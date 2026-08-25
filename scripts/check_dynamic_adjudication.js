'use strict';

const assert = require('assert');
const fs = require('fs');
const { applyRpgPatch, materializeWorldRuntimeState, buildAgentCheckResolutions, validateAgentPhaseContract } = require('../server');

const world = {
  runtime: {
    version: 1,
    variables: [{ id: 'alert', label: '警戒', type: 'number', min: 0, max: 10, initial: 0 }],
    collections: [{
      id: 'inventory', label: '物品',
      entrySchema: { type: 'object', properties: { id: { type: 'string' }, count: { type: 'number', min: 0, max: 9 } }, required: ['id', 'count'], additionalProperties: false },
      initial: [{ id: 'ration', count: 1 }],
    }],
    actions: [{
      id: 'eat-ration', label: '食用口粮',
      availability: [{ type: 'collection.number', collectionId: 'inventory', entryId: 'ration', field: 'count', operator: '>', value: 0 }],
      effects: [{ type: 'collection.patch', collectionId: 'inventory', entryId: 'ration', delta: { count: -1 } }],
    }, {
      id: 'inspect-seal', label: '检视封印',
      check: {
        sides: 20,
        target: 15,
        modifiers: [{ source: 'player', bucket: 'attributes', id: 'insight' }],
      },
      effects: [{ type: 'variable.delta', variableId: 'alert', delta: 1 }],
    }, {
      id: 'cast-ward', label: '施放护符',
      check: {
        sides: 20,
        target: 12,
        modifiers: [{ source: 'player', bucket: 'skills', id: 'arcana' }],
      },
      effects: [{ type: 'variable.delta', variableId: 'alert', delta: 2 }],
    }],
  },
};

const state = {
  player: { attributes: { insight: 6 }, skills: { arcana: 4 } },
  runtime: materializeWorldRuntimeState(world.runtime),
};

const modifiers = [
  { source: 'player', bucket: 'attributes', id: 'insight' },
  { source: 'constant', bonus: 1 },
];
const check = buildAgentCheckResolutions(world, [
  { callId: 'check-1', name: 'rules.check', result: { ok: true, proposal: { id: 'dynamic:inspect', dynamic: true, actionId: 'inspect', roll: '1d20', target: 15, modifierRules: modifiers } } },
  { callId: 'roll-1', name: 'dice.roll', arguments: { expr: '1d20', modifiers }, result: { ok: true, rolls: [{ expr: '1d20', total: 10 }] } },
], { dice: [{ expr: '1d20', rolls: [10], total: 10 }] }, state);
assert.strictEqual(check.error, undefined);
assert.strictEqual(check.resolutions[0].modifier, 7);
assert.strictEqual(check.resolutions[0].total, 17);
assert.strictEqual(check.resolutions[0].source, 'agent.dynamic');

const inspectModifiers = [{ source: 'player', bucket: 'attributes', id: 'insight' }];
const inspectCheck = buildAgentCheckResolutions(world, [
  { name: 'rules.check', result: { ok: true, proposal: { id: 'dynamic:inspect-seal', dynamic: true, actionId: 'inspect-seal', roll: '1d20', target: 15, modifierRules: inspectModifiers } } },
  { name: 'dice.roll', arguments: { expr: '1d20', modifiers: inspectModifiers }, result: { ok: true, rolls: [{ expr: '1d20', total: 10 }] } },
], { dice: [{ expr: '1d20', rolls: [10], total: 10 }] }, state);
assert.strictEqual(inspectCheck.error, undefined);
assert.strictEqual(inspectCheck.resolutions[0].actionId, 'inspect-seal');
assert.strictEqual(inspectCheck.resolutions[0].total, 16);
const inspected = applyRpgPatch(world, state, { baseRevision: 0, updates: [{ type: 'runtime.action.execute', actionId: 'inspect-seal', input: {} }] }, { checkResolutions: inspectCheck.resolutions });
assert.strictEqual(inspected.error, undefined);
assert.strictEqual(inspected.state.runtime.variables.alert, 1);
const noCheck = applyRpgPatch(world, state, { baseRevision: 0, updates: [{ type: 'runtime.action.execute', actionId: 'inspect-seal', input: {} }] });
assert.match(noCheck.error, /需要先完成判定/);
const failedInspect = buildAgentCheckResolutions(world, [
  { name: 'rules.check', result: { ok: true, proposal: { id: 'dynamic:inspect-seal', dynamic: true, actionId: 'inspect-seal', roll: '1d20', target: 15, modifierRules: inspectModifiers } } },
  { name: 'dice.roll', arguments: { expr: '1d20', modifiers: inspectModifiers }, result: { ok: true, rolls: [{ expr: '1d20', total: 5 }] } },
], { dice: [{ expr: '1d20', rolls: [5], total: 5 }] }, state);
assert.strictEqual(failedInspect.resolutions[0].total, 11);
const failedApply = applyRpgPatch(world, state, { baseRevision: 0, updates: [{ type: 'runtime.action.execute', actionId: 'inspect-seal', input: {} }] }, { checkResolutions: failedInspect.resolutions });
assert.match(failedApply.error, /判定失败/);
assert.strictEqual(failedApply.state, undefined);

const skillModifiers = [{ source: 'player', bucket: 'skills', id: 'arcana' }];
const skillCheck = buildAgentCheckResolutions(world, [
  { name: 'rules.check', result: { ok: true, proposal: { id: 'dynamic:cast-ward', dynamic: true, actionId: 'cast-ward', roll: '1d20', target: 12, modifierRules: skillModifiers } } },
  { name: 'dice.roll', arguments: { expr: '1d20', modifiers: skillModifiers }, result: { ok: true, rolls: [{ expr: '1d20', total: 10 }] } },
], { dice: [{ expr: '1d20', rolls: [10], total: 10 }] }, state);
assert.strictEqual(skillCheck.error, undefined);
assert.strictEqual(skillCheck.resolutions[0].modifier, 4);
assert.strictEqual(skillCheck.resolutions[0].total, 14);
const skillUsed = applyRpgPatch(world, state, { baseRevision: 0, updates: [{ type: 'runtime.action.execute', actionId: 'cast-ward', input: {} }] }, { checkResolutions: skillCheck.resolutions });
assert.strictEqual(skillUsed.error, undefined);
assert.strictEqual(skillUsed.state.runtime.variables.alert, 2);

const first = applyRpgPatch(world, state, { baseRevision: 0, updates: [{ type: 'runtime.action.execute', actionId: 'eat-ration', input: {} }] });
assert.strictEqual(first.error, undefined);
assert.strictEqual(first.state.runtime.collections.inventory[0].count, 0);
const rejected = applyRpgPatch(world, first.state, { baseRevision: 1, updates: [{ type: 'runtime.action.execute', actionId: 'eat-ration', input: {} }] });
assert.match(rejected.error, /当前不可用/);
assert.strictEqual(rejected.state, undefined, 'rejected patch must not return a partially applied state');
assert.strictEqual(first.state.runtime.collections.inventory[0].count, 0, 'availability rejection must not partially apply effects');

const demo = JSON.parse(fs.readFileSync('docs/demo-gameplay-fog-harbor.tavern-world.json', 'utf8')).content.world;
const demoState = { runtime: materializeWorldRuntimeState(demo.runtime) };
const demoUse = applyRpgPatch(demo, demoState, { baseRevision: 0, updates: [{ type: 'runtime.action.execute', actionId: 'use-field-ration', input: {} }] });
assert.strictEqual(demoUse.error, undefined, 'demo item action should be executable while the item exists');
assert.strictEqual(demoUse.state.runtime.collections.inventory.find(item => item.id === 'field-rations').count, 1);
const skillModifiersDemo = [{ source: 'player', bucket: 'skills', id: 'survival' }];
const demoSkillCheck = buildAgentCheckResolutions(demo, [
  { name: 'rules.check', result: { ok: true, proposal: { id: 'dynamic:read-tide-signal', dynamic: true, actionId: 'read-tide-signal', roll: '1d20', target: 12, modifierRules: skillModifiersDemo } } },
  { name: 'dice.roll', arguments: { expr: '1d20', modifiers: skillModifiersDemo }, result: { ok: true, rolls: [{ expr: '1d20', total: 10 }] } },
], { dice: [{ expr: '1d20', rolls: [10], total: 10 }] }, { ...demoState, player: { skills: { survival: 3 } } });
assert.strictEqual(demoSkillCheck.error, undefined, 'demo skill check should resolve');
const demoSkillUse = applyRpgPatch(demo, { ...demoState, player: { skills: { survival: 3 } } }, { baseRevision: 0, updates: [{ type: 'runtime.action.execute', actionId: 'read-tide-signal', input: {} }] }, { checkResolutions: demoSkillCheck.resolutions });
assert.strictEqual(demoSkillUse.error, undefined, 'demo skill action should execute after a successful check');
assert.strictEqual(demoSkillUse.state.runtime.variables.evidence, 1);
assert.strictEqual(validateAgentPhaseContract([
  { callId: 'check', name: 'rules.check', phase: 'guard', result: { ok: true } },
  { callId: 'roll', name: 'dice.roll', phase: 'guard', result: { ok: true } },
  { callId: 'action', name: 'runtime.action.execute', phase: 'commit', result: { ok: true } },
]), null, 'runtime action must be accepted as a commit-phase Agent tool');
const demoUnknown = applyRpgPatch(demo, demoUse.state, { baseRevision: 1, updates: [{ type: 'runtime.action.execute', actionId: 'missing-item', input: {} }] });
assert.match(demoUnknown.error, /未声明动作/);
const demoUseAgain = applyRpgPatch(demo, demoUse.state, { baseRevision: 1, updates: [
  { type: 'runtime.action.execute', actionId: 'use-field-ration', input: {} },
  { type: 'runtime.action.execute', actionId: 'use-field-ration', input: {} },
] });
assert.match(demoUseAgain.error, /当前不可用/);
assert.strictEqual(demoUseAgain.state, undefined, 'demo unavailable item action must remain atomic');

console.log('check_dynamic_adjudication: ok');
