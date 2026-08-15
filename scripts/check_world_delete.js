'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-world-delete-'));
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

async function main() {
  try {
    await startServer(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const saveId = 'save-delete-test';
    const now = Date.now();
    fs.writeFileSync(path.join(tempDir, 'saves', saveId + '.json'), JSON.stringify({
      schemaVersion: 1, id: saveId, name: '删除测试存档', worldId: 'world-test-lab', worldVersion: 1,
      createdAt: now, updatedAt: now, revision: 0, state: { locationId: 'white-tide-port' },
      setup: { status: 'active' }, turns: [], opening: '',
    }));

    const blocked = await jsonRequest(base, '/api/worlds/world-test-lab', { method: 'DELETE' });
    assert.strictEqual(blocked.response.status, 409, JSON.stringify(blocked.body));
    assert.strictEqual(blocked.body.saveCount, 1);

    const deletedSave = await jsonRequest(base, `/api/world-saves/${saveId}`, { method: 'DELETE' });
    assert.strictEqual(deletedSave.response.status, 200, JSON.stringify(deletedSave.body));
    const missingSave = await jsonRequest(base, `/api/world-saves/${saveId}`);
    assert.strictEqual(missingSave.response.status, 404);

    const deletedWorld = await jsonRequest(base, '/api/worlds/world-test-lab', { method: 'DELETE' });
    assert.strictEqual(deletedWorld.response.status, 200, JSON.stringify(deletedWorld.body));
    const missingWorld = await jsonRequest(base, '/api/worlds/world-test-lab');
    assert.strictEqual(missingWorld.response.status, 404);
    const worlds = await jsonRequest(base, '/api/worlds');
    assert.strictEqual(worlds.response.status, 200);
    assert.ok(!worlds.body.some(world => world.id === 'world-test-lab'));

    console.log('world save/world card delete check passed');
  } finally {
    await closeServer();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
