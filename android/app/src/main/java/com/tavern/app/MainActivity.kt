package com.tavern.app

import android.Manifest
import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.content.pm.ActivityInfo
import android.webkit.JavascriptInterface
import android.widget.FrameLayout
import android.widget.Toast
import java.io.File
import java.io.FileOutputStream

/**
 * Tavern · 离线 APK 入口
 *
 * 后端 = 仓库里的 server.js 本体（唯一来源），由内嵌 Node 运行时（nodejs-mobile）
 * 直接执行，不再用 Kotlin 重写一份。前端代码与桌面版完全一致（零改动）；
 * 数据/图片存应用私有目录。
 *
 * 启动顺序：解包 assets → 拉起 Node → 轮询等端口就绪 → WebView 加载同源页面。
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private val port = NodeBootstrap.PORT

    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private val FILE_CHOOSER_REQ = 1001
    private val DOWNLOAD_PERMISSION_REQ = 1002
    private var pendingDownload: DownloadRequest? = null

    private data class DownloadRequest(val name: String, val mimeType: String, val base64: String)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true // localStorage 持久（角色/世界书/会话）
        webView.settings.databaseEnabled = true
        webView.settings.allowFileAccess = false
        webView.settings.mediaPlaybackRequiresUserGesture = false
        // 视口：让 viewport meta（width=device-width）生效，否则 WebView 默认按 980px 宽渲染
        // → 会导致 ≥961px 判定成立、侧栏误显示
        webView.settings.useWideViewPort = true
        webView.settings.loadWithOverviewMode = true
        // 全屏模式下 WebView 要透明，让页面自己的背景铺到状态栏 / 导航栏之下
        webView.setBackgroundColor(android.graphics.Color.TRANSPARENT)
        webView.addJavascriptInterface(DownloadBridge(), "TavernAndroid")
        webView.webChromeClient = object : WebChromeClient() {
            // 文件选择器：<input type="file"> 必须实现此回调，否则点击无效（导入形象参考图依赖）
            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback
                try {
                    startActivityForResult(fileChooserParams.createIntent(), FILE_CHOOSER_REQ)
                } catch (e: Exception) {
                    this@MainActivity.filePathCallback = null
                    return false
                }
                return true
            }
        }
        webView.webViewClient = object : WebViewClient() {
            // 外部链接（非本地服务）移交系统浏览器，避免塞进 WebView
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                if (url.startsWith("http://127.0.0.1:$port") || url.startsWith("http://localhost:$port")) return false
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                    } catch (e: Exception) { /* 无浏览器可打开时忽略 */ }
                    return true
                }
                return false
            }

            override fun onPageFinished(view: WebView, url: String) {
                // 页面重载后 :root 上的变量会丢失，需要重新注入一次
                injectSafeArea()
            }
        }
        // 全屏（edge-to-edge）：窗口铺满整屏，内容一直铺到状态栏 / 导航栏之下，
        // 系统栏透明。避让交给页面自己：把系统栏高度注入 --safe-top / --safe-bottom，
        // 由 styles.css 的 #app 与各全屏面板使用 —— 谁在显示就带谁的颜色，
        // 不会出现一条固定的「同色带」跟当前界面颜色对不上。
        val rootView = FrameLayout(this)
        rootView.addView(
            webView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )
        rootView.setOnApplyWindowInsetsListener { _, insets ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val bars = insets.getInsets(WindowInsets.Type.systemBars())
                // 键盘弹出时把键盘高度也算进底部避让：页面自己收叠（聊天区变矮），
                // 而不是整个窗口被平移上去（adjustPan）。
                val ime = insets.getInsets(WindowInsets.Type.ime())
                updateSafeArea(bars.top, maxOf(bars.bottom, ime.bottom))
            } else {
                @Suppress("DEPRECATION")
                // API 30 以下：adjustResize 时 systemWindowInsetBottom 已包含键盘
                updateSafeArea(insets.systemWindowInsetTop, insets.systemWindowInsetBottom)
            }
            insets
        }
        setContentView(rootView)

        applyEdgeToEdge()
        bootNode()
    }

    /** 系统栏留白（CSS 像素）：top / bottom，页面重载后要重新注入 */
    private var safeTopCss = 0
    private var safeBottomCss = 0

    /** 系统栏高度（物理像素）换算成 CSS 像素后注入页面变量 */
    private fun updateSafeArea(topPx: Int, bottomPx: Int) {
        val d = resources.displayMetrics.density.takeIf { it > 0f } ?: 1f
        safeTopCss = (topPx / d).toInt()
        safeBottomCss = (bottomPx / d).toInt()
        injectSafeArea()
    }

    /**
     * 把系统栏留白写进 :root 的 --safe-top / --safe-bottom。
     *
     * 页面（styles.css）用 var(--safe-*, env(safe-area-inset-*)) 读取：
     * 套壳里走注入值，浏览器 / iOS PWA 里 env() 本来就有效，作为回退。
     */
    private fun injectSafeArea() {
        val js = "(function(){var s=document.documentElement.style;" +
            "s.setProperty('--safe-top','${safeTopCss}px');" +
            "s.setProperty('--safe-bottom','${safeBottomCss}px');})()"
        webView.post { runCatching { webView.evaluateJavascript(js, null) } }
    }

    /**
     * 全屏（edge-to-edge）：窗口铺满整屏，系统栏透明，内容一直铺到栏下。
     *
     * 避让由页面自己负责（--safe-top / --safe-bottom），这样状态栏 / 导航栏
     * 区域永远显示「当前界面自己的颜色」，不会出现一条对不上的底色带。
     */
    private fun applyEdgeToEdge() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            // 状态栏 / 导航栏区域显示为页面底色，避免露出黑边（底色与 index.html 的 theme-color 一致）
            window.decorView.setBackgroundColor(PAGE_BACKGROUND)
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility =
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                    View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Android 10+ 默认给导航栏加一层对比度底色，不去掉就做不到真透明
            @Suppress("DEPRECATION")
            window.isNavigationBarContrastEnforced = false
        }
        // 系统栏必须透明，否则会盖住已经延伸到栏下的内容（表现就是顶部 / 底部黑边）。
        // 注意：Android 15 只在 targetSdk >= 35 时才强制透明；本项目 targetSdk = 34，
        // 所以这两行在 Android 15（API 35）上仍然必需，不能按 SDK 版本跳过。
        @Suppress("DEPRECATION")
        window.statusBarColor = android.graphics.Color.TRANSPARENT
        @Suppress("DEPRECATION")
        window.navigationBarColor = android.graphics.Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // 界面是深色的：清掉「浅色图标」标记，让系统栏图标转为浅色
            window.insetsController?.setSystemBarsAppearance(
                0,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                    WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            )
        }
    }


    /** 解包 assets → 应用私有目录，拉起内嵌 Node，等 server.js 开始监听后再加载页面 */
    private fun bootNode() {
        Thread({
            try {
                val dir = NodeBootstrap.start(applicationContext)
                Log.i(TAG, "运行目录: ${dir.absolutePath}")
                if (NodeBootstrap.awaitReady(30_000L)) {
                    Log.i(TAG, "server.js 已监听端口 $port")
                    runOnUiThread { webView.loadUrl("http://127.0.0.1:$port/") }
                } else {
                    Log.e(TAG, "等待 server.js 监听端口 $port 超时")
                    showBootFailure("后端启动超时（30 秒内未监听端口 $port）")
                }
            } catch (t: Throwable) {
                Log.e(TAG, "Node 启动失败", t)
                showBootFailure(t.message ?: t.toString())
            }
        }, "tavern-node-boot").start()
    }

    private fun showBootFailure(detail: String) {
        val safe = detail.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        val html = """
            <!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
            <body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#1c1c1e;font:14px -apple-system,sans-serif">
            <div style="text-align:center;padding:24px">
            <p style="color:#ff453a;margin:0 0 8px">后端启动失败</p>
            <p style="color:#98989d;margin:0">$safe</p>
            </div></body>
        """.trimIndent()
        runOnUiThread { webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null) }
    }

    private inner class DownloadBridge {
        @JavascriptInterface
        fun saveFile(rawName: String, rawMimeType: String, base64: String): Boolean {
            if (base64.length > 48_000_000) {
                runOnUiThread { Toast.makeText(this@MainActivity, "导出文件过大（上限约 36 MB）", Toast.LENGTH_LONG).show() }
                return false
            }
            val request = DownloadRequest(safeDownloadName(rawName), rawMimeType.ifBlank { "application/octet-stream" }, base64)
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                pendingDownload = request
                runOnUiThread { requestPermissions(arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), DOWNLOAD_PERMISSION_REQ) }
                return true
            }
            return writeDownload(request)
        }

        /** 世界卡声明的屏幕方向（ui.shell.orientation）：any / portrait / landscape。
         *  由宿主页面在进入 / 退出世界卡时调用；卡内 iframe 是 sandbox，读不到本桥。 */
        @JavascriptInterface
        fun setOrientation(mode: String) {
            val target = when (mode) {
                "landscape" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                "portrait" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
                else -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            }
            runOnUiThread { if (requestedOrientation != target) requestedOrientation = target }
        }
    }

    private fun safeDownloadName(rawName: String): String {
        val name = rawName.substringAfterLast('/').substringAfterLast('\\')
            .replace(Regex("[\\\\/:*?\"<>|\\r\\n]"), "_").trim()
        return name.take(180).ifBlank { "tavern-export.json" }
    }

    private fun writeDownload(request: DownloadRequest): Boolean {
        return try {
            val bytes = Base64.decode(request.base64, Base64.DEFAULT)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, request.name)
                    put(MediaStore.Downloads.MIME_TYPE, request.mimeType)
                    put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return false
                try {
                    contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: throw IllegalStateException("无法打开下载文件")
                    contentResolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
                } catch (error: Exception) {
                    contentResolver.delete(uri, null, null)
                    throw error
                }
            } else {
                val directory = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                if (!directory.exists() && !directory.mkdirs()) throw IllegalStateException("无法创建 Download 文件夹")
                val target = File(directory, request.name)
                FileOutputStream(target).use { it.write(bytes) }
            }
            runOnUiThread { Toast.makeText(this, "已导出到 Download/${request.name}", Toast.LENGTH_SHORT).show() }
            true
        } catch (error: Exception) {
            runOnUiThread { Toast.makeText(this, "导出失败：${error.message ?: "无法写入文件"}", Toast.LENGTH_LONG).show() }
            false
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == FILE_CHOOSER_REQ) {
            if (filePathCallback == null) {
                super.onActivityResult(requestCode, resultCode, data)
                return
            }
            val results: Array<Uri>? = if (resultCode == Activity.RESULT_OK && data != null && data.data != null) {
                arrayOf(data.data!!)
            } else null
            filePathCallback?.onReceiveValue(results)
            filePathCallback = null
        } else {
            super.onActivityResult(requestCode, resultCode, data)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != DOWNLOAD_PERMISSION_REQ) return
        val request = pendingDownload ?: return
        pendingDownload = null
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) writeDownload(request)
        else Toast.makeText(this, "未获得存储权限，无法导出文件", Toast.LENGTH_LONG).show()
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        // Node 线程随进程结束而终止；这里只回收 WebView
        webView.destroy()
        super.onDestroy()
    }

    private companion object {
        private const val PAGE_BACKGROUND = 0xFF1C1C1E.toInt() // 同 index.html 的 theme-color
        const val TAG = "TavernAndroid"
    }
}