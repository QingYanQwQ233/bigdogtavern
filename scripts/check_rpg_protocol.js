'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { normalizeRpgTurnIntent, validateActionIntent, validateRpgPatch, applyRpgPatch, materializeWorldRuntimeState, validateAgentPhaseContract } = require('../server');

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

const orderedAgentTrace = [
  { callId: 'ctx-1', name: 'context.retrieve', phase: 'observe', result: { ok: true } },
  { callId: 'check-1', name: 'rules.check', phase: 'guard', result: { ok: true } },
  { callId: 'roll-1', name: 'dice.roll', phase: 'guard', result: { ok: true } },
  { callId: 'patch-1', name: 'state.patch', phase: 'commit', result: { ok: true } },
];
assert.strictEqual(validateAgentPhaseContract(orderedAgentTrace), null);
assert.match(validateAgentPhaseContract([...orderedAgentTrace].reverse()), /阶段顺序/);

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
assert.strictEqual(vm.runInContext("rpgUiValueText('confirmed', 'status')", context), '已确认');
assert.strictEqual(vm.runInContext("rpgUiValueText('unconfirmed', 'status')", context), '未确认');
assert.strictEqual(vm.runInContext(`rpgRuntimeActionIsConfirmed(
  { effects: [{ type: 'collection.patch', collectionId: 'clue-board', entryId: 'clue-1', set: { status: 'confirmed' } }] },
  { collections: { 'clue-board': [{ id: 'clue-1', status: 'confirmed' }] } }
)`, context), true);
assert.strictEqual(vm.runInContext(`rpgRuntimeActionIsConfirmed(
  { effects: [{ type: 'collection.patch', collectionId: 'clue-board', entryId: 'clue-1', set: { status: 'confirmed' } }] },
  { collections: { 'clue-board': [{ id: 'clue-1', status: 'unconfirmed' }] } }
)`, context), false);

const mergedRepair = vm.runInContext(`mergeRepairedReply(
  ${JSON.stringify('第一段正文，应该保持不变。\n<tavern_state_update>{"updates":}</tavern_state_update>')},
  ${JSON.stringify('修复后的另一段正文。\n<tavern_state_update>{"protocol":"tavern.rpg.turn","version":1,"baseRevision":7,"updates":[],"options":[]}</tavern_state_update>')},
  'rpg'
)`, context);
assert.match(mergedRepair, /^第一段正文，应该保持不变。/);
assert.doesNotMatch(mergedRepair, /修复后的另一段正文/);

const rawRepair = JSON.stringify({
  updates: [],
  options: ['调查门厅', '询问守卫', '检查地面', '暂时离开'],
  eventMemory: [],
});
const canonicalRepair = vm.runInContext(`canonicalizeRpgRepairOutput(${JSON.stringify('```json\n' + rawRepair + '\n```')}, 7)`, context);
const canonicalParsed = parse(`保留的原始叙事。\n${canonicalRepair}`);
assert.strictEqual(canonicalParsed.errorCode, null, 'dedicated repair JSON should become the canonical tagged protocol');
assert.strictEqual(canonicalParsed.payload.protocol, 'tavern.rpg.turn');
assert.strictEqual(canonicalParsed.payload.version, 1);
assert.strictEqual(canonicalParsed.payload.baseRevision, 7);
assert.deepStrictEqual(JSON.parse(JSON.stringify(canonicalParsed.payload.options)), ['调查门厅', '询问守卫', '检查地面', '暂时离开']);
const repairTool = JSON.parse(vm.runInContext(`JSON.stringify(buildRpgRepairToolDefinition({ min: 3, max: 4 }))`, context));
assert.strictEqual(repairTool.function.name, 'tavern_rpg_turn_repair');
assert.strictEqual(repairTool.function.parameters.properties.options.minItems, 3);
assert.strictEqual(repairTool.function.parameters.properties.options.maxItems, 4);
assert.deepStrictEqual(repairTool.function.parameters.required, ['updates', 'options']);

const terminalOriginalPayload = {
  protocol: 'tavern.rpg.turn', version: 1, baseRevision: 20,
  updates: [
    { type: 'variable.delta', variableId: 'clues', delta: 1 },
    { type: 'collection.patch', collectionId: 'clue-board', entryId: 'clue-glass-paw', set: { status: 'confirmed' } },
  ],
  options: ['询问旅店老板', '前往北门', '试探碎片反应', '寻找月井女巫'],
};
const terminalRepairedPayload = {
  protocol: 'tavern.rpg.turn', version: 1, baseRevision: 20,
  updates: [
    { type: 'runtime.variable.delta', id: 'clues', delta: 1 },
    { type: 'runtime.collection.patch', collectionId: 'clue-board', entryId: 'clue-glass-paw', set: { status: 'confirmed' } },
  ],
  options: [],
};
const preservedTerminalRepair = vm.runInContext(`(() => { mode = 'rpg'; return preserveValidRpgRepairFields(
  processAIOutput(${JSON.stringify(`调查成功。\n<tavern_state_update>${JSON.stringify(terminalOriginalPayload)}</tavern_state_update>`)}),
  processAIOutput(${JSON.stringify(`调查成功。\n<tavern_state_update>${JSON.stringify(terminalRepairedPayload)}</tavern_state_update>`)}),
  { min: 3, max: 4 },
  20
); })()`, context);
assert.deepStrictEqual(JSON.parse(JSON.stringify(preservedTerminalRepair.options)), terminalOriginalPayload.options, 'repair must retain already-valid current-turn options');
assert.deepStrictEqual(JSON.parse(JSON.stringify(preservedTerminalRepair.patch.updates)), terminalRepairedPayload.updates, 'repair must keep the corrected patch when the original patch shape was invalid');

const pendingTurns = vm.runInContext(`pendingWorldTurnMessages({
  messages: [{ role: 'user', content: '行动' }],
  assistantMessage: { role: 'assistant', content: '正文' },
})`, context);
assert.deepStrictEqual(JSON.parse(JSON.stringify(pendingTurns)).map(message => message.role), ['user', 'assistant']);
assert.match(mergedRepair, /"baseRevision":7/);

const mergedTavernRepair = vm.runInContext(`mergeRepairedReply(
  ${JSON.stringify('酒馆原始正文。')},
  ${JSON.stringify('修复时重写的正文。<tavern_options>["继续"]</tavern_options>')},
  'tavern'
)`, context);
assert.strictEqual(mergedTavernRepair, '酒馆原始正文。\n<tavern_options>["继续"]</tavern_options>');

const normalizedOptions = vm.runInContext("normalizeRpgOptions([{label:'调查码头'}, {text:'调查码头'}, '  离开  ', {title:' 观察潮汐 '}], { min: 2, max: 4 })", context);
assert.deepStrictEqual(JSON.parse(JSON.stringify(normalizedOptions)), ['调查码头', '离开', '观察潮汐']);
const objectOptionPayload = {
  protocol: 'tavern.rpg.turn', version: 1, baseRevision: 22, updates: [],
  options: [
    { label: '去找卡尔德，旁敲侧击他收购红矿的缘由', value: 'talk-calder-ore' },
    { label: '去北门找塞拉芬，谈谈玻璃爪印和碎片', value: 'talk-seraphine-paw' },
    { label: '在旅店休整一夜，恢复法力后再感知', value: 'rest-and-retry' },
    { label: '饮用法力药剂，再试一次深入感知', value: 'drink-and-retry' },
  ],
};
const objectOptionLabels = objectOptionPayload.options.map(option => option.label);
const objectOptionOutput = vm.runInContext(`processAIOutput(${JSON.stringify(`部分成功。\n<tavern_state_update>${JSON.stringify(objectOptionPayload)}</tavern_state_update>`)})`, context);
assert.deepStrictEqual(JSON.parse(JSON.stringify(objectOptionOutput.options)), objectOptionLabels);
assert.deepStrictEqual(JSON.parse(JSON.stringify(objectOptionOutput.patch.options)), objectOptionLabels, 'top-level and patch options must use the same canonical strings');
const discardShardPayload = {
  protocol: 'tavern.rpg.turn', version: 1, baseRevision: 27,
  updates: [{ type: 'collection.remove', collectionId: 'inventory', entryId: 'ember-shard' }],
  options: ['向卡尔德要回碎片', '去北门查看兽爪印', '警告卡尔德', '回房休息'],
  eventMemory: [],
};
const discardShardOutput = vm.runInContext(`processAIOutput(${JSON.stringify(`你丢弃了龙火碎片。\n<tavern_state_update>${JSON.stringify(discardShardPayload)}</tavern_state_update>`)})`, context);
assert.deepStrictEqual(JSON.parse(JSON.stringify(discardShardOutput.patch.updates)), [
  { type: 'runtime.collection.remove', collectionId: 'inventory', entryId: 'ember-shard' },
]);
assert.strictEqual(vm.runInContext(`validateRpgPatchShape(${JSON.stringify(discardShardOutput.patch)})`, context), null);
assert.deepStrictEqual(JSON.parse(JSON.stringify(vm.runInContext("rollWorldDice('1d20+114514')", context))), [], '明显失真的骰子修正不应进入回合');
assert.strictEqual(vm.runInContext('RPG_PROTOCOL_REPAIR_ATTEMPTS', context), 2);
const failedDebugOutput = vm.runInContext(`formatDebugOutput({
  rawOutput: '第二楼的完整正文。',
  outputTag: '本次输出未找到结构化标签。',
  reasoning: '原始 reasoning',
  error: 'options 需要 3-4 个非空字符串',
})`, context);
assert.match(failedDebugOutput, /第二楼的完整正文/);
assert.match(failedDebugOutput, /options 需要 3-4 个非空字符串/);
assert.match(failedDebugOutput, /原始 reasoning/);
assert.match(source, /attempt <= RPG_PROTOCOL_REPAIR_ATTEMPTS/);

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

const optionIntent = vm.runInContext("buildRpgTurnIntent('选择门边的蓝色按钮', { kind: 'option', source: 'option', optionId: 'blue-door' })", context);
assert.deepStrictEqual(JSON.parse(JSON.stringify(optionIntent)), {
  version: 1,
  kind: 'option',
  source: 'option',
  raw: '选择门边的蓝色按钮',
  optionId: 'blue-door',
});

const legacyIntent = normalizeRpgTurnIntent({ raw: '打开门' });
assert.deepStrictEqual(legacyIntent, { raw: '打开门', version: 1, kind: 'text', source: 'input' });
assert.strictEqual(validateActionIntent(legacyIntent), null);
assert.match(validateActionIntent({ ...legacyIntent, source: 'external-script' }), /actionIntent\.source 无效/);
assert.match(validateActionIntent({ ...legacyIntent, unexpected: true }), /actionIntent 含有未声明字段/);

vm.runInContext(`mode = 'rpg'; currentWorldId = 'world-context'; currentWorldSaveId = 'save-context'; worldCards = [{ id: 'world-context', version: 2, title: '上下文测试世界' }]; currentWorldSave = { id: 'save-context', worldId: 'world-context', worldVersion: 2, revision: 4, setup: { status: 'active' }, state: { locationId: 'loc-a', time: { value: 3, unit: 'day' } }, turns: [], eventLedger: [] };`, context);
const agentContext = vm.runInContext(`buildRpgAgentContext({ mode: 'native', maxSteps: 2, tools: { 'context.retrieve': { enabled: true }, 'state.patch': { enabled: true }, 'dice.roll': { enabled: true } } })`, context);
assert.strictEqual(agentContext.protocol, 'tavern.rpg.context');
assert.strictEqual(agentContext.version, 1);
assert.deepStrictEqual(JSON.parse(JSON.stringify(agentContext.scope)), { worldId: 'world-context', worldVersion: 2, saveId: 'save-context', revision: 4 });
assert.deepStrictEqual(JSON.parse(JSON.stringify(agentContext.action)), { intent: null, pending: false });
assert.deepStrictEqual(JSON.parse(JSON.stringify(agentContext.tools.enabled)), ['context.retrieve', 'state.patch', 'dice.roll']);
assert.deepStrictEqual(JSON.parse(JSON.stringify(agentContext.tools.readOnly)), ['context.retrieve']);
assert.deepStrictEqual(JSON.parse(JSON.stringify(agentContext.tools.candidateOnly)), ['state.patch']);
assert.strictEqual(agentContext.tools.diceSource, 'client');

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
const validCollectionPatch = vm.runInContext(`validateRpgPatchShape(${JSON.stringify({
  protocol: 'tavern.rpg.turn', version: 1, baseRevision: 7, updates: [
    { type: 'runtime.collection.patch', collectionId: 'inventory', entryId: 'bread', set: { label: '面包' }, delta: { count: -1 },
    },
  ], options: [],
})})`, context);
assert.strictEqual(validCollectionPatch, null);
const malformedCollectionPatch = vm.runInContext(`validateRpgPatchShape(${JSON.stringify({
  protocol: 'tavern.rpg.turn', version: 1, baseRevision: 7, updates: [
    { type: 'runtime.collection.patch', collectionId: 'inventory', entryId: 'bread', delta: { count: -1 }, unexpected: true },
  ], options: [],
})})`, context);
assert.match(malformedCollectionPatch, /patch\.runtime\.collection\.patch 含有未声明字段 unexpected/);
const flattenedCollectionAdd = vm.runInContext(`validateRpgPatchShape(${JSON.stringify({
  protocol: 'tavern.rpg.turn', version: 1, baseRevision: 7, updates: [
    { type: 'runtime.collection.add', collectionId: 'clue-board', title: '爪印与碎片吻合', status: 'confirmed' },
  ], options: [],
})})`, context);
assert.match(flattenedCollectionAdd, /必须把新增条目放进 value 对象/);
const collectionAddWithoutId = vm.runInContext(`validateRpgPatchShape(${JSON.stringify({
  protocol: 'tavern.rpg.turn', version: 1, baseRevision: 7, updates: [
    { type: 'runtime.collection.add', collectionId: 'clue-board', value: { title: '爪印与碎片吻合', status: 'confirmed' } },
  ], options: [],
})})`, context);
assert.match(collectionAddWithoutId, /value\.id 必填/);
const validCollectionAdd = vm.runInContext(`validateRpgPatchShape(${JSON.stringify({
  protocol: 'tavern.rpg.turn', version: 1, baseRevision: 7, updates: [
    { type: 'runtime.collection.add', collectionId: 'clue-board', value: { id: 'clue-paw-match', title: '爪印与碎片吻合', status: 'confirmed' } },
  ], options: [],
})})`, context);
assert.strictEqual(validCollectionAdd, null);

const runtimeWorld = {
  runtime: {
    version: 1,
    variables: [{ id: 'trust', label: '信任', type: 'number', min: 0, max: 100, initial: 10 }],
    collections: [{
      id: 'inventory', label: '物品', entrySchema: {
        type: 'object', properties: {
          id: { type: 'string' }, count: { type: 'number', min: 0, max: 99 },
          label: { type: 'string' },
        }, required: ['id', 'count'], additionalProperties: false,
      }, initial: [{ id: 'bread', count: 3, label: '口粮' }],
    }],
    actions: [{
      id: 'eat-bread', label: '食用口粮', inputs: [],
      effects: [{ type: 'collection.patch', collectionId: 'inventory', entryId: 'bread', delta: { count: -1 } }],
    }, {
      id: 'rename-bread', label: '标记口粮', inputs: [{ id: 'label', label: '名称', type: 'string', required: true }],
      effects: [{ type: 'collection.patch', collectionId: 'inventory', entryId: 'bread', set: { label: '{{input.label}}' } }],
    }],
  },
};
const runtimePatch = {
  protocol: 'tavern.rpg.turn', version: 1, baseRevision: 0,
  updates: [
    { type: 'runtime.variable.delta', id: 'trust', delta: 2 },
    { type: 'runtime.collection.patch', collectionId: 'inventory', entryId: 'bread', delta: { count: -1 }, set: { label: '口粮（已拆封）' } },
  ], options: [],
};
assert.strictEqual(validateRpgPatch(runtimePatch), null);
const runtimeState = applyRpgPatch(runtimeWorld, { runtime: materializeWorldRuntimeState(runtimeWorld.runtime) }, runtimePatch);
assert.strictEqual(runtimeState.error, undefined);
assert.strictEqual(runtimeState.state.runtime.variables.trust, 12);
assert.strictEqual(runtimeState.state.runtime.collections.inventory[0].count, 2);
const actionState = applyRpgPatch(runtimeWorld, runtimeState.state, {
  protocol: 'tavern.rpg.turn', version: 1, baseRevision: 1,
  updates: [{ type: 'runtime.action.execute', actionId: 'eat-bread', input: {} }], options: [],
});
assert.strictEqual(actionState.error, undefined);
assert.strictEqual(actionState.state.runtime.collections.inventory[0].count, 1, 'declared action must apply its collection effect');
const templatedActionState = applyRpgPatch(runtimeWorld, actionState.state, {
  protocol: 'tavern.rpg.turn', version: 1, baseRevision: 2,
  updates: [{ type: 'runtime.action.execute', actionId: 'rename-bread', input: { label: '旅途口粮' } }], options: [],
});
assert.strictEqual(templatedActionState.error, undefined);
assert.strictEqual(templatedActionState.state.runtime.collections.inventory[0].label, '旅途口粮', 'action input should bind to declared effects');
assert.match(validateRpgPatch({ ...runtimePatch, updates: [{ type: 'runtime.collection.patch', collectionId: 'inventory', entryId: 'bread', delta: { count: 'nope' } }] }), /有限数字/);

context.fetch = () => { throw new Error('world dice must not call /api/dice'); };
const localDice = vm.runInContext("rollWorldDice('1d6')", context);
assert.strictEqual(localDice.length, 1);
assert.strictEqual(localDice[0].expr, '1d6');
assert.ok(localDice[0].total >= 1 && localDice[0].total <= 6);

(async () => {
  const structuredArgs = {
    updates: [{ type: 'runtime.collection.add', collectionId: 'clue-board', value: { id: 'clue-paw-match', title: '爪印与碎片吻合', status: 'confirmed' } }],
    options: ['查看门锁', '询问向导', '检查脚印', '原路返回'],
    eventMemory: [],
  };
  const structuredResponse = {
    choices: [{ message: {
      content: null,
      tool_calls: [{ id: 'repair-1', type: 'function', function: { name: 'tavern_rpg_turn_repair', arguments: JSON.stringify(structuredArgs) } }],
    } }],
  };
  vm.runInContext(`repairRequests = []; currentWorldSave = { revision: 9 }; callAPI = async request => {
    repairRequests.push(cloneValue(request));
    if (request.body.thinking?.type !== 'disabled') throw new Error('DeepSeek V4 thinking mode rejects forced tool_choice');
    return ${JSON.stringify(structuredResponse)};
  };`, context);
  const structuredRepair = await vm.runInContext(`repairRpgOutput({ baseUrl: 'https://api.deepseek.com', body: { model: 'deepseek-v4-flash', max_tokens: 1024, thinking: { type: 'enabled' }, reasoning_effort: 'high' } }, '原始叙事草稿。', { min: 4, max: 4 }, null)`, context);
  const structuredParsed = parse(`原始叙事草稿。\n${structuredRepair}`);
  assert.strictEqual(structuredParsed.payload.baseRevision, 9);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(structuredParsed.payload.options)), structuredArgs.options);
  assert.strictEqual(vm.runInContext(`validateRpgPatchShape(${JSON.stringify(structuredParsed.payload)})`, context), null);
  assert.strictEqual(context.repairRequests.length, 1, 'DeepSeek repair should stay on the forced structured request');
  assert.strictEqual(context.repairRequests[0].body.thinking.type, 'disabled');
  assert.strictEqual(context.repairRequests[0].body.tool_choice.function.name, 'tavern_rpg_turn_repair');
  assert.strictEqual(context.repairRequests[0].body.tools.length, 1);
  assert.match(context.repairRequests[0].body.messages[1].content, /runtime\.collection\.add 必须使用/);
  assert.match(context.repairRequests[0].body.messages[1].content, /"value":\{"id":"stable-entry-id"/);

  const jsonFallbackArgs = {
    updates: [],
    options: ['查看余烬', '询问卡尔德', '返回旅店'],
  };
  vm.runInContext(`repairRequests = []; callAPI = async request => {
    repairRequests.push(cloneValue(request));
    if (repairRequests.length === 1) return { choices: [{ message: { content: '' } }] };
    return { choices: [{ message: { content: ${JSON.stringify(JSON.stringify(jsonFallbackArgs))} } }] };
  };`, context);
  const jsonFallbackRepair = await vm.runInContext(`repairRpgOutput({ baseUrl: 'https://api.deepseek.com', body: { model: 'deepseek-v4-flash', max_tokens: 1024 } }, '原始叙事草稿。', { min: 3, max: 4 }, null)`, context);
  const jsonFallbackParsed = parse(`原始叙事草稿。\n${jsonFallbackRepair}`);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(jsonFallbackParsed.payload.options)), jsonFallbackArgs.options);
  assert.strictEqual(context.repairRequests.length, 2);
  assert.strictEqual(context.repairRequests[1].body.response_format.type, 'json_object');
  assert.strictEqual(context.repairRequests[1].body.tools, undefined);
  assert.strictEqual(context.repairRequests[1].body.tool_choice, undefined);
  assert.match(context.repairRequests[1].body.messages[1].content, /JSON 示例/);
  console.log('rpg protocol parser check passed');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
