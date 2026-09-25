'use strict';

// 间距尺度守卫。
//
// 现状：styles.css 曾用 24 个不同的间距值（几乎是从 1 到 16 的每个整数 + 若干散值），
// 其中 22.5% 偏离 2px 网格 1px（5/7/9/11/13/15）。迁移后全部对齐到 2px 基尺度。
//
// 为什么需要守卫：1px 级的偏移不会报错，但会累积成节奏散乱；
// 与「内核版本过低」「CSS 变量未定义」属同一类静默退化，必须靠检查兜住。
//
// 尺度（16 以下 2px 步进，16–40 为 4px 步进，40 以上 8px 步进）：
//   2 4 6 8 10 12 14 16 20 24 28 32 40 48 56 64 72
// 另保留 0（贴边）与 1px（发丝线 / 亚像素分隔）作为“非节奏值”。

const assert = require('assert');
const fs = require('fs');

const css = fs.readFileSync('public/styles.css', 'utf8');

const SPACING_PROPS = [
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'margin-block', 'margin-inline', 'margin-block-start', 'margin-block-end',
  'margin-inline-start', 'margin-inline-end',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'padding-block', 'padding-inline', 'padding-block-start', 'padding-block-end',
  'padding-inline-start', 'padding-inline-end',
  'gap', 'row-gap', 'column-gap',
  'scroll-margin', 'scroll-padding',
];
const PROP_ALT = SPACING_PROPS.slice().sort((a, b) => b.length - a.length).join('|');

// 属性前不能是 - 或单词字符，避免命中 --xx-padding: 这类自定义属性
const DECL = new RegExp('(?:^|[^\\w-])(' + PROP_ALT + ')\\s*:\\s*([^;{}]+)', 'gi');
const NUM = /(?:^|[^\w.-])(-?)(\d+(?:\.\d+)?)px/g;

const SCALE = new Set([2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64, 72]);
const NON_RHYTHM = new Set([0, 1]);

// 注释与 calc() 内部不参与判定（注释不是代码；calc 是计算式不是节奏值）
const commentSpans = [];
for (let i = 0; ;) {
  const a = css.indexOf('/*', i);
  if (a < 0) break;
  const b = css.indexOf('*/', a + 2);
  if (b < 0) break;
  commentSpans.push([a, b + 2]);
  i = b + 2;
}
const calcSpans = [];
for (const m of css.matchAll(/calc\(/g)) {
  let depth = 0;
  for (let j = m.index + 4; j < css.length; j += 1) {
    if (css[j] === '(') depth += 1;
    else if (css[j] === ')') {
      depth -= 1;
      if (depth === 0) { calcSpans.push([m.index, j + 1]); break; }
    }
  }
}
const inside = (pos, spans) => spans.some(([a, b]) => a <= pos && pos < b);

const offenders = [];
let checked = 0;

for (const decl of css.matchAll(DECL)) {
  const valueStart = decl.index + decl[0].length - decl[2].length;
  for (const num of decl[2].matchAll(NUM)) {
    const abs = valueStart + num.index + (num[0].length - num[0].trimStart().length);
    if (inside(abs, commentSpans) || inside(abs, calcSpans)) continue;
    checked += 1;
    const v = parseFloat(num[2]);
    if (SCALE.has(v) || NON_RHYTHM.has(v)) continue;
    offenders.push({ line: css.slice(0, abs).split('\n').length, value: v, prop: decl[1].toLowerCase() });
  }
}

console.log(`  styles.css 间距值 ${checked} 个，越界 ${offenders.length} 个`);

assert.strictEqual(
  offenders.length,
  0,
  '以下间距值不在 2px 基尺度上（尺度：2 4 6 8 10 12 14 16 20 24 28 32 40 48 56 64 72；另允许 0 与 1px）：' +
  offenders.slice(0, 20).map(o => `\n    L${o.line}  ${o.prop}: ${o.value}px`).join('') +
  (offenders.length > 20 ? `\n    … 共 ${offenders.length} 处` : '') +
  '\n  说明：1px 级偏移不会报错，但会累积成节奏散乱。请改用尺度上的相邻值。'
);

console.log('spacing scale check passed');