package com.tavern.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * Tavern · 离线 APK 入口
 * 启动内嵌 HTTP 服务（127.0.0.1:3000），WebView 加载同源页面。
 * 前端代码与桌面版完全一致（零改动）；数据/图片存应用私有目录。
 */
class MainActivity : Activity() {

    private lateinit var server: TavernServer
    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private val FILE_CHOOSER_REQ = 1001

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        server = TavernServer(applicationContext)
        try {
            server.start(10_000, false) // 端口 3000；timeout 10s
        } catch (e: Exception) {
            server.stop()
            finish()
            return
        }

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
                if (url.startsWith("http://127.0.0.1:3000") || url.startsWith("http://localhost:3000")) return false
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                    } catch (e: Exception) { /* 无浏览器可打开时忽略 */ }
                    return true
                }
                return false
            }
        }
        setContentView(webView)
        webView.loadUrl("http://127.0.0.1:3000/")
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

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        server.stop()
        webView.destroy()
        super.onDestroy()
    }
}
