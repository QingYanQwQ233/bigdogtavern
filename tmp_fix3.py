import io

p = 'android/app/src/main/java/com/tavern/app/MainActivity.kt'
lines = io.open(p, encoding='utf-8').read().split('\n')

# ① 删掉挂在 webView 上的 insets listener（WebView 自身会覆盖外部 padding）
start = [k for k, l in enumerate(lines) if 'webView.setOnApplyWindowInsetsListener' in l]
assert len(start) == 1, f'listener 命中 {len(start)} 处'
s0 = start[0]
# 注释两行 + listener 块（到同级 '        }' 结束）
assert '全屏后内容会顶到状态栏' in lines[s0 - 3], 'listener 上方注释不符合预期'
e0 = s0
while lines[e0].strip() != '}':
    e0 += 1
del lines[s0 - 3:e0 + 1]
lines = [l for l in lines if l.strip() != '' or True]  # 保持不变，仅占位

# ② setContentView(webView) → 包一层 FrameLayout，padding 加在容器上
j = [k for k, l in enumerate(lines) if l.strip() == 'setContentView(webView)']
assert len(j) == 1, 'setContentView anchor'
holder = '''        // WebView 自身会处理 window insets 并覆盖外部设置的 padding，
        // 因此避让必须加在承载它的容器上，而不是 WebView 自己。
        val rootView = FrameLayout(this)
        rootView.addView(
            webView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )
        rootView.setOnApplyWindowInsetsListener { view, insets ->
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
        }
        setContentView(rootView)'''.split('\n')
lines[j[0]:j[0] + 1] = holder

# ③ import FrameLayout
k = [k for k, l in enumerate(lines) if l.strip() == 'import android.widget.FrameLayout']
if not k:
    m = [k for k, l in enumerate(lines) if l.strip() == 'import android.widget.Toast']
    assert len(m) == 1, 'Toast import anchor'
    lines.insert(m[0], 'import android.widget.FrameLayout')

io.open(p, 'w', encoding='utf-8').write('\n'.join(lines))

text = io.open(p, encoding='utf-8').read()
assert 'setOnApplyWindowInsetsListener' in text and 'rootView' in text
assert 'setContentView(rootView)' in text
assert text.count('setOnApplyWindowInsetsListener') == 1, '不应再有 WebView 上的 listener'
assert 'import android.widget.FrameLayout' in text
print('MainActivity.kt OK：避让改为容器 padding')