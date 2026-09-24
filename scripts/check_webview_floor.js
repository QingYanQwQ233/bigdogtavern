'use strict';

// 内核下限守卫：保证「声明的下限」永远不低于「代码实际用到的最高特性」。
//
// 背景：在本次校准之前，index.html 声明 Chromium 83，但 styles.css 已经用到了
// Chromium 111 才有的 color-mix()，以及 :has() / :is() / inset / aspect-ratio /
// :focus-visible / flex gap。83~110 的设备上 UI 会静默损坏（规则被丢弃），
// 且因为旧门槛是「低于 83 才提示」，这些用户看不到任何警告。
//
// 光把数字改对是打补丁。本文件守的是「声明与代码的一致性」，防止再次脱钩。
// 新增任何高版本特性时，这里的断言会失败并提示同步更新声明与文档。

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('public/index.html', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const css = fs.readFileSync('public/styles.css', 'utf8');

const bootMatch = html.match(/<script id="webview-compat-bootstrap">([\s\S]*?)<\/script>/i);
assert.ok(bootMatch, '兼容引导脚本缺失：public/index.html 里应有 <script id="webview-compat-bootstrap">');
const bootstrap = bootMatch[1];

const floorMatch = html.match(/var minimum = (\d+);/);
assert.ok(floorMatch, 'index.html 缺少 `var minimum = <数字>;` 声明');
const declaredFloor = Number(floorMatch[1]);

// ── 1. 引导脚本必须能在过旧内核上解析 ───────────────────────────────────
// 它是唯一能在过旧内核上运行、并告知用户「版本过低」的通道，所以本身不能用新语法。
assert.doesNotMatch(
  bootstrap,
  /\b(?:const|let|class|async|await)\b|=>|\?\.|\?\?|\*\*/,
  '兼容引导脚本必须保持 ES5 可解析（它要能在过旧内核上运行）'
);
assert.ok(html.indexOf(bootMatch[0]) < html.indexOf('<script src="vendor/marked.min.js">'), '兼容引导脚本必须早于 vendor 代码执行');
assert.match(bootstrap, /Array\.prototype\.at/);
assert.match(bootstrap, /Object\.hasOwn/);
assert.match(bootstrap, /Element\.prototype\.replaceChildren/);

// ── 2. 静态特性扫描：声明与代码的实际要求必须一致 ───────────────────────
// 本表是「内核下限」的唯一定义处。新增高版本特性时，同步加进这里。
const FEATURES = [
  { label: 'Array.fromAsync()', re: /\bArray\.fromAsync\b/g, min: 124 },
  { label: 'Set.prototype.union()', re: /\.union\(/g, min: 122 },
  { label: 'Promise.withResolvers()', re: /\bPromise\.withResolvers\b/g, min: 119 },
  { label: 'Object.groupBy()', re: /\bObject\.groupBy\b/g, min: 117 },
  { label: 'Map.groupBy()', re: /\bMap\.groupBy\b/g, min: 117 },
  { label: 'color-mix()', re: /color-mix\(/g, min: 111 },
  { label: ':has()', re: /:has\(/g, min: 105 },
  { label: 'Object.hasOwn()', re: /\bObject\.hasOwn\b/g, min: 93 },
  { label: 'Array.prototype.at()', re: /\.at\(/g, min: 92 },
  { label: ':is()', re: /:is\(/g, min: 88 },
  { label: 'aspect-ratio', re: /(^|[^-\w])aspect-ratio\s*:/g, min: 88 },
  { label: 'inset 简写', re: /(^|[;{\s])inset\s*:/g, min: 87 },
  { label: ':focus-visible', re: /:focus-visible/g, min: 86 },
  { label: 'replaceChildren()', re: /\breplaceChildren\b/g, min: 86 },
  { label: 'flex gap', re: /(^|[;{\s])gap\s*:/g, min: 84 },
];

// app.js 内含 iframe srcdoc 的内联 CSS，所以两种模式都要扫。
const SCAN_TARGETS = [
  { file: 'public/styles.css', mode: 'css' },
  { file: 'public/app.js', mode: 'both' },
  { file: 'public/sw.js', mode: 'both' },
  { file: 'public/mapgen.js', mode: 'both' },
];

const CSS_FEATURE_LABELS = new Set(['color-mix()', ':has()', ':is()', 'aspect-ratio', 'inset 简写', ':focus-visible', 'flex gap']);

const hits = [];
for (const target of SCAN_TARGETS) {
  if (!fs.existsSync(target.file)) continue;
  // 去掉块注释，避免注释里提到的特性名被误判成实际用法。
  const source = fs.readFileSync(target.file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const feature of FEATURES) {
    const isCss = CSS_FEATURE_LABELS.has(feature.label);
    if (target.mode === 'css' && !isCss) continue;
    const found = source.match(feature.re);
    if (found) hits.push({ file: target.file, label: feature.label, min: feature.min, count: found.length });
  }
}

hits.sort((a, b) => b.min - a.min || a.label.localeCompare(b.label));
const maxRequired = hits.length ? hits[0].min : 0;
const worst = hits.filter(hit => hit.min === maxRequired);

console.log(`  声明下限 Chromium ${declaredFloor} ／ 代码实际要求 Chromium ${maxRequired}`);
for (const hit of hits) {
  console.log(`    ${String(hit.min).padStart(3)}  ${hit.label.padEnd(24)} ${hit.file} ×${hit.count}`);
}

assert.ok(
  maxRequired <= declaredFloor,
  `内核下限声明与代码脱钩：index.html 声明 Chromium ${declaredFloor}，但代码用到了 Chromium ${maxRequired} 的特性` +
  `（${worst.map(h => `${h.label} @ ${h.file}`).join(', ')}）。` +
  '请同步更新 index.html 的 minimum 常量、README 与 AGENTS.md。'
);

// ── 3. 两份兼容降级层必须同步 ───────────────────────────────────────────
// 一份内联在 index.html（主页面），一份是 app-core.js 的 webCompatBootstrap()
// （注入两种隔离 iframe）。它们必须逐字等价，否则会出现「主页面修了、iframe 没修」的静默漂移。
const normalizeBootstrap = source => source
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\s+/g, '')
  .replace(/,\)/g, ')')
  .replace(/,}/g, '}');

const uaIndex = bootstrap.indexOf('var ua');
assert.ok(uaIndex > 0, '兼容引导脚本缺少 UA 检测段落');
const polyfillInHtml = normalizeBootstrap(
  bootstrap.slice(0, uaIndex).replace(/^[\s\S]*?\(function \(\) \{/, '')
);
const fnMatch = app.match(/function webCompatBootstrap\(\)\s*\{([\s\S]*?)^\}/m);
assert.ok(fnMatch, 'public/app.js 缺少 webCompatBootstrap()：隔离 iframe 将拿不到降级层');
const polyfillInApp = normalizeBootstrap(fnMatch[1]);

assert.strictEqual(
  polyfillInApp,
  polyfillInHtml,
  'index.html 与 app.js 里的兼容降级层已经漂移：两处必须同步修改（一处给主页面，一处注入隔离 iframe）'
);

// ── 4. 告警判定以「内核能力」为准，而不是 UA 版本号 ─────────────────────
const WEBVIEW_UA = 'Mozilla/5.0 (Linux; Android 10; wv) AppleWebKit/537.36 Version/4.0 Chrome/90.0.4430.91 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Safari/537.36';

function runBootstrap(options) {
  const warning = { hidden: true };
  const version = { textContent: '' };
  let closeBound = false;
  let closeFocused = false;
  const close = {
    addEventListener: () => { closeBound = true; },
    focus: () => { closeFocused = true; },
  };
  const win = {};
  if (options.supports === 'yes') win.CSS = { supports: () => true };
  if (options.supports === 'no') win.CSS = { supports: () => false };
  const context = vm.createContext({
    window: win,
    navigator: { userAgent: options.ua },
    document: {
      createTextNode: text => ({ nodeType: 3, textContent: String(text) }),
      getElementById: id => ({ 'webview-compat-warning': warning, 'webview-compat-version': version, 'webview-compat-close': close })[id] || null,
    },
  });
  vm.runInContext([
    'function Element() { this.nodes = []; }',
    "Object.defineProperty(Element.prototype, 'firstChild', { get: function() { return this.nodes[0] || null; } });",
    'Element.prototype.appendChild = function(node) { this.nodes.push(node); return node; };',
    'Element.prototype.removeChild = function(node) { var index = this.nodes.indexOf(node); if (index >= 0) this.nodes.splice(index, 1); return node; };',
    'Array.prototype.at = undefined;',
    'Object.hasOwn = undefined;',
  ].join('\n'), context);
  vm.runInContext(bootstrap, context);
  return { warning, version, closeBound, closeFocused, context };
}

const capableCase = runBootstrap({ ua: WEBVIEW_UA, supports: 'yes' });
assert.strictEqual(capableCase.warning.hidden, true, '内核能力足够时不得告警（哪怕 UA 里写着旧版本号）');

const legacyCase = runBootstrap({ ua: WEBVIEW_UA, supports: 'no' });
assert.strictEqual(legacyCase.warning.hidden, false, '内核能力不足时必须告警');
assert.ok(legacyCase.closeBound, '告警必须绑定关闭动作，不能阻断使用');
assert.ok(legacyCase.closeFocused, '告警打开时应聚焦关闭按钮');
assert.match(legacyCase.version.textContent, new RegExp('最低要求为 Chromium ' + declaredFloor));
assert.match(legacyCase.version.textContent, /Android System WebView/);

const desktopCase = runBootstrap({ ua: DESKTOP_UA, supports: 'no' });
assert.strictEqual(desktopCase.warning.hidden, false, '桌面浏览器内核不足时同样应告警：判定以能力为准，不只看 WebView');
assert.match(desktopCase.version.textContent, /浏览器/);

const ancientCase = runBootstrap({ ua: WEBVIEW_UA, supports: 'missing' });
assert.strictEqual(ancientCase.warning.hidden, false, '连 CSS.supports 都没有的远古内核必须告警');

// ── 5. 降级层（polyfill）行为 ───────────────────────────────────────────
const runtime = vm.runInContext([
  'var host = new Element();',
  "var node = { nodeType: 1, id: 'node' };",
  "host.appendChild({ nodeType: 1, id: 'old' });",
  "host.replaceChildren('text', node);",
  "({ last: [1, 2].at(-1), own: Object.hasOwn({ ok: true }, 'ok'), missing: Object.hasOwn({ ok: true }, 'no'), children: host.nodes });",
].join('\n'), legacyCase.context);
assert.strictEqual(runtime.last, 2, 'at 降级层必须支持负索引');
assert.strictEqual(runtime.own, true, 'Object.hasOwn 降级层必须保留 own-property 语义');
assert.strictEqual(runtime.missing, false);
assert.strictEqual(runtime.children.length, 2, 'replaceChildren 降级层必须先清空、再按参数顺序追加');
assert.strictEqual(runtime.children[0].textContent, 'text');
assert.strictEqual(runtime.children[1].id, 'node');

assert.strictEqual(
  (app.match(/<script>\$\{webCompatSource\(\)\}<\/script>/g) || []).length,
  2,
  '两种隔离 iframe（世界卡扩展 / 角色卡框架）都必须收到兼容降级层'
);

// ── 6. 导航抽屉与无障碍（保留项，与内核下限无关）────────────────────────
assert.match(html, /id="btn-nav-drawer"[^>]*type="button"[^>]*aria-controls="nav-drawer"[^>]*aria-expanded="false"/, '导航触发按钮必须声明 button 与抽屉语义');
assert.match(app, /function usesDesktopNavigation\(\)\s*\{[\s\S]*?window\.matchMedia\(NAVIGATION_DESKTOP_QUERY\)\.matches/, '导航断点必须与 CSS 使用同一套媒体查询模型');
assert.match(app, /function setNavDrawerOpen\(open\)[\s\S]*?aria-expanded/, '导航抽屉必须更新其无障碍状态');
assert.match(app, /\$\('btn-nav-drawer'\)\.addEventListener\('click',[\s\S]*?openNavDrawer\(\)/, '导航触发按钮必须绑定移动抽屉动作');
assert.match(app, /function openSettings\(\)\s*\{[\s\S]*?\$\('settings-modal'\)\.classList\.remove\('hidden'\);[\s\S]*?\}/, '设置动作必须显示设置弹窗');
assert.match(app, /document\.querySelectorAll\('\.js-settings'\)\.forEach\(b => b\.addEventListener\('click', openSettings\)\);/, '设置入口必须绑定设置动作');

const customWorldHeader = css.match(/body\.world-custom-layout:not\(\.world-immersive\) \.chat-header\s*\{([\s\S]*?)\}/i);
assert.ok(customWorldHeader, '自定义世界顶栏规则缺失');
const customWorldHeaderDeclarations = customWorldHeader[1].replace(/\/\*[\s\S]*?\*\//g, '');
assert.doesNotMatch(customWorldHeaderDeclarations, /^\s*pointer-events\s*:\s*none\s*;/im, '自定义世界顶栏不得禁用菜单命中区域（WebView 的 pointer-events 传播不可靠）');
assert.match(customWorldHeaderDeclarations, /^\s*pointer-events\s*:\s*auto\s*;/im, '自定义世界顶栏必须保持菜单命中区域可用');
assert.match(css, /#btn-nav-drawer\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;[^}]*touch-action:\s*manipulation;/, '移动菜单触发按钮必须保持可靠触控命中区（≥44px）');
assert.match(css, /\.pg-reply-options input,[\s\S]*?\.pg-reply-options textarea,[\s\S]*?font-size:\s*16px/, 'RP 选项输入框必须显式声明 16px 字号（避免移动端自动缩放）');

const navSource = app.match(/const NAVIGATION_DESKTOP_QUERY[\s\S]*?function closeNavDrawer\(\) \{ setNavDrawerOpen\(false\); \}/);
assert.ok(navSource, '导航抽屉 helpers 缺失');
const classes = new Set();
const attributes = {};
const drawer = { classList: { toggle(name, force) { if (force) classes.add(name); else classes.delete(name); return classes.has(name); } } };
const trigger = { setAttribute(name, value) { attributes[name] = String(value); } };
const viewport = { matches: false };
const navContext = vm.createContext({
  window: { innerWidth: 1280, matchMedia: () => viewport },
  $: id => ({ 'nav-drawer': drawer, 'btn-nav-drawer': trigger })[id] || null,
});
vm.runInContext(navSource[0], navContext);
assert.strictEqual(navContext.usesDesktopNavigation(), false, 'matchMedia 必须优先于过时期内宽度');
navContext.openNavDrawer();
assert.ok(classes.has('open'), '移动菜单点击必须打开抽屉');
assert.strictEqual(attributes['aria-expanded'], 'true');
navContext.closeNavDrawer();
assert.ok(!classes.has('open'), '关闭抽屉必须移除打开态');
assert.strictEqual(attributes['aria-expanded'], 'false');
viewport.matches = true;
assert.strictEqual(navContext.usesDesktopNavigation(), true);

console.log('webview floor check passed');
