'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('public/app.js', 'utf8').replace(/\ninit\(\);\s*$/, '');
const state = { calls: 0, requests: [] };
const context = vm.createContext({
  console,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  window: {}, document: {}, Date, Math, JSON, Set, Map, TextDecoder,
  fetch: async (url, options) => {
    state.calls += 1;
    state.requests.push(JSON.parse(options.body));
    const contents = [
      '需要判定。\n<tavern_state_update>{"toolCalls":[{"callId":"check-1","name":"rules.check","arguments":{"ruleId":"notice"}},{"callId":"roll-1","name":"dice.roll","arguments":{"expr":"1d20+2"}}],"updates":[],"options":[]}</tavern_state_update>',
      '你成功发现了脚印，决定谨慎绕开。\n<tavern_state_update>{"updates":[],"options":[]}</tavern_state_update>',
    ];
    const content = contents[state.calls - 1];
    assert.ok(content, 'compat loop must stop after final narrative');
    const line = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`;
    let used = false;
    return { ok: true, body: { getReader: () => ({ read: async () => used ? { done: true } : (used = true, { done: false, value: new TextEncoder().encode(line) }) }) } };
  },
  TextEncoder,
});
vm.runInContext(source, context);

vm.runInContext(`
  mode = 'rpg';
  worldModeActive = () => true;
  currentWorldCard = () => ({ rules: { checks: ['notice'] }, conflicts: [] });
  currentWorldSave = { id: 'save-compat', revision: 4, state: {} };
  updateTypingContent = () => {};
  setDebugTrace = () => {};
  rollWorldDice = async expr => [{ expr, rolls: [15], bonus: 2, total: 17 }];
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

Promise.resolve(result).then(value => {
  assert.strictEqual(state.calls, 2, 'compat Agent must resume with a second model request');
  assert.match(value.reply, /成功发现了脚印/);
  assert.strictEqual(value.toolTrace.length, 2);
  assert.strictEqual(value.toolTrace[0].name, 'rules.check');
  assert.strictEqual(value.toolTrace[1].name, 'dice.roll');
  assert.strictEqual(value.toolTrace[1].result.rolls[0].total, 17);
  assert.ok(!Object.hasOwn(state.requests[0].body, 'tools'), 'compat request must not send native tools');
  assert.match(state.requests[1].body.messages.at(-1).content, /tavern\.rpg\.agent\.tool_result/);
  console.log('rpg compat agent loop check passed');
}).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
