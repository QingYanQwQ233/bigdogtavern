'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('public/app.js', 'utf8');
const start = source.indexOf('function splitNarration(text)');
const end = source.indexOf('/* ─────────── 会话管理', start);
assert.ok(start >= 0 && end > start, 'splitNarration boundaries not found');

const sandbox = {};
vm.runInNewContext(`${source.slice(start, end)}; result = splitNarration;`, sandbox);
const split = sandbox.result;

const cases = [
  ['“你好”', ['dialogue']],
  ['正文“你好”正文', ['narration', 'dialogue', 'narration']],
  ['（旁白“其他内容”旁白）', ['narration']],
  ['(旁白“其他内容”旁白)', ['narration']],
  ['正文“其他内容”正文', ['narration', 'dialogue', 'narration']],
  ['"key": "value"', ['narration']],
  ['```js\nconsole.log("“不是对白”")\n```\n“对白”', ['narration', 'dialogue']],
  ['行内代码 `“不是对白”` 之后“对白”', ['narration', 'dialogue']],
  ['~~~txt\n“不是对白”\n~~~\n“对白”', ['narration', 'dialogue']],
];

for (const [input, expected] of cases) {
  assert.strictEqual(JSON.stringify(split(input).map(({ type }) => type)), JSON.stringify(expected), input);
}

console.log('tavern narration check passed');
