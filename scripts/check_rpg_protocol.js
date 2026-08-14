'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const storage = new Map();
const context = vm.createContext({
  console,
  localStorage: {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  },
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  window: {}, document: {}, Date, Math, JSON, Set, Map,
});

const source = fs.readFileSync('public/app.js', 'utf8').replace(/\ninit\(\);\s*$/, '');
vm.runInContext(source, context);

function parse(value) {
  return vm.runInContext(`parseRpgOutput(${JSON.stringify(value)})`, context);
}

const valid = parse([
  '黎明前的雾压在石桥上。',
  '<tavern_state_update>',
  JSON.stringify({ protocol: 'tavern.rpg.turn', version: 1, baseRevision: 7, updates: [], options: [] }),
  '</tavern_state_update>',
].join('\n'));
assert.strictEqual(valid.format, 'tagged');
assert.strictEqual(valid.errorCode, null);
assert.strictEqual(valid.narrative, '黎明前的雾压在石桥上。');
assert.strictEqual(valid.payload.baseRevision, 7);

const empty = parse('只有故事，没有状态变化。\n<tavern_state_update>{"updates":[]}</tavern_state_update>');
assert.deepStrictEqual(JSON.parse(JSON.stringify(empty.payload)), { updates: [] });

const fenced = parse('故事。\n<tavern_state_update>\n```json\n{"updates":[]}\n```\n</tavern_state_update>');
assert.strictEqual(fenced.errorCode, null);
assert.deepStrictEqual(JSON.parse(JSON.stringify(fenced.payload)), { updates: [] });

const legacy = parse('旧版故事。\n```rpg\n{"options":[],"hp":-1}\n```');
assert.strictEqual(legacy.format, 'legacy-rpg');
assert.strictEqual(legacy.legacy, true);
assert.strictEqual(legacy.payload.hp, -1);

const noBlock = parse('正文中提到 JSON：{"updates":[]}，但这不是协议。');
assert.strictEqual(noBlock.format, 'none');
assert.strictEqual(noBlock.errorCode, null);
assert.strictEqual(noBlock.narrative, '正文中提到 JSON：{"updates":[]}，但这不是协议。');

const invalidJson = parse('故事\n<tavern_state_update>{"updates":[}</tavern_state_update>');
assert.strictEqual(invalidJson.errorCode, 'update.invalid_json');
assert.strictEqual(invalidJson.repairable, true);
assert.strictEqual(invalidJson.payload, null);

const missingEnd = parse('故事\n<tavern_state_update>{"updates":[]}');
assert.strictEqual(missingEnd.errorCode, 'update.missing_end');
assert.strictEqual(missingEnd.complete, false);

const duplicate = parse('<tavern_state_update>{"updates":[]}</tavern_state_update>\n<tavern_state_update>{"updates":[]}</tavern_state_update>');
assert.strictEqual(duplicate.errorCode, 'update.duplicate');
assert.strictEqual(duplicate.payload, null);

const trailing = parse('<tavern_state_update>{"updates":[]}</tavern_state_update>\n多余解释');
assert.strictEqual(trailing.errorCode, 'update.trailing_content');
assert.strictEqual(trailing.payload, null);

const rootArray = parse('<tavern_state_update>[]</tavern_state_update>');
assert.strictEqual(rootArray.errorCode, 'update.root_not_object');
assert.strictEqual(rootArray.repairable, false);

console.log('rpg protocol parser check passed');
