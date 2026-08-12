'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-world-'));
const defaults = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', '_defaults.json'), 'utf8'));
defaults.worlds.push({
  ...defaults.worlds[0],
  id: 'world-second',
  title: '第二个世界',
  start: { ...defaults.worlds[0].start, locationId: 'second-start' },
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
    assert.strictEqual(afterRestart.body.length, 2, 'saves survive server restart');
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
