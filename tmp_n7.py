import io

p = 'frontend/app-ui.js'
s = io.open(p, encoding='utf-8').read()

# 文件里实际是 JS 的 /\s+/ 被写成了 /\\s+/（多一层转义 ⇒ 匹配字面反斜杠）
# 用 raw 字符串精确定位
bad = r""".replace(/\\s+/g, '')"""
good = r""".replace(/\s+/g, '')"""
n = s.count(bad)
assert n >= 1, f'坏正则锚点不符（命中 {n}）'
s = s.replace(bad, good)
io.open(p, 'w', encoding='utf-8').write(s)
print(f'app-ui.js OK：修了 {n} 处')
for i, line in enumerate(s.split('\n'), 1):
    if 'squeeze = text' in line or 'replace(/' in line and 's+' in line:
        print(i, line.strip())