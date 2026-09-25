'use strict';

// 设计尺度守卫：styles.css 的四类尺度都必须落在定义好的刻度上。
//
// 为什么需要：这些偏移都是 1px / 0.5px / 0.01s 级别，**不会报任何错**，
// 但会累积成节奏散乱。与「内核版本过低」「CSS 变量未定义」同属静默退化。
//
// 尺度定义（改这里就该同步改 AGENTS.md 与迁移脚本）：
//   间距   2 4 6 8 10 12 14 16 20 24 28 32 40 48 56 64 72   另允许 0、1px
//   圆角   0 2 4 6 8 10 12 16 20 999                         另允许 % / inherit / var()
//   动效   0 100 150 200 250 300 400 800 1000 1400 60000 ms  统一使用 ms
//   字号   10 11 12 13 14 15 16 18 20 24 28 42 46            另允许 em / var() / calc()

const assert = require('assert');
const fs = require('fs');

const css = fs.readFileSync('public/styles.css', 'utf8');

// ── 注释 / calc() 区间（不参与判定）────────────────────────────────────
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
const MOTION_PROPS = [
  'transition', 'animation', 'transition-duration', 'animation-duration',
  'transition-delay', 'animation-delay',
];

const CATEGORIES = [
  { label: '间距', props: SPACING_PROPS, scale: [2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64, 72], extra: [0, 1], kind: 'px' },
  { label: '圆角', props: ['border-radius'], scale: [0, 2, 4, 6, 8, 10, 12, 16, 20, 999], extra: [], kind: 'px' },
  { label: '动效', props: MOTION_PROPS, scale: [0, 100, 150, 200, 250, 300, 400, 800, 1000, 1400, 60000], extra: [], kind: 'time' },
  { label: '字号', props: ['font-size'], scale: [10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 28, 42, 46], extra: [], kind: 'px' },
];

const PX = /(?<![\w.-])(-?)(\d+(?:\.\d+)?)px/g;
const TIME = /(?<![\w.])(\d*\.?\d+)(ms|s)\b/g;

const offenders = [];
const unitViolations = [];
const stats = [];

for (const cat of CATEGORIES) {
  const propAlt = cat.props.slice().sort((a, b) => b.length - a.length).join('|');
  const declRe = new RegExp('(?:^|[^\\w-])(' + propAlt + ')\\s*:\\s*([^;{}]+)', 'gi');
  const allowed = new Set([...cat.scale, ...cat.extra]);
  let checked = 0;
  let bad = 0;

  for (const decl of css.matchAll(declRe)) {
    const value = decl[2];
    const valueStart = decl.index + decl[0].length - value.length;

    if (cat.kind === 'px') {
      for (const num of value.matchAll(PX)) {
        const abs = valueStart + num.index;
        if (inside(abs, commentSpans) || inside(abs, calcSpans)) continue;
        checked += 1;
        const v = parseFloat(num[2]);
        if (allowed.has(v)) continue;
        bad += 1;
        offenders.push({ cat: cat.label, line: css.slice(0, abs).split('\n').length, text: `${decl[1].toLowerCase()}: ${v}px` });
      }
    } else {
      for (const t of value.matchAll(TIME)) {
        const abs = valueStart + t.index;
        if (inside(abs, commentSpans) || inside(abs, calcSpans)) continue;
        checked += 1;
        if (t[2] !== 'ms') {
          unitViolations.push({ line: css.slice(0, abs).split('\n').length, text: `${decl[1].toLowerCase()}: ${t[0]}` });
        }
        const ms = Math.round(parseFloat(t[1]) * (t[2] === 's' ? 1000 : 1) * 10) / 10;
        if (allowed.has(ms)) continue;
        bad += 1;
        offenders.push({ cat: cat.label, line: css.slice(0, abs).split('\n').length, text: `${decl[1].toLowerCase()}: ${t[0]}` });
      }
    }
  }
  stats.push(`  ${cat.label}: ${checked} 个值，越界 ${bad}`);
}

console.log(stats.join('\n'));

assert.strictEqual(
  unitViolations.length,
  0,
  '动效时长必须统一使用 ms，以下仍在使用 s：' +
  unitViolations.slice(0, 10).map(u => `\n    L${u.line}  ${u.text}`).join('')
);

assert.strictEqual(
  offenders.length,
  0,
  '以下值不在设计尺度上：' +
  offenders.slice(0, 20).map(o => `\n    [${o.cat}] L${o.line}  ${o.text}`).join('') +
  (offenders.length > 20 ? `\n    … 共 ${offenders.length} 处` : '') +
  '\n  尺度定义见本文件头部注释。这些偏移不报错，但会累积成节奏散乱。'
);

console.log('design scales check passed');