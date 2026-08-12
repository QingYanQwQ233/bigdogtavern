/**
 * Tavern · AI RP 框架演示 —— 本地服务器
 *
 * 零依赖（Node 18+，自带 fetch），同时提供：
 *   1. 静态文件服务（public/）
 *   2. POST /api/chat 代理：把 OpenAI 兼容的 Chat Completions 请求转发到
 *      用户自定义的任意 API，并注入 Authorization 头，绕开浏览器 CORS 限制。
 *
 * 安全提醒：仅供本地开发 / 演示使用。代理不做鉴权与 SSRF 防护，
 * 请勿直接部署到公网。
 *
 * 运行：node server.js  →  http://localhost:3000
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.TAVERN_DATA_DIR
  ? path.resolve(process.env.TAVERN_DATA_DIR)
  : path.join(PUBLIC_DIR, 'data');
const SAVES_DIR = path.join(DATA_DIR, 'saves');
const WORLD_DRAFTS_PATH = path.join(DATA_DIR, 'world-drafts.json');
// --api-only：只暴露 /api/*（无网页），供公网纯 API 场景
const API_ONLY = process.argv.includes('--api-only');

const DATA_TYPES = ['characters', 'presets', 'lorebooks', 'settings', 'user', 'worlds'];
const DEFAULTS_PATH = path.join(DATA_DIR, '_defaults.json');

/* 默认模板：从 public/data/_defaults.json 读取（唯一数据源，代码不写死内容） */
function loadDefaults() {
  try {
    const raw = fs.readFileSync(DEFAULTS_PATH, 'utf-8');
    const d = JSON.parse(raw);
    return {
      characters: Array.isArray(d.characters) ? d.characters : [],
      presets: (d.presets && typeof d.presets === 'object') ? d.presets : {},
      user: (d.user && typeof d.user === 'object') ? d.user : { presets: {}, memories: [] },
      lorebooks: (d.lorebooks && typeof d.lorebooks === 'object') ? d.lorebooks : { default: { name: '默认世界书', entries: [] } },
      settings: (d.settings && typeof d.settings === 'object') ? d.settings : {},
      prefs: (d.prefs && typeof d.prefs === 'object') ? d.prefs : {},
      format: (d.format && typeof d.format === 'object') ? d.format : {},
      providers: Array.isArray(d.providers) ? d.providers : [],
      ui: (d.ui && typeof d.ui === 'object') ? d.ui : {},
      gen: (d.gen && typeof d.gen === 'object') ? d.gen : {},
      rpg: (d.rpg && typeof d.rpg === 'object') ? d.rpg : {},
      worlds: Array.isArray(d.worlds) ? d.worlds : [],
    };
  } catch (e) {
    console.warn('[data] 读取 _defaults.json 失败（用空结构兜底）:', e.message);
    return { characters: [], presets: {}, lorebooks: { default: { name: '默认世界书', entries: [] } }, settings: {}, prefs: {}, format: {}, providers: [], ui: {}, worlds: [] };
  }
}

/* 确保数据目录与初始 JSON 文件存在 */
async function ensureDataFiles() {
  const defaults = loadDefaults();
  try { await fs.promises.mkdir(DATA_DIR, { recursive: true }); } catch {}
  try { await fs.promises.mkdir(SAVES_DIR, { recursive: true }); } catch {}
  try { await fs.promises.access(WORLD_DRAFTS_PATH); }
  catch { await fs.promises.writeFile(WORLD_DRAFTS_PATH, '[]\n', 'utf-8'); }
  for (const type of DATA_TYPES) {
    const fp = path.join(DATA_DIR, type + '.json');
    try { await fs.promises.access(fp); }
    catch {
      // 文件不存在 → 从 _defaults.json 对应段初始化
      const initial = defaults[type] ?? {};
      await fs.promises.writeFile(fp, JSON.stringify(initial, null, 2), 'utf-8');
      console.log(`  [data] 初始化 ${type}.json`);
    }
  }
}

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const COMMAND_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,95}$/;
const worldSaveLocks = new Map();
let worldWriteChain = Promise.resolve();

function isSafeId(value) {
  return typeof value === 'string' && SAFE_ID_RE.test(value);
}

function savePath(saveId) {
  if (!isSafeId(saveId)) return null;
  return path.join(SAVES_DIR, saveId + '.json');
}

function withWorldSaveLock(saveId, task) {
  const previous = worldSaveLocks.get(saveId) || Promise.resolve();
  const run = previous.catch(() => {}).then(task);
  worldSaveLocks.set(saveId, run);
  run.finally(() => {
    if (worldSaveLocks.get(saveId) === run) worldSaveLocks.delete(saveId);
  }).catch(() => {});
  return run;
}

// ponytail: single local-user lock; split by world only if concurrent editors become a real use case.
function withWorldsLock(task) {
  const run = worldWriteChain.catch(() => {}).then(task);
  worldWriteChain = run;
  run.finally(() => {
    if (worldWriteChain === run) worldWriteChain = Promise.resolve();
  }).catch(() => {});
  return run;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

async function readJsonBody(req, maxBytes = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('请求体过大'), { code: 'PAYLOAD_TOO_LARGE' });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');
  try { return JSON.parse(raw); }
  catch { throw Object.assign(new Error('无效的 JSON'), { code: 'BAD_JSON' }); }
}

async function writeJsonAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, '.' + path.basename(filePath) + '.' + process.pid + '.' + Date.now().toString(36) + '.tmp');
  try {
    await fs.promises.writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf-8');
    await fs.promises.rename(tmp, filePath);
  } catch (err) {
    try { await fs.promises.unlink(tmp); } catch {}
    throw err;
  }
}

async function loadWorlds() {
  const raw = await fs.promises.readFile(path.join(DATA_DIR, 'worlds.json'), 'utf-8');
  const worlds = JSON.parse(raw);
  if (!Array.isArray(worlds)) throw new Error('worlds.json 必须是数组');
  return worlds;
}

function worldVersions(worlds, worldId) {
  return worlds
    .filter(world => world && world.id === worldId)
    .sort((a, b) => Number(a.version) - Number(b.version));
}

function latestWorld(worlds, worldId) {
  return worldVersions(worlds, worldId).at(-1) || null;
}

function findWorldVersion(worlds, worldId, version) {
  return worlds.find(world => world && world.id === worldId && Number(world.version) === Number(version)) || null;
}

async function loadWorldDrafts() {
  const raw = await fs.promises.readFile(WORLD_DRAFTS_PATH, 'utf-8');
  const drafts = JSON.parse(raw);
  if (!Array.isArray(drafts)) throw new Error('world-drafts.json 必须是数组');
  return drafts;
}

function worldDraftFieldsValid(payload, requireRevision = false) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '请求必须是 JSON 对象';
  if (requireRevision && (!Number.isInteger(payload.expectedUpdatedAt) || payload.expectedUpdatedAt < 0)) return 'expectedUpdatedAt 必须是非负整数';
  if (!Number.isInteger(payload.baseVersion) || payload.baseVersion < 1) return 'baseVersion 必须是正整数';
  if (typeof payload.title !== 'string' || !payload.title.trim() || payload.title.trim().length > 200) return 'title 必须是 1-200 字符的字符串';
  if (typeof payload.summary !== 'string' || payload.summary.length > 4000) return 'summary 不能超过 4000 个字符';
  if (!Array.isArray(payload.tags) || payload.tags.length > 64 || payload.tags.some(value => typeof value !== 'string' || !value.trim() || value.length > 120)) return 'tags 必须是最多 64 项的非空字符串数组';
  if (!Array.isArray(payload.lorebookIds) || payload.lorebookIds.length > 64 || payload.lorebookIds.some(value => typeof value !== 'string' || !isSafeId(value.trim()))) return 'lorebookIds 包含无效 ID';
  const mapInvalid = validateWorldDraftMapGeneration(payload.mapGeneration);
  if (mapInvalid) return mapInvalid;
  return null;
}

function validateWorldDraftMapGeneration(value) {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'mapGeneration 必须是对象';
  if (!Number.isInteger(value.seed) || value.seed < 0 || value.seed > 2147483647) return 'mapGeneration.seed 无效';
  if (![64, 96, 128, 160, 192].includes(value.size)) return 'mapGeneration.size 无效';
  if (!Number.isInteger(value.regionCount) || value.regionCount < 4 || value.regionCount > 24) return 'mapGeneration.regionCount 无效';
  if (!Number.isFinite(value.landRatio) || value.landRatio < 0.25 || value.landRatio > 0.8) return 'mapGeneration.landRatio 无效';
  if (!['tiny', 'small'].includes(value.mapgenSize)) return 'mapGeneration.mapgenSize 无效';
  return null;
}

function normalizeWorldDraftMapGeneration(value) {
  return {
    seed: value.seed,
    size: value.size,
    regionCount: value.regionCount,
    landRatio: Math.round(value.landRatio * 100) / 100,
    mapgenSize: value.mapgenSize,
  };
}

function draftTextValid(value, maxLength, required = false) {
  return typeof value === 'string' && value.trim().length <= maxLength && (!required || value.trim().length > 0);
}

function draftStringListValid(value, maxItems, maxLength) {
  return Array.isArray(value) && value.length <= maxItems
    && value.every(item => typeof item === 'string' && item.trim() && item.trim().length <= maxLength);
}

function validateWorldDraftCollections(payload, sourceWorld) {
  const hasLocations = payload.locations !== undefined;
  const hasNpcs = payload.npcs !== undefined;
  if (!hasLocations && !hasNpcs) return null;
  const locations = hasLocations ? payload.locations : (Array.isArray(sourceWorld?.locations) ? sourceWorld.locations : []);
  const npcs = hasNpcs ? payload.npcs : (Array.isArray(sourceWorld?.npcs) ? sourceWorld.npcs : []);
  if (!Array.isArray(locations) || locations.length > 256) return 'locations must contain at most 256 items';
  const locationIds = new Set();
  for (const location of locations) {
    if (!location || typeof location !== 'object' || Array.isArray(location)) return 'locations contains an invalid item';
    const id = typeof location.id === 'string' ? location.id.trim() : '';
    if (!isSafeId(id) || locationIds.has(id)) return 'locations contains a duplicate or invalid ID';
    if (!draftTextValid(location.name, 200, true) || !draftTextValid(location.type ?? '', 80) || !draftTextValid(location.summary ?? '', 2000)) return 'location text is invalid';
    if (location.tags !== undefined && !draftStringListValid(location.tags, 32, 120)) return 'location tags are invalid';
    locationIds.add(id);
  }
  const startLocationId = sourceWorld?.start?.locationId;
  if (hasLocations && startLocationId !== undefined && startLocationId !== null && !locationIds.has(startLocationId)) return 'locations must retain start.locationId';
  if (!Array.isArray(npcs) || npcs.length > 256) return 'npcs must contain at most 256 items';
  const npcIds = new Set();
  for (const npc of npcs) {
    if (!npc || typeof npc !== 'object' || Array.isArray(npc)) return 'npcs contains an invalid item';
    const id = typeof npc.id === 'string' ? npc.id.trim() : '';
    if (!isSafeId(id) || npcIds.has(id)) return 'npcs contains a duplicate or invalid ID';
    if (!draftTextValid(npc.name, 200, true)) return 'NPC name is invalid';
    for (const key of ['role', 'description', 'persona', 'personality', 'appearance', 'speechStyle']) {
      if (npc[key] !== undefined && !draftTextValid(npc[key], key === 'description' ? 4000 : 2000)) return `NPC ${key} is too long`;
    }
    for (const key of ['publicFacts', 'publicGoals']) {
      if (npc[key] !== undefined && !draftStringListValid(npc[key], 64, 1000)) return `NPC ${key} is invalid`;
    }
    if (npc.secrets !== undefined) {
      if (!Array.isArray(npc.secrets) || npc.secrets.length > 64) return 'NPC secrets are invalid';
      const secretIds = new Set();
      for (const secret of npc.secrets) {
        const secretId = typeof secret?.id === 'string' ? secret.id.trim() : '';
        if (!isSafeId(secretId) || secretIds.has(secretId) || !draftTextValid(secret?.content ?? '', 2000, true)) return 'NPC secrets contain an invalid item';
        secretIds.add(secretId);
      }
    }
    if (npc.locationId !== undefined && npc.locationId !== null && (!isSafeId(npc.locationId) || !locationIds.has(npc.locationId))) return 'NPC locationId must point to a registered location';
    npcIds.add(id);
  }
  return null;
}

function normalizeDraftList(value, maxItems, maxLength) {
  return [...new Set((Array.isArray(value) ? value : []).map(item => item.trim()).filter(Boolean))].slice(0, maxItems).map(item => item.slice(0, maxLength));
}

function normalizeDraftLocation(location) {
  const next = { id: location.id.trim(), name: location.name.trim() };
  for (const key of ['type', 'summary']) if (typeof location[key] === 'string') next[key] = location[key].trim();
  if (Array.isArray(location.tags)) next.tags = normalizeDraftList(location.tags, 32, 120);
  return next;
}

function normalizeDraftNpc(npc) {
  const next = { id: npc.id.trim(), name: npc.name.trim() };
  for (const key of ['role', 'description', 'persona', 'personality', 'appearance', 'speechStyle']) if (typeof npc[key] === 'string') next[key] = npc[key].trim();
  if (npc.locationId !== undefined) next.locationId = npc.locationId === null ? null : npc.locationId.trim();
  for (const key of ['publicFacts', 'publicGoals']) if (Array.isArray(npc[key])) next[key] = normalizeDraftList(npc[key], 64, 1000);
  if (Array.isArray(npc.secrets)) next.secrets = npc.secrets.map(secret => ({ id: secret.id.trim(), content: secret.content.trim() }));
  return next;
}

function applyWorldDraftFields(world, payload) {
  const next = cloneJson(world);
  next.title = payload.title.trim();
  next.summary = payload.summary;
  next.tags = [...new Set(payload.tags.map(value => value.trim()))];
  next.lorebookIds = [...new Set(payload.lorebookIds.map(value => value.trim()))];
  if (payload.mapGeneration !== undefined) {
    const map = next.map && typeof next.map === 'object' && !Array.isArray(next.map) ? next.map : {};
    next.map = { ...map, generation: normalizeWorldDraftMapGeneration(payload.mapGeneration) };
  }
  if (payload.locations !== undefined) next.locations = payload.locations.map(normalizeDraftLocation);
  if (payload.npcs !== undefined) {
    next.npcs = payload.npcs.map(normalizeDraftNpc);
    next.npcIds = next.npcs.map(npc => npc.id);
  }
  return next;
}

function worldDraftView(draft) {
  return cloneJson(draft);
}

function prepareWorldDraftPublication(draft) {
  const world = cloneJson(draft?.world);
  if (!world || world.id !== draft.worldId || Number(world.version) !== Number(draft.baseVersion)) {
    return { error: '草稿世界标识或基础版本不一致' };
  }
  let mapGeneration = world.map?.generation;
  if (mapGeneration && typeof mapGeneration === 'object' && !Array.isArray(mapGeneration)) {
    mapGeneration = {
      ...mapGeneration,
      landRatio: mapGeneration.landRatio ?? 0.55,
      mapgenSize: mapGeneration.mapgenSize ?? 'small',
    };
    world.map = { ...world.map, generation: normalizeWorldDraftMapGeneration(mapGeneration) };
  }
  const payload = {
    baseVersion: Number(draft.baseVersion),
    title: world.title,
    summary: world.summary,
    tags: world.tags,
    lorebookIds: world.lorebookIds,
    ...(mapGeneration ? { mapGeneration } : {}),
    locations: Array.isArray(world.locations) ? world.locations : [],
    npcs: Array.isArray(world.npcs) ? world.npcs : [],
  };
  const invalid = worldDraftFieldsValid(payload) || validateWorldDraftCollections(payload, world);
  return invalid ? { error: invalid } : { world };
}

function worldNpcIds(world) {
  const ids = [];
  if (Array.isArray(world?.npcIds)) ids.push(...world.npcIds);
  if (Array.isArray(world?.npcs)) ids.push(...world.npcs.map(npc => npc && npc.id));
  return [...new Set(ids.filter(id => typeof id === 'string' && id.trim()).map(id => id.trim()))];
}

function worldLocationIds(world) {
  return new Set((Array.isArray(world?.locations) ? world.locations : [])
    .map(location => location && location.id)
    .filter(id => typeof id === 'string' && id.trim())
    .map(id => id.trim()));
}

function validateWorldLocationIds(world, state, npcStates, createEntities) {
  const allowedIds = worldLocationIds(world);
  const refs = [['state.locationId', state && state.locationId]];
  if (npcStates && typeof npcStates === 'object') {
    for (const [npcId, npc] of Object.entries(npcStates)) refs.push([`npcStates.${npcId}.locationId`, npc && npc.locationId]);
  }
  if (Array.isArray(createEntities)) {
    createEntities.forEach((entity, index) => refs.push([`createEntities[${index}].locationId`, entity && entity.locationId]));
  }
  for (const [label, locationId] of refs) {
    if (locationId !== undefined && locationId !== null && (!allowedIds.has(locationId) || !SAFE_ID_RE.test(locationId))) {
      return `${label} 必须是当前世界已登记的稳定 locationId`;
    }
  }
  return null;
}

function initialNpcStates(world, start) {
  const locationId = start && typeof start.locationId === 'string' ? start.locationId : null;
  return Object.fromEntries(worldNpcIds(world).map(npcId => [npcId, {
    locationId,
    relation: {},
    knowledge: [],
    status: [],
  }]));
}

function worldSummary(world, saveCount = 0) {
  return {
    id: world.id,
    version: world.version,
    title: world.title || world.id,
    summary: world.summary || '',
    coverImage: world.coverImage || '',
    tags: Array.isArray(world.tags) ? world.tags : [],
    locationCount: Array.isArray(world.locations) ? world.locations.length : 0,
    npcCount: worldNpcIds(world).length,
    saveCount,
  };
}

function saveSummary(save) {
  return {
    id: save.id,
    name: save.name,
    worldId: save.worldId,
    worldVersion: save.worldVersion,
    createdAt: save.createdAt,
    updatedAt: save.updatedAt,
    revision: save.revision,
    locationId: save.state && save.state.locationId || null,
  };
}

async function listWorldSaveFiles(worldId) {
  const names = await fs.promises.readdir(SAVES_DIR);
  const result = [];
  for (const name of names) {
    if (!name.endsWith('.json') || name.startsWith('.')) continue;
    const id = name.slice(0, -5);
    if (!isSafeId(id)) continue;
    const raw = await fs.promises.readFile(path.join(SAVES_DIR, name), 'utf-8');
    const save = JSON.parse(raw);
    if (!save || save.id !== id) throw new Error('存档文件 ID 不一致：' + name);
    if (!worldId || save.worldId === worldId) result.push(saveSummary(save));
  }
  result.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return result;
}

function newSaveId() {
  return 'save-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

async function handleWorldsGet(req, res) {
  try {
    const worlds = await loadWorlds();
    const saves = await listWorldSaveFiles();
    const counts = new Map();
    for (const save of saves) counts.set(save.worldId, (counts.get(save.worldId) || 0) + 1);
    const latest = new Map();
    for (const world of worlds) {
      if (!world || typeof world.id !== 'string') continue;
      const previous = latest.get(world.id);
      if (!previous || Number(world.version) > Number(previous.version)) latest.set(world.id, world);
    }
    send(res, 200, JSON.stringify([...latest.values()].map(w => worldSummary(w, counts.get(w.id) || 0))), 'application/json; charset=utf-8');
  } catch (err) {
    console.error('[worlds] 读取失败:', err.message);
    send(res, 500, JSON.stringify({ error: '世界卡读取失败: ' + err.message }), 'application/json');
  }
}

async function handleWorldDraftsGet(req, res, worldId = '', single = false) {
  if (worldId && !isSafeId(worldId)) return send(res, 400, JSON.stringify({ error: '无效的 worldId' }), 'application/json');
  try {
    const drafts = await loadWorldDrafts();
    if (worldId && single) {
      const draft = drafts.find(item => item && item.worldId === worldId);
      if (!draft) return send(res, 404, JSON.stringify({ error: '世界草稿不存在' }), 'application/json');
      return send(res, 200, JSON.stringify(worldDraftView(draft)), 'application/json; charset=utf-8');
    }
    const result = worldId ? drafts.filter(draft => draft && draft.worldId === worldId) : drafts;
    send(res, 200, JSON.stringify(result.map(worldDraftView)), 'application/json; charset=utf-8');
  } catch (err) {
    console.error('[world-drafts] 读取失败:', err.message);
    send(res, 500, JSON.stringify({ error: '世界草稿读取失败: ' + err.message }), 'application/json');
  }
}

async function handleWorldDraftCreate(req, res) {
  let payload;
  try { payload = await readJsonBody(req, 64 * 1024); }
  catch (err) {
    const status = err.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
    return send(res, status, JSON.stringify({ error: err.message }), 'application/json');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return send(res, 400, JSON.stringify({ error: '请求必须是 JSON 对象' }), 'application/json');
  const worldId = String(payload.worldId || '');
  if (!isSafeId(worldId)) return send(res, 400, JSON.stringify({ error: '无效的 worldId' }), 'application/json');
  if (payload.baseVersion !== undefined && (!Number.isInteger(payload.baseVersion) || payload.baseVersion < 1)) return send(res, 400, JSON.stringify({ error: 'baseVersion 必须是正整数' }), 'application/json');
  return withWorldsLock(async () => {
    try {
      const worlds = await loadWorlds();
      const source = payload.baseVersion === undefined ? latestWorld(worlds, worldId) : findWorldVersion(worlds, worldId, payload.baseVersion);
      if (!source) return send(res, 404, JSON.stringify({ error: '世界卡版本不存在' }), 'application/json');
      const drafts = await loadWorldDrafts();
      const existing = drafts.find(draft => draft && draft.worldId === worldId);
      if (existing) return send(res, 200, JSON.stringify(worldDraftView(existing)), 'application/json; charset=utf-8');
      const now = Date.now();
      const draft = { schemaVersion: 1, worldId, baseVersion: Number(source.version), world: cloneJson(source), createdAt: now, updatedAt: now };
      drafts.push(draft);
      await writeJsonAtomic(WORLD_DRAFTS_PATH, drafts);
      send(res, 201, JSON.stringify(worldDraftView(draft)), 'application/json; charset=utf-8');
    } catch (err) {
      console.error('[world-drafts] 创建失败:', err.message);
      send(res, 500, JSON.stringify({ error: '世界草稿创建失败: ' + err.message }), 'application/json');
    }
  });
}

async function handleWorldDraftPut(req, res, worldId) {
  if (!isSafeId(worldId)) return send(res, 400, JSON.stringify({ error: '无效的 worldId' }), 'application/json');
  let payload;
  try { payload = await readJsonBody(req, 512 * 1024); }
  catch (err) {
    const status = err.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
    return send(res, status, JSON.stringify({ error: err.message }), 'application/json');
  }
  const invalid = worldDraftFieldsValid(payload, true);
  if (invalid) return send(res, 400, JSON.stringify({ error: invalid }), 'application/json');
  return withWorldsLock(async () => {
    try {
      const drafts = await loadWorldDrafts();
      const index = drafts.findIndex(draft => draft && draft.worldId === worldId);
      if (index < 0) return send(res, 404, JSON.stringify({ error: '世界草稿不存在' }), 'application/json');
      const current = drafts[index];
      if (current.updatedAt !== payload.expectedUpdatedAt || Number(current.baseVersion) !== payload.baseVersion) {
        return send(res, 409, JSON.stringify({ error: '世界草稿已被更新，请重新读取', updatedAt: current.updatedAt }), 'application/json');
      }
      const worlds = await loadWorlds();
      if (!findWorldVersion(worlds, worldId, current.baseVersion)) return send(res, 409, JSON.stringify({ error: '草稿所基于的世界版本已不存在' }), 'application/json');
      const collectionsInvalid = validateWorldDraftCollections(payload, current.world);
      if (collectionsInvalid) return send(res, 400, JSON.stringify({ error: collectionsInvalid }), 'application/json');
      const updatedAt = Math.max(Date.now(), current.updatedAt + 1);
      const next = { ...current, world: applyWorldDraftFields(current.world, payload), updatedAt };
      drafts[index] = next;
      await writeJsonAtomic(WORLD_DRAFTS_PATH, drafts);
      send(res, 200, JSON.stringify(worldDraftView(next)), 'application/json; charset=utf-8');
    } catch (err) {
      console.error('[world-drafts] 保存失败:', err.message);
      send(res, 500, JSON.stringify({ error: '世界草稿保存失败: ' + err.message }), 'application/json');
    }
  });
}

async function handleWorldDraftPublish(req, res, worldId) {
  if (!isSafeId(worldId)) return send(res, 400, JSON.stringify({ error: '无效的 worldId' }), 'application/json');
  let payload;
  try { payload = await readJsonBody(req, 64 * 1024); }
  catch (err) {
    const status = err.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
    return send(res, status, JSON.stringify({ error: err.message }), 'application/json');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return send(res, 400, JSON.stringify({ error: '请求必须是 JSON 对象' }), 'application/json');
  if (typeof payload.commandId !== 'string' || !COMMAND_ID_RE.test(payload.commandId)) return send(res, 400, JSON.stringify({ error: 'commandId 无效' }), 'application/json');
  if (!Number.isInteger(payload.expectedUpdatedAt) || payload.expectedUpdatedAt < 0) return send(res, 400, JSON.stringify({ error: 'expectedUpdatedAt 必须是非负整数' }), 'application/json');
  if (!Number.isInteger(payload.baseVersion) || payload.baseVersion < 1) return send(res, 400, JSON.stringify({ error: 'baseVersion 必须是正整数' }), 'application/json');
  return withWorldsLock(async () => {
    try {
      const worlds = await loadWorlds();
      const published = worlds.find(world => world?.id === worldId && world.publication?.commandId === payload.commandId);
      if (published) {
        if (Number(published.publication.baseVersion) !== payload.baseVersion || published.publication.draftUpdatedAt !== payload.expectedUpdatedAt) {
          return send(res, 409, JSON.stringify({ error: 'commandId 已用于其他草稿修订' }), 'application/json');
        }
        const drafts = await loadWorldDrafts();
        const staleIndex = drafts.findIndex(draft => draft?.worldId === worldId
          && Number(draft.baseVersion) === Number(published.publication.baseVersion)
          && draft.updatedAt === published.publication.draftUpdatedAt);
        if (staleIndex >= 0) {
          drafts.splice(staleIndex, 1);
          await writeJsonAtomic(WORLD_DRAFTS_PATH, drafts);
        }
        return send(res, 200, JSON.stringify({ world: published, idempotent: true, draftRemoved: true }), 'application/json; charset=utf-8');
      }
      const drafts = await loadWorldDrafts();
      const index = drafts.findIndex(draft => draft && draft.worldId === worldId);
      if (index < 0) return send(res, 404, JSON.stringify({ error: '世界草稿不存在' }), 'application/json');
      const current = drafts[index];
      if (current.updatedAt !== payload.expectedUpdatedAt || Number(current.baseVersion) !== payload.baseVersion) {
        return send(res, 409, JSON.stringify({ error: '世界草稿已被更新，请重新读取', updatedAt: current.updatedAt }), 'application/json');
      }
      const latest = latestWorld(worlds, worldId);
      if (!latest) return send(res, 404, JSON.stringify({ error: '世界卡不存在' }), 'application/json');
      if (Number(latest.version) !== Number(current.baseVersion)) {
        return send(res, 409, JSON.stringify({
          error: `草稿基于 v${current.baseVersion}，但当前最新版本是 v${latest.version}；请先处理版本冲突`,
          latestVersion: Number(latest.version),
        }), 'application/json');
      }
      const prepared = prepareWorldDraftPublication(current);
      if (prepared.error) return send(res, 400, JSON.stringify({ error: prepared.error }), 'application/json');
      const publishedAt = Date.now();
      const nextWorld = prepared.world;
      nextWorld.version = Number(current.baseVersion) + 1;
      nextWorld.publication = {
        source: 'draft',
        commandId: payload.commandId,
        baseVersion: Number(current.baseVersion),
        draftUpdatedAt: current.updatedAt,
        publishedAt,
      };
      worlds.push(nextWorld);
      await writeJsonAtomic(path.join(DATA_DIR, 'worlds.json'), worlds);
      drafts.splice(index, 1);
      await writeJsonAtomic(WORLD_DRAFTS_PATH, drafts);
      send(res, 201, JSON.stringify({ world: nextWorld, idempotent: false, draftRemoved: true }), 'application/json; charset=utf-8');
    } catch (err) {
      console.error('[world-drafts] 发布失败:', err.message);
      send(res, 500, JSON.stringify({ error: '世界草稿发布失败: ' + err.message }), 'application/json');
    }
  });
}

async function handleWorldCardGet(req, res, worldId, version) {
  if (!isSafeId(worldId)) return send(res, 400, JSON.stringify({ error: '无效的 worldId' }), 'application/json');
  try {
    const worlds = await loadWorlds();
    const world = version === undefined ? latestWorld(worlds, worldId) : findWorldVersion(worlds, worldId, version);
    if (!world) return send(res, 404, JSON.stringify({ error: '世界卡版本不存在' }), 'application/json');
    send(res, 200, JSON.stringify(world), 'application/json; charset=utf-8');
  } catch (err) {
    console.error('[worlds] 读取版本失败:', err.message);
    send(res, 500, JSON.stringify({ error: '世界卡读取失败: ' + err.message }), 'application/json');
  }
}

function stableWorldNpcId(worlds) {
  let id;
  do {
    id = 'npc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  } while (worlds.some(world => worldNpcIds(world).includes(id)));
  return id;
}

async function handleWorldNpcPromotion(req, res, worldId) {
  let payload;
  try { payload = await readJsonBody(req, 64 * 1024); }
  catch (err) {
    const status = err.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
    return send(res, status, JSON.stringify({ error: err.message }), 'application/json');
  }
  if (!isSafeId(worldId)) return send(res, 400, JSON.stringify({ error: '无效的 worldId' }), 'application/json');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return send(res, 400, JSON.stringify({ error: '请求必须是 JSON 对象' }), 'application/json');
  const sourceSaveId = String(payload.sourceSaveId || '');
  const generatedNpcId = String(payload.npcId || '');
  if (!isSafeId(sourceSaveId)) return send(res, 400, JSON.stringify({ error: '无效的 sourceSaveId' }), 'application/json');
  if (!/^save:[A-Za-z0-9][A-Za-z0-9_-]{0,63}:npc:\d+$/.test(generatedNpcId)) return send(res, 400, JSON.stringify({ error: '无效的存档 NPC ID' }), 'application/json');
  if (payload.expectedRevision !== undefined && (!Number.isInteger(payload.expectedRevision) || payload.expectedRevision < 0)) {
    return send(res, 400, JSON.stringify({ error: 'expectedRevision 必须是非负整数' }), 'application/json');
  }
  if (payload.title !== undefined && (typeof payload.title !== 'string' || !payload.title.trim() || payload.title.trim().length > 200)) {
    return send(res, 400, JSON.stringify({ error: 'title 必须是 1-200 字符的字符串' }), 'application/json');
  }
  if (!generatedNpcId.startsWith(`save:${sourceSaveId}:npc:`)) return send(res, 403, JSON.stringify({ error: 'NPC 不属于指定存档' }), 'application/json');
  const sourcePath = savePath(sourceSaveId);
  return withWorldSaveLock(sourceSaveId, () => withWorldsLock(async () => {
    try {
      const save = JSON.parse(await fs.promises.readFile(sourcePath, 'utf-8'));
      if (!save || save.id !== sourceSaveId) return send(res, 404, JSON.stringify({ error: '存档不存在' }), 'application/json');
      if (save.worldId !== worldId) return send(res, 409, JSON.stringify({ error: '存档不属于指定世界' }), 'application/json');
      if (payload.expectedRevision !== undefined && save.revision !== payload.expectedRevision) {
        return send(res, 409, JSON.stringify({ error: '存档版本冲突，请重新读取', revision: save.revision }), 'application/json');
      }
      const generatedNpc = save.generatedEntities?.npcs?.[generatedNpcId];
      if (!generatedNpc || generatedNpc.kind !== 'npc') return send(res, 404, JSON.stringify({ error: '存档 NPC 不存在' }), 'application/json');
      const worlds = await loadWorlds();
      const sourceWorld = findWorldVersion(worlds, worldId, save.worldVersion);
      if (!sourceWorld) return send(res, 409, JSON.stringify({ error: '存档绑定的世界版本不存在' }), 'application/json');
      for (const world of worlds) {
        const existing = (Array.isArray(world.npcs) ? world.npcs : []).find(npc => npc && npc.sourceGeneratedEntityId === generatedNpcId && npc.sourceSaveId === sourceSaveId);
        if (existing) return send(res, 200, JSON.stringify({ world, npcId: existing.id, idempotent: true }), 'application/json; charset=utf-8');
      }
      const nextVersion = worldVersions(worlds, worldId).reduce((max, world) => Math.max(max, Number(world.version) || 0), 0) + 1;
      const stableNpcId = stableWorldNpcId(worlds);
      const promotedNpc = {
        id: stableNpcId,
        name: generatedNpc.name,
        sourceSaveId,
        sourceGeneratedEntityId: generatedNpcId,
        promotedAt: Date.now(),
      };
      for (const key of ['description', 'locationId', 'status', 'role', 'persona', 'personality', 'appearance', 'speechStyle', 'publicGoals', 'publicFacts', 'type']) {
        if (generatedNpc[key] !== undefined) promotedNpc[key] = cloneJson(generatedNpc[key]);
      }
      const nextWorld = cloneJson(sourceWorld);
      nextWorld.version = nextVersion;
      if (payload.title !== undefined) nextWorld.title = payload.title.trim();
      nextWorld.npcIds = [...new Set([...(Array.isArray(sourceWorld.npcIds) ? sourceWorld.npcIds : []), stableNpcId])];
      nextWorld.npcs = [...(Array.isArray(sourceWorld.npcs) ? cloneJson(sourceWorld.npcs) : []), promotedNpc];
      worlds.push(nextWorld);
      await writeJsonAtomic(path.join(DATA_DIR, 'worlds.json'), worlds);
      send(res, 201, JSON.stringify({ world: nextWorld, npcId: stableNpcId, idempotent: false }), 'application/json; charset=utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') return send(res, 404, JSON.stringify({ error: '存档不存在' }), 'application/json');
      console.error('[worlds] 收录 NPC 失败:', err.message);
      send(res, 500, JSON.stringify({ error: '世界版本创建失败: ' + err.message }), 'application/json');
    }
  }));
}

async function handleWorldSavesList(req, res, worldId) {
  if (worldId && !isSafeId(worldId)) return send(res, 400, JSON.stringify({ error: '无效的 worldId' }), 'application/json');
  try {
    const saves = await listWorldSaveFiles(worldId || '');
    send(res, 200, JSON.stringify(saves), 'application/json; charset=utf-8');
  } catch (err) {
    console.error('[world-saves] 列表失败:', err.message);
    send(res, 500, JSON.stringify({ error: '存档列表读取失败: ' + err.message }), 'application/json');
  }
}

async function handleWorldSaveGet(req, res, saveId) {
  const fp = savePath(saveId);
  if (!fp) return send(res, 400, JSON.stringify({ error: '无效的 saveId' }), 'application/json');
  try {
    const raw = await fs.promises.readFile(fp, 'utf-8');
    const save = JSON.parse(raw);
    if (!save || save.id !== saveId) throw new Error('存档文件 ID 不一致');
    send(res, 200, raw, 'application/json; charset=utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return send(res, 404, JSON.stringify({ error: '存档不存在' }), 'application/json');
    console.error('[world-saves] 读取失败:', err.message);
    send(res, 500, JSON.stringify({ error: '存档读取失败: ' + err.message }), 'application/json');
  }
}

async function handleWorldSaveCreate(req, res) {
  let payload;
  try { payload = await readJsonBody(req, 64 * 1024); }
  catch (err) {
    const status = err.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
    return send(res, status, JSON.stringify({ error: err.message }), 'application/json');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return send(res, 400, JSON.stringify({ error: '请求必须是 JSON 对象' }), 'application/json');
  const worldId = String(payload.worldId || '');
  if (!isSafeId(worldId)) return send(res, 400, JSON.stringify({ error: '无效的 worldId' }), 'application/json');
  let worlds;
  try { worlds = await loadWorlds(); }
  catch (err) { return send(res, 500, JSON.stringify({ error: '世界卡读取失败: ' + err.message }), 'application/json'); }
  const world = payload.worldVersion === undefined
    ? latestWorld(worlds, worldId)
    : findWorldVersion(worlds, worldId, Number(payload.worldVersion));
  if (!world) return send(res, 404, JSON.stringify({ error: '世界卡不存在' }), 'application/json');
  const worldVersion = Number(payload.worldVersion ?? world.version);
  if (!Number.isInteger(worldVersion) || worldVersion !== Number(world.version)) return send(res, 409, JSON.stringify({ error: '世界卡版本已变化，请重新打开世界库' }), 'application/json');
  const start = world.start && typeof world.start === 'object' ? world.start : {};
  const invalidStartLocation = validateWorldLocationIds(world, { locationId: start.locationId }, null);
  if (invalidStartLocation) return send(res, 400, JSON.stringify({ error: invalidStartLocation }), 'application/json');
  if (typeof payload.name !== 'string') return send(res, 400, JSON.stringify({ error: '存档名称必须是字符串' }), 'application/json');
  const name = payload.name.trim();
  if (!name || name.length > 120) return send(res, 400, JSON.stringify({ error: '存档名称不能为空且不能超过 120 个字符' }), 'application/json');

  const id = newSaveId();
  const now = Date.now();
  const initial = start.initialState && typeof start.initialState === 'object' ? start.initialState : {};
  const stats = initial.stats && typeof initial.stats === 'object' ? cloneJson(initial.stats) : {};
  const player = start.playerTemplate && typeof start.playerTemplate === 'object' ? cloneJson(start.playerTemplate) : { name: '未命名冒险者', race: '待定', role: '旅人', profileFields: [] };
  const playerId = String(start.playerTemplateId || ('pc-' + id));
  const save = {
    schemaVersion: 1,
    id,
    name,
    worldId,
    worldVersion,
    createdAt: now,
    updatedAt: now,
    revision: 0,
    player: { characterId: playerId, snapshot: player },
    party: { memberIds: [playerId], leaderId: playerId },
    state: {
      locationId: start.locationId || null,
      stats,
      inventory: Array.isArray(initial.inventory) ? cloneJson(initial.inventory) : [],
      quests: Array.isArray(initial.quests) ? cloneJson(initial.quests) : [],
      map: {
        strategy: world.map && world.map.strategy || 'perSave',
        baseMapId: world.map && world.map.baseMapId || null,
        data: null,
        imagePath: null,
        discoveredLocationIds: start.locationId ? [start.locationId] : [],
        markers: [],
      },
    },
    npcStates: initialNpcStates(world, start),
    opening: String(start.opening || ''),
    turns: [],
    receipts: [],
    generatedEntities: {},
    migrationHistory: [],
  };
  try {
    await fs.promises.mkdir(SAVES_DIR, { recursive: true });
    await writeJsonAtomic(savePath(id), save);
    send(res, 201, JSON.stringify(save), 'application/json; charset=utf-8');
  } catch (err) {
    console.error('[world-saves] 创建失败:', err.message);
    send(res, 500, JSON.stringify({ error: '存档创建失败: ' + err.message }), 'application/json');
  }
}

function validateWorldSavePatch(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '请求必须是 JSON 对象';
  if (!Number.isInteger(payload.expectedRevision) || payload.expectedRevision < 0) return 'expectedRevision 必须是非负整数';
  if (!payload.state || typeof payload.state !== 'object' || Array.isArray(payload.state)) return 'state 必须是对象';
  if (!Array.isArray(payload.turns) || payload.turns.length > 5000) return 'turns 必须是最多 5000 条的数组';
  if (payload.opening !== undefined && typeof payload.opening !== 'string') return 'opening 必须是字符串';
  const state = payload.state;
  if (!Array.isArray(state.inventory) || !Array.isArray(state.quests)) return 'state.inventory/state.quests 必须是数组';
  if (state.locationId !== null && state.locationId !== undefined && (typeof state.locationId !== 'string' || state.locationId.length > 240)) return 'state.locationId 必须是 240 字符以内的字符串或 null';
  if (state.inventory.length > 256 || state.quests.length > 256) return '背包或任务最多各保存 256 项';
  if (state.stats !== undefined) {
    if (!state.stats || typeof state.stats !== 'object' || Array.isArray(state.stats)) return 'state.stats 必须是对象';
    const statRules = {
      level: [1, 999999, true], exp: [0, 1000000000, true], expNext: [1, 1000000000, true],
      hp: [0, 1000000000, false], maxHp: [1, 1000000000, false], mp: [0, 1000000000, false],
      maxMp: [1, 1000000000, false], gold: [0, 1000000000000, false],
    };
    for (const [key, [min, max, integer]] of Object.entries(statRules)) {
      if (state.stats[key] === undefined) continue;
      const value = state.stats[key];
      if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) return `state.stats.${key} 数值无效`;
    }
    if (state.stats.buffs !== undefined && (!Array.isArray(state.stats.buffs) || state.stats.buffs.length > 64 || state.stats.buffs.some(v => typeof v !== 'string' || v.length > 120))) return 'state.stats.buffs 无效';
  }
  for (const item of state.inventory) {
    if (!item || typeof item !== 'object' || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 200) return '背包条目无效';
    if (item.count !== undefined && (!Number.isInteger(item.count) || item.count < 0 || item.count > 1000000)) return '背包数量无效';
    if (item.desc !== undefined && (typeof item.desc !== 'string' || item.desc.length > 2000)) return '背包描述无效';
  }
  for (const quest of state.quests) {
    if (!quest || typeof quest !== 'object' || typeof quest.title !== 'string' || !quest.title.trim() || quest.title.length > 240) return '任务条目无效';
    if (quest.desc !== undefined && (typeof quest.desc !== 'string' || quest.desc.length > 4000)) return '任务描述无效';
    if (quest.status !== undefined && !['active', 'done'].includes(quest.status)) return '任务状态无效';
  }
  if (state.map !== undefined) {
    if (!state.map || typeof state.map !== 'object' || Array.isArray(state.map)) return 'state.map 必须是对象';
    if (state.map.markers !== undefined && (!Array.isArray(state.map.markers) || state.map.markers.length > 256)) return '地图 markers 无效';
    const imagePath = state.map.imagePath;
    if (imagePath !== null && imagePath !== undefined && !/^\/images\/[A-Za-z0-9._-]{1,160}$/.test(imagePath)) return '地图图片必须是本地 /images/ 路径';
    const map = state.map.data;
    if (map !== null && map !== undefined) {
      if (!map || typeof map !== 'object' || !Number.isInteger(map.size) || map.size < 1 || map.size > 512) return '地图 size 无效';
      const generationInvalid = validateWorldDraftMapGeneration(map.generation);
      if (generationInvalid) return generationInvalid;
      if (map.generation && map.generation.size !== map.size) return '地图 generation.size 与 size 不一致';
      if (map.generation && map.generation.seed !== map.seed) return '地图 generation.seed 与 seed 不一致';
      if (!Array.isArray(map.grid) || map.grid.length !== map.size * map.size) return '地图 grid 长度无效';
      if (map.grid.some(v => !Number.isInteger(v) || v < 0 || v > 65535)) return '地图 grid 数值无效';
      if (map.regions !== undefined && (!Array.isArray(map.regions) || map.regions.length > 1024)) return '地图 regions 无效';
      if (map.points !== undefined && (!Array.isArray(map.points) || map.points.length > 4096)) return '地图 points 无效';
      if (map.adjacency !== undefined && (!Array.isArray(map.adjacency) || map.adjacency.length > 8192)) return '地图 adjacency 无效';
    }
  }
  return null;
}

function validateNpcStates(value, allowedIds = null) {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'npcStates 必须是对象';
  const ids = Object.keys(value);
  if (ids.length > 256 || ids.some(id => !id.trim() || id.length > 120)) return 'npcStates 数量或 ID 无效';
  if (allowedIds && ids.some(id => !allowedIds.has(id))) return 'npcStates 包含当前存档未登记的 NPC';
  for (const id of ids) {
    const npc = value[id];
    if (!npc || typeof npc !== 'object' || Array.isArray(npc)) return 'NPC 状态必须是对象';
    if (npc.locationId !== undefined && npc.locationId !== null && (typeof npc.locationId !== 'string' || npc.locationId.length > 240)) return 'NPC locationId 无效';
    if (npc.relation !== undefined && (!npc.relation || typeof npc.relation !== 'object' || Array.isArray(npc.relation))) return 'NPC relation 无效';
    if (npc.knowledge !== undefined && (!Array.isArray(npc.knowledge) || npc.knowledge.length > 128 || npc.knowledge.some(item => typeof item !== 'string' || item.length > 1000))) return 'NPC knowledge 无效';
    if (npc.status !== undefined && (!Array.isArray(npc.status) || npc.status.length > 64 || npc.status.some(item => typeof item !== 'string' || item.length > 240))) return 'NPC status 无效';
  }
  return null;
}

const GENERATED_ENTITY_KINDS = new Set(['npc', 'item', 'quest', 'location']);

function validateCreateEntities(value) {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length > 32) return 'createEntities 必须是最多 32 个实体的数组';
  const tempIds = new Set();
  for (const entity of value) {
    if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return 'createEntities 项必须是对象';
    if (!GENERATED_ENTITY_KINDS.has(entity.kind)) return 'createEntities kind 无效';
    if (typeof entity.tempId !== 'string' || !entity.tempId.trim() || entity.tempId.length > 80) return 'createEntities tempId 无效';
    if (tempIds.has(entity.tempId.trim())) return 'createEntities tempId 不能重复';
    tempIds.add(entity.tempId.trim());
    if (typeof entity.name !== 'string' || !entity.name.trim() || entity.name.length > 200) return 'createEntities name 无效';
    if (entity.reason !== undefined && (typeof entity.reason !== 'string' || entity.reason.length > 1000)) return 'createEntities reason 无效';
    if (entity.description !== undefined && (typeof entity.description !== 'string' || entity.description.length > 4000)) return 'createEntities description 无效';
    for (const key of ['role', 'persona', 'personality', 'appearance', 'speechStyle', 'publicGoals', 'type']) {
      if (entity[key] !== undefined && (typeof entity[key] !== 'string' || entity[key].length > 2000)) return `createEntities ${key} 无效`;
    }
    if (entity.locationId !== undefined && entity.locationId !== null && (typeof entity.locationId !== 'string' || entity.locationId.length > 240)) return 'createEntities locationId 无效';
    if (entity.count !== undefined && (!Number.isInteger(entity.count) || entity.count < 0 || entity.count > 1000000)) return 'createEntities count 无效';
    if (entity.status !== undefined && (typeof entity.status !== 'string' || entity.status.length > 64)) return 'createEntities status 无效';
    for (const key of ['npcIds', 'tags', 'publicFacts']) {
      if (entity[key] !== undefined && (!Array.isArray(entity[key]) || entity[key].length > 64 || entity[key].some(item => typeof item !== 'string' || item.length > 1000))) return `createEntities ${key} 无效`;
    }
  }
  return null;
}

function generatedEntityCount(generatedEntities) {
  if (!generatedEntities || typeof generatedEntities !== 'object' || Array.isArray(generatedEntities)) return 0;
  return Object.values(generatedEntities).reduce((total, bucket) => total + (bucket && typeof bucket === 'object' && !Array.isArray(bucket) ? Object.keys(bucket).length : 0), 0);
}

function nextGeneratedEntitySequence(generatedEntities, saveId) {
  let next = 1;
  if (!generatedEntities || typeof generatedEntities !== 'object') return next;
  for (const bucket of Object.values(generatedEntities)) {
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
    for (const id of Object.keys(bucket)) {
      const match = id.match(new RegExp(`^save:${saveId}:[a-z]+:(\\d+)$`));
      if (match) next = Math.max(next, Number(match[1]) + 1);
    }
  }
  return next;
}

function materializeGeneratedEntities(current, candidates, saveId, commandId, revision) {
  const generated = current.generatedEntities && typeof current.generatedEntities === 'object' && !Array.isArray(current.generatedEntities)
    ? cloneJson(current.generatedEntities)
    : {};
  let sequence = nextGeneratedEntitySequence(generated, saveId);
  for (const candidate of candidates || []) {
    const bucketName = candidate.kind + 's';
    if (!generated[bucketName] || typeof generated[bucketName] !== 'object' || Array.isArray(generated[bucketName])) generated[bucketName] = {};
    const id = `save:${saveId}:${candidate.kind}:${sequence++}`;
    const entity = {
      id,
      kind: candidate.kind,
      tempId: candidate.tempId.trim(),
      name: candidate.name.trim(),
      reason: candidate.reason ? candidate.reason.trim() : '',
      createdAt: Date.now(),
      commandId,
      revision,
    };
    for (const key of ['description', 'locationId', 'status', 'role', 'persona', 'personality', 'appearance', 'speechStyle', 'publicGoals', 'type']) {
      if (candidate[key] !== undefined) entity[key] = candidate[key];
    }
    if (candidate.count !== undefined) entity.count = candidate.count;
    for (const key of ['npcIds', 'tags', 'publicFacts']) {
      if (Array.isArray(candidate[key])) entity[key] = candidate[key].map(item => item.trim());
    }
    generated[bucketName][id] = entity;
  }
  return generated;
}

async function handleWorldSavePut(req, res, saveId) {
  const fp = savePath(saveId);
  if (!fp) return send(res, 400, JSON.stringify({ error: '无效的 saveId' }), 'application/json');
  let payload;
  try { payload = await readJsonBody(req, 4 * 1024 * 1024); }
  catch (err) {
    const status = err.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
    return send(res, status, JSON.stringify({ error: err.message }), 'application/json');
  }
  const invalid = validateWorldSavePatch(payload);
  if (invalid) return send(res, 400, JSON.stringify({ error: invalid }), 'application/json');
  return withWorldSaveLock(saveId, async () => {
    try {
      const current = JSON.parse(await fs.promises.readFile(fp, 'utf-8'));
      if (!current || current.id !== saveId) throw new Error('存档文件 ID 不一致');
      const world = findWorldVersion(await loadWorlds(), current.worldId, current.worldVersion);
      const invalidLocation = validateWorldLocationIds(world, payload.state, current.npcStates);
      if (invalidLocation) return send(res, 400, JSON.stringify({ error: invalidLocation }), 'application/json');
      if (current.revision !== payload.expectedRevision) {
        return send(res, 409, JSON.stringify({ error: '存档版本冲突，请重新读取', revision: current.revision }), 'application/json');
      }
      const next = {
        ...current,
        state: cloneJson(payload.state),
        turns: cloneJson(payload.turns),
        opening: payload.opening === undefined ? current.opening : payload.opening,
        revision: current.revision + 1,
        updatedAt: Date.now(),
      };
      await writeJsonAtomic(fp, next);
      send(res, 200, JSON.stringify(next), 'application/json; charset=utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') return send(res, 404, JSON.stringify({ error: '存档不存在' }), 'application/json');
      console.error('[world-saves] 保存失败:', err.message);
      send(res, 500, JSON.stringify({ error: '存档保存失败: ' + err.message }), 'application/json');
    }
  });
}

function validateWorldTurn(payload) {
  const invalid = validateWorldSavePatch(payload);
  if (invalid) return invalid;
  if (typeof payload.commandId !== 'string' || !COMMAND_ID_RE.test(payload.commandId)) return 'commandId 无效';
  if (payload.turns.length > 32) return '单回合最多提交 32 条消息';
  if (!payload.turns.some(turn => turn && turn.role === 'assistant')) return '回合必须包含 assistant 消息';
  for (const turn of payload.turns) {
    if (!turn || typeof turn !== 'object' || !['user', 'assistant', 'system'].includes(turn.role)) return '回合消息 role 无效';
    if (typeof turn.content !== 'string' || turn.content.length > 100000) return '回合消息 content 无效';
  }
  if (!Array.isArray(payload.options) || payload.options.length !== 4 || payload.options.some(o => typeof o !== 'string' || !o.trim())) return 'options 必须恰好包含 4 个非空字符串';
  if (new Set(payload.options.map(o => o.trim())).size !== 4) return 'options 不能重复';
  const invalidCreateEntities = validateCreateEntities(payload.createEntities);
  if (invalidCreateEntities) return invalidCreateEntities;
  return null;
}

async function handleWorldTurnPost(req, res, saveId) {
  const fp = savePath(saveId);
  if (!fp) return send(res, 400, JSON.stringify({ error: '无效的 saveId' }), 'application/json');
  let payload;
  try { payload = await readJsonBody(req, 4 * 1024 * 1024); }
  catch (err) {
    const status = err.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
    return send(res, status, JSON.stringify({ error: err.message }), 'application/json');
  }
  const invalid = validateWorldTurn(payload);
  if (invalid) return send(res, 400, JSON.stringify({ error: invalid }), 'application/json');
  const invalidNpcStates = validateNpcStates(payload.npcStates);
  if (invalidNpcStates) return send(res, 400, JSON.stringify({ error: invalidNpcStates }), 'application/json');
  return withWorldSaveLock(saveId, async () => {
    try {
      const current = JSON.parse(await fs.promises.readFile(fp, 'utf-8'));
      if (!current || current.id !== saveId) throw new Error('存档文件 ID 不一致');
      const world = findWorldVersion(await loadWorlds(), current.worldId, current.worldVersion);
      const invalidLocation = validateWorldLocationIds(world, payload.state, payload.npcStates, payload.createEntities);
      if (invalidLocation) return send(res, 400, JSON.stringify({ error: invalidLocation }), 'application/json');
      let allowedNpcIds = new Set(Object.keys(current.npcStates || {}));
      const generatedNpcs = current.generatedEntities && current.generatedEntities.npcs;
      if (generatedNpcs && typeof generatedNpcs === 'object' && !Array.isArray(generatedNpcs)) {
        for (const id of Object.keys(generatedNpcs)) allowedNpcIds.add(id);
      }
      if (!allowedNpcIds.size) {
        try {
          const world = findWorldVersion(await loadWorlds(), current.worldId, current.worldVersion);
          allowedNpcIds = new Set(worldNpcIds(world));
        } catch {}
      }
      const invalidNpcIds = validateNpcStates(payload.npcStates, allowedNpcIds);
      if (invalidNpcIds) return send(res, 400, JSON.stringify({ error: invalidNpcIds }), 'application/json');
      const existingReceipt = Array.isArray(current.receipts)
        ? current.receipts.find(receipt => receipt && receipt.commandId === payload.commandId)
        : null;
      if (existingReceipt) return send(res, 200, JSON.stringify(current), 'application/json; charset=utf-8');
      if (current.revision !== payload.expectedRevision) {
        return send(res, 409, JSON.stringify({ error: '存档版本冲突，请重新读取', revision: current.revision }), 'application/json');
      }
      if (generatedEntityCount(current.generatedEntities) + (payload.createEntities ? payload.createEntities.length : 0) > 1024) {
        return send(res, 400, JSON.stringify({ error: '存档临时实体数量不能超过 1024' }), 'application/json');
      }
      const revision = current.revision + 1;
      const committedTurns = payload.turns.map(turn => ({ ...cloneJson(turn), commandId: payload.commandId, revision }));
      const next = {
        ...current,
        state: cloneJson(payload.state),
        npcStates: payload.npcStates === undefined ? (current.npcStates || {}) : cloneJson(payload.npcStates),
        generatedEntities: payload.createEntities && payload.createEntities.length
          ? materializeGeneratedEntities(current, payload.createEntities, saveId, payload.commandId, revision)
          : (current.generatedEntities || {}),
        turns: [...(Array.isArray(current.turns) ? current.turns : []), ...committedTurns],
        receipts: [...(Array.isArray(current.receipts) ? current.receipts : []), {
          commandId: payload.commandId,
          revision,
          turnIds: committedTurns.map(turn => turn.id).filter(Boolean),
          committedAt: Date.now(),
        }].slice(-200),
        revision,
        updatedAt: Date.now(),
      };
      await writeJsonAtomic(fp, next);
      send(res, 200, JSON.stringify(next), 'application/json; charset=utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') return send(res, 404, JSON.stringify({ error: '存档不存在' }), 'application/json');
      console.error('[world-saves] 回合提交失败:', err.message);
      send(res, 500, JSON.stringify({ error: '回合提交失败: ' + err.message }), 'application/json');
    }
  });
}

/** GET /api/data/:type → 返回 JSON 文件内容 */
async function handleDataGet(req, res, type) {
  if (!DATA_TYPES.includes(type) || type === 'worlds') return send(res, 400, '未知数据类型');
  const fp = path.join(DATA_DIR, type + '.json');
  try {
    const data = await fs.promises.readFile(fp, 'utf-8');
    send(res, 200, data, 'application/json; charset=utf-8');
  } catch (err) {
    console.error('[data] 读取失败:', type, err.message);
    send(res, 500, JSON.stringify({ error: '读取失败: ' + err.message }), 'application/json');
  }
}

/** PUT /api/data/:type → 覆盖写入 JSON 文件 */
async function handleDataPut(req, res, type) {
  if (!DATA_TYPES.includes(type) || type === 'worlds') return send(res, 405, JSON.stringify({ error: '世界卡只能通过世界 API 读取，当前阶段不支持编辑' }), 'application/json');
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8');
  try {
    JSON.parse(raw); // 校验是合法 JSON
  } catch {
    return send(res, 400, JSON.stringify({ error: '无效的 JSON' }), 'application/json');
  }
  const fp = path.join(DATA_DIR, type + '.json');
  try {
    await fs.promises.writeFile(fp, raw, 'utf-8');
    send(res, 200, JSON.stringify({ ok: true }), 'application/json');
  } catch (err) {
    console.error('[data] 写入失败:', type, err.message);
    send(res, 500, JSON.stringify({ error: '写入失败: ' + err.message }), 'application/json');
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const IMAGES_DIR = path.join(PUBLIC_DIR, 'images');

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

async function serveStatic(req, res, pathname) {
  let decodedPath;
  try { decodedPath = decodeURIComponent(pathname); }
  catch { return send(res, 400, 'Bad Request'); }
  if (decodedPath === '/data' || decodedPath.startsWith('/data/')) return send(res, 403, 'Forbidden');
  const root = path.resolve(PUBLIC_DIR);
  const filePath = path.resolve(root, decodedPath === '/' ? 'index.html' : '.' + decodedPath);
  const relative = path.relative(root, filePath);
  if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return send(res, 403, 'Forbidden');
  try {
    const data = await fs.promises.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    // 强制不缓存：本地开发频繁改代码，避免浏览器用旧版 app.js 导致“改了没生效”
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT') send(res, 404, 'Not Found');
    else { console.error('[static]', err.message); send(res, 500, 'Internal Error'); }
  }
}

/**
 * 代理：前端把 { baseUrl, apiKey, extraHeaders?, body } 发来，
 * 这里拼出 <baseUrl>/chat/completions 原样转发（含流式 SSE）。
 * body 由前端完全控制（model / messages / temperature / stream 等）。
 */
async function handleChat(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8');
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return send(res, 400, 'Bad JSON');
  }

  const { baseUrl, apiKey, body } = payload || {};
  if (!baseUrl || !body) return send(res, 400, '缺少 baseUrl 或 body');

  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
  if (payload.extraHeaders && typeof payload.extraHeaders === 'object') {
    Object.assign(headers, payload.extraHeaders); // 例如 OpenRouter 的 X-Title
  }

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
    });
    // 流式管道转发（SSE 逐块透传，也兼容非流式）
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    console.error('[proxy] 请求失败:', err.message);
    send(res, 502, JSON.stringify({ error: { message: '代理请求失败: ' + err.message } }), 'application/json');
  }
}

/** 模型列表代理：GET /api/models（前端带 X-Base-Url / X-Api-Key 头） */
async function handleModels(req, res) {
  const baseUrl = req.headers['x-base-url'];
  const apiKey = req.headers['x-api-key'] || '';
  if (!baseUrl) return send(res, 400, '缺少 X-Base-Url 头');
  const headers = {};
  if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
  try {
    const upstream = await fetch(baseUrl.replace(/\/+$/, '') + '/models', { headers });
    const text = await upstream.text();
    res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
    res.end(text);
  } catch (err) {
    console.error('[proxy] 获取模型失败:', err.message);
    send(res, 502, JSON.stringify({ error: { message: '获取模型失败: ' + err.message } }), 'application/json');
  }
}

/**
 * 文生图代理：POST /api/image
 * 前端发 { baseUrl, apiKey, kind: 'openai' | 'sd', body }：
 *   - kind='openai' → POST <baseUrl>/images/generations（OpenAI 兼容）
 *   - kind='sd'     → POST <baseUrl>/sdapi/v1/txt2img（Stable Diffusion WebUI）
 * 原样转发上游 JSON（含 base64 大图），注入 Authorization 头，绕开 CORS。
 */
async function handleImage(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8');
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return send(res, 400, 'Bad JSON');
  }
  const { baseUrl, apiKey, kind, body } = payload || {};
  if (!baseUrl || !body) return send(res, 400, '缺少 baseUrl 或 body');
  // kind=sd → img2img；openai 兼容：body 含 images（参考图）→ /images/edits，否则 /images/generations
  const pathname = kind === 'sd' ? '/sdapi/v1/txt2img'
    : (Array.isArray(body.images) && body.images.length ? '/images/edits' : '/images/generations');
  const url = baseUrl.replace(/\/+$/, '') + pathname;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
  try {
    const upstream = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await upstream.text();
    res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' });
    res.end(text);
  } catch (err) {
    console.error('[proxy] 文生图失败:', err.message);
    send(res, 502, JSON.stringify({ error: { message: '文生图代理请求失败: ' + err.message } }), 'application/json');
  }
}

/**
 * 文生图图片持久化：POST /api/image-save
 * 前端发 { b64: 'data:image/png;base64,...' } 或 { url: 'https://...' }，
 * server 存到 public/images/ 并返回可访问的相对路径（刷新页面图片不丢）。
 */
async function handleImageSave(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8');
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return send(res, 400, 'Bad JSON');
  }
  const { b64, url } = payload || {};
  let buf = null;
  try {
    if (b64) {
      const m = String(b64).match(/^data:image\/(\w+);base64,(.+)$/s);
      buf = m ? Buffer.from(m[2], 'base64') : Buffer.from(String(b64), 'base64');
    } else if (url) {
      const r = await fetch(String(url));
      if (!r.ok) return send(res, 502, JSON.stringify({ error: '下载图片失败: HTTP ' + r.status }), 'application/json');
      buf = Buffer.from(await r.arrayBuffer());
    }
  } catch (err) {
    return send(res, 502, JSON.stringify({ error: '保存图片失败: ' + err.message }), 'application/json');
  }
  if (!buf || !buf.length) return send(res, 400, JSON.stringify({ error: '缺少图片数据（b64 或 url）' }), 'application/json');
  try {
    await fs.promises.mkdir(IMAGES_DIR, { recursive: true });
    const name = Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + '.png';
    await fs.promises.writeFile(path.join(IMAGES_DIR, name), buf);
    send(res, 200, JSON.stringify({ path: '/images/' + name }), 'application/json');
  } catch (err) {
    console.error('[image] 写入失败:', err.message);
    send(res, 500, JSON.stringify({ error: '写入失败: ' + err.message }), 'application/json');
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'POST' && url.pathname === '/api/chat') return handleChat(req, res);
  if (req.method === 'POST' && url.pathname === '/api/image') return handleImage(req, res);
  if (req.method === 'POST' && url.pathname === '/api/image-save') return handleImageSave(req, res);
  if (req.method === 'GET' && url.pathname === '/api/models') return handleModels(req, res);
  if (req.method === 'GET' && url.pathname === '/api/worlds') return handleWorldsGet(req, res);
  const worldDraftListMatch = url.pathname.match(/^\/api\/world-drafts\/?$/);
  if (worldDraftListMatch) {
    if (req.method === 'GET') return handleWorldDraftsGet(req, res, url.searchParams.get('worldId') || '');
    if (req.method === 'POST') return handleWorldDraftCreate(req, res);
  }
  const worldDraftPublishMatch = url.pathname.match(/^\/api\/world-drafts\/([^/]+)\/publish\/?$/);
  if (worldDraftPublishMatch && req.method === 'POST') {
    let worldId;
    try { worldId = decodeURIComponent(worldDraftPublishMatch[1]); }
    catch { return send(res, 400, JSON.stringify({ error: '无效的 worldId' }), 'application/json'); }
    return handleWorldDraftPublish(req, res, worldId);
  }
  const worldDraftMatch = url.pathname.match(/^\/api\/world-drafts\/([^/]+)\/?$/);
  if (worldDraftMatch && (req.method === 'GET' || req.method === 'PUT')) {
    let worldId;
    try { worldId = decodeURIComponent(worldDraftMatch[1]); }
    catch { return send(res, 400, JSON.stringify({ error: '无效的 worldId' }), 'application/json'); }
    if (req.method === 'GET') return handleWorldDraftsGet(req, res, worldId, true);
    return handleWorldDraftPut(req, res, worldId);
  }
  const worldVersionMatch = url.pathname.match(/^\/api\/worlds\/([^/]+)\/versions\/?$/);
  if (worldVersionMatch && req.method === 'POST') {
    let worldId;
    try { worldId = decodeURIComponent(worldVersionMatch[1]); }
    catch { return send(res, 400, JSON.stringify({ error: '无效的 worldId' }), 'application/json'); }
    return handleWorldNpcPromotion(req, res, worldId);
  }
  const worldCardMatch = url.pathname.match(/^\/api\/worlds\/([^/]+)\/?$/);
  if (worldCardMatch && req.method === 'GET') {
    let worldId;
    try { worldId = decodeURIComponent(worldCardMatch[1]); }
    catch { return send(res, 400, JSON.stringify({ error: '无效的 worldId' }), 'application/json'); }
    const rawVersion = url.searchParams.get('version');
    if (rawVersion !== null && (!/^\d+$/.test(rawVersion) || !Number.isSafeInteger(Number(rawVersion)))) {
      return send(res, 400, JSON.stringify({ error: '无效的 worldVersion' }), 'application/json');
    }
    return handleWorldCardGet(req, res, worldId, rawVersion === null ? undefined : Number(rawVersion));
  }
  const worldSaveListMatch = url.pathname.match(/^\/api\/world-saves\/?$/);
  if (worldSaveListMatch) {
    if (req.method === 'GET') return handleWorldSavesList(req, res, url.searchParams.get('worldId') || '');
    if (req.method === 'POST') return handleWorldSaveCreate(req, res);
  }
  const worldSaveMatch = url.pathname.match(/^\/api\/world-saves\/([^/]+)\/?$/);
  if (worldSaveMatch && (req.method === 'GET' || req.method === 'PUT' || req.method === 'POST')) {
    let saveId;
    try { saveId = decodeURIComponent(worldSaveMatch[1]); }
    catch { return send(res, 400, JSON.stringify({ error: '无效的 saveId' }), 'application/json'); }
    if (req.method === 'PUT') return handleWorldSavePut(req, res, saveId);
    if (req.method === 'POST') return handleWorldTurnPost(req, res, saveId);
    return handleWorldSaveGet(req, res, saveId);
  }
  // 数据读写：/api/data/:type
  const dataMatch = url.pathname.match(/^\/api\/data\/(\w+)$/);
  if (dataMatch) {
    if (req.method === 'GET' && dataMatch[1] === 'seed') {
      // 返回默认模板（示例数据 + 格式指令 + 服务预设 + 偏好），深拷贝避免引用污染
      return send(res, 200, JSON.stringify(JSON.parse(JSON.stringify(loadDefaults()))));
    }
    if (req.method === 'GET') return handleDataGet(req, res, dataMatch[1]);
    if (req.method === 'PUT') return handleDataPut(req, res, dataMatch[1]);
  }
  if (API_ONLY) {
    // 纯 API 模式：静态网页 / 图片一律不提供
    if (req.method === 'GET' || req.method === 'HEAD') return send(res, 404, 'Not Found (API only)');
  }
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url.pathname);
  send(res, 405, 'Method Not Allowed');
});

async function startServer(port = PORT) {
  await ensureDataFiles();
  return new Promise((resolve, reject) => {
    const onError = err => { server.off('listening', onListening); reject(err); };
    const onListening = () => { server.off('error', onError); resolve(server); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });
}

if (require.main === module) {
  startServer().then(() => {
    const address = server.address();
    const actualPort = address && typeof address === 'object' ? address.port : PORT;
    console.log('──────────────────────────────────────────');
    console.log('  Tavern · AI RP 框架演示');
    console.log(`  打开: http://localhost:${actualPort}`);
    console.log(`  静态目录: ${PUBLIC_DIR}`);
    console.log(`  数据目录: ${DATA_DIR}`);
    console.log('──────────────────────────────────────────');
  }).catch(err => {
    console.error('[server] 启动失败:', err.message);
    process.exitCode = 1;
  });
}

module.exports = { server, startServer, ensureDataFiles, DATA_DIR, SAVES_DIR };
