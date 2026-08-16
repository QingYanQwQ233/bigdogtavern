'use strict';

/* 会话跨浏览器同步验证：
 * 1. 服务端启动时不预建 sessions.json（GET 404 = 从未同步，客户端据此迁移）
 * 2. PUT 包结构校验（拒绝裸数组）
 * 3. 模拟浏览器 A 迁移 → 浏览器 B 读取合并 → A 删除（墓碑）→ B 再次读取不复活
 * 用法：node scripts/check_session_sync.js （自带临时数据目录，不触碰 public/data 运行时文件）
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-session-sync-'));
fs.copyFileSync(path.join(root, 'public', 'data', '_defaults.json'), path.join(tempDir, '_defaults.json'));
process.env.TAVERN_DATA_DIR = tempDir;
const PORT = 3217;
process.env.PORT = String(PORT);
const BASE = `http://127.0.0.1:${PORT}`;

const { server, startServer } = require(path.join(root, 'server.js'));

function closeServer() {
  return new Promise(resolve => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
  });
}

/* 用原生 http（无 keep-alive）发请求，避免 undici 连接池与 process.exit 在 Windows 上竞态 */
async function api(method, url, body) {
  const http = require('http');
  const payload = body ? JSON.stringify(body) : null;
  const resp = await new Promise((resolve, reject) => {
    const req = http.request(BASE + url, {
      method,
      headers: payload ? { 'Content-Type': 'application/json; charset=utf-8' } : {},
    }, resolve);
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
  let raw = '';
  resp.setEncoding('utf8');
  for await (const chunk of resp) raw += chunk;
  let json = null;
  try { json = JSON.parse(raw); } catch {}
  return { status: resp.statusCode, json };
}

(async () => {
  await startServer();
  const sessionsFile = path.join(tempDir, 'sessions.json');

  // 1) 启动后未预建 sessions.json，GET 返回 404（客户端据此做首次迁移）
  assert.ok(!fs.existsSync(sessionsFile), 'sessions.json 不应在启动时预建');
  let r = await api('GET', '/api/data/sessions');
  assert.strictEqual(r.status, 404, '未同步时 GET 应返回 404，实际 ' + r.status);

  // 2) PUT 结构校验：裸数组被拒绝
  r = await api('PUT', '/api/data/sessions', [{ id: 'x' }]);
  assert.strictEqual(r.status, 400, '裸数组应被 400 拒绝，实际 ' + r.status);

  // 3) 浏览器 A：两条本地会话迁移上服务端
  r = await api('PUT', '/api/data/sessions', {
    schemaVersion: 1,
    sessions: [
      { id: 's1', name: 'A 的会话 1', messages: [], createdAt: 1000, updatedAt: 5000 },
      { id: 's2', name: 'A 的会话 2', messages: [], createdAt: 2000, updatedAt: 2000 },
    ],
    deletedIds: [],
  });
  assert.strictEqual(r.status, 200, '合法会话包应 200，实际 ' + r.status);

  // 4) 浏览器 B：读到 A 的会话，并合并进自己独有的会话后回写
  r = await api('GET', '/api/data/sessions');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json.sessions.map(s => s.id).sort(), ['s1', 's2']);
  r = await api('PUT', '/api/data/sessions', {
    schemaVersion: 1,
    sessions: [...r.json.sessions, { id: 's3', name: 'B 的会话', messages: [], createdAt: 3000, updatedAt: 6000 }],
    deletedIds: [],
  });
  assert.strictEqual(r.status, 200);

  // 5) 浏览器 A：删除 s2（写墓碑）
  r = await api('GET', '/api/data/sessions');
  r = await api('PUT', '/api/data/sessions', {
    schemaVersion: 1,
    sessions: r.json.sessions.filter(s => s.id !== 's2'),
    deletedIds: ['s2'],
  });
  assert.strictEqual(r.status, 200);

  // 6) 浏览器 B：再次读取，s2 已消失且墓碑在案
  r = await api('GET', '/api/data/sessions');
  const final = r.json;
  assert.deepStrictEqual(final.sessions.map(s => s.id).sort(), ['s1', 's3'], '已删会话不应出现');
  assert.ok(final.deletedIds.includes('s2'), '删除墓碑应保留');

  // 7) 落盘内容与 API 一致（换浏览器加载即从此文件恢复）
  const onDisk = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
  assert.deepStrictEqual(onDisk, final);

  console.log('✓ 会话服务端同步通过（404 迁移信号 / 包校验 / 并集 / 墓碑防复活）');

  // ── 第二段：客户端合并逻辑（VM 内加载 app.js，直接驱动 syncSessionsFromServer）──
  const vm = require('vm');
  const source = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8').replace(/\ninit\(\);\s*$/, '');
  function runClient(name, { local = [], deleted = [], remote = null }) {
    const store = new Map();
    const puts = [];
    store.set('rpg-airp:sessions', JSON.stringify(local));
    store.set('rpg-airp:sessions-deleted', JSON.stringify(deleted));
    const ctx = vm.createContext({
      console, Date, Math, JSON, Set, Map,
      localStorage: {
        getItem: k => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: k => store.delete(k),
      },
      fetch: async (url, opts) => {
        if (opts && opts.method === 'PUT') puts.push({ url, body: JSON.parse(opts.body) });
        return { ok: true, json: async () => remote || {} };
      },
      window: {}, document: {},
    });
    vm.runInContext(source, ctx);
    vm.runInContext('syncSessionsFromServer(__REMOTE__)'.replace('__REMOTE__', JSON.stringify(remote)), ctx);
    // VM 内创建的数组与宿主原型不同，deepStrictEqual 会因原型不一致失败 → JSON 归一化
    const ids = JSON.parse(vm.runInContext('JSON.stringify(sessions.map(s => s.id))', ctx));
    const names = JSON.parse(vm.runInContext('JSON.stringify(Object.fromEntries(sessions.map(s => [s.id, s.name || ""])))', ctx));
    const tombstones = JSON.parse(vm.runInContext('JSON.stringify(sessionsDeleted)', ctx));
    return { ids, names, tombstones, puts, store };
  }

  // a) server 未同步（404/null）→ 本地会话整体推送（首次迁移）
  let c = runClient('migrate', { local: [{ id: 'a1', name: 'A', createdAt: 1, updatedAt: 5 }], remote: null });
  assert.strictEqual(c.puts.length, 1, '未同步时应推送一次迁移');
  assert.deepStrictEqual(c.puts[0].body.sessions.map(s => s.id), ['a1']);
  assert.deepStrictEqual(c.ids, ['a1'], '本地会话保持不变');

  // b) 双端并集：local [a1] + remote [b1] → 两台浏览器的会话都保留
  c = runClient('union', {
    local: [{ id: 'a1', name: 'A', createdAt: 1, updatedAt: 5 }],
    remote: { schemaVersion: 1, sessions: [{ id: 'b1', name: 'B', createdAt: 2, updatedAt: 9 }], deletedIds: [] },
  });
  assert.deepStrictEqual([...c.ids].sort(), ['a1', 'b1'], '并集应包含两端会话');
  assert.deepStrictEqual(c.ids[0], 'b1', '合并后按更新时间倒序');
  assert.ok(c.puts.some(p => p.body.sessions.some(s => s.id === 'a1')), '合并结果应回写服务端');

  // c) 同 ID 冲突：保留 updatedAt 新者
  c = runClient('conflict-local-newer', {
    local: [{ id: 's', name: '本地新名', createdAt: 1, updatedAt: 90 }],
    remote: { schemaVersion: 1, sessions: [{ id: 's', name: '远端旧名', createdAt: 1, updatedAt: 10 }], deletedIds: [] },
  });
  assert.strictEqual(c.names.s, '本地新名');
  c = runClient('conflict-remote-newer', {
    local: [{ id: 's', name: '本地旧名', createdAt: 1, updatedAt: 10 }],
    remote: { schemaVersion: 1, sessions: [{ id: 's', name: '远端新名', createdAt: 1, updatedAt: 90 }], deletedIds: [] },
  });
  assert.strictEqual(c.names.s, '远端新名');

  // d) 墓碑：任一端删除的会话不复活，且双方墓碑合并
  c = runClient('tombstone-local', {
    local: [{ id: 'a1', name: 'A', createdAt: 1, updatedAt: 5 }],
    deleted: ['gone-local'],
    remote: { schemaVersion: 1, sessions: [{ id: 'gone-local', name: '已删' }, { id: 'gone-remote', name: '远端删' }], deletedIds: ['gone-remote'] },
  });
  assert.deepStrictEqual(c.ids, ['a1'], '两端删除的会话都不应出现');
  assert.ok(c.tombstones.includes('gone-local') && c.tombstones.includes('gone-remote'), '墓碑取并集');

  // e) Android 首次 GET 返回 {_empty:true} → 视为未同步，走迁移
  c = runClient('android-empty', { local: [{ id: 'a1', name: 'A', createdAt: 1 }], remote: { _empty: true } });
  assert.strictEqual(c.puts.length, 1, '_empty 应触发迁移推送');

  // f) 与服务端完全一致 → 不回写
  const same = [{ id: 'a1', name: 'A', createdAt: 1, updatedAt: 5 }];
  c = runClient('no-change', { local: same, remote: { schemaVersion: 1, sessions: same, deletedIds: [] } });
  assert.strictEqual(c.puts.length, 0, '无变化时不应回写');

  // g) 连续保存必须按调用顺序写入，旧请求不能覆盖新请求
  const writes = [];
  let releaseFirst;
  let resolveFirstStarted;
  const firstStarted = new Promise(resolve => { resolveFirstStarted = resolve; });
  const firstRelease = new Promise(resolve => { releaseFirst = resolve; });
  const queueCtx = vm.createContext({
    console, Date, Math, JSON, Set, Map,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    fetch: async (url, opts) => {
      const body = JSON.parse(opts.body);
      writes.push(body);
      if (writes.length === 1) { resolveFirstStarted(); await firstRelease; }
      return { ok: true };
    },
    window: {}, document: {},
  });
  vm.runInContext(source, queueCtx);
  const firstWrite = vm.runInContext("saveServerData('sessions', { version: 1 })", queueCtx);
  await firstStarted;
  const secondWrite = vm.runInContext("saveServerData('sessions', { version: 2 })", queueCtx);
  releaseFirst();
  await Promise.all([firstWrite, secondWrite]);
  assert.deepStrictEqual(writes.map(item => item.version), [1, 2], '会话服务端写入必须保持调用顺序');

  console.log('✓ 客户端合并逻辑通过（迁移 / 并集 / 冲突取新 / 墓碑防复活 / _empty / 免回写）');
  await closeServer();
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.exit(0);
})().catch(async err => {
  console.error('✗', err.message);
  await closeServer();
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
