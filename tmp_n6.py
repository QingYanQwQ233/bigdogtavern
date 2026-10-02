import io

p = 'frontend/app-ui.js'
s = io.open(p, encoding='utf-8').read()

# 目标：把 JS 里的 /\\s+/g（匹配字面 \s）改回 /\s+/g（匹配空白）
bad = "const squeeze = text => String(text || '').replace(/\\\\s+/g, '');"
good = "const squeeze = text => String(text || '').replace(/\\s+/g, '');"
assert s.count(bad) == 1, f'坏正则锚点不符（命中 {s.count(bad)} 次，实际文件里是 {bad[:80]!r}）'
s = s.replace(bad, good, 1)

# 顺便检查文件里是否还有同类误写
rest = s.count("/\\\\s+")
io.open(p, 'w', encoding='utf-8').write(s)
print(f'app-ui.js OK（其余 /\\\\s+ 残留：{rest}）')