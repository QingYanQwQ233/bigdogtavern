import io

# ═══════════════ 1) index.html：去掉 Coloris 引用 ═══════════════
p = 'public/index.html'
s = io.open(p, encoding='utf-8').read()
for frag in ('\n    <link rel="stylesheet" href="vendor/coloris/coloris.min.css" />',
             '<script src="vendor/coloris/coloris.min.js"></script>\n    '):
    if frag in s:
        s = s.replace(frag, '', 1)
assert 'vendor/coloris' not in s, 'index.html 仍有 coloris 引用'
io.open(p, 'w', encoding='utf-8').write(s)
print('index.html OK（已移除 vendor 引用）')

# ═══════════════ 2) sw.js：SHELL 去掉 vendor ═══════════════
p = 'public/sw.js'
s = io.open(p, encoding='utf-8').read()
old = ", '/vendor/coloris/coloris.min.js', '/vendor/coloris/coloris.min.css'"
assert s.count(old) == 1, 'SHELL 锚点不符'
s = s.replace(old, '', 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('sw.js OK')

# ═══════════════ 3) styles.css：Coloris 规则换成自绘面板样式 ═══════════════
p = 'public/styles.css'
s = io.open(p, encoding='utf-8').read()
start = s.find('/* ─── 取色器（Coloris）外观对齐项目风格 ───')
assert start > 0, '未找到 Coloris 样式段'
end = s.find('.clr-field { width: 100%; }', start)
assert end > 0, '未找到 Coloris 样式段结尾'
end += len('.clr-field { width: 100%; }')
new_css = """/* ─── 颜色字段 + 自绘取色面板 ───
   不用原生 input[type=color]，也不引第三方库：自绘面板无外部依赖，
   不会被 service worker 的离线兜底或加载时序影响。 */
.tavern-color-field {
  width: 100%;
  min-height: 36px;
  padding: 8px 40px 8px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 13px;
  box-sizing: border-box;
}
.tavern-color-field:focus { outline: 1px solid var(--accent); outline-offset: 1px; }
.color-field-wrap { position: relative; }
.color-field-swatch {
  position: absolute;
  top: 50%;
  right: 8px;
  width: 24px;
  height: 24px;
  padding: 0;
  transform: translateY(-50%);
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #000;
  cursor: pointer;
}
.color-field-swatch:focus { outline: 1px solid var(--accent); outline-offset: 1px; }

.tcp { position: fixed; inset: 0; z-index: 17000; }
.tcp[hidden] { display: none; }
.tcp-veil { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.45); }
.tcp-panel {
  position: absolute;
  left: 50%;
  bottom: calc(16px + var(--safe-bottom, 0px));
  width: min(320px, calc(100vw - 32px));
  padding: 12px;
  transform: translateX(-50%);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  box-sizing: border-box;
  font-family: var(--font-body);
}
.tcp-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.tcp-preview {
  flex: none;
  width: 24px;
  height: 24px;
  border: 1px solid var(--line);
  border-radius: 6px;
}
.tcp-hex {
  flex: 1;
  min-width: 0;
  min-height: 36px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
  font-size: 13px;
  box-sizing: border-box;
}
.tcp-done {
  flex: none;
  min-height: 36px;
  padding: 8px 16px;
  border: 1px solid rgba(var(--accent-rgb), 0.5);
  border-radius: 8px;
  background: rgba(var(--accent-rgb), 0.16);
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}
.tcp-sv {
  position: relative;
  height: 140px;
  border-radius: 8px;
  background:
    linear-gradient(to top, #000, rgba(0, 0, 0, 0)),
    linear-gradient(to right, #fff, rgba(255, 255, 255, 0));
  overflow: hidden;
  touch-action: none;
}
.tcp-hue {
  position: relative;
  height: 12px;
  margin-top: 10px;
  border-radius: 6px;
  background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
  touch-action: none;
}
.tcp-dot,
.tcp-hue-dot {
  position: absolute;
  top: 50%;
  left: 0;
  width: 16px;
  height: 16px;
  transform: translate(-50%, -50%);
  border: 2px solid #fff;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
  pointer-events: none;
}
.tcp-swatches { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.tcp-swatches button {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 6px;
  cursor: pointer;
}
.tcp-hint { margin: 10px 0 0; color: var(--muted); font-size: 12px; }"""
s = s[:start] + new_css + s[end:]
assert 'clr-' not in s, '还有 Coloris 样式残留'
io.open(p, 'w', encoding='utf-8').write(s)
print('styles.css OK')