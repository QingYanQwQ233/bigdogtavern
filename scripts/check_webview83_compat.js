'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('public/index.html', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
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
console.log('webview 83 compatibility check passed');
