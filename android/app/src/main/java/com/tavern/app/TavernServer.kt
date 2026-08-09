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

/**
 * Tavern 内嵌服务器：移植自 server.js（零改动前端，页面与 /api/* 同源 http://127.0.0.1:3000）
 *
 * 端点：
 *   POST /api/chat         聊天代理（SSE 流式转发 /chat/completions）
 *   POST /api/image        文生图代理（openai /images/generations | sd /sdapi/v1/txt2img）
 *   POST /api/image-save   图片落盘 → filesDir/images/，返回 /images/xxx.png
 *   GET  /api/models       模型列表代理
 *   GET  /api/data/seed    返回 assets/data/_defaults.json（模板）
 *   GET/PUT /api/data/:type 读写 filesDir/data/（characters/presets/lorebooks/settings）
 *   其他                    静态资源（assets 根；/images/* → filesDir/images）
 */
class TavernServer(private val ctx: Context) : NanoHTTPD("127.0.0.1", 3000) { // 仅绑定回环，同机其他 App 无法访问

    private val dataDir: File = File(ctx.filesDir, "data")
    private val imgDir: File = File(ctx.filesDir, "images")
    private val dataTypes = setOf("characters", "presets", "lorebooks", "settings")

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
                uri.startsWith("/api/data/") -> handleData(session, uri)
                else -> serveStatic(uri)
            }
        } catch (e: Exception) {
            newFixedLengthResponse(Response.Status.INTERNAL_ERROR, MIME_PLAINTEXT, "server error: ${e.message}")
        }
    }

    /* ---------- 工具 ---------- */

    private fun readBody(session: IHTTPSession): String {
        val len = session.headers["content-length"]?.toIntOrNull() ?: 0
        if (len <= 0) return ""
        val buf = ByteArray(len)
        var off = 0
        while (off < len) {
            val r = session.inputStream.read(buf, off, len - off)
            if (r < 0) break
            off += r
        }
        return String(buf, 0, off, Charsets.UTF_8)
    }

    private fun openUpstream(baseUrl: String, path: String, apiKey: String, body: String?): HttpURLConnection {
        val url = URL(baseUrl.trimEnd('/') + path)
        val conn = url.openConnection() as HttpURLConnection
        conn.connectTimeout = 60_000
        conn.readTimeout = 120_000
        if (body != null) {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        } else {
            conn.requestMethod = "GET"
        }
        if (apiKey.isNotBlank()) conn.setRequestProperty("Authorization", "Bearer $apiKey")
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
        newFixedLengthResponse(res, "application/json; charset=utf-8", obj.toString())

    /* ---------- /api/chat：SSE 流式转发 ---------- */

    private fun handleChat(session: IHTTPSession): Response {
        val body = JSONObject(readBody(session))
        val baseUrl = body.optString("baseUrl", "")
        val apiKey = body.optString("apiKey", "")
        val payload = body.optJSONObject("body") ?: return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "missing body"))
        if (baseUrl.isBlank()) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "missing baseUrl"))
        val conn = openUpstream(baseUrl, "/chat/completions", apiKey, payload.toString())
        val status = Response.Status.lookup(conn.responseCode) ?: Response.Status.INTERNAL_ERROR
        val contentType = conn.contentType ?: "application/json"
        val mime = if (contentType.contains("event-stream")) "text/event-stream; charset=utf-8" else "$contentType; charset=utf-8"
        // chunked + InputStream：WebView 逐块接收，SSE 流式打字效果保留
        return newChunkedResponse(status, mime, upstreamBody(conn))
    }

    /* ---------- /api/image：文生图代理 ---------- */

    private fun handleImage(session: IHTTPSession): Response {
        val body = JSONObject(readBody(session))
        val baseUrl = body.optString("baseUrl", "")
        val apiKey = body.optString("apiKey", "")
        val kind = body.optString("kind", "openai")
        val payload = body.optJSONObject("body") ?: return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "missing body"))
        if (baseUrl.isBlank()) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "missing baseUrl"))
        val path = if (kind == "sd") "/sdapi/v1/txt2img" else "/images/generations"
        val conn = openUpstream(baseUrl, path, apiKey, payload.toString())
        val text = upstreamBody(conn).readBytes().toString(Charsets.UTF_8)
        return newFixedLengthResponse(Response.Status.lookup(conn.responseCode) ?: Response.Status.INTERNAL_ERROR,
            "application/json; charset=utf-8", text)
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
                if (conn.responseCode !in 200..299) return json(Response.Status.BAD_GATEWAY, JSONObject().put("error", "download failed HTTP ${conn.responseCode}"))
                FileOutputStream(target).use { conn.inputStream.copyTo(it) }
            }
        } catch (e: Exception) {
            return json(Response.Status.BAD_GATEWAY, JSONObject().put("error", "save failed: ${e.message}"))
        }
        return json(Response.Status.OK, JSONObject().put("path", "/images/$name"))
    }

    /* ---------- /api/models ---------- */

    private fun handleModels(session: IHTTPSession): Response {
        val baseUrl = session.headers["x-base-url"] ?: return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "missing X-Base-Url"))
        val apiKey = session.headers["x-api-key"] ?: ""
        val conn = openUpstream(baseUrl, "/models", apiKey, null)
        val text = upstreamBody(conn).readBytes().toString(Charsets.UTF_8)
        return newFixedLengthResponse(Response.Status.lookup(conn.responseCode) ?: Response.Status.INTERNAL_ERROR,
            "application/json; charset=utf-8", text)
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
            if (f.exists()) return newFixedLengthResponse(Response.Status.OK, mimeOf(f.name), f.inputStream())
            return newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Not Found")
        }
        val assetPath = if (uri == "/" || uri == "") "index.html" else uri.removePrefix("/")
        val mime = mimeOf(assetPath)
        return try {
            val stream: InputStream = ctx.assets.open(assetPath)
            newFixedLengthResponse(Response.Status.OK, mime, stream)
        } catch (e: Exception) {
            newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Not Found")
        }
    }
}
