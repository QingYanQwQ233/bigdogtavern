'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-test-lab-'));
const defaults = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', '_defaults.json'), 'utf8'));
fs.writeFileSync(path.join(tempDir, '_defaults.json'), JSON.stringify(defaults, null, 2));
fs.writeFileSync(path.join(tempDir, 'worlds.json'), JSON.stringify(defaults.worlds, null, 2));
process.env.TAVERN_DATA_DIR = tempDir;

const { server, startServer } = require(path.join(root, 'server.js'));

function closeServer() {
  return new Promise(resolve => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
  });
}

async function jsonRequest(base, pathname, options) {
  const response = await fetch(base + pathname, options);
  const body = await response.json().catch(() => null);
  return { response, body };
}

function clientDice(expr, value = null) {
  const match = String(expr).match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  assert.ok(match, `valid dice expression: ${expr}`);
  const count = Math.max(1, Number(match[1] || 1));
  const sides = Number(match[2]);
  const bonus = Number(match[3] || 0);
  const rolls = Array.from({ length: count }, () => value ?? sides);
  return { expr, rolls, bonus, total: rolls.reduce((sum, roll) => sum + roll, bonus) };
}

function activeConflict(definition, id) {
  const action = (definition.actions || []).find(item => item.check) || definition.actions[0];
  const phase = definition.phases?.[0]?.id || null;
  const participants = definition.type === 'combat'
    ? [{ id: `${id}-player`, role: 'player', hp: 20, maxHp: 20, defense: 10 }, { id: `${id}-target`, role: 'target', hp: 8, maxHp: 8, defense: 8 }]
    : [{ id: `${id}-player`, role: 'player' }, { id: `${id}-target`, role: 'opponent' }];
  return { id, templateId: definition.id, type: definition.type, status: 'active', phase, round: 1, participants, availableActions: action ? [action.id] : [] };
}

async function main() {
  try {
    await startServer(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const worldResult = await jsonRequest(base, '/api/worlds/world-test-lab?version=1');
    assert.strictEqual(worldResult.response.status, 200);
    const world = worldResult.body;
    assert.strictEqual(world.title, '潮汐试验场');
    assert.strictEqual(world.locations.length, 4);
    assert.strictEqual(world.npcs.length, 3);
    assert.strictEqual(world.factions.length, 2);
    assert.deepStrictEqual(world.conflicts.map(item => item.type), ['combat', 'social', 'stealth']);
    assert.strictEqual(world.playerCreation.pointBudget.total, 18);
    assert.ok(world.playerCreation.fields.some(field => field.id === 'customNotes'));
    assert.strictEqual(world.playerCreation.derived[1].formula, 'attributes.resolve + skills.negotiate');
    assert.strictEqual(world.map.data.grid.length, world.map.data.size ** 2);
    assert.deepStrictEqual(Object.keys(defaults.rpg.agent.tools).sort(), ['context.retrieve', 'dice.roll', 'entity.create', 'memory.record', 'rules.check', 'state.patch'].sort());

    const player = {
      fields: { name: '测试旅者', gender: '自定义', age: 24, origin: '白潮港', identity: '潮汐测绘员', appearance: '披着防潮斗篷', personality: '谨慎好奇', customNotes: '用于验证自定义字段。' },
      attributes: { might: 4, agility: 5, insight: 5, resolve: 4 },
      skills: { survey: 3, negotiate: 2, survival: 3 },
      resources: { hp: 20, focus: 8, shells: 60 },
      traits: ['tide-sense'], choices: ['tide-sense', 'port-network'],
      relations: { 'npc-mira': 15, 'npc-oren': 0, 'npc-sable': -10 },
      initialInventory: { 'tide-compass': 1, 'field-rations': 2 },
    };
    const created = await jsonRequest(base, '/api/world-saves', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: world.id, worldVersion: world.version, name: '潮汐试验存档', playerPresetId: 'balanced-scout', player }),
    });
    assert.strictEqual(created.response.status, 201, JSON.stringify(created.body));
    assert.strictEqual(created.body.setup.status, 'planning');
    assert.strictEqual(created.body.setup.playerPresetId, 'balanced-scout');
    assert.strictEqual(created.body.state.locationId, 'white-tide-port');
    assert.strictEqual(created.body.state.map.data.size, 4);
    assert.strictEqual(created.body.npcStates['npc-mira'].relation.player, 15);
    assert.strictEqual(created.body.state.factionStates['faction-harbor'].resources.influence, 55);

    const setup = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(created.body.id)}/setup`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandId: 'test-lab-setup-1', expectedRevision: created.body.revision,
        game: { difficulty: 'standard', sandbox: 'open', combatEnabled: true, worldAdvance: true, allowNewEntities: false, calendarNote: '红潮前夜' },
        plan: {
          locationId: 'white-tide-port', presentNpcIds: ['npc-mira'], situation: '红潮提前，玩家来到港口档案室。', hook: '找到失踪测绘队。',
          knownFacts: ['最后联络来自断崖灯塔。'], boundaries: ['不替玩家决定行动。'], tone: '克制而有悬念',
          time: { era: '潮汐纪 12 年', date: '红潮前夜', period: '夜', value: 6, unit: '潮汐时' },
          event: { mode: 'manual', title: '红潮前夜', description: '灯塔同时转向海面。' },
          npcContexts: [{ npcId: 'npc-mira', relationship: '初次合作', currentGoal: '核对灯塔记录', currentState: '正在整理档案', knowsPlayer: false, playerKnowsTruth: false }],
          preGameFacts: [{ id: 'arrival', scope: 'player-visible', content: '玩家刚抵达白潮港。', confidence: 'confirmed' }],
          knowledge: { worldTruth: ['潮汐核心即将苏醒。'], characterKnowledge: ['测绘队失踪。'], playerVisible: ['港口暂时安全。'], hidden: ['萨布尔的真实身份。'], rumors: ['雾林里有求救声。'] },
          initialHook: { id: 'find-team', title: '寻找测绘队', description: '可选的第一条行动抓手。', optional: true },
        },
      }),
    });
    assert.strictEqual(setup.response.status, 200, JSON.stringify(setup.body));
    assert.strictEqual(setup.body.setup.plan.locationId, 'white-tide-port');
    assert.strictEqual(setup.body.setup.game.allowNewEntities, false);

    const opening = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(created.body.id)}/opening`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'test-lab-opening-1', expectedRevision: setup.body.revision, opening: '红潮映红港口，档案室的灯塔图同时亮起。', options: ['查看档案', '询问米拉', '前往码头', '离开港口'] }),
    });
    assert.strictEqual(opening.response.status, 200, JSON.stringify(opening.body));
    assert.strictEqual(opening.body.setup.status, 'active');
    assert.strictEqual(opening.body.state.openingScenario.knowledge.hidden[0], '萨布尔的真实身份。');
    assert.strictEqual(opening.body.openingOptions.length, 4);

    // Agent tool loop: state.patch + entity.create + memory.record are committed
    // through execute -> narrate; rules.check/dice.roll are retained as proposed calls.
    const agentExecute = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(created.body.id)}/agent-execute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandId: 'test-lab-agent-1', expectedRevision: opening.body.revision,
        patch: { protocol: 'tavern.rpg.turn', version: 1, baseRevision: opening.body.revision, updates: [
          { type: 'player.resource.delta', id: 'focus', delta: -1 },
          { type: 'location.set', locationId: 'mistwood' },
          { type: 'objective.status', kind: 'goals', id: 'find-team', status: 'done' },
          { type: 'objective.status', kind: 'leads', id: 'lighthouse-lead', status: 'done' },
          { type: 'objective.status', kind: 'quests', id: 'find-survey-team', status: 'done' },
        ] },
        actionIntent: { raw: '记录任务进展并前往雾林', risk: 'medium' },
        agentCalls: [
          { callId: 'tool-state', name: 'state.patch', arguments: { updateCount: 5 } },
          { callId: 'tool-dice', name: 'dice.roll', arguments: { expr: '1d20' } },
          { callId: 'tool-rules', name: 'rules.check', arguments: { rule: 'survey' } },
          { callId: 'tool-entity', name: 'entity.create', arguments: { kind: 'npc' } },
          { callId: 'tool-memory', name: 'memory.record', arguments: { visibility: 'hidden' } },
        ],
        createEntities: [{ kind: 'npc', tempId: 'mist-guide', name: '雾中引路人', reason: '测试存档级实体隔离', description: '只属于本条存档的新 NPC。', locationId: 'mistwood', role: 'guide' }],
        eventMemory: [{ summary: '玩家完成了第一批开局任务，并进入雾林。', entityIds: ['npc-mira'], visibility: 'hidden' }],
      }),
    });
    assert.strictEqual(agentExecute.response.status, 200, JSON.stringify(agentExecute.body));
    assert.strictEqual(agentExecute.body.agentRuntime.status, 'awaiting-narration');
    const agentNarrate = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(created.body.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentPhase: 'narrate', commandId: 'test-lab-narrate-1', pendingCommandId: 'test-lab-agent-1', expectedRevision: opening.body.revision, turns: [{ role: 'assistant', content: '雾林的潮气漫过石阶，任务记录在你的手中变得清晰。' }], options: [] }),
    });
    assert.strictEqual(agentNarrate.response.status, 200, JSON.stringify(agentNarrate.body));
    assert.strictEqual(agentNarrate.body.agentRuntime.status, 'idle');
    assert.strictEqual(agentNarrate.body.state.locationId, 'mistwood');
    assert.strictEqual(agentNarrate.body.state.player.resources.focus, 7);
    assert.strictEqual(agentNarrate.body.state.goals.find(item => item.id === 'find-team').status, 'done');
    assert.strictEqual(agentNarrate.body.state.leads.find(item => item.id === 'lighthouse-lead').status, 'done');
    assert.strictEqual(agentNarrate.body.state.quests.find(item => item.id === 'find-survey-team').status, 'done');
    assert.strictEqual(Object.keys(agentNarrate.body.generatedEntities.npcs).length, 1);
    assert.strictEqual(agentNarrate.body.eventMemory.at(-1).visibility, 'hidden');
    assert.ok(agentNarrate.body.receipts.at(-1).agent.proposedTools.some(tool => tool.name === 'rules.check'));

    // Return to the port at time 8: world event + faction action should settle once.
    const conflictDefinitions = Object.fromEntries(world.conflicts.map(definition => [definition.type, definition]));
    const conflictStartState = {
      ...agentNarrate.body.state,
      locationId: 'white-tide-port',
      conflicts: {
        'reef-run-1': activeConflict(conflictDefinitions.combat, 'reef-run-1'),
        'hearing-1': activeConflict(conflictDefinitions.social, 'hearing-1'),
        'mist-track-1': activeConflict(conflictDefinitions.stealth, 'mist-track-1'),
      },
    };
    const conflictStart = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(created.body.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'test-lab-events-1', expectedRevision: agentNarrate.body.revision, state: conflictStartState, turns: [{ role: 'assistant', content: '你回到白潮港，灯塔发出红光。' }], options: [] }),
    });
    assert.strictEqual(conflictStart.response.status, 200, JSON.stringify(conflictStart.body));
    assert.ok(conflictStart.body.state.worldEvents.some(event => event.eventId === 'red-tide'));
    assert.ok(conflictStart.body.state.worldEvents.some(event => event.eventId === 'harbor-alarm'));
    assert.ok(conflictStart.body.state.worldEvents.some(event => event.eventId === 'faction-faction-harbor-close-gates'));
    assert.strictEqual(conflictStart.body.state.factionStates['faction-harbor'].influence, 58);

    // One client-supplied dice bundle resolves combat, social and stealth checks.
    const nextConflicts = JSON.parse(JSON.stringify(conflictStart.body.state.conflicts));
    const dice = [];
    for (const [id, type] of [['reef-run-1', 'combat'], ['hearing-1', 'social'], ['mist-track-1', 'stealth']]) {
      const state = nextConflicts[id];
      const definition = conflictDefinitions[type];
      const action = definition.actions.find(item => item.check);
      state.round = 2;
      state.actionId = action.id;
      if (type === 'combat') state.targetId = `${id}-target`;
      dice.push(clientDice(action.check.roll, 15));
      if (type === 'combat' && action.check.damage?.roll) dice.push(clientDice(action.check.damage.roll, 4));
    }
    const conflictTurn = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(created.body.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'test-lab-dice-1', expectedRevision: conflictStart.body.revision, actionIntent: { raw: '同时处理三类冲突', dice }, state: { ...conflictStart.body.state, conflicts: nextConflicts }, turns: [{ role: 'assistant', content: '客户端骰子决定了三类判定。' }], options: [] }),
    });
    assert.strictEqual(conflictTurn.response.status, 200, JSON.stringify(conflictTurn.body));
    assert.strictEqual(conflictTurn.body.receipts.at(-1).combatChecks.length, 1);
    assert.strictEqual(conflictTurn.body.receipts.at(-1).conflictChecks.length, 2);
    assert.ok(conflictTurn.body.receipts.at(-1).agent.steps[0].toolCalls.some(tool => tool.name === 'rules.resolve'));
    assert.ok(conflictTurn.body.receipts.at(-1).agent.steps[0].toolCalls.some(tool => tool.name === 'dice.roll'));
    assert.ok(conflictTurn.body.state.conflicts['reef-run-1'].participants.find(item => item.id === 'reef-run-1-target').hp < 8);

    // Failure settlement -> growth proposal/acceptance -> memory diagnostics.
    const failed = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(created.body.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'test-lab-failure-1', expectedRevision: conflictTurn.body.revision, state: { ...conflictTurn.body.state, stats: { ...conflictTurn.body.state.stats, hp: 0 } }, turns: [{ role: 'assistant', content: '生命归零，测试负伤失败模式。' }], options: [] }),
    });
    assert.strictEqual(failed.response.status, 200, JSON.stringify(failed.body));
    assert.strictEqual(failed.body.state.failure.mode, 'injured');
    assert.ok(failed.body.state.stats.hp > 0);
    const growthDefinition = world.playerCreation.growth.candidates.find(candidate => candidate.id === 'survey-ruins');
    const growthRecord = { id: 'test-lab-growth-1', candidateId: growthDefinition.id, sourceId: growthDefinition.sourceId, reason: '读懂遗迹地图', status: 'proposed' };
    const growthProposal = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(created.body.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'test-lab-growth-1', expectedRevision: failed.body.revision, state: { ...failed.body.state, growthCandidates: [growthRecord] }, turns: [{ role: 'assistant', content: '记录成长候选。' }], options: [] }),
    });
    assert.strictEqual(growthProposal.response.status, 200, JSON.stringify(growthProposal.body));
    const growthAccepted = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(created.body.id)}/growth`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'test-lab-growth-accept-1', expectedRevision: growthProposal.body.revision, candidateId: growthRecord.id, decision: 'accepted' }),
    });
    assert.strictEqual(growthAccepted.response.status, 200, JSON.stringify(growthAccepted.body));
    assert.strictEqual(growthAccepted.body.state.player.skills.survey, 4);
    assert.ok(growthAccepted.body.state.experiences.at(-1).candidateId === 'survey-ruins');
    const memoryDiagnostics = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(created.body.id)}/memory`);
    assert.strictEqual(memoryDiagnostics.response.status, 200);
    assert.ok(memoryDiagnostics.body.memory.hidden >= 1);

    const summary = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(created.body.id)}/summary/rebuild`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'test-lab-summary-1', expectedRevision: growthAccepted.body.revision }),
    });
    assert.strictEqual(summary.response.status, 200, JSON.stringify(summary.body));
    assert.strictEqual(summary.body.stale, false);
    const endingPreview = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(created.body.id)}/end`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'test-lab-ending-preview', expectedRevision: growthAccepted.body.revision, endingId: 'player-choice', confirm: false }),
    });
    assert.strictEqual(endingPreview.response.status, 409);
    const ended = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(created.body.id)}/end`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'test-lab-ending-1', expectedRevision: growthAccepted.body.revision, endingId: 'player-choice', confirm: true }),
    });
    assert.strictEqual(ended.response.status, 200, JSON.stringify(ended.body));
    assert.strictEqual(ended.body.state.ending.status, 'ended');
    console.log('world test lab check passed');
  } finally {
    await closeServer();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
