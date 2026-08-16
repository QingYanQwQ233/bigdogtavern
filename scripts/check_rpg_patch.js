'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-rpg-patch-'));
const defaults = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', '_defaults.json'), 'utf8'));
const testWorld = defaults.worlds.find(world => Array.isArray(world.npcs) && world.npcs.length) || defaults.worlds[0];
testWorld.start = {
  ...(testWorld.start || {}),
  openingMode: 'static',
  initialState: { ...(testWorld.start?.initialState || {}), activeHooks: [{ id: 'opening-hook', title: '确认北门情况', description: '检查北门的异常动静。', optional: true, status: 'active', source: 'test' }] },
};
const testNpc = testWorld.npcs?.[0];
assert.ok(testNpc?.id, 'test world needs an NPC');
testNpc.actions = [{ id: 'patrol', title: '开始巡逻', description: 'NPC 开始巡逻。', trigger: { afterTurns: 1 }, changes: { statusAdd: ['巡逻中'], relationDelta: 1 } }];
fs.writeFileSync(path.join(tempDir, '_defaults.json'), JSON.stringify(defaults));
fs.writeFileSync(path.join(tempDir, 'worlds.json'), JSON.stringify(defaults.worlds));
process.env.TAVERN_DATA_DIR = tempDir;

const { server, startServer } = require(path.join(root, 'server.js'));

async function request(base, pathname, body, method = 'POST') {
  const response = await fetch(base + pathname, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { response, body: await response.json().catch(() => null) };
}

async function main() {
  try {
    await startServer(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const world = (await request(base, `/api/worlds/${testWorld.id}?version=1`, undefined, 'GET')).body;
    const player = {
      fields: Object.fromEntries((world.playerCreation.fields || []).map(field => [field.id, field.id === 'name' ? 'patch-player' : field.default ?? (field.options?.[0]?.value || (field.required ? 'test' : ''))])),
      attributes: Object.fromEntries((world.playerCreation.attributes || []).map(definition => [definition.id, definition.default ?? definition.min ?? 0])),
      skills: Object.fromEntries((world.playerCreation.skills || []).map(definition => [definition.id, definition.default ?? definition.min ?? 0])),
      resources: Object.fromEntries((world.playerCreation.resources || []).map(definition => [definition.id, definition.initial ?? definition.min ?? 0])),
      relations: {},
    };
    const created = await request(base, '/api/world-saves', { worldId: world.id, worldVersion: 1, name: 'patch regression', player });
    assert.strictEqual(created.response.status, 201, JSON.stringify(created.body));
    const save = created.body;
    assert.strictEqual(save.state.activeHooks[0].id, 'opening-hook');
    const firstResource = world.playerCreation.resources[0];
    const firstAttribute = world.playerCreation.attributes[0];
    const options = ['继续观察', '前往北门', '询问守卫', '整理装备'];
    const commandId = 'patch-regression-1';
    const patch = {
      protocol: 'tavern.rpg.turn', version: 1, baseRevision: save.revision,
      updates: [
        { type: 'player.resource.delta', id: firstResource.id, delta: -1 },
        { type: 'player.attribute.delta', id: firstAttribute.id, delta: 1 },
        { type: 'objective.status', kind: 'hooks', id: 'opening-hook', status: 'done' },
        { type: 'objective.upsert', kind: 'goals', id: 'find-signal', title: '追踪异常信号', desc: '确认信号来源。', status: 'active' },
      ],
    };
    const committed = await request(base, `/api/world-saves/${save.id}`, { commandId, expectedRevision: save.revision, patch, agentCalls: [{ callId: 'roll-1', name: 'dice.roll', arguments: { expr: 'd20' } }], turns: [{ role: 'assistant', content: '结构化回合。' }], options });
    assert.strictEqual(committed.response.status, 200, `${committed.response.status} ${JSON.stringify(committed.body)}`);
    assert.strictEqual(committed.body.revision, save.revision + 1);
    assert.strictEqual(committed.body.state.player.resources[firstResource.id], player.resources[firstResource.id] - 1);
    assert.strictEqual(committed.body.state.player.attributes[firstAttribute.id], player.attributes[firstAttribute.id] + 1);
    assert.deepStrictEqual(committed.body.turns.at(-1).options, options);
    assert.deepStrictEqual(committed.body.receipts.at(-1).patch, { protocol: 'tavern.rpg.turn', version: 1, updateCount: 4 });
    assert.strictEqual(committed.body.state.activeHooks[0].status, 'done');
    assert.strictEqual(committed.body.state.goals.find(item => item.id === 'find-signal')?.title, '追踪异常信号');
    assert.ok(committed.body.npcStates[testNpc.id].status.includes('巡逻中'));
    assert.ok(committed.body.state.worldEvents.some(event => event.npcId === testNpc.id && event.actionId === 'patrol'));
    assert.deepStrictEqual(committed.body.receipts.at(-1).agent.proposedTools, [{ callId: 'roll-1', name: 'dice.roll', status: 'observed' }]);
    const idempotent = await request(base, `/api/world-saves/${save.id}`, { commandId, expectedRevision: save.revision, patch, turns: [{ role: 'assistant', content: '重复提交。' }], options });
    assert.strictEqual(idempotent.response.status, 200);
    assert.strictEqual(idempotent.body.revision, committed.body.revision);
    const forbidden = await request(base, `/api/world-saves/${save.id}`, {
      commandId: 'patch-regression-forbidden', expectedRevision: committed.body.revision,
      patch: { protocol: 'tavern.rpg.turn', version: 1, baseRevision: committed.body.revision, updates: [{ type: 'player.resource.delta', id: 'not-declared', delta: 1 }] },
      turns: [{ role: 'assistant', content: '非法更新。' }], options,
    });
    assert.strictEqual(forbidden.response.status, 400);
    const unknownField = await request(base, `/api/world-saves/${save.id}`, {
      commandId: 'patch-regression-unknown', expectedRevision: committed.body.revision,
      patch: { protocol: 'tavern.rpg.turn', version: 1, baseRevision: committed.body.revision, updates: [{ type: 'player.resource.delta', id: firstResource.id, delta: 1, path: '/state' }] },
      turns: [{ role: 'assistant', content: '未知字段。' }], options,
    });
    assert.strictEqual(unknownField.response.status, 400);
    const unknownTool = await request(base, `/api/world-saves/${save.id}`, {
      commandId: 'patch-regression-unknown-tool', expectedRevision: committed.body.revision,
      patch: { protocol: 'tavern.rpg.turn', version: 1, baseRevision: committed.body.revision, updates: [] },
      agentCalls: [{ callId: 'tool-1', name: 'state.replace', arguments: {} }],
      turns: [{ role: 'assistant', content: '未知工具。' }], options,
    });
    assert.strictEqual(unknownTool.response.status, 400);
    const stale = await request(base, `/api/world-saves/${save.id}`, {
      commandId: 'patch-regression-stale', expectedRevision: save.revision,
      patch: { protocol: 'tavern.rpg.turn', version: 1, baseRevision: save.revision, updates: [] },
      turns: [{ role: 'assistant', content: '过期更新。' }], options,
    });
    assert.strictEqual(stale.response.status, 409);
    const executeCommand = 'agent-execution-1';
    const executeRevision = committed.body.revision;
    const badPhase = await request(base, `/api/world-saves/${save.id}/agent-execute`, {
      commandId: 'agent-invalid-phase', expectedRevision: executeRevision,
      patch: { protocol: 'tavern.rpg.turn', version: 1, baseRevision: executeRevision, updates: [] },
      agentCalls: [{ callId: 'bad-phase', name: 'state.patch', arguments: {} }],
      agentToolTrace: [{ callId: 'bad-phase', name: 'state.patch', phase: 'guard', result: { ok: true } }],
    });
    assert.strictEqual(badPhase.response.status, 400);
    assert.match(String(badPhase.body.error), /必须位于 decide 阶段/);
    const badDiceGate = await request(base, `/api/world-saves/${save.id}/agent-execute`, {
      commandId: 'agent-invalid-dice-gate', expectedRevision: executeRevision,
      patch: { protocol: 'tavern.rpg.turn', version: 1, baseRevision: executeRevision, updates: [] },
      agentCalls: [{ callId: 'bad-dice', name: 'dice.roll', arguments: { expr: 'd20' } }],
      agentToolTrace: [{ callId: 'bad-dice', name: 'dice.roll', phase: 'guard', result: { ok: true, rolls: [{ expr: 'd20', total: 12 }] } }],
    });
    assert.strictEqual(badDiceGate.response.status, 400);
    assert.match(String(badDiceGate.body.error), /必须先通过 rules\.check/);
    const badBinding = await request(base, `/api/world-saves/${save.id}/agent-execute`, {
      commandId: 'agent-invalid-binding', expectedRevision: executeRevision,
      patch: { protocol: 'tavern.rpg.turn', version: 1, baseRevision: executeRevision, updates: [] },
      agentCalls: [{ callId: 'candidate-a', name: 'state.patch', arguments: {} }],
      agentToolTrace: [{ callId: 'candidate-b', name: 'state.patch', phase: 'decide', result: { ok: true } }],
    });
    assert.strictEqual(badBinding.response.status, 400);
    assert.match(String(badBinding.body.error), /未在 agentCalls 中声明/);
    const execute = await request(base, `/api/world-saves/${save.id}/agent-execute`, {
      commandId: executeCommand,
      expectedRevision: executeRevision,
      patch: { protocol: 'tavern.rpg.turn', version: 1, baseRevision: executeRevision, updates: [
        { type: 'player.resource.delta', id: firstResource.id, delta: 1 },
        { type: 'objective.upsert', kind: 'goals', id: 'agent-plan', title: '确认安全路线', desc: '先观察，再决定是否继续。', status: 'active' },
      ] },
      actionIntent: { raw: '执行一次安全的资源变更' },
      agentCalls: [
        { callId: 'state-1', name: 'state.patch', arguments: { updateCount: 2 } },
        { callId: 'plan-1', name: 'objective.upsert', arguments: { kind: 'goals', id: 'agent-plan', title: '确认安全路线', desc: '先观察，再决定是否继续。' } },
      ],
      agentToolTrace: [
        { callId: 'state-1', name: 'state.patch', phase: 'decide', result: { ok: true, accepted: 'candidate' }, step: 1, mode: 'compat' },
        { callId: 'plan-1', name: 'objective.upsert', phase: 'decide', result: { ok: true, accepted: 'candidate' }, step: 1, mode: 'compat' },
      ],
      turns: [{ role: 'user', content: '执行一次安全的资源变更' }, { role: 'assistant', content: '资源变化已经准备好，等待正式叙事。' }],
      options,
    });
    assert.strictEqual(execute.response.status, 200, `${execute.response.status} ${JSON.stringify(execute.body)}`);
    assert.strictEqual(execute.body.revision, executeRevision);
    assert.strictEqual(execute.body.agentRuntime.status, 'awaiting-narration');
    assert.strictEqual(execute.body.agentRuntime.pending.turns.length, 2);
    assert.deepStrictEqual(execute.body.agentRuntime.pending.options, options);
    assert.strictEqual(execute.body.agentRuntime.pending.phase, 'narrate');
    assert.strictEqual(execute.body.agentRuntime.pending.phaseHistory.at(-2).phase, 'execute');
    assert.strictEqual(execute.body.agentRuntime.pending.phaseHistory.at(-1).status, 'pending');
    assert.deepStrictEqual(execute.body.agentRuntime.pending.orchestration.counts, { candidates: 2, observed: 0, passed: 2, rejected: 0 });
    assert.deepStrictEqual(execute.body.agentRuntime.pending.orchestration.plan.map(item => item.id), ['agent-plan']);
    assert.strictEqual(execute.body.agentRuntime.pending.agentToolTrace[0].result.ok, true);
    assert.strictEqual(execute.body.agentRuntime.pending.state.player.resources[firstResource.id], committed.body.state.player.resources[firstResource.id] + 1);
    assert.strictEqual(execute.body.state.player.resources[firstResource.id], committed.body.state.player.resources[firstResource.id]);
    const executeRetry = await request(base, `/api/world-saves/${save.id}/agent-execute`, {
      commandId: executeCommand,
      expectedRevision: executeRevision,
      patch: { protocol: 'tavern.rpg.turn', version: 1, baseRevision: executeRevision, updates: [{ type: 'player.resource.delta', id: firstResource.id, delta: 1 }] },
    });
    assert.strictEqual(executeRetry.response.status, 200);
    assert.strictEqual(executeRetry.body.agentRuntime.status, 'awaiting-narration');
    const narrate = await request(base, `/api/world-saves/${save.id}`, {
      agentPhase: 'narrate',
      commandId: 'agent-narration-1',
      pendingCommandId: executeCommand,
      expectedRevision: executeRevision,
      turns: [{ role: 'assistant', content: '执行结果已经转化为叙事。' }],
      options,
    });
    assert.strictEqual(narrate.response.status, 200, `${narrate.response.status} ${JSON.stringify(narrate.body)}`);
    assert.strictEqual(narrate.body.revision, executeRevision + 1);
    assert.strictEqual(narrate.body.state.player.resources[firstResource.id], committed.body.state.player.resources[firstResource.id] + 1);
    assert.strictEqual(narrate.body.agentRuntime.status, 'idle');
    assert.strictEqual(narrate.body.receipts.at(-1).agent.guard.status, 'passed');
    assert.deepStrictEqual(narrate.body.receipts.at(-1).agent.phaseSequence, ['decide', 'execute', 'narrate']);
    assert.deepStrictEqual(narrate.body.receipts.at(-1).agent.phaseHistory.map(item => item.phase), ['decide', 'execute', 'narrate']);
    assert.strictEqual(narrate.body.receipts.at(-1).agent.orchestration.results[0].status, 'passed');
    const narrateRetry = await request(base, `/api/world-saves/${save.id}`, {
      agentPhase: 'narrate', commandId: 'agent-narration-1', pendingCommandId: executeCommand,
      expectedRevision: executeRevision, turns: [{ role: 'assistant', content: '重复叙事。' }], options,
    });
    assert.strictEqual(narrateRetry.response.status, 200);
    assert.strictEqual(narrateRetry.body.revision, narrate.body.revision);
    const cancelCommand = 'agent-cancel-1';
    const cancelRevision = narrate.body.revision;
    const cancelExecution = await request(base, `/api/world-saves/${save.id}/agent-execute`, {
      commandId: cancelCommand, expectedRevision: cancelRevision,
      patch: { protocol: 'tavern.rpg.turn', version: 1, baseRevision: cancelRevision, updates: [] },
      actionIntent: { raw: '取消待叙事执行' },
    });
    assert.strictEqual(cancelExecution.response.status, 200);
    const cancelled = await request(base, `/api/world-saves/${save.id}/agent-cancel`, {
      commandId: cancelCommand, expectedRevision: cancelRevision,
    });
    assert.strictEqual(cancelled.response.status, 200);
    assert.strictEqual(cancelled.body.agentRuntime.status, 'idle');
    console.log('rpg patch check passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
