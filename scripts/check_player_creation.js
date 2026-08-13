'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-player-'));
const defaults = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', '_defaults.json'), 'utf8'));
const world = defaults.worlds[0];
world.npcIds = ['npc-lily'];
world.factions = [{ id: 'north-guild', name: 'North Guild', goals: ['Protect the pass'], resources: [{ id: 'funds', label: 'Funds', min: 0, max: 100, initial: 40 }], initialState: { relation: 10, influence: 4, resources: { funds: 30 } }, actions: [{ id: 'patrol-pass', title: '巡逻山口', description: '北方公会派出巡逻队。', trigger: { at: 9, locationId: 'wolf-tooth-inn' }, changes: { relation: 2, resources: { funds: -5 } }, consequences: ['山口暂时安全。'] }] }];
world.npcs = [{ id: 'npc-lily', name: '莉莉', role: 'innkeeper' }];
world.playerCreation.relations = [{ npcId: 'npc-lily', label: '与莉莉的关系', min: -100, max: 100, default: 5 }];
world.events.push({ id: 'inn-echo', title: '旅店回响', description: '炉火后传来一声短促的回响。', trigger: { locationId: 'wolf-tooth-inn' }, visibility: 'local', once: true });
world.start.initialState.goals = [{ id: 'deadline-goal', title: 'Deadline', desc: 'expires at start', status: 'active', deadline: { unit: 'hour', value: 8 } }];
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
    assert.strictEqual(worldResponse.body.playerCreation.derived[0].formula, 'attributes.wits + attributes.spirit');
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
      resources: { hp: 24, mp: 8, gold: 30 },
      traits: ['keen-sense'],
      relations: { 'npc-lily': 25 },
    };
    const first = await jsonRequest(base, '/api/world-saves', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: 'world-aurora', worldVersion: 1, name: '澪的第一条世界线', player: validPlayer }),
    });
    assert.strictEqual(first.response.status, 201);
    assert.deepStrictEqual(first.body.player.snapshot.fields, validPlayer.fields);
    assert.deepStrictEqual(first.body.player.snapshot.attributes, validPlayer.attributes);
    assert.deepStrictEqual(first.body.player.snapshot.traits, validPlayer.traits);
    assert.strictEqual(first.body.state.player.resources.hp, 24);
    assert.strictEqual(first.body.state.stats.hp, 24);
    assert.strictEqual(first.body.npcStates['npc-lily'].relation.player, 25);
    assert.strictEqual(first.body.state.factionStates['north-guild'].relation, 10);
    assert.strictEqual(first.body.state.factionStates['north-guild'].resources.funds, 30);
    assert.strictEqual(first.body.openingMode, 'ai');
    const opening = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(first.body.id)}/opening`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'opening-check-1', expectedRevision: first.body.revision, opening: '你在雨幕中推开旅店的门。', options: ['观察炉火', '询问店主', '查看地图', '走向窗边'] }),
    });
    assert.strictEqual(opening.response.status, 200);
    assert.strictEqual(opening.body.opening, '你在雨幕中推开旅店的门。');
    assert.deepStrictEqual(opening.body.openingOptions, ['观察炉火', '询问店主', '查看地图', '走向窗边']);
    const openingRetry = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(first.body.id)}/opening`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'opening-check-1', expectedRevision: first.body.revision, opening: 'different', options: ['a', 'b', 'c', 'd'] }),
    });
    assert.strictEqual(openingRetry.response.status, 200, 'opening command is idempotent');
    const freeTurn = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(first.body.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'turn-check-1', expectedRevision: opening.body.revision, actionIntent: { raw: '观察四周', risk: '低' }, state: opening.body.state, turns: [
        { role: 'user', content: '观察四周', ts: Date.now() },
        { role: 'assistant', content: '你看见雨水沿着窗棂滑落。', ts: Date.now() },
      ], options: [] }),
    });
    assert.strictEqual(freeTurn.response.status, 200, 'world card can allow zero suggestions');
    assert.strictEqual(freeTurn.body.turns.at(-2).actionIntent.raw, '观察四周');
    assert.strictEqual(freeTurn.body.state.time.value, 9, 'server advances world time once per committed turn');
    assert.strictEqual(freeTurn.body.state.goals[0].status, 'failed', 'expired goals fail after the server advances time');
    assert.strictEqual(freeTurn.body.state.goals[0].deadlineStatus, 'expired');
    assert.deepStrictEqual(freeTurn.body.receipts.at(-1).deadlineIds, ['goals:deadline-goal']);
    assert.deepStrictEqual(freeTurn.body.state.worldEvents.map(event => event.eventId), ['inn-echo', 'faction-north-guild-patrol-pass']);
    assert.strictEqual(freeTurn.body.state.factionStates['north-guild'].relation, 12);
    assert.strictEqual(freeTurn.body.state.factionStates['north-guild'].resources.funds, 25);
    assert.deepStrictEqual(freeTurn.body.receipts.at(-1).factionActionIds, ['north-guild:patrol-pass']);
    const tamperedDice = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(first.body.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'turn-check-2', expectedRevision: freeTurn.body.revision, actionIntent: { raw: '掷骰', dice: [{ expr: '1d20', rolls: [20], bonus: 0, total: 1 }] }, state: freeTurn.body.state, turns: [{ role: 'user', content: '掷骰', ts: Date.now() }, { role: 'assistant', content: '结果。', ts: Date.now() }], options: [] }),
    });
    assert.strictEqual(tamperedDice.response.status, 400, 'tampered dice result is rejected');
    const eventTurn = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(first.body.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'turn-check-3', expectedRevision: freeTurn.body.revision, actionIntent: { raw: '继续观察' }, state: { ...freeTurn.body.state, player: { ...freeTurn.body.state.player, attributes: { ...freeTurn.body.state.player.attributes, might: 4 } }, goals: [{ id: 'find-aurora', title: '查明极光异动', desc: '找到山脊上的异常光源。', status: 'active', locationId: 'wolf-tooth-inn' }], leads: [{ id: 'inn-rumor', title: '旅店传闻', desc: '有人听见山脊方向的回响。', status: 'active', locationId: 'wolf-tooth-inn' }] }, turns: [{ role: 'user', content: '继续观察', ts: Date.now() }, { role: 'assistant', content: '极光忽然亮起。', ts: Date.now() }], options: [] }),
    });
    assert.strictEqual(eventTurn.response.status, 200);
    assert.strictEqual(eventTurn.body.state.time.value, 10);
    assert.deepStrictEqual(eventTurn.body.state.worldEvents.map(event => event.eventId), ['inn-echo', 'faction-north-guild-patrol-pass', 'aurora-omen']);
    assert.deepStrictEqual(eventTurn.body.receipts.at(-1).factionActionIds, [], 'faction action does not repeat on later turns');
    assert.strictEqual(eventTurn.body.state.goals[0].id, 'find-aurora');
    assert.strictEqual(eventTurn.body.state.leads[0].id, 'inn-rumor');
    assert.strictEqual(eventTurn.body.state.player.attributes.might, 4);
    assert.deepStrictEqual(eventTurn.body.receipts.at(-1).eventIds, ['aurora-omen']);
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

    const invalidDerivedPlayer = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(first.body.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'turn-check-derived', expectedRevision: eventTurn.body.revision, actionIntent: { raw: 'derived' }, state: { ...eventTurn.body.state, player: { ...eventTurn.body.state.player, derived: { readiness: 99 } } }, turns: [{ role: 'assistant', content: 'reject' }], options: [] }),
    });
    assert.strictEqual(invalidDerivedPlayer.response.status, 400, 'derived values are read-only and cannot be persisted');

    const invalidCases = [
      { ...validPlayer, fields: { ...validPlayer.fields, name: '' } },
      { ...validPlayer, attributes: { ...validPlayer.attributes, might: 5, wits: 5, spirit: 5, fortune: 5 } },
      { ...validPlayer, attributes: { ...validPlayer.attributes, unknown: 1 } },
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
