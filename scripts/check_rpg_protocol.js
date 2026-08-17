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

// Markdown 叙事中的骰子表达式是文本，不能触发任何骰子副作用。
context.rollCalls = 0;
const originalRollDiceIn = context.rollDiceIn;
vm.runInContext("mode = 'rpg'; rollDiceIn = function () { rollCalls++; return []; };", context);
const narrative = vm.runInContext(`processAIOutput(${JSON.stringify('叙事提到 d20+5，但没有执行掷骰。\n<tavern_state_update>{"protocol":"tavern.rpg.turn","version":1,"baseRevision":7,"updates":[],"options":[]}</tavern_state_update>')})`, context);
assert.strictEqual(narrative.content, '叙事提到 d20+5，但没有执行掷骰。');
assert.strictEqual(context.rollCalls, 0);
context.rollDiceIn = originalRollDiceIn;

const toolCandidate = vm.runInContext(`processAIOutput(${JSON.stringify('工具候选。\n<tavern_state_update>' + JSON.stringify({ protocol: 'tavern.rpg.turn', version: 1, baseRevision: 7, updates: [], options: [], toolCalls: [{ callId: 'roll-1', name: 'dice.roll', arguments: { expr: 'd20' } }] }) + '</tavern_state_update>')})`, context);
assert.strictEqual(toolCandidate.agentCalls[0].name, 'dice.roll');
assert.strictEqual(Object.hasOwn(toolCandidate.patch, 'toolCalls'), false);

const locationPatch = vm.runInContext(`processAIOutput(${JSON.stringify('<tavern_state_update>' + JSON.stringify({ protocol: 'tavern.rpg.turn', version: 1, baseRevision: 7, updates: [{ type: 'location.set', location: { id: 'wolf-tooth-inn' }, name: '多余显示名' }], options: [] }) + '</tavern_state_update>')})`, context);
assert.deepStrictEqual(JSON.parse(JSON.stringify(locationPatch.patch.updates)), [{ type: 'location.set', locationId: 'wolf-tooth-inn' }]);

const malformedActionPatch = vm.runInContext(`validateRpgPatchShape(${JSON.stringify({
  protocol: 'tavern.rpg.turn', version: 1, baseRevision: 7, updates: [
    { type: 'runtime.action.execute', actionId: 'restock', input: {}, result: { ok: true } },
  ], options: [],
})})`, context);
assert.match(malformedActionPatch, /patch\.runtime\.action\.execute 含有未声明字段 result/);
const validActionPatch = vm.runInContext(`validateRpgPatchShape(${JSON.stringify({
  protocol: 'tavern.rpg.turn', version: 1, baseRevision: 7, updates: [
    { type: 'runtime.action.execute', actionId: 'restock', input: { count: 1 } },
  ], options: [],
})})`, context);
assert.strictEqual(validActionPatch, null);

context.fetch = () => { throw new Error('world dice must not call /api/dice'); };
const localDice = vm.runInContext("rollWorldDice('1d6')", context);
assert.strictEqual(localDice.length, 1);
assert.strictEqual(localDice[0].expr, '1d6');
assert.ok(localDice[0].total >= 1 && localDice[0].total <= 6);

console.log('rpg protocol parser check passed');
