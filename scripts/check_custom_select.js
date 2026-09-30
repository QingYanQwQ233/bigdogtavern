/*
 * 自定义下拉守卫。
 *
 * 背景：部分 Android WebView 在 <dialog> / modal 内无法弹出原生 <select> 选择器，
 * 用户点下去毫无反应。应用内改为统一的自定义下拉（保留原生 select 的值与事件）。
 * 本文件守住：组件在位、已接入启动流程、且不在模块顶层访问 DOM 构造器
 * （app.js 会被 node vm 沙箱加载，没有 DOM，顶层访问会让一批检查直接崩）。
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const appCore = fs.readFileSync('frontend/app-core.js', 'utf8');
const appUi = fs.readFileSync('frontend/app-ui.js', 'utf8');
const bundle = fs.readFileSync('public/app.js', 'utf8');
const css = fs.readFileSync('public/styles.css', 'utf8');

// 1. 组件在位
for (const fn of ['enhanceCustomSelect', 'enhanceCustomSelectsIn', 'autoEnhanceCustomSelects', 'syncCustomSelect']) {
  assert.ok(new RegExp(`function ${fn}\\(`).test(appCore), `app-core.js 必须提供 ${fn}`);
}
assert.ok(bundle.includes('custom-select-picker'), 'bundle 必须包含自定义下拉');

// 2. 已接入启动流程
assert.ok(/autoEnhanceCustomSelects\(\);/.test(appUi), 'init 必须调用 autoEnhanceCustomSelects()');

// 3. 顶层不得访问 DOM 构造器（node vm 沙箱无 DOM）
const topLevelDom = appCore.split('\n').filter(line => /^(const|let|var)\b/.test(line) && /\b(HTML|SVG|Element|Document|Window)[A-Za-z]*\b\.(prototype|prototype\.)/.test(line));
assert.deepStrictEqual(topLevelDom, [], `模块顶层不得访问 DOM 构造器（会在 vm 沙箱报错）：\n${topLevelDom.join('\n')}`);
assert.ok(/typeof HTMLSelectElement === 'function'/.test(appCore), 'HTMLSelectElement 必须惰性且带存在性检查');

// 4. 样式在位
for (const cls of ['.custom-select-picker', '.custom-select-trigger', '.custom-select-menu']) {
  assert.ok(css.includes(cls + ' ') || css.includes(cls + ' {'), `styles.css 缺 ${cls}`);
}

// 5. 不得退回逐处手写的旧实现
assert.ok(!/enhanceWorldPresetSelect/.test(bundle), '应统一使用 enhanceCustomSelect，不再保留单点实现');

// 6. 候选输入框不得回到原生 datalist（会盖住输入框，且各平台行为不一致）
const html = fs.readFileSync('public/index.html', 'utf8');
assert.ok(!/<input[^>]+list=/.test(html), '不得使用原生 datalist：请用 enhanceComboInput');
assert.ok(/function enhanceComboInput\(/.test(appCore), 'app-core.js 必须提供 enhanceComboInput');
assert.ok(/enhanceComboInput\(modelInput, \{ source: 'model-list' \}\)/.test(appUi), '模型输入必须初始化为应用内候选菜单');


// 7. 可输入候选框：展开按钮必须内嵌且不带分隔线（否则看起来像并列的第二个控件）
const toggleMatch = css.match(/\.combo-toggle\s*\{[^}]*\}/);
assert.ok(toggleMatch, 'styles.css 必须提供 .combo-toggle');
assert.ok(!/border-left\s*:/.test(toggleMatch[0]), '.combo-toggle 不得带 border-left 分隔线');
assert.ok(/\.combo-input > input\s*\{[^}]*padding-right/.test(css), '.combo-input > input 必须为内嵌按钮留出右内边距');

console.log('check_custom_select: ok');
