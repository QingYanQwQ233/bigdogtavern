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
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.JavascriptInterface
import android.widget.Toast
import java.io.File
import java.io.FileOutputStream

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
    private val DOWNLOAD_PERMISSION_REQ = 1002
    private var pendingDownload: DownloadRequest? = null

    private data class DownloadRequest(val name: String, val mimeType: String, val base64: String)

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
        server.stop()
        webView.destroy()
        super.onDestroy()
    }
}
