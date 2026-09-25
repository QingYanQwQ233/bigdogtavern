'use strict';

// CSS 变量定义守卫。
//
// 背景：`var(--x)` 在 `--x` 未定义且没有 fallback 时，整条 CSS 声明会被丢弃，
// 且**不报任何错**。这是与「内核版本过低」同一类的静默失败：
// 本次审计通过它抓到了 `--font-mono`（12 处代码/JSON 编辑面失去等宽字体）
// 和 `--border`（消息窗口控制条边框与 hover 反馈同时失效）。
//
// 本检查断言：styles.css 里以无 fallback 形式引用的变量，必须能从
// ① styles.css 自身的定义，或 ② JS/HTML 的运行时注入，得到值。

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync('public/styles.css', 'utf8');

// ── 1. styles.css 中无 fallback 的引用：var(--x)，名字后紧跟 ")" ──────────
// 带 fallback 的 var(--x, ...) 不会匹配，因为它本来就有兜底值。
const usedNoFallback = new Map();
for (const match of css.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
  usedNoFallback.set(match[1], (usedNoFallback.get(match[1]) || 0) + 1);
}

// ── 2. styles.css 中的定义 ────────────────────────────────────────────
const definedInCss = new Set();
for (const match of css.matchAll(/(?:^|[;{\s])(--[a-z0-9-]+)\s*:/g)) {
  definedInCss.add(match[1]);
}

// ── 3. 运行时注入：setProperty('--x' / 对象里的 '--x' / inline style 的 --x: ──
const RUNTIME_ASSIGN_PATTERNS = [
  /(--[a-z0-9-]+)['"]/g, // setProperty('--x'、{ ok: '--ok-rgb' }
  /(--[a-z0-9-]+)\s*:/g, // style="--meter:50%"
];
const runtimeSet = new Set();
function scanRuntime(file) {
  if (!fs.existsSync(file)) return;
  const source = fs.readFileSync(file, 'utf8');
  for (const pattern of RUNTIME_ASSIGN_PATTERNS) {
    for (const match of source.matchAll(pattern)) runtimeSet.add(match[1]);
  }
}
for (const dir of ['frontend', 'public']) {
  for (const name of fs.readdirSync(dir)) {
    if (/\.(?:js|html)$/.test(name)) scanRuntime(path.join(dir, name));
  }
}

// ── 4. 判定 ───────────────────────────────────────────────────────────
const allowed = new Set([...definedInCss, ...runtimeSet]);
const missing = [...usedNoFallback.entries()]
  .filter(([name]) => !allowed.has(name))
  .sort((a, b) => b[1] - a[1]);

const runtimeOnly = [...usedNoFallback.keys()]
  .filter(name => !definedInCss.has(name) && runtimeSet.has(name))
  .sort();

console.log(`  styles.css 无 fallback 引用 ${usedNoFallback.size} 个变量（CSS 定义 ${definedInCss.size} 个，运行时注入 ${runtimeOnly.length} 个）`);
if (runtimeOnly.length) console.log(`  依赖运行时注入：${runtimeOnly.join(', ')}`);

assert.strictEqual(
  missing.length,
  0,
  '以下 CSS 变量既未在 styles.css 中定义，也没有 JS/HTML 运行时注入，' +
  '但被以无 fallback 的形式引用，会导致整条声明被静默丢弃：' +
  missing.map(([name, count]) => `\n    ${name} ×${count}`).join('') +
  '\n  修法：在 :root 里定义，或改成 var(--x, <兜底值>)，或由 JS 运行时注入。'
);

console.log('css vars check passed');