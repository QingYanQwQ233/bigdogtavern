#!/usr/bin/env node
/**
 * 思维链流式渲染护栏。
 *
 * 起因：一次改动在 renderTypingCot 里写了 `let body`，而该函数外层已有同名 const，
 * 触发 TDZ（Cannot access 'body' before initialization）—— 运行时直接报错、
 * 流式思维链整块不渲染，但 112 项检查全绿，没一个拦住它。
 *
 * 这里只钉住三条最容易再犯的约定：
 *  1) renderTypingCot 内不得出现与外层同名的 `let/const body`
 *  2) 流式文本必须走 textContent（不得重建 .cot-step-body 的 innerHTML）
 *  3) 折叠区必须关掉滚动锚定（overflow-anchor: none），否则长展开区会跳
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const runtime = fs.readFileSync(path.join(root, 'frontend/ai-runtime.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');

const errors = [];

const start = runtime.indexOf('function renderTypingCot(');
if (start < 0) {
  errors.push('找不到 renderTypingCot');
} else {
  // 粗略取到下一个顶层 function 之前
  const next = runtime.indexOf('\nfunction ', start + 1);
  const body = runtime.slice(start, next > 0 ? next : undefined);
  // 只禁「同一个函数里 body 被声明两次」：外层那个容器变量是必需的，
  // 真正出过事的是在它之后再声明一次同名变量。
  const bodyDecls = body.match(/\b(?:let|const|var)\s+body\s*=/g) || [];
  if (bodyDecls.length > 1) {
    errors.push('renderTypingCot 内重复声明了 body（与前面的同名变量撞 TDZ，会导致整块不渲染）');
  }
  if (/main\.innerHTML\s*=/.test(body)) {
    errors.push('renderTypingCot 重建了整块 innerHTML（会重算滚动锚点、让展开区跳动）');
  }
  if (!/textContent\s*=/.test(body)) {
    errors.push('renderTypingCot 未使用 textContent 更新流式文本');
  }
}

if (!/overflow-anchor:\s*none/.test(styles)) {
  errors.push('styles.css 缺少 overflow-anchor: none（长思维链展开时会跳）');
}

// 4) 自动跟随必须走 chatStickToBottom：无条件滚到底会把正在翻看上文的用户拽回去
const appUi = fs.readFileSync(path.join(root, 'frontend/app-ui.js'), 'utf8');
// 只检查「这两个封装函数之外」的赋值：它们内部的那句是合法兜底
const isolated = ['chatStickToBottom', 'scrollChatToLatest'].reduce((text, name) => {
  const at = text.indexOf(`function ${name}(`);
  if (at < 0) return text;
  const end = text.indexOf('\nfunction ', at + 1);
  return text.slice(0, at) + text.slice(end > 0 ? end : undefined);
}, appUi);
const unconditional = isolated.match(/chat\.scrollTop\s*=\s*chat\.scrollHeight/g) || [];
if (unconditional.length) {
  errors.push(`app-ui.js 有 ${unconditional.length} 处无条件把聊天滚到底（应用 chatStickToBottom / scrollChatToLatest）`);
}
if (!/function chatStickToBottom/.test(appUi)) {
  errors.push('app-ui.js 缺少 chatStickToBottom（自动跟随必须在用户贴底时才进行）');
}

if (errors.length) {
  console.error('[FAIL] check_cot_stream_render');
  errors.forEach(error => console.error('  - ' + error));
  process.exit(1);
}
console.log('[OK] check_cot_stream_render');
