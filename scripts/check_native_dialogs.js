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


// 5. 通知必须走顶部「灵动岛」toast，而不是模态弹窗（用户反馈：弹窗“不知道在哪里”，且要求进行中也进灵动岛）
assert.ok(/function notifyProgress\(/.test(appCore), 'app-core.js 必须提供 notifyProgress（进行中提示进灵动岛）');
const nrIdx = appCore.indexOf('function notifyResult(');
assert.ok(nrIdx >= 0, 'app-core.js 必须提供 notifyResult');
const nrEnd = appCore.indexOf('\n}', nrIdx);
const nrBody = nrEnd > nrIdx ? appCore.slice(nrIdx, nrEnd) : appCore.slice(nrIdx, nrIdx + 600);
assert.ok(/showToast\(/.test(nrBody), 'notifyResult 必须用 showToast（灵动岛）');
assert.ok(!/showAppAlert\(/.test(nrBody), 'notifyResult 不得用模态弹窗（showAppAlert）');
assert.ok(/notifyProgress\(/.test(sources['app-ui.js'] || ''), 'app-ui.js 的进行中提示必须用 notifyProgress');
assert.ok(/notifyProgress\(/.test(sources['ai-runtime.js'] || ''), 'ai-runtime.js 的进行中提示必须用 notifyProgress');

// 6. 灵动岛动效防回退：内容切换必须原地复用同一条胶囊（新建一条时，旧的淡出 + 新的入场
//    两条会同时占据 flex 列，看起来像抽搐），且宽度过渡与状态脉冲的样式必须在位。
assert.ok(/update = \(text/.test(appCore), 'showToast 必须提供 update（原地替换内容）');
assert.ok(/busy\.update\(/.test(appCore), 'notifyResult 必须复用进行中的胶囊');
assert.ok(/\.toast\.is-updating/.test(css), 'styles.css 必须提供 .toast.is-updating（内容替换脉冲）');
assert.ok(/\.toast \{[^}]*transition:[^}]*width 250ms/.test(css), '.toast 必须允许宽度平滑过渡（FLIP）');

console.log('check_native_dialogs: ok');
