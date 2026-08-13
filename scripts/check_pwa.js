'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sw = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const version = sw.match(/const ASSET_VERSION = '([^']+)'/);
assert.ok(version, 'service worker declares an asset version');
const assetVersion = version[1];
assert.ok(sw.includes("const CACHE = 'tavern-' + ASSET_VERSION;"), 'cache name includes the asset version');
for (const asset of ['mapgen.js', 'app.js']) {
  assert.match(sw, new RegExp(`/${asset}\\?v=' \\+ ASSET_VERSION`), `${asset} is pre-cached with its query version`);
  assert.ok(index.includes(`${asset}?v=${assetVersion}`), `${asset} page URL matches the service worker shell`);
}
assert.ok(!sw.includes("const CACHE = 'tavern-v1'"), 'stale v1 cache is retired');
console.log('PWA cache check passed');
