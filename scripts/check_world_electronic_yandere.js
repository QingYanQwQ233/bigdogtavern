'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-yandere-'));
const defaults = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', '_defaults.json'), 'utf8'));
fs.writeFileSync(path.join(tempDir, '_defaults.json'), JSON.stringify(defaults));
fs.writeFileSync(path.join(tempDir, 'worlds.json'), JSON.stringify(defaults.worlds));
process.env.TAVERN_DATA_DIR = tempDir;

const { server, startServer } = require(path.join(root, 'server.js'));

function closeServer() {
  return new Promise(resolve => server.listening ? server.close(resolve) : resolve());
}

async function request(base, pathname, options) {
  const response = await fetch(base + pathname, options);
  return { response, body: await response.json().catch(() => null) };
}

async function main() {
  try {
    await startServer(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const worldResult = await request(base, '/api/worlds/world-electronic-yandere?version=1');
    assert.strictEqual(worldResult.response.status, 200);
    const world = worldResult.body;
    assert.strictEqual(world.ui.entryGate.message.includes('惊悚恐怖'), true);
    assert.strictEqual(world.ui.entryGate.fullscreen, true);
    assert.strictEqual(world.ui.layout, 'immersive');
    assert.deepStrictEqual(world.start.options, ['爱', '不爱']);
    assert.strictEqual(world.ui.extension.permissions.includes('write.runtime'), true);
    assert.strictEqual(world.ui.extension.actionNarrates, true);
    assert.match(world.ui.extension.js, /TavernExtension\.choose/);
    assert.match(world.ui.extension.js, /context\.turn\.options/);
    assert.strictEqual(world.runtime.actions.length, 3);

    const player = {
      fields: { name: '测试接入者', gender: '自定义', age: 24, role: '访客', background: '测试入口门禁和扩展。', customNotes: '' },
      attributes: { nerve: 4, intuition: 5, empathy: 4 },
      skills: { debugging: 2, observation: 2 },
      resources: { hp: 20, focus: 10, credits: 3 },
      traits: [], choices: [], relations: { 'npc-yui': 0 }, initialInventory: { 'terminal-key': 1 },
    };
    const created = await request(base, '/api/world-saves', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: world.id, worldVersion: world.version, name: '电子病娇测试', player }),
    });
    assert.strictEqual(created.response.status, 201, JSON.stringify(created.body));
    assert.strictEqual(created.body.setup.status, 'active');
    assert.deepStrictEqual(created.body.openingOptions, ['爱', '不爱']);
    assert.strictEqual(created.body.state.runtime.variables.choice_lock, 'open');

    const update = await request(base, `/api/world-saves/${created.body.id}/runtime`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'yui-answer-1', expectedRevision: 0, updates: [{ type: 'runtime.action.execute', actionId: 'answer-not-love', input: {} }] }),
    });
    assert.strictEqual(update.response.status, 200, JSON.stringify(update.body));
    assert.strictEqual(update.body.state.runtime.variables.love_answer, '不爱');
    assert.strictEqual(update.body.state.runtime.variables.choice_lock, 'love-only');
    assert.strictEqual(update.body.state.runtime.variables.affection_signal, 100);
    console.log('check_world_electronic_yandere: ok');
  } finally {
    await closeServer();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
