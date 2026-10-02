import io

# ═══════════ 1) app-ui.js：步骤内联渲染 ═══════════
p = 'frontend/app-ui.js'
s = io.open(p, encoding='utf-8').read()

# 渲染辅助：插在 parseCotSteps 之前
anchor = "/* 把思维链按「── 标签 ──」切成步骤块；没有分隔符时返回单步。 */"
assert s.count(anchor) == 1, 'parseCotSteps 锚点不符'
helper = """/* 一步的工具行：名字来自 agentSteps，骰面来自已落库的 agentToolTrace（按 name 匹配）。 */
function cotToolHtml(tool, trace) {
  const hit = (Array.isArray(trace) ? trace : []).find(item => item?.name === tool?.name && item?.result);
  const roll = hit?.result?.rolls?.[0];
  const detail = roll?.expr ? ` · ${roll.expr} = ${roll.total}` : '';
  return `<div class="cot-tool">调用 ${esc(tool?.name || '工具')}${esc(detail)}</div>`;
}
/* 有 agentSteps 就按「步骤 → 工具 → 步骤」的时间顺序摆；
   没有则返回 null，调用方回退到旧的整段 cot 渲染（老存档、老消息照旧能看）。 */
function cotStepsHtml(steps, trace) {
  const list = Array.isArray(steps) ? steps.filter(step => step && (step.label || step.cot || step.tools?.length)) : [];
  if (!list.length) return null;
  return list.map(step => {
    const head = step.label ? `<div class="cot-step-head">${esc(step.label)}</div>` : '';
    const body = step.cot ? `<div class="cot-step-body">${esc(step.cot)}</div>` : '';
    const tools = (Array.isArray(step.tools) ? step.tools : []).map(tool => cotToolHtml(tool, trace)).join('');
    return `<div class="cot-step">${head}${body}${tools}</div>`;
  }).join('');
}
"""
s = s.replace(anchor, helper + anchor, 1)

old = """      if (m.cot) {
        const cotEl = document.createElement('div');
        cotEl.className = 'msg cot-msg';
        cotEl.innerHTML = `<div class="bubble"><details class="cot rpg-prose"><summary>思维链</summary><div class="cot-body">${cotBodyHtml(m.cot)}</div></details></div>`;
        chat.appendChild(cotEl);
      }"""
new = """      if (m.cot || m.agentSteps?.length) {
        // 优先按步骤内联；拿不到步骤数据就回退整段思维链
        const stepsHtml = cotStepsHtml(m.agentSteps, m.agentToolTrace);
        const inner = stepsHtml || cotBodyHtml(m.cot);
        const cotEl = document.createElement('div');
        cotEl.className = 'msg cot-msg';
        cotEl.innerHTML = `<div class="bubble"><details class="cot rpg-prose"><summary>思维链</summary><div class="cot-body">${inner}</div></details></div>`;
        chat.appendChild(cotEl);
      }"""
assert s.count(old) == 1, '思维链渲染锚点不符'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('app-ui.js OK')

# ═══════════ 2) styles.css：步骤块样式（刻度内） ═══════════
p = 'public/styles.css'
s = io.open(p, encoding='utf-8').read()
assert '.cot-step-head' not in s, 'CSS 已改过'
extra = """
/* 思维链「按步骤」内联：每步一块，工具调用跟在它所属的步骤下面。
   字号/间距都取设计刻度，颜色只用 muted，别让旁注抢正文。 */
.cot-body .cot-step + .cot-step { margin-top: 8px; }
.cot-body .cot-step-head { color: var(--text); font-weight: 600; }
.cot-body .cot-step-body { white-space: pre-wrap; }
.cot-body .cot-tool {
  margin-top: 4px;
  padding-left: 8px;
  border-left: 2px solid var(--line);
  color: var(--muted);
  font-size: 12px;
}
"""
s = s.rstrip() + '\n' + extra
io.open(p, 'w', encoding='utf-8').write(s)
print('styles.css OK')