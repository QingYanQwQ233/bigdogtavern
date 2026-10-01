import io

# ---- 1) index.html: viewport-fit=cover ----
p = 'public/index.html'
s = io.open(p, encoding='utf-8').read()
old = '<meta name="viewport" content="width=device-width, initial-scale=1.0" />'
new = '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />'
assert s.count(old) == 1, 'viewport anchor'
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8').write(s)
print('index.html OK')

# ---- 2) MainActivity.kt: edge-to-edge ----
p2 = 'android/app/src/main/java/com/tavern/app/MainActivity.kt'
s2 = io.open(p2, encoding='utf-8').read()

# 2a) imports
old_imp = 'import android.util.Log\nimport android.webkit.ValueCallback'
new_imp = 'import android.util.Log\nimport android.view.View\nimport android.view.WindowInsetsController\nimport android.webkit.ValueCallback'
assert s2.count(old_imp) == 1, 'import anchor'
s2 = s2.replace(old_imp, new_imp)

# 2b) onCreate 里开启 edge-to-edge
old_oncreate = '        super.onCreate(savedInstanceState)\n        webView = WebView(this)'
new_oncreate = '        super.onCreate(savedInstanceState)\n        applyEdgeToEdge()\n        webView = WebView(this)'
assert s2.count(old_oncreate) == 1, 'onCreate anchor'
s2 = s2.replace(old_oncreate, new_oncreate)

# 2c) WebView 背景交给页面（深色铺满，避免状态栏区域露出窗口底色）
old_bg = '        webView.settings.loadWithOverviewMode = true'
new_bg = ('        webView.settings.loadWithOverviewMode = true\n'
          '        // 全屏模式下 WebView 要透明，让页面自己的背景铺到状态栏 / 导航栏之下\n'
          '        webView.setBackgroundColor(android.graphics.Color.TRANSPARENT)')
assert s2.count(old_bg) == 1, 'webview bg anchor'
s2 = s2.replace(old_bg, new_bg)

# 2d) 新增 applyEdgeToEdge()
old_boot = '    /** 解包 assets → 应用私有目录，拉起内嵌 Node，等 server.js 开始监听后再加载页面 */'
new_boot = '''    /**
     * 全屏（edge-to-edge）：让内容延伸到状态栏 / 导航栏之下。
     *
     * 不这样做时，系统会把窗口限制在状态栏下方 —— 顶部就会空出一条黑边。
     * 避让由页面 CSS 的 env(safe-area-inset-*) 负责（styles.css 已就位），
     * 所以页面 meta 必须带 viewport-fit=cover，否则这些 env() 恒为 0。
     */
    private fun applyEdgeToEdge() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
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
        if (Build.VERSION.SDK_INT < 35) {
            // Android 15 (API 35) 起这两项已废弃且强制为透明，无需再设
            @Suppress("DEPRECATION")
            window.statusBarColor = android.graphics.Color.TRANSPARENT
            @Suppress("DEPRECATION")
            window.navigationBarColor = android.graphics.Color.TRANSPARENT
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // 界面是深色的：清掉 “浅色图标” 标记，让状态栏 / 导航栏图标转为浅色
            window.insetsController?.setSystemBarsAppearance(
                0,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                    WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            )
        }
    }

    /** 解包 assets → 应用私有目录，拉起内嵌 Node，等 server.js 开始监听后再加载页面 */'''
assert s2.count(old_boot) == 1, 'bootNode anchor'
s2 = s2.replace(old_boot, new_boot)

io.open(p2, 'w', encoding='utf-8').write(s2)
print('MainActivity.kt OK')