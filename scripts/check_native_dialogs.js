/*
 * 原生对话框防回退守卫。
 *
 * 原生 alert/confirm/prompt 在 WebView 里样式不可控、出现位置随内核变化，
 * 用户经常「根本没看到通知」。现在统一用应用内浮层；本文件守住这条线，
 * 防止后续改动又把 dialog 埋回去。
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const frontendDir = 'frontend';
const files = fs.readdirSync(frontendDir).filter(name => name.endsWith('.js'));
const sources = Object.fromEntries(files.map(name => [name, fs.readFileSync(path.join(frontendDir, name), 'utf8')]));
const appCore = sources['app-core.js'] || '';
const html = fs.readFileSync('public/index.html', 'utf8');
const css = fs.readFileSync('public/styles.css', 'utf8');

// 1. 应用内对话框组件存在，且提供三种语义
assert.ok(/function openAppDialog\(/.test(appCore), 'app-core.js 必须提供 openAppDialog');
for (const fn of ['showAppAlert', 'showAppConfirm', 'showAppPrompt']) {
  assert.ok(new RegExp(`function ${fn}\\(`).test(appCore), `app-core.js 必须提供 ${fn}`);
}

// 2. 宿主与样式就位
assert.ok(/id="dialog-host"/.test(html), 'index.html 必须包含 #dialog-host');
assert.ok(/\.dialog-card\s*\{/.test(css), 'styles.css 必须提供 .dialog-card 样式');
assert.ok(/\.dialog-btn\s*\{/.test(css), 'styles.css 必须提供 .dialog-btn 样式');

// 3. 除组件自身的兜底外，不得再直接调用原生对话框
const NATIVE = /(?<![A-Za-z0-9_.])(alert|confirm|prompt)\(/;
for (const name of files) {
  const src = sources[name];
  if (name === 'app-core.js') {
    // app-core.js 允许在宿主缺失时兜底；但只允许出现在 openAppDialog 内部
    const idx = src.indexOf('function openAppDialog(');
    const fallbackZone = idx >= 0 ? src.slice(idx, src.indexOf('function showAppAlert(')) : '';
    const stripped = src.replace(fallbackZone, '');
    assert.ok(!NATIVE.test(stripped), 'app-core.js 仅允许在 openAppDialog 兜底路径中使用原生对话框');
    continue;
  }
  assert.ok(!NATIVE.test(src), `${name} 不得使用原生 alert/confirm/prompt，请改用 showAppAlert / showAppConfirm / showAppPrompt`);
}

// 4. 每处 await 调用都必须落在 async 函数内（异步对话框不能出现在同步函数里）
const asyncViolations = [];
for (const name of files) {
  const src = sources[name];
  if (!/await showApp(Alert|Confirm|Prompt)\b/.test(src)) continue;
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/await showApp(Alert|Confirm|Prompt)\b/.test(lines[i])) continue;
    let ok = false;
    for (let j = i; j >= 0; j--) {
      if (/function\s+[A-Za-z0-9_$]+\s*\(/.test(lines[j])) { ok = /async\s+function\s+[A-Za-z0-9_$]+\s*\(/.test(lines[j]); break; }
      if (/>\s*\{?\s*$/.test(lines[j])) { ok = /async\s*\(/.test(lines[j]); break; }
    }
    if (!ok) asyncViolations.push(`${name}:${i + 1}`);
  }
}
assert.deepStrictEqual(asyncViolations, [], `这些 await 调用不在 async 函数内：${asyncViolations.join(', ')}`);

console.log('check_native_dialogs: ok');
