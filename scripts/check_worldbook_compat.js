'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('public/app.js', 'utf8');
const start = source.indexOf('/* SillyTavern World Info 的数值枚举');
const end = source.indexOf('/* 世界书匹配：', start);
assert.ok(start >= 0 && end > start, 'worldbook compatibility helpers not found');

const sandbox = { prefs: { wiCaseSensitive: false, wiWholeWord: false }, result: null };
vm.runInNewContext(`${source.slice(start, end)}; result = { normalizeCharacterBookEntries, worldInfoMatchStats, worldInfoKeyMatches, serializeSTWorldInfoEntry };`, sandbox);
const { normalizeCharacterBookEntries, worldInfoMatchStats, worldInfoKeyMatches, serializeSTWorldInfoEntry } = sandbox.result;

const entries = normalizeCharacterBookEntries({
  entries: [{ uid: 42, comment: '港口', key: ['港口'], keysecondary: ['夜', '雨'], selective: true, selectiveLogic: 3,
    position: 4, depth: 6, role: 1, triggers: ['quick-reply:inspect'], content: '夜雨港口' }],
});
assert.strictEqual(entries.length, 1);
assert.deepStrictEqual(entries[0].primaryKeys, ['港口']);
assert.deepStrictEqual(entries[0].secondaryKeys, ['夜', '雨']);
assert.strictEqual(worldInfoMatchStats(entries[0], '夜雨中的港口').ok, true, 'AND ALL secondary keys should match');
assert.strictEqual(worldInfoMatchStats(entries[0], '夜里的港口').ok, false, 'AND ALL should reject a missing secondary key');

const regexEntry = normalizeCharacterBookEntries({ entries: [{ key: ['/龙之谷/i'], content: 'x' }] })[0];
assert.strictEqual(worldInfoKeyMatches('/龙之谷/i', regexEntry, '龙之谷'), true);
const exported = serializeSTWorldInfoEntry(entries[0], 0);
assert.deepStrictEqual(exported.key, ['港口']);
assert.deepStrictEqual(exported.keysecondary, ['夜', '雨']);
assert.strictEqual(exported.selectiveLogic, 3);
assert.strictEqual(exported.position, 4);
assert.strictEqual(exported.depth, 6);
assert.strictEqual(exported.role, 1);
assert.deepStrictEqual(Array.from(exported.triggers), ['quick-reply:inspect']);
assert.strictEqual(worldInfoKeyMatches('/' + 'a'.repeat(501) + '/', regexEntry, 'a'), false);

const html = fs.readFileSync('public/index.html', 'utf8');
for (const id of ['lb-export', 'lb-scan-depth', 'lb-recursive', 'lb-min-activations', 'lb-min-depth', 'wi-selective-logic', 'wi-position', 'wi-secondary', 'wi-sticky', 'wi-cooldown', 'wi-delay', 'wi-ignore-budget']) {
  assert.match(html, new RegExp(`id="${id}"`), `missing worldbook control: ${id}`);
}
assert.match(source, /world-lb-delete/);
assert.match(source, /function deleteLBById\(id\)/);

const importStart = source.indexOf('function importCharOrLorebookFromBuffer(buffer, fileName = \'\')');
const importEnd = source.indexOf('function exportCurrentChar()', importStart);
assert.ok(importStart >= 0 && importEnd > importStart, 'unified character/worldbook import helper not found');
const importSandbox = {
  characterCardTextFromBuffer: () => JSON.stringify({ name: 'ST 世界书', entries: [{ key: ['港口'], content: 'x' }] }),
  importedLorebookEntries: value => Array.isArray(value?.entries) ? value.entries : [],
  importSTLorebookText: (text, fileName) => ({ name: fileName.replace(/\.json$/i, ''), entries: 1 }),
  importCharFromText: () => ({ character: { name: '角色' } }),
};
vm.runInNewContext(`${source.slice(importStart, importEnd)}; result = importCharOrLorebookFromBuffer(new ArrayBuffer(0), 'world.json');`, importSandbox);
assert.strictEqual(importSandbox.result.kind, 'lorebook', 'named ST World Info JSON should route to the worldbook importer');
assert.strictEqual(importSandbox.result.report.entries, 1);

console.log('worldbook ST compatibility check passed');
