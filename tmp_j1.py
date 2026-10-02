import io

p = 'public/styles.css'
s = io.open(p, encoding='utf-8').read()

old = """/* 步骤链（流式与正式消息同构）：每段 = 思维链 + 正文 + 工具行。
   思维链和工具行是「元信息」，必须和正文在视觉上分层，不能糊成一片。 */
.typing-chain { display: flex; flex-direction: column; }
.rpg-step-chain { display: flex; flex-direction: column; }
.rpg-step-chain + .rpg-step-chain { margin-top: 14px; }
.rpg-step-chain .step-body { margin-top: 4px; }
/* 思维链：独立的小卡片，左对齐一条竖线，缩进与正文区分开 */
.rpg-step-chain .cot-step {
  align-self: flex-start;
  max-width: 100%;
  margin-bottom: 4px;
  padding: 4px 8px;
  border: 1px solid var(--line);
  border-left: 2px solid var(--line);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  font-size: 12px;
}
.rpg-step-chain .cot-step-head {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.rpg-step-chain .cot-step[open] > .cot-step-head { color: var(--text); }
.rpg-step-chain .cot-step-main { padding: 4px 0 0 0; }
.rpg-step-chain .cot-step-body {
  font-size: 12px;
  line-height: 1.5;
  color: var(--muted);
}
/* 工具结果：等宽 + 竖线，明确是「调用记录」而不是叙事 */
.rpg-step-chain .cot-inline-tools {
  align-self: flex-start;
  max-width: 100%;
  margin: 2px 0 0;
  padding: 4px 8px;
  border-left: 2px solid var(--line);
  border-radius: 0 6px 6px 0;
  background: rgba(255, 255, 255, 0.02);
}
.rpg-step-chain .cot-tool {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--muted);
}
/* 还没产出思维链的步骤：不显示空卡片 */
.rpg-step-chain .cot-step.is-empty { display: none; }
.rpg-step-chain .cot-step.is-current > .cot-step-head { color: var(--accent); }"""
new = """/* 步骤链（流式与正式消息同构）：每段 = 思维链 + 正文 + 工具行。
   外观沿用原版思维链（左竖线 + 弱色小字），不要卡片化。 */
.typing-chain { display: flex; flex-direction: column; }
.rpg-step-chain { display: flex; flex-direction: column; }
.rpg-step-chain + .rpg-step-chain { margin-top: 10px; }
.rpg-step-chain .step-body { margin-top: 2px; }
.rpg-step-chain .cot-step { display: block; }
.rpg-step-chain .cot-step.is-current > .cot-step-head { color: var(--accent); }"""
assert s.count(old) == 1, '卡片样式锚点不符'
s = s.replace(old, new, 1)

# 聊天容器也关掉滚动锚定：流式增长时浏览器会自行调整滚动位置，看着就是「乱跳」
old = """/* 流式更新时不要让浏览器自动调整滚动位置（会导致展开的思维链看起来在跳） */
.cot-body, .cot-body .cot-step-main { overflow-anchor: none; }"""
new = """/* 流式更新时不要让浏览器自动调整滚动位置（会导致展开的思维链看起来在跳） */
.cot-body, .cot-body .cot-step-main { overflow-anchor: none; }
/* 列表本身同理：内容每帧变长时不要自动挪动用户的滚动位置 */
#chat { overflow-anchor: none; }"""
assert s.count(old) == 1, '#chat 锚点不符'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('styles.css OK（还原原版外观 + 关滚动锚定）')