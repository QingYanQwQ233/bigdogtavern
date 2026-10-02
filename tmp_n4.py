import io

p = 'public/styles.css'
s = io.open(p, encoding='utf-8').read()

old = """.cot-body .cot-tool {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;"""
assert s.count(old) == 1, f'cot-tool 块锚点不符（命中 {s.count(old)} 次）'

new = """/* 正文里内联的工具卡：和叙事段落区分开，但不打断阅读 */
.rpg-prose .cot-inline-tools { margin: 8px 0; display: flex; flex-direction: column; gap: 4px; }
.cot-body .cot-tool {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;"""
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('styles.css OK')