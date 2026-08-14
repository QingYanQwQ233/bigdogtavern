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
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const proxyTimeoutValue = Number(process.env.TAVERN_PROXY_TIMEOUT_MS);
const PROXY_TIMEOUT_MS = Number.isFinite(proxyTimeoutValue) && proxyTimeoutValue > 0
  ? Math.min(proxyTimeoutValue, 10 * 60 * 1000)
  : 120 * 1000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.TAVERN_DATA_DIR
  ? path.resolve(process.env.TAVERN_DATA_DIR)
  : path.join(PUBLIC_DIR, 'data');
const SAVES_DIR = path.join(DATA_DIR, 'saves');
const WORLD_DRAFTS_PATH = path.join(DATA_DIR, 'world-drafts.json');
const WORLD_IMPORTS_DIR = path.join(DATA_DIR, 'world-imports');
const RPG_MIGRATIONS_DIR = path.join(DATA_DIR, 'rpg-migrations');
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
  try { await fs.promises.mkdir(WORLD_IMPORTS_DIR, { recursive: true }); } catch {}
  try { await fs.promises.mkdir(RPG_MIGRATIONS_DIR, { recursive: true }); } catch {}
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
const EVENT_LEDGER_MAX = 4096;
const EVENT_MEMORY_MAX = 512;
const WORLD_SUMMARY_EVENT_MAX = 128;
const WORLD_SUMMARY_RELATION_MAX = 128;
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

const WORLD_PACKAGE_SPEC = 'tavern_world_package';
const WORLD_PACKAGE_VERSION = 1;
const WORLD_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
const EXPORT_SECRET_KEYS = new Set(['authorization', 'bearer', 'token', 'password', 'extraheaders']);
const EXPORT_PRIVATE_KEYS = new Set(['sourcesaveid', 'sourcegeneratedentityid']);
const EXPORT_ASSET_KEYS = new Set(['coverImage', 'refImage', 'rawAssetRef']);

function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function sha256Json(value) {
  return 'sha256:' + crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function sha256Text(value) {
  return 'sha256:' + crypto.createHash('sha256').update(value).digest('hex');
}

function worldImportPath(importId) {
  return isSafeId(importId) ? path.join(WORLD_IMPORTS_DIR, importId + '.json') : null;
}

function rpgMigrationPath(migrationId) {
  return isSafeId(migrationId) ? path.join(RPG_MIGRATIONS_DIR, migrationId + '.json') : null;
}

function newRpgMigrationId() {
  return 'rpg-migrate-' + Date.now().toString(36) + '-' + crypto.randomBytes(6).toString('hex');
}

function newWorldImportId() {
  return 'import-' + Date.now().toString(36) + '-' + crypto.randomBytes(6).toString('hex');
}

function newGrowthExperienceId() {
  return 'growth-exp-' + Date.now().toString(36) + '-' + crypto.randomBytes(5).toString('hex');
}

function importedEntityId(kind, importId, sourceId) {
  return `imp-${kind}-${crypto.createHash('sha256').update(`${importId}\0${sourceId}`).digest('hex').slice(0, 24)}`;
}

function portableAssetRef(value) {
  if (value === null || value === '') return true;
  if (typeof value !== 'string' || value.length > 2048) return false;
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      return !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  }
  if (/^\/images\/[A-Za-z0-9._-]{1,160}$/.test(value)) return true;
  return !/[?#]/.test(value) && !/(^|[\\/])\.\.([\\/]|$)/.test(value)
    && !/^(?:[A-Za-z]:[\\/]|\\\\|\/|file:|data:|javascript:)/i.test(value);
}

function isExportSecretKey(key) {
  const normalized = key.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  return EXPORT_SECRET_KEYS.has(normalized) || normalized.endsWith('apikey')
    || normalized.endsWith('token') || normalized.endsWith('clientsecret')
    || normalized.endsWith('secretkey') || normalized.endsWith('privatekey')
    || normalized === 'cookie' || normalized === 'setcookie';
}

function sanitizeWorldPackageValue(value, pathPrefix, redactedPaths) {
  if (Array.isArray(value)) return value.map((item, index) => sanitizeWorldPackageValue(item, `${pathPrefix}[${index}]`, redactedPaths));
  if (!value || typeof value !== 'object') return value;
  const next = {};
  for (const [key, child] of Object.entries(value)) {
    const childPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    const normalizedKey = key.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    if (isExportSecretKey(key) || EXPORT_PRIVATE_KEYS.has(normalizedKey)
      || (EXPORT_ASSET_KEYS.has(key) && !portableAssetRef(child))) {
      redactedPaths.push(childPath);
      continue;
    }
    next[key] = sanitizeWorldPackageValue(child, childPath, redactedPaths);
  }
  return next;
}

async function loadDataDocument(type) {
  return JSON.parse(await fs.promises.readFile(path.join(DATA_DIR, type + '.json'), 'utf-8'));
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
  // 旧 worlds.json 仍可运行：加载时只在内存中补齐默认世界/声明式规则；本函数不写回文件。
  const defaults = loadDefaults();
  const defaultWorlds = Array.isArray(defaults.worlds) ? defaults.worlds : [];
  const defaultByKey = new Map(defaultWorlds.map(world => [`${world.id}:${world.version}`, world]));
  const loaded = worlds.map(world => {
    if (!world) return world;
    const fallback = defaultByKey.get(`${world.id}:${world.version}`);
    if (!fallback) return world;
    const next = { ...world };
    for (const key of ['playerCreation', 'turnContract', 'failure', 'ending', 'time', 'events', 'factions', 'conflicts']) {
      if (next[key] === undefined && fallback[key] !== undefined) next[key] = cloneJson(fallback[key]);
    }
    return next;
  });
  const loadedKeys = new Set(loaded.filter(Boolean).map(world => `${world.id}:${world.version}`));
  for (const world of defaultWorlds) {
    const key = `${world.id}:${world.version}`;
    if (!loadedKeys.has(key)) loaded.push(cloneJson(world));
  }
  return loaded;
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
  const settingInvalid = validateWorldSetting(payload.setting);
  if (settingInvalid) return settingInvalid;
  const rulesInvalid = validateWorldAuthorRules(payload.rules);
  if (rulesInvalid) return rulesInvalid;
  const playerCreationInvalid = validatePlayerCreationSchema(payload.playerCreation);
  if (playerCreationInvalid) return playerCreationInvalid;
  const turnContractInvalid = validateTurnContract(payload.turnContract);
  if (turnContractInvalid) return turnContractInvalid;
  const failureInvalid = validateWorldFailure(payload.failure);
  if (failureInvalid) return failureInvalid;
  const endingInvalid = validateWorldEnding(payload.ending);
  if (endingInvalid) return endingInvalid;
  const timeInvalid = validateWorldTime(payload.time);
  if (timeInvalid) return timeInvalid;
  const eventsInvalid = validateWorldEvents(payload.events);
  if (eventsInvalid) return eventsInvalid;
  const factionsInvalid = validateWorldFactions(payload.factions);
  if (factionsInvalid) return factionsInvalid;
  const conflictsInvalid = validateConflictTemplates(payload.conflicts);
  if (conflictsInvalid) return conflictsInvalid;
  return null;
}

const WORLD_SETTING_FIELDS = new Set(['premise', 'history', 'geography', 'culture', 'technology', 'magic', 'society', 'economy', 'currentSituation']);

function validateWorldSetting(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'setting 必须是对象';
  const keys = Object.keys(value);
  if (keys.length > WORLD_SETTING_FIELDS.size) return 'setting 字段数量超出限制';
  for (const key of keys) {
    if (!WORLD_SETTING_FIELDS.has(key)) return `setting.${key} 不是可编辑字段`;
    if (typeof value[key] !== 'string' || value[key].length > 8000) return `setting.${key} 必须是不超过 8000 个字符的字符串`;
  }
  return null;
}

function validateWorldAuthorRules(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'rules 必须是对象';
  for (const bucket of ['hard', 'soft']) {
    if (value[bucket] === undefined) continue;
    if (!Array.isArray(value[bucket]) || value[bucket].length > 64 || value[bucket].some(item => typeof item !== 'string' || !item.trim() || item.length > 2000)) {
      return `rules.${bucket} 必须是最多 64 项的不超过 2000 个字符的非空字符串数组`;
    }
  }
  return Object.keys(value).some(key => !['hard', 'soft'].includes(key)) ? 'rules 只允许 hard / soft 字段' : null;
}

function validBoundedNumber(value, min, max, integer = false) {
  return Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
}

const DERIVED_FORMULA_MAX_LENGTH = 240;
const DERIVED_FORMULA_MAX_NODES = 64;

function parseDerivedFormula(expression) {
  if (typeof expression !== 'string' || !expression.trim() || expression.length > DERIVED_FORMULA_MAX_LENGTH) return { error: '表达式长度或内容无效' };
  const source = expression.trim();
  const tokens = [];
  const tokenRe = /\s*(?:(\d+(?:\.\d*)?|\.\d+)|([A-Za-z_][A-Za-z0-9_.-]*)|([()+\-*/]))/y;
  let offset = 0;
  while (offset < source.length) {
    tokenRe.lastIndex = offset;
    const match = tokenRe.exec(source);
    if (!match) return { error: '表达式包含非法字符' };
    offset = tokenRe.lastIndex;
    tokens.push(match[1] ? { type: 'number', value: Number(match[1]) } : match[2] ? { type: 'ref', value: match[2] } : { type: match[3] });
  }
  let cursor = 0;
  let nodes = 0;
  const refs = new Set();
  const peek = () => tokens[cursor];
  const take = type => (peek()?.type === type ? tokens[cursor++] : null);
  const makeNode = (type, left, right = null) => {
    if (++nodes > DERIVED_FORMULA_MAX_NODES) throw new Error('表达式过于复杂');
    return { type, left, right };
  };
  function parsePrimary() {
    const token = peek();
    if (token?.type === 'number') { cursor++; return makeNode('number', token.value); }
    if (token?.type === 'ref') { cursor++; refs.add(token.value); return makeNode('ref', token.value); }
    if (take('(')) {
      const node = parseAdd();
      if (!take(')')) throw new Error('括号不匹配');
      return node;
    }
    throw new Error('缺少数字、引用或括号');
  }
  function parseUnary() {
    if (take('+')) return parseUnary();
    if (take('-')) return makeNode('neg', parseUnary());
    return parsePrimary();
  }
  function parseMul() {
    let node = parseUnary();
    while (peek()?.type === '*' || peek()?.type === '/') node = makeNode(tokens[cursor++].type, node, parseUnary());
    return node;
  }
  function parseAdd() {
    let node = parseMul();
    while (peek()?.type === '+' || peek()?.type === '-') node = makeNode(tokens[cursor++].type, node, parseMul());
    return node;
  }
  try {
    const ast = parseAdd();
    if (cursor !== tokens.length) throw new Error('表达式尾部无效');
    return { ast, refs: [...refs] };
  } catch (error) {
    return { error: error.message || '表达式无效' };
  }
}

function validatePlayerCreationSchema(schema, world = null) {
  if (schema === undefined || schema === null) return null;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return 'playerCreation 必须是对象';
  if (!['custom', 'preset'].includes(schema.mode || 'custom')) return 'playerCreation.mode 无效';
  if (schema.title !== undefined && (!draftTextValid(schema.title, 160, true))) return 'playerCreation.title 无效';
  if (schema.description !== undefined && !draftTextValid(schema.description, 2000)) return 'playerCreation.description 无效';
  if (schema.pointBudget !== undefined) {
    const budget = schema.pointBudget;
    if (!budget || typeof budget !== 'object' || Array.isArray(budget)
      || !validBoundedNumber(budget.total, 0, 999, true)
      || (budget.min !== undefined && !validBoundedNumber(budget.min, 0, budget.total, true))) return 'playerCreation.pointBudget 无效';
  }
  const fieldIds = new Set();
  const fields = schema.fields === undefined ? [] : schema.fields;
  if (!Array.isArray(fields) || fields.length > 64) return 'playerCreation.fields 最多 64 项';
  for (const field of fields) {
    const id = typeof field?.id === 'string' ? field.id.trim() : '';
    if (!isSafeId(id) || fieldIds.has(id) || !draftTextValid(field.label, 120, true)) return 'playerCreation.fields 含有重复或无效条目';
    if (!['text', 'textarea', 'select', 'number'].includes(field.type)) return `playerCreation.fields.${id}.type 无效`;
    if (field.required !== undefined && typeof field.required !== 'boolean') return `playerCreation.fields.${id}.required 无效`;
    if (field.maxLength !== undefined && !validBoundedNumber(field.maxLength, 1, 10000, true)) return `playerCreation.fields.${id}.maxLength 无效`;
    if (field.type === 'select') {
      if (!Array.isArray(field.options) || field.options.length > 128 || field.options.length === 0) return `playerCreation.fields.${id}.options 无效`;
      const options = new Set();
      for (const option of field.options) {
        const value = typeof option === 'string' ? option.trim() : String(option?.value || '').trim();
        const label = typeof option === 'string' ? option.trim() : option?.label;
        if (!value || value.length > 160 || options.has(value) || !draftTextValid(label, 160, true)) return `playerCreation.fields.${id}.options 无效`;
        options.add(value);
      }
      if (field.default !== undefined && !options.has(String(field.default))) return `playerCreation.fields.${id}.default 无效`;
    }
    if (field.default !== undefined) {
      if (field.type === 'number') {
        const value = Number(field.default);
        if (!validBoundedNumber(value, field.min ?? -1000000, field.max ?? 1000000)) return `playerCreation.fields.${id}.default 无效`;
      } else if (typeof field.default !== 'string' || field.default.length > (field.maxLength || 2000)) return `playerCreation.fields.${id}.default 无效`;
    }
    if (field.type === 'number') {
      if (field.min !== undefined && !validBoundedNumber(field.min, -1000000, 1000000)) return `playerCreation.fields.${id}.min 无效`;
      if (field.max !== undefined && !validBoundedNumber(field.max, -1000000, 1000000)) return `playerCreation.fields.${id}.max 无效`;
      if (field.min !== undefined && field.max !== undefined && field.min > field.max) return `playerCreation.fields.${id}.range 无效`;
      if (field.step !== undefined && !validBoundedNumber(field.step, 0.000001, 1000000)) return `playerCreation.fields.${id}.step 无效`;
      if (field.default !== undefined && field.step !== undefined) {
        const value = Number(field.default);
        if (Math.abs((value - (field.min ?? 0)) / field.step - Math.round((value - (field.min ?? 0)) / field.step)) > 1e-9) return `playerCreation.fields.${id}.default 无效`;
      }
    }
    fieldIds.add(id);
  }
  const attributeIds = new Set();
  const attributes = schema.attributes === undefined ? [] : schema.attributes;
  if (!Array.isArray(attributes) || attributes.length > 64) return 'playerCreation.attributes 最多 64 项';
  for (const attribute of attributes) {
    const id = typeof attribute?.id === 'string' ? attribute.id.trim() : '';
    if (!isSafeId(id) || attributeIds.has(id) || !draftTextValid(attribute.label, 120, true)) return 'playerCreation.attributes 含有重复或无效条目';
    const min = attribute.min ?? 0;
    const max = attribute.max ?? 100;
    const step = attribute.step ?? 1;
    if (!validBoundedNumber(min, -1000000, 1000000) || !validBoundedNumber(max, min, 1000000)
      || !validBoundedNumber(step, 0.000001, 1000000) || !validBoundedNumber(attribute.default ?? min, min, max)) return `playerCreation.attributes.${id} 范围无效`;
    attributeIds.add(id);
  }
  const resourceIds = new Set();
  const resources = schema.resources === undefined ? [] : schema.resources;
  if (!Array.isArray(resources) || resources.length > 64) return 'playerCreation.resources 最多 64 项';
  for (const resource of resources) {
    const id = typeof resource?.id === 'string' ? resource.id.trim() : '';
    if (!isSafeId(id) || resourceIds.has(id) || !draftTextValid(resource.label, 120, true) || (resource.type && resource.type !== 'number')) return 'playerCreation.resources 含有重复或无效条目';
    const min = resource.min ?? 0;
    const max = resource.max ?? 1000000;
    if (!validBoundedNumber(min, -1000000, 1000000000) || !validBoundedNumber(max, min, 1000000000)
      || !validBoundedNumber(resource.initial ?? min, min, max)) return `playerCreation.resources.${id} 范围无效`;
    resourceIds.add(id);
  }
  const skillIds = new Set();
  const skills = schema.skills === undefined ? [] : schema.skills;
  if (!Array.isArray(skills) || skills.length > 128) return 'playerCreation.skills 最多 128 项';
  for (const skill of skills) {
    const id = typeof skill?.id === 'string' ? skill.id.trim() : '';
    const min = skill.min ?? 0;
    const max = skill.max ?? 100;
    const step = skill.step ?? 1;
    if (!isSafeId(id) || skillIds.has(id) || !draftTextValid(skill.label, 120, true)
      || (skill.description !== undefined && !draftTextValid(skill.description, 1000))
      || !validBoundedNumber(min, -1000000, 1000000) || !validBoundedNumber(max, min, 1000000)
      || !validBoundedNumber(step, 0.000001, 1000000)
      || !validBoundedNumber(skill.default ?? min, min, max)) return 'playerCreation.skills 含有重复或无效条目';
    if (skill.default !== undefined && Math.abs((Number(skill.default) - min) / step - Math.round((Number(skill.default) - min) / step)) > 1e-9) return `playerCreation.skills.${id}.default 无效`;
    skillIds.add(id);
  }
  const derived = schema.derived === undefined ? [] : schema.derived;
  if (!Array.isArray(derived) || derived.length > 64) return 'playerCreation.derived 最多 64 项';
  const derivedIds = new Set();
  const derivedRefs = new Map();
  for (const definition of derived) {
    const id = typeof definition?.id === 'string' ? definition.id.trim() : '';
    if (!isSafeId(id) || derivedIds.has(id) || !draftTextValid(definition.label, 120, true)
      || typeof definition.formula !== 'string' || !definition.formula.trim() || definition.formula.length > DERIVED_FORMULA_MAX_LENGTH
      || (definition.description !== undefined && !draftTextValid(definition.description, 1000))
      || (definition.visible !== undefined && typeof definition.visible !== 'boolean')) return 'playerCreation.derived 含有重复或无效条目';
    derivedIds.add(id);
  }
  for (const definition of derived) {
    const parsed = parseDerivedFormula(definition.formula);
    if (parsed.error) return `playerCreation.derived.${definition.id}.formula ${parsed.error}`;
    for (const ref of parsed.refs) {
      const parts = ref.split('.');
      if (parts.length !== 2 || !['attributes', 'skills', 'resources', 'derived'].includes(parts[0]) || !isSafeId(parts[1])) return `playerCreation.derived.${definition.id}.formula 引用了无效 ID`;
      const allowed = parts[0] === 'attributes' ? attributeIds : parts[0] === 'skills' ? skillIds : parts[0] === 'resources' ? resourceIds : derivedIds;
      if (!allowed.has(parts[1])) return `playerCreation.derived.${definition.id}.formula 引用了不存在的 ${ref}`;
    }
    derivedRefs.set(definition.id, parsed.refs.filter(ref => ref.startsWith('derived.')).map(ref => ref.slice(8)));
  }
  const visiting = new Set();
  const visited = new Set();
  function visitDerived(id) {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of derivedRefs.get(id) || []) if (visitDerived(dependency)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  }
  for (const id of derivedIds) if (visitDerived(id)) return `playerCreation.derived.${id}.formula 存在循环依赖`;
  const traitIds = new Set();
  const traits = schema.traits === undefined ? [] : schema.traits;
  if (!Array.isArray(traits) || traits.length > 128) return 'playerCreation.traits 最多 128 项';
  for (const trait of traits) {
    const id = typeof trait?.id === 'string' ? trait.id.trim() : '';
    if (!isSafeId(id) || traitIds.has(id) || !draftTextValid(trait.label, 120, true) || (trait.description !== undefined && !draftTextValid(trait.description, 1000))) return 'playerCreation.traits 含有重复或无效条目';
    traitIds.add(id);
  }
  const relationIds = new Set();
  if (schema.relations !== undefined) {
    if (!Array.isArray(schema.relations) || schema.relations.length > 256) return 'playerCreation.relations 无效';
    const allowedNpcIds = world ? new Set(worldNpcIds(world)) : null;
    for (const relation of schema.relations) {
      const npcId = typeof relation?.npcId === 'string' ? relation.npcId.trim() : '';
      if (!isSafeId(npcId) || relationIds.has(npcId) || (allowedNpcIds && !allowedNpcIds.has(npcId))) return 'playerCreation.relations 含有无效 NPC';
      if (!validBoundedNumber(relation.min ?? -100, -1000000, 1000000) || !validBoundedNumber(relation.max ?? 100, relation.min ?? -100, 1000000)
        || !validBoundedNumber(relation.default ?? 0, relation.min ?? -100, relation.max ?? 100)) return `playerCreation.relations.${npcId} 范围无效`;
      relationIds.add(npcId);
    }
  }
  const growthInvalid = validateGrowthSchema(schema.growth, {
    attributes: attributeIds, skills: skillIds, resources: resourceIds, traits: traitIds, relations: relationIds,
    factions: new Set(worldFactionDefinitions(world).map(faction => faction.id)), npcIds: new Set(worldNpcIds(world)),
  });
  if (growthInvalid) return growthInvalid;
  const economyInvalid = validatePlayerEconomySchema(schema.economy);
  if (economyInvalid) return economyInvalid;
  return null;
}

function validateGrowthSchema(value, buckets = {}) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'playerCreation.growth 必须是对象';
  if (value.sources !== undefined && !Array.isArray(value.sources)) return 'playerCreation.growth.sources 必须是数组';
  if (value.candidates !== undefined && !Array.isArray(value.candidates)) return 'playerCreation.growth.candidates 必须是数组';
  const sources = Array.isArray(value.sources) ? value.sources : [];
  if (sources.length > 32) return 'playerCreation.growth.sources 最多 32 项';
  const sourceIds = new Set();
  for (const source of sources) {
    const id = typeof source?.id === 'string' ? source.id.trim() : '';
    if (!isSafeId(id) || sourceIds.has(id) || !draftTextValid(source.label, 160, true)) return 'playerCreation.growth.sources 含有重复或无效条目';
    if (source.kind !== undefined && !['training', 'learning', 'exploration', 'relationship', 'event', 'custom'].includes(source.kind)) return `playerCreation.growth.sources.${id}.kind 无效`;
    if (source.description !== undefined && !draftTextValid(source.description, 1000)) return `playerCreation.growth.sources.${id}.description 无效`;
    sourceIds.add(id);
  }
  const candidates = Array.isArray(value.candidates) ? value.candidates : [];
  if (candidates.length > 128) return 'playerCreation.growth.candidates 最多 128 项';
  const candidateIds = new Set();
  for (const candidate of candidates) {
    const id = typeof candidate?.id === 'string' ? candidate.id.trim() : '';
    const sourceId = typeof candidate?.sourceId === 'string' ? candidate.sourceId.trim() : '';
    const bucket = candidate?.bucket;
    const targetId = typeof candidate?.targetId === 'string' ? candidate.targetId.trim() : '';
    const targetIds = buckets[bucket] || new Set();
    const numericBucket = ['attributes', 'skills', 'resources', 'relations', 'factions'].includes(bucket);
    const validBucket = ['attributes', 'skills', 'resources', 'traits', 'relations', 'factions', 'identity'].includes(bucket);
    if (!isSafeId(id) || candidateIds.has(id) || !draftTextValid(candidate.label, 200, true) || !sourceIds.has(sourceId)
      || !validBucket || !isSafeId(targetId) || (bucket !== 'identity' && !targetIds.has(targetId))) return 'playerCreation.growth.candidates 含有重复或无效条目';
    if (numericBucket && (!Number.isFinite(candidate.delta) || candidate.delta === 0 || Math.abs(candidate.delta) > 100)) return `playerCreation.growth.candidates.${id}.delta 无效`;
    if (!numericBucket && bucket !== 'identity' && candidate.delta !== undefined) return `playerCreation.growth.candidates.${id}.delta 无效`;
    if (bucket === 'factions' && candidate.metric !== undefined && !['relation', 'influence'].includes(candidate.metric)) return `playerCreation.growth.candidates.${id}.metric 无效`;
    if (bucket === 'identity' && !draftTextValid(candidate.value, 160, true)) return `playerCreation.growth.candidates.${id}.value 无效`;
    if (candidate.description !== undefined && !draftTextValid(candidate.description, 1000)) return `playerCreation.growth.candidates.${id}.description 无效`;
    candidateIds.add(id);
  }
  return null;
}

function playerGrowthSchema(world) {
  const growth = playerCreationSchema(world)?.growth;
  return growth && typeof growth === 'object' && !Array.isArray(growth) ? growth : null;
}

function validateGrowthCandidates(world, value, current = null) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > 128) return 'state.growthCandidates 最多 128 项';
  const growth = playerGrowthSchema(world);
  const definitions = new Map((Array.isArray(growth?.candidates) ? growth.candidates : []).map(candidate => [candidate.id, candidate]));
  const sourceIds = new Set((Array.isArray(growth?.sources) ? growth.sources : []).map(source => source.id));
  if (!definitions.size && value.length) return 'state.growthCandidates 包含未声明的成长候选';
  const ids = new Set();
  for (const candidate of value) {
    const id = typeof candidate?.id === 'string' ? candidate.id.trim() : '';
    const candidateId = typeof candidate?.candidateId === 'string' ? candidate.candidateId.trim() : '';
    const sourceId = typeof candidate?.sourceId === 'string' ? candidate.sourceId.trim() : '';
    if (!isSafeId(id) || ids.has(id) || !isSafeId(candidateId) || !definitions.has(candidateId) || !sourceIds.has(sourceId)) return 'state.growthCandidates 含有重复或无效条目';
    const definition = definitions.get(candidateId);
    if (definition.sourceId !== sourceId || (candidate.status !== undefined && candidate.status !== 'proposed')) return `state.growthCandidates.${id} 只能保存未应用的候选`;
    if (candidate.reason !== undefined && !draftTextValid(candidate.reason, 2000)) return `state.growthCandidates.${id}.reason 无效`;
    if (candidate.revision !== undefined && (!Number.isInteger(candidate.revision) || candidate.revision < 0)) return `state.growthCandidates.${id}.revision 无效`;
    ids.add(id);
  }
  if (current && Array.isArray(current)) {
    for (const previous of current) {
      const next = value.find(candidate => candidate?.id === previous?.id);
      if (!next) return `state.growthCandidates.${previous?.id || 'unknown'} 不能省略`;
      if (canonicalJson(next) !== canonicalJson(previous)) return `state.growthCandidates.${previous?.id || 'unknown'} 只能追加，不能改写`;
    }
  }
  return null;
}

function growthCandidateEffect(definition) {
  if (!definition || typeof definition !== 'object') return null;
  return {
    bucket: definition.bucket,
    targetId: definition.targetId,
    ...(definition.delta !== undefined ? { delta: definition.delta } : {}),
    ...(definition.metric !== undefined ? { metric: definition.metric } : {}),
    ...(definition.value !== undefined ? { value: definition.value } : {}),
  };
}

function validateGrowthApplications(world, value, current = null) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > 128) return 'state.growthApplications 最多 128 项';
  const definitions = new Map((Array.isArray(playerGrowthSchema(world)?.candidates) ? playerGrowthSchema(world).candidates : []).map(candidate => [candidate.id, candidate]));
  const ids = new Set();
  const candidateIds = new Set();
  for (const item of value) {
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    const candidateId = typeof item?.candidateId === 'string' ? item.candidateId.trim() : '';
    const sourceId = typeof item?.sourceId === 'string' ? item.sourceId.trim() : '';
    if (!isSafeId(id) || ids.has(id) || candidateIds.has(candidateId) || !isSafeId(candidateId) || !definitions.has(candidateId) || !isSafeId(sourceId)) return 'state.growthApplications 含有重复或无效条目';
    const definition = definitions.get(candidateId);
    if (definition.sourceId !== sourceId || !['accepted', 'rejected'].includes(item.decision)) return `state.growthApplications.${id} 无效`;
    if ((item.decision === 'accepted') !== !!item.experienceId) return `state.growthApplications.${id}.experienceId 无效`;
    if (item.experienceId !== null && item.experienceId !== undefined && !isSafeId(String(item.experienceId))) return `state.growthApplications.${id}.experienceId 无效`;
    if (!Number.isInteger(item.revision) || item.revision < 1 || !Number.isFinite(item.appliedAt)) return `state.growthApplications.${id} 元数据无效`;
    ids.add(id);
    candidateIds.add(candidateId);
  }
  if (current && Array.isArray(current)) {
    for (const previous of current) {
      const next = value.find(item => item?.id === previous?.id);
      if (!next) return `state.growthApplications.${previous?.id || 'unknown'} 不能省略`;
      if (canonicalJson(next) !== canonicalJson(previous)) return `state.growthApplications.${previous?.id || 'unknown'} 只能追加，不能改写`;
    }
  }
  return null;
}

function validateGrowthExperiences(world, value, current = null) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > 256) return 'state.experiences 最多 256 项';
  const definitions = new Map((Array.isArray(playerGrowthSchema(world)?.candidates) ? playerGrowthSchema(world).candidates : []).map(candidate => [candidate.id, candidate]));
  const ids = new Set();
  const candidateIds = new Set();
  for (const item of value) {
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    const candidateId = typeof item?.candidateId === 'string' ? item.candidateId.trim() : '';
    const sourceId = typeof item?.sourceId === 'string' ? item.sourceId.trim() : '';
    if (!isSafeId(id) || ids.has(id) || candidateIds.has(candidateId) || !isSafeId(candidateId) || !definitions.has(candidateId) || !isSafeId(sourceId)
      || !draftTextValid(item.title, 200, true) || !draftTextValid(item.summary, 4000, true)) return 'state.experiences 含有重复或无效条目';
    const definition = definitions.get(candidateId);
    if (definition.sourceId !== sourceId || canonicalJson(item.effects) !== canonicalJson(growthCandidateEffect(definition))) return `state.experiences.${id} 效果与世界卡不一致`;
    if (item.locationId !== null && item.locationId !== undefined && !isSafeId(String(item.locationId))) return `state.experiences.${id}.locationId 无效`;
    if (!Number.isInteger(item.revision) || item.revision < 1 || !Number.isFinite(item.createdAt)) return `state.experiences.${id} 元数据无效`;
    ids.add(id);
    candidateIds.add(candidateId);
  }
  if (current && Array.isArray(current)) {
    for (const previous of current) {
      const next = value.find(item => item?.id === previous?.id);
      if (!next) return `state.experiences.${previous?.id || 'unknown'} 不能省略`;
      if (canonicalJson(next) !== canonicalJson(previous)) return `state.experiences.${previous?.id || 'unknown'} 只能追加，不能改写`;
    }
  }
  return null;
}

function validateGrowthStateCrossRefs(state) {
  if (!state || typeof state !== 'object') return null;
  const candidates = Array.isArray(state.growthCandidates) ? state.growthCandidates : [];
  const applications = Array.isArray(state.growthApplications) ? state.growthApplications : [];
  const experiences = Array.isArray(state.experiences) ? state.experiences : [];
  const appliedCandidateIds = new Set(applications.map(item => item?.candidateId).filter(Boolean));
  if (candidates.some(item => appliedCandidateIds.has(item?.candidateId))) return '成长候选不能重复应用';
  const experienceIds = new Set(experiences.map(item => item?.id).filter(Boolean));
  for (const application of applications) {
    if (application.decision === 'accepted' && !experienceIds.has(application.experienceId)) return '已接受成长必须对应人物经历';
    if (application.decision === 'rejected' && application.experienceId) return '拒绝成长不能对应人物经历';
  }
  for (const experience of experiences) {
    if (!applications.some(application => application.decision === 'accepted' && application.experienceId === experience.id)) return '人物经历缺少对应的成长应用';
  }
  return null;
}

function applyGrowthEffect(world, state, npcStates, definition) {
  const effect = growthCandidateEffect(definition);
  if (!effect || !state || !state.player || typeof state.player !== 'object') return { error: '当前存档缺少可应用成长的玩家状态' };
  const schema = playerCreationSchema(world) || {};
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  if (['attributes', 'skills', 'resources'].includes(effect.bucket)) {
    const rule = (Array.isArray(schema[effect.bucket]) ? schema[effect.bucket] : []).find(item => item.id === effect.targetId);
    if (!rule) return { error: '成长目标已不在当前世界卡中' };
    const bucket = state.player[effect.bucket] && typeof state.player[effect.bucket] === 'object' ? state.player[effect.bucket] : (state.player[effect.bucket] = {});
    const next = clamp(Number(bucket[effect.targetId] ?? rule.default ?? rule.initial ?? rule.min ?? 0) + effect.delta, rule.min ?? 0, rule.max ?? (effect.bucket === 'resources' ? 1000000 : 100));
    bucket[effect.targetId] = next;
    if (effect.bucket === 'resources' && ['hp', 'mp', 'gold'].includes(effect.targetId)) {
      state.stats = { ...(state.stats || {}), [effect.targetId]: next };
      if (effect.targetId === 'gold' && state.currencies && typeof state.currencies === 'object') state.currencies.gold = next;
    }
    return { effect };
  }
  if (effect.bucket === 'traits') {
    const traits = Array.isArray(state.player.traits) ? state.player.traits : (state.player.traits = []);
    if (!traits.includes(effect.targetId)) traits.push(effect.targetId);
    return { effect };
  }
  if (effect.bucket === 'relations') {
    const rule = (Array.isArray(schema.relations) ? schema.relations : []).find(item => item.npcId === effect.targetId);
    if (!rule) return { error: '成长关系目标已不在当前世界卡中' };
    const relations = state.player.relations && typeof state.player.relations === 'object' ? state.player.relations : (state.player.relations = {});
    const next = clamp(Number(relations[effect.targetId] ?? rule.default ?? 0) + effect.delta, rule.min ?? -100, rule.max ?? 100);
    relations[effect.targetId] = next;
    if (npcStates && npcStates[effect.targetId]) npcStates[effect.targetId].relation = { ...(npcStates[effect.targetId].relation || {}), player: next };
    return { effect };
  }
  if (effect.bucket === 'factions') {
    const faction = worldFactionDefinitions(world).find(item => item.id === effect.targetId);
    if (!faction) return { error: '成长阵营目标已不在当前世界卡中' };
    state.factionStates = materializeFactionStates(world, state.factionStates);
    const factionState = state.factionStates[effect.targetId];
    const metric = effect.metric || 'relation';
    const min = metric === 'relation' ? -100 : 0;
    const max = metric === 'relation' ? 100 : 1000000000;
    factionState[metric] = clamp(Number(factionState[metric] ?? min) + effect.delta, min, max);
    return { effect };
  }
  if (effect.bucket === 'identity') {
    const identity = state.player.identity && typeof state.player.identity === 'object' ? state.player.identity : (state.player.identity = {});
    const values = Array.isArray(identity[effect.targetId]) ? identity[effect.targetId] : (identity[effect.targetId] = []);
    if (!values.includes(effect.value)) values.push(effect.value);
    identity[effect.targetId] = values.slice(-32);
    return { effect };
  }
  return { error: '不支持的成长效果' };
}

function validatePlayerEconomySchema(economy) {
  if (economy === undefined || economy === null) return null;
  if (!economy || typeof economy !== 'object' || Array.isArray(economy)) return 'playerCreation.economy 必须是对象';
  const inventory = economy.inventory === undefined ? {} : economy.inventory;
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) return 'playerCreation.economy.inventory 无效';
  for (const key of ['enabled', 'allowUnknownItems']) {
    if (inventory[key] !== undefined && typeof inventory[key] !== 'boolean') return `playerCreation.economy.inventory.${key} 无效`;
  }
  if (inventory.maxSlots !== undefined && (!Number.isInteger(inventory.maxSlots) || inventory.maxSlots < 1 || inventory.maxSlots > 256)) return 'playerCreation.economy.inventory.maxSlots 无效';
  if (inventory.maxWeight !== undefined && inventory.maxWeight !== null && !validBoundedNumber(inventory.maxWeight, 0, 1000000000)) return 'playerCreation.economy.inventory.maxWeight 无效';
  const itemIds = new Set();
  const items = inventory.items === undefined ? [] : inventory.items;
  if (!Array.isArray(items) || items.length > 256) return 'playerCreation.economy.inventory.items 最多 256 项';
  for (const item of items) {
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    if (!isSafeId(id) || itemIds.has(id) || !draftTextValid(item.label, 160, true)) return 'playerCreation.economy.inventory.items 含有重复或无效条目';
    if (item.weight !== undefined && !validBoundedNumber(item.weight, 0, 1000000)) return `playerCreation.economy.inventory.items.${id}.weight 无效`;
    if (item.maxStack !== undefined && (!Number.isInteger(item.maxStack) || item.maxStack < 1 || item.maxStack > 1000000)) return `playerCreation.economy.inventory.items.${id}.maxStack 无效`;
    if (item.slot !== undefined && item.slot !== null && !isSafeId(String(item.slot))) return `playerCreation.economy.inventory.items.${id}.slot 无效`;
    itemIds.add(id);
  }
  const equipment = economy.equipment === undefined ? {} : economy.equipment;
  if (!equipment || typeof equipment !== 'object' || Array.isArray(equipment)) return 'playerCreation.economy.equipment 无效';
  if (equipment.enabled !== undefined && typeof equipment.enabled !== 'boolean') return 'playerCreation.economy.equipment.enabled 无效';
  const slotIds = new Set();
  const slots = equipment.slots === undefined ? [] : equipment.slots;
  if (!Array.isArray(slots) || slots.length > 32) return 'playerCreation.economy.equipment.slots 最多 32 项';
  for (const slot of slots) {
    const id = typeof slot?.id === 'string' ? slot.id.trim() : '';
    if (!isSafeId(id) || slotIds.has(id) || !draftTextValid(slot.label, 120, true)) return 'playerCreation.economy.equipment.slots 含有重复或无效条目';
    slotIds.add(id);
  }
  for (const item of items) if (item.slot !== undefined && item.slot !== null && !slotIds.has(String(item.slot))) return `playerCreation.economy.inventory.items.${item.id}.slot 引用了不存在的装备位`;
  const currencyIds = new Set();
  const currencies = economy.currencies === undefined ? [] : economy.currencies;
  if (!Array.isArray(currencies) || currencies.length > 32) return 'playerCreation.economy.currencies 最多 32 项';
  for (const currency of currencies) {
    const id = typeof currency?.id === 'string' ? currency.id.trim() : '';
    const min = currency.min ?? 0;
    const max = currency.max ?? 1000000000000;
    if (!isSafeId(id) || currencyIds.has(id) || !draftTextValid(currency.label, 120, true)
      || !validBoundedNumber(min, 0, 1000000000000) || !validBoundedNumber(max, min, 1000000000000)
      || !validBoundedNumber(currency.initial ?? min, min, max)) return 'playerCreation.economy.currencies 含有重复或无效条目';
    currencyIds.add(id);
  }
  return null;
}

function playerEconomySchema(world) {
  const economy = playerCreationSchema(world)?.economy;
  return economy && typeof economy === 'object' && !Array.isArray(economy) ? economy : null;
}

function materializePlayerEconomyState(world, initial = {}, playerState = null) {
  const economy = playerEconomySchema(world);
  if (!economy) return {};
  const currencies = initial.currencies && typeof initial.currencies === 'object' && !Array.isArray(initial.currencies) ? cloneJson(initial.currencies) : {};
  for (const currency of Array.isArray(economy.currencies) ? economy.currencies : []) {
    if (currencies[currency.id] === undefined && Number.isFinite(playerState?.resources?.[currency.id])) currencies[currency.id] = playerState.resources[currency.id];
    if (currencies[currency.id] === undefined) currencies[currency.id] = currency.initial ?? currency.min ?? 0;
  }
  return {
    inventory: Array.isArray(initial.inventory) ? cloneJson(initial.inventory) : [],
    equipment: initial.equipment && typeof initial.equipment === 'object' && !Array.isArray(initial.equipment) ? cloneJson(initial.equipment) : {},
    currencies,
  };
}

function validatePlayerEconomyState(world, state, current = null) {
  const economy = playerEconomySchema(world);
  if (!economy) return null;
  if (!state || typeof state !== 'object' || Array.isArray(state)) return 'state 必须是对象';
  const inventoryRules = economy.inventory && typeof economy.inventory === 'object' ? economy.inventory : {};
  const inventory = state.inventory;
  if (!Array.isArray(inventory)) return 'state.inventory 必须是数组';
  if (inventoryRules.enabled === false && inventory.length) return '当前世界卡已关闭背包';
  if (inventoryRules.maxSlots !== undefined && inventory.length > inventoryRules.maxSlots) return `state.inventory 不能超过 ${inventoryRules.maxSlots} 格`;
  const itemDefinitions = new Map((Array.isArray(inventoryRules.items) ? inventoryRules.items : []).map(item => [item.id, item]));
  let weight = 0;
  for (const item of inventory) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 200) return '背包条目无效';
    if (item.itemId !== undefined && (!isSafeId(String(item.itemId)) || (itemDefinitions.size && !itemDefinitions.has(String(item.itemId)) && inventoryRules.allowUnknownItems !== true))) return '背包条目引用了未知物品';
    const definition = itemDefinitions.get(String(item.itemId || ''));
    const count = item.count === undefined ? 1 : item.count;
    if (!Number.isInteger(count) || count < 1 || count > 1000000) return '背包数量无效';
    if (definition?.maxStack !== undefined && count > definition.maxStack) return `背包物品 ${definition.id} 超过堆叠上限`;
    const itemWeight = item.weight ?? definition?.weight ?? 0;
    if (!validBoundedNumber(itemWeight, 0, 1000000)) return '背包重量无效';
    if (item.desc !== undefined && (typeof item.desc !== 'string' || item.desc.length > 2000)) return '背包描述无效';
    weight += itemWeight * count;
  }
  if (inventoryRules.maxWeight !== undefined && inventoryRules.maxWeight !== null && weight > inventoryRules.maxWeight + 1e-9) return `背包重量不能超过 ${inventoryRules.maxWeight}`;
  const equipmentRules = economy.equipment && typeof economy.equipment === 'object' ? economy.equipment : {};
  const equipment = state.equipment === undefined ? {} : state.equipment;
  if (current?.equipment !== undefined && state.equipment === undefined) return 'state.equipment 不能省略';
  if (!equipment || typeof equipment !== 'object' || Array.isArray(equipment)) return 'state.equipment 必须是对象';
  const slotIds = new Set((Array.isArray(equipmentRules.slots) ? equipmentRules.slots : []).map(slot => slot.id));
  if (equipmentRules.enabled === false && Object.keys(equipment).length) return '当前世界卡已关闭装备位';
  if (Object.keys(equipment).some(slotId => !slotIds.has(slotId))) return 'state.equipment 含有未声明的装备位';
  const inventoryById = new Map(inventory.filter(item => item?.itemId).map(item => [String(item.itemId), item]));
  for (const [slotId, itemId] of Object.entries(equipment)) {
    if (itemId === null || itemId === undefined || itemId === '') continue;
    if (typeof itemId !== 'string' || !isSafeId(itemId) || !inventoryById.has(itemId)) return `state.equipment.${slotId} 引用了不在背包中的物品`;
    const definition = itemDefinitions.get(itemId);
    if (definition?.slot && definition.slot !== slotId) return `state.equipment.${slotId} 与物品装备位不匹配`;
  }
  const currenciesRules = Array.isArray(economy.currencies) ? economy.currencies : [];
  const currencies = state.currencies === undefined ? {} : state.currencies;
  if (current?.currencies !== undefined && state.currencies === undefined) return 'state.currencies 不能省略';
  if (!currencies || typeof currencies !== 'object' || Array.isArray(currencies)) return 'state.currencies 必须是对象';
  const currencyDefinitions = new Map(currenciesRules.map(currency => [currency.id, currency]));
  for (const [id, value] of Object.entries(currencies)) {
    const definition = currencyDefinitions.get(id);
    if (!definition || !validBoundedNumber(value, definition.min ?? 0, definition.max ?? 1000000000000)) return `state.currencies.${id} 超出世界卡范围`;
  }
  for (const definition of currenciesRules) if (currencies[definition.id] === undefined && current?.currencies?.[definition.id] !== undefined) return `state.currencies.${definition.id} 不能省略`;
  return null;
}

function playerCreationSchema(world) {
  const schema = world?.playerCreation;
  return schema && typeof schema === 'object' && !Array.isArray(schema) ? schema : null;
}

function validateDynamicPlayerState(world, value, current = null, immutable = false) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'state.player 必须是对象';
  const schema = playerCreationSchema(world);
  if (!schema) return null;
  if (value.derived !== undefined) return 'state.player.derived 是只读派生值，不能写入';
  if (value.identity !== undefined) {
    if (!value.identity || typeof value.identity !== 'object' || Array.isArray(value.identity) || Object.keys(value.identity).length > 32) return 'state.player.identity 无效';
    for (const [key, values] of Object.entries(value.identity)) {
      if (!isSafeId(key) || !Array.isArray(values) || values.length > 32 || values.some(item => typeof item !== 'string' || !draftTextValid(item, 160, true))) return `state.player.identity.${key} 无效`;
    }
  }
  const definitions = { attributes: schema.attributes || [], skills: schema.skills || [], resources: schema.resources || [] };
  for (const bucket of ['attributes', 'skills', 'resources']) {
    const map = value[bucket];
    if (map === undefined) continue;
    if (!map || typeof map !== 'object' || Array.isArray(map)) return `state.player.${bucket} 必须是对象`;
    if (current?.[bucket] && typeof current[bucket] === 'object') {
      for (const id of Object.keys(current[bucket])) if (map[id] === undefined) return `state.player.${bucket}.${id} 不能省略`;
    }
    const defs = new Map(definitions[bucket].map(definition => [definition.id, definition]));
    for (const [id, number] of Object.entries(map)) {
      const definition = defs.get(id);
      if (!definition || !validBoundedNumber(number, definition.min ?? 0, definition.max ?? (bucket === 'resources' ? 1000000 : 100))) return `state.player.${bucket}.${id} 超出世界卡范围`;
    }
  }
  if (immutable && current) {
    for (const key of ['fields', 'traits', 'relations', 'identity']) {
      if (canonicalJson(value[key] ?? null) !== canonicalJson(current[key] ?? null)) return `state.player.${key} 只能由存档创建时确定`;
    }
  }
  return null;
}

function validateTurnContract(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'turnContract 必须是对象';
  const options = value.options;
  if (options !== undefined) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) return 'turnContract.options 必须是对象';
    const min = options.min ?? 4;
    const max = options.max ?? 4;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min || max > 4) return 'turnContract.options 范围必须是 0-4';
  }
  if (value.actionIntent !== undefined && typeof value.actionIntent !== 'boolean') return 'turnContract.actionIntent 必须是布尔值';
  return null;
}

const BUILTIN_WORLD_FAILURE_MODES = [
  { id: 'continue', label: '继续', description: '失败推进新的局面，保留玩家行动权。' },
  { id: 'injured', label: '重伤', description: '保留世界线，恢复少量 HP 并附加重伤状态。', hpRatio: 0.25, effect: '重伤' },
  { id: 'captured', label: '俘虏', description: '冲突失败后被控制，后续可通过行动脱困。', effect: '俘虏' },
  { id: 'resource-loss', label: '资源损失', description: '以资源代价继续故事。', resourceLoss: { gold: 10 } },
  { id: 'permadeath', label: '永久死亡', description: '当前世界线停止普通回合。', terminal: true },
  { id: 'card', label: '按卡定义', description: '由世界卡说明具体失败流程。', cardDefined: true },
];

function validateWorldFailure(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'failure 必须是对象';
  for (const key of ['defaultMode', 'onZeroHp', 'onConflictDefeat']) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || !isSafeId(value[key]))) return `failure.${key} 无效`;
  }
  if (value.modes !== undefined) {
    if (!Array.isArray(value.modes) || value.modes.length > 32) return 'failure.modes 最多 32 项';
    const ids = new Set();
    for (const mode of value.modes) {
      if (!mode || typeof mode !== 'object' || Array.isArray(mode) || !isSafeId(mode.id) || ids.has(mode.id)) return 'failure.modes 含有重复或无效 ID';
      if (!draftTextValid(mode.label, 120, true) || !draftTextValid(mode.description, 2000)) return `failure.modes.${mode.id} 文本无效`;
      if (mode.terminal !== undefined && typeof mode.terminal !== 'boolean') return `failure.modes.${mode.id}.terminal 无效`;
      if (mode.cardDefined !== undefined && typeof mode.cardDefined !== 'boolean') return `failure.modes.${mode.id}.cardDefined 无效`;
      if (mode.hpRatio !== undefined && !validBoundedNumber(mode.hpRatio, 0, 1)) return `failure.modes.${mode.id}.hpRatio 无效`;
      if (mode.effect !== undefined && !draftTextValid(mode.effect, 240)) return `failure.modes.${mode.id}.effect 无效`;
      if (mode.resourceLoss !== undefined) {
        if (!mode.resourceLoss || typeof mode.resourceLoss !== 'object' || Array.isArray(mode.resourceLoss) || Object.keys(mode.resourceLoss).length > 32) return `failure.modes.${mode.id}.resourceLoss 无效`;
        for (const [resourceId, loss] of Object.entries(mode.resourceLoss)) {
          if (!isSafeId(resourceId) || !validBoundedNumber(loss, 0, 1000000000000)) return `failure.modes.${mode.id}.resourceLoss 无效`;
        }
      }
      ids.add(mode.id);
    }
  }
  const configuredIds = new Set(Array.isArray(value.modes) ? value.modes.map(mode => mode?.id).filter(Boolean) : []);
  const allowed = new Set([...BUILTIN_WORLD_FAILURE_MODES.map(mode => mode.id), ...configuredIds]);
  for (const key of ['defaultMode', 'onZeroHp', 'onConflictDefeat']) if (value[key] !== undefined && !allowed.has(value[key])) return `failure.${key} 未声明对应模式`;
  return null;
}

function worldFailureRules(world) {
  const configured = world?.failure && typeof world.failure === 'object' && !Array.isArray(world.failure) ? world.failure : {};
  const modes = new Map(BUILTIN_WORLD_FAILURE_MODES.map(mode => [mode.id, cloneJson(mode)]));
  for (const mode of Array.isArray(configured.modes) ? configured.modes : []) {
    if (mode && isSafeId(mode.id)) modes.set(mode.id, { ...modes.get(mode.id), ...cloneJson(mode) });
  }
  const fallback = configured.defaultMode && modes.has(configured.defaultMode) ? configured.defaultMode : 'continue';
  return {
    defaultMode: fallback,
    onZeroHp: configured.onZeroHp && modes.has(configured.onZeroHp) ? configured.onZeroHp : fallback,
    onConflictDefeat: configured.onConflictDefeat && modes.has(configured.onConflictDefeat) ? configured.onConflictDefeat : fallback,
    modes,
  };
}

function failureStateMatches(currentState, payloadState) {
  if (currentState?.failure === undefined) return payloadState?.failure === undefined || payloadState?.failure === null;
  return payloadState?.failure === undefined || canonicalJson(payloadState.failure) === canonicalJson(currentState.failure);
}

function failureResourceFloor(world, id) {
  const resource = (playerCreationSchema(world)?.resources || []).find(item => item.id === id);
  if (resource) return Number.isFinite(resource.min) ? resource.min : 0;
  const currency = (playerEconomySchema(world)?.currencies || []).find(item => item.id === id);
  return currency && Number.isFinite(currency.min) ? currency.min : 0;
}

function applyFailureMode(world, state, mode, cause, revision) {
  const next = cloneJson(state);
  const maxHp = Number(next.stats?.maxHp ?? (playerCreationSchema(world)?.resources || []).find(item => item.id === 'hp')?.max);
  if (Number.isFinite(mode.hpRatio) && Number.isFinite(maxHp) && maxHp > 0) {
    const hp = Math.max(failureResourceFloor(world, 'hp'), Math.ceil(maxHp * mode.hpRatio));
    next.stats = { ...(next.stats || {}), hp };
    if (next.player?.resources && next.player.resources.hp !== undefined) next.player.resources.hp = hp;
  }
  if (mode.resourceLoss && typeof mode.resourceLoss === 'object') {
    for (const [id, loss] of Object.entries(mode.resourceLoss)) {
      const floor = failureResourceFloor(world, id);
      for (const bucket of [next.player?.resources, next.currencies, next.stats]) {
        if (bucket && Number.isFinite(Number(bucket[id]))) bucket[id] = Math.max(floor, Number(bucket[id]) - loss);
      }
    }
  }
  if (mode.effect) {
    const effects = Array.isArray(next.player?.effects) ? next.player.effects : [];
    if (!effects.includes(mode.effect)) next.player = { ...(next.player || {}), effects: [...effects, mode.effect].slice(-128) };
  }
  const status = mode.terminal ? 'terminal' : mode.id === 'continue' ? 'resolved' : 'active';
  next.failure = { mode: mode.id, status, cause, revision, label: mode.label, description: mode.description, recoverable: !mode.terminal };
  return { state: next, record: cloneJson(next.failure) };
}

function resolveWorldFailure(world, currentState, nextState, revision) {
  const rules = worldFailureRules(world);
  const currentHp = Number(currentState?.stats?.hp);
  const nextHp = Number(nextState?.stats?.hp);
  let cause = Number.isFinite(currentHp) && Number.isFinite(nextHp) && currentHp > 0 && nextHp <= 0 ? 'hp_zero' : null;
  if (!cause) {
    const previous = currentState?.conflicts && typeof currentState.conflicts === 'object' ? currentState.conflicts : {};
    const conflicts = nextState?.conflicts && typeof nextState.conflicts === 'object' ? nextState.conflicts : {};
    cause = Object.entries(conflicts).some(([id, state]) => state?.status === 'failed' && previous[id]?.status !== 'failed') ? 'conflict_defeat' : null;
  }
  if (!cause) return { state: nextState, record: null };
  const modeId = cause === 'hp_zero' ? rules.onZeroHp : rules.onConflictDefeat;
  const mode = rules.modes.get(modeId) || rules.modes.get(rules.defaultMode) || BUILTIN_WORLD_FAILURE_MODES[0];
  return applyFailureMode(world, nextState, mode, cause, revision);
}

const BUILTIN_WORLD_ENDINGS = [
  { id: 'player-choice', kind: 'player-choice', label: '玩家主动结束', description: '玩家确认后结束当前世界线，不要求唯一正确结局。', terminal: true },
];

function validateWorldEnding(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'ending 必须是对象';
  for (const key of ['enabled', 'allowPlayerEnd', 'requireConfirm']) if (value[key] !== undefined && typeof value[key] !== 'boolean') return `ending.${key} 必须是布尔值`;
  if (value.defaultEndingId !== undefined && (typeof value.defaultEndingId !== 'string' || !isSafeId(value.defaultEndingId))) return 'ending.defaultEndingId 无效';
  if (value.endings !== undefined) {
    if (!Array.isArray(value.endings) || value.endings.length > 32) return 'ending.endings 最多 32 项';
    const ids = new Set();
    for (const ending of value.endings) {
      if (!ending || typeof ending !== 'object' || Array.isArray(ending) || !isSafeId(ending.id) || ids.has(ending.id)) return 'ending.endings 含有重复或无效 ID';
      if (!draftTextValid(ending.label, 120, true) || !draftTextValid(ending.description, 2000)) return `ending.endings.${ending.id} 文本无效`;
      if (ending.kind !== undefined && !['player-choice', 'card-defined'].includes(ending.kind)) return `ending.endings.${ending.id}.kind 无效`;
      if (ending.terminal !== undefined && ending.terminal !== true) return `ending.endings.${ending.id}.terminal 必须为 true`;
      if (ending.condition !== undefined) {
        const condition = ending.condition;
        if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return `ending.endings.${ending.id}.condition 无效`;
        if (!['always', 'goals', 'leads', 'quests', 'conflicts', 'failure'].includes(condition.source)) return `ending.endings.${ending.id}.condition.source 无效`;
        if (condition.status !== undefined && (typeof condition.status !== 'string' || condition.status.length > 40 || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(condition.status))) return `ending.endings.${ending.id}.condition.status 无效`;
        if (condition.minCount !== undefined && (!Number.isInteger(condition.minCount) || condition.minCount < 1 || condition.minCount > 256)) return `ending.endings.${ending.id}.condition.minCount 无效`;
      }
      ids.add(ending.id);
    }
    const allowed = new Set([...BUILTIN_WORLD_ENDINGS.map(ending => ending.id), ...ids]);
    if (value.defaultEndingId !== undefined && !allowed.has(value.defaultEndingId)) return 'ending.defaultEndingId 未声明对应结局';
  }
  return null;
}

function worldEndingRules(world) {
  const configured = world?.ending && typeof world.ending === 'object' && !Array.isArray(world.ending) ? world.ending : {};
  const endings = new Map(BUILTIN_WORLD_ENDINGS.map(ending => [ending.id, cloneJson(ending)]));
  for (const ending of Array.isArray(configured.endings) ? configured.endings : []) {
    if (ending && isSafeId(ending.id)) endings.set(ending.id, { ...endings.get(ending.id), ...cloneJson(ending) });
  }
  const defaultEndingId = configured.defaultEndingId && endings.has(configured.defaultEndingId) ? configured.defaultEndingId : 'player-choice';
  return {
    enabled: configured.enabled !== false,
    allowPlayerEnd: configured.allowPlayerEnd !== false,
    requireConfirm: configured.requireConfirm !== false,
    defaultEndingId,
    endings,
  };
}

function endingStateMatches(currentState, payloadState) {
  if (currentState?.ending === undefined) return payloadState?.ending === undefined || payloadState?.ending === null;
  return payloadState?.ending === undefined || canonicalJson(payloadState.ending) === canonicalJson(currentState.ending);
}

function worldEndingConditionMet(ending, state) {
  const condition = ending?.condition;
  if (!condition || condition.source === 'always') return true;
  const values = condition.source === 'failure'
    ? (state?.failure ? [state.failure] : [])
    : condition.source === 'conflicts'
      ? Object.values(state?.conflicts && typeof state.conflicts === 'object' ? state.conflicts : {})
      : (Array.isArray(state?.[condition.source]) ? state[condition.source] : []);
  const matches = condition.status === undefined ? values : values.filter(value => value?.status === condition.status);
  return matches.length >= (Number.isInteger(condition.minCount) ? condition.minCount : 1);
}

function validateWorldEndRequest(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '请求必须是 JSON 对象';
  if (!Number.isInteger(payload.expectedRevision) || payload.expectedRevision < 0) return 'expectedRevision 必须是非负整数';
  if (typeof payload.commandId !== 'string' || !COMMAND_ID_RE.test(payload.commandId)) return 'commandId 无效';
  if (payload.confirm !== undefined && typeof payload.confirm !== 'boolean') return 'confirm 必须是布尔值';
  if (payload.endingId !== undefined && (typeof payload.endingId !== 'string' || !isSafeId(payload.endingId))) return 'endingId 无效';
  return null;
}

function worldTurnOptionRules(world) {
  const options = world?.turnContract?.options;
  return { min: Number.isInteger(options?.min) ? options.min : 4, max: Number.isInteger(options?.max) ? options.max : 4 };
}

function validateWorldTime(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'time 必须是对象';
  if (typeof value.unit !== 'string' || !value.unit.trim() || value.unit.length > 40) return 'time.unit 无效';
  for (const key of ['start', 'turnAdvance']) if (value[key] !== undefined && (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > 1000000)) return `time.${key} 无效`;
  if (value.turnAdvance !== undefined && value.turnAdvance <= 0) return 'time.turnAdvance 必须大于 0';
  return null;
}

const CONFLICT_TYPES = new Set(['combat', 'social', 'stealth', 'chase', 'custom']);
const CONFLICT_STATUSES = new Set(['active', 'resolved', 'fled', 'failed']);
const CONFLICT_OBJECTIVE_STATUSES = new Set(['active', 'done', 'failed']);
const DICE_EXPRESSION_RE = /^(\d*)d(\d+)([+-]\d+)?$/i;

function parseDiceExpression(expression) {
  const match = String(expression || '').trim().match(DICE_EXPRESSION_RE);
  if (!match) return { error: '骰子表达式无效' };
  const count = Math.min(Number(match[1] || 1), 100);
  const sides = Number(match[2]);
  const bonus = Number(match[3] || 0);
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(sides) || sides < 1 || sides > 1000000 || !Number.isInteger(bonus) || Math.abs(bonus) > 1000000) return { error: '骰子范围无效' };
  return { expr: String(expression).trim(), count, sides, bonus };
}

function validateCombatModifier(value, label) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return `${label} 必须是对象`;
  if (!['attributes', 'skills', 'resources'].includes(value.bucket) || !isSafeId(value.id)) return `${label}.bucket/id 无效`;
  if (value.factor !== undefined && (!Number.isFinite(value.factor) || Math.abs(value.factor) > 100)) return `${label}.factor 无效`;
  if (value.bonus !== undefined && (!Number.isFinite(value.bonus) || Math.abs(value.bonus) > 1000000)) return `${label}.bonus 无效`;
  return null;
}

function validateCombatCheck(value, label) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return `${label} 必须是对象`;
  const roll = parseDiceExpression(value.roll);
  if (roll.error) return `${label}.roll 无效`;
  if (!Number.isFinite(value.target) || value.target < -1000000 || value.target > 1000000) return `${label}.target 无效`;
  const modifierInvalid = validateCombatModifier(value.modifier, `${label}.modifier`);
  if (modifierInvalid) return modifierInvalid;
  if (value.damage !== undefined && value.damage !== null) {
    if (!value.damage || typeof value.damage !== 'object' || Array.isArray(value.damage)) return `${label}.damage 必须是对象`;
    const damageRoll = parseDiceExpression(value.damage.roll);
    if (damageRoll.error) return `${label}.damage.roll 无效`;
    const damageModifierInvalid = validateCombatModifier(value.damage.modifier, `${label}.damage.modifier`);
    if (damageModifierInvalid) return damageModifierInvalid;
  }
  return null;
}

function validateConflictTemplates(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > 32) return 'conflicts 最多 32 项';
  const ids = new Set();
  for (const conflict of value) {
    const id = typeof conflict?.id === 'string' ? conflict.id.trim() : '';
    const type = conflict?.type === undefined ? 'custom' : conflict.type;
    if (!isSafeId(id) || ids.has(id) || !draftTextValid(conflict.label, 200, true) || typeof type !== 'string' || !CONFLICT_TYPES.has(type)) return 'conflicts 含有重复或无效条目';
    if (conflict.description !== undefined && !draftTextValid(conflict.description, 4000)) return `conflicts.${id}.description 无效`;
    if (conflict.maxRounds !== undefined && (!Number.isInteger(conflict.maxRounds) || conflict.maxRounds < 1 || conflict.maxRounds > 1000000)) return `conflicts.${id}.maxRounds 无效`;
    const phases = conflict.phases === undefined ? [] : conflict.phases;
    if (!Array.isArray(phases) || phases.length > 32) return `conflicts.${id}.phases 无效`;
    const phaseIds = new Set();
    for (const phase of phases) {
      const phaseId = typeof phase?.id === 'string' ? phase.id.trim() : '';
      if (!isSafeId(phaseId) || phaseIds.has(phaseId) || !draftTextValid(phase.label, 120, true)) return `conflicts.${id}.phases 含有重复或无效条目`;
      phaseIds.add(phaseId);
    }
    const actions = conflict.actions === undefined ? [] : conflict.actions;
    if (!Array.isArray(actions) || actions.length > 64) return `conflicts.${id}.actions 无效`;
    const actionIds = new Set();
    for (const action of actions) {
      const actionId = typeof action?.id === 'string' ? action.id.trim() : '';
      if (!isSafeId(actionId) || actionIds.has(actionId) || !draftTextValid(action.label, 160, true)) return `conflicts.${id}.actions 含有重复或无效条目`;
      if (action.description !== undefined && !draftTextValid(action.description, 1000)) return `conflicts.${id}.actions.${actionId}.description 无效`;
      const checkInvalid = validateCombatCheck(action.check, `conflicts.${id}.actions.${actionId}.check`);
      if (checkInvalid) return checkInvalid;
      actionIds.add(actionId);
    }
    const outcomes = conflict.outcomes === undefined ? [] : conflict.outcomes;
    if (!Array.isArray(outcomes) || outcomes.length > 16) return `conflicts.${id}.outcomes 无效`;
    const outcomeIds = new Set();
    for (const outcome of outcomes) {
      const outcomeId = typeof outcome?.id === 'string' ? outcome.id.trim() : '';
      if (!isSafeId(outcomeId) || outcomeIds.has(outcomeId) || !draftTextValid(outcome.label, 160, true)) return `conflicts.${id}.outcomes 含有重复或无效条目`;
      if (outcome.consequences !== undefined && !draftStringListValid(outcome.consequences, 16, 1000)) return `conflicts.${id}.outcomes.${outcomeId}.consequences 无效`;
      outcomeIds.add(outcomeId);
    }
    ids.add(id);
  }
  return null;
}

function worldConflictDefinitions(world) {
  return Array.isArray(world?.conflicts) ? world.conflicts : [];
}

function validateConflictStates(world, value, current = null) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'state.conflicts 必须是对象';
  if (Object.keys(value).length > 64) return 'state.conflicts 最多 64 项';
  const definitions = new Map(worldConflictDefinitions(world).map(conflict => [conflict.id, conflict]));
  if (!definitions.size && Object.keys(value).length) return 'state.conflicts 包含未声明的冲突模板';
  if (current && typeof current === 'object') {
    for (const id of Object.keys(current)) if (value[id] === undefined) return `state.conflicts.${id} 不能省略`;
  }
  for (const [id, state] of Object.entries(value)) {
    if (!isSafeId(id) || !state || typeof state !== 'object' || Array.isArray(state)) return `state.conflicts.${id} 无效`;
    if (state.id !== undefined && state.id !== id) return `state.conflicts.${id}.id 必须与键一致`;
    const templateId = typeof state.templateId === 'string' ? state.templateId : '';
    const definition = definitions.get(templateId);
    if (!definition) return `state.conflicts.${id}.templateId 未声明`;
    const status = state.status === undefined ? 'active' : state.status;
    if (!CONFLICT_STATUSES.has(status)) return `state.conflicts.${id}.status 无效`;
    if (state.type !== undefined && (!CONFLICT_TYPES.has(state.type) || state.type !== (definition.type || 'custom'))) return `state.conflicts.${id}.type 无效`;
    const phases = Array.isArray(definition.phases) ? definition.phases : [];
    const phaseIds = new Set(phases.map(phase => phase.id));
    if (state.phase !== undefined && state.phase !== null && (!isSafeId(state.phase) || (phaseIds.size && !phaseIds.has(state.phase)))) return `state.conflicts.${id}.phase 无效`;
    const round = state.round === undefined ? 1 : state.round;
    if (!Number.isInteger(round) || round < 1 || round > 1000000 || (definition.maxRounds !== undefined && round > definition.maxRounds)) return `state.conflicts.${id}.round 无效`;
    const actions = new Set((Array.isArray(definition.actions) ? definition.actions : []).map(action => action.id));
    if (state.actionId !== undefined && state.actionId !== null && (!isSafeId(state.actionId) || (actions.size && !actions.has(state.actionId)))) return `state.conflicts.${id}.actionId 无效`;
    if (state.availableActions !== undefined && (!Array.isArray(state.availableActions) || state.availableActions.length > 64 || state.availableActions.some(actionId => !isSafeId(actionId) || (actions.size && !actions.has(actionId))))) return `state.conflicts.${id}.availableActions 无效`;
    let participantIds = new Set();
    if (state.participants !== undefined) {
      if (!Array.isArray(state.participants) || state.participants.length > 64) return `state.conflicts.${id}.participants 无效`;
      for (const participant of state.participants) {
        const participantId = typeof participant === 'string' ? participant : participant?.id;
        if (!isSafeId(participantId) || participantIds.has(participantId)) return `state.conflicts.${id}.participants 含有重复或无效 ID`;
        if (typeof participant === 'object' && participant !== null) {
          if (participant.role !== undefined && (typeof participant.role !== 'string' || participant.role.length > 120)) return `state.conflicts.${id}.participants.role 无效`;
          if (participant.status !== undefined && (typeof participant.status !== 'string' || participant.status.length > 120)) return `state.conflicts.${id}.participants.status 无效`;
          if (participant.maxHp !== undefined && (!Number.isFinite(participant.maxHp) || participant.maxHp < 1 || participant.maxHp > 1000000000)) return `state.conflicts.${id}.participants.maxHp 无效`;
          if (participant.hp !== undefined && (!Number.isFinite(participant.hp) || participant.hp < 0 || participant.hp > 1000000000 || (participant.maxHp !== undefined && participant.hp > participant.maxHp))) return `state.conflicts.${id}.participants.hp 无效`;
          if (participant.defense !== undefined && (!Number.isFinite(participant.defense) || participant.defense < -1000000 || participant.defense > 1000000)) return `state.conflicts.${id}.participants.defense 无效`;
        }
        participantIds.add(participantId);
      }
    }
    if (state.targetId !== undefined && state.targetId !== null && (!isSafeId(state.targetId) || (participantIds.size && !participantIds.has(state.targetId)))) return `state.conflicts.${id}.targetId 无效`;
    if (state.objectives !== undefined) {
      if (!Array.isArray(state.objectives) || state.objectives.length > 64) return `state.conflicts.${id}.objectives 无效`;
      const objectiveIds = new Set();
      for (const objective of state.objectives) {
        const objectiveId = typeof objective?.id === 'string' ? objective.id : '';
        if (!isSafeId(objectiveId) || objectiveIds.has(objectiveId) || !draftTextValid(objective.title, 240, true)) return `state.conflicts.${id}.objectives 含有重复或无效条目`;
        if (objective.status !== undefined && !CONFLICT_OBJECTIVE_STATUSES.has(objective.status)) return `state.conflicts.${id}.objectives.${objectiveId}.status 无效`;
        if (objective.desc !== undefined && !draftTextValid(objective.desc, 2000)) return `state.conflicts.${id}.objectives.${objectiveId}.desc 无效`;
        objectiveIds.add(objectiveId);
      }
    }
    const outcomes = new Set((Array.isArray(definition.outcomes) ? definition.outcomes : []).map(outcome => outcome.id));
    if (state.outcome !== undefined && state.outcome !== null && (!isSafeId(state.outcome) || (outcomes.size && !outcomes.has(state.outcome)))) return `state.conflicts.${id}.outcome 无效`;
    if (status !== 'active' && outcomes.size && !state.outcome) return `state.conflicts.${id}.outcome 结束时不能为空`;
    if (state.consequences !== undefined && !draftStringListValid(state.consequences, 16, 1000)) return `state.conflicts.${id}.consequences 无效`;
    if (status === 'active' && Array.isArray(state.consequences) && state.consequences.length) return `state.conflicts.${id}.active 不能写入结束后果`;
    const previous = current && typeof current === 'object' ? current[id] : null;
    if (!previous && status !== 'active') return `state.conflicts.${id} 必须先以 active 开始`;
    if (previous && typeof previous === 'object') {
      if (previous.status !== 'active' && canonicalJson(state) !== canonicalJson(previous)) return `state.conflicts.${id} 已结束，不能重新修改`;
      if (previous.templateId !== templateId) return `state.conflicts.${id}.templateId 不能改变`;
      if (round < Number(previous.round || 1) || round > Number(previous.round || 1) + 1) return `state.conflicts.${id}.round 只能推进一轮`;
      if (previous.status === 'active' && status === 'active' && state.outcome) return `state.conflicts.${id}.active 状态不能写入结束结果`;
      if (Array.isArray(previous.participants) && Array.isArray(state.participants)) {
        const previousParticipants = new Map(previous.participants.map(item => [typeof item === 'string' ? item : item?.id, item]));
        for (const participant of state.participants) {
          const participantId = typeof participant === 'string' ? participant : participant?.id;
          const before = previousParticipants.get(participantId);
          if (!before || typeof participant !== 'object' || typeof before !== 'object') continue;
          for (const key of ['hp', 'maxHp', 'defense']) {
            if (before[key] !== undefined && (participant[key] === undefined || participant[key] !== before[key])) return `state.conflicts.${id}.participants.${participantId}.${key} 由服务端结算`;
          }
        }
      }
    }
  }
  return null;
}

function conflictTransitionRecords(previous, next, commandId, revision) {
  const before = previous && typeof previous === 'object' ? previous : {};
  const after = next && typeof next === 'object' ? next : {};
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  const transitions = [];
  for (const id of ids) {
    const from = before[id];
    const to = after[id];
    if (!to || canonicalJson(from) === canonicalJson(to)) continue;
    const fromStatus = from?.status || null;
    const toStatus = to.status || 'active';
    transitions.push({ id, op: !from ? 'start' : toStatus === 'active' ? 'advance' : 'end', fromStatus, toStatus, round: to.round || 1, actionId: to.actionId || null, outcome: to.outcome || null, commandId, revision });
  }
  return transitions.slice(0, 64);
}

function materializeConflictOutcomes(world, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const definitions = new Map(worldConflictDefinitions(world).map(conflict => [conflict.id, conflict]));
  const next = cloneJson(value);
  for (const state of Object.values(next)) {
    if (!state || state.status === 'active' || !state.outcome) continue;
    const outcome = definitions.get(state.templateId)?.outcomes?.find(item => item.id === state.outcome);
    if (outcome && Array.isArray(outcome.consequences)) state.consequences = cloneJson(outcome.consequences);
  }
  return next;
}

function combatModifierValue(source, rule) {
  if (!rule) return 0;
  const raw = Number(source?.[rule.bucket]?.[rule.id]);
  const factor = Number.isFinite(rule.factor) ? rule.factor : 1;
  const bonus = Number.isFinite(rule.bonus) ? rule.bonus : 0;
  return (Number.isFinite(raw) ? raw : 0) * factor + bonus;
}

function resolveCombatChecks(world, currentState, nextState, commandId, revision) {
  const currentConflicts = currentState?.conflicts && typeof currentState.conflicts === 'object' ? currentState.conflicts : {};
  const nextConflicts = nextState?.conflicts && typeof nextState.conflicts === 'object' ? nextState.conflicts : {};
  const definitions = new Map(worldConflictDefinitions(world).map(conflict => [conflict.id, conflict]));
  const checks = [];
  for (const [id, state] of Object.entries(nextConflicts)) {
    const previous = currentConflicts[id];
    if (!previous || previous.status !== 'active' || state?.status !== 'active' || Number(state.round || 1) <= Number(previous.round || 1)) continue;
    const definition = definitions.get(state.templateId);
    if ((definition?.type || 'custom') !== 'combat') continue;
    const action = (Array.isArray(definition.actions) ? definition.actions : []).find(item => item.id === state.actionId);
    const check = action?.check;
    if (!check) continue;
    const targetId = state.targetId || previous.targetId;
    if (!targetId) return { error: `state.conflicts.${id}.targetId 必须指定攻击目标` };
    const previousParticipants = Array.isArray(previous.participants) ? previous.participants : [];
    const participants = Array.isArray(state.participants) ? state.participants : cloneJson(previousParticipants);
    const previousMap = new Map(previousParticipants.map(item => [typeof item === 'string' ? item : item?.id, item]));
    const target = participants.find(item => (typeof item === 'string' ? item : item?.id) === targetId);
    const previousTarget = previousMap.get(targetId);
    if (!target || typeof target !== 'object' || !previousTarget || typeof previousTarget !== 'object') return { error: `state.conflicts.${id}.targetId 必须引用带战斗数值的参与者` };
    for (const participant of participants) {
      const participantId = participant?.id;
      const before = previousMap.get(participantId);
      if (!before || typeof before !== 'object') continue;
      for (const key of ['hp', 'maxHp', 'defense']) {
        if (participant[key] !== undefined && before[key] !== undefined && participant[key] !== before[key]) return { error: `state.conflicts.${id}.participants.${participantId}.${key} 由服务端结算` };
      }
    }
    const maxHp = Number(previousTarget.maxHp);
    const hp = Number(previousTarget.hp);
    if (!Number.isFinite(maxHp) || !Number.isFinite(hp)) return { error: `state.conflicts.${id}.targetId 缺少 hp/maxHp` };
    const attackRoll = rollDiceExpression(check.roll);
    if (attackRoll.error) return { error: `conflicts.${state.templateId}.actions.${state.actionId}.check.roll 无效` };
    const attackModifier = combatModifierValue(currentState?.player, check.modifier);
    const attackTotal = attackRoll.total + attackModifier;
    const defense = Number.isFinite(Number(previousTarget.defense)) ? Number(previousTarget.defense) : Number(check.target);
    const targetValue = Number.isFinite(defense) ? defense : Number(check.target);
    const hit = attackTotal >= targetValue;
    let damage = null;
    let damageAmount = 0;
    if (hit && check.damage) {
      const damageRoll = rollDiceExpression(check.damage.roll);
      if (damageRoll.error) return { error: `conflicts.${state.templateId}.actions.${state.actionId}.check.damage.roll 无效` };
      const damageModifier = combatModifierValue(currentState?.player, check.damage.modifier);
      damageAmount = Math.max(0, damageRoll.total + damageModifier);
      damage = { ...damageRoll, modifier: damageModifier, amount: damageAmount };
    }
    const nextHp = Math.max(0, Math.min(maxHp, hp - damageAmount));
    state.targetId = targetId;
    state.participants = participants.map(participant => participant?.id === targetId ? { ...participant, hp: nextHp, maxHp } : participant);
    checks.push({
      conflictId: id,
      actionId: state.actionId,
      targetId,
      round: Number(state.round || 1),
      attack: { ...attackRoll, modifier: attackModifier, total: attackTotal, target: targetValue, defense, hit },
      damage,
      commandId,
      revision,
    });
  }
  return { checks };
}

function resolveNonCombatChecks(world, currentState, nextState, commandId, revision) {
  const currentConflicts = currentState?.conflicts && typeof currentState.conflicts === 'object' ? currentState.conflicts : {};
  const nextConflicts = nextState?.conflicts && typeof nextState.conflicts === 'object' ? nextState.conflicts : {};
  const definitions = new Map(worldConflictDefinitions(world).map(conflict => [conflict.id, conflict]));
  const checks = [];
  for (const [id, state] of Object.entries(nextConflicts)) {
    const previous = currentConflicts[id];
    if (!previous || previous.status !== 'active' || state?.status !== 'active' || Number(state.round || 1) <= Number(previous.round || 1)) continue;
    const definition = definitions.get(state.templateId);
    if (!['social', 'stealth'].includes(definition?.type)) continue;
    const action = (Array.isArray(definition.actions) ? definition.actions : []).find(item => item.id === state.actionId);
    const check = action?.check;
    if (!check) continue;
    const roll = rollDiceExpression(check.roll);
    if (roll.error) return { error: `conflicts.${state.templateId}.actions.${state.actionId}.check.roll 无效` };
    const modifier = combatModifierValue(currentState?.player, check.modifier);
    const total = roll.total + modifier;
    const target = Number(check.target);
    const success = total >= target;
    checks.push({
      conflictId: id,
      type: definition.type,
      actionId: state.actionId,
      round: Number(state.round || 1),
      check: { ...roll, modifier, total, target, success },
      commandId,
      revision,
    });
  }
  return { checks };
}

function validateWorldEvents(value, world = null) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > 256) return 'events 最多 256 项';
  const ids = new Set();
  const locationIds = world ? worldLocationIds(world) : null;
  for (const event of value) {
    const id = typeof event?.id === 'string' ? event.id.trim() : '';
    if (!isSafeId(id) || ids.has(id)) return 'events 含有重复或无效 ID';
    if (!draftTextValid(event.title, 200, true) || !draftTextValid(event.description ?? '', 4000)) return `events.${id} 文本无效`;
    const trigger = event.trigger;
    if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) return `events.${id}.trigger 必须是对象`;
    const hasAt = trigger.at !== undefined;
    const hasAfterTurns = trigger.afterTurns !== undefined;
    const hasLocation = trigger.locationId !== undefined && trigger.locationId !== null;
    if (!hasAt && !hasAfterTurns && !hasLocation) return `events.${id}.trigger 至少声明一个条件`;
    if (hasAt && (!Number.isFinite(trigger.at) || trigger.at < 0 || trigger.at > 1000000000)) return `events.${id}.trigger.at 无效`;
    if (hasAfterTurns && (!Number.isInteger(trigger.afterTurns) || trigger.afterTurns < 1 || trigger.afterTurns > 1000000)) return `events.${id}.trigger.afterTurns 无效`;
    if (hasLocation && (!isSafeId(trigger.locationId) || (locationIds && !locationIds.has(trigger.locationId)))) return `events.${id}.trigger.locationId 必须引用已登记地点`;
    if (event.visibility !== undefined && !['public', 'local', 'hidden'].includes(event.visibility)) return `events.${id}.visibility 无效`;
    if (event.once !== undefined && event.once !== true) return `events.${id}.once 目前必须为 true`;
    if (event.tags !== undefined && !draftStringListValid(event.tags, 32, 120)) return `events.${id}.tags 无效`;
    if (event.consequences !== undefined && !draftStringListValid(event.consequences, 16, 1000)) return `events.${id}.consequences 无效`;
    ids.add(id);
  }
  return null;
}

function validateWorldEventLog(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > 256) return 'state.worldEvents 最多 256 项';
  const ids = new Set();
  for (const event of value) {
    const id = typeof event?.eventId === 'string' ? event.eventId.trim() : '';
    if (!isSafeId(id) || ids.has(id)) return 'state.worldEvents 含有重复或无效 eventId';
    if (!draftTextValid(event.title, 200, true) || !draftTextValid(event.description ?? '', 4000)) return `state.worldEvents.${id} 文本无效`;
    if (event.visibility !== undefined && !['public', 'local', 'hidden'].includes(event.visibility)) return `state.worldEvents.${id}.visibility 无效`;
    if (event.locationId !== undefined && event.locationId !== null && !isSafeId(event.locationId)) return `state.worldEvents.${id}.locationId 无效`;
    if (event.time !== undefined && (!event.time || typeof event.time !== 'object' || Array.isArray(event.time) || typeof event.time.unit !== 'string' || !Number.isFinite(event.time.value))) return `state.worldEvents.${id}.time 无效`;
    if (event.consequences !== undefined && !draftStringListValid(event.consequences, 16, 1000)) return `state.worldEvents.${id}.consequences 无效`;
    if (event.commandId !== undefined && (typeof event.commandId !== 'string' || !COMMAND_ID_RE.test(event.commandId))) return `state.worldEvents.${id}.commandId 无效`;
    if (event.revision !== undefined && (!Number.isInteger(event.revision) || event.revision < 0)) return `state.worldEvents.${id}.revision 无效`;
    ids.add(id);
  }
  return null;
}

function validateEventLedger(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > EVENT_LEDGER_MAX) return `eventLedger 最多 ${EVENT_LEDGER_MAX} 项`;
  const ids = new Set();
  const kinds = new Set(['opening', 'turn', 'growth', 'ending', 'world-version-upgrade', 'migration']);
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return 'eventLedger 含有无效记录';
    const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
    if (!isSafeId(id) || ids.has(id)) return 'eventLedger 含有重复或无效 ID';
    if (!kinds.has(entry.kind)) return `eventLedger.${id}.kind 无效`;
    if (typeof entry.commandId !== 'string' || !COMMAND_ID_RE.test(entry.commandId)) return `eventLedger.${id}.commandId 无效`;
    if (!Number.isInteger(entry.sourceRevision) || entry.sourceRevision < 0) return `eventLedger.${id}.sourceRevision 无效`;
    if (entry.revision !== undefined && (!Number.isInteger(entry.revision) || entry.revision !== entry.sourceRevision)) return `eventLedger.${id}.revision 无效`;
    if (entry.locationId !== undefined && entry.locationId !== null && !isSafeId(entry.locationId)) return `eventLedger.${id}.locationId 无效`;
    if (entry.time !== undefined && entry.time !== null && (!entry.time || typeof entry.time !== 'object' || Array.isArray(entry.time) || typeof entry.time.unit !== 'string' || !Number.isFinite(entry.time.value))) return `eventLedger.${id}.time 无效`;
    for (const key of ['turnIds', 'worldEventIds', 'factionActionIds', 'deadlineIds']) {
      if (entry[key] !== undefined && (!Array.isArray(entry[key]) || entry[key].length > 64 || entry[key].some(item => typeof item !== 'string' || item.length > 160))) return `eventLedger.${id}.${key} 无效`;
    }
    for (const key of ['growthApplicationId', 'migrationId', 'endingId']) {
      if (entry[key] !== undefined && entry[key] !== null && !isSafeId(entry[key])) return `eventLedger.${id}.${key} 无效`;
    }
    if (entry.createdAt !== undefined && (!Number.isFinite(entry.createdAt) || entry.createdAt < 0)) return `eventLedger.${id}.createdAt 无效`;
    ids.add(id);
  }
  return null;
}

function validateEventMemoryCandidates(value, world = null) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > 8) return 'eventMemory 每回合最多 8 项';
  const locationIds = world ? worldLocationIds(world) : null;
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return `eventMemory[${index}] 无效`;
    if (!draftTextValid(item.summary, 2000, true)) return `eventMemory[${index}].summary 无效`;
    if (item.entityIds !== undefined && (!Array.isArray(item.entityIds) || item.entityIds.length > 32 || item.entityIds.some(id => !isSafeId(id)))) return `eventMemory[${index}].entityIds 无效`;
    if (item.locationId !== undefined && item.locationId !== null && (!isSafeId(item.locationId) || (locationIds && !locationIds.has(item.locationId)))) return `eventMemory[${index}].locationId 无效`;
    if (item.time !== undefined && item.time !== null && (!item.time || typeof item.time !== 'object' || Array.isArray(item.time) || typeof item.time.unit !== 'string' || !item.time.unit.trim() || item.time.unit.length > 40 || !Number.isFinite(item.time.value) || item.time.value < 0 || item.time.value > 1000000000)) return `eventMemory[${index}].time 无效`;
    if (item.visibility !== undefined && !['public', 'local', 'hidden'].includes(item.visibility)) return `eventMemory[${index}].visibility 无效`;
  }
  return null;
}

function validateEventMemory(value, world = null, current = null) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > EVENT_MEMORY_MAX) return `eventMemory 最多 ${EVENT_MEMORY_MAX} 项`;
  const ids = new Set();
  const locationIds = world ? worldLocationIds(world) : null;
  for (const item of value) {
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    if (!isSafeId(id) || ids.has(id)) return 'eventMemory 含有重复或无效 ID';
    if (!['event', 'fact', 'relationship'].includes(item.kind)) return `eventMemory.${id}.kind 无效`;
    if (!draftTextValid(item.summary, 2000, true)) return `eventMemory.${id}.summary 无效`;
    if (!Array.isArray(item.entityIds) || item.entityIds.length > 32 || item.entityIds.some(entityId => !isSafeId(entityId))) return `eventMemory.${id}.entityIds 无效`;
    if (item.locationId !== null && item.locationId !== undefined && (!isSafeId(item.locationId) || (locationIds && !locationIds.has(item.locationId)))) return `eventMemory.${id}.locationId 无效`;
    if (!item.time || typeof item.time !== 'object' || Array.isArray(item.time) || typeof item.time.unit !== 'string' || !item.time.unit.trim() || item.time.unit.length > 40 || !Number.isFinite(item.time.value) || item.time.value < 0 || item.time.value > 1000000000) return `eventMemory.${id}.time 无效`;
    if (!Number.isInteger(item.sourceRevision) || item.sourceRevision < 0) return `eventMemory.${id}.sourceRevision 无效`;
    if (!Array.isArray(item.sourceTurnIds) || !item.sourceTurnIds.length || item.sourceTurnIds.length > 32 || item.sourceTurnIds.some(turnId => typeof turnId !== 'string' || !turnId.trim() || turnId.length > 160)) return `eventMemory.${id}.sourceTurnIds 无效`;
    if (!Array.isArray(item.sourceEventIds) || item.sourceEventIds.length > 64 || item.sourceEventIds.some(eventId => typeof eventId !== 'string' || !eventId.trim() || eventId.length > 160)) return `eventMemory.${id}.sourceEventIds 无效`;
    if (!['public', 'local', 'hidden'].includes(item.visibility)) return `eventMemory.${id}.visibility 无效`;
    if (!Number.isFinite(item.createdAt) || item.createdAt < 0) return `eventMemory.${id}.createdAt 无效`;
    ids.add(id);
  }
  if (current && Array.isArray(current)) {
    for (const previous of current) {
      const next = value.find(item => item?.id === previous?.id);
      if (!next || canonicalJson(next) !== canonicalJson(previous)) return `eventMemory.${previous?.id || 'unknown'} 只能追加，不能改写`;
    }
  }
  return null;
}

function memoryEventId(saveId, revision, index) {
  const hash = crypto.createHash('sha256').update(`${saveId}:${revision}:${index}`).digest('hex').slice(0, 24);
  return `memory-${revision}-${index}-${hash}`;
}

function committedTurnId(saveId, revision, index) {
  const hash = crypto.createHash('sha256').update(`${saveId}:turn:${revision}:${index}`).digest('hex').slice(0, 24);
  return `turn-${revision}-${index}-${hash}`;
}

function appendEventMemory(save, candidates, { world, revision, turns, eventIds, time, locationId }) {
  if (!Array.isArray(candidates) || !candidates.length) return Array.isArray(save.eventMemory) ? save.eventMemory : [];
  const sourceTurnIds = turns.map(turn => turn.id).filter(id => typeof id === 'string' && id.trim());
  const sourceEventIds = [...new Set(eventIds.filter(id => typeof id === 'string' && id.trim()))];
  const entries = candidates.map((item, index) => ({
    id: memoryEventId(save.id, revision, index),
    kind: 'event',
    summary: item.summary.trim(),
    entityIds: Array.isArray(item.entityIds) ? [...new Set(item.entityIds)] : [],
    locationId: locationId ?? null,
    time: time ? cloneJson(time) : { unit: 'turn', value: revision },
    sourceRevision: revision,
    sourceTurnIds: [...sourceTurnIds],
    sourceEventIds: [...sourceEventIds],
    visibility: item.visibility || 'public',
    createdAt: Date.now(),
  }));
  const next = [...(Array.isArray(save.eventMemory) ? save.eventMemory : []), ...entries].slice(-EVENT_MEMORY_MAX);
  const invalid = validateEventMemory(next, world);
  if (invalid) throw new Error(invalid);
  return next;
}

function rebuiltMemoryId(saveId, kind, sourceId) {
  const hash = crypto.createHash('sha256').update(`${saveId}:memory-rebuild:${kind}:${sourceId}`).digest('hex').slice(0, 24);
  return `memory-rebuild-${kind}-${hash}`;
}

function memorySourceTurnIds(entry, kind, sourceId) {
  const turnIds = Array.isArray(entry?.turnIds) ? entry.turnIds.filter(id => typeof id === 'string' && id.trim()) : [];
  return turnIds.length ? [...new Set(turnIds)] : [`source-${kind}-${sourceId}`];
}

function memorySourceTime(event, entry, sourceRevision) {
  const time = event?.time || entry?.time;
  return time && typeof time === 'object' && !Array.isArray(time) && typeof time.unit === 'string' && time.unit.trim() && time.unit.length <= 40 && Number.isFinite(time.value) && time.value >= 0 && time.value <= 1000000000
    ? cloneJson(time)
    : { unit: 'turn', value: sourceRevision };
}

function rebuildWorldEventMemory(save, world) {
  const state = save?.state && typeof save.state === 'object' ? save.state : {};
  const ledger = Array.isArray(save?.eventLedger) ? save.eventLedger : [];
  const eventLedger = new Map();
  for (const entry of ledger) {
    for (const eventId of Array.isArray(entry?.worldEventIds) ? entry.worldEventIds : []) eventLedger.set(eventId, entry);
  }
  const growthLedger = new Map(ledger.filter(entry => entry?.growthApplicationId).map(entry => [entry.growthApplicationId, entry]));
  const locationIds = worldLocationIds(world);
  const entries = [];
  for (const event of Array.isArray(state.worldEvents) ? state.worldEvents : []) {
    if (!event || typeof event.eventId !== 'string' || !event.eventId.trim()) continue;
    const source = eventLedger.get(event.eventId);
    const sourceRevision = Number.isInteger(event.revision) ? event.revision : (Number.isInteger(source?.sourceRevision) ? source.sourceRevision : 0);
    const consequences = Array.isArray(event.consequences) && event.consequences.length ? `；后果：${event.consequences.join('；')}` : '';
    const summary = `${String(event.title || event.eventId).trim()}：${String(event.description || '事件已提交').trim()}${consequences}`.slice(0, 2000);
    const locationId = locationIds.has(event.locationId) ? event.locationId : (locationIds.has(source?.locationId) ? source.locationId : null);
    const entityIds = isSafeId(event.factionId) ? [event.factionId] : [];
    entries.push({
      id: rebuiltMemoryId(save.id, 'event', event.eventId), kind: 'event', summary,
      entityIds, locationId, time: memorySourceTime(event, source, sourceRevision), sourceRevision,
      sourceTurnIds: memorySourceTurnIds(source, 'event', event.eventId), sourceEventIds: [event.eventId],
      visibility: ['public', 'local', 'hidden'].includes(event.visibility) ? event.visibility : 'public',
      createdAt: Number.isFinite(event.createdAt) ? event.createdAt : sourceRevision,
    });
  }
  const experiences = Array.isArray(state.experiences) ? state.experiences : [];
  const experienceById = new Map(experiences.filter(item => item?.id).map(item => [item.id, item]));
  for (const application of Array.isArray(state.growthApplications) ? state.growthApplications : []) {
    if (!application || typeof application.id !== 'string' || !application.id.trim()) continue;
    const source = growthLedger.get(application.id);
    const experience = application.experienceId ? experienceById.get(application.experienceId) : null;
    const sourceRevision = Number.isInteger(application.revision) ? application.revision : (Number.isInteger(source?.sourceRevision) ? source.sourceRevision : 0);
    const summary = `${experience?.title || application.candidateId || '成长记录'}：${experience?.summary || `已${application.decision === 'accepted' ? '接受' : '处理'}成长候选`}`.slice(0, 2000);
    const locationId = locationIds.has(experience?.locationId) ? experience.locationId : (locationIds.has(source?.locationId) ? source.locationId : null);
    entries.push({
      id: rebuiltMemoryId(save.id, 'growth', application.id), kind: 'fact', summary,
      entityIds: [], locationId, time: memorySourceTime(experience, source, sourceRevision), sourceRevision,
      sourceTurnIds: memorySourceTurnIds(source, 'growth', application.id), sourceEventIds: [],
      visibility: 'public', createdAt: Number.isFinite(application.appliedAt) ? application.appliedAt : sourceRevision,
    });
  }
  const next = entries.sort((a, b) => a.sourceRevision - b.sourceRevision || a.id.localeCompare(b.id)).slice(-EVENT_MEMORY_MAX);
  const invalid = validateEventMemory(next, world);
  if (invalid) throw new Error(invalid);
  return { entries: next, sourceHash: sha256Json({ eventLedger: ledger, worldEvents: state.worldEvents || [], growthApplications: state.growthApplications || [], experiences: state.experiences || [] }) };
}

function memoryDebugView(item) {
  if (!item || typeof item !== 'object') return null;
  if (item.visibility === 'hidden') {
    return { id: item.id, kind: item.kind, visibility: 'hidden', summary: '（隐藏记忆内容已省略）' };
  }
  return { ...item };
}

function worldMemoryDiagnostics(save, world) {
  const memories = Array.isArray(save?.eventMemory) ? save.eventMemory : [];
  const currentLocationId = save?.state?.locationId || null;
  const visible = memories.filter(item => item && item.visibility !== 'hidden');
  const local = visible.filter(item => item.visibility === 'local');
  const current = visible.filter(item => item.visibility !== 'local' || !item.locationId || item.locationId === currentLocationId);
  const rebuilt = rebuildWorldEventMemory(save, world);
  return {
    saveId: save.id, worldId: save.worldId, worldVersion: save.worldVersion, revision: save.revision,
    locationId: currentLocationId,
    memory: { total: memories.length, visible: visible.length, hidden: memories.length - visible.length, local: local.length, currentVisible: current.length },
    sources: {
      eventLedger: Array.isArray(save.eventLedger) ? save.eventLedger.length : 0,
      worldEvents: Array.isArray(save.state?.worldEvents) ? save.state.worldEvents.length : 0,
      growthApplications: Array.isArray(save.state?.growthApplications) ? save.state.growthApplications.length : 0,
      experiences: Array.isArray(save.state?.experiences) ? save.state.experiences.length : 0,
    },
    rebuild: {
      sourceHash: rebuilt.sourceHash, entryCount: rebuilt.entries.length,
      hiddenEntryCount: rebuilt.entries.filter(item => item.visibility === 'hidden').length,
      entries: rebuilt.entries.slice(-32).map(memoryDebugView), truncated: rebuilt.entries.length > 32,
    },
    lastRebuild: save.memoryRebuild || null,
  };
}

async function handleWorldMemoryDiagnostics(req, res, saveId) {
  const fp = savePath(saveId);
  if (!fp) return send(res, 400, JSON.stringify({ error: '无效的 saveId' }), 'application/json');
  try {
    const save = JSON.parse(await fs.promises.readFile(fp, 'utf-8'));
    const world = findWorldVersion(await loadWorlds(), save.worldId, save.worldVersion);
    if (!world) return send(res, 409, JSON.stringify({ error: '存档绑定的世界版本不存在' }), 'application/json');
    send(res, 200, JSON.stringify(worldMemoryDiagnostics(save, world)), 'application/json; charset=utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return send(res, 404, JSON.stringify({ error: '存档不存在' }), 'application/json');
    console.error('[world-saves] 记忆诊断失败:', err.message);
    send(res, 500, JSON.stringify({ error: '记忆诊断失败: ' + err.message }), 'application/json');
  }
}

async function handleWorldMemoryRebuild(req, res, saveId) {
  const fp = savePath(saveId);
  if (!fp) return send(res, 400, JSON.stringify({ error: '无效的 saveId' }), 'application/json');
  let payload;
  try { payload = await readJsonBody(req, 64 * 1024); }
  catch (err) { return send(res, err.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, JSON.stringify({ error: err.message }), 'application/json'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return send(res, 400, JSON.stringify({ error: '请求必须是 JSON 对象' }), 'application/json');
  if (!Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0) return send(res, 400, JSON.stringify({ error: 'expectedRevision 必须是非负整数' }), 'application/json');
  if (typeof payload.commandId !== 'string' || !COMMAND_ID_RE.test(payload.commandId)) return send(res, 400, JSON.stringify({ error: 'commandId 无效' }), 'application/json');
  return withWorldSaveLock(saveId, async () => {
    try {
      const current = JSON.parse(await fs.promises.readFile(fp, 'utf-8'));
      if (!current || current.id !== saveId) throw new Error('存档文件 ID 不一致');
      if (current.memoryRebuild?.commandId === payload.commandId) {
        const world = findWorldVersion(await loadWorlds(), current.worldId, current.worldVersion);
        return send(res, 200, JSON.stringify({ save: current, diagnostics: worldMemoryDiagnostics(current, world), idempotent: true }), 'application/json; charset=utf-8');
      }
      if (current.revision !== payload.expectedRevision) return send(res, 409, JSON.stringify({ error: '存档版本冲突，请重新读取', revision: current.revision }), 'application/json');
      const world = findWorldVersion(await loadWorlds(), current.worldId, current.worldVersion);
      if (!world) return send(res, 409, JSON.stringify({ error: '存档绑定的世界版本不存在' }), 'application/json');
      const rebuilt = rebuildWorldEventMemory(current, world);
      const next = { ...current, eventMemory: rebuilt.entries, memoryRebuild: { commandId: payload.commandId, sourceRevision: current.revision, sourceHash: rebuilt.sourceHash, rebuiltAt: Date.now() }, updatedAt: Date.now() };
      await writeJsonAtomic(fp, next);
      send(res, 200, JSON.stringify({ save: next, diagnostics: worldMemoryDiagnostics(next, world), idempotent: false }), 'application/json; charset=utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') return send(res, 404, JSON.stringify({ error: '存档不存在' }), 'application/json');
      console.error('[world-saves] 派生记忆重建失败:', err.message);
      send(res, 500, JSON.stringify({ error: '派生记忆重建失败: ' + err.message }), 'application/json');
    }
  });
}

function worldLineSummarySource(save) {
  const state = save?.state && typeof save.state === 'object' ? save.state : {};
  return {
    saveId: save?.id || null,
    worldId: save?.worldId || null,
    worldVersion: save?.worldVersion ?? null,
    revision: Number.isInteger(save?.revision) ? save.revision : 0,
    eventLedger: Array.isArray(save?.eventLedger) ? save.eventLedger : [],
    worldEvents: Array.isArray(state.worldEvents) ? state.worldEvents : [],
    growthApplications: Array.isArray(state.growthApplications) ? state.growthApplications : [],
    experiences: Array.isArray(state.experiences) ? state.experiences : [],
    playerRelations: state.player?.relations && typeof state.player.relations === 'object' && !Array.isArray(state.player.relations) ? state.player.relations : {},
    npcStates: save?.npcStates && typeof save.npcStates === 'object' && !Array.isArray(save.npcStates) ? save.npcStates : {},
    factionStates: state.factionStates && typeof state.factionStates === 'object' && !Array.isArray(state.factionStates) ? state.factionStates : {},
    goals: Array.isArray(state.goals) ? state.goals : [],
    leads: Array.isArray(state.leads) ? state.leads : [],
    failure: state.failure || null,
    ending: state.ending || null,
    locationId: state.locationId ?? null,
    time: state.time || null,
  };
}

function worldLineSummarySourceHash(save) {
  return sha256Json(worldLineSummarySource(save));
}

function buildWorldLineSummary(save, world) {
  const state = save?.state && typeof save.state === 'object' ? save.state : {};
  const locationNames = new Map((Array.isArray(world?.locations) ? world.locations : []).map(item => [item?.id, item?.name || item?.id]));
  const npcNames = new Map((Array.isArray(world?.npcs) ? world.npcs : []).map(item => [item?.id, item?.name || item?.id]));
  const factionNames = new Map(worldFactionDefinitions(world).map(item => [item?.id, item?.name || item?.id]));
  const events = (Array.isArray(state.worldEvents) ? state.worldEvents : [])
    .filter(event => event && event.visibility !== 'hidden')
    .slice(-WORLD_SUMMARY_EVENT_MAX)
    .map(event => ({
      eventId: event.eventId,
      title: event.title || event.eventId,
      description: event.description || '',
      consequences: Array.isArray(event.consequences) ? event.consequences.slice(0, 16) : [],
      locationId: event.locationId ?? null,
      locationName: locationNames.get(event.locationId) || null,
      time: event.time ? cloneJson(event.time) : null,
      factionId: event.factionId || null,
      factionName: factionNames.get(event.factionId) || null,
      revision: Number.isInteger(event.revision) ? event.revision : null,
    }));
  const visibleEventIds = new Set(events.map(event => event.eventId));
  const experiences = (Array.isArray(state.experiences) ? state.experiences : []).slice(-WORLD_SUMMARY_EVENT_MAX).map(item => ({
    id: item.id,
    title: item.title,
    summary: item.summary,
    sourceId: item.sourceId,
    candidateId: item.candidateId,
    locationId: item.locationId ?? null,
    locationName: locationNames.get(item.locationId) || null,
    revision: item.revision,
    effects: item.effects ? cloneJson(item.effects) : null,
  }));
  const playerRelations = state.player?.relations && typeof state.player.relations === 'object' && !Array.isArray(state.player.relations) ? state.player.relations : {};
  const relationships = Object.entries(save?.npcStates && typeof save.npcStates === 'object' ? save.npcStates : {}).slice(0, WORLD_SUMMARY_RELATION_MAX).map(([npcId, npc]) => ({
    npcId,
    name: npcNames.get(npcId) || npcId,
    relation: playerRelations[npcId] ?? npc?.relation?.player ?? null,
    status: Array.isArray(npc?.status) ? npc.status.slice(0, 16) : [],
    locationId: npc?.locationId ?? null,
    locationName: locationNames.get(npc?.locationId) || null,
  }));
  const factions = Object.entries(state.factionStates && typeof state.factionStates === 'object' ? state.factionStates : {}).slice(0, WORLD_SUMMARY_RELATION_MAX).map(([factionId, faction]) => ({
    factionId,
    name: factionNames.get(factionId) || factionId,
    relation: faction?.relation ?? null,
    influence: faction?.influence ?? null,
    goals: Array.isArray(faction?.goals) ? faction.goals.slice(0, 16) : [],
  }));
  const sourceHash = worldLineSummarySourceHash(save);
  return {
    schemaVersion: 1,
    saveId: save.id,
    worldId: save.worldId,
    worldVersion: save.worldVersion,
    sourceRevision: save.revision,
    sourceHash,
    generatedAt: Date.now(),
    status: state.ending?.status === 'ended' ? 'ended' : 'ongoing',
    location: { id: state.locationId ?? null, name: locationNames.get(state.locationId) || null },
    time: state.time ? cloneJson(state.time) : null,
    failure: state.failure ? { status: state.failure.status || null, mode: state.failure.mode || null, label: state.failure.label || null } : null,
    ending: state.ending ? { status: state.ending.status || null, endingId: state.ending.endingId || null, label: state.ending.label || null, description: state.ending.description || '' } : null,
    experiences,
    relationships,
    factions,
    worldChanges: events,
    milestones: (Array.isArray(save.eventLedger) ? save.eventLedger : []).slice(-WORLD_SUMMARY_EVENT_MAX).map(entry => ({
      kind: entry.kind,
      sourceRevision: entry.sourceRevision,
      locationId: entry.locationId ?? null,
      time: entry.time ? cloneJson(entry.time) : null,
      worldEventIds: Array.isArray(entry.worldEventIds) ? entry.worldEventIds.filter(id => visibleEventIds.has(id)).slice(0, 64) : [],
      growthApplicationId: entry.growthApplicationId || null,
      endingId: entry.endingId || null,
    })),
    openObjectives: [...(Array.isArray(state.goals) ? state.goals : []), ...(Array.isArray(state.leads) ? state.leads : [])]
      .filter(item => item && item.status === 'active')
      .slice(0, WORLD_SUMMARY_EVENT_MAX)
      .map(item => ({ id: item.id, title: item.title, description: item.desc || '', kind: state.goals?.includes(item) ? 'goal' : 'lead' })),
  };
}

function worldLineSummaryView(save, world) {
  const sourceHash = worldLineSummarySourceHash(save);
  const summary = save?.worldLineSummary && typeof save.worldLineSummary === 'object' ? save.worldLineSummary : null;
  return { saveId: save.id, worldId: save.worldId, worldVersion: save.worldVersion, revision: save.revision, sourceHash, stale: !summary || summary.sourceHash !== sourceHash, summary };
}

async function handleWorldLineSummaryGet(req, res, saveId) {
  const fp = savePath(saveId);
  if (!fp) return send(res, 400, JSON.stringify({ error: '无效的 saveId' }), 'application/json');
  try {
    const save = JSON.parse(await fs.promises.readFile(fp, 'utf-8'));
    const world = findWorldVersion(await loadWorlds(), save.worldId, save.worldVersion);
    if (!world) return send(res, 409, JSON.stringify({ error: '存档绑定的世界版本不存在' }), 'application/json');
    send(res, 200, JSON.stringify(worldLineSummaryView(save, world)), 'application/json; charset=utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return send(res, 404, JSON.stringify({ error: '存档不存在' }), 'application/json');
    console.error('[world-saves] 世界线总结读取失败:', err.message);
    send(res, 500, JSON.stringify({ error: '世界线总结读取失败: ' + err.message }), 'application/json');
  }
}

async function handleWorldLineSummaryRebuild(req, res, saveId) {
  const fp = savePath(saveId);
  if (!fp) return send(res, 400, JSON.stringify({ error: '无效的 saveId' }), 'application/json');
  let payload;
  try { payload = await readJsonBody(req, 64 * 1024); }
  catch (err) { return send(res, err.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, JSON.stringify({ error: err.message }), 'application/json'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return send(res, 400, JSON.stringify({ error: '请求必须是 JSON 对象' }), 'application/json');
  if (!Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0) return send(res, 400, JSON.stringify({ error: 'expectedRevision 必须是非负整数' }), 'application/json');
  if (typeof payload.commandId !== 'string' || !COMMAND_ID_RE.test(payload.commandId)) return send(res, 400, JSON.stringify({ error: 'commandId 无效' }), 'application/json');
  return withWorldSaveLock(saveId, async () => {
    try {
      const current = JSON.parse(await fs.promises.readFile(fp, 'utf-8'));
      if (!current || current.id !== saveId) throw new Error('存档文件 ID 不一致');
      if (current.worldLineSummary?.commandId === payload.commandId) return send(res, 200, JSON.stringify({ save: current, ...worldLineSummaryView(current, await loadWorlds().then(worlds => findWorldVersion(worlds, current.worldId, current.worldVersion))), idempotent: true }), 'application/json; charset=utf-8');
      if (current.revision !== payload.expectedRevision) return send(res, 409, JSON.stringify({ error: '存档版本冲突，请重新读取', revision: current.revision }), 'application/json');
      const world = findWorldVersion(await loadWorlds(), current.worldId, current.worldVersion);
      if (!world) return send(res, 409, JSON.stringify({ error: '存档绑定的世界版本不存在' }), 'application/json');
      const summary = buildWorldLineSummary(current, world);
      summary.commandId = payload.commandId;
      const next = { ...current, worldLineSummary: summary, updatedAt: Date.now() };
      await writeJsonAtomic(fp, next);
      send(res, 200, JSON.stringify({ save: next, ...worldLineSummaryView(next, world), idempotent: false }), 'application/json; charset=utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') return send(res, 404, JSON.stringify({ error: '存档不存在' }), 'application/json');
      console.error('[world-saves] 世界线总结重建失败:', err.message);
      send(res, 500, JSON.stringify({ error: '世界线总结重建失败: ' + err.message }), 'application/json');
    }
  });
}

function validateWorldObjectiveList(value, label, world = null) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > 256) return `${label} 最多 256 项`;
  const locationIds = world ? worldLocationIds(world) : null;
  const ids = new Set();
  for (const objective of value) {
    const id = typeof objective?.id === 'string' ? objective.id.trim() : '';
    if (!isSafeId(id) || ids.has(id)) return `${label} 含有重复或无效 ID`;
    if (!draftTextValid(objective.title, 240, true) || !draftTextValid(objective.desc ?? '', 4000)) return `${label}.${id} 文本无效`;
    if (objective.status !== undefined && !['active', 'done', 'failed', 'paused'].includes(objective.status)) return `${label}.${id}.status 无效`;
    for (const key of ['actorId', 'locationId']) {
      if (objective[key] !== undefined && objective[key] !== null && (!isSafeId(objective[key]) || (key === 'locationId' && locationIds && !locationIds.has(objective[key])))) return `${label}.${id}.${key} 无效`;
    }
    if (objective.deadline !== undefined && (!objective.deadline || typeof objective.deadline !== 'object' || Array.isArray(objective.deadline) || typeof objective.deadline.unit !== 'string' || !objective.deadline.unit.trim() || objective.deadline.unit.length > 40 || !Number.isFinite(objective.deadline.value) || objective.deadline.value < 0 || objective.deadline.value > 1000000000)) return `${label}.${id}.deadline 无效`;
    if (objective.tags !== undefined && !draftStringListValid(objective.tags, 32, 120)) return `${label}.${id}.tags 无效`;
    ids.add(id);
  }
  return null;
}

function validateFactionGoalList(value, label) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > 64 || value.some(goal => typeof goal !== 'string' || !goal.trim() || goal.length > 240)) return `${label} 无效`;
  return null;
}

function validateFactionActionList(factionId, value, resources, locationIds = null) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > 64) return `factions.${factionId}.actions 无效`;
  const ids = new Set();
  const resourceIds = new Set(resources.map(resource => resource.id));
  for (const action of value) {
    const id = typeof action?.id === 'string' ? action.id.trim() : '';
    if (!isSafeId(id) || ids.has(id) || !draftTextValid(action.title, 200, true) || !draftTextValid(action.description ?? '', 4000)) return `factions.${factionId}.actions 含有重复或无效条目`;
    const trigger = action.trigger;
    if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) return `factions.${factionId}.actions.${id}.trigger 无效`;
    const hasAt = trigger.at !== undefined;
    const hasAfterTurns = trigger.afterTurns !== undefined;
    if (!hasAt && !hasAfterTurns) return `factions.${factionId}.actions.${id}.trigger 至少声明 at 或 afterTurns`;
    if (hasAt && (!validBoundedNumber(trigger.at, 0, 1000000000))) return `factions.${factionId}.actions.${id}.trigger.at 无效`;
    if (hasAfterTurns && (!Number.isInteger(trigger.afterTurns) || trigger.afterTurns < 1 || trigger.afterTurns > 1000000)) return `factions.${factionId}.actions.${id}.trigger.afterTurns 无效`;
    if (trigger.locationId !== undefined && (!isSafeId(trigger.locationId) || (locationIds && !locationIds.has(trigger.locationId)))) return `factions.${factionId}.actions.${id}.trigger.locationId 必须引用已登记地点`;
    if (action.visibility !== undefined && !['public', 'local', 'hidden'].includes(action.visibility)) return `factions.${factionId}.actions.${id}.visibility 无效`;
    if (action.once !== undefined && action.once !== true) return `factions.${factionId}.actions.${id}.once 目前必须为 true`;
    const changes = action.changes === undefined ? {} : action.changes;
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return `factions.${factionId}.actions.${id}.changes 无效`;
    for (const key of ['relation', 'influence']) if (changes[key] !== undefined && !validBoundedNumber(changes[key], -1000000000, 1000000000)) return `factions.${factionId}.actions.${id}.changes.${key} 无效`;
    if (changes.resources !== undefined) {
      if (!changes.resources || typeof changes.resources !== 'object' || Array.isArray(changes.resources) || Object.keys(changes.resources).length > 64) return `factions.${factionId}.actions.${id}.changes.resources 无效`;
      for (const [resourceId, delta] of Object.entries(changes.resources)) if (!resourceIds.has(resourceId) || !validBoundedNumber(delta, -1000000000, 1000000000)) return `factions.${factionId}.actions.${id}.changes.resources.${resourceId} 无效`;
    }
    if (action.consequences !== undefined && !draftStringListValid(action.consequences, 16, 1000)) return `factions.${factionId}.actions.${id}.consequences 无效`;
    if (!isSafeId(`${factionId}-${id}`)) return `factions.${factionId}.actions.${id} 与派系 ID 组合后过长`;
    ids.add(id);
  }
  return null;
}

function validateWorldFactions(value, world = null) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > 128) return 'factions 最多 128 项';
  const factionIds = new Set();
  const locationIds = world ? worldLocationIds(world) : null;
  for (const faction of value) {
    const id = typeof faction?.id === 'string' ? faction.id.trim() : '';
    if (!isSafeId(id) || factionIds.has(id) || !draftTextValid(faction.name, 200, true)) return 'factions 含有重复或无效条目';
    if (faction.description !== undefined && !draftTextValid(faction.description, 4000)) return `factions.${id}.description 无效`;
    const goalInvalid = validateFactionGoalList(faction.goals, `factions.${id}.goals`);
    if (goalInvalid) return goalInvalid;
    const resources = faction.resources === undefined ? [] : faction.resources;
    if (!Array.isArray(resources) || resources.length > 64) return `factions.${id}.resources 无效`;
    const resourceIds = new Set();
    for (const resource of resources) {
      const resourceId = typeof resource?.id === 'string' ? resource.id.trim() : '';
      const min = resource.min ?? 0;
      const max = resource.max ?? 1000000;
      const initial = resource.initial ?? min;
      if (!isSafeId(resourceId) || resourceIds.has(resourceId) || !draftTextValid(resource.label, 120, true)
        || !validBoundedNumber(min, -1000000000, 1000000000) || !validBoundedNumber(max, min, 1000000000)
        || !validBoundedNumber(initial, min, max)) return `factions.${id}.resources 无效`;
      resourceIds.add(resourceId);
    }
    const actionInvalid = validateFactionActionList(id, faction.actions, resources, locationIds);
    if (actionInvalid) return actionInvalid;
    const initial = faction.initialState;
    if (initial !== undefined) {
      if (!initial || typeof initial !== 'object' || Array.isArray(initial)) return `factions.${id}.initialState 无效`;
      if (initial.relation !== undefined && !validBoundedNumber(initial.relation, -100, 100)) return `factions.${id}.initialState.relation 无效`;
      if (initial.influence !== undefined && !validBoundedNumber(initial.influence, 0, 1000000000)) return `factions.${id}.initialState.influence 无效`;
      const initialGoalsInvalid = validateFactionGoalList(initial.goals, `factions.${id}.initialState.goals`);
      if (initialGoalsInvalid) return initialGoalsInvalid;
      if (initial.resources !== undefined) {
        if (!initial.resources || typeof initial.resources !== 'object' || Array.isArray(initial.resources)) return `factions.${id}.initialState.resources 无效`;
        for (const [resourceId, resourceValue] of Object.entries(initial.resources)) {
          const resource = resources.find(item => item.id === resourceId);
          if (!resource || !validBoundedNumber(resourceValue, resource.min ?? 0, resource.max ?? 1000000)) return `factions.${id}.initialState.resources.${resourceId} 无效`;
        }
      }
    }
    factionIds.add(id);
  }
  return null;
}

function worldFactionDefinitions(world) {
  return Array.isArray(world?.factions) ? world.factions : [];
}

function validateFactionStates(world, value, current = null) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'state.factionStates 必须是对象';
  const definitions = new Map(worldFactionDefinitions(world).map(faction => [faction.id, faction]));
  if (!definitions.size && Object.keys(value).length) return 'state.factionStates 包含未登记的派系';
  for (const id of definitions.keys()) if (value[id] === undefined) return `state.factionStates.${id} 不能省略`;
  if (current && typeof current === 'object') {
    for (const id of Object.keys(current)) if (value[id] === undefined) return `state.factionStates.${id} 不能省略`;
  }
  for (const [id, state] of Object.entries(value)) {
    if (!isSafeId(id) || (definitions.size && !definitions.has(id)) || !state || typeof state !== 'object' || Array.isArray(state)) return `state.factionStates.${id} 无效`;
    if (state.relation !== undefined && !validBoundedNumber(state.relation, -100, 100)) return `state.factionStates.${id}.relation 无效`;
    if (state.influence !== undefined && !validBoundedNumber(state.influence, 0, 1000000000)) return `state.factionStates.${id}.influence 无效`;
    const goalsInvalid = validateFactionGoalList(state.goals, `state.factionStates.${id}.goals`);
    if (goalsInvalid) return goalsInvalid;
    if (state.resources !== undefined) {
      if (!state.resources || typeof state.resources !== 'object' || Array.isArray(state.resources)) return `state.factionStates.${id}.resources 无效`;
      const resourceDefinitions = new Map((definitions.get(id)?.resources || []).map(resource => [resource.id, resource]));
      for (const [resourceId, resourceValue] of Object.entries(state.resources)) {
        const resource = resourceDefinitions.get(resourceId);
        if (!resource || !validBoundedNumber(resourceValue, resource.min ?? 0, resource.max ?? 1000000)) return `state.factionStates.${id}.resources.${resourceId} 无效`;
      }
    }
  }
  return null;
}

function initialFactionStates(world) {
  return Object.fromEntries(worldFactionDefinitions(world).map(faction => {
    const initial = faction.initialState || {};
    const initialResources = initial.resources && typeof initial.resources === 'object' && !Array.isArray(initial.resources) ? initial.resources : {};
    const resources = Object.fromEntries((Array.isArray(faction.resources) ? faction.resources : []).map(resource => [resource.id, initialResources[resource.id] ?? resource.initial ?? resource.min ?? 0]));
    return [faction.id, {
      goals: Array.isArray(initial.goals) ? cloneJson(initial.goals) : (Array.isArray(faction.goals) ? cloneJson(faction.goals) : []),
      resources,
      relation: initial.relation ?? 0,
      influence: initial.influence ?? 0,
    }];
  }));
}

function materializeFactionStates(world, current = null) {
  const initial = initialFactionStates(world);
  const existing = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  return Object.fromEntries(worldFactionDefinitions(world).map(faction => [faction.id, existing[faction.id] ? cloneJson(existing[faction.id]) : initial[faction.id]]));
}

function advanceWorldTime(current, world) {
  const config = world?.time && typeof world.time === 'object' ? world.time : {};
  const unit = typeof current?.unit === 'string' ? current.unit : String(config.unit || 'tick');
  const value = Number.isFinite(current?.value) ? current.value : Number(config.start || 0);
  return { unit, value: value + Number(config.turnAdvance || 1) };
}

function committedTurnCount(save) {
  const receipts = Array.isArray(save?.receipts) ? save.receipts : [];
  return receipts.filter(receipt => receipt && (receipt.kind === 'turn' || Array.isArray(receipt.turnIds))).length;
}

function committedCommand(save, commandId) {
  const receipts = Array.isArray(save?.receipts) ? save.receipts : [];
  if (receipts.some(receipt => receipt && receipt.commandId === commandId)) return true;
  const ledger = Array.isArray(save?.eventLedger) ? save.eventLedger : [];
  return ledger.some(entry => entry && entry.commandId === commandId);
}

function ledgerEventId(saveId, revision) {
  const hash = crypto.createHash('sha256').update(`${saveId}:${revision}`).digest('hex').slice(0, 24);
  return `ledger-${revision}-${hash}`;
}

function appendEventLedger(save, entry) {
  const sourceRevision = Number(entry.sourceRevision);
  const record = {
    id: ledgerEventId(save.id, sourceRevision),
    kind: entry.kind,
    commandId: entry.commandId,
    sourceRevision,
    revision: sourceRevision,
    locationId: entry.locationId ?? null,
    time: entry.time ? cloneJson(entry.time) : null,
    createdAt: entry.createdAt || Date.now(),
  };
  for (const key of ['turnIds', 'worldEventIds', 'factionActionIds', 'deadlineIds', 'growthApplicationId', 'migrationId', 'endingId']) {
    if (entry[key] !== undefined) record[key] = cloneJson(entry[key]);
  }
  const invalid = validateEventLedger([record]);
  if (invalid) throw new Error(invalid);
  return [...(Array.isArray(save.eventLedger) ? save.eventLedger : []), record].slice(-EVENT_LEDGER_MAX);
}

function settleWorldEvents(world, current, nextState, commandId, revision) {
  const definitions = Array.isArray(world?.events) ? world.events : [];
  const existing = Array.isArray(current?.state?.worldEvents) ? cloneJson(current.state.worldEvents) : [];
  const triggeredIds = new Set(existing.map(event => event && event.eventId).filter(Boolean));
  const turnNumber = committedTurnCount(current) + 1;
  const time = nextState?.time;
  const locationId = nextState?.locationId ?? null;
  const triggered = [];
  for (const event of definitions) {
    if (!event || typeof event !== 'object' || !isSafeId(event.id)) continue;
    if (triggeredIds.has(event.id)) continue;
    const trigger = event.trigger || {};
    if (trigger.at !== undefined && (!time || Number(time.value) < Number(trigger.at))) continue;
    if (trigger.afterTurns !== undefined && turnNumber < Number(trigger.afterTurns)) continue;
    if (trigger.locationId !== undefined && trigger.locationId !== locationId) continue;
    triggered.push({
      eventId: event.id,
      title: String(event.title || event.id).trim(),
      description: String(event.description || '').trim(),
      consequences: Array.isArray(event.consequences) ? event.consequences.map(item => String(item).trim()).filter(Boolean) : [],
      visibility: ['public', 'local', 'hidden'].includes(event.visibility) ? event.visibility : 'public',
      locationId: trigger.locationId ?? locationId,
      time: time ? cloneJson(time) : null,
      commandId,
      revision,
    });
  }
  return { events: [...existing, ...triggered].slice(-256), eventIds: triggered.map(event => event.eventId) };
}

function settleWorldFactionActions(world, current, nextState, commandId, revision) {
  const existing = Array.isArray(current?.state?.worldEvents) ? cloneJson(current.state.worldEvents) : [];
  const eventIds = new Set(existing.map(event => event?.eventId).filter(Boolean));
  const actionIds = [];
  const time = nextState?.time;
  const locationId = nextState?.locationId ?? null;
  const turnNumber = committedTurnCount(current) + 1;
  const triggered = [];
  const factionStates = nextState.factionStates && typeof nextState.factionStates === 'object' ? nextState.factionStates : {};
  for (const faction of worldFactionDefinitions(world)) {
    const state = factionStates[faction.id];
    if (!state) continue;
    for (const action of Array.isArray(faction.actions) ? faction.actions : []) {
      const trigger = action.trigger || {};
      if (trigger.at !== undefined && (!time || Number(time.value) < Number(trigger.at))) continue;
      if (trigger.afterTurns !== undefined && turnNumber < Number(trigger.afterTurns)) continue;
      if (trigger.locationId !== undefined && trigger.locationId !== locationId) continue;
      const eventId = `faction-${faction.id}-${action.id}`;
      if (eventIds.has(eventId)) continue;
      const changes = action.changes || {};
      if (changes.relation !== undefined) state.relation = Math.max(-100, Math.min(100, Number(state.relation || 0) + Number(changes.relation)));
      if (changes.influence !== undefined) state.influence = Math.max(0, Math.min(1000000000, Number(state.influence || 0) + Number(changes.influence)));
      if (changes.resources && typeof changes.resources === 'object') {
        const resourceDefs = new Map((Array.isArray(faction.resources) ? faction.resources : []).map(resource => [resource.id, resource]));
        for (const [resourceId, delta] of Object.entries(changes.resources)) {
          const definition = resourceDefs.get(resourceId);
          if (!definition) continue;
          const currentValue = Number(state.resources?.[resourceId] ?? definition.initial ?? definition.min ?? 0);
          if (!state.resources || typeof state.resources !== 'object' || Array.isArray(state.resources)) state.resources = {};
          state.resources[resourceId] = Math.max(definition.min ?? 0, Math.min(definition.max ?? 1000000, currentValue + Number(delta)));
        }
      }
      const event = {
        eventId,
        title: String(action.title || `${faction.name || faction.id} 行动`).trim(),
        description: String(action.description || '').trim(),
        consequences: Array.isArray(action.consequences) ? action.consequences.map(item => String(item).trim()).filter(Boolean) : [],
        visibility: ['public', 'local', 'hidden'].includes(action.visibility) ? action.visibility : 'public',
        locationId: trigger.locationId ?? locationId,
        time: time ? cloneJson(time) : null,
        factionId: faction.id,
        actionId: action.id,
        commandId,
        revision,
      };
      triggered.push(event);
      eventIds.add(eventId);
      actionIds.push(`${faction.id}:${action.id}`);
    }
  }
  return { events: [...existing, ...triggered].slice(-256), eventIds: actionIds };
}

function settleWorldDeadlines(nextState) {
  const time = nextState?.time;
  if (!time || !Number.isFinite(time.value) || typeof time.unit !== 'string') return [];
  const expired = [];
  for (const key of ['goals', 'leads']) {
    const list = Array.isArray(nextState[key]) ? nextState[key] : [];
    for (const objective of list) {
      const deadline = objective?.deadline;
      if (objective?.status !== 'active' || !deadline || deadline.unit !== time.unit || !Number.isFinite(deadline.value) || time.value < deadline.value) continue;
      objective.status = 'failed';
      objective.deadlineStatus = 'expired';
      objective.deadlineResolvedAt = cloneJson(time);
      expired.push(`${key}:${objective.id}`);
    }
  }
  return expired;
}

function validateActionIntent(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'actionIntent 必须是对象';
  if (typeof value.raw !== 'string' || !value.raw.trim() || value.raw.length > 10000) return 'actionIntent.raw 无效';
  for (const key of ['verb', 'target', 'method', 'risk']) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 240)) return `actionIntent.${key} 无效`;
  }
  if (value.dice !== undefined) {
    if (!Array.isArray(value.dice) || value.dice.length > 16) return 'actionIntent.dice 无效';
    for (const roll of value.dice) {
      const parsed = rollDiceExpression(roll?.expr);
      if (parsed.error || !Array.isArray(roll.rolls) || roll.rolls.length !== parsed.rolls.length || roll.rolls.some((value, index) => !Number.isInteger(value) || value < 1 || value > Number(roll.expr.match(/d(\d+)/i)[1]) || value !== roll.rolls[index]) || roll.total !== roll.rolls.reduce((sum, value) => sum + value, Number(roll.bonus || 0)) || roll.bonus !== parsed.bonus) return 'actionIntent.dice 无效';
    }
  }
  return null;
}

function rollDiceExpression(expression) {
  const parsed = parseDiceExpression(expression);
  if (parsed.error) return parsed;
  const rolls = Array.from({ length: parsed.count }, () => crypto.randomInt(1, parsed.sides + 1));
  return { expr: parsed.expr, rolls, bonus: parsed.bonus, total: rolls.reduce((sum, value) => sum + value, parsed.bonus) };
}

async function handleDiceRoll(req, res) {
  let payload;
  try { payload = await readJsonBody(req, 16 * 1024); }
  catch (err) { return send(res, err.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, JSON.stringify({ error: err.message }), 'application/json'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.expressions) || payload.expressions.length > 16) return send(res, 400, JSON.stringify({ error: 'expressions 必须是最多 16 项的数组' }), 'application/json');
  const rolls = [];
  for (const expression of payload.expressions) {
    const result = rollDiceExpression(expression);
    if (result.error) return send(res, 400, JSON.stringify({ error: result.error }), 'application/json');
    rolls.push(result);
  }
  send(res, 200, JSON.stringify({ rolls }), 'application/json; charset=utf-8');
}

function validatePlayerCreationInput(world, input) {
  const schema = playerCreationSchema(world);
  if (input === undefined || input === null) return { snapshot: cloneJson(world?.start?.playerTemplate || { name: '未命名冒险者', race: '待定', role: '旅人', profileFields: [] }), statePlayer: null, relations: {} };
  if (!schema) return { error: '当前世界卡没有可用的玩家创建规则' };
  if (schema.mode === 'preset') return { error: '当前世界卡使用预设玩家，不能提交自定义建角数据' };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'player 必须是对象' };
  const fields = Object.fromEntries((Array.isArray(schema.fields) ? schema.fields : []).map(field => [field.id, field]));
  const attributes = Object.fromEntries((Array.isArray(schema.attributes) ? schema.attributes : []).map(attribute => [attribute.id, attribute]));
  const resources = Object.fromEntries((Array.isArray(schema.resources) ? schema.resources : []).map(resource => [resource.id, resource]));
  const skills = Object.fromEntries((Array.isArray(schema.skills) ? schema.skills : []).map(skill => [skill.id, skill]));
  const traits = new Map((Array.isArray(schema.traits) ? schema.traits : []).map(trait => [trait.id, trait]));
  const values = input.fields && typeof input.fields === 'object' && !Array.isArray(input.fields) ? input.fields : {};
  const normalizedFields = {};
  for (const [id, field] of Object.entries(fields)) {
    let value = values[id] ?? field.default ?? '';
    if (field.type === 'number') value = Number(value);
    if (field.type === 'number' && (!validBoundedNumber(value, field.min ?? -1000000, field.max ?? 1000000)
      || (field.step && Math.abs((value - (field.min ?? 0)) / field.step - Math.round((value - (field.min ?? 0)) / field.step)) > 1e-9))) return { error: `player.fields.${id} 数值无效` };
    if (field.type !== 'number' && typeof value !== 'string') return { error: `player.fields.${id} 必须是文本` };
    if (field.type !== 'number' && field.required && !value.trim()) return { error: `player.fields.${id} 不能为空` };
    if (field.type !== 'number' && value.length > (field.maxLength || 2000)) return { error: `player.fields.${id} 超出长度限制` };
    if (field.type === 'select' && !field.options.some(option => (typeof option === 'string' ? option : option.value) === value)) return { error: `player.fields.${id} 选项无效` };
    normalizedFields[id] = field.type === 'number' ? value : value.trim();
  }
  for (const id of Object.keys(values)) if (!Object.hasOwn(fields, id)) return { error: `player.fields.${id} 不是当前世界卡字段` };
  const inputAttributes = input.attributes && typeof input.attributes === 'object' && !Array.isArray(input.attributes) ? input.attributes : {};
  const normalizedAttributes = {};
  let spent = 0;
  for (const [id, attribute] of Object.entries(attributes)) {
    const value = inputAttributes[id] ?? attribute.default ?? attribute.min ?? 0;
    if (!validBoundedNumber(value, attribute.min ?? 0, attribute.max ?? 100)
      || (attribute.step && Math.abs((value - (attribute.min ?? 0)) / attribute.step - Math.round((value - (attribute.min ?? 0)) / attribute.step)) > 1e-9)) return { error: `player.attributes.${id} 超出范围` };
    normalizedAttributes[id] = value;
    spent += value;
  }
  for (const id of Object.keys(inputAttributes)) if (!Object.hasOwn(attributes, id)) return { error: `player.attributes.${id} 不是当前世界卡属性` };
  if (schema.pointBudget && spent > schema.pointBudget.total) return { error: `属性点不能超过 ${schema.pointBudget.total}` };
  if (schema.pointBudget && spent < (schema.pointBudget.min ?? 0)) return { error: `属性点不能少于 ${schema.pointBudget.min}` };
  const inputResources = input.resources && typeof input.resources === 'object' && !Array.isArray(input.resources) ? input.resources : {};
  const normalizedResources = {};
  for (const [id, resource] of Object.entries(resources)) {
    const value = inputResources[id] ?? resource.initial ?? resource.min ?? 0;
    if (!validBoundedNumber(value, resource.min ?? 0, resource.max ?? 1000000)) return { error: `player.resources.${id} 超出范围` };
    normalizedResources[id] = value;
  }
  for (const id of Object.keys(inputResources)) if (!Object.hasOwn(resources, id)) return { error: `player.resources.${id} 不是当前世界卡资源` };
  const inputSkills = input.skills && typeof input.skills === 'object' && !Array.isArray(input.skills) ? input.skills : {};
  const normalizedSkills = {};
  for (const [id, skill] of Object.entries(skills)) {
    const value = inputSkills[id] ?? skill.default ?? skill.min ?? 0;
    if (!validBoundedNumber(value, skill.min ?? 0, skill.max ?? 100)
      || (skill.step && Math.abs((value - (skill.min ?? 0)) / skill.step - Math.round((value - (skill.min ?? 0)) / skill.step)) > 1e-9)) return { error: `player.skills.${id} 超出范围` };
    normalizedSkills[id] = value;
  }
  for (const id of Object.keys(inputSkills)) if (!Object.hasOwn(skills, id)) return { error: `player.skills.${id} 不是当前世界卡技能` };
  const selectedTraits = Array.isArray(input.traits) ? [...new Set(input.traits.map(String))] : [];
  if (selectedTraits.length > traits.size || selectedTraits.some(id => !traits.has(id))) return { error: 'player.traits 含有无效条目' };
  const inputRelations = input.relations && typeof input.relations === 'object' && !Array.isArray(input.relations) ? input.relations : {};
  const relationRules = Object.fromEntries((Array.isArray(schema.relations) ? schema.relations : []).map(rule => [rule.npcId, rule]));
  const normalizedRelations = {};
  for (const [npcId, rule] of Object.entries(relationRules)) {
    const value = inputRelations[npcId] ?? rule.default ?? 0;
    if (!validBoundedNumber(value, rule.min ?? -100, rule.max ?? 100)) return { error: `player.relations.${npcId} 超出范围` };
    normalizedRelations[npcId] = value;
  }
  for (const id of Object.keys(inputRelations)) if (!Object.hasOwn(relationRules, id)) return { error: `player.relations.${id} 不是当前世界卡关系` };
  const snapshot = {
    fields: normalizedFields,
    attributes: normalizedAttributes,
    skills: normalizedSkills,
    resources: normalizedResources,
    traits: selectedTraits,
    relations: normalizedRelations,
    name: normalizedFields.name || '未命名冒险者',
    race: normalizedFields.race || '待定',
    role: normalizedFields.role || '旅人',
    profileFields: Object.entries(normalizedFields).filter(([id]) => !['name', 'race', 'role'].includes(id)).map(([key, value]) => ({ key, value })),
  };
  return {
    snapshot,
    statePlayer: { fields: normalizedFields, attributes: normalizedAttributes, skills: normalizedSkills, resources: normalizedResources, traits: selectedTraits, relations: normalizedRelations, effects: [] },
    relations: normalizedRelations,
  };
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
    for (const key of ['publicFacts', 'publicGoals', 'desires', 'fears', 'goals']) {
      if (npc[key] !== undefined && !draftStringListValid(npc[key], 64, 1000)) return `NPC ${key} is invalid`;
    }
    if (npc.activity !== undefined && !draftTextValid(npc.activity, 2000)) return 'NPC activity is invalid';
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
    if (npc.homeLocationId !== undefined && npc.homeLocationId !== null && (!isSafeId(npc.homeLocationId) || !locationIds.has(npc.homeLocationId))) return 'NPC homeLocationId must point to a registered location';
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
  if (npc.homeLocationId !== undefined) next.homeLocationId = npc.homeLocationId === null ? null : npc.homeLocationId.trim();
  for (const key of ['publicFacts', 'publicGoals', 'desires', 'fears', 'goals']) if (Array.isArray(npc[key])) next[key] = normalizeDraftList(npc[key], 64, 1000);
  if (typeof npc.activity === 'string') next.activity = npc.activity.trim();
  if (Array.isArray(npc.secrets)) next.secrets = npc.secrets.map(secret => ({ id: secret.id.trim(), content: secret.content.trim() }));
  return next;
}

function applyWorldDraftFields(world, payload) {
  const next = cloneJson(world);
  next.title = payload.title.trim();
  next.summary = payload.summary;
  next.tags = [...new Set(payload.tags.map(value => value.trim()))];
  next.lorebookIds = [...new Set(payload.lorebookIds.map(value => value.trim()))];
  if (payload.setting !== undefined) next.setting = payload.setting === null ? null : cloneJson(payload.setting);
  if (payload.rules !== undefined) next.rules = payload.rules === null ? null : cloneJson(payload.rules);
  if (payload.playerCreation !== undefined) next.playerCreation = cloneJson(payload.playerCreation);
  if (payload.turnContract !== undefined) next.turnContract = cloneJson(payload.turnContract);
  if (payload.failure !== undefined) next.failure = cloneJson(payload.failure);
  if (payload.ending !== undefined) next.ending = cloneJson(payload.ending);
  if (payload.time !== undefined) next.time = cloneJson(payload.time);
  if (payload.events !== undefined) next.events = Array.isArray(payload.events) ? cloneJson(payload.events) : [];
  if (payload.factions !== undefined) next.factions = cloneJson(payload.factions);
  if (payload.conflicts !== undefined) next.conflicts = cloneJson(payload.conflicts);
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

const WORLD_DRAFT_PUBLICATION_CHECKS = [
  ['definition', '世界定义'], ['references', '稳定引用'], ['runtime', '开局运行态'], ['prompt', 'Prompt 契约'],
];

function worldDraftPublicationIssue(section, target, message) {
  return { section, target, message };
}

function validateWorldConflictModifierBindings(world) {
  const schema = playerCreationSchema(world) || {};
  const buckets = Object.fromEntries(['attributes', 'skills', 'resources'].map(key => [key, new Set((Array.isArray(schema[key]) ? schema[key] : []).map(item => item?.id))]));
  for (const conflict of Array.isArray(world?.conflicts) ? world.conflicts : []) {
    for (const action of Array.isArray(conflict?.actions) ? conflict.actions : []) {
      for (const [path, modifier] of [['check.modifier', action?.check?.modifier], ['check.damage.modifier', action?.check?.damage?.modifier]]) {
        if (modifier && !buckets[modifier.bucket]?.has(modifier.id)) return `conflicts.${conflict.id}.actions.${action.id}.${path} 引用了未声明的玩家字段`;
      }
    }
  }
  return null;
}

function validateWorldFailureResourceBindings(world) {
  const schema = playerCreationSchema(world) || {};
  const resourceIds = new Set([
    ...(Array.isArray(schema.resources) ? schema.resources : []).map(item => item?.id),
    ...(Array.isArray(schema.economy?.currencies) ? schema.economy.currencies : []).map(item => item?.id),
  ]);
  for (const mode of Array.isArray(world?.failure?.modes) ? world.failure.modes : []) {
    for (const id of Object.keys(mode?.resourceLoss || {})) if (!resourceIds.has(id)) return `failure.modes.${mode?.id || 'unknown'}.resourceLoss.${id} 未声明为玩家资源或货币`;
  }
  return null;
}

function validateWorldDraftStart(world) {
  if (world?.start === undefined || world?.start === null) return null;
  const start = world.start;
  if (!start || typeof start !== 'object' || Array.isArray(start)) return 'start 必须是对象';
  if (start.locationId !== undefined && start.locationId !== null && (!isSafeId(start.locationId) || !worldLocationIds(world).has(start.locationId))) return 'start.locationId 必须引用已登记地点';
  if (start.playerTemplateId !== undefined && start.playerTemplateId !== null && !isSafeId(start.playerTemplateId)) return 'start.playerTemplateId 无效';
  if (start.opening !== undefined && (typeof start.opening !== 'string' || start.opening.length > 100000)) return 'start.opening 无效';
  if (start.openingMode !== undefined && !['static', 'ai'].includes(start.openingMode)) return 'start.openingMode 无效';
  if (start.playerTemplate !== undefined && (!start.playerTemplate || typeof start.playerTemplate !== 'object' || Array.isArray(start.playerTemplate))) return 'start.playerTemplate 必须是对象';
  if (start.initialState !== undefined && (!start.initialState || typeof start.initialState !== 'object' || Array.isArray(start.initialState))) return 'start.initialState 必须是对象';
  return null;
}

function worldDraftPublicationReport(draft) {
  const world = cloneJson(draft?.world);
  const errors = [];
  const add = (section, target, message) => { if (message) errors.push(worldDraftPublicationIssue(section, target, message)); };
  if (!world || world.id !== draft.worldId || Number(world.version) !== Number(draft.baseVersion)) {
    add('definition', 'world-draft-name', '草稿世界标识或基础版本不一致');
    return { world: null, errors, checks: WORLD_DRAFT_PUBLICATION_CHECKS.map(([id, label]) => ({ id, label, ok: false })) };
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
    ...(world.setting !== undefined ? { setting: world.setting } : {}),
    ...(world.rules !== undefined ? { rules: world.rules } : {}),
    ...(world.playerCreation !== undefined ? { playerCreation: world.playerCreation } : {}),
    ...(world.turnContract !== undefined ? { turnContract: world.turnContract } : {}),
    ...(world.failure !== undefined ? { failure: world.failure } : {}),
    ...(world.ending !== undefined ? { ending: world.ending } : {}),
    ...(world.time !== undefined ? { time: world.time } : {}),
    ...(world.events !== undefined ? { events: world.events } : {}),
    ...(world.factions !== undefined ? { factions: world.factions } : {}),
    ...(world.conflicts !== undefined ? { conflicts: world.conflicts } : {}),
    ...(mapGeneration ? { mapGeneration } : {}),
    locations: Array.isArray(world.locations) ? world.locations : [],
    npcs: Array.isArray(world.npcs) ? world.npcs : [],
  };
  add('definition', 'world-draft-name', worldDraftFieldsValid(payload));
  add('references', 'world-draft-player-creation', validatePlayerCreationSchema(payload.playerCreation, world));
  add('references', 'world-draft-locations', validateWorldDraftCollections(payload, world));
  add('references', 'world-draft-events', validateWorldEvents(payload.events, world));
  add('references', 'world-draft-factions', validateWorldFactions(payload.factions, world));
  add('references', 'world-draft-conflicts', validateWorldConflictModifierBindings(world));
  add('references', 'world-draft-failure', validateWorldFailureResourceBindings(world));

  const start = world.start && typeof world.start === 'object' && !Array.isArray(world.start) ? world.start : {};
  const initial = start.initialState && typeof start.initialState === 'object' && !Array.isArray(start.initialState) ? start.initialState : {};
  add('runtime', 'world-draft-locations', validateWorldDraftStart(world));
  const state = {
    locationId: start.locationId ?? null,
    stats: initial.stats === undefined ? {} : initial.stats,
    time: { unit: String(world.time?.unit || 'tick'), value: Number(world.time?.start || 0) },
    inventory: initial.inventory === undefined ? [] : initial.inventory,
    quests: initial.quests === undefined ? [] : initial.quests,
    goals: initial.goals === undefined ? [] : initial.goals,
    leads: initial.leads === undefined ? [] : initial.leads,
    worldEvents: [],
    ...(initial.player !== undefined ? { player: initial.player } : {}),
    ...(initial.conflicts !== undefined ? { conflicts: initial.conflicts } : {}),
    ...(initial.growthCandidates !== undefined ? { growthCandidates: initial.growthCandidates } : {}),
    ...(initial.growthApplications !== undefined ? { growthApplications: initial.growthApplications } : {}),
    ...(initial.experiences !== undefined ? { experiences: initial.experiences } : {}),
  };
  const factionStates = initialFactionStates(world);
  const economyState = materializePlayerEconomyState(world, initial, initial.player);
  Object.assign(state, playerEconomySchema(world) ? economyState : {}, { factionStates });
  add('runtime', 'world-draft-name', validateWorldSavePatch({ expectedRevision: 0, state, turns: [] }));
  add('runtime', 'world-draft-name', validateDynamicPlayerState(world, initial.player));
  add('runtime', 'world-draft-name', validateWorldLocationIds(world, state, initialNpcStates(world, start)));
  add('runtime', 'world-draft-factions', validateFactionStates(world, factionStates));
  add('runtime', 'world-draft-conflicts', validateConflictStates(world, state.conflicts || {}));
  add('runtime', 'world-draft-player-creation', validateGrowthCandidates(world, state.growthCandidates || []));
  add('runtime', 'world-draft-player-creation', validateGrowthApplications(world, state.growthApplications || []));
  add('runtime', 'world-draft-player-creation', validateGrowthExperiences(world, state.experiences || []));
  add('runtime', 'world-draft-player-creation', validateGrowthStateCrossRefs(state));
  add('runtime', 'world-draft-player-creation', validatePlayerEconomyState(world, economyState));
  const seen = new Set();
  const uniqueErrors = errors.filter(issue => {
    const key = `${issue.section}\0${issue.target}\0${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    world,
    errors: uniqueErrors,
    checks: WORLD_DRAFT_PUBLICATION_CHECKS.map(([id, label]) => ({ id, label, ok: !uniqueErrors.some(issue => issue.section === id) })),
  };
}

async function worldDraftPromptIssues(world) {
  let lorebooks;
  try { lorebooks = await loadDataDocument('lorebooks'); }
  catch { return [worldDraftPublicationIssue('prompt', 'world-draft-lorebooks', '无法读取世界书，不能确认 Prompt 引用')]; }
  if (!lorebooks || typeof lorebooks !== 'object' || Array.isArray(lorebooks)) return [worldDraftPublicationIssue('prompt', 'world-draft-lorebooks', '世界书数据格式无效')];
  const issues = [];
  const lorebookIds = Array.isArray(world?.lorebookIds) && world.lorebookIds.length ? world.lorebookIds : ['default'];
  for (const id of [...new Set(lorebookIds)]) {
    const lorebook = lorebooks[id];
    if (!lorebook) { issues.push(worldDraftPublicationIssue('prompt', 'world-draft-lorebooks', `缺少世界书引用：${id}`)); continue; }
    if (!Array.isArray(lorebook.entries)) { issues.push(worldDraftPublicationIssue('prompt', 'world-draft-lorebooks', `世界书 ${id} 的 entries 无效`)); continue; }
    for (const [index, entry] of lorebook.entries.entries()) {
      for (const key of String(entry?.keys || '').split(',').map(value => value.trim()).filter(Boolean)) {
        if (!key.startsWith('/') || key.lastIndexOf('/') <= 0) continue;
        const end = key.lastIndexOf('/');
        const pattern = key.slice(1, end);
        const flags = key.slice(end + 1);
        try {
          if (pattern.length > 500 || !/^[dgimsuvy]*$/.test(flags)) throw new Error('invalid');
          new RegExp(pattern, flags);
        } catch { issues.push(worldDraftPublicationIssue('prompt', 'world-draft-lorebooks', `世界书 ${id}.entries[${index}] 的正则触发器无效`)); }
      }
    }
  }
  return issues;
}

async function worldDraftPublicationCheck(draft, worlds) {
  const report = worldDraftPublicationReport(draft);
  const latest = latestWorld(worlds, draft?.worldId);
  if (!latest) report.errors.push(worldDraftPublicationIssue('definition', 'world-draft-name', '世界卡不存在'));
  else if (Number(latest.version) !== Number(draft?.baseVersion)) report.errors.push(worldDraftPublicationIssue('definition', 'world-draft-base', `草稿基于 v${draft.baseVersion}，但当前最新版本是 v${latest.version}`));
  if (report.world) report.errors.push(...await worldDraftPromptIssues(report.world));
  const seen = new Set();
  report.errors = report.errors.filter(issue => {
    const key = `${issue.section}\0${issue.target}\0${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  report.checks = WORLD_DRAFT_PUBLICATION_CHECKS.map(([id, label]) => ({ id, label, ok: !report.errors.some(issue => issue.section === id) }));
  return { ...report, ready: report.errors.length === 0, nextVersion: Number(draft?.baseVersion) + 1 };
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

function initialNpcStates(world, start, playerRelations = {}) {
  const locationId = start && typeof start.locationId === 'string' ? start.locationId : null;
  return Object.fromEntries(worldNpcIds(world).map(npcId => [npcId, {
    locationId,
    relation: Object.hasOwn(playerRelations, npcId) ? { player: playerRelations[npcId] } : {},
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

function worldUpgradeEntities(world, type) {
  const config = {
    locations: ['locations', []],
    npcs: ['npcs', ['npcIds']],
    quests: ['quests', ['questIds', 'questTemplateIds']],
  }[type];
  const entities = new Map();
  for (const entity of Array.isArray(world?.[config[0]]) ? world[config[0]] : []) {
    if (isSafeId(entity?.id)) entities.set(entity.id, { id: entity.id, name: entity.name || entity.title || entity.id });
  }
  for (const key of config[1]) {
    for (const id of Array.isArray(world?.[key]) ? world[key] : []) if (isSafeId(id) && !entities.has(id)) entities.set(id, { id, name: id });
  }
  return entities;
}

function worldSaveUpgradeReport(save, sourceWorld, targetWorld) {
  const source = Object.fromEntries(['locations', 'npcs', 'quests'].map(type => [type, worldUpgradeEntities(sourceWorld, type)]));
  const target = Object.fromEntries(['locations', 'npcs', 'quests'].map(type => [type, worldUpgradeEntities(targetWorld, type)]));
  const changes = Object.fromEntries(['locations', 'npcs', 'quests'].map(type => [type, {
    added: [...target[type].values()].filter(entity => !source[type].has(entity.id)),
    removed: [...source[type].values()].filter(entity => !target[type].has(entity.id)),
  }]));
  const generated = save.generatedEntities && typeof save.generatedEntities === 'object' ? save.generatedEntities : {};
  const generatedLocationIds = new Set(Object.keys(generated.locations || {}));
  const generatedNpcIds = new Set(Object.keys(generated.npcs || {}));
  const generatedQuestIds = new Set(Object.keys(generated.quests || {}));
  const hardErrors = [];
  const missing = (kind, id, path) => {
    if (id === undefined || id === null || id === '') return;
    const entityKind = { locations: 'location', npcs: 'npc', quests: 'quest' }[kind];
    if (typeof id !== 'string' || !isSafeId(id)) {
      hardErrors.push({ kind: entityKind, id: String(id), path, message: `${path} 不是有效的稳定 ID` });
    } else if (!target[kind].has(id)) {
      hardErrors.push({ kind: entityKind, id, path, message: `${path} 引用的 ${id} 不存在于目标版本` });
    }
  };
  const state = save.state || {};
  if (!generatedLocationIds.has(state.locationId)) missing('locations', state.locationId, 'state.locationId');
  for (const [npcId, npcState] of Object.entries(save.npcStates || {})) {
    if (!generatedNpcIds.has(npcId)) missing('npcs', npcId, `npcStates.${npcId}`);
    if (!generatedLocationIds.has(npcState?.locationId)) missing('locations', npcState?.locationId, `npcStates.${npcId}.locationId`);
  }
  for (const [index, id] of (Array.isArray(state.map?.discoveredLocationIds) ? state.map.discoveredLocationIds : []).entries()) {
    if (!generatedLocationIds.has(id)) missing('locations', id, `state.map.discoveredLocationIds[${index}]`);
  }
  for (const [index, marker] of (Array.isArray(state.map?.markers) ? state.map.markers : []).entries()) {
    if (!generatedLocationIds.has(marker?.locationId)) missing('locations', marker?.locationId, `state.map.markers[${index}].locationId`);
  }
  const playerId = save.player?.characterId;
  for (const [index, id] of (Array.isArray(save.party?.memberIds) ? save.party.memberIds : []).entries()) {
    if (id !== playerId && !generatedNpcIds.has(id)) missing('npcs', id, `party.memberIds[${index}]`);
  }
  for (const [index, quest] of (Array.isArray(state.quests) ? state.quests : []).entries()) {
    const id = quest?.questId || quest?.id;
    if (!generatedQuestIds.has(id)) missing('quests', id, `state.quests[${index}]`);
  }
  return {
    saveId: save.id,
    worldId: save.worldId,
    fromVersion: Number(sourceWorld.version),
    targetVersion: Number(targetWorld.version),
    targetTitle: targetWorld.title || targetWorld.id,
    canUpgrade: hardErrors.length === 0,
    changes,
    hardErrors,
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

function reopenedSaveId(saveId, commandId) {
  return 'reopen-' + crypto.createHash('sha256').update(`${saveId}\0${commandId}`).digest('hex').slice(0, 32);
}

function migratedSaveId(migrationId) {
  return 'migrated-' + migrationId;
}

function rpgMigrationView(record) {
  const { raw, ...view } = record;
  return view;
}

function buildLegacyRpgMigrationReport(envelope, worlds) {
  const errors = [];
  const warnings = [];
  const session = envelope?.session;
  if (!session || typeof session !== 'object' || Array.isArray(session)) errors.push('session 必须是对象');
  if (session && session.kind && session.kind !== 'rpg') warnings.push('来源会话 kind 不是 rpg，将按旧 RPG 会话读取');
  const worldId = typeof envelope?.worldId === 'string' ? envelope.worldId : '';
  const requestedVersion = envelope?.worldVersion === undefined ? undefined : Number(envelope.worldVersion);
  const world = worldId && isSafeId(worldId)
    ? (requestedVersion === undefined ? latestWorld(worlds, worldId) : findWorldVersion(worlds, worldId, requestedVersion))
    : null;
  if (!world) errors.push('目标世界卡或版本不存在');
  const state = session?.rpgState && typeof session.rpgState === 'object' ? session.rpgState : {};
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  if (!Array.isArray(session?.messages)) warnings.push('来源没有 messages，迁移后将从空回合开始');
  if (messages.length > 5000) errors.push('来源消息超过 5000 条');
  if (messages.some(msg => !msg || typeof msg !== 'object' || typeof msg.content !== 'string')) warnings.push('部分消息格式异常，迁移时会跳过');
  const locationId = state.locationId ?? state.location ?? null;
  const locationIds = world ? worldLocationIds(world) : new Set();
  let mappedLocationId = typeof locationId === 'string' && locationIds.has(locationId) ? locationId : null;
  if (locationId && !mappedLocationId) {
    mappedLocationId = world?.start?.locationId || null;
    warnings.push(`旧位置 ${String(locationId).slice(0, 120)} 不属于目标世界，已回退到起点`);
  }
  const map = state.map && typeof state.map === 'object' ? state.map : {};
  if (map.imagePath && !/^\/images\/[A-Za-z0-9._-]{1,160}$/.test(map.imagePath)) warnings.push('旧地图图片路径不安全，已隔离');
  if (map.data && (!map.data || typeof map.data !== 'object' || !Number.isInteger(map.data.size) || !Array.isArray(map.data.grid))) warnings.push('旧地图数据格式异常，已隔离');
  return {
    canMigrate: errors.length === 0,
    source: { sessionId: typeof session?.id === 'string' ? session.id.slice(0, 120) : null, name: typeof session?.name === 'string' ? session.name.slice(0, 120) : '旧 RPG 会话', turns: messages.length },
    target: world ? { worldId: world.id, worldVersion: Number(world.version), title: world.title || world.id } : { worldId, worldVersion: requestedVersion || null, title: null },
    state: { locationId: mappedLocationId, inventory: Array.isArray(state.inventory) ? Math.min(state.inventory.length, 256) : 0, quests: Array.isArray(state.quests) ? Math.min(state.quests.length, 256) : 0, hasMap: !!(map.data || map.imagePath) },
    warnings,
    errors,
  };
}

function normalizeLegacyTurns(messages) {
  return (Array.isArray(messages) ? messages : []).slice(0, 5000).flatMap((msg, index) => {
    if (!msg || typeof msg !== 'object' || typeof msg.content !== 'string') return [];
    const role = ['user', 'assistant', 'system'].includes(msg.role) ? msg.role : 'assistant';
    return [{ role, content: msg.content.slice(0, 20000), ts: Number.isFinite(msg.ts) ? msg.ts : Date.now() + index }];
  });
}

function legacyState(envelope, world, report) {
  const source = envelope.session.rpgState && typeof envelope.session.rpgState === 'object' ? envelope.session.rpgState : {};
  const stats = source.stats && typeof source.stats === 'object' ? cloneJson(source.stats) : {};
  for (const key of ['level', 'exp', 'expNext', 'hp', 'maxHp', 'mp', 'maxMp', 'gold']) {
    if (stats[key] === undefined && Number.isFinite(source[key])) stats[key] = source[key];
  }
  const map = source.map && typeof source.map === 'object' ? source.map : {};
  const safeMap = {
    strategy: world.map?.strategy || 'perSave', baseMapId: world.map?.baseMapId || null,
    data: map.data && typeof map.data === 'object' ? cloneJson(map.data) : null,
    imagePath: /^\/images\/[A-Za-z0-9._-]{1,160}$/.test(map.imagePath || '') ? map.imagePath : null,
    discoveredLocationIds: report.state.locationId ? [report.state.locationId] : [], markers: [],
  };
  const state = {
    locationId: report.state.locationId,
    stats,
    inventory: Array.isArray(source.inventory) ? cloneJson(source.inventory).slice(0, 256) : [],
    quests: Array.isArray(source.quests) ? cloneJson(source.quests).slice(0, 256) : [],
    map: safeMap,
    ...(source.conflicts && typeof source.conflicts === 'object' && !Array.isArray(source.conflicts) ? { conflicts: cloneJson(source.conflicts) } : {}),
    ...(playerGrowthSchema(world) ? { growthCandidates: [], growthApplications: [], experiences: [] } : {}),
  };
  return {
    ...state,
    ...(worldConflictDefinitions(world).length && state.conflicts === undefined ? { conflicts: {} } : {}),
    ...materializePlayerEconomyState(world, state, null),
  };
}

async function readRpgMigrationRecord(migrationId) {
  const raw = await fs.promises.readFile(rpgMigrationPath(migrationId), 'utf-8');
  const record = JSON.parse(raw);
  if (!record || record.id !== migrationId || typeof record.raw !== 'string') throw new Error('RPG 迁移封存件无效');
  return record;
}

async function handleRpgMigrationPreview(req, res) {
  let payload;
  try { payload = await readJsonBody(req, WORLD_IMPORT_MAX_BYTES); }
  catch (err) { return send(res, err.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, JSON.stringify({ error: err.message }), 'application/json'); }
  if (!payload || typeof payload.raw !== 'string' || !payload.raw.trim()) return send(res, 400, JSON.stringify({ error: 'raw 必须是非空 JSON 文本' }), 'application/json');
  if (Buffer.byteLength(payload.raw, 'utf8') > WORLD_IMPORT_MAX_BYTES) return send(res, 413, JSON.stringify({ error: '旧 RPG 会话超过 2 MiB 限制' }), 'application/json');
  let envelope;
  try { envelope = JSON.parse(payload.raw); }
  catch { return send(res, 422, JSON.stringify({ error: '旧 RPG 会话 JSON 无效' }), 'application/json'); }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return send(res, 422, JSON.stringify({ error: '迁移封装必须是对象' }), 'application/json');
  let worlds;
  try { worlds = await loadWorlds(); }
  catch (err) { return send(res, 500, JSON.stringify({ error: '世界卡读取失败: ' + err.message }), 'application/json'); }
  const report = buildLegacyRpgMigrationReport(envelope, worlds);
  const id = newRpgMigrationId();
  const record = {
    schemaVersion: 1, id, kind: 'legacy-rpg-session', status: 'previewed', createdAt: Date.now(),
    raw: payload.raw, rawHash: sha256Text(payload.raw), report,
    source: report.source, target: report.target,
  };
  try {
    await fs.promises.mkdir(RPG_MIGRATIONS_DIR, { recursive: true });
    await writeJsonAtomic(rpgMigrationPath(id), record);
    send(res, report.canMigrate ? 201 : 422, JSON.stringify(rpgMigrationView(record)), 'application/json; charset=utf-8');
  } catch (err) {
    console.error('[rpg-migrations] 封存失败:', err.message);
    send(res, 500, JSON.stringify({ error: '旧 RPG 会话封存失败: ' + err.message }), 'application/json');
  }
}

async function handleRpgMigrationGet(req, res, migrationId) {
  if (!rpgMigrationPath(migrationId)) return send(res, 400, JSON.stringify({ error: '无效的 migrationId' }), 'application/json');
  try {
    const record = await readRpgMigrationRecord(migrationId);
    send(res, 200, JSON.stringify(rpgMigrationView(record)), 'application/json; charset=utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return send(res, 404, JSON.stringify({ error: '迁移记录不存在' }), 'application/json');
    send(res, 500, JSON.stringify({ error: '迁移记录读取失败: ' + err.message }), 'application/json');
  }
}

async function handleRpgMigrationCommit(req, res, migrationId) {
  const recordPath = rpgMigrationPath(migrationId);
  if (!recordPath) return send(res, 400, JSON.stringify({ error: '无效的 migrationId' }), 'application/json');
  return withWorldsLock(async () => {
    try {
      const record = await readRpgMigrationRecord(migrationId);
      if (record.status === 'committed' && record.saveId) {
        const committed = JSON.parse(await fs.promises.readFile(savePath(record.saveId), 'utf-8'));
        return send(res, 200, JSON.stringify({ migration: rpgMigrationView(record), save: committed, idempotent: true }), 'application/json; charset=utf-8');
      }
      if (sha256Text(record.raw) !== record.rawHash) return send(res, 409, JSON.stringify({ error: '迁移原件校验失败，已拒绝写入' }), 'application/json');
      const envelope = JSON.parse(record.raw);
      const worlds = await loadWorlds();
      const report = buildLegacyRpgMigrationReport(envelope, worlds);
      if (!report.canMigrate) return send(res, 422, JSON.stringify({ error: '迁移预演未通过', report }), 'application/json; charset=utf-8');
      const world = findWorldVersion(worlds, report.target.worldId, report.target.worldVersion);
      const saveId = migratedSaveId(migrationId);
      const fp = savePath(saveId);
      try {
        const existing = JSON.parse(await fs.promises.readFile(fp, 'utf-8'));
        if (existing?.migrationInfo?.migrationId === migrationId) {
          record.status = 'committed'; record.saveId = saveId; record.committedAt = record.committedAt || Date.now();
          await writeJsonAtomic(recordPath, record);
          return send(res, 200, JSON.stringify({ migration: rpgMigrationView(record), save: existing, idempotent: true }), 'application/json; charset=utf-8');
        }
        return send(res, 409, JSON.stringify({ error: '确定的迁移存档 ID 已被占用' }), 'application/json');
      } catch (err) { if (err.code !== 'ENOENT') throw err; }
      const now = Date.now();
      const session = envelope.session;
      const playerId = isSafeId(session.charId) ? session.charId : 'pc-' + saveId.slice(-24);
      const rawCharacter = envelope.characterSnapshot && typeof envelope.characterSnapshot === 'object' ? envelope.characterSnapshot : {};
      const redactedPaths = [];
      const player = sanitizeWorldPackageValue({ name: rawCharacter.name || '未命名冒险者', race: rawCharacter.race || '待定', role: rawCharacter.role || '旅人', ...rawCharacter }, 'player', redactedPaths);
      const state = legacyState(envelope, world, report);
      if (playerGrowthSchema(world) && state.growthCandidates === undefined) state.growthCandidates = [];
      const save = {
        schemaVersion: 1, id: saveId, name: String(envelope.name || session.name || '迁移的旧 RPG 会话').trim().slice(0, 120) || '迁移的旧 RPG 会话',
        worldId: world.id, worldVersion: Number(world.version), createdAt: now, updatedAt: now, revision: 0,
        player: { characterId: playerId, snapshot: player }, party: { memberIds: [playerId], leaderId: playerId }, state,
        npcStates: initialNpcStates(world, { locationId: state.locationId }), opening: String(session.opening || ''), turns: normalizeLegacyTurns(session.messages), receipts: [], generatedEntities: {},
        eventLedger: [{ id: ledgerEventId(saveId, 0), kind: 'migration', commandId: migrationId, sourceRevision: 0, revision: 0, locationId: state.locationId || null, time: state.time ? cloneJson(state.time) : null, migrationId, createdAt: now }],
        eventMemory: [],
        worldLineSummary: null,
        migrationHistory: [], migrationInfo: { kind: 'legacy-rpg-session', migrationId, sourceSessionId: report.source.sessionId, sourceHash: record.rawHash, migratedAt: now, redactedPaths },
      };
      const invalidSave = validateWorldSavePatch({ expectedRevision: 0, state: save.state, turns: save.turns, opening: save.opening });
      if (invalidSave) return send(res, 422, JSON.stringify({ error: '旧 RPG 状态无法安全写入', detail: invalidSave }), 'application/json');
      const economyStateInvalid = validatePlayerEconomyState(world, save.state);
      if (economyStateInvalid) return send(res, 422, JSON.stringify({ error: '旧 RPG 经济状态无法安全写入', detail: economyStateInvalid }), 'application/json');
      const conflictStateInvalid = validateConflictStates(world, save.state.conflicts);
      if (conflictStateInvalid) return send(res, 422, JSON.stringify({ error: '旧 RPG 冲突状态无法安全写入', detail: conflictStateInvalid }), 'application/json');
      const growthCandidateInvalid = validateGrowthCandidates(world, save.state.growthCandidates);
      if (growthCandidateInvalid) return send(res, 422, JSON.stringify({ error: '旧 RPG 成长候选无法安全写入', detail: growthCandidateInvalid }), 'application/json');
      const growthApplicationsInvalid = validateGrowthApplications(world, save.state.growthApplications);
      if (growthApplicationsInvalid) return send(res, 422, JSON.stringify({ error: '旧 RPG 成长应用无法安全写入', detail: growthApplicationsInvalid }), 'application/json');
      const experiencesInvalid = validateGrowthExperiences(world, save.state.experiences);
      if (experiencesInvalid) return send(res, 422, JSON.stringify({ error: '旧 RPG 人物经历无法安全写入', detail: experiencesInvalid }), 'application/json');
      const growthCrossRefInvalid = validateGrowthStateCrossRefs(save.state);
      if (growthCrossRefInvalid) return send(res, 422, JSON.stringify({ error: '旧 RPG 成长引用无法安全写入', detail: growthCrossRefInvalid }), 'application/json');
      await fs.promises.mkdir(SAVES_DIR, { recursive: true });
      await writeJsonAtomic(fp, save);
      record.status = 'committed'; record.saveId = saveId; record.committedAt = now; record.report = report;
      await writeJsonAtomic(recordPath, record);
      send(res, 201, JSON.stringify({ migration: rpgMigrationView(record), save, idempotent: false }), 'application/json; charset=utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') return send(res, 404, JSON.stringify({ error: '迁移记录或目标文件不存在' }), 'application/json');
      console.error('[rpg-migrations] 提交失败:', err.message);
      send(res, 500, JSON.stringify({ error: '旧 RPG 会话迁移失败: ' + err.message }), 'application/json');
    }
  });
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
      const playerCreationInvalid = validatePlayerCreationSchema(payload.playerCreation, current.world);
      if (playerCreationInvalid) return send(res, 400, JSON.stringify({ error: playerCreationInvalid }), 'application/json');
      const turnContractInvalid = validateTurnContract(payload.turnContract);
      if (turnContractInvalid) return send(res, 400, JSON.stringify({ error: turnContractInvalid }), 'application/json');
      const endingInvalid = validateWorldEnding(payload.ending);
      if (endingInvalid) return send(res, 400, JSON.stringify({ error: endingInvalid }), 'application/json');
      const collectionsInvalid = validateWorldDraftCollections(payload, current.world);
      if (collectionsInvalid) return send(res, 400, JSON.stringify({ error: collectionsInvalid }), 'application/json');
      const eventsInvalid = validateWorldEvents(payload.events, { ...current.world, locations: payload.locations ?? current.world.locations });
      if (eventsInvalid) return send(res, 400, JSON.stringify({ error: eventsInvalid }), 'application/json');
      const factionsInvalid = validateWorldFactions(payload.factions, { ...current.world, locations: payload.locations ?? current.world.locations });
      if (factionsInvalid) return send(res, 400, JSON.stringify({ error: factionsInvalid }), 'application/json');
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

async function handleWorldDraftCheck(req, res, worldId) {
  if (!isSafeId(worldId)) return send(res, 400, JSON.stringify({ error: '无效的 worldId' }), 'application/json');
  try {
    const [drafts, worlds] = await Promise.all([loadWorldDrafts(), loadWorlds()]);
    const draft = drafts.find(item => item?.worldId === worldId);
    if (!draft) return send(res, 404, JSON.stringify({ error: '世界草稿不存在' }), 'application/json');
    const report = await worldDraftPublicationCheck(draft, worlds);
    send(res, 200, JSON.stringify({ ...report, worldId, updatedAt: draft.updatedAt, baseVersion: draft.baseVersion }), 'application/json; charset=utf-8');
  } catch (err) {
    console.error('[world-drafts] 发布检查失败:', err.message);
    send(res, 500, JSON.stringify({ error: '发布检查失败: ' + err.message }), 'application/json');
  }
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
      const report = await worldDraftPublicationCheck(current, worlds);
      if (!report.ready) return send(res, 400, JSON.stringify({ error: report.errors[0].message, report }), 'application/json');
      const publishedAt = Date.now();
      const nextWorld = report.world;
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

async function handleWorldVersionsGet(req, res, worldId) {
  if (!isSafeId(worldId)) return send(res, 400, JSON.stringify({ error: '无效的 worldId' }), 'application/json');
  try {
    const versions = worldVersions(await loadWorlds(), worldId);
    if (!versions.length) return send(res, 404, JSON.stringify({ error: '世界卡不存在' }), 'application/json');
    send(res, 200, JSON.stringify(versions.map(world => worldSummary(world))), 'application/json; charset=utf-8');
  } catch (err) {
    console.error('[worlds] 版本列表读取失败:', err.message);
    send(res, 500, JSON.stringify({ error: '世界版本列表读取失败: ' + err.message }), 'application/json');
  }
}

async function describeWorldPackageAsset(role, ownerId, uri) {
  const entry = { id: `${role}:${ownerId}`, role, ownerId, uri };
  if (/^https?:\/\//i.test(uri)) return { ...entry, status: 'external', sha256: null };
  if (!/^\/images\/[A-Za-z0-9._-]{1,160}$/.test(uri)) return { ...entry, status: 'unresolved', sha256: null };
  try {
    const data = await fs.promises.readFile(path.join(IMAGES_DIR, path.basename(uri)));
    return {
      ...entry,
      status: 'available',
      mime: MIME[path.extname(uri).toLowerCase()]?.split(';')[0] || 'application/octet-stream',
      bytes: data.length,
      sha256: 'sha256:' + crypto.createHash('sha256').update(data).digest('hex'),
    };
  } catch (err) {
    if (err.code === 'ENOENT') return { ...entry, status: 'missing', sha256: null };
    throw err;
  }
}

async function buildWorldPackage(world) {
  const [rawCharacters, rawLorebooks, rawPresets] = await Promise.all([
    loadDataDocument('characters'), loadDataDocument('lorebooks'), loadDataDocument('presets'),
  ]);
  if (!Array.isArray(rawCharacters) || !rawLorebooks || typeof rawLorebooks !== 'object' || Array.isArray(rawLorebooks)
    || !rawPresets || typeof rawPresets !== 'object' || Array.isArray(rawPresets)) {
    throw new Error('角色、世界书或预设数据格式无效');
  }

  const warnings = [];
  const localNpcIds = new Set((Array.isArray(world.npcs) ? world.npcs : []).map(npc => npc?.id).filter(isSafeId));
  const requestedCharacterIds = new Set();
  if (isSafeId(world.start?.playerTemplateId)) requestedCharacterIds.add(world.start.playerTemplateId);
  for (const id of Array.isArray(world.characterIds) ? world.characterIds : []) if (isSafeId(id)) requestedCharacterIds.add(id);
  for (const id of Array.isArray(world.npcIds) ? world.npcIds : []) if (isSafeId(id) && !localNpcIds.has(id)) requestedCharacterIds.add(id);
  const characters = rawCharacters.filter(character => requestedCharacterIds.has(character?.id));
  const characterById = new Set(characters.map(character => character.id));
  for (const id of requestedCharacterIds) {
    if (!characterById.has(id) && !localNpcIds.has(id)) warnings.push(`缺少角色引用：${id}`);
  }

  const lorebookIds = new Set(Array.isArray(world.lorebookIds) && world.lorebookIds.length ? world.lorebookIds : ['default']);
  const presetNames = new Set(typeof world.rpgPresetName === 'string' && world.rpgPresetName ? [world.rpgPresetName] : []);
  for (const character of characters) {
    if (isSafeId(character.loreId)) lorebookIds.add(character.loreId);
    if (typeof character.presetName === 'string' && character.presetName) presetNames.add(character.presetName);
  }
  const lorebooks = {};
  for (const id of lorebookIds) {
    if (typeof id === 'string' && Object.hasOwn(rawLorebooks, id)) lorebooks[id] = rawLorebooks[id];
    else if (isSafeId(id)) warnings.push(`缺少世界书引用：${id}`);
  }
  const presets = {};
  for (const name of presetNames) {
    if (Object.hasOwn(rawPresets, name)) presets[name] = rawPresets[name];
    else warnings.push(`缺少预设引用：${name}`);
  }

  const redactedPaths = [];
  const content = sanitizeWorldPackageValue({ world, characters, lorebooks, presets }, 'content', redactedPaths);
  const assetRefs = [];
  const addAsset = (role, ownerId, uri) => {
    if (typeof uri === 'string' && uri) assetRefs.push({ role, ownerId, uri });
  };
  addAsset('world-cover', content.world.id, content.world.coverImage);
  addAsset('source-asset', content.world.id, content.world.source?.rawAssetRef);
  for (const character of content.characters) addAsset('character-reference', character.id, character.refImage);
  for (const npc of Array.isArray(content.world.npcs) ? content.world.npcs : []) addAsset('npc-reference', npc.id, npc.refImage);
  const uniqueAssetRefs = [...new Map(assetRefs.map(asset => [`${asset.role}\0${asset.ownerId}\0${asset.uri}`, asset])).values()];
  const assets = await Promise.all(uniqueAssetRefs.map(asset => describeWorldPackageAsset(asset.role, asset.ownerId, asset.uri)));
  const regexTriggers = Object.values(content.lorebooks).reduce((count, lorebook) => count + (Array.isArray(lorebook?.entries)
    ? lorebook.entries.reduce((sum, entry) => sum + String(entry?.keys || '').split(',').filter(key => /^\s*\/.*\/[a-z]*\s*$/i.test(key)).length, 0)
    : 0), 0);
  const payload = { content, assets };
  return {
    spec: WORLD_PACKAGE_SPEC,
    specVersion: WORLD_PACKAGE_VERSION,
    exportedAt: new Date().toISOString(),
    manifest: {
      packageId: world.id,
      worldVersion: Number(world.version),
      worldSchemaVersion: Number(world.schemaVersion || 1),
      title: String(world.title || world.id),
      author: typeof (world.author || world.source?.author) === 'string' ? (world.author || world.source.author) : null,
      license: typeof (world.license || world.source?.license) === 'string' ? (world.license || world.source.license) : null,
      source: content.world.source || { format: 'native', rawAssetRef: null },
      contentHash: sha256Json(payload),
      hashScope: 'canonical-json(content,assets)',
      references: { characters: content.characters.length, lorebooks: Object.keys(content.lorebooks).length, presets: Object.keys(content.presets).length, assets: assets.length },
      privacy: { excludes: ['settings', 'user', 'worldSaves'], redactedPaths: [...new Set(redactedPaths)].sort() },
      executableContent: { html: false, scripts: false, regexTriggers, executedDuringExport: false },
      warnings,
    },
    ...payload,
  };
}

async function handleWorldPackageExport(req, res, worldId, version) {
  if (!isSafeId(worldId)) return send(res, 400, JSON.stringify({ error: '无效的 worldId' }), 'application/json');
  try {
    const worlds = await loadWorlds();
    const world = version === undefined ? latestWorld(worlds, worldId) : findWorldVersion(worlds, worldId, version);
    if (!world) return send(res, 404, JSON.stringify({ error: '世界卡版本不存在' }), 'application/json');
    const worldPackage = await buildWorldPackage(world);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${world.id}-v${Number(world.version)}.tavern-world.json"`,
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(worldPackage, null, 2));
  } catch (err) {
    console.error('[worlds] 世界包导出失败:', err.message);
    send(res, 500, JSON.stringify({ error: '世界包导出失败: ' + err.message }), 'application/json');
  }
}

function collectInertImportPaths(value, pathPrefix, paths) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    if (/(?:script|ejs|mvu|macro|javascript)/i.test(key)) paths.push(childPath);
    collectInertImportPaths(child, childPath, paths);
  }
}

function collectUnsafeWorldPackagePaths(value, pathPrefix, paths) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectUnsafeWorldPackagePaths(item, `${pathPrefix}[${index}]`, paths));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    const normalizedKey = key.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    if (isExportSecretKey(key) || EXPORT_PRIVATE_KEYS.has(normalizedKey)) paths.push(childPath);
    else if (EXPORT_ASSET_KEYS.has(key) && !portableAssetRef(child)) paths.push(childPath);
    collectUnsafeWorldPackagePaths(child, childPath, paths);
  }
}

function worldPackageRegexEntries(lorebooks) {
  const entries = [];
  for (const [lorebookId, lorebook] of Object.entries(lorebooks || {})) {
    for (const [index, entry] of (Array.isArray(lorebook?.entries) ? lorebook.entries : []).entries()) {
      for (const key of String(entry?.keys || '').split(',').map(value => value.trim()).filter(Boolean)) {
        if (!key.startsWith('/') || key.lastIndexOf('/') <= 0) continue;
        const end = key.lastIndexOf('/');
        entries.push({ lorebookId, index, key, pattern: key.slice(1, end), flags: key.slice(end + 1) });
      }
    }
  }
  return entries;
}

function worldPackageImportReport(pkg) {
  const errors = [];
  const warnings = [];
  const unknownTopLevelKeys = [];
  const inertPaths = [];
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return { canImport: false, errors: ['世界包根节点必须是 JSON 对象'], warnings, unknownTopLevelKeys, inertPaths };
  for (const key of Object.keys(pkg)) {
    if (!['spec', 'specVersion', 'exportedAt', 'manifest', 'content', 'assets'].includes(key)) {
      unknownTopLevelKeys.push(key);
      collectInertImportPaths({ [key]: pkg[key] }, '', inertPaths);
    }
  }
  if (pkg.spec !== WORLD_PACKAGE_SPEC) errors.push('不支持的世界包 spec');
  if (pkg.specVersion !== WORLD_PACKAGE_VERSION) errors.push('不支持的世界包版本');
  const content = pkg.content;
  if (!content || typeof content !== 'object' || Array.isArray(content)) errors.push('世界包缺少 content 对象');
  const world = content?.world;
  if (!world || typeof world !== 'object' || Array.isArray(world)) errors.push('世界包缺少 world 定义');
  else {
    if (!isSafeId(world.id)) errors.push('world.id 无效');
    if (!Number.isSafeInteger(world.version) || world.version < 1) errors.push('world.version 无效');
    if (typeof world.title !== 'string' || !world.title.trim() || world.title.length > 200) errors.push('world.title 无效');
    const settingInvalid = validateWorldSetting(world.setting);
    if (settingInvalid) errors.push(settingInvalid);
    const rulesInvalid = validateWorldAuthorRules(world.rules);
    if (rulesInvalid) errors.push(rulesInvalid);
    const playerCreationInvalid = validatePlayerCreationSchema(world.playerCreation, world);
    if (playerCreationInvalid) errors.push(playerCreationInvalid);
    const turnContractInvalid = validateTurnContract(world.turnContract);
    if (turnContractInvalid) errors.push(turnContractInvalid);
    const failureInvalid = validateWorldFailure(world.failure);
    if (failureInvalid) errors.push(failureInvalid);
    const endingInvalid = validateWorldEnding(world.ending);
    if (endingInvalid) errors.push(endingInvalid);
    const timeInvalid = validateWorldTime(world.time);
    if (timeInvalid) errors.push(timeInvalid);
    const factionsInvalid = validateWorldFactions(world.factions, world);
    if (factionsInvalid) errors.push(factionsInvalid);
    const conflictsInvalid = validateConflictTemplates(world.conflicts);
    if (conflictsInvalid) errors.push(conflictsInvalid);
  }
  if (!Array.isArray(content?.characters) || content.characters.length > 256) errors.push('characters 必须是至多 256 项的数组');
  if (!content?.lorebooks || typeof content.lorebooks !== 'object' || Array.isArray(content.lorebooks)) errors.push('lorebooks 必须是对象');
  if (!content?.presets || typeof content.presets !== 'object' || Array.isArray(content.presets)) errors.push('presets 必须是对象');
  if (!Array.isArray(pkg.assets) || pkg.assets.length > 256) errors.push('assets 必须是至多 256 项的数组');
  if (content && ['settings', 'user', 'worldSaves'].some(key => Object.hasOwn(content, key))) errors.push('世界包不得包含运行时设置或玩家存档');
  const unsafePaths = [];
  collectUnsafeWorldPackagePaths(content, 'content', unsafePaths);
  if (unsafePaths.length) errors.push(`世界包包含私密或不安全字段：${unsafePaths.slice(0, 4).join('、')}${unsafePaths.length > 4 ? '…' : ''}`);
  collectInertImportPaths(content, 'content', inertPaths);
  if (pkg.manifest?.contentHash !== sha256Json({ content: pkg.content, assets: pkg.assets })) errors.push('contentHash 校验失败');
  if (errors.length) return { canImport: false, errors, warnings, unknownTopLevelKeys, inertPaths };

  const characters = content.characters;
  const characterIds = new Set();
  for (const character of characters) {
    if (!character || typeof character !== 'object' || !isSafeId(character.id) || characterIds.has(character.id)) errors.push('characters 包含重复或无效 ID');
    else characterIds.add(character.id);
  }
  const lorebookIds = new Set(Object.keys(content.lorebooks));
  if ([...lorebookIds].some(id => !isSafeId(id))) errors.push('lorebooks 包含无效 ID');
  const presetNames = new Set(Object.keys(content.presets));
  if ([...presetNames].some(name => !name || name.length > 200)) errors.push('presets 包含无效名称');
  const embeddedNpcIds = new Set((Array.isArray(world.npcs) ? world.npcs : []).map(npc => npc?.id).filter(isSafeId));
  const referencedCharacterIds = new Set();
  if (world.start?.playerTemplateId && !isSafeId(world.start.playerTemplateId)) errors.push('start.playerTemplateId 无效');
  if (isSafeId(world.start?.playerTemplateId)) referencedCharacterIds.add(world.start.playerTemplateId);
  for (const key of ['characterIds', 'npcIds']) {
    if (world[key] !== undefined && (!Array.isArray(world[key]) || world[key].some(id => !isSafeId(id)))) errors.push(`${key} 包含无效 ID`);
  }
  for (const id of Array.isArray(world.characterIds) ? world.characterIds : []) if (isSafeId(id)) referencedCharacterIds.add(id);
  for (const id of Array.isArray(world.npcIds) ? world.npcIds : []) if (isSafeId(id) && !embeddedNpcIds.has(id)) referencedCharacterIds.add(id);
  for (const id of referencedCharacterIds) if (!characterIds.has(id)) errors.push(`缺少角色引用：${id}`);
  for (const key of ['factionIds', 'itemIds', 'questTemplateIds']) {
    if (Array.isArray(world[key]) && world[key].length) errors.push(`${key} 尚无随世界包导入的定义`);
  }
  if (world.lorebookIds !== undefined && (!Array.isArray(world.lorebookIds) || world.lorebookIds.some(id => !isSafeId(id)))) errors.push('lorebookIds 包含无效 ID');
  const effectiveLorebookIds = Array.isArray(world.lorebookIds) && world.lorebookIds.length ? world.lorebookIds : ['default'];
  for (const id of effectiveLorebookIds) if (!lorebookIds.has(id)) errors.push(`缺少世界书引用：${id}`);
  if (world.rpgPresetName !== undefined && typeof world.rpgPresetName !== 'string') errors.push('rpgPresetName 无效');
  if (world.rpgPresetName && !presetNames.has(world.rpgPresetName)) errors.push(`缺少预设引用：${world.rpgPresetName}`);
  for (const character of characters) {
    if (character?.loreId && !lorebookIds.has(character.loreId)) errors.push(`角色 ${character.id} 缺少世界书：${character.loreId}`);
    if (character?.presetName && !presetNames.has(character.presetName)) errors.push(`角色 ${character.id} 缺少预设：${character.presetName}`);
  }
  const regexEntries = worldPackageRegexEntries(content.lorebooks);
  for (const regex of regexEntries) {
    if (regex.pattern.length > 500 || !/^[dgimsuvy]*$/.test(regex.flags)) errors.push(`世界书正则无效：${regex.lorebookId}.entries[${regex.index}]`);
    else {
      try { new RegExp(regex.pattern, regex.flags); }
      catch { errors.push(`世界书正则无效：${regex.lorebookId}.entries[${regex.index}]`); }
    }
  }
  if (pkg.manifest?.executableContent?.scripts) warnings.push('包声明含脚本；将仅封存，不会执行');
  if (regexEntries.length) warnings.push(`世界书含 ${regexEntries.length} 个正则触发器；已保留，导入后默认禁用`);
  if (unknownTopLevelKeys.length) warnings.push(`保留 ${unknownTopLevelKeys.length} 个未知顶层字段，仅封存在原件中`);
  return {
    canImport: errors.length === 0,
    errors,
    warnings,
    unknownTopLevelKeys,
    inertPaths,
    references: { characters: characters.length, lorebooks: lorebookIds.size, presets: presetNames.size, assets: pkg.assets.length },
    disabledRegexEntries: regexEntries.length,
  };
}

function worldImportView(record) {
  return {
    id: record.id,
    status: record.status,
    createdAt: record.createdAt,
    committedAt: record.committedAt || null,
    rawHash: record.rawHash,
    source: record.source || null,
    report: record.report,
    importedWorld: record.importedWorld || null,
  };
}

async function loadWorldImport(importId) {
  const fp = worldImportPath(importId);
  if (!fp) return null;
  try { return JSON.parse(await fs.promises.readFile(fp, 'utf-8')); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}

async function handleWorldPackageImportPreview(req, res) {
  let payload;
  try { payload = await readJsonBody(req, WORLD_IMPORT_MAX_BYTES + 64 * 1024); }
  catch (err) { return send(res, err.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, JSON.stringify({ error: err.message }), 'application/json'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.raw !== 'string' || !payload.raw.trim()) {
    return send(res, 400, JSON.stringify({ error: '请提交世界包原文' }), 'application/json');
  }
  if (Buffer.byteLength(payload.raw, 'utf8') > WORLD_IMPORT_MAX_BYTES) return send(res, 413, JSON.stringify({ error: '世界包超过 2 MiB 限制' }), 'application/json');
  let pkg = null;
  let parseError = null;
  try { pkg = JSON.parse(payload.raw); } catch { parseError = '世界包不是有效 JSON'; }
  let report;
  try { report = parseError ? { canImport: false, errors: [parseError], warnings: [], unknownTopLevelKeys: [], inertPaths: [] } : worldPackageImportReport(pkg); }
  catch { report = { canImport: false, errors: ['世界包结构过深或无法安全检查'], warnings: [], unknownTopLevelKeys: [], inertPaths: [] }; }
  const importId = newWorldImportId();
  const record = {
    schemaVersion: 1,
    id: importId,
    status: 'pending',
    createdAt: Date.now(),
    rawHash: sha256Text(payload.raw),
    raw: payload.raw,
    source: pkg?.manifest ? { packageId: pkg.manifest.packageId || null, worldVersion: pkg.manifest.worldVersion || null, contentHash: pkg.manifest.contentHash || null } : null,
    report,
  };
  try {
    await fs.promises.mkdir(WORLD_IMPORTS_DIR, { recursive: true });
    await writeJsonAtomic(worldImportPath(importId), record);
    send(res, report.canImport ? 201 : 422, JSON.stringify(worldImportView(record)), 'application/json; charset=utf-8');
  } catch (err) {
    console.error('[world-imports] 封存失败:', err.message);
    send(res, 500, JSON.stringify({ error: '世界包封存失败: ' + err.message }), 'application/json');
  }
}

function mapImportedWorldPackage(pkg, importId, rawHash) {
  const content = cloneJson(pkg.content);
  const sourceWorld = content.world;
  const characterIdMap = new Map(content.characters.map(character => [character.id, importedEntityId('char', importId, character.id)]));
  const lorebookIdMap = new Map(Object.keys(content.lorebooks).map(id => [id, importedEntityId('lore', importId, id)]));
  const presetNameMap = new Map(Object.keys(content.presets).map(name => [name, `导入 · ${importId.slice(-8)} · ${name}`]));
  const worldId = importedEntityId('world', importId, sourceWorld.id);
  const localNpcIds = new Set((Array.isArray(sourceWorld.npcs) ? sourceWorld.npcs : []).map(npc => npc?.id).filter(isSafeId));
  const remapCharacter = id => characterIdMap.get(id) || id;
  const world = {
    ...sourceWorld,
    id: worldId,
    version: 1,
    characterIds: Array.isArray(sourceWorld.characterIds) ? sourceWorld.characterIds.map(remapCharacter) : [],
    npcIds: Array.isArray(sourceWorld.npcIds) ? sourceWorld.npcIds.map(id => localNpcIds.has(id) ? id : remapCharacter(id)) : [],
    lorebookIds: (Array.isArray(sourceWorld.lorebookIds) && sourceWorld.lorebookIds.length ? sourceWorld.lorebookIds : ['default']).map(id => lorebookIdMap.get(id) || id),
    rpgPresetName: presetNameMap.get(sourceWorld.rpgPresetName) || sourceWorld.rpgPresetName || '',
    start: sourceWorld.start && typeof sourceWorld.start === 'object' ? { ...sourceWorld.start, playerTemplateId: remapCharacter(sourceWorld.start.playerTemplateId) } : sourceWorld.start,
    importInfo: { importId, sourceWorldId: sourceWorld.id, sourceWorldVersion: sourceWorld.version, importedAt: Date.now(), rawHash },
  };
  const characters = content.characters.map(character => ({
    ...character,
    id: characterIdMap.get(character.id),
    loreId: lorebookIdMap.get(character.loreId) || character.loreId || '',
    presetName: presetNameMap.get(character.presetName) || character.presetName || '',
    importInfo: { importId, sourceId: character.id },
  }));
  const lorebooks = Object.fromEntries(Object.entries(content.lorebooks).map(([id, lorebook]) => [lorebookIdMap.get(id), {
    ...lorebook,
    entries: Array.isArray(lorebook.entries) ? lorebook.entries.map(entry => {
      const hasRegex = worldPackageRegexEntries({ [id]: { entries: [entry] } }).length > 0;
      return hasRegex ? { ...entry, enabled: false, importInfo: { importId, regexDisabledOnImport: true } } : entry;
    }) : lorebook.entries,
    importInfo: { importId, sourceId: id },
  }]));
  const presets = Object.fromEntries(Object.entries(content.presets).map(([name, preset]) => [presetNameMap.get(name), {
    ...preset,
    importInfo: { importId, sourceName: name },
  }]));
  return { world, characters, lorebooks, presets };
}

function mergeImportedArray(existing, incoming, importId) {
  const ids = new Set(existing.map(item => item?.id));
  for (const item of incoming) {
    const matched = existing.find(candidate => candidate?.id === item.id);
    if (matched?.importInfo?.importId === importId) continue;
    if (ids.has(item.id)) throw new Error('导入实体 ID 冲突');
    existing.push(item);
    ids.add(item.id);
  }
  return existing;
}

async function handleWorldPackageImportCommit(req, res, importId) {
  if (!isSafeId(importId)) return send(res, 400, JSON.stringify({ error: '无效的 importId' }), 'application/json');
  return withWorldsLock(async () => {
    try {
      const record = await loadWorldImport(importId);
      if (!record) return send(res, 404, JSON.stringify({ error: '世界包封存不存在' }), 'application/json');
      if (record.status === 'committed') return send(res, 200, JSON.stringify({ import: worldImportView(record), world: record.importedWorld, idempotent: true }), 'application/json; charset=utf-8');
      if (sha256Text(record.raw || '') !== record.rawHash) return send(res, 409, JSON.stringify({ error: '封存世界包哈希不一致，已拒绝导入' }), 'application/json');
      let pkg;
      try { pkg = JSON.parse(record.raw); } catch { return send(res, 409, JSON.stringify({ error: '封存世界包无法重新解析' }), 'application/json'); }
      let report;
      try { report = worldPackageImportReport(pkg); }
      catch { return send(res, 409, JSON.stringify({ error: '封存世界包结构过深或无法安全检查' }), 'application/json'); }
      if (!report.canImport) return send(res, 409, JSON.stringify({ error: '世界包未通过导入校验', report }), 'application/json');
      const mapped = mapImportedWorldPackage(pkg, importId, record.rawHash);
      const [worlds, characters, lorebooks, presets] = await Promise.all([loadWorlds(), loadDataDocument('characters'), loadDataDocument('lorebooks'), loadDataDocument('presets')]);
      const existingWorld = worlds.find(world => world?.id === mapped.world.id);
      if (existingWorld?.importInfo?.importId !== importId && existingWorld) throw new Error('导入世界 ID 冲突');
      mergeImportedArray(characters, mapped.characters, importId);
      for (const [id, lorebook] of Object.entries(mapped.lorebooks)) {
        if (lorebooks[id]?.importInfo?.importId !== importId && lorebooks[id]) throw new Error('导入世界书 ID 冲突');
        if (!lorebooks[id]) lorebooks[id] = lorebook;
      }
      for (const [name, preset] of Object.entries(mapped.presets)) {
        if (presets[name]?.importInfo?.importId !== importId && presets[name]) throw new Error('导入预设名称冲突');
        if (!presets[name]) presets[name] = preset;
      }
      if (!existingWorld) worlds.push(mapped.world);
      await writeJsonAtomic(path.join(DATA_DIR, 'characters.json'), characters);
      await writeJsonAtomic(path.join(DATA_DIR, 'lorebooks.json'), lorebooks);
      await writeJsonAtomic(path.join(DATA_DIR, 'presets.json'), presets);
      await writeJsonAtomic(path.join(DATA_DIR, 'worlds.json'), worlds);
      record.status = 'committed';
      record.committedAt = Date.now();
      record.report = report;
      record.importedWorld = worldSummary(mapped.world);
      await writeJsonAtomic(worldImportPath(importId), record);
      send(res, 201, JSON.stringify({ import: worldImportView(record), world: record.importedWorld, idempotent: false }), 'application/json; charset=utf-8');
    } catch (err) {
      console.error('[world-imports] 导入失败:', err.message);
      send(res, 500, JSON.stringify({ error: '世界包导入失败: ' + err.message }), 'application/json');
    }
  });
}

async function handleWorldPackageImportGet(req, res, importId) {
  if (!isSafeId(importId)) return send(res, 400, JSON.stringify({ error: '无效的 importId' }), 'application/json');
  try {
    const record = await loadWorldImport(importId);
    if (!record) return send(res, 404, JSON.stringify({ error: '世界包封存不存在' }), 'application/json');
    send(res, 200, JSON.stringify(worldImportView(record)), 'application/json; charset=utf-8');
  } catch (err) {
    console.error('[world-imports] 读取失败:', err.message);
    send(res, 500, JSON.stringify({ error: '世界包封存读取失败: ' + err.message }), 'application/json');
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

function resolveWorldSaveUpgrade(worlds, save, targetVersion) {
  const sourceWorld = findWorldVersion(worlds, save.worldId, save.worldVersion);
  if (!sourceWorld) return { status: 409, error: '存档绑定的世界版本不存在' };
  const targetWorld = findWorldVersion(worlds, save.worldId, targetVersion);
  if (!targetWorld) return { status: 404, error: '目标世界版本不存在' };
  if (Number(targetWorld.version) <= Number(save.worldVersion)) return { status: 400, error: '目标版本必须高于存档当前版本' };
  return { sourceWorld, targetWorld, report: worldSaveUpgradeReport(save, sourceWorld, targetWorld) };
}

async function handleWorldSaveUpgradePreview(req, res, saveId, targetVersion) {
  const fp = savePath(saveId);
  if (!fp) return send(res, 400, JSON.stringify({ error: '无效的 saveId' }), 'application/json');
  return withWorldSaveLock(saveId, async () => {
    try {
      const save = JSON.parse(await fs.promises.readFile(fp, 'utf-8'));
      if (!save || save.id !== saveId) throw new Error('存档文件 ID 不一致');
      const resolved = resolveWorldSaveUpgrade(await loadWorlds(), save, targetVersion);
      if (resolved.error) return send(res, resolved.status, JSON.stringify({ error: resolved.error }), 'application/json');
      send(res, 200, JSON.stringify(resolved.report), 'application/json; charset=utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') return send(res, 404, JSON.stringify({ error: '存档不存在' }), 'application/json');
      console.error('[world-saves] 升级预演失败:', err.message);
      send(res, 500, JSON.stringify({ error: '存档升级预演失败: ' + err.message }), 'application/json');
    }
  });
}

async function handleWorldSaveUpgrade(req, res, saveId) {
  const fp = savePath(saveId);
  if (!fp) return send(res, 400, JSON.stringify({ error: '无效的 saveId' }), 'application/json');
  let payload;
  try { payload = await readJsonBody(req, 64 * 1024); }
  catch (err) {
    const status = err.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
    return send(res, status, JSON.stringify({ error: err.message }), 'application/json');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return send(res, 400, JSON.stringify({ error: '请求必须是 JSON 对象' }), 'application/json');
  if (!Number.isSafeInteger(payload.targetVersion) || payload.targetVersion < 1) return send(res, 400, JSON.stringify({ error: 'targetVersion 必须是正整数' }), 'application/json');
  if (!Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0) return send(res, 400, JSON.stringify({ error: 'expectedRevision 必须是非负整数' }), 'application/json');
  if (typeof payload.commandId !== 'string' || !COMMAND_ID_RE.test(payload.commandId)) return send(res, 400, JSON.stringify({ error: 'commandId 无效' }), 'application/json');
  return withWorldSaveLock(saveId, async () => {
    try {
      const current = JSON.parse(await fs.promises.readFile(fp, 'utf-8'));
      if (!current || current.id !== saveId) throw new Error('存档文件 ID 不一致');
      const history = Array.isArray(current.migrationHistory) ? current.migrationHistory : [];
      const existing = history.find(entry => entry?.commandId === payload.commandId);
      if (existing) {
        if (Number(existing.toVersion) !== payload.targetVersion || Number(existing.revision) - 1 !== payload.expectedRevision) return send(res, 409, JSON.stringify({ error: 'commandId 已用于其他升级请求' }), 'application/json');
        const report = { saveId, worldId: current.worldId, fromVersion: existing.fromVersion, targetVersion: existing.toVersion, targetTitle: existing.targetTitle, canUpgrade: true, changes: existing.changes, hardErrors: [] };
        return send(res, 200, JSON.stringify({ save: current, report, idempotent: true }), 'application/json; charset=utf-8');
      }
      if (current.revision !== payload.expectedRevision) {
        return send(res, 409, JSON.stringify({ error: '存档版本冲突，请重新预演', revision: current.revision }), 'application/json');
      }
      const resolved = resolveWorldSaveUpgrade(await loadWorlds(), current, payload.targetVersion);
      if (resolved.error) return send(res, resolved.status, JSON.stringify({ error: resolved.error }), 'application/json');
      if (!resolved.report.canUpgrade) return send(res, 409, JSON.stringify({ error: '存档包含目标版本缺失的引用', report: resolved.report }), 'application/json; charset=utf-8');
      const conflictStateInvalid = validateConflictTemplates(resolved.targetWorld.conflicts);
      if (conflictStateInvalid) return send(res, 409, JSON.stringify({ error: conflictStateInvalid }), 'application/json');
      const targetConflictState = current.state?.conflicts === undefined && worldConflictDefinitions(resolved.targetWorld).length ? {} : current.state?.conflicts;
      const targetConflictStateInvalid = validateConflictStates(resolved.targetWorld, targetConflictState);
      if (targetConflictStateInvalid) return send(res, 409, JSON.stringify({ error: targetConflictStateInvalid }), 'application/json');
      const targetGrowthCandidates = current.state?.growthCandidates === undefined && playerGrowthSchema(resolved.targetWorld) ? [] : current.state?.growthCandidates;
      const targetGrowthCandidateInvalid = validateGrowthCandidates(resolved.targetWorld, targetGrowthCandidates);
      if (targetGrowthCandidateInvalid) return send(res, 409, JSON.stringify({ error: targetGrowthCandidateInvalid }), 'application/json');
      const targetGrowthApplications = current.state?.growthApplications === undefined && playerGrowthSchema(resolved.targetWorld) ? [] : current.state?.growthApplications;
      const targetGrowthApplicationsInvalid = validateGrowthApplications(resolved.targetWorld, targetGrowthApplications);
      if (targetGrowthApplicationsInvalid) return send(res, 409, JSON.stringify({ error: targetGrowthApplicationsInvalid }), 'application/json');
      const targetExperiences = current.state?.experiences === undefined && playerGrowthSchema(resolved.targetWorld) ? [] : current.state?.experiences;
      const targetExperiencesInvalid = validateGrowthExperiences(resolved.targetWorld, targetExperiences);
      if (targetExperiencesInvalid) return send(res, 409, JSON.stringify({ error: targetExperiencesInvalid }), 'application/json');
      const targetGrowthCrossRefInvalid = validateGrowthStateCrossRefs({ growthCandidates: targetGrowthCandidates, growthApplications: targetGrowthApplications, experiences: targetExperiences });
      if (targetGrowthCrossRefInvalid) return send(res, 409, JSON.stringify({ error: targetGrowthCrossRefInvalid }), 'application/json');
      const targetNpcIds = worldNpcIds(resolved.targetWorld);
      const targetLocationIds = worldLocationIds(resolved.targetWorld);
      const npcStates = cloneJson(current.npcStates || {});
      const factionStates = materializeFactionStates(resolved.targetWorld, current.state?.factionStates);
      const addedFactionStateIds = Object.keys(factionStates).filter(id => !Object.hasOwn(current.state?.factionStates || {}, id));
      const addedNpcStateIds = [];
      for (const npcId of targetNpcIds) {
        if (Object.hasOwn(npcStates, npcId)) continue;
        const definition = (resolved.targetWorld.npcs || []).find(npc => npc?.id === npcId);
        const locationId = targetLocationIds.has(definition?.locationId) ? definition.locationId
          : targetLocationIds.has(current.state?.locationId) ? current.state.locationId
            : targetLocationIds.has(resolved.targetWorld.start?.locationId) ? resolved.targetWorld.start.locationId : null;
        npcStates[npcId] = { locationId, relation: {}, knowledge: [], status: [] };
        addedNpcStateIds.push(npcId);
      }
      const revision = current.revision + 1;
      const migratedAt = Date.now();
      const migration = {
        kind: 'world-version-upgrade',
        commandId: payload.commandId,
        fromVersion: Number(current.worldVersion),
        toVersion: payload.targetVersion,
        targetTitle: resolved.report.targetTitle,
        changes: resolved.report.changes,
        addedNpcStateIds,
        addedFactionStateIds,
        revision,
        migratedAt,
      };
      const next = {
        ...current,
        worldVersion: payload.targetVersion,
        npcStates,
        state: { ...current.state, factionStates, ...(targetConflictState !== undefined ? { conflicts: cloneJson(targetConflictState) } : {}), ...(targetGrowthCandidates !== undefined ? { growthCandidates: cloneJson(targetGrowthCandidates) } : {}), ...(targetGrowthApplications !== undefined ? { growthApplications: cloneJson(targetGrowthApplications) } : {}), ...(targetExperiences !== undefined ? { experiences: cloneJson(targetExperiences) } : {}) },
        migrationHistory: [...history, migration],
        eventLedger: appendEventLedger(current, { kind: 'world-version-upgrade', commandId: payload.commandId, sourceRevision: revision, locationId: current.state?.locationId ?? null, time: current.state?.time ?? null, migrationId: payload.commandId }),
        revision,
        updatedAt: migratedAt,
      };
      await writeJsonAtomic(fp, next);
      send(res, 200, JSON.stringify({ save: next, report: resolved.report, idempotent: false }), 'application/json; charset=utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') return send(res, 404, JSON.stringify({ error: '存档不存在' }), 'application/json');
      console.error('[world-saves] 升级失败:', err.message);
      send(res, 500, JSON.stringify({ error: '存档升级失败: ' + err.message }), 'application/json');
    }
  });
}

async function handleWorldEndingPost(req, res, saveId) {
  const fp = savePath(saveId);
  if (!fp) return send(res, 400, JSON.stringify({ error: '无效的 saveId' }), 'application/json');
  let payload;
  try { payload = await readJsonBody(req, 64 * 1024); }
  catch (err) {
    const status = err.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
    return send(res, status, JSON.stringify({ error: err.message }), 'application/json');
  }
  const invalid = validateWorldEndRequest(payload);
  if (invalid) return send(res, 400, JSON.stringify({ error: invalid }), 'application/json');
  return withWorldSaveLock(saveId, async () => {
    try {
      const current = JSON.parse(await fs.promises.readFile(fp, 'utf-8'));
      if (!current || current.id !== saveId) throw new Error('存档文件 ID 不一致');
      if (committedCommand(current, payload.commandId)) return send(res, 200, JSON.stringify(current), 'application/json; charset=utf-8');
      if (current.revision !== payload.expectedRevision) return send(res, 409, JSON.stringify({ error: '存档版本冲突，请重新读取', revision: current.revision }), 'application/json');
      if (current.state?.ending?.status === 'ended') return send(res, 409, JSON.stringify({ error: '当前世界线已经结束', ending: current.state.ending }), 'application/json');
      if (current.state?.failure?.status === 'terminal') return send(res, 409, JSON.stringify({ error: '当前存档已进入终止失败状态', failure: current.state.failure }), 'application/json');
      const world = findWorldVersion(await loadWorlds(), current.worldId, current.worldVersion);
      const rules = worldEndingRules(world);
      if (!rules.enabled || !rules.allowPlayerEnd) return send(res, 403, JSON.stringify({ error: '当前世界卡不允许玩家主动结束' }), 'application/json');
      const endingId = payload.endingId || rules.defaultEndingId;
      const ending = rules.endings.get(endingId);
      if (!ending) return send(res, 400, JSON.stringify({ error: '未声明该结局模式' }), 'application/json');
      if (!worldEndingConditionMet(ending, current.state)) return send(res, 409, JSON.stringify({ error: '该结局条件尚未满足', ending: { id: ending.id, label: ending.label, condition: ending.condition || null } }), 'application/json');
      if (rules.requireConfirm && payload.confirm !== true) return send(res, 409, JSON.stringify({ error: '结束世界线需要明确确认', confirmationRequired: true, ending: { id: ending.id, label: ending.label, description: ending.description } }), 'application/json');
      const revision = current.revision + 1;
      const endedAt = Date.now();
      const endingState = {
        status: 'ended',
        endingId: ending.id,
        kind: ending.kind || 'card-defined',
        label: ending.label,
        description: ending.description || '',
        sourceRevision: revision,
        commandId: payload.commandId,
        endedAt,
      };
      const nextState = { ...cloneJson(current.state || {}), ending: endingState };
      const receipt = { commandId: payload.commandId, kind: 'ending', revision, ending: cloneJson(endingState), committedAt: endedAt };
      const next = {
        ...current,
        state: nextState,
        receipts: [...(Array.isArray(current.receipts) ? current.receipts : []), receipt].slice(-200),
        eventLedger: appendEventLedger(current, { kind: 'ending', commandId: payload.commandId, sourceRevision: revision, locationId: nextState.locationId ?? null, time: nextState.time ?? null, endingId: ending.id }),
        revision,
        updatedAt: endedAt,
      };
      await writeJsonAtomic(fp, next);
      send(res, 200, JSON.stringify(next), 'application/json; charset=utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') return send(res, 404, JSON.stringify({ error: '存档不存在' }), 'application/json');
      console.error('[world-saves] 结束世界线失败:', err.message);
      send(res, 500, JSON.stringify({ error: '结束世界线失败: ' + err.message }), 'application/json');
    }
  });
}

async function handleWorldSaveReopen(req, res, saveId) {
  const sourcePath = savePath(saveId);
  if (!sourcePath) return send(res, 400, JSON.stringify({ error: '无效的 saveId' }), 'application/json');
  let payload;
  try { payload = await readJsonBody(req, 64 * 1024); }
  catch (err) { return send(res, err.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, JSON.stringify({ error: err.message }), 'application/json'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return send(res, 400, JSON.stringify({ error: '请求必须是 JSON 对象' }), 'application/json');
  if (typeof payload.commandId !== 'string' || !COMMAND_ID_RE.test(payload.commandId)) return send(res, 400, JSON.stringify({ error: 'commandId 无效' }), 'application/json');
  if (payload.name !== undefined && (typeof payload.name !== 'string' || payload.name.trim().length > 120)) return send(res, 400, JSON.stringify({ error: 'name 必须是不超过 120 个字符的字符串' }), 'application/json');
  return withWorldSaveLock(saveId, async () => {
    try {
      const current = JSON.parse(await fs.promises.readFile(sourcePath, 'utf-8'));
      if (!current || current.id !== saveId) throw new Error('存档文件 ID 不一致');
      const sourceStatus = current.state?.ending?.status === 'ended' ? 'ended' : current.state?.failure?.status === 'terminal' ? 'terminal-failure' : '';
      if (!sourceStatus) return send(res, 409, JSON.stringify({ error: '只有已结束或终止失败的世界线可以重开' }), 'application/json');
      const nextId = reopenedSaveId(saveId, payload.commandId);
      const nextPath = savePath(nextId);
      const existing = await fs.promises.readFile(nextPath, 'utf-8').then(JSON.parse).catch(err => {
        if (err.code === 'ENOENT') return null;
        throw err;
      });
      if (existing) {
        if (existing.reopenInfo?.sourceSaveId !== saveId || existing.reopenInfo?.commandId !== payload.commandId) {
          return send(res, 409, JSON.stringify({ error: '重开命令 ID 已被占用' }), 'application/json');
        }
        return send(res, 200, JSON.stringify({ save: existing, idempotent: true }), 'application/json; charset=utf-8');
      }
      const worlds = await loadWorlds();
      const world = findWorldVersion(worlds, current.worldId, current.worldVersion);
      if (!world) return send(res, 409, JSON.stringify({ error: '存档绑定的世界版本不存在' }), 'application/json');
      const now = Date.now();
      const priorSummary = current.worldLineSummary && typeof current.worldLineSummary === 'object'
        ? cloneJson(current.worldLineSummary)
        : buildWorldLineSummary(current, world);
      const next = cloneJson(current);
      next.id = nextId;
      next.name = payload.name?.trim() || `${current.name || '世界线'} · 重开`;
      next.createdAt = now;
      next.updatedAt = now;
      next.revision = 0;
      next.state.failure = null;
      next.state.ending = null;
      if (sourceStatus === 'terminal-failure' && next.state.stats && typeof next.state.stats === 'object') {
        const maxHp = Number(next.state.stats.maxHp);
        if (Number.isFinite(maxHp)) next.state.stats.hp = Math.max(1, maxHp);
      }
      if (sourceStatus === 'terminal-failure' && next.state.player?.resources && typeof next.state.player.resources === 'object') {
        const maxHp = Number(next.state.player.resources.maxHp ?? next.state.stats?.maxHp);
        if (Number.isFinite(maxHp)) next.state.player.resources.hp = Math.max(1, maxHp);
      }
      next.opening = '（世界线已从上一条终止线重开；上一条世界线的记忆、状态与总结已作为过去记录保留。）';
      next.openingMode = 'static';
      next.openingOptions = [];
      next.openingCommandId = null;
      next.turns = [];
      next.receipts = [];
      next.eventLedger = [];
      next.memoryRebuild = null;
      next.worldLineSummary = null;
      next.reopenInfo = {
        sourceSaveId: saveId,
        sourceRevision: current.revision,
        sourceStatus,
        sourceSummaryHash: worldLineSummarySourceHash(current),
        sourceSummary: priorSummary,
        sourceEnding: current.state?.ending ? cloneJson(current.state.ending) : null,
        sourceFailure: current.state?.failure ? cloneJson(current.state.failure) : null,
        commandId: payload.commandId,
        reopenedAt: now,
      };
      await fs.promises.mkdir(SAVES_DIR, { recursive: true });
      await writeJsonAtomic(nextPath, next);
      send(res, 201, JSON.stringify({ save: next, idempotent: false }), 'application/json; charset=utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') return send(res, 404, JSON.stringify({ error: '存档不存在' }), 'application/json');
      console.error('[world-saves] 重开失败:', err.message);
      send(res, 500, JSON.stringify({ error: '存档重开失败: ' + err.message }), 'application/json');
    }
  });
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
  const schemaInvalid = validatePlayerCreationSchema(world.playerCreation, world);
  if (schemaInvalid) return send(res, 400, JSON.stringify({ error: schemaInvalid }), 'application/json');
  const timeInvalid = validateWorldTime(world.time);
  if (timeInvalid) return send(res, 400, JSON.stringify({ error: timeInvalid }), 'application/json');
  const factionsInvalid = validateWorldFactions(world.factions, world);
  if (factionsInvalid) return send(res, 400, JSON.stringify({ error: factionsInvalid }), 'application/json');
  const conflictsInvalid = validateConflictTemplates(world.conflicts);
  if (conflictsInvalid) return send(res, 400, JSON.stringify({ error: conflictsInvalid }), 'application/json');
  const factionStates = initialFactionStates(world);
  const factionStateInvalid = validateFactionStates(world, factionStates);
  if (factionStateInvalid) return send(res, 400, JSON.stringify({ error: factionStateInvalid }), 'application/json');
  for (const [key, label] of [['goals', 'start.initialState.goals'], ['leads', 'start.initialState.leads']]) {
    const invalidObjectives = validateWorldObjectiveList(initial[key], label, world);
    if (invalidObjectives) return send(res, 400, JSON.stringify({ error: invalidObjectives }), 'application/json');
  }
  const conflictStates = initial.conflicts === undefined ? {} : cloneJson(initial.conflicts);
  const conflictStateInvalid = validateConflictStates(world, conflictStates);
  if (conflictStateInvalid) return send(res, 400, JSON.stringify({ error: conflictStateInvalid }), 'application/json');
  const growthCandidates = initial.growthCandidates === undefined ? [] : cloneJson(initial.growthCandidates);
  const growthCandidateInvalid = validateGrowthCandidates(world, growthCandidates);
  if (growthCandidateInvalid) return send(res, 400, JSON.stringify({ error: growthCandidateInvalid }), 'application/json');
  const growthApplications = initial.growthApplications === undefined ? [] : cloneJson(initial.growthApplications);
  const growthApplicationsInvalid = validateGrowthApplications(world, growthApplications);
  if (growthApplicationsInvalid) return send(res, 400, JSON.stringify({ error: growthApplicationsInvalid }), 'application/json');
  const experiences = initial.experiences === undefined ? [] : cloneJson(initial.experiences);
      const experiencesInvalid = validateGrowthExperiences(world, experiences);
      if (experiencesInvalid) return send(res, 400, JSON.stringify({ error: experiencesInvalid }), 'application/json');
  const growthCrossRefInvalid = validateGrowthStateCrossRefs({ growthCandidates, growthApplications, experiences });
  if (growthCrossRefInvalid) return send(res, 400, JSON.stringify({ error: growthCrossRefInvalid }), 'application/json');
  const playerResult = validatePlayerCreationInput(world, payload.player);
  if (playerResult.error) return send(res, 400, JSON.stringify({ error: playerResult.error }), 'application/json');
  const player = playerResult.snapshot;
  const playerId = String(start.playerTemplateId || ('pc-' + id));
  const playerState = playerResult.statePlayer || (initial.player && typeof initial.player === 'object' ? cloneJson(initial.player) : null);
  const economyState = materializePlayerEconomyState(world, initial, playerState);
  const economyStateInvalid = validatePlayerEconomyState(world, economyState);
  if (economyStateInvalid) return send(res, 400, JSON.stringify({ error: economyStateInvalid }), 'application/json');
  const derivedStats = { ...stats };
  for (const key of ['hp', 'mp', 'gold']) {
    if (playerState?.resources && Number.isFinite(playerState.resources[key])) derivedStats[key] = playerState.resources[key];
  }
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
      stats: derivedStats,
      time: { unit: String(world.time?.unit || 'tick'), value: Number(world.time?.start || 0) },
      ...(playerState ? { player: playerState } : {}),
      ...(playerEconomySchema(world) ? economyState : {}),
      ...(worldConflictDefinitions(world).length || initial.conflicts !== undefined ? { conflicts: conflictStates } : {}),
      failure: null,
      ending: null,
      ...(playerGrowthSchema(world) || initial.growthCandidates !== undefined ? { growthCandidates } : {}),
      ...(playerGrowthSchema(world) || initial.growthApplications !== undefined ? { growthApplications } : {}),
      ...(playerGrowthSchema(world) || initial.experiences !== undefined ? { experiences } : {}),
      worldEvents: [],
      goals: Array.isArray(initial.goals) ? cloneJson(initial.goals) : [],
      leads: Array.isArray(initial.leads) ? cloneJson(initial.leads) : [],
      inventory: Array.isArray(initial.inventory) ? cloneJson(initial.inventory) : [],
      quests: Array.isArray(initial.quests) ? cloneJson(initial.quests) : [],
      factionStates,
      map: {
        strategy: world.map && world.map.strategy || 'perSave',
        baseMapId: world.map && world.map.baseMapId || null,
        data: null,
        imagePath: null,
        discoveredLocationIds: start.locationId ? [start.locationId] : [],
        markers: [],
      },
    },
    npcStates: initialNpcStates(world, start, playerResult.relations),
    opening: String(start.opening || ''),
    openingMode: start.openingMode === 'ai' ? 'ai' : 'static',
    openingOptions: [],
    openingCommandId: null,
    turns: [],
    receipts: [],
    eventLedger: [],
    eventMemory: [],
    memoryRebuild: null,
    worldLineSummary: null,
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
  if (state.player !== undefined) {
    if (!state.player || typeof state.player !== 'object' || Array.isArray(state.player)) return 'state.player 必须是对象';
    for (const key of ['fields', 'attributes', 'skills', 'resources', 'relations']) {
      if (state.player[key] !== undefined && (!state.player[key] || typeof state.player[key] !== 'object' || Array.isArray(state.player[key]) || Object.keys(state.player[key]).length > 128)) return `state.player.${key} 无效`;
    }
    if (state.player.traits !== undefined && (!Array.isArray(state.player.traits) || state.player.traits.length > 128 || state.player.traits.some(id => typeof id !== 'string' || !isSafeId(id)))) return 'state.player.traits 无效';
    if (state.player.effects !== undefined && (!Array.isArray(state.player.effects) || state.player.effects.length > 128)) return 'state.player.effects 无效';
  }
  if (state.time !== undefined) {
    if (!state.time || typeof state.time !== 'object' || Array.isArray(state.time) || typeof state.time.unit !== 'string' || state.time.unit.length > 40 || !Number.isFinite(state.time.value) || state.time.value < 0 || state.time.value > 1000000000) return 'state.time 无效';
  }
  if (state.factionStates !== undefined && (!state.factionStates || typeof state.factionStates !== 'object' || Array.isArray(state.factionStates) || Object.keys(state.factionStates).length > 128)) return 'state.factionStates 无效';
  if (state.conflicts !== undefined && (!state.conflicts || typeof state.conflicts !== 'object' || Array.isArray(state.conflicts) || Object.keys(state.conflicts).length > 64)) return 'state.conflicts 无效';
  if (state.growthCandidates !== undefined && (!Array.isArray(state.growthCandidates) || state.growthCandidates.length > 128)) return 'state.growthCandidates 无效';
  if (state.growthApplications !== undefined && (!Array.isArray(state.growthApplications) || state.growthApplications.length > 128)) return 'state.growthApplications 无效';
  if (state.experiences !== undefined && (!Array.isArray(state.experiences) || state.experiences.length > 256)) return 'state.experiences 无效';
  const worldEventsInvalid = validateWorldEventLog(state.worldEvents);
  if (worldEventsInvalid) return worldEventsInvalid;
  for (const [key, label] of [['goals', 'state.goals'], ['leads', 'state.leads']]) {
    const invalidObjectives = validateWorldObjectiveList(state[key], label);
    if (invalidObjectives) return invalidObjectives;
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

async function handleWorldSaveOpeningPost(req, res, saveId) {
  const fp = savePath(saveId);
  if (!fp) return send(res, 400, JSON.stringify({ error: '无效的 saveId' }), 'application/json');
  let payload;
  try { payload = await readJsonBody(req, 256 * 1024); }
  catch (err) { return send(res, err.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, JSON.stringify({ error: err.message }), 'application/json'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return send(res, 400, JSON.stringify({ error: '请求必须是 JSON 对象' }), 'application/json');
  if (typeof payload.commandId !== 'string' || !COMMAND_ID_RE.test(payload.commandId)) return send(res, 400, JSON.stringify({ error: 'commandId 无效' }), 'application/json');
  if (!Number.isInteger(payload.expectedRevision) || payload.expectedRevision < 0) return send(res, 400, JSON.stringify({ error: 'expectedRevision 必须是非负整数' }), 'application/json');
  if (typeof payload.opening !== 'string' || !payload.opening.trim() || payload.opening.length > 100000) return send(res, 400, JSON.stringify({ error: 'opening 必须是非空文本' }), 'application/json');
  if (!Array.isArray(payload.options) || payload.options.length !== 4 || payload.options.some(option => typeof option !== 'string' || !option.trim() || option.length > 500)) return send(res, 400, JSON.stringify({ error: 'opening options 必须恰好包含 4 个非空选项' }), 'application/json');
  if (new Set(payload.options.map(option => option.trim())).size !== 4) return send(res, 400, JSON.stringify({ error: 'opening options 不能重复' }), 'application/json');
  return withWorldSaveLock(saveId, async () => {
    try {
      const current = JSON.parse(await fs.promises.readFile(fp, 'utf-8'));
      if (!current || current.id !== saveId) throw new Error('存档文件 ID 不一致');
      if (current.openingCommandId === payload.commandId) return send(res, 200, JSON.stringify(current), 'application/json; charset=utf-8');
      if (current.revision !== payload.expectedRevision) return send(res, 409, JSON.stringify({ error: '存档版本冲突，请重新读取', revision: current.revision }), 'application/json');
      const revision = current.revision + 1;
      const next = {
        ...current,
        opening: payload.opening.trim(),
        openingOptions: payload.options.map(option => option.trim()),
        openingCommandId: payload.commandId,
        receipts: [...(Array.isArray(current.receipts) ? current.receipts : []), { commandId: payload.commandId, kind: 'opening', revision, committedAt: Date.now() }].slice(-200),
        eventLedger: appendEventLedger(current, { kind: 'opening', commandId: payload.commandId, sourceRevision: revision, locationId: current.state?.locationId ?? null, time: current.state?.time ?? null }),
        revision,
        updatedAt: Date.now(),
      };
      await writeJsonAtomic(fp, next);
      send(res, 200, JSON.stringify(next), 'application/json; charset=utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') return send(res, 404, JSON.stringify({ error: '存档不存在' }), 'application/json');
      console.error('[world-saves] 开场提交失败:', err.message);
      send(res, 500, JSON.stringify({ error: '开场提交失败: ' + err.message }), 'application/json');
    }
  });
}

async function handleWorldGrowthPost(req, res, saveId) {
  const fp = savePath(saveId);
  if (!fp) return send(res, 400, JSON.stringify({ error: '无效的 saveId' }), 'application/json');
  let payload;
  try { payload = await readJsonBody(req, 64 * 1024); }
  catch (err) { return send(res, err.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, JSON.stringify({ error: err.message }), 'application/json'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return send(res, 400, JSON.stringify({ error: '请求必须是 JSON 对象' }), 'application/json');
  if (typeof payload.commandId !== 'string' || !COMMAND_ID_RE.test(payload.commandId)) return send(res, 400, JSON.stringify({ error: 'commandId 无效' }), 'application/json');
  if (!Number.isInteger(payload.expectedRevision) || payload.expectedRevision < 0) return send(res, 400, JSON.stringify({ error: 'expectedRevision 必须是非负整数' }), 'application/json');
  if (!isSafeId(String(payload.candidateId || ''))) return send(res, 400, JSON.stringify({ error: 'candidateId 无效' }), 'application/json');
  if (!['accepted', 'rejected'].includes(payload.decision)) return send(res, 400, JSON.stringify({ error: 'decision 必须是 accepted 或 rejected' }), 'application/json');
  if (payload.title !== undefined && !draftTextValid(payload.title, 200, true)) return send(res, 400, JSON.stringify({ error: 'title 无效' }), 'application/json');
  if (payload.summary !== undefined && !draftTextValid(payload.summary, 4000, true)) return send(res, 400, JSON.stringify({ error: 'summary 无效' }), 'application/json');
  return withWorldSaveLock(saveId, async () => {
    try {
      const current = JSON.parse(await fs.promises.readFile(fp, 'utf-8'));
      if (!current || current.id !== saveId) throw new Error('存档文件 ID 不一致');
      const world = findWorldVersion(await loadWorlds(), current.worldId, current.worldVersion);
      if (committedCommand(current, payload.commandId)) return send(res, 200, JSON.stringify(current), 'application/json; charset=utf-8');
      if (current.state?.ending?.status === 'ended') return send(res, 409, JSON.stringify({ error: '当前世界线已经结束，不能继续应用成长' }), 'application/json');
      if (current.revision !== payload.expectedRevision) return send(res, 409, JSON.stringify({ error: '存档版本冲突，请重新读取', revision: current.revision }), 'application/json');
      const currentCandidates = Array.isArray(current.state?.growthCandidates) ? current.state.growthCandidates : [];
      const growthCandidateInvalid = validateGrowthCandidates(world, currentCandidates);
      if (growthCandidateInvalid) return send(res, 409, JSON.stringify({ error: growthCandidateInvalid }), 'application/json');
      const index = currentCandidates.findIndex(candidate => candidate && candidate.id === payload.candidateId && candidate.status === 'proposed');
      if (index < 0) return send(res, 409, JSON.stringify({ error: '成长候选不存在、已处理或已被其他操作消费' }), 'application/json');
      const candidate = currentCandidates[index];
      const growthApplications = Array.isArray(current.state?.growthApplications) ? current.state.growthApplications : [];
      if (growthApplications.some(item => item?.candidateId === candidate.candidateId)) return send(res, 409, JSON.stringify({ error: '成长候选已经处理过' }), 'application/json');
      const definition = (Array.isArray(playerGrowthSchema(world)?.candidates) ? playerGrowthSchema(world).candidates : []).find(item => item.id === candidate.candidateId);
      if (!definition || definition.sourceId !== candidate.sourceId) return send(res, 409, JSON.stringify({ error: '成长候选已不匹配当前世界卡' }), 'application/json');
      const revision = current.revision + 1;
      const nextState = cloneJson(current.state || {});
      const nextNpcStates = cloneJson(current.npcStates || {});
      nextState.growthCandidates = currentCandidates.filter((_, candidateIndex) => candidateIndex !== index);
      const nextGrowthApplications = Array.isArray(nextState.growthApplications) ? nextState.growthApplications : [];
      const experiences = Array.isArray(nextState.experiences) ? nextState.experiences : [];
      let experience = null;
      if (payload.decision === 'accepted') {
        const applied = applyGrowthEffect(world, nextState, nextNpcStates, definition);
        if (applied.error) return send(res, 409, JSON.stringify({ error: applied.error }), 'application/json');
        experience = {
          id: newGrowthExperienceId(),
          kind: 'growth',
          candidateId: candidate.candidateId,
          sourceId: candidate.sourceId,
          title: payload.title?.trim() || definition.label,
          summary: payload.summary?.trim() || candidate.reason?.trim() || definition.description || definition.label,
          effects: applied.effect,
          locationId: nextState.locationId || null,
          revision,
          createdAt: Date.now(),
        };
        experiences.push(experience);
      }
      const application = {
        id: `growth-app-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
        candidateId: candidate.candidateId,
        sourceId: candidate.sourceId,
        decision: payload.decision,
        experienceId: experience?.id || null,
        revision,
        appliedAt: Date.now(),
      };
      nextGrowthApplications.push(application);
      nextState.growthApplications = nextGrowthApplications.slice(-128);
      nextState.experiences = experiences.slice(-256);
      const next = {
        ...current,
        state: nextState,
        npcStates: nextNpcStates,
        receipts: [...(Array.isArray(current.receipts) ? current.receipts : []), {
          commandId: payload.commandId,
          kind: 'growth',
          revision,
          growthApplication: cloneJson(application),
          committedAt: Date.now(),
        }].slice(-200),
        eventLedger: appendEventLedger(current, { kind: 'growth', commandId: payload.commandId, sourceRevision: revision, locationId: nextState.locationId ?? null, time: nextState.time ?? null, growthApplicationId: application.id }),
        revision,
        updatedAt: Date.now(),
      };
      const dynamicPlayerInvalid = validateDynamicPlayerState(world, next.state.player);
      if (dynamicPlayerInvalid) return send(res, 409, JSON.stringify({ error: dynamicPlayerInvalid }), 'application/json');
      const factionStateInvalid = validateFactionStates(world, next.state.factionStates);
      if (factionStateInvalid) return send(res, 409, JSON.stringify({ error: factionStateInvalid }), 'application/json');
      const economyStateInvalid = validatePlayerEconomyState(world, next.state, current.state);
      if (economyStateInvalid) return send(res, 409, JSON.stringify({ error: economyStateInvalid }), 'application/json');
      const applicationsInvalid = validateGrowthApplications(world, next.state.growthApplications);
      if (applicationsInvalid) return send(res, 409, JSON.stringify({ error: applicationsInvalid }), 'application/json');
      const experiencesInvalid = validateGrowthExperiences(world, next.state.experiences);
      if (experiencesInvalid) return send(res, 409, JSON.stringify({ error: experiencesInvalid }), 'application/json');
      const growthCrossRefInvalid = validateGrowthStateCrossRefs(next.state);
      if (growthCrossRefInvalid) return send(res, 409, JSON.stringify({ error: growthCrossRefInvalid }), 'application/json');
      await writeJsonAtomic(fp, next);
      send(res, 200, JSON.stringify(next), 'application/json; charset=utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') return send(res, 404, JSON.stringify({ error: '存档不存在' }), 'application/json');
      console.error('[world-saves] 成长应用失败:', err.message);
      send(res, 500, JSON.stringify({ error: '成长应用失败: ' + err.message }), 'application/json');
    }
  });
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
      if (!failureStateMatches(current.state, payload.state)) return send(res, 400, JSON.stringify({ error: 'state.failure 由服务端失败结算，客户端不能直接修改' }), 'application/json');
      if (!endingStateMatches(current.state, payload.state)) return send(res, 400, JSON.stringify({ error: 'state.ending 由服务端结局结算，客户端不能直接修改' }), 'application/json');
      if (current.state?.ending?.status === 'ended') return send(res, 409, JSON.stringify({ error: '当前世界线已经结束，不能继续修改存档' }), 'application/json');
      const invalidLocation = validateWorldLocationIds(world, payload.state, current.npcStates);
      if (invalidLocation) return send(res, 400, JSON.stringify({ error: invalidLocation }), 'application/json');
      for (const [key, label] of [['goals', 'state.goals'], ['leads', 'state.leads']]) {
        const invalidObjectives = validateWorldObjectiveList(payload.state[key], label, world);
        if (invalidObjectives) return send(res, 400, JSON.stringify({ error: invalidObjectives }), 'application/json');
      }
      if (current.state?.factionStates && payload.state.factionStates === undefined) return send(res, 400, JSON.stringify({ error: 'state.factionStates 不能省略' }), 'application/json');
      const factionStatePayload = payload.state.factionStates === undefined && worldFactionDefinitions(world).length
        ? materializeFactionStates(world, current.state?.factionStates)
        : payload.state.factionStates;
      const factionStateInvalid = validateFactionStates(world, factionStatePayload, current.state?.factionStates);
      if (factionStateInvalid) return send(res, 400, JSON.stringify({ error: factionStateInvalid }), 'application/json');
      if (current.state?.player && payload.state.player === undefined) return send(res, 400, JSON.stringify({ error: 'state.player 不能省略' }), 'application/json');
      const dynamicPlayerInvalid = validateDynamicPlayerState(world, payload.state.player, current.state?.player);
      if (dynamicPlayerInvalid) return send(res, 400, JSON.stringify({ error: dynamicPlayerInvalid }), 'application/json');
      const economyStateInvalid = validatePlayerEconomyState(world, payload.state, current.state);
      if (economyStateInvalid) return send(res, 400, JSON.stringify({ error: economyStateInvalid }), 'application/json');
      if (current.state?.conflicts !== undefined && payload.state.conflicts === undefined) return send(res, 400, JSON.stringify({ error: 'state.conflicts 不能省略' }), 'application/json');
      const conflictStateInvalid = validateConflictStates(world, payload.state.conflicts, current.state?.conflicts);
      if (conflictStateInvalid) return send(res, 400, JSON.stringify({ error: conflictStateInvalid }), 'application/json');
      if (current.state?.growthCandidates !== undefined && payload.state.growthCandidates === undefined) return send(res, 400, JSON.stringify({ error: 'state.growthCandidates 不能省略' }), 'application/json');
      const growthCandidateInvalid = validateGrowthCandidates(world, payload.state.growthCandidates, current.state?.growthCandidates);
      if (growthCandidateInvalid) return send(res, 400, JSON.stringify({ error: growthCandidateInvalid }), 'application/json');
      if (current.state?.growthApplications !== undefined && payload.state.growthApplications === undefined) return send(res, 400, JSON.stringify({ error: 'state.growthApplications 不能省略' }), 'application/json');
      const growthApplicationsInvalid = validateGrowthApplications(world, payload.state.growthApplications, current.state?.growthApplications);
      if (growthApplicationsInvalid) return send(res, 400, JSON.stringify({ error: growthApplicationsInvalid }), 'application/json');
      if (current.state?.experiences !== undefined && payload.state.experiences === undefined) return send(res, 400, JSON.stringify({ error: 'state.experiences 不能省略' }), 'application/json');
      const experiencesInvalid = validateGrowthExperiences(world, payload.state.experiences, current.state?.experiences);
      if (experiencesInvalid) return send(res, 400, JSON.stringify({ error: experiencesInvalid }), 'application/json');
      const growthCrossRefInvalid = validateGrowthStateCrossRefs(payload.state);
      if (growthCrossRefInvalid) return send(res, 400, JSON.stringify({ error: growthCrossRefInvalid }), 'application/json');
      if (current.revision !== payload.expectedRevision) {
        return send(res, 409, JSON.stringify({ error: '存档版本冲突，请重新读取', revision: current.revision }), 'application/json');
      }
      const nextState = cloneJson(payload.state);
      if (current.state?.failure !== undefined) nextState.failure = cloneJson(current.state.failure);
      if (current.state?.ending !== undefined) nextState.ending = cloneJson(current.state.ending);
      nextState.conflicts = materializeConflictOutcomes(world, nextState.conflicts);
      if (payload.state.factionStates === undefined && factionStatePayload !== undefined) nextState.factionStates = factionStatePayload;
      if (current.state?.time !== undefined) nextState.time = cloneJson(current.state.time);
      nextState.worldEvents = Array.isArray(current.state?.worldEvents) ? cloneJson(current.state.worldEvents) : [];
      const next = {
        ...current,
        state: nextState,
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

function validateWorldTurn(payload, optionRules = { min: 4, max: 4 }) {
  const invalid = validateWorldSavePatch(payload);
  if (invalid) return invalid;
  if (typeof payload.commandId !== 'string' || !COMMAND_ID_RE.test(payload.commandId)) return 'commandId 无效';
  if (payload.turns.length > 32) return '单回合最多提交 32 条消息';
  if (!payload.turns.some(turn => turn && turn.role === 'assistant')) return '回合必须包含 assistant 消息';
  for (const turn of payload.turns) {
    if (!turn || typeof turn !== 'object' || !['user', 'assistant', 'system'].includes(turn.role)) return '回合消息 role 无效';
    if (typeof turn.content !== 'string' || turn.content.length > 100000) return '回合消息 content 无效';
  }
  const options = payload.options == null ? [] : payload.options;
  if (!Array.isArray(options) || options.length < optionRules.min || options.length > optionRules.max || options.some(o => typeof o !== 'string' || !o.trim())) return `options 必须包含 ${optionRules.min}-${optionRules.max} 个非空字符串`;
  if (new Set(options.map(o => o.trim())).size !== options.length) return 'options 不能重复';
  const invalidCreateEntities = validateCreateEntities(payload.createEntities);
  if (invalidCreateEntities) return invalidCreateEntities;
  const invalidEventMemory = validateEventMemoryCandidates(payload.eventMemory);
  if (invalidEventMemory) return invalidEventMemory;
  const invalidActionIntent = validateActionIntent(payload.actionIntent);
  if (invalidActionIntent) return invalidActionIntent;
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
  const invalid = validateWorldTurn(payload, { min: 0, max: 4 });
  if (invalid) return send(res, 400, JSON.stringify({ error: invalid }), 'application/json');
  const invalidNpcStates = validateNpcStates(payload.npcStates);
  if (invalidNpcStates) return send(res, 400, JSON.stringify({ error: invalidNpcStates }), 'application/json');
  return withWorldSaveLock(saveId, async () => {
    try {
      const current = JSON.parse(await fs.promises.readFile(fp, 'utf-8'));
      if (!current || current.id !== saveId) throw new Error('存档文件 ID 不一致');
      const world = findWorldVersion(await loadWorlds(), current.worldId, current.worldVersion);
      const optionRules = worldTurnOptionRules(world);
      const contractInvalid = validateWorldTurn(payload, optionRules);
      if (contractInvalid) return send(res, 400, JSON.stringify({ error: contractInvalid }), 'application/json');
      const eventMemoryInvalid = validateEventMemoryCandidates(payload.eventMemory, world);
      if (eventMemoryInvalid) return send(res, 400, JSON.stringify({ error: eventMemoryInvalid }), 'application/json');
      const invalidLocation = validateWorldLocationIds(world, payload.state, payload.npcStates, payload.createEntities);
      if (invalidLocation) return send(res, 400, JSON.stringify({ error: invalidLocation }), 'application/json');
      for (const [key, label] of [['goals', 'state.goals'], ['leads', 'state.leads']]) {
        const invalidObjectives = validateWorldObjectiveList(payload.state[key], label, world);
        if (invalidObjectives) return send(res, 400, JSON.stringify({ error: invalidObjectives }), 'application/json');
      }
      if (current.state?.factionStates && payload.state.factionStates === undefined) return send(res, 400, JSON.stringify({ error: 'state.factionStates 不能省略' }), 'application/json');
      const factionStatePayload = payload.state.factionStates === undefined && worldFactionDefinitions(world).length
        ? materializeFactionStates(world, current.state?.factionStates)
        : payload.state.factionStates;
      const factionStateInvalid = validateFactionStates(world, factionStatePayload, current.state?.factionStates);
      if (factionStateInvalid) return send(res, 400, JSON.stringify({ error: factionStateInvalid }), 'application/json');
      if (current.state?.player && payload.state.player === undefined) return send(res, 400, JSON.stringify({ error: 'state.player 不能省略' }), 'application/json');
      const dynamicPlayerInvalid = validateDynamicPlayerState(world, payload.state.player, current.state?.player, true);
      if (dynamicPlayerInvalid) return send(res, 400, JSON.stringify({ error: dynamicPlayerInvalid }), 'application/json');
      const economyStateInvalid = validatePlayerEconomyState(world, payload.state, current.state);
      if (economyStateInvalid) return send(res, 400, JSON.stringify({ error: economyStateInvalid }), 'application/json');
      if (current.state?.conflicts !== undefined && payload.state.conflicts === undefined) return send(res, 400, JSON.stringify({ error: 'state.conflicts 不能省略' }), 'application/json');
      const conflictStateInvalid = validateConflictStates(world, payload.state.conflicts, current.state?.conflicts);
      if (conflictStateInvalid) return send(res, 400, JSON.stringify({ error: conflictStateInvalid }), 'application/json');
      if (current.state?.growthCandidates !== undefined && payload.state.growthCandidates === undefined) return send(res, 400, JSON.stringify({ error: 'state.growthCandidates 不能省略' }), 'application/json');
      const growthCandidateInvalid = validateGrowthCandidates(world, payload.state.growthCandidates, current.state?.growthCandidates);
      if (growthCandidateInvalid) return send(res, 400, JSON.stringify({ error: growthCandidateInvalid }), 'application/json');
      if (current.state?.growthApplications !== undefined && payload.state.growthApplications === undefined) return send(res, 400, JSON.stringify({ error: 'state.growthApplications 不能省略' }), 'application/json');
      const growthApplicationsInvalid = validateGrowthApplications(world, payload.state.growthApplications, current.state?.growthApplications);
      if (growthApplicationsInvalid) return send(res, 400, JSON.stringify({ error: growthApplicationsInvalid }), 'application/json');
      if (current.state?.experiences !== undefined && payload.state.experiences === undefined) return send(res, 400, JSON.stringify({ error: 'state.experiences 不能省略' }), 'application/json');
      const experiencesInvalid = validateGrowthExperiences(world, payload.state.experiences, current.state?.experiences);
      if (experiencesInvalid) return send(res, 400, JSON.stringify({ error: experiencesInvalid }), 'application/json');
      const growthCrossRefInvalid = validateGrowthStateCrossRefs(payload.state);
      if (growthCrossRefInvalid) return send(res, 400, JSON.stringify({ error: growthCrossRefInvalid }), 'application/json');
      const worldEventsInvalid = validateWorldEventLog(payload.state.worldEvents);
      if (worldEventsInvalid) return send(res, 400, JSON.stringify({ error: worldEventsInvalid }), 'application/json');
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
      if (committedCommand(current, payload.commandId)) return send(res, 200, JSON.stringify(current), 'application/json; charset=utf-8');
      if (!failureStateMatches(current.state, payload.state)) return send(res, 400, JSON.stringify({ error: 'state.failure 由服务端失败结算，客户端不能直接修改' }), 'application/json');
      if (!endingStateMatches(current.state, payload.state)) return send(res, 400, JSON.stringify({ error: 'state.ending 由服务端结局结算，客户端不能直接修改' }), 'application/json');
      if (current.state?.ending?.status === 'ended') return send(res, 409, JSON.stringify({ error: '当前世界线已经结束，不能继续普通回合', ending: current.state.ending }), 'application/json');
      if (current.state?.failure?.status === 'terminal') return send(res, 409, JSON.stringify({ error: '当前存档已进入终止失败状态，请重开或等待后续结局流程', failure: current.state.failure }), 'application/json');
      if (current.revision !== payload.expectedRevision) {
        return send(res, 409, JSON.stringify({ error: '存档版本冲突，请重新读取', revision: current.revision }), 'application/json');
      }
      if (generatedEntityCount(current.generatedEntities) + (payload.createEntities ? payload.createEntities.length : 0) > 1024) {
        return send(res, 400, JSON.stringify({ error: '存档临时实体数量不能超过 1024' }), 'application/json');
      }
      const revision = current.revision + 1;
      const nextState = cloneJson(payload.state);
      if (current.state?.failure !== undefined) nextState.failure = cloneJson(current.state.failure);
      if (current.state?.ending !== undefined) nextState.ending = cloneJson(current.state.ending);
      nextState.conflicts = materializeConflictOutcomes(world, nextState.conflicts);
      if (payload.state.factionStates === undefined && factionStatePayload !== undefined) nextState.factionStates = factionStatePayload;
      const combatResult = resolveCombatChecks(world, current.state, nextState, payload.commandId, revision);
      if (combatResult.error) return send(res, 400, JSON.stringify({ error: combatResult.error }), 'application/json');
      const nonCombatResult = resolveNonCombatChecks(world, current.state, nextState, payload.commandId, revision);
      if (nonCombatResult.error) return send(res, 400, JSON.stringify({ error: nonCombatResult.error }), 'application/json');
      nextState.time = advanceWorldTime(current.state?.time, world);
      const deadlineIds = settleWorldDeadlines(nextState);
      const settledEvents = settleWorldEvents(world, current, nextState, payload.commandId, revision);
      const settledFactionActions = settleWorldFactionActions(world, { ...current, state: { ...current.state, worldEvents: settledEvents.events } }, nextState, payload.commandId, revision);
      nextState.worldEvents = settledFactionActions.events;
      const conflictTransitions = conflictTransitionRecords(current.state?.conflicts, nextState.conflicts, payload.commandId, revision);
      const failureResult = resolveWorldFailure(world, current.state, nextState, revision);
      const settledState = failureResult.state;
      const committedTurns = payload.turns.map((turn, index) => ({
        ...cloneJson(turn),
        id: typeof turn.id === 'string' && turn.id.trim() ? turn.id.trim() : committedTurnId(saveId, revision, index),
        ...(index === 0 && payload.actionIntent ? { actionIntent: cloneJson(payload.actionIntent) } : {}),
        commandId: payload.commandId,
        revision,
      }));
      const next = {
        ...current,
        state: settledState,
        npcStates: payload.npcStates === undefined ? (current.npcStates || {}) : cloneJson(payload.npcStates),
        generatedEntities: payload.createEntities && payload.createEntities.length
          ? materializeGeneratedEntities(current, payload.createEntities, saveId, payload.commandId, revision)
          : (current.generatedEntities || {}),
        turns: [...(Array.isArray(current.turns) ? current.turns : []), ...committedTurns],
        receipts: [...(Array.isArray(current.receipts) ? current.receipts : []), {
          commandId: payload.commandId,
          kind: 'turn',
          revision,
          turnIds: committedTurns.map(turn => turn.id).filter(Boolean),
          eventIds: settledEvents.eventIds,
          factionActionIds: settledFactionActions.eventIds,
          conflictTransitions,
          ...(failureResult.record ? { failure: failureResult.record } : {}),
          combatChecks: combatResult.checks,
          conflictChecks: nonCombatResult.checks,
          deadlineIds,
          committedAt: Date.now(),
        }].slice(-200),
        eventLedger: appendEventLedger(current, {
          kind: 'turn',
          commandId: payload.commandId,
          sourceRevision: revision,
          locationId: settledState.locationId ?? null,
          time: settledState.time ?? null,
          turnIds: committedTurns.map(turn => turn.id).filter(Boolean),
          worldEventIds: settledEvents.eventIds,
          factionActionIds: settledFactionActions.eventIds,
          deadlineIds,
        }),
        eventMemory: appendEventMemory(current, payload.eventMemory, {
          world,
          revision,
          turns: committedTurns,
          eventIds: [...settledEvents.eventIds, ...settledFactionActions.eventIds, ...deadlineIds],
          time: settledState.time,
          locationId: settledState.locationId ?? null,
        }),
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
  let payload;
  try { payload = await readJsonBody(req, 4 * 1024 * 1024); }
  catch (err) { return send(res, err.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, err.code === 'BAD_JSON' ? 'Bad JSON' : err.message); }

  const { baseUrl, apiKey, body } = payload || {};
  if (!baseUrl || !body) return send(res, 400, '缺少 baseUrl 或 body');

  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
  if (payload.extraHeaders && typeof payload.extraHeaders === 'object') {
    Object.assign(headers, payload.extraHeaders); // 例如 OpenRouter 的 X-Title
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
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
    if (res.headersSent) return res.destroy();
    const timedOut = controller.signal.aborted;
    send(res, timedOut ? 504 : 502, JSON.stringify({ error: { message: timedOut ? '模型代理请求超时' : '代理请求失败: ' + err.message } }), 'application/json');
  } finally {
    clearTimeout(timer);
  }
}

/** 模型列表代理：GET /api/models（前端带 X-Base-Url / X-Api-Key 头） */
async function handleModels(req, res) {
  const baseUrl = req.headers['x-base-url'];
  const apiKey = req.headers['x-api-key'] || '';
  if (!baseUrl) return send(res, 400, '缺少 X-Base-Url 头');
  const headers = {};
  if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
  try {
    const upstream = await fetch(baseUrl.replace(/\/+$/, '') + '/models', { headers, signal: controller.signal });
    const text = await upstream.text();
    res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
    res.end(text);
  } catch (err) {
    console.error('[proxy] 获取模型失败:', err.message);
    const timedOut = controller.signal.aborted;
    send(res, timedOut ? 504 : 502, JSON.stringify({ error: { message: timedOut ? '模型列表请求超时' : '获取模型失败: ' + err.message } }), 'application/json');
  } finally {
    clearTimeout(timer);
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
  if (req.method === 'POST' && url.pathname === '/api/dice') return handleDiceRoll(req, res);
  if (req.method === 'GET' && url.pathname === '/api/worlds') return handleWorldsGet(req, res);
  if (req.method === 'POST' && url.pathname === '/api/world-imports') return handleWorldPackageImportPreview(req, res);
  const worldImportMatch = url.pathname.match(/^\/api\/world-imports\/([^/]+)\/?$/);
  if (worldImportMatch && (req.method === 'GET' || req.method === 'POST')) {
    let importId;
    try { importId = decodeURIComponent(worldImportMatch[1]); }
    catch { return send(res, 400, JSON.stringify({ error: '无效的 importId' }), 'application/json'); }
    if (req.method === 'GET') return handleWorldPackageImportGet(req, res, importId);
    return handleWorldPackageImportCommit(req, res, importId);
  }
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
  const worldDraftCheckMatch = url.pathname.match(/^\/api\/world-drafts\/([^/]+)\/check\/?$/);
  if (worldDraftCheckMatch && req.method === 'GET') {
    let worldId;
    try { worldId = decodeURIComponent(worldDraftCheckMatch[1]); }
    catch { return send(res, 400, JSON.stringify({ error: '无效的 worldId' }), 'application/json'); }
    return handleWorldDraftCheck(req, res, worldId);
  }
  const worldDraftMatch = url.pathname.match(/^\/api\/world-drafts\/([^/]+)\/?$/);
  if (worldDraftMatch && (req.method === 'GET' || req.method === 'PUT')) {
    let worldId;
    try { worldId = decodeURIComponent(worldDraftMatch[1]); }
    catch { return send(res, 400, JSON.stringify({ error: '无效的 worldId' }), 'application/json'); }
    if (req.method === 'GET') return handleWorldDraftsGet(req, res, worldId, true);
    return handleWorldDraftPut(req, res, worldId);
  }
  const worldExportMatch = url.pathname.match(/^\/api\/worlds\/([^/]+)\/export\/?$/);
  if (worldExportMatch && req.method === 'GET') {
    let worldId;
    try { worldId = decodeURIComponent(worldExportMatch[1]); }
    catch { return send(res, 400, JSON.stringify({ error: '无效的 worldId' }), 'application/json'); }
    const rawVersion = url.searchParams.get('version');
    if (rawVersion !== null && (!/^\d+$/.test(rawVersion) || !Number.isSafeInteger(Number(rawVersion)) || Number(rawVersion) < 1)) {
      return send(res, 400, JSON.stringify({ error: '无效的 worldVersion' }), 'application/json');
    }
    return handleWorldPackageExport(req, res, worldId, rawVersion === null ? undefined : Number(rawVersion));
  }
  const worldVersionMatch = url.pathname.match(/^\/api\/worlds\/([^/]+)\/versions\/?$/);
  if (worldVersionMatch && (req.method === 'GET' || req.method === 'POST')) {
    let worldId;
    try { worldId = decodeURIComponent(worldVersionMatch[1]); }
    catch { return send(res, 400, JSON.stringify({ error: '无效的 worldId' }), 'application/json'); }
    if (req.method === 'GET') return handleWorldVersionsGet(req, res, worldId);
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
  const worldSaveMemoryRebuildMatch = url.pathname.match(/^\/api\/world-saves\/([^/]+)\/memory\/rebuild\/?$/);
  if (worldSaveMemoryRebuildMatch && req.method === 'POST') {
    let saveId;
    try { saveId = decodeURIComponent(worldSaveMemoryRebuildMatch[1]); }
    catch { return send(res, 400, JSON.stringify({ error: '无效的 saveId' }), 'application/json'); }
    return handleWorldMemoryRebuild(req, res, saveId);
  }
  const worldSaveMemoryMatch = url.pathname.match(/^\/api\/world-saves\/([^/]+)\/memory\/?$/);
  if (worldSaveMemoryMatch && req.method === 'GET') {
    let saveId;
    try { saveId = decodeURIComponent(worldSaveMemoryMatch[1]); }
    catch { return send(res, 400, JSON.stringify({ error: '无效的 saveId' }), 'application/json'); }
    return handleWorldMemoryDiagnostics(req, res, saveId);
  }
  const worldSaveSummaryRebuildMatch = url.pathname.match(/^\/api\/world-saves\/([^/]+)\/summary\/rebuild\/?$/);
  if (worldSaveSummaryRebuildMatch && req.method === 'POST') {
    let saveId;
    try { saveId = decodeURIComponent(worldSaveSummaryRebuildMatch[1]); }
    catch { return send(res, 400, JSON.stringify({ error: '无效的 saveId' }), 'application/json'); }
    return handleWorldLineSummaryRebuild(req, res, saveId);
  }
  const worldSaveSummaryMatch = url.pathname.match(/^\/api\/world-saves\/([^/]+)\/summary\/?$/);
  if (worldSaveSummaryMatch && req.method === 'GET') {
    let saveId;
    try { saveId = decodeURIComponent(worldSaveSummaryMatch[1]); }
    catch { return send(res, 400, JSON.stringify({ error: '无效的 saveId' }), 'application/json'); }
    return handleWorldLineSummaryGet(req, res, saveId);
  }
  const rpgMigrationListMatch = url.pathname.match(/^\/api\/rpg-migrations\/?$/);
  if (rpgMigrationListMatch && req.method === 'POST') return handleRpgMigrationPreview(req, res);
  const rpgMigrationMatch = url.pathname.match(/^\/api\/rpg-migrations\/([^/]+)\/?$/);
  if (rpgMigrationMatch && (req.method === 'GET' || req.method === 'POST')) {
    let migrationId;
    try { migrationId = decodeURIComponent(rpgMigrationMatch[1]); }
    catch { return send(res, 400, JSON.stringify({ error: '无效的 migrationId' }), 'application/json'); }
    if (req.method === 'GET') return handleRpgMigrationGet(req, res, migrationId);
    return handleRpgMigrationCommit(req, res, migrationId);
  }
  const worldSaveUpgradeMatch = url.pathname.match(/^\/api\/world-saves\/([^/]+)\/upgrade\/?$/);
  if (worldSaveUpgradeMatch && (req.method === 'GET' || req.method === 'POST')) {
    let saveId;
    try { saveId = decodeURIComponent(worldSaveUpgradeMatch[1]); }
    catch { return send(res, 400, JSON.stringify({ error: '无效的 saveId' }), 'application/json'); }
    if (req.method === 'POST') return handleWorldSaveUpgrade(req, res, saveId);
    const rawVersion = url.searchParams.get('targetVersion');
    if (rawVersion === null || !/^\d+$/.test(rawVersion) || !Number.isSafeInteger(Number(rawVersion)) || Number(rawVersion) < 1) {
      return send(res, 400, JSON.stringify({ error: '无效的 targetVersion' }), 'application/json');
    }
    return handleWorldSaveUpgradePreview(req, res, saveId, Number(rawVersion));
  }
  const worldSaveOpeningMatch = url.pathname.match(/^\/api\/world-saves\/([^/]+)\/opening\/?$/);
  if (worldSaveOpeningMatch && req.method === 'POST') {
    let saveId;
    try { saveId = decodeURIComponent(worldSaveOpeningMatch[1]); }
    catch { return send(res, 400, JSON.stringify({ error: '无效的 saveId' }), 'application/json'); }
    return handleWorldSaveOpeningPost(req, res, saveId);
  }
  const worldGrowthMatch = url.pathname.match(/^\/api\/world-saves\/([^/]+)\/growth\/?$/);
  if (worldGrowthMatch && req.method === 'POST') {
    let saveId;
    try { saveId = decodeURIComponent(worldGrowthMatch[1]); }
    catch { return send(res, 400, JSON.stringify({ error: '无效的 saveId' }), 'application/json'); }
    return handleWorldGrowthPost(req, res, saveId);
  }
  const worldEndingMatch = url.pathname.match(/^\/api\/world-saves\/([^/]+)\/end\/?$/);
  if (worldEndingMatch && req.method === 'POST') {
    let saveId;
    try { saveId = decodeURIComponent(worldEndingMatch[1]); }
    catch { return send(res, 400, JSON.stringify({ error: '无效的 saveId' }), 'application/json'); }
    return handleWorldEndingPost(req, res, saveId);
  }
  const worldSaveReopenMatch = url.pathname.match(/^\/api\/world-saves\/([^/]+)\/reopen\/?$/);
  if (worldSaveReopenMatch && req.method === 'POST') {
    let saveId;
    try { saveId = decodeURIComponent(worldSaveReopenMatch[1]); }
    catch { return send(res, 400, JSON.stringify({ error: '无效的 saveId' }), 'application/json'); }
    return handleWorldSaveReopen(req, res, saveId);
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
      // 返回 _defaults.json 模板，深拷贝避免引用污染
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
