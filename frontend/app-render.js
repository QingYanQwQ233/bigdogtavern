/* ─────────── 掷骰（D&D 风格：d20+5 / 2d6-1 自动掷骰） ─────────── */
const DICE_RE = /(\d*)d(\d+)([+-]\d+)?/gi;
const MAX_DICE_BONUS = 1000;
function rollDiceIn(text) {
  const results = [];
  String(text || '').replace(DICE_RE, (m, cnt, die, mod) => {
    const n = Math.min(parseInt(cnt, 10) || 1, 100);
    const d = parseInt(die, 10) || 1;
    if (!Number.isInteger(n) || n < 1 || !Number.isInteger(d) || d < 1 || d > 1000000) return m;
    const bonus = mod ? parseInt(mod, 10) : 0;
    if (!Number.isInteger(bonus) || Math.abs(bonus) > MAX_DICE_BONUS) return m;
    const rolls = [];
    for (let i = 0; i < n; i++) rolls.push(1 + Math.floor(Math.random() * d));
    const sum = rolls.reduce((a, b) => a + b, 0);
    results.push({ expr: m, rolls, bonus, total: sum + bonus });
    return m;
  });
  return results;
}
function rollWorldDice(text) {
  const expressions = [];
  String(text || '').replace(DICE_RE, match => { if (!expressions.includes(match)) expressions.push(match); return match; });
  if (!expressions.length) return [];
  return rollDiceIn(expressions.join(' '));
}

/* ─────────── Markdown 渲染（marked + DOMPurify 消毒） ───────────
 * 参考 Open WebUI：解析后必须消毒（AI / 用户内容不可信）
 * 返回 { html, md }：md=true 表示已渲染，气泡加 .md 类取消 pre-wrap */
function normalizeTavernHtmlBlocks(content) {
  const source = String(content ?? '');
  const hasLayoutHtml = (value) => /<(?:html|body|main|section|article|header|footer|aside|nav|div|span|table|details|style|h[1-6]|p)\b/i.test(value)
    && /<\/[A-Za-z][\w:-]*\s*>/i.test(value);
  const htmlLine = /^\s*(?:<!--|<\/?[A-Za-z][\w:-]*(?:\s+[^<>]*|\/?\s*>))/i;

  // ST/JS-Slash-Runner 卡片常把正则替换结果标成 ```text```，但内容本身是完整 HTML。
  // 只在检测到完整布局时展开；最终仍交给 DOMPurify，脚本另经授权后进入隔离 iframe。
  let normalized = source.replace(/(^|\n)[ \t]*```(?:html?|xhtml|text|plaintext|markdown)?\s*\r?\n([\s\S]*?)\r?\n[ \t]*```/gi, (full, prefix, body) => (
    hasLayoutHtml(body) ? `${prefix}${body}` : full
  ));

  // Markdown 会把 4 个以上的前导空格当作代码块；卡片常把 HTML 子节点缩进，
  // 因此只在检测到完整 HTML 布局时去掉标签行缩进，保留普通文本与非 HTML 代码块。
  const chunks = normalized.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g);
  normalized = chunks.map((chunk, index) => {
    if (index % 2 || !hasLayoutHtml(chunk)) return chunk;
    return chunk.split(/\r?\n/).map(line => htmlLine.test(line) ? line.replace(/^[ \t]+/, '') : line).join('\n');
  }).join('');
  return normalized;
}

function expandDisplayMacros(content) {
  const userName = String(currentUserPreset()?.name || '玩家').replace(/[\r\n]+/g, ' ');
  return String(content ?? '').replace(/\{\{\s*user\s*\}\}/gi, userName);
}

/* DOMPurify 会移除 style 元素；卡片的声明式 HTML/CSS 需要保留样式，
 * 但不能把 CSS 变成主页面的任意脚本/外链入口。样式规则统一限定在当前消息容器。 */
const TAVERN_RENDER_SCOPE = '[data-tavern-rendered]';
function sanitizeTavernCss(css, scope = true) {
  let safe = String(css || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@(?:import|charset|namespace)[^;{}]*;?/gi, '')
    .replace(/url\s*\([^)]*\)/gi, '')
    .replace(/\b(?:expression|behavior|-moz-binding)\s*\([^)]*\)/gi, '')
    .replace(/(?:javascript|vbscript|data):/gi, '')
    .replace(/<\/?style/gi, '');
  if (!scope) return safe;
  return safe.replace(/(^|[{}])\s*([^{}@][^{]*)\{/g, (full, open, selectors) => {
    const scoped = selectors.split(',').map(selector => selector.trim())
      .filter(Boolean)
      .map(selector => {
        // 卡片常用 body/html/:root 作为整页背景选择器；消息气泡没有这些节点，
        // 将根选择器映射到当前消息容器，不能简单删掉（否则会留下裸 CSS 声明）。
        const rest = selector.replace(/^(?:(?:html\s+)?body|html|:root)\b/i, '').trim();
        if (!rest) return TAVERN_RENDER_SCOPE;
        return `${TAVERN_RENDER_SCOPE}${/^(?::|[>+~])/.test(rest) ? '' : ' '}${rest}`;
      }).join(', ');
    return scoped ? `${open}${scoped}{` : open;
  });
}

function extractTavernStyles(source, scope = true) {
  const styles = [];
  const chunks = String(source || '').split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g);
  const markup = chunks.map((chunk, index) => {
    if (index % 2) return chunk; // 代码块内的示例只能按文本显示
    return chunk.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (full, css) => {
      const safe = sanitizeTavernCss(css, scope);
      if (safe.trim()) styles.push(`<style data-tavern-card-style>${safe}</style>`);
      return '';
    });
  }).join('');
  return { markup, styles: styles.join('') };
}

/* 卡片脚本只在显式授权的完整兼容 iframe 中运行；代码块里的脚本仍是普通文本。 */
function extractTavernScripts(source) {
  const scripts = [];
  const chunks = String(source || '').split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g);
  const markup = chunks.map((chunk, index) => {
    if (index % 2) return chunk;
    return chunk.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (full, attrs, code) => {
      const src = String(attrs || '').match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || '';
      scripts.push({ src: String(src).trim(), code: String(code || '') });
      return '';
    });
  }).join('');
  return { markup, scripts };
}

const TAVERN_CARD_EVENT_ATTRS = ['onclick', 'ondblclick', 'onchange', 'oninput', 'onsubmit', 'onload', 'onerror', 'onkeydown', 'onkeyup', 'onfocus', 'onblur'];


function sanitizeTavernMarkup(source, parser, allowEvents = false) {
  const raw = parser ? parser.parse(source, {
    gfm: true,
    breaks: true,
    headerIds: false,
    mangle: false,
    smartypants: false,
  }) : source;
  const div = document.createElement('div');
  div.innerHTML = window.DOMPurify.sanitize(raw, {
    DATA_URI_TAGS: ['img'],
    ADD_ATTR: ['target', 'rel', ...(allowEvents ? TAVERN_CARD_EVENT_ATTRS : [])],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
  });
  div.querySelectorAll('[style]').forEach(node => {
    const safe = sanitizeTavernCss(node.getAttribute('style'), false).trim();
    if (safe) node.setAttribute('style', safe);
    else node.removeAttribute('style');
  });
  div.querySelectorAll('a').forEach(link => {
    if (/^https?:\/\//i.test(link.getAttribute('href') || '')) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer nofollow';
    }
  });
  return div.innerHTML;
}


function renderBubble(content, options = {}) {
  const source = expandDisplayMacros(content);
  const hasSanitizer = typeof window !== 'undefined' && window.DOMPurify && typeof document !== 'undefined' && typeof document.createElement === 'function';
  if (hasSanitizer) {
    try {
      const parser = window.marked && typeof window.marked.parse === 'function' ? window.marked : null;
      // marked 不可用时仍把卡片生成的 HTML 交给 DOMPurify，避免安全库缺少时只能把标签当纯文本显示。
      // 先解开 HTML 代码块，再提取 style；否则 ```text 内的 CSS 会继续被当作代码显示。
      const normalizedSource = normalizeTavernHtmlBlocks(source);
      const extracted = extractTavernStyles(normalizedSource);
      const renderSource = extractTavernScripts(extracted.markup);
      return { html: extracted.styles + sanitizeTavernMarkup(renderSource.markup, parser), md: !!parser };
    } catch { /* 解析失败则回退纯文本 */ }
  }
  return { html: esc(source), md: false };
}

/* 拆分旁白 / 对白：使用括号范围区分角色发言与叙述引用。
 * “对白” 在括号外进入气泡；（旁白“引用”旁白）整体保留为旁白。 */
function splitNarration(text) {
  const OPEN = { '“': '”' };
  const PAREN_OPEN = { '（': '）', '(': ')' };
  const segs = [];
  let cur = '';
  const stack = []; // 引号栈（期望的闭符）
  let parenDepth = 0;
  let inlineCode = false;
  let fence = '';
  const flush = (type) => {
    if (cur.trim()) segs.push({ type, text: cur });
    cur = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '`' || ch === '~') {
      let run = 1;
      while (text[i + run] === ch) run++;
      if (run >= 3 && !inlineCode) {
        if (!fence) fence = ch.repeat(3);
        else if (fence[0] === ch) fence = '';
        cur += ch.repeat(run);
        i += run - 1;
        continue;
      }
      if (ch === '`' && !fence && run === 1) inlineCode = !inlineCode;
      cur += ch.repeat(run);
      i += run - 1;
      continue;
    }
    // Markdown 代码跨度/围栏内的引号只是代码，不得触发 Tavern 对白拆分。
    if (fence || inlineCode) {
      cur += ch;
      continue;
    }
    if (stack.length) {
      // 引号内：继续累积，匹配到闭符出栈
      cur += ch;
      if (ch === stack[stack.length - 1]) stack.pop();
      if (!stack.length) flush('dialogue');
    } else if (PAREN_OPEN[ch] !== undefined) {
      parenDepth++;
      cur += ch;
    } else if ((ch === '）' || ch === ')') && parenDepth > 0) {
      parenDepth--;
      cur += ch;
    } else if (OPEN[ch] !== undefined && parenDepth === 0) {
      // 引号只在括号外开启对白；括号内的同类引号属于旁白引用
      flush('narration');
      stack.push(OPEN[ch]);
      cur += ch;
    } else {
      cur += ch;
    }
  }
  // 未闭合的引号内容追加到旁白（LLM 输出不成对时保持可读、不产生碎段）
  if (stack.length) {
    if (segs.length && segs[segs.length - 1].type === 'narration') segs[segs.length - 1].text += cur;
    else if (cur.trim()) segs.push({ type: 'narration', text: cur });
  } else if (cur.trim()) {
    // 对白结束后的尾部正文仍属于旁白，不能丢失
    if (segs.length && segs[segs.length - 1].type === 'narration') segs[segs.length - 1].text += cur;
    else segs.push({ type: 'narration', text: cur });
  }
  if (!segs.length) segs.push({ type: 'narration', text });
  return segs;
}
function applyRegexStage(text, stage, { targetMode = mode, depth = null, editing = false, includePromptOnly = true, role = 'assistant' } = {}) {
  const rules = activeOutputRegexRules(targetMode, stage, { depth, editing, includePromptOnly, role });
  return rules.length ? applyOutputRegexRules(text, rules) : String(text ?? '');
}

function renderOutputContent(text, targetMode = mode, { fromRaw = true, role = 'assistant', depth = null } = {}) {
  const source = String(text || '');
  const rules = activeOutputRegexRules(targetMode, fromRaw ? 'chat_display' : 'chat_display_persisted', { role, depth });
  const needsRegex = rules.some(rule => {
    const regex = buildOutputRegex(rule);
    if (!regex) return false;
    regex.lastIndex = 0;
    return regex.test(source);
  });
  return recoverStructuredTagOutput(needsRegex ? applyOutputRegexRules(source, rules) : source);
}

