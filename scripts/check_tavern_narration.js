'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('public/app.js', 'utf8');
const swSource = fs.readFileSync('public/sw.js', 'utf8');
const start = source.indexOf('function normalizeTavernHtmlBlocks(content)');
const end = source.indexOf('/* ─────────── 会话管理', start);
assert.ok(start >= 0 && end > start, 'Tavern renderer boundaries not found');

const sandbox = { currentUserPreset: () => ({ name: '测试用户名' }) };
vm.runInNewContext(`${source.slice(start, end)}; result = { split: splitNarration, normalize: normalizeTavernHtmlBlocks, expand: expandDisplayMacros, extractStyles: extractTavernStyles, extractScripts: extractTavernScripts, cardScripts: cardScriptInventory, sanitizeCss: sanitizeTavernCss };`, sandbox);
const { split, normalize, expand, extractStyles, extractScripts, cardScripts, sanitizeCss } = sandbox.result;

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

const fencedTextHtml = '```text\n<!DOCTYPE html><html><body><section><strong>卡片</strong></section></body></html>\n```';
assert.ok(normalize(fencedTextHtml).includes('<section><strong>卡片</strong></section>'), 'ST text fences containing HTML should render as HTML');
assert.ok(!normalize(fencedTextHtml).includes('```text'), 'ST text fence should be removed when it wraps a full HTML layout');

const fencedTextStyle = extractStyles(normalize('```text\n<style>.panel{color:red}</style><div class="panel">内容</div>\n```'));
assert.ok(fencedTextStyle.styles.includes('[data-tavern-rendered] .panel'), 'styles inside an HTML text fence should be scoped and extracted');
assert.ok(fencedTextStyle.markup.includes('<div class="panel">内容</div>'), 'HTML text fence body should remain after style extraction');

const fencedJs = '```js\n    <div>保留代码块</div>\n```';
assert.strictEqual(normalize(fencedJs), fencedJs, 'non-HTML code fences must remain untouched');
const scriptSample = extractScripts('<style>.panel{color:red}</style><button onclick="ok()">运行</button><script src="https://code.jquery.com/jquery-3.6.0.min.js"></script><script>window.cardRan=true</script>');
assert.strictEqual(scriptSample.scripts.length, 2, 'HTML scripts should be extracted in order');
assert.strictEqual(scriptSample.scripts[0].src, 'https://code.jquery.com/jquery-3.6.0.min.js', 'external script URL should be preserved');
assert.strictEqual(scriptSample.scripts[1].code.trim(), 'window.cardRan=true', 'inline script body should be preserved');
assert.ok(scriptSample.markup.includes('<button onclick="ok()">运行</button>'), 'script extraction must not remove surrounding HTML');
const fencedScript = extractScripts('```html\n<script>window.nope=true</script>\n```');
assert.strictEqual(fencedScript.scripts.length, 0, 'scripts in code fences must stay inert');
const fencedCardScript = '```text\n<!doctype html><html><body><script>window.cardRan=true</script></body></html>\n```';
assert.strictEqual(cardScripts({ id: 'card', cardData: { extensions: { regex_scripts: [{ replaceString: fencedCardScript }] } } }).length, 1, 'full HTML script fences must be included in the card inventory');

const extractedStyles = extractStyles('<style>@import url("https://bad.test/x.css"); .panel{color:red;background:url(https://bad.test/p.png)}</style><section class="panel">内容</section>');
assert.ok(extractedStyles.styles.includes('[data-tavern-rendered] .panel'), 'card CSS should be scoped to the rendered message');
assert.ok(!extractedStyles.styles.includes('@import') && !extractedStyles.styles.includes('https://bad.test'), 'card CSS must not keep external imports or URLs');
assert.ok(extractedStyles.markup.includes('<section class="panel">内容</section>'), 'style extraction must preserve the HTML body');
const rootStyles = extractStyles('<style>body{background:linear-gradient(red,blue);color:white} :root .panel{padding:4px}</style><div class="panel">背景</div>');
assert.ok(rootStyles.styles.includes('[data-tavern-rendered]{background:linear-gradient(red,blue);color:white}'), 'body styles should map to the rendered message scope');
assert.ok(rootStyles.styles.includes('[data-tavern-rendered] .panel{padding:4px}'), ':root descendants should map into the rendered message scope');
assert.ok(!/\}\s*font-family:|\}\s*background:/.test(rootStyles.styles), 'scoped root CSS must not leave declarations outside a selector');
const fencedStyle = extractStyles('```html\n<style>.code-only{color:red}</style>\n```');
assert.strictEqual(fencedStyle.styles, '', 'style examples inside code fences must stay inert');
assert.ok(fencedStyle.markup.includes('<style>.code-only{color:red}</style>'), 'fenced style should remain visible as code input');
assert.strictEqual(sanitizeCss('color:red; background:url(https://bad.test/x.png)', false), 'color:red; background:', 'inline styles should drop external URLs');

const demoCard = JSON.parse(fs.readFileSync('docs/demo-script-compat-character.json', 'utf8'));
const demoOpening = String(demoCard?.data?.first_mes || '');
for (const label of ['EJS 原文（保留，不执行）', 'MVU 原文（保留，不执行）', 'JS 原文（保留，不执行）']) {
  assert.ok(demoOpening.includes(label), `demo opening should include ${label}`);
}
assert.ok(demoOpening.includes('无需 AI 生成即可验收'), 'demo opening must be deterministic');
const visibleDemoText = [
  demoCard?.data?.first_mes,
  demoCard?.data?.mes_example,
  ...(Array.isArray(demoCard?.data?.alternate_greetings) ? demoCard.data.alternate_greetings : []),
].join('\n');
assert.ok(!/<%/.test(visibleDemoText), 'ST-visible demo fields must not contain executable EJS openers');
assert.ok(demoOpening.includes('ejs-token'), 'demo opening should visibly preserve the EJS sample');
assert.ok(demoOpening.includes('data-compat-demo="character-v3" style='), 'demo opening should include an inline style fallback for ST');
assert.ok(demoOpening.includes('background:linear-gradient'), 'demo opening should retain the panel fallback background');

const stylesSource = fs.readFileSync('public/styles.css', 'utf8');
assert.match(stylesSource, /\.msg \.bubble\s*\{[\s\S]*?overflow-x:\s*hidden/, 'message bubbles should contain horizontal overflow');
assert.match(stylesSource, /\.msg \.bubble\[data-tavern-rendered\][\s\S]*?max-width:\s*100%/, 'rendered card bubbles should stay within the message width');
assert.match(stylesSource, /\.msg:has\(\.tavern-card-script-shell\)[\s\S]*?width:\s*100%/, 'role-card messages should use the full desktop chat width');
assert.match(stylesSource, /\.msg:has\(\.tavern-card-script-shell\) \.bubble[\s\S]*?flex:\s*1 1 auto/, 'role-card bubbles should not shrink-to-fit their contents');
assert.match(stylesSource, /@media \(max-width: 640px\)[\s\S]*?\.msg \.bubble\[data-tavern-rendered\][\s\S]*?min-width:\s*0/, 'mobile rendered card bubbles need a zero minimum width');
assert.doesNotMatch(source, /class=\\?"avatar\\?"/, 'chat messages should not render host avatars');
assert.doesNotMatch(stylesSource, /\.msg \.avatar\s*\{/, 'host avatar styling should not remain active');
assert.doesNotMatch(source, /放弃本回合/, 'pending turn UI should not expose the surrender action');
assert.match(stylesSource, /\.msg-actions\s*\{[\s\S]*?position:\s*static;[\s\S]*?flex:\s*0 0 100%;[\s\S]*?justify-content:\s*flex-end/, 'message actions should occupy their own row instead of overlapping message text');
const cardFrameSource = source.slice(source.indexOf('function tavernCardScriptFrame'), source.indexOf('let tavernCardFrameBridgeReady'));
assert.match(cardFrameSource, /data-tavern-card-mode="full"/, 'role-card scripts must opt into the full ST-compatible iframe mode');
assert.doesNotMatch(cardFrameSource, /sandbox=/, 'role-card full mode must not add a sandbox attribute');
assert.doesNotMatch(cardFrameSource, /connect-src 'none'/, 'role-card full mode must not block card network dependencies');
assert.match(source, /installSTDataGlobals/, 'role-card bridge must provide missing ST data globals');
assert.match(source, /testMessage_data\|testWorldBooks/, 'role-card bridge must provide local ST fixture compatibility');
assert.match(source, /\(function\(\)\{\\n\$\{code\}/, 'role-card scripts must run in isolated lexical wrappers to avoid duplicate const failures');
assert.match(source, /parsed\.protocol\)\)\s*return ''/, 'external card scripts must still reject non-http protocols');
assert.match(source, /tavernCardFrameBridgeSource\(nonce(?:, compatibility)?/, 'role-card iframe must install the host bridge');
assert.match(source, /global\.triggerSlash = triggerSlash/, 'role-card bridge must expose the limited /send compatibility API');
assert.match(source, /global\.copyToTavernDialog = copy/, 'role-card bridge must expose the input-box copy API');
assert.match(source, /global\.getLastMessageId = getLastMessageId/, 'role-card bridge must expose a read-only last-message compatibility API');
assert.match(source, /global\.getCurrentMessageId = getCurrentMessageId/, 'role-card bridge must expose the current-message compatibility API');
assert.match(source, /global\.getChatMessages = getChatMessages/, 'role-card bridge must expose a read-only chat compatibility API');
assert.match(source, /global\.getAllChatMessages = getAllChatMessages/, 'role-card bridge must expose the all-chat compatibility API');
assert.match(source, /global\.getCharWorldbookNames = getCharWorldbookNames/, 'role-card bridge must expose a read-only character-worldbook API');
assert.match(source, /global\.getWorldbook = getWorldbook/, 'role-card bridge must expose a read-only worldbook compatibility API');
assert.match(source, /global\.getCurrentChatId = getCurrentChatId/, 'role-card bridge must expose the current-chat compatibility API');
assert.match(source, /rawContent/, 'display regex must not discard the pre-regex message used by card loaders');
assert.match(source, /const visible = text\.slice\(0, open\.index\) \+ text\.slice\(open\.index \+ open\[0\]\.length\)/, 'malformed RP option tags must not discard trailing narrative');
assert.match(source, /data-tavern-card-nonce/, 'role-card bridge messages must be nonce-bound');
assert.match(source, /角色卡发送内容超过 40000 字符限制/, 'role-card bridge must cap untrusted text payloads');
assert.match(source, /root\?\.scrollHeight\|\|0/, 'role-card iframe height should follow the card root instead of the viewport');
assert.match(source, /new ResizeObserver\(report\)\.observe\(root\)/, 'role-card iframe should resize when the card collapses or expands');
assert.match(swSource, /fetch\(e\.request, \{ cache: 'no-store' \}\)/, 'service worker navigations must bypass stale cache entries');

console.log('tavern narration/html check passed');
