'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-runtime-roundtrip-'));
const defaults = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', '_defaults.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'demo-gameplay-fog-harbor.tavern-world.json'), 'utf8'));
const world = JSON.parse(JSON.stringify(pkg.content.world));
world.id = 'world-runtime-roundtrip';
world.start.openingMode = 'static';
world.runtime.collections.find(collection => collection.id === 'inventory').initial.find(item => item.id === 'field-rations').count = 3;
fs.writeFileSync(path.join(tempDir, '_defaults.json'), JSON.stringify({ ...defaults, worlds: [world] }));
fs.writeFileSync(path.join(tempDir, 'worlds.json'), JSON.stringify([world]));
process.env.TAVERN_DATA_DIR = tempDir;

const { server, startServer, buildAgentCheckResolutions } = require(path.join(root, 'server.js'));

const attributeCheck = buildAgentCheckResolutions(
  {
    rules: { checks: [{ id: 'insight-check', label: '洞察判定', roll: '1d20', target: 12, modifier: { bucket: 'attributes', id: 'insight', factor: 1, bonus: 1 } }] },
  },
  [
    { name: 'rules.check', result: { ok: true, ruleId: 'insight-check' } },
    { name: 'dice.roll', result: { ok: true, modifierRule: { bucket: 'attributes', id: 'insight', factor: 1, bonus: 1 }, rolls: [{ expr: '1d20', total: 7 }] } },
  ],
  { dice: [{ expr: '1d20', rolls: [7], total: 7 }] },
  { player: { attributes: { insight: 5 } } },
);
assert.strictEqual(attributeCheck.resolutions[0].modifier, 6);
assert.strictEqual(attributeCheck.resolutions[0].total, 13);

const inlineModifierCheck = buildAgentCheckResolutions(
  {
    rules: { checks: [{ id: 'insight-check', label: '洞察判定', roll: '1d20', target: 12, modifier: { bucket: 'attributes', id: 'insight' } }] },
  },
  [
    { name: 'rules.check', result: { ok: true, ruleId: 'insight-check' } },
    { name: 'dice.roll', result: { ok: true, modifierRule: { bucket: 'attributes', id: 'insight' }, rolls: [{ expr: '1d20+1', total: 8 }] } },
  ],
  { dice: [{ expr: '1d20+1', rolls: [7], total: 8 }] },
  { player: { attributes: { insight: 6 } } },
);
assert.match(inlineModifierCheck.error, /基础骰式/);

async function request(base, pathname, options) {
  const response = await fetch(base + pathname, options);
  return { response, body: await response.json().catch(() => null) };
}

async function main() {
  try {
    await startServer(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const player = {
      fields: { name: '回归测试者', origin: '白潮港', identity: '验证 runtime 持久化的旅者' },
      attributes: { might: 3, agility: 4, insight: 5, nerve: 4 },
      skills: { investigate: 3, negotiate: 2, survival: 2 },
      resources: { hp: 20, focus: 8, shells: 35 },
      traits: [], choices: [], relations: {},
    };
    const created = await request(base, '/api/world-saves', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: world.id, worldVersion: world.version, name: 'runtime roundtrip', player }),
    });
    assert.strictEqual(created.response.status, 201, JSON.stringify(created.body));
    const save = created.body;
    assert.strictEqual(save.setup.status, 'active');

    const patch = {
      protocol: 'tavern.rpg.turn', version: 1, baseRevision: save.revision,
      updates: [
        { type: 'runtime.action.execute', actionId: 'record-evidence', input: { title: '灯塔记录', text: '第十三声钟前不要点亮灯塔。' } },
        { type: 'runtime.action.execute', actionId: 'make-contract', input: { id: 'contract-mira-letter', title: '护送信件', with: '米拉', price: '一份档案复印件' } },
        { type: 'runtime.action.execute', actionId: 'use-field-ration', input: {} },
      ],
    };
    const committed = await request(base, `/api/world-saves/${encodeURIComponent(save.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandId: 'runtime-roundtrip-1', expectedRevision: save.revision,
        actionIntent: { version: 1, kind: 'text', source: 'input', raw: '记录线索并登记承诺' },
        agentCalls: [{ callId: 'runtime-action-1', name: 'runtime.action.execute', arguments: { actionId: 'record-evidence' } }],
        agentToolTrace: [
          { callId: 'runtime-action-1', name: 'runtime.action.execute', phase: 'commit', arguments: { actionId: 'record-evidence' }, result: { ok: true }, step: 1, mode: 'native' },
          { callId: 'runtime-action-rejected', name: 'runtime.action.execute', phase: 'commit', arguments: { actionId: 'missing-action' }, result: { ok: false, error: '动作不存在' }, step: 1, mode: 'native' },
        ],
        patch,
        turns: [{ role: 'user', content: '记录线索并登记承诺' }, { role: 'assistant', content: '已记录线索并登记承诺。' }],
        options: ['去档案室', '前往雾林入口', '询问打捞行'],
      }),
    });
    assert.strictEqual(committed.response.status, 200, JSON.stringify(committed.body));
    assert.strictEqual(committed.body.state.runtime.variables.evidence, 1);
    assert.strictEqual(committed.body.state.runtime.collections.contracts.length, 1);
    assert.strictEqual(committed.body.state.runtime.collections.contracts[0].id, 'contract-mira-letter');
    assert.strictEqual(committed.body.state.runtime.collections.contracts[0].title, '护送信件');
    assert.strictEqual(committed.body.state.runtime.collections.inventory.find(item => item.id === 'field-rations').count, 2);

    const reloaded = await request(base, `/api/world-saves/${encodeURIComponent(save.id)}`);
    assert.strictEqual(reloaded.response.status, 200, JSON.stringify(reloaded.body));
    assert.strictEqual(reloaded.body.state.runtime.variables.evidence, 1);
    assert.strictEqual(reloaded.body.state.runtime.collections.contracts.length, 1);
    assert.strictEqual(reloaded.body.state.runtime.collections.inventory.find(item => item.id === 'field-rations').count, 2);

    const intentCommitted = await request(base, `/api/world-saves/${encodeURIComponent(save.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandId: 'runtime-roundtrip-intent-fallback', expectedRevision: reloaded.body.revision,
        actionIntent: { version: 1, kind: 'action', source: 'input', raw: '食用野外口粮', actionId: 'use-field-ration' },
        state: reloaded.body.state,
        turns: [{ role: 'user', content: '食用野外口粮' }, { role: 'assistant', content: '你吃下最后一份野外口粮。' }],
        options: ['检查补给袋', '继续前进', '返回港口'],
      }),
    });
    assert.strictEqual(intentCommitted.response.status, 200, JSON.stringify(intentCommitted.body));
    assert.strictEqual(intentCommitted.body.state.runtime.collections.inventory.find(item => item.id === 'field-rations').count, 1, 'an exact free-input action intent should synthesize the missing runtime execute');

    const malformedIntentExecution = await request(base, `/api/world-saves/${encodeURIComponent(save.id)}/agent-execute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandId: 'runtime-roundtrip-intent-malformed', expectedRevision: intentCommitted.body.revision,
        actionIntent: { version: 1, kind: 'action', source: 'world-card', raw: '食用野外口粮', actionId: 'use-field-ration' },
        patch: {
          protocol: 'tavern.rpg.turn', version: 1, baseRevision: intentCommitted.body.revision,
          updates: [{ type: 'item.delta', id: 'field-rations', field: 'count', delta: -1 }],
        },
        turns: [{ role: 'user', content: '食用野外口粮' }, { role: 'assistant', content: '你吃下最后一份野外口粮。' }],
        options: ['检查补给袋', '继续前进', '返回港口'],
      }),
    });
    assert.strictEqual(malformedIntentExecution.response.status, 200, JSON.stringify(malformedIntentExecution.body));
    assert.strictEqual(malformedIntentExecution.body.execution.state.runtime.collections.inventory.find(item => item.id === 'field-rations').count, 0, 'malformed model updates must be replaced by the explicit declared action');

    const malformedIntentCommitted = await request(base, `/api/world-saves/${encodeURIComponent(save.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentPhase: 'narrate', commandId: 'runtime-roundtrip-intent-malformed', pendingCommandId: 'runtime-roundtrip-intent-malformed', expectedRevision: intentCommitted.body.revision,
        turns: [{ role: 'user', content: '食用野外口粮' }, { role: 'assistant', content: '你吃下最后一份野外口粮。' }],
        options: ['检查补给袋', '继续前进', '返回港口'],
      }),
    });
    assert.strictEqual(malformedIntentCommitted.response.status, 200, JSON.stringify(malformedIntentCommitted.body));
    assert.strictEqual(malformedIntentCommitted.body.state.runtime.collections.inventory.find(item => item.id === 'field-rations').count, 0);

    const malformedNonCardIntent = await request(base, `/api/world-saves/${encodeURIComponent(save.id)}/agent-execute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandId: 'runtime-roundtrip-malformed-non-card', expectedRevision: malformedIntentCommitted.body.revision,
        actionIntent: { version: 1, kind: 'action', source: 'input', raw: '食用野外口粮', actionId: 'use-field-ration' },
        patch: {
          protocol: 'tavern.rpg.turn', version: 1, baseRevision: malformedIntentCommitted.body.revision,
          updates: [{ type: 'item.delta', id: 'field-rations', field: 'count', delta: -1 }],
        },
        turns: [{ role: 'user', content: '食用野外口粮' }, { role: 'assistant', content: '你试着翻找补给袋。' }],
        options: ['检查补给袋', '继续前进', '返回港口'],
      }),
    });
    assert.strictEqual(malformedNonCardIntent.response.status, 400, 'only explicit world-card actions may discard malformed model patches');

    const unavailableIntent = await request(base, `/api/world-saves/${encodeURIComponent(save.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandId: 'runtime-roundtrip-intent-empty', expectedRevision: malformedIntentCommitted.body.revision,
        actionIntent: { version: 1, kind: 'action', source: 'world-card', raw: '食用野外口粮', actionId: 'use-field-ration' },
        patch: {
          protocol: 'tavern.rpg.turn', version: 1, baseRevision: malformedIntentCommitted.body.revision,
          updates: [{ type: 'runtime.action.execute', actionId: 'use-field-ration' }],
        },
        state: malformedIntentCommitted.body.state,
        turns: [{ role: 'user', content: '食用野外口粮' }, { role: 'assistant', content: '补给袋已经空了。' }],
        options: ['检查补给袋', '继续前进', '返回港口'],
      }),
    });
    assert.strictEqual(unavailableIntent.response.status, 200, JSON.stringify(unavailableIntent.body));
    assert.strictEqual(unavailableIntent.body.state.runtime.collections.inventory.find(item => item.id === 'field-rations').count, 0, 'zero resources should produce a normal turn, not an action error');

    const aliasDiscarded = await request(base, `/api/world-saves/${encodeURIComponent(save.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
      commandId: 'runtime-roundtrip-alias-remove', expectedRevision: unavailableIntent.body.revision,
        actionIntent: { version: 1, kind: 'text', source: 'input', raw: '丢弃野外口粮' },
        patch: {
          protocol: 'tavern.rpg.turn', version: 1, baseRevision: unavailableIntent.body.revision,
          updates: [{ type: 'collection.remove', collectionId: 'inventory', entryId: 'field-rations' }],
        },
        turns: [{ role: 'user', content: '丢弃野外口粮' }, { role: 'assistant', content: '你丢弃了野外口粮。' }],
        options: ['检查背包', '继续前进', '返回港口'],
      }),
    });
    assert.strictEqual(aliasDiscarded.response.status, 200, JSON.stringify(aliasDiscarded.body));
    assert.strictEqual(aliasDiscarded.body.state.runtime.collections.inventory.some(item => item.id === 'field-rations'), false);

    const reset = await request(base, `/api/world-saves/${encodeURIComponent(save.id)}/reset`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'runtime-roundtrip-reset-1', expectedRevision: aliasDiscarded.body.revision }),
    });
    assert.strictEqual(reset.response.status, 200, JSON.stringify(reset.body));
    assert.strictEqual(reset.body.turns.length, 0);
    assert.strictEqual(reset.body.state.runtime.variables.evidence, 0);
    assert.strictEqual(reset.body.state.runtime.variables.tideClock, 5);
    assert.strictEqual(reset.body.state.runtime.collections.contracts.length, 0);
    assert.strictEqual(reset.body.state.runtime.collections.inventory.find(item => item.id === 'field-rations').count, 3);

    const resetReloaded = await request(base, `/api/world-saves/${encodeURIComponent(save.id)}`);
    assert.strictEqual(resetReloaded.response.status, 200, JSON.stringify(resetReloaded.body));
    assert.strictEqual(resetReloaded.body.state.runtime.variables.evidence, 0);
    assert.strictEqual(resetReloaded.body.state.runtime.collections.contracts.length, 0);
    assert.strictEqual(resetReloaded.body.state.runtime.collections.inventory.find(item => item.id === 'field-rations').count, 3);
    console.log('check_runtime_roundtrip: ok');
  } finally {
    await new Promise(resolve => server.listening ? server.close(resolve) : resolve());
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
