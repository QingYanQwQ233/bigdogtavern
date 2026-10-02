import io, re

# ═══════ 1) index.html：引库 + 色字段改文本输入 + 扩档位 ═══════
p = 'public/index.html'
s = io.open(p, encoding='utf-8').read()

m = re.search(r'<link rel="stylesheet" href="styles\.css[^"]*"[^>]*>', s)
assert m, 'styles.css link 未找到'
s = s[:m.end()] + '\n    <link rel="stylesheet" href="vendor/coloris/coloris.min.css" />' + s[m.end():]

m = re.search(r'<script src="app\.js[^"]*"></script>', s)
assert m, 'app.js script 未找到'
s = s[:m.start()] + '<script src="vendor/coloris/coloris.min.js"></script>\n    ' + s[m.start():]

for name, default in (('toast-bg', '#1c1c1e'), ('toast-fg', '#f2f2f7'), ('toast-accent', '#77e6d5')):
    old = '<input id="%s" type="color" value="%s" />' % (name, default)
    assert s.count(old) == 1, '%s 字段锚点不符' % name
    s = s.replace(old, '<input id="%s" class="tavern-color-field" type="text" value="%s" autocomplete="off" spellcheck="false" />' % (name, default), 1)

old = """                <select id="toast-font-size">
                  <option value="12">12px</option>
                  <option value="13">13px</option>
                  <option value="14">14px</option>
                  <option value="15">15px</option>
                </select>"""
new = """                <select id="toast-font-size">
                  <option value="10">10px</option>
                  <option value="11">11px</option>
                  <option value="12">12px</option>
                  <option value="13">13px</option>
                  <option value="14">14px</option>
                  <option value="15">15px</option>
                  <option value="16">16px</option>
                  <option value="18">18px</option>
                  <option value="20">20px</option>
                </select>"""
assert s.count(old) == 1, '字号锚点不符'
s = s.replace(old, new, 1)

old = """                <select id="toast-padding">
                  <option value="compact">紧凑</option>
                  <option value="normal">标准</option>
                  <option value="loose">宽松</option>
                </select>"""
new = """                <select id="toast-padding">
                  <option value="tight">很紧凑</option>
                  <option value="compact">紧凑</option>
                  <option value="normal">标准</option>
                  <option value="loose">宽松</option>
                  <option value="loose2">很宽松</option>
                </select>"""
assert s.count(old) == 1, '大小锚点不符'
s = s.replace(old, new, 1)

old = """                <select id="toast-shape">
                  <option value="pill">胶囊</option>
                  <option value="round">圆角</option>
                  <option value="sharp">方角</option>
                </select>"""
new = """                <select id="toast-shape">
                  <option value="pill">胶囊</option>
                  <option value="round">圆角</option>
                  <option value="soft">小圆角</option>
                  <option value="sharp">方角</option>
                  <option value="square">直角</option>
                </select>"""
assert s.count(old) == 1, '样式锚点不符'
s = s.replace(old, new, 1)

old = """                <select id="toast-speed">
                  <option value="slow">慢</option>
                  <option value="normal">标准</option>
                  <option value="fast">快</option>
                </select>"""
new = """                <select id="toast-speed">
                  <option value="slowest">很慢</option>
                  <option value="slow">慢</option>
                  <option value="normal">标准</option>
                  <option value="fast">快</option>
                  <option value="fastest">很快</option>
                </select>"""
assert s.count(old) == 1, '速度锚点不符'
s = s.replace(old, new, 1)

old = """                <select id="toast-max">
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5</option>
                </select>"""
new = """                <select id="toast-max">
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5</option>
                  <option value="6">6</option>
                  <option value="8">8</option>
                  <option value="10">10</option>
                </select>"""
assert s.count(old) == 1, '数量锚点不符'
s = s.replace(old, new, 1)

io.open(p, 'w', encoding='utf-8').write(s)
print('index.html OK')

# ═══════ 2) app-core.js：档位表扩展 + 数量上限 ═══════
p = 'frontend/app-core.js'
s = io.open(p, encoding='utf-8').read()

old = "const TOAST_PADDING = { compact: { y: 8, x: 12 }, normal: { y: 10, x: 16 }, loose: { y: 12, x: 20 } };"
new = "const TOAST_PADDING = { tight: { y: 6, x: 10 }, compact: { y: 8, x: 12 }, normal: { y: 10, x: 16 }, loose: { y: 12, x: 20 }, loose2: { y: 16, x: 24 } };"
assert s.count(old) == 1, '内边距表锚点不符'
s = s.replace(old, new, 1)

old = "const TOAST_SHAPE_RADIUS = { pill: 999, round: 16, sharp: 8 };"
new = "const TOAST_SHAPE_RADIUS = { pill: 999, round: 16, soft: 12, sharp: 8, square: 0 };"
assert s.count(old) == 1, '形状表锚点不符'
s = s.replace(old, new, 1)

old = """const TOAST_DURATIONS = {
  slow: { in: 400, out: 480, clear: 640, pulse: 400 },
  normal: { in: 250, out: 300, clear: 400, pulse: 250 },
  fast: { in: 150, out: 200, clear: 250, pulse: 150 },
};"""
new = """const TOAST_DURATIONS = {
  slowest: { in: 600, out: 800, clear: 1000, pulse: 600 },
  slow: { in: 400, out: 480, clear: 640, pulse: 400 },
  normal: { in: 250, out: 300, clear: 400, pulse: 250 },
  fast: { in: 150, out: 200, clear: 250, pulse: 150 },
  fastest: { in: 100, out: 150, clear: 200, pulse: 100 },
};"""
assert s.count(old) == 1, '时长表锚点不符'
s = s.replace(old, new, 1)

old = "    max: Math.max(1, Math.min(5, Number(raw.max) || 2)),"
new = "    max: Math.max(1, Math.min(10, Number(raw.max) || 2)),"
assert s.count(old) == 1, '数量上限锚点不符'
s = s.replace(old, new, 1)

io.open(p, 'w', encoding='utf-8').write(s)
print('app-core.js OK')

# ═══════ 3) app-ui.js：初始化 Coloris（替代原生取色器） ═══════
p = 'frontend/app-ui.js'
s = io.open(p, encoding='utf-8').read()
old = """  $('btn-toast-test').addEventListener('click', testToastAppearance);"""
new = """  /* 颜色字段用 Coloris（内联在 public/vendor/coloris，MIT），不用原生取色器：
     Android WebView 的原生取色器样式不可控、打开位置也奇怪。 */
  if (typeof Coloris === 'function') {
    Coloris({
      el: '.tavern-color-field',
      themeMode: 'dark',
      format: 'hex',
      alpha: false,
      swatches: ['#1c1c1e', '#f2f2f7', '#77e6d5', '#5d8bca', '#ff6b6b', '#ffd166', '#06d6a0', '#ef476f'],
      onChange: () => readToastForm(true),
      a11y: {
        open: '打开取色器',
        close: '关闭取色器',
        clear: '清除颜色',
        hueSlider: '色相',
        alphaSlider: '透明度',
        input: '颜色值',
        format: '颜色格式',
        swatch: '色板',
      },
    });
  }
  $('btn-toast-test').addEventListener('click', testToastAppearance);"""
assert s.count(old) == 1, '测试按钮绑定锚点不符'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('app-ui.js OK')

# ═══════ 4) styles.css：层级 + 输入框外观 ═══════
p = 'public/styles.css'
s = io.open(p, encoding='utf-8').read()
extra = """
/* Coloris（第三方，public/vendor/coloris，MIT）：默认 z-index 只有 1000，
   会被设置面板（10000+）和灵动岛（15000）盖住，这里抬到最上层。 */
.clr-picker { z-index: 16500; }
/* 颜色字段沿用项目输入外观，保持与其它设置项一致 */
.tavern-color-field {
  width: 100%;
  min-height: 36px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-2, rgba(255, 255, 255, 0.06));
  color: var(--text);
  font-family: var(--font-body);
  font-size: 13px;
  box-sizing: border-box;
}
.tavern-color-field:focus { outline: 1px solid var(--accent); outline-offset: 1px; }
"""
s = s.rstrip() + '\n' + extra
io.open(p, 'w', encoding='utf-8').write(s)
print('styles.css OK')