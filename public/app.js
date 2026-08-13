/* ═══════════════ Tavern · AI RP 框架 —— 前端逻辑 ═══════════════
 * 数据层（localStorage）：
 *   角色库 characters / 会话 sessions / 世界书 lorebook /
 *   提示词预设 promptPresets / 偏好 prefs（格式·世界书设置）
 * 提示词管线（兼容 SillyTavern prompts + prompt_order）：
 *   固定槽位/自定义条目按预设顺序组装；System 最终合并为唯一消息。
 */

'use strict';

/* ─────────── 常量 ─────────── */
const LS_SETTINGS = 'rpg-airp:settings';
const LS_CHAT = 'rpg-airp:chat';
const LS_CHAR = 'rpg-airp:char';
const LS_THEME = 'rpg-airp:theme';
const LS_LAYOUT = 'rpg-airp:layout';
const LS_MODE = 'rpg-airp:mode';
const LS_PROFILES = 'rpg-airp:profiles';
const LS_CHARS = 'rpg-airp:chars';
const LS_CURRENT_CHAR = 'rpg-airp:current-char';
const LS_SESSIONS = 'rpg-airp:sessions';
const LS_LORE = 'rpg-airp:lore';
const LS_USER = 'rpg-airp:user';
const LS_PRESETS = 'rpg-airp:prompt-presets';
const LS_PREFS = 'rpg-airp:prefs';
const LS_CURRENT_WORLD = 'rpg-airp:current-world';
const LS_CURRENT_WORLD_SAVE = 'rpg-airp:current-world-save';
const GLOBAL_PRESET_KEY = '__global__';
const PRESET_SCHEMA_VERSION = 2;
const PRESET_MARKERS = [
  ['main', '主提示词'],
  ['worldInfoBefore', '世界书（前）'],
  ['personaDescription', '玩家设定'],
  ['charDescription', '角色描述'],
  ['charPersonality', '角色性格'],
  ['scenario', '场景'],
  ['tavernMemory', '记忆'],
  ['tavernFormat', '格式指令'],
  ['tavernRpg', 'RPG 状态与协议'],
  ['worldInfoAfter', '世界书（后）'],
  ['dialogueExamples', '对话示例'],
  ['chatHistory', '聊天历史'],
  ['jailbreak', '历史后指令'],
];
const PRESET_MARKER_IDS = new Set(PRESET_MARKERS.map(([id]) => id));

const PAW_SVG = '<span class="avatar-mark">✦</span>';

/* 风格主题（色调）——UI 设计配置，保留在代码（驱动 CSS 变量） */
const FIXED_THEME = 'vibrancy';

const DEFAULT_SETTINGS = {
  preset: '', baseUrl: '', apiKey: '', model: '',
  temperature: 0.9, maxTokens: 1024,
  topP: 1, frequencyPenalty: 0, presencePenalty: 0, seed: -1,
  history: 20, stream: true,
  systemPrompt: '', postHistory: '', firstMes: '',
};

/* 服务预设 / 格式指令 / 界面偏好：从 public/data/_defaults.json 加载，代码不写死 */
let defaults = null;
let providers = [];        // [{ id, label, baseUrl, model }]
let formatInstructions = {}; // { key: 指令文字 }

/* 空状态提示：从 _defaults.json 的 ui 段读取模板，{name}/{role} 插值当前角色，不写死文案 */
function buildGuide() {
  const ui = (defaults && defaults.ui) || {};
  const char = currentChar();
  if (char && char.name && char.name !== '？？？' && ui.emptyGuideWithChar) {
    return ui.emptyGuideWithChar
      .replace('{name}', char.name)
      .replace('{role}', char.role || '');
  }
  return ui.emptyGuide || '';
}

/* 空状态标题：从 _defaults.json 的 ui 段读取 */
function emptyTitle() {
  const ui = (defaults && defaults.ui) || {};
  return ui.emptyTitle || '';
}

/* ─────────── 状态 ─────────── */
let settings = loadJSON(LS_SETTINGS, DEFAULT_SETTINGS);
let prefs = loadJSON(LS_PREFS, null) || {}; // 默认值来自 _defaults.json 的 prefs 段
let profiles = loadJSON(LS_PROFILES, {});
let characters = loadJSON(LS_CHARS, []);
let currentCharId = localStorage.getItem(LS_CURRENT_CHAR);
let sessions = loadJSON(LS_SESSIONS, null);
let currentSessionId = null;
let lorebooks = null; // { id: { name, entries: [] } }
let userData = loadJSON(LS_USER, null); // { currentPreset, presets: {...}, memories: [] }
let promptPresets = loadJSON(LS_PRESETS, {});
let worldCards = [];
const worldCardVersions = new Map();
let currentWorldId = localStorage.getItem(LS_CURRENT_WORLD) || null;
let currentWorldSaveId = localStorage.getItem(LS_CURRENT_WORLD_SAVE) || null;
let currentWorldSave = null;
let worldSavesByWorld = new Map();
let worldLoadToken = 0;
let worldSaveWriteChain = Promise.resolve();
let worldSavePending = null;
let worldTurnPending = null;
let worldTurnError = null;
let worldTurnPreparing = false;
let worldTurnEpoch = 0;
let worldDraft = null;
let worldDraftDirty = false;
let worldDraftOpener = null;
let worldDraftPublishId = null;
let worldPlayerOpener = null;
let pendingWorldSaveName = '';
let pendingWorldSaveButton = null;
let worldOpeningGeneration = null;
let worldUpgrade = null;
let worldUpgradeOpener = null;
let worldImport = null;
let worldImportOpener = null;
let rpgMigration = null;
let rpgMigrationOpener = null;
let theme = FIXED_THEME;
let mode = localStorage.getItem(LS_MODE) || 'tavern'; // 'tavern' 酒馆模式 | 'rpg' RPG 模式
let sending = false;
const debugTraces = new Map(); // 仅内存、按 session.id 隔离，不把完整 Prompt 写入存档
const debugMemoryDiagnostics = new Map(); // 仅内存、按 save.id 隔离，不写入世界存档
const debugMemoryPending = new Set();
let cmEditingId = null;
let cmCreating = false;
let wiEditingId = null;
let lbEditingId = null;
let pgEditingName = null;
let pgEditingPreset = null;
let pgEditingPromptId = null;

/* ─────────── 数据加载 / 保存（JSON 文件存储） ─────────── */
function saveSettings() {
  localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
  saveServerData('settings', settings);
}
async function loadServerData(type) {
  try {
    const resp = await fetch('/api/data/' + type);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.json();
  } catch (e) {
    console.warn('[Tavern] 加载 ' + type + ' 失败，回退本地缓存:', e.message);
    return null;
  }
}
async function saveServerData(type, data) {
  try {
    const resp = await fetch('/api/data/' + type, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(data),
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
  } catch (e) {
    console.error('[Tavern] 保存 ' + type + ' 失败:', e.message);
  }
}

/* ─────────── 工具 ─────────── */
function loadJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; }
  catch { return fallback; }
}
function saveJSON(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
function savePresets() { localStorage.setItem(LS_PRESETS, JSON.stringify(promptPresets)); saveServerData('presets', promptPresets); }
function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function currentChar() { return characters.find(c => c.id === currentCharId) || null; }
function sessionMatches(s) { return !!s && s.charId === currentCharId && s.kind === mode; }

/* ─────────── 世界库 / 世界存档（W2：RPG 主链由当前 WorldSave 持有） ─────────── */
function worldCardById(id) { return worldCards.find(w => w.id === id) || null; }
function worldCardKey(id, version) { return `${id}@${version}`; }
function currentWorldCard() {
  const version = currentWorldSave && currentWorldSave.worldVersion;
  return version === undefined || version === null
    ? worldCardById(currentWorldId)
    : worldCardVersions.get(worldCardKey(currentWorldId, version)) || worldCardById(currentWorldId);
}
function formatWorldDate(ts) {
  if (!ts) return '时间未知';
  try { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(ts)); }
  catch { return new Date(ts).toLocaleString(); }
}
function worldApiError(data, fallback) {
  return data && typeof data.error === 'string' ? data.error : fallback;
}
function worldModeActive() {
  return mode === 'rpg' && !!currentWorldSave && currentWorldSave.id === currentWorldSaveId;
}
function activeConversationKey() {
  const scope = activeConversationScope();
  return scope ? `${worldModeActive() ? 'world' : 'session'}:${scope.id}` : '';
}
function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}
function hydrateWorldSave(data) {
  if (!data || typeof data !== 'object') return data;
  if (!data.state || typeof data.state !== 'object') data.state = {};
  if (!Array.isArray(data.turns)) data.turns = [];
  if (data.state.ending === undefined) data.state.ending = null;
  if (data.state.goals === undefined && Array.isArray(data.state.quests) && data.state.quests.length) {
    data.state.goals = data.state.quests.map((quest, index) => ({
      id: /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(String(quest?.id || '')) ? `legacy-${quest.id}`.slice(0, 64) : `legacy-goal-${index + 1}`,
      title: String(quest?.title || `旧任务 ${index + 1}`).slice(0, 240),
      desc: String(quest?.desc || '').slice(0, 4000),
      status: quest?.status === 'done' ? 'done' : 'active',
      legacyQuestId: quest?.id || null,
    }));
  }
  const map = data.state.map;
  if (map && map.data && window.MapGen?.hydrateMap) map.data = window.MapGen.hydrateMap(map.data);
  return data;
}
function serializeWorldState(save) {
  const state = cloneValue(save.state || {});
  const map = save.state && save.state.map;
  if (map && map.data && window.MapGen?.serializeMap) state.map.data = window.MapGen.serializeMap(map.data);
  return state;
}
function worldTimelineMessages() {
  if (!worldModeActive()) return [];
  const result = [];
  if (currentWorldSave.opening) result.push({ role: 'assistant', content: currentWorldSave.opening, ts: currentWorldSave.createdAt || Date.now(), _opening: true });
  for (const turn of currentWorldSave.turns || []) {
    if (!turn || typeof turn !== 'object' || !turn.role) continue;
    result.push(turn);
  }
  if (worldTurnPending && worldTurnPending.saveId === currentWorldSaveId) result.push(...worldTurnPending.messages);
  return result;
}
function worldShortTermWindowSize() {
  const configured = Number(settings?.history);
  return Number.isFinite(configured) && configured > 0 ? Math.min(100, Math.floor(configured)) : 20;
}
function buildWorldRecentContext() {
  if (!worldModeActive()) return { messages: [], revision: null, locationId: null, time: null, sceneStartRevision: null, sourceLedgerIds: [] };
  const save = currentWorldSave;
  const timeline = worldTimelineMessages().filter(message => message && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string');
  const ledger = Array.isArray(save.eventLedger) ? save.eventLedger.filter(entry => entry && Number.isInteger(entry.sourceRevision)) : [];
  const currentLocationId = save.state?.locationId ?? null;
  let sceneStartRevision = null;
  for (let i = ledger.length - 1; i > 0; i--) {
    const current = ledger[i];
    const previous = ledger[i - 1];
    if (current.locationId && previous.locationId && current.locationId !== previous.locationId && current.locationId === currentLocationId) {
      sceneStartRevision = current.sourceRevision;
      break;
    }
  }
  const candidates = sceneStartRevision === null
    ? timeline
    : timeline.filter(message => message._opening !== true && (message.revision === undefined || message.revision >= sceneStartRevision));
  const selected = (candidates.length ? candidates : timeline).slice(-worldShortTermWindowSize());
  const firstRevision = selected.find(message => Number.isInteger(message.revision))?.revision;
  return {
    messages: selected.map(message => ({ role: message.role, content: message.content })),
    revision: Number.isInteger(save.revision) ? save.revision : null,
    locationId: currentLocationId,
    time: save.state?.time ? cloneValue(save.state.time) : null,
    sceneStartRevision,
    sourceLedgerIds: ledger.filter(entry => firstRevision === undefined || entry.sourceRevision >= firstRevision).map(entry => entry.id).filter(Boolean),
  };
}
function worldTurnPendingActive() {
  return worldModeActive() && !!worldTurnPending && worldTurnPending.saveId === currentWorldSaveId;
}
function worldTurnErrorActive() {
  return worldModeActive() && !!worldTurnError && worldTurnError.saveId === currentWorldSaveId;
}
function resetWorldTurnPending(pending) {
  if (!pending) return;
  pending.messages = pending.messages.filter(message => message && message.role !== 'assistant' && message.role !== 'image');
  pending.options = null;
  pending.createEntities = null;
  pending.eventMemory = null;
  pending.state = cloneValue(pending.beforeState);
  if (currentWorldSave && pending.saveId === currentWorldSaveId) {
    currentWorldSave.state = cloneValue(pending.beforeState);
    hydrateWorldSave(currentWorldSave);
  }
}
function discardWorldTurnPending() {
  const pending = worldTurnPending;
  worldTurnPending = null;
  worldTurnError = null;
  worldTurnEpoch++;
  resetWorldTurnPending(pending);
  renderMessages();
}
function failWorldTurnPending(message) {
  if (!worldTurnPendingActive()) return false;
  resetWorldTurnPending(worldTurnPending);
  worldTurnError = {
    saveId: worldTurnPending.saveId,
    commandId: worldTurnPending.commandId,
    message: String(message || '本回合未提交'),
  };
  worldTurnEpoch++;
  renderMessages();
  return true;
}
async function retryWorldTurn() {
  if (!worldTurnPendingActive() || !worldTurnErrorActive() || sending || worldTurnPreparing) return;
  worldTurnError = null;
  resetWorldTurnPending(worldTurnPending);
  worldTurnEpoch++;
  renderMessages();
  worldTurnPreparing = true;
  try { await requestReply(); }
  finally { worldTurnPreparing = false; }
}
async function submitWorldTurn(pending) {
  const res = await fetch('/api/world-saves/' + encodeURIComponent(pending.saveId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      commandId: pending.commandId,
      expectedRevision: pending.expectedRevision,
      state: pending.state,
      turns: cloneValue(pending.messages),
      options: pending.options,
      createEntities: pending.createEntities || undefined,
      eventMemory: pending.eventMemory || undefined,
      actionIntent: pending.actionIntent,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(worldApiError(data, '世界回合提交失败（HTTP ' + res.status + '）'));
  if (!worldTurnPendingActive() || pending.commandId !== worldTurnPending.commandId) {
    if (worldTurnPending === pending) { worldTurnPending = null; worldTurnEpoch++; }
    return;
  }
  hydrateWorldSave(data);
  currentWorldSave = data;
  currentWorldSaveId = data.id;
  worldTurnPending = null;
  worldTurnError = null;
  worldTurnEpoch++;
  renderRPG();
  renderSessions();
  renderMessages();
}
async function flushWorldSaveWrites() {
  while (worldSavePending) {
    const pending = worldSavePending;
    worldSavePending = null;
    const { save, snapshot } = pending;
    if (!currentWorldSave || save.id !== currentWorldSaveId) continue;
    const res = await fetch('/api/world-saves/' + encodeURIComponent(save.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ expectedRevision: currentWorldSave.revision, ...snapshot }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(worldApiError(data, '世界存档保存失败（HTTP ' + res.status + '）'));
    if (!currentWorldSave || save.id !== currentWorldSaveId) continue;
    hydrateWorldSave(data);
    currentWorldSave = data;
    renderRPG();
    renderSessions();
  }
}
function queueWorldSave(save = currentWorldSave) {
  if (!save || !worldModeActive() || save !== currentWorldSave || worldTurnPendingActive()) return worldSaveWriteChain;
  worldSavePending = {
    save,
    snapshot: {
      state: serializeWorldState(save),
      turns: cloneValue(save.turns || []),
      opening: save.opening || '',
    },
  };
  worldSaveWriteChain = worldSaveWriteChain.catch(() => {}).then(() => flushWorldSaveWrites()).catch(err => {
    console.error('[Tavern] 世界存档保存失败:', err.message);
    const status = $('world-open-status');
    if (status && worldModeActive()) status.textContent = `⚠️ 存档尚未保存：${err.message}（可继续操作，稍后重试）`;
  });
  return worldSaveWriteChain;
}
function enterWorldWorkspace() {
  if (!worldModeActive()) return;
  closeWorldLibrary();
  renderSessions();
  renderMessages();
}
async function loadWorldCards() {
  const res = await fetch('/api/worlds');
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(worldApiError(data, '世界卡读取失败（HTTP ' + res.status + '）'));
  worldCards = Array.isArray(data) ? data : [];
  if (!worldCardById(currentWorldId)) {
    currentWorldId = worldCards[0] ? worldCards[0].id : null;
    localStorage.setItem(LS_CURRENT_WORLD, currentWorldId || '');
  }
  return worldCards;
}
async function loadWorldCardVersion(worldId, version) {
  const query = version === undefined || version === null ? '' : '?version=' + encodeURIComponent(version);
  const res = await fetch('/api/worlds/' + encodeURIComponent(worldId) + query);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(worldApiError(data, '世界卡版本读取失败（HTTP ' + res.status + '）'));
  if (!data || data.id !== worldId) throw new Error('世界卡响应缺少稳定 ID');
  worldCardVersions.set(worldCardKey(worldId, data.version), data);
  return data;
}
function setWorldDraftStatus(message, kind = '') {
  const el = $('world-draft-status');
  if (!el) return;
  el.textContent = message || '';
  el.className = 'world-draft-status' + (kind ? ' ' + kind : '');
}
function splitWorldDraftList(value) {
  return [...new Set(String(value || '').split(',').map(item => item.trim()).filter(Boolean))];
}
function worldDraftMapGeneration(world = worldDraft?.world) {
  const generation = world?.map?.generation || {};
  return {
    seed: Number.isInteger(generation.seed) ? generation.seed : 12345,
    size: [64, 96, 128, 160, 192].includes(generation.size) ? generation.size : 128,
    regionCount: Number.isInteger(generation.regionCount) ? Math.max(4, Math.min(24, generation.regionCount)) : 10,
    landRatio: Number.isFinite(generation.landRatio) ? Math.max(0.25, Math.min(0.8, generation.landRatio)) : 0.55,
    mapgenSize: ['tiny', 'small'].includes(generation.mapgenSize) ? generation.mapgenSize : 'small',
  };
}
function updateWorldDraftMapOutputs() {
  $('world-draft-map-regions-output').value = $('world-draft-map-regions').value;
  $('world-draft-map-land-output').value = $('world-draft-map-land').value + '%';
}
function fillWorldDraftMapForm(world) {
  const generation = worldDraftMapGeneration(world);
  $('world-draft-map-seed').value = generation.seed;
  $('world-draft-map-size').value = generation.size;
  $('world-draft-map-regions').value = generation.regionCount;
  $('world-draft-map-land').value = Math.round(generation.landRatio * 100);
  $('world-draft-map-detail').value = generation.mapgenSize;
  updateWorldDraftMapOutputs();
  const canvas = $('world-draft-map-canvas');
  canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  $('world-draft-map-caption').textContent = '调整参数后生成预览。';
}
function collectWorldDraftMapGeneration() {
  return {
    seed: Number($('world-draft-map-seed').value),
    size: Number($('world-draft-map-size').value),
    regionCount: Number($('world-draft-map-regions').value),
    landRatio: Number($('world-draft-map-land').value) / 100,
    mapgenSize: $('world-draft-map-detail').value,
  };
}
function randomizeWorldDraftMapSeed() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  $('world-draft-map-seed').value = values[0] & 0x7fffffff;
  worldDraftDirty = true;
}
async function previewWorldDraftMap() {
  const button = $('world-draft-map-preview');
  const caption = $('world-draft-map-caption');
  if (!window.MapGen || button.disabled) return;
  const seedInput = $('world-draft-map-seed');
  if (!seedInput.checkValidity()) return seedInput.reportValidity();
  const generation = collectWorldDraftMapGeneration();
  const old = button.textContent;
  button.disabled = true;
  button.textContent = '生成中…';
  caption.textContent = '正在计算地形…';
  await new Promise(resolve => requestAnimationFrame(resolve));
  try {
    const map = window.MapGen.generateWorldMap(generation.seed, generation);
    window.MapGen.renderWorldMap($('world-draft-map-canvas'), map, { pixelSize: 2, labels: false, markers: false });
    const landPixels = map.grid.reduce((count, regionId) => count + (regionId ? 1 : 0), 0);
    const actualLand = Math.round(landPixels / map.grid.length * 100);
    caption.textContent = `${map.regions.length} 个区域 · 实际陆地 ${actualLand}% · ${map.engine === 'mapgen2' ? 'Mapgen2' : 'Fallback'}`;
  } catch (err) {
    caption.textContent = '预览生成失败：' + err.message;
  } finally {
    button.disabled = false;
    button.textContent = old;
  }
}
function worldDraftLocationTemplate(location, index) {
  return `<article class="world-draft-entry world-draft-location" data-index="${index}">
    <div class="world-draft-entry-head"><strong>地点 ${index + 1}</strong><button class="ghost-btn small danger" type="button" data-remove-location>删除</button></div>
    <div class="world-draft-entry-grid">
      <label class="field"><span>ID</span><input data-location-id value="${esc(location.id || '')}" maxlength="64" spellcheck="false" required /></label>
      <label class="field"><span>名称</span><input data-location-name value="${esc(location.name || '')}" maxlength="200" required /></label>
      <label class="field"><span>类型</span><input data-location-type value="${esc(location.type || '')}" maxlength="80" placeholder="城镇 / 地牢 / 区域" /></label>
      <label class="field"><span>标签</span><input data-location-tags value="${esc(Array.isArray(location.tags) ? location.tags.join(', ') : '')}" maxlength="1000" placeholder="港口, 安全区" /></label>
    </div>
    <label class="field"><span>简介</span><textarea data-location-summary rows="2" maxlength="2000" placeholder="玩家可见的地点简介">${esc(location.summary || '')}</textarea></label>
  </article>`;
}
function worldDraftNpcTemplate(npc, index, locations) {
  const options = ['<option value="">未指定地点</option>'].concat(locations.map(location => `<option value="${esc(location.id || '')}"${npc.locationId === location.id ? ' selected' : ''}>${esc(location.name || location.id)}</option>`)).join('');
  return `<article class="world-draft-entry world-draft-npc" data-index="${index}">
    <div class="world-draft-entry-head"><strong>NPC ${index + 1}</strong><button class="ghost-btn small danger" type="button" data-remove-npc>删除</button></div>
    <div class="world-draft-entry-grid">
      <label class="field"><span>ID</span><input data-npc-id value="${esc(npc.id || '')}" maxlength="64" spellcheck="false" required /></label>
      <label class="field"><span>名称</span><input data-npc-name value="${esc(npc.name || '')}" maxlength="200" required /></label>
      <label class="field"><span>身份 / 角色</span><input data-npc-role value="${esc(npc.role || '')}" maxlength="200" /></label>
      <label class="field"><span>所在地点</span><select data-npc-location>${options}</select></label>
    </div>
    <label class="field"><span>描述</span><textarea data-npc-description rows="2" maxlength="4000" placeholder="外观、背景与当前状态">${esc(npc.description || '')}</textarea></label>
    <div class="world-draft-entry-grid">
      <label class="field"><span>性格</span><textarea data-npc-personality rows="2" maxlength="2000" placeholder="性格与行为习惯">${esc(npc.personality || '')}</textarea></label>
      <label class="field"><span>说话方式</span><textarea data-npc-speech rows="2" maxlength="2000" placeholder="语气、口头禅或表达风格">${esc(npc.speechStyle || '')}</textarea></label>
    </div>
    <div class="world-draft-entry-grid">
      <label class="field"><span>公开事实</span><input data-npc-facts value="${esc(Array.isArray(npc.publicFacts) ? npc.publicFacts.join(', ') : '')}" maxlength="1000" placeholder="逗号分隔" /></label>
      <label class="field"><span>公开目标</span><input data-npc-goals value="${esc(Array.isArray(npc.publicGoals) ? npc.publicGoals.join(', ') : '')}" maxlength="1000" placeholder="逗号分隔" /></label>
    </div>
    <div class="world-draft-entry-grid">
      <label class="field"><span>欲望 / 追求</span><input data-npc-desires value="${esc(Array.isArray(npc.desires) ? npc.desires.join(', ') : '')}" maxlength="1000" placeholder="逗号分隔" /></label>
      <label class="field"><span>恐惧 / 顾虑</span><input data-npc-fears value="${esc(Array.isArray(npc.fears) ? npc.fears.join(', ') : '')}" maxlength="1000" placeholder="逗号分隔" /></label>
    </div>
    <div class="world-draft-entry-grid">
      <label class="field"><span>当前目标</span><input data-npc-goal-list value="${esc(Array.isArray(npc.goals) ? npc.goals.join(', ') : '')}" maxlength="1000" placeholder="逗号分隔" /></label>
      <label class="field"><span>日常活动</span><input data-npc-activity value="${esc(npc.activity || '')}" maxlength="2000" placeholder="不在场时正在做什么" /></label>
    </div>
  </article>`;
}
function renderWorldDraftCollections(world) {
  const locations = Array.isArray(world?.locations) ? world.locations : [];
  const npcs = Array.isArray(world?.npcs) ? world.npcs : [];
  const locationList = $('world-draft-locations');
  const npcList = $('world-draft-npcs');
  if (locationList) locationList.innerHTML = locations.length ? locations.map(worldDraftLocationTemplate).join('') : '<p class="world-draft-empty">暂无地点，点击“＋地点”添加。</p>';
  if (npcList) npcList.innerHTML = npcs.length ? npcs.map((npc, index) => worldDraftNpcTemplate(npc, index, locations)).join('') : '<p class="world-draft-empty">暂无 NPC，点击“＋NPC”添加。</p>';
  locationList?.querySelectorAll('[data-remove-location]').forEach(button => button.addEventListener('click', () => {
    syncWorldDraftCollectionsFromForm();
    const index = Number(button.closest('[data-index]')?.dataset.index);
    worldDraft.world.locations.splice(index, 1);
    worldDraftDirty = true;
    renderWorldDraftCollections(worldDraft.world);
  }));
  npcList?.querySelectorAll('[data-remove-npc]').forEach(button => button.addEventListener('click', () => {
    syncWorldDraftCollectionsFromForm();
    const index = Number(button.closest('[data-index]')?.dataset.index);
    worldDraft.world.npcs.splice(index, 1);
    worldDraftDirty = true;
    renderWorldDraftCollections(worldDraft.world);
  }));
}
function syncWorldDraftCollectionsFromForm() {
  if (!worldDraft) return;
  const { locations, npcs } = collectWorldDraftCollections();
  worldDraft.world.locations = locations;
  worldDraft.world.npcs = npcs;
}
function addWorldDraftLocation() {
  if (!worldDraft) return;
  syncWorldDraftCollectionsFromForm();
  if (!Array.isArray(worldDraft.world.locations)) worldDraft.world.locations = [];
  worldDraft.world.locations.push({ id: 'location-' + uid(), name: '新地点', type: 'region', summary: '', tags: [] });
  worldDraftDirty = true;
  renderWorldDraftCollections(worldDraft.world);
  $('world-draft-locations')?.lastElementChild?.querySelector('input')?.focus();
}
function addWorldDraftNpc() {
  if (!worldDraft) return;
  syncWorldDraftCollectionsFromForm();
  if (!Array.isArray(worldDraft.world.npcs)) worldDraft.world.npcs = [];
  worldDraft.world.npcs.push({ id: 'npc-' + uid(), name: '新 NPC', role: '', locationId: null, description: '', personality: '', publicFacts: [], publicGoals: [], desires: [], fears: [], goals: [], activity: '' });
  worldDraftDirty = true;
  renderWorldDraftCollections(worldDraft.world);
  $('world-draft-npcs')?.lastElementChild?.querySelector('input')?.focus();
}
function collectWorldDraftCollections() {
  const locations = [...document.querySelectorAll('#world-draft-locations .world-draft-location')].map(row => ({
    id: row.querySelector('[data-location-id]')?.value.trim() || '',
    name: row.querySelector('[data-location-name]')?.value.trim() || '',
    type: row.querySelector('[data-location-type]')?.value.trim() || '',
    summary: row.querySelector('[data-location-summary]')?.value || '',
    tags: splitWorldDraftList(row.querySelector('[data-location-tags]')?.value),
  }));
  const npcs = [...document.querySelectorAll('#world-draft-npcs .world-draft-npc')].map(row => {
    const index = Number(row.dataset.index);
    const previous = worldDraft?.world?.npcs?.[index] || {};
    const personality = row.querySelector('[data-npc-personality]')?.value || '';
    return {
      ...previous,
      id: row.querySelector('[data-npc-id]')?.value.trim() || '',
      name: row.querySelector('[data-npc-name]')?.value.trim() || '',
      role: row.querySelector('[data-npc-role]')?.value.trim() || '',
      locationId: row.querySelector('[data-npc-location]')?.value || null,
      description: row.querySelector('[data-npc-description]')?.value || '',
      personality,
      speechStyle: row.querySelector('[data-npc-speech]')?.value || '',
      publicFacts: splitWorldDraftList(row.querySelector('[data-npc-facts]')?.value),
      publicGoals: splitWorldDraftList(row.querySelector('[data-npc-goals]')?.value),
      desires: splitWorldDraftList(row.querySelector('[data-npc-desires]')?.value),
      fears: splitWorldDraftList(row.querySelector('[data-npc-fears]')?.value),
      goals: splitWorldDraftList(row.querySelector('[data-npc-goal-list]')?.value),
      activity: row.querySelector('[data-npc-activity]')?.value.trim() || '',
      ...(Array.isArray(previous.secrets) ? { secrets: previous.secrets } : {}),
    };
  });
  return { locations, npcs };
}
function fillWorldDraftForm(draft) {
  const world = draft?.world || {};
  $('world-draft-name').value = world.title || '';
  $('world-draft-summary').value = world.summary || '';
  $('world-draft-tags').value = Array.isArray(world.tags) ? world.tags.join(', ') : '';
  $('world-draft-lorebooks').value = Array.isArray(world.lorebookIds) ? world.lorebookIds.join(', ') : '';
  $('world-draft-player-creation').value = world.playerCreation ? JSON.stringify(world.playerCreation, null, 2) : '';
  $('world-draft-turn-contract').value = world.turnContract ? JSON.stringify(world.turnContract, null, 2) : '';
  $('world-draft-failure').value = world.failure ? JSON.stringify(world.failure, null, 2) : '';
  $('world-draft-ending').value = world.ending ? JSON.stringify(world.ending, null, 2) : '';
  $('world-draft-time').value = world.time ? JSON.stringify(world.time, null, 2) : '';
  $('world-draft-events').value = Array.isArray(world.events) ? JSON.stringify(world.events, null, 2) : '';
  $('world-draft-factions').value = Array.isArray(world.factions) ? JSON.stringify(world.factions, null, 2) : '';
  fillWorldDraftMapForm(world);
  renderWorldDraftCollections(world);
  $('world-draft-base').textContent = `基于已发布 v${draft.baseVersion}；草稿修改不会影响旧版本或已有存档。`;
  $('world-draft-publish').textContent = `发布为 v${Number(draft.baseVersion) + 1}`;
}
async function openWorldDraftEditor() {
  const world = worldCardById(currentWorldId);
  const dialog = $('world-draft-dialog');
  if (!world || !dialog) return showWorldError('请先选择一个世界卡。');
  worldDraftOpener = document.activeElement;
  setWorldDraftStatus('正在读取草稿…');
  try {
    const res = await fetch('/api/world-drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ worldId: world.id, baseVersion: world.version }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(worldApiError(data, '世界草稿读取失败（HTTP ' + res.status + '）'));
    worldDraft = data;
    worldDraftDirty = false;
    worldDraftPublishId = null;
    fillWorldDraftForm(data);
    setWorldDraftStatus(data.createdAt === data.updatedAt ? '草稿已创建，修改后点击保存。' : '已载入上次保存的草稿。');
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => $('world-draft-name')?.focus());
  } catch (err) {
    setWorldDraftStatus(err.message, 'error');
  }
}
function requestCloseWorldDraft() {
  const dialog = $('world-draft-dialog');
  if (!dialog?.open) return;
  if (worldDraftDirty && !confirm('草稿还有未保存的修改，确定关闭吗？')) return;
  worldDraftDirty = false;
  dialog.close('cancel');
  worldDraftOpener?.focus?.();
  worldDraftOpener = null;
}
async function saveWorldDraft() {
  if (!worldDraft) return false;
  const title = $('world-draft-name').value.trim();
  const summary = $('world-draft-summary').value;
  const tags = splitWorldDraftList($('world-draft-tags').value);
  const lorebookIds = splitWorldDraftList($('world-draft-lorebooks').value);
  const mapGeneration = collectWorldDraftMapGeneration();
  const { locations, npcs } = collectWorldDraftCollections();
  let playerCreation = null;
  const playerCreationText = $('world-draft-player-creation').value.trim();
  if (playerCreationText) {
    try { playerCreation = JSON.parse(playerCreationText); }
    catch { setWorldDraftStatus('玩家创建规则不是有效 JSON。', 'error'); $('world-draft-player-creation').focus(); return false; }
  }
  let turnContract = null;
  const turnContractText = $('world-draft-turn-contract').value.trim();
  if (turnContractText) {
    try { turnContract = JSON.parse(turnContractText); }
    catch { setWorldDraftStatus('回合契约不是有效 JSON。', 'error'); $('world-draft-turn-contract').focus(); return false; }
  }
  let failure = null;
  const failureText = $('world-draft-failure').value.trim();
  if (failureText) {
    try { failure = JSON.parse(failureText); }
    catch { setWorldDraftStatus('失败与死亡规则不是有效 JSON。', 'error'); $('world-draft-failure').focus(); return false; }
  }
  let ending = null;
  const endingText = $('world-draft-ending').value.trim();
  if (endingText) {
    try { ending = JSON.parse(endingText); }
    catch { setWorldDraftStatus('开放式结局不是有效 JSON。', 'error'); $('world-draft-ending').focus(); return false; }
  }
  let time = null;
  const timeText = $('world-draft-time').value.trim();
  if (timeText) {
    try { time = JSON.parse(timeText); }
    catch { setWorldDraftStatus('世界时间不是有效 JSON。', 'error'); $('world-draft-time').focus(); return false; }
  }
  let events = null;
  const eventsText = $('world-draft-events').value.trim();
  if (eventsText) {
    try {
      events = JSON.parse(eventsText);
      if (!Array.isArray(events)) throw new Error('必须是数组');
    } catch { setWorldDraftStatus('世界事件不是有效 JSON 数组。', 'error'); $('world-draft-events').focus(); return false; }
  }
  let factions = null;
  const factionsText = $('world-draft-factions').value.trim();
  if (factionsText) {
    try {
      factions = JSON.parse(factionsText);
      if (!Array.isArray(factions)) throw new Error('必须是数组');
    } catch { setWorldDraftStatus('派系不是有效 JSON 数组。', 'error'); $('world-draft-factions').focus(); return false; }
  }
  const titleInput = $('world-draft-name');
  if (!title) {
    setWorldDraftStatus('世界标题不能为空。', 'error');
    titleInput.focus();
    return false;
  }
  const btn = $('world-draft-save');
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = '保存中…';
  setWorldDraftStatus('正在保存草稿…');
  try {
    const res = await fetch('/api/world-drafts/' + encodeURIComponent(worldDraft.worldId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ expectedUpdatedAt: worldDraft.updatedAt, baseVersion: worldDraft.baseVersion, title, summary, tags, lorebookIds, mapGeneration, locations, npcs, playerCreation, turnContract, failure, ending, time, events, factions }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(worldApiError(data, '世界草稿保存失败（HTTP ' + res.status + '）'));
    worldDraft = data;
    worldDraftDirty = false;
    worldDraftPublishId = null;
    fillWorldDraftForm(data);
    setWorldDraftStatus(`草稿已保存，可以发布为 v${Number(data.baseVersion) + 1}。`, 'ok');
    return true;
  } catch (err) {
    setWorldDraftStatus(err.message, 'error');
    return false;
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}
async function publishWorldDraft() {
  if (!worldDraft || !$('world-draft-form').reportValidity()) return;
  if (worldDraftDirty && !await saveWorldDraft()) return;
  const title = worldDraft.world?.title || '未命名世界';
  const nextVersion = Number(worldDraft.baseVersion) + 1;
  if (!confirm(`将“${title}”发布为 v${nextVersion}？\n\n已发布版本不可覆盖；现有存档仍绑定各自原版本。`)) return;
  worldDraftPublishId ||= 'publish-' + uid();
  const publishButton = $('world-draft-publish');
  const saveButton = $('world-draft-save');
  const oldLabel = publishButton.textContent;
  publishButton.disabled = true;
  saveButton.disabled = true;
  publishButton.textContent = '发布中…';
  setWorldDraftStatus(`正在发布 v${nextVersion}…`);
  try {
    const res = await fetch('/api/world-drafts/' + encodeURIComponent(worldDraft.worldId) + '/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ commandId: worldDraftPublishId, expectedUpdatedAt: worldDraft.updatedAt, baseVersion: worldDraft.baseVersion }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const error = new Error(worldApiError(data, '世界草稿发布失败（HTTP ' + res.status + '）'));
      error.status = res.status;
      throw error;
    }
    const published = data?.world;
    if (!published || published.id !== worldDraft.worldId || Number(published.version) !== nextVersion) throw new Error('发布响应缺少新世界版本');
    worldDraft = null;
    worldDraftDirty = false;
    worldDraftPublishId = null;
    $('world-draft-dialog').close('published');
    worldDraftOpener = null;
    await loadWorldLibraryData();
    const status = $('world-open-status');
    if (status) status.textContent = `已发布“${published.title}” v${published.version}；旧存档仍固定在各自世界版本。`;
    $('world-edit-draft')?.focus();
  } catch (err) {
    const recovery = err.status === 409 ? '；草稿已保留，请先处理版本冲突。' : '；可直接重试发布。';
    setWorldDraftStatus(err.message + recovery, 'error');
  } finally {
    publishButton.disabled = false;
    saveButton.disabled = false;
    publishButton.textContent = worldDraft ? oldLabel : `发布为 v${nextVersion}`;
  }
}
async function loadWorldSaves(worldId) {
  if (!worldId) return [];
  const res = await fetch('/api/world-saves?worldId=' + encodeURIComponent(worldId));
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(worldApiError(data, '存档列表读取失败（HTTP ' + res.status + '）'));
  const saves = Array.isArray(data) ? data : [];
  worldSavesByWorld.set(worldId, saves);
  return saves;
}
async function openWorldSave(saveId, expectedToken = worldLoadToken) {
  if (worldTurnPending && worldTurnPending.saveId !== saveId) discardWorldTurnPending();
  const res = await fetch('/api/world-saves/' + encodeURIComponent(saveId));
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(worldApiError(data, '存档读取失败（HTTP ' + res.status + '）'));
  if (!data || data.id !== saveId) throw new Error('存档响应缺少稳定 ID');
  if (expectedToken !== worldLoadToken) return null;
  await loadWorldCardVersion(data.worldId, data.worldVersion);
  if (expectedToken !== worldLoadToken) return null;
  hydrateWorldSave(data);
  currentWorldSave = data;
  currentWorldSaveId = data.id;
  currentWorldId = data.worldId;
  localStorage.setItem(LS_CURRENT_WORLD, currentWorldId);
  localStorage.setItem(LS_CURRENT_WORLD_SAVE, currentWorldSaveId);
  renderWorldDetail();
  renderDebugTerminal();
  return currentWorldSave;
}
function setWorldPlayerStatus(message, kind = '') {
  const el = $('world-player-status');
  if (el) { el.textContent = message || ''; el.className = `world-draft-status${kind ? ' ' + kind : ''}`; }
}
function playerFieldInput(field, value = '') {
  const id = String(field.id);
  const label = esc(field.label || id);
  const required = field.required ? ' required' : '';
  if (field.type === 'textarea') return `<label class="field"><span>${label}${field.required ? ' *' : ''}</span><textarea data-player-field="${esc(id)}" rows="3" maxlength="${esc(field.maxLength || 2000)}" placeholder="${esc(field.placeholder || '')}"${required}>${esc(value)}</textarea></label>`;
  if (field.type === 'select') {
    const options = (field.options || []).map(option => {
      const optionValue = typeof option === 'string' ? option : option.value;
      const optionLabel = typeof option === 'string' ? option : option.label;
      return `<option value="${esc(optionValue)}"${String(value) === String(optionValue) ? ' selected' : ''}>${esc(optionLabel)}</option>`;
    }).join('');
    return `<label class="field"><span>${label}${field.required ? ' *' : ''}</span><select data-player-field="${esc(id)}"${required}>${options}</select></label>`;
  }
  const type = field.type === 'number' ? 'number' : 'text';
  const attrs = field.type === 'number'
    ? ` min="${esc(field.min ?? '')}" max="${esc(field.max ?? '')}" step="${esc(field.step || 'any')}" inputmode="decimal"`
    : ` maxlength="${esc(field.maxLength || 2000)}"`;
  return `<label class="field"><span>${label}${field.required ? ' *' : ''}</span><input type="${type}" data-player-field="${esc(id)}" value="${esc(value)}"${attrs}${required}></label>`;
}
function renderWorldPlayerForm(world) {
  const schema = world?.playerCreation || {};
  $('world-player-title').textContent = schema.title || '创建你的冒险者';
  $('world-player-intro').textContent = schema.description || '填写的内容只属于当前存档。';
  const body = $('world-player-fields');
  const fields = Array.isArray(schema.fields) ? schema.fields : [];
  const attributes = Array.isArray(schema.attributes) ? schema.attributes : [];
  const skills = Array.isArray(schema.skills) ? schema.skills : [];
  const resources = Array.isArray(schema.resources) ? schema.resources : [];
  const traits = Array.isArray(schema.traits) ? schema.traits : [];
  const relations = Array.isArray(schema.relations) ? schema.relations : [];
  const initialFields = world.start?.playerTemplate || {};
  const sections = [];
  if (schema.pointBudget) sections.push(`<p class="world-player-budget">${esc(schema.pointBudget.label || '属性点')}：<strong data-player-budget>${esc(schema.pointBudget.total)}</strong> / ${esc(schema.pointBudget.total)}</p>`);
  if (fields.length) sections.push(fields.map(field => playerFieldInput(field, initialFields[field.id] ?? field.default ?? '')).join(''));
  if (attributes.length) sections.push(`<section class="field"><span>属性</span><div class="world-player-attribute-grid">${attributes.map(attribute => `<label class="field"><span>${esc(attribute.label)} <small>${esc(attribute.min ?? 0)}-${esc(attribute.max ?? 100)}</small></span><input type="number" data-player-attribute="${esc(attribute.id)}" value="${esc(attribute.default ?? attribute.min ?? 0)}" min="${esc(attribute.min ?? 0)}" max="${esc(attribute.max ?? 100)}" step="${esc(attribute.step || 1)}" inputmode="numeric"></label>`).join('')}</div></section>`);
  if (skills.length) sections.push(`<section class="field"><span>技能</span><div class="world-player-attribute-grid">${skills.map(skill => `<label class="field"><span>${esc(skill.label)} <small>${esc(skill.min ?? 0)}-${esc(skill.max ?? 100)}</small></span><input type="number" data-player-skill="${esc(skill.id)}" value="${esc(skill.default ?? skill.min ?? 0)}" min="${esc(skill.min ?? 0)}" max="${esc(skill.max ?? 100)}" step="${esc(skill.step || 1)}" inputmode="numeric"></label>`).join('')}</div></section>`);
  if (resources.length) sections.push(`<section class="field"><span>初始资源</span><div class="world-player-resource-grid">${resources.map(resource => `<label class="field"><span>${esc(resource.label)}</span><input type="number" data-player-resource="${esc(resource.id)}" value="${esc(resource.initial ?? resource.min ?? 0)}" min="${esc(resource.min ?? 0)}" max="${esc(resource.max ?? 1000000)}" step="any" inputmode="decimal"></label>`).join('')}</div></section>`);
  if (traits.length) sections.push(`<fieldset class="field world-player-traits"><legend>特质（可选）</legend>${traits.map(trait => `<div class="world-player-trait"><input id="world-player-trait-${esc(trait.id)}" type="checkbox" data-player-trait="${esc(trait.id)}"><div><label for="world-player-trait-${esc(trait.id)}">${esc(trait.label)}</label>${trait.description ? `<small>${esc(trait.description)}</small>` : ''}</div></div>`).join('')}</fieldset>`);
  if (relations.length) {
    const npcs = new Map((world.npcs || []).map(npc => [npc.id, npc.name || npc.id]));
    sections.push(`<section class="field"><span>起始关系</span><div class="world-player-resource-grid">${relations.map(rule => `<label class="field"><span>${esc(npcs.get(rule.npcId) || rule.npcId)}</span><input type="number" data-player-relation="${esc(rule.npcId)}" value="${esc(rule.default ?? 0)}" min="${esc(rule.min ?? -100)}" max="${esc(rule.max ?? 100)}" step="1" inputmode="numeric"></label>`).join('')}</div></section>`);
  }
  body.innerHTML = sections.join('') || '<p class="world-empty">当前世界卡没有额外建角字段，将使用默认玩家模板。</p>';
  body.querySelectorAll('[data-player-attribute]').forEach(input => input.addEventListener('input', updateWorldPlayerBudget));
  updateWorldPlayerBudget();
}
function updateWorldPlayerBudget() {
  const world = currentWorldCard();
  const total = Number(world?.playerCreation?.pointBudget?.total);
  const el = document.querySelector('[data-player-budget]');
  if (!el || !Number.isFinite(total)) return;
  const spent = [...document.querySelectorAll('[data-player-attribute]')].reduce((sum, input) => sum + (Number(input.value) || 0), 0);
  el.textContent = String(Math.max(0, total - spent));
  el.parentElement?.classList.toggle('world-player-budget-over', spent > total);
}
function collectWorldPlayerInput() {
  const player = { fields: {}, attributes: {}, skills: {}, resources: {}, traits: [], relations: {} };
  document.querySelectorAll('[data-player-field]').forEach(input => { player.fields[input.dataset.playerField] = input.type === 'number' ? Number(input.value) : input.value; });
  document.querySelectorAll('[data-player-attribute]').forEach(input => { player.attributes[input.dataset.playerAttribute] = Number(input.value); });
  document.querySelectorAll('[data-player-skill]').forEach(input => { player.skills[input.dataset.playerSkill] = Number(input.value); });
  document.querySelectorAll('[data-player-resource]').forEach(input => { player.resources[input.dataset.playerResource] = Number(input.value); });
  document.querySelectorAll('[data-player-trait]:checked').forEach(input => player.traits.push(input.dataset.playerTrait));
  document.querySelectorAll('[data-player-relation]').forEach(input => { player.relations[input.dataset.playerRelation] = Number(input.value); });
  return player;
}
function closeWorldPlayerDialog(result = 'cancel') {
  const dialog = $('world-player-dialog');
  if (!dialog?.open) return;
  const saveButton = pendingWorldSaveButton;
  dialog.close(result);
  worldPlayerOpener?.focus?.();
  if (saveButton) saveButton.disabled = false;
  worldPlayerOpener = null;
  pendingWorldSaveButton = null;
  pendingWorldSaveName = '';
}
async function openWorldPlayerCreation(name, button) {
  const world = worldCardById(currentWorldId);
  if (!world) throw new Error('请先选择一个世界卡');
  await loadWorldCardVersion(world.id, world.version);
  const fullWorld = currentWorldCard();
  if (!fullWorld?.playerCreation || fullWorld.playerCreation.mode === 'preset') return createWorldSave(name);
  pendingWorldSaveName = name;
  pendingWorldSaveButton = button;
  worldPlayerOpener = button || document.activeElement;
  renderWorldPlayerForm(fullWorld);
  setWorldPlayerStatus('创建后，玩家快照与当前存档绑定。', '');
  const dialog = $('world-player-dialog');
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => dialog.querySelector('input, textarea, select')?.focus());
  return null;
}
async function createWorldSave(name, player) {
  if (worldTurnPending) discardWorldTurnPending();
  const world = worldCardById(currentWorldId);
  if (!world) throw new Error('请先选择一个世界卡');
  const res = await fetch('/api/world-saves', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ worldId: world.id, worldVersion: world.version, name, ...(player ? { player } : {}) }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(worldApiError(data, '存档创建失败（HTTP ' + res.status + '）'));
  await loadWorldCardVersion(data.worldId, data.worldVersion);
  hydrateWorldSave(data);
  currentWorldSave = data;
  currentWorldSaveId = data.id;
  localStorage.setItem(LS_CURRENT_WORLD, data.worldId);
  localStorage.setItem(LS_CURRENT_WORLD_SAVE, data.id);
  await loadWorldSaves(data.worldId);
  await loadWorldCards();
  renderWorldList();
  renderWorldDetail();
  if (data.openingMode === 'ai') generateWorldOpening(data).catch(err => {
    const status = $('world-open-status');
    if (status && currentWorldSaveId === data.id) status.textContent = `存档已创建；AI 开场生成失败，已保留卡片开场：${err.message}`;
  });
  return data;
}
async function generateWorldOpening(save) {
  if (!save || save.openingMode !== 'ai' || !settings.baseUrl || worldOpeningGeneration) return save;
  const world = currentWorldCard();
  if (!world || !currentWorldSave || currentWorldSave.id !== save.id) return save;
  worldOpeningGeneration = save.id;
  const status = $('world-open-status');
  if (status) status.textContent = '正在根据玩家与世界卡生成独立开场…';
  try {
    const payload = buildPayload();
    payload.body.messages.push({ role: 'user', content: '【开场生成任务】这是一个新建世界存档。请根据当前世界卡、玩家快照、起始地点、在场 NPC 与卡片规则，生成可直接展示给玩家的开场叙事。不要替玩家决定未声明的核心意图；结尾停在玩家可以回应的局面。必须在末尾输出唯一的 ```rpg``` JSON，包含恰好 4 个具体行动选项和当前初始状态，未变化字段使用 null。' });
    let reply;
    if (payload.body.stream) reply = (await callAPIStream(payload)).content;
    else reply = (await callAPI(payload))?.choices?.[0]?.message?.content;
    const processed = processAIOutput(reply || '');
    if (!processed.content || !processed.options || processed.options.length !== 4) throw new Error('AI 未返回合规的开场正文与 4 个选项');
    const response = await fetch('/api/world-saves/' + encodeURIComponent(save.id) + '/opening', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ commandId: uid(), expectedRevision: save.revision, opening: processed.content, options: processed.options }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(worldApiError(data, '开场提交失败（HTTP ' + response.status + '）'));
    if (currentWorldSaveId === save.id) {
      hydrateWorldSave(data);
      currentWorldSave = data;
      renderWorldDetail();
      renderMessages();
      const nextStatus = $('world-open-status');
      if (nextStatus) nextStatus.textContent = `已生成并绑定「${data.name}」的独立开场；存档 revision：${data.revision}`;
    }
    return data;
  } finally {
    worldOpeningGeneration = null;
  }
}
async function exportCurrentWorldPackage() {
  const world = worldCardById(currentWorldId);
  if (!world) return showWorldError('请先选择一个世界卡。');
  const button = $('world-export');
  const oldLabel = button.textContent;
  button.disabled = true;
  button.textContent = '⏳ 导出中…';
  showWorldError('');
  try {
    const res = await fetch(`/api/worlds/${encodeURIComponent(world.id)}/export?version=${encodeURIComponent(world.version)}`);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = null; }
    if (!res.ok || !data) throw new Error(worldApiError(data, '世界包导出失败（HTTP ' + res.status + '）'));
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${String(world.title || world.id).replace(/[\\/:*?"<>|]/g, '_')}-v${world.version}.tavern-world.json`;
    link.click();
    URL.revokeObjectURL(url);
    const warnings = data.manifest?.warnings?.length || 0;
    const status = $('world-open-status');
    if (status) status.textContent = `已导出世界 v${world.version}；SHA-256 ${String(data.manifest?.contentHash || '').replace(/^sha256:/, '').slice(0, 12)}${warnings ? `；${warnings} 项引用警告已写入清单` : ''}。`;
  } catch (err) {
    showWorldError(err.message);
  } finally {
    button.disabled = false;
    button.textContent = oldLabel;
  }
}
function setWorldImportStatus(message, kind = '') {
  const el = $('world-import-status');
  el.textContent = message || '';
  el.className = 'world-draft-status' + (kind ? ' ' + kind : '');
}
function renderWorldImportReport(imported) {
  const root = $('world-import-report');
  const report = imported?.report;
  if (!report) { root.innerHTML = ''; return; }
  const refs = report.references || {};
  const facts = [['角色', refs.characters || 0], ['世界书', refs.lorebooks || 0], ['预设', refs.presets || 0], ['资源', refs.assets || 0]]
    .map(([label, value]) => `<span><b>${esc(value)}</b>${label}</span>`).join('');
  const errors = report.errors?.length ? `<section class="world-import-errors"><h3>无法导入</h3><ul>${report.errors.map(error => `<li>${esc(error)}</li>`).join('')}</ul></section>` : '<p class="world-import-ready">✓ 校验通过；确认后会创建新的独立世界，不覆盖本地内容。</p>';
  const warnings = report.warnings?.length ? `<section class="world-import-warnings"><h3>保留与隔离</h3><ul>${report.warnings.map(warning => `<li>${esc(warning)}</li>`).join('')}</ul></section>` : '';
  const inert = report.inertPaths?.length ? `<p class="world-import-inert">未执行：${report.inertPaths.map(esc).join('、')}</p>` : '';
  root.innerHTML = `<div class="world-import-facts">${facts}</div>${errors}${warnings}${inert}`;
}
function openWorldPackageImport() {
  const input = $('world-import-file');
  if (!input) return;
  worldImportOpener = document.activeElement;
  input.value = '';
  input.click();
}
async function previewWorldPackageImport(file) {
  if (!file) return;
  const dialog = $('world-import-dialog');
  const commit = $('world-import-commit');
  worldImport = null;
  commit.disabled = true;
  renderWorldImportReport(null);
  setWorldImportStatus('正在读取并封存世界包…');
  if (!dialog.open) dialog.showModal();
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('世界包超过 2 MiB 限制');
    const raw = await file.text();
    const res = await fetch('/api/world-imports', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ raw }),
    });
    const data = await res.json().catch(() => null);
    if (!data || !data.id) throw new Error(worldApiError(data, '世界包封存失败（HTTP ' + res.status + '）'));
    worldImport = data;
    $('world-import-base').textContent = `“${file.name}”已封存 · ${String(data.rawHash || '').replace(/^sha256:/, '').slice(0, 12)}`;
    renderWorldImportReport(data);
    commit.disabled = !data.report?.canImport;
    setWorldImportStatus(data.report?.canImport ? '原件已封存；导入不会覆盖现有世界、角色、世界书或预设。' : '原件已封存，但校验未通过；不会写入世界库。', data.report?.canImport ? 'ok' : 'error');
  } catch (err) {
    setWorldImportStatus(err.message, 'error');
  }
}
function closeWorldPackageImport() {
  const dialog = $('world-import-dialog');
  if (!dialog?.open) return;
  dialog.close('cancel');
  worldImport = null;
  worldImportOpener?.focus?.();
  worldImportOpener = null;
}

function setRpgMigrationStatus(message, kind = '') {
  const el = $('rpg-migration-status');
  if (el) { el.textContent = message || ''; el.className = 'world-draft-status' + (kind ? ' ' + kind : ''); }
}
function renderRpgMigrationReport(data) {
  const root = $('rpg-migration-report');
  const report = data?.report;
  if (!report) { root.innerHTML = '<p>选择会话后查看只读迁移预览。</p>'; return; }
  const errors = (report.errors || []).map(v => `<li>${esc(v)}</li>`).join('');
  const warnings = (report.warnings || []).map(v => `<li>${esc(v)}</li>`).join('');
  root.innerHTML = `<div class="world-import-facts"><span><b>${esc(report.source?.turns || 0)}</b>回合</span><span><b>${esc(report.state?.inventory || 0)}</b>背包</span><span><b>${esc(report.state?.quests || 0)}</b>任务</span><span><b>${report.state?.hasMap ? '有' : '无'}</b>地图</span></div>${errors ? `<section class="world-import-errors"><h3>无法迁移</h3><ul>${errors}</ul></section>` : '<p class="world-import-ready">✓ 校验通过；原会话不会被修改。</p>'}${warnings ? `<section class="world-import-warnings"><h3>迁移提示</h3><ul>${warnings}</ul></section>` : ''}`;
}
function legacyRpgSessions() {
  return (Array.isArray(sessions) ? sessions : []).filter(s => s && s.kind === 'rpg' && (!currentCharId || s.charId === currentCharId));
}
function migrationCharacterSnapshot() {
  const char = currentChar() || {};
  const copy = { name: char.name, race: char.race, role: char.role, persona: char.persona, profileFields: Array.isArray(char.profileFields) ? char.profileFields : [] };
  return Object.fromEntries(Object.entries(copy).filter(([, value]) => value !== undefined));
}
function renderRpgMigrationSessions() {
  const select = $('rpg-migration-session');
  const list = legacyRpgSessions();
  select.innerHTML = list.length ? list.map(s => `<option value="${esc(s.id)}">${esc(s.name || s.id)} · ${esc((s.messages || []).length)} 回合</option>`).join('') : '<option value="">没有可迁移的旧 RPG 会话</option>';
  $('rpg-migration-commit').disabled = true;
  renderRpgMigrationReport(null);
  return list;
}
async function previewRpgMigration() {
  const id = $('rpg-migration-session').value;
  const session = legacyRpgSessions().find(s => s.id === id);
  const world = currentWorldCard();
  const commit = $('rpg-migration-commit');
  rpgMigration = null;
  commit.disabled = true;
  renderRpgMigrationReport(null);
  if (!session || !world) { setRpgMigrationStatus('请先选择目标世界与旧 RPG 会话。', 'error'); return; }
  setRpgMigrationStatus('正在封存原会话并生成只读预览…');
  const envelope = { schemaVersion: 1, kind: 'legacy-rpg-session', name: session.name, worldId: world.id, worldVersion: world.version, session, characterSnapshot: migrationCharacterSnapshot() };
  try {
    const raw = JSON.stringify(envelope);
    const res = await fetch('/api/rpg-migrations', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ raw }) });
    const data = await res.json().catch(() => null);
    if (!data?.id) throw new Error(worldApiError(data, '迁移预览失败（HTTP ' + res.status + '）'));
    rpgMigration = data;
    $('rpg-migration-base').textContent = `“${session.name || session.id}”已封存 · ${String(data.rawHash || '').replace(/^sha256:/, '').slice(0, 12)}`;
    renderRpgMigrationReport(data);
    commit.disabled = !data.report?.canMigrate;
    setRpgMigrationStatus(data.report?.canMigrate ? '原件已封存；确认后才创建世界存档。' : '原件已封存，但校验未通过。', data.report?.canMigrate ? 'ok' : 'error');
  } catch (err) { setRpgMigrationStatus(err.message, 'error'); }
}
function openRpgMigration() {
  rpgMigrationOpener = document.activeElement;
  renderRpgMigrationSessions();
  const dialog = $('rpg-migration-dialog');
  if (!dialog.open) dialog.showModal();
  if ($('rpg-migration-session').value) previewRpgMigration();
}
function closeRpgMigration() {
  const dialog = $('rpg-migration-dialog');
  if (dialog?.open) dialog.close('cancel');
  rpgMigration = null;
  rpgMigrationOpener?.focus?.();
  rpgMigrationOpener = null;
}
async function commitRpgMigration() {
  const migration = rpgMigration;
  if (!migration?.report?.canMigrate) return;
  const button = $('rpg-migration-commit');
  button.disabled = true; button.textContent = '迁移中…'; setRpgMigrationStatus('正在创建独立世界存档…');
  try {
    const res = await fetch('/api/rpg-migrations/' + encodeURIComponent(migration.id), { method: 'POST' });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.save?.id) throw new Error(worldApiError(data, '迁移失败（HTTP ' + res.status + '）'));
    currentWorldId = data.save.worldId; currentWorldSaveId = data.save.id; currentWorldSave = data.save;
    localStorage.setItem(LS_CURRENT_WORLD, currentWorldId); localStorage.setItem(LS_CURRENT_WORLD_SAVE, currentWorldSaveId);
    closeRpgMigration(); await loadWorldLibraryData(true); enterWorldWorkspace();
  } catch (err) { setRpgMigrationStatus(err.message, 'error'); button.disabled = false; }
  finally { button.textContent = '确认迁移'; }
}
async function commitWorldPackageImport() {
  const imported = worldImport;
  if (!imported?.report?.canImport) return;
  const button = $('world-import-commit');
  button.disabled = true;
  button.textContent = '导入中…';
  setWorldImportStatus('正在写入独立世界与其专属引用…');
  try {
    const res = await fetch('/api/world-imports/' + encodeURIComponent(imported.id), { method: 'POST' });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.world?.id) throw new Error(worldApiError(data, '世界包导入失败（HTTP ' + res.status + '）'));
    currentWorldId = data.world.id;
    currentWorldSave = null;
    currentWorldSaveId = null;
    localStorage.setItem(LS_CURRENT_WORLD, currentWorldId);
    localStorage.removeItem(LS_CURRENT_WORLD_SAVE);
    const [nextCharacters, nextLorebooks, nextPresets] = await Promise.all([
      loadServerData('characters'), loadServerData('lorebooks'), loadServerData('presets'),
    ]);
    if (Array.isArray(nextCharacters)) characters = nextCharacters;
    if (nextLorebooks && typeof nextLorebooks === 'object') lorebooks = nextLorebooks;
    if (nextPresets && typeof nextPresets === 'object') promptPresets = nextPresets;
    $('world-import-dialog').close('committed');
    worldImport = null;
    worldImportOpener = null;
    await loadWorldLibraryData();
    const status = $('world-open-status');
    if (status) status.textContent = `已导入“${data.world.title}” v${data.world.version}；新世界及其角色、世界书和预设均使用独立 ID。`;
    $('world-save-name')?.focus();
  } catch (err) {
    setWorldImportStatus(err.message, 'error');
    button.disabled = false;
  } finally {
    button.textContent = '确认导入';
  }
}
function setWorldUpgradeStatus(message, kind = '') {
  const el = $('world-upgrade-status');
  el.textContent = message || '';
  el.className = 'world-draft-status' + (kind ? ' ' + kind : '');
}
function renderWorldUpgradeReport(report) {
  const root = $('world-upgrade-report');
  if (!report) {
    root.innerHTML = '<p class="world-upgrade-empty">选择目标版本后查看预演结果。</p>';
    return;
  }
  const groups = [['locations', '地点'], ['npcs', 'NPC'], ['quests', '任务']];
  const changeCards = groups.map(([key, label]) => {
    const changes = report.changes?.[key] || { added: [], removed: [] };
    const entries = [
      ...changes.added.map(entity => `<li class="added"><b>+新增</b><span>${esc(entity.name)}</span><code>${esc(entity.id)}</code></li>`),
      ...changes.removed.map(entity => `<li class="removed"><b>−移除</b><span>${esc(entity.name)}</span><code>${esc(entity.id)}</code></li>`),
    ];
    return `<section class="world-upgrade-change"><h3>${label}<span>${changes.added.length} + / ${changes.removed.length} −</span></h3>${entries.length ? `<ul>${entries.join('')}</ul>` : '<p>无变化</p>'}</section>`;
  }).join('');
  const errors = report.hardErrors?.length
    ? `<section class="world-upgrade-errors" aria-labelledby="world-upgrade-errors-title"><h3 id="world-upgrade-errors-title">⚠ 必须先修复的引用</h3><ul>${report.hardErrors.map(error => `<li><code>${esc(error.path)}</code><span>${esc(error.message)}</span></li>`).join('')}</ul></section>`
    : '<p class="world-upgrade-ready">✓ 引用检查通过，可以升级。</p>';
  root.innerHTML = `<div class="world-upgrade-route"><span>v${esc(report.fromVersion)}</span><i aria-hidden="true">→</i><strong>v${esc(report.targetVersion)}</strong></div><div class="world-upgrade-changes">${changeCards}</div>${errors}`;
}
async function previewWorldSaveUpgrade() {
  const upgrade = worldUpgrade;
  if (!upgrade?.save) return;
  const targetVersion = Number($('world-upgrade-target').value);
  const commit = $('world-upgrade-commit');
  upgrade.report = null;
  upgrade.commandId = null;
  commit.disabled = true;
  renderWorldUpgradeReport(null);
  setWorldUpgradeStatus('正在检查存档引用…');
  try {
    const res = await fetch(`/api/world-saves/${encodeURIComponent(upgrade.save.id)}/upgrade?targetVersion=${encodeURIComponent(targetVersion)}`);
    const report = await res.json().catch(() => null);
    if (!res.ok) throw new Error(worldApiError(report, '存档升级预演失败（HTTP ' + res.status + '）'));
    if (worldUpgrade !== upgrade || Number($('world-upgrade-target').value) !== targetVersion) return;
    upgrade.report = report;
    renderWorldUpgradeReport(report);
    commit.disabled = !report.canUpgrade;
    setWorldUpgradeStatus(report.canUpgrade ? '预演通过；升级会保留当前进度并记录迁移历史。' : '存档存在缺失引用，未做任何修改。', report.canUpgrade ? 'ok' : 'error');
  } catch (err) {
    if (worldUpgrade !== upgrade || Number($('world-upgrade-target').value) !== targetVersion) return;
    setWorldUpgradeStatus(err.message, 'error');
  }
}
async function openWorldSaveUpgrade(saveId, opener) {
  const world = worldCardById(currentWorldId);
  if (!world) return;
  const opening = { save: null, report: null, commandId: null };
  worldUpgrade = opening;
  worldUpgradeOpener = opener || document.activeElement;
  setWorldUpgradeStatus('正在读取世界版本…');
  try {
    const [saveRes, versionsRes] = await Promise.all([
      fetch('/api/world-saves/' + encodeURIComponent(saveId)),
      fetch('/api/worlds/' + encodeURIComponent(world.id) + '/versions'),
    ]);
    const save = await saveRes.json().catch(() => null);
    const versions = await versionsRes.json().catch(() => null);
    if (!saveRes.ok) throw new Error(worldApiError(save, '存档读取失败'));
    if (!versionsRes.ok) throw new Error(worldApiError(versions, '世界版本读取失败'));
    if (!Array.isArray(versions)) throw new Error('世界版本响应格式无效');
    if (worldUpgrade !== opening) return;
    const targets = versions.filter(version => Number(version.version) > Number(save.worldVersion));
    if (!targets.length) {
      worldUpgrade = null;
      worldUpgradeOpener = null;
      return showWorldError('该存档已使用最新世界版本。');
    }
    opening.save = save;
    $('world-upgrade-base').textContent = `“${save.name}”当前绑定 v${save.worldVersion}；预演不会写入存档。`;
    $('world-upgrade-target').innerHTML = targets.map(version => `<option value="${esc(version.version)}">v${esc(version.version)} · ${esc(version.title)}</option>`).join('');
    const dialog = $('world-upgrade-dialog');
    if (!dialog.open) dialog.showModal();
    await previewWorldSaveUpgrade();
    requestAnimationFrame(() => $('world-upgrade-target')?.focus());
  } catch (err) {
    if (worldUpgrade !== opening) return;
    worldUpgrade = null;
    worldUpgradeOpener = null;
    showWorldError(err.message);
  }
}
function closeWorldSaveUpgrade() {
  const dialog = $('world-upgrade-dialog');
  if (!dialog?.open) return;
  dialog.close('cancel');
  worldUpgrade = null;
  worldUpgradeOpener?.focus?.();
  worldUpgradeOpener = null;
}
async function commitWorldSaveUpgrade() {
  const upgrade = worldUpgrade;
  const report = upgrade?.report;
  if (!report?.canUpgrade) return;
  if (!confirm(`将“${upgrade.save.name}”从 v${report.fromVersion} 升级到 v${report.targetVersion}？\n\n升级后保留当前进度，并在存档中记录迁移历史。`)) return;
  upgrade.commandId ||= 'upgrade-' + uid();
  const button = $('world-upgrade-commit');
  button.disabled = true;
  button.textContent = '升级中…';
  setWorldUpgradeStatus('正在提交存档升级…');
  try {
    const res = await fetch('/api/world-saves/' + encodeURIComponent(upgrade.save.id) + '/upgrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ commandId: upgrade.commandId, expectedRevision: upgrade.save.revision, targetVersion: report.targetVersion }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(worldApiError(data, '存档升级失败（HTTP ' + res.status + '）'));
    const upgraded = data.save;
    if (currentWorldSaveId === upgraded.id) {
      await loadWorldCardVersion(upgraded.worldId, upgraded.worldVersion);
      hydrateWorldSave(upgraded);
      currentWorldSave = upgraded;
    }
    if (worldUpgrade === upgrade) {
      $('world-upgrade-dialog').close('upgraded');
      worldUpgrade = null;
      worldUpgradeOpener = null;
    }
    await loadWorldSaves(upgraded.worldId);
    renderWorldDetail();
    const status = $('world-open-status');
    if (status) status.textContent = `已将“${upgraded.name}”升级到世界 v${upgraded.worldVersion}；迁移记录已写入当前存档。`;
    document.querySelector(`[data-open-save="${CSS.escape(upgraded.id)}"]`)?.focus();
  } catch (err) {
    if (worldUpgrade !== upgrade) return;
    setWorldUpgradeStatus(err.message + '；请关闭窗口后重新打开并预演。', 'error');
    button.disabled = false;
  } finally {
    button.textContent = '确认升级';
  }
}
function renderWorldList() {
  const list = $('world-list');
  if (!list) return;
  if (!worldCards.length) {
    list.innerHTML = '<div class="hint">还没有可用的世界卡。</div>';
    return;
  }
  list.innerHTML = worldCards.map(world => {
    const active = world.id === currentWorldId ? ' active' : '';
    const saves = worldSavesByWorld.get(world.id) || [];
    return `<button class="world-item${active}" type="button" data-world-id="${esc(world.id)}">
      <span class="world-item-title">${esc(world.title || world.id)}</span>
      <span class="world-item-summary">${esc(world.summary || '尚无简介')}</span>
      <span class="world-item-meta"><span>v${esc(world.version)}</span><span>${saves.length || world.saveCount || 0} 份存档</span></span>
    </button>`;
  }).join('');
  list.querySelectorAll('[data-world-id]').forEach(el => el.addEventListener('click', async () => {
    if (worldTurnPending) discardWorldTurnPending();
    const token = ++worldLoadToken;
    const id = el.dataset.worldId;
    if (!worldCardById(id)) return;
    currentWorldId = id;
    localStorage.setItem(LS_CURRENT_WORLD, id);
    currentWorldSave = null;
    currentWorldSaveId = null;
    localStorage.removeItem(LS_CURRENT_WORLD_SAVE);
    renderWorldList();
    try {
      await loadWorldSaves(id);
      if (token !== worldLoadToken) return;
      renderWorldDetail(); renderWorldList();
    } catch (err) {
      if (token !== worldLoadToken) return;
      showWorldError(err.message); renderWorldDetail();
    }
  }));
}
function showWorldError(message) {
  const el = $('world-error');
  if (el) el.textContent = message || '';
}
function renderWorldDetail() {
  const empty = $('world-empty');
  const detail = $('world-detail');
  const world = worldCardById(currentWorldId);
  if (!empty || !detail) return;
  if (!world) {
    empty.classList.remove('hidden');
    detail.classList.add('hidden');
    $('world-edit-title').textContent = '选择一个世界';
    return;
  }
  empty.classList.add('hidden');
  detail.classList.remove('hidden');
  $('world-edit-title').textContent = world.title || world.id;
  $('world-version').textContent = 'v' + (world.version ?? 1);
  $('world-title').textContent = world.title || world.id;
  $('world-summary').textContent = world.summary || '尚无世界简介。';
  $('world-tags').innerHTML = (Array.isArray(world.tags) && world.tags.length ? world.tags : ['未分类'])
    .map(tag => `<span class="world-tag">${esc(tag)}</span>`).join('');
  const facts = [
    [world.locationCount || 0, '已登记地点'],
    [world.npcCount || 0, '世界角色'],
    [worldSavesByWorld.get(world.id)?.length || world.saveCount || 0, '独立存档'],
  ];
  $('world-facts').innerHTML = facts.map(([value, label]) => `<div class="world-fact"><b>${esc(value)}</b><span>${esc(label)}</span></div>`).join('');
  showWorldError('');
  const saves = worldSavesByWorld.get(world.id) || [];
  $('world-save-count').textContent = saves.length + ' 份';
  const list = $('world-save-list');
  const latestVersion = Number(world.version);
  list.innerHTML = saves.length ? saves.map(save => `<div class="world-save-card${save.id === currentWorldSaveId ? ' active' : ''}">
    <div class="world-save-main"><span class="world-save-name">${esc(save.name)}</span><span class="world-save-meta">世界 v${esc(save.worldVersion)} · ${esc(save.locationId || '未定位')} · revision ${esc(save.revision)} · ${esc(formatWorldDate(save.updatedAt))}</span></div>
    <div class="world-save-actions">${Number(save.worldVersion) < latestVersion ? `<button class="ghost-btn small" type="button" data-upgrade-save="${esc(save.id)}">升级…</button>` : ''}<button class="ghost-btn small" type="button" data-open-save="${esc(save.id)}">${save.id === currentWorldSaveId ? '已打开' : '打开存档'}</button></div>
  </div>`).join('') : '<p class="hint">这个世界还没有存档，先创建一份吧。</p>';
  list.querySelectorAll('[data-upgrade-save]').forEach(btn => btn.addEventListener('click', () => openWorldSaveUpgrade(btn.dataset.upgradeSave, btn)));
  list.querySelectorAll('[data-open-save]').forEach(btn => btn.addEventListener('click', async () => {
    const token = worldLoadToken;
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '读取中…';
    try {
      const opened = await openWorldSave(btn.dataset.openSave, token);
      if (!opened || token !== worldLoadToken) return;
      const status = $('world-open-status');
      if (status) status.textContent = `已打开「${currentWorldSave.name}」——世界状态、地图和叙事已绑定当前存档；当前存档 ID：${currentWorldSave.id}`;
      enterWorldWorkspace();
    } catch (err) { showWorldError(err.message); }
    finally { btn.disabled = false; btn.textContent = old; }
  }));
  if (currentWorldSave && currentWorldSave.worldId === world.id) {
    const status = $('world-open-status');
    if (status) status.textContent = `已打开「${currentWorldSave.name}」——世界状态、地图和叙事已绑定当前存档；当前存档 ID：${currentWorldSave.id}`;
  }
}
async function loadWorldLibraryData(restoreWorkspace = false) {
  const token = ++worldLoadToken;
  try {
    await loadWorldCards();
    if (token !== worldLoadToken) return false;
    await Promise.all(worldCards.map(world => loadWorldSaves(world.id)));
    if (token !== worldLoadToken) return false;
    if (currentWorldSaveId) {
      try { await openWorldSave(currentWorldSaveId, token); }
      catch { currentWorldSave = null; currentWorldSaveId = null; localStorage.removeItem(LS_CURRENT_WORLD_SAVE); }
    }
    if (token !== worldLoadToken) return false;
    renderWorldList();
    renderWorldDetail();
    if (restoreWorkspace && worldModeActive() && currentWorldSaveId) enterWorldWorkspace();
    return true;
  } catch (err) {
    if (token !== worldLoadToken) return false;
    worldCards = [];
    renderWorldList();
    renderWorldDetail();
    showWorldError(err.message);
    return false;
  }
}
function openWorldLibrary(restoreWorkspace = false) {
  const mgr = $('world-mgr');
  if (!mgr) return;
  mgr.classList.remove('hidden');
  loadWorldLibraryData(restoreWorkspace);
}
function closeWorldLibrary() {
  worldLoadToken++;
  const mgr = $('world-mgr');
  if (mgr) mgr.classList.add('hidden');
}

/* 开场白兜底链：char.firstMes → preset.firstMes → settings.firstMes（新会话 / 清空聊天共用） */
function getGreeting() {
  const char = currentChar();
  const preset = resolvePromptPreset().preset;
  return (char && char.firstMes && char.firstMes.trim())
    || (preset && preset.firstMes && preset.firstMes.trim())
    || settings.firstMes || '';
}
function curSession() { return Array.isArray(sessions) ? sessions.find(s => s.id === currentSessionId && sessionMatches(s)) || null : null; }
function activeConversationScope() { return worldModeActive() ? currentWorldSave : curSession(); }
function curMessages() {
  if (worldModeActive()) return worldTimelineMessages();
  const s = curSession();
  return s ? s.messages : [];
}

/* ═══════════ RPG 状态（每会话独立） ═══════════ */

/* 默认 RPG 状态：优先 _defaults.rpg.initial（数据外置），否则内置兜底 */
function defaultRpgState() {
  const init = (defaults && defaults.rpg && defaults.rpg.initial) || {};
  return {
    level: init.level || 1,
    exp: init.exp || 0,
    expNext: init.expNext || 100,
    hp: init.hp || 20,
    maxHp: init.maxHp || 20,
    mp: init.mp || 5,
    maxMp: init.maxMp || 5,
    gold: init.gold || 0,
    location: init.location || '旅店',
    buffs: Array.isArray(init.buffs) ? init.buffs : [],
    inventory: Array.isArray(init.inventory) ? init.inventory : [],
    quests: Array.isArray(init.quests) ? init.quests : [],
    goals: Array.isArray(init.goals) ? init.goals : [],
    leads: Array.isArray(init.leads) ? init.leads : [],
  };
}

function worldRpgState() {
  if (!worldModeActive()) return null;
  const state = currentWorldSave.state || (currentWorldSave.state = {});
  if (!state.__runtimeRpg) {
    const stats = state.stats && typeof state.stats === 'object' ? state.stats : {};
    const numberOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
    Object.defineProperty(state, '__runtimeRpg', {
      value: {
        level: numberOr(stats.level, 1), exp: numberOr(stats.exp, 0), expNext: numberOr(stats.expNext, 100),
        hp: numberOr(stats.hp, 20), maxHp: numberOr(stats.maxHp, 20), mp: numberOr(stats.mp, 5), maxMp: numberOr(stats.maxMp, 5),
        gold: numberOr(stats.gold, 0), location: state.locationId || '未知地点',
        buffs: Array.isArray(stats.buffs) ? stats.buffs : [],
        inventory: Array.isArray(state.inventory) ? state.inventory : [],
        equipment: state.equipment && typeof state.equipment === 'object' ? state.equipment : {},
        currencies: state.currencies && typeof state.currencies === 'object' ? state.currencies : {},
        conflicts: state.conflicts && typeof state.conflicts === 'object' ? state.conflicts : {},
        growthCandidates: Array.isArray(state.growthCandidates) ? state.growthCandidates : [],
        growthApplications: Array.isArray(state.growthApplications) ? state.growthApplications : [],
        experiences: Array.isArray(state.experiences) ? state.experiences : [],
        quests: Array.isArray(state.quests) ? state.quests : [],
        goals: Array.isArray(state.goals) ? state.goals : [],
        leads: Array.isArray(state.leads) ? state.leads : [],
      }, writable: true, configurable: true,
    });
  }
  return state.__runtimeRpg;
}

function parseRpgDerivedFormula(expression) {
  if (typeof expression !== 'string' || !expression.trim() || expression.length > 240) return null;
  const source = expression.trim();
  const tokens = [];
  const tokenRe = /\s*(?:(\d+(?:\.\d*)?|\.\d+)|([A-Za-z_][A-Za-z0-9_.-]*)|([()+\-*/]))/y;
  let offset = 0;
  while (offset < source.length) {
    tokenRe.lastIndex = offset;
    const match = tokenRe.exec(source);
    if (!match) return null;
    offset = tokenRe.lastIndex;
    tokens.push(match[1] ? { type: 'number', value: Number(match[1]) } : match[2] ? { type: 'ref', value: match[2] } : { type: match[3] });
  }
  let cursor = 0;
  let nodes = 0;
  const peek = () => tokens[cursor];
  const take = type => (peek()?.type === type ? tokens[cursor++] : null);
  const makeNode = (type, left, right = null) => (++nodes > 64 ? null : { type, left, right });
  function primary() {
    const token = peek();
    if (token?.type === 'number') { cursor++; return makeNode('number', token.value); }
    if (token?.type === 'ref') { cursor++; return makeNode('ref', token.value); }
    if (take('(')) { const node = add(); return take(')') && node; }
    return null;
  }
  function unary() {
    if (take('+')) return unary();
    if (take('-')) return makeNode('neg', unary());
    return primary();
  }
  function mul() {
    let node = unary();
    while (node && (peek()?.type === '*' || peek()?.type === '/')) node = makeNode(tokens[cursor++].type, node, unary());
    return node;
  }
  function add() {
    let node = mul();
    while (node && (peek()?.type === '+' || peek()?.type === '-')) node = makeNode(tokens[cursor++].type, node, mul());
    return node;
  }
  const ast = add();
  return ast && cursor === tokens.length ? ast : null;
}

function evaluateWorldDerivedValues(schema, playerState) {
  const definitions = Array.isArray(schema?.derived) ? schema.derived : [];
  const attrs = playerState?.attributes && typeof playerState.attributes === 'object' ? playerState.attributes : {};
  const skills = playerState?.skills && typeof playerState.skills === 'object' ? playerState.skills : {};
  const resources = playerState?.resources && typeof playerState.resources === 'object' ? playerState.resources : {};
  const byId = new Map(definitions.map(definition => [definition.id, definition]));
  const memo = new Map();
  const evaluating = new Set();
  const evaluate = id => {
    if (memo.has(id)) return memo.get(id);
    const definition = byId.get(id);
    if (!definition || evaluating.has(id)) return null;
    evaluating.add(id);
    const read = ref => {
      const [bucket, key] = String(ref || '').split('.');
      if (bucket === 'attributes') return Number.isFinite(Number(attrs[key])) ? Number(attrs[key]) : null;
      if (bucket === 'skills') return Number.isFinite(Number(skills[key])) ? Number(skills[key]) : null;
      if (bucket === 'resources') return Number.isFinite(Number(resources[key])) ? Number(resources[key]) : null;
      return bucket === 'derived' ? evaluate(key) : null;
    };
    const calculate = node => {
      if (!node) return null;
      if (node.type === 'number') return Number.isFinite(node.left) ? node.left : null;
      if (node.type === 'ref') return read(node.left);
      if (node.type === 'neg') { const value = calculate(node.left); return value === null ? null : -value; }
      const left = calculate(node.left);
      const right = calculate(node.right);
      if (left === null || right === null || (node.type === '/' && right === 0)) return null;
      const value = node.type === '+' ? left + right : node.type === '-' ? left - right : node.type === '*' ? left * right : left / right;
      return Number.isFinite(value) ? value : null;
    };
    const value = calculate(parseRpgDerivedFormula(definition.formula));
    evaluating.delete(id);
    memo.set(id, value);
    return value;
  };
  return definitions.filter(definition => definition && definition.visible !== false).map(definition => ({ ...definition, value: evaluate(definition.id) }));
}

function commitRpgState(rs) {
  if (!rs) return;
  if (worldModeActive()) {
    const state = currentWorldSave.state || (currentWorldSave.state = {});
    state.stats = { ...(state.stats || {}), level: rs.level, exp: rs.exp, expNext: rs.expNext, hp: rs.hp, maxHp: rs.maxHp, mp: rs.mp, maxMp: rs.maxMp, gold: rs.gold, buffs: cloneValue(rs.buffs || []) };
    state.locationId = rs.location || null;
    state.inventory = cloneValue(rs.inventory || []);
    if (currentWorldCard()?.playerCreation?.economy) {
      state.equipment = cloneValue(rs.equipment || {});
      state.currencies = cloneValue(rs.currencies || {});
    }
    if (currentWorldCard()?.conflicts || state.conflicts !== undefined) state.conflicts = cloneValue(rs.conflicts || {});
    if (currentWorldCard()?.playerCreation?.growth || state.growthCandidates !== undefined) state.growthCandidates = cloneValue(rs.growthCandidates || []);
    if (currentWorldCard()?.playerCreation?.growth || state.growthApplications !== undefined) state.growthApplications = cloneValue(rs.growthApplications || []);
    if (currentWorldCard()?.playerCreation?.growth || state.experiences !== undefined) state.experiences = cloneValue(rs.experiences || []);
    state.quests = cloneValue(rs.quests || []);
    state.goals = cloneValue(rs.goals || []);
    state.leads = cloneValue(rs.leads || []);
    if (state.player?.resources && typeof state.player.resources === 'object') {
      for (const key of ['hp', 'mp', 'gold']) if (Number.isFinite(state.player.resources[key])) state.player.resources[key] = rs[key];
    }
    if (worldTurnPendingActive()) {
      worldTurnPending.state = serializeWorldState(currentWorldSave);
      return;
    }
    queueWorldSave(currentWorldSave);
  } else {
    saveSessions();
  }
}

/* 当前 RPG 状态（旧 RPG 会话兼容；世界模式由 WorldSave.state 持有） */
function curRpgState() {
  if (worldModeActive()) return worldRpgState();
  const s = curSession();
  if (!s || s.kind !== 'rpg') return null;
  if (!s.rpgState) s.rpgState = defaultRpgState();
  return s.rpgState;
}

function growthEffectLabel(candidate) {
  if (!candidate) return '';
  const bucketLabels = { attributes: '属性', skills: '技能', resources: '资源', traits: '特质', relations: '关系', factions: '阵营声望', identity: '身份' };
  const target = candidate.targetId || '';
  if (candidate.bucket === 'identity') return `${bucketLabels.identity} · ${target}：${candidate.value || ''}`;
  if (candidate.bucket === 'factions') return `${bucketLabels.factions} · ${target}（${candidate.metric || 'relation'}）${candidate.delta > 0 ? '+' : ''}${candidate.delta}`;
  if (candidate.bucket === 'traits') return `${bucketLabels.traits} · ${target}`;
  return `${bucketLabels[candidate.bucket] || candidate.bucket} · ${target} ${candidate.delta > 0 ? '+' : ''}${candidate.delta}`;
}

function renderRpgSheetMetric(definition, value) {
  const numeric = value === null || value === undefined || (typeof value === 'string' && !value.trim()) ? NaN : Number(value);
  const hasRange = Number.isFinite(numeric) && Number.isFinite(Number(definition?.min)) && Number.isFinite(Number(definition?.max)) && Number(definition.max) > Number(definition.min);
  const meter = hasRange ? Math.max(0, Math.min(100, (numeric - Number(definition.min)) / (Number(definition.max) - Number(definition.min)) * 100)) : null;
  const display = Number.isFinite(numeric) ? String(value) : '—';
  return `<div class="rpg-sheet-stat"><div class="rpg-sheet-stat-head"><span title="${esc(definition?.description || definition?.label || definition?.id || '')}">${esc(definition?.label || definition?.id || '未命名')}</span><b>${esc(display)}</b></div>${meter === null ? '' : `<div class="rpg-sheet-meter" aria-hidden="true"><i style="--meter:${meter.toFixed(2)}%"></i></div>`}</div>`;
}

function renderRpgSheetSection(title, body, className = '') {
  if (!body) return '';
  return `<section class="rpg-sheet-section ${className}"><div class="rpg-sheet-section-title">${esc(title)}</div>${body}</section>`;
}

function renderRpgPlayerSheet() {
  const panel = $('rpg-player-sheet');
  if (!panel) return;
  if (!worldModeActive()) {
    panel.innerHTML = '';
    return;
  }
  const world = currentWorldCard();
  const schema = world?.playerCreation || {};
  const player = currentWorldSave?.state?.player || {};
  const metricGroup = (title, bucket) => {
    const definitions = Array.isArray(schema[bucket]) ? schema[bucket] : [];
    if (!definitions.length) return '';
    const values = player[bucket] && typeof player[bucket] === 'object' ? player[bucket] : {};
    return renderRpgSheetSection(title, `<div class="rpg-sheet-grid">${definitions.map(definition => renderRpgSheetMetric(definition, values[definition.id] ?? definition.default ?? definition.initial ?? definition.min)).join('')}</div>`);
  };
  const derived = evaluateWorldDerivedValues(schema, player);
  const traits = Array.isArray(player.traits) ? player.traits : [];
  const traitDefinitions = new Map((Array.isArray(schema.traits) ? schema.traits : []).map(definition => [definition.id, definition]));
  const traitBody = traits.length
    ? `<div class="rpg-sheet-text">${traits.map(id => {
      const definition = traitDefinitions.get(id);
      return `<span title="${esc(definition?.description || '')}">${esc(definition?.label || id)}</span>`;
    }).join(' · ')}</div>`
    : '<p class="rpg-sheet-empty">暂无已激活特质</p>';
  const relations = Array.isArray(schema.relations) ? schema.relations : [];
  const npcNames = new Map((Array.isArray(world?.npcs) ? world.npcs : []).map(npc => [npc.id, npc.name || npc.id]));
  const relationValues = player.relations && typeof player.relations === 'object' ? player.relations : {};
  const relationBody = relations.length
    ? `<div class="rpg-sheet-grid">${relations.map(rule => renderRpgSheetMetric({ ...rule, id: rule.npcId, label: npcNames.get(rule.npcId) || rule.npcId, min: rule.min ?? -100, max: rule.max ?? 100 }, relationValues[rule.npcId] ?? rule.default ?? 0)).join('')}</div>`
    : '';
  const identity = player.identity && typeof player.identity === 'object' && !Array.isArray(player.identity) ? player.identity : {};
  const identityBody = Object.entries(identity).filter(([, values]) => Array.isArray(values) && values.length).map(([key, values]) => `<div class="rpg-sheet-text"><b>${esc(key)}</b>：${esc(values.join('、').slice(0, 1000))}</div>`).join('');
  const effects = Array.isArray(player.effects) ? player.effects : [];
  const effectBody = effects.length ? `<div class="rpg-sheet-text">${effects.map(effect => {
    const label = typeof effect === 'string' ? effect : effect?.label || effect?.name || effect?.id || JSON.stringify(effect);
    return esc(String(label || '').slice(0, 240));
  }).join(' · ')}</div>` : '';
  panel.innerHTML = [
    '<div class="rpg-panel-head">角色状态</div>',
    metricGroup('属性', 'attributes'),
    metricGroup('技能', 'skills'),
    metricGroup('资源', 'resources'),
    renderRpgSheetSection('派生值', derived.map(definition => renderRpgSheetMetric(definition, definition.value)).join('')),
    renderRpgSheetSection('特质', traitBody),
    renderRpgSheetSection('关系', relationBody),
    renderRpgSheetSection('身份', identityBody),
    renderRpgSheetSection('状态效果', effectBody),
  ].filter(Boolean).join('') || '<p class="rpg-sheet-empty">当前世界卡未声明角色状态。</p>';
}

async function decideGrowthCandidate(candidateId, decision) {
  if (!worldModeActive() || !candidateId || worldTurnPendingActive()) return;
  const buttons = [...document.querySelectorAll('[data-growth-action]')].filter(item => item.dataset.growthId === candidateId);
  buttons.forEach(item => { item.disabled = true; });
  try {
    const res = await fetch('/api/world-saves/' + encodeURIComponent(currentWorldSaveId) + '/growth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ commandId: uid(), expectedRevision: currentWorldSave.revision, candidateId, decision }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(worldApiError(data, '成长处理失败（HTTP ' + res.status + '）'));
    hydrateWorldSave(data);
    currentWorldSave = data;
    renderRPG();
    renderMessages();
    renderWorldDetail();
  } catch (err) {
    console.error('[Tavern] 成长处理失败:', err.message);
    buttons.forEach(item => { item.disabled = false; });
    const status = $('world-open-status');
    if (status) status.textContent = `成长处理失败：${err.message}`;
  }
}

async function endCurrentWorld() {
  if (!worldModeActive() || !currentWorldSave || worldTurnPendingActive()) return;
  const select = $('rpg-ending-select');
  const endingId = select?.value || 'player-choice';
  const ending = (Array.isArray(currentWorldCard()?.ending?.endings) ? currentWorldCard().ending.endings : []).find(item => item.id === endingId);
  const label = ending?.label || endingId;
  if (!confirm(`确定结束当前世界线“${label}”吗？结束后将不能继续普通回合。`)) return;
  const button = $('rpg-end-world');
  if (button) button.disabled = true;
  try {
    const res = await fetch('/api/world-saves/' + encodeURIComponent(currentWorldSaveId) + '/end', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ commandId: uid(), expectedRevision: currentWorldSave.revision, endingId, confirm: true }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(worldApiError(data, '结束世界线失败（HTTP ' + res.status + '）'));
    hydrateWorldSave(data); currentWorldSave = data;
    renderRPG(); renderMessages(); renderWorldDetail();
  } catch (err) {
    showWorldError(err.message);
    if (button) button.disabled = false;
  }
}

/* 渲染 RPG 面板：顶栏（等级/金币/位置）、状态条（HP/MP/EXP）、背包、任务、角色摘要 */
function renderRPG() {
  const rs = curRpgState();
  if (!rs) return;
  const setT = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  const setW = (id, pct) => { const el = $(id); if (el) el.style.width = pct; };
  setT('rpg-level', rs.level);
  setT('rpg-gold', rs.gold);
  setT('rpg-gold2', rs.gold);
  setT('rpg-loc', rs.location || '—');
  setT('rpg-hp-text', `${rs.hp}/${rs.maxHp}`);
  setT('rpg-mp-text', `${rs.mp}/${rs.maxMp}`);
  setT('rpg-exp-text', `${rs.exp}/${rs.expNext}`);
  setW('rpg-hp-bar', rs.maxHp ? Math.max(0, Math.min(100, rs.hp / rs.maxHp * 100)) + '%' : '0%');
  setW('rpg-mp-bar', rs.maxMp ? Math.max(0, Math.min(100, rs.mp / rs.maxMp * 100)) + '%' : '0%');
  setW('rpg-exp-bar', rs.expNext ? Math.max(0, Math.min(100, rs.exp / rs.expNext * 100)) + '%' : '0%');
  setT('rpg-buffs', rs.buffs && rs.buffs.length ? rs.buffs.join('、') : '—');
  const dynamicStats = $('rpg-dynamic-stats');
  if (dynamicStats) {
    const schema = worldModeActive() ? currentWorldCard()?.playerCreation : null;
    const playerState = worldModeActive() ? currentWorldSave.state?.player : null;
    const definitions = [...(Array.isArray(schema?.attributes) ? schema.attributes : []), ...(Array.isArray(schema?.skills) ? schema.skills : []), ...(Array.isArray(schema?.resources) ? schema.resources : [])]
      .filter(definition => definition && !['hp', 'mp', 'gold'].includes(definition.id));
    dynamicStats.innerHTML = definitions.map(definition => {
      const bucket = schema?.attributes?.some(item => item.id === definition.id) ? playerState?.attributes
        : schema?.skills?.some(item => item.id === definition.id) ? playerState?.skills : playerState?.resources;
      const value = bucket?.[definition.id] ?? definition.default ?? definition.initial ?? '—';
      return `<span class="rpg-dynamic-stat">${esc(definition.label || definition.id)}<b>${esc(value)}</b></span>`;
    }).join('');
  }
  if (dynamicStats && worldModeActive()) {
    const schema = currentWorldCard()?.playerCreation;
    const playerState = currentWorldSave.state?.player;
    const derived = evaluateWorldDerivedValues(schema, playerState);
    if (derived.length) dynamicStats.innerHTML += derived.map(definition => {
      const value = definition.value === null ? '鈥?' : Number.isInteger(definition.value) ? String(definition.value) : String(Number(definition.value.toFixed(3)));
      return `<span class="rpg-dynamic-stat rpg-derived-stat" title="只读：${esc(definition.formula)}">${esc(definition.label || definition.id)}<b>${esc(value)}</b></span>`;
    }).join('');
  }
  renderRpgPlayerSheet();
  const inv = $('rpg-inventory');
  const economy = worldModeActive() ? currentWorldCard()?.playerCreation?.economy : null;
  const economyItems = new Map((Array.isArray(economy?.inventory?.items) ? economy.inventory.items : []).map(item => [item.id, item]));
  const inventoryMeta = $('rpg-inventory-meta');
  if (inventoryMeta) {
    const rules = economy?.inventory || {};
    const weight = rs.inventory.reduce((total, item) => total + Number(item?.weight ?? economyItems.get(item?.itemId)?.weight ?? 0) * Number(item?.count || 0), 0);
    const slots = rules.maxSlots ? `${rs.inventory.length}/${rules.maxSlots} 格` : `${rs.inventory.length} 格`;
    const burden = rules.maxWeight === undefined || rules.maxWeight === null ? '' : ` · 重量 ${Number(weight.toFixed(2))}/${rules.maxWeight}`;
    inventoryMeta.textContent = economy?.inventory?.enabled === false ? '世界卡已关闭背包' : slots + burden;
  }
  if (inv) {
    inv.innerHTML = rs.inventory.length
      ? rs.inventory.map((i, idx) => `<div class="rpg-item"><span class="rpg-item-name">${esc(i.name)}</span> ×${i.count}<span class="rpg-del" data-kind="inv" data-idx="${idx}" title="删除">✕</span><div class="rpg-item-sub">${esc(i.desc || '')}</div></div>`).join('')
      : '<p class="hint">（空）</p>';
  }
  const equipmentEl = $('rpg-equipment');
  if (equipmentEl) {
    const rules = economy?.equipment || {};
    const slots = Array.isArray(rules.slots) ? rules.slots : [];
    equipmentEl.innerHTML = !economy || rules.enabled === false
      ? '<p class="hint">世界卡未启用装备位</p>'
      : (slots.length ? slots.map(slot => {
        const equipped = rs.equipment?.[slot.id];
        const itemId = typeof equipped === 'string' ? equipped : equipped?.itemId;
        const item = itemId ? economyItems.get(itemId) : null;
        const label = item?.label || equipped?.name || equipped || '空';
        return `<div class="rpg-item"><span class="rpg-item-name">${esc(slot.label || slot.id)}</span><div class="rpg-item-sub">${esc(label)}</div></div>`;
      }).join('') : '<p class="hint">未声明装备位</p>');
  }
  const currenciesEl = $('rpg-currencies');
  if (currenciesEl) {
    const currencies = Array.isArray(economy?.currencies) ? economy.currencies : [];
    currenciesEl.innerHTML = currencies.length
      ? currencies.map(currency => `<div class="rpg-item"><span class="rpg-item-name">${esc(currency.label || currency.id)}</span><b>${esc(rs.currencies?.[currency.id] ?? currency.initial ?? currency.min ?? 0)}</b></div>`).join('')
      : '<p class="hint">未声明额外货币</p>';
  }
  const conflictsEl = $('rpg-conflicts');
  if (conflictsEl) {
    const definitions = new Map((Array.isArray(currentWorldCard()?.conflicts) ? currentWorldCard().conflicts : []).map(conflict => [conflict.id, conflict]));
    const conflicts = Object.values(rs.conflicts && typeof rs.conflicts === 'object' ? rs.conflicts : {});
    const statusLabels = { active: '进行中', resolved: '已解决', fled: '已撤退', failed: '已失败' };
    conflictsEl.innerHTML = conflicts.length
      ? conflicts.map(conflict => {
        const definition = definitions.get(conflict.templateId);
        const phase = (definition?.phases || []).find(item => item.id === conflict.phase)?.label || conflict.phase || '未分阶段';
        const participants = Array.isArray(conflict.participants) ? conflict.participants.map(item => {
          if (typeof item === 'string') return item;
          const hp = Number.isFinite(Number(item?.hp)) && Number.isFinite(Number(item?.maxHp)) ? ` ${item.hp}/${item.maxHp} HP` : '';
          const defense = Number.isFinite(Number(item?.defense)) ? ` 防御${item.defense}` : '';
          return `${item?.id || ''}${hp}${defense}`.trim();
        }).filter(Boolean).join('、') : '';
        const objectives = Array.isArray(conflict.objectives) ? conflict.objectives.map(item => item?.title || item?.id).filter(Boolean).join('、') : '';
        return `<article class="rpg-item${conflict.status !== 'active' ? ' done' : ''}"><div class="rpg-item-name">${esc(definition?.label || conflict.id)} <small>${esc(statusLabels[conflict.status] || conflict.status || '进行中')}</small></div><div class="rpg-item-sub">第 ${esc(conflict.round || 1)} 轮 · ${esc(phase)}${participants ? ` · ${esc(participants)}` : ''}${objectives ? ` · 目标：${esc(objectives)}` : ''}</div></article>`;
      }).join('')
      : '<p class="hint">暂无冲突</p>';
  }
  const failureEl = $('rpg-failure');
  if (failureEl) {
    const failure = worldModeActive() ? currentWorldSave?.state?.failure : null;
    if (!failure) {
      failureEl.innerHTML = '<p class="hint">当前未触发失败模式。</p>';
    } else {
      const modes = new Map((Array.isArray(currentWorldCard()?.failure?.modes) ? currentWorldCard().failure.modes : []).map(item => [item.id, item]));
      const mode = modes.get(failure.mode);
      const statusLabels = { active: '进行中', resolved: '已结算', terminal: '终止' };
      failureEl.innerHTML = `<article class="rpg-item rpg-failure-item ${failure.status === 'terminal' ? 'terminal' : 'active'}"><div class="rpg-item-name">${esc(mode?.label || failure.label || failure.mode)} <small>${esc(statusLabels[failure.status] || failure.status || '未知')}</small></div><div class="rpg-item-sub">${esc(mode?.description || failure.description || '')}</div><div class="rpg-item-sub">原因：${esc(failure.cause || '未记录')} · revision ${esc(failure.revision ?? '')}</div></article>`;
    }
  }
  const endingSelect = $('rpg-ending-select');
  const endingStatus = $('rpg-ending-status');
  const endingButton = $('rpg-end-world');
  if (endingSelect && endingStatus && endingButton) {
    const rules = currentWorldCard()?.ending;
    const endings = Array.isArray(rules?.endings) ? rules.endings : [{ id: 'player-choice', label: '玩家主动结束', description: '结束当前世界线。' }];
    endingSelect.innerHTML = endings.map(ending => `<option value="${esc(ending.id)}">${esc(ending.label || ending.id)}</option>`).join('');
    const ending = worldModeActive() ? currentWorldSave?.state?.ending : null;
    const endingAllowed = worldModeActive() && rules?.enabled !== false && rules?.allowPlayerEnd !== false;
    endingStatus.innerHTML = ending
      ? `<article class="rpg-item rpg-failure-item terminal"><div class="rpg-item-name">${esc(ending.label || ending.endingId)} <small>已结束</small></div><div class="rpg-item-sub">${esc(ending.description || '')}</div><div class="rpg-item-sub">结束于 revision ${esc(ending.sourceRevision ?? '')}</div></article>`
      : endingAllowed ? '<p class="hint">当前世界线仍在进行。</p>' : '<p class="hint">当前世界卡不允许玩家主动结束。</p>';
    endingSelect.disabled = !!ending || !endingAllowed;
    endingButton.disabled = !!ending || !endingAllowed || worldTurnPendingActive();
  }
  const q = $('rpg-quests');
  if (q) {
    q.innerHTML = rs.quests.length
      ? rs.quests.map((x, idx) => `<div class="rpg-item${x.status === 'done' ? ' done' : ''}" data-kind="quest" data-idx="${idx}" title="点击切换进行/完成"><span class="rpg-item-name">${esc(x.title)}</span> ${x.status === 'done' ? '✅' : '●'}<span class="rpg-del" data-kind="quest-del" data-idx="${idx}" title="删除">✕</span><div class="rpg-item-sub">${esc(x.desc || '')}</div></div>`).join('')
      : '<p class="hint">（无）</p>';
  }
  const renderObjectives = (id, list, empty) => {
    const el = $(id);
    if (!el) return;
    const values = Array.isArray(list) ? list : [];
    el.innerHTML = values.length
      ? values.map(item => `<article class="rpg-item${item.status && item.status !== 'active' ? ' done' : ''}"><div class="rpg-item-name">${esc(item.title || item.id)}${item.status && item.status !== 'active' ? ` <small>${esc(item.status)}</small>` : ''}</div><div class="rpg-item-sub">${esc(item.desc || '（暂无描述）')}</div></article>`).join('')
      : `<p class="hint">${empty}</p>`;
  };
  renderObjectives('rpg-goals', worldModeActive() ? currentWorldSave.state?.goals : rs.goals, '暂无目标。');
  renderObjectives('rpg-leads', worldModeActive() ? currentWorldSave.state?.leads : rs.leads, '暂无线索。');
  const addDeadlineLabels = (id, list) => {
    const el = $(id);
    const values = Array.isArray(list) ? list : [];
    el?.querySelectorAll('.rpg-item').forEach((item, index) => {
      const deadline = values[index]?.deadline;
      if (!deadline || typeof deadline.value !== 'number' || !deadline.unit) return;
      const label = document.createElement('small');
      label.className = 'rpg-deadline';
      label.textContent = `截止 ${deadline.value} ${deadline.unit}`;
      item.querySelector('.rpg-item-name')?.append(' · ', label);
    });
  };
  addDeadlineLabels('rpg-goals', worldModeActive() ? currentWorldSave.state?.goals : rs.goals);
  addDeadlineLabels('rpg-leads', worldModeActive() ? currentWorldSave.state?.leads : rs.leads);
  const eventList = $('rpg-world-events');
  let factionList = $('rpg-factions');
  if (!factionList && eventList?.parentElement) {
    const heading = document.createElement('div');
    heading.className = 'rpg-panel-head';
    heading.style.marginTop = '10px';
    heading.textContent = '🏛 派系';
    factionList = document.createElement('div');
    factionList.id = 'rpg-factions';
    factionList.className = 'rpg-list';
    factionList.setAttribute('role', 'list');
    factionList.setAttribute('aria-label', '当前派系');
    eventList.parentElement.insertBefore(heading, eventList);
    eventList.parentElement.insertBefore(factionList, eventList);
  }
  if (factionList) {
    const world = worldModeActive() ? currentWorldCard() : null;
    const definitions = Array.isArray(world?.factions) ? world.factions : [];
    const states = currentWorldSave?.state?.factionStates && typeof currentWorldSave.state.factionStates === 'object' ? currentWorldSave.state.factionStates : {};
    factionList.innerHTML = definitions.length
      ? definitions.map(faction => {
        const state = states[faction.id] || {};
        const resources = Array.isArray(faction.resources) ? faction.resources.map(resource => `${resource.label || resource.id}: ${state.resources?.[resource.id] ?? resource.initial ?? resource.min ?? 0}`).join(' · ') : '';
        const goals = Array.isArray(state.goals) && state.goals.length ? state.goals.join('、') : (Array.isArray(faction.goals) ? faction.goals.join('、') : '暂无公开目标');
        return `<article class="rpg-item"><div class="rpg-item-name">${esc(faction.name || faction.id)} <small>关系 ${esc(state.relation ?? 0)} · 影响 ${esc(state.influence ?? 0)}</small></div><div class="rpg-item-sub">目标：${esc(goals)}</div>${resources ? `<div class="rpg-item-sub">资源：${esc(resources)}</div>` : ''}</article>`;
      }).join('')
      : '<p class="hint">当前世界暂无派系。</p>';
  }
  if (eventList) {
    const currentLocationId = currentWorldSave?.state?.locationId || null;
    const events = (worldModeActive() && Array.isArray(currentWorldSave.state?.worldEvents) ? currentWorldSave.state.worldEvents : [])
      .filter(event => event && event.visibility !== 'hidden'
        && (event.visibility !== 'local' || !event.locationId || event.locationId === currentLocationId));
    eventList.innerHTML = events.length
      ? events.slice(-32).reverse().map(event => {
        const time = event.time ? `${event.time.value} ${event.time.unit}` : '';
        const consequences = Array.isArray(event.consequences) && event.consequences.length
          ? `<div class="rpg-item-sub">后果：${esc(event.consequences.join('；'))}</div>` : '';
        return `<article class="rpg-item rpg-event-item"><div class="rpg-item-name">${esc(event.title || event.eventId)}${time ? ` <small>${esc(time)}</small>` : ''}</div><div class="rpg-item-sub">${esc(event.description || '（无公开描述）')}</div>${consequences}</article>`;
      }).join('')
      : '<p class="hint">尚无公开事件。</p>';
  }
  const cs = $('rpg-char-summary');
  const c = worldModeActive() ? (currentWorldSave.player?.snapshot || null) : currentChar();
  if (cs) {
    cs.innerHTML = c
      ? `<div class="rpg-item"><span class="rpg-item-name">${esc(c.name || '未命名冒险者')}</span><div class="rpg-item-sub">${esc([c.race, c.role].filter(Boolean).join(' · ') || '种族/身份待定')}</div></div>`
      : '<p class="hint">未选择角色</p>';
  }
  const growthEl = $('rpg-growth-candidates');
  if (growthEl) {
    const world = worldModeActive() ? currentWorldCard() : null;
    const definitions = new Map((Array.isArray(world?.playerCreation?.growth?.candidates) ? world.playerCreation.growth.candidates : []).map(candidate => [candidate.id, candidate]));
    const candidates = worldModeActive() && Array.isArray(currentWorldSave.state?.growthCandidates) ? currentWorldSave.state.growthCandidates : [];
    growthEl.innerHTML = candidates.length
      ? candidates.slice(-32).reverse().map(candidate => {
        const definition = definitions.get(candidate.candidateId) || {};
        return `<article class="rpg-item rpg-growth-item" data-growth-id="${esc(candidate.id)}"><div class="rpg-item-name">${esc(definition.label || candidate.candidateId)}</div><div class="rpg-growth-effect">${esc(growthEffectLabel(definition))}</div><div class="rpg-item-sub">${esc(candidate.reason || definition.description || '剧情成果待确认')}</div><div class="rpg-growth-actions"><button class="ghost-btn growth-accept" type="button" data-growth-action="accepted" data-growth-id="${esc(candidate.id)}" aria-label="接受成长：${esc(definition.label || candidate.candidateId)}">接受</button><button class="ghost-btn growth-reject" type="button" data-growth-action="rejected" data-growth-id="${esc(candidate.id)}" aria-label="拒绝成长：${esc(definition.label || candidate.candidateId)}">拒绝</button></div></article>`;
      }).join('')
      : '<p class="hint">暂无待确认成长</p>';
  }
  const experienceEl = $('rpg-experiences');
  if (experienceEl) {
    const experiences = worldModeActive() && Array.isArray(currentWorldSave.state?.experiences) ? currentWorldSave.state.experiences : [];
    experienceEl.innerHTML = experiences.length
      ? experiences.slice(-16).reverse().map(item => `<article class="rpg-item rpg-experience-item"><div class="rpg-item-name">${esc(item.title)} <small>${esc(item.sourceId || 'growth')}</small></div><div class="rpg-item-sub">${esc(item.summary)}</div></article>`).join('')
      : '<p class="hint">暂无人物经历</p>';
  }
  renderMap(); // 世界地图（数据层 + 美化图显示）
}

/* 应用 AI 输出的 ```rpg``` JSON 状态变更；返回本轮行动选项 */
/* RPG 任务定义兜底（仅当「RPG 叙事引擎」预设被删除时使用；正常内容在预设 JSON 里可编辑） */
const RPG_TASK_FALLBACK = '你是这个幻想世界的地下城主（DM）与世界化身，始终以“你”称呼玩家。直接呈现场景、事件与 NPC，不以作者或助手自称。根据当前状态公平裁定行动；状态变化必须先在叙事中发生，再写入回复末尾唯一一个 ```rpg``` JSON 代码块。options 必须遵守当前世界卡回合契约（0-4 条），具体、可执行且不重复；自由输入始终可用。';

function worldOptionRules() {
  const options = currentWorldCard()?.turnContract?.options;
  return { min: Number.isInteger(options?.min) ? options.min : 4, max: Number.isInteger(options?.max) ? options.max : 4 };
}

/* RPG 输出分为叙事正文与末尾控制块；流式输出未闭合时也不把控制 JSON 混进叙事栏。 */
function splitRpgOutput(reply) {
  const text = String(reply || '');
  const start = text.match(/(?:^|\r?\n)[ \t]*```rpg(?:[ \t]*\r?\n|[ \t]*$)/i);
  if (!start) return { content: text.trim(), payload: null };
  const rest = text.slice(start.index + start[0].length);
  const end = rest.match(/\r?\n?[ \t]*```[ \t]*$/);
  return {
    content: text.slice(0, start.index).trim(),
    payload: end ? rest.slice(0, end.index).trim() : null,
  };
}

/* AI 输出处理：酒馆保留原文；RPG 先剥离控制块，再只对叙事正文执行掷骰。 */
function processAIOutput(reply) {
  if (mode !== 'rpg') return { content: String(reply || '').trim(), options: null };
  const parsed = splitRpgOutput(reply);
  const rolls = rollDiceIn(parsed.content); // options 中尚未选择的骰子表达式不能提前掷骰
  for (const r of rolls) {
    const detail = r.rolls.length > 1 ? `（${r.rolls.join(' + ')}${r.bonus ? (r.bonus >= 0 ? ' + ' + r.bonus : ' - ' + Math.abs(r.bonus)) : ''}）` : (r.bonus ? `（+${r.bonus}）` : '');
    pushMessage('user', `🎲 掷骰 ${r.expr} = ${r.total} ${detail}`, { meta: true });
  }
  const update = applyRpgUpdate(parsed.payload); // ```rpg``` 状态/物品/任务/位置/options 应用
  return { content: parsed.content, options: update?.options || null, createEntities: update?.createEntities || null, eventMemory: update?.eventMemory || null };
}

function applyRpgUpdate(payload) {
  if (mode !== 'rpg' || !payload) return null;
  let upd;
  try { upd = JSON.parse(payload); } catch (e) { console.warn('[Tavern] rpg JSON 解析失败', e.message); return null; }
  const rs = curRpgState();
  if (!rs || typeof upd !== 'object') return null;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const economy = worldModeActive() ? currentWorldCard()?.playerCreation?.economy : null;
  const currencyUpdates = upd.currencies && typeof upd.currencies === 'object' && !Array.isArray(upd.currencies) ? upd.currencies : null;
  const hasDeclaredGold = Array.isArray(economy?.currencies) && economy.currencies.some(currency => currency?.id === 'gold');
  if (typeof upd.hp === 'number') rs.hp = clamp(rs.hp + upd.hp, 0, rs.maxHp);
  if (typeof upd.mp === 'number') rs.mp = clamp(rs.mp + upd.mp, 0, rs.maxMp);
  if (typeof upd.maxHp === 'number') { rs.maxHp = Math.max(1, rs.maxHp + upd.maxHp); rs.hp = Math.min(rs.hp, rs.maxHp); }
  if (typeof upd.maxMp === 'number') { rs.maxMp = Math.max(1, rs.maxMp + upd.maxMp); rs.mp = Math.min(rs.mp, rs.maxMp); }
  if (typeof upd.gold === 'number' && !(hasDeclaredGold && currencyUpdates && Object.prototype.hasOwnProperty.call(currencyUpdates, 'gold'))) {
    rs.gold = Math.max(0, rs.gold + upd.gold);
    if (hasDeclaredGold) {
      if (!rs.currencies || typeof rs.currencies !== 'object') rs.currencies = {};
      rs.currencies.gold = rs.gold;
    }
  }
  if (typeof upd.level === 'number') rs.level = Math.max(1, rs.level + (upd.level || 0));
  if (typeof upd.exp === 'number') rs.exp = Math.max(0, rs.exp + upd.exp);
  if (typeof upd.location === 'string' && upd.location.trim()) rs.location = upd.location.trim();
  if (Array.isArray(upd.buffs)) rs.buffs = upd.buffs;
  if (worldModeActive() && economy && currencyUpdates) {
    const definitions = new Map((Array.isArray(economy.currencies) ? economy.currencies : []).map(currency => [currency.id, currency]));
    if (!rs.currencies || typeof rs.currencies !== 'object') rs.currencies = {};
    for (const [id, delta] of Object.entries(currencyUpdates)) {
      const definition = definitions.get(id);
      if (!definition || typeof delta !== 'number' || !Number.isFinite(delta)) continue;
      const current = Number(rs.currencies[id] ?? definition.initial ?? definition.min ?? 0);
      rs.currencies[id] = clamp(current + delta, definition.min ?? 0, definition.max ?? 1000000000000);
      if (id === 'gold') rs.gold = rs.currencies[id];
    }
  }
  if (Array.isArray(upd.inventory)) {
    for (const it of upd.inventory) {
      if (!it || !it.name) continue;
      const count = (typeof it.count === 'number') ? it.count : 1;
      const exist = rs.inventory.find(x => (it.itemId && x.itemId === it.itemId) || (!it.itemId && x.name === it.name));
      if (it.add === false || count < 0) {
        const remove = Math.abs(count);
        if (exist) {
          exist.count -= remove;
          if (exist.count <= 0) {
            if (exist.itemId && rs.equipment && typeof rs.equipment === 'object') {
              for (const slotId of Object.keys(rs.equipment)) if (rs.equipment[slotId] === exist.itemId) rs.equipment[slotId] = null;
            }
            rs.inventory = rs.inventory.filter(x => x !== exist);
          }
        }
      } else {
        if (exist) exist.count += count;
        else rs.inventory.push({ ...(it.itemId ? { itemId: String(it.itemId) } : {}), name: it.name, count, ...(it.weight !== undefined ? { weight: Number(it.weight) } : {}), desc: it.desc || '' });
      }
    }
  }
  if (worldModeActive() && economy && upd.equipment && typeof upd.equipment === 'object' && !Array.isArray(upd.equipment)) {
    const slotIds = new Set((Array.isArray(economy.equipment?.slots) ? economy.equipment.slots : []).map(slot => slot.id));
    if (!rs.equipment || typeof rs.equipment !== 'object') rs.equipment = {};
    const inventoryIds = new Set(rs.inventory.filter(item => item?.itemId).map(item => String(item.itemId)));
    for (const [slotId, itemId] of Object.entries(upd.equipment)) {
      if (!slotIds.has(slotId) || itemId !== null && (typeof itemId !== 'string' || !inventoryIds.has(itemId))) continue;
      rs.equipment[slotId] = itemId;
    }
  }
  if (worldModeActive() && Array.isArray(upd.conflicts)) {
    const state = currentWorldSave.state || (currentWorldSave.state = {});
    const conflictDefinitions = new Map((Array.isArray(currentWorldCard()?.conflicts) ? currentWorldCard().conflicts : []).map(conflict => [conflict.id, conflict]));
    if (!state.conflicts || typeof state.conflicts !== 'object' || Array.isArray(state.conflicts)) state.conflicts = {};
    for (const change of upd.conflicts) {
      if (!change || typeof change !== 'object' || Array.isArray(change) || typeof change.id !== 'string' || !change.id.trim()) continue;
      const id = change.id.trim();
      const previous = state.conflicts[id];
      const templateId = String(change.templateId || previous?.templateId || '').trim();
      const definition = conflictDefinitions.get(templateId);
      if (!definition) continue;
      const op = ['start', 'advance', 'end'].includes(change.op) ? change.op : 'advance';
      if (op === 'start' && previous && previous.status !== 'active') continue;
      if (op !== 'start' && (!previous || previous.status !== 'active')) continue;
      const next = previous ? cloneValue(previous) : {
        id,
        templateId,
        type: definition.type || 'custom',
        status: 'active',
        phase: definition.phases?.[0]?.id || null,
        round: 1,
        participants: [],
        objectives: [],
        availableActions: (definition.actions || []).map(action => action.id),
      };
      next.id = id;
      next.templateId = templateId;
      if (op === 'start') next.status = 'active';
      if (op === 'advance') next.status = 'active';
      if (op === 'end' && !['resolved', 'fled', 'failed'].includes(change.status)) next.status = 'resolved';
      if (change.status && ['active', 'resolved', 'fled', 'failed'].includes(change.status)) next.status = change.status;
      if (change.phase !== undefined) next.phase = change.phase || null;
      if (Number.isInteger(change.round) && change.round > 0) next.round = change.round;
      if (change.actionId !== undefined) next.actionId = change.actionId || null;
      if (change.targetId !== undefined) next.targetId = change.targetId || null;
      if (Array.isArray(change.participants)) next.participants = cloneValue(change.participants);
      if (Array.isArray(change.objectives)) next.objectives = cloneValue(change.objectives);
      if (Array.isArray(change.availableActions)) next.availableActions = change.availableActions.slice();
      if (change.outcome !== undefined) next.outcome = change.outcome || null;
      if (Array.isArray(change.consequences)) next.consequences = change.consequences.slice();
      state.conflicts[id] = next;
    }
    rs.conflicts = state.conflicts;
  }
  if (worldModeActive() && Array.isArray(upd.growth)) {
    const growth = currentWorldCard()?.playerCreation?.growth;
    const candidateDefinitions = new Map((Array.isArray(growth?.candidates) ? growth.candidates : []).map(candidate => [candidate.id, candidate]));
    const sourceIds = new Set((Array.isArray(growth?.sources) ? growth.sources : []).map(source => source.id));
    const state = currentWorldSave.state || (currentWorldSave.state = {});
    const candidates = Array.isArray(state.growthCandidates) ? state.growthCandidates : [];
    for (const proposal of upd.growth) {
      const candidateId = String(proposal?.candidateId || '').trim();
      const sourceId = String(proposal?.sourceId || '').trim();
      const definition = candidateDefinitions.get(candidateId);
      if (!definition || definition.sourceId !== sourceId || !sourceIds.has(sourceId)) continue;
      if (candidates.some(candidate => candidate.candidateId === candidateId && candidate.sourceId === sourceId && candidate.status === 'proposed')) continue;
      candidates.push({ id: `growth-${uid()}`, candidateId, sourceId, reason: String(proposal.reason || '').trim().slice(0, 2000), status: 'proposed' });
    }
    state.growthCandidates = candidates.slice(-128);
    rs.growthCandidates = state.growthCandidates;
  }
  if (Array.isArray(upd.quests)) {
    for (const qd of upd.quests) {
      if (!qd || !qd.title) continue;
      const exist = rs.quests.find(x => x.title === qd.title);
      if (exist) {
        if (qd.status) exist.status = qd.status;
        if (qd.desc) exist.desc = qd.desc;
      } else {
        rs.quests.push({ id: uid(), title: qd.title, desc: qd.desc || '', status: qd.status || 'active' });
      }
    }
  }
  if (worldModeActive() && upd.player && typeof upd.player === 'object') {
    const playerState = currentWorldSave.state?.player;
    const schema = currentWorldCard()?.playerCreation;
    for (const bucket of ['attributes', 'skills', 'resources']) {
      const definitions = new Map((Array.isArray(schema?.[bucket]) ? schema[bucket] : []).map(definition => [definition.id, definition]));
      const changes = upd.player[bucket];
      if (!playerState || !changes || typeof changes !== 'object' || Array.isArray(changes)) continue;
      if (!playerState[bucket] || typeof playerState[bucket] !== 'object') playerState[bucket] = {};
      for (const [id, delta] of Object.entries(changes)) {
        const definition = definitions.get(id);
        if (!definition || typeof delta !== 'number' || !Number.isFinite(delta)) continue;
        const current = Number(playerState[bucket][id] ?? definition.default ?? definition.initial ?? definition.min ?? 0);
        const min = Number(definition.min ?? 0);
        const max = Number(definition.max ?? (bucket === 'resources' ? 1000000 : 100));
        playerState[bucket][id] = Math.max(min, Math.min(max, current + delta));
        if (bucket === 'resources' && ['hp', 'mp', 'gold'].includes(id)) rs[id] = playerState[bucket][id];
      }
    }
  }
  const upsertObjectives = (key, values) => {
    if (!Array.isArray(values)) return;
    if (!Array.isArray(rs[key])) rs[key] = [];
    for (const item of values) {
      if (!item || typeof item !== 'object' || !String(item.title || '').trim()) continue;
      const title = String(item.title).trim();
      const existing = rs[key].find(value => (item.id && value.id === item.id) || value.title === title);
      const next = existing || { id: /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(String(item.id || '')) ? String(item.id) : uid(), title, desc: '' };
      next.title = title;
      if (item.desc !== undefined) next.desc = String(item.desc).slice(0, 4000);
      if (['active', 'done', 'failed', 'paused'].includes(item.status)) next.status = item.status;
      for (const field of ['actorId', 'locationId']) if (item[field] !== undefined) next[field] = item[field] || null;
      if (item.deadline && typeof item.deadline === 'object') next.deadline = cloneValue(item.deadline);
      if (Array.isArray(item.tags)) next.tags = item.tags.filter(tag => typeof tag === 'string').slice(0, 32);
      if (!existing) rs[key].push(next);
    }
  };
  upsertObjectives('goals', upd.goals);
  upsertObjectives('leads', upd.leads);
  const options = Array.isArray(upd.options)
    ? upd.options.filter(o => typeof o === 'string' && o.trim()).slice(0, worldOptionRules().max)
    : null;
  const createEntities = Array.isArray(upd.createEntities) ? cloneValue(upd.createEntities) : null;
  const eventMemory = worldModeActive() && Array.isArray(upd.eventMemory) ? cloneValue(upd.eventMemory) : null;
  commitRpgState(rs);
  renderRPG();
  return { options, createEntities, eventMemory };
}

/* ─────────── 掷骰（D&D 风格：d20+5 / 2d6-1 自动掷骰） ─────────── */
const DICE_RE = /(\d*)d(\d+)([+-]\d+)?/gi;
function rollDiceIn(text) {
  const results = [];
  String(text || '').replace(DICE_RE, (m, cnt, die, mod) => {
    const n = Math.min(parseInt(cnt, 10) || 1, 100);
    const d = parseInt(die, 10) || 1;
    const bonus = mod ? parseInt(mod, 10) : 0;
    const rolls = [];
    for (let i = 0; i < n; i++) rolls.push(1 + Math.floor(Math.random() * d));
    const sum = rolls.reduce((a, b) => a + b, 0);
    results.push({ expr: m, rolls, bonus, total: sum + bonus });
    return m;
  });
  return results;
}
async function rollWorldDice(text) {
  const expressions = [];
  String(text || '').replace(DICE_RE, match => { if (!expressions.includes(match)) expressions.push(match); return match; });
  if (!expressions.length) return [];
  const response = await fetch('/api/dice', {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ expressions }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(data?.rolls)) throw new Error(data?.error || `骰子服务失败（HTTP ${response.status}）`);
  return data.rolls;
}

/* ─────────── Markdown 渲染（marked + DOMPurify 消毒） ───────────
 * 参考 Open WebUI：解析后必须消毒（AI / 用户内容不可信）
 * 返回 { html, md }：md=true 表示已渲染，气泡加 .md 类取消 pre-wrap */
function renderBubble(content) {
  if (window.marked && window.DOMPurify) {
    try {
      const raw = marked.parse(String(content), { breaks: true, gfm: true });
      const div = document.createElement('div');
      div.innerHTML = DOMPurify.sanitize(raw, { DATA_URI_TAGS: ['img'] });
      return { html: div.innerHTML, md: true };
    } catch { /* 解析失败则回退纯文本 */ }
  }
  return { html: esc(content), md: false };
}

/* 拆分旁白 / 对白（SillyTavern 语义：引号=对白、星号/括号动作=旁白、其余=叙述）
 * 状态机实现：支持嵌套引号（「他说“你好”」）、同族配对（“”「」『』" " ' '）、
 * 不成对引号整体回退为旁白；多段对白自然分段。 */
function splitNarration(text) {
  const OPEN = { '“': '”', '"': '"', '「': '」', '『': '』', '‘': '’', "'": "'" };
  const segs = [];
  let cur = '';
  const stack = []; // 引号栈（期望的闭符）
  const flush = (type) => {
    if (cur.trim()) segs.push({ type, text: cur });
    cur = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (stack.length) {
      // 引号内：继续累积，匹配到闭符出栈
      cur += ch;
      if (ch === stack[stack.length - 1]) stack.pop();
      if (!stack.length) flush('dialogue');
    } else if (OPEN[ch] !== undefined) {
      // 开引号：先落旁白，再入栈开始对白
      flush('narration');
      stack.push(OPEN[ch]);
      cur += ch;
    } else {
      cur += ch;
    }
  }
  // 未闭合的引号内容追加到旁白（LLM 输出不成对时保持可读、不产生碎段）
  if (stack.length) {
    if (segs.length && segs[segs.length - 1].type === 'narration') segs[segs.length - 1].text += cur;
    else if (cur.trim()) segs.push({ type: 'narration', text: cur });
  }
  if (!segs.length) segs.push({ type: 'narration', text });
  return segs;
}

/* ─────────── 会话管理 ─────────── */
function saveSessions() {
  try {
    // 图片消息存的是本地相对路径（/images/xxx.png，很小），可以安全持久化
    saveJSON(LS_SESSIONS, sessions);
  } catch (e) {
    console.warn('[Tavern] 会话保存失败（可能超出本地存储配额）:', e.message);
  }
}

/* 世界书集合：迁移旧单数组 → 多本结构 */
function ensureLorebooks() {
  // server 数据优先：已加载世界书时绝不用 localStorage 覆盖（localStorage 可能是旧数据）
  if (lorebooks && typeof lorebooks === 'object' && Object.keys(lorebooks).length) {
    if (!lorebooks['default']) lorebooks['default'] = { name: '默认世界书', entries: [] };
    if (!prefs.activeLoreId || !lorebooks[prefs.activeLoreId]) prefs.activeLoreId = 'default';
    saveJSON(LS_LORE, lorebooks); // 同步进 localStorage 缓存
    saveJSON(LS_PREFS, prefs);
    return;
  }
  // 无 server 数据：从 localStorage 迁移（旧数组 → 对象结构）或建空默认
  const raw = loadJSON(LS_LORE, null);
  if (Array.isArray(raw)) {
    lorebooks = { default: { name: '默认世界书', entries: raw } };
  } else if (raw && typeof raw === 'object' && Object.keys(raw).length) {
    lorebooks = raw;
  } else {
    lorebooks = { default: { name: '默认世界书', entries: [] } };
  }
  if (!lorebooks['default']) lorebooks['default'] = { name: '默认世界书', entries: [] };
  if (!prefs.activeLoreId || !lorebooks[prefs.activeLoreId]) prefs.activeLoreId = 'default';
  saveJSON(LS_LORE, lorebooks);
  saveJSON(LS_PREFS, prefs);
}

/* 示例数据：从 server /api/data/seed 拉取模板（空库自动注入；force 追加，按名称去重） */
async function fetchSeedTemplate() {
  try {
    const resp = await fetch('/api/data/seed');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.json();
  } catch (e) {
    console.warn('[Tavern] 无法加载示例数据模板（server 未运行?）:', e.message);
    return null;
  }
}

async function seedExamples(force) {
  const seed = await fetchSeedTemplate();
  if (!seed) return false;
  const seedChar = (seed.characters || [])[0];
  const seedPreset = seed.presets && seed.presets['RP 基础（示例）'];
  let changed = false;
  if ((force || !characters.length) && seedChar) {
    if (!characters.find(c => c.name === seedChar.name)) {
      const c = { id: uid(), ...seedChar, createdAt: Date.now() };
      characters.push(c);
      changed = true;
    }
    // 确保当前角色有效（指向已删除/不存在的 id 时回落为示例角色）
    if (!currentCharId || !characters.find(x => x.id === currentCharId)) {
      const sc = characters.find(x => x.name === seedChar.name);
      if (sc) { currentCharId = sc.id; localStorage.setItem(LS_CURRENT_CHAR, currentCharId); }
    }
  }
  const def = lorebooks['default'];
  const seedEntries = (seed.lorebooks && seed.lorebooks.default && seed.lorebooks.default.entries) || [];
  if (def && (force || !def.entries.length)) {
    for (const e of seedEntries) {
      if (!def.entries.find(x => x.title === e.title)) {
        def.entries.push({ id: uid(), ...e });
        changed = true;
      }
    }
  }
  if ((force || !Object.keys(promptPresets).length) && seedPreset) {
    if (!promptPresets['RP 基础（示例）']) {
      promptPresets['RP 基础（示例）'] = JSON.parse(JSON.stringify(seedPreset));
      prefs.currentPresetByMode = { ...(prefs.currentPresetByMode || {}), tavern: 'RP 基础（示例）' };
      prefs.currentPreset = 'RP 基础（示例）';
      changed = true;
    }
  }
  if (changed) {
    saveChars();
    saveLore();
    savePresets();
    saveJSON(LS_PREFS, prefs);
  }
  return changed;
}

function ensureSessions() {
  if (sessions && sessions.length) {
    // 迁移旧会话：无 kind → 酒馆；无 charId → 当前角色。已有归属绝不改写。
    for (const s of sessions) {
      if (!s.kind) s.kind = 'tavern';
      if (!s.charId || s.charId === 'undefined') s.charId = currentCharId;
    }
    // 当前会话必须同时属于当前角色与当前模式。
    if (!curSession()) currentSessionId = (sessions.find(sessionMatches) || {}).id || null;
    saveSessions();
    return;
  }
  // 迁移旧单会话
  const oldMsgs = loadJSON(LS_CHAT, null);
  const oldKind = oldMsgs && oldMsgs.length ? 'tavern' : mode;
  sessions = [{
    id: uid(), name: '会话 1', charId: currentCharId, kind: oldKind,
    messages: (oldMsgs && oldMsgs.length) ? oldMsgs : [],
    createdAt: Date.now(),
  }];
  currentSessionId = sessionMatches(sessions[0]) ? sessions[0].id : null;
  saveSessions();
}

function activateSessionScope() {
  ensureSessions();
  if (!currentCharId) { currentSessionId = null; return; }
  if (!curSession()) newSession(false);
}

function newSession(askName = true) {
  const char = currentChar();
  if (!char) { if (askName) alert('请先创建 / 选择角色'); return; }
  const defaultName = '会话 ' + (sessions.filter(sessionMatches).length + 1);
  const name = askName ? ((prompt('新会话名称：', defaultName) || defaultName).trim() || defaultName) : defaultName;
  const messages = [];
  const greeting = getGreeting();
  if (greeting) {
    messages.push({ role: 'assistant', content: greeting, ts: Date.now() }); // 开场白：正常走旁白/对白拆分
  } else if (defaults && defaults.ui && defaults.ui.noGreeting) {
    messages.push({ role: 'system', content: defaults.ui.noGreeting, ts: Date.now() });
  }
  sessions.unshift({ id: uid(), name, charId: currentCharId, kind: mode, messages, createdAt: Date.now() });
  currentSessionId = sessions[0].id;
  saveSessions();
  renderSessions();
  renderMessages();
}

function switchSession(id) {
  if (!sessions.find(s => s.id === id && sessionMatches(s))) return;
  currentSessionId = id;
  saveSessions();
  renderSessions();
  renderMessages();
}

function deleteSession(id) {
  if (!confirm('删除该会话？此操作不可撤销。')) return;
  sessions = sessions.filter(s => s.id !== id);
  if (currentSessionId === id) currentSessionId = null;
  ensureSessions();
  if (!curSession() && currentCharId) return newSession(false);
  saveSessions();
  renderSessions();
  renderMessages();
}

function renderSessions() {
  const nameEl = $('session-name');
  if (worldModeActive()) {
    if (nameEl) nameEl.textContent = currentWorldSave.name || '世界存档';
    const player = currentWorldSave.player?.snapshot || {};
    const hdrName = $('hdr-char-name');
    const hdrRace = $('hdr-char-race');
    if (hdrName) hdrName.textContent = player.name || currentWorldCard()?.title || '世界存档';
    if (hdrRace) hdrRace.textContent = `${[player.race, player.role].filter(Boolean).join(' · ') || '玩家快照'} · 世界存档`;
    const ml = $('session-menu-list');
    if (ml) ml.innerHTML = '<div class="sess-empty">当前显示世界存档，不读取旧 RPG 会话</div>';
    const saveMark = $('rpg-world-save');
    if (saveMark) { saveMark.hidden = false; saveMark.textContent = `世界 · ${currentWorldSave.name || currentWorldSave.id}`; }
    return;
  }
  const s = curSession();
  if (nameEl) nameEl.textContent = s ? s.name : '—';
  const saveMark = $('rpg-world-save');
  if (saveMark) saveMark.hidden = true;
  // 头部下拉（只列当前模式 kind 的会话）
  const ml = $('session-menu-list');
  if (ml) {
    ml.innerHTML = '';
    for (const ses of sessions.filter(sessionMatches)) {
      const el = document.createElement('div');
      el.className = 'sess-item' + (ses.id === currentSessionId ? ' active' : '');
      el.innerHTML = `<span>${esc(ses.name)}</span><span class="sess-btns"><span class="sess-x" data-act="rename" title="重命名">✎</span><span class="sess-x" data-act="del" title="删除">✕</span></span>`;
      el.addEventListener('click', (ev) => {
        const act = ev.target.dataset && ev.target.dataset.act;
        if (act === 'del') { deleteSession(ses.id); return; }
        if (act === 'rename') { renameSession(ses.id); return; }
        switchSession(ses.id);
        $('session-menu').classList.add('hidden');
      });
      ml.appendChild(el);
    }
  }
}

function renameSession(id) {
  const s = sessions.find(x => x.id === id);
  if (!s) return;
  const name = prompt('重命名会话：', s.name);
  if (name && name.trim()) { s.name = name.trim(); saveSessions(); renderSessions(); }
}

/* ─────────── 角色管理 ─────────── */
function saveChars() { saveJSON(LS_CHARS, characters); saveServerData('characters', characters); }

function ensureChars() {
  if (characters.length) {
    const ids = new Set();
    let changed = false;
    for (const c of characters) {
      if (!c.id || ids.has(c.id)) { c.id = uid(); changed = true; }
      ids.add(c.id);
    }
    if (!currentCharId || !characters.find(c => c.id === currentCharId)) {
      currentCharId = characters[0].id;
      localStorage.setItem(LS_CURRENT_CHAR, currentCharId);
    }
    if (changed) saveChars();
    return;
  }
  // 迁移旧角色卡
  const old = loadJSON(LS_CHAR, null);
  if (old && (old.name || old.persona)) {
    const c = {
      id: uid(),
      name: old.name || '？？？',
      race: old.race || '待定',
      role: old.role || '待定',
      persona: old.persona || '',
      scenario: '', firstMes: '', systemPrompt: '', postHistory: '',
      presetName: '', loreId: '',
      tags: '', createdAt: Date.now(),
    };
    characters = [c];
    currentCharId = c.id;
    localStorage.setItem(LS_CURRENT_CHAR, currentCharId);
    saveChars();
    return;
  }
  // 无旧数据：不创建占位角色，交给 seedExamples 注入示例角色
  currentCharId = null;
  localStorage.removeItem(LS_CURRENT_CHAR);
}

function renderCharacter() {
  // 兜底：角色库为空时由 init 注入示例；此处仅选当前角色
  let c = currentChar();
  if (!c && characters.length) {
    currentCharId = characters[0].id;
    localStorage.setItem(LS_CURRENT_CHAR, currentCharId);
    c = characters[0];
  }
  const name = c ? c.name : '？？？';
  const race = c ? (c.race || '待定') : '待定';
  const role = c ? (c.role || '待定') : '待定';
  $('hdr-char-name').textContent = name;
  $('hdr-char-race').textContent = `${race} · ${role}`;
}

function renderCharList() {
  const list = $('cm-list');
  if (!list) return;
  list.innerHTML = '';
  if (cmCreating) {
    const draft = document.createElement('div');
    draft.className = 'cm-item cm-draft active';
    draft.innerHTML = `<span class="cm-name">${esc($('cm-name').value.trim() || '新角色')}<span class="cm-draft-mark">未保存</span></span>`;
    list.appendChild(draft);
  }
  for (const c of characters) {
    const el = document.createElement('div');
    const inUse = c.id === currentCharId;
    el.className = 'cm-item' + (c.id === cmEditingId ? ' active' : '');
    el.innerHTML = `<span class="cm-name">${esc(c.name || '未命名')}${inUse ? '<span class="cm-inuse-mark">使用中</span>' : ''}</span><span class="cm-x" title="删除">✕</span>`;
    el.addEventListener('click', (ev) => {
      if (ev.target.classList.contains('cm-x')) { deleteChar(c.id); return; }
      selectCharForEdit(c.id);
    });
    list.appendChild(el);
  }
}

/* 填充角色卡绑定下拉（预设 / 世界书） */
function renderBindSelects() {
  const ps = $('cm-preset');
  if (ps) {
    const cur = ps.value;
    ps.innerHTML = '';
    const o0 = document.createElement('option'); o0.value = ''; o0.textContent = '（不绑定）'; ps.appendChild(o0);
    for (const n of Object.keys(promptPresets)) {
      if (n === GLOBAL_PRESET_KEY || !['tavern', 'both'].includes(presetMode(n, promptPresets[n]))) continue;
      const o = document.createElement('option'); o.value = n; o.textContent = n; ps.appendChild(o);
    }
    if (cur && promptPresets[cur]) ps.value = cur;
  }
  const ls = $('cm-lore');
  if (ls) {
    const cur = ls.value;
    ls.innerHTML = '';
    const o0 = document.createElement('option'); o0.value = ''; o0.textContent = '（不绑定）'; ls.appendChild(o0);
    for (const id of Object.keys(lorebooks || {})) {
      const o = document.createElement('option'); o.value = id; o.textContent = lorebooks[id].name; ls.appendChild(o);
    }
    if (cur && lorebooks[cur]) ls.value = cur;
  }
}

const CHAR_FIELD_FORM = {
  name: 'cm-name', race: 'cm-race', role: 'cm-role', persona: 'cm-persona',
  scenario: 'cm-scenario', firstMes: 'cm-first-mes', tags: 'cm-tags',
};

function charFieldDefs() {
  const fields = defaults && defaults.gen && defaults.gen.charFields;
  return Array.isArray(fields) ? fields.filter(f => f && f.key && f.label) : [];
}

function normalizeCharProfileFields(fields) {
  if (!Array.isArray(fields)) return [];
  return fields.filter(f => f && f.key && f.label).map(f => ({
    key: String(f.key), label: String(f.label), value: f.value == null ? '' : String(f.value),
  }));
}

function setCharWizardStep(step) {
  document.querySelectorAll('[data-cw-step]').forEach(el => {
    const n = Number(el.dataset.cwStep);
    el.classList.toggle('active', n === step);
    el.classList.toggle('done', n < step);
  });
  [1, 2, 3].forEach(n => $('cw-panel-' + n).classList.toggle('hidden', n !== step));
}

function appendCharFieldRow(field, custom = false) {
  const row = document.createElement('div');
  row.className = 'cm-profile-row';
  row.dataset.key = field.key;
  row.dataset.custom = custom ? '1' : '0';
  if (custom) {
    const label = document.createElement('input');
    label.className = 'cm-profile-label';
    label.value = field.label || '';
    label.placeholder = '条目名称';
    label.setAttribute('aria-label', '自定义条目名称');
    row.appendChild(label);
  } else {
    const label = document.createElement('label');
    label.textContent = field.label;
    label.htmlFor = 'cpf-' + field.key;
    row.appendChild(label);
  }
  const input = document.createElement('input');
  input.id = 'cpf-' + field.key;
  input.className = 'cm-profile-value';
  input.value = field.value || '';
  input.placeholder = field.placeholder || '填写' + (field.label || '内容');
  input.setAttribute('aria-label', (field.label || '自定义条目') + '内容');
  if (CHAR_FIELD_FORM[field.key]) input.addEventListener('input', () => {
    $(CHAR_FIELD_FORM[field.key]).value = input.value;
    if (cmCreating && field.key === 'name') renderCharList();
  });
  row.appendChild(input);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'ghost-btn cm-profile-remove';
  remove.textContent = '删除';
  remove.setAttribute('aria-label', '删除“' + (field.label || '自定义') + '”条目');
  remove.addEventListener('click', () => row.remove());
  row.appendChild(remove);
  $('cm-profile-fields').appendChild(row);
  return row;
}

function renderCharProfileFields(char, generated) {
  const list = $('cm-profile-fields');
  list.innerHTML = '';
  const stored = normalizeCharProfileFields(char && char.profileFields);
  const storedByKey = new Map(stored.map(f => [f.key, f]));
  const defined = new Set();
  for (const def of charFieldDefs()) {
    defined.add(def.key);
    const old = storedByKey.get(def.key);
    const coreValue = char && CHAR_FIELD_FORM[def.key] ? (char[def.key] || '') : '';
    const value = generated && Object.prototype.hasOwnProperty.call(generated, def.key)
      ? generated[def.key] : ((old && old.value) || coreValue);
    appendCharFieldRow({ ...def, value: String(value || '') });
  }
  for (const field of stored) {
    if (!defined.has(field.key)) appendCharFieldRow(field, true);
  }
}

function addCharProfileField() {
  const row = appendCharFieldRow({ key: 'custom_' + uid(), label: '', value: '' }, true);
  row.querySelector('.cm-profile-label').focus();
}

function collectCharProfileFields(syncCore = false) {
  const coreValues = Object.fromEntries(Object.entries(CHAR_FIELD_FORM).map(([key, id]) => [key, $(id).value.trim()]));
  return [...document.querySelectorAll('#cm-profile-fields .cm-profile-row')].map(row => {
    const custom = row.dataset.custom === '1';
    const labelEl = row.querySelector(custom ? '.cm-profile-label' : 'label');
    const key = row.dataset.key;
    return {
      key,
      label: (custom ? labelEl.value : labelEl.textContent).trim() || '自定义条目',
      value: syncCore && Object.prototype.hasOwnProperty.call(coreValues, key) ? coreValues[key] : row.querySelector('.cm-profile-value').value.trim(),
    };
  }).filter(field => field.key && field.value);
}

function syncProfileFieldsToForm() {
  for (const row of document.querySelectorAll('#cm-profile-fields .cm-profile-row')) {
    const id = CHAR_FIELD_FORM[row.dataset.key];
    if (id) $(id).value = row.querySelector('.cm-profile-value').value.trim();
  }
  if (cmCreating) renderCharList();
}

function selectCharForEdit(id) {
  const c = characters.find(x => x.id === id);
  if (!c) return;
  cmCreating = false;
  cmEditingId = id;
  $('cm-del').textContent = '删除角色';
  $('cm-edit-title').textContent = '编辑角色：' + (c.name || '未命名');
  $('cm-name').value = c.name || '';
  $('cm-race').value = c.race || '';
  $('cm-role').value = c.role || '';
  $('cm-persona').value = c.persona || '';
  $('cm-scenario').value = c.scenario || '';
  $('cm-first-mes').value = c.firstMes || '';
  $('cm-system').value = c.systemPrompt || '';
  $('cm-post').value = c.postHistory || '';
  $('cm-preset').value = c.presetName || '';
  $('cm-lore').value = c.loreId || '';
  $('cm-ref-image').value = c.refImage || '';
  updateRefPreview(c.refImage || '');
  $('cm-tags').value = c.tags || '';
  renderCharProfileFields(c);
  setCharWizardStep(2);
  $('cm-ai-status').textContent = '';
  renderCharList();
}

/* 参考图预览：有图显示，无图隐藏 */
function updateRefPreview(src) {
  const img = $('cm-ref-preview');
  if (!img) return;
  if (src) { img.src = src; img.classList.remove('hidden'); }
  else { img.removeAttribute('src'); img.classList.add('hidden'); }
  $('btn-remove-ref').classList.toggle('hidden', !src);
}

function removeRefImage() {
  if (!confirm('删除当前角色的参考图？图片文件仍会保留在本地。')) return;
  $('cm-ref-image').value = '';
  updateRefPreview('');
  const c = characters.find(x => x.id === cmEditingId);
  if (c) { c.refImage = ''; saveChars(); }
}

/* 导入本地图片 → 上传到 server → 填入参考图 */
function importRefImage(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const res = await fetch('/api/image-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ b64: reader.result }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.path) throw new Error('上传失败: ' + (data.error || res.status));
      $('cm-ref-image').value = data.path;
      updateRefPreview(data.path);
      const c = characters.find(x => x.id === cmEditingId);
      if (c) { c.refImage = data.path; saveChars(); }
    } catch (err) {
      console.error('[Tavern] 参考图导入失败:', err.message);
      alert('❌ 参考图导入失败：' + err.message);
    }
  };
  reader.readAsDataURL(file);
}

function newCharEditor() {
  cmCreating = true;
  cmEditingId = null;
  $('cm-edit-title').textContent = '新建角色';
  $('cm-del').textContent = '取消新建';
  ['cm-name', 'cm-race', 'cm-role', 'cm-persona', 'cm-scenario', 'cm-first-mes', 'cm-system', 'cm-post', 'cm-ref-image', 'cm-tags']
    .forEach(id => { $(id).value = ''; });
  $('cm-ai-desc').value = '';
  $('cm-ai-status').textContent = '';
  renderCharProfileFields(null);
  setCharWizardStep(1);
  updateRefPreview(''); // 清空参考图预览（新建角色不复用上个角色的图）
  renderCharList();
  $('cm-ai-desc').focus();
}

function saveCharFromEditor() {
  const data = {
    name: $('cm-name').value.trim() || '未命名',
    race: $('cm-race').value.trim(),
    role: $('cm-role').value.trim(),
    persona: $('cm-persona').value,
    scenario: $('cm-scenario').value,
    firstMes: $('cm-first-mes').value,
    systemPrompt: $('cm-system').value,
    postHistory: $('cm-post').value,
    presetName: $('cm-preset').value || '',
    loreId: $('cm-lore').value || '',
    refImage: $('cm-ref-image').value.trim(),
    tags: $('cm-tags').value.trim(),
    profileFields: collectCharProfileFields(true),
  };
  if (cmEditingId) {
    const c = characters.find(x => x.id === cmEditingId);
    Object.assign(c, data);
  } else {
    const c = { id: uid(), ...data, createdAt: Date.now() };
    characters.push(c);
    cmEditingId = c.id;
  }
  cmCreating = false;
  $('cm-edit-title').textContent = '编辑角色：' + data.name;
  $('cm-del').textContent = '删除角色';
  saveChars();
  renderCharList();
  renderCharacter();
}

function useCharInEditor() {
  saveCharFromEditor();
  const target = cmEditingId ? characters.find(x => x.id === cmEditingId) : characters[characters.length - 1];
  if (target) {
    currentCharId = target.id;
    localStorage.setItem(LS_CURRENT_CHAR, currentCharId);
  }
  activateSessionScope();
  renderCharacter();
  renderCharList();
  renderSessions();
  renderMessages();
  switchView('chat');
}

function deleteChar(id) {
  if (!confirm('删除该角色？关联会话保留但不再绑定角色。')) return;
  characters = characters.filter(c => c.id !== id);
  if (currentCharId === id) { currentCharId = characters.length ? characters[0].id : null; localStorage.setItem(LS_CURRENT_CHAR, currentCharId || ''); }
  saveChars();
  activateSessionScope();
  if (cmEditingId === id) {
    if (currentCharId) selectCharForEdit(currentCharId);
    else newCharEditor();
  }
  renderCharList();
  renderCharacter();
  renderSessions();
  renderMessages();
}

/* 角色卡导入 / 导出（Character Card V1/V2） */
function charToV2(c) {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: c.name || '',
      description: c.persona || '',
      personality: '',
      scenario: c.scenario || '',
      first_mes: c.firstMes || '',
      mes_example: '',
      creator_notes: '',
      system_prompt: c.systemPrompt || '',
      post_history_instructions: c.postHistory || '',
      alternate_greetings: [],
      tags: (c.tags || '').split(',').map(t => t.trim()).filter(Boolean),
      creator: '',
      character_version: '1.0',
      extensions: { tavern: { race: c.race || '', role: c.role || '', presetName: c.presetName || '', loreId: c.loreId || '', profileFields: c.profileFields || [] } },
    },
  };
}

function v2ToChar(j) {
  let d;
  if (j && j.spec === 'chara_card_v2' && j.data) d = j.data;
  else if (j && typeof j.name === 'string') d = j; // V1 平铺
  else throw new Error('无法识别的角色卡格式（需 Character Card V1/V2 JSON）');
  const ext = (d.extensions && d.extensions.tavern) || {};
  return {
    id: uid(), name: d.name || '未命名',
    race: ext.race || '待定', role: ext.role || '待定',
    persona: d.description || '', scenario: d.scenario || '',
    firstMes: d.first_mes || '', systemPrompt: d.system_prompt || '',
    postHistory: d.post_history_instructions || '',
    presetName: ext.presetName || '', loreId: ext.loreId || '',
    profileFields: normalizeCharProfileFields(ext.profileFields),
    tags: (d.tags || []).join(', '), createdAt: Date.now(),
  };
}

function exportCurrentChar() {
  const c = currentChar();
  if (!c) return alert('请先创建 / 选择一个角色');
  const blob = new Blob([JSON.stringify(charToV2(c), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (c.name || 'character').replace(/[\\/:*?"<>|]/g, '_') + '.card.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importCharFromText(text) {
  const c = v2ToChar(JSON.parse(text));
  characters.push(c);
  saveChars();
  renderCharList();
  selectCharForEdit(c.id);
}

/* ─────────── 提示词预设（独立栏目） ─────────── */

function currentLB() { return (lorebooks && lorebooks[lbEditingId]) || null; }

/* ─────────── 记忆 / 玩家设定 ─────────── */
function ensureUserData() {
  if (userData && userData.presets) return;
  userData = { currentPreset: 'default', presets: { default: { name: '旅人', race: '', role: '', persona: '', notes: '' } }, memories: [] };
}
function saveUserData() {
  ensureUserData();
  saveJSON(LS_USER, userData);
  saveServerData('user', userData);
}
function currentUserPreset() {
  ensureUserData();
  return userData.presets[userData.currentPreset] || Object.values(userData.presets)[0] || userData.presets.default;
}
function renderUserPresets() {
  const sel = $('um-preset');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '';
  for (const name of Object.keys(userData.presets)) {
    const o = document.createElement('option');
    o.value = name; o.textContent = name;
    sel.appendChild(o);
  }
  if (cur && userData.presets[cur]) sel.value = cur;
  else sel.value = userData.currentPreset || Object.keys(userData.presets)[0] || '';
}
function fillUserForm() {
  const p = currentUserPreset();
  $('um-preset').value = userData.currentPreset || '';
  $('um-name').value = p.name || '';
  $('um-race').value = p.race || '';
  $('um-role').value = p.role || '';
  $('um-persona').value = p.persona || '';
  $('um-notes').value = p.notes || '';
  renderUserPresets();
}
function readUserForm() {
  const p = currentUserPreset();
  p.name = $('um-name').value;
  p.race = $('um-race').value;
  p.role = $('um-role').value;
  p.persona = $('um-persona').value;
  p.notes = $('um-notes').value;
}
function saveUserForm() {
  readUserForm();
  saveUserData();
  alert('✅ 玩家设定已保存');
}
function saveUserAsNew() {
  readUserForm();
  const name = prompt('预设名称：', '设定 ' + (Object.keys(userData.presets).length + 1));
  if (!name || !name.trim()) return;
  userData.presets[name.trim()] = JSON.parse(JSON.stringify(currentUserPreset()));
  userData.currentPreset = name.trim();
  saveUserData();
  fillUserForm();
}
function deleteUserPreset() {
  const name = userData.currentPreset;
  if (!name || name === 'default') { alert('默认预设不可删除'); return; }
  if (!confirm(`删除预设「${name}」？`)) return;
  delete userData.presets[name];
  userData.currentPreset = 'default';
  saveUserData();
  fillUserForm();
}

/* 记忆条目 */
function renderMemList() {
  const list = $('mem-list');
  if (!list) return;
  list.innerHTML = '';
  const mems = userData.memories || [];
  if (!mems.length) { list.innerHTML = '<div class="hint">尚无记忆 —— 在上面输入一条。</div>'; return; }
  mems.forEach((m, i) => {
    const el = document.createElement('div');
    el.className = 'wi-item' + (m.enabled === false ? ' mem-off' : '');
    el.innerHTML = `<span class="wi-title-wrap">${m.enabled === false ? '🚫 ' : '💭 '}${esc(m.content)}</span><span class="wi-const" data-mi="${i}" title="启用/停用">${m.enabled === false ? '🔓' : '🔒'}</span><span class="wi-const" data-di="${i}" title="删除">✕</span>`;
    el.addEventListener('click', (ev) => {
      if (ev.target.dataset && ev.target.dataset.di !== undefined) { mems.splice(parseInt(ev.target.dataset.di, 10), 1); saveUserData(); renderMemList(); return; }
      if (ev.target.dataset && ev.target.dataset.mi !== undefined) {
        const idx = parseInt(ev.target.dataset.mi, 10);
        mems[idx].enabled = mems[idx].enabled === false ? true : false;
        saveUserData(); renderMemList(); return;
      }
      // 点击编辑
      const edit = prompt('编辑记忆：', m.content);
      if (edit === null) return;
      m.content = edit.trim();
      if (!m.content) { mems.splice(i, 1); }
      saveUserData(); renderMemList();
    });
    list.appendChild(el);
  });
}
function addMemory() {
  const input = $('mem-input');
  const text = input.value.trim();
  if (!text) return;
  userData.memories = userData.memories || [];
  userData.memories.push({ id: uid(), content: text, enabled: true, ts: Date.now() });
  input.value = '';
  saveUserData();
  renderMemList();
}

/* 世界书条目 id 兜底：种子数据无 id，统一补齐（渲染高亮/加载/保存/删除都依赖 id） */
function ensureEntryIds() {
  if (!lorebooks) return;
  let changed = false;
  for (const lb of Object.values(lorebooks)) {
    if (!lb || !Array.isArray(lb.entries)) continue;
    for (const e of lb.entries) {
      if (!e.id) { e.id = uid(); changed = true; }
    }
  }
  if (changed) saveLore(); // 持久化，避免刷新后 id 丢失
}

function presetMode(name, preset) {
  if (preset && ['tavern', 'rpg', 'both'].includes(preset.mode)) return preset.mode;
  if (name === GLOBAL_PRESET_KEY) return 'both';
  return /RPG/i.test(name || '') ? 'rpg' : 'tavern';
}

function makePresetMarker(identifier, name, content = '') {
  return { identifier, name, role: 'system', content, marker: true, position: 'relative', depth: 4, order: 100 };
}

function normalizePromptPreset(name, source) {
  const src = source && typeof source === 'object' ? source : {};
  if (src.version === PRESET_SCHEMA_VERSION && Array.isArray(src.prompts) && Array.isArray(src.promptOrder)) {
    const seen = new Set();
    const prompts = src.prompts.map((p, i) => {
      let identifier = String(p.identifier || p.id || `prompt-${i + 1}`);
      while (seen.has(identifier)) identifier += '-copy';
      seen.add(identifier);
      const marker = !!p.marker || PRESET_MARKER_IDS.has(identifier);
      return {
        ...p,
        identifier,
        name: String(p.name || identifier),
        role: marker ? 'system' : (['system', 'user', 'assistant'].includes(p.role) ? p.role : 'system'),
        content: String(p.content || ''),
        marker,
        position: marker ? 'relative' : (p.position === 'in_chat' ? 'in_chat' : 'relative'),
        depth: Math.max(0, Number(p.depth ?? p.injection_depth ?? 4) || 0),
        order: Number(p.order ?? p.injection_order ?? 100) || 0,
      };
    });
    const ids = new Set(prompts.map(p => p.identifier));
    const promptOrder = src.promptOrder
      .filter(o => o && ids.has(o.identifier))
      .map(o => ({ identifier: o.identifier, enabled: o.enabled !== false }));
    for (const [identifier, label] of PRESET_MARKERS.filter(([id]) => ['tavernMemory', 'tavernFormat', 'tavernRpg'].includes(id))) {
      if (ids.has(identifier)) continue;
      prompts.push(makePresetMarker(identifier, label));
      const beforeHistory = promptOrder.findIndex(o => o.identifier === 'chatHistory');
      promptOrder.splice(beforeHistory < 0 ? promptOrder.length : beforeHistory, 0, { identifier, enabled: identifier !== 'tavernRpg' || presetMode(name, src) !== 'tavern' });
      ids.add(identifier);
    }
    return { ...src, version: PRESET_SCHEMA_VERSION, mode: presetMode(name, src), firstMes: String(src.firstMes || ''), prompts, promptOrder };
  }

  const prompts = PRESET_MARKERS.map(([id, label]) => makePresetMarker(
    id,
    label,
    id === 'main' ? String(src.systemPrompt || '') : (id === 'jailbreak' ? String(src.postHistory || '') : ''),
  ));
  const promptOrder = prompts.map(p => ({ identifier: p.identifier, enabled: p.identifier !== 'tavernRpg' || presetMode(name, src) !== 'tavern' }));
  const formatIndex = promptOrder.findIndex(o => o.identifier === 'tavernFormat');
  for (const [i, module] of (Array.isArray(src.modules) ? src.modules : []).entries()) {
    let identifier = String(module.id || `module-${i + 1}`);
    while (prompts.some(p => p.identifier === identifier)) identifier += '-copy';
    prompts.push({ identifier, name: String(module.name || identifier), role: 'system', content: String(module.content || ''), marker: false, position: 'relative', depth: 4, order: 100 });
    promptOrder.splice(formatIndex + i, 0, { identifier, enabled: module.enabled !== false });
  }
  return { version: PRESET_SCHEMA_VERSION, mode: presetMode(name, src), firstMes: String(src.firstMes || ''), prompts, promptOrder };
}

function ensurePromptPresetsV2() {
  let changed = false;
  for (const name of Object.keys(promptPresets)) {
    const before = JSON.stringify(promptPresets[name]);
    const normalized = normalizePromptPreset(name, promptPresets[name]);
    if (before !== JSON.stringify(normalized)) changed = true;
    promptPresets[name] = normalized;
  }
  return changed;
}

function activePresetNameForMode(targetMode = mode) {
  const byMode = prefs.currentPresetByMode || {};
  const hasModeChoice = Object.prototype.hasOwnProperty.call(byMode, targetMode);
  const named = hasModeChoice ? byMode[targetMode] : (prefs.currentPreset || '');
  if (hasModeChoice && !named) return ''; // 空值是用户明确选择全局默认，不应自动回落示例预设
  if (promptPresets[named] && ['both', targetMode].includes(presetMode(named, promptPresets[named]))) return named;
  const fallbackName = targetMode === 'rpg' ? 'RPG 叙事引擎（示例）' : 'RP 基础（示例）';
  if (promptPresets[fallbackName]) return fallbackName;
  return Object.keys(promptPresets).find(n => n !== GLOBAL_PRESET_KEY && ['both', targetMode].includes(presetMode(n, promptPresets[n]))) || '';
}

function setActivePresetName(name) {
  prefs.currentPresetByMode = { ...(prefs.currentPresetByMode || {}), [mode]: name || '' };
  prefs.currentPreset = name || ''; // 保留旧版消费者的兼容镜像
  saveJSON(LS_PREFS, prefs);
}

function resolvePromptPreset() {
  const char = currentChar();
  const bound = mode === 'tavern' && char?.presetName && promptPresets[char.presetName]
    && ['tavern', 'both'].includes(presetMode(char.presetName, promptPresets[char.presetName])) ? char.presetName : '';
  const name = bound || activePresetNameForMode(mode);
  return { name, preset: promptPresets[name] || promptPresets[GLOBAL_PRESET_KEY] || normalizePromptPreset(GLOBAL_PRESET_KEY, {}) };
}

function renderPGList() {
  const list = $('pg-list');
  if (!list) return;
  list.innerHTML = '';
  const names = Object.keys(promptPresets);
  if (!names.length) { list.innerHTML = '<div class="hint">尚无预设 —— 点击「＋ 新建预设」。</div>'; }
  for (const name of names) {
    const display = name === GLOBAL_PRESET_KEY ? '⭐ 全局默认' : name;
    const el = document.createElement('div');
    const inUse = name === resolvePromptPreset().name;
    const badge = presetMode(name, promptPresets[name]) === 'both' ? '通用' : (presetMode(name, promptPresets[name]) === 'rpg' ? 'RPG' : '酒馆');
    el.className = 'cm-item' + (name === pgEditingName ? ' active' : '') + (inUse ? ' pg-inuse' : '');
    el.innerHTML = `<span>${esc(display)} <small>${badge}</small>${inUse ? ' ●' : ''}</span>${name === GLOBAL_PRESET_KEY ? '' : '<span class="cm-x" data-act="del" title="删除">✕</span>'}`;
    el.addEventListener('click', (ev) => {
      if (ev.target.dataset && ev.target.dataset.act === 'del') { pgDelete(name); return; }
      selectPresetForEdit(name);
    });
    list.appendChild(el);
  }
  fillPGActive();
}

function fillPGActive() {
  const sel = $('pg-active');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '';
  const o0 = document.createElement('option');
  o0.value = '';
  o0.textContent = '（不使用预设 → 用全局默认）';
  sel.appendChild(o0);
  for (const name of Object.keys(promptPresets)) {
    if (name === GLOBAL_PRESET_KEY) continue; // 全局默认由空值表达
    if (!['both', mode].includes(presetMode(name, promptPresets[name]))) continue;
    const o = document.createElement('option');
    o.value = name;
    o.textContent = name;
    sel.appendChild(o);
  }
  if (cur && promptPresets[cur]) sel.value = cur;
  else sel.value = activePresetNameForMode(mode);
}

function selectPresetForEdit(name) {
  pgEditingName = name || GLOBAL_PRESET_KEY;
  pgEditingPreset = normalizePromptPreset(pgEditingName, promptPresets[pgEditingName]);
  pgEditingPromptId = pgEditingPreset.promptOrder[0]?.identifier || null;
  $('pg-edit-title').textContent = pgEditingName === GLOBAL_PRESET_KEY ? '编辑全局默认' : '编辑预设：' + pgEditingName;
  $('pg-mode').value = pgEditingPreset.mode;
  $('pg-first-mes').value = pgEditingPreset.firstMes;
  renderPGPrompts();
  renderPGList();
}

function pgNew() {
  const name = prompt('新预设名称：', '预设 ' + (Object.keys(promptPresets).length + 1));
  if (!name || !name.trim()) return;
  if (promptPresets[name.trim()]) { alert('已存在同名预设。'); return; }
  promptPresets[name.trim()] = normalizePromptPreset(name.trim(), { mode, firstMes: '' });
  savePresets();
  selectPresetForEdit(name.trim());
}

function pgDelete(name) {
  if (!promptPresets[name] || name === GLOBAL_PRESET_KEY) return; // 全局默认不可删
  if (!confirm(`删除预设「${name}」？`)) return;
  delete promptPresets[name];
  for (const targetMode of ['tavern', 'rpg']) {
    if (prefs.currentPresetByMode?.[targetMode] === name) prefs.currentPresetByMode[targetMode] = '';
  }
  if (prefs.currentPreset === name) prefs.currentPreset = '';
  let charsChanged = false;
  for (const char of characters) {
    if (char.presetName === name) { char.presetName = ''; charsChanged = true; }
  }
  if (charsChanged) saveChars();
  saveJSON(LS_PREFS, prefs);
  savePresets();
  if (pgEditingName === name) selectPresetForEdit(GLOBAL_PRESET_KEY);
  else renderPGList();
}

function pgSave() {
  const name = pgEditingName || GLOBAL_PRESET_KEY;
  if (!pgEditingPreset) return;
  capturePGPromptEditor();
  pgEditingPreset.mode = $('pg-mode').value;
  pgEditingPreset.firstMes = $('pg-first-mes').value;
  promptPresets[name] = JSON.parse(JSON.stringify(pgEditingPreset));
  savePresets();
  renderPGList();
}

function currentPGPrompt() {
  return pgEditingPreset && pgEditingPreset.prompts.find(p => p.identifier === pgEditingPromptId);
}

function renderPGLibrary() {
  const select = $('pg-library');
  const used = new Set(pgEditingPreset?.promptOrder.map(o => o.identifier) || []);
  select.innerHTML = '<option value="">插入素材…</option>';
  for (const p of pgEditingPreset?.prompts || []) {
    if (used.has(p.identifier)) continue;
    const option = document.createElement('option');
    option.value = p.identifier;
    option.textContent = p.name;
    select.appendChild(option);
  }
  select.disabled = select.options.length === 1;
}

function renderPGPrompts() {
  const box = $('pg-prompts');
  box.innerHTML = '';
  if (!pgEditingPreset || !pgEditingPreset.promptOrder.length) box.innerHTML = '<div class="hint">提示词顺序为空。请新建条目或从素材库插入。</div>';
  const promptMap = new Map(pgEditingPreset?.prompts.map(p => [p.identifier, p]) || []);
  pgEditingPreset?.promptOrder.forEach((item, i) => {
    const p = promptMap.get(item.identifier);
    if (!p) return;
    const el = document.createElement('div');
    el.className = 'pg-prompt-row' + (p.identifier === pgEditingPromptId ? ' active' : '');
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.innerHTML = `<input type="checkbox" data-enable="${i}" aria-label="启用 ${esc(p.name)}" ${item.enabled ? 'checked' : ''} />
      <div class="pg-prompt-main"><span class="pg-prompt-name">${esc(p.name)}</span><span class="pg-prompt-meta"><span>${esc(p.role)}</span><span>${p.marker ? '固定槽位' : (p.position === 'in_chat' ? `历史深度 ${p.depth}` : '相对位置')}</span></span></div>
      <div class="pg-prompt-move"><button class="ghost-btn" type="button" data-move="-1" data-index="${i}" aria-label="上移 ${esc(p.name)}">↑</button><button class="ghost-btn" type="button" data-move="1" data-index="${i}" aria-label="下移 ${esc(p.name)}">↓</button></div>`;
    const selectPrompt = () => {
      capturePGPromptEditor();
      pgEditingPromptId = p.identifier;
      renderPGPrompts();
    };
    el.addEventListener('click', e => {
      if (e.target.closest('input,button')) return;
      selectPrompt();
    });
    el.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      selectPrompt();
    });
    box.appendChild(el);
  });
  box.querySelectorAll('input[data-enable]').forEach(cb => {
    cb.addEventListener('change', () => {
      pgEditingPreset.promptOrder[Number(cb.dataset.enable)].enabled = cb.checked;
    });
  });
  box.querySelectorAll('button[data-move]').forEach(btn => btn.addEventListener('click', () => {
    capturePGPromptEditor();
    const from = Number(btn.dataset.index);
    const to = from + Number(btn.dataset.move);
    if (to < 0 || to >= pgEditingPreset.promptOrder.length) return;
    const [item] = pgEditingPreset.promptOrder.splice(from, 1);
    pgEditingPreset.promptOrder.splice(to, 0, item);
    renderPGPrompts();
  }));
  renderPGLibrary();
  fillPGPromptEditor();
}

function fillPGPromptEditor() {
  const p = currentPGPrompt();
  const editor = $('pg-prompt-editor');
  editor.classList.toggle('hidden', !p);
  if (!p) return;
  const dynamicMarker = p.marker && !['main', 'jailbreak'].includes(p.identifier);
  editor.classList.toggle('is-marker', p.marker);
  $('pg-prompt-name').value = p.name;
  $('pg-prompt-role').value = p.role;
  $('pg-prompt-position').value = p.position;
  $('pg-prompt-depth').value = p.depth;
  $('pg-prompt-order').value = p.order;
  $('pg-prompt-content').value = p.content;
  $('pg-prompt-role').disabled = p.marker;
  $('pg-prompt-position').disabled = p.marker;
  $('pg-prompt-content').disabled = dynamicMarker;
  $('pg-prompt-del').disabled = p.marker;
  $('pg-inchat-fields').classList.toggle('hidden', p.position !== 'in_chat' || p.marker);
  $('pg-prompt-note').textContent = dynamicMarker
    ? '固定槽位由运行时数据填充，不在预设中复制角色、世界书、历史或状态。'
    : (p.marker ? '固定槽位不可删除，但可编辑内容、调整顺序或关闭。' : '自定义条目可使用常用 SillyTavern 宏。');
}

function capturePGPromptEditor() {
  const p = currentPGPrompt();
  if (!p) return;
  p.name = $('pg-prompt-name').value.trim() || p.identifier;
  if (!p.marker) {
    p.role = $('pg-prompt-role').value;
    p.position = $('pg-prompt-position').value;
  }
  p.depth = Math.max(0, Number($('pg-prompt-depth').value) || 0);
  p.order = Number($('pg-prompt-order').value) || 0;
  if (!$('pg-prompt-content').disabled) p.content = $('pg-prompt-content').value;
}

function pgPromptNew() {
  if (!pgEditingPreset) return;
  capturePGPromptEditor();
  const identifier = uid();
  pgEditingPreset.prompts.push({ identifier, name: '新提示词', role: 'system', content: '', marker: false, position: 'relative', depth: 4, order: 100 });
  pgEditingPreset.promptOrder.push({ identifier, enabled: true });
  pgEditingPromptId = identifier;
  renderPGPrompts();
  $('pg-prompt-name').focus();
  $('pg-prompt-name').select();
}

function pgPromptDelete() {
  const p = currentPGPrompt();
  if (!p || p.marker) return;
  pgEditingPreset.promptOrder = pgEditingPreset.promptOrder.filter(o => o.identifier !== p.identifier);
  pgEditingPreset.prompts = pgEditingPreset.prompts.filter(x => x.identifier !== p.identifier);
  pgEditingPromptId = pgEditingPreset.promptOrder[0]?.identifier || null;
  renderPGPrompts();
}

function insertPGLibraryPrompt(identifier) {
  if (!identifier || !pgEditingPreset || pgEditingPreset.promptOrder.some(o => o.identifier === identifier)) return;
  capturePGPromptEditor();
  pgEditingPreset.promptOrder.push({ identifier, enabled: true });
  pgEditingPromptId = identifier;
  renderPGPrompts();
}

function convertSTPresetData(data) {
  if (!data || !Array.isArray(data.prompts) || !Array.isArray(data.prompt_order)) throw new Error('不是 SillyTavern Chat Completion 预设');
  if (data.prompts.length > 2000) throw new Error('预设素材超过 2000 条，拒绝导入');
  const profile = data.prompt_order.find(x => x.character_id === 100001) || data.prompt_order.at(-1);
  if (!profile || !Array.isArray(profile.order)) throw new Error('预设缺少 prompt_order');
  if (profile.order.length > 2000) throw new Error('提示词顺序超过 2000 条，拒绝导入');
  const prompts = data.prompts.map((p, i) => ({
    ...p,
    identifier: String(p.identifier || `prompt-${i + 1}`),
    name: String(p.name || p.identifier || `提示词 ${i + 1}`),
    role: ['system', 'user', 'assistant'].includes(p.role) ? p.role : 'system',
    content: String(p.content || ''),
    marker: !!p.marker || PRESET_MARKER_IDS.has(p.identifier),
    position: p.injection_position === 1 ? 'in_chat' : 'relative',
    depth: Math.max(0, Number(p.injection_depth ?? 4) || 0),
    order: Number(p.injection_order ?? 100) || 0,
  }));
  const promptOrder = profile.order.map(o => ({ identifier: o.identifier, enabled: o.enabled !== false }));
  const modelParameters = Object.fromEntries([
    'temperature', 'frequency_penalty', 'presence_penalty', 'top_p', 'top_k', 'top_a', 'min_p',
    'repetition_penalty', 'openai_max_context', 'openai_max_tokens', 'seed', 'n', 'stream_openai',
    'reasoning_effort', 'verbosity', 'assistant_prefill', 'continue_prefill', 'continue_postfix',
  ].filter(key => data[key] !== undefined).map(key => [key, data[key]]));
  const importedMode = ['tavern', 'rpg', 'both'].includes(data.tavern_meta?.mode) ? data.tavern_meta.mode : 'tavern';
  return {
    preset: { version: PRESET_SCHEMA_VERSION, mode: importedMode, firstMes: String(data.tavern_meta?.firstMes || ''), prompts, promptOrder, modelParameters, source: { format: 'sillytavern-chat-completion', profile: profile.character_id, unusedPrompts: Math.max(0, prompts.length - promptOrder.length) } },
    report: { prompts: prompts.length, ordered: promptOrder.length, regexes: data.extensions?.regex_scripts?.length || 0 },
  };
}

function importSTPreset(data, filename) {
  const converted = convertSTPresetData(data);
  const name = String(filename || 'SillyTavern 预设').replace(/\.json$/i, '') || 'SillyTavern 预设';
  let uniqueName = name;
  for (let i = 2; promptPresets[uniqueName]; i++) uniqueName = `${name} (${i})`;
  promptPresets[uniqueName] = normalizePromptPreset(uniqueName, converted.preset);
  savePresets();
  selectPresetForEdit(uniqueName);
  return { name: uniqueName, ...converted.report };
}

function exportPromptPreset() {
  if (!pgEditingPreset || pgEditingName === GLOBAL_PRESET_KEY) return;
  capturePGPromptEditor();
  const prompts = pgEditingPreset.prompts.map(p => ({
    name: p.name, system_prompt: p.marker, role: p.role, content: p.content,
    identifier: p.identifier, marker: p.marker || undefined,
    injection_position: p.position === 'in_chat' ? 1 : 0,
    injection_depth: p.depth, injection_order: p.order,
  }));
  const payload = { ...(pgEditingPreset.modelParameters || {}), prompts, prompt_order: [{ character_id: 100001, order: pgEditingPreset.promptOrder }], tavern_meta: { version: PRESET_SCHEMA_VERSION, mode: pgEditingPreset.mode, firstMes: pgEditingPreset.firstMes } };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = pgEditingName.replace(/[\\/:*?"<>|]/g, '_') + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ─────────── 世界书（独立栏目，多本可绑定） ─────────── */
function saveLore() { saveJSON(LS_LORE, lorebooks); saveServerData('lorebooks', lorebooks); }

function renderLBList() {
  const list = $('lb-list');
  if (!list) return;
  list.innerHTML = '';
  for (const id of Object.keys(lorebooks)) {
    const lb = lorebooks[id];
    const el = document.createElement('div');
    el.className = 'cm-item' + (id === lbEditingId ? ' active' : '');
    el.innerHTML = `<span>${esc(lb.name)}${id === prefs.activeLoreId ? ' ★' : ''}</span><span class="cm-x" data-act="act" title="设为全局">★</span>`;
    el.addEventListener('click', (ev) => {
      if (ev.target.dataset && ev.target.dataset.act === 'act') { setActiveLB(id); return; }
      selectLB(id);
    });
    list.appendChild(el);
  }
}

function setActiveLB(id) {
  if (!lorebooks[id]) return;
  prefs.activeLoreId = id;
  saveJSON(LS_PREFS, prefs);
  renderLBList();
}

function selectLB(id) {
  if (!lorebooks[id]) return;
  lbEditingId = id;
  wiEditingId = null;
  $('lb-edit-title').textContent = '世界书：' + lorebooks[id].name;
  renderLBList();
  renderWIList();
}

function lbNew() {
  const name = prompt('新世界书名称：', '世界书 ' + (Object.keys(lorebooks).length + 1));
  if (!name || !name.trim()) return;
  const id = uid();
  lorebooks[id] = { name: name.trim(), entries: [] };
  saveLore();
  selectLB(id);
}

function lbDelete() {
  if (!lbEditingId) return;
  const lb = lorebooks[lbEditingId];
  if (!confirm(`删除世界书「${lb.name}」？其条目将一并删除。`)) return;
  delete lorebooks[lbEditingId];
  if (prefs.activeLoreId === lbEditingId) prefs.activeLoreId = 'default';
  saveJSON(LS_PREFS, prefs);
  lbEditingId = Object.keys(lorebooks)[0] || null;
  saveLore();
  renderLBList();
  if (lbEditingId) renderWIList();
}

function currentLBEntries() { const lb = currentLB(); return lb ? lb.entries : []; }

function renderWIList() {
  const list = $('wi-list');
  if (!list) return;
  list.innerHTML = '';
  const entries = currentLBEntries();
  if (!entries.length) {
    list.innerHTML = '<div class="hint">尚无条目 —— 点击「＋ 新条目」添加。</div>';
    return;
  }
  for (const e of entries) {
    const el = document.createElement('div');
    el.className = 'wi-item' + (e.id === wiEditingId ? ' active' : '');
    el.innerHTML = `<span class="wi-title-wrap">${esc(e.title || '（无标题）')}</span><span class="wi-keys-preview">${esc(e.keys || '')}</span><span class="wi-const" data-act="const" title="${e.constant ? '取消常驻（改为触发注入）' : '设为常驻（不触发也总是注入）'}">${e.constant ? '🔒' : '🔓'}</span>`;
    el.addEventListener('click', (ev) => {
      if (ev.target.dataset && ev.target.dataset.act === 'const') { toggleConst(e.id); return; }
      selectWI(e.id);
    });
    list.appendChild(el);
  }
}

/* 一键切换条目常驻（列表项上的 🔒/🔓） */
function toggleConst(id) {
  const e = currentLBEntries().find(x => x.id === id);
  if (!e) return;
  e.constant = !e.constant;
  saveLore();
  renderWIList();
}

function selectWI(id) {
  const e = currentLBEntries().find(x => x.id === id);
  if (!e) return;
  wiEditingId = id;
  $('wi-title').value = e.title || '';
  $('wi-keys').value = e.keys || '';
  $('wi-content').value = e.content || '';
  $('wi-order').value = e.order || 100;
  $('wi-constant').checked = !!e.constant;
  renderWIList();
}

/* 注入测试：按当前最近消息即时计算哪些世界书条目会命中 */
function wiTestHits() {
  const injected = buildWorldInfo();
  const el = $('wi-test-result');
  if (!el) return;
  el.textContent = injected.length
    ? `✅ 将注入 ${injected.length} 条：` + injected.map(c => c.slice(0, 24)).join(' / ')
    : 'ℹ️ 当前无命中 —— 检查触发词是否出现在最近消息中、扫描深度、条目是否已保存（常驻条目始终注入）';
}

function newWIEditor() {
  if (!lbEditingId) return;
  wiEditingId = null;
  $('wi-title').value = '';
  $('wi-keys').value = '';
  $('wi-content').value = '';
  $('wi-order').value = 100;
  $('wi-constant').checked = false;
  renderWIList();
}

function saveWI() {
  if (!lbEditingId) return;
  const data = {
    title: $('wi-title').value.trim(),
    keys: $('wi-keys').value.trim(),
    content: $('wi-content').value,
    order: parseInt($('wi-order').value, 10) || 100,
    constant: $('wi-constant').checked,
    enabled: true,
  };
  const entries = currentLBEntries();
  if (wiEditingId) {
    Object.assign(entries.find(x => x.id === wiEditingId), data);
  } else {
    entries.push({ id: uid(), ...data });
  }
  saveLore();
  renderWIList();
}

function deleteWI() {
  if (!wiEditingId || !lbEditingId) return;
  if (!confirm('删除该世界书条目？')) return;
  lorebooks[lbEditingId].entries = currentLBEntries().filter(e => e.id !== wiEditingId);
  wiEditingId = null;
  saveLore();
  renderWIList();
  newWIEditor();
}

/* 世界书匹配：最近 N 条消息里找触发词（含正则），constant 常驻，按 order 排序 */
function buildWorldInfo() {
  const char = currentChar();
  const sources = [];
  const worldLoreIds = worldModeActive()
    ? (Array.isArray(currentWorldCard()?.lorebookIds) && currentWorldCard().lorebookIds.length
      ? currentWorldCard().lorebookIds
      : ['default'])
    : (prefs.activeLoreId ? [prefs.activeLoreId] : []);
  for (const loreId of [...new Set(worldLoreIds)]) {
    if (lorebooks && lorebooks[loreId] && Array.isArray(lorebooks[loreId].entries)) sources.push(...lorebooks[loreId].entries);
  }
  if (!worldModeActive() && char && char.loreId && lorebooks && lorebooks[char.loreId] && char.loreId !== prefs.activeLoreId) {
    sources.push(...lorebooks[char.loreId].entries);
  }
  const depth = Math.max(0, prefs.wiScanDepth || 0);
  const msgs = depth ? curMessages().slice(-depth) : [];
  const scanText = msgs.map(m => (m.role === 'user' ? '玩家：' : '角色：') + m.content).join('\n');
  const hits = [];
  for (const e of sources) {
    if (e.enabled === false) continue;
    if (e.constant) { hits.push(e); continue; }
    const keys = (e.keys || '').split(',').map(k => k.trim()).filter(Boolean);
    if (!keys.length) continue;
    for (const k of keys) {
      let matched = false;
      if (k.startsWith('/') && k.lastIndexOf('/') > 0) {
        const end = k.lastIndexOf('/');
        try { matched = new RegExp(k.slice(1, end), k.slice(end + 1)).test(scanText); } catch { matched = false; }
      } else if (prefs.wiWholeWord && /^[A-Za-z0-9_]+$/.test(k)) {
        matched = new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(scanText);
      } else {
        matched = scanText.toLowerCase().includes(k.toLowerCase());
      }
      if (matched) { hits.push(e); break; }
    }
  }
  const seen = new Set();
  const uniq = hits.filter(e => {
    const key = e.id || e.title; // 条目可能无 id（种子数据），用 title 去重
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  uniq.sort((a, b) => ((a.constant ? 0 : 1) - (b.constant ? 0 : 1)) || ((a.order || 0) - (b.order || 0)));
  return uniq.map(e => e.content).filter(Boolean);
}

/* ─────────── 提示词构建管线（ST 风格素材库 + 顺序，运行时保持唯一 system） ─────────── */
function buildCharacterPromptParts(char) {
  if (!char) return { description: '', personality: '', scenario: '' };
  const lines = [];
  if (char.name?.trim()) lines.push('名字：' + char.name.trim());
  if (char.race?.trim()) lines.push('种族：' + char.race.trim());
  if (char.role?.trim()) lines.push('身份：' + char.role.trim());
  const coreKeys = new Set(['name', 'race', 'role', 'persona', 'scenario', 'firstMes', 'tags']);
  for (const field of normalizeCharProfileFields(char.profileFields)) {
    if (!coreKeys.has(field.key) && field.value) lines.push(field.label.trim() + '：' + field.value.trim());
  }
  if (mode === 'rpg' && char.systemPrompt?.trim()) lines.push('角色专属指令：' + char.systemPrompt.trim());
  return {
    description: lines.length ? '【角色描述】\n' + lines.join('\n') : '',
    personality: char.persona?.trim() ? '【角色性格与外貌】\n' + char.persona.trim() : '',
    scenario: char.scenario?.trim() ? '【当前场景】\n' + char.scenario.trim() : '',
  };
}

function buildUserPromptPart() {
  if (!userData) return '';
  const up = currentUserPreset();
  const lines = [];
  if (up.name?.trim()) lines.push('名字：' + up.name.trim());
  if (up.race?.trim()) lines.push('种族：' + up.race.trim());
  if (up.role?.trim()) lines.push('身份：' + up.role.trim());
  if (up.persona?.trim()) lines.push('外貌 / 背景 / 偏好：' + up.persona.trim());
  return lines.length ? '【玩家设定】\n' + lines.join('\n') : '';
}

function buildMemoryPromptPart() {
  const mems = (userData?.memories || []).filter(m => m.enabled !== false && m.content?.trim());
  return mems.length ? '【记忆】\n' + mems.map(m => '- ' + m.content.trim()).join('\n') : '';
}

function buildFormatPromptPart() {
  const lines = [];
  const fi = formatInstructions[prefs.formatPreset];
  if (fi) lines.push(typeof fi === 'string' ? fi : (fi.text || ''));
  if (prefs.formatCustom?.trim()) lines.push(prefs.formatCustom.trim());
  return lines.filter(Boolean).join('\n');
}

function worldNpcQuestIds(quest) {
  if (!quest || typeof quest !== 'object') return [];
  const ids = [];
  for (const key of ['npcId', 'giverNpcId', 'targetNpcId', 'actorNpcId']) {
    if (typeof quest[key] === 'string') ids.push(quest[key]);
  }
  for (const key of ['npcIds', 'relatedNpcIds', 'participantNpcIds']) {
    if (Array.isArray(quest[key])) ids.push(...quest[key]);
  }
  if (Array.isArray(quest.objectives)) {
    for (const objective of quest.objectives) {
      if (objective && typeof objective.npcId === 'string') ids.push(objective.npcId);
    }
  }
  return ids.filter(id => id.trim()).map(id => id.trim());
}

function worldContextBudget() {
  const configured = Number(prefs?.worldContextBudget);
  return Number.isFinite(configured) && configured > 0
    ? Math.max(6000, Math.min(60000, Math.floor(configured)))
    : 24000;
}

function worldPromptPriority(part) {
  const heading = /^【([^】]+)】/.exec(String(part || ''))?.[1];
  if (!heading) return null;
  return {
    '回合契约': 115,
    '世界时间': 112,
    '当前玩家动态状态': 110,
    'RPG 状态': 110,
    '目标': 108,
    '线索': 108,
    '目标 / 线索时限': 108,
    '长期事件记忆': 106,
    '当前世界卡': 104,
    '当前作用域 NPC': 102,
    '当前玩家只读派生值': 100,
    '背包': 98,
    '世界存档中的玩家快照': 96,
    '已提交世界事件': 94,
    '冲突状态': 92,
    '物品 / 装备 / 经济规则': 88,
    '成长候选与人物经历': 76,
    '地图': 70,
    '当前作用域派系': 64,
    '任务': 108,
  }[heading] ?? 40;
}

function clipWorldPromptPart(text, limit) {
  if (text.length <= limit) return text;
  const suffix = '…（本段受上下文预算裁剪）';
  const max = Math.max(0, limit - suffix.length);
  const lines = text.split('\n');
  let output = '';
  for (const line of lines) {
    const next = output ? `${output}\n${line}` : line;
    if (next.length > max) break;
    output = next;
  }
  if (!output) output = text.slice(0, max);
  return output + suffix;
}

function budgetWorldPromptParts(parts) {
  if (!worldModeActive()) return parts;
  const entries = parts.map((text, index) => ({ text: String(text || ''), index, priority: worldPromptPriority(text) }))
    .filter(entry => entry.priority !== null && entry.text);
  if (!entries.length) return parts;
  let remaining = worldContextBudget();
  const kept = new Map();
  for (const entry of [...entries].sort((a, b) => b.priority - a.priority || a.index - b.index)) {
    const separatorCost = kept.size ? 2 : 0;
    if (remaining <= separatorCost) break;
    const clipped = clipWorldPromptPart(entry.text, remaining - separatorCost);
    if (!clipped) continue;
    kept.set(entry.index, clipped);
    remaining -= clipped.length + separatorCost;
  }
  return parts.map((text, index) => {
    const priority = worldPromptPriority(text);
    return priority === null ? text : (kept.get(index) || '');
  }).filter(Boolean);
}

function worldNpcLocationIds(npc) {
  if (!npc || typeof npc !== 'object') return [];
  const ids = [];
  if (typeof npc.locationId === 'string') ids.push(npc.locationId);
  if (typeof npc.homeLocationId === 'string') ids.push(npc.homeLocationId);
  if (Array.isArray(npc.locationIds)) ids.push(...npc.locationIds);
  return ids.filter(id => typeof id === 'string' && id.trim()).map(id => id.trim());
}

function worldNpcVisibleSecretText(npc, npcState) {
  const knowledge = new Set(Array.isArray(npcState?.knowledge) ? npcState.knowledge.filter(item => typeof item === 'string').map(item => item.trim()) : []);
  const secrets = Array.isArray(npc?.secrets) ? npc.secrets : [];
  return secrets
    .filter(secret => secret && typeof secret === 'object')
    .map(secret => ({ id: typeof secret.id === 'string' ? secret.id.trim() : '', content: typeof secret.content === 'string' ? secret.content.trim() : '' }))
    .filter(secret => secret.id && secret.content && knowledge.has(secret.id))
    .map(secret => `${secret.id}：${secret.content}`);
}

function buildWorldNpcPromptPart() {
  if (!worldModeActive()) return '';
  const world = currentWorldCard();
  const save = currentWorldSave;
  const generatedNpcs = save.generatedEntities?.npcs && typeof save.generatedEntities.npcs === 'object' && !Array.isArray(save.generatedEntities.npcs)
    ? Object.values(save.generatedEntities.npcs)
    : [];
  const definitions = [...(Array.isArray(world?.npcs) ? world.npcs : []), ...generatedNpcs]
    .filter(npc => npc && typeof npc.id === 'string' && npc.id.trim())
    .filter((npc, index, list) => list.findIndex(item => item.id === npc.id) === index);
  if (!definitions.length) return '';
  const state = save.state || {};
  const currentLocationId = typeof state.locationId === 'string' ? state.locationId : '';
  const partyIds = new Set(Array.isArray(save.party?.memberIds) ? save.party.memberIds.filter(id => typeof id === 'string') : []);
  const objectiveIds = new Set([
    ...(Array.isArray(state.quests) ? state.quests : []),
    ...(Array.isArray(state.goals) ? state.goals : []),
    ...(Array.isArray(state.leads) ? state.leads : []),
  ].flatMap(worldNpcQuestIds));
  const conflictIds = new Set(Object.values(state.conflicts && typeof state.conflicts === 'object' ? state.conflicts : {}).flatMap(conflict => [
    conflict?.targetId,
    ...(Array.isArray(conflict?.participants) ? conflict.participants.map(item => typeof item === 'string' ? item : item?.id) : []),
  ].filter(id => typeof id === 'string' && id.trim())));
  const memoryIds = new Set((Array.isArray(save.eventMemory) ? save.eventMemory : [])
    .filter(memory => memory && memory.visibility !== 'hidden'
      && (memory.visibility !== 'local' || !memory.locationId || memory.locationId === currentLocationId))
    .flatMap(memory => Array.isArray(memory.entityIds) ? memory.entityIds : [])
    .filter(id => typeof id === 'string' && id.trim()));
  const npcStates = save.npcStates && typeof save.npcStates === 'object' ? save.npcStates : {};
  const selected = definitions.filter(npc => {
    const id = npc.id.trim();
    const npcState = npcStates[id];
    return partyIds.has(id)
      || objectiveIds.has(id)
      || conflictIds.has(id)
      || memoryIds.has(id)
      || (npcState && npcState.locationId === currentLocationId)
      || worldNpcLocationIds(npc).includes(currentLocationId);
  });
  if (!selected.length) return '';
  const sections = selected.map(npc => {
    const id = npc.id.trim();
    const npcState = npcStates[id] || {};
    const fields = [`ID：${id}`, `名称：${npc.name || id}`];
    for (const key of ['role', 'description', 'persona', 'personality', 'appearance', 'speechStyle', 'publicFacts', 'publicGoals', 'desires', 'fears', 'goals', 'activity']) {
      const value = npc[key];
      if (Array.isArray(value) && value.length) fields.push(`${key}：${value.join('；')}`);
      else if (typeof value === 'string' && value.trim()) fields.push(`${key}：${value.trim()}`);
    }
    const visibleSecrets = worldNpcVisibleSecretText(npc, npcState);
    if (visibleSecrets.length) fields.push(`当前存档已解锁秘密（仅使用这些）：${visibleSecrets.join('；')}`);
    if (npcState.locationId) fields.push(`当前存档位置：${npcState.locationId}`);
    if (npcState.relation && Object.keys(npcState.relation).length) fields.push(`当前存档关系：${JSON.stringify(npcState.relation)}`);
    if (Array.isArray(npcState.knowledge) && npcState.knowledge.length) fields.push(`当前存档已知事实：${npcState.knowledge.join('；')}`);
    if (Array.isArray(npcState.status) && npcState.status.length) fields.push(`当前存档状态：${npcState.status.join('；')}`);
    return fields.join('\n');
  });
  return '【当前作用域 NPC】\n只允许引用以下 NPC；未列出的世界 NPC 不在本回合上下文中。静态资料仅代表公开信息；不得臆测未注入的秘密。NPC 只能使用公共资料、本存档已知事实和已解锁秘密，不得读取其他存档或其他 NPC 的知识。\n' + sections.join('\n\n');
}

function buildWorldFactLayerPromptPart() {
  if (!worldModeActive()) return '';
  const world = currentWorldCard();
  const save = currentWorldSave;
  const state = save.state || {};
  const staticScope = `${world?.id || save.worldId || 'world'}@v${world?.version || save.worldVersion || 1}`;
  const saveScope = `${save.id || currentWorldSaveId || 'save'}@r${Number.isInteger(save.revision) ? save.revision : 0}`;
  const currentLocation = state.locationId || '未指定';
  const currentTime = state.time ? `${state.time.value} ${state.time.unit}` : '未指定';
  return `【世界事实分层】
稳定设定来源：WorldCard ${staticScope}。世界简介、登记地点、NPC 公共资料、派系定义、事件模板和规则属于稳定设定；不要因为某个存档的变化而改写它们。
当前事实来源：WorldSave ${saveScope}。当前地点=${currentLocation}；当前时间=${currentTime}；NPC 位置 / 关系 / 认知、背包、目标、冲突、已提交事件和长期记忆等动态字段只属于这个存档。
冲突处理：同一实体或地点同时出现静态资料与存档状态时，静态资料解释默认设定，存档状态解释当前局面；两者都要保留，不能把一次存档变化宣称为世界卡永久改写，也不能用旧静态默认值覆盖已提交状态。`;
}

function buildWorldEventPromptPart() {
  if (!worldModeActive()) return '';
  const state = currentWorldSave.state || {};
  const currentLocationId = state.locationId || null;
  const events = Array.isArray(state.worldEvents) ? state.worldEvents : [];
  const visible = events.filter(event => event && event.visibility !== 'hidden');
  const local = visible.filter(event => event.visibility === 'local' && (!event.locationId || event.locationId === currentLocationId)).slice(-8);
  const global = visible.filter(event => event.visibility !== 'local' && (!event.locationId || event.locationId === currentLocationId)).slice(-8);
  const selected = [...global, ...local].filter((event, index, list) => list.findIndex(item => item.eventId === event.eventId) === index);
  if (!selected.length) return '';
  return '【已提交世界事件】\n以下事件已由服务端在成功回合后结算，只能视为已发生事实，不得跨存档引用：\n'
    + selected.map(event => {
      const consequences = Array.isArray(event.consequences) && event.consequences.length ? `；后果：${event.consequences.join('；')}` : '';
      const time = event.time ? `（${event.time.value} ${event.time.unit}）` : '';
      return `- ${event.title || event.eventId}${time}：${event.description || '（无公开描述）'}${consequences}`;
    }).join('\n');
}

function buildWorldEventMemoryPromptPart() {
  if (!worldModeActive()) return '';
  const save = currentWorldSave;
  const currentLocationId = save.state?.locationId || null;
  const memories = (Array.isArray(save.eventMemory) ? save.eventMemory : [])
    .filter(memory => memory && memory.visibility !== 'hidden'
      && (memory.visibility !== 'local' || !memory.locationId || memory.locationId === currentLocationId))
    .slice(-32);
  if (!memories.length) return '';
  return '【长期事件记忆】\n以下记忆只来自当前世界存档已提交的回合，带有来源 revision；不得跨世界或跨存档引用，也不得把记忆摘要当作未发生事实。\n'
    + memories.map(memory => {
      const entities = Array.isArray(memory.entityIds) && memory.entityIds.length ? `；实体：${memory.entityIds.join('、')}` : '';
      const time = memory.time ? `；时间：${memory.time.value} ${memory.time.unit}` : '';
      const location = memory.locationId ? `；地点：${memory.locationId}` : '';
      return `- ${memory.summary}${entities}${location}${time}（来源 revision ${memory.sourceRevision}）`;
    }).join('\n');
}

function buildWorldFactionPromptPart() {
  if (!worldModeActive()) return '';
  const world = currentWorldCard();
  const state = currentWorldSave?.state || {};
  const currentLocationId = state.locationId || null;
  const recentFactionIds = new Set((Array.isArray(state.worldEvents) ? state.worldEvents : []).slice(-32).map(event => event?.factionId).filter(Boolean));
  const definitions = (Array.isArray(world?.factions) ? world.factions : []).filter(faction => recentFactionIds.has(faction.id)
    || (Array.isArray(faction.actions) && faction.actions.some(action => !action?.trigger?.locationId || action.trigger.locationId === currentLocationId)));
  if (!definitions.length) return '';
  const states = state.factionStates && typeof state.factionStates === 'object' ? state.factionStates : {};
  return '【当前作用域派系】\n派系定义属于当前世界卡；动态状态属于当前存档，禁止跨世界或跨存档引用。\n' + definitions.map(faction => {
    const state = states[faction.id] || {};
    const goals = Array.isArray(state.goals) && state.goals.length ? state.goals : (Array.isArray(faction.goals) ? faction.goals : []);
    const resources = Array.isArray(faction.resources) ? faction.resources.map(resource => `${resource.id}=${state.resources?.[resource.id] ?? resource.initial ?? resource.min ?? 0}`).join(', ') : '';
    return [`ID: ${faction.id}`, `名称: ${faction.name || faction.id}`, faction.description, goals.length ? `目标: ${goals.join('；')}` : '', `关系: ${state.relation ?? 0}`, `影响力: ${state.influence ?? 0}`, resources ? `资源: ${resources}` : ''].filter(Boolean).join('\n');
  }).join('\n\n');
}

function buildWorldConflictPromptPart() {
  if (!worldModeActive()) return '';
  const world = currentWorldCard();
  const definitions = new Map((Array.isArray(world?.conflicts) ? world.conflicts : []).map(conflict => [conflict.id, conflict]));
  const states = currentWorldSave?.state?.conflicts && typeof currentWorldSave.state.conflicts === 'object' ? Object.values(currentWorldSave.state.conflicts) : [];
  if (!definitions.size && !states.length) return '';
  const lines = states.length ? states.map(state => {
    const definition = definitions.get(state.templateId);
    const actions = Array.isArray(state.availableActions) ? state.availableActions.join('、') : '';
    const participants = Array.isArray(state.participants) ? state.participants.map(item => {
      if (typeof item === 'string') return item;
      const hp = Number.isFinite(Number(item?.hp)) && Number.isFinite(Number(item?.maxHp)) ? ` HP=${item.hp}/${item.maxHp}` : '';
      const defense = Number.isFinite(Number(item?.defense)) ? ` 防御=${item.defense}` : '';
      return `${item?.id || ''}${hp}${defense}`.trim();
    }).filter(Boolean).join('、') : '';
    return `- ${state.id}：${definition?.label || state.templateId}，状态=${state.status || 'active'}，阶段=${state.phase || '未分阶段'}，第 ${state.round || 1} 轮${state.targetId ? `，目标=${state.targetId}` : ''}${participants ? `，参与者=${participants}` : ''}${actions ? `，可用行动=${actions}` : ''}${state.outcome ? `，结果=${state.outcome}` : ''}`;
  }).join('\n') : '（当前没有进行中的冲突）';
  const templates = [...definitions.values()].map(definition => {
    const actions = Array.isArray(definition.actions) ? definition.actions.map(action => {
      const check = action.check;
      const checkText = check ? ` [${check.roll}+${check.modifier?.bucket || 'none'}.${check.modifier?.id || 'none'} vs ${check.target}${check.damage ? `; damage ${check.damage.roll}` : ''}]` : '';
      return `${action.id}:${action.label}${checkText}`;
    }).join('、') : '';
    const phases = Array.isArray(definition.phases) ? definition.phases.map(phase => `${phase.id}:${phase.label}`).join('、') : '';
    const outcomes = Array.isArray(definition.outcomes) ? definition.outcomes.map(outcome => `${outcome.id}:${outcome.label}`).join('、') : '';
    return `- ${definition.id}（${definition.type || 'custom'}）：阶段=${phases || '无'}；行动=${actions || '无'}；结果=${outcomes || '无'}`;
  }).join('\n');
  const recentChecks = (Array.isArray(currentWorldSave?.receipts) ? currentWorldSave.receipts : [])
    .slice(-8).flatMap(receipt => Array.isArray(receipt?.conflictChecks) ? receipt.conflictChecks : [])
    .filter(check => states.some(state => state.id === check.conflictId));
  const checkLines = recentChecks.length
    ? '\n最近服务端判定：\n' + recentChecks.slice(-8).map(check => `- ${check.conflictId} ${check.type} ${check.actionId}：${check.check.total} vs ${check.check.target}，${check.check.success ? '成功' : '失败'}`).join('\n')
    : '';
  return `【冲突状态】\n冲突是当前世界存档独立拥有的状态，不得跨存档引用。只能使用已声明模板；生命周期只能 start（开始）、advance（推进一轮）或 end（以 declared outcome 结束），已结束冲突不可重开。战斗 action 的 check 由服务端掷骰并写回参与者 HP；social / stealth action 的 check 只记录技能判定结果，不读取或扣除 HP。AI 只选择 actionId 与必要的 targetId，不得伪造 HP、骰子或判定结果。\n当前状态：\n${lines}\n可用模板：\n${templates}${checkLines}`;
}

function buildWorldGrowthPromptPart() {
  if (!worldModeActive()) return '';
  const growth = currentWorldCard()?.playerCreation?.growth;
  if (!growth || typeof growth !== 'object') return '';
  const sources = (Array.isArray(growth.sources) ? growth.sources : []).map(source => `${source.id}:${source.label}`).join('、');
  const candidates = (Array.isArray(growth.candidates) ? growth.candidates : []).map(candidate => `${candidate.id}:${candidate.label}（${candidate.sourceId} → ${growthEffectLabel(candidate)}）`).join('、');
  const proposed = Array.isArray(currentWorldSave?.state?.growthCandidates) ? currentWorldSave.state.growthCandidates : [];
  const proposedText = proposed.length ? proposed.map(candidate => `${candidate.candidateId}（${candidate.sourceId}，待确认）`).join('、') : '（暂无）';
  const experiences = Array.isArray(currentWorldSave?.state?.experiences) ? currentWorldSave.state.experiences.slice(-8) : [];
  const experienceText = experiences.length ? experiences.map(item => `${item.title}：${item.summary}`).join('；') : '（暂无）';
  return `【成长候选与人物经历】\n成长来源属于当前世界卡，候选记录只属于当前存档；来源=${sources || '无'}。可提议候选=${candidates || '无'}。当前待确认=${proposedText}。已确认人物经历=${experienceText}。当剧情确实产生训练、学习、探索、关系或事件成果时，才在 rpg JSON 输出 growth:[{candidateId,sourceId,reason}]；这只是待确认候选，必须等待玩家确认后才会改变能力、特质、关系、阵营声望或身份；不得伪造 delta/value，也不得自行输出 accepted/rejected。`;
}

function buildWorldFailurePromptPart() {
  if (!worldModeActive()) return '';
  const failure = currentWorldCard()?.failure;
  const modes = Array.isArray(failure?.modes) ? failure.modes : [];
  const modeText = modes.length ? modes.map(mode => `${mode.id}:${mode.label || mode.id}${mode.terminal ? '（终止）' : ''}${mode.hpRatio !== undefined ? ` HP=${mode.hpRatio}` : ''}`).join('、') : '使用服务端内置安全模式';
  const current = currentWorldSave?.state?.failure;
  return `【失败与死亡规则】失败结算由服务端根据 WorldCard.failure 触发，AI 不得直接写入 state.failure、伪造 HP/骰子结果或绕过模式。可用模式：${modeText}。HP 降到 0 与冲突失败由服务端判定；当前失败状态：${current ? `${current.mode}/${current.status}` : '未触发'}。永久死亡后不得继续普通回合。`;
}

function buildWorldEndingPromptPart() {
  if (!worldModeActive()) return '';
  const ending = currentWorldCard()?.ending;
  const options = Array.isArray(ending?.endings) ? ending.endings.map(item => `${item.id}:${item.label || item.id}`).join('、') : 'player-choice:玩家主动结束';
  const current = currentWorldSave?.state?.ending;
  return `【开放式结局】世界卡不强制唯一结局，可用结局：${options}。AI 只能叙述候选结果，不得自行结束世界线或写入 state.ending；玩家必须通过界面明确确认，服务端才会提交结局。当前状态：${current ? `${current.endingId}/ended` : '进行中'}。`;
}

function buildRpgPromptPart() {
  if (mode !== 'rpg') return '';
  const parts = [];
  const rs = curRpgState();
  if (rs) {
    parts.push('【RPG 状态】' + `等级 ${rs.level}（经验 ${rs.exp}/${rs.expNext}），HP ${rs.hp}/${rs.maxHp}，MP ${rs.mp}/${rs.maxMp}，金币 ${rs.gold}，当前位置：${rs.location}`
      + (rs.buffs?.length ? `，状态效果：${rs.buffs.join('、')}` : ''));
    parts.push('【背包】' + (rs.inventory.length ? rs.inventory.map(i => `${i.name}×${i.count}${i.desc ? `（${i.desc}）` : ''}`).join('、') : '（空）'));
    if (worldModeActive()) {
      const economy = currentWorldCard()?.playerCreation?.economy;
      if (economy) {
        const rules = economy.inventory || {};
        const currencies = Array.isArray(economy.currencies) ? economy.currencies.map(currency => `${currency.id}=${rs.currencies?.[currency.id] ?? currency.initial ?? currency.min ?? 0}`).join('、') : '';
        const equipment = economy.equipment?.enabled !== false && Array.isArray(economy.equipment?.slots)
          ? economy.equipment.slots.map(slot => `${slot.id}=${rs.equipment?.[slot.id] || '空'}`).join('、') : '';
        parts.push('【物品 / 装备 / 经济规则】' + [
          rules.enabled === false ? '背包关闭' : `背包 ${rs.inventory.length}/${rules.maxSlots || '∞'} 格`,
          rules.maxWeight === undefined || rules.maxWeight === null ? '' : `最大重量 ${rules.maxWeight}`,
          currencies ? `货币：${currencies}` : '',
          equipment ? `装备位：${equipment}` : '',
        ].filter(Boolean).join('；') + '。只能使用世界卡声明的物品、装备位和货币，不能突破格数、堆叠或重量限制。');
      }
    }
    parts.push('【任务】' + (rs.quests.length ? rs.quests.map(x => `${x.title}${x.status === 'done' ? '（已完成）' : ''}`).join('、') : '（无）'));
    parts.push('【目标】' + (rs.goals?.length ? rs.goals.map(x => `${x.title}${x.status && x.status !== 'active' ? `（${x.status}）` : ''}`).join('、') : '（无）'));
    parts.push('【线索】' + (rs.leads?.length ? rs.leads.map(x => `${x.title}${x.status && x.status !== 'active' ? `（${x.status}）` : ''}`).join('、') : '（无）'));
    const deadlineObjectives = worldModeActive()
      ? [...(currentWorldSave.state?.goals || []), ...(currentWorldSave.state?.leads || [])]
      : [...(rs.goals || []), ...(rs.leads || [])];
    const deadlineText = deadlineObjectives.filter(item => item?.deadline && item.status === 'active' && Number.isFinite(item.deadline.value) && item.deadline.unit).map(item => `${item.title || item.id} 截止 ${item.deadline.value} ${item.deadline.unit}`).join('；');
    if (deadlineText) parts.push('【目标 / 线索时限】' + deadlineText);
    const mapCtx = buildMapContext();
    if (mapCtx) parts.push(mapCtx);
  }
  if (worldModeActive()) {
    const world = currentWorldCard();
    if (world) {
      const factLayerPrompt = buildWorldFactLayerPromptPart();
      if (factLayerPrompt) parts.push(factLayerPrompt);
      const worldTime = currentWorldSave.state?.time;
      if (worldTime) parts.unshift(`【世界时间】${worldTime.value} ${worldTime.unit}（每次正式回合由服务端推进，AI 不得直接篡改）`);
      parts.unshift('【当前世界卡】\n' + [
        `世界：${world.title || world.id}（v${world.version || 1}）`,
        world.summary || '',
        '位置协议：state.locationId 与 NPC locationId 只能使用已登记的稳定 locationId；地点名称只用于叙事，不得写入状态。',
        world.locations?.length ? '已登记地点：' + world.locations.map(x => `${x.name || x.id}（id: ${x.id}；${x.type || '地点'}）`).join('、') : '',
        currentWorldSave.opening ? '开局：' + currentWorldSave.opening : '',
      ].filter(Boolean).join('\n'));
      const player = currentWorldSave.player?.snapshot;
      if (player) parts.unshift('【世界存档中的玩家快照】\n' + Object.entries(player).filter(([k, v]) => k !== 'profileFields' && v != null && String(v).trim()).map(([k, v]) => `${k}：${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n'));
      const dynamicPlayer = currentWorldSave.state?.player;
      if (dynamicPlayer) parts.unshift('【当前玩家动态状态】\n' + ['attributes', 'skills', 'resources', 'traits', 'relations', 'identity', 'effects'].filter(key => dynamicPlayer[key] !== undefined).map(key => `${key}：${JSON.stringify(dynamicPlayer[key])}`).join('\n'));
      const derivedValues = evaluateWorldDerivedValues(world.playerCreation, dynamicPlayer);
      if (derivedValues.length) parts.unshift('【当前玩家只读派生值】\n' + derivedValues.map(item => `${item.id}: ${item.value === null ? 'N/A' : item.value}`).join('\n') + '\n这些值由属性/技能/资源实时计算，仅供阅读，禁止写回 ```rpg``` 状态块。');
      const optionRules = worldOptionRules();
      parts.push(`【回合契约】行动选项数量 ${optionRules.min}-${optionRules.max}；自由文本输入始终可用。AI 不得替玩家补写未表达的核心意图、台词或不可逆行动。`);
      const npcPrompt = buildWorldNpcPromptPart();
      if (npcPrompt) parts.push(npcPrompt);
      const factionPrompt = buildWorldFactionPromptPart();
      if (factionPrompt) parts.push(factionPrompt);
      const eventPrompt = buildWorldEventPromptPart();
      if (eventPrompt) parts.push(eventPrompt);
      const eventMemoryPrompt = buildWorldEventMemoryPromptPart();
      if (eventMemoryPrompt) parts.push(eventMemoryPrompt);
      const conflictPrompt = buildWorldConflictPromptPart();
      if (conflictPrompt) parts.push(conflictPrompt);
      const failurePrompt = buildWorldFailurePromptPart();
      if (failurePrompt) parts.push(failurePrompt);
      const endingPrompt = buildWorldEndingPromptPart();
      if (endingPrompt) parts.push(endingPrompt);
      const growthPrompt = buildWorldGrowthPromptPart();
      if (growthPrompt) parts.push(growthPrompt);
    }
  }
  if (worldModeActive()) {
    const budgeted = budgetWorldPromptParts(parts);
    parts.length = 0;
    parts.push(...budgeted);
  }
  parts.push((defaults?.rpg?.stateInstruction) || '每次回复末尾输出包含 options 的 ```rpg``` JSON 状态块。');
  if (defaults?.rpg?.eventMemoryInstruction) parts.push(defaults.rpg.eventMemoryInstruction);
  return parts.join('\n\n');
}

function expandPresetMacros(text, macroContext, variables) {
  let output = String(text || '').replace(/\{\{\/\/[\s\S]*?\}\}/g, '');
  output = output.replace(/\{\{setvar::([^}:]+)::([\s\S]*?)\}\}/g, (_, key, value) => {
    variables[key.trim()] = value;
    return '';
  });
  output = output.replace(/\{\{getvar::([^}]+)\}\}/g, (_, key) => variables[key.trim()] ?? '');
  output = output.replace(/\{\{(user|char|persona|description|personality|scenario)\}\}/g, (_, key) => macroContext[key] ?? '');
  return output.replace(/\{\{trim\}\}/g, '').trim();
}

function mergeHistoryInjections(history, injections) {
  if (!injections.length) return history;
  const grouped = new Map();
  for (const item of injections) {
    const index = Math.max(0, history.length - Math.max(0, item.depth));
    if (!grouped.has(index)) grouped.set(index, []);
    grouped.get(index).push(item);
  }
  const roleOrder = { user: 0, assistant: 1 };
  const result = [];
  for (let i = 0; i <= history.length; i++) {
    const group = grouped.get(i) || [];
    group.sort((a, b) => a.order - b.order || roleOrder[a.role] - roleOrder[b.role]);
    result.push(...group.map(({ role, content }) => ({ role, content })));
    if (i < history.length) result.push(history[i]);
  }
  return result;
}

function buildPromptBlocks() {
  const char = currentChar();
  const promptChar = worldModeActive() ? null : char;
  const { preset: rawPreset } = resolvePromptPreset();
  const preset = normalizePromptPreset('', rawPreset);
  const wi = buildWorldInfo();
  const charParts = worldModeActive() ? { description: '', personality: '', scenario: '' } : buildCharacterPromptParts(promptChar);
  const userPart = worldModeActive() ? '' : buildUserPromptPart();
  const runtime = {
    worldInfoBefore: wi.length ? '【世界设定】\n' + wi.join('\n\n') : '',
    worldInfoAfter: '',
    personaDescription: userPart,
    charDescription: charParts.description,
    charPersonality: charParts.personality,
    scenario: charParts.scenario,
    tavernMemory: buildMemoryPromptPart(),
    tavernFormat: buildFormatPromptPart(),
    tavernRpg: buildRpgPromptPart(),
    dialogueExamples: promptChar?.mesExample || promptChar?.mes_example || '',
  };
  const macroContext = {
    user: currentUserPreset()?.name || '玩家',
    char: worldModeActive() ? (currentWorldCard()?.title || '世界') : (promptChar?.name || '角色'),
    persona: currentUserPreset()?.persona || '',
    description: charParts.description,
    personality: promptChar?.persona || '',
    scenario: promptChar?.scenario || '',
  };
  const variables = {};
  const promptMap = new Map(preset.prompts.map(p => [p.identifier, p]));
  const systemParts = [];
  const beforeHistory = [];
  const afterHistory = [];
  const injections = [];
  let includeHistory = false;
  let reachedHistory = false;

  for (const item of preset.promptOrder) {
    if (item.enabled === false) continue;
    const prompt = promptMap.get(item.identifier);
    if (!prompt) continue;
    if (prompt.identifier === 'chatHistory') {
      includeHistory = true;
      reachedHistory = true;
      continue;
    }
    let content = prompt.marker ? runtime[prompt.identifier] ?? prompt.content : prompt.content;
    if (prompt.identifier === 'main') {
      content = (mode === 'tavern' && promptChar?.systemPrompt?.trim()) || prompt.content || (mode === 'rpg' ? RPG_TASK_FALLBACK : settings.systemPrompt) || '';
    }
    if (prompt.identifier === 'jailbreak') content = promptChar?.postHistory?.trim() || prompt.content || settings.postHistory || '';
    content = expandPresetMacros(content, macroContext, variables);
    if (!content) continue;
    if (prompt.position === 'in_chat' && !prompt.marker) {
      if (prompt.role === 'system') systemParts.push(`【历史深度 ${prompt.depth} 的 System 指令】\n${content}`);
      else injections.push({ role: prompt.role, content, depth: prompt.depth, order: prompt.order });
    } else if (prompt.role === 'system' || prompt.marker) {
      systemParts.push(content);
    } else {
      (reachedHistory ? afterHistory : beforeHistory).push({ role: prompt.role, content });
    }
  }

  const recentContext = worldModeActive() ? buildWorldRecentContext() : null;
  let history = includeHistory
    ? (recentContext ? recentContext.messages : curMessages().slice(-Math.max(1, settings.history || 20)).filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({ role: m.role, content: m.content })))
    : [];
  if (mode === 'rpg' && defaults?.rpg?.exampleTurn) {
    const ex = defaults.rpg.exampleTurn;
    if (ex.user && ex.assistant) history.unshift({ role: 'user', content: ex.user }, { role: 'assistant', content: ex.assistant });
  }
  history = mergeHistoryInjections(history, injections);
  return { system: systemParts.join('\n\n'), wi, history: [...beforeHistory, ...history, ...afterHistory], post: '', worldInfoInSystem: true, recentContext };
}

/* ─────────── API ─────────── */
function buildPayload({ test = false } = {}) {
  const s = settings;
  if (!s.baseUrl) throw new Error('请先在设置 → 连接中填写 Base URL');
  const body = {
    model: s.model || 'default',
    temperature: s.temperature,
    max_tokens: test ? 16 : s.maxTokens,
    top_p: s.topP,
    frequency_penalty: s.frequencyPenalty,
    presence_penalty: s.presencePenalty,
    stream: test ? false : !!s.stream,
  };
  if (s.seed != null && s.seed >= 0) body.seed = s.seed;
  if (!test && prefs.cotEnabled) {
    body.thinking = { type: 'enabled' };
    body.reasoning_effort = prefs.cotEffort || 'low';
    body.max_tokens = Math.max(body.max_tokens || 1024, 2048); // 思维链模式需要更多生成预算
  }
  if (!test && prefs.stop && prefs.stop.trim()) {
    body.stop = prefs.stop.split(',').map(x => x.trim()).filter(Boolean);
  }
  if (test) {
    body.messages = [{ role: 'user', content: 'ping' }];
    return { baseUrl: s.baseUrl, apiKey: s.apiKey, body, wi: [] };
  }
  const { system, wi, history, post, worldInfoInSystem } = buildPromptBlocks();
  // 唯一 system 消息：身份 + 角色卡 + 模块 + 格式 + 世界设定 + 历史后指令 合并为一条，
  // 避免多条 system 穿插在 user/assistant 之间导致模型混淆 role 边界（DeepSeek/本地模型尤其敏感）
  const sysParts = [];
  if (system && system.trim()) sysParts.push(system);
  if (!worldInfoInSystem && wi && wi.length) sysParts.push('【世界设定】\n' + wi.join('\n\n'));
  if (post && post.trim()) sysParts.push('【历史后指令】\n' + post);
  body.messages = [];
  if (sysParts.length) body.messages.push({ role: 'system', content: sysParts.join('\n\n') });
  body.messages.push(...history);
  return { baseUrl: s.baseUrl, apiKey: s.apiKey, body, wi };
}

async function callAPI(payload) {
  const resp = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    // 错误兜底：json 解析失败时退回 text()（WebView/NanoHTTPD 兼容，保证错误一定可读）
    let msg = data?.error?.message || data?.error || `HTTP ${resp.status}`;
    if (!data?.error) {
      try { const t = await resp.text(); if (t) msg = `HTTP ${resp.status}: ${t.slice(0, 300)}`; } catch {}
    }
    throw new Error(msg);
  }
  return data;
}

async function callAPIStream(payload) {
  const resp = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const d = await resp.json().catch(() => ({}));
    throw new Error(d?.error?.message || `HTTP ${resp.status}`);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', content = '', cot = '';
  // 容错解析：兼容标准 SSE（data: + \n\n）、裸 JSON 行流、以及 stream 被忽略时的整体 JSON
  const consumeLine = (line) => {
    let data = line.trim();
    if (!data) return;
    if (data.startsWith('data:')) {
      data = data.slice(5).trim();
      if (!data || data === '[DONE]') return;
    }
    if (!data.startsWith('{')) return;
    try {
      const json = JSON.parse(data);
      const cotDelta = json?.choices?.[0]?.delta?.reasoning_content ?? json?.choices?.[0]?.message?.reasoning_content;
      if (cotDelta) cot += cotDelta;
      const delta = json?.choices?.[0]?.delta?.content ?? json?.choices?.[0]?.message?.content;
      if (delta) {
        content += delta;
        updateTypingContent(content);
      }
    } catch { /* 忽略不完整分块 */ }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of chunk.split('\n')) consumeLine(line);
    }
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      if (line.trim().startsWith('{')) {
        consumeLine(line);
        buf = buf.slice(nl + 1);
      } else break;
    }
  }
  if (buf.trim()) consumeLine(buf);
  return { content, cot };
}

/* 流式刷新：每帧最多渲染一次，避免逐 token 全量解析 */
let typingText = '';
let typingRaf = 0;
function updateTypingContent(text) {
  typingText = text;
  if (typingRaf) return;
  typingRaf = requestAnimationFrame(() => {
    typingRaf = 0;
    const t = $('typing-msg');
    const content = mode === 'rpg' ? splitRpgOutput(typingText).content : typingText;
    if (t) {
      const target = t.querySelector(mode === 'rpg' ? '.rpg-prose' : '.bubble');
      const rendered = renderBubble(content);
      target.innerHTML = rendered.html;
      target.classList.toggle('md', rendered.md);
    }
    const chat = $('chat');
    chat.scrollTop = chat.scrollHeight;
  });
}

async function fetchModels() {
  const out = $('test-result');
  readSettingsForm();
  if (!settings.baseUrl) {
    out.textContent = '❌ 请先填写 Base URL';
    out.className = 'err';
    return;
  }
  try {
    out.textContent = '正在获取模型列表…';
    out.className = '';
    const resp = await fetch('/api/models', {
      headers: { 'X-Base-Url': settings.baseUrl, 'X-Api-Key': settings.apiKey || '' },
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data?.error?.message || `HTTP ${resp.status}`);
    const ids = (data.data || []).map(m => m.id).filter(Boolean);
    if (!ids.length) throw new Error('上游未返回任何模型（请确认该服务支持 /models 端点）');
    const dl = $('model-list');
    dl.innerHTML = '';
    for (const id of ids) {
      const o = document.createElement('option');
      o.value = id;
      dl.appendChild(o);
    }
    if (!settings.model) {
      settings.model = ids[0];
      $('s-model').value = ids[0];
      saveSettings();
    }
    const preview = ids.slice(0, 3).join(', ') + (ids.length > 3 ? '…' : '');
    out.textContent = `✅ 获取到 ${ids.length} 个模型：${preview}`;
    out.className = 'ok';
  } catch (err) {
    out.textContent = `❌ 获取失败：${err.message}`;
    out.className = 'err';
  }
}

/* ─────────── 配置存档 Profile ─────────── */
const PROFILE_KEYS = ['preset', 'baseUrl', 'apiKey', 'model', 'temperature', 'maxTokens',
  'topP', 'frequencyPenalty', 'presencePenalty', 'seed', 'history', 'stream'];

function renderProfileSelect() {
  const sel = $('s-profile');
  const cur = sel.value;
  sel.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = '默认配置';
  sel.appendChild(opt0);
  for (const name of Object.keys(profiles)) {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = name;
    sel.appendChild(o);
  }
  if (cur && profiles[cur]) sel.value = cur;
}

function profileSwitch() {
  const name = $('s-profile').value;
  if (!name || !profiles[name]) return;
  settings = { ...settings, ...profiles[name] };
  saveSettings();
  fillSettingsForm();
  updateApiStatusFromSettings();
  const out = $('test-result');
  out.textContent = `✅ 已切换到「${name}」`;
  out.className = 'ok';
}

function profileSave() {
  readSettingsForm();
  const name = prompt('为新配置存档命名：', '配置 ' + (Object.keys(profiles).length + 1));
  if (!name) return;
  const snap = {};
  for (const k of PROFILE_KEYS) snap[k] = settings[k];
  profiles[name] = snap;
  saveJSON(LS_PROFILES, profiles);
  renderProfileSelect();
  $('s-profile').value = name;
  const out = $('test-result');
  out.textContent = `✅ 已存档「${name}」`;
  out.className = 'ok';
}

function profileDelete() {
  const name = $('s-profile').value;
  if (!name || !profiles[name]) return;
  if (!confirm(`删除配置存档「${name}」？`)) return;
  delete profiles[name];
  saveJSON(LS_PROFILES, profiles);
  renderProfileSelect();
  const out = $('test-result');
  out.textContent = '已删除';
  out.className = 'ok';
}

/* ─────────── 设置面板 ─────────── */
function fillSettingsForm() {
  const s = settings;
  $('s-preset').value = s.preset || '';
  $('s-base-url').value = s.baseUrl || '';
  $('s-api-key').value = s.apiKey || '';
  $('s-model').value = s.model || '';
  $('s-temperature').value = s.temperature;
  $('s-temp-val').textContent = s.temperature;
  $('s-max-tokens').value = s.maxTokens;
  $('s-top-p').value = s.topP;
  $('s-top-p-val').textContent = s.topP;
  $('s-freq-p').value = s.frequencyPenalty;
  $('s-pres-p').value = s.presencePenalty;
  $('s-seed').value = s.seed;
  $('s-history').value = s.history;
  $('s-stream').checked = !!s.stream;
  // 格式偏好
  $('f-preset').value = prefs.formatPreset || '';
  $('f-custom').value = prefs.formatCustom || '';
  $('f-stop').value = prefs.stop || '';
  $('s-cot').checked = !!prefs.cotEnabled;
  $('s-cot-effort').value = prefs.cotEffort || 'medium';
  // 文生图（测试）
  const ig = s.imageGen || {};
  $('ig-enabled').checked = !!ig.enabled;
  $('ig-kind').value = ig.kind || 'openai';
  $('ig-base-url').value = ig.baseUrl || '';
  $('ig-api-key').value = ig.apiKey || '';
  $('ig-model').value = ig.model || '';
  $('ig-size').value = ig.size || '1024x1024';
  $('ig-steps').value = ig.steps || 20;
  $('ig-cfg').value = ig.cfgScale || 7;
  $('ig-sampler').value = ig.sampler || '';
  $('ig-negative').value = ig.negativePrompt || '';
  $('ig-prompt-suffix').value = ig.promptSuffix || '';
  $('ig-negative-suffix').value = ig.negativeSuffix || '';
  $('ig-prompt-source').value = ig.promptSource || 'llm';
  $('ig-auto').checked = !!ig.auto;
  $('ig-ref-use').checked = !!ig.refUse;
  $('ig-ref-strength').value = ig.refStrength || 0.5;
  $('ig-prompt-instr').value = ig.promptInstruction || '';
}

function readSettingsForm() {
  settings.preset = $('s-preset').value;
  settings.baseUrl = $('s-base-url').value.trim();
  settings.apiKey = $('s-api-key').value.trim();
  settings.model = $('s-model').value.trim();
  settings.temperature = parseFloat($('s-temperature').value) || 0.9;
  settings.maxTokens = parseInt($('s-max-tokens').value, 10) || 1024;
  settings.topP = parseFloat($('s-top-p').value) ?? 1;
  settings.frequencyPenalty = parseFloat($('s-freq-p').value) || 0;
  settings.presencePenalty = parseFloat($('s-pres-p').value) || 0;
  settings.seed = parseInt($('s-seed').value, 10);
  settings.history = parseInt($('s-history').value, 10) || 20;
  settings.stream = $('s-stream').checked;
  prefs.formatPreset = $('f-preset').value;
  prefs.formatCustom = $('f-custom').value;
  prefs.stop = $('f-stop').value;
  prefs.cotEnabled = $('s-cot').checked;
  prefs.cotEffort = $('s-cot-effort').value || 'medium';
  // 文生图（测试）
  const ig = settings.imageGen = settings.imageGen || {};
  ig.enabled = $('ig-enabled').checked;
  ig.kind = $('ig-kind').value;
  ig.baseUrl = $('ig-base-url').value.trim();
  ig.apiKey = $('ig-api-key').value.trim();
  ig.model = $('ig-model').value.trim();
  ig.size = $('ig-size').value;
  ig.steps = parseInt($('ig-steps').value, 10) || 20;
  ig.cfgScale = parseFloat($('ig-cfg').value) || 7;
  ig.sampler = $('ig-sampler').value.trim();
  ig.negativePrompt = $('ig-negative').value.trim();
  ig.promptSuffix = $('ig-prompt-suffix').value;
  ig.negativeSuffix = $('ig-negative-suffix').value;
  ig.promptSource = $('ig-prompt-source').value;
  ig.auto = $('ig-auto').checked;
  ig.refUse = $('ig-ref-use').checked;
  ig.refStrength = parseFloat($('ig-ref-strength').value) || 0.5;
  ig.promptInstruction = $('ig-prompt-instr').value;
  saveSettings();
  saveJSON(LS_PREFS, prefs);
}

function setApiStatus(text, isErr = false) {
  const el = $('api-status');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('ok', !isErr && !!settings.baseUrl);
}

function openSettings() {
  fillSettingsForm();
  renderProfileSelect();
  $('settings-modal').classList.remove('hidden');
}

function closeSettings() {
  $('settings-modal').classList.add('hidden');
  $('test-result').textContent = '';
  $('test-result').className = '';
  updateApiStatusFromSettings();
}

function updateApiStatusFromSettings() {
  const s = settings;
  if (!s.baseUrl) return setApiStatus('尚未接上 API → 点头部「🏮」→ 设置');
  const who = s.model ? `${s.model}` : '（模型未填）';
  setApiStatus(`已接上：${s.baseUrl} · ${who}`);
}

/* ─────────── 调试终端：当前会话最近一次 AI 输入 / 原始输出 ─────────── */
function setDebugTrace(session, patch) {
  if (!session) return;
  debugTraces.set(session.id, { ...(debugTraces.get(session.id) || {}), ...patch });
  if (session === activeConversationScope()) renderDebugTerminal();
}

function renderDebugTerminal() {
  const session = activeConversationScope();
  const trace = session && debugTraces.get(session.id);
  const scope = $('debug-scope');
  if (!scope) return;
  scope.textContent = session
    ? `${worldModeActive() ? (currentWorldCard()?.title || '世界') : (currentChar()?.name || '未命名角色')} · ${worldModeActive() ? '世界存档' : (session.kind === 'rpg' ? 'RPG' : '酒馆')} · ${session.name || session.id}${trace?.commandId ? ` · ${trace.commandId}` : ''}${trace?.status ? ` · ${trace.status}` : ''}`
    : '当前会话 · 暂无记录';
  $('debug-input').textContent = trace?.input || '尚未向 AI 发送请求。';
  $('debug-output').textContent = trace?.output || '尚未收到 AI 响应。';
  renderDebugMemory();
}

function renderDebugMemory() {
  const pre = $('debug-memory');
  const button = $('debug-memory-rebuild');
  if (!pre || !button) return;
  if (!worldModeActive()) {
    pre.textContent = '仅世界存档提供派生记忆诊断。';
    button.disabled = true;
    return;
  }
  button.disabled = false;
  const saveId = currentWorldSaveId;
  const diagnostics = debugMemoryDiagnostics.get(saveId);
  if (diagnostics && diagnostics.revision !== currentWorldSave?.revision) {
    debugMemoryDiagnostics.delete(saveId);
    return renderDebugMemory();
  }
  if (!diagnostics) {
    pre.textContent = '正在读取当前存档的记忆来源…';
    loadDebugMemoryDiagnostics(saveId);
    return;
  }
  pre.textContent = JSON.stringify(diagnostics, null, 2);
}

async function loadDebugMemoryDiagnostics(saveId = currentWorldSaveId) {
  if (!saveId || !worldModeActive() || saveId !== currentWorldSaveId || debugMemoryDiagnostics.has(saveId) || debugMemoryPending.has(saveId)) return;
  debugMemoryPending.add(saveId);
  try {
    const res = await fetch('/api/world-saves/' + encodeURIComponent(saveId) + '/memory');
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(worldApiError(data, '记忆诊断读取失败（HTTP ' + res.status + '）'));
    if (worldModeActive() && currentWorldSaveId === saveId) {
      debugMemoryDiagnostics.set(saveId, data);
      renderDebugMemory();
    }
  } catch (err) {
    if (worldModeActive() && currentWorldSaveId === saveId) $('debug-memory').textContent = `读取失败：${err.message}`;
  } finally {
    debugMemoryPending.delete(saveId);
  }
}

async function rebuildDebugMemory() {
  if (!worldModeActive() || !currentWorldSave) return;
  if (!confirm('将用当前存档的正式事件与成长事实重建派生记忆；不会修改叙事、状态或世界卡。继续？')) return;
  const button = $('debug-memory-rebuild');
  const oldLabel = button.textContent;
  button.disabled = true;
  button.textContent = '重建中…';
  try {
    const saveId = currentWorldSave.id;
    const res = await fetch('/api/world-saves/' + encodeURIComponent(saveId) + '/memory/rebuild', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ commandId: 'memory-rebuild-' + uid(), expectedRevision: currentWorldSave.revision }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.save?.id) throw new Error(worldApiError(data, '派生记忆重建失败（HTTP ' + res.status + '）'));
    if (currentWorldSaveId === saveId) {
      hydrateWorldSave(data.save);
      currentWorldSave = data.save;
      debugMemoryDiagnostics.set(saveId, data.diagnostics);
      renderRPG();
      renderMessages();
      renderDebugMemory();
    }
  } catch (err) {
    $('debug-memory').textContent = `重建失败：${err.message}`;
  } finally {
    button.disabled = false;
    button.textContent = oldLabel;
  }
}

function openDebugTerminal() {
  const panel = $('debug-panel');
  if (!panel.open) panel.showModal();
  $('btn-debug').setAttribute('aria-expanded', 'true');
  renderDebugTerminal();
  $('debug-close').focus();
}

function closeDebugTerminal() {
  const panel = $('debug-panel');
  if (panel.open) panel.close();
  $('btn-debug').setAttribute('aria-expanded', 'false');
  $('btn-debug').focus();
}

function clearDebugTerminal() {
  const session = activeConversationScope();
  if (session) debugTraces.delete(session.id);
  if (worldModeActive()) debugMemoryDiagnostics.delete(currentWorldSaveId);
  renderDebugTerminal();
}

function copyDebugTerminal() {
  const session = activeConversationScope();
  const trace = session && debugTraces.get(session.id);
  if (!trace) return;
  const memory = worldModeActive() ? ($('debug-memory')?.textContent || '') : '';
  const text = `INPUT\n${trace.input || ''}\n\nOUTPUT\n${trace.output || ''}${memory ? `\n\nMEMORY\n${memory}` : ''}`;
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard')))
    .catch(() => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); });
}

async function testConnection() {
  const out = $('test-result');
  readSettingsForm();
  try {
    out.textContent = '正在测试…';
    out.className = '';
    const data = await callAPI(buildPayload({ test: true }));
    const reply = data?.choices?.[0]?.message?.content;
    out.textContent = `✅ 连接成功！模型响应：${(reply || '(空)').slice(0, 40)}`;
    out.className = 'ok';
    updateApiStatusFromSettings();
  } catch (err) {
    out.textContent = `❌ 连接失败：${err.message}`;
    out.className = 'err';
  }
}

function exportSettings() {
  readSettingsForm();
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tavern-settings.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importSettingsFromText(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error('不是合法的 JSON'); }
  if (!obj || typeof obj !== 'object') throw new Error('配置格式不正确');
  settings = { ...DEFAULT_SETTINGS, ...settings, ...obj };
  saveSettings();
  fillSettingsForm();
  updateApiStatusFromSettings();
}

function importSettings() {
  const out = $('test-result');
  const text = prompt('粘贴要导入的配置 JSON（也可双击「导入配置」选择文件）');
  if (text === null) return;
  try { importSettingsFromText(text); out.textContent = '✅ 配置已导入'; out.className = 'ok'; }
  catch (err) { out.textContent = `❌ 导入失败：${err.message}`; out.className = 'err'; }
}

function importSettingsFromFile(file) {
  const out = $('test-result');
  const reader = new FileReader();
  reader.onload = () => {
    try { importSettingsFromText(reader.result); out.textContent = '✅ 配置已导入'; out.className = 'ok'; }
    catch (err) { out.textContent = `❌ 导入失败：${err.message}`; out.className = 'err'; }
  };
  reader.readAsText(file);
}

/* ─────────── 聊天渲染 ─────────── */

/* 消息操作按钮（编辑/删除/重生成/复制） */
function attachMsgActions(el, m, opts) {
  const wrap = document.createElement('div');
  wrap.className = 'msg-actions';
  const btns = opts || {};
  if (btns.regen) {
    const b = document.createElement('button');
    b.className = 'ma-btn'; b.title = '重新生成'; b.setAttribute('aria-label', b.title); b.textContent = '🔄';
    b.addEventListener('click', (e) => { e.stopPropagation(); regenAssistant(m); });
    wrap.appendChild(b);
  }
  if (btns.edit) {
    const b = document.createElement('button');
    b.className = 'ma-btn'; b.title = '编辑'; b.setAttribute('aria-label', b.title); b.textContent = '✏️';
    b.addEventListener('click', (e) => { e.stopPropagation(); editMessage(m); });
    wrap.appendChild(b);
  }
  if (btns.copy) {
    const b = document.createElement('button');
    b.className = 'ma-btn'; b.title = '复制'; b.setAttribute('aria-label', b.title); b.textContent = '⧉';
    b.addEventListener('click', (e) => { e.stopPropagation(); copyMessage(m); });
    wrap.appendChild(b);
  }
  if (btns.del) {
    const b = document.createElement('button');
    b.className = 'ma-btn'; b.title = '删除'; b.setAttribute('aria-label', b.title); b.textContent = '🗑';
    b.addEventListener('click', (e) => { e.stopPropagation(); deleteMessage(m); });
    wrap.appendChild(b);
  }
  if (wrap.children.length) el.appendChild(wrap);
}

/* 消息操作实现 */
function editMessage(m) {
  m._editing = true;
  renderMessages();
  const ta = $('edit-msg');
  if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}
function saveEdit(m) {
  const ta = $('edit-msg');
  if (ta) m.content = ta.value;
  delete m._editing;
  if (worldModeActive()) queueWorldSave(currentWorldSave); else saveSessions();
  renderMessages();
}
function cancelEdit(m) {
  delete m._editing;
  renderMessages();
}
function deleteMessage(m) {
  if (worldModeActive()) {
    if (m._opening) return;
    if (!confirm('删除这条消息？')) return;
    const i = (currentWorldSave.turns || []).indexOf(m);
    if (i < 0) return;
    currentWorldSave.turns.splice(i, 1);
    queueWorldSave(currentWorldSave);
    renderMessages();
    return;
  }
  const s = curSession();
  if (!s) return;
  const i = s.messages.indexOf(m);
  if (i < 0) return;
  if (!confirm('删除这条消息？')) return;
  s.messages.splice(i, 1);
  saveSessions();
  renderMessages();
}
function copyMessage(m) {
  const text = m.content || '';
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard')))
    .then(() => { /* 复制成功 */ })
    .catch(() => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); });
}
/* 重新生成：删除该条 assistant 及之后，用现有历史重新请求 */
async function regenAssistant(m) {
  if (worldModeActive()) {
    if (m._opening || sending) return;
    const i = (currentWorldSave.turns || []).indexOf(m);
    if (i < 0 || currentWorldSave.turns[i].role !== 'assistant') return;
    currentWorldSave.turns = currentWorldSave.turns.slice(0, i);
    queueWorldSave(currentWorldSave);
    renderMessages();
    await requestReply();
    return;
  }
  const s = curSession();
  if (!s || sending) return;
  const i = s.messages.indexOf(m);
  if (i < 0 || s.messages[i].role !== 'assistant') return;
  s.messages = s.messages.slice(0, i);
  saveSessions();
  renderMessages();
  await requestReply();
}

/* 编辑模式渲染：消息内容替换为 textarea */
function renderEditBubble(m, className = 'bubble edit-bubble') {
  return `<div class="${className}"><textarea id="edit-msg" rows="4">${esc(m.content)}</textarea><div class="edit-actions"><button class="btn gold small" data-edit-save>保存</button><button class="ghost-btn small" data-edit-cancel>取消</button></div></div>`;
}

function renderMessages() {
  const chat = $('chat');
  renderDebugTerminal();
  chat.innerHTML = '';
  if (mode === 'rpg') renderRPG(); // RPG 模式联动状态面板
  const msgs = curMessages();
  renderQuickActions(); // 从当前会话最后一条 AI 回复恢复选项，切换会话不串线
  const ended = mode === 'rpg' && worldModeActive() && currentWorldSave?.state?.ending?.status === 'ended';
  const input = $('input');
  const sendButton = $('btn-send');
  if (input) { input.disabled = ended; input.placeholder = ended ? '世界线已结束，创建新存档后继续…' : '写下你的话或行动（可用 *动作* 表示）… Enter 发送 · Shift+Enter 换行'; }
  if (sendButton && !sending) sendButton.disabled = ended;
  if (!msgs.length) {
    chat.innerHTML = `<div class="chat-empty"><div class="ce-icon">🐾</div><div class="ce-title">${esc(emptyTitle())}</div><div class="ce-desc">${esc(buildGuide())}</div></div>`;
    return;
  }
  for (const m of msgs) {
    // 文生图图片消息
    if (m.role === 'image') {
      const imgEl = document.createElement('div');
      imgEl.className = 'msg image-msg';
      imgEl.innerHTML = `<div class="bubble img-bubble"><img src="${esc(m.content)}" alt="生成图" loading="lazy" /></div><button class="regen-btn" title="用同一提示词重新生成">🔄 重新生成</button>`;
      const img = imgEl.querySelector('img');
      if (img) {
        img.style.cursor = 'zoom-in';
        img.addEventListener('click', () => openLightbox(m.content));
        img.onerror = () => {
          imgEl.innerHTML = '<div class="bubble img-bubble img-fail">🖼 图片加载失败（文件可能已删除或不可访问）</div>';
        };
      }
      const btn = imgEl.querySelector('.regen-btn');
      if (btn) btn.addEventListener('click', () => regenImage(m));
      attachMsgActions(imgEl, m, { copy: true, del: true });
      chat.appendChild(imgEl);
      continue;
    }
    // AI 回复：RPG 是连续叙事；酒馆才按引号拆分「旁白行 + 角色气泡」。
    if (m.role === 'assistant') {
      // 思维链独立呈现（旁白样式），不占用角色气泡
      if (m.cot) {
        const cotEl = document.createElement('div');
        cotEl.className = 'msg cot-msg';
        cotEl.innerHTML = `<div class="nar-icon">🧠</div><div class="bubble"><details class="cot"><summary>🧠 思维链</summary><pre>${esc(m.cot)}</pre></details></div>`;
        chat.appendChild(cotEl);
      }
      if (mode === 'rpg') {
        const el = document.createElement('article');
        el.className = 'msg rpg-narrative';
        if (m._editing) {
          el.innerHTML = renderEditBubble(m, 'rpg-prose rpg-prose-editor');
          const sb = el.querySelector('[data-edit-save]');
          const cb = el.querySelector('[data-edit-cancel]');
          if (sb) sb.addEventListener('click', () => saveEdit(m));
          if (cb) cb.addEventListener('click', () => cancelEdit(m));
        } else {
          const { html, md } = renderBubble(m.content);
          el.innerHTML = `<div class="rpg-prose${md ? ' md' : ''}">${html}</div>`;
          attachMsgActions(el, m, m._opening ? { copy: true } : { regen: true, edit: true, copy: true, del: true });
        }
        chat.appendChild(el);
        continue;
      }
      const segs = splitNarration(m.content);
      segs.forEach((seg, si) => {
        const el = document.createElement('div');
        let html;
        if (m._editing) {
          el.className = 'msg assistant';
          el.innerHTML = renderEditBubble(m);
        } else {
          const { html: h, md } = renderBubble(seg.type === 'dialogue' ? seg.text.slice(1, -1) : seg.text);
          html = h;
          if (seg.type === 'narration') {
            el.className = 'msg narration';
            el.innerHTML = `<div class="nar-icon">✦</div><div class="bubble${md ? ' md' : ''}">${html}</div>`;
          } else {
            el.className = 'msg assistant';
            el.innerHTML = `<div class="avatar">${PAW_SVG}</div><div class="bubble${md ? ' md' : ''}">${html}</div>`;
          }
        }
        // 操作按钮只挂在第一段（整条消息共享操作）
        if (si === 0) {
          if (m._editing) {
            const sb = el.querySelector('[data-edit-save]');
            const cb = el.querySelector('[data-edit-cancel]');
            if (sb) sb.addEventListener('click', () => saveEdit(m));
            if (cb) cb.addEventListener('click', () => cancelEdit(m));
          } else {
            attachMsgActions(el, m, { regen: true, edit: true, copy: true, del: true });
          }
        }
        chat.appendChild(el);
      });
      // AI 回复选项已统一渲染在底部快捷行动栏（renderQuickActions），不再挂消息下方
      continue;
    }
    // 用户 / 系统消息（meta 消息：内部注入如掷骰结果，居中显示）
    const el = document.createElement('div');
    el.className = 'msg ' + (m.meta ? 'system' : m.role);
    if (m.role === 'user' && !m.meta && m._editing) {
      el.innerHTML = renderEditBubble(m);
      const sb = el.querySelector('[data-edit-save]');
      const cb = el.querySelector('[data-edit-cancel]');
      if (sb) sb.addEventListener('click', () => saveEdit(m));
      if (cb) cb.addEventListener('click', () => cancelEdit(m));
    } else {
      const avatar = (m.meta || m.role === 'system') ? '<span>❖</span>'
        : (m.role === 'user' ? '<span>🧑</span>' : PAW_SVG);
      const { html, md } = renderBubble(m.content);
      el.innerHTML = `<div class="avatar">${avatar}</div><div class="bubble${md ? ' md' : ''}">${html}</div>`;
      attachMsgActions(el, m,
        m.role === 'user' ? { edit: true, copy: true, del: true }
        : m.role === 'system' ? { copy: true, del: true }
        : { edit: true, copy: true, del: true });
    }
    chat.appendChild(el);
  }
  chat.scrollTop = chat.scrollHeight;
}

function pushMessage(role, content, extra) {
  if (worldModeActive()) {
    const msg = { id: uid(), role, content, ts: Date.now() };
    if (extra) Object.assign(msg, extra);
    if (worldTurnPendingActive()) {
      worldTurnPending.messages.push(msg);
      renderMessages();
      return;
    }
    currentWorldSave.turns = Array.isArray(currentWorldSave.turns) ? currentWorldSave.turns : [];
    currentWorldSave.turns.push(msg);
    queueWorldSave(currentWorldSave);
    renderMessages();
    renderSessions();
    return;
  }
  const s = curSession();
  if (!s) return;
  const msg = { role, content, ts: Date.now() };
  if (extra) Object.assign(msg, extra);
  s.messages.push(msg);
  saveSessions();
  renderMessages();
  renderSessions();
}

function addTyping() {
  const chat = $('chat');
  const el = document.createElement(mode === 'rpg' ? 'article' : 'div');
  el.className = mode === 'rpg' ? 'msg rpg-narrative typing' : 'msg assistant typing';
  el.id = 'typing-msg';
  el.innerHTML = mode === 'rpg'
    ? '<div class="rpg-prose">世界正在回应…</div>'
    : `<div class="avatar">${PAW_SVG}</div><div class="bubble">正在思索…</div>`;
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
}
function removeTyping() {
  const t = $('typing-msg');
  if (t) t.remove();
}

/* ─────────── 文生图（测试功能） ─────────── */
function igSettings() { return settings.imageGen || (settings.imageGen = {}); }

/* 聊天栏「正在生图」占位提示 */
function addImagePending() {
  const chat = $('chat');
  if (!chat || $('img-pending-msg')) return;
  const el = document.createElement('div');
  el.className = 'msg image-msg pending';
  el.id = 'img-pending-msg';
  el.innerHTML = '<div class="bubble img-bubble pending-bubble">🖼 正在生成图片…</div>';
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
}
function removeImagePending() {
  const t = $('img-pending-msg');
  if (t) t.remove();
}

/* 图片转 data URI：本地相对路径先 fetch 再转（中转服务端无法访问我们的 /images/ 相对路径） */
async function imageToDataUri(src) {
  if (!src) return src;
  if (src.startsWith('data:')) return src;
  if (src.startsWith('http://') || src.startsWith('https://')) return src; // 绝对 URL 直接给中转
  try {
    const r = await fetch(src);
    const blob = await r.blob();
    return await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(blob);
    });
  } catch (e) { return src; }
}

async function buildImageBody(ig, prompt, refImage) {
  // 约束后缀：无论提示词来源（LLM/剧情/手动）都自动附加，兽人禁人脸
  const fullPrompt = (prompt || '') + (ig.promptSuffix || '');
  const body = { prompt: fullPrompt };
  if (ig.kind === 'sd') {
    const [w, h] = (ig.size || '512x512').split('x').map(Number);
    body.width = w || 512;
    body.height = h || 512;
    body.steps = ig.steps || 20;
    body.cfg_scale = ig.cfgScale || 7;
    if (ig.sampler) body.sampler_name = ig.sampler;
    const neg = [ig.negativePrompt, ig.negativeSuffix].filter(Boolean)
      .map(s => s.replace(/^,\s*/, '').trim()).filter(Boolean).join(', ');
    if (neg) body.negative_prompt = neg;
    body.seed = -1;
    // 形象参考：SD 走 img2img（低重绘幅度 → 形象延续）
    if (ig.refUse && refImage) {
      body.init_images = [refImage];
      body.denoising_strength = ig.refStrength || 0.5;
    }
  } else {
    if (ig.model) body.model = ig.model;
    if (ig.size) body.size = ig.size;
    body.n = 1;
    // 形象参考：OpenAI 兼容中转（chatgpt2api 等）generations 白名单丢弃未知字段，
    // 参考图必须走 /images/edits（body.images 数组，服务端据此自动选端点）
    if (ig.refUse && refImage) {
      body.images = [await imageToDataUri(refImage)];
      // 图生图引导：参考图 = 角色形象基准，生成「该角色在当前场景中」的画面；
      // 明确禁止输出角色设计图/立绘（否则 gpt-image 会把参考图当设计对象重绘）
      body.prompt = `Using the character in the reference image as the exact character design, show this same character acting in the following scene: ${fullPrompt} Do NOT output a character sheet, turnaround, or design diagram.`;
    }
    // 不发送 response_format：dall-e 系列默认返回 url；gpt-image 系列不接受该参数、总是返回 b64（解析端已兼容两者）
  }
  return body;
}

function parseImageSrc(data) {
  if (!data) return null;
  if (Array.isArray(data.data) && data.data[0]) {
    const it = data.data[0];
    return it.b64_json ? 'data:image/png;base64,' + it.b64_json : (it.url || null);
  }
  if (Array.isArray(data.images) && data.images[0]) {
    return 'data:image/png;base64,' + data.images[0]; // SD WebUI
  }
  return null;
}

/* 生图请求（120s 超时防挂起）；refImage = 角色形象参考图 */
async function callImageAPI(ig, prompt, refImage) {
  if (!ig.baseUrl) throw new Error('请先在 设置 → 文生图 中填写 Base URL');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch('/api/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      signal: ctrl.signal,
      body: JSON.stringify({ baseUrl: ig.baseUrl, apiKey: ig.apiKey, kind: ig.kind || 'openai', body: await buildImageBody(ig, prompt, refImage) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data && data.error && (data.error.message || data.error)) || ('生图 API 返回 ' + res.status);
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    const src = parseImageSrc(data);
    if (!src) throw new Error('响应中没有图片字段（期望 data[].url / data[].b64_json / images[]）— 原始响应: ' + JSON.stringify(data).slice(0, 160));
    return src;
  } finally {
    clearTimeout(timer);
  }
}

/* LLM 生成生图提示词（走 /api/chat 代理，复用对话配置；60s 超时防挂起） */
async function llmImagePrompt(ig, story) {
  const instr = ig.promptInstruction || '根据以下剧情输出英文文生图提示词：';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      signal: ctrl.signal,
      body: JSON.stringify({
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        body: {
          model: settings.model || 'default',
          messages: [
            { role: 'system', content: instr },
            { role: 'user', content: story },
          ],
          temperature: 0.8,
          max_tokens: 300,
          stream: false,
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.choices || !data.choices[0]) throw new Error('提示词生成失败（对话 API 未配置？）');
    return data.choices[0].message.content.trim();
  } finally {
    clearTimeout(timer);
  }
}

/* 图片本地化：data URI / http url → server 保存到 public/images/ → 返回 /images/xxx.png（刷新不丢） */
async function saveImageLocally(src) {
  if (!src) return src;
  if (src.startsWith('/images/')) return src; // 已是本地路径
  const res = await fetch('/api/image-save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(src.startsWith('data:') ? { b64: src } : { url: src }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.path) throw new Error('图片本地保存失败: ' + (data.error || res.status));
  return data.path;
}

/* 点击图片放大查看（lightbox）：点遮罩关闭，点图片切换 适应窗口 / 原始尺寸（可滚动） */
let lightboxEl = null;
function openLightbox(src, caption) {
  if (!lightboxEl) {
    lightboxEl = document.createElement('div');
    lightboxEl.className = 'lightbox hidden';
    lightboxEl.innerHTML = '<div class="lightbox-tools">'
      + '<button class="lb-btn" data-act="fit">🖼 适应窗口</button>'
      + '<button class="lb-btn" data-act="orig">🔍 原始尺寸</button>'
      + '<span class="lb-hint">或点击图片切换</span>'
      + '</div>'
      + '<div class="lightbox-cap" hidden></div>'
      + '<img alt="大图" />';
    lightboxEl.addEventListener('click', (e) => {
      const act = e.target.dataset && e.target.dataset.act;
      const img = lightboxEl.querySelector('img');
      if (act === 'fit') { img.classList.remove('zoomed'); img.classList.add('fit'); lightboxEl.scrollTop = 0; return; }
      if (act === 'orig') { img.classList.add('zoomed'); img.classList.remove('fit'); lightboxEl.scrollTop = 0; return; }
      if (e.target === lightboxEl) { closeLightbox(); return; } // 点遮罩关闭
      img.classList.toggle('zoomed'); // 点图片切换缩放
      img.classList.remove('fit');
      lightboxEl.scrollTop = 0;
    });
    document.body.appendChild(lightboxEl);
  }
  const img = lightboxEl.querySelector('img');
  img.src = src;
  img.classList.remove('zoomed');
  img.classList.add('fit');
  const cap = lightboxEl.querySelector('.lightbox-cap');
  if (cap) { cap.textContent = caption || ''; cap.hidden = !caption; }
  lightboxEl.scrollTop = 0;
  lightboxEl.classList.remove('hidden');
}
function closeLightbox() { if (lightboxEl) lightboxEl.classList.add('hidden'); }

/* 地图查看原图：优先当前可见源（窗口美化图 → 预览美化图 → 窗口画布 → 预览画布 → 高清重渲），
 * 无 mapData 也不静默失效；标题取 mm-info 当前内容首行 */
function zoomMap() {
  let src = null;
  const mmBeauty = $('mm-beauty'), mmImg = $('mm-beauty-img');
  const beauty = $('map-beauty'), bImg = $('map-beauty-img');
  if (mmBeauty && !mmBeauty.hidden && mmImg && mmImg.src) src = mmImg.src;
  else if (beauty && !beauty.hidden && bImg && bImg.src) src = bImg.src;
  if (!src) {
    const map = curMapData();
    const canvas = $('mm-canvas') || $('map-canvas');
    if (map && window.MapGen) {
      const c = document.createElement('canvas');
      window.MapGen.renderWorldMap(c, map, { pixelSize: 12 }); // 高清重渲（128×12=1536px）
      src = c.toDataURL('image/png');
    } else if (canvas && canvas.toDataURL) {
      src = canvas.toDataURL('image/png'); // 兜底：直接取当前画布
    }
  }
  const info = $('mm-info');
  const caption = info && info.innerText ? info.innerText.split('\n')[0].trim() : '';
  if (src) openLightbox(src, caption);
}

/* 查看生图参考图（带地形标记：山脉▲/森林树/湿地波纹）——用于确认 AI 收到的标注图 */
function showMapRef() {
  const map = curMapData();
  if (!map || !window.MapGen) return;
  const c = document.createElement('canvas');
  window.MapGen.renderWorldMap(c, map, { pixelSize: 12, markers: true, labels: 'bold' });
  openLightbox(c.toDataURL('image/png'), '生图参考图（标注：山脉/森林/湿地）');
}

/* 地图数据 JSON 查看：结构化导出（区域/路径点/邻接/网格统计），不包含全量 grid */
let lastMapJson = '';
function buildMapJson() {
  const map = curMapData();
  if (!map) return null;
  let land = 0, ocean = 0;
  for (let i = 0; i < map.grid.length; i++) { if (map.grid[i]) land++; else ocean++; }
  return {
    engine: map.engine, seed: map.seed, size: map.size,
    regions: map.regions.map(r => ({ id: r.id, name: r.name, biome: r.biome, seedX: r.seedX, seedY: r.seedY })),
    points: map.points.map(p => ({ name: p.name, type: p.type, x: p.x, y: p.y, regionId: p.regionId, desc: p.desc })),
    adjacency: map.adjacency,
    gridStats: { landPx: land, oceanPx: ocean, total: map.size * map.size, regions: map.regions.length },
  };
}
function showMapJson() {
  const data = buildMapJson();
  if (!data) return;
  lastMapJson = JSON.stringify(data, null, 2);
  const pre = $('map-json-content');
  if (pre) pre.textContent = lastMapJson;
  const mj = $('map-json-modal');
  if (mj) mj.classList.remove('hidden');
}
function copyMapJson() {
  const data = buildMapJson();
  const txt = data ? JSON.stringify(data, null, 2) : lastMapJson;
  if (!txt) return;
  navigator.clipboard.writeText(txt).then(
    () => alert('✅ 地图数据 JSON 已复制'),
    () => alert('复制失败（浏览器剪贴板权限）')
  );
}

/* 生图并作为图片消息上屏 */
async function generateImageFor(story) {
  const ig = igSettings();
  if (!ig.enabled || !ig.baseUrl) return;
  const targetKey = activeConversationKey();
  const targetTurnEpoch = worldModeActive() ? worldTurnEpoch : null;
  const status = $('ig-test-result');
  if (status) status.textContent = '⏳ 正在生成图片…';
  addImagePending(); // 聊天栏占位提示：开始生图
  try {
    const char = worldModeActive() ? (currentWorldSave.player?.snapshot || null) : currentChar();
    const refImage = (char && char.refImage) ? char.refImage : null;
    let prompt;
    if (ig.promptSource === 'story') {
      prompt = story;
    } else {
      try { prompt = await llmImagePrompt(ig, story); }
      catch (e) { console.warn('[Tavern] LLM 提示词生成失败，回退用剧情文本:', e.message); prompt = story; }
    }
    // 角色形象 + 当前场景统一：把角色外貌与场景描述注入提示词（图生图与对话场景一致）
    if (char) {
      const look = [char.race, char.persona].filter(Boolean).join('，').slice(0, 150);
      const scene = (char.scenario && char.scenario.trim()) ? `当前场景：${char.scenario.trim()}` : '';
      prompt = `角色形象：${char.name || ''}（${look}）。${scene}保持一致的形象设定。${prompt}`;
    }
    console.info('[Tavern] 🖼 生图提示词', prompt.slice(0, 120),
      '| 参考图:', refImage ? ('有(' + refImage.slice(0, 40) + ')') : '无',
      '| refUse:', ig.refUse,
      '| 端点:', (ig.refUse && refImage) ? (ig.kind === 'sd' ? 'img2img' : '/images/edits') : (ig.kind === 'sd' ? 'txt2img' : '/images/generations'));
    const src = await callImageAPI(ig, prompt, refImage);
    removeImagePending();
    let local = src;
    try { local = await saveImageLocally(src); } // 存本地，刷新不丢
    catch (e) { console.warn('[Tavern] 图片本地保存失败，本轮仍显示:', e.message); }
    if (activeConversationKey() !== targetKey || (worldModeActive() && targetTurnEpoch !== worldTurnEpoch)) return;
    pushMessage('image', local, { imgPrompt: prompt }); // 记住提示词，供「重新生成」复用
    if (status) status.textContent = '✅ 图片已生成并显示在聊天栏';
  } catch (err) {
    console.error('[Tavern] 文生图失败:', err.message);
    removeImagePending();
    if (status) status.textContent = '❌ ' + err.message;
    if (activeConversationKey() === targetKey && (!worldModeActive() || targetTurnEpoch === worldTurnEpoch)) pushMessage('system', `⚠️ 文生图失败：${err.message}`);
  }
}

/* 测试按钮：用测试提示词直接生图 */
async function testImageGen() {
  const ig = igSettings();
  const prompt = ($('ig-test-prompt').value || '').trim() || 'a fox knight in a tavern, anime style';
  const status = $('ig-test-result');
  const targetKey = activeConversationKey();
  if (status) status.textContent = '⏳ 正在生成测试图…';
  addImagePending();
  try {
    const char = worldModeActive() ? (currentWorldSave.player?.snapshot || null) : currentChar();
    const refImage = (char && char.refImage) ? char.refImage : null;
    // 测试按钮同样注入当前角色形象描述
    let p = prompt;
    if (char && (char.race || char.persona)) {
      const look = [char.race, char.persona].filter(Boolean).join('，').slice(0, 150);
      p = `角色形象：${char.name || ''}（${look}），保持一致的形象设定。${p}`;
    }
    const src = await callImageAPI(ig, p, refImage);
    removeImagePending();
    if (status) status.textContent = '✅ 成功（见聊天栏）';
    let local = src;
    try { local = await saveImageLocally(src); }
    catch (e) { console.warn('[Tavern] 图片本地保存失败，本轮仍显示:', e.message); }
    if (activeConversationKey() !== targetKey) return;
    pushMessage('image', local, { imgPrompt: prompt });
  } catch (err) {
    console.error('[Tavern] 文生图测试失败:', err.message);
    removeImagePending();
    if (status) status.textContent = '❌ ' + err.message;
  }
}

/* 重新生成：用同一提示词再次生图并替换该条图片消息 */
async function regenImage(msg) {
  const ig = igSettings();
  if (!ig.enabled || !ig.baseUrl) { pushMessage('system', '⚠️ 文生图未启用或未配置 Base URL'); return; }
  if (!msg.imgPrompt) { pushMessage('system', '⚠️ 该图片没有提示词记录（旧消息），无法重新生成'); return; }
  const targetKey = activeConversationKey();
  addImagePending();
  try {
    const refChar = worldModeActive() ? (currentWorldSave.player?.snapshot || null) : currentChar();
    const refImage = refChar?.refImage || null;
    const src = await callImageAPI(ig, msg.imgPrompt, refImage);
    removeImagePending();
    if (activeConversationKey() !== targetKey) return;
    let local = src;
    try { local = await saveImageLocally(src); }
    catch (e) { console.warn('[Tavern] 图片本地保存失败，本轮仍显示:', e.message); }
    msg.content = local;
    msg.ts = Date.now();
    if (worldModeActive()) queueWorldSave(currentWorldSave); else saveSessions();
    renderMessages();
  } catch (err) {
    console.error('[Tavern] 重新生成失败:', err.message);
    removeImagePending();
    pushMessage('system', `⚠️ 重新生成失败：${err.message}`);
  }
}

/* 核心请求：用当前历史请求一次回复（发送消息 / 重新生成共用） */
async function requestReply() {
  if (sending) return;
  const targetScope = activeConversationScope();
  if (!targetScope) return;
  const targetKey = activeConversationKey();
  sending = true;
  $('btn-send').disabled = true;
  addTyping();
  let cot = '';
  try {
    const payload = buildPayload();
    setDebugTrace(targetScope, {
      commandId: worldTurnPendingActive() ? worldTurnPending.commandId : null,
      status: '请求中',
      input: JSON.stringify({ endpoint: payload.baseUrl + '/chat/completions', ...payload.body }, null, 2),
      output: '等待 AI 响应…',
    });
    // 请求 / 响应日志输出到浏览器控制台
    console.debug('[Tavern] → 请求', payload.baseUrl + '/chat/completions', {
      model: payload.body.model,
      stream: payload.body.stream,
      temperature: payload.body.temperature,
      max_tokens: payload.body.max_tokens,
      thinking: payload.body.thinking,
      messages: payload.body.messages,
    });
    let reply;
    if (payload.body.stream) {
      const r = await callAPIStream(payload);
      reply = r.content;
      cot = r.cot;
    } else {
      const data = await callAPI(payload);
      reply = data?.choices?.[0]?.message?.content;
      cot = data?.choices?.[0]?.message?.reasoning_content || '';
    }
    if (!reply) {
      const msg = cot
        ? '模型只输出了思维链、未生成正文（可能被 max_tokens 截断，或模型选择不回答）'
        : '模型未返回内容（请检查模型名与 API 是否匹配；请求详情见浏览器控制台）';
      throw new Error(msg);
    }
    setDebugTrace(targetScope, {
      status: '已完成',
      output: cot ? `${reply}\n\n[reasoning_content]\n${cot}` : String(reply),
    });
    // 请求期间可能切换角色 / 模式 / 会话；迟到响应不得写入新的当前会话。
    if (activeConversationKey() !== targetKey) {
      setDebugTrace(targetScope, { status: '已完成（响应因切换存档/会话未写入历史）' });
      console.warn('[Tavern] 当前存档/会话已切换，已丢弃原范围的迟到响应');
      if (worldTurnPending && worldTurnPending.saveId === targetScope.id) discardWorldTurnPending();
      removeTyping();
      return;
    }
    console.debug('[Tavern] ← 响应', reply);
    if (cot) console.debug('[Tavern] 🧠 思维链', cot);
    removeTyping();
    // RPG 模式：统一正则处理（```rpg``` 状态/掷骰），剔除 rpg 块
    const processed = processAIOutput(reply);
    const clean = processed.content;
    const extra = {};
    if (cot) extra.cot = cot;
    if (processed.options && processed.options.length) extra.options = processed.options;
    pushMessage('assistant', clean, extra);
    if (worldTurnPendingActive()) {
      const optionRules = worldOptionRules();
      const options = Array.isArray(processed.options) ? processed.options : [];
      if (options.length < optionRules.min || options.length > optionRules.max) throw new Error(`RPG 回合需要 ${optionRules.min}-${optionRules.max} 个行动选项，当前候选未提交`);
      worldTurnPending.options = options;
      worldTurnPending.createEntities = processed.createEntities;
      worldTurnPending.eventMemory = processed.eventMemory;
      worldTurnPending.state = serializeWorldState(currentWorldSave);
      await submitWorldTurn(worldTurnPending);
    }
    // 文生图（测试）：回复完成后自动生图（异步，不阻塞对话）
    const ig = settings.imageGen;
    if (ig && ig.enabled && ig.auto && ig.baseUrl) {
      generateImageFor(clean).catch(e => console.error('[Tavern] 文生图失败', e.message));
    }
  } catch (err) {
    console.error('[Tavern] ✗ 请求失败', err.message);
    removeTyping();
    const keptWorldTurn = failWorldTurnPending(err.message);
    setDebugTrace(targetScope, { status: '失败', output: `ERROR\n${err.message}` });
    if (activeConversationKey() === targetKey && !keptWorldTurn) pushMessage('system', `⚠️ 请求失败：${err.message}`);
    setApiStatus(`最近一次请求失败：${err.message}`, true);
  } finally {
    sending = false;
    $('btn-send').disabled = false;
    const input = $('input');
    if (input) input.focus();
  }
}

async function sendMessage() {
  if (sending || worldTurnPreparing || worldTurnPending || (worldModeActive() && currentWorldSave?.state?.ending?.status === 'ended')) return;
  const input = $('input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  if (worldModeActive()) {
    worldTurnPreparing = true;
    try {
      await worldSaveWriteChain.catch(() => {});
      if (!worldModeActive()) return;
      worldTurnEpoch++;
      worldTurnPending = {
        commandId: uid(),
        saveId: currentWorldSave.id,
        expectedRevision: currentWorldSave.revision,
        beforeState: cloneValue(serializeWorldState(currentWorldSave)),
        state: serializeWorldState(currentWorldSave),
        messages: [{ id: uid(), role: 'user', content: text, ts: Date.now() }],
        actionIntent: { raw: text },
        options: null,
        createEntities: null,
        eventMemory: null,
      };
      renderMessages();
      const rolls = await rollWorldDice(text);
      for (const r of rolls) {
        const detail = r.rolls.length > 1 ? `（${r.rolls.join(' + ')}${r.bonus ? (r.bonus >= 0 ? ' + ' + r.bonus : ' - ' + Math.abs(r.bonus)) : ''}）` : (r.bonus ? `（+${r.bonus}）` : '');
        pushMessage('user', `🎲 ${r.expr} = ${r.total} ${detail}`, { meta: true });
      }
      worldTurnPending.actionIntent.dice = rolls;
      await requestReply();
    } catch (err) {
      failWorldTurnPending(err.message);
      setApiStatus(`最近一次请求失败：${err.message}`, true);
    } finally {
      worldTurnPreparing = false;
    }
    return;
  }
  pushMessage('user', text);
  // 掷骰：玩家输入含 d20+5 / 2d6-1 → 自动掷骰并显示结果（不进 AI 上下文）
  const rolls = rollDiceIn(text);
  for (const r of rolls) {
    const detail = r.rolls.length > 1 ? `（${r.rolls.join(' + ')}${r.bonus ? (r.bonus >= 0 ? ' + ' + r.bonus : ' - ' + Math.abs(r.bonus)) : ''}）` : (r.bonus ? `（+${r.bonus}）` : '');
    // 掷骰结果以 meta 用户消息注入：居中显示 + 进入 AI 上下文（AI 能基于结果推进）
    pushMessage('user', `🎲 ${r.expr} = ${r.total} ${detail}`, { meta: true });
  }
  await requestReply();
}

/* ─────────── 视图切换 ─────────── */
const VIEW_PLACEHOLDER = {};

function switchView(name) {
  closeNavDrawer(); // 手机抽屉：切换视图后自动收起
  renderDebugTerminal();
  document.querySelectorAll('.nav-item[data-view]').forEach(b =>
    b.classList.toggle('active', b.dataset.view === name));
  ['char-mgr', 'prompt-mgr', 'lore-mgr', 'memory-mgr', 'world-mgr'].forEach(id => { const el = $(id); if (el) el.classList.add('hidden'); });
  if (name === 'worlds') { openWorldLibrary(false); return; }
  if (name === 'chat') return;
  if (name === 'chars') {
    renderBindSelects();
    $('char-mgr').classList.remove('hidden');
    renderCharList();
    if (!cmEditingId && !cmCreating && characters.length) selectCharForEdit(currentCharId || characters[0].id);
    return;
  }
  if (name === 'prompts') {
    $('prompt-mgr').classList.remove('hidden');
    const editingPreset = promptPresets[pgEditingName];
    if (!editingPreset || !['both', mode].includes(presetMode(pgEditingName, editingPreset))) selectPresetForEdit(activePresetNameForMode(mode) || GLOBAL_PRESET_KEY);
    else renderPGList();
    return;
  }
  if (name === 'lore') {
    $('lore-mgr').classList.remove('hidden');
    if (!lbEditingId) lbEditingId = Object.keys(lorebooks)[0] || null;
    $('lb-scan-depth').value = prefs.wiScanDepth;
    $('lb-whole-word').checked = !!prefs.wiWholeWord;
    renderLBList();
    renderWIList();
    return;
  }
  if (name === 'memory') {
    $('memory-mgr').classList.remove('hidden');
    ensureUserData();
    fillUserForm();
    renderMemList();
    return;
  }
}

/* ─────────── 主题 / 布局 ─────────── */
let bgRaf = null;
function initBackground() {
  if (bgRaf) cancelAnimationFrame(bgRaf);
  bgRaf = null;
}

function applyTheme() {
  theme = FIXED_THEME;
  document.body.dataset.theme = theme;
  localStorage.setItem(LS_THEME, theme);
  initBackground();
}

function applyLayout() {
  document.body.dataset.layout = 'classic';
}

/* 模式：酒馆 / RPG（body[data-mode] 控制布局与渲染分支） */
function applyMode(name) {
  if (worldTurnPending) discardWorldTurnPending();
  mode = (name === 'rpg') ? 'rpg' : 'tavern';
  document.body.dataset.mode = mode;
  localStorage.setItem(LS_MODE, mode);
  const btn = $('btn-mode-switch');
  if (btn) {
    btn.querySelector('.icon').textContent = mode === 'rpg' ? '⚔' : '🍺';
    btn.querySelector('.label').textContent = mode === 'rpg' ? '模式：RPG' : '模式：酒馆';
  }
  activateSessionScope();
  // 模式切换：会话按 charId + kind 双重分流
  renderSessions();
  renderMessages();
  if (mode === 'rpg') openWorldLibrary(true);
  else { closeWorldLibrary(); renderCharacter(); }
}

function switchMode() {
  const next = mode === 'rpg' ? 'tavern' : 'rpg';
  // 每种模式记住自己的预设；首次进入时使用对应示例。
  const defaultPreset = next === 'rpg' ? 'RPG 叙事引擎（示例）' : 'RP 基础（示例）';
  prefs.currentPresetByMode = { ...(prefs.currentPresetByMode || {}) };
  const hasSavedPreset = Object.prototype.hasOwnProperty.call(prefs.currentPresetByMode, next);
  const savedPreset = prefs.currentPresetByMode[next];
  if (!hasSavedPreset || (savedPreset && !promptPresets[savedPreset])) prefs.currentPresetByMode[next] = promptPresets[defaultPreset] ? defaultPreset : '';
  prefs.currentPreset = prefs.currentPresetByMode[next] || '';
  saveJSON(LS_PREFS, prefs);
  applyMode(next);
  renderSessions();
  renderMessages();
  renderQuickActions(); // 快捷行动预设随模式切换
  renderPGList(); // 提示词页「当前预设」高亮/下拉刷新
  renderBindSelects(); // 角色绑定预设下拉刷新
}

/* ─────────── 手机导航抽屉 ─────────── */
function openNavDrawer() { const d = $('nav-drawer'); if (d) d.classList.add('open'); }
function closeNavDrawer() { const d = $('nav-drawer'); if (d) d.classList.remove('open'); }

/* ─────────── AI 生成（角色卡 / 世界书条目） ─────────── */
/* 调用对话 API 生成，返回解析后的对象 */
async function aiGenerate(instruction, desc) {
  if (!settings.baseUrl) throw new Error('请先配置 API（设置 → 连接）');
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      body: {
        model: settings.model || 'default',
        messages: [
          { role: 'system', content: instruction },
          { role: 'user', content: desc },
        ],
        temperature: 0.7,
        max_tokens: 900,
        stream: false,
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.choices || !data.choices[0]) {
    throw new Error('生成失败：' + ((data.error && data.error.message) || ('HTTP ' + res.status)));
  }
  return parseLLMJson(data.choices[0].message.content);
}

/* 容错解析 LLM 输出的 JSON（容忍 ```json 围栏 / 前后杂文） */
function parseLLMJson(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

/* 第一步 → 第二步：一句话生成由 JSON 定义的基本信息表 */
async function aiGenChar() {
  const desc = $('cm-ai-desc').value.trim();
  if (!desc) { alert('先描述你想要的角色，例如：傲娇的猫娘旅店老板娘'); return; }
  const gen = defaults.gen || {};
  if (!gen.charBasicPrompt || !charFieldDefs().length) { alert('未配置角色基本信息字段或生成指令'); return; }
  const btn = $('btn-ai-char');
  btn.disabled = true; btn.textContent = '填写中…';
  $('cm-ai-status').textContent = 'AI 正在填写基本信息…';
  try {
    const schema = charFieldDefs().map(({ key, label }) => ({ key, label }));
    const instruction = gen.charBasicPrompt + '\n字段定义：' + JSON.stringify(schema);
    const obj = await aiGenerate(instruction, desc);
    const fields = obj && obj.fields && typeof obj.fields === 'object' ? obj.fields : obj;
    renderCharProfileFields(characters.find(c => c.id === cmEditingId) || null, fields);
    syncProfileFieldsToForm();
    setCharWizardStep(2);
    $('cm-ai-status').textContent = '基本信息已填写，可直接修改或添加自定义条目。';
  } catch (err) {
    console.error('[Tavern] AI 生成角色卡失败:', err.message);
    alert('❌ ' + err.message);
    $('cm-ai-status').textContent = '基本信息生成失败，请检查 API 设置后重试。';
  } finally {
    btn.disabled = false; btn.textContent = 'AI 填写基本信息';
  }
}

/* 第二步 → 第三步：基于用户确认的信息生成完整 JSON 角色卡 */
async function aiGenFullChar() {
  const gen = defaults.gen || {};
  if (!gen.charFullPrompt) { alert('未配置完整角色卡生成指令'); return; }
  const profileFields = collectCharProfileFields();
  if (!profileFields.length) { alert('请先填写至少一项基本信息'); return; }
  const btn = $('btn-ai-char-full');
  btn.disabled = true; btn.textContent = '生成中…';
  $('cm-ai-status').textContent = 'AI 正在完善完整角色卡…';
  try {
    const obj = await aiGenerate(gen.charFullPrompt, JSON.stringify({ summary: $('cm-ai-desc').value.trim(), profileFields }));
    const confirmed = Object.fromEntries(profileFields.map(field => [field.key, field.value]));
    const bindings = {
      name: 'cm-name', race: 'cm-race', role: 'cm-role', persona: 'cm-persona',
      scenario: 'cm-scenario', firstMes: 'cm-first-mes', systemPrompt: 'cm-system',
      postHistory: 'cm-post', tags: 'cm-tags',
    };
    for (const [key, id] of Object.entries(bindings)) {
      const value = Object.prototype.hasOwnProperty.call(confirmed, key) ? confirmed[key] : obj[key];
      if (typeof value === 'string') $(id).value = value;
    }
    if (cmCreating) renderCharList();
    setCharWizardStep(3);
    $('cm-ai-status').textContent = '完整角色卡已生成，基本信息条目会随角色一起保存。';
  } catch (err) {
    console.error('[Tavern] AI 完整角色卡生成失败:', err.message);
    alert('❌ ' + err.message);
    $('cm-ai-status').textContent = '完整角色卡生成失败，已保留当前基本信息。';
  } finally {
    btn.disabled = false; btn.textContent = 'AI 完善并生成完整角色卡';
  }
}

/* 生成世界书条目 → 填入条目编辑器（用户确认后保存） */
async function aiGenWI() {
  const desc = $('wi-ai-desc').value.trim();
  if (!desc) { alert('先描述要生成的设定，例如：北方沉睡古龙的龙之谷'); return; }
  const gen = defaults.gen || {};
  if (!gen.lorePrompt) { alert('未配置生成指令（_defaults.json → gen.lorePrompt）'); return; }
  const btn = $('btn-ai-wi');
  btn.disabled = true; btn.textContent = '生成中…';
  try {
    const obj = await aiGenerate(gen.lorePrompt, desc);
    $('wi-title').value = obj.title || '';
    $('wi-keys').value = obj.keys || '';
    $('wi-content').value = obj.content || '';
    $('wi-order').value = 100;
    $('wi-constant').checked = !!obj.constant;
    alert('✅ 已生成并填入 —— 检查后点「保存条目」');
  } catch (err) {
    console.error('[Tavern] AI 生成世界书失败:', err.message);
    alert('❌ ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = '✨ 生成';
  }
}

/* ─────────── RPG 手动管理（背包 / 任务 / 快捷行动） ─────────── */

function addRpgItem() {
  const rs = curRpgState();
  if (!rs) { alert('当前不是 RPG 会话'); return; }
  const name = (prompt('道具名称：') || '').trim();
  if (!name) return;
  const n = parseInt(prompt('数量（默认 1）：', '1'), 10);
  const count = isNaN(n) ? 1 : n;
  const desc = (prompt('描述（可留空）：') || '').trim();
  const exist = rs.inventory.find(i => i.name === name);
  if (exist) exist.count += count;
  else rs.inventory.push({ name, count, desc });
  commitRpgState(rs); renderRPG();
}

function addRpgQuest() {
  const rs = curRpgState();
  if (!rs) { alert('当前不是 RPG 会话'); return; }
  const title = (prompt('任务标题：') || '').trim();
  if (!title) return;
  const desc = (prompt('任务内容（可留空）：') || '').trim();
  rs.quests.push({ id: uid(), title, desc, status: 'active' });
  commitRpgState(rs); renderRPG();
}

function toggleRpgQuest(idx) {
  const rs = curRpgState();
  if (!rs || !rs.quests[idx]) return;
  rs.quests[idx].status = rs.quests[idx].status === 'done' ? 'active' : 'done';
  commitRpgState(rs); renderRPG();
}

function removeRpgItem(idx) {
  const rs = curRpgState();
  if (!rs) return;
  rs.inventory.splice(idx, 1);
  commitRpgState(rs); renderRPG();
}

function removeRpgQuest(idx) {
  const rs = curRpgState();
  if (!rs) return;
  rs.quests.splice(idx, 1);
  commitRpgState(rs); renderRPG();
}

/* 酒馆模式快捷行动（保留原有） */
const QUICK_TAVERN = [
  { label: '🐾 摸摸头', action: '（轻轻摸了摸对方的头）' },
  { label: '👀 观察四周', action: '（仔细观察四周的环境）' },
  { label: '🤔 试探对方', action: '（试探性地）你怎么看这件事？' },
  { label: '⚔ 保持戒备', action: '（警惕地后退一步，手按在武器上）' },
];

/* ═══════════ 世界地图系统（三步法 demo：算法生成 + 数据层 + AI 美化 + 上下文注入） ═══════════ */
/* 世界模式地图归属 WorldSave.state.map；旧 RPG 兼容路径仍读 session.rpgState。 */

function currentWorldMapState() {
  if (!worldModeActive()) return null;
  const state = currentWorldSave.state || (currentWorldSave.state = {});
  state.map = state.map && typeof state.map === 'object' ? state.map : { strategy: 'perSave', data: null, imagePath: null, markers: [] };
  return state.map;
}
function currentWorldMapGeneration(seed) {
  const generation = worldDraftMapGeneration(currentWorldCard());
  return seed === undefined ? generation : { ...generation, seed };
}
function curMapImage() {
  const mapState = currentWorldMapState();
  return mapState ? mapState.imagePath : (curRpgState()?.mapImage || null);
}
function setCurMapImage(value) {
  const mapState = currentWorldMapState();
  if (mapState) mapState.imagePath = value || null;
  else {
    const rs = curRpgState();
    if (rs) rs.mapImage = value || null;
  }
}

function curMapData() {
  const worldMap = currentWorldMapState();
  if (worldMap) {
    if (worldMap.data && !(worldMap.data.grid instanceof Uint16Array) && window.MapGen?.hydrateMap) worldMap.data = window.MapGen.hydrateMap(worldMap.data);
    if (!worldMap.data && window.MapGen) {
      const generation = currentWorldMapGeneration();
      worldMap.data = window.MapGen.generateWorldMap(generation.seed, generation);
      queueWorldSave(currentWorldSave);
    }
    return worldMap.data || null;
  }
  const rs = curRpgState();
  if (!rs) return null;
  if (!rs.mapData) {
    rs.mapData = (window.MapGen ? window.MapGen.generateWorldMap(Date.now() % 2147483647, { size: 128, regionCount: 8 }) : null);
    saveSessions();
  }
  return rs.mapData;
}

/* 渲染：小预览（缩略） + 地图窗口（若打开，高清） */
function renderMap() {
  const canvas = $('map-canvas');
  if (!canvas || !window.MapGen) return;
  const rs = curRpgState();
  const map = curMapData();
  if (!map) return;
  if (curMapImage()) {
    canvas.style.display = 'none';
    $('map-beauty').hidden = false;
    $('map-beauty-img').src = curMapImage();
  } else {
    $('map-beauty').hidden = true;
    canvas.style.display = 'block';
    window.MapGen.renderWorldMap(canvas, map, { pixelSize: 6 });
  }
  renderMapModal();
}

let mmShowOriginal = false; // 地图窗口：true = 显示美化前的算法原图，false = 显示 AI 美化图

/* 地图窗口渲染（打开时刷新窗口内画布 / 美化图） */
function renderMapModal() {
  const modal = $('map-modal');
  if (!modal || modal.classList.contains('hidden')) return;
  const canvas = $('mm-canvas');
  if (!canvas || !window.MapGen) return;
  const rs = curRpgState();
  const map = curMapData();
  if (!map) return;
  const toggle = $('mm-toggle');
  const mapImage = curMapImage();
  const hasImage = !!mapImage;
  if (toggle) toggle.style.display = hasImage ? '' : 'none'; // 无美化图时切换按钮隐藏
  const showOriginal = !hasImage || mmShowOriginal;
  if (!showOriginal) {
    canvas.style.display = 'none';
    $('mm-beauty').hidden = false;
    $('mm-beauty-img').src = mapImage;
    if (toggle) toggle.textContent = '🖼 原始底图';
  } else {
    $('mm-beauty').hidden = true;
    canvas.style.display = 'block';
    window.MapGen.renderWorldMap(canvas, map, { pixelSize: 12 }); // 窗口内高清
    if (toggle) toggle.textContent = hasImage ? '✨ 美化图' : '✨ AI 美化';
  }
}

/* 切换 美化图 / 美化前的算法原图 */
function toggleMapView() {
  mmShowOriginal = !mmShowOriginal;
  renderMapModal();
  const info = $('mm-info');
  if (info) {
    info.innerHTML = mmShowOriginal
      ? '<span class="hint">🖼 正在查看美化前的算法原图（数据层不变，点击地图可查看区域 / 地点信息）</span>'
      : '<span class="hint">✨ 已切回 AI 美化图</span>';
  }
}

function openMapModal() {
  const modal = $('map-modal');
  if (!modal) return;
  mmShowOriginal = false; // 每次打开默认显示美化图（如有）
  modal.classList.remove('hidden');
  renderMapModal();
}
function closeMapModal() {
  const modal = $('map-modal');
  if (modal) modal.classList.add('hidden');
}

/* 点击命中（地图窗口内 canvas / 美化图共用）：DOM 坐标 → 网格坐标 → mapHit，信息显示在窗口底部 */
function mapCanvasClick(e) {
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  const px = (e.clientX - rect.left) / rect.width;
  const py = (e.clientY - rect.top) / rect.height;
  const map = curMapData();
  if (!map) return;
  const gx = Math.floor(px * map.size), gy = Math.floor(py * map.size);
  const hit = window.MapGen.mapHit(map, gx, gy);
  const info = $('mm-info');
  if (!info) return;
  if (!hit || hit.kind === 'ocean') {
    info.innerHTML = '<span class="hint">（浩瀚的海洋，尚无定居点）</span>'
      + '<div><button class="ghost-btn small" id="mm-view-orig">🔍 查看原图</button></div>';
    return;
  }
  if (hit.kind === 'point') {
    const p = hit.point;
    info.innerHTML = `<div class="map-info-title">📍 ${esc(p.name)} <span class="tag">${esc(p.type)}</span></div>`
      + `<div class="map-info-desc">${esc(p.desc)}</div>`
      + '<div><button class="ghost-btn small" id="mm-view-orig">🔍 查看原图</button></div>';
    return;
  }
  const r = map.regions[hit.region - 1];
  if (!r) return;
  const neighbors = map.adjacency
    .filter(([a, b]) => a === r.id || b === r.id)
    .map(([a, b]) => map.regions[(a === r.id ? b : a) - 1].name);
  const pts = map.points.filter(p => p.regionId === r.id);
  info.innerHTML = `<div class="map-info-title">🗺 ${esc(r.name)} <span class="tag">${esc(r.biome)}</span></div>`
    + `<div class="map-info-desc">${esc(r.name)}的${esc(r.biome)}地带${neighbors.length ? '，可前往：' + esc(neighbors.join('、')) : ''}</div>`
    + (pts.length ? `<div class="map-info-desc">${pts.map(p => '📍 ' + esc(p.name) + '（' + esc(p.type) + '）').join('　')}</div>` : '')
    + '<div><button class="ghost-btn small" id="mm-view-orig">🔍 查看原图</button></div>';
}

/* 重新生成：换 seed，清美化图，重建数据层（逻辑坐标全变） */
function mapRegenerate() {
  const rs = curRpgState();
  if (!rs || !window.MapGen) return;
  const seed = Date.now() % 2147483647;
  const generation = worldModeActive() ? currentWorldMapGeneration(seed) : { seed, size: 128, regionCount: 8, landRatio: 0.55, mapgenSize: 'small' };
  const map = window.MapGen.generateWorldMap(seed, generation);
  const worldMap = currentWorldMapState();
  if (worldMap) {
    worldMap.data = map;
    worldMap.imagePath = null;
    queueWorldSave(currentWorldSave);
  } else {
    rs.mapData = map;
    delete rs.mapImage;
    if (worldModeActive()) queueWorldSave(currentWorldSave); else saveSessions();
  }
  renderMap(); // 小预览 + 窗口同步刷新
  const info = $('mm-info');
  if (info) info.innerHTML = '<span class="hint">✅ 已生成新世界，数据层已更新（区域/路径点/邻接）</span>';
}

/* AI 美化提示词：携带地图数据约束（区域数/biome 列表/区域明细），让 AI 遵循原图群系不破坏 */
function buildBeautifyPrompt(map) {
  const biomes = [...new Set(map.regions.map(r => r.biome))].join('、');
  const regionDetails = map.regions.map(r => r.biome + '「' + r.name + '」').join('，');
  return 'Beautify this procedurally generated fantasy world map into a beautiful hand-drawn cartography style map. '
    + 'Keep the landmass shapes and landmark positions exactly as they are. '
    + 'This is a single-region map with ' + map.regions.length + ' regions whose biomes are: ' + biomes + '. '
    + 'Preserve each region\'s color area and biome exactly as in the reference image — do not merge or split regions, do not change or invent biomes. '
    + 'Region details: ' + regionDetails + '. '
    + 'IMPORTANT: the reference image is a labeled reference map: '
    + 'thin boundary lines mark region borders, text labels show each region\'s biome name (e.g. 森林/草原), '
    + 'ridge mountain symbols = mountains, tree symbols = forest, wavy lines = wetland, blue = water. '
    + 'Use the boundary lines to know exactly where each region starts and ends, and use the text labels to know its terrain type. '
    + 'Draw realistic mountains, forests and wetlands in exactly the areas where the corresponding symbols appear, '
    + 'and replace every annotation (boundary lines, text labels, marker symbols) with actual terrain — do not keep any of them in the final image. '
    + 'Keep each region\'s color area and biome as the reference, blending softly at borders. '
    + 'Add coastline details, rivers and a compass rose. '
    + 'Do NOT add any new text, labels, place names or town names. '
    + 'Fantasy cartography, parchment color palette, clean and quiet.';
}

/* AI 美化（三步法第②③步）：独立渲染【带地形标记的参考图】（展示图无标记，参考图标山脉/森林/湿地）
 * → gpt-image /images/edits → 美化图 + 数据层不变 */
async function mapBeautify() {
  if (!window.MapGen) return;
  const rs = curRpgState();
  const map = curMapData();
  if (!map) return;
  const ig = (settings && settings.imageGen) || {};
  if (!ig.baseUrl) {
    alert('请先在 设置 → 文生图 中配置 Base URL（gpt-image 反代）');
    return;
  }
  const status = $('mm-info');
  const targetKey = activeConversationKey();
  const targetMap = map;
  if (status) status.innerHTML = '<span class="hint">⏳ AI 美化中…（标注版参考图已上传）</span>';
  const refCanvas = document.createElement('canvas');
  window.MapGen.renderWorldMap(refCanvas, map, { pixelSize: 12, markers: true, labels: 'bold' }); // 参考图：标注边界线+文字+地形符号
  const dataUrl = refCanvas.toDataURL('image/png');
  try {
    const res = await fetch('/api/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        baseUrl: ig.baseUrl, apiKey: ig.apiKey || '', kind: 'openai',
        body: {
          model: ig.model || 'gpt-image-2',
          size: ig.size || '1024x1024',
          prompt: buildBeautifyPrompt(map),
          images: [dataUrl],
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data.error && (data.error.message || data.error)) || ('生图 API 返回 ' + res.status);
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    const src = parseImageSrc(data);
    if (!src) throw new Error('响应中没有图片字段');
    const local = await saveImageLocally(src);
    if (worldModeActive()
      ? (activeConversationKey() !== targetKey || currentWorldMapState()?.data?.seed !== targetMap.seed)
      : activeConversationKey() !== targetKey) return;
    setCurMapImage(local || src);
    if (worldModeActive()) queueWorldSave(currentWorldSave); else saveSessions();
    renderMap();
    if (status) status.innerHTML = '<span class="hint">✅ 美化完成 —— 数据层（区域/路径点/邻接）保持不变，点击仍有效</span>';
  } catch (err) {
    console.error('[Tavern] 地图美化失败', err.message);
    if (status) status.innerHTML = `<span class="hint">❌ 地图美化失败：${esc(err.message)}</span>`;
  }
}

/* 地图数据注入 AI 上下文（保障叙事：区域/可达性/当前位置/地标） */
function buildMapContext() {
  if (mode !== 'rpg') return '';
  const map = curMapData();
  if (!map || !map.regions) return '';
  const rs = curRpgState();
  // 当前区域：location 含「区域 N」→ N；否则按名称模糊匹配
  const locText = (rs && rs.location) || '';
  const m = /区域\s*(\d+)/.exec(locText);
  let cur = m ? map.regions.find(r => r.id === parseInt(m[1], 10)) : null;
  if (!cur) cur = map.regions.find(r => r.name === locText) || null;
  const adjacentIds = new Set(cur ? [cur.id, ...map.adjacency
    .filter(([a, b]) => a === cur.id || b === cur.id)
    .map(([a, b]) => a === cur.id ? b : a)] : []);
  const scopedRegions = adjacentIds.size
    ? map.regions.filter(region => adjacentIds.has(region.id))
    : map.regions.slice(0, 6);
  const scopedRegionIds = new Set(scopedRegions.map(region => region.id));
  const lines = [];
  lines.push('【地图】当前世界是一张算法生成的地图，共 ' + map.regions.length + ' 个区域。'
    + '玩家当前位置：' + (cur ? cur.name + '（' + cur.biome + '）' : (locText || '未知')) + '。');
  lines.push('当前区域与可达性（仅注入当前位置及相邻区域）：');
  for (const r of scopedRegions) {
    const nb = map.adjacency
      .filter(([a, b]) => a === r.id || b === r.id)
      .map(([a, b]) => map.regions.find(region => region.id === (a === r.id ? b : a)))
      .filter(region => region && scopedRegionIds.has(region.id))
      .map(region => region.name)
      .filter(Boolean);
    lines.push('· ' + r.name + '（' + r.biome + '）' + (nb.length ? ' — 可前往：' + nb.join('、') : '（孤立）'));
  }
  const pts = map.points.filter(point => adjacentIds.has(point.regionId)).slice(0, 12);
  if (pts.length) {
    lines.push('当前区域地标：');
    lines.push('· ' + pts.map(p => p.type + '「' + p.name + '」（' + (map.regions.find(region => region.id === p.regionId)?.name || p.regionId) + '）').join('　'));
  }
  lines.push('（玩家移动时，请让 location 使用区域名，如「区域 3」；叙事应遵循区域可达性）');
  return lines.join('\n');
}

/* 快捷行动预设栏：RPG 模式 = AI 生成的 options（全 AI 驱动，点击即发送）；酒馆模式 = 原有预设 */
function renderQuickActions() {
  const qa = $('quick-actions');
  if (!qa) return;
  qa.innerHTML = '';
  if (worldTurnErrorActive()) {
    const box = document.createElement('div');
    box.className = 'world-turn-error';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    const text = document.createElement('span');
    text.className = 'world-turn-error-text';
    text.textContent = `本回合未提交：${worldTurnError.message}`;
    box.appendChild(text);
    const actions = document.createElement('span');
    actions.className = 'world-turn-error-actions';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn gold small';
    retry.textContent = '重试 AI';
    retry.addEventListener('click', retryWorldTurn);
    const discard = document.createElement('button');
    discard.type = 'button';
    discard.className = 'ghost-btn small';
    discard.textContent = '放弃本回合';
    discard.addEventListener('click', discardWorldTurnPending);
    actions.append(retry, discard);
    box.appendChild(actions);
    qa.appendChild(box);
    return;
  }
  if (mode === 'rpg') {
    if (worldModeActive() && currentWorldSave?.state?.ending?.status === 'ended') {
      const done = document.createElement('span');
      done.className = 'quick-hint';
      done.textContent = '世界线已结束；如要继续，请创建新的世界存档。';
      qa.appendChild(done);
      return;
    }
    const msgs = curMessages();
    let opts = null;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role !== 'assistant') continue;
      opts = Array.isArray(msgs[i].options) && msgs[i].options.length ? msgs[i].options : null;
      break;
    }
    if (!opts && worldModeActive() && Array.isArray(currentWorldSave.openingOptions) && currentWorldSave.openingOptions.length) opts = currentWorldSave.openingOptions;
    if (opts) {
      for (const o of opts) {
        const b = document.createElement('button');
        b.className = 'chip';
        b.textContent = o;
        b.addEventListener('click', () => { $('input').value = o; sendMessage(); });
        qa.appendChild(b);
      }
    } else {
      // 无 AI 选项时显示提示（数据外置 defaults.rpg.noOptions）
      const hint = (defaults && defaults.rpg && defaults.rpg.noOptions) || '（等待 AI 给出行动选项…）';
      const s = document.createElement('span');
      s.className = 'quick-hint';
      s.textContent = hint;
      qa.appendChild(s);
    }
    return;
  }
  // 酒馆模式：原有预设
  for (const a of QUICK_TAVERN) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = a.label;
    b.addEventListener('click', () => {
      const input = $('input');
      input.value = input.value.trim() ? input.value.trimEnd() + '\n' + a.action : a.action;
      input.focus();
    });
    qa.appendChild(b);
  }
}

/* ─────────── 事件绑定 ─────────── */
function bindEvents() {
  // 发送
  $('btn-send').addEventListener('click', sendMessage);
  $('input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  // 快捷行动（按模式渲染）
  renderQuickActions();
  // RPG 功能区：背包/任务管理
  $('btn-rpg-item').addEventListener('click', addRpgItem);
  $('btn-rpg-quest').addEventListener('click', addRpgQuest);
  // 世界地图：生成/美化/点击
  // 小预览 → 打开地图窗口（功能全部在窗口内）
  const mapCanvas = $('map-canvas');
  if (mapCanvas) mapCanvas.addEventListener('click', openMapModal);
  const mapBeautyImg = $('map-beauty-img');
  if (mapBeautyImg) mapBeautyImg.addEventListener('click', openMapModal);
  // 地图窗口
  const mmCanvas = $('mm-canvas');
  if (mmCanvas) mmCanvas.addEventListener('click', mapCanvasClick);
  const mmBeautyImg = $('mm-beauty-img');
  if (mmBeautyImg) mmBeautyImg.addEventListener('click', mapCanvasClick);
  $('mm-toggle').addEventListener('click', toggleMapView);
  $('mm-zoom').addEventListener('click', zoomMap);
  $('mm-json').addEventListener('click', showMapJson);
  $('mm-gen').addEventListener('click', mapRegenerate);
  $('mm-beautify').addEventListener('click', mapBeautify);
  $('mm-close').addEventListener('click', closeMapModal);
  const mmModal = $('map-modal');
  if (mmModal) mmModal.addEventListener('click', (e) => { if (e.target === mmModal) closeMapModal(); });
  const btnRef = $('mm-view-ref');
  if (btnRef) btnRef.addEventListener('click', showMapRef);
  // 地图数据 JSON 查看
  const mjModal = $('map-json-modal');
  if (mjModal) mjModal.addEventListener('click', (e) => { if (e.target === mjModal) mjModal.classList.add('hidden'); });
  const mjCopy = $('mm-json-copy');
  if (mjCopy) mjCopy.addEventListener('click', copyMapJson);
  const mjClose = $('mm-json-close');
  if (mjClose) mjClose.addEventListener('click', () => { if (mjModal) mjModal.classList.add('hidden'); });
  // 信息条内「查看原图」按钮（事件委托，innerHTML 重建后仍有效）
  const mmInfoEl = $('mm-info');
  if (mmInfoEl) mmInfoEl.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'mm-view-orig') zoomMap();
  });
  const rpgInv = $('rpg-inventory');
  if (rpgInv) rpgInv.addEventListener('click', e => {
    const el = e.target;
    if (el.dataset && el.dataset.kind === 'inv') removeRpgItem(parseInt(el.dataset.idx, 10));
  });
  const rpgQ = $('rpg-quests');
  if (rpgQ) rpgQ.addEventListener('click', e => {
    const el = e.target;
    if (el.dataset && el.dataset.kind === 'quest-del') removeRpgQuest(parseInt(el.dataset.idx, 10));
    else if (el.dataset && el.dataset.kind === 'quest') toggleRpgQuest(parseInt(el.dataset.idx, 10));
  });
  const rpgGrowth = $('rpg-growth-candidates');
  if (rpgGrowth) rpgGrowth.addEventListener('click', e => {
    const el = e.target?.closest?.('[data-growth-action]');
    if (!el) return;
    decideGrowthCandidate(el.dataset.growthId, el.dataset.growthAction);
  });
  // 导航
  document.querySelectorAll('.nav-item[data-view]').forEach(b =>
    b.addEventListener('click', () => switchView(b.dataset.view)));
  // 手机导航抽屉 / 桌面侧栏收起（≥961px 时切换侧栏显隐，否则开抽屉）
  $('btn-nav-drawer').addEventListener('click', e => {
    e.stopPropagation();
    if (window.innerWidth >= 961) {
      document.body.classList.toggle('sidebar-hidden'); // 侧栏滑出 + main 回满宽（CSS transform/margin 动画，可靠无抽搐）
    } else {
      openNavDrawer();
    }
  });
  $('btn-nav-drawer-close').addEventListener('click', closeNavDrawer);
  const nd = $('nav-drawer');
  const ndm = nd && nd.querySelector('.nd-mask');
  if (ndm) ndm.addEventListener('click', closeNavDrawer);
  // 形象参考图导入
  $('btn-import-ref').addEventListener('click', () => { const f = $('cm-ref-file'); if (f) f.click(); });
  $('btn-remove-ref').addEventListener('click', removeRefImage);
  $('cm-ref-file').addEventListener('change', (e) => { importRefImage(e.target.files && e.target.files[0]); e.target.value = ''; });
  // 记忆 / 玩家设定
  $('um-preset').addEventListener('change', () => { userData.currentPreset = $('um-preset').value; fillUserForm(); saveUserData(); });
  $('um-save').addEventListener('click', saveUserForm);
  $('um-save-new').addEventListener('click', saveUserAsNew);
  $('um-del').addEventListener('click', deleteUserPreset);
  $('mem-add').addEventListener('click', addMemory);
  $('mem-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') addMemory(); });
  // AI 生成
  $('btn-ai-char').addEventListener('click', aiGenChar);
  $('btn-ai-char-full').addEventListener('click', aiGenFullChar);
  $('cm-profile-add').addEventListener('click', addCharProfileField);
  $('cw-back-1').addEventListener('click', () => setCharWizardStep(1));
  $('cw-back-2').addEventListener('click', () => setCharWizardStep(2));
  $('cm-ai-desc').addEventListener('keydown', e => { if (e.key === 'Enter') aiGenChar(); });
  $('btn-ai-wi').addEventListener('click', aiGenWI);
  // 会话
  $('btn-session').addEventListener('click', e => {
    e.stopPropagation();
    if (worldModeActive()) { openWorldLibrary(); return; }
    $('session-menu').classList.toggle('hidden');
  });
  document.addEventListener('click', e => {
    if (!$('session-menu').contains(e.target)) $('session-menu').classList.add('hidden');
    if (!$('floating-panel').contains(e.target) && !$('floating-toggle').contains(e.target)) {
      $('floating-panel').classList.add('hidden');
    }
  });
  $('session-menu-new').addEventListener('click', () => { newSession(); $('session-menu').classList.add('hidden'); });
  // 角色管理
  $('cm-new').addEventListener('click', newCharEditor);
  $('cm-name').addEventListener('input', () => { if (cmCreating) renderCharList(); });
  $('cm-save').addEventListener('click', () => { saveCharFromEditor(); renderCharList(); });
  $('cm-use').addEventListener('click', useCharInEditor);
  $('cm-del').addEventListener('click', () => {
    if (cmCreating) {
      if (!confirm('取消新建角色？未保存内容将丢失。')) return;
      cmCreating = false;
      if (currentCharId) selectCharForEdit(currentCharId);
      else renderCharList();
      return;
    }
    if (cmEditingId) deleteChar(cmEditingId);
  });
  $('cm-export').addEventListener('click', exportCurrentChar);
  $('cm-import').addEventListener('click', () => charFileInput.click());
  // 世界书
  $('wi-new').addEventListener('click', newWIEditor);
  $('wi-save').addEventListener('click', saveWI);
  $('wi-del').addEventListener('click', deleteWI);
  // 注入测试
  $('wi-test').addEventListener('click', wiTestHits);
  // 提示词预设页
  $('pg-new').addEventListener('click', pgNew);
  $('pg-del').addEventListener('click', () => { if (pgEditingName) pgDelete(pgEditingName); });
  $('pg-save').addEventListener('click', pgSave);
  $('pg-prompt-new').addEventListener('click', pgPromptNew);
  $('pg-prompt-del').addEventListener('click', pgPromptDelete);
  $('pg-library').addEventListener('change', () => { insertPGLibraryPrompt($('pg-library').value); $('pg-library').value = ''; });
  $('pg-prompt-position').addEventListener('change', () => { capturePGPromptEditor(); fillPGPromptEditor(); });
  $('pg-import').addEventListener('click', () => $('pg-file').click());
  $('pg-export').addEventListener('click', exportPromptPreset);
  $('pg-file').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('文件超过 5 MB，拒绝导入');
      const report = importSTPreset(JSON.parse(await file.text()), file.name);
      alert(`已导入「${report.name}」：素材 ${report.prompts} 条，当前顺序 ${report.ordered} 条。${report.regexes ? `检测到 ${report.regexes} 条扩展正则，已保留在原文件但不会执行。` : ''}`);
    } catch (err) {
      alert('导入失败：' + err.message);
    } finally {
      e.target.value = '';
    }
  });
  $('pg-active').addEventListener('change', () => {
    setActivePresetName($('pg-active').value || '');
    renderPGList();
  });
  // 世界书页
  $('lb-new').addEventListener('click', lbNew);
  $('lb-del').addEventListener('click', lbDelete);
  $('lb-scan-depth').addEventListener('change', () => {
    prefs.wiScanDepth = parseInt($('lb-scan-depth').value, 10) || 0;
    saveJSON(LS_PREFS, prefs);
  });
  $('lb-whole-word').addEventListener('change', () => {
    prefs.wiWholeWord = $('lb-whole-word').checked;
    saveJSON(LS_PREFS, prefs);
  });
  // 设置 tab
  document.querySelectorAll('.st-tab').forEach(b =>
    b.addEventListener('click', () => {
      document.querySelectorAll('.st-tab').forEach(x => x.classList.toggle('active', x === b));
      document.querySelectorAll('#settings-modal [id^="st-panel-"]').forEach(p => p.classList.add('hidden'));
      $('st-panel-' + b.dataset.st).classList.remove('hidden');
      const box = $('settings-modal').querySelector('.modal-box');
      if (box) box.scrollTop = 0;
    }));
  // 设置
  document.querySelectorAll('.js-settings').forEach(b => b.addEventListener('click', openSettings));
  $('btn-debug').addEventListener('click', () => $('debug-panel').open ? closeDebugTerminal() : openDebugTerminal());
  $('rpg-end-world').addEventListener('click', endCurrentWorld);
  $('debug-close').addEventListener('click', closeDebugTerminal);
  $('debug-clear').addEventListener('click', clearDebugTerminal);
  $('debug-copy').addEventListener('click', copyDebugTerminal);
  $('debug-memory-rebuild').addEventListener('click', rebuildDebugMemory);
  $('debug-panel').addEventListener('cancel', e => { e.preventDefault(); closeDebugTerminal(); });
  $('debug-panel').addEventListener('click', e => { if (e.target === e.currentTarget) closeDebugTerminal(); });
  // 模式切换：刷新快捷行动与 RPG 面板
  $('btn-mode-switch').addEventListener('click', switchMode);
  renderQuickActions();
  // 世界库：当前存档接管 RPG 主链；旧 RPG 回合仍保留兼容出口
  $('world-refresh').addEventListener('click', async () => {
    const btn = $('world-refresh');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '刷新中…';
    await loadWorldLibraryData();
    btn.disabled = false;
    btn.textContent = old;
  });
  $('world-new-draft').addEventListener('click', openWorldDraftEditor);
  $('world-import').addEventListener('click', openWorldPackageImport);
  $('world-import-file').addEventListener('change', e => previewWorldPackageImport(e.target.files?.[0]));
  $('world-migrate-rpg').addEventListener('click', openRpgMigration);
  $('rpg-migration-session').addEventListener('change', previewRpgMigration);
  $('rpg-migration-form').addEventListener('submit', async e => { e.preventDefault(); await commitRpgMigration(); });
  $('rpg-migration-close').addEventListener('click', closeRpgMigration);
  $('rpg-migration-cancel').addEventListener('click', closeRpgMigration);
  $('rpg-migration-dialog').addEventListener('cancel', e => { e.preventDefault(); closeRpgMigration(); });
  $('rpg-migration-dialog').addEventListener('click', e => { if (e.target === e.currentTarget) closeRpgMigration(); });
  $('world-import-form').addEventListener('submit', async e => { e.preventDefault(); await commitWorldPackageImport(); });
  $('world-import-close').addEventListener('click', closeWorldPackageImport);
  $('world-import-cancel').addEventListener('click', closeWorldPackageImport);
  $('world-import-dialog').addEventListener('cancel', e => { e.preventDefault(); closeWorldPackageImport(); });
  $('world-import-dialog').addEventListener('click', e => { if (e.target === e.currentTarget) closeWorldPackageImport(); });
  $('world-export').addEventListener('click', exportCurrentWorldPackage);
  $('world-edit-draft').addEventListener('click', openWorldDraftEditor);
  $('world-draft-form').addEventListener('input', () => { worldDraftDirty = true; worldDraftPublishId = null; });
  $('world-draft-map-regions').addEventListener('input', updateWorldDraftMapOutputs);
  $('world-draft-map-land').addEventListener('input', updateWorldDraftMapOutputs);
  $('world-draft-map-random').addEventListener('click', randomizeWorldDraftMapSeed);
  $('world-draft-map-preview').addEventListener('click', previewWorldDraftMap);
  $('world-draft-add-location').addEventListener('click', addWorldDraftLocation);
  $('world-draft-add-npc').addEventListener('click', addWorldDraftNpc);
  $('world-draft-form').addEventListener('submit', async e => { e.preventDefault(); await saveWorldDraft(); });
  $('world-draft-publish').addEventListener('click', publishWorldDraft);
  $('world-draft-close').addEventListener('click', requestCloseWorldDraft);
  $('world-draft-cancel').addEventListener('click', requestCloseWorldDraft);
  $('world-draft-dialog').addEventListener('cancel', e => { e.preventDefault(); requestCloseWorldDraft(); });
  $('world-draft-dialog').addEventListener('click', e => { if (e.target === e.currentTarget) requestCloseWorldDraft(); });
  $('world-player-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = $('world-player-form');
    if (!form.reportValidity() || !pendingWorldSaveName) return;
    const createButton = $('world-player-create');
    const worldButton = pendingWorldSaveButton;
    createButton.disabled = true;
    setWorldPlayerStatus('正在创建独立存档…');
    try {
      await createWorldSave(pendingWorldSaveName, collectWorldPlayerInput());
      const input = $('world-save-name');
      if (input) input.value = '';
      closeWorldPlayerDialog('created');
      const status = $('world-open-status');
      if (status) status.textContent = `已创建并打开「${currentWorldSave.name}」——玩家、世界状态、地图和叙事已绑定当前存档；当前存档 ID：${currentWorldSave.id}`;
      enterWorldWorkspace();
    } catch (err) {
      setWorldPlayerStatus(err.message, 'error');
    } finally {
      createButton.disabled = false;
      if (worldButton) worldButton.disabled = false;
    }
  });
  $('world-player-close').addEventListener('click', () => closeWorldPlayerDialog());
  $('world-player-cancel').addEventListener('click', () => closeWorldPlayerDialog());
  $('world-player-dialog').addEventListener('cancel', e => { e.preventDefault(); closeWorldPlayerDialog(); });
  $('world-player-dialog').addEventListener('click', e => { if (e.target === e.currentTarget) closeWorldPlayerDialog(); });
  $('world-upgrade-target').addEventListener('change', previewWorldSaveUpgrade);
  $('world-upgrade-form').addEventListener('submit', async e => { e.preventDefault(); await commitWorldSaveUpgrade(); });
  $('world-upgrade-close').addEventListener('click', closeWorldSaveUpgrade);
  $('world-upgrade-cancel').addEventListener('click', closeWorldSaveUpgrade);
  $('world-upgrade-dialog').addEventListener('cancel', e => { e.preventDefault(); closeWorldSaveUpgrade(); });
  $('world-upgrade-dialog').addEventListener('click', e => { if (e.target === e.currentTarget) closeWorldSaveUpgrade(); });
  window.addEventListener('beforeunload', e => {
    if (!worldDraftDirty) return;
    e.preventDefault();
    e.returnValue = '';
  });
  $('world-save-form').addEventListener('submit', async e => {
    e.preventDefault();
    const input = $('world-save-name');
    const btn = $('world-save-create');
    const name = input.value.trim();
    showWorldError('');
    if (!name) { showWorldError('请填写存档名称。'); input.focus(); return; }
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '创建中…';
    try {
      const created = await openWorldPlayerCreation(name, btn);
      if (created) {
        input.value = '';
        const status = $('world-open-status');
        if (status) status.textContent = `已创建并打开「${currentWorldSave.name}」——世界状态、地图和叙事已绑定当前存档；当前存档 ID：${currentWorldSave.id}`;
        enterWorldWorkspace();
      }
    } catch (err) {
      showWorldError(err.message);
      input.focus();
    } finally {
      if (!$('world-player-dialog')?.open) btn.disabled = false;
      btn.textContent = old;
    }
  });
  $('world-legacy-chat').addEventListener('click', () => { closeWorldLibrary(); switchView('chat'); });
  $('world-close').addEventListener('click', () => { closeWorldLibrary(); switchView('chat'); });
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeSettings));
  $('btn-test-image').addEventListener('click', testImageGen);
  $('settings-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeSettings(); });
  $('floating-toggle').addEventListener('click', e => {
    e.stopPropagation();
    $('floating-panel').classList.toggle('hidden');
  });
  $('btn-save-settings').addEventListener('click', () => { readSettingsForm(); closeSettings(); });
  $('btn-test').addEventListener('click', testConnection);
  $('btn-export').addEventListener('click', exportSettings);
  $('btn-import').addEventListener('click', importSettings);
  $('s-preset').addEventListener('change', () => {
    const p = providers.find(x => x.id === $('s-preset').value);
    if (p) {
      $('s-base-url').value = p.baseUrl;
      $('s-model').value = p.model;
    }
  });
  $('s-temperature').addEventListener('input', () => { $('s-temp-val').textContent = $('s-temperature').value; });
  $('s-top-p').addEventListener('input', () => { $('s-top-p-val').textContent = $('s-top-p').value; });
  $('btn-fetch-models').addEventListener('click', fetchModels);
  $('s-profile').addEventListener('change', profileSwitch);
  $('btn-profile-save').addEventListener('click', profileSave);
  $('btn-profile-del').addEventListener('click', profileDelete);
  // 清空对话
  $('btn-clear-chat').addEventListener('click', () => {
    if (!confirm('确定清空当前对话？将重新加载开场白。')) return;
    if (worldModeActive()) {
      if (worldTurnPendingActive()) { discardWorldTurnPending(); return; }
      currentWorldSave.turns = [];
      queueWorldSave(currentWorldSave);
      renderMessages();
      renderSessions();
      return;
    }
    const s = curSession();
    if (!s) return;
    // 清空后重新加载开场白（getGreeting：char → preset → settings）
    const greeting = getGreeting();
    s.messages = greeting
      ? [{ role: 'assistant', content: greeting, ts: Date.now() }] // 开场白：正常拆分旁白/对白
      : (defaults && defaults.ui && defaults.ui.noGreeting
        ? [{ role: 'system', content: defaults.ui.noGreeting, ts: Date.now() }]
        : []);
    saveSessions(); renderMessages(); renderSessions();
  });
  // 文件导入（配置 / 角色卡）
  const cfgFileInput = document.createElement('input');
  cfgFileInput.type = 'file';
  cfgFileInput.accept = '.json,application/json';
  cfgFileInput.style.display = 'none';
  cfgFileInput.addEventListener('change', () => {
    if (cfgFileInput.files[0]) importSettingsFromFile(cfgFileInput.files[0]);
    cfgFileInput.value = '';
  });
  document.body.appendChild(cfgFileInput);
  $('btn-import').addEventListener('dblclick', () => cfgFileInput.click());
  $('btn-import').title = '单击：粘贴 JSON；双击：选择文件';
  const charFileInput = document.createElement('input');
  charFileInput.type = 'file';
  charFileInput.accept = '.json,application/json';
  charFileInput.style.display = 'none';
  charFileInput.addEventListener('change', () => {
    if (!charFileInput.files[0]) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { importCharFromText(reader.result); alert('✅ 角色卡已导入'); }
      catch (err) { alert('❌ 导入失败：' + err.message); }
    };
    reader.readAsText(charFileInput.files[0]);
    charFileInput.value = '';
  });
  document.body.appendChild(charFileInput);
  // 回到对话
  document.querySelectorAll('[data-back-chat]').forEach(b =>
    b.addEventListener('click', () => switchView('chat')));
  // 载入示例数据
  $('btn-seed').addEventListener('click', async () => {
    const changed = await seedExamples(true);
    alert(changed ? '✅ 已载入示例数据（角色「莉莉」/ 世界书条目 / 提示词预设）' : '示例数据已存在');
    renderCharList();
    renderCharacter();
  });
}

/* 服务预设 / 格式指令下拉：从 JSON 数据动态渲染，不写死选项 */
function renderProviderOptions() {
  const sel = $('s-preset');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">—— 自定义 ——</option>'
    + providers.map(p => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('');
  sel.value = cur;
}
function renderFormatOptions() {
  const sel = $('f-preset');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">自由对话（无附加指令）</option>'
    + Object.entries(formatInstructions).map(([k, v]) =>
      `<option value="${esc(k)}">${esc((v && v.label) || k)}</option>`).join('');
  sel.value = cur;
}

/* ─────────── 启动 ─────────── */
async function init() {
  // 从 server 加载默认模板（服务预设 / 格式指令 / 偏好 / 示例），失败回退空结构
  defaults = await fetchSeedTemplate();
  if (!defaults) defaults = { characters: [], presets: {}, lorebooks: {}, settings: {}, prefs: {}, format: {}, providers: [] };
  providers = Array.isArray(defaults.providers) ? defaults.providers : [];
  formatInstructions = (defaults.format && typeof defaults.format === 'object') ? defaults.format : {};

  settings = { ...DEFAULT_SETTINGS, ...settings };
  prefs = { ...(defaults.prefs || {}), ...prefs };

  // 从 server 加载 JSON 数据（失败回退本地缓存）
  const [chars, presets, lore, s, u] = await Promise.all([
    loadServerData('characters'),
    loadServerData('presets'),
    loadServerData('lorebooks'),
    loadServerData('settings'),
    loadServerData('user'),
  ]);
  if (chars && Array.isArray(chars)) characters = chars;
  if (presets && typeof presets === 'object') promptPresets = presets;
  if (lore && typeof lore === 'object') lorebooks = lore;
  if (u && typeof u === 'object' && u.presets) userData = u;
  if (s && typeof s === 'object') settings = { ...DEFAULT_SETTINGS, ...s };

  // 迁移：_defaults 新增的示例预设自动并入（不覆盖用户已修改的同名预设）
  if (defaults && defaults.presets && typeof defaults.presets === 'object') {
    let changed = false;
    for (const k of Object.keys(defaults.presets)) {
      if (promptPresets[k] === undefined) {
        promptPresets[k] = defaults.presets[k];
        changed = true;
      }
    }
    if (changed) savePresets();
  }

  renderProviderOptions();
  renderFormatOptions();

  ensureChars();
  ensureLorebooks();
  ensureEntryIds();
  // 清理旧版遗留的纯占位角色
  if (characters.length && characters.every(c => !c.name || c.name === '？？？')) {
    characters = [];
    currentCharId = null;
    localStorage.removeItem(LS_CURRENT_CHAR);
    saveChars();
  }
  await seedExamples(false);
  const presetsMigrated = ensurePromptPresetsV2();
  prefs.currentPresetByMode = { ...(prefs.currentPresetByMode || {}) };
  for (const targetMode of ['tavern', 'rpg']) {
    const hasSavedPreset = Object.prototype.hasOwnProperty.call(prefs.currentPresetByMode, targetMode);
    const savedPreset = prefs.currentPresetByMode[targetMode];
    if (!hasSavedPreset || (savedPreset && !promptPresets[savedPreset])) prefs.currentPresetByMode[targetMode] = activePresetNameForMode(targetMode);
  }
  prefs.currentPreset = prefs.currentPresetByMode[mode] || '';
  saveJSON(LS_PREFS, prefs);
  if (presetsMigrated) savePresets();
  ensureSessions();
  applyTheme();
  applyMode(mode);
  bindEvents();
  renderMessages();
  renderCharacter();
  renderSessions();
  renderCharList();
  updateApiStatusFromSettings();
}
init();
