import io

p = 'frontend/app-ui.js'
s = io.open(p, encoding='utf-8').read()

# ── 1) 新增：把工具卡插进叙事中途的标记工具 ──
anchor = """function cotStepsHtml(steps, trace) {"""
helper = """/* 叙事中途的工具卡：把每步的叙事片段按顺序串起来，在有工具结果的步骤后放一个占位标记，
   渲染完再把标记换成工具卡。这样骰子这类结果就出现在它真正发生的位置，
   而不是全挤在正文末尾。
   关键：只有当「片段拼接 == 原正文」时才启用（去掉空白后比较）。
   对不上就返回 null，调用方走原路径 —— 宁可不出卡，也不能把正文改坏。 */
function rpgNarrativeWithToolMarks(content, steps) {
  const list = (Array.isArray(steps) ? steps : []).filter(step => step && (step.narrative || step.tools?.length));
  if (list.length < 2) return null;
  const pieces = list.map(step => String(step.narrative || '').trim()).filter(Boolean);
  if (!pieces.length) return null;
  const squeeze = text => String(text || '').replace(/\\s+/g, '');
  const joined = pieces.join('');
  const source = squeeze(content);
  if (!source || joined !== source) return null;
  let text = '';
  list.forEach((step, index) => {
    const piece = String(step.narrative || '').trim();
    if (piece) text = text ? `${text}\\n\\n${piece}` : piece;
    if ((step.tools || []).length) text += `\\n\\n%%COTTOOL${index}%%\\n\\n`;
  });
  return text;
}
/* 渲染后把标记换成工具卡（标记可能被包进 <p>，所以带标签一起清） */
function injectCotInlineCards(html, steps, trace) {
  const list = Array.isArray(steps) ? steps : [];
  return String(html || '').replace(/<p>\\s*%%COTTOOL(\\d+)%%\\s*<\\/p>|%%COTTOOL(\\d+)%%/g, (whole, a, b) => {
    const index = Number(a ?? b);
    const step = list[index];
    const tools = Array.isArray(step?.tools) ? step.tools : [];
    if (!tools.length) return '';
    return `<div class="cot-inline-tools">${tools.map(tool => cotToolHtml(tool, trace)).join('')}</div>`;
  });
}
function cotStepsHtml(steps, trace) {"""
assert s.count(anchor) == 1, 'cotStepsHtml 锚点不符'
s = s.replace(anchor, helper, 1)

# ── 2) 渲染点接入 ──
old = """          const { html, md } = renderRpgNarrativeWithCheckpoints(m.rawContent ?? m.content, m.checkpoints, { fromRaw: typeof m.rawContent === 'string' });"""
new = """          const narrativeSource = m.rawContent ?? m.content;
          const marked = rpgNarrativeWithToolMarks(narrativeSource, m.agentSteps);
          const rendered = renderRpgNarrativeWithCheckpoints(marked || narrativeSource, m.checkpoints, { fromRaw: typeof m.rawContent === 'string' });
          const html = marked ? injectCotInlineCards(rendered.html, m.agentSteps, m.agentToolTrace) : rendered.html;
          const md = rendered.md;"""
assert s.count(old) == 1, 'RPG 正文渲染点锚点不符'
s = s.replace(old, new, 1)

io.open(p, 'w', encoding='utf-8').write(s)
print('app-ui.js OK')

# ── 3) 样式 ──
p = 'public/styles.css'
s = io.open(p, encoding='utf-8').read()
old = """.cot-body .cot-tool {"""
new = """/* 正文里内联的工具卡：左右缩一点，和叙事段落区分开，但不打断阅读 */
.rpg-prose .cot-inline-tools { margin: 8px 0; display: flex; flex-direction: column; gap: 4px; }
.rpg-prose .cot-inline-tools .cot-tool { margin: 0; }
.cot-body .cot-tool {"""
assert s.count(old) == 1, 'cot-tool 锚点不符'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('styles.css OK')