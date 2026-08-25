'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-setup-surface-'));
const defaults = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', '_defaults.json'), 'utf8'));
const source = defaults.worlds.find(world => world.id === 'world-electronic-yandere') || defaults.worlds[0];
const world = JSON.parse(JSON.stringify(source));
world.id = 'world-setup-surface-test';
world.ui = { ...(world.ui || {}), extension: { ...(world.ui?.extension || {}), surfaces: ['setup', 'play'], permissions: [...new Set([...(world.ui?.extension?.permissions || []), 'write.setup'])] } };
fs.writeFileSync(path.join(tempDir, '_defaults.json'), JSON.stringify({ ...defaults, worlds: [world] }));
fs.writeFileSync(path.join(tempDir, 'worlds.json'), JSON.stringify([world]));
process.env.TAVERN_DATA_DIR = tempDir;

const { server, startServer } = require(path.join(root, 'server.js'));

async function request(base, pathname, options) {
  const response = await fetch(base + pathname, options);
  return { response, body: await response.json().catch(() => null) };
}

async function main() {
  try {
    await startServer(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const player = {
      fields: { name: '开局测试者', gender: '自定义', age: 24, role: '访客', background: 'setup surface test', customNotes: '' },
      attributes: { nerve: 4, intuition: 5, empathy: 4 },
      skills: { debugging: 2, observation: 2 },
      resources: { hp: 20, focus: 10, credits: 3 },
      traits: [], choices: [], relations: { 'npc-yui': 0 }, initialInventory: { 'terminal-key': 1 },
    };
    const created = await request(base, '/api/world-saves', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: world.id, worldVersion: world.version, name: 'setup surface', setupOnly: true }),
    });
    assert.strictEqual(created.response.status, 201, JSON.stringify(created.body));
    assert.strictEqual(created.body.setup.status, 'planning');
    assert.strictEqual(created.body.player, undefined);
    assert.strictEqual(created.body.setup.draft.player, null);

    const draft = await request(base, `/api/world-saves/${created.body.id}/setup`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'setup-draft-test', expectedRevision: created.body.revision, draft: { player: { fields: { name: '草稿角色' } }, game: { difficulty: 'story' }, plan: null, ui: { step: 1 } } }),
    });
    assert.strictEqual(draft.response.status, 200, JSON.stringify(draft.body));
    assert.strictEqual(draft.body.setup.draft.player.fields.name, '草稿角色');

    const missingPlayer = await request(base, `/api/world-saves/${created.body.id}/setup`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'setup-commit-missing-player', expectedRevision: draft.body.revision, game: {}, plan: null }),
    });
    assert.strictEqual(missingPlayer.response.status, 409, JSON.stringify(missingPlayer.body));

    const committed = await request(base, `/api/world-saves/${created.body.id}/setup`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'setup-commit-test', expectedRevision: draft.body.revision, player, game: {}, plan: null }),
    });
    assert.strictEqual(committed.response.status, 200, JSON.stringify(committed.body));
    assert.strictEqual(committed.body.player.snapshot.name, '开局测试者');
    assert.strictEqual(committed.body.setup.draft, null);
    console.log('check_world_setup_surface: ok');
  } finally {
    await new Promise(resolve => server.listening ? server.close(resolve) : resolve());
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
