'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const MapGen = require(path.join(root, 'public', 'mapgen.js'));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-world-'));
const defaults = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', '_defaults.json'), 'utf8'));
defaults.worlds[0].npcIds = ['npc-lily'];
defaults.worlds[0].npcs = [{ id: 'npc-lily', name: 'Lily', role: 'innkeeper' }];
defaults.worlds[0].locations.push({ id: 'region-2', name: 'Region Two', type: 'region' });
defaults.worlds.push({
  ...defaults.worlds[0],
  id: 'world-second',
  title: '第二个世界',
  start: { ...defaults.worlds[0].start, locationId: 'second-start' },
  locations: [...defaults.worlds[0].locations, { id: 'second-start', name: 'Second Start', type: 'region' }],
});
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
    const generatedMap = MapGen.generateWorldMap(7, { size: 24, regionCount: 4 });
    const serializedMap = MapGen.serializeMap(generatedMap);
    assert.ok(Array.isArray(serializedMap.grid), 'map grid crosses JSON boundary as an array');
    const hydratedMap = MapGen.hydrateMap(serializedMap);
    assert.ok(hydratedMap.grid instanceof Uint16Array, 'map grid hydrates to Uint16Array');
    assert.deepStrictEqual(Array.from(hydratedMap.grid), Array.from(generatedMap.grid));
    await startServer(0);
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;

    const worlds = await jsonRequest(base, '/api/worlds');
    assert.strictEqual(worlds.response.status, 200);
    assert.ok(Array.isArray(worlds.body) && worlds.body.length >= 1);
    const world = worlds.body.find(item => item.id === 'world-aurora');
    assert.ok(world, 'seed world is listed');
    const secondWorld = worlds.body.find(item => item.id === 'world-second');
    assert.ok(secondWorld, 'second world is listed');

    const dataFile = await fetch(base + '/data/worlds.json');
    assert.strictEqual(dataFile.status, 403, 'runtime data is not exposed as static file');
    const genericWorldRead = await fetch(base + '/api/data/worlds');
    assert.strictEqual(genericWorldRead.status, 400, 'world cards do not use generic data API');

    const makeSave = name => jsonRequest(base, '/api/world-saves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: world.id, worldVersion: world.version, name }),
    });
    const first = await makeSave('第一份存档');
    const second = await makeSave('第二份存档');
    const otherWorld = await jsonRequest(base, '/api/world-saves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: secondWorld.id, worldVersion: secondWorld.version, name: '第二世界存档' }),
    });
    assert.strictEqual(first.response.status, 201);
    assert.strictEqual(second.response.status, 201);
    assert.strictEqual(otherWorld.response.status, 201);
    assert.notStrictEqual(first.body.id, second.body.id);
    assert.strictEqual(first.body.revision, 0);
    assert.strictEqual(first.body.state.locationId, 'wolf-tooth-inn');
    assert.deepStrictEqual(first.body.npcStates, {
      'npc-lily': { locationId: 'wolf-tooth-inn', relation: {}, knowledge: [], status: [] },
    });
    assert.deepStrictEqual(second.body.npcStates, first.body.npcStates, 'NPC states are seeded per save');
    assert.deepStrictEqual(otherWorld.body.npcStates, {
      'npc-lily': { locationId: 'second-start', relation: {}, knowledge: [], status: [] },
    }, 'NPC states follow the world start location');

    const list = await jsonRequest(base, '/api/world-saves?worldId=' + encodeURIComponent(world.id));
    assert.strictEqual(list.response.status, 200);
    assert.strictEqual(list.body.length, 2);
    assert.deepStrictEqual(new Set(list.body.map(item => item.id)).size, 2);
    const otherList = await jsonRequest(base, '/api/world-saves?worldId=' + encodeURIComponent(secondWorld.id));
    assert.strictEqual(otherList.response.status, 200);
    assert.strictEqual(otherList.body.length, 1, 'world save lists stay isolated');

    const saved = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id));
    assert.strictEqual(saved.response.status, 200);
    assert.strictEqual(saved.body.name, '第一份存档');
    assert.strictEqual(saved.body.worldId, world.id);
    const statePatch = JSON.parse(JSON.stringify(saved.body.state));
    statePatch.locationId = 'region-2';
    statePatch.map.data = { size: 2, grid: [0, 1, 1, 0], regions: [], points: [], adjacency: [], seed: 7 };
    statePatch.map.imagePath = '/images/world-map.png';
    const savedUpdate = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: saved.body.revision, state: statePatch, turns: [{ id: 'turn-1', role: 'assistant', content: '世界存档内的叙事' }], opening: saved.body.opening }),
    });
    assert.strictEqual(savedUpdate.response.status, 200);
    assert.strictEqual(savedUpdate.body.revision, 1);
    assert.deepStrictEqual(savedUpdate.body.state.map.data.grid, [0, 1, 1, 0]);
    const turnPayload = {
      commandId: 'command-0001',
      expectedRevision: 1,
      state: statePatch,
      turns: [
        { id: 'turn-user-1', role: 'user', content: '进入旅店' },
        { id: 'turn-ai-1', role: 'assistant', content: '你推开了旅店的门。' },
      ],
      options: ['观察炉火', '询问老板', '检查背包', '走向窗边'],
    };
    const turnCommit = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(turnPayload),
    });
    assert.strictEqual(turnCommit.response.status, 200);
    assert.strictEqual(turnCommit.body.revision, 2);
    assert.strictEqual(turnCommit.body.turns.at(-1).commandId, 'command-0001');
    assert.strictEqual(turnCommit.body.receipts.at(-1).commandId, 'command-0001');
    const npcTurn = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...turnPayload,
        commandId: 'command-0005',
        expectedRevision: 2,
        npcStates: { 'npc-lily': { locationId: 'region-2', relation: { trust: 1 }, knowledge: ['玩家曾帮助她'], status: ['alert'] } },
        turns: [
          { id: 'turn-user-2', role: 'user', content: '询问莉莉' },
          { id: 'turn-ai-2', role: 'assistant', content: '莉莉抬头。' },
        ],
        createEntities: [
          { kind: 'npc', tempId: 'traveler-1', name: '临时旅人', role: 'witness', description: '只属于本次存档的目击者', locationId: 'region-2' },
          { kind: 'item', tempId: 'blue-key', name: '蓝色钥匙', count: 1, locationId: 'region-2' },
        ],
      }),
    });
    assert.strictEqual(npcTurn.response.status, 200);
    assert.strictEqual(npcTurn.body.revision, 3);
    assert.strictEqual(npcTurn.body.npcStates['npc-lily'].locationId, 'region-2');
    const generatedNpcId = Object.keys(npcTurn.body.generatedEntities.npcs || {})[0];
    assert.match(generatedNpcId, new RegExp(`^save:${first.body.id}:npc:1$`));
    assert.strictEqual(npcTurn.body.generatedEntities.npcs[generatedNpcId].name, '临时旅人');
    assert.strictEqual(npcTurn.body.generatedEntities.npcs[generatedNpcId].role, 'witness');
    assert.strictEqual(Object.keys(npcTurn.body.generatedEntities.items || {}).length, 1);
    const sourceWorldCard = await jsonRequest(base, `/api/worlds/${encodeURIComponent(world.id)}?version=${world.version}`);
    assert.strictEqual(sourceWorldCard.response.status, 200);
    assert.strictEqual(sourceWorldCard.body.version, world.version);
    assert.ok(!sourceWorldCard.body.npcs.some(npc => npc.id === generatedNpcId), 'source world remains unchanged');
    const promotion = await jsonRequest(base, `/api/worlds/${encodeURIComponent(world.id)}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceSaveId: first.body.id, expectedRevision: 3, npcId: generatedNpcId, title: '极光大陆 · 收录旅人' }),
    });
    assert.strictEqual(promotion.response.status, 201);
    assert.strictEqual(promotion.body.world.id, world.id);
    assert.strictEqual(promotion.body.world.version, Number(world.version) + 1);
    assert.ok(promotion.body.npcId && promotion.body.npcId !== generatedNpcId);
    assert.ok(promotion.body.world.npcIds.includes(promotion.body.npcId));
    assert.strictEqual(promotion.body.world.npcs.find(npc => npc.id === promotion.body.npcId).sourceGeneratedEntityId, generatedNpcId);
    const duplicatePromotion = await jsonRequest(base, `/api/worlds/${encodeURIComponent(world.id)}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceSaveId: first.body.id, expectedRevision: 3, npcId: generatedNpcId }),
    });
    assert.strictEqual(duplicatePromotion.response.status, 200, 'promotion is idempotent');
    assert.strictEqual(duplicatePromotion.body.npcId, promotion.body.npcId);
    const latestWorld = await jsonRequest(base, `/api/worlds/${encodeURIComponent(world.id)}`);
    assert.strictEqual(latestWorld.response.status, 200);
    assert.strictEqual(latestWorld.body.version, promotion.body.world.version);
    assert.ok(latestWorld.body.npcIds.includes(promotion.body.npcId));
    const promotedSave = await jsonRequest(base, '/api/world-saves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: world.id, worldVersion: latestWorld.body.version, name: '收录后新存档' }),
    });
    assert.strictEqual(promotedSave.response.status, 201);
    assert.ok(promotedSave.body.npcStates[promotion.body.npcId], 'new version seeds promoted NPC state');
    const oldSaveAfterPromotion = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id));
    assert.strictEqual(oldSaveAfterPromotion.body.worldVersion, world.version, 'old save stays pinned to source version');
    assert.ok(!oldSaveAfterPromotion.body.npcStates[promotion.body.npcId], 'old save does not receive promoted NPC');
    const duplicateGeneratedTurn = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...turnPayload,
        commandId: 'command-0005',
        expectedRevision: 2,
        npcStates: { 'npc-lily': { locationId: 'region-2', relation: { trust: 1 }, knowledge: ['玩家曾帮助她'], status: ['alert'] } },
        turns: [{ id: 'turn-user-2', role: 'user', content: '询问莉莉' }, { id: 'turn-ai-2', role: 'assistant', content: '莉莉抬头。' }],
        createEntities: [
          { kind: 'npc', tempId: 'traveler-1', name: '临时旅人', role: 'witness', description: '只属于本次存档的目击者', locationId: 'region-2' },
          { kind: 'item', tempId: 'blue-key', name: '蓝色钥匙', count: 1, locationId: 'region-2' },
        ],
      }),
    });
    assert.strictEqual(duplicateGeneratedTurn.response.status, 200, 'generated entity command is idempotent');
    assert.strictEqual(Object.keys(duplicateGeneratedTurn.body.generatedEntities.npcs || {}).length, 1);
    const invalidLocation = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...turnPayload, commandId: 'command-0008', expectedRevision: 3, state: { ...statePatch, locationId: '自由文本地点' } }),
    });
    assert.strictEqual(invalidLocation.response.status, 400, 'free-text locations are rejected');
    const unknownNpcState = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...turnPayload, commandId: 'command-0007', expectedRevision: 3, npcStates: { 'npc-other-save': { locationId: 'region-9' } } }),
    });
    assert.strictEqual(unknownNpcState.response.status, 400, 'NPC state cannot cross save/world ownership');
    const secondReload = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(second.body.id));
    assert.strictEqual(secondReload.response.status, 200);
    assert.strictEqual(secondReload.body.revision, 0);
    assert.strictEqual(secondReload.body.npcStates['npc-lily'].locationId, 'wolf-tooth-inn', 'NPC state does not leak across saves');
    assert.deepStrictEqual(secondReload.body.generatedEntities, {}, 'generated entities do not leak across saves');
    const duplicateTurn = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(turnPayload),
    });
    assert.strictEqual(duplicateTurn.response.status, 200, 'duplicate command is idempotent');
    assert.strictEqual(duplicateTurn.body.revision, 3);
    const badOptions = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...turnPayload, commandId: 'command-0002', expectedRevision: 2, options: ['重复', '重复', '三', '四'] }),
    });
    assert.strictEqual(badOptions.response.status, 400, 'candidate options are validated');
    const badState = JSON.parse(JSON.stringify(statePatch));
    badState.stats.hp = 1000000001;
    const invalidState = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...turnPayload, commandId: 'command-0003', expectedRevision: 2, state: badState }),
    });
    assert.strictEqual(invalidState.response.status, 400, 'candidate numeric state is bounded');
    const badInventory = JSON.parse(JSON.stringify(statePatch));
    badInventory.inventory = [{ name: '超大数量', count: 1000001 }];
    const invalidInventory = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...turnPayload, commandId: 'command-0004', expectedRevision: 2, state: badInventory }),
    });
    assert.strictEqual(invalidInventory.response.status, 400, 'candidate inventory is bounded');
    const invalidNpcState = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...turnPayload, commandId: 'command-0006', expectedRevision: 3, npcStates: { 'npc-lily': { knowledge: new Array(129).fill('x') } } }),
    });
    assert.strictEqual(invalidNpcState.response.status, 400, 'candidate NPC state is bounded');
    const invalidCreateEntity = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...turnPayload, commandId: 'command-0009', expectedRevision: 3, createEntities: [{ kind: 'world-rule', tempId: 'bad', name: '越界实体' }] }),
    });
    assert.strictEqual(invalidCreateEntity.response.status, 400, 'unsupported generated entity kind is rejected');
    const conflict = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 0, state: statePatch, turns: [], opening: saved.body.opening }),
    });
    assert.strictEqual(conflict.response.status, 409, 'stale revision is rejected');
    const badImagePath = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, state: { ...statePatch, map: { ...statePatch.map, imagePath: '../secret.png' } }, turns: [], opening: saved.body.opening }),
    });
    assert.strictEqual(badImagePath.response.status, 400, 'external image path is rejected');

    const traversal = await jsonRequest(base, '/api/world-saves/%2e%2e%2fworlds');
    assert.strictEqual(traversal.response.status, 400, 'path traversal is rejected');
    const badWorld = await jsonRequest(base, '/api/world-saves?worldId=../secrets');
    assert.strictEqual(badWorld.response.status, 400, 'invalid worldId is rejected');
    const badPayload = await jsonRequest(base, '/api/world-saves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: world.id, worldVersion: world.version, name: '' }),
    });
    assert.strictEqual(badPayload.response.status, 400);
    const badNameType = await jsonRequest(base, '/api/world-saves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: world.id, worldVersion: world.version, name: { value: '对象' } }),
    });
    assert.strictEqual(badNameType.response.status, 400);
    const unknownWorld = await jsonRequest(base, '/api/world-saves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: 'world-missing', worldVersion: 1, name: '未知世界' }),
    });
    assert.strictEqual(unknownWorld.response.status, 404);

    await closeServer();
    await startServer(0);
    const restarted = server.address();
    const afterRestart = await jsonRequest(`http://127.0.0.1:${restarted.port}`, '/api/world-saves?worldId=' + encodeURIComponent(world.id));
    assert.strictEqual(afterRestart.response.status, 200);
    assert.strictEqual(afterRestart.body.length, 3, 'saves survive server restart');
    console.log('world storage check passed');
  } finally {
    await closeServer();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
