'use strict';
/*
 * 通知统一出口守卫。
 *
 * 背景：通知曾散成三种形态——模态弹窗（showAppAlert）、直接写内联状态槽、
 * 零散 showToast。结果就是“有些提示有灵动岛、有些只挂在页面某个角落”，
 * 同一件事在不同入口表现不一样。现在统一走 notify()：
 *   notify(message, { slot, slotClass, level, silent, duration, action })
 *     · slot    要留痕的内联状态槽 id
 *     · level   'info' | 'success' | 'error'
 *     · silent  只留痕不弹（常态文案）
 * 进行中的提示走 notifyProgress()，结果播报用 notifyResult()（notify 的兼容封装）。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const dir = 'frontend';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
const src = Object.fromEntries(files.map(f => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
const core = src['app-core.js'] || '';

// 1. 唯一出口在位
assert.ok(/function notify\(message, options = \{\}\)/.test(core), 'app-core.js 必须提供 notify(message, options)');
assert.ok(/function notifyProgress\(/.test(core), 'app-core.js 必须提供 notifyProgress()');
assert.ok(/function notifyResult\(/.test(core), 'notifyResult 必须作为 notify 的兼容封装保留');
assert.ok(/slot: 'test-result'/.test(core), 'notifyResult 必须走 notify({ slot: \'test-result\' })');

// 2. 除 app-core.js 外，不得直接调用 showToast（必须走 notify / notifyProgress）
const toastOffenders = [];
for (const f of files) {
  if (f === 'app-core.js') continue;
  src[f].split('\n').forEach((line, i) => {
    if (/(?<![A-Za-z0-9_.])showToast\(/.test(line)) toastOffenders.push(`${f}:${i + 1}`);
  });
}
assert.deepStrictEqual(toastOffenders, [], '这些地方还在直接调 showToast，请改用 notify / notifyProgress：\n' + toastOffenders.join('\n'));

// 3. 通知槽只能经 notify({ slot }) 写入（赋空串清理状态不算）
const SLOTS = [
  'world-opening-status', 'world-open-status', 'world-error', 'world-draft-status',
  'world-player-status', 'world-import-status', 'world-upgrade-status',
  'ui-theme-status', 'ui-transparency-status', 'chat-background-status',
  'g-gen-status', 'pg-params-status', 'test-result', 'ig-test-result',
  'rpg-extension-status',
];
const slotOffenders = [];
for (const f of files) {
  src[f].split('\n').forEach((line, i) => {
    for (const id of SLOTS) {
      // 只报“赋了非空文本”；赋空串属于清理状态，不算通知
      const re = new RegExp(`['"]${id}['"]\\)\\.textContent\\s*=\\s*['"][^'"]`);
      if (re.test(line)) slotOffenders.push(`${f}:${i + 1} ${id}`);
    }
  });
}
assert.deepStrictEqual(slotOffenders, [], '通知槽必须经 notify({ slot }) 写入：\n' + slotOffenders.join('\n'));
console.log('check_notify_unified: ok');
