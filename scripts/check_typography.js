'use strict';

/* 排版设置检查：
 * 1. applyTypography 默认值写入 --chat-* 变量
 * 2. prefs.typography 覆盖（含段首两格缩进、字体栈映射）
 * 3. 非法值回退默认（font 未知 / fontSize 非数字 / indent 未知）
 * 4. typographyFromPrefs 与默认值合并（部分字段保存）
 * 5. styles.css / index.html 的变量布线存在（防误删）
 * 用法：node scripts/check_typography.js
 */

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const captured = {};
const context = vm.createContext({
  console, Date, Math, JSON, Set, Map,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  window: {},
  document: {
    documentElement: { style: { setProperty(k, v) { captured[k] = v; } } },
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener: () => {},
    body: { dataset: {} },
  },
});

const source = fs.readFileSync('public/app.js', 'utf8').replace(/\ninit\(\);\s*$/, '');
vm.runInContext(source, context);

// 1) 默认排版 → 变量默认值
vm.runInContext('applyTypography()', context);
assert.strictEqual(captured['--chat-font'], 'var(--font-body)', '默认字体应跟随界面');
assert.strictEqual(captured['--chat-font-size'], '15px');
assert.strictEqual(captured['--chat-line-height'], '1.8');
assert.strictEqual(captured['--chat-para-gap'], '0.7em');
assert.strictEqual(captured['--chat-indent'], '0em', '默认无缩进');
assert.strictEqual(captured['--chat-side-pad'], '24px');

// 2) prefs 覆盖：楷体 + 两格缩进 + 自定义间距
vm.runInContext(`
  prefs.typography = { font: 'kai', fontSize: 18, lineHeight: 2.2, paraGap: 1.4, indent: '2em', sidePad: 48 };
  applyTypography();
`, context);
assert.ok(captured['--chat-font'].includes('KaiTi'), '楷体栈应包含 KaiTi');
assert.strictEqual(captured['--chat-font-size'], '18px');
assert.strictEqual(captured['--chat-line-height'], '2.2');
assert.strictEqual(captured['--chat-para-gap'], '1.4em');
assert.strictEqual(captured['--chat-indent'], '2em', '段首空两格');
assert.strictEqual(captured['--chat-side-pad'], '48px');

// 3) 非法 / 未知值回退
vm.runInContext(`
  prefs.typography = { font: 'nope', fontSize: 'abc', lineHeight: 'x', paraGap: 'y', indent: 'weird', sidePad: null };
  applyTypography();
`, context);
assert.strictEqual(captured['--chat-font'], 'var(--font-body)', '未知字体回退默认');
assert.strictEqual(captured['--chat-font-size'], '15px');
assert.strictEqual(captured['--chat-line-height'], '1.8');
assert.strictEqual(captured['--chat-para-gap'], '0.7em');
assert.strictEqual(captured['--chat-indent'], '0em');
assert.strictEqual(captured['--chat-side-pad'], '24px');

// 4) 部分保存的字段与默认值合并
const merged = vm.runInContext(`
  prefs.typography = { indent: '1em' };
  typographyFromPrefs();
`, context);
assert.strictEqual(merged.fontSize, 15, '未保存字段用默认值');
assert.strictEqual(merged.indent, '1em', '已保存字段生效');
assert.strictEqual(merged.font, 'default');

// 5) CSS / HTML 布线存在
const css = fs.readFileSync('public/styles.css', 'utf8');
assert.ok(css.includes('--chat-font-size: 15px'), ':root 应声明默认字号');
assert.ok(css.includes('font-size: var(--chat-font-size)'), '气泡正文应使用变量字号');
assert.ok(css.includes('text-indent: var(--chat-indent)'), '段落应使用变量缩进');
assert.ok(css.includes('var(--chat-side-pad)'), '聊天列应使用变量边距');
// 关键覆盖层必须同样走变量：narration 基础规则硬编码 13px/1.7，tavern-prose 与 rpg-prose 必须以变量覆盖它，
// 否则字号/行距设置对默认渲染路径（narration + tavern-prose）不生效
const varFontSizeCount = (css.match(/font-size: var\(--chat-font-size\)/g) || []).length;
assert.ok(varFontSizeCount >= 3, '变量字号应同时覆盖 .msg .bubble / .msg.tavern-prose .bubble / .rpg-prose，实际 ' + varFontSizeCount + ' 处');
const varLineHeightCount = (css.match(/line-height: var\(--chat-line-height\)/g) || []).length;
assert.ok(varLineHeightCount >= 3, '变量行距应同时覆盖三层正文，实际 ' + varLineHeightCount + ' 处');
assert.ok(css.includes('padding: 22px var(--chat-side-pad)'), '聊天列左右留白应 1:1 使用设置值');
assert.ok(!css.includes('968px'), '不应残留居中列与滑块的耦合常量（保证线性）');
assert.match(css, /\.msg-actions\s*\{[^}]*position:\s*static;[^}]*flex:\s*0 0 100%;[^}]*width:\s*100%;/s, '消息操作按钮应独占文末一行，不能覆盖正文或被窄屏推出');
const html = fs.readFileSync('public/index.html', 'utf8');
assert.ok(html.includes('id="st-panel-typo"'), '设置应有排版面板');
assert.ok(html.includes('value="2em"'), '缩进选项应包含空两格');
assert.ok(html.includes('id="t-side-pad"'), '应有左右间距控件');

console.log('✓ 排版设置通过（默认值 / prefs 覆盖 / 非法回退 / 部分合并 / CSS·HTML 布线）');
