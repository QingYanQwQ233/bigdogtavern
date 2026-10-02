import io

p = 'public/styles.css'
s = io.open(p, encoding='utf-8').read()

# 原样式挂在 .cot-body 下，但步骤链里的思维链在 .rpg-prose 里 ⇒ 放宽前缀，恢复原版观感
old = """.cot-body .cot-step + .cot-step { margin-top: 8px; }
.cot-body .cot-step-head {"""
new = """.cot-step + .cot-step { margin-top: 8px; }
.cot-step-head {"""
assert s.count(old) == 1, 'cot-step-head 前缀锚点不符'
s = s.replace(old, new, 1)

for name in ['cot-step-head::-webkit-details-marker', 'cot-step-head::before', 'cot-step[open] > .cot-step-head::before', 'cot-step-main', 'cot-step-body']:
    pass

old = """.cot-body .cot-step-head::-webkit-details-marker { display: none; }
.cot-body .cot-step-head::before { content: '▸'; margin-right: 4px; color: var(--muted); }
.cot-body .cot-step[open] > .cot-step-head::before { content: '▾'; }
.cot-body .cot-step-main { padding: 2px 0 0 12px; }"""
new = """.cot-step-head::-webkit-details-marker { display: none; }
.cot-step-head::before { content: '▸'; margin-right: 4px; color: var(--muted); }
.cot-step[open] > .cot-step-head::before { content: '▾'; }
.cot-step-main { padding: 2px 0 0 12px; }"""
assert s.count(old) == 1, 'cot-step 子项前缀锚点不符'
s = s.replace(old, new, 1)

old = """.cot-body .cot-step-body { white-space: pre-wrap; overflow-wrap: anywhere; }"""
new = """.cot-step-body { white-space: pre-wrap; overflow-wrap: anywhere; }"""
assert s.count(old) == 1, 'cot-step-body 前缀锚点不符'
s = s.replace(old, new, 1)

old = """/* 当前步：只做一个很轻的标识，别用重背景抢正文 */
.cot-body .cot-step.is-current > .cot-step-head { color: var(--accent); }"""
new = """/* 当前步：只做一个很轻的标识，别用重背景抢正文 */
.cot-step.is-current > .cot-step-head { color: var(--accent); }"""
assert s.count(old) == 1, 'is-current 前缀锚点不符'
s = s.replace(old, new, 1)

# 还没产出思维链的步骤不显示空块
old = """.rpg-step-chain .cot-step { display: block; }"""
new = """.rpg-step-chain .cot-step { display: block; }
.rpg-step-chain .cot-step.is-empty { display: none; }"""
assert s.count(old) == 1, 'is-empty 锚点不符'
s = s.replace(old, new, 1)

# 工具行样式前缀同步
old = """.cot-body .cot-tool {"""
new = """.cot-tool {"""
assert s.count(old) == 1, 'cot-tool 前缀锚点不符'
s = s.replace(old, new, 1)

old = """.cot-body .cot-step { animation: cot-step-in 150ms var(--motion-out) both; }
.cot-body .cot-tool { animation: cot-tool-in 150ms var(--motion-out) both; }"""
new = """.cot-step { animation: cot-step-in 150ms var(--motion-out) both; }
.cot-tool { animation: cot-tool-in 150ms var(--motion-out) both; }"""
assert s.count(old) == 1, '动效前缀锚点不符'
s = s.replace(old, new, 1)

old = """  .cot-body .cot-step,
  .cot-body .cot-tool { animation: none; }"""
new = """  .cot-step,
  .cot-tool { animation: none; }"""
assert s.count(old) == 1, 'reduced-motion 前缀锚点不符'
s = s.replace(old, new, 1)

io.open(p, 'w', encoding='utf-8').write(s)
print('styles.css OK（前缀放宽，恢复原版观感）')
print('残留 .cot-body .cot-step:', s.count('.cot-body .cot-step'))