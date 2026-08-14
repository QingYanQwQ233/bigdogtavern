package com.tavern.app

import android.content.Context
import android.util.Base64
import fi.iki.elonen.NanoHTTPD
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLDecoder
import java.util.HashMap

/**
 * Tavern 内嵌服务器：移植自 server.js（零改动前端，页面与 /api/ 同源 http://127.0.0.1:3000）
 *
 * 端点：
 *   POST /api/chat         聊天代理（SSE 流式转发 /chat/completions）
 *   POST /api/image        文生图代理（openai /images/generations | sd /sdapi/v1/txt2img）
 *   POST /api/image-save   图片落盘 → filesDir/images/，返回 /images/xxx.png
 *   GET  /api/models       模型列表代理
 *   GET  /api/data/seed    返回 assets/data/_defaults.json（模板）
 *   GET/PUT /api/data/:type 读写 filesDir/data/（characters/presets/lorebooks/settings）
 *   其他                    静态资源（assets 根；/images/ → filesDir/images）
 */
class TavernServer(private val ctx: Context) : NanoHTTPD("127.0.0.1", 3000) { // 仅绑定回环，同机其他 App 无法访问

    private val dataDir: File = File(ctx.filesDir, "data")
    private val imgDir: File = File(ctx.filesDir, "images")
    private val dataTypes = setOf("characters", "presets", "lorebooks", "settings")
    private val worldsFile: File = File(dataDir, "worlds.json")
    private val worldDraftsFile: File = File(dataDir, "world-drafts.json")

    override fun serve(session: IHTTPSession): Response {
        val uri = try {
            URLDecoder.decode(session.uri, "UTF-8")
        } catch (e: Exception) {
            session.uri
        }
        return try {
            when {
                session.method == Method.POST && uri == "/api/chat" -> handleChat(session)
                session.method == Method.POST && uri == "/api/image" -> handleImage(session)
                session.method == Method.POST && uri == "/api/image-save" -> handleImageSave(session)
                session.method == Method.GET && uri == "/api/models" -> handleModels(session)
                session.method == Method.GET && uri == "/api/worlds" -> handleWorlds()
                session.method == Method.POST && uri == "/api/world-drafts" -> handleWorldDraftCreate(session)
                uri.startsWith("/api/world-drafts/") && (session.method == Method.GET || session.method == Method.PUT) ->
                    handleWorldDraftItem(session, uri.removePrefix("/api/world-drafts/"))
                uri.startsWith("/api/data/") -> handleData(session, uri)
                else -> serveStatic(uri)
            }
        } catch (e: Exception) {
            // 以 JSON 返回具体错误，前端能直接展示便于诊断
            json(Response.Status.INTERNAL_ERROR, JSONObject().put("error", "server error: ${e.message}"))
        }
    }

    /* ---------- 工具 ---------- */

    private fun readBody(session: IHTTPSession): String {
        // NanoHTTPD 标准方式：parseBody 把请求体解析到 files["postData"]。
        // 直接读 session.inputStream 在 NanoHTTPD 下不可靠（body 可能读不到 → JSON 解析失败 → 500）。
        return try {
            val files = HashMap<String, String>()
            session.parseBody(files)
            files["postData"] ?: ""
        } catch (e: Exception) {
            ""
        }
    }

    private fun openUpstream(baseUrl: String, path: String, apiKey: String, body: String?): HttpURLConnection {
        val url = URL(baseUrl.trimEnd('/') + path)
        val conn = url.openConnection() as HttpURLConnection
        conn.connectTimeout = 60_000
        conn.readTimeout = 120_000
        // 所有请求属性必须在任何可能触发连接的操作之前设置！
        // 写 body（outputStream）会隐式 connect()，之后再 setRequestProperty 会抛
        // "Cannot set request property after connection is made" → 500
        if (apiKey.isNotBlank()) conn.setRequestProperty("Authorization", "Bearer $apiKey")
        if (body != null) {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        } else {
            conn.requestMethod = "GET"
        }
        return conn
    }

    private fun upstreamBody(conn: HttpURLConnection): InputStream =
        if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream

    private fun mimeOf(name: String): String = when (name.substringAfterLast('.').lowercase()) {
        "html" -> "text/html; charset=utf-8"
        "css" -> "text/css; charset=utf-8"
        "js" -> "text/javascript; charset=utf-8"
        "json", "webmanifest" -> "application/json; charset=utf-8"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "gif" -> "image/gif"
        "webp" -> "image/webp"
        "ico" -> "image/x-icon"
        else -> "application/octet-stream"
    }

    private fun json(res: Response.Status, obj: JSONObject): Response =
        // 禁用 gzip：NanoHTTPD 默认对 json 启用 gzip+chunked，WebView fetch 在错误路径上解压失败 → body 读不到
        newFixedLengthResponse(res, "application/json; charset=utf-8", obj.toString()).also { it.setGzipEncoding(false) }

    private fun jsonArray(array: org.json.JSONArray): Response =
        newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", array.toString()).also { it.setGzipEncoding(false) }

    private fun readArray(file: File, defaultKey: String): org.json.JSONArray {
        dataDir.mkdirs()
        if (file.exists()) return org.json.JSONArray(file.readText(Charsets.UTF_8))
        val defaults = JSONObject(ctx.assets.open("data/_defaults.json").readBytes().toString(Charsets.UTF_8))
        val seeded = defaults.optJSONArray(defaultKey) ?: org.json.JSONArray()
        file.writeText(seeded.toString(), Charsets.UTF_8)
        return org.json.JSONArray(seeded.toString())
    }

    private fun writeArray(file: File, value: org.json.JSONArray) {
        dataDir.mkdirs()
        file.writeText(value.toString(), Charsets.UTF_8)
    }

    private fun worldSummary(world: JSONObject, saveCount: Int = 0): JSONObject {
        val tags = world.optJSONArray("tags") ?: org.json.JSONArray()
        val locations = world.optJSONArray("locations") ?: org.json.JSONArray()
        val npcs = world.optJSONArray("npcs") ?: world.optJSONArray("npcIds") ?: org.json.JSONArray()
        return JSONObject().apply {
            put("id", world.optString("id"))
            put("version", world.optInt("version", 1))
            put("title", world.optString("title", world.optString("id")))
            put("summary", world.optString("summary"))
            put("coverImage", world.optString("coverImage"))
            put("tags", tags)
            put("locationCount", locations.length())
            put("npcCount", npcs.length())
            put("saveCount", saveCount)
        }
    }

    private fun handleWorlds(): Response {
        return try {
            val worlds = readArray(worldsFile, "worlds")
            val result = org.json.JSONArray()
            for (index in 0 until worlds.length()) {
                val world = worlds.optJSONObject(index) ?: continue
                result.put(worldSummary(world))
            }
            jsonArray(result)
        } catch (e: Exception) {
            json(Response.Status.INTERNAL_ERROR, JSONObject().put("error", "worlds read failed: ${e.message}"))
        }
    }

    private fun draftView(draft: JSONObject): JSONObject = JSONObject(draft.toString())

    @Synchronized
    private fun handleWorldDraftCreate(session: IHTTPSession): Response {
        return try {
            val body = JSONObject(readBody(session))
            val worldId = body.optString("worldId")
            if (worldId.isBlank()) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "missing worldId"))
            val baseVersion = if (body.has("baseVersion")) body.optInt("baseVersion", 0) else null
            val worlds = readArray(worldsFile, "worlds")
            var source: JSONObject? = null
            for (index in 0 until worlds.length()) {
                val world = worlds.optJSONObject(index) ?: continue
                if (world.optString("id") == worldId && (baseVersion == null || world.optInt("version", 1) == baseVersion)) source = world
            }
            if (source == null) return json(Response.Status.NOT_FOUND, JSONObject().put("error", "world not found"))
            val drafts = readArray(worldDraftsFile, "worldDrafts")
            for (index in 0 until drafts.length()) {
                val existing = drafts.optJSONObject(index) ?: continue
                if (existing.optString("worldId") == worldId) return json(Response.Status.OK, draftView(existing))
            }
            val now = System.currentTimeMillis()
            val draft = JSONObject().apply {
                put("schemaVersion", 1)
                put("worldId", worldId)
                put("baseVersion", source!!.optInt("version", 1))
                put("world", JSONObject(source.toString()))
                put("createdAt", now)
                put("updatedAt", now)
            }
            drafts.put(draft)
            writeArray(worldDraftsFile, drafts)
            val response = draftView(draft)
            json(Response.Status.CREATED, response)
        } catch (e: Exception) {
            json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid world draft: ${e.message}"))
        }
    }

    @Synchronized
    private fun handleWorldDraftItem(session: IHTTPSession, worldId: String): Response {
        if (worldId.isBlank()) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "missing worldId"))
        return try {
            val drafts = readArray(worldDraftsFile, "worldDrafts")
            var index = -1
            for (i in 0 until drafts.length()) if (drafts.optJSONObject(i)?.optString("worldId") == worldId) { index = i; break }
            if (index < 0) return json(Response.Status.NOT_FOUND, JSONObject().put("error", "world draft not found"))
            val current = drafts.getJSONObject(index)
            if (session.method == Method.GET) return json(Response.Status.OK, draftView(current))
            val payload = JSONObject(readBody(session))
            val expectedUpdatedAt = payload.optLong("expectedUpdatedAt", -1)
            if (expectedUpdatedAt >= 0 && expectedUpdatedAt != current.optLong("updatedAt")) {
                return json(Response.Status.CONFLICT, JSONObject().put("error", "world draft was updated"))
            }
            val world = JSONObject(current.optJSONObject("world")?.toString() ?: "{}")
            val fields = arrayOf("title", "summary", "tags", "lorebookIds", "setting", "rules", "playerCreation", "turnContract", "failure", "ending", "time", "events", "factions", "conflicts", "locations", "npcs", "mapGeneration")
            for (field in fields) if (payload.has(field)) world.put(field, payload.get(field))
            val next = JSONObject(current.toString()).apply {
                put("world", world)
                put("baseVersion", payload.optInt("baseVersion", current.optInt("baseVersion", 1)))
                put("updatedAt", maxOf(System.currentTimeMillis(), current.optLong("updatedAt") + 1))
            }
            drafts.put(index, next)
            writeArray(worldDraftsFile, drafts)
            json(Response.Status.OK, draftView(next))
        } catch (e: Exception) {
            json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid world draft: ${e.message}"))
        }
    }

    /* ---------- /api/chat：SSE 流式转发 ---------- */

    private fun handleChat(session: IHTTPSession): Response {
        val body = JSONObject(readBody(session))
        val baseUrl = body.optString("baseUrl", "")
        val apiKey = body.optString("apiKey", "")
        val payload = body.optJSONObject("body") ?: return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "missing body"))
        if (baseUrl.isBlank()) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "missing baseUrl"))
        val conn = openUpstream(baseUrl, "/chat/completions", apiKey, payload.toString())
        val code = conn.responseCode
        // 上游非 2xx：把上游正文包进 JSON，前端才能看到具体错误（否则只显示 "HTTP 500" 无从诊断）
        if (code !in 200..299) {
            val errBody = upstreamBody(conn).readBytes().toString(Charsets.UTF_8)
            return newFixedLengthResponse(Response.Status.lookup(code) ?: Response.Status.INTERNAL_ERROR,
                "application/json; charset=utf-8",
                JSONObject().put("error", JSONObject().put("message", "上游 HTTP $code: ${errBody.take(400)}")).toString())
                .also { it.setGzipEncoding(false) }
        }
        val status = Response.Status.lookup(code) ?: Response.Status.INTERNAL_ERROR
        val contentType = conn.contentType ?: "application/json"
        val mime = if (contentType.contains("event-stream")) "text/event-stream; charset=utf-8" else "$contentType; charset=utf-8"
        // chunked + InputStream：WebView 逐块接收，SSE 流式打字效果保留（必须禁 gzip，否则流被压缩破坏）
        return newChunkedResponse(status, mime, upstreamBody(conn)).also { it.setGzipEncoding(false) }
    }

    /* ---------- /api/image：文生图代理 ---------- */

    private fun handleImage(session: IHTTPSession): Response {
        val body = JSONObject(readBody(session))
        val baseUrl = body.optString("baseUrl", "")
        val apiKey = body.optString("apiKey", "")
        val kind = body.optString("kind", "openai")
        val payload = body.optJSONObject("body") ?: return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "missing body"))
        if (baseUrl.isBlank()) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "missing baseUrl"))
        // kind=sd → img2img；openai 兼容：body 含 images（参考图）→ /images/edits，否则 /images/generations
        val path = if (kind == "sd") "/sdapi/v1/txt2img"
            else if (payload.has("images")) "/images/edits"
            else "/images/generations"
        val conn = openUpstream(baseUrl, path, apiKey, payload.toString())
        val code = conn.responseCode
        val text = upstreamBody(conn).readBytes().toString(Charsets.UTF_8)
        if (code !in 200..299) {
            return newFixedLengthResponse(Response.Status.lookup(code) ?: Response.Status.INTERNAL_ERROR,
                "application/json; charset=utf-8",
                JSONObject().put("error", JSONObject().put("message", "上游 HTTP $code: ${text.take(300)}")).toString())
                .also { it.setGzipEncoding(false) }
        }
        return newFixedLengthResponse(Response.Status.lookup(code) ?: Response.Status.INTERNAL_ERROR,
            "application/json; charset=utf-8", text).also { it.setGzipEncoding(false) }
    }

    /* ---------- /api/image-save：图片落盘 ---------- */

    private fun handleImageSave(session: IHTTPSession): Response {
        val body = JSONObject(readBody(session))
        imgDir.mkdirs()
        val name = (System.currentTimeMillis().toString(36) + (1000..9999).random()) + ".png"
        val target = File(imgDir, name)
        try {
            val b64 = body.optString("b64", "")
            if (b64.isNotBlank()) {
                val data = if (b64.startsWith("data:")) b64.substringAfter("base64,") else b64
                FileOutputStream(target).use { it.write(Base64.decode(data, Base64.DEFAULT)) }
            } else {
                val url = body.optString("url", "")
                if (url.isBlank()) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "missing b64 or url"))
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.connectTimeout = 30_000
                conn.readTimeout = 60_000
                if (conn.responseCode !in 200..299) return json(Response.Status.INTERNAL_ERROR, JSONObject().put("error", "download failed HTTP ${conn.responseCode}"))
                FileOutputStream(target).use { conn.inputStream.copyTo(it) }
            }
        } catch (e: Exception) {
            return json(Response.Status.INTERNAL_ERROR, JSONObject().put("error", "save failed: ${e.message}"))
        }
        return json(Response.Status.OK, JSONObject().put("path", "/images/$name"))
    }

    /* ---------- /api/models ---------- */

    private fun handleModels(session: IHTTPSession): Response {
        val baseUrl = session.headers["x-base-url"] ?: return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "missing X-Base-Url"))
        val apiKey = session.headers["x-api-key"] ?: ""
        val conn = openUpstream(baseUrl, "/models", apiKey, null)
        val code = conn.responseCode
        val text = upstreamBody(conn).readBytes().toString(Charsets.UTF_8)
        if (code !in 200..299) {
            return newFixedLengthResponse(Response.Status.lookup(code) ?: Response.Status.INTERNAL_ERROR,
                "application/json; charset=utf-8",
                JSONObject().put("error", JSONObject().put("message", "上游 HTTP $code: ${text.take(300)}")).toString())
                .also { it.setGzipEncoding(false) }
        }
        return newFixedLengthResponse(Response.Status.lookup(code) ?: Response.Status.INTERNAL_ERROR,
            "application/json; charset=utf-8", text).also { it.setGzipEncoding(false) }
    }

    /* ---------- /api/data/:type ---------- */

    private fun handleData(session: IHTTPSession, uri: String): Response {
        val type = uri.removePrefix("/api/data/")
        if (type == "seed") {
            // 模板：assets/data/_defaults.json
            return try {
                val stream = ctx.assets.open("data/_defaults.json")
                newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", stream.readBytes().toString(Charsets.UTF_8))
            } catch (e: Exception) {
                json(Response.Status.INTERNAL_ERROR, JSONObject().put("error", "seed missing: ${e.message}"))
            }
        }
        if (type !in dataTypes) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "unknown data type"))
        dataDir.mkdirs()
        val f = File(dataDir, "$type.json")
        if (session.method == Method.GET) {
            if (!f.exists()) initFromDefaults(f, type) // 首次：从 _defaults.json 对应段初始化
            if (!f.exists()) return json(Response.Status.OK, JSONObject().put("_empty", true))
            return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", f.readText(Charsets.UTF_8))
        }
        if (session.method == Method.PUT) {
            val raw = readBody(session)
            try {
                JSONObject(raw) // 校验
            } catch (e: Exception) {
                return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid JSON"))
            }
            f.writeText(raw, Charsets.UTF_8)
            return json(Response.Status.OK, JSONObject().put("ok", true))
        }
        return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "method not allowed"))
    }

    /** 从 assets/data/_defaults.json 取对应段写入 filesDir（等价 server.js 的 ensureDataFiles） */
    private fun initFromDefaults(f: File, type: String) {
        try {
            val defaults = JSONObject(ctx.assets.open("data/_defaults.json").readBytes().toString(Charsets.UTF_8))
            val seg = defaults.opt(type) ?: return
            f.writeText(seg.toString(), Charsets.UTF_8)
        } catch (e: Exception) { /* 忽略：文件不存在时 GET 返回空结构 */ }
    }

    /* ---------- 静态资源 ---------- */

    private fun serveStatic(uri: String): Response {
        if (uri.startsWith("/images/")) {
            val name = uri.removePrefix("/images/")
            // 路径穿越防护：仅允许纯文件名
            if (name.isBlank() || !name.matches(Regex("[A-Za-z0-9._-]+"))) {
                return newFixedLengthResponse(Response.Status.BAD_REQUEST, MIME_PLAINTEXT, "Bad Request")
            }
            val f = File(imgDir, name)
            if (f.exists()) return newFixedLengthResponse(Response.Status.OK, mimeOf(f.name), f.inputStream(), f.length())
            return newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Not Found")
        }
        val assetPath = if (uri == "/" || uri == "") "index.html" else uri.removePrefix("/")
        val mime = mimeOf(assetPath)
        return try {
            val stream: InputStream = ctx.assets.open(assetPath)
            newFixedLengthResponse(Response.Status.OK, mime, stream, stream.available().toLong())
        } catch (e: Exception) {
            newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Not Found")
        }
    }
}
