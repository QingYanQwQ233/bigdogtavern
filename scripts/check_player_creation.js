'use strict';

// Contract check for the current, schema-driven RPG setup flow.
// Legacy world-card economy/inventory/growth fixtures intentionally do not belong here;
// runtime extensions are covered by check_runtime_roundtrip.js.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-player-'));
const defaults = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', '_defaults.json'), 'utf8'));
const sourceWorld = defaults.worlds.find(world => world.id === 'world-aurora');
const testWorld = JSON.parse(JSON.stringify(sourceWorld));
testWorld.id = 'world-player-creation-test';
testWorld.ui = {
  ...(testWorld.ui || {}),
  extension: {
    ...(testWorld.ui?.extension || {}),
    surfaces: ['setup', 'play'],
    permissions: ['read.public', 'read.save', 'write.setup'],
  },
};
const testDefaults = { ...defaults, worlds: [testWorld] };
fs.writeFileSync(path.join(tempDir, '_defaults.json'), JSON.stringify(testDefaults, null, 2));
fs.writeFileSync(path.join(tempDir, 'worlds.json'), JSON.stringify([testWorld], null, 2));
process.env.TAVERN_DATA_DIR = tempDir;

const { server, startServer } = require(path.join(root, 'server.js'));

function request(base, pathname, options) {
  return fetch(base + pathname, options).then(async response => ({
    response,
    body: await response.json().catch(() => null),
  }));
}

async function main() {
  try {
    await startServer(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const world = await request(base, '/api/worlds/world-player-creation-test?version=1');
    assert.strictEqual(world.response.status, 200, JSON.stringify(world.body));
    assert.strictEqual(world.body.playerCreation.mode, 'custom');
    assert.ok(world.body.playerCreation.fields.some(field => field.id === 'name'));
    assert.ok(world.body.playerCreation.attributes.some(attribute => attribute.id === 'wits'));
    assert.ok(world.body.playerCreation.skills.some(skill => skill.id === 'scouting'));
    assert.ok(Array.isArray(world.body.playerCreation.choices));
    assert.ok(Array.isArray(world.body.playerCreation.buildPresets));
    assert.strictEqual(world.body.playerCreation.initialInventory, undefined, 'legacy inventory schema must not leak into the public card');
    assert.strictEqual(world.body.playerCreation.economy, undefined, 'legacy economy schema must not leak into the public card');
    assert.ok(Array.isArray(world.body.sessionSetup.fields));
    assert.ok(!('inventory' in (world.body.start?.initialState || {})), 'legacy start inventory must not leak');

    const player = {
      fields: { name: '澪', race: '狐人', role: '旅人', background: '从北境来到断牙之角。' },
      attributes: { might: 2, wits: 2, spirit: 2, fortune: 2 },
      skills: { scouting: 2, empathy: 1 },
      resources: { hp: 20, mp: 5, gold: 10 },
      traits: [],
      choices: [],
      relations: {},
    };
    const created = await request(base, '/api/world-saves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: testWorld.id, worldVersion: 1, name: '澪的世界线', setupOnly: true }),
    });
    assert.strictEqual(created.response.status, 201, JSON.stringify(created.body));
    assert.strictEqual(created.body.setup.status, 'planning');
    assert.strictEqual(created.body.player, undefined);

    const draft = await request(base, `/api/world-saves/${encodeURIComponent(created.body.id)}/setup`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandId: 'player-draft-1',
        expectedRevision: created.body.revision,
        draft: { player, game: { difficulty: 'story' }, plan: null, ui: { step: 1 } },
      }),
    });
    assert.strictEqual(draft.response.status, 200, JSON.stringify(draft.body));
    assert.strictEqual(draft.body.setup.draft.player.fields.name, '澪');

    const committed = await request(base, `/api/world-saves/${encodeURIComponent(created.body.id)}/setup`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandId: 'player-commit-1',
        expectedRevision: draft.body.revision,
        player,
        game: { difficulty: 'story' },
        plan: null,
      }),
    });
    assert.strictEqual(committed.response.status, 200, JSON.stringify(committed.body));
    assert.strictEqual(committed.body.player.snapshot.fields.name, '澪');
    assert.strictEqual(committed.body.setup.draft, null);
    assert.strictEqual(committed.body.setup.status, 'planning');
    assert.ok(!('inventory' in committed.body.state), 'legacy inventory state must not be materialized');
    assert.ok(committed.body.state.player && committed.body.state.player.attributes);
    console.log('player creation check passed');
  } finally {
    await new Promise(resolve => server.listening ? server.close(resolve) : resolve());
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
