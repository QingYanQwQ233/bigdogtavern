'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-gen3-'));
const defaults = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', '_defaults.json'), 'utf8'));
const world = defaults.worlds[0];
world.start = { ...(world.start || {}), openingMode: 'static' };
world.runtime = {
  version: 1,
  variables: [{ id: 'weather', label: '天气', scope: 'world', type: 'enum', options: ['晴朗', '降雨'], initial: '晴朗' }, { id: 'alarm', label: '警报', scope: 'save', type: 'number', min: 0, max: 3, initial: 0 }],
  collections: [{ id: 'shop', label: '商城', scope: 'save', initial: [{ id: 'potion', name: '治疗药水', price: 10 }] }],
  actions: [{ id: 'restock', label: '补货', effects: [{ type: 'collection.add', collectionId: 'shop', value: { id: 'torch', name: '火把', price: 3 } }] }],
};
fs.writeFileSync(path.join(tempDir, '_defaults.json'), JSON.stringify(defaults, null, 2));
fs.writeFileSync(path.join(tempDir, 'worlds.json'), JSON.stringify(defaults.worlds, null, 2));
process.env.TAVERN_DATA_DIR = tempDir;

const { server, startServer } = require(path.join(root, 'server.js'));
const closeServer = () => new Promise(resolve => server.listening ? server.close(resolve) : resolve());
async function request(base, pathname, options) {
  const response = await fetch(base + pathname, options);
  return { response, body: await response.json().catch(() => null) };
}

async function main() {
  try {
    await startServer(0);
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;
    const worldRead = await request(base, `/api/worlds/${world.id}?version=${world.version}`);
    assert.strictEqual(worldRead.response.status, 200);
    const draft = await request(base, '/api/world-drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ worldId: world.id, baseVersion: world.version }) });
    assert.strictEqual(draft.response.status, 201);
    const runtime = world.runtime;
    const draftPut = await request(base, `/api/world-drafts/${world.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedUpdatedAt: draft.body.updatedAt, baseVersion: world.version, title: world.title, summary: world.summary || '', tags: world.tags || [], lorebookIds: world.lorebookIds || [], runtime, ui: { layout: 'world-desk', sidebar: { panels: [{ id: 'shop', title: '商城', source: 'runtime.collections.shop', layout: 'cards', fields: [{ key: 'price', label: '价格' }] }, { id: 'weather', title: '天气', source: 'runtime.variables.weather', layout: 'list' }] } } }),
    });
    assert.strictEqual(draftPut.response.status, 200, JSON.stringify(draftPut.body));
    assert.strictEqual(draftPut.body.world.runtime.collections[0].id, 'shop');
    assert.strictEqual(draftPut.body.world.ui.sidebar.panels[0].source, 'runtime.collections.shop');
    const publish = await request(base, `/api/world-drafts/${world.id}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId: 'gen3-publish', expectedUpdatedAt: draftPut.body.updatedAt, baseVersion: world.version }) });
    assert.strictEqual(publish.response.status, 201, JSON.stringify(publish.body));
    const published = publish.body.world;
    const save = await request(base, '/api/world-saves', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ worldId: world.id, worldVersion: published.version, name: 'GEN3 测试存档' }) });
    assert.strictEqual(save.response.status, 201, JSON.stringify(save.body));
    assert.strictEqual(save.body.state.runtime.variables.weather, '晴朗');
    assert.strictEqual(save.body.state.runtime.collections.shop[0].id, 'potion');
    const patch = { protocol: 'tavern.rpg.turn', version: 1, baseRevision: 0, updates: [{ type: 'runtime.variable.set', id: 'weather', value: '降雨' }, { type: 'runtime.variable.delta', id: 'alarm', delta: 1 }, { type: 'runtime.collection.add', collectionId: 'shop', value: { id: 'torch', name: '火把', price: 3 } }, { type: 'runtime.action.execute', actionId: 'restock', input: {} }], options: [] };
    const commit = await request(base, `/api/world-saves/${save.body.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId: 'gen3-turn', expectedRevision: 0, patch, turns: [{ role: 'assistant', content: 'GEN3 test' }], options: [] }) });
    assert.strictEqual(commit.response.status, 200, JSON.stringify(commit.body));
    assert.strictEqual(commit.body.state.runtime.variables.weather, '降雨');
    assert.strictEqual(commit.body.state.runtime.variables.alarm, 1);
    assert.strictEqual(commit.body.state.runtime.collections.shop.filter(item => item.id === 'torch').length, 1, 'collection add is idempotent');
    const invalid = await request(base, `/api/world-saves/${save.body.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId: 'gen3-invalid', expectedRevision: 1, patch: { ...patch, baseRevision: 1, updates: [{ type: 'runtime.variable.set', id: 'not-declared', value: true }] }, turns: [{ role: 'assistant', content: 'invalid' }], options: [] }) });
    assert.strictEqual(invalid.response.status, 400);
    assert.match(String(invalid.body?.error || ''), /未声明变量/);
    console.log('check_rpg_gen3: ok');
  } finally {
    await closeServer();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
