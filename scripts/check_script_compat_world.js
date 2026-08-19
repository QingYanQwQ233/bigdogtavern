'use strict';

const assert = require('assert');
const fs = require('fs');

const pkg = JSON.parse(fs.readFileSync('docs/demo-script-compat-world.tavern-world.json', 'utf8'));
const world = pkg.content.world;
const extension = world.ui.extension;
const ids = new Set(world.runtime.variables.map(item => item.id));

assert.strictEqual(pkg.spec, 'tavern_world_package');
assert.strictEqual(world.id, 'world-script-compat-lab');
assert.strictEqual(extension.enabled, true);
assert.ok(extension.html.includes('EJS'));
assert.ok(extension.js.includes('TavernExtension.mvu'));
assert.ok(extension.js.includes('addEventListener'));
assert.ok(extension.js.includes('<% if (user) { %>'));
assert.deepStrictEqual([...ids].sort(), ['demo_count', 'demo_status']);
assert.ok(extension.permissions.includes('write.runtime'));
console.log('check_script_compat_world: ok');
