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
world.npcs = [{ id: 'npc-lily', name: '莉莉', role: 'innkeeper' }];
world.playerCreation.relations = [{ npcId: 'npc-lily', label: '与莉莉的关系', min: -100, max: 100, default: 5 }];
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
      body: JSON.stringify({ commandId: 'turn-check-1', expectedRevision: opening.body.revision, state: opening.body.state, turns: [
        { role: 'user', content: '观察四周', ts: Date.now() },
        { role: 'assistant', content: '你看见雨水沿着窗棂滑落。', ts: Date.now() },
      ], options: [] }),
    });
    assert.strictEqual(freeTurn.response.status, 200, 'world card can allow zero suggestions');

    const second = await jsonRequest(base, '/api/world-saves', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: 'world-aurora', worldVersion: 1, name: '另一条世界线', player: { ...validPlayer, fields: { ...validPlayer.fields, name: '焰' }, relations: { 'npc-lily': -20 }, traits: [] } }),
    });
    assert.strictEqual(second.response.status, 201);
    assert.notStrictEqual(first.body.id, second.body.id);
    assert.strictEqual(second.body.player.snapshot.name, '焰');
    assert.strictEqual(second.body.npcStates['npc-lily'].relation.player, -20);
    assert.strictEqual(first.body.player.snapshot.name, '澪', 'first save remains isolated');

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
