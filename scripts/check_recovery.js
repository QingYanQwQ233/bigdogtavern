'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-recovery-'));
const defaults = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', '_defaults.json'), 'utf8'));
fs.writeFileSync(path.join(tempDir, '_defaults.json'), JSON.stringify(defaults, null, 2));
fs.writeFileSync(path.join(tempDir, 'worlds.json'), JSON.stringify(defaults.worlds, null, 2));
process.env.TAVERN_DATA_DIR = tempDir;
process.env.TAVERN_PROXY_TIMEOUT_MS = '40';

const { server, startServer } = require(path.join(root, 'server.js'));

function closeServer(instance) {
  return new Promise(resolve => {
    if (!instance.listening) return resolve();
    instance.close(() => resolve());
  });
}

async function request(base, pathname, options = {}) {
  const response = await fetch(base + pathname, options);
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { response, body };
}

async function main() {
  const upstream = http.createServer((req) => { req.resume(); });
  try {
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    await startServer(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const upstreamBase = `http://127.0.0.1:${upstream.address().port}`;
    const world = defaults.worlds[0];

    const badChatJson = await request(base, '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.strictEqual(badChatJson.response.status, 400, 'bad chat JSON is rejected');
    const oversizedChat = await request(base, '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl: upstreamBase, body: { messages: [{ role: 'user', content: 'x'.repeat(4 * 1024 * 1024) }] } }) });
    assert.strictEqual(oversizedChat.response.status, 413, 'oversized chat body is rejected');
    const timedOut = await request(base, '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl: upstreamBase, body: { model: 'hang', messages: [] } }) });
    assert.strictEqual(timedOut.response.status, 504, 'hanging model request returns gateway timeout');
    assert.match(String(timedOut.body?.error?.message || ''), /超时/);

    const created = await request(base, '/api/world-saves', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ worldId: world.id, worldVersion: world.version, name: '恢复测试' }) });
    assert.strictEqual(created.response.status, 201);
    const stale = await request(base, '/api/world-saves/' + encodeURIComponent(created.body.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: 9, state: created.body.state, turns: [], opening: created.body.opening }) });
    assert.strictEqual(stale.response.status, 409, 'stale save revision remains recoverable');
    assert.strictEqual(stale.body.revision, 0);
    const malformedMigration = await request(base, '/api/rpg-migrations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: '{' }) });
    assert.strictEqual(malformedMigration.response.status, 422, 'malformed migration source is preview-only failure');
    const missingSave = await request(base, '/api/world-saves/missing-save');
    assert.strictEqual(missingSave.response.status, 404, 'missing save is explicit');

    fs.writeFileSync(path.join(tempDir, 'saves', 'corrupt-save.json'), '{not-json');
    const corruptList = await request(base, '/api/world-saves?worldId=' + encodeURIComponent(world.id));
    assert.strictEqual(corruptList.response.status, 500, 'corrupt save list fails closed');
    fs.unlinkSync(path.join(tempDir, 'saves', 'corrupt-save.json'));
    const recoveredList = await request(base, '/api/world-saves?worldId=' + encodeURIComponent(world.id));
    assert.strictEqual(recoveredList.response.status, 200, 'save list recovers after corrupt file removal');

    console.log('recovery check passed');
  } finally {
    await closeServer(server);
    await closeServer(upstream);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
