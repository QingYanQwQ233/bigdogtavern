'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('public/app.js', 'utf8').replace(/\ninit\(\);\s*$/, '');
const state = { calls: 0, requests: [], previewFrames: [] };
const context = vm.createContext({
  console,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  window: {}, document: { getElementById: () => null, querySelectorAll: () => [] }, Date, Math, JSON, Set, Map, TextDecoder, setTimeout,
  fetch: async (url, options) => {
    state.calls += 1;
    state.requests.push(JSON.parse(options.body));
    const contents = [
      '需要判定。\n<tavern_state_update>{"toolCalls":[{"callId":"check-1","name":"rules.check","arguments":{"ruleId":"notice"}},{"callId":"roll-1","name":"dice.roll","arguments":{"expr":"1d20"}}],"updates":[],"options":[]}</tavern_state_update>',
      '需要判定。\n你成功发现了脚印，决定谨慎绕开。\n<tavern_state_update>{"updates":[],"options":[]}</tavern_state_update>',
    ];
    const content = contents[state.calls - 1];
    assert.ok(content, 'compat loop must stop after final narrative');
    const line = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`;
    let used = false;
    return { ok: true, body: { getReader: () => ({ read: async () => used ? { done: true } : (used = true, { done: false, value: new TextEncoder().encode(line) }) }) } };
  },
  TextEncoder,
  previewFrames: state.previewFrames,
});
vm.runInContext(source, context);

vm.runInContext(`
  mode = 'rpg';
  worldModeActive = () => true;
  currentWorldCard = () => ({ rules: { checks: [{ id: 'notice', label: '观察告知', description: '观察附近脚印。', roll: '1d20', target: 12, modifier: 2 }] }, conflicts: [] });
  currentWorldSave = { id: 'save-compat', revision: 4, state: {} };
  updateTypingContent = text => previewFrames.push(String(text));
  setResponsePreview = text => previewFrames.push(String(text));
  setDebugTrace = () => {};
  rollWorldDice = async expr => [{ expr, rolls: [15], bonus: 0, total: 15 }];
`, context);

const compatDefinitions = vm.runInContext(`buildRpgNativeToolDefinitions({ mode: 'tool-candidate', tools: { 'dice.roll': { enabled: true, parameters: { type: 'object' } } } })`, context);
assert.strictEqual(compatDefinitions.length, 1, 'compat profile must still expose tool schemas to the prompt builder');

const result = vm.runInContext(`requestRpgAgentReply({
  body: { stream: true, messages: [{ role: 'system', content: 'test' }] },
  agentProfile: {
    protocol: 'tavern.rpg.agent', version: 1, mode: 'tool-candidate', maxSteps: 2,
    tools: {
      'rules.check': { enabled: true }, 'dice.roll': { enabled: true },
      'state.patch': { enabled: true }, 'entity.create': { enabled: true },
      'memory.record': { enabled: true }, 'context.retrieve': { enabled: true },
    },
  },
  nativeTools: [{ type: 'function', function: { name: 'dice_roll' } }],
}, null)`, context);

Promise.resolve(result).then(async value => {
  assert.strictEqual(state.calls, 2, 'compat Agent must resume with a second model request');
  assert.match(value.reply, /成功发现了脚印/);
  assert.match(value.reply, /需要判定/);
  assert.strictEqual(value.session.previewNarrative, '需要判定。\n你成功发现了脚印，决定谨慎绕开。', 'repeated narrative prefixes must be merged once');
  assert.strictEqual(value.toolTrace.length, 2);
  assert.strictEqual(value.toolTrace[0].name, 'rules.check');
  assert.strictEqual(value.toolTrace[0].result.proposal.roll, '1d20');
  assert.strictEqual(value.toolTrace[0].result.proposal.target, 12);
  assert.strictEqual(value.toolTrace[0].result.proposal.modifier, 2);
  assert.strictEqual(value.toolTrace[1].name, 'dice.roll');
  assert.strictEqual(value.toolTrace[1].result.rolls[0].total, 15);
  assert.strictEqual(value.toolTrace[1].result.resolution.grade, 'success');
  assert.strictEqual(value.toolTrace[1].result.resolution.total, 17);
  assert.ok(value.session && value.session.events.some(event => event.type === 'tool.call'), 'compat session must record tool calls');
  assert.ok(value.session.events.some(event => event.type === 'tool.result'), 'compat session must record tool results');
  assert.ok(value.session.events.some(event => event.type === 'turn.complete'), 'compat session must close the turn');
  assert.strictEqual(value.session.checkpoints.length, 1, 'dice feedback must be stored with the Agent turn');
  assert.strictEqual(value.session.checkpoints[0].offset, '需要判定。'.length, 'dice feedback must keep the narrative offset where the tool was called');
  assert.strictEqual(value.session.checkpoints[0].completed, true);
  assert.ok(state.previewFrames.some(frame => frame.includes('需要判定。')), 'later stream steps must retain earlier narrative preview');
  assert.ok(!Object.hasOwn(state.requests[0].body, 'tools'), 'compat request must not send native tools');
  assert.match(state.requests[1].body.messages.at(-1).content, /tavern\.rpg\.agent\.tool_result/);
  assert.match(state.requests[1].body.messages.at(-1).content, /"target":12/);
  vm.runInContext(`currentWorldSave = { state: { player: { attributes: { insight: 5 } } } };`, context);
  assert.strictEqual(vm.runInContext(`rpgCheckModifierValue({ bucket: 'attributes', id: 'insight', factor: 1, bonus: 1 })`, context), 6);
  const modifierProfile = {
    mode: 'tool-candidate',
    tools: { 'rules.check': { enabled: true }, 'dice.roll': { enabled: true } },
  };
  const explicit = await vm.runInContext(`(async () => {
    currentWorldCard = () => ({ rules: { checks: [{ id: 'insight', label: '洞察', roll: '1d20', target: 10, modifier: { bucket: 'attributes', id: 'insight' } }] } });
    currentWorldSave = { state: { player: { attributes: { insight: 6 } } } };
    rollWorldDice = async expr => [{ expr, rolls: [10], bonus: 0, total: 10 }];
    return executeRpgNativeToolCalls([
      { callId: 'check-2', name: 'rules.check', arguments: { ruleId: 'insight' } },
      { callId: 'roll-2', name: 'dice.roll', arguments: { expr: '1d20', modifier: { bucket: 'attributes', id: 'insight' } } },
    ], ${JSON.stringify(modifierProfile)}, null, { world: { rules: { checks: [{ id: 'insight', label: '洞察', roll: '1d20', target: 10, modifier: { bucket: 'attributes', id: 'insight' } }] } }, save: { state: { player: { attributes: { insight: 6 } } } } }, {});
  })()`, context);
  assert.strictEqual(explicit.trace[1].result.modifier, 6);
  assert.strictEqual(explicit.trace[1].result.resolution.total, 16);
  const inline = await vm.runInContext(`executeRpgNativeToolCalls([
    { callId: 'check-3', name: 'rules.check', arguments: { ruleId: 'insight' } },
    { callId: 'roll-3', name: 'dice.roll', arguments: { expr: '1d20+1', modifier: { bucket: 'attributes', id: 'insight' } } },
  ], ${JSON.stringify(modifierProfile)}, null, { world: { rules: { checks: [{ id: 'insight', label: '洞察', roll: '1d20', target: 10, modifier: { bucket: 'attributes', id: 'insight' } }] } }, save: { state: { player: { attributes: { insight: 6 } } } } }, {});`, context);
  assert.match(inline.trace[1].result.error, /基础骰式/);
  const rationAction = {
    id: 'eat-ration', label: '食用旅行口粮',
    availability: [{ type: 'collection.number', collectionId: 'inventory', entryId: 'travel-ration', field: 'count', operator: '>', value: 0 }],
  };
  const unavailable = await vm.runInContext(`executeRpgNativeToolCalls([
    { callId: 'ration-1', name: 'runtime.action.execute', arguments: { actionId: 'eat-ration', input: {} } },
  ], { mode: 'tool-candidate', tools: { 'runtime.action.execute': { enabled: true } } }, null, {
    world: { runtime: { actions: [${JSON.stringify(rationAction)}] } },
    save: { state: { runtime: { collections: { inventory: [{ id: 'travel-ration', label: '旅行口粮', count: 0 }] }, variables: {} } } },
  }, {});`, context);
  assert.strictEqual(unavailable.accepted.length, 0, '库存为零的动作不能进入提交候选');
  assert.strictEqual(unavailable.trace[0].result.ok, false, '库存为零必须以工具结果告知 Agent，而非让回合提交失败');
  assert.match(unavailable.trace[0].result.error, /当前值 0/);
  const forgedAction = await vm.runInContext(`executeRpgNativeToolCalls([
    { callId: 'forged-action', name: 'state.patch', arguments: { updates: [{ type: 'runtime.action.execute', actionId: 'retrieve-ember-from-fire' }] } },
  ], { mode: 'tool-candidate', tools: { 'state.patch': { enabled: true } } }, null, {
    world: { runtime: { actions: [] } }, save: { state: { runtime: { collections: {}, variables: {} } } },
  }, {});`, context);
  assert.strictEqual(forgedAction.accepted.length, 0, 'state.patch 不能绕过独立的 runtime.action.execute 工具');
  assert.strictEqual(forgedAction.trace[0].result.ok, false, '伪造动作必须作为工具结果返回 Agent');
  assert.match(forgedAction.trace[0].result.error, /state\.patch 不得包含 runtime\.action\.execute/);
  const directRuntimePatch = await vm.runInContext(`executeRpgNativeToolCalls([
    { callId: 'retrieve-ember', name: 'state.patch', arguments: { updates: [{ type: 'runtime.collection.patch', collectionId: 'inventory', entryId: 'ember-shard', set: { count: 1 } }] } },
  ], { mode: 'tool-candidate', tools: { 'state.patch': { enabled: true } } }, null, {
    world: { runtime: { actions: [], collections: [{ id: 'inventory' }] } }, save: { state: { runtime: { collections: { inventory: [{ id: 'ember-shard', count: 0 }] }, variables: {} } } },
  }, {});`, context);
  assert.strictEqual(directRuntimePatch.accepted.length, 1, '没有声明动作时，已声明的 collection patch 仍可作为正常候选');
  const undeclaredActionPatch = vm.runInContext(`validateRpgPatchRuntimeActions({ protocol: 'tavern.rpg.turn', version: 1, baseRevision: 5, updates: [{ type: 'runtime.action.execute', actionId: 'retrieve-ember-from-fire' }] })`, context);
  assert.match(undeclaredActionPatch, /未声明动作 retrieve-ember-from-fire/, '最终标签也必须在提交前拦截未声明动作');
  const unavailablePrompt = vm.runInContext(`(() => {
    mode = 'rpg';
    currentWorldSaveId = 'save-ration';
    currentWorldSave = { id: 'save-ration', revision: 5, turns: [], state: { runtime: { collections: { inventory: [{ id: 'travel-ration', label: '旅行口粮', count: 0 }] }, variables: {} } } };
    currentWorldCard = () => ({ id: 'ration-world', version: 1, title: '测试世界', runtime: { actions: [${JSON.stringify(rationAction)}] }, turnContract: { options: { min: 0, max: 4 } } });
    worldModeActive = () => true;
    return buildRpgPromptPart();
  })()`, context);
  assert.match(unavailablePrompt, /当前不可用 Runtime 动作/);
  assert.match(unavailablePrompt, /当前值 0/);
  assert.match(unavailablePrompt, /state\.patch 工具时，updates 不得包含 runtime\.action\.execute/);
  const middle = vm.runInContext(`renderRpgNarrativeWithCheckpoints('开头\\n中间\\n结尾', [{ id: 'middle', offset: 3, expr: '1d20', completed: true, roll: { expr: '1d20', total: 12 }, resolution: { grade: 'success', label: '成功', roll: '1d20', total: 12, target: 10 } }], { streaming: true }).html`, context);
  assert.ok(middle.indexOf('开头') < middle.indexOf('data-rpg-checkpoint') && middle.indexOf('data-rpg-checkpoint') < middle.indexOf('中间'), 'middle dice feedback must stay between the surrounding prose');
  const opening = vm.runInContext(`renderRpgNarrativeWithCheckpoints('第一段', [{ id: 'opening', offset: 0, expr: '1d20', completed: true }], { streaming: true }).html`, context);
  assert.ok(opening.indexOf('data-rpg-checkpoint') < opening.indexOf('第一段'), 'opening dice feedback must stay before the first prose segment');
  console.log('rpg compat agent loop check passed');
}).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
