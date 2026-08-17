'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('public/app.js', 'utf8');
const start = source.indexOf('function normalizeTavernHtmlBlocks(content)');
const end = source.indexOf('/* ─────────── 会话管理', start);
assert.ok(start >= 0 && end > start, 'Tavern renderer boundaries not found');

const sandbox = { currentUserPreset: () => ({ name: '测试用户名' }) };
vm.runInNewContext(`${source.slice(start, end)}; result = { split: splitNarration, normalize: normalizeTavernHtmlBlocks, expand: expandDisplayMacros };`, sandbox);
const { split, normalize, expand } = sandbox.result;

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

assert.strictEqual(expand('你好，{{user}}。'), '你好，测试用户名。');
assert.strictEqual(expand('{{ USER }} 的名字'), '测试用户名 的名字');

const indentedHtml = [
  '<!-- 顶部属性栏 -->',
  '    <div style="color:red">',
  '        <span>在线</span>',
  '    </div>',
  '',
  '    <div>正文</div>',
].join('\n');
const normalized = normalize(indentedHtml);
assert.ok(normalized.includes('<div style="color:red">'), 'indented HTML opening tag should be unindented');
assert.ok(!/^ {4}<div/m.test(normalized), 'HTML tags must not become Markdown code blocks');

const fencedHtml = '```html\n    <section><strong>卡片</strong></section>\n```';
assert.strictEqual(normalize(fencedHtml), '<section><strong>卡片</strong></section>');

const fencedJs = '```js\n    <div>保留代码块</div>\n```';
assert.strictEqual(normalize(fencedJs), fencedJs, 'non-HTML code fences must remain untouched');

console.log('tavern narration/html check passed');
