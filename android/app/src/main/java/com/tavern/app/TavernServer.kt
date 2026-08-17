package com.tavern.app

import android.content.Context
import android.net.Uri
import android.util.Base64
import fi.iki.elonen.NanoHTTPD
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLDecoder
import java.security.MessageDigest
import java.util.HashMap

/**
 * Tavern 内嵌服务器：移植自 server.js（零改动前端，页面与 /api/ 同源 http://127.0.0.1:3000）
 *
 * 端点：
 *   POST /api/chat         聊天代理（SSE 流式转发 /chat/completions）
 *   POST /api/image        文生图代理（openai /images/generations | sd /sdapi/v1/txt2img）
 *   POST /api/image-save   图片落盘 → filesDir/images/，返回 /images/xxx.png
 *   GET  /api/models       模型列表代理
 *   GET  /api/worlds/:id  世界卡详情
 *   GET/POST /api/world-saves  世界存档列表 / 创建
 *   GET/POST/PUT /api/world-saves/:id  读取 / Typed Patch 回合 / 完整存档兼容写入
 *   PUT  /api/world-saves/:id/setup 开局规划保存
 *   POST /api/world-saves/:id/opening-candidate AI 开场候选保存
 *   POST /api/world-saves/:id/opening  AI 开场提交
 *   GET  /api/data/seed    返回 assets/data/_defaults.json（模板）
 *   GET/PUT /api/data/:type 读写 filesDir/data/（characters/presets/lorebooks/settings/sessions）
 *   其他                    静态资源（assets 根；/images/ → filesDir/images）
 *
 * Android 端的完整世界规则校验仍由 Node server 维护；这里保持同源离线可用，
 * 只在存档边界执行 revision、ID、Typed Patch 白名单和本地文件隔离校验。
 */
class TavernServer(private val ctx: Context) : NanoHTTPD("127.0.0.1", 3000) { // 仅绑定回环，同机其他 App 无法访问

    private val dataDir: File = File(ctx.filesDir, "data")
    private val imgDir: File = File(ctx.filesDir, "images")
    private val dataTypes = setOf("characters", "presets", "lorebooks", "settings", "user", "sessions")
    private val worldsFile: File = File(dataDir, "worlds.json")
    private val worldDraftsFile: File = File(dataDir, "world-drafts.json")
    private val worldImportsFile: File = File(dataDir, "world-imports.json")
    private val savesDir: File = File(dataDir, "saves")

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
                uri.substringBefore('?').startsWith("/api/worlds/") && session.method == Method.GET ->
                    handleWorldItem(uri)
                uri.substringBefore('?') == "/api/world-saves" && (session.method == Method.GET || session.method == Method.POST) ->
                    handleWorldSavesRoot(session, uri)
                uri.substringBefore('?').startsWith("/api/world-saves/") ->
                    handleWorldSaveItem(session, uri.substringBefore('?').removePrefix("/api/world-saves/"))
                session.method == Method.POST && uri == "/api/world-drafts" -> handleWorldDraftCreate(session)
                uri.startsWith("/api/world-drafts/") && (session.method == Method.GET || session.method == Method.PUT) ->
                    handleWorldDraftItem(session, uri.removePrefix("/api/world-drafts/"))
                session.method == Method.POST && uri == "/api/world-imports" -> handleWorldImportPreview(session)
                uri.startsWith("/api/world-imports/") && (session.method == Method.GET || session.method == Method.POST) ->
                    handleWorldImportItem(session, uri.removePrefix("/api/world-imports/"))
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
        // NanoHTTPD 对 POST 的原始数据放在 postData，对 PUT 则写入临时文件 content。
        // 之前只读取 postData，导致 APK 的 PUT /setup 被当成空 JSON。
        val files = HashMap<String, String>()
        try {
            session.parseBody(files)
        } catch (e: Exception) {
            throw IllegalArgumentException("request body parse failed: ${e.message}", e)
        }
        files["postData"]?.takeIf { it.isNotBlank() }?.let { return it }
        files["content"]?.let { path ->
            val content = File(path).readText(Charsets.UTF_8)
            if (content.isNotBlank()) return content
        }
        throw IllegalArgumentException("request body is empty")
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
        writeTextAtomic(file, value.toString())
    }

    private fun writeTextAtomic(file: File, value: String) {
        file.parentFile?.mkdirs()
        val temp = File(file.parentFile, file.name + ".tmp")
        temp.writeText(value, Charsets.UTF_8)
        if (!temp.renameTo(file)) file.writeText(value, Charsets.UTF_8)
    }

    private fun readObject(file: File): JSONObject? = if (file.exists()) JSONObject(file.readText(Charsets.UTF_8)) else null

    private fun writeObject(file: File, value: JSONObject) = writeTextAtomic(file, value.toString())

    private fun saveFile(saveId: String): File? {
        if (!saveId.matches(Regex("[A-Za-z0-9_-]{1,120}"))) return null
        return File(savesDir, "$saveId.json")
    }

    private fun findWorld(worldId: String, version: Int?): JSONObject? {
        val worlds = readArray(worldsFile, "worlds")
        for (index in 0 until worlds.length()) {
            val world = worlds.optJSONObject(index) ?: continue
            if (world.optString("id") == worldId && (version == null || world.optInt("version", 1) == version)) return JSONObject(world.toString())
        }
        return null
    }

    private fun queryValue(uri: String, key: String): String? = Uri.parse(uri).getQueryParameter(key)

    private fun nowId(prefix: String): String = "$prefix-${System.currentTimeMillis().toString(36)}-${(1000..9999).random()}"

    private fun sha256Text(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }

    private fun saveSummary(save: JSONObject): JSONObject = JSONObject().apply {
        put("id", save.optString("id"))
        put("worldId", save.optString("worldId"))
        put("worldVersion", save.optInt("worldVersion", 1))
        put("name", save.optString("name"))
        put("revision", save.optInt("revision", 0))
        put("updatedAt", save.optLong("updatedAt", 0L))
        put("opening", save.optString("opening"))
        put("setupStatus", save.optJSONObject("setup")?.optString("status", "active") ?: "active")
        put("openingReady", save.optJSONObject("setup")?.optString("status", "active") != "planning")
    }

    private fun ensureSaveState(state: JSONObject) {
        if (!state.has("inventory")) state.put("inventory", org.json.JSONArray())
        if (!state.has("quests")) state.put("quests", org.json.JSONArray())
        if (!state.has("goals")) state.put("goals", org.json.JSONArray())
        if (!state.has("leads")) state.put("leads", org.json.JSONArray())
        if (!state.has("worldEvents")) state.put("worldEvents", org.json.JSONArray())
    }

    private fun handleWorldSaveSetup(session: IHTTPSession, file: File): Response {
        return try {
            val current = readObject(file) ?: return json(Response.Status.NOT_FOUND, JSONObject().put("error", "save not found"))
            val payload = JSONObject(readBody(session))
            val commandId = payload.optString("commandId")
            val expected = payload.optInt("expectedRevision", -1)
            if (!safeCommandId(commandId)) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid commandId"))
            if (hasCommand(current, commandId)) return json(Response.Status.OK, current)
            if (current.optJSONObject("setup")?.optString("status") != "planning") return json(Response.Status.CONFLICT, JSONObject().put("error", "当前存档已经完成开局规划"))
            if (expected != current.optInt("revision", 0)) return json(Response.Status.CONFLICT, JSONObject().put("error", "revision conflict").put("revision", current.optInt("revision", 0)))
            val world = findWorld(current.optString("worldId"), current.optInt("worldVersion", 1)) ?: return json(Response.Status.CONFLICT, JSONObject().put("error", "world not found"))
            val plan = if (payload.has("plan") && !payload.isNull("plan")) payload.optJSONObject("plan") else current.optJSONObject("setup")?.optJSONObject("plan")
            if (payload.has("plan") && !payload.isNull("plan") && plan == null) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "plan 必须是对象"))
            if (plan != null) openingPlanError(plan, world)?.let { return json(Response.Status.BAD_REQUEST, JSONObject().put("error", it)) }
            val game = payload.optJSONObject("game")?.let { JSONObject(it.toString()) }
                ?: current.optJSONObject("setup")?.optJSONObject("game")?.let { JSONObject(it.toString()) }
                ?: world.optJSONObject("start")?.optJSONObject("sessionConfig")?.let { JSONObject(it.toString()) }
                ?: JSONObject()
            val next = JSONObject(current.toString()).apply {
                put("setup", JSONObject().apply { put("status", "planning"); put("game", game); put("plan", plan ?: JSONObject.NULL); put("candidate", JSONObject.NULL) })
                if (payload.has("player") && !payload.isNull("player")) {
                    val player = payload.optJSONObject("player")
                    if (player != null) {
                        put("player", JSONObject(optJSONObject("player")?.toString() ?: "{}").apply { put("snapshot", player) })
                        put("state", JSONObject(optJSONObject("state")?.toString() ?: "{}").apply { put("player", player) })
                    }
                }
                put("revision", expected + 1); put("updatedAt", System.currentTimeMillis())
            }
            val receipts = current.optJSONArray("receipts") ?: org.json.JSONArray()
            receipts.put(JSONObject().put("kind", if (payload.has("plan")) "setup-plan" else "setup").put("commandId", commandId).put("revision", expected + 1).put("plan", plan ?: JSONObject.NULL).put("game", game))
            next.put("receipts", receipts)
            writeObject(file, next)
            json(Response.Status.OK, next)
        } catch (e: Exception) { json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid setup request: ${e.message}")) }
    }

    private fun handleWorldSaveOpeningCandidate(session: IHTTPSession, file: File): Response {
        return try {
            val current = readObject(file) ?: return json(Response.Status.NOT_FOUND, JSONObject().put("error", "save not found"))
            val payload = JSONObject(readBody(session))
            val commandId = payload.optString("commandId")
            val expected = payload.optInt("expectedRevision", -1)
            if (!safeCommandId(commandId)) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid commandId"))
            if (hasCommand(current, commandId)) return json(Response.Status.OK, current)
            if (current.optJSONObject("setup")?.optString("status") != "planning") return json(Response.Status.CONFLICT, JSONObject().put("error", "当前存档已经完成开局规划"))
            if (current.optJSONObject("setup")?.optJSONObject("plan") == null) return json(Response.Status.CONFLICT, JSONObject().put("error", "请先保存开局规划"))
            if (expected != current.optInt("revision", 0)) return json(Response.Status.CONFLICT, JSONObject().put("error", "revision conflict").put("revision", current.optInt("revision", 0)))
            val candidate = payload.optJSONObject("candidate") ?: return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "candidate 必须是对象"))
            openingCandidateError(candidate)?.let { return json(Response.Status.BAD_REQUEST, JSONObject().put("error", it)) }
            val storedCandidate = JSONObject().apply {
                put("narrative", candidate.optString("narrative").trim())
                put("options", candidate.optJSONArray("options"))
                put("generatedAt", System.currentTimeMillis())
                put("commandId", commandId)
                put("sourceRevision", expected + 1)
            }
            val next = JSONObject(current.toString()).apply {
                put("setup", JSONObject(current.optJSONObject("setup")?.toString() ?: "{}").apply { put("status", "planning"); put("candidate", storedCandidate) })
                put("revision", expected + 1); put("updatedAt", System.currentTimeMillis())
            }
            val receipts = current.optJSONArray("receipts") ?: org.json.JSONArray()
            receipts.put(JSONObject().put("kind", "opening-candidate").put("commandId", commandId).put("revision", expected + 1))
            next.put("receipts", receipts)
            writeObject(file, next)
            json(Response.Status.OK, next)
        } catch (e: Exception) { json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid opening candidate: ${e.message}")) }
    }

    @Synchronized
    private fun handleWorldItem(uri: String): Response {
        val path = uri.substringBefore('?').removePrefix("/api/worlds/")
        if (path.isBlank() || path.contains('/')) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid world id"))
        val world = findWorld(path, queryValue(uri, "version")?.toIntOrNull())
            ?: return json(Response.Status.NOT_FOUND, JSONObject().put("error", "world not found"))
        return json(Response.Status.OK, world)
    }

    @Synchronized
    private fun handleWorldSavesRoot(session: IHTTPSession, uri: String): Response {
        return try {
            savesDir.mkdirs()
            if (session.method == Method.GET) {
                val worldId = queryValue(uri, "worldId")
                val result = org.json.JSONArray()
                savesDir.listFiles()?.filter { it.extension == "json" }?.forEach { file ->
                    val save = readObject(file) ?: return@forEach
                    if (worldId == null || save.optString("worldId") == worldId) result.put(saveSummary(save))
                }
                return jsonArray(result)
            }
            val body = JSONObject(readBody(session))
            val worldId = body.optString("worldId")
            if (worldId.isBlank()) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "missing worldId"))
            val world = findWorld(worldId, if (body.has("worldVersion")) body.optInt("worldVersion", 1) else null)
                ?: return json(Response.Status.NOT_FOUND, JSONObject().put("error", "world not found"))
            val saveId = nowId("save")
            val start = world.optJSONObject("start") ?: JSONObject()
            val state = JSONObject(start.optJSONObject("initialState")?.toString() ?: "{}")
            ensureSaveState(state)
            val player = body.optJSONObject("player")?.let { JSONObject(it.toString()) }
            if (player != null) state.put("player", JSONObject(player.toString()))
            val now = System.currentTimeMillis()
            val save = JSONObject().apply {
                put("id", saveId)
                put("worldId", world.optString("id"))
                put("worldVersion", world.optInt("version", 1))
                put("name", body.optString("name", world.optString("title", saveId)))
                put("createdAt", now)
                put("updatedAt", now)
                put("revision", 0)
                put("player", JSONObject().put("snapshot", player ?: JSONObject()))
                put("state", state)
                put("opening", start.optString("opening"))
                put("openingMode", if (start.optString("openingMode") == "static") "static" else "ai")
                put("setup", JSONObject().apply {
                    put("status", if (start.optString("openingMode") == "static") "active" else "planning")
                    put("game", start.optJSONObject("sessionConfig") ?: JSONObject())
                    put("plan", JSONObject.NULL)
                    put("candidate", JSONObject.NULL)
                })
                put("openingOptions", org.json.JSONArray())
                put("turns", org.json.JSONArray())
                put("receipts", org.json.JSONArray())
                put("eventLedger", org.json.JSONArray())
                put("eventMemory", org.json.JSONArray())
                put("npcStates", JSONObject())
                put("generatedEntities", JSONObject())
            }
            writeObject(File(savesDir, "$saveId.json"), save)
            json(Response.Status.CREATED, save)
        } catch (e: Exception) {
            json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid world save: ${e.message}"))
        }
    }

    private fun hasCommand(save: JSONObject, commandId: String): Boolean {
        val receipts = save.optJSONArray("receipts") ?: return false
        for (index in 0 until receipts.length()) if (receipts.optJSONObject(index)?.optString("commandId") == commandId) return true
        return false
    }

    private fun safeCommandId(value: String): Boolean = value.matches(Regex("[A-Za-z0-9._:-]{1,200}"))

    private fun applyNumericDelta(bucket: JSONObject, id: String, delta: Double): String? {
        if (!bucket.has(id) || bucket.isNull(id)) return "未声明数值字段：$id"
        val current = bucket.optDouble(id, Double.NaN)
        if (!current.isFinite() || !delta.isFinite() || kotlin.math.abs(delta) > 1_000_000_000) return "数值无效：$id"
        val next = current + delta
        if (!next.isFinite() || kotlin.math.abs(next) > 1_000_000_000_000) return "数值越界：$id"
        bucket.put(id, next)
        return null
    }

    private fun applyMobilePatch(world: JSONObject, state: JSONObject, patch: JSONObject): String? {
        if (patch.optString("protocol") != "tavern.rpg.turn" || patch.optInt("version", -1) != 1) return "unsupported patch protocol"
        val updates = patch.optJSONArray("updates") ?: return "patch.updates 必须是数组"
        if (updates.length() > 32) return "patch.updates 过多"
        for (index in 0 until updates.length()) {
            val update = updates.optJSONObject(index) ?: return "patch update 无效"
            val type = update.optString("type")
            when (type) {
                "player.resource.delta", "player.attribute.delta", "player.skill.delta" -> {
                    val id = update.optString("id")
                    val delta = update.optDouble("delta", Double.NaN)
                    val bucketName = when (type) {
                        "player.resource.delta" -> "resources"
                        "player.attribute.delta" -> "attributes"
                        else -> "skills"
                    }
                    val player = state.optJSONObject("player")
                    val bucket = player?.optJSONObject(bucketName)
                    if (bucket != null) {
                        applyNumericDelta(bucket, id, delta)?.let { return it }
                    } else {
                        val stats = state.optJSONObject("stats") ?: return "当前存档没有玩家数值桶"
                        applyNumericDelta(stats, id, delta)?.let { return it }
                    }
                }
                "currency.delta" -> {
                    val currencies = state.optJSONObject("currencies") ?: return "当前存档没有货币状态"
                    applyNumericDelta(currencies, update.optString("id"), update.optDouble("delta", Double.NaN))?.let { return it }
                }
                "inventory.delta" -> {
                    val itemId = update.optString("itemId")
                    val delta = update.optInt("delta", 0)
                    if (itemId.isBlank() || delta == 0) return "inventory.delta 参数无效"
                    val inventory = state.optJSONArray("inventory") ?: org.json.JSONArray().also { state.put("inventory", it) }
                    var found = -1
                    for (i in 0 until inventory.length()) if (inventory.optJSONObject(i)?.optString("itemId") == itemId) { found = i; break }
                    if (found >= 0) {
                        val item = inventory.getJSONObject(found)
                        val count = item.optInt("count", 1) + delta
                        if (count <= 0) inventory.remove(found) else item.put("count", count)
                    } else if (delta > 0) {
                        inventory.put(JSONObject().apply { put("itemId", itemId); put("name", update.optString("name", itemId)); put("count", delta) })
                    } else return "不能减少不存在的物品：$itemId"
                }
                "location.set" -> {
                    val locationId = update.optString("locationId")
                    val locations = world.optJSONArray("locations") ?: org.json.JSONArray()
                    var known = false
                    for (i in 0 until locations.length()) if (locations.optJSONObject(i)?.optString("id") == locationId) { known = true; break }
                    if (!known) return "未登记地点：$locationId"
                    state.put("locationId", locationId)
                }
                "effect.add", "effect.remove" -> {
                    val value = update.optString("value").trim()
                    if (value.isBlank()) return "effect value 无效"
                    val player = state.optJSONObject("player") ?: JSONObject().also { state.put("player", it) }
                    val effects = player.optJSONArray("effects") ?: org.json.JSONArray().also { player.put("effects", it) }
                    var found = -1
                    for (i in 0 until effects.length()) if (effects.optString(i) == value) { found = i; break }
                    if (type == "effect.add" && found < 0) effects.put(value)
                    if (type == "effect.remove" && found >= 0) effects.remove(found)
                }
                "objective.status" -> {
                    val kind = update.optString("kind")
                    if (kind !in setOf("goals", "leads", "quests")) return "objective kind 无效"
                    val list = state.optJSONArray(kind) ?: return "目标列表不存在：$kind"
                    var found = false
                    for (i in 0 until list.length()) {
                        val item = list.optJSONObject(i) ?: continue
                        if (item.optString("id") == update.optString("id")) { item.put("status", update.optString("status")); found = true; break }
                    }
                    if (!found) return "目标不存在：${update.optString("id")}"
                }
                else -> return "不支持的 patch 操作：$type"
            }
        }
        return null
    }

    private fun openingPlanError(plan: JSONObject, world: JSONObject): String? {
        if (plan.has("locationId") && !plan.isNull("locationId")) {
            val locationId = plan.optString("locationId")
            val locations = world.optJSONArray("locations") ?: org.json.JSONArray()
            var known = false
            for (i in 0 until locations.length()) if (locations.optJSONObject(i)?.optString("id") == locationId) { known = true; break }
            if (!known) return "plan.locationId 未登记"
        }
        val presentNpcIds = plan.optJSONArray("presentNpcIds")
        if (plan.has("presentNpcIds") && presentNpcIds == null) return "plan.presentNpcIds 必须是数组"
        if (presentNpcIds != null) {
            if (presentNpcIds.length() > 32) return "plan.presentNpcIds 过多"
            val npcs = world.optJSONArray("npcs") ?: org.json.JSONArray()
            for (i in 0 until presentNpcIds.length()) {
                val id = presentNpcIds.optString(i)
                var known = false
                for (j in 0 until npcs.length()) if (npcs.optJSONObject(j)?.optString("id") == id) { known = true; break }
                if (!known) return "plan.presentNpcIds 包含未登记 NPC"
            }
        }
        for (key in listOf("situation", "hook", "tone")) {
            if (plan.has(key) && plan.optString(key).length > if (key == "tone") 500 else 4000) return "plan.$key 过长"
        }
        for (key in listOf("knownFacts", "boundaries")) {
            if (plan.has(key) && plan.optJSONArray(key) == null) return "plan.$key 必须是数组"
            val values = plan.optJSONArray(key) ?: continue
            if (values.length() > 32) return "plan.$key 过多"
            for (i in 0 until values.length()) if (values.optString(i).isBlank() || values.optString(i).length > 500) return "plan.$key 无效"
        }
        return null
    }

    private fun openingCandidateError(candidate: JSONObject): String? {
        if (candidate.optString("narrative").isBlank() || candidate.optString("narrative").length > 100000) return "candidate.narrative 无效"
        val options = candidate.optJSONArray("options") ?: return "candidate.options 必须包含 4 项"
        if (options.length() != 4) return "candidate.options 必须恰好包含 4 项"
        val seen = mutableSetOf<String>()
        for (i in 0 until options.length()) {
            val option = options.optString(i).trim()
            if (option.isBlank() || option.length > 500 || !seen.add(option)) return "candidate.options 无效或重复"
        }
        return null
    }

    private fun exportSecretKey(key: String): Boolean {
        val normalized = key.replace(Regex("[^A-Za-z0-9]"), "").lowercase()
        return normalized.endsWith("apikey") || normalized.endsWith("token") || normalized.endsWith("clientsecret") ||
            normalized.endsWith("secretkey") || normalized.endsWith("privatekey") || normalized == "cookie" || normalized == "setcookie"
    }

    private fun sanitizeExportValue(value: Any?, path: String, redacted: MutableList<String>): Any? {
        if (value == null || value === JSONObject.NULL || value !is JSONObject && value !is org.json.JSONArray) return value
        if (value is org.json.JSONArray) {
            val result = org.json.JSONArray()
            for (index in 0 until value.length()) result.put(sanitizeExportValue(value.opt(index), "$path[$index]", redacted))
            return result
        }
        val objectValue = value as? JSONObject ?: return value
        val result = JSONObject()
        for (key in objectValue.keys()) {
            val childPath = if (path.isBlank()) key else "$path.$key"
            val child = objectValue.opt(key)
            val lower = key.lowercase()
            val portableAsset = lower in setOf("coverimage", "refimage", "imagepath", "rawassetref") && child is String && child.startsWith("/images/")
            if (exportSecretKey(key) || (lower in setOf("settings", "providers", "user", "worldsaves") && path == "save") ||
                (lower in setOf("coverimage", "refimage", "imagepath", "rawassetref") && !portableAsset)) {
                redacted += childPath
                continue
            }
            result.put(key, sanitizeExportValue(child, childPath, redacted))
        }
        return result
    }

    private fun handleWorldSaveRename(session: IHTTPSession, file: File): Response {
        return try {
            val current = readObject(file) ?: return json(Response.Status.NOT_FOUND, JSONObject().put("error", "save not found"))
            val payload = JSONObject(readBody(session))
            val name = payload.optString("name").trim()
            if (name.isBlank() || name.length > 120) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "存档名称不能为空且不能超过 120 个字符"))
            val next = JSONObject(current.toString()).put("name", name).put("updatedAt", System.currentTimeMillis())
            writeObject(file, next)
            json(Response.Status.OK, next)
        } catch (e: Exception) {
            json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid rename request: ${e.message}"))
        }
    }

    private fun handleWorldSaveDelete(saveId: String, file: File): Response {
        val current = readObject(file) ?: return json(Response.Status.NOT_FOUND, JSONObject().put("error", "save not found"))
        if (!file.delete()) return json(Response.Status.INTERNAL_ERROR, JSONObject().put("error", "存档删除失败"))
        return json(Response.Status.OK, JSONObject().put("ok", true).put("saveId", saveId).put("worldId", current.optString("worldId")))
    }

    private fun handleWorldSaveExport(saveId: String, file: File): Response {
        val current = readObject(file) ?: return json(Response.Status.NOT_FOUND, JSONObject().put("error", "save not found"))
        val redacted = mutableListOf<String>()
        val safeSave = sanitizeExportValue(current, "save", redacted) as JSONObject
        val redactedPaths = org.json.JSONArray()
        redacted.distinct().sorted().forEach { redactedPaths.put(it) }
        val payload = JSONObject().apply {
            put("spec", "tavern_world_save")
            put("specVersion", 1)
            put("exportedAt", java.util.Date().toString())
            put("manifest", JSONObject().apply {
                put("saveId", current.optString("id"))
                put("worldId", current.optString("worldId"))
                put("worldVersion", current.optInt("worldVersion", 1))
                put("title", current.optString("name", current.optString("id")))
                put("privacy", JSONObject().put("excludes", org.json.JSONArray().put("apiKeys").put("settings").put("otherSaves")).put("redactedPaths", redactedPaths))
            })
            put("save", safeSave)
        }
        return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", payload.toString(2)).also {
            it.setGzipEncoding(false)
            it.addHeader("Content-Disposition", "attachment; filename=\"$saveId.tavern-save.json\"")
            it.addHeader("Cache-Control", "no-store")
        }
    }

    private fun collectCopyReferences(value: Any?, path: String, commandMap: LinkedHashMap<String, String>, idMap: LinkedHashMap<String, String>, targetId: String) {
        when (value) {
            is org.json.JSONArray -> for (index in 0 until value.length()) collectCopyReferences(value.opt(index), "$path[$index]", commandMap, idMap, targetId)
            is JSONObject -> for (key in value.keys()) {
                val child = value.opt(key)
                val childPath = if (path.isBlank()) key else "$path.$key"
                if ((key == "commandId" || key == "openingCommandId") && child is String && safeCommandId(child) && !commandMap.containsKey(child)) commandMap[child] = "copy-$targetId-cmd-${commandMap.size + 1}"
                if (key == "id" && child is String) {
                    val bucket = when {
                        childPath.contains(".turns[") -> "turn"
                        childPath.contains(".eventMemory[") -> "memory"
                        childPath.contains(".eventLedger[") -> "ledger"
                        else -> null
                    }
                    if (bucket != null && !idMap.containsKey(child)) idMap[child] = "copy-$targetId-$bucket-${idMap.size + 1}"
                }
                collectCopyReferences(child, childPath, commandMap, idMap, targetId)
            }
        }
    }

    private fun remapCopyValue(value: Any?, sourceId: String, targetId: String, commandMap: Map<String, String>, idMap: Map<String, String>): Any? {
        if (value == null || value === JSONObject.NULL) return value
        if (value is org.json.JSONArray) {
            val result = org.json.JSONArray()
            for (index in 0 until value.length()) result.put(remapCopyValue(value.opt(index), sourceId, targetId, commandMap, idMap))
            return result
        }
        if (value is JSONObject) {
            val result = JSONObject()
            for (key in value.keys()) result.put(key, remapCopyValue(value.opt(key), sourceId, targetId, commandMap, idMap))
            return result
        }
        if (value is String) {
            commandMap[value]?.let { return it }
            idMap[value]?.let { return it }
            if (value == "pc-$sourceId") return "pc-$targetId"
            return value.replace("save:$sourceId:", "save:$targetId:")
        }
        return value
    }

    private fun handleWorldSaveCopy(session: IHTTPSession, saveId: String, file: File): Response {
        return try {
            val current = readObject(file) ?: return json(Response.Status.NOT_FOUND, JSONObject().put("error", "save not found"))
            val payload = JSONObject(readBody(session))
            val commandId = payload.optString("commandId")
            if (!safeCommandId(commandId)) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid commandId"))
            val requestedName = if (payload.has("name") && !payload.isNull("name")) payload.optString("name").trim() else ""
            if (requestedName.length > 120) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "name 不能超过 120 个字符"))
            savesDir.mkdirs()
            savesDir.listFiles()?.filter { it.extension == "json" }?.forEach { candidateFile ->
                val existing = readObject(candidateFile)
                val info = existing?.optJSONObject("copyInfo")
                if (info?.optString("sourceSaveId") == saveId && info.optString("commandId") == commandId) return json(Response.Status.OK, JSONObject().put("save", existing).put("idempotent", true))
            }
            val nextId = nowId("copy")
            val commandMap = linkedMapOf<String, String>()
            val idMap = linkedMapOf<String, String>()
            collectCopyReferences(current, "", commandMap, idMap, nextId)
            val next = remapCopyValue(current, saveId, nextId, commandMap, idMap) as JSONObject
            val now = System.currentTimeMillis()
            next.put("id", nextId).put("name", if (requestedName.isBlank()) "${current.optString("name", "存档")} · 副本" else requestedName).put("createdAt", now).put("updatedAt", now)
            next.put("agentRuntime", JSONObject().put("version", 1).put("status", "idle").put("pending", JSONObject.NULL))
            next.put("memoryRebuild", JSONObject.NULL).put("reopenInfo", JSONObject.NULL)
            next.put("copyInfo", JSONObject().put("sourceSaveId", saveId).put("sourceRevision", current.optInt("revision", 0)).put("commandId", commandId).put("copiedAt", now))
            writeObject(File(savesDir, "$nextId.json"), next)
            json(Response.Status.CREATED, JSONObject().put("save", next).put("idempotent", false))
        } catch (e: Exception) {
            json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid copy request: ${e.message}"))
        }
    }

    private fun upgradeEntityIds(world: JSONObject?, key: String): Set<String> {
        val ids = linkedSetOf<String>()
        val values = world?.optJSONArray(key) ?: org.json.JSONArray()
        for (index in 0 until values.length()) {
            val item = values.opt(index)
            if (item is JSONObject) item.optString("id").takeIf { it.isNotBlank() }?.let { ids += it } else if (item is String && item.isNotBlank()) ids += item
        }
        return ids
    }

    private fun worldUpgradeReport(save: JSONObject, targetVersion: Int): JSONObject {
        val sourceWorld = findWorld(save.optString("worldId"), save.optInt("worldVersion", 1))
        val targetWorld = findWorld(save.optString("worldId"), targetVersion)
        if (sourceWorld == null) return JSONObject().put("error", "存档绑定的世界版本不存在")
        if (targetWorld == null) return JSONObject().put("error", "目标世界版本不存在")
        if (targetVersion <= save.optInt("worldVersion", 1)) return JSONObject().put("error", "目标版本必须高于存档当前版本")
        val changes = JSONObject()
        for (key in listOf("locations", "npcs", "quests")) {
            val source = upgradeEntityIds(sourceWorld, key); val target = upgradeEntityIds(targetWorld, key)
            val added = org.json.JSONArray(); val removed = org.json.JSONArray()
            for (id in target) if (!source.contains(id)) added.put(JSONObject().put("id", id).put("name", id))
            for (id in source) if (!target.contains(id)) removed.put(JSONObject().put("id", id).put("name", id))
            changes.put(key, JSONObject().put("added", added).put("removed", removed))
        }
        val hardErrors = org.json.JSONArray()
        val locationId = save.optJSONObject("state")?.optString("locationId") ?: ""
        if (locationId.isNotBlank() && !upgradeEntityIds(targetWorld, "locations").contains(locationId)) hardErrors.put(JSONObject().put("kind", "location").put("id", locationId).put("path", "state.locationId").put("message", "目标版本不存在当前地点"))
        return JSONObject().put("saveId", save.optString("id")).put("worldId", save.optString("worldId")).put("fromVersion", save.optInt("worldVersion", 1)).put("targetVersion", targetVersion).put("targetTitle", targetWorld.optString("title", targetWorld.optString("id"))).put("canUpgrade", hardErrors.length() == 0).put("changes", changes).put("hardErrors", hardErrors)
    }

    private fun handleWorldSaveUpgradePreview(session: IHTTPSession, file: File): Response {
        val save = readObject(file) ?: return json(Response.Status.NOT_FOUND, JSONObject().put("error", "save not found"))
        val targetVersion = queryValue(session.uri, "targetVersion")?.toIntOrNull() ?: return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "targetVersion 无效"))
        val report = worldUpgradeReport(save, targetVersion)
        return if (report.has("error")) json(Response.Status.CONFLICT, report) else json(Response.Status.OK, report)
    }

    private fun handleWorldSaveUpgrade(session: IHTTPSession, file: File): Response {
        return try {
            val current = readObject(file) ?: return json(Response.Status.NOT_FOUND, JSONObject().put("error", "save not found"))
            val payload = JSONObject(readBody(session)); val commandId = payload.optString("commandId"); val expected = payload.optInt("expectedRevision", -1); val targetVersion = payload.optInt("targetVersion", -1)
            if (!safeCommandId(commandId) || expected < 0 || targetVersion < 1) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "commandId、expectedRevision 或 targetVersion 无效"))
            val history = current.optJSONArray("migrationHistory") ?: org.json.JSONArray()
            for (index in 0 until history.length()) {
                val entry = history.optJSONObject(index) ?: continue
                if (entry.optString("commandId") == commandId) return json(Response.Status.OK, JSONObject().put("save", current).put("report", worldUpgradeReport(current, entry.optInt("toVersion", targetVersion))).put("idempotent", true))
            }
            if (expected != current.optInt("revision", 0)) return json(Response.Status.CONFLICT, JSONObject().put("error", "存档版本冲突，请重新预演").put("revision", current.optInt("revision", 0)))
            val report = worldUpgradeReport(current, targetVersion)
            if (report.has("error")) return json(Response.Status.CONFLICT, report)
            if (!report.optBoolean("canUpgrade")) return json(Response.Status.CONFLICT, JSONObject().put("error", "存档包含目标版本缺失的引用").put("report", report))
            val revision = expected + 1; val now = System.currentTimeMillis()
            val migration = JSONObject().put("kind", "world-version-upgrade").put("commandId", commandId).put("fromVersion", current.optInt("worldVersion", 1)).put("toVersion", targetVersion).put("targetTitle", report.optString("targetTitle")).put("changes", report.optJSONObject("changes")).put("revision", revision).put("migratedAt", now)
            history.put(migration)
            val ledger = current.optJSONArray("eventLedger") ?: org.json.JSONArray()
            ledger.put(JSONObject().put("id", "ledger-$revision").put("kind", "world-version-upgrade").put("commandId", commandId).put("sourceRevision", revision).put("locationId", current.optJSONObject("state")?.optString("locationId") ?: JSONObject.NULL).put("migrationId", commandId).put("createdAt", now))
            val next = JSONObject(current.toString()).put("worldVersion", targetVersion).put("migrationHistory", history).put("eventLedger", ledger).put("revision", revision).put("updatedAt", now)
            writeObject(file, next)
            json(Response.Status.OK, JSONObject().put("save", next).put("report", report).put("idempotent", false))
        } catch (e: Exception) { json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid upgrade request: ${e.message}")) }
    }

    private fun handleWorldAgentExecute(session: IHTTPSession, file: File): Response {
        return try {
            val current = readObject(file) ?: return json(Response.Status.NOT_FOUND, JSONObject().put("error", "save not found"))
            if (current.optJSONObject("setup")?.optString("status") == "planning") return json(Response.Status.CONFLICT, JSONObject().put("error", "请先完成开局规划"))
            val payload = JSONObject(readBody(session))
            val commandId = payload.optString("commandId")
            val expected = payload.optInt("expectedRevision", -1)
            if (!safeCommandId(commandId) || expected != current.optInt("revision", 0)) return json(Response.Status.CONFLICT, JSONObject().put("error", "revision conflict").put("revision", current.optInt("revision", 0)))
            val existing = current.optJSONObject("agentRuntime")?.optJSONObject("pending")
            if (existing != null) {
                if (existing.optString("commandId") == commandId && existing.optInt("baseRevision", -1) == expected) {
                    return json(Response.Status.OK, JSONObject(current.toString()).put("execution", JSONObject().apply {
                        put("status", "awaiting-narration"); put("commandId", commandId); put("baseRevision", expected); put("state", existing.optJSONObject("state") ?: JSONObject()); put("outcome", existing.optJSONObject("outcome") ?: JSONObject())
                    }))
                }
                return json(Response.Status.CONFLICT, JSONObject().put("error", "已有待叙事 Agent 执行结果，请先完成 narrate 阶段").put("commandId", existing.optString("commandId")))
            }
            val patch = payload.optJSONObject("patch") ?: return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "patch 必须是对象"))
            if (patch.optString("protocol") != "tavern.rpg.turn" || patch.optInt("version", -1) != 1 || patch.optInt("baseRevision", -1) != expected) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "patch 协议或 revision 无效"))
            val nextState = JSONObject(current.optJSONObject("state")?.toString() ?: "{}")
            applyMobilePatch(findWorld(current.optString("worldId"), current.optInt("worldVersion", 1)) ?: JSONObject(), nextState, patch)?.let { return json(Response.Status.BAD_REQUEST, JSONObject().put("error", it)) }
            ensureSaveState(nextState)
            val pending = JSONObject().apply {
                put("version", 1); put("commandId", commandId); put("baseRevision", expected); put("previewRevision", expected + 1); put("state", nextState); put("outcome", JSONObject())
                put("createEntities", payload.optJSONArray("createEntities") ?: org.json.JSONArray())
                put("eventMemory", payload.optJSONArray("eventMemory") ?: org.json.JSONArray())
                put("agentCalls", payload.optJSONArray("agentCalls") ?: org.json.JSONArray())
                if (payload.has("actionIntent")) put("actionIntent", payload.optJSONObject("actionIntent") ?: JSONObject.NULL)
            }
            val next = JSONObject(current.toString()).put("agentRuntime", JSONObject().put("version", 1).put("status", "awaiting-narration").put("pending", pending)).put("updatedAt", System.currentTimeMillis())
            writeObject(file, next)
            json(Response.Status.OK, JSONObject(next.toString()).put("execution", JSONObject().apply {
                put("status", "awaiting-narration"); put("commandId", commandId); put("baseRevision", expected); put("state", nextState); put("outcome", JSONObject())
            }))
        } catch (e: Exception) {
            json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid agent execution: ${e.message}"))
        }
    }

    private fun handleWorldAgentCancel(session: IHTTPSession, file: File): Response {
        return try {
            val current = readObject(file) ?: return json(Response.Status.NOT_FOUND, JSONObject().put("error", "save not found"))
            val payload = JSONObject(readBody(session))
            val cancelCommandId = payload.optString("commandId")
            if (!safeCommandId(cancelCommandId) || payload.optInt("expectedRevision", -1) != current.optInt("revision", 0)) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "commandId 或 expectedRevision 无效"))
            val pending = current.optJSONObject("agentRuntime")?.optJSONObject("pending")
            if (pending == null) return json(Response.Status.OK, current)
            if (pending.optString("commandId") != cancelCommandId) return json(Response.Status.CONFLICT, JSONObject().put("error", "待叙事 Agent 结果已变化").put("revision", current.optInt("revision", 0)))
            val next = JSONObject(current.toString()).put("agentRuntime", JSONObject().put("version", 1).put("status", "idle").put("pending", JSONObject.NULL)).put("updatedAt", System.currentTimeMillis())
            writeObject(file, next)
            json(Response.Status.OK, next)
        } catch (e: Exception) {
            json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid agent cancel: ${e.message}"))
        }
    }

    private fun commitWorldAgentNarration(current: JSONObject, payload: JSONObject, file: File): Response {
        val commandId = payload.optString("commandId")
        if (safeCommandId(commandId) && hasCommand(current, commandId)) return json(Response.Status.OK, current)
        val pending = current.optJSONObject("agentRuntime")?.optJSONObject("pending")
            ?: return json(Response.Status.CONFLICT, JSONObject().put("error", "Agent 执行结果不存在或已过期").put("revision", current.optInt("revision", 0)))
        val expected = payload.optInt("expectedRevision", -1)
        if (!safeCommandId(commandId) || !safeCommandId(payload.optString("pendingCommandId")) || payload.optString("pendingCommandId") != pending.optString("commandId") || expected != current.optInt("revision", 0)) return json(Response.Status.CONFLICT, JSONObject().put("error", "Agent 执行结果不存在或已过期").put("revision", current.optInt("revision", 0)))
        val turns = payload.optJSONArray("turns") ?: return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "narrate 阶段必须包含 turns"))
        var hasAssistant = false
        for (index in 0 until turns.length()) if (turns.optJSONObject(index)?.optString("role") == "assistant") hasAssistant = true
        if (turns.length() > 32 || !hasAssistant) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "narrate 阶段必须包含 assistant 消息"))
        val nextState = JSONObject(pending.optJSONObject("state")?.toString() ?: "{}")
        ensureSaveState(nextState)
        val next = JSONObject(current.toString()).apply {
            put("state", nextState)
            put("turns", appendJsonArray(current.optJSONArray("turns"), turns))
            put("openingOptions", payload.optJSONArray("options") ?: org.json.JSONArray())
            put("revision", expected + 1)
            put("updatedAt", System.currentTimeMillis())
            put("agentRuntime", JSONObject().put("version", 1).put("status", "idle").put("pending", JSONObject.NULL))
        }
        val receipts = current.optJSONArray("receipts") ?: org.json.JSONArray()
        receipts.put(JSONObject().apply { put("kind", "turn"); put("commandId", commandId); put("revision", expected + 1); put("agent", JSONObject().put("phase", "narrate").put("status", "committed").put("proposedTools", pending.optJSONArray("agentCalls") ?: org.json.JSONArray())) })
        next.put("receipts", receipts)
        val memories = appendJsonArray(current.optJSONArray("eventMemory"), pending.optJSONArray("eventMemory"))
        next.put("eventMemory", memories)
        writeObject(file, next)
        return json(Response.Status.OK, next)
    }

    @Synchronized
    private fun handleWorldSaveItem(session: IHTTPSession, rawSaveId: String): Response {
        val saveId = rawSaveId.substringBefore('/')
        val file = saveFile(saveId) ?: return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid save id"))
        if (rawSaveId.endsWith("/rename") && session.method == Method.POST) return handleWorldSaveRename(session, file)
        if (rawSaveId.endsWith("/export") && session.method == Method.GET) return handleWorldSaveExport(saveId, file)
        if (rawSaveId.endsWith("/copy") && session.method == Method.POST) return handleWorldSaveCopy(session, saveId, file)
        if (rawSaveId.endsWith("/upgrade") && session.method == Method.GET) return handleWorldSaveUpgradePreview(session, file)
        if (rawSaveId.endsWith("/upgrade") && session.method == Method.POST) return handleWorldSaveUpgrade(session, file)
        if (rawSaveId.endsWith("/agent-execute") && session.method == Method.POST) return handleWorldAgentExecute(session, file)
        if (rawSaveId.endsWith("/agent-cancel") && session.method == Method.POST) return handleWorldAgentCancel(session, file)
        if (rawSaveId == saveId && session.method == Method.DELETE) return handleWorldSaveDelete(saveId, file)
        if (session.method == Method.GET && rawSaveId == saveId) {
            val save = readObject(file) ?: return json(Response.Status.NOT_FOUND, JSONObject().put("error", "save not found"))
            return json(Response.Status.OK, save)
        }
        if (rawSaveId.endsWith("/setup") && session.method == Method.PUT) return handleWorldSaveSetup(session, file)
        if (rawSaveId.endsWith("/opening-candidate") && session.method == Method.POST) return handleWorldSaveOpeningCandidate(session, file)
        if (rawSaveId.endsWith("/opening") && session.method == Method.POST) return handleWorldSaveOpening(session, file)
        if (rawSaveId.contains("/growth") && session.method == Method.POST) return handleWorldSaveGrowth(session, file)
        if (rawSaveId.contains("/end") && session.method == Method.POST) return handleWorldSaveEnd(session, file)
        if (rawSaveId.contains("/reopen") && session.method == Method.POST) return handleWorldSaveReopen(session, file)
        if (rawSaveId.contains("/summary/rebuild") && session.method == Method.POST) return handleWorldSummaryRebuild(session, file)
        if (rawSaveId.contains("/summary") && session.method == Method.GET) return handleWorldSummaryGet(file)
        if (rawSaveId.contains("/memory/rebuild") && session.method == Method.POST) return handleWorldMemoryRebuild(session, file)
        if (rawSaveId.contains("/memory") && session.method == Method.GET) return handleWorldMemoryGet(file)
        if (rawSaveId.contains('/')) return json(Response.Status.NOT_FOUND, JSONObject().put("error", "unsupported world save endpoint"))
        if (session.method != Method.POST && session.method != Method.PUT) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "method not allowed"))
        return try {
            val current = readObject(file) ?: return json(Response.Status.NOT_FOUND, JSONObject().put("error", "save not found"))
            if (current.optJSONObject("setup")?.optString("status") == "planning") return json(Response.Status.CONFLICT, JSONObject().put("error", "请先完成开局规划"))
            val payload = JSONObject(readBody(session))
            if (session.method == Method.POST && payload.optString("agentPhase") == "narrate") return commitWorldAgentNarration(current, payload, file)
            val commandId = payload.optString("commandId")
            val expected = payload.optInt("expectedRevision", -1)
            if (session.method == Method.POST && !safeCommandId(commandId)) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid commandId"))
            if (session.method == Method.POST && hasCommand(current, commandId)) return json(Response.Status.OK, current)
            if (expected < 0 || expected != current.optInt("revision", 0)) return json(Response.Status.CONFLICT, JSONObject().put("error", "revision conflict").put("revision", current.optInt("revision", 0)))
            val next = JSONObject(current.toString())
            val state = if (session.method == Method.POST && payload.has("patch")) {
                val patched = JSONObject(current.optJSONObject("state")?.toString() ?: "{}")
                val patch = payload.optJSONObject("patch") ?: return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "patch 无效"))
                if (patch.optInt("baseRevision", -1) != expected) return json(Response.Status.CONFLICT, JSONObject().put("error", "patch revision conflict"))
                applyMobilePatch(findWorld(current.optString("worldId"), current.optInt("worldVersion", 1)) ?: JSONObject(), patched, patch)?.let { return json(Response.Status.BAD_REQUEST, JSONObject().put("error", it)) }
                patched
            } else JSONObject(payload.optJSONObject("state")?.toString() ?: current.optJSONObject("state")?.toString() ?: "{}")
            ensureSaveState(state)
            next.put("state", state)
            if (payload.has("turns")) next.put("turns", appendJsonArray(current.optJSONArray("turns"), payload.optJSONArray("turns")))
            val revision = expected + 1
            next.put("revision", revision)
            next.put("updatedAt", System.currentTimeMillis())
            if (session.method == Method.POST) {
                val receipts = current.optJSONArray("receipts") ?: org.json.JSONArray()
                receipts.put(JSONObject().apply { put("kind", "turn"); put("commandId", commandId); put("revision", revision); if (payload.has("patch")) put("patch", JSONObject().put("protocol", "tavern.rpg.turn").put("version", 1)) })
                next.put("receipts", receipts)
            }
            writeObject(file, next)
            json(Response.Status.OK, next)
        } catch (e: Exception) {
            json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid world save request: ${e.message}"))
        }
    }

    private fun appendJsonArray(existing: org.json.JSONArray?, additions: org.json.JSONArray?): org.json.JSONArray {
        val result = org.json.JSONArray()
        for (source in listOf(existing, additions)) for (i in 0 until (source?.length() ?: 0)) result.put(source?.get(i))
        return result
    }

    private fun handleWorldSaveOpening(session: IHTTPSession, file: File): Response {
        return try {
            val current = readObject(file) ?: return json(Response.Status.NOT_FOUND, JSONObject().put("error", "save not found"))
            val payload = JSONObject(readBody(session))
            val commandId = payload.optString("commandId")
            if (hasCommand(current, commandId)) return json(Response.Status.OK, current)
            val expected = payload.optInt("expectedRevision", -1)
            if (!safeCommandId(commandId) || expected != current.optInt("revision", 0)) return json(Response.Status.CONFLICT, JSONObject().put("error", "revision conflict"))
            val setup = current.optJSONObject("setup") ?: JSONObject().put("status", "active")
            if (setup.optString("status") != "planning") return json(Response.Status.CONFLICT, JSONObject().put("error", "开场已经提交，不能重复覆盖"))
            if (setup.optJSONObject("plan") == null) return json(Response.Status.CONFLICT, JSONObject().put("error", "请先保存开局规划"))
            if (payload.has("candidateCommandId") && setup.optJSONObject("candidate")?.optString("commandId") != payload.optString("candidateCommandId")) return json(Response.Status.CONFLICT, JSONObject().put("error", "开场候选已变化"))
            val opening = payload.optString("opening").trim()
            val options = payload.optJSONArray("options") ?: return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "options 必须包含 4 项"))
            if (opening.isBlank() || options.length() != 4) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "opening/options 无效"))
            val plan = setup.optJSONObject("plan")
            val next = JSONObject(current.toString()).apply {
                put("setup", JSONObject(setup.toString()).apply { put("status", "active"); put("candidate", JSONObject.NULL) })
                if (plan != null) put("state", JSONObject(optJSONObject("state")?.toString() ?: "{}").apply {
                    put("openingScenario", JSONObject(plan.toString()))
                    if (plan.has("preGameFacts")) put("preGameFacts", plan.optJSONArray("preGameFacts"))
                    if (plan.has("knowledge")) put("knownInformation", plan.optJSONObject("knowledge"))
                    if (plan.has("locationId")) put("locationId", plan.optString("locationId"))
                })
                put("opening", opening)
                put("openingOptions", options)
                put("openingCommandId", commandId)
                put("revision", expected + 1)
                put("updatedAt", System.currentTimeMillis())
            }
            val receipts = current.optJSONArray("receipts") ?: org.json.JSONArray()
            receipts.put(JSONObject().put("kind", "opening").put("commandId", commandId).put("revision", expected + 1))
            next.put("receipts", receipts)
            writeObject(file, next)
            json(Response.Status.OK, next)
        } catch (e: Exception) {
            json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid opening: ${e.message}"))
        }
    }

    private fun handleWorldSaveGrowth(session: IHTTPSession, file: File): Response {
        return try {
            val current = readObject(file) ?: return json(Response.Status.NOT_FOUND, JSONObject().put("error", "save not found"))
            if (current.optJSONObject("setup")?.optString("status") == "planning") return json(Response.Status.CONFLICT, JSONObject().put("error", "请先完成开局规划"))
            val payload = JSONObject(readBody(session))
            val commandId = payload.optString("commandId")
            if (hasCommand(current, commandId)) return json(Response.Status.OK, current)
            val expected = payload.optInt("expectedRevision", -1)
            val candidateId = payload.optString("candidateId")
            val decision = payload.optString("decision")
            if (!safeCommandId(commandId) || expected != current.optInt("revision", 0) || candidateId.isBlank() || decision !in setOf("accepted", "rejected")) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid growth request"))
            val state = JSONObject(current.optJSONObject("state")?.toString() ?: "{}")
            val candidates = state.optJSONArray("growthCandidates") ?: return json(Response.Status.CONFLICT, JSONObject().put("error", "no growth candidates"))
            var index = -1
            var candidate: JSONObject? = null
            for (i in 0 until candidates.length()) {
                val item = candidates.optJSONObject(i) ?: continue
                if (item.optString("id") == candidateId && item.optString("status", "proposed") == "proposed") { index = i; candidate = item; break }
            }
            if (index < 0 || candidate == null) return json(Response.Status.CONFLICT, JSONObject().put("error", "growth candidate not found"))
            candidates.remove(index)
            if (decision == "accepted") {
                val world = findWorld(current.optString("worldId"), current.optInt("worldVersion", 1)) ?: JSONObject()
                val definitions = world.optJSONObject("playerCreation")?.optJSONObject("growth")?.optJSONArray("candidates") ?: org.json.JSONArray()
                var definition: JSONObject? = null
                for (i in 0 until definitions.length()) if (definitions.optJSONObject(i)?.optString("id") == candidate.optString("candidateId")) { definition = definitions.optJSONObject(i); break }
                if (definition == null) return json(Response.Status.CONFLICT, JSONObject().put("error", "growth definition not found"))
                val bucket = definition.optString("bucket")
                val targetId = definition.optString("targetId")
                val delta = definition.optDouble("delta", Double.NaN)
                if (bucket in setOf("attributes", "skills", "resources") && delta.isFinite()) {
                    val player = state.optJSONObject("player") ?: return json(Response.Status.CONFLICT, JSONObject().put("error", "player state missing"))
                    val values = player.optJSONObject(bucket) ?: return json(Response.Status.CONFLICT, JSONObject().put("error", "growth bucket missing"))
                    applyNumericDelta(values, targetId, delta)?.let { return json(Response.Status.CONFLICT, JSONObject().put("error", it)) }
                } else if (bucket == "traits") {
                    val player = state.optJSONObject("player") ?: JSONObject().also { state.put("player", it) }
                    val traits = player.optJSONArray("traits") ?: org.json.JSONArray().also { player.put("traits", it) }
                    if (traits.toString().contains(targetId).not()) traits.put(targetId)
                }
            }
            val applications = state.optJSONArray("growthApplications") ?: org.json.JSONArray()
            applications.put(JSONObject().apply { put("candidateId", candidate.optString("candidateId")); put("decision", decision); put("revision", expected + 1) })
            state.put("growthCandidates", candidates)
            state.put("growthApplications", applications)
            val next = JSONObject(current.toString()).apply { put("state", state); put("revision", expected + 1); put("updatedAt", System.currentTimeMillis()) }
            val receipts = current.optJSONArray("receipts") ?: org.json.JSONArray()
            receipts.put(JSONObject().apply { put("kind", "growth"); put("commandId", commandId); put("revision", expected + 1); put("decision", decision) })
            next.put("receipts", receipts)
            writeObject(file, next)
            json(Response.Status.OK, next)
        } catch (e: Exception) {
            json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid growth request: ${e.message}"))
        }
    }

    private fun handleWorldSaveEnd(session: IHTTPSession, file: File): Response {
        return try {
            val current = readObject(file) ?: return json(Response.Status.NOT_FOUND, JSONObject().put("error", "save not found"))
            if (current.optJSONObject("setup")?.optString("status") == "planning") return json(Response.Status.CONFLICT, JSONObject().put("error", "请先完成开局规划"))
            val payload = JSONObject(readBody(session))
            val commandId = payload.optString("commandId")
            if (hasCommand(current, commandId)) return json(Response.Status.OK, current)
            val expected = payload.optInt("expectedRevision", -1)
            if (!safeCommandId(commandId) || expected != current.optInt("revision", 0) || payload.optBoolean("confirm", false).not()) return json(Response.Status.CONFLICT, JSONObject().put("error", "ending requires confirmation"))
            val state = JSONObject(current.optJSONObject("state")?.toString() ?: "{}")
            if (state.optJSONObject("ending")?.optString("status") == "ended") return json(Response.Status.CONFLICT, JSONObject().put("error", "world already ended"))
            val world = findWorld(current.optString("worldId"), current.optInt("worldVersion", 1)) ?: JSONObject()
            val endingId = payload.optString("endingId", "player-choice")
            val endings = world.optJSONObject("ending")?.optJSONArray("endings") ?: org.json.JSONArray()
            var ending: JSONObject? = null
            for (i in 0 until endings.length()) if (endings.optJSONObject(i)?.optString("id") == endingId) { ending = endings.optJSONObject(i); break }
            if (endings.length() > 0 && ending == null) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "ending not declared"))
            val endingState = JSONObject().apply { put("status", "ended"); put("endingId", endingId); put("label", ending?.optString("label", endingId) ?: endingId); put("description", ending?.optString("description", "") ?: ""); put("sourceRevision", expected + 1); put("commandId", commandId); put("endedAt", System.currentTimeMillis()) }
            state.put("ending", endingState)
            val next = JSONObject(current.toString()).apply { put("state", state); put("revision", expected + 1); put("updatedAt", System.currentTimeMillis()) }
            val receipts = current.optJSONArray("receipts") ?: org.json.JSONArray()
            receipts.put(JSONObject().put("kind", "ending").put("commandId", commandId).put("revision", expected + 1).put("ending", endingState))
            next.put("receipts", receipts)
            writeObject(file, next)
            json(Response.Status.OK, next)
        } catch (e: Exception) {
            json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid ending request: ${e.message}"))
        }
    }

    private fun handleWorldSaveReopen(session: IHTTPSession, file: File): Response {
        return try {
            val current = readObject(file) ?: return json(Response.Status.NOT_FOUND, JSONObject().put("error", "save not found"))
            val payload = JSONObject(readBody(session))
            val commandId = payload.optString("commandId")
            if (!safeCommandId(commandId)) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid commandId"))
            savesDir.mkdirs()
            savesDir.listFiles()?.filter { it.extension == "json" }?.forEach { candidateFile ->
                val existing = readObject(candidateFile)
                val info = existing?.optJSONObject("reopenInfo")
                if (info?.optString("sourceSaveId") == current.optString("id") && info?.optString("commandId") == commandId) return json(Response.Status.OK, JSONObject().put("save", existing).put("idempotent", true))
            }
            val state = current.optJSONObject("state") ?: return json(Response.Status.CONFLICT, JSONObject().put("error", "state missing"))
            val ended = state.optJSONObject("ending")?.optString("status") == "ended" || state.optJSONObject("failure")?.optString("status") == "terminal"
            if (!ended) return json(Response.Status.CONFLICT, JSONObject().put("error", "only ended worlds can reopen"))
            val next = JSONObject(current.toString())
            val nextId = nowId("reopen")
            val nextState = JSONObject(state.toString()).apply { put("ending", JSONObject.NULL); put("failure", JSONObject.NULL) }
            next.put("id", nextId); next.put("name", payload.optString("name", current.optString("name") + " · 重开")); next.put("state", nextState); next.put("revision", 0); next.put("opening", "（世界线已从上一条终止线重开。）"); next.put("openingMode", "static"); next.put("setup", JSONObject().put("status", "active").put("plan", JSONObject.NULL).put("candidate", JSONObject.NULL)); next.put("openingOptions", org.json.JSONArray()); next.put("turns", org.json.JSONArray()); next.put("receipts", org.json.JSONArray()); next.put("eventLedger", org.json.JSONArray()); next.put("eventMemory", org.json.JSONArray()); next.put("reopenInfo", JSONObject().put("sourceSaveId", current.optString("id")).put("sourceRevision", current.optInt("revision", 0)).put("commandId", commandId).put("sourceStatus", "ended").put("reopenedAt", System.currentTimeMillis())); next.put("createdAt", System.currentTimeMillis()); next.put("updatedAt", System.currentTimeMillis())
            writeObject(File(savesDir, "$nextId.json"), next)
            json(Response.Status.CREATED, JSONObject().put("save", next).put("idempotent", false))
        } catch (e: Exception) {
            json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid reopen request: ${e.message}"))
        }
    }

    private fun summaryHash(save: JSONObject): String = "android-${(save.optJSONObject("state")?.toString() ?: "{}").hashCode()}-${save.optJSONArray("turns")?.length() ?: 0}"

    private fun buildMobileSummary(save: JSONObject): JSONObject = JSONObject().apply {
        put("sourceRevision", save.optInt("revision", 0))
        put("sourceHash", summaryHash(save))
        put("locationId", save.optJSONObject("state")?.let { state -> if (state.has("locationId") && !state.isNull("locationId")) state.optString("locationId") else JSONObject.NULL } ?: JSONObject.NULL)
        put("turnCount", save.optJSONArray("turns")?.length() ?: 0)
        put("eventCount", save.optJSONObject("state")?.optJSONArray("worldEvents")?.length() ?: 0)
        put("memoryCount", save.optJSONArray("eventMemory")?.length() ?: 0)
        put("updatedAt", System.currentTimeMillis())
    }

    private fun handleWorldSummaryGet(file: File): Response {
        val save = readObject(file) ?: return json(Response.Status.NOT_FOUND, JSONObject().put("error", "save not found"))
        val stored = save.optJSONObject("worldLineSummary")
        return json(Response.Status.OK, JSONObject().apply {
            put("saveId", save.optString("id")); put("worldId", save.optString("worldId")); put("worldVersion", save.optInt("worldVersion", 1)); put("revision", save.optInt("revision", 0)); put("sourceHash", summaryHash(save)); put("stale", stored == null || stored.optString("sourceHash") != summaryHash(save)); put("summary", stored ?: JSONObject.NULL)
        })
    }

    private fun handleWorldSummaryRebuild(session: IHTTPSession, file: File): Response {
        return try {
            val current = readObject(file) ?: return json(Response.Status.NOT_FOUND, JSONObject().put("error", "save not found"))
            val payload = JSONObject(readBody(session)); val commandId = payload.optString("commandId"); val expected = payload.optInt("expectedRevision", -1)
            val existing = current.optJSONObject("worldLineSummary")
            if (existing?.optString("commandId") == commandId) return json(Response.Status.OK, JSONObject().put("save", current).put("summary", existing).put("stale", false).put("idempotent", true))
            if (!safeCommandId(commandId) || expected != current.optInt("revision", 0)) return json(Response.Status.CONFLICT, JSONObject().put("error", "revision conflict").put("revision", current.optInt("revision", 0)))
            val summary = buildMobileSummary(current).put("commandId", commandId)
            val next = JSONObject(current.toString()).put("worldLineSummary", summary).put("updatedAt", System.currentTimeMillis())
            writeObject(file, next)
            json(Response.Status.OK, JSONObject().put("save", next).put("summary", summary).put("stale", false).put("idempotent", false))
        } catch (e: Exception) { json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid summary request: ${e.message}")) }
    }

    private fun memoryDiagnostics(save: JSONObject): JSONObject {
        val memories = save.optJSONArray("eventMemory") ?: org.json.JSONArray()
        var hidden = 0
        for (i in 0 until memories.length()) if (memories.optJSONObject(i)?.optString("visibility") == "hidden") hidden++
        return JSONObject().apply {
            put("saveId", save.optString("id")); put("revision", save.optInt("revision", 0)); put("entryCount", memories.length()); put("hiddenEntryCount", hidden); put("entries", memories)
            put("lastRebuild", save.optJSONObject("memoryRebuild") ?: JSONObject.NULL)
        }
    }

    private fun handleWorldMemoryGet(file: File): Response {
        val save = readObject(file) ?: return json(Response.Status.NOT_FOUND, JSONObject().put("error", "save not found"))
        return json(Response.Status.OK, memoryDiagnostics(save))
    }

    private fun handleWorldMemoryRebuild(session: IHTTPSession, file: File): Response {
        return try {
            val current = readObject(file) ?: return json(Response.Status.NOT_FOUND, JSONObject().put("error", "save not found"))
            val payload = JSONObject(readBody(session)); val commandId = payload.optString("commandId"); val expected = payload.optInt("expectedRevision", -1)
            if (current.optJSONObject("memoryRebuild")?.optString("commandId") == commandId) return json(Response.Status.OK, JSONObject().put("save", current).put("diagnostics", memoryDiagnostics(current)).put("idempotent", true))
            if (!safeCommandId(commandId) || expected != current.optInt("revision", 0)) return json(Response.Status.CONFLICT, JSONObject().put("error", "revision conflict").put("revision", current.optInt("revision", 0)))
            val entries = org.json.JSONArray()
            val events = current.optJSONObject("state")?.optJSONArray("worldEvents") ?: org.json.JSONArray()
            for (i in 0 until events.length()) {
                val event = events.optJSONObject(i) ?: continue
                entries.put(JSONObject().apply { put("id", "event-${i + 1}"); put("kind", "fact"); put("summary", event.optString("title", event.optString("eventId", "世界事件"))); put("locationId", if (event.has("locationId") && !event.isNull("locationId")) event.optString("locationId") else JSONObject.NULL); put("visibility", event.optString("visibility", "public")); put("sourceRevision", event.optInt("revision", current.optInt("revision", 0))) })
            }
            val next = JSONObject(current.toString()).put("eventMemory", entries).put("memoryRebuild", JSONObject().put("commandId", commandId).put("sourceRevision", expected).put("rebuiltAt", System.currentTimeMillis())).put("updatedAt", System.currentTimeMillis())
            writeObject(file, next)
            json(Response.Status.OK, JSONObject().put("save", next).put("diagnostics", memoryDiagnostics(next)).put("idempotent", false))
        } catch (e: Exception) { json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid memory request: ${e.message}")) }
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

    private fun importReport(pkg: JSONObject): JSONObject {
        val errors = org.json.JSONArray()
        val warnings = org.json.JSONArray()
        val inert = org.json.JSONArray()
        if (pkg.optString("spec") != "tavern_world_package") errors.put("不支持的世界包 spec")
        if (pkg.optInt("specVersion", -1) != 1) errors.put("不支持的世界包版本")
        val content = pkg.optJSONObject("content")
        val world = content?.optJSONObject("world")
        if (content == null || world == null || world.optString("id").isBlank()) errors.put("世界包缺少 content.world")
        if (content?.optJSONArray("characters") == null) errors.put("世界包缺少 characters")
        if (content?.optJSONObject("lorebooks") == null) errors.put("世界包缺少 lorebooks")
        if (content?.optJSONObject("presets") == null) errors.put("世界包缺少 presets")
        if (pkg.optJSONObject("manifest")?.optJSONObject("executableContent")?.optBoolean("scripts", false) == true) {
            warnings.put("包声明含脚本；Android 仅封存，不会执行")
            inert.put("manifest.executableContent.scripts")
        }
        return JSONObject().put("canImport", errors.length() == 0).put("errors", errors).put("warnings", warnings).put("inertPaths", inert)
            .put("references", JSONObject().put("characters", content?.optJSONArray("characters")?.length() ?: 0).put("lorebooks", content?.optJSONObject("lorebooks")?.length() ?: 0).put("presets", content?.optJSONObject("presets")?.length() ?: 0))
    }

    private fun dataObject(type: String): JSONObject {
        val file = File(dataDir, "$type.json")
        if (!file.exists()) initFromDefaults(file, type)
        return readObject(file) ?: JSONObject()
    }

    private fun remapImportArray(value: org.json.JSONArray?, idMap: Map<String, String>): org.json.JSONArray {
        val result = org.json.JSONArray()
        if (value == null) return result
        for (index in 0 until value.length()) {
            val id = value.optString(index)
            result.put(idMap[id] ?: id)
        }
        return result
    }

    private fun commitWorldImport(record: JSONObject): JSONObject {
        val importId = record.optString("id")
        val raw = record.optString("raw")
        if (sha256Text(raw) != record.optString("rawHash")) throw IllegalStateException("封存世界包哈希不一致")
        val pkg = JSONObject(raw)
        val report = importReport(pkg)
        if (!report.optBoolean("canImport")) throw IllegalStateException("世界包未通过导入校验")
        val content = pkg.getJSONObject("content")
        val sourceWorld = content.getJSONObject("world")
        val characterMap = linkedMapOf<String, String>()
        val chars = content.getJSONArray("characters")
        for (index in 0 until chars.length()) {
            val source = chars.getJSONObject(index).optString("id")
            characterMap[source] = "imp-${importId.takeLast(12)}-char-${index + 1}"
        }
        val loreMap = linkedMapOf<String, String>()
        val lorebooks = content.getJSONObject("lorebooks")
        var loreIndex = 0
        for (key in lorebooks.keys()) { loreIndex++; loreMap[key] = "imp-${importId.takeLast(12)}-lore-$loreIndex" }
        val presetMap = linkedMapOf<String, String>()
        val presets = content.getJSONObject("presets")
        for (key in presets.keys()) presetMap[key] = "导入 · ${importId.takeLast(8)} · $key"
        val worldId = "imp-${importId.takeLast(12)}-world"
        val world = JSONObject(sourceWorld.toString()).apply {
            put("id", worldId); put("version", 1)
            put("characterIds", remapImportArray(sourceWorld.optJSONArray("characterIds"), characterMap))
            put("npcIds", remapImportArray(sourceWorld.optJSONArray("npcIds"), characterMap))
            put("lorebookIds", remapImportArray(sourceWorld.optJSONArray("lorebookIds"), loreMap))
            put("rpgPresetName", presetMap[sourceWorld.optString("rpgPresetName")] ?: sourceWorld.optString("rpgPresetName"))
            if (sourceWorld.optJSONObject("start") != null) put("start", JSONObject(sourceWorld.getJSONObject("start").toString()).apply { if (has("playerTemplateId")) put("playerTemplateId", characterMap[optString("playerTemplateId")] ?: optString("playerTemplateId")) })
            put("importInfo", JSONObject().put("importId", importId).put("sourceWorldId", sourceWorld.optString("id")).put("sourceWorldVersion", sourceWorld.optInt("version", 1)))
        }
        val characters = dataObject("characters")
        for (index in 0 until chars.length()) {
            val source = chars.getJSONObject(index)
            val id = characterMap[source.optString("id")] ?: continue
            if (characters.has(id)) throw IllegalStateException("导入角色 ID 冲突")
            characters.put(id, JSONObject(source.toString()).apply { put("id", id); put("loreId", loreMap[optString("loreId")] ?: optString("loreId")); put("presetName", presetMap[optString("presetName")] ?: optString("presetName")); put("importInfo", JSONObject().put("importId", importId).put("sourceId", source.optString("id"))) })
        }
        val localLorebooks = dataObject("lorebooks")
        for (key in lorebooks.keys()) {
            val id = loreMap[key] ?: continue
            if (localLorebooks.has(id)) throw IllegalStateException("导入世界书 ID 冲突")
            val lore = JSONObject(lorebooks.getJSONObject(key).toString())
            val entries = lore.optJSONArray("entries")
            if (entries != null) for (index in 0 until entries.length()) {
                val entry = entries.optJSONObject(index) ?: continue
                val keys = entry.optString("keys")
                if (keys.contains("/")) entry.put("enabled", false).put("importInfo", JSONObject().put("importId", importId).put("regexDisabledOnImport", true))
            }
            lore.put("importInfo", JSONObject().put("importId", importId).put("sourceId", key)); localLorebooks.put(id, lore)
        }
        val localPresets = dataObject("presets")
        for (key in presets.keys()) {
            val name = presetMap[key] ?: continue
            if (localPresets.has(name)) throw IllegalStateException("导入预设名称冲突")
            localPresets.put(name, JSONObject(presets.getJSONObject(key).toString()).put("importInfo", JSONObject().put("importId", importId).put("sourceName", key)))
        }
        val worlds = readArray(worldsFile, "worlds")
        for (index in 0 until worlds.length()) if (worlds.optJSONObject(index)?.optString("id") == worldId) throw IllegalStateException("导入世界 ID 冲突")
        worlds.put(world)
        writeObject(File(dataDir, "characters.json"), characters); writeObject(File(dataDir, "lorebooks.json"), localLorebooks); writeObject(File(dataDir, "presets.json"), localPresets); writeArray(worldsFile, worlds)
        return world
    }

    @Synchronized
    private fun handleWorldImportPreview(session: IHTTPSession): Response {
        return try {
            val body = JSONObject(readBody(session)); val raw = body.optString("raw")
            if (raw.isBlank() || raw.toByteArray(Charsets.UTF_8).size > 2 * 1024 * 1024) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "世界包为空或超过 2 MiB 限制"))
            val pkg = try { JSONObject(raw) } catch (_: Exception) { null }
            val report = pkg?.let { importReport(it) } ?: JSONObject().put("canImport", false).put("errors", org.json.JSONArray().put("世界包不是有效 JSON")).put("warnings", org.json.JSONArray()).put("inertPaths", org.json.JSONArray())
            val record = JSONObject().apply { put("id", nowId("imp")); put("status", "pending"); put("createdAt", System.currentTimeMillis()); put("rawHash", sha256Text(raw)); put("raw", raw); put("report", report) }
            val records = readArray(worldImportsFile, "worldImports"); records.put(record); writeArray(worldImportsFile, records)
            json(if (report.optBoolean("canImport")) Response.Status.CREATED else (Response.Status.lookup(422) ?: Response.Status.BAD_REQUEST), JSONObject(record.toString()).apply { remove("raw") })
        } catch (e: Exception) { json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid world package: ${e.message}")) }
    }

    @Synchronized
    private fun handleWorldImportItem(session: IHTTPSession, importId: String): Response {
        if (!importId.matches(Regex("[A-Za-z0-9_-]{1,120}"))) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid import id"))
        return try {
            val records = readArray(worldImportsFile, "worldImports")
            var index = -1
            for (i in 0 until records.length()) if (records.optJSONObject(i)?.optString("id") == importId) { index = i; break }
            if (index < 0) return json(Response.Status.NOT_FOUND, JSONObject().put("error", "world import not found"))
            val record = records.getJSONObject(index)
            if (session.method == Method.GET) return json(Response.Status.OK, JSONObject(record.toString()).apply { remove("raw") })
            if (record.optString("status") == "committed") return json(Response.Status.OK, JSONObject().put("import", JSONObject(record.toString()).apply { remove("raw") }).put("world", record.optJSONObject("importedWorld")).put("idempotent", true))
            val world = commitWorldImport(record)
            record.put("status", "committed").put("committedAt", System.currentTimeMillis()).put("importedWorld", worldSummary(world)); records.put(index, record); writeArray(worldImportsFile, records)
            json(Response.Status.CREATED, JSONObject().put("import", JSONObject(record.toString()).apply { remove("raw") }).put("world", worldSummary(world)).put("idempotent", false))
        } catch (e: Exception) { json(Response.Status.CONFLICT, JSONObject().put("error", "世界包导入失败: ${e.message}")) }
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
            val fields = arrayOf("title", "summary", "tags", "lorebookIds", "rpgPresetName", "agent", "ui", "regexes", "setting", "rules", "playerCreation", "turnContract", "failure", "ending", "time", "events", "factions", "conflicts", "locations", "npcs", "mapGeneration")
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
                // characters.json 是数组，其余数据文件通常是对象；两种根类型都要允许。
                // 之前只用 JSONObject 校验，角色保存每次都返回 400，前端只能留下 localStorage 缓存。
                val parsed = org.json.JSONTokener(raw).nextValue()
                if (parsed !is JSONObject && parsed !is org.json.JSONArray) throw IllegalArgumentException("JSON 根节点必须是对象或数组")
            } catch (e: Exception) {
                return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "invalid JSON"))
            }
            writeTextAtomic(f, raw)
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
