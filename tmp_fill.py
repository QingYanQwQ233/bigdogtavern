import io

# ─────────── 1) MainActivity.kt：铺满 + 注入 --safe-top/bottom ───────────
p = 'android/app/src/main/java/com/tavern/app/MainActivity.kt'
s = io.open(p, encoding='utf-8').read()

old_head = '''        // 全屏（edge-to-edge）：窗口铺到状态栏 / 导航栏之下；内容不能跟着顶上去
        // （否则会和状态栏图标叠在一起），所以用容器内边距避开系统栏。
        // 内边距必须加在容器上：WebView 自身会处理 insets 并覆盖掉外部设置的 padding。'''
new_head = '''        // 全屏（edge-to-edge）：窗口铺满整屏，内容一直铺到状态栏 / 导航栏之下，
        // 系统栏透明。避让交给页面自己：把系统栏高度注入 --safe-top / --safe-bottom，
        // 由 styles.css 的 #app 与各全屏面板使用 —— 谁在显示就带谁的颜色，
        // 不会出现一条固定的「同色带」跟当前界面颜色对不上。'''
assert s.count(old_head) == 1, 'head 锚点不符'
s = s.replace(old_head, new_head)

old_listener = '''        rootView.setOnApplyWindowInsetsListener { view, insets ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val bars = insets.getInsets(WindowInsets.Type.systemBars())
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            } else {
                @Suppress("DEPRECATION")
                view.setPadding(
                    insets.systemWindowInsetLeft,
                    insets.systemWindowInsetTop,
                    insets.systemWindowInsetRight,
                    insets.systemWindowInsetBottom
                )
            }
            insets
        }'''
new_listener = '''        rootView.setOnApplyWindowInsetsListener { _, insets ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val bars = insets.getInsets(WindowInsets.Type.systemBars())
                updateSafeArea(bars.top, bars.bottom)
            } else {
                @Suppress("DEPRECATION")
                updateSafeArea(insets.systemWindowInsetTop, insets.systemWindowInsetBottom)
            }
            insets
        }'''
assert s.count(old_listener) == 1, 'listener 锚点不符'
s = s.replace(old_listener, new_listener)

# WebViewClient 补 onPageFinished
old_wc = '''                return false
            }
        }
        // 全屏（edge-to-edge）'''
new_wc = '''                return false
            }

            override fun onPageFinished(view: WebView, url: String) {
                // 页面重载后 :root 上的变量会丢失，需要重新注入一次
                injectSafeArea()
            }
        }
        // 全屏（edge-to-edge）'''
assert s.count(old_wc) == 1, 'WebViewClient 锚点不符'
s = s.replace(old_wc, new_wc)

# 成员 + 方法
i = s.index('    /**\n     * 全屏（edge-to-edge）：窗口铺满整屏')
j = s.index('    private fun applyEdgeToEdge() {')
new_helpers = '''    /** 系统栏留白（CSS 像素）：top / bottom，页面重载后要重新注入 */
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
     * 避让由页面自己负责（--safe-top / --safe-bottom，见 styles.css 的 #app
     * 与各全屏面板），这样状态栏 / 导航栏区域永远显示「当前界面的颜色」。
     */
'''
s = s[:i] + new_helpers + s[j:]
io.open(p, 'w', encoding='utf-8').write(s)
t = io.open(p, encoding='utf-8').read()
assert 'injectSafeArea' in t and 'updateSafeArea' in t
assert 'view.setPadding' not in t, '容器不应再留内边距'
print('MainActivity.kt OK')

# ─────────── 2) styles.css：env → var + #app 避让 ───────────
p = 'public/styles.css'
s = io.open(p, encoding='utf-8').read()
cnt = {}
for side in ('top', 'bottom'):
    old = 'env(safe-area-inset-%s)' % side
    new = 'var(--safe-%s, env(safe-area-inset-%s))' % (side, side)
    cnt[side] = s.count(old)
    s = s.replace(old, new)

anchor = '#app {\n  display: grid;'
assert s.count(anchor) == 1, '#app 锚点不符'
s = s.replace(anchor,
              '#app {\n'
              '  /* 系统栏避让：--safe-* 由 Android 壳注入（WebView 不上报 env()） */\n'
              '  padding-top: var(--safe-top, env(safe-area-inset-top));\n'
              '  padding-bottom: var(--safe-bottom, env(safe-area-inset-bottom));\n'
              '  box-sizing: border-box;\n'
              '  display: grid;')
io.open(p, 'w', encoding='utf-8').write(s)
print('styles.css OK：top %d 处 / bottom %d 处，并给 #app 加了避让' % (cnt['top'], cnt['bottom']))