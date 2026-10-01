import io

# ─────────── 1) MainActivity.kt ───────────
p = 'android/app/src/main/java/com/tavern/app/MainActivity.kt'
s = io.open(p, encoding='utf-8').read()

# 1a) WebViewClient 补 onPageFinished
old1 = '''                return false
            }
        }
        // 全屏（edge-to-edge）：窗口铺到状态栏 / 导航栏之下；内容不能跟着顶上去
        // （否则会和状态栏图标叠在一起），所以用容器内边距避开系统栏。
        // 内边距必须加在容器上：WebView 自身会处理 insets 并覆盖掉外部设置的 padding。'''
new1 = '''                return false
            }

            override fun onPageFinished(view: WebView, url: String) {
                // 页面重载后 :root 上的变量会丢失，需要重新注入一次
                injectBottomInset()
            }
        }
        // 全屏（edge-to-edge）：窗口铺到状态栏 / 导航栏之下。
        // 顶部：内容用容器内边距避开状态栏（那条区域露出窗口底色，与页面同色）。
        // 底部：容器不留内边距，改由页面底栏自己避让 —— 这样底栏背景能一直铺到
        // 屏幕底部，而不是在导航栏位置留一条同色的空带。'''
assert s.count(old1) == 1, 'onPageFinished 锚点不符'
s = s.replace(old1, new1)

# 1b) listener：顶部留白 + 底部注入
old2 = '''        rootView.setOnApplyWindowInsetsListener { view, insets ->
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
new2 = '''        rootView.setOnApplyWindowInsetsListener { view, insets ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val bars = insets.getInsets(WindowInsets.Type.systemBars())
                view.setPadding(bars.left, bars.top, bars.right, 0)
                updateBottomInset(bars.bottom)
            } else {
                @Suppress("DEPRECATION")
                view.setPadding(
                    insets.systemWindowInsetLeft,
                    insets.systemWindowInsetTop,
                    insets.systemWindowInsetRight,
                    0
                )
                @Suppress("DEPRECATION")
                updateBottomInset(insets.systemWindowInsetBottom)
            }
            insets
        }'''
assert s.count(old2) == 1, 'listener 锚点不符'
s = s.replace(old2, new2)

# 1c) 替换方法注释，并补两个底部注入方法
i = s.index('    /**\n     * 全屏（edge-to-edge）：让窗口铺满整屏')
j = s.index('    private fun applyEdgeToEdge() {')
new3 = '''    /** 底部安全区（CSS 像素）：页面底栏用它避让导航栏，而不是由容器留白 */
    private var bottomInsetCss = 0

    /** 导航栏高度（物理像素）换算为 CSS 像素并注入页面 */
    private fun updateBottomInset(bottomPx: Int) {
        val d = resources.displayMetrics.density.takeIf { it > 0f } ?: 1f
        bottomInsetCss = (bottomPx / d).toInt()
        injectBottomInset()
    }

    /**
     * 把底部安全区写进 :root 的 --safe-bottom 供页面读取。
     *
     * 为什么不直接用容器内边距：那样底栏背景会被一起顶上去，导航栏位置留下
     * 一条同色的空带。交给页面自己避让，底栏背景才能铺满到底。
     */
    private fun injectBottomInset() {
        val js = "(function(){document.documentElement.style.setProperty(" +
            "'--safe-bottom','${bottomInsetCss}px');})()"
        webView.post { runCatching { webView.evaluateJavascript(js, null) } }
    }

    /**
     * 全屏（edge-to-edge）：窗口铺满整屏，系统栏透明，状态栏 / 导航栏区域露出窗口底色。
     *
     * 顶部避让由 rootView 内边距负责（状态栏区域保持一条与页面同色的带，不与图标重叠）；
     * 底部避让由页面的 --safe-bottom 负责（底栏背景可以铺到底）。
     */
'''
s = s[:i] + new3 + s[j:]

io.open(p, 'w', encoding='utf-8').write(s)
t = io.open(p, encoding='utf-8').read()
assert 'injectBottomInset' in t and 'bottomInsetCss' in t
assert 'bars.right, 0)' in t
assert 'setPadding' in t
print('MainActivity.kt OK')

# ─────────── 2) styles.css：只把 bottom 换成变量 ───────────
p = 'public/styles.css'
s = io.open(p, encoding='utf-8').read()
old = 'env(safe-area-inset-bottom)'
new = 'var(--safe-bottom, env(safe-area-inset-bottom))'
n = s.count(old)
assert n >= 6, 'bottom env 命中数异常：%d' % n
s = s.replace(old, new)
assert 'env(safe-area-inset-top)' in s and 'var(--safe-top' not in s, '顶部不应改动'
io.open(p, 'w', encoding='utf-8').write(s)
print('styles.css OK：%d 处 bottom 改为变量' % n)