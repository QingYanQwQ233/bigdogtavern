/* Native Agent contract smoke check: no browser or network required. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const defaults = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', '_defaults.json'), 'utf8'));
const agent = defaults.rpg.agent;
assert.strictEqual(agent.protocol, 'tavern.rpg.agent');
assert.strictEqual(agent.mode, 'native');
assert.ok(Number.isInteger(agent.maxSteps) && agent.maxSteps >= 1 && agent.maxSteps <= 8);
const names = Object.keys(agent.tools);
assert.deepStrictEqual(names.sort(), ['context.retrieve', 'dice.roll', 'entity.create', 'memory.record', 'rules.check', 'state.patch'].sort());
for (const [name, config] of Object.entries(agent.tools)) {
  assert.strictEqual(config.enabled, true, `${name} disabled unexpectedly`);
  assert.ok(config.parameters && config.parameters.type === 'object', `${name} needs an object schema`);
  assert.ok(!Object.prototype.hasOwnProperty.call(config, 'handler'), `${name} must not inject executable handlers`);
}
const wireNames = names.map(name => name.replace(/[^a-zA-Z0-9_-]/g, '_'));
assert.ok(wireNames.every(name => /^[a-zA-Z0-9_-]+$/.test(name)), 'wire tool names must satisfy OpenAI function-name rules');

const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
for (const marker of [
  'function mergeNativeToolCall',
  'function parseNativeToolArguments',
  'async function requestRpgAgentReply',
  "body.tool_choice = 'auto'",
  "call?.name !== 'context.retrieve'",
  'maxSteps',
]) assert.ok(app.includes(marker), `missing Agent marker: ${marker}`);

console.log('rpg native agent contract check passed');
