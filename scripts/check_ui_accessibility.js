'use strict';

// §7 无障碍约束的静态守卫（对应 docs/ui-beauty-declaration.md §7）。
//
// §7 有 8 条，其中能在源码层证明的在这里断言；只能在运行时测量的
// 由 scripts/audit_ui_accessibility.js 覆盖（见该文件头部说明）；
// 两条无法机器化的在 §7 文档里标为 UNENFORCED 并写明原因。
//
// 每条断言都注明它守的是 §7 的哪一条。

const assert = require('assert');
const fs = require('fs');

const css = fs.readFileSync('public/styles.css', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const cardFrame = fs.readFileSync('frontend/app-render.js', 'utf8');
const extension = fs.readFileSync('frontend/rpg-world.js', 'utf8');

// 去注释副本：判定只看真实声明，不看注释里的示例
const cssNC = css.replace(/\/\*[\s\S]*?\*\//g, '');

const rules = [];
for (const m of cssNC.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  rules.push({
    selector: m[1].trim().replace(/\s+/g, ' '),
    body: m[2],
    line: cssNC.slice(0, m.index).split('\n').length,
  });
}

// 把选择器归一为「去掉全部伪类/伪元素段」的紧凑串，用于配对 base 与 :focus
function baseKey(selector) {
  return selector
    .replace(/::?[a-z-]+(\([^()]*(?:\([^()]*\)[^()]*)*\))?/gi, '')
    .replace(/\s+/g, '');
}

// ── §7-4：必须保留 :focus-visible 焦点环 ────────────────────────────────
const globalFocusRing = rules.find(r => /(?:^|,|\s):focus-visible$/.test(r.selector.trim()) && /outline\s*:/.test(r.body));
assert.ok(globalFocusRing, '§7-4：缺少全局 :focus-visible 焦点环规则（应带 outline）');

const focusVisibleCount = rules.filter(r => /:focus-visible/.test(r.selector)).length;
assert.ok(focusVisibleCount >= 4, `§7-4：:focus-visible 规则过少（${focusVisibleCount} 条），焦点环可能被大面积移除`);

// 每一处 outline: none 都必须有配对的焦点指示（同 base 选择器上的 :focus / :focus-visible）
const focusProtected = new Set();
for (const r of rules) {
  if (!/:focus(?:-visible)?\b/.test(r.selector)) continue;
  if (!/(?:box-shadow|outline)\s*:/.test(r.body)) continue;
  for (const sel of r.selector.split(',')) focusProtected.add(baseKey(sel));
}

const outlineKilled = rules.filter(r => /(?:^|[;\s])outline\s*:\s*(?:none|0)\s*(?:;|$)/i.test(r.body));
const unpaired = [];
for (const r of outlineKilled) {
  const paired = r.selector.split(',').some(sel => focusProtected.has(baseKey(sel)));
  if (!paired) unpaired.push(`L${r.line}  ${r.selector.slice(0, 80)}`);
}
assert.strictEqual(
  unpaired.length,
  0,
  '§7-4：以下规则移除了 outline 却没有配对的焦点指示（:focus / :focus-visible 上的 box-shadow 或 outline）。' +
  '表单控件可以不用 outline，但必须换成 box-shadow 等可见指示，否则键盘用户看不到焦点位置：' +
  unpaired.map(u => `\n    ${u}`).join('')
);

// ── §7-5：尊重 prefers-reduced-motion ──────────────────────────────────
const reduceBlocks = (cssNC.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)/g) || []).length;
assert.ok(reduceBlocks >= 3, `§7-5：prefers-reduced-motion: reduce 块过少（${reduceBlocks} 个）`);
assert.ok(
  /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]{0,400}?(?:animation|transition)\s*:\s*none/.test(cssNC)
  || (cssNC.match(/transition\s*:\s*none|animation\s*:\s*none/g) || []).length >= 2,
  '§7-5：reduced-motion 块里必须真正把 transition/animation 关掉（transition: none / animation: none）'
);

// ── §7-2：输入框字号 ≥16px（移动端不触发自动缩放）─────────────────────
// 移动端媒体查询块（取所有 max-width 块的内容拼起来）
const mobileCss = [];
for (const m of cssNC.matchAll(/@media\s*\(max-width:\s*(\d+)px\)\s*\{/g)) {
  let depth = 0;
  for (let j = m.index + m[0].length - 1; j < cssNC.length; j += 1) {
    if (cssNC[j] === '{') depth += 1;
    else if (cssNC[j] === '}') {
      depth -= 1;
      if (depth === 0) { mobileCss.push(cssNC.slice(m.index + m[0].length, j)); break; }
    }
  }
}
const mobileText = mobileCss.join('\n');
const mobile16 = (mobileText.match(/font-size\s*:\s*16px/g) || []).length;
assert.ok(mobile16 >= 3, `§7-2：移动端媒体查询里的 16px 输入字号覆盖过少（${mobile16} 处）`);
assert.match(mobileText, /textarea#input\s*\{[^}]*font-size\s*:\s*16px/, '§7-2：移动端聊天输入框必须显式 16px');

// ── §7-1：命中区 —— 静态部分只守已知的固定控件 ──────────────────────────
// 完整覆盖（所有可交互元素）由运行时审计测量；这里守的是「不能被改小」的关键项。
assert.match(mobileText, /textarea#input\s*\{[^}]*min-height\s*:\s*44px/, '§7-1：移动端聊天输入框命中区必须 ≥44px');
assert.match(cssNC, /#btn-nav-drawer\s*\{[^}]*min-width\s*:\s*44px;[^}]*min-height\s*:\s*44px;/, '§7-1：移动菜单触发按钮命中区必须 ≥44px');

// ── §7-3：弹窗/抽屉可键盘关闭（静态部分）────────────────────────────
// 这条断言在本次落地时抓到了真实缺陷：#settings-modal 与两个地图弹窗都不在
// Escape 分支链里，键盘用户无法关闭它们。
const escapeAt = app.indexOf("e.key !== 'Escape'");
assert.ok(escapeAt >= 0, '§7-3：找不到 Escape 键处理，弹窗/抽屉将无法用键盘关闭');
const escapeChain = app.slice(escapeAt, escapeAt + 1800);
const modalIds = [...html.matchAll(/<div id="([a-z0-9-]+)"\s+class="[^"]*modal/g)].map(m => m[1]);
assert.ok(modalIds.length >= 3, `§7-3：弹窗识别失败（只找到 ${modalIds.length} 个），检查提取正则是否需要更新`);
const notHandled = modalIds.filter(id => !escapeChain.includes(`'${id}'`));
assert.strictEqual(
  notHandled.length,
  0,
  '§7-3：以下弹窗不在 Escape 分支链里，键盘用户无法关闭它们：' +
  notHandled.map(id => `\n    #${id}`).join('') +
  '\n请在 Escape 处理器开头为每个弹窗加分支，并调用它自己的 close 函数（以归还焦点）。'
);

// 每个弹窗的 close 路径都必须归还焦点（否则键盘焦点会掉回 body）
for (const fn of ['closeSettings', 'closeMapModal', 'closeMapJsonModal']) {
  const body = app.slice(app.indexOf(`function ${fn}(`), app.indexOf(`function ${fn}(`) + 620);
  assert.ok(/\.focus\(\)/.test(body), `§7-3：${fn}() 没有把焦点还给触发元素`);
}

// ── §7-7：卡内消息区只能有一个滚动容器 ─────────────────────────────────
function overflowAutoSelectors(source) {
  const out = [];
  const nc = source.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of nc.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/overflow(?:-y)?\s*:\s*(?:auto|scroll)/.test(m[2])) out.push(m[1].trim().replace(/\s+/g, ' '));
  }
  return out;
}
const extScrollers = overflowAutoSelectors(extension);
const messageScroller = extScrollers.filter(s => /data-tavern-messages/.test(s));
assert.strictEqual(messageScroller.length, 1, '§7-7：扩展 iframe 里消息区必须有且只有一个滚动容器（[data-tavern-messages]）');
const rivalScrollers = extScrollers.filter(s => /tavern-message|data-tavern-narrative|data-tavern-options/.test(s) && !/data-tavern-messages/.test(s));
assert.strictEqual(
  rivalScrollers.length,
  0,
  '§7-7：消息区之外的叙事/选项容器不得再开滚动容器，否则会出现两条独立滚动：' +
  rivalScrollers.map(s => `\n    ${s}`).join('')
);


console.log(`  焦点环规则 ${focusVisibleCount} 条；outline:none 配对 ${outlineKilled.length - unpaired.length}/${outlineKilled.length}`);
console.log(`  reduced-motion 块 ${reduceBlocks} 个；移动端 16px 覆盖 ${mobile16} 处；扩展消息区滚动容器 ${messageScroller.length} 个`);
console.log('ui accessibility check passed');