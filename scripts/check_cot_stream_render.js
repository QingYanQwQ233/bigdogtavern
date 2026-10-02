#!/usr/bin/env node
/**
 * 流式思维链 / 正文渲染护栏。
 *
 * 起因：一次改动在流式渲染函数里写了 `let body`，与该函数外层同名 const 撞 TDZ，
 * 运行时直接报错、流式思维链整块不渲染，而检查全绿，没一个拦住它。
 *
 * 钉住的约定：
 *  1) 流式渲染函数内不得重复声明 body（同名会撞 TDZ）
 *  2) 不得重建整条链的 innerHTML（会重算滚动锚点、让展开区跳动）
 *  3) 折叠区必须关掉滚动锚定（overflow-anchor: none），否则长展开区会跳
 *  4) 自动跟随必须走 chatStickToBottom：无条件滚到底会把正在翻看上文的用户拽回去
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const runtime = fs.readFileSync(path.join(root, 'frontend/ai-runtime.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');

const errors = [];

const streamFn = runtime.includes('function renderTypingChain(') ? 'renderTypingChain' : 'renderTypingCot';
const start = runtime.indexOf(`function ${streamFn}(`);
if (start < 0) {
  errors.push('找不到流式思维链渲染函数（renderTypingChain / renderTypingCot）');
} else {
  const next = runtime.indexOf('\nfunction ', start + 1);
  const body = runtime.slice(start, next > 0 ? next : undefined);
  const bodyDecls = body.match(/\b(?:let|const|var)\s+body\s*=/g) || [];
  if (bodyDecls.length > 1) {
    errors.push(`${streamFn} 内重复声明了 body（与前面的同名变量撞 TDZ，会导致整块不渲染）`);
  }
  if (/chain\.innerHTML\s*=/.test(body)) {
    errors.push(`${streamFn} 重建了整条链的 innerHTML（会重算滚动锚点、让展开区跳动）`);
  }
  if (!/textContent\s*=/.test(body)) {
    errors.push(`${streamFn} 未使用 textContent 更新思维链文本`);
  }
}

if (!/overflow-anchor:\s*none/.test(styles)) {
  errors.push('styles.css 缺少 overflow-anchor: none（长思维链展开时会跳）');
}

// 自动跟随必须走 chatStickToBottom：无条件滚到底会把正在翻看上文的用户拽回去
const appUi = fs.readFileSync(path.join(root, 'frontend/app-ui.js'), 'utf8');
const isolated = ['chatScrollToBottomNow', 'chatStickToBottom', 'scrollChatToLatest'].reduce((text, name) => {
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