'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('public/index.html', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const css = fs.readFileSync('public/styles.css', 'utf8');
const match = html.match(/<script id="webview-83-compat">([\s\S]*?)<\/script>/i);
assert.ok(match, 'WebView 83 compatibility bootstrap is missing');
const bootstrap = match[1];

assert.doesNotMatch(bootstrap, /\b(?:const|let|class|async|await)\b|=>|\?\.|\?\?|\*\*/, 'bootstrap must stay ES5-parseable');
assert.ok(html.indexOf(match[0]) < html.indexOf('<script src="vendor/marked.min.js">'), 'bootstrap must run before vendor code');
assert.match(bootstrap, /Array\.prototype\.at/);
assert.match(bootstrap, /Object\.hasOwn/);
assert.match(bootstrap, /Element\.prototype\.replaceChildren/);
assert.match(html, /var minimum = 83;/, 'Android WebView 83 must not be warned as unsupported');

const warning = { hidden: true };
const version = { textContent: '' };
let closeBound = false;
let closeFocused = false;
const close = {
  addEventListener: () => { closeBound = true; },
  focus: () => { closeFocused = true; },
};
const context = vm.createContext({
  window: {},
  navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 10; wv) AppleWebKit/537.36 Version/4.0 Chrome/83.0.4103.106 Mobile Safari/537.36' },
  document: {
    createTextNode: text => ({ nodeType: 3, textContent: String(text) }),
    getElementById: id => ({ 'webview-compat-warning': warning, 'webview-compat-version': version, 'webview-compat-close': close })[id] || null,
  },
});
vm.runInContext(`
  function Element() { this.nodes = []; }
  Object.defineProperty(Element.prototype, 'firstChild', { get: function() { return this.nodes[0] || null; } });
  Element.prototype.appendChild = function(node) { this.nodes.push(node); return node; };
  Element.prototype.removeChild = function(node) { var index = this.nodes.indexOf(node); if (index >= 0) this.nodes.splice(index, 1); return node; };
  Array.prototype.at = undefined;
  Object.hasOwn = undefined;
`, context);
vm.runInContext(bootstrap, context);
const runtime = vm.runInContext(`
  var host = new Element();
  var node = { nodeType: 1, id: 'node' };
  host.appendChild({ nodeType: 1, id: 'old' });
  host.replaceChildren('text', node);
  ({ last: [1, 2].at(-1), own: Object.hasOwn({ ok: true }, 'ok'), missing: Object.hasOwn({ ok: true }, 'no'), children: host.nodes });
`, context);
assert.strictEqual(runtime.last, 2, 'at polyfill must support negative indexes');
assert.strictEqual(runtime.own, true, 'Object.hasOwn polyfill must preserve own-property checks');
assert.strictEqual(runtime.missing, false);
assert.strictEqual(runtime.children.length, 2, 'replaceChildren polyfill must remove previous nodes and append replacements');
assert.strictEqual(runtime.children[0].textContent, 'text');
assert.strictEqual(runtime.children[1].id, 'node');
assert.strictEqual(warning.hidden, true, 'WebView 83 must not show the unsupported-version warning');

context.navigator.userAgent = 'Mozilla/5.0 (Linux; Android 10; wv) AppleWebKit/537.36 Version/4.0 Chrome/82.0.4103.106 Mobile Safari/537.36';
vm.runInContext(bootstrap, context);
assert.strictEqual(warning.hidden, false, 'WebView 82 must keep the update warning');
assert.match(version.textContent, /最低要求为 83/);
assert.strictEqual(closeBound, true);
assert.strictEqual(closeFocused, true);

for (const file of ['public/app.js', 'public/mapgen.js', 'public/sw.js', 'public/vendor/marked.min.js', 'public/vendor/purify.min.js', 'public/vendor/mapgen2.bundle.js']) {
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /\|\|=|&&=|\?\?=/, `${file} contains syntax WebView 83 cannot parse`);
}
assert.strictEqual((app.match(/<script>\$\{webview83CompatSource\(\)\}<\/script>/g) || []).length, 2, 'both sandbox iframe types must receive the WebView 83 bootstrap');
assert.match(html, /id="btn-nav-drawer"[^>]*type="button"[^>]*aria-controls="nav-drawer"[^>]*aria-expanded="false"/, 'navigation trigger must expose button and drawer semantics');
assert.match(app, /function usesDesktopNavigation\(\)\s*\{[\s\S]*?window\.matchMedia\(NAVIGATION_DESKTOP_QUERY\)\.matches/, 'navigation breakpoint must use the same media-query model as CSS');
assert.match(app, /function setNavDrawerOpen\(open\)[\s\S]*?aria-expanded/, 'navigation drawer state must update its accessibility state');
const customWorldHeader = css.match(/body\.world-custom-layout:not\(\.world-immersive\) \.chat-header\s*\{([\s\S]*?)\}/i);
assert.ok(customWorldHeader, 'custom world header rule is missing');
const customWorldHeaderDeclarations = customWorldHeader[1].replace(/\/\*[\s\S]*?\*\//g, '');
assert.doesNotMatch(customWorldHeaderDeclarations, /^\s*pointer-events\s*:\s*none\s*;/im, 'custom world header must not disable its WebView 83 menu hit target');
assert.match(customWorldHeaderDeclarations, /^\s*pointer-events\s*:\s*auto\s*;/im, 'custom world header must keep its menu hit target active');
assert.match(css, /#btn-nav-drawer\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;[^}]*touch-action:\s*manipulation;/, 'mobile menu trigger must remain a reliable touch target');

const navSource = app.match(/const NAVIGATION_DESKTOP_QUERY[\s\S]*?function closeNavDrawer\(\) \{ setNavDrawerOpen\(false\); \}/);
assert.ok(navSource, 'navigation drawer helpers are missing');
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
assert.strictEqual(navContext.usesDesktopNavigation(), false, 'matchMedia must win when legacy WebView reports a stale innerWidth');
navContext.openNavDrawer();
assert.ok(classes.has('open'), 'mobile menu click must open the drawer');
assert.strictEqual(attributes['aria-expanded'], 'true');
navContext.closeNavDrawer();
assert.ok(!classes.has('open'), 'drawer close must remove the open state');
assert.strictEqual(attributes['aria-expanded'], 'false');
viewport.matches = true;
assert.strictEqual(navContext.usesDesktopNavigation(), true);
console.log('webview 83 compatibility check passed');
