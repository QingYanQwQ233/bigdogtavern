'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
assert.match(indexHtml, /id="world-draft-extension-editor"/);
assert.match(indexHtml, /id="world-extension-enabled"/);
assert.match(indexHtml, /id="world-extension-load-json"/);
assert.match(appJs, /function collectWorldDraftExtension\(\)/);
assert.match(appJs, /fillWorldDraftExtensionEditor\(world\.ui\?\.extension\)/);
assert.match(appJs, /function submitWorldExtensionChoice\(text, actionId, input, updates\)/);
assert.match(appJs, /runtime\.action\.execute', actionId, input: data\.input \}\], \{ render: false \}\)/);
assert.match(appJs, /context\.messages = messages/);
assert.match(appJs, /data-tavern-messages/);
assert.match(appJs, /data-tavern-narrative/);
assert.match(appJs, /data-tavern-options/);
assert.match(appJs, /data-tavern-input/);
assert.match(appJs, /data-tavern-bind/);
assert.match(appJs, /data-tavern-show/);
assert.match(appJs, /player: save\.state\?\.player/);
assert.match(appJs, /TavernExtension\.choose/);
assert.match(appJs, /MVU 消息未包含可映射的 updates 或 variables/);
assert.doesNotMatch(appJs, /tavern-auto-messages/);
assert.match(appJs, /function worldCardUsesImmersive\(world = currentWorldCard\(\)\)/);
assert.match(appJs, /function executableContentKinds\(value, key = ''\)/);
assert.match(appJs, /function approveWorldExtensionCode\(extension\)/);
assert.match(appJs, /仅在隔离 sandbox iframe 中启用世界扩展/);
assert.match(appJs, /prefs\.extensionApprovals/);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-extension-'));
const defaults = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', '_defaults.json'), 'utf8'));
const world = defaults.worlds[0];
world.start = { ...(world.start || {}), openingMode: 'static' };
world.runtime = {
  version: 1,
  variables: [{ id: 'alarm', label: '警报', scope: 'save', type: 'number', min: 0, max: 3, initial: 0 }],
  collections: [{ id: 'shop', label: '商城', scope: 'save', initial: [{ id: 'potion', name: '治疗药水' }] }],
  actions: [{ id: 'restock', label: '补货', effects: [{ type: 'collection.add', collectionId: 'shop', value: { id: 'torch', name: '火把' } }] }],
};
world.ui = {
  extension: {
    enabled: true,
    title: '测试 HUD',
    html: '<button id="rest">补货</button>',
    css: '#rest{padding:8px}',
    js: 'document.querySelector("#rest").onclick=()=>TavernExtension.action("restock",{});',
    mvu: { protocol: 'mvu.compat', version: 1 },
    permissions: ['read.public', 'read.save', 'write.runtime', 'tool.call'],
  },
};
fs.writeFileSync(path.join(tempDir, '_defaults.json'), JSON.stringify(defaults));
fs.writeFileSync(path.join(tempDir, 'worlds.json'), JSON.stringify(defaults.worlds));
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
    const base = `http://127.0.0.1:${server.address().port}`;
    const draft = await request(base, '/api/world-drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ worldId: world.id, baseVersion: world.version }) });
    assert.strictEqual(draft.response.status, 201);
    const put = await request(base, `/api/world-drafts/${world.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedUpdatedAt: draft.body.updatedAt, baseVersion: world.version, title: world.title, summary: world.summary || '', tags: world.tags || [], lorebookIds: world.lorebookIds || [], runtime: world.runtime, ui: world.ui }) });
    assert.strictEqual(put.response.status, 200, JSON.stringify(put.body));
    assert.strictEqual(put.body.world.ui.extension.title, '测试 HUD');
    const publish = await request(base, `/api/world-drafts/${world.id}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId: 'ext-publish-1', expectedUpdatedAt: put.body.updatedAt, baseVersion: world.version }) });
    assert.strictEqual(publish.response.status, 201, JSON.stringify(publish.body));
    const save = await request(base, '/api/world-saves', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ worldId: world.id, worldVersion: publish.body.world.version, name: '扩展测试' }) });
    assert.strictEqual(save.response.status, 201, JSON.stringify(save.body));
    const runtime = await request(base, `/api/world-saves/${save.body.id}/runtime`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId: 'ext-runtime-1', expectedRevision: 0, updates: [{ type: 'runtime.variable.delta', id: 'alarm', delta: 1 }, { type: 'runtime.action.execute', actionId: 'restock', input: {} }] }) });
    assert.strictEqual(runtime.response.status, 200, JSON.stringify(runtime.body));
    assert.strictEqual(runtime.body.state.runtime.variables.alarm, 1);
    assert.strictEqual(runtime.body.state.runtime.collections.shop.some(item => item.id === 'torch'), true);
    const mvu = await request(base, `/api/world-saves/${save.body.id}/runtime`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId: 'ext-mvu-1', expectedRevision: 1, mvu: { variables: { alarm: 2 } } }) });
    assert.strictEqual(mvu.response.status, 200, JSON.stringify(mvu.body));
    assert.strictEqual(mvu.body.state.runtime.variables.alarm, 2, 'MVU variables 映射为 typed runtime patch');
    const replay = await request(base, `/api/world-saves/${save.body.id}/runtime`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId: 'ext-runtime-1', expectedRevision: 0, updates: [{ type: 'runtime.variable.delta', id: 'alarm', delta: 1 }] }) });
    assert.strictEqual(replay.response.status, 200);
    assert.strictEqual(replay.body.revision, 2, '重复 commandId 必须幂等且返回当前存档版本');
    const invalid = await request(base, `/api/world-saves/${save.body.id}/runtime`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId: 'ext-runtime-2', expectedRevision: 2, updates: [{ type: 'player.resource.delta', id: 'hp', delta: -1 }] }) });
    assert.strictEqual(invalid.response.status, 400);
    assert.match(String(invalid.body?.error || ''), /runtime/);
    const noExtensionWorld = defaults.worlds[1];
    noExtensionWorld.start = { ...(noExtensionWorld.start || {}), openingMode: 'static' };
    const noExtensionSave = await request(base, '/api/world-saves', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ worldId: noExtensionWorld.id, worldVersion: noExtensionWorld.version, name: '无扩展权限' }) });
    assert.strictEqual(noExtensionSave.response.status, 201, JSON.stringify(noExtensionSave.body));
    const denied = await request(base, `/api/world-saves/${noExtensionSave.body.id}/runtime`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId: 'ext-runtime-denied', expectedRevision: 0, updates: [{ type: 'runtime.variable.set', id: 'alarm', value: 1 }] }) });
    assert.strictEqual(denied.response.status, 403);
    console.log('check_rpg_extension: ok');
  } finally {
    await closeServer();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
