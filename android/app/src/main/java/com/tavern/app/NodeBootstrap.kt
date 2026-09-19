package com.tavern.app

import android.content.Context
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * 把 APK 里的后端资源解包到应用私有目录，并拉起内嵌 Node 运行时。
 *
 * APK 内的布局（由 scripts/sync_android_assets.sh 生成）：
 * ```
 * assets/nodejs/server.js         ← 与桌面端同一个文件，零改动
 * assets/nodejs/public/...        ← 前端资源
 * ```
 * 解包后（server.js 的 `path.join(__dirname, 'public')` 因此成立）：
 * ```
 * filesDir/nodejs/server.js
 * filesDir/nodejs/public/index.html ...
 * ```
 * 数据目录沿用 server.js 的默认值 `public/data`，落在应用私有目录内，
 * 与桌面端语义完全一致，且其它 App 无法访问。
 */
object NodeBootstrap {

    const val PORT = 3000

    private const val TAG = "NodeBootstrap"
    private const val ASSET_ROOT = "nodejs"
    private const val POLL_INTERVAL_MS = 250L

    /** 解包后的运行目录（server.js 与 public/ 的父目录） */
    fun runtimeDir(context: Context): File = File(context.filesDir, ASSET_ROOT)

    /**
     * 把 assets/nodejs 递归解包到 filesDir/nodejs，返回 server.js 路径。
     *
     * 每次启动都重新解包：APK 升级后资源会变，覆盖写可避免新旧文件混杂。
     * 只覆盖 assets 里存在的文件，因此运行期生成的数据（worlds.json、saves/ 等）不会被清掉。
     */
    fun unpack(context: Context): File {
        val dir = runtimeDir(context)
        // 迁移必须排在解包之前：解包会创建 public/data，否则会被判定为「已存在」而跳过迁移
        migrateLegacyData(context, dir)
        extract(context, ASSET_ROOT, dir)
        val serverJs = File(dir, "server.js")
        check(serverJs.isFile) { "APK 里缺少 assets/$ASSET_ROOT/server.js（构建时是否漏跑 scripts/sync_android_assets.sh？）" }
        return serverJs
    }

    /** 解包并启动 Node，返回运行目录。 */
    fun start(context: Context): File {
        val dir = runtimeDir(context)
        val serverJs = unpack(context)
        val rc = NodeRuntime.startNode(arrayOf("node", serverJs.absolutePath), dir.absolutePath, true)
        Log.i(TAG, "已拉起 Node 线程 rc=$rc, server.js=${serverJs.absolutePath}")
        check(rc == 0) { "无法创建 Node 线程（rc=$rc）" }
        return dir
    }

    /** 轮询 http://127.0.0.1:PORT/ 直到 server.js 开始监听。 */
    fun awaitReady(timeoutMs: Long = 30_000L): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (probe()) return true
            try {
                Thread.sleep(POLL_INTERVAL_MS)
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
                return false
            }
        }
        return false
    }

    private fun probe(): Boolean = try {
        val conn = URL("http://127.0.0.1:$PORT/").openConnection() as HttpURLConnection
        conn.connectTimeout = 1000
        conn.readTimeout = 1000
        conn.requestMethod = "GET"
        val code = conn.responseCode
        conn.disconnect()
        code in 200..499
    } catch (e: Exception) {
        false
    }

    /**
     * 一次性迁移旧版（Kotlin 后端）的数据目录。
     *
     * 旧版 TavernServer.kt 把数据放在 `filesDir/data` 与 `filesDir/images`；
     * 新版沿用 server.js 的默认布局，即 `public/data` 与 `public/images`。
     * 不迁移的话升级后会看到一个空存档。
     *
     * 仅在目标目录尚不存在时迁移一次；旧目录原样保留，便于回退。
     */
    private fun migrateLegacyData(context: Context, target: File) {
        val pairs = listOf(
            File(context.filesDir, "data") to File(target, "public/data"),
            File(context.filesDir, "images") to File(target, "public/images")
        )
        for ((legacy, dest) in pairs) {
            if (dest.exists() || !legacy.isDirectory) continue
            try {
                legacy.copyRecursively(dest, overwrite = false)
                Log.i(TAG, "已迁移旧版数据：${legacy.absolutePath} → ${dest.absolutePath}")
            } catch (e: Exception) {
                Log.w(TAG, "迁移 ${legacy.absolutePath} 失败（继续启动）", e)
            }
        }
    }

    /** assets.list() 返回空即视作文件；本项目 assets 下不存在空目录。 */
    private fun extract(context: Context, assetPath: String, target: File) {
        val children = context.assets.list(assetPath).orEmpty()
        if (children.isEmpty()) {
            target.parentFile?.mkdirs()
            context.assets.open(assetPath).use { input ->
                FileOutputStream(target).use { output -> input.copyTo(output) }
            }
            return
        }
        target.mkdirs()
        for (child in children) {
            extract(context, "$assetPath/$child", File(target, child))
        }
    }
}
