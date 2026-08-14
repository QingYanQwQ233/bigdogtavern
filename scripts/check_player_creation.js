'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-player-'));
const defaults = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', '_defaults.json'), 'utf8'));
assert.ok(defaults.rpg.stateInstruction.includes('player.skill.delta'));
const world = defaults.worlds[0];
world.conflicts.find(conflict => conflict.id === 'wolf-skirmish').actions.find(action => action.id === 'strike').check.target = 1;
world.conflicts.find(conflict => conflict.id === 'gate-negotiation').actions.find(action => action.id === 'persuade').check.target = 1;
world.npcIds = ['npc-lily'];
world.factions = [{ id: 'north-guild', name: 'North Guild', goals: ['Protect the pass'], resources: [{ id: 'funds', label: 'Funds', min: 0, max: 100, initial: 40 }], initialState: { relation: 10, influence: 4, resources: { funds: 30 } }, actions: [{ id: 'patrol-pass', title: '巡逻山口', description: '北方公会派出巡逻队。', trigger: { at: 9, locationId: 'wolf-tooth-inn' }, changes: { relation: 2, resources: { funds: -5 } }, consequences: ['山口暂时安全。'] }] }];
world.npcs = [{ id: 'npc-lily', name: '莉莉', role: 'innkeeper' }];
world.playerCreation.relations = [{ npcId: 'npc-lily', label: '与莉莉的关系', min: -100, max: 100, default: 5 }];
world.playerCreation.derived.push({ id: 'skill-readiness', label: '技能准备', formula: 'skills.scouting + attributes.wits' });
world.events.push({ id: 'inn-echo', title: '旅店回响', description: '炉火后传来一声短促的回响。', trigger: { locationId: 'wolf-tooth-inn' }, visibility: 'local', once: true });
world.start.initialState.goals = [{ id: 'deadline-goal', title: 'Deadline', desc: 'expires at start', status: 'active', deadline: { unit: 'hour', value: 8 } }];
world.start.initialState.inventory = [{ itemId: 'iron-sword', name: '铁剑', count: 1 }];
world.start.initialState.equipment = { 'main-hand': 'iron-sword' };
world.start.initialState.conflicts = {
  'wolf-encounter-1': {
    id: 'wolf-encounter-1', templateId: 'wolf-skirmish', type: 'combat', status: 'active', phase: 'engage', round: 1,
    participants: [{ id: 'pc-hero', role: 'player', hp: 24, maxHp: 24, defense: 10 }, { id: 'wolf-alpha', role: 'enemy', hp: 8, maxHp: 8, defense: 1 }], objectives: [{ id: 'survive', title: '撑过遭遇', status: 'active' }],
    availableActions: ['strike', 'guard', 'flee'],
  },
  'gate-talk-1': {
    id: 'gate-talk-1', templateId: 'gate-negotiation', type: 'social', status: 'active', phase: 'exchange', round: 1,
    participants: [{ id: 'npc-warden', role: 'opponent' }], objectives: [{ id: 'pass-gate', title: '说服守卫放行', status: 'active' }],
    availableActions: ['persuade', 'probe', 'withdraw'],
  },
};
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

async function main() {
  try {
    await startServer(0);
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;
    const worldResponse = await jsonRequest(base, '/api/worlds/world-aurora?version=1');
    assert.strictEqual(worldResponse.response.status, 200);
    assert.strictEqual(worldResponse.body.playerCreation.mode, 'custom');
    assert.ok(worldResponse.body.playerCreation.fields.some(field => field.id === 'name'));
    assert.ok(worldResponse.body.playerCreation.skills.some(skill => skill.id === 'scouting'));
    assert.ok(Array.isArray(worldResponse.body.playerCreation.choices), 'choice schema is exposed by world card');
    assert.ok(Array.isArray(worldResponse.body.playerCreation.initialInventory), 'initial inventory schema is exposed by world card');
    assert.ok(worldResponse.body.playerCreation.buildPresets.some(preset => preset.id === 'wanderer'), 'build presets are exposed by world card');
    assert.strictEqual(worldResponse.body.playerCreation.pointBudget.cost, 'above-min');
    assert.ok(Array.isArray(worldResponse.body.sessionSetup.fields), 'session setup schema is exposed by world card');
    assert.strictEqual(worldResponse.body.playerCreation.derived[0].formula, 'attributes.wits + attributes.spirit');
    assert.strictEqual(worldResponse.body.playerCreation.derived[1].formula, 'skills.scouting + attributes.wits');
    assert.strictEqual(worldResponse.body.events[0].trigger.at, 10);
    const dice = await jsonRequest(base, '/api/dice', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expressions: ['2d6+1'] }),
    });
    assert.strictEqual(dice.response.status, 200);
    assert.strictEqual(dice.body.rolls[0].rolls.length, 2);
    assert.strictEqual(dice.body.rolls[0].total, dice.body.rolls[0].rolls.reduce((sum, value) => sum + value, 1));

    const validPlayer = {
      fields: { name: '澪', race: '狐人', role: '地图学者', background: '从北境来到断牙之角。' },
      attributes: { might: 2, wits: 2, spirit: 2, fortune: 2 },
      skills: { scouting: 4, empathy: 2 },
      resources: { hp: 24, mp: 8, gold: 30 },
      traits: ['keen-sense'],
      choices: ['keen-sense'],
      initialInventory: { 'wolf-fang': 1 },
      relations: { 'npc-lily': 25 },
    };
    const first = await jsonRequest(base, '/api/world-saves', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: 'world-aurora', worldVersion: 1, name: '澪的第一条世界线', playerPresetId: 'wanderer', player: validPlayer }),
    });
    assert.strictEqual(first.response.status, 201);
    assert.deepStrictEqual(first.body.player.snapshot.fields, validPlayer.fields);
    assert.deepStrictEqual(first.body.player.snapshot.attributes, validPlayer.attributes);
    assert.deepStrictEqual(first.body.player.snapshot.skills, validPlayer.skills);
    assert.deepStrictEqual(first.body.player.snapshot.traits, validPlayer.traits);
    assert.deepStrictEqual(first.body.player.snapshot.choices, validPlayer.choices);
    assert.strictEqual(first.body.state.player.resources.hp, 24);
    assert.strictEqual(first.body.state.stats.hp, 24);
    assert.deepStrictEqual(first.body.state.equipment, { 'main-hand': 'iron-sword' });
    assert.strictEqual(first.body.state.inventory[0].itemId, 'iron-sword');
    assert.strictEqual(first.body.state.currencies.gold, 30);
    assert.strictEqual(first.body.state.conflicts['wolf-encounter-1'].status, 'active');
    assert.strictEqual(first.body.state.conflicts['wolf-encounter-1'].round, 1);
    assert.deepStrictEqual(first.body.state.growthCandidates, []);
    assert.strictEqual(first.body.npcStates['npc-lily'].relation.player, 25);
    assert.strictEqual(first.body.state.factionStates['north-guild'].relation, 10);
    assert.strictEqual(first.body.state.factionStates['north-guild'].resources.funds, 30);
    assert.strictEqual(first.body.openingMode, 'ai');
    assert.strictEqual(first.body.setup.status, 'planning', 'AI opening starts in planning state');
    assert.strictEqual(first.body.setup.playerPresetId, 'wanderer', 'preset source is bound to the save');
    const saveList = await jsonRequest(base, '/api/world-saves?worldId=world-aurora');
    assert.strictEqual(saveList.response.status, 200);
    assert.strictEqual(saveList.body.find(item => item.id === first.body.id).setupStatus, 'planning');
    const planningTurn = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(first.body.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'turn-before-opening', expectedRevision: first.body.revision, actionIntent: { raw: '直接开始' }, state: first.body.state, turns: [{ role: 'assistant', content: '不应提交。' }], options: [] }),
    });
    assert.strictEqual(planningTurn.response.status, 409, 'planning save rejects formal turns');
    const invalidSetupGame = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(first.body.id)}/setup`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'setup-invalid-game', expectedRevision: first.body.revision, game: { unknownRule: true }, plan: { locationId: 'wolf-tooth-inn', presentNpcIds: [] } }),
    });
    assert.strictEqual(invalidSetupGame.response.status, 400, 'unknown session setup fields are rejected');
    const setupPlan = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(first.body.id)}/setup`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'setup-plan-1', expectedRevision: first.body.revision, game: { difficulty: 'story', sandboxIntensity: 'guided', combatEnabled: true, worldAdvance: false, allowNewEntities: false }, plan: { locationId: 'wolf-tooth-inn', presentNpcIds: ['npc-lily'], situation: '雨夜抵达旅店', hook: '极光在北方天际闪烁', knownFacts: ['旅店暂时安全'], boundaries: ['不替玩家决定行动'], tone: '克制而有悬念', time: { era: '星历 742 年', date: '霜月 12 日', period: '黄昏', value: 12 }, event: { mode: 'manual', title: '雨夜抵达', description: '玩家刚刚抵达旅店。' }, npcContexts: [{ npcId: 'npc-lily', relationship: '初次见面', currentGoal: '维持旅店秩序', currentState: '正在擦拭杯子', knowsPlayer: false, playerKnowsTruth: false }], preGameFacts: [{ id: 'arrival', scope: 'player-visible', content: '玩家刚抵达边境', confidence: 'confirmed' }], knowledge: { worldTruth: ['北方极光提前出现'], characterKnowledge: ['玩家正在寻找落脚处'], playerVisible: ['旅店暂时安全'], hidden: ['山脊下有裂隙'], rumors: ['有人说夜里听见了狼嚎'] }, initialHook: { id: 'find-room', title: '找到住宿', description: '只是一个可选的起点', optional: true } } }),
    });
    assert.strictEqual(setupPlan.response.status, 200, 'opening plan is saved independently');
    assert.strictEqual(setupPlan.body.setup.status, 'planning');
    assert.strictEqual(setupPlan.body.setup.plan.hook, '极光在北方天际闪烁');
    assert.strictEqual(setupPlan.body.setup.game.difficulty, 'story');
    const openingCandidate = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(first.body.id)}/opening-candidate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'opening-candidate-1', expectedRevision: setupPlan.body.revision, candidate: { narrative: '你在雨幕中推开旅店的门，炉火映出一张陌生的地图。', options: ['观察炉火', '询问店主', '查看地图', '走向窗边'] } }),
    });
    assert.strictEqual(openingCandidate.response.status, 200, 'opening candidate is persisted independently');
    assert.strictEqual(openingCandidate.body.setup.status, 'planning');
    assert.strictEqual(openingCandidate.body.setup.candidate.commandId, 'opening-candidate-1');
    assert.strictEqual(openingCandidate.body.openingCommandId, null, 'candidate does not commit the formal opening');
    const opening = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(first.body.id)}/opening`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'opening-check-1', candidateCommandId: 'opening-candidate-1', expectedRevision: openingCandidate.body.revision, opening: '你在雨幕中推开旅店的门。', options: ['观察炉火', '询问店主', '查看地图', '走向窗边'] }),
    });
    assert.strictEqual(opening.response.status, 200);
    assert.strictEqual(opening.body.opening, '你在雨幕中推开旅店的门。');
    assert.deepStrictEqual(opening.body.openingOptions, ['观察炉火', '询问店主', '查看地图', '走向窗边']);
    assert.strictEqual(opening.body.state.openingScenario.time.era, '星历 742 年');
    assert.deepStrictEqual(opening.body.state.knownInformation.hidden, ['山脊下有裂隙']);
    assert.strictEqual(opening.body.state.activeHooks[0].optional, true);
    assert.strictEqual(opening.body.npcStates['npc-lily'].openingContext.currentGoal, '维持旅店秩序');
    const openingRetry = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(first.body.id)}/opening`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'opening-check-1', expectedRevision: first.body.revision, opening: 'different', options: ['a', 'b', 'c', 'd'] }),
    });
    assert.strictEqual(openingRetry.response.status, 200, 'opening command is idempotent');
    const freeTurn = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(first.body.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'turn-check-1', expectedRevision: opening.body.revision, actionIntent: { raw: '攻击灰狼并说服守卫', risk: '高', dice: [{ expr: '1d20', rolls: [20], bonus: 0, total: 20 }, { expr: '1d6', rolls: [6], bonus: 0, total: 6 }, { expr: '1d20', rolls: [20], bonus: 0, total: 20 }] }, state: { ...opening.body.state, growthCandidates: [{ id: 'growth-test-1', candidateId: 'scouting-training', sourceId: 'training', reason: '完成一次训练', status: 'proposed' }], conflicts: { ...opening.body.state.conflicts, 'wolf-encounter-1': { ...opening.body.state.conflicts['wolf-encounter-1'], round: 2, actionId: 'strike', targetId: 'wolf-alpha' }, 'gate-talk-1': { ...opening.body.state.conflicts['gate-talk-1'], round: 2, actionId: 'persuade' }, 'wolf-encounter-2': { id: 'wolf-encounter-2', templateId: 'wolf-skirmish', type: 'combat', status: 'active', phase: 'engage', round: 1, participants: ['pc-hero', 'wolf-beta'], availableActions: ['strike', 'flee'] } } }, turns: [
        { role: 'user', content: '攻击灰狼并说服守卫', ts: Date.now() },
        { role: 'assistant', content: '你看见雨水沿着窗棂滑落。', ts: Date.now() },
      ], options: [] }),
    });
    assert.strictEqual(freeTurn.response.status, 200, 'world card can allow zero suggestions');
    assert.strictEqual(freeTurn.body.turns.at(-2).actionIntent.raw, '攻击灰狼并说服守卫');
    assert.strictEqual(freeTurn.body.state.time.value, 13, 'server advances configured world time once per committed turn');
    assert.strictEqual(freeTurn.body.state.goals[0].status, 'failed', 'expired goals fail after the server advances time');
    assert.strictEqual(freeTurn.body.state.goals[0].deadlineStatus, 'expired');
    assert.deepStrictEqual(freeTurn.body.receipts.at(-1).deadlineIds, ['goals:deadline-goal']);
    assert.deepStrictEqual(freeTurn.body.state.worldEvents.map(event => event.eventId), ['aurora-omen', 'inn-echo', 'faction-north-guild-patrol-pass']);
    assert.strictEqual(freeTurn.body.state.factionStates['north-guild'].relation, 12);
    assert.strictEqual(freeTurn.body.state.factionStates['north-guild'].resources.funds, 25);
    assert.deepStrictEqual(freeTurn.body.receipts.at(-1).factionActionIds, ['north-guild:patrol-pass']);
    assert.strictEqual(freeTurn.body.state.conflicts['wolf-encounter-1'].round, 2);
    assert.strictEqual(freeTurn.body.receipts.at(-1).combatChecks.length, 1, 'client dice drives combat check');
    assert.strictEqual(freeTurn.body.receipts.at(-1).combatChecks[0].attack.hit, true);
    assert.ok(freeTurn.body.state.conflicts['wolf-encounter-1'].participants.find(item => item.id === 'wolf-alpha').hp < 8, 'server applies damage after a hit');
    assert.strictEqual(freeTurn.body.receipts.at(-1).conflictChecks.length, 1);
    assert.strictEqual(freeTurn.body.receipts.at(-1).conflictChecks[0].type, 'social');
    assert.strictEqual(freeTurn.body.receipts.at(-1).conflictChecks[0].check.success, true);
    assert.deepStrictEqual(freeTurn.body.state.conflicts['gate-talk-1'].participants, [{ id: 'npc-warden', role: 'opponent' }], 'non-combat check does not mutate HP participants');
    assert.deepStrictEqual(freeTurn.body.state.growthCandidates.map(item => item.candidateId), ['scouting-training']);
    assert.strictEqual(freeTurn.body.receipts.at(-1).conflictTransitions[0].op, 'advance');
    assert.ok(freeTurn.body.receipts.at(-1).conflictTransitions.some(item => item.id === 'wolf-encounter-2' && item.op === 'start'));
    const implicitDice = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(first.body.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'turn-check-no-client-dice', expectedRevision: freeTurn.body.revision, actionIntent: { raw: '不提供骰子结果' }, state: { ...freeTurn.body.state, conflicts: { ...freeTurn.body.state.conflicts, 'wolf-encounter-1': { ...freeTurn.body.state.conflicts['wolf-encounter-1'], round: 3, actionId: 'strike' } } }, turns: [{ role: 'assistant', content: '拒绝隐式判定。' }], options: [] }),
    });
    assert.strictEqual(implicitDice.response.status, 400, 'server rejects rule checks without client dice');
    assert.match(implicitDice.body.error, /缺少客户端骰子结果/);
    const tamperedCombatHp = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(first.body.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'turn-check-combat-hp', expectedRevision: freeTurn.body.revision, actionIntent: { raw: '伪造伤害' }, state: { ...freeTurn.body.state, conflicts: { ...freeTurn.body.state.conflicts, 'wolf-encounter-1': { ...freeTurn.body.state.conflicts['wolf-encounter-1'], participants: freeTurn.body.state.conflicts['wolf-encounter-1'].participants.map(item => item.id === 'wolf-alpha' ? { ...item, hp: item.hp === 0 ? 1 : 0 } : item) } } }, turns: [{ role: 'assistant', content: '拒绝。' }], options: [] }),
    });
    assert.strictEqual(tamperedCombatHp.response.status, 400, 'combat participant HP is server-owned');
    const invalidGrowthCandidate = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(first.body.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'turn-check-growth-invalid', expectedRevision: freeTurn.body.revision, actionIntent: { raw: '伪造成长' }, state: { ...freeTurn.body.state, growthCandidates: [...freeTurn.body.state.growthCandidates, { id: 'growth-test-2', candidateId: 'unknown-growth', sourceId: 'training', status: 'proposed' }] }, turns: [{ role: 'assistant', content: '拒绝。' }], options: [] }),
    });
    assert.strictEqual(invalidGrowthCandidate.response.status, 400, 'unknown growth candidates are rejected');
    const tamperedDice = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(first.body.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'turn-check-2', expectedRevision: freeTurn.body.revision, actionIntent: { raw: '掷骰', dice: [{ expr: '1d20', rolls: [20], bonus: 0, total: 1 }] }, state: freeTurn.body.state, turns: [{ role: 'user', content: '掷骰', ts: Date.now() }, { role: 'assistant', content: '结果。', ts: Date.now() }], options: [] }),
    });
    assert.strictEqual(tamperedDice.response.status, 400, 'tampered dice result is rejected');
    const eventTurn = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(first.body.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'turn-check-3', expectedRevision: freeTurn.body.revision, actionIntent: { raw: '继续观察' }, state: { ...freeTurn.body.state, currencies: { ...freeTurn.body.state.currencies, gold: 35 }, conflicts: { ...freeTurn.body.state.conflicts, 'wolf-encounter-1': { ...freeTurn.body.state.conflicts['wolf-encounter-1'], status: 'resolved', outcome: 'victory', actionId: 'strike' } }, player: { ...freeTurn.body.state.player, attributes: { ...freeTurn.body.state.player.attributes, might: 4 }, skills: { ...freeTurn.body.state.player.skills, scouting: 5 } }, goals: [{ id: 'find-aurora', title: '查明极光异动', desc: '找到山脊上的异常光源。', status: 'active', locationId: 'wolf-tooth-inn' }], leads: [{ id: 'inn-rumor', title: '旅店传闻', desc: '有人听见山脊方向的回响。', status: 'active', locationId: 'wolf-tooth-inn' }] }, turns: [{ role: 'user', content: '继续观察', ts: Date.now() }, { role: 'assistant', content: '极光忽然亮起。', ts: Date.now() }], options: [] }),
    });
    assert.strictEqual(eventTurn.response.status, 200);
    assert.strictEqual(eventTurn.body.state.time.value, 14);
    assert.deepStrictEqual(eventTurn.body.state.worldEvents.map(event => event.eventId), ['aurora-omen', 'inn-echo', 'faction-north-guild-patrol-pass']);
    assert.deepStrictEqual(eventTurn.body.receipts.at(-1).factionActionIds, [], 'faction action does not repeat on later turns');
    assert.strictEqual(eventTurn.body.state.goals[0].id, 'find-aurora');
    assert.strictEqual(eventTurn.body.state.leads[0].id, 'inn-rumor');
    assert.strictEqual(eventTurn.body.state.player.attributes.might, 4);
    assert.strictEqual(eventTurn.body.state.player.skills.scouting, 5);
    assert.strictEqual(eventTurn.body.state.currencies.gold, 35);
    assert.strictEqual(eventTurn.body.state.conflicts['wolf-encounter-1'].status, 'resolved');
    assert.strictEqual(eventTurn.body.receipts.at(-1).conflictTransitions[0].op, 'end');
    assert.deepStrictEqual(eventTurn.body.receipts.at(-1).eventIds, []);
    const invalidConflictReopen = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(first.body.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'turn-check-conflict-reopen', expectedRevision: eventTurn.body.revision, actionIntent: { raw: '重开冲突' }, state: { ...eventTurn.body.state, conflicts: { ...eventTurn.body.state.conflicts, 'wolf-encounter-1': { ...eventTurn.body.state.conflicts['wolf-encounter-1'], status: 'active', round: 3, outcome: null } } }, turns: [{ role: 'assistant', content: '拒绝。' }], options: [] }),
    });
    assert.strictEqual(invalidConflictReopen.response.status, 400, 'ended conflicts cannot be reopened');
    const invalidFactionState = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(first.body.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'turn-check-faction-invalid', expectedRevision: eventTurn.body.revision, actionIntent: { raw: 'faction' }, state: { ...eventTurn.body.state, factionStates: { 'north-guild': { ...eventTurn.body.state.factionStates['north-guild'], relation: 101 } } }, turns: [{ role: 'assistant', content: 'reject' }], options: [] }),
    });
    assert.strictEqual(invalidFactionState.response.status, 400, 'faction state ranges are enforced per world card');
    const eventRetry = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(first.body.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'turn-check-3', expectedRevision: 0, actionIntent: { raw: '重试' }, state: eventTurn.body.state, turns: [{ role: 'assistant', content: '重试。' }], options: [] }),
    });
    assert.strictEqual(eventRetry.response.status, 200, 'event turn retry is idempotent');
    assert.strictEqual(eventRetry.body.state.worldEvents.length, 3, 'event retry does not duplicate event');
    const invalidObjective = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(first.body.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'turn-check-4', expectedRevision: eventTurn.body.revision, actionIntent: { raw: '检查目标' }, state: { ...eventTurn.body.state, goals: [{ id: 'bad-goal', title: '越界目标', locationId: 'missing-location' }] }, turns: [{ role: 'assistant', content: '拒绝。' }], options: [] }),
    });
    assert.strictEqual(invalidObjective.response.status, 400, 'objective locations are validated against the world');
    const invalidDynamicPlayer = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(first.body.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'turn-check-5', expectedRevision: eventTurn.body.revision, actionIntent: { raw: '越界属性' }, state: { ...eventTurn.body.state, player: { ...eventTurn.body.state.player, attributes: { ...eventTurn.body.state.player.attributes, might: 99 } } }, turns: [{ role: 'assistant', content: '拒绝。' }], options: [] }),
    });
    assert.strictEqual(invalidDynamicPlayer.response.status, 400, 'dynamic player values respect world schema ranges');
    const invalidEconomy = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(first.body.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'turn-check-economy-invalid', expectedRevision: eventTurn.body.revision, actionIntent: { raw: '越界背包' }, state: { ...eventTurn.body.state, inventory: [{ itemId: 'iron-sword', name: '铁剑', count: 1, weight: 121 }] }, turns: [{ role: 'assistant', content: '拒绝。' }], options: [] }),
    });
    assert.strictEqual(invalidEconomy.response.status, 400, 'inventory weight is enforced per world card');
    const second = await jsonRequest(base, '/api/world-saves', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: 'world-aurora', worldVersion: 1, name: '另一条世界线', player: { ...validPlayer, fields: { ...validPlayer.fields, name: '焰' }, relations: { 'npc-lily': -20 }, traits: [] } }),
    });
    assert.strictEqual(second.response.status, 201);
    assert.notStrictEqual(first.body.id, second.body.id);
    assert.strictEqual(second.body.player.snapshot.name, '焰');
    assert.strictEqual(second.body.npcStates['npc-lily'].relation.player, -20);
    assert.strictEqual(second.body.state.factionStates['north-guild'].relation, 10, 'faction relation is isolated per save');
    assert.strictEqual(second.body.state.factionStates['north-guild'].resources.funds, 30, 'faction resources are isolated per save');
    assert.strictEqual(first.body.player.snapshot.name, '澪', 'first save remains isolated');
    const secondPlan = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(second.body.id)}/setup`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'setup-plan-2', expectedRevision: second.body.revision, plan: { locationId: 'wolf-tooth-inn', presentNpcIds: [], situation: '焰抵达旅店', hook: '极光在北方闪烁', knownFacts: [], boundaries: [], tone: '悬疑' } }),
    });
    assert.strictEqual(secondPlan.response.status, 200);
    const secondOpening = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(second.body.id)}/opening`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'opening-check-2', expectedRevision: secondPlan.body.revision, opening: '焰在雨幕中推开旅店的门。', options: ['观察炉火', '询问店主', '查看地图', '走向窗边'] }),
    });
    assert.strictEqual(secondOpening.response.status, 200, 'second save also commits its own opening before turns');

    const secondProposal = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(second.body.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'growth-propose-2', expectedRevision: secondOpening.body.revision, actionIntent: { raw: '探索山脊' }, state: { ...secondOpening.body.state, growthCandidates: [{ id: 'growth-test-identity', candidateId: 'ridge-title', sourceId: 'exploration', reason: '完成山脊探索', status: 'proposed' }, { id: 'growth-test-trait', candidateId: 'steady-hand-training', sourceId: 'training', reason: '训练后保持专注', status: 'proposed' }] }, turns: [{ role: 'assistant', content: '你在山脊发现了极光。' }], options: [] }),
    });
    assert.strictEqual(secondProposal.response.status, 200);
    const growthReject = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(second.body.id)}/growth`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'growth-reject-2', expectedRevision: secondProposal.body.revision, candidateId: 'growth-test-trait', decision: 'rejected' }),
    });
    assert.strictEqual(growthReject.response.status, 200, 'player can reject a pending growth candidate');
    assert.deepStrictEqual(growthReject.body.state.growthCandidates.map(item => item.candidateId), ['ridge-title']);
    assert.strictEqual(growthReject.body.state.growthApplications.at(-1).decision, 'rejected');
    assert.deepStrictEqual(growthReject.body.state.experiences, []);
    const secondAccept = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(second.body.id)}/growth`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'growth-accept-2', expectedRevision: growthReject.body.revision, candidateId: 'growth-test-identity', decision: 'accepted' }),
    });
    assert.strictEqual(secondAccept.response.status, 200);
    assert.deepStrictEqual(secondAccept.body.state.player.identity.titles, ['山脊见证者']);
    assert.strictEqual(secondAccept.body.state.experiences.at(-1).effects.bucket, 'identity');

    const invalidDerivedPlayer = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(first.body.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'turn-check-derived', expectedRevision: eventTurn.body.revision, actionIntent: { raw: 'derived' }, state: { ...eventTurn.body.state, player: { ...eventTurn.body.state.player, derived: { readiness: 99 } } }, turns: [{ role: 'assistant', content: 'reject' }], options: [] }),
    });
    assert.strictEqual(invalidDerivedPlayer.response.status, 400, 'derived values are read-only and cannot be persisted');
    const growthAccept = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(first.body.id)}/growth`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'growth-accept-1', expectedRevision: eventTurn.body.revision, candidateId: 'growth-test-1', decision: 'accepted' }),
    });
    assert.strictEqual(growthAccept.response.status, 200, 'player can accept a pending growth candidate');
    assert.strictEqual(growthAccept.body.state.player.skills.scouting, 6);
    assert.deepStrictEqual(growthAccept.body.state.growthCandidates, []);
    assert.strictEqual(growthAccept.body.state.growthApplications.at(-1).decision, 'accepted');
    assert.strictEqual(growthAccept.body.state.experiences.at(-1).candidateId, 'scouting-training');
    const growthReplay = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(first.body.id)}/growth`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'growth-accept-1', expectedRevision: eventTurn.body.revision, candidateId: 'growth-test-1', decision: 'accepted' }),
    });
    assert.strictEqual(growthReplay.response.status, 200, 'growth command is idempotent');
    assert.strictEqual(growthReplay.body.revision, growthAccept.body.revision);

    const invalidCases = [
      { ...validPlayer, fields: { ...validPlayer.fields, name: '' } },
      { ...validPlayer, attributes: { ...validPlayer.attributes, might: 5, wits: 5, spirit: 5, fortune: 5 } },
      { ...validPlayer, attributes: { ...validPlayer.attributes, unknown: 1 } },
      { ...validPlayer, skills: { ...validPlayer.skills, unknown: 1 } },
    ];
    for (const player of invalidCases) {
      const invalid = await jsonRequest(base, '/api/world-saves', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worldId: 'world-aurora', worldVersion: 1, name: 'invalid', player }),
      });
      assert.strictEqual(invalid.response.status, 400);
    }
    const saves = await jsonRequest(base, '/api/world-saves?worldId=world-aurora');
    assert.strictEqual(saves.response.status, 200);
    assert.strictEqual(saves.body.length, 2, 'invalid player input never creates a save');
    console.log('player creation check passed');
  } finally {
    await closeServer();
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
