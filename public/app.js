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
const LS_SESSIONS_DELETED = 'rpg-airp:sessions-deleted';
const LS_LORE = 'rpg-airp:lore';
const LS_USER = 'rpg-airp:user';
const LS_PRESETS = 'rpg-airp:prompt-presets';
const LS_PREFS = 'rpg-airp:prefs';
const LS_GEN = 'rpg-airp:gen';
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
  temperature: 0.9, maxTokens: 32000,
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
  if (mode === 'rpg') {
    if (!worldModeActive()) return 'RPG 模式不读取普通角色卡，请先从世界库创建或打开世界存档。';
    return String(ui.rpgEmptyGuide || '当前存档：{save}。RPG 叙事只读取这条世界线。')
      .replace('{save}', currentWorldSave?.name || currentWorldSaveId || '当前世界存档');
  }
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
  if (mode === 'rpg') return worldModeActive() ? (ui.rpgEmptyTitle || '世界线已绑定') : '请先选择世界存档';
  return ui.emptyTitle || '';
}

/* ─────────── 状态 ─────────── */
let settings = loadJSON(LS_SETTINGS, DEFAULT_SETTINGS);
let prefs = loadJSON(LS_PREFS, null) || {}; // 默认值来自 _defaults.json 的 prefs 段
let profiles = loadJSON(LS_PROFILES, {});
let characters = loadJSON(LS_CHARS, []);
let currentCharId = localStorage.getItem(LS_CURRENT_CHAR);
let sessions = loadJSON(LS_SESSIONS, null);
let sessionsDeleted = loadJSON(LS_SESSIONS_DELETED, []); // 已删会话 ID 墓碑，跨浏览器同步时防止复活
if (!Array.isArray(sessionsDeleted)) sessionsDeleted = [];
let currentSessionId = null;
let lorebooks = null; // { id: { name, entries: [] } }
let userData = loadJSON(LS_USER, null); // { currentPreset, presets: {...}, memories: [] }
let promptPresets = loadJSON(LS_PRESETS, {});
const storedGenSettings = loadJSON(LS_GEN, null);
let genSettings = storedGenSettings && typeof storedGenSettings === 'object' && !Array.isArray(storedGenSettings) ? storedGenSettings : {};
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
let worldSummaryPending = false;
let worldTurnError = null;
let worldTurnPreparing = false;
let worldTurnEpoch = 0;
let worldDraft = null;
let worldDraftDirty = false;
let worldDraftOpener = null;
let worldDraftChoiceOpener = null;
let worldDraftPublishId = null;
let worldPlayerOpener = null;
let pendingWorldSaveName = '';
let pendingWorldSaveButton = null;
let pendingWorldPlayerPresetId = '';
let editingWorldPlayerSaveId = null;
let worldEntryGatePending = null;
let worldEntryGateBypass = false;
let worldImmersiveSession = false;
let worldSetupAutosaveTimer = null;
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
let debugTab = 'output';
const devtoolsEnabled = typeof location !== 'undefined' && /(?:^|[?&])dev=1(?:&|$)/.test(location.search || '');
let devtoolsScenarios = [];
let cmEditingId = null;
let cmCreating = false;
let wiEditingId = null;
let lbEditingId = null;
let pgEditingName = null;
let pgEditingPreset = null;
let pgEditingPromptId = null;
let regexEditingId = null;
let regexEditingSource = 'custom';
let rpgDrawerReturnFocus = null;
const serverDataWriteQueues = new Map();
const WORLD_EXTENSION_CHANNEL = 'tavern.rpg.extension';
let worldExtensionState = { iframe: null, nonce: '', signature: '', ready: false, timer: null, pending: new Map(), nextRequestId: 0 };
const worldExtensionDeniedApprovals = new Set();
const cardScriptDeniedApprovals = new Set();

/* ─────────── 数据加载 / 保存（JSON 文件存储） ─────────── */
function saveSettings() {
  localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
  saveServerData('settings', settings);
}
function saveGenerationSettings() {
  localStorage.setItem(LS_GEN, JSON.stringify(genSettings));
  saveServerData('gen', genSettings);
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
  const previous = serverDataWriteQueues.get(type) || Promise.resolve();
  const write = async () => {
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
  };
  // 首次写入立即发起；后续写入接在同一类型的前一个请求之后，避免旧快新慢覆盖。
  const current = serverDataWriteQueues.has(type) ? previous.catch(() => {}).then(write) : write();
  serverDataWriteQueues.set(type, current);
  current.finally(() => {
    if (serverDataWriteQueues.get(type) === current) serverDataWriteQueues.delete(type);
  });
  return current;
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
async function downloadBlob(blob, filename) {
  const bridge = window.TavernAndroid;
  if (bridge && typeof bridge.saveFile === 'function') {
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('导出文件读取失败'));
        reader.readAsDataURL(blob);
      });
      const comma = dataUrl.indexOf(',');
      if (comma > 0 && bridge.saveFile(filename, blob.type || 'application/octet-stream', dataUrl.slice(comma + 1)) !== false) return true;
    } catch { /* 原生桥不可用时回退浏览器下载 */ }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return false;
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function currentChar() { return characters.find(c => c.id === currentCharId) || null; }
function sessionMatches(s) { return !!s && s.charId === currentCharId && s.kind === mode; }

/* ─────────── 世界库 / 世界存档（W2：RPG 主链由当前 WorldSave 持有） ─────────── */
function worldCardById(id) { return worldCards.find(w => w.id === id) || null; }
function worldCardKey(id, version) { return `${id}@${version}`; }
function currentWorldCard() {
  const version = currentWorldSave && currentWorldSave.worldVersion;
  const summary = worldCardById(currentWorldId);
  const targetVersion = version === undefined || version === null ? summary?.version : version;
  return worldCardVersions.get(worldCardKey(currentWorldId, targetVersion)) || summary;
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
function worldSavePlanning(save = currentWorldSave) { return !!save && save.setup?.status === 'planning'; }
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
  if (!data.setup || typeof data.setup !== 'object') data.setup = { status: 'active', plan: null, candidate: null };
  if (!['planning', 'active'].includes(data.setup.status)) data.setup.status = 'active';
  if (!data.setup.game || typeof data.setup.game !== 'object') data.setup.game = {};
  if (data.setup.plan === undefined) data.setup.plan = null;
  if (data.setup.candidate === undefined) data.setup.candidate = null;
  if (!Array.isArray(data.turns)) data.turns = [];
  if (data.state.ending === undefined) data.state.ending = null;
  if (!Array.isArray(data.state.activeHooks)) data.state.activeHooks = [];
  if (data.worldLineSummary === undefined) data.worldLineSummary = null;
  if (data.reopenInfo === undefined) data.reopenInfo = null;
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
  if (currentWorldSave.setup?.status !== 'planning' && currentWorldSave.opening) result.push({ role: 'assistant', content: currentWorldSave.opening, ts: currentWorldSave.createdAt || Date.now(), _opening: true });
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
  pending.agentCalls = null;
  pending.agentToolTrace = null;
  pending.patch = null;
  pending.agentPhase = null;
  pending.agentPhaseHistory = [];
  pending.agentOrchestration = null;
  pending.agentExecution = null;
  pending.state = cloneValue(pending.beforeState);
  if (currentWorldSave && pending.saveId === currentWorldSaveId) {
    currentWorldSave.state = cloneValue(pending.beforeState);
    hydrateWorldSave(currentWorldSave);
  }
}
function cancelWorldAgentExecution(pending) {
  if (!pending?.agentExecution) return;
  fetch('/api/world-saves/' + encodeURIComponent(pending.saveId) + '/agent-cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ commandId: pending.commandId, expectedRevision: pending.expectedRevision }),
  }).catch(err => console.warn('[Tavern] Agent pending 清理失败:', err.message));
}
function discardWorldTurnPending() {
  const pending = worldTurnPending;
  cancelWorldAgentExecution(pending);
  worldTurnPending = null;
  worldTurnError = null;
  worldTurnEpoch++;
  resetWorldTurnPending(pending);
  renderMessages();
}
function failWorldTurnPending(message) {
  if (!worldTurnPendingActive()) return false;
  if (!worldTurnPending.agentExecution) resetWorldTurnPending(worldTurnPending);
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
  const retryAgentNarration = !!worldTurnPending.agentExecution;
  if (!retryAgentNarration) resetWorldTurnPending(worldTurnPending);
  worldTurnEpoch++;
  renderMessages();
  if (retryAgentNarration) {
    try { await submitWorldTurn(worldTurnPending); }
    catch (err) { failWorldTurnPending(err.message); }
    return;
  }
  worldTurnPreparing = true;
  try { await requestReply(); }
  finally { worldTurnPreparing = false; }
}
async function resumeWorldAgentNarration() {
  if (!worldTurnPendingActive() || !worldTurnPending.agentExecution || sending || worldTurnPreparing) return;
  worldTurnPreparing = true;
  try { await submitWorldTurn(worldTurnPending); }
  catch (err) { failWorldTurnPending(err.message); }
  finally { worldTurnPreparing = false; }
}
async function submitWorldTurn(pending) {
  const endpoint = '/api/world-saves/' + encodeURIComponent(pending.saveId);
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  const request = async (url, body, label) => {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const staleServerHint = res.status === 405 && /\/agent-execute\/?$/.test(url)
        ? '；当前 3000 端口可能仍运行旧版 server.js，请停止旧进程后重新启动服务'
        : '';
      throw new Error(worldApiError(data, `${label}（HTTP ${res.status}）`) + staleServerHint);
    }
    return data;
  };
  let data;
  if (pending.patch) {
    if (!pending.agentExecution) {
      setDebugTrace(activeConversationScope(), { status: 'Agent 执行阶段' });
      data = await request(endpoint + '/agent-execute', {
        commandId: pending.commandId,
        expectedRevision: pending.expectedRevision,
        patch: { ...cloneValue(pending.patch), baseRevision: pending.expectedRevision },
        createEntities: pending.createEntities || undefined,
        eventMemory: pending.eventMemory || undefined,
        agentCalls: pending.agentCalls || undefined,
        agentToolTrace: pending.agentToolTrace || undefined,
        actionIntent: pending.actionIntent,
        turns: cloneValue(pending.messages),
        options: pending.options || [],
      }, 'Agent 执行阶段失败');
      pending.agentExecution = data.execution || data.agentRuntime?.pending || null;
      pending.agentPhase = pending.agentExecution?.phase || 'narrate';
      pending.agentPhaseHistory = Array.isArray(pending.agentExecution?.phaseHistory)
        ? cloneValue(pending.agentExecution.phaseHistory) : [];
      pending.agentOrchestration = pending.agentExecution?.orchestration
        ? cloneValue(pending.agentExecution.orchestration) : null;
      postWorldExtensionEvent('agent.execute', {
        commandId: pending.commandId,
        phase: pending.agentExecution?.phase || 'narrate',
        revision: Number.isSafeInteger(data.revision) ? data.revision : pending.expectedRevision,
      });
    }
    setDebugTrace(activeConversationScope(), { status: 'Agent 叙事阶段' });
    data = await request(endpoint, {
      agentPhase: 'narrate',
      commandId: pending.commandId,
      pendingCommandId: pending.commandId,
      expectedRevision: pending.expectedRevision,
      turns: cloneValue(pending.messages),
      options: pending.options,
    }, 'Agent 叙事阶段失败');
  } else {
    data = await request(endpoint, {
      commandId: pending.commandId,
      expectedRevision: pending.expectedRevision,
      turns: cloneValue(pending.messages),
      options: pending.options,
      createEntities: pending.createEntities || undefined,
      eventMemory: pending.eventMemory || undefined,
      agentCalls: pending.agentCalls || undefined,
      agentToolTrace: pending.agentToolTrace || undefined,
      actionIntent: pending.actionIntent,
      state: pending.state,
    }, '世界回合提交失败');
  }
  if (!worldTurnPendingActive() || pending.commandId !== worldTurnPending.commandId) {
    if (worldTurnPending === pending) { worldTurnPending = null; worldTurnEpoch++; }
    return;
  }
  hydrateWorldSave(data);
  currentWorldSave = data;
  currentWorldSaveId = data.id;
  postWorldExtensionEvent('turn.commit', { commandId: pending.commandId, revision: data.revision });
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
  if (!save || !worldModeActive() || save !== currentWorldSave || worldTurnPendingActive() || worldSavePlanning(save)) return worldSaveWriteChain;
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
  syncModeNavigation('chat');
  closeWorldLibrary();
  if (!worldSavePlanning() && worldCardUsesImmersive()) enterWorldImmersiveMode({ fullscreen: false });
  else exitWorldImmersiveMode();
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
function clearWorldDraftCheckReport() {
  const report = $('world-draft-check-report');
  if (!report) return;
  report.hidden = true;
  report.replaceChildren();
  delete report.dataset.ready;
}
function focusWorldDraftCheckTarget(targetId) {
  const target = $(targetId) || $('world-draft-check-report');
  if (!target) return;
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (!/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName)) target.tabIndex = -1;
  target.focus({ preventScroll: true });
}
function renderWorldDraftCheckReport(report, { focus = false } = {}) {
  const host = $('world-draft-check-report');
  if (!host) return;
  const errors = Array.isArray(report?.errors) ? report.errors : [];
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  host.hidden = false;
  host.dataset.ready = errors.length === 0 ? 'true' : 'false';
  const summary = document.createElement('p');
  summary.className = 'world-draft-check-summary';
  const passed = checks.filter(check => check?.ok).length;
  summary.textContent = errors.length ? `发布被阻止：${errors.length} 项问题需要处理。` : `发布检查通过：${passed}/${checks.length} 项契约已确认。`;
  host.replaceChildren(summary);
  if (!errors.length) {
    const detail = document.createElement('p');
    detail.className = 'world-draft-check-pass';
    detail.textContent = '起点、稳定引用、开局运行态和 Prompt 注入均可用。';
    host.append(detail);
    return;
  }
  const list = document.createElement('ol');
  list.className = 'world-draft-check-list';
  for (const issue of errors) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.worldDraftCheckTarget = issue?.target || '';
    button.textContent = issue?.message || '发布检查失败';
    item.append(button);
    list.append(item);
  }
  host.append(list);
  if (focus) focusWorldDraftCheckTarget(errors[0]?.target);
}
async function checkWorldDraftPublishability({ save = true, focus = false } = {}) {
  if (!worldDraft || !$('world-draft-form').reportValidity()) return false;
  if (save && worldDraftDirty && !await saveWorldDraft()) return false;
  setWorldDraftStatus('正在检查发布条件…');
  try {
    const res = await fetch('/api/world-drafts/' + encodeURIComponent(worldDraft.worldId) + '/check');
    const report = await res.json().catch(() => null);
    if (!res.ok) throw new Error(worldApiError(report, '发布检查失败（HTTP ' + res.status + '）'));
    renderWorldDraftCheckReport(report, { focus });
    if (!report?.ready) {
      setWorldDraftStatus(`发布检查发现 ${Array.isArray(report?.errors) ? report.errors.length : 1} 项问题。`, 'error');
      return false;
    }
    setWorldDraftStatus(`发布检查通过，可发布 v${report.nextVersion}。`, 'ok');
    return true;
  } catch (err) {
    setWorldDraftStatus(err.message, 'error');
    return false;
  }
}
function setWorldDraftJsonRawState(target, state = '') {
  const raw = typeof target === 'string' ? $(target) : target;
  if (!raw) return;
  raw.classList.toggle('world-draft-json-valid', state === 'valid');
  raw.classList.toggle('world-draft-json-invalid', state === 'invalid');
  if (state === 'invalid') raw.setAttribute('aria-invalid', 'true');
  else raw.removeAttribute('aria-invalid');
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
    <label class="field"><span>主动行动模板（JSON，可选）</span><textarea data-npc-actions rows="5" spellcheck="false" placeholder='[{"id":"patrol","title":"巡逻","description":"沿街巡逻。","trigger":{"afterTurns":2},"changes":{"statusAdd":["巡逻中"]}}]'>${esc(Array.isArray(npc.actions) && npc.actions.length ? JSON.stringify(npc.actions, null, 2) : '')}</textarea></label>
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
    const location = worldDraft.world.locations[index];
    if (location?.id && blockWorldDraftDelete('locations', location.id, '地点')) return;
    worldDraft.world.locations.splice(index, 1);
    worldDraftDirty = true;
    renderWorldDraftCollections(worldDraft.world);
  }));
  npcList?.querySelectorAll('[data-remove-npc]').forEach(button => button.addEventListener('click', () => {
    syncWorldDraftCollectionsFromForm();
    const index = Number(button.closest('[data-index]')?.dataset.index);
    const npc = worldDraft.world.npcs[index];
    if (npc?.id && blockWorldDraftDelete('npcs', npc.id, 'NPC')) return;
    worldDraft.world.npcs.splice(index, 1);
    worldDraftDirty = true;
    renderWorldDraftCollections(worldDraft.world);
  }));
}
function syncWorldDraftCollectionsFromForm() {
  if (!worldDraft) return;
  const collected = collectWorldDraftCollections();
  if (collected.error) return collected;
  const { locations, npcs } = collected;
  worldDraft.world.locations = locations;
  worldDraft.world.npcs = npcs;
  return collected;
}
function worldDraftReferenceReport(kind, id) {
  if (!worldDraft || !id) return [];
  const world = worldDraft.world || {};
  const refs = [];
  const push = (value, path) => { if (value === id) refs.push(path); };
  const pushObjectKeys = (value, path) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, id)) refs.push(`${path}.${id}`);
  };
  if (kind === 'locations') {
    push(world.start?.locationId, 'start.locationId');
    (Array.isArray(world.npcs) ? world.npcs : []).forEach((npc, index) => {
      push(npc?.locationId, `npcs[${index}].locationId`);
      push(npc?.homeLocationId, `npcs[${index}].homeLocationId`);
    });
    (Array.isArray(world.events) ? world.events : []).forEach((event, index) => push(event?.trigger?.locationId, `events[${index}].trigger.locationId`));
    (Array.isArray(world.factions) ? world.factions : []).forEach((faction, factionIndex) => (Array.isArray(faction?.actions) ? faction.actions : []).forEach((action, actionIndex) => push(action?.trigger?.locationId, `factions[${factionIndex}].actions[${actionIndex}].trigger.locationId`)));
  } else if (kind === 'npcs') {
    (Array.isArray(world.playerCreation?.relations) ? world.playerCreation.relations : []).forEach((relation, index) => push(relation?.npcId, `playerCreation.relations[${index}].npcId`));
    (Array.isArray(world.playerCreation?.growth?.candidates) ? world.playerCreation.growth.candidates : []).forEach((candidate, index) => {
      if (candidate?.bucket === 'relations') push(candidate?.targetId, `playerCreation.growth.candidates[${index}].targetId`);
    });
  } else if (kind === 'factions') {
    (Array.isArray(world.playerCreation?.growth?.candidates) ? world.playerCreation.growth.candidates : []).forEach((candidate, index) => {
      if (candidate?.bucket === 'factions') push(candidate?.targetId, `playerCreation.growth.candidates[${index}].targetId`);
    });
    pushObjectKeys(world.start?.initialState?.factionStates, 'start.initialState.factionStates');
  } else if (kind === 'conflicts') {
    const states = world.start?.initialState?.conflicts;
    if (states && typeof states === 'object' && !Array.isArray(states)) Object.entries(states).forEach(([stateId, state]) => push(state?.templateId, `start.initialState.conflicts.${stateId}.templateId`));
  } else if (kind === 'failureModes') {
    for (const key of ['defaultMode', 'onZeroHp', 'onConflictDefeat']) push(world.failure?.[key], `failure.${key}`);
  } else if (kind === 'endingEndings') {
    push(world.ending?.defaultEndingId, 'ending.defaultEndingId');
  } else if (kind === 'growthSources') {
    (Array.isArray(world.playerCreation?.growth?.candidates) ? world.playerCreation.growth.candidates : []).forEach((candidate, index) => push(candidate?.sourceId, `playerCreation.growth.candidates[${index}].sourceId`));
  } else if (kind === 'growthCandidates') {
    const initial = world.start?.initialState || {};
    for (const [bucket, values] of Object.entries(initial)) {
      if (!Array.isArray(values)) continue;
      values.forEach((value, index) => push(value?.candidateId, `start.initialState.${bucket}[${index}].candidateId`));
    }
  } else if (['fields', 'attributes', 'skills', 'resources', 'traits'].includes(kind)) {
    const prefix = `${kind}.${id}`;
    (Array.isArray(world.playerCreation?.derived) ? world.playerCreation.derived : []).forEach((definition, index) => {
      if (typeof definition?.formula === 'string' && definition.formula.includes(prefix)) refs.push(`playerCreation.derived[${index}].formula`);
    });
    (Array.isArray(world.playerCreation?.growth?.candidates) ? world.playerCreation.growth.candidates : []).forEach((candidate, index) => {
      if (candidate?.bucket === kind && candidate?.targetId === id) refs.push(`playerCreation.growth.candidates[${index}].targetId`);
    });
    (Array.isArray(world.conflicts) ? world.conflicts : []).forEach((conflict, conflictIndex) => (Array.isArray(conflict?.actions) ? conflict.actions : []).forEach((action, actionIndex) => {
      for (const check of [{ path: 'check', value: action?.check }, { path: 'check.damage', value: action?.check?.damage }]) {
        if (check.value?.modifier?.bucket === kind && check.value.modifier.id === id) refs.push(`conflicts[${conflictIndex}].actions[${actionIndex}].${check.path}.modifier.id`);
      }
    }));
  }
  return [...new Set(refs)];
}
function blockWorldDraftDelete(kind, id, label) {
  const refs = worldDraftReferenceReport(kind, id);
  if (!refs.length) return false;
  const shown = refs.slice(0, 3).join('、');
  const suffix = refs.length > 3 ? ` 等 ${refs.length} 处` : '';
  setWorldDraftStatus(`${label || kind}「${id}」仍被引用：${shown}${suffix}。请先移除引用。`, 'error');
  return true;
}
function worldDraftDuplicateIdReport(world) {
  const collections = [
    ['地点', world?.locations], ['NPC', world?.npcs], ['事件', world?.events], ['派系', world?.factions], ['冲突', world?.conflicts],
    ['身份字段', world?.playerCreation?.fields], ['属性', world?.playerCreation?.attributes], ['技能', world?.playerCreation?.skills],
    ['资源', world?.playerCreation?.resources], ['特质', world?.playerCreation?.traits], ['成长来源', world?.playerCreation?.growth?.sources],
    ['成长候选', world?.playerCreation?.growth?.candidates], ['失败模式', world?.failure?.modes], ['结局', world?.ending?.endings],
  ];
  for (const [label, values] of collections) {
    if (!Array.isArray(values)) continue;
    const seen = new Set();
    for (const item of values) {
      const id = typeof item?.id === 'string' ? item.id.trim() : '';
      if (id && seen.has(id)) return { label, id };
      if (id) seen.add(id);
    }
  }
  return null;
}
const WORLD_DRAFT_PLAYER_BUCKETS = [
  { key: 'fields', label: '身份字段', template: () => ({ id: 'field-' + uid(), label: '新字段', type: 'text', required: false, default: '' }) },
  { key: 'attributes', label: '属性', template: () => ({ id: 'attribute-' + uid(), label: '新属性', min: 0, max: 100, step: 1, default: 0 }) },
  { key: 'skills', label: '技能', template: () => ({ id: 'skill-' + uid(), label: '新技能', description: '', min: 0, max: 100, step: 1, default: 0 }) },
  { key: 'resources', label: '资源', template: () => ({ id: 'resource-' + uid(), label: '新资源', type: 'number', min: 0, max: 100, initial: 0 }) },
  { key: 'traits', label: '特质', template: () => ({ id: 'trait-' + uid(), label: '新特质', description: '' }) },
];
function worldDraftPlayerSchema() {
  const value = worldDraft?.world?.playerCreation;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function worldDraftPlayerItemText(item) {
  return JSON.stringify(item, null, 2) ?? '';
}
function worldDraftPlayerPreview() {
  const preview = $('world-draft-player-preview');
  if (preview) preview.textContent = JSON.stringify(worldDraftPlayerSchema(), null, 2);
}
function worldDraftPlayerRawMatchesEditor() {
  const raw = $('world-draft-player-creation');
  if (!raw) return true;
  const schema = worldDraftPlayerSchema();
  const expected = Object.keys(schema).length ? JSON.stringify(schema, null, 2) : '';
  return raw.value.trim() === expected;
}
function requireWorldDraftPlayerRawSync() {
  if (worldDraftPlayerRawMatchesEditor()) return true;
  setWorldDraftStatus('高级 JSON 有未载入修改，请先点击“从高级 JSON 载入编辑器”。', 'error');
  $('world-draft-player-creation')?.focus();
  return false;
}
function worldDraftPlayerCreationTemplate(bucket, index, item) {
  const title = WORLD_DRAFT_PLAYER_BUCKETS.find(definition => definition.key === bucket)?.label || bucket;
  return `<article class="world-draft-entry world-draft-player-entry" data-player-entry data-player-bucket="${esc(bucket)}" data-player-index="${index}">
    <div class="world-draft-entry-head"><strong>${esc(title)} ${index + 1}</strong><div class="world-draft-player-actions">
      <button class="ghost-btn small" type="button" data-player-move="up" aria-label="上移">↑</button>
      <button class="ghost-btn small" type="button" data-player-move="down" aria-label="下移">↓</button>
      <button class="ghost-btn small danger" type="button" data-player-remove>删除</button>
    </div></div>
    <textarea class="world-draft-player-json" data-player-json rows="6" spellcheck="false" aria-label="${esc(title)} ${index + 1} JSON">${esc(worldDraftPlayerItemText(item))}</textarea>
    <p class="world-draft-player-error" data-player-error role="status"></p>
  </article>`;
}
function renderWorldDraftPlayerCreation() {
  const schema = worldDraftPlayerSchema();
  const host = $('world-draft-player-schema');
  if (host) {
    host.innerHTML = WORLD_DRAFT_PLAYER_BUCKETS.map(({ key, label }) => {
      const entries = Array.isArray(schema[key]) ? schema[key] : [];
      return `<section class="world-draft-collection world-draft-player-collection" data-player-collection="${esc(key)}">
        <div class="world-draft-collection-head"><div><h3>${esc(label)}</h3><p>可添加、删除、排序；复杂字段可直接编辑 JSON。</p></div><button class="ghost-btn small" type="button" data-player-add="${esc(key)}">＋${esc(label)}</button></div>
        <div class="world-draft-collection-list">${entries.length ? entries.map((item, index) => worldDraftPlayerCreationTemplate(key, index, item)).join('') : `<p class="world-draft-empty">暂无${esc(label)}，点击“＋${esc(label)}”添加。</p>`}</div>
      </section>`;
    }).join('');
  }
  const raw = $('world-draft-player-creation');
  if (raw) {
    raw.value = Object.keys(schema).length ? JSON.stringify(schema, null, 2) : '';
    setWorldDraftJsonRawState(raw);
  }
  worldDraftPlayerPreview();
}
function syncWorldDraftPlayerCreationFromForm({ showError = false } = {}) {
  if (!worldDraft) return { ok: true, value: null };
  const current = worldDraftPlayerSchema();
  const next = cloneValue(current);
  for (const { key } of WORLD_DRAFT_PLAYER_BUCKETS) {
    const rows = [...document.querySelectorAll(`#world-draft-player-schema [data-player-entry][data-player-bucket="${key}"]`)]
      .sort((a, b) => Number(a.dataset.playerIndex) - Number(b.dataset.playerIndex));
    const values = [];
    let invalid = false;
    for (const row of rows) {
      const error = row.querySelector('[data-player-error]');
      try {
        const value = JSON.parse(row.querySelector('[data-player-json]')?.value || '');
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('必须是 JSON 对象');
        values.push(value);
        if (error) { error.textContent = ''; error.hidden = true; }
      } catch (err) {
        invalid = true;
        if (error) { error.textContent = err.message || 'JSON 无效'; error.hidden = false; }
        if (showError) return { ok: false, error: `${key} 中有无效 JSON`, focus: row.querySelector('[data-player-json]') };
      }
    }
    if (invalid) return { ok: false, error: `${key} 中有无效 JSON` };
    next[key] = values;
  }
  if (Object.keys(next).length) {
    if (!next.mode) next.mode = 'custom';
    worldDraft.world.playerCreation = next;
  } else {
    worldDraft.world.playerCreation = null;
  }
  const raw = $('world-draft-player-creation');
  if (raw) {
    raw.value = worldDraft.world.playerCreation ? JSON.stringify(worldDraft.world.playerCreation, null, 2) : '';
    setWorldDraftJsonRawState(raw);
  }
  worldDraftPlayerPreview();
  return { ok: true, value: worldDraft.world.playerCreation };
}
function validateWorldDraftPlayerCreationJson() {
  const raw = $('world-draft-player-creation');
  if (!raw) return { ok: false, error: '找不到玩家创建规则 JSON' };
  const text = raw.value.trim();
  try {
    const value = text ? JSON.parse(text) : null;
    if (value !== null && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error('必须是 JSON 对象');
    setWorldDraftJsonRawState(raw, 'valid');
    setWorldDraftStatus('玩家创建规则 JSON 有效；点击“载入编辑器”后才会替换可视化草稿。', 'ok');
    return { ok: true, value };
  } catch (err) {
    setWorldDraftJsonRawState(raw, 'invalid');
    setWorldDraftStatus(`玩家创建规则 JSON 无效：${err.message || '格式错误'}`, 'error');
    return { ok: false, error: err.message || 'JSON 无效', focus: raw };
  }
}
function loadWorldDraftPlayerCreationJson() {
  const raw = $('world-draft-player-creation');
  if (!raw || !worldDraft) return;
  const result = validateWorldDraftPlayerCreationJson();
  if (!result.ok) {
    result.focus?.focus();
    return;
  }
  if (!result.value) {
    worldDraft.world.playerCreation = null;
    renderWorldDraftPlayerCreation();
    worldDraftDirty = true;
    setWorldDraftStatus('已从高级 JSON 清空玩家创建规则。', 'ok');
    return;
  }
  worldDraft.world.playerCreation = result.value;
  renderWorldDraftPlayerCreation();
  worldDraftDirty = true;
  setWorldDraftStatus('已从高级 JSON 载入玩家创建规则。', 'ok');
}
function handleWorldDraftPlayerCreationClick(event) {
  const button = event.target.closest('button');
  if (!button) return;
  const host = $('world-draft-player-schema');
  if (!host || !worldDraft) return;
  const bucket = button.dataset.playerAdd;
  if (bucket) {
    const definition = WORLD_DRAFT_PLAYER_BUCKETS.find(item => item.key === bucket);
    if (!definition) return;
    if (!requireWorldDraftPlayerRawSync()) return;
    if (!syncWorldDraftPlayerCreationFromForm().ok) return;
    const schema = worldDraftPlayerSchema();
    if (!Array.isArray(schema[bucket])) schema[bucket] = [];
    schema[bucket].push(definition.template());
    schema.mode ||= 'custom';
    worldDraft.world.playerCreation = schema;
    worldDraftDirty = true;
    renderWorldDraftPlayerCreation();
    host.querySelector(`[data-player-bucket="${bucket}"] [data-player-entry]:last-child [data-player-json]`)?.focus();
    return;
  }
  const row = button.closest('[data-player-entry]');
  if (!row) return;
  const rowBucket = row.dataset.playerBucket;
  const index = Number(row.dataset.playerIndex);
  if (!requireWorldDraftPlayerRawSync()) return;
  if (!syncWorldDraftPlayerCreationFromForm().ok) return;
  const schema = worldDraftPlayerSchema();
  if (!Array.isArray(schema[rowBucket])) return;
  const values = schema[rowBucket];
  if (button.hasAttribute('data-player-remove')) {
    const id = values[index]?.id;
    if (id && blockWorldDraftDelete(rowBucket, id, WORLD_DRAFT_PLAYER_BUCKETS.find(definition => definition.key === rowBucket)?.label || rowBucket)) return;
    values.splice(index, 1);
  }
  if (button.dataset.playerMove === 'up' && index > 0) [values[index - 1], values[index]] = [values[index], values[index - 1]];
  if (button.dataset.playerMove === 'down' && index < values.length - 1) [values[index + 1], values[index]] = [values[index], values[index + 1]];
  worldDraftDirty = true;
  renderWorldDraftPlayerCreation();
}
const WORLD_DRAFT_JSON_ARRAY_DEFS = [
  { key: 'events', label: '世界事件', validateId: 'world-draft-events-validate-json', template: () => ({ id: 'event-' + uid(), title: '新事件', description: '', trigger: { afterTurns: 1 }, visibility: 'public', once: true, consequences: [] }) },
  { key: 'factions', label: '派系', validateId: 'world-draft-factions-validate-json', template: () => ({ id: 'faction-' + uid(), name: '新派系', description: '', goals: [], resources: [], actions: [] }) },
  { key: 'conflicts', label: '冲突模板', validateId: 'world-draft-conflicts-validate-json', template: () => ({ id: 'conflict-' + uid(), label: '新冲突', type: 'custom', description: '', phases: [], actions: [], outcomes: [] }) },
  { key: 'failureModes', label: '失败模式', parentKey: 'failure', nestedKey: 'modes', rawId: 'world-draft-failure', editorId: 'world-draft-failure-modes-editor', previewId: 'world-draft-failure-modes-preview', loadId: 'world-draft-failure-load-modes-json', validateId: 'world-draft-failure-validate-modes-json', template: () => ({ id: 'failure-' + uid(), label: '新失败模式', description: '', effect: '' }) },
  { key: 'endingEndings', label: '结局条目', parentKey: 'ending', nestedKey: 'endings', rawId: 'world-draft-ending', editorId: 'world-draft-ending-endings-editor', previewId: 'world-draft-ending-endings-preview', loadId: 'world-draft-ending-load-endings-json', validateId: 'world-draft-ending-validate-endings-json', template: () => ({ id: 'ending-' + uid(), kind: 'card-defined', label: '新结局', description: '', terminal: true }) },
  { key: 'growthSources', label: '成长来源', parentKey: 'playerCreation', nestedKey: 'growth.sources', rawId: 'world-draft-player-creation', editorId: 'world-draft-growth-sources-editor', previewId: 'world-draft-growth-sources-preview', loadId: 'world-draft-player-load-growth-sources-json', validateId: 'world-draft-player-validate-growth-sources-json', template: () => ({ id: 'growth-source-' + uid(), label: '新成长来源', kind: 'custom', description: '' }) },
  { key: 'growthCandidates', label: '成长候选', parentKey: 'playerCreation', nestedKey: 'growth.candidates', rawId: 'world-draft-player-creation', editorId: 'world-draft-growth-candidates-editor', previewId: 'world-draft-growth-candidates-preview', loadId: 'world-draft-player-load-growth-candidates-json', validateId: 'world-draft-player-validate-growth-candidates-json', template: () => ({ id: 'growth-candidate-' + uid(), label: '新成长候选', sourceId: '', bucket: 'attributes', targetId: '', delta: 1, description: '' }) },
];
function worldDraftJsonArrayDefinition(key) {
  return WORLD_DRAFT_JSON_ARRAY_DEFS.find(definition => definition.key === key) || null;
}
function worldDraftJsonArrayNestedValue(parent, path) {
  return String(path || '').split('.').reduce((value, key) => value?.[key], parent);
}
function worldDraftJsonArraySetNested(parent, path, value) {
  const keys = String(path || '').split('.').filter(Boolean);
  if (!keys.length) return value;
  const next = parent && typeof parent === 'object' && !Array.isArray(parent) ? { ...parent } : {};
  let cursor = next;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) cursor[key] = value;
    else {
      cursor[key] = cursor[key] && typeof cursor[key] === 'object' && !Array.isArray(cursor[key]) ? { ...cursor[key] } : {};
      cursor = cursor[key];
    }
  });
  return next;
}
function worldDraftJsonArraySchema(key) {
  const definition = worldDraftJsonArrayDefinition(key);
  const value = definition?.parentKey
    ? worldDraftJsonArrayNestedValue(worldDraft?.world?.[definition.parentKey], definition.nestedKey)
    : worldDraft?.world?.[key];
  return Array.isArray(value) ? value : [];
}
function worldDraftJsonArrayRawValue(key) {
  const definition = worldDraftJsonArrayDefinition(key);
  if (!definition) return undefined;
  return definition.parentKey ? worldDraft?.world?.[definition.parentKey] : worldDraft?.world?.[key];
}
function worldDraftJsonArrayWrite(key, value) {
  const definition = worldDraftJsonArrayDefinition(key);
  if (!definition || !worldDraft) return;
  if (!definition.parentKey) {
    worldDraft.world[key] = value;
    return;
  }
  const parent = worldDraft.world[definition.parentKey];
  worldDraft.world[definition.parentKey] = worldDraftJsonArraySetNested(parent, definition.nestedKey, value);
}
function worldDraftJsonArrayRawText(key) {
  const value = worldDraftJsonArrayRawValue(key);
  return value === undefined || value === null ? '' : JSON.stringify(value, null, 2);
}
function worldDraftJsonArrayItemText(item) {
  return JSON.stringify(item, null, 2) ?? '';
}
function worldDraftJsonArrayPreview(key) {
  const definition = worldDraftJsonArrayDefinition(key);
  const preview = $(definition?.previewId || `world-draft-${key}-preview`);
  if (preview) preview.textContent = JSON.stringify(worldDraftJsonArraySchema(key), null, 2);
}
function worldDraftJsonArrayRawMatchesEditor(key) {
  const definition = worldDraftJsonArrayDefinition(key);
  const raw = $(definition?.rawId || `world-draft-${key}`);
  if (!raw) return true;
  const expected = worldDraftJsonArrayRawText(key);
  return raw.value.trim() === expected;
}
function requireWorldDraftJsonArrayRawSync(key) {
  if (worldDraftJsonArrayRawMatchesEditor(key)) return true;
  const definition = worldDraftJsonArrayDefinition(key);
  setWorldDraftStatus(`${definition?.label || key} 高级 JSON 有未载入修改，请先点击“载入编辑器”。`, 'error');
  $(definition?.rawId || `world-draft-${key}`)?.focus();
  return false;
}
function worldDraftJsonArrayEntryTemplate(key, index, item) {
  const title = worldDraftJsonArrayDefinition(key)?.label || key;
  return `<article class="world-draft-entry world-draft-array-entry" data-world-entry data-world-bucket="${esc(key)}" data-world-index="${index}">
    <div class="world-draft-entry-head"><strong>${esc(title)} ${index + 1}</strong><div class="world-draft-array-actions">
      <button class="ghost-btn small" type="button" data-world-move="up" aria-label="上移">↑</button>
      <button class="ghost-btn small" type="button" data-world-move="down" aria-label="下移">↓</button>
      <button class="ghost-btn small danger" type="button" data-world-remove>删除</button>
    </div></div>
    <textarea class="world-draft-array-json" data-world-json rows="7" spellcheck="false" aria-label="${esc(title)} ${index + 1} JSON">${esc(worldDraftJsonArrayItemText(item))}</textarea>
    <p class="world-draft-array-error" data-world-error role="status"></p>
  </article>`;
}
function renderWorldDraftJsonArray(key) {
  const definition = worldDraftJsonArrayDefinition(key);
  if (!definition) return;
  const host = $(definition.editorId || `world-draft-${key}-editor`);
  const entries = worldDraftJsonArraySchema(key);
  if (host) host.innerHTML = entries.length
    ? entries.map((item, index) => worldDraftJsonArrayEntryTemplate(key, index, item)).join('')
    : `<p class="world-draft-empty">暂无${esc(definition.label)}，点击“＋${esc(definition.label)}”添加。</p>`;
  const raw = $(definition.rawId || `world-draft-${key}`);
  if (raw) {
    raw.value = worldDraftJsonArrayRawText(key);
    setWorldDraftJsonRawState(raw);
  }
  worldDraftJsonArrayPreview(key);
}
function renderWorldDraftJsonArrays() {
  for (const { key } of WORLD_DRAFT_JSON_ARRAY_DEFS) renderWorldDraftJsonArray(key);
}
function requireWorldDraftJsonArraysRawSync() {
  return WORLD_DRAFT_JSON_ARRAY_DEFS.every(({ key }) => requireWorldDraftJsonArrayRawSync(key));
}
function syncWorldDraftJsonArraysFromForm({ showError = false } = {}) {
  if (!worldDraft) return { ok: true, values: {} };
  const values = {};
  for (const { key } of WORLD_DRAFT_JSON_ARRAY_DEFS) {
    const definition = worldDraftJsonArrayDefinition(key);
    const rows = [...document.querySelectorAll(`#${definition.editorId || `world-draft-${key}-editor`} [data-world-entry]`)]
      .sort((a, b) => Number(a.dataset.worldIndex) - Number(b.dataset.worldIndex));
    const entries = [];
    for (const row of rows) {
      const error = row.querySelector('[data-world-error]');
      try {
        const value = JSON.parse(row.querySelector('[data-world-json]')?.value || '');
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('必须是 JSON 对象');
        entries.push(value);
        if (error) { error.textContent = ''; error.hidden = true; }
      } catch (err) {
        if (error) { error.textContent = err.message || 'JSON 无效'; error.hidden = false; }
        if (showError) return { ok: false, error: `${key} 中有无效 JSON`, focus: row.querySelector('[data-world-json]') };
        return { ok: false, error: `${key} 中有无效 JSON` };
      }
    }
    values[key] = entries;
  }
  for (const { key } of WORLD_DRAFT_JSON_ARRAY_DEFS) {
    worldDraftJsonArrayWrite(key, values[key]);
    const definition = worldDraftJsonArrayDefinition(key);
    const raw = $(definition.rawId || `world-draft-${key}`);
    if (raw) {
      raw.value = worldDraftJsonArrayRawText(key);
      setWorldDraftJsonRawState(raw);
    }
    worldDraftJsonArrayPreview(key);
  }
  return { ok: true, values };
}
function collectWorldDraftJsonArraysForSave() {
  const raw = Object.fromEntries(WORLD_DRAFT_JSON_ARRAY_DEFS.map(({ key, rawId }) => [key, $(rawId || `world-draft-${key}`)?.value.trim() || '']));
  const rawMatchesEditor = Object.fromEntries(WORLD_DRAFT_JSON_ARRAY_DEFS.map(({ key }) => [key, raw[key] === worldDraftJsonArrayRawText(key)]));
  for (const { key } of WORLD_DRAFT_JSON_ARRAY_DEFS) {
    if (!rawMatchesEditor[key]) {
      const result = validateWorldDraftJsonArrayRaw(key);
      if (!result.ok) return result;
    }
  }
  const editor = syncWorldDraftJsonArraysFromForm({ showError: true });
  if (!editor.ok) return editor;
  const values = { ...editor.values };
  for (const { key } of WORLD_DRAFT_JSON_ARRAY_DEFS) {
    const definition = worldDraftJsonArrayDefinition(key);
    if (rawMatchesEditor[key]) continue;
    if (!raw[key]) values[key] = null;
    else {
      try {
        const value = JSON.parse(raw[key]);
        const entries = definition.parentKey ? worldDraftJsonArrayNestedValue(value, definition.nestedKey) : value;
        if (!Array.isArray(entries)) throw new Error('必须包含 JSON 数组');
        values[key] = entries;
      } catch (err) {
        return { ok: false, error: `${key} 高级 JSON 无效：${err.message}`, focus: $(definition.rawId || `world-draft-${key}`) };
      }
    }
  }
  return { ok: true, values };
}
function validateWorldDraftJsonArrayRaw(key) {
  const definition = worldDraftJsonArrayDefinition(key);
  const raw = $(definition?.rawId || `world-draft-${key}`);
  if (!definition || !raw) return { ok: false, error: `${key} JSON 输入不存在` };
  try {
    const text = raw.value.trim();
    const value = text ? JSON.parse(text) : (definition.parentKey ? {} : []);
    const entries = text && definition.parentKey ? worldDraftJsonArrayNestedValue(value, definition.nestedKey) : value;
    if (!Array.isArray(entries)) throw new Error('必须包含 JSON 数组');
    setWorldDraftJsonRawState(raw, 'valid');
    setWorldDraftStatus(`${definition.label} JSON 有效；点击“载入编辑器”后才会替换可视化草稿。`, 'ok');
    return { ok: true, value, entries };
  } catch (err) {
    setWorldDraftJsonRawState(raw, 'invalid');
    setWorldDraftStatus(`${definition.label} JSON 无效：${err.message || '格式错误'}`, 'error');
    return { ok: false, error: err.message || 'JSON 无效', focus: raw };
  }
}
function loadWorldDraftJsonArray(key) {
  const definition = worldDraftJsonArrayDefinition(key);
  const raw = $(definition?.rawId || `world-draft-${key}`);
  if (!raw || !worldDraft) return;
  const result = validateWorldDraftJsonArrayRaw(key);
  if (!result.ok) {
    result.focus?.focus();
    return;
  }
  if (definition.parentKey) {
    if (raw.value.trim()) worldDraft.world[definition.parentKey] = result.value;
    else worldDraftJsonArrayWrite(key, []);
  } else worldDraft.world[key] = result.entries;
  if (definition.parentKey === 'playerCreation') renderWorldDraftPlayerCreation();
  renderWorldDraftJsonArray(key);
  worldDraftDirty = true;
  setWorldDraftStatus(`已从高级 JSON 载入${definition.label}。`, 'ok');
}
function handleWorldDraftJsonArrayClick(event) {
  const button = event.target.closest('button');
  if (!button || !worldDraft) return;
  const addKey = button.dataset.worldAdd;
  if (addKey) {
    if (!requireWorldDraftJsonArraysRawSync() || !syncWorldDraftJsonArraysFromForm().ok) return;
    const definition = worldDraftJsonArrayDefinition(addKey);
    if (!definition) return;
    const entries = worldDraftJsonArraySchema(addKey);
    entries.push(definition.template());
    worldDraftJsonArrayWrite(addKey, entries);
    worldDraftDirty = true;
    renderWorldDraftJsonArrays();
    $(`#${definition.editorId || `world-draft-${addKey}-editor`} [data-world-entry]:last-child [data-world-json]`)?.focus();
    return;
  }
  const row = button.closest('[data-world-entry]');
  if (!row) return;
  const key = row.dataset.worldBucket;
  const index = Number(row.dataset.worldIndex);
  if (!requireWorldDraftJsonArraysRawSync() || !syncWorldDraftJsonArraysFromForm().ok) return;
  const entries = worldDraftJsonArraySchema(key);
  if (button.hasAttribute('data-world-remove')) {
    const id = entries[index]?.id;
    if (id && blockWorldDraftDelete(key, id, worldDraftJsonArrayDefinition(key)?.label || key)) return;
    entries.splice(index, 1);
  }
  if (button.dataset.worldMove === 'up' && index > 0) [entries[index - 1], entries[index]] = [entries[index], entries[index - 1]];
  if (button.dataset.worldMove === 'down' && index < entries.length - 1) [entries[index + 1], entries[index]] = [entries[index], entries[index + 1]];
  worldDraftDirty = true;
  renderWorldDraftJsonArrays();
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
  let error = null;
  let focus = null;
  const npcs = [...document.querySelectorAll('#world-draft-npcs .world-draft-npc')].map(row => {
    const index = Number(row.dataset.index);
    const previous = worldDraft?.world?.npcs?.[index] || {};
    const personality = row.querySelector('[data-npc-personality]')?.value || '';
    const actionsRaw = row.querySelector('[data-npc-actions]')?.value.trim() || '';
    let actions = [];
    if (actionsRaw) {
      try {
        actions = JSON.parse(actionsRaw);
        if (!Array.isArray(actions)) throw new Error('必须是数组');
      } catch (err) {
        error ||= `NPC ${index + 1} 的主动行动模板不是有效 JSON：${err.message || '格式错误'}`;
        focus ||= row.querySelector('[data-npc-actions]');
        actions = Array.isArray(previous.actions) ? previous.actions : [];
      }
    }
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
      actions,
      ...(Array.isArray(previous.secrets) ? { secrets: previous.secrets } : {}),
    };
  });
  return { locations, npcs, error, focus };
}
function fillWorldDraftRpgPresetOptions(selected = '') {
  const select = $('world-draft-rpg-preset');
  if (!select) return;
  select.innerHTML = '<option value="">当前 RPG 默认预设</option>';
  for (const [name, preset] of Object.entries(promptPresets)) {
    if (name === GLOBAL_PRESET_KEY) continue;
    if (!['rpg', 'both'].includes(presetMode(name, preset))) continue;
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }
  select.value = selected && promptPresets[selected] ? selected : '';
}
function fillWorldDraftExtensionEditor(extension = null) {
  const value = extension && typeof extension === 'object' && !Array.isArray(extension) ? extension : {};
  const enabled = $('world-extension-enabled');
  if (!enabled) return;
  enabled.checked = value.enabled === true;
  $('world-extension-immersive').checked = value.immersive !== false;
  $('world-extension-action-narrates').checked = value.actionNarrates === true;
  $('world-extension-title').value = value.title || '';
  $('world-extension-height').value = Number.isInteger(value.maxHeight) ? value.maxHeight : 360;
  $('world-extension-timeout').value = Number.isInteger(value.timeoutMs) ? value.timeoutMs : 1200;
  const permissions = new Set(Array.isArray(value.permissions) ? value.permissions : []);
  document.querySelectorAll('[data-world-extension-permission]').forEach(input => { input.checked = permissions.has(input.value); });
  $('world-extension-html').value = value.html || '';
  $('world-extension-css').value = value.css || '';
  $('world-extension-js').value = value.js || '';
  $('world-extension-mvu').value = value.mvu ? JSON.stringify(value.mvu, null, 2) : '';
}
function loadWorldUiTemplate() {
  const template = defaults?.ui?.worldUiTemplate;
  if (!template || typeof template !== 'object' || Array.isArray(template)) {
    setWorldDraftStatus('当前默认数据没有配置完整 UI 模板。', 'error');
    return;
  }
  if ($('world-draft-ui').value.trim() && !confirm('载入完整 UI 模板会覆盖当前界面 JSON，确定继续吗？')) return;
  const next = cloneValue(template);
  $('world-draft-ui').value = JSON.stringify(next, null, 2);
  fillWorldDraftExtensionEditor(next.extension);
  worldDraftDirty = true;
  worldDraftPublishId = null;
  clearWorldDraftCheckReport();
  setWorldDraftStatus('已载入完整 UI 声明模板，可继续按世界需求修改。', 'ok');
}
function collectWorldDraftExtension() {
  const enabled = $('world-extension-enabled');
  if (!enabled) return { ok: true, value: null };
  const immersive = $('world-extension-immersive').checked;
  const mvuText = $('world-extension-mvu').value.trim();
  let mvu = null;
  if (mvuText) {
    try { mvu = JSON.parse(mvuText); }
    catch { setWorldDraftStatus('ui.extension.mvu 不是有效 JSON。', 'error'); $('world-extension-mvu').focus(); return { ok: false }; }
    if (!mvu || typeof mvu !== 'object' || Array.isArray(mvu)) {
      setWorldDraftStatus('ui.extension.mvu 必须是 JSON 对象。', 'error'); $('world-extension-mvu').focus(); return { ok: false };
    }
  }
  const title = $('world-extension-title').value.trim();
  const html = $('world-extension-html').value;
  const css = $('world-extension-css').value;
  const js = $('world-extension-js').value;
  const actionNarrates = $('world-extension-action-narrates').checked;
  const permissions = [...document.querySelectorAll('[data-world-extension-permission]:checked')].map(input => input.value);
  const hasContent = enabled.checked || !immersive || actionNarrates || title || html.trim() || css.trim() || js.trim() || mvuText || permissions.length;
  if (!hasContent) return { ok: true, value: null };
  const maxHeight = Number($('world-extension-height').value);
  const timeoutMs = Number($('world-extension-timeout').value);
  if (!Number.isInteger(maxHeight) || maxHeight < 180 || maxHeight > 800) {
    setWorldDraftStatus('扩展高度必须是 180-800 的整数。', 'error'); $('world-extension-height').focus(); return { ok: false };
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 200 || timeoutMs > 5000) {
    setWorldDraftStatus('扩展超时必须是 200-5000 的整数。', 'error'); $('world-extension-timeout').focus(); return { ok: false };
  }
  return { ok: true, value: { enabled: enabled.checked, ...(immersive ? {} : { immersive: false }), ...(actionNarrates ? { actionNarrates: true } : {}), ...(title ? { title } : {}), ...(html ? { html } : {}), ...(css ? { css } : {}), ...(js ? { js } : {}), ...(mvu ? { mvu } : {}), permissions, maxHeight, timeoutMs } };
}
function renderWorldDraftLorebookOptions(selectedIds = []) {
  const host = $('world-draft-lorebooks');
  if (!host) return;
  const selected = new Set((Array.isArray(selectedIds) ? selectedIds : []).map(id => String(id || '').trim()).filter(Boolean));
  const available = Object.entries(lorebooks && typeof lorebooks === 'object' ? lorebooks : {});
  const known = new Set(available.map(([id]) => id));
  const missing = [...selected].filter(id => !known.has(id)).map(id => [id, { name: '缺失引用' }]);
  const options = [...available, ...missing];
  if (!options.length) {
    host.innerHTML = '<p class="world-draft-lorebook-empty">当前没有可选择的世界书，请先在酒馆模式的“世界书”页创建。</p>';
    return;
  }
  host.innerHTML = options.map(([id, book]) => {
    const name = String(book?.name || id);
    const missingMark = known.has(id) ? '' : '（缺失引用）';
    return `<label class="world-draft-lorebook-option"><input type="checkbox" value="${esc(id)}" data-world-draft-lorebook${selected.has(id) ? ' checked' : ''} /><span>${esc(name + missingMark)}<small>${esc(id)}</small></span></label>`;
  }).join('');
}
function collectWorldDraftLorebookIds() {
  const host = $('world-draft-lorebooks');
  if (!host) return [];
  return [...host.querySelectorAll('[data-world-draft-lorebook]:checked')]
    .map(input => String(input.value || '').trim()).filter(Boolean);
}
function fillWorldDraftForm(draft) {
  const world = draft?.world || {};
  clearWorldDraftCheckReport();
  $('world-draft-name').value = world.title || '';
  $('world-draft-summary').value = world.summary || '';
  $('world-draft-setting').value = world.setting ? JSON.stringify(world.setting, null, 2) : '';
  $('world-draft-rules').value = world.rules ? JSON.stringify(world.rules, null, 2) : '';
  $('world-draft-tags').value = Array.isArray(world.tags) ? world.tags.join(', ') : '';
  renderWorldDraftLorebookOptions(Array.isArray(world.lorebookIds) ? world.lorebookIds : splitWorldDraftList(world.lorebookIds || ''));
  fillWorldDraftRpgPresetOptions(world.rpgPresetName || '');
  $('world-draft-agent').value = world.agent ? JSON.stringify(world.agent, null, 2) : '';
  $('world-draft-ui').value = world.ui ? JSON.stringify(world.ui, null, 2) : '';
  fillWorldDraftExtensionEditor(world.ui?.extension);
  $('world-draft-regexes').value = world.regexes ? JSON.stringify(world.regexes, null, 2) : '';
  $('world-draft-runtime').value = world.runtime ? JSON.stringify(world.runtime, null, 2) : '';
  renderWorldDraftPlayerCreation();
  $('world-draft-session-setup').value = world.sessionSetup ? JSON.stringify(world.sessionSetup, null, 2) : '';
  $('world-draft-turn-contract').value = world.turnContract ? JSON.stringify(world.turnContract, null, 2) : '';
  $('world-draft-failure').value = world.failure ? JSON.stringify(world.failure, null, 2) : '';
  $('world-draft-ending').value = world.ending ? JSON.stringify(world.ending, null, 2) : '';
  $('world-draft-time').value = world.time ? JSON.stringify(world.time, null, 2) : '';
  renderWorldDraftJsonArrays();
  fillWorldDraftMapForm(world);
  renderWorldDraftCollections(world);
  const isNewWorld = worldDraftIsNew(draft);
  $('world-draft-base').textContent = isNewWorld
    ? '这是一个独立的新世界草稿；保存不会修改任何已发布世界或已有存档。'
    : `基于已发布 v${draft.baseVersion}；草稿修改不会影响旧版本或已有存档。`;
  $('world-draft-publish').textContent = isNewWorld ? '发布为新世界' : `发布为 v${Number(draft.baseVersion) + 1}`;
}
function worldDraftIsNew(draft = worldDraft) {
  return draft?.kind === 'new' || draft?.kind === 'blank';
}
function worldOpenStatusText(save = currentWorldSave) {
  if (!save) return '';
  if (save.setup?.status === 'planning') return `「${save.name}」已创建，当前处于待开局规划；规划完成前不会写入正式回合。`;
  return `存档已打开：「${save.name}」——世界状态、地图和叙事已绑定当前存档；当前存档 ID：${save.id}`;
}
function openWorldDraftChoice() {
  const dialog = $('world-draft-choice-dialog');
  if (!dialog) return openWorldDraftEditor({ createNew: 'blank' });
  worldDraftChoiceOpener = document.activeElement;
  const existing = $('world-draft-open-existing');
  if (existing) existing.disabled = !worldCardById(currentWorldId);
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => (existing?.disabled ? $('world-draft-create-blank') : existing)?.focus());
}
function closeWorldDraftChoice() {
  const dialog = $('world-draft-choice-dialog');
  if (dialog?.open) dialog.close('cancel');
  worldDraftChoiceOpener?.focus?.();
  worldDraftChoiceOpener = null;
}
function openSelectedWorldDraft() {
  closeWorldDraftChoice();
  if (!worldCardById(currentWorldId)) return showWorldError('请先在左侧选择一个已有世界卡。');
  openWorldDraftEditor({ createNew: false });
}
function openBlankWorldDraft() {
  closeWorldDraftChoice();
  openWorldDraftEditor({ createNew: 'blank' });
}
async function openWorldDraftEditor({ createNew = false } = {}) {
  const blank = createNew === 'blank';
  const world = blank ? null : worldCardById(currentWorldId);
  const dialog = $('world-draft-dialog');
  if ((!world && !blank) || !dialog) return showWorldError('请先选择一个世界卡。');
  worldDraftOpener = document.activeElement;
  setWorldDraftStatus('正在读取草稿…');
  try {
    const res = await fetch('/api/world-drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(blank
        ? { mode: 'blank' }
        : createNew
          ? { mode: 'new', sourceWorldId: world.id, baseVersion: world.version }
        : { worldId: world.id, baseVersion: world.version }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(worldApiError(data, '世界草稿读取失败（HTTP ' + res.status + '）'));
    worldDraft = data;
    worldDraftDirty = false;
    worldDraftPublishId = null;
    fillWorldDraftForm(data);
    setWorldDraftStatus(data.createdAt === data.updatedAt
      ? (worldDraftIsNew(data) ? '新世界草稿已创建，修改后点击保存。' : '草稿已创建，修改后点击保存。')
      : '已载入上次保存的草稿。');
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
  let setting = null;
  const settingText = $('world-draft-setting').value.trim();
  if (settingText) {
    try { setting = JSON.parse(settingText); }
    catch { setWorldDraftStatus('世界观设定不是有效 JSON。', 'error'); $('world-draft-setting').focus(); return false; }
  }
  let rules = null;
  const rulesText = $('world-draft-rules').value.trim();
  if (rulesText) {
    try { rules = JSON.parse(rulesText); }
    catch { setWorldDraftStatus('硬 / 软规则不是有效 JSON。', 'error'); $('world-draft-rules').focus(); return false; }
  }
  const tags = splitWorldDraftList($('world-draft-tags').value);
  const lorebookIds = collectWorldDraftLorebookIds();
  const rpgPresetName = $('world-draft-rpg-preset').value.trim();
  let agent = null;
  const agentText = $('world-draft-agent').value.trim();
  if (agentText) {
    try { agent = JSON.parse(agentText); }
    catch { setWorldDraftStatus('Agent 配置不是有效 JSON。', 'error'); $('world-draft-agent').focus(); return false; }
  }
  let ui = null;
  const uiText = $('world-draft-ui').value.trim();
  if (uiText) {
    try { ui = JSON.parse(uiText); }
    catch { setWorldDraftStatus('RPG 界面配置不是有效 JSON。', 'error'); $('world-draft-ui').focus(); return false; }
  }
  const extensionResult = collectWorldDraftExtension();
  if (!extensionResult.ok) return false;
  if (extensionResult.value) {
    if (!ui || typeof ui !== 'object' || Array.isArray(ui)) ui = {};
    ui = { ...ui, extension: extensionResult.value };
  } else if (ui && typeof ui === 'object' && !Array.isArray(ui) && Object.prototype.hasOwnProperty.call(ui, 'extension')) {
    ui = { ...ui };
    delete ui.extension;
    if (!Object.keys(ui).length) ui = null;
  }
  let regexes = null;
  const regexText = $('world-draft-regexes').value.trim();
  if (regexText) {
    try { regexes = JSON.parse(regexText); }
    catch { setWorldDraftStatus('世界卡输出正则不是有效 JSON。', 'error'); $('world-draft-regexes').focus(); return false; }
  }
  let runtime = null;
  const runtimeText = $('world-draft-runtime').value.trim();
  if (runtimeText) {
    try { runtime = JSON.parse(runtimeText); }
    catch { setWorldDraftStatus('RPG GEN 3 运行态不是有效 JSON。', 'error'); $('world-draft-runtime').focus(); return false; }
  }
  const mapGeneration = collectWorldDraftMapGeneration();
  const collections = collectWorldDraftCollections();
  if (collections.error) {
    setWorldDraftStatus(collections.error, 'error');
    collections.focus?.focus();
    return false;
  }
  const { locations, npcs } = collections;
  let playerCreation = null;
  const playerCreationRaw = $('world-draft-player-creation').value.trim();
  const playerCreationPreviewBeforeSync = worldDraftPlayerSchema();
  const playerCreationExpected = Object.keys(playerCreationPreviewBeforeSync).length ? JSON.stringify(playerCreationPreviewBeforeSync, null, 2) : '';
  if (playerCreationRaw !== playerCreationExpected) {
    const rawResult = validateWorldDraftPlayerCreationJson();
    if (!rawResult.ok) {
      rawResult.focus?.focus();
      return false;
    }
    playerCreation = rawResult.value;
    worldDraft.world.playerCreation = playerCreation;
  } else {
    const playerCreationResult = syncWorldDraftPlayerCreationFromForm({ showError: true });
    if (!playerCreationResult.ok) {
      setWorldDraftStatus(playerCreationResult.error, 'error');
      playerCreationResult.focus?.focus();
      return false;
    }
    playerCreation = playerCreationResult.value;
  }
  let sessionSetup = null;
  const sessionSetupText = $('world-draft-session-setup').value.trim();
  if (sessionSetupText) {
    try { sessionSetup = JSON.parse(sessionSetupText); }
    catch { setWorldDraftStatus('本局游戏配置 Schema 不是有效 JSON。', 'error'); $('world-draft-session-setup').focus(); return false; }
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
  const jsonArrays = collectWorldDraftJsonArraysForSave();
  if (!jsonArrays.ok) {
    setWorldDraftStatus(jsonArrays.error, 'error');
    jsonArrays.focus?.focus();
    return false;
  }
  const { events, factions, conflicts } = jsonArrays.values;
  const duplicate = worldDraftDuplicateIdReport({
    ...worldDraft.world,
    locations,
    npcs,
    playerCreation,
    sessionSetup,
    failure,
    ending,
    events,
    factions,
    conflicts,
    runtime,
  });
  if (duplicate) {
    setWorldDraftStatus(`${duplicate.label} ID「${duplicate.id}」重复，请先修改后再保存。`, 'error');
    return false;
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
      body: JSON.stringify({ expectedUpdatedAt: worldDraft.updatedAt, baseVersion: worldDraft.baseVersion, title, summary, tags, lorebookIds, rpgPresetName, agent, ui, regexes, runtime, mapGeneration, locations, npcs, setting, rules, playerCreation, sessionSetup, turnContract, failure, ending, time, events, factions, conflicts }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(worldApiError(data, '世界草稿保存失败（HTTP ' + res.status + '）'));
    worldDraft = data;
    worldDraftDirty = false;
    worldDraftPublishId = null;
    fillWorldDraftForm(data);
    setWorldDraftStatus(worldDraftIsNew(data)
      ? '新世界草稿已保存，可以发布为独立世界卡。'
      : `草稿已保存，可以发布为 v${Number(data.baseVersion) + 1}。`, 'ok');
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
  if (!await checkWorldDraftPublishability({ save: false, focus: true })) return;
  const title = worldDraft.world?.title || '未命名世界';
  const isNewWorld = worldDraftIsNew(worldDraft);
  const nextVersion = isNewWorld ? 1 : Number(worldDraft.baseVersion) + 1;
  const publishLabel = isNewWorld ? '新的世界卡' : `v${nextVersion}`;
  if (!confirm(`将“${title}”发布为${publishLabel}？\n\n已发布版本不可覆盖；现有存档仍绑定各自原版本。`)) return;
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
    if (isNewWorld) {
      currentWorldId = published.id;
      localStorage.setItem(LS_CURRENT_WORLD, currentWorldId);
    }
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
    publishButton.textContent = worldDraft ? oldLabel : (isNewWorld ? '发布为新世界' : `发布为 v${nextVersion}`);
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
  restoreWorldAgentPending(data);
  localStorage.setItem(LS_CURRENT_WORLD, currentWorldId);
  localStorage.setItem(LS_CURRENT_WORLD_SAVE, currentWorldSaveId);
  renderWorldDetail();
  renderDebugTerminal();
  return currentWorldSave;
}
function restoreWorldAgentPending(save) {
  const pending = save?.agentRuntime?.pending;
  if (!pending || typeof pending !== 'object' || !Array.isArray(pending.turns) || !pending.turns.length) {
    if (worldTurnPending?.saveId === save?.id) { worldTurnPending = null; worldTurnError = null; }
    return false;
  }
  worldTurnPending = {
    saveId: save.id,
    commandId: pending.commandId,
    expectedRevision: pending.baseRevision,
    beforeState: cloneValue(save.state),
    state: cloneValue(pending.state || save.state),
    messages: cloneValue(pending.turns),
    options: Array.isArray(pending.options) ? cloneValue(pending.options) : [],
    createEntities: null,
    eventMemory: Array.isArray(pending.eventMemory) ? cloneValue(pending.eventMemory) : null,
    agentCalls: Array.isArray(pending.agentCalls) ? cloneValue(pending.agentCalls) : null,
    agentToolTrace: Array.isArray(pending.agentToolTrace) ? cloneValue(pending.agentToolTrace) : null,
    agentPhase: pending.phase || 'narrate',
    agentPhaseHistory: Array.isArray(pending.phaseHistory) ? cloneValue(pending.phaseHistory) : [],
    agentOrchestration: pending.orchestration ? cloneValue(pending.orchestration) : null,
    actionIntent: pending.actionIntent ? cloneValue(pending.actionIntent) : null,
    patch: null,
    agentExecution: cloneValue(pending),
  };
  worldTurnError = null;
  return true;
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
function worldPlayerPresetList(world) { return Array.isArray(world?.playerCreation?.buildPresets) ? world.playerCreation.buildPresets : []; }
function renderWorldPlayerPresetSelects(world, selected = '') {
  const presets = worldPlayerPresetList(world);
  const html = `<option value="">自定义配置</option>${presets.map(preset => `<option value="${esc(preset.id)}">${esc(preset.label || preset.id)}${preset.description ? ` · ${esc(preset.description)}` : ''}</option>`).join('')}`;
  ['world-save-preset', 'world-player-preset'].forEach(id => { const select = $(id); if (!select) return; select.innerHTML = html; select.value = selected || ''; });
}
function worldPlayerWithPreset(world, presetId, player = {}) {
  const preset = worldPlayerPresetList(world).find(item => item.id === presetId);
  const values = preset?.values && typeof preset.values === 'object' ? preset.values : {};
  return { ...player, fields: { ...(values.fields || {}), ...(player.fields || {}) }, attributes: { ...(values.attributes || {}), ...(player.attributes || {}) }, skills: { ...(values.skills || {}), ...(player.skills || {}) }, resources: { ...(values.resources || {}), ...(player.resources || {}) }, traits: Array.isArray(player.traits) ? player.traits : (Array.isArray(values.traits) ? values.traits : []), choices: Array.isArray(player.choices) ? player.choices : (Array.isArray(values.choices) ? values.choices : []), initialInventory: player.initialInventory || values.initialInventory || {}, relations: { ...(values.relations || {}), ...(player.relations || {}) } };
}
function renderWorldPlayerForm(world, targetId = 'world-player-fields', existingPlayer = null) {
  const schema = world?.playerCreation || {};
  $('world-player-title').textContent = schema.title || '创建你的冒险者';
  $('world-player-intro').textContent = schema.description || '填写的内容只属于当前存档。';
  const body = $(targetId);
  const fields = Array.isArray(schema.fields) ? schema.fields : [];
  const attributes = Array.isArray(schema.attributes) ? schema.attributes : [];
  const skills = Array.isArray(schema.skills) ? schema.skills : [];
  const resources = Array.isArray(schema.resources) ? schema.resources : [];
  const traits = Array.isArray(schema.traits) ? schema.traits : [];
  const relations = Array.isArray(schema.relations) ? schema.relations : [];
  const choices = Array.isArray(schema.choices) ? schema.choices : [];
  const initial = existingPlayer && typeof existingPlayer === 'object' ? existingPlayer : {};
  const initialFields = initial.fields || world.start?.playerTemplate || {};
  const selectedChoices = new Set(Array.isArray(initial.choices) ? initial.choices : []);
  const initialInventory = new Map((Array.isArray(initial.initialInventory) ? initial.initialInventory : []).map(item => [item.itemId, item.count]));
  const sections = [];
  if (schema.pointBudget) sections.push(`<p class="world-player-budget">${esc(schema.pointBudget.label || '属性点')}：<strong data-player-budget>${schema.pointBudget.mode === 'free' ? '自由' : esc(schema.pointBudget.total)}</strong>${schema.pointBudget.mode === 'free' ? '' : ` / ${esc(schema.pointBudget.total)}`} <small>${schema.pointBudget.cost === 'above-min' ? '按超过最低值的部分计费' : '按属性值计费'}</small></p>`);
  if (fields.length) sections.push(fields.map(field => playerFieldInput(field, initialFields[field.id] ?? field.default ?? '')).join(''));
  if (attributes.length) sections.push(`<section class="field"><span>基础属性</span><div class="world-player-attribute-grid">${attributes.map(attribute => `<label class="field"><span>${esc(attribute.label)} <small>${esc(attribute.min ?? 0)}-${esc(attribute.max ?? 100)}</small></span><input type="number" data-player-attribute="${esc(attribute.id)}" value="${esc(initial.attributes?.[attribute.id] ?? attribute.default ?? attribute.min ?? 0)}" min="${esc(attribute.min ?? 0)}" max="${esc(attribute.max ?? 100)}" step="${esc(attribute.step || 1)}" inputmode="numeric"></label>`).join('')}</div></section>`);
  if (skills.length) sections.push(`<section class="field"><span>技能与能力</span><div class="world-player-attribute-grid">${skills.map(skill => `<label class="field"><span>${esc(skill.label)} <small>${esc(skill.min ?? 0)}-${esc(skill.max ?? 100)}</small></span><input type="number" data-player-skill="${esc(skill.id)}" value="${esc(initial.skills?.[skill.id] ?? skill.default ?? skill.min ?? 0)}" min="${esc(skill.min ?? 0)}" max="${esc(skill.max ?? 100)}" step="${esc(skill.step || 1)}" inputmode="numeric"></label>`).join('')}</div></section>`);
  if (resources.length) sections.push(`<section class="field"><span>初始资源</span><div class="world-player-resource-grid">${resources.map(resource => `<label class="field"><span>${esc(resource.label)}</span><input type="number" data-player-resource="${esc(resource.id)}" value="${esc(initial.resources?.[resource.id] ?? resource.initial ?? resource.min ?? 0)}" min="${esc(resource.min ?? 0)}" max="${esc(resource.max ?? 1000000)}" step="any" inputmode="decimal"></label>`).join('')}</div></section>`);
  if (traits.length) sections.push(`<fieldset class="field world-player-traits"><legend>特质 / 天赋</legend>${traits.map(trait => `<div class="world-player-trait"><input id="${esc(targetId)}-trait-${esc(trait.id)}" type="checkbox" data-player-trait="${esc(trait.id)}"${Array.isArray(initial.traits) && initial.traits.includes(trait.id) ? ' checked' : ''}><div><label for="${esc(targetId)}-trait-${esc(trait.id)}">${esc(trait.label)}</label>${trait.description ? `<small>${esc(trait.description)}</small>` : ''}</div></div>`).join('')}</fieldset>`);
  if (choices.length) sections.push(`<fieldset class="field world-player-traits"><legend>天赋 / 特殊能力${schema.choiceBudget ? `（${esc(schema.choiceBudget.label || '选择点')}：<strong data-player-choice-budget>${esc(schema.choiceBudget.total)}</strong>）` : ''}</legend>${choices.map(choice => `<div class="world-player-trait"><input id="${esc(targetId)}-choice-${esc(choice.id)}" type="checkbox" data-player-choice="${esc(choice.id)}"${selectedChoices.has(choice.id) ? ' checked' : ''}><div><label for="${esc(targetId)}-choice-${esc(choice.id)}">${esc(choice.label)}${choice.cost ? ` · ${esc(choice.cost)}点` : ''}</label>${choice.description ? `<small>${esc(choice.description)}</small>` : ''}</div></div>`).join('')}</fieldset>`);
  const initialItems = Array.isArray(schema.initialInventory) ? schema.initialInventory : [];
  if (initialItems.length) sections.push(`<fieldset class="field world-player-traits"><legend>初始装备 / 物品</legend>${initialItems.map(item => `<label class="world-player-inline-check"><input type="number" data-player-inventory="${esc(item.itemId)}" value="${esc(initialInventory.get(item.itemId) ?? item.count ?? 1)}" min="0" max="${esc(item.count ?? 1)}" step="1" inputmode="numeric"><span>${esc(item.label || item.itemId)}</span></label>`).join('')}</fieldset>`);
  if (relations.length) {
    const npcs = new Map((world.npcs || []).map(npc => [npc.id, npc.name || npc.id]));
    sections.push(`<section class="field"><span>起始关系</span><div class="world-player-resource-grid">${relations.map(rule => `<label class="field"><span>${esc(npcs.get(rule.npcId) || rule.npcId)}</span><input type="number" data-player-relation="${esc(rule.npcId)}" value="${esc(rule.default ?? 0)}" min="${esc(rule.min ?? -100)}" max="${esc(rule.max ?? 100)}" step="1" inputmode="numeric"></label>`).join('')}</div></section>`);
  }
  body.innerHTML = sections.join('') || '<p class="world-empty">当前世界卡没有额外建角字段，将使用默认玩家模板。</p>';
  body.querySelectorAll('[data-player-attribute],[data-player-choice]').forEach(input => input.addEventListener('input', () => updateWorldPlayerBudget(body)));
  updateWorldPlayerBudget(body);
}
function updateWorldPlayerBudget(root = document) {
  const world = currentWorldCard();
  const budget = world?.playerCreation?.pointBudget;
  const total = Number(budget?.total);
  const scope = root?.querySelectorAll ? root : document;
  const el = scope.querySelector('[data-player-budget]');
  if (el && Number.isFinite(total)) {
    const spent = [...scope.querySelectorAll('[data-player-attribute]')].reduce((sum, input) => { const def = world?.playerCreation?.attributes?.find(item => item.id === input.dataset.playerAttribute); return sum + (Number(input.value) || 0) - (budget?.cost === 'above-min' ? Number(def?.min || 0) : 0); }, 0);
    if (budget?.mode === 'free') { el.textContent = '自由'; el.parentElement?.classList.remove('world-player-budget-over'); }
    else { el.textContent = String(Math.max(0, total - spent)); el.parentElement?.classList.toggle('world-player-budget-over', spent > total); }
  }
  const choiceTotal = Number(world?.playerCreation?.choiceBudget?.total);
  const choiceEl = scope.querySelector('[data-player-choice-budget]');
  if (choiceEl && Number.isFinite(choiceTotal)) {
    const spentChoices = [...scope.querySelectorAll('[data-player-choice]:checked')].reduce((sum, input) => sum + Number(world.playerCreation.choices?.find(choice => choice.id === input.dataset.playerChoice)?.cost || 0), 0);
    choiceEl.textContent = String(Math.max(0, choiceTotal - spentChoices));
    choiceEl.parentElement?.classList.toggle('world-player-budget-over', spentChoices > choiceTotal);
  }
}
function collectWorldPlayerInput(containerId = 'world-player-fields') {
  const root = $(containerId) || document;
  const player = { fields: {}, attributes: {}, skills: {}, resources: {}, traits: [], relations: {} };
  root.querySelectorAll('[data-player-field]').forEach(input => { player.fields[input.dataset.playerField] = input.type === 'number' ? Number(input.value) : input.value; });
  root.querySelectorAll('[data-player-attribute]').forEach(input => { player.attributes[input.dataset.playerAttribute] = Number(input.value); });
  root.querySelectorAll('[data-player-skill]').forEach(input => { player.skills[input.dataset.playerSkill] = Number(input.value); });
  root.querySelectorAll('[data-player-resource]').forEach(input => { player.resources[input.dataset.playerResource] = Number(input.value); });
  root.querySelectorAll('[data-player-trait]:checked').forEach(input => player.traits.push(input.dataset.playerTrait));
  root.querySelectorAll('[data-player-choice]:checked').forEach(input => (player.choices || (player.choices = [])).push(input.dataset.playerChoice));
  root.querySelectorAll('[data-player-inventory]').forEach(input => { const count = Number(input.value); if (count > 0) (player.initialInventory || (player.initialInventory = {}))[input.dataset.playerInventory] = count; });
  root.querySelectorAll('[data-player-relation]').forEach(input => { player.relations[input.dataset.playerRelation] = Number(input.value); });
  return player;
}
function worldPlayerAiSchema(world) {
  const schema = world?.playerCreation || {};
  return { fields: schema.fields || [], attributes: schema.attributes || [], skills: schema.skills || [], resources: schema.resources || [], traits: schema.traits || [], choices: schema.choices || [], initialInventory: schema.initialInventory || [], relations: schema.relations || [], pointBudget: schema.pointBudget || null };
}
async function aiFillWorldPlayerBasic() {
  const brief = $('world-player-ai-brief')?.value.trim();
  if (!brief) { setWorldPlayerStatus('请先写一句角色需求。', 'error'); $('world-player-ai-brief')?.focus(); return; }
  const world = currentWorldCard();
  const button = $('world-player-ai-basic');
  if (!world || !button) return;
  button.disabled = true; button.textContent = '填写中…'; setWorldPlayerStatus('第二步：AI 正在按当前世界 Schema 填写基本信息…');
  try {
    const instruction = '你是 RPG 建角助手。只返回 JSON，不要 Markdown，不要解释。严格依据给出的 Schema 生成 player 对象；不要新增字段 ID，不要修改规则。填写 fields、attributes、skills、resources、traits、choices、initialInventory、relations。';
    const result = await aiGenerate(instruction, JSON.stringify({ request: brief, presetId: $('world-player-preset')?.value || '', schema: worldPlayerAiSchema(world) }));
    const generated = result?.player && typeof result.player === 'object' ? result.player : result;
    renderWorldPlayerForm(world, 'world-player-fields', worldPlayerWithPreset(world, $('world-player-preset')?.value || '', generated));
    setWorldPlayerStatus('基本信息已填入。请检查并微调表格，再进行第三步。');
  } catch (err) { setWorldPlayerStatus('AI 填表失败：' + err.message, 'error'); }
  finally { button.disabled = false; button.textContent = '① AI 填写基本信息'; }
}
async function aiFillWorldPlayerFull() {
  const world = currentWorldCard();
  const button = $('world-player-ai-full');
  if (!world || !button) return;
  const current = collectWorldPlayerInput();
  button.disabled = true; button.textContent = '完善中…'; setWorldPlayerStatus('第三步：AI 正在补全结构化玩家状态…');
  try {
    const instruction = '你是 RPG 结构化建角助手。只返回 JSON，不要 Markdown，不要解释。补全 player 对象，保留用户已有值，不能发明 Schema 中不存在的 ID；这是草稿，不要直接开始故事。';
    const result = await aiGenerate(instruction, JSON.stringify({ request: $('world-player-ai-brief')?.value.trim() || '', current, schema: worldPlayerAiSchema(world) }));
    const generated = result?.player && typeof result.player === 'object' ? result.player : result;
    renderWorldPlayerForm(world, 'world-player-fields', worldPlayerWithPreset(world, '', { ...current, ...generated, fields: { ...current.fields, ...(generated.fields || {}) }, attributes: { ...current.attributes, ...(generated.attributes || {}) }, skills: { ...current.skills, ...(generated.skills || {}) }, resources: { ...current.resources, ...(generated.resources || {}) }, relations: { ...current.relations, ...(generated.relations || {}) } }));
    setWorldPlayerStatus('完整结构已生成。请再次确认后点击“保存角色并继续”。');
  } catch (err) { setWorldPlayerStatus('AI 完善失败：' + err.message, 'error'); }
  finally { button.disabled = false; button.textContent = '③ AI 完善结构'; }
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
  pendingWorldPlayerPresetId = '';
  editingWorldPlayerSaveId = null;
}
async function openWorldPlayerCreation(name, button) {
  const world = worldCardById(currentWorldId);
  if (!world) throw new Error('请先选择一个世界卡');
  await loadWorldCardVersion(world.id, world.version);
  const fullWorld = currentWorldCard();
  if (!fullWorld?.playerCreation) return createWorldSave(name);
  pendingWorldSaveName = name;
  pendingWorldPlayerPresetId = $('world-save-preset')?.value || fullWorld.playerCreation.defaultPresetId || '';
  editingWorldPlayerSaveId = null;
  pendingWorldSaveButton = button;
  worldPlayerOpener = button || document.activeElement;
  renderWorldPlayerPresetSelects(fullWorld, pendingWorldPlayerPresetId);
  renderWorldPlayerForm(fullWorld, 'world-player-fields', worldPlayerWithPreset(fullWorld, pendingWorldPlayerPresetId));
  $('world-player-create').textContent = '保存角色并继续';
  setWorldPlayerStatus('创建后，玩家快照与当前存档绑定。', '');
  const dialog = $('world-player-dialog');
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => dialog.querySelector('input, textarea, select')?.focus());
  return null;
}
function worldEntryGateConfig(world = currentWorldCard()) {
  const gate = world?.ui?.entryGate;
  return gate && gate.enabled !== false ? gate : null;
}
function worldCardUsesImmersive(world = currentWorldCard()) {
  const layout = String(world?.ui?.layout || '').trim().toLowerCase();
  const extension = world?.ui?.extension;
  if (!extension || extension.enabled === false || !Boolean(extension.html || extension.css || extension.js || extension.mvu != null)) return false;
  // custom 默认是窗口化接管宿主插槽；显式 immersive:true 仍可要求自动沉浸。
  if (layout === 'custom') return extension.immersive === true;
  return layout === 'immersive' || extension.immersive !== false;
}
function worldCardUsesCustomLayout(world = currentWorldCard()) {
  const layout = String(world?.ui?.layout || '').trim().toLowerCase();
  const extension = world?.ui?.extension;
  return layout === 'custom' && extension?.enabled !== false
    && Boolean(extension?.html || extension?.css || extension?.js || extension?.mvu != null);
}
function setWorldCustomLayout(enabled) {
  const active = Boolean(enabled);
  document.body.classList.toggle('world-custom-layout', active);
  document.body.dataset.uiSurface = active ? 'world-card' : 'host';
  const shell = active ? worldUiShell() : { navigation: 'show', topbar: 'show' };
  document.body.classList.toggle('world-shell-navigation-hidden', active && shell.navigation === 'hide');
  document.body.classList.toggle('world-shell-topbar-hidden', active && shell.topbar === 'hide');
  document.body.dataset.worldShellNavigation = active ? shell.navigation : 'show';
  document.body.dataset.worldShellTopbar = active ? shell.topbar : 'show';
}
function exitWorldImmersiveMode() {
  worldImmersiveSession = false;
  document.body.classList.remove('world-immersive');
  const syncExtensionContext = () => { if (worldExtensionState.iframe) postWorldExtensionContext(); };
  if (document.fullscreenElement && document.exitFullscreen) return document.exitFullscreen().catch(() => {}).finally(syncExtensionContext);
  syncExtensionContext();
  return Promise.resolve();
}
function enterWorldImmersiveMode(gate = {}) {
  worldImmersiveSession = true;
  document.body.classList.add('world-immersive');
  if (gate.fullscreen !== true || document.fullscreenElement || !document.documentElement.requestFullscreen) return Promise.resolve(false);
  return document.documentElement.requestFullscreen().then(() => true).catch(() => false);
}
async function openWorldEntryGate(name, button) {
  const world = worldCardById(currentWorldId);
  if (!world) throw new Error('请先选择一个世界卡');
  await loadWorldCardVersion(world.id, world.version);
  const gate = worldEntryGateConfig(currentWorldCard());
  if (!gate) return false;
  worldEntryGatePending = { name, button, gate };
  const dialog = $('world-entry-gate-dialog');
  if (!dialog) return false;
  $('world-entry-gate-title').textContent = gate.title || '进入世界前确认';
  $('world-entry-gate-message').textContent = gate.message || '本世界卡包含需要你确认的内容。';
  $('world-entry-gate-confirm').textContent = gate.confirmText || '确认进入';
  $('world-entry-gate-cancel').textContent = gate.cancelText || '退出';
  $('world-entry-gate-status').textContent = gate.fullscreen === true ? '确认后将尝试进入沉浸式全屏；浏览器拒绝时仍可继续。' : '';
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => $('world-entry-gate-cancel')?.focus());
  return true;
}
function closeWorldEntryGate() {
  const dialog = $('world-entry-gate-dialog');
  if (dialog?.open) dialog.close('cancel');
  worldEntryGatePending = null;
}
function confirmWorldEntryGate() {
  const pending = worldEntryGatePending;
  if (!pending) return;
  const fullscreen = enterWorldImmersiveMode(pending.gate);
  worldEntryGatePending = null;
  $('world-entry-gate-dialog')?.close('confirm');
  worldEntryGateBypass = true;
  $('world-save-form')?.requestSubmit?.();
  fullscreen.then(ok => {
    if (!ok && pending.gate.fullscreen === true) {
      const status = $('world-open-status');
      if (status) status.textContent = '已继续进入世界；浏览器未授予全屏权限，可按浏览器全屏按钮重试。';
    }
  });
}
function openWorldPlayerEditor(save = currentWorldSave) {
  const world = currentWorldCard();
  if (!save || !world || !worldSavePlanning(save)) return;
  editingWorldPlayerSaveId = save.id;
  pendingWorldSaveName = save.name || '';
  pendingWorldPlayerPresetId = save.setup?.playerPresetId || '';
  pendingWorldSaveButton = null;
  renderWorldPlayerPresetSelects(world, pendingWorldPlayerPresetId);
  renderWorldPlayerForm(world, 'world-player-fields', save.state?.player || null);
  $('world-player-title').textContent = '编辑本局 RP 角色';
  $('world-player-intro').textContent = '修改只会更新当前 WorldSave，不会改写角色库或世界卡。';
  $('world-player-create').textContent = '保存角色并返回开局配置';
  const dialog = $('world-player-dialog');
  if (!dialog.open) dialog.showModal();
}
async function createWorldSave(name, player, playerPresetId = '') {
  if (worldTurnPending) discardWorldTurnPending();
  const world = worldCardById(currentWorldId);
  if (!world) throw new Error('请先选择一个世界卡');
  const res = await fetch('/api/world-saves', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ worldId: world.id, worldVersion: world.version, name, ...(player ? { player } : {}), ...(playerPresetId ? { playerPresetId } : {}) }),
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
  return data;
}
function openingPlanText(value) { return Array.isArray(value) ? value.join('\n') : String(value || ''); }
function renderWorldSessionConfig(save = currentWorldSave) {
  const world = currentWorldCard();
  const root = $('world-session-fields');
  const binding = $('world-session-binding');
  if (!world || !root || !binding) return;
  const setup = save?.setup || {};
  const game = setup.game && typeof setup.game === 'object' ? setup.game : {};
  binding.innerHTML = `<span>Worldbook：<b>${esc(Array.isArray(world.lorebookIds) && world.lorebookIds.length ? world.lorebookIds.join('、') : 'default')}</b></span><span>RPG Preset：<b>${esc(world.rpgPresetName || '当前默认')}</b></span><span>时间：<b>${esc(world.time?.unit || 'tick')} / ${esc(world.time?.start ?? 0)}</b></span><span>回合契约：<b>${esc(world.turnContract?.options ? `${world.turnContract.options.min ?? 0}-${world.turnContract.options.max ?? 4} 选项` : '自由输入')}</b></span>`;
  const fields = Array.isArray(world.sessionSetup?.fields) ? world.sessionSetup.fields : [];
  root.innerHTML = fields.length ? fields.map(field => {
    const value = game[field.id] ?? field.default ?? (field.type === 'boolean' ? false : '');
    if (field.type === 'boolean') return `<label class="world-session-toggle"><input type="checkbox" data-session-field="${esc(field.id)}"${value === true ? ' checked' : ''}><span>${esc(field.label || field.id)}</span></label>`;
    if (field.type === 'select') return `<label class="field"><span>${esc(field.label || field.id)}${field.required ? ' *' : ''}</span><select data-session-field="${esc(field.id)}">${(field.options || []).map(option => { const optionValue = typeof option === 'string' ? option : option.value; const optionLabel = typeof option === 'string' ? option : option.label; return `<option value="${esc(optionValue)}"${String(value) === String(optionValue) ? ' selected' : ''}>${esc(optionLabel)}</option>`; }).join('')}</select></label>`;
    if (field.type === 'textarea') return `<label class="field"><span>${esc(field.label || field.id)}${field.required ? ' *' : ''}</span><textarea data-session-field="${esc(field.id)}" rows="3" maxlength="${esc(field.maxLength || 4000)}">${esc(value)}</textarea></label>`;
    const type = field.type === 'number' ? 'number' : 'text';
    return `<label class="field"><span>${esc(field.label || field.id)}${field.required ? ' *' : ''}</span><input type="${type}" data-session-field="${esc(field.id)}" value="${esc(value)}"${field.type === 'number' ? ` min="${esc(field.min ?? '')}" max="${esc(field.max ?? '')}" step="${esc(field.step || 'any')}"` : ` maxlength="${esc(field.maxLength || 4000)}"`}></label>`;
  }).join('') : '<p class="hint">当前世界卡未声明额外的本局规则；将沿用 WorldCard、Worldbook 与 RPG Preset 的默认规则。</p>';
}
function renderWorldOpeningNpcContexts(plan = {}) {
  const root = $('world-opening-npc-contexts');
  if (!root) return;
  const world = currentWorldCard();
  const selected = new Set(Array.isArray(plan.presentNpcIds) ? plan.presentNpcIds : []);
  const contexts = new Map((Array.isArray(plan.npcContexts) ? plan.npcContexts : []).map(context => [context.npcId, context]));
  root.innerHTML = (world?.npcs || []).filter(npc => selected.has(npc.id)).map(npc => {
    const context = contexts.get(npc.id) || {};
    return `<fieldset class="world-opening-npc-context"><legend>${esc(npc.name || npc.id)} · ${esc(npc.role || 'NPC')}</legend><div class="field row2"><label class="field"><span>与玩家关系</span><input data-opening-npc-field="relationship" data-opening-npc-id="${esc(npc.id)}" value="${esc(context.relationship || '')}" maxlength="1000" placeholder="朋友、债主、初次见面…"></label><label class="field"><span>当前目标</span><input data-opening-npc-field="currentGoal" data-opening-npc-id="${esc(npc.id)}" value="${esc(context.currentGoal || '')}" maxlength="1000"></label></div><label class="field"><span>当前状态</span><textarea data-opening-npc-field="currentState" data-opening-npc-id="${esc(npc.id)}" rows="2" maxlength="1000">${esc(context.currentState || '')}</textarea></label><div class="world-opening-npc-flags"><label><input type="checkbox" data-opening-npc-field="knowsPlayer" data-opening-npc-id="${esc(npc.id)}"${context.knowsPlayer === true ? ' checked' : ''}> NPC 已认识玩家</label><label><input type="checkbox" data-opening-npc-field="playerKnowsTruth" data-opening-npc-id="${esc(npc.id)}"${context.playerKnowsTruth === true ? ' checked' : ''}> 玩家知道其真实身份</label></div></fieldset>`;
  }).join('');
}
function renderWorldOpeningConfirmSummary(save = currentWorldSave, plan = {}) {
  const root = $('world-opening-confirm-summary');
  if (!root) return;
  const world = currentWorldCard();
  const player = save?.state?.player || {};
  const playerName = save?.player?.snapshot?.name || player.fields?.name || '未命名角色';
  const location = (world?.locations || []).find(item => item.id === plan.locationId)?.name || plan.locationId || '沿用世界卡起点';
  const npcNames = (world?.npcs || []).filter(item => (plan.presentNpcIds || []).includes(item.id)).map(item => item.name || item.id);
  const game = $('world-session-fields') ? collectWorldSessionConfig() : (save?.setup?.game || {});
  const gameText = Object.entries(game).map(([key, value]) => `${key}: ${typeof value === 'boolean' ? (value ? '是' : '否') : value}`).join('；') || '沿用世界卡与预设默认规则';
  const facts = Array.isArray(plan.preGameFacts) ? plan.preGameFacts.length : 0;
  root.innerHTML = [
    ['玩家角色', playerName],
    ['世界 / 规则', `${world?.title || world?.id || '未选择'} · ${gameText}`],
    ['时间 / 地点', `${plan.time?.era || '世界卡时代'} · ${plan.time?.date || '未指定'} · ${location}`],
    ['开场人物', npcNames.length ? npcNames.join('、') : '尚未指定 NPC'],
    ['开场事件', plan.event?.title || plan.event?.mode || '手动配置'],
    ['前置事实 / 知识权限', `${facts} 条前置事实；${plan.knowledge ? '已分层' : '沿用默认'}`],
    ['初始 Hook', plan.initialHook?.title || '无（自由 Sandbox）'],
  ].map(([label, value]) => `<div><small>${esc(label)}</small><strong>${esc(String(value))}</strong></div>`).join('');
}
function renderWorldOpeningDialog(save = currentWorldSave) {
  const dialog = $('world-opening-dialog');
  const world = currentWorldCard();
  if (!dialog || !save || !world) return;
  const plan = save.setup?.plan || {};
  renderWorldPlayerForm(world, 'world-opening-character-fields', save.state?.player || null);
  renderWorldSessionConfig(save);
  const playerName = save.player?.snapshot?.name || save.state?.player?.fields?.name || '未命名角色';
  $('world-opening-character-summary').textContent = `${playerName} · 本局角色与构建只绑定当前存档。`;
  $('world-opening-location').innerHTML = (world.locations || []).map(location => `<option value="${esc(location.id)}"${location.id === (plan.locationId || save.state?.locationId) ? ' selected' : ''}>${esc(location.name || location.id)}</option>`).join('');
  const npcIds = new Set(Array.isArray(plan.presentNpcIds) ? plan.presentNpcIds : []);
  $('world-opening-npcs').innerHTML = (world.npcs || []).length
    ? world.npcs.map(npc => `<label class="world-opening-check"><input type="checkbox" data-opening-npc="${esc(npc.id)}"${npcIds.has(npc.id) ? ' checked' : ''}>${esc(npc.name || npc.id)}</label>`).join('')
    : '<span class="hint">世界卡未登记 NPC。</span>';
  renderWorldOpeningNpcContexts(plan);
  $('world-opening-era').value = plan.time?.era || '';
  $('world-opening-date').value = plan.time?.date || plan.time?.period || '';
  $('world-opening-time-value').value = plan.time?.value ?? '';
  $('world-opening-situation').value = plan.situation || '';
  $('world-opening-hook').value = plan.hook || '';
  $('world-opening-facts').value = openingPlanText(plan.knownFacts);
  $('world-opening-boundaries').value = openingPlanText(plan.boundaries);
  $('world-opening-tone').value = plan.tone || '';
  $('world-opening-event-mode').value = plan.event?.mode || 'manual';
  $('world-opening-event-title').value = plan.event?.title || '';
  $('world-opening-event-description').value = plan.event?.description || '';
  const preGameFacts = Array.isArray(plan.preGameFacts) ? plan.preGameFacts.map(fact => `${fact.scope || 'player-visible'}|${fact.content || ''}`) : [];
  $('world-opening-pregame-facts').value = preGameFacts.join('\n');
  $('world-opening-knowledge').value = plan.knowledge ? JSON.stringify(plan.knowledge, null, 2) : '';
  $('world-opening-hook-title').value = plan.initialHook?.title || '';
  $('world-opening-hook-description').value = plan.initialHook?.description || '';
  const candidate = save.setup?.candidate;
  $('world-opening-candidate').hidden = !candidate;
  $('world-opening-regenerate').hidden = !candidate;
  $('world-opening-confirm').hidden = !candidate;
  $('world-opening-save').hidden = !!candidate;
  $('world-opening-narrative').value = candidate?.narrative || '';
  document.querySelectorAll('[data-opening-option]').forEach(input => { input.value = candidate?.options?.[Number(input.dataset.openingOption)] || ''; });
  $('world-opening-status').textContent = candidate ? '候选已保存到当前存档；你可以编辑后确认。' : '先保存规划，AI 才会生成独立开场候选。';
  renderWorldOpeningConfirmSummary(save, plan);
}
function openWorldOpeningDialog(save = currentWorldSave) {
  if (!save || !worldSavePlanning(save)) return;
  renderWorldOpeningDialog(save);
  const dialog = $('world-opening-dialog');
  if (dialog && !dialog.open) dialog.showModal();
}
function closeWorldOpeningDialog() {
  clearTimeout(worldSetupAutosaveTimer);
  worldSetupAutosaveTimer = null;
  const dialog = $('world-opening-dialog');
  if (dialog?.open) dialog.close('later');
}
function collectWorldOpeningPlan({ strict = false } = {}) {
  const lines = id => $(id).value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  const preGameFacts = lines('world-opening-pregame-facts').map((line, index) => {
    const [scope, ...parts] = line.split('|');
    return { id: `pre-${index + 1}`, scope: ['world-truth', 'character-knowledge', 'player-visible', 'hidden', 'rumor'].includes(scope) ? scope : 'player-visible', content: (parts.length ? parts.join('|') : line).trim(), confidence: scope === 'rumor' ? 'uncertain' : 'confirmed' };
  }).filter(fact => fact.content);
  let knowledge = {};
  try { knowledge = $('world-opening-knowledge').value.trim() ? JSON.parse($('world-opening-knowledge').value) : {}; } catch (error) { if (strict) throw new Error('知识权限必须是有效 JSON。'); knowledge = {}; }
  const timeValue = $('world-opening-time-value').value.trim();
  const npcContexts = [...document.querySelectorAll('[data-opening-npc-id]')].reduce((result, input) => {
    const id = input.dataset.openingNpcId;
    const context = result.find(item => item.npcId === id) || { npcId: id };
    if (!result.includes(context)) result.push(context);
    context[input.dataset.openingNpcField] = input.type === 'checkbox' ? input.checked : input.value.trim();
    return result;
  }, []);
  const event = { mode: $('world-opening-event-mode').value, title: $('world-opening-event-title').value.trim(), description: $('world-opening-event-description').value.trim() };
  return {
    locationId: $('world-opening-location').value || null,
    presentNpcIds: [...document.querySelectorAll('[data-opening-npc]:checked')].map(input => input.dataset.openingNpc),
    situation: $('world-opening-situation').value.trim(),
    hook: $('world-opening-hook').value.trim(),
    knownFacts: lines('world-opening-facts'),
    boundaries: lines('world-opening-boundaries'),
    tone: $('world-opening-tone').value.trim(),
    time: { era: $('world-opening-era').value.trim(), date: $('world-opening-date').value.trim(), period: $('world-opening-date').value.trim(), ...(timeValue ? { value: Number(timeValue) } : {}) },
    event,
    npcContexts,
    preGameFacts,
    knowledge,
    initialHook: $('world-opening-hook-title').value.trim() ? { id: 'initial-hook', title: $('world-opening-hook-title').value.trim(), description: $('world-opening-hook-description').value.trim(), optional: true } : null,
  };
}
function collectWorldSessionConfig() {
  const game = {};
  document.querySelectorAll('[data-session-field]').forEach(input => {
    game[input.dataset.sessionField] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value.trim();
  });
  return game;
}
function scheduleWorldSetupAutosave() {
  if (!currentWorldSave || !worldSavePlanning() || worldOpeningGeneration) return;
  clearTimeout(worldSetupAutosaveTimer);
  worldSetupAutosaveTimer = setTimeout(async () => {
    const save = currentWorldSave;
    if (!save || !worldSavePlanning(save)) return;
    try {
      const response = await fetch('/api/world-saves/' + encodeURIComponent(save.id) + '/setup', { method: 'PUT', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ commandId: 'draft-' + uid(), expectedRevision: save.revision, player: collectWorldPlayerInput('world-opening-character-fields'), game: collectWorldSessionConfig(), plan: collectWorldOpeningPlan() }) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(worldApiError(data, '草稿自动保存失败（HTTP ' + response.status + '）'));
      if (currentWorldSaveId === save.id) { hydrateWorldSave(data); currentWorldSave = data; renderWorldList(); }
    } catch (error) {
      const status = $('world-opening-status');
      if (status) status.textContent = error.message;
    }
  }, 900);
}
async function saveWorldOpeningPlan() {
  const save = currentWorldSave;
  if (!save || !worldSavePlanning(save)) return;
  clearTimeout(worldSetupAutosaveTimer);
  worldSetupAutosaveTimer = null;
  const button = $('world-opening-save');
  button.disabled = true;
  $('world-opening-status').textContent = '正在保存规划并生成候选…';
  try {
    const setupResponse = await fetch('/api/world-saves/' + encodeURIComponent(save.id) + '/setup', {
      method: 'PUT', headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ commandId: 'setup-' + uid(), expectedRevision: save.revision, player: collectWorldPlayerInput('world-opening-character-fields'), game: collectWorldSessionConfig(), plan: collectWorldOpeningPlan({ strict: true }) }),
    });
    const setup = await setupResponse.json().catch(() => null);
    if (!setupResponse.ok) throw new Error(worldApiError(setup, '开局规划保存失败（HTTP ' + setupResponse.status + '）'));
    hydrateWorldSave(setup);
    currentWorldSave = setup;
    await generateWorldOpening(setup);
  } finally {
    button.disabled = false;
  }
}
async function generateWorldOpening(save) {
  if (!save || !worldSavePlanning(save) || worldOpeningGeneration) return save;
  if (!settings.baseUrl) {
    const status = $('world-opening-status');
    if (status) status.textContent = '请先在设置中配置 AI API，再生成开场候选。规划已保存，可稍后继续。';
    return save;
  }
  const world = currentWorldCard();
  if (!world || !currentWorldSave || currentWorldSave.id !== save.id) return save;
  worldOpeningGeneration = save.id;
  const status = $('world-opening-status');
  if (status) status.textContent = '正在根据规划、玩家与世界卡生成独立候选…';
  try {
    const payload = buildPayload();
    const traceCommandId = 'opening-candidate-' + uid();
    payload.body.messages.push({ role: 'user', content: `【开局规划任务】这是一个新建世界存档。请严格依据以下当前存档开局规划生成候选：${JSON.stringify(save.setup?.plan || {})}。根据世界卡、玩家快照、起始地点、在场 NPC 与规则，生成可直接展示给玩家的开场叙事；不要替玩家决定未声明的核心意图，结尾停在玩家可以回应的局面。末尾输出唯一的 <tavern_state_update> JSON 更新块，protocol=tavern.rpg.turn、version=1、baseRevision=${save.revision}、updates=[]，并提供恰好 4 个具体行动选项。` });
    setDebugTrace(save, { commandId: traceCommandId, status: '开场候选请求中', input: JSON.stringify({ kind: 'opening-plan', endpoint: payload.baseUrl + '/chat/completions', ...payload.body }, null, 2), output: '等待 AI 响应…' });
    let reply;
    if (payload.body.stream) reply = (await callAPIStream(payload)).content;
    else reply = (await callAPI(payload))?.choices?.[0]?.message?.content;
    const processed = processAIOutput(reply || '');
    if (!processed.content || !processed.options || processed.options.length !== 4) throw new Error('AI 未返回合规的开场正文与 4 个选项');
    const commandId = 'candidate-' + uid();
    setDebugTrace(save, { commandId, status: '开场候选已收到', output: String(reply || '') });
    const response = await fetch('/api/world-saves/' + encodeURIComponent(save.id) + '/opening-candidate', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ commandId, expectedRevision: save.revision, candidate: { narrative: processed.content, options: processed.options } }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(worldApiError(data, '开场候选保存失败（HTTP ' + response.status + '）'));
    if (currentWorldSaveId === save.id) {
      hydrateWorldSave(data);
      currentWorldSave = data;
      renderWorldOpeningDialog(data);
      renderWorldDetail();
    }
    return data;
  } catch (err) {
    setDebugTrace(save, { status: '开场候选失败', output: `ERROR\n${err.message}` });
    throw err;
  } finally {
    worldOpeningGeneration = null;
  }
}
async function confirmWorldOpeningCandidate() {
  const save = currentWorldSave;
  const candidate = save?.setup?.candidate;
  if (!save || !candidate || !worldSavePlanning(save)) return;
  const narrative = $('world-opening-narrative').value.trim();
  const options = [...document.querySelectorAll('[data-opening-option]')].map(input => input.value.trim());
  if (!narrative || options.length !== 4 || options.some((value, index) => !value || options.indexOf(value) !== index)) {
    $('world-opening-status').textContent = '请填写开场正文，并保证 4 个选项均非空且不重复。';
    return;
  }
  const button = $('world-opening-confirm');
  button.disabled = true;
  $('world-opening-status').textContent = '正在确认开场并进入正式世界线…';
  try {
    const response = await fetch('/api/world-saves/' + encodeURIComponent(save.id) + '/opening', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ commandId: 'opening-' + uid(), candidateCommandId: candidate.commandId, expectedRevision: save.revision, opening: narrative, options }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(worldApiError(data, '开场提交失败（HTTP ' + response.status + '）'));
    hydrateWorldSave(data);
    currentWorldSave = data;
    setDebugTrace(data, { status: '开场候选已确认', commandId: data.openingCommandId || null });
    closeWorldOpeningDialog();
    renderWorldDetail();
    renderMessages();
    enterWorldWorkspace();
  } catch (err) {
    $('world-opening-status').textContent = err.message;
  } finally {
    button.disabled = false;
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
    await downloadBlob(new Blob([text], { type: 'application/json' }), `${String(world.title || world.id).replace(/[\\/:*?"<>|]/g, '_')}-v${world.version}.tavern-world.json`);
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
    const saveCount = worldSavesByWorld.has(world.id) ? saves.length : (world.saveCount || 0);
    return `<div class="world-item${active}">
      <button class="world-item-main" type="button" data-world-id="${esc(world.id)}">
        <span class="world-item-title">${esc(world.title || world.id)}</span>
        <span class="world-item-summary">${esc(world.summary || '尚无简介')}</span>
        <span class="world-item-meta"><span>v${esc(world.version)}</span><span>${saveCount} 份存档</span></span>
      </button>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-world-id]').forEach(el => el.addEventListener('click', async () => {
    setMobileManagerPanel('world-mgr', 'detail');
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
async function deleteWorldSave(saveId, button) {
  const saves = worldSavesByWorld.get(currentWorldId) || [];
  const save = saves.find(item => item.id === saveId);
  if (!save) return;
  if (worldTurnPendingActive() && currentWorldSaveId === saveId) {
    showWorldError('当前存档还有未完成的回合，请先结束或放弃本回合。');
    return;
  }
  if (!confirm(`确定删除存档“${save.name || save.id}”？\n\n这会永久删除该存档的状态与叙事记录。`)) return;
  const old = button?.textContent;
  if (button) { button.disabled = true; button.textContent = '删除中…'; }
  try {
    const res = await fetch('/api/world-saves/' + encodeURIComponent(saveId), { method: 'DELETE' });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(worldApiError(data, '存档删除失败（HTTP ' + res.status + '）'));
    const wasCurrent = currentWorldSaveId === saveId;
    if (wasCurrent) {
      discardWorldTurnPending();
      currentWorldSave = null;
      currentWorldSaveId = null;
      localStorage.removeItem(LS_CURRENT_WORLD_SAVE);
      renderMessages();
      renderSessions();
      $('world-mgr')?.classList.remove('hidden');
    }
    await loadWorldSaves(save.worldId || currentWorldId);
    renderWorldList();
    renderWorldDetail();
  } catch (err) {
    showWorldError(err.message);
  } finally {
    if (button) { button.disabled = false; button.textContent = old || '删除'; }
  }
}
async function renameWorldSave(saveId, button) {
  const saves = worldSavesByWorld.get(currentWorldId) || [];
  const save = saves.find(item => item.id === saveId);
  if (!save) return;
  const name = window.prompt('存档名称', save.name || '');
  if (name === null || !name.trim() || name.trim() === save.name) return;
  const old = button?.textContent;
  if (button) { button.disabled = true; button.textContent = '保存中…'; }
  try {
    const res = await fetch('/api/world-saves/' + encodeURIComponent(saveId) + '/rename', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ name: name.trim() }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(worldApiError(data, '存档重命名失败（HTTP ' + res.status + '）'));
    if (currentWorldSaveId === saveId) currentWorldSave = data;
    await loadWorldSaves(save.worldId || currentWorldId);
    renderWorldList(); renderWorldDetail();
  } catch (err) {
    showWorldError(err.message);
  } finally {
    if (button) { button.disabled = false; button.textContent = old || '重命名'; }
  }
}
async function exportWorldSave(saveId, button) {
  const old = button?.textContent;
  if (button) { button.disabled = true; button.textContent = '导出中…'; }
  try {
    const res = await fetch('/api/world-saves/' + encodeURIComponent(saveId) + '/export');
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(worldApiError(data, '存档导出失败（HTTP ' + res.status + '）'));
    }
    const blob = await res.blob();
    await downloadBlob(blob, `${saveId}.tavern-save.json`);
    const status = $('world-open-status');
    if (status) status.textContent = '已导出脱敏存档包；不包含 API key、设置或其他存档。';
  } catch (err) {
    showWorldError(err.message);
  } finally {
    if (button) { button.disabled = false; button.textContent = old || '导出'; }
  }
}
async function copyWorldSave(saveId, button) {
  const saves = worldSavesByWorld.get(currentWorldId) || [];
  const save = saves.find(item => item.id === saveId);
  if (!save) return;
  const suggested = `${save.name || '存档'} · 副本`;
  const name = window.prompt('副本名称', suggested);
  if (name === null || !name.trim()) return;
  const old = button?.textContent;
  if (button) { button.disabled = true; button.textContent = '复制中…'; }
  try {
    const res = await fetch('/api/world-saves/' + encodeURIComponent(saveId) + '/copy', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ commandId: 'copy-' + uid(), name: name.trim() }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.save?.id) throw new Error(worldApiError(data, '存档复制失败（HTTP ' + res.status + '）'));
    await loadWorldSaves(save.worldId || currentWorldId);
    const opened = await openWorldSave(data.save.id);
    renderWorldList(); renderWorldDetail();
    const status = $('world-open-status');
    if (status) status.textContent = `已创建「${data.save.name}」；它与源存档的状态、回合和账本独立。`;
    if (opened?.setup?.status === 'planning') openWorldOpeningDialog(opened);
    else enterWorldWorkspace();
  } catch (err) {
    showWorldError(err.message);
  } finally {
    if (button) { button.disabled = false; button.textContent = old || '复制'; }
  }
}
async function deleteWorldCard(worldId, button) {
  const world = worldCardById(worldId);
  if (!world) return;
  const saves = worldSavesByWorld.get(worldId) || [];
  if (saves.length) {
    showWorldError(`“${world.title || world.id}”还有 ${saves.length} 份存档，请先删除存档。`);
    return;
  }
  if (!confirm(`确定删除世界卡“${world.title || world.id}”？\n\n世界卡的全部版本与未发布草稿都会移除。`)) return;
  const old = button?.textContent;
  if (button) { button.disabled = true; button.textContent = '删除中…'; }
  try {
    const res = await fetch('/api/worlds/' + encodeURIComponent(worldId), { method: 'DELETE' });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(worldApiError(data, '世界卡删除失败（HTTP ' + res.status + '）'));
    if (currentWorldId === worldId) {
      discardWorldTurnPending();
      currentWorldId = null;
      currentWorldSave = null;
      currentWorldSaveId = null;
      localStorage.removeItem(LS_CURRENT_WORLD);
      localStorage.removeItem(LS_CURRENT_WORLD_SAVE);
    }
    worldSavesByWorld.delete(worldId);
    await loadWorldLibraryData(false);
    showWorldError(`世界卡“${world.title || world.id}”已删除。`);
  } catch (err) {
    showWorldError(err.message);
  } finally {
    if (button) { button.disabled = false; button.textContent = old || '删除'; }
  }
}
function renderWorldLorebookSummary(world) {
  const host = $('world-lorebook-list');
  if (!host) return;
  const ids = Array.isArray(world?.lorebookIds) && world.lorebookIds.length ? [...new Set(world.lorebookIds)] : ['default'];
  host.innerHTML = ids.map(id => {
    const book = lorebooks && lorebooks[id];
    if (!book) return `<span class="world-lorebook-chip missing">⚠ 缺失：${esc(id)}</span>`;
    return `<span class="world-lorebook-chip">📖 ${esc(book.name || id)}</span>`;
  }).join('');
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
  renderWorldLorebookSummary(world);
  renderWorldPlayerPresetSelects(world, world.defaultPresetId || '');
  const worldVersionCached = worldCardVersions.has(worldCardKey(world.id, world.version));
  if (!worldVersionCached && (!Array.isArray(world.lorebookIds) || !world.playerCreation)) loadWorldCardVersion(world.id, world.version).then(fullWorld => {
    if (currentWorldId !== world.id) return;
    renderWorldLorebookSummary(fullWorld);
    renderWorldPlayerPresetSelects(fullWorld, fullWorld.playerCreation?.defaultPresetId || '');
  }).catch(() => {});
  const saves = worldSavesByWorld.get(world.id) || [];
  const facts = [
    [world.locationCount || 0, '已登记地点'],
    [world.npcCount || 0, '世界角色'],
    [worldSavesByWorld.has(world.id) ? saves.length : (world.saveCount || 0), '独立存档'],
  ];
  $('world-facts').innerHTML = facts.map(([value, label]) => `<div class="world-fact"><b>${esc(value)}</b><span>${esc(label)}</span></div>`).join('');
  showWorldError('');
  const openStatus = $('world-open-status');
  if (openStatus && (!currentWorldSave || currentWorldSave.worldId !== world.id)) openStatus.textContent = '选择一个存档后进入对应的 RPG 世界线。';
  $('world-save-count').textContent = saves.length + ' 份';
  const list = $('world-save-list');
  const latestVersion = Number(world.version);
  list.innerHTML = saves.length ? saves.map(save => `<div class="world-save-card${save.id === currentWorldSaveId ? ' active' : ''}">
    <div class="world-save-main"><span class="world-save-name">${esc(save.name)} ${save.setupStatus === 'planning' ? '<em class="world-save-planning">待开局</em>' : ''}</span><span class="world-save-meta">世界 v${esc(save.worldVersion)} · ${esc(save.locationId || '未定位')} · revision ${esc(save.revision)} · ${esc(formatWorldDate(save.updatedAt))}</span></div>
    <div class="world-save-actions">${Number(save.worldVersion) < latestVersion ? `<button class="ghost-btn small" type="button" data-upgrade-save="${esc(save.id)}">升级…</button>` : ''}<button class="ghost-btn small" type="button" data-open-save="${esc(save.id)}">${save.setupStatus === 'planning' ? '继续规划' : save.id === currentWorldSaveId ? '已打开' : '打开存档'}</button><button class="ghost-btn small" type="button" data-copy-save="${esc(save.id)}">复制</button><button class="ghost-btn small" type="button" data-rename-save="${esc(save.id)}">重命名</button><button class="ghost-btn small" type="button" data-export-save="${esc(save.id)}">导出</button><button class="ghost-btn small danger" type="button" data-delete-save="${esc(save.id)}">删除</button></div>
  </div>`).join('') : '<p class="hint">这个世界还没有存档，先创建一份吧。</p>';
  list.querySelectorAll('[data-upgrade-save]').forEach(btn => btn.addEventListener('click', () => openWorldSaveUpgrade(btn.dataset.upgradeSave, btn)));
  list.querySelectorAll('[data-delete-save]').forEach(btn => btn.addEventListener('click', event => {
    event.stopPropagation();
    deleteWorldSave(btn.dataset.deleteSave, btn);
  }));
  list.querySelectorAll('[data-rename-save]').forEach(btn => btn.addEventListener('click', event => {
    event.stopPropagation();
    renameWorldSave(btn.dataset.renameSave, btn);
  }));
  list.querySelectorAll('[data-export-save]').forEach(btn => btn.addEventListener('click', event => {
    event.stopPropagation();
    exportWorldSave(btn.dataset.exportSave, btn);
  }));
  list.querySelectorAll('[data-copy-save]').forEach(btn => btn.addEventListener('click', event => {
    event.stopPropagation();
    copyWorldSave(btn.dataset.copySave, btn);
  }));
  list.querySelectorAll('[data-open-save]').forEach(btn => btn.addEventListener('click', async () => {
    const token = worldLoadToken;
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '读取中…';
    try {
      const opened = await openWorldSave(btn.dataset.openSave, token);
      if (!opened || token !== worldLoadToken) return;
      const status = $('world-open-status');
      if (currentWorldSave.setup?.status === 'planning') {
        openWorldOpeningDialog(currentWorldSave);
      } else {
        if (status) status.textContent = worldOpenStatusText();
        enterWorldWorkspace();
      }
    } catch (err) { showWorldError(err.message); }
    finally { btn.disabled = false; btn.textContent = old; }
  }));
  if (currentWorldSave && currentWorldSave.worldId === world.id) {
    const status = $('world-open-status');
    if (status) status.textContent = worldOpenStatusText();
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
    if (restoreWorkspace && worldModeActive() && currentWorldSaveId) {
      if (worldSavePlanning()) openWorldOpeningDialog(currentWorldSave);
      enterWorldWorkspace();
    }
    else if (restoreWorkspace) $('world-mgr')?.classList.remove('hidden');
    return true;
  } catch (err) {
    if (token !== worldLoadToken) return false;
    worldCards = [];
    renderWorldList();
    renderWorldDetail();
    if (restoreWorkspace) $('world-mgr')?.classList.remove('hidden');
    showWorldError(err.message);
    return false;
  }
}
function openWorldLibrary(restoreWorkspace = false) {
  const mgr = $('world-mgr');
  if (!mgr) return;
  // 恢复已有 RPG 存档时先保持管理层隐藏，避免异步读取期间闪出世界卡界面。
  // 没有可恢复的存档则正常展示世界库，让用户选择或创建世界。
  const restoringSave = restoreWorkspace && !!currentWorldSaveId;
  syncModeNavigation(restoringSave ? 'chat' : 'worlds');
  if (!restoringSave) {
    exitWorldImmersiveMode();
    setWorldCustomLayout(false);
    clearWorldExtension();
  }
  mgr.classList.toggle('hidden', restoringSave);
  if (!restoringSave) setMobileManagerPanel('world-mgr', 'list', { focus: false });
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
    || (char && Array.isArray(char.alternateGreetings) && char.alternateGreetings.find(g => String(g || '').trim()))
    || (preset && preset.firstMes && preset.firstMes.trim())
    || settings.firstMes || '';
}
function curSession() { return Array.isArray(sessions) ? sessions.find(s => s.id === currentSessionId && sessionMatches(s)) || null : null; }
function activeConversationScope() { return worldModeActive() ? currentWorldSave : curSession(); }
function curMessages() {
  if (worldModeActive()) return worldTimelineMessages();
  if (mode === 'rpg') return [];
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
        activeHooks: Array.isArray(state.activeHooks) ? state.activeHooks : [],
        runtime: state.runtime && typeof state.runtime === 'object' ? state.runtime : null,
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
    state.activeHooks = cloneValue(rs.activeHooks || []);
    if (rs.runtime && typeof rs.runtime === 'object') state.runtime = cloneValue(rs.runtime);
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

async function reopenCurrentWorld() {
  if (!worldModeActive() || !currentWorldSave || worldTurnPendingActive()) return;
  const ending = currentWorldSave.state?.ending?.status === 'ended';
  const terminalFailure = currentWorldSave.state?.failure?.status === 'terminal';
  if (!ending && !terminalFailure) return;
  const sourceLabel = ending ? '已结束' : '终止失败';
  if (!confirm(`从当前${sourceLabel}世界线重开一份独立存档？原存档会保留不变。`)) return;
  const suggested = `${currentWorldSave.name || '世界线'} · 重开`;
  const name = prompt('新存档名称（留空使用默认名称）：', suggested);
  if (name === null) return;
  const button = $('rpg-reopen-world');
  if (button) { button.disabled = true; button.textContent = '重开中…'; }
  try {
    const res = await fetch('/api/world-saves/' + encodeURIComponent(currentWorldSaveId) + '/reopen', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ commandId: 'reopen-' + uid(), name: name.trim() || suggested }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.save?.id) throw new Error(worldApiError(data, '世界线重开失败（HTTP ' + res.status + '）'));
    await loadWorldSaves(data.save.worldId);
    await openWorldSave(data.save.id);
    renderRPG();
    renderMessages();
    renderWorldDetail();
  } catch (err) {
    showWorldError(err.message);
  } finally {
    if (button) { button.disabled = false; button.textContent = '从此世界线重开'; }
  }
}

async function rebuildWorldLineSummary() {
  if (!worldModeActive() || !currentWorldSave || worldSummaryPending) return;
  const button = $('rpg-summary-rebuild');
  const oldLabel = button?.textContent || '生成 / 更新总结';
  worldSummaryPending = true;
  if (button) { button.disabled = true; button.textContent = '生成中…'; }
  try {
    const saveId = currentWorldSave.id;
    const res = await fetch('/api/world-saves/' + encodeURIComponent(saveId) + '/summary/rebuild', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ commandId: 'world-summary-' + uid(), expectedRevision: currentWorldSave.revision }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.save?.id) throw new Error(worldApiError(data, '世界线总结生成失败（HTTP ' + res.status + '）'));
    if (currentWorldSaveId === saveId) {
      hydrateWorldSave(data.save);
      currentWorldSave = data.save;
      renderRPG();
      renderMessages();
      renderWorldDetail();
    }
  } catch (err) {
    showWorldError(err.message);
  } finally {
    worldSummaryPending = false;
    if (button) { button.disabled = false; button.textContent = oldLabel; }
    renderRPG();
  }
}

/* 渲染 RPG 面板：顶栏（等级/金币/位置）、状态条（HP/MP/EXP）、背包、任务、角色摘要 */
const RPG_UI_SOURCES = new Set([
  'world.npcs', 'world.locations', 'save.npcStates', 'save.state.activeHooks', 'save.state.goals', 'save.state.leads',
  'save.state.worldEvents', 'save.state.factionStates', 'save.state.player.attributes',
  'save.state.player.skills', 'save.state.player.resources', 'save.state.player.traits',
]);

function isSupportedRpgUiSource(source) {
  return RPG_UI_SOURCES.has(source) || /^runtime\.(variables|collections)\.[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(String(source || ''));
}

function readRpgUiField(value, path) {
  return String(path || '').split('.').reduce((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return current[key];
  }, value);
}

function rpgUiValueText(value) {
  if (value === undefined || value === null || value === '') return '—';
  if (Array.isArray(value)) return value.map(item => rpgUiValueText(item)).join('、');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const WORLD_UI_SLOT_TARGETS = {
  topbar: () => [$('workspace-header-content') || document.querySelector('.chat-header')].filter(Boolean),
  'sidebar.left': () => [$('rpg-left')].filter(Boolean),
  narrative: () => [$('chat')].filter(Boolean),
  options: () => [$('quick-actions')].filter(Boolean),
  input: () => [document.querySelector('.composer')].filter(Boolean),
  'sidebar.right': () => [$('rpg-right')].filter(Boolean),
  status: () => [$('rpg-status')].filter(Boolean),
  overlay: () => [$('world-ui-overlay')].filter(Boolean),
};
// custom 世界卡只接管 RPG 工作区同级区域；应用级导航和窗口化返回入口仍由宿主保留。
const WORLD_CUSTOM_REPLACED_SLOTS = new Set([
  'sidebar.left', 'narrative', 'options', 'input', 'sidebar.right', 'status', 'overlay',
]);
const WORLD_UI_REGION_MODES = new Set(['decorate', 'replace', 'append', 'hide']);
const WORLD_UI_REGION_FALLBACKS = new Set(['host', 'empty']);
const WORLD_UI_SHELL_MODES = new Set(['show', 'hide']);
const WORLD_UI_ESCAPE_MODES = new Set(['fullscreen', 'world', 'none']);
const WORLD_UI_COMPONENT_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const WORLD_UI_THEME_TOKEN_RE = /^[a-z][a-z0-9-]{0,40}$/;
let appliedWorldThemeTokens = new Set();

function worldUiRegions(world = currentWorldCard()) {
  const ui = world?.ui && typeof world.ui === 'object' && !Array.isArray(world.ui) ? world.ui : {};
  const regions = ui.regions && typeof ui.regions === 'object' && !Array.isArray(ui.regions) ? ui.regions : {};
  const slots = ui.slots && typeof ui.slots === 'object' && !Array.isArray(ui.slots) ? ui.slots : {};
  const normalized = {};
  for (const slot of Object.keys(WORLD_UI_SLOT_TARGETS)) {
    const source = regions[slot] && typeof regions[slot] === 'object' && !Array.isArray(regions[slot])
      ? regions[slot]
      : slots[slot] && typeof slots[slot] === 'object' && !Array.isArray(slots[slot]) ? slots[slot] : null;
    if (!source) continue;
    const mode = WORLD_UI_REGION_MODES.has(source.mode) ? source.mode : (source.visible === false ? 'hide' : 'decorate');
    const label = typeof source.label === 'string' && source.label.length <= 120 ? source.label.trim() : '';
    const component = typeof source.component === 'string' && WORLD_UI_COMPONENT_RE.test(source.component)
      ? source.component : '';
    normalized[slot] = {
      mode,
      visible: source.visible !== false,
      ...(label ? { label } : {}),
      ...(component ? { component } : {}),
      fallback: WORLD_UI_REGION_FALLBACKS.has(source.fallback) ? source.fallback : 'host',
    };
  }
  return normalized;
}

function worldUiThemeTokens(world = currentWorldCard()) {
  const tokens = world?.ui?.theme?.tokens;
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return {};
  return Object.fromEntries(Object.entries(tokens).filter(([key, value]) => WORLD_UI_THEME_TOKEN_RE.test(key)
    && typeof value === 'string'
    && value.length <= 240
    && !/[<>{}`;]/.test(value)
    && !/(?:url|expression)\s*\(|(?:javascript|vbscript|data):/i.test(value)));
}

function worldUiShell(world = currentWorldCard()) {
  const shell = world?.ui?.shell;
  if (!shell || typeof shell !== 'object' || Array.isArray(shell)) return {
    navigation: 'show', topbar: 'show', fullscreen: true, escape: 'fullscreen',
  };
  return {
    navigation: WORLD_UI_SHELL_MODES.has(shell.navigation) ? shell.navigation : 'show',
    topbar: WORLD_UI_SHELL_MODES.has(shell.topbar) ? shell.topbar : 'show',
    fullscreen: shell.fullscreen !== false,
    escape: WORLD_UI_ESCAPE_MODES.has(shell.escape) ? shell.escape : 'fullscreen',
  };
}

function applyWorldUiTheme() {
  const next = worldModeActive() ? worldUiThemeTokens() : {};
  for (const key of appliedWorldThemeTokens) document.body.style.removeProperty(`--${key}`);
  appliedWorldThemeTokens = new Set(Object.keys(next));
  for (const [key, value] of Object.entries(next)) document.body.style.setProperty(`--${key}`, value);
  document.body.dataset.uiTheme = Object.keys(next).length ? 'world-card' : 'host';
}

function applyWorldUiSlots() {
  const customLayout = worldModeActive() && worldCardUsesCustomLayout();
  applyWorldUiTheme();
  setWorldCustomLayout(customLayout);
  const targets = Object.fromEntries(Object.entries(WORLD_UI_SLOT_TARGETS).map(([slot, resolve]) => [slot, resolve()]));
  const regions = worldModeActive() ? worldUiRegions() : {};
  for (const [slot, elements] of Object.entries(targets)) {
    for (const element of elements) {
      const config = regions[slot];
      const mode = config?.mode || 'decorate';
      const legacyCustomHidden = customLayout && WORLD_CUSTOM_REPLACED_SLOTS.has(slot) && !config;
      const hidden = (slot === 'overlay' && !config) || mode === 'hide' || config?.visible === false || legacyCustomHidden;
      element.hidden = hidden;
      element.dataset.uiMode = mode;
      element.dataset.uiOwner = hidden || mode === 'replace' ? 'world-card' : (mode === 'append' ? 'shared' : 'host');
      element.dataset.uiFallback = config?.fallback || 'host';
      if (config?.component) element.dataset.uiComponent = config.component;
      else delete element.dataset.uiComponent;
      if (hidden) element.dataset.uiHidden = 'true';
      else delete element.dataset.uiHidden;
      element.removeAttribute('aria-label');
      if (config?.label && !hidden) element.setAttribute('aria-label', String(config.label).trim());
    }
  }
  const extensionHost = $('rpg-extension-host');
  if (extensionHost) extensionHost.dataset.uiOwner = customLayout ? 'world-card' : 'host';
}

function renderWorldSidebarPanels() {
  const targets = { left: $('rpg-custom-left'), right: $('rpg-custom-right') };
  Object.values(targets).forEach(target => { if (target) target.replaceChildren(); });
  if (!worldModeActive() || !currentWorldSave) return;
  const world = currentWorldCard() || {};
  const save = currentWorldSave;
  const sourceValues = {
    'world.npcs': world.npcs,
    'world.locations': world.locations,
    'save.npcStates': save.npcStates,
    'save.state.activeHooks': save.state?.activeHooks,
    'save.state.goals': save.state?.goals,
    'save.state.leads': save.state?.leads,
    'save.state.worldEvents': save.state?.worldEvents,
    'save.state.factionStates': save.state?.factionStates,
    'save.state.player.attributes': save.state?.player?.attributes,
    'save.state.player.skills': save.state?.player?.skills,
    'save.state.player.resources': save.state?.player?.resources,
    'save.state.player.traits': save.state?.player?.traits,
  };
  const runtime = save.state?.runtime;
  for (const panel of Array.isArray(world.ui?.sidebar?.panels) ? world.ui.sidebar.panels : []) {
    const match = /^runtime\.(variables|collections)\.([A-Za-z0-9][A-Za-z0-9_-]{0,63})$/.exec(String(panel?.source || ''));
    if (!match) continue;
    if (match[1] === 'variables' && currentWorldCard()?.runtime?.variables?.find(item => item.id === match[2])?.visible === false) continue;
    sourceValues[panel.source] = match[1] === 'variables'
      ? { value: runtime?.variables?.[match[2]] }
      : (runtime?.collections?.[match[2]] || []);
  }
  const panels = Array.isArray(world.ui?.sidebar?.panels) ? world.ui.sidebar.panels : [];
  for (const panel of panels) {
    if (!panel || !isSupportedRpgUiSource(panel.source)) continue;
    const target = targets[panel.side === 'left' ? 'left' : 'right'];
    if (!target) continue;
    const layout = ['cards', 'table'].includes(panel.layout) ? panel.layout : 'list';
    const section = document.createElement('section');
    section.className = `rpg-custom-panel rpg-custom-${layout}`;
    const heading = document.createElement('div');
    heading.className = 'rpg-panel-head';
    heading.style.marginTop = '10px';
    heading.textContent = `${panel.icon ? `${panel.icon} ` : ''}${panel.title}`;
    section.appendChild(heading);
    const list = document.createElement('div');
    list.className = 'rpg-list';
    const raw = sourceValues[panel.source];
    const entries = Array.isArray(raw)
      ? raw.map((value, index) => ({ key: value?.id || value?.name || String(index + 1), value }))
      : raw && typeof raw === 'object' ? Object.entries(raw).map(([key, value]) => ({ key, value })) : [];
    const configuredFields = Array.isArray(panel.fields) ? panel.fields.map(field => typeof field === 'string' ? { key: field, label: field } : field) : [];
    const inferredFields = entries[0]?.value && typeof entries[0].value === 'object'
      ? Object.keys(entries[0].value).filter(key => !['id', 'name', 'title'].includes(key)).slice(0, 6).map(key => ({ key, label: key }))
      : [];
    const fields = configuredFields.length ? configuredFields : inferredFields;
    const valueForField = (entry, field) => rpgUiValueText(field.key === '$key' ? entry.key : readRpgUiField(entry.value, field.key));
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = panel.emptyText || '暂无数据。';
      list.appendChild(empty);
    } else if (layout === 'table') {
      const table = document.createElement('table');
      table.className = 'rpg-custom-table-grid';
      const headerRow = document.createElement('tr');
      ['名称', ...fields.map(field => field.label || field.key)].forEach(label => {
        const cell = document.createElement('th');
        cell.textContent = String(label);
        headerRow.appendChild(cell);
      });
      const thead = document.createElement('thead');
      thead.appendChild(headerRow);
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      entries.slice(0, 64).forEach(entry => {
        const row = document.createElement('tr');
        const name = document.createElement('th');
        name.scope = 'row';
        name.textContent = String(entry.value?.name || entry.value?.title || entry.key);
        row.appendChild(name);
        fields.forEach(field => {
          const cell = document.createElement('td');
          cell.textContent = valueForField(entry, field);
          row.appendChild(cell);
        });
        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      list.appendChild(table);
    } else {
      if (layout === 'cards') list.classList.add('rpg-card-grid');
      entries.slice(0, 64).forEach(entry => {
        const card = document.createElement('article');
        card.className = 'rpg-item';
        const title = document.createElement('div');
        title.className = 'rpg-item-name';
        title.textContent = String(entry.value?.name || entry.value?.title || entry.key);
        card.appendChild(title);
        fields.forEach(field => {
          const line = document.createElement('div');
          line.className = 'rpg-item-sub';
          line.textContent = `${field.label || field.key}：${valueForField(entry, field)}`;
          card.appendChild(line);
        });
        list.appendChild(card);
      });
    }
    section.appendChild(list);
    target.appendChild(section);
  }
}

function worldExtensionPermissions(extension) {
  return new Set(Array.isArray(extension?.permissions) ? extension.permissions : ['read.public', 'read.save']);
}

function executableContentKinds(value, key = '') {
  const kinds = new Set();
  const visit = (node, pathKey = '') => {
    if (typeof node === 'string') {
      if (/<%[\s\S]*?%>/.test(node)) kinds.add('EJS');
      if (/^(?:js|javascript|script|scripts|code)$/i.test(pathKey) && !/regex/i.test(pathKey)) kinds.add('扩展脚本');
      return;
    }
    if (Array.isArray(node)) { node.forEach(item => visit(item, pathKey)); return; }
    if (!node || typeof node !== 'object') return;
    for (const [childKey, child] of Object.entries(node)) {
      if (/mvu/i.test(childKey)) kinds.add('MVU');
      visit(child, childKey);
    }
  };
  visit(value, key);
  return [...kinds];
}

function worldExtensionApprovalKey(extension) {
  return `${currentWorldId || 'world'}@${currentWorldSave?.worldVersion ?? currentWorldCard()?.version ?? 0}:${lorebookHash(JSON.stringify({ html: extension?.html || '', css: extension?.css || '', js: extension?.js || '', mvu: extension?.mvu || null }))}`;
}

function approveWorldExtensionCode(extension) {
  const kinds = executableContentKinds(extension);
  if (!kinds.length) return true;
  const key = worldExtensionApprovalKey(extension);
  const approvals = prefs.extensionApprovals && typeof prefs.extensionApprovals === 'object' ? prefs.extensionApprovals : {};
  if (approvals[key] === true) return true;
  if (worldExtensionDeniedApprovals.has(key)) return false;
  const approved = typeof window !== 'undefined' && typeof window.confirm === 'function'
    ? window.confirm(`当前世界卡包含 ${kinds.join('、')}。\n确认后仅在隔离 sandbox iframe 中启用世界扩展；不会执行主页面脚本，角色卡/预设里的 EJS 也不会被解释。\n是否启用？`)
    : false;
  if (approved) {
    prefs.extensionApprovals = { ...approvals, [key]: true };
    saveJSON(LS_PREFS, prefs);
  } else {
    worldExtensionDeniedApprovals.add(key);
  }
  return approved;
}

function worldExtensionContext() {
  const world = currentWorldCard() || {};
  const save = currentWorldSave;
  const extension = world.ui?.extension || {};
  const permissions = worldExtensionPermissions(extension);
  const context = {
    version: 1,
    permissions: [...permissions],
    mvu: extension.mvu || null,
    ui: {
      immersive: Boolean(worldImmersiveSession),
      fullscreen: Boolean(document.fullscreenElement),
      shell: worldUiShell(world),
    },
  };
  if (permissions.has('read.public')) {
    context.world = {
      id: world.id,
      version: world.version,
      title: world.title,
      summary: world.summary,
      tags: Array.isArray(world.tags) ? world.tags : [],
      locations: Array.isArray(world.locations) ? world.locations.filter(Boolean).map(item => ({ id: item.id, name: item.name || item.label, description: item.description })) : [],
      factions: Array.isArray(world.factions) ? world.factions.filter(Boolean).map(item => ({ id: item.id, name: item.name || item.label, description: item.description })) : [],
      npcs: Array.isArray(world.npcs) ? world.npcs.filter(Boolean).map(item => ({ id: item.id, name: item.name || item.label, description: item.description })) : [],
    };
  }
  if (permissions.has('read.save') && save) {
    const timeline = worldTimelineMessages();
    const latestAssistant = [...timeline].reverse().find(item => item?.role === 'assistant');
    const turnOptions = Array.isArray(latestAssistant?.options) && latestAssistant.options.length
      ? latestAssistant.options
      : (Array.isArray(save.openingOptions) ? save.openingOptions : []);
    // 扩展前端负责自己的对话布局；只投影当前存档的用户/AI消息，不泄露其他会话或内部提示。
    const messages = timeline
      .filter(item => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
      .slice(-40)
      .map(item => {
        const content = String(item.content).slice(0, 12000);
        const rendered = renderBubble(renderOutputContent(content, 'rpg'));
        return {
          id: item.id || null,
          role: item.role,
          content,
          html: rendered.html,
          markdown: rendered.md,
          ts: Number.isFinite(item.ts) ? item.ts : null,
          opening: item._opening === true,
          options: Array.isArray(item.options) ? item.options.filter(option => typeof option === 'string').slice(0, 8) : [],
        };
      });
    const narrative = String(latestAssistant?.content || save.opening || '');
    const narrativeRendered = renderBubble(renderOutputContent(narrative, 'rpg'));
    context.save = {
      id: save.id,
      name: save.name,
      revision: save.revision,
      worldVersion: save.worldVersion,
      setupStatus: save.setup?.status || 'active',
      state: {
        locationId: save.state?.locationId || null,
        time: save.state?.time || null,
        runtime: save.state?.runtime || null,
        player: save.state?.player && typeof save.state.player === 'object' ? {
          fields: save.state.player.fields || {},
          attributes: save.state.player.attributes || {},
          skills: save.state.player.skills || {},
          resources: save.state.player.resources || {},
          traits: Array.isArray(save.state.player.traits) ? save.state.player.traits : [],
          relations: save.state.player.relations || {},
          inventory: Array.isArray(save.state.inventory) ? save.state.inventory : [],
          equipment: save.state.equipment || {},
          currencies: save.state.currencies || {},
        } : null,
        goals: save.state?.goals || [],
        leads: save.state?.leads || [],
        worldEvents: (Array.isArray(save.state?.worldEvents) ? save.state.worldEvents : []).filter(item => item?.visibility !== 'hidden'),
      },
    };
    context.messages = messages;
    context.turn = {
      revision: save.revision,
      narrative,
      narrativeHtml: narrativeRendered.html,
      markdown: narrativeRendered.md,
      hasResponse: Boolean(latestAssistant && latestAssistant._opening !== true),
      options: turnOptions.filter(item => typeof item === 'string' && item.trim()).slice(0, 8),
      canChoose: save.setup?.status === 'active' && !worldTurnPendingActive(),
    };
  }
  return context;
}

const WORLD_EXTENSION_EVENT_NAMES = new Set(['turn.start', 'agent.execute', 'agent.complete', 'turn.commit', 'turn.error']);
function postWorldExtensionEvent(name, payload = {}) {
  const iframe = worldExtensionState.iframe;
  if (!iframe?.contentWindow || !worldModeActive()) return;
  const extension = currentWorldCard()?.ui?.extension || {};
  if (!worldExtensionPermissions(extension).has('read.save') || !WORLD_EXTENSION_EVENT_NAMES.has(name)) return;
  iframe.contentWindow.postMessage({
    channel: WORLD_EXTENSION_CHANNEL,
    version: 1,
    nonce: worldExtensionState.nonce,
    type: 'event',
    event: name,
    payload: { ...payload },
  }, '*');
}

function extensionBridgeSource(nonce) {
  return `(() => {
    const channel = ${JSON.stringify(WORLD_EXTENSION_CHANNEL)};
    const nonce = ${JSON.stringify(nonce)};
    const pending = new Map();
    const listeners = new Map();
    let sequence = 0;
    const chooseFromElement = (element, text) => {
      const value = String(text || '').trim();
      if (!value || element.dataset.tavernBusy === '1') return;
      element.dataset.tavernBusy = '1';
      element.setAttribute('aria-busy', 'true');
      if ('disabled' in element) element.disabled = true;
      window.TavernExtension.choose(value).catch(error => {
        if ('disabled' in element) element.disabled = false;
        element.dispatchEvent(new CustomEvent('tavern-input-error', { detail: { message: error.message } }));
      }).finally(() => {
        delete element.dataset.tavernBusy;
        element.removeAttribute('aria-busy');
      });
    };
    const renderMessageSlots = context => {
      const messages = Array.isArray(context && context.messages) ? context.messages : [];
      document.querySelectorAll('[data-tavern-messages]').forEach(target => {
        stabilizeMessageViewport(target);
        target.replaceChildren(...messages.map(message => {
          const item = document.createElement('article');
          item.className = 'tavern-message tavern-message-' + (message.role === 'user' ? 'user' : 'assistant');
          item.dataset.role = message.role || 'assistant';
          item.dataset.tavernRendered = 'true';
          if (typeof message.html === 'string' && message.html.trim()) item.innerHTML = message.html;
          else item.textContent = String(message.content || '');
          return item;
        }));
        target.scrollTop = target.scrollHeight;
      });
    };
    const renderNarrativeSlots = context => {
      const narrative = String(context && context.turn && context.turn.narrative || '');
      const html = String(context && context.turn && context.turn.narrativeHtml || '');
      document.querySelectorAll('[data-tavern-narrative]').forEach(target => {
        target.dataset.tavernRendered = 'true';
        if (html.trim()) target.innerHTML = html;
        else target.textContent = narrative;
      });
    };
    const syncMessageSurface = () => {
      const hasMessages = document.querySelector('[data-tavern-messages]');
      document.querySelectorAll('[data-tavern-narrative]').forEach(target => {
        const duplicate = Boolean(hasMessages) && target.dataset.tavernAllowDuplicate !== 'true';
        target.hidden = duplicate;
        target.setAttribute('aria-hidden', duplicate ? 'true' : 'false');
      });
    };
    const stabilizeMessageViewport = target => {
      const parent = target.parentElement;
      if (!parent || parent === target) return;
      const overflow = getComputedStyle(parent).overflowY;
      if (!['auto', 'scroll'].includes(overflow)) return;
      parent.style.display = 'flex';
      parent.style.flexDirection = 'column';
      parent.style.minHeight = '0';
      parent.style.overflow = 'hidden';
      target.style.flex = '1 1 auto';
      target.style.minHeight = '0';
      target.style.maxHeight = 'none';
      target.style.overflow = 'auto';
    };
    const readBinding = (context, path) => {
      const keys = String(path || '').trim().split('.').filter(Boolean);
      if (!keys.length || keys.length > 8 || keys.some(key => !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) || key === '__proto__' || key === 'prototype' || key === 'constructor')) return undefined;
      return keys.reduce((value, key) => value && typeof value === 'object' ? value[key] : undefined, context);
    };
    const bindingText = value => value === undefined || value === null ? '' : Array.isArray(value) ? value.join('、') : typeof value === 'object' ? JSON.stringify(value) : String(value);
    const renderDataBindings = context => {
      document.querySelectorAll('[data-tavern-bind]').forEach(target => {
        target.textContent = bindingText(readBinding(context, target.getAttribute('data-tavern-bind')));
      });
      document.querySelectorAll('[data-tavern-show]').forEach(target => {
        const value = readBinding(context, target.getAttribute('data-tavern-show'));
        target.hidden = value === undefined || value === null || value === false || value === '' || value === 0;
      });
    };
    const renderOptionSlots = context => {
      const turn = context && context.turn || {};
      const options = Array.isArray(turn.options) ? turn.options.filter(item => typeof item === 'string' && item.trim()).slice(0, 8) : [];
      document.querySelectorAll('[data-tavern-options]').forEach(target => {
        const existing = [...target.querySelectorAll('[data-tavern-option]')];
        if (existing.length) {
          existing.forEach((button, index) => {
            const text = options[index] || '';
            button.hidden = !text;
            const label = button.querySelector('[data-tavern-option-label]');
            (label || button).textContent = text;
            button.dataset.optionText = text;
            if ('disabled' in button) button.disabled = !text || turn.canChoose === false;
            if (!button.dataset.tavernOptionBound) {
              button.dataset.tavernOptionBound = '1';
              button.addEventListener('click', () => chooseFromElement(button, button.dataset.optionText));
            }
          });
          return;
        }
        target.replaceChildren(...options.map(text => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'tavern-option';
          button.dataset.optionText = text;
          button.textContent = text;
          button.disabled = turn.canChoose === false;
          button.addEventListener('click', () => chooseFromElement(button, text));
          return button;
        }));
      });
    };
    const bindInputSlots = context => {
      const turn = context && context.turn || {};
      document.querySelectorAll('[data-tavern-input]').forEach(container => {
        const form = container.matches('form') ? container : container.closest('form');
        const input = container.matches('input,textarea') ? container : container.querySelector('input,textarea');
        if (!input) return;
        input.disabled = turn.canChoose === false;
        if (!input.dataset.tavernInputBound) {
          input.dataset.tavernInputBound = '1';
          const submit = () => chooseFromElement(input, input.value);
          if (form && !form.dataset.tavernInputBound) {
            form.dataset.tavernInputBound = '1';
            form.addEventListener('submit', event => { event.preventDefault(); submit(); });
          }
          input.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
          });
        }
      });
      document.querySelectorAll('[data-tavern-submit]').forEach(button => {
        if (button.dataset.tavernSubmitBound) return;
        button.dataset.tavernSubmitBound = '1';
        button.addEventListener('click', event => {
          event.preventDefault();
          const container = button.closest('form,[data-tavern-input]') || document.querySelector('[data-tavern-input]');
          const input = container?.matches('input,textarea') ? container : container?.querySelector('input,textarea');
          if (input) chooseFromElement(input, input.value);
        });
      });
    };
    const renderContextSlots = context => {
      syncMessageSurface();
      renderMessageSlots(context);
      renderNarrativeSlots(context);
      renderOptionSlots(context);
      bindInputSlots(context);
      renderDataBindings(context);
    };
    const send = (type, payload = {}) => new Promise((resolve, reject) => {
      const requestId = 'ext-' + (++sequence);
      pending.set(requestId, { resolve, reject });
      parent.postMessage({ channel, version: 1, nonce, type, requestId, ...payload }, '*');
      // AI 回合可能包含 Agent 工具循环与长思维链；扩展桥接不能用 5 秒的 UI 超时截断它。
      setTimeout(() => { if (pending.delete(requestId)) reject(new Error('扩展请求超时')); }, 120000);
    });
    window.TavernExtension = {
      requestContext: () => send('context.request'),
      on: (name, listener) => {
        const key = String(name || '').trim();
        if (!/^[a-z][a-z0-9._-]{0,63}$/.test(key) || typeof listener !== 'function') return () => {};
        const bucket = listeners.get(key) || new Set();
        bucket.add(listener);
        listeners.set(key, bucket);
        return () => {
          bucket.delete(listener);
          if (!bucket.size) listeners.delete(key);
        };
      },
      off: (name, listener) => listeners.get(String(name || '').trim())?.delete(listener),
      patch: updates => send('runtime.patch', { updates }),
      action: (actionId, input) => send('tool.call', { actionId, input }),
      choose: (text, options = {}) => send('turn.choose', {
        text,
        actionId: options && options.actionId,
        input: options && options.input,
        updates: options && options.updates,
      }),
      mvu: message => send('mvu', { message }),
      fullscreen: () => send('immersive.fullscreen'),
      exitFullscreen: () => send('immersive.exit'),
      exitWorld: () => send('workspace.exit'),
      openTerminal: () => send('terminal.open'),
    };
    window.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      parent.postMessage({ channel, version: 1, nonce, type: 'immersive.exit', reason: 'escape' }, '*');
    });
    window.addEventListener('message', event => {
      const data = event.data;
      if (!data || data.channel !== channel || data.version !== 1 || data.nonce !== nonce) return;
      if (data.type === 'context') {
        renderContextSlots(data.context);
        window.dispatchEvent(new CustomEvent('tavern-context', { detail: data.context }));
      }
      if (data.type === 'event') {
        const eventName = String(data.event || '').trim();
        const detail = data.payload && typeof data.payload === 'object' ? data.payload : {};
        (listeners.get(eventName) || []).forEach(listener => {
          try { listener(detail); } catch (error) { setTimeout(() => { throw error; }, 0); }
        });
        window.dispatchEvent(new CustomEvent('tavern-event', { detail: { name: eventName, payload: detail } }));
        return;
      }
      if (data.type !== 'response' || !data.requestId) return;
      const item = pending.get(data.requestId);
      if (!item) return;
      pending.delete(data.requestId);
      data.ok ? item.resolve(data.result) : item.reject(new Error(data.error || '扩展请求失败'));
    });
    syncMessageSurface();
    parent.postMessage({ channel, version: 1, nonce, type: 'ready' }, '*');
  })();`;
}

function worldExtensionSrcdoc(extension, nonce, themeTokens = {}) {
  const html = String(extension?.html || '').replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
  const rawCss = String(extension?.css || '');
  const js = String(extension?.js || '').replace(/<\/script/gi, '<\\/script');
  const theme = Object.entries(themeTokens && typeof themeTokens === 'object' ? themeTokens : {})
    .map(([key, value]) => `--${key}:${value}`).join(';');
  const css = `${theme ? `:root{${theme}}` : ''}${rawCss}`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{width:100%;height:100%;margin:0;min-height:100%;overflow:hidden;background:transparent;color:#f2f2f7;font:14px -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;scrollbar-width:thin;scrollbar-color:rgba(119,230,213,.7) transparent}*{scrollbar-width:thin;scrollbar-color:rgba(119,230,213,.7) transparent}*::-webkit-scrollbar{width:8px;height:8px}*::-webkit-scrollbar-track{background:rgba(255,255,255,.04);border-radius:8px}*::-webkit-scrollbar-thumb{background:linear-gradient(180deg,rgba(119,230,213,.85),rgba(93,139,202,.85));border:2px solid transparent;background-clip:padding-box;border-radius:8px}*::-webkit-scrollbar-thumb:hover{background:linear-gradient(180deg,#77e6d5,#6a9de5);border:1px solid transparent;background-clip:padding-box}#tavern-extension-root{width:100%;height:100%;min-height:100%;box-sizing:border-box}#tavern-extension-root>:first-child{box-sizing:border-box;min-height:100%}button,input,textarea,select{font:inherit}button{cursor:pointer}[data-tavern-messages]{display:flex;flex-direction:column;gap:10px;min-height:0;overflow:auto;overscroll-behavior:contain}[data-tavern-messages] .tavern-message{white-space:pre-wrap;overflow-wrap:anywhere}[data-tavern-messages] .tavern-message-user{align-self:flex-end}[data-tavern-messages] .tavern-message-assistant{align-self:flex-start}[data-tavern-narrative]{overflow-wrap:anywhere}[data-tavern-narrative][hidden]{display:none!important}[data-tavern-rendered] p{margin:.45em 0;line-height:1.7}[data-tavern-rendered] p:first-child{margin-top:0}[data-tavern-rendered] p:last-child{margin-bottom:0}[data-tavern-rendered] ul,[data-tavern-rendered] ol{padding-left:1.35em}[data-tavern-rendered] blockquote{margin:.7em 0;padding:.2em .8em;border-left:3px solid rgba(119,230,213,.7);background:rgba(119,230,213,.08)}[data-tavern-rendered] pre{max-width:100%;overflow:auto;padding:.7em;border-radius:8px;background:rgba(0,0,0,.28)}[data-tavern-rendered] code{overflow-wrap:anywhere}[data-tavern-options]{display:flex;flex-wrap:wrap;gap:10px}[data-tavern-options] .tavern-option{min-height:44px;padding:10px 14px;border-radius:10px}[data-tavern-input]{display:flex;gap:10px}[data-tavern-input] input,[data-tavern-input] textarea{min-width:0;flex:1;box-sizing:border-box}${css}</style></head><body><main id="tavern-extension-root">${html}</main><script>${extensionBridgeSource(nonce)}\n${js}</script></body></html>`;
}

function postWorldExtensionContext() {
  const iframe = worldExtensionState.iframe;
  if (!iframe?.contentWindow) return;
  iframe.contentWindow.postMessage({ channel: WORLD_EXTENSION_CHANNEL, version: 1, nonce: worldExtensionState.nonce, type: 'context', context: worldExtensionContext() }, '*');
}

function clearWorldExtension() {
  if (worldExtensionState.timer) clearTimeout(worldExtensionState.timer);
  for (const pending of worldExtensionState.pending.values()) pending.reject(new Error('扩展已卸载'));
  worldExtensionState.pending.clear();
  $('rpg-extension-frame')?.replaceChildren();
  const host = $('rpg-extension-host');
  if (host) host.hidden = true;
  worldExtensionState = { iframe: null, nonce: '', signature: '', ready: false, timer: null, pending: new Map(), nextRequestId: 0 };
}

async function submitWorldExtensionUpdates(updates, { render = true } = {}) {
  if (!worldModeActive() || !currentWorldSave) throw new Error('当前没有打开的世界存档');
  const extension = currentWorldCard()?.ui?.extension || {};
  if (!worldExtensionPermissions(extension).has('write.runtime')) throw new Error('扩展没有 write.runtime 权限');
  if (!Array.isArray(updates) || !updates.length || updates.length > 16) throw new Error('扩展更新数量无效');
  const saveId = currentWorldSave.id;
  const res = await fetch('/api/world-saves/' + encodeURIComponent(saveId) + '/runtime', {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ commandId: 'extension-' + uid(), expectedRevision: currentWorldSave.revision, updates }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(worldApiError(data, '扩展运行时提交失败（HTTP ' + res.status + '）'));
  if (currentWorldSaveId === saveId) {
    hydrateWorldSave(data);
    currentWorldSave = data;
    if (render) {
      renderRPG();
      renderMessages();
    } else {
      // Keep the current extension iframe alive while its action is waiting
      // for the narrative turn response.
      postWorldExtensionContext();
    }
  }
  return { revision: data.revision };
}
async function submitWorldExtensionChoice(text, actionId, input, updates) {
  if (!worldModeActive() || !currentWorldSave) throw new Error('当前没有打开的世界存档');
  const extension = currentWorldCard()?.ui?.extension || {};
  if (!worldExtensionPermissions(extension).has('read.save')) throw new Error('扩展没有 read.save 权限');
  const value = String(text || '').trim().slice(0, 4000);
  if (!value) throw new Error('扩展行动不能为空');
  const runtimeUpdates = [];
  if (actionId) runtimeUpdates.push({ type: 'runtime.action.execute', actionId: String(actionId), input });
  if (Array.isArray(updates)) runtimeUpdates.push(...updates);
  if (runtimeUpdates.length && !worldExtensionPermissions(extension).has('write.runtime')) throw new Error('扩展没有 write.runtime 权限');
  if (runtimeUpdates.length) await submitWorldExtensionUpdates(runtimeUpdates.slice(0, 16), { render: false });
  await submitWorldActionText(value, { throwOnError: true });
  return { revision: currentWorldSave?.revision ?? null };
}

function respondWorldExtension(event, requestId, ok, result, error) {
  if (!requestId || !event.source) return;
  event.source.postMessage({ channel: WORLD_EXTENSION_CHANNEL, version: 1, nonce: worldExtensionState.nonce, type: 'response', requestId, ok, result, ...(error ? { error } : {}) }, '*');
}

async function handleWorldExtensionMessage(event) {
  const state = worldExtensionState;
  if (!state.iframe || event.source !== state.iframe.contentWindow) return;
  const data = event.data;
  if (!data || data.channel !== WORLD_EXTENSION_CHANNEL || data.version !== 1 || data.nonce !== state.nonce) return;
  if (data.type === 'ready') {
    state.ready = true;
    if (state.timer) clearTimeout(state.timer);
    const status = $('rpg-extension-status');
    if (status) status.textContent = '已连接';
    postWorldExtensionContext();
    return;
  }
  if (data.type === 'context.request') { postWorldExtensionContext(); respondWorldExtension(event, data.requestId, true, worldExtensionContext()); return; }
  if (data.type === 'immersive.exit') {
    const escapeMode = worldUiShell().escape;
    if (data.reason === 'escape' && escapeMode === 'none') {
      respondWorldExtension(event, data.requestId, true, { immersive: worldImmersiveSession, fullscreen: Boolean(document.fullscreenElement), ignored: true });
      return;
    }
    if (data.reason === 'escape' && escapeMode === 'world') {
      respondWorldExtension(event, data.requestId, true, { immersive: false, fullscreen: false, world: false });
      await exitWorldImmersiveMode();
      setWorldCustomLayout(false);
      clearWorldExtension();
      openWorldLibrary(false);
      return;
    }
    await exitWorldImmersiveMode();
    respondWorldExtension(event, data.requestId, true, { immersive: false, fullscreen: false });
    return;
  }
  if (data.type === 'immersive.fullscreen') {
    try {
      if (!worldUiShell().fullscreen) throw new Error('当前世界卡未启用浏览器全屏');
      const ok = await enterWorldImmersiveMode({ fullscreen: true });
      respondWorldExtension(event, data.requestId, true, { immersive: true, fullscreen: Boolean(ok || document.fullscreenElement) });
    } catch (error) {
      respondWorldExtension(event, data.requestId, false, null, error.message);
    }
    return;
  }
  if (data.type === 'workspace.exit') {
    respondWorldExtension(event, data.requestId, true, { world: false, immersive: false, fullscreen: false });
    await exitWorldImmersiveMode();
    setWorldCustomLayout(false);
    clearWorldExtension();
    openWorldLibrary(false);
    return;
  }
  if (data.type === 'terminal.open') {
    openDebugTerminal();
    respondWorldExtension(event, data.requestId, true, { opened: true });
    return;
  }
  const extension = currentWorldCard()?.ui?.extension || {};
  const permissions = worldExtensionPermissions(extension);
  try {
    if (data.type === 'runtime.patch' || data.type === 'mvu') {
      if (!permissions.has('write.runtime')) throw new Error('扩展没有 write.runtime 权限');
       let message = data.type === 'runtime.patch' ? { updates: data.updates } : data.message;
       if (typeof message === 'string') {
         try { message = JSON.parse(message); } catch { message = null; }
       }
       const updates = message?.updates || message?.patch?.updates || message?.data?.updates
         || (message?.variables && typeof message.variables === 'object' && !Array.isArray(message.variables)
           ? Object.entries(message.variables).map(([id, value]) => ({ type: 'runtime.variable.set', id, value })) : null);
       if (!Array.isArray(updates)) throw new Error('MVU 消息未包含可映射的 updates 或 variables');
       const result = await submitWorldExtensionUpdates(updates);
      respondWorldExtension(event, data.requestId, true, result);
      return;
    }
    if (data.type === 'turn.choose') {
      const result = await submitWorldExtensionChoice(data.text, data.actionId, data.input, data.updates);
      respondWorldExtension(event, data.requestId, true, result);
      return;
    }
    if (data.type === 'tool.call') {
      if (!permissions.has('tool.call') || !permissions.has('write.runtime')) throw new Error('扩展没有 tool.call/write.runtime 权限');
      const actionId = String(data.actionId || '');
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(actionId)) throw new Error('扩展 actionId 无效');
      const result = await submitWorldExtensionUpdates([{ type: 'runtime.action.execute', actionId, input: data.input }], { render: false });
      if (extension.actionNarrates === true) {
        const action = (Array.isArray(currentWorldCard()?.runtime?.actions) ? currentWorldCard().runtime.actions : []).find(item => item?.id === actionId);
        await submitWorldActionText(action?.label || actionId, { throwOnError: true });
      }
      respondWorldExtension(event, data.requestId, true, result);
      return;
    }
    throw new Error('扩展消息类型不受支持');
  } catch (error) {
    respondWorldExtension(event, data.requestId, false, null, error.message);
  }
}

function renderWorldExtension() {
  const host = $('rpg-extension-host');
  const frame = $('rpg-extension-frame');
  if (!host || !frame || !worldModeActive()) { clearWorldExtension(); return; }
  const extension = currentWorldCard()?.ui?.extension;
  if (!extension || extension.enabled === false || (!extension.html && !extension.css && !extension.js && extension.mvu == null)) { clearWorldExtension(); return; }
  if (!approveWorldExtensionCode(extension)) {
    clearWorldExtension();
    setWorldCustomLayout(false);
    host.hidden = false;
    const title = $('rpg-extension-title');
    const status = $('rpg-extension-status');
    if (title) title.textContent = extension.title || '世界扩展';
    if (status) status.textContent = '脚本已阻止；刷新或修改扩展内容后可重新授权。';
    return;
  }
  const signature = JSON.stringify([currentWorldId, currentWorldSave?.worldVersion, extension]);
  host.hidden = false;
  const title = $('rpg-extension-title');
  if (title) title.textContent = extension.title || '世界扩展';
  const iframe = worldExtensionState.iframe;
  if (iframe && worldExtensionState.signature === signature) {
    iframe.style.height = `${Number(extension.maxHeight) || 360}px`;
    postWorldExtensionContext();
    return;
  }
  clearWorldExtension();
  host.hidden = false;
  const next = document.createElement('iframe');
  next.title = extension.title || '世界卡扩展';
  next.setAttribute('sandbox', 'allow-scripts');
  next.referrerPolicy = 'no-referrer';
  next.style.height = `${Number(extension.maxHeight) || 360}px`;
  const nonce = uid() + '-' + uid();
  worldExtensionState = { iframe: next, nonce, signature, ready: false, timer: null, pending: new Map(), nextRequestId: 0 };
  const status = $('rpg-extension-status');
  if (status) status.textContent = '加载中…';
  next.addEventListener('load', () => { if (worldExtensionState.iframe === next) postWorldExtensionContext(); });
  frame.replaceChildren(next);
  next.srcdoc = worldExtensionSrcdoc(extension, nonce, worldUiThemeTokens(currentWorldCard()));
  worldExtensionState.timer = setTimeout(() => {
    if (!worldExtensionState.ready && worldExtensionState.iframe === next) {
      const statusEl = $('rpg-extension-status');
      if (statusEl) statusEl.textContent = '扩展未响应（静态内容仍可用）';
    }
  }, Math.max(200, Math.min(5000, Number(extension.timeoutMs) || 1200)));
}

function renderRPG() {
  applyWorldUiSlots();
  const rs = curRpgState();
  if (!rs) return;
  const sendButton = $('btn-send');
  if (sendButton && !sending) sendButton.disabled = worldSavePlanning();
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
  const reopenButton = $('rpg-reopen-world');
  if (reopenButton) {
    const canReopen = worldModeActive() && (currentWorldSave?.state?.ending?.status === 'ended' || currentWorldSave?.state?.failure?.status === 'terminal');
    reopenButton.disabled = !canReopen || worldTurnPendingActive();
    reopenButton.title = canReopen ? '创建一份独立存档，继承过去世界线的记忆与总结' : '仅已结束或终止失败的世界线可重开';
  }
  const summaryEl = $('rpg-world-summary');
  const summaryButton = $('rpg-summary-rebuild');
  if (summaryEl && summaryButton) {
    const summary = worldModeActive() ? currentWorldSave?.worldLineSummary : null;
    const reopenInfo = worldModeActive() ? currentWorldSave?.reopenInfo : null;
    const priorSummary = reopenInfo?.sourceSummary;
    const stale = !!summary && Number(summary.sourceRevision) !== Number(currentWorldSave?.revision);
    const priorCard = reopenInfo ? `<article class="rpg-item"><div class="rpg-item-name">来自上一条世界线 <small>${esc(reopenInfo.sourceStatus || 'reopen')}</small></div><div class="rpg-item-sub">源存档 ${esc(reopenInfo.sourceSaveId || '')} · revision ${esc(reopenInfo.sourceRevision ?? '')}</div><div class="rpg-item-sub">经历 ${esc(priorSummary?.experiences?.length || 0)} · 关系 ${esc(priorSummary?.relationships?.length || 0)} · 世界变化 ${esc(priorSummary?.worldChanges?.length || 0)}</div></article>` : '';
    summaryEl.innerHTML = priorCard + (!worldModeActive()
      ? '<p class="hint">仅世界存档提供世界线总结。</p>'
      : !summary
        ? '<p class="hint">尚未生成；总结只读取已提交的经历、关系与世界变化。</p>'
        : `<article class="rpg-item"><div class="rpg-item-name">${stale ? '需要更新' : '已生成'} <small>revision ${esc(summary.sourceRevision ?? '')}</small></div><div class="rpg-item-sub">人物经历 ${esc(summary.experiences?.length || 0)} · 关系 ${esc(summary.relationships?.length || 0)} · 世界变化 ${esc(summary.worldChanges?.length || 0)}</div><div class="rpg-item-sub">${esc(summary.status === 'ended' ? '世界线已结束' : '世界线进行中')} · ${esc(summary.location?.name || summary.location?.id || '位置未记录')}</div></article>`);
    summaryButton.disabled = !worldModeActive() || worldSummaryPending;
    summaryButton.textContent = stale ? '更新总结' : '生成 / 更新总结';
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
  renderObjectives('rpg-hooks', worldModeActive() ? currentWorldSave.state?.activeHooks : [], '暂无开局 Hook。');
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
  const c = mode === 'rpg'
    ? (worldModeActive() ? (currentWorldSave.player?.snapshot || null) : null)
    : currentChar();
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
  renderWorldSidebarPanels();
  renderWorldExtension();
  renderMap(); // 世界地图（数据层 + 美化图显示）
}

/* 应用 AI 输出的 ```rpg``` JSON 状态变更；返回本轮行动选项 */
/* RPG 任务定义兜底（仅当「RPG 叙事引擎」预设被删除时使用；正常内容在预设 JSON 里可编辑） */
const RPG_TASK_FALLBACK = '你是这个幻想世界的地下城主（DM）与世界化身，始终以“你”称呼玩家。直接呈现场景、事件与 NPC，不以作者或助手自称。根据当前状态公平裁定行动；状态变化必须先在叙事中发生，再写入回复末尾唯一一个 <tavern_state_update> JSON 更新块。更新块必须使用 protocol=tavern.rpg.turn、version=1、当前 revision，并只提交允许的 typed updates；每个 update 只能使用协议声明的字段，runtime.action.execute 只能是 {type,actionId,input}，不能附加 result、args、value、execute 等字段；options 必须遵守当前世界卡回合契约（0-4 条），具体、可执行且不重复；自由输入始终可用。';

function worldOptionRules() {
  const options = currentWorldCard()?.turnContract?.options;
  return { min: Number.isInteger(options?.min) ? options.min : 4, max: Number.isInteger(options?.max) ? options.max : 4 };
}

function buildRpgAgentProfile() {
  const preset = resolvePromptPreset()?.preset || {};
  const defaultsAgent = defaults?.rpg?.agent && typeof defaults.rpg.agent === 'object' ? defaults.rpg.agent : {};
  const presetAgent = preset.agent && typeof preset.agent === 'object' ? preset.agent : {};
  const worldAgent = currentWorldCard()?.agent && typeof currentWorldCard().agent === 'object' ? currentWorldCard().agent : {};
  const mergedTools = {};
  for (const source of [defaultsAgent.tools, presetAgent.tools, worldAgent.tools]) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    for (const [name, config] of Object.entries(source)) {
      if (!config || typeof config !== 'object' || Array.isArray(config)) continue;
      mergedTools[name] = { ...(mergedTools[name] || {}), ...config };
    }
  }
  const maxSteps = Number(worldAgent.maxSteps ?? presetAgent.maxSteps ?? defaultsAgent.maxSteps ?? 1);
  return {
    protocol: String(worldAgent.protocol || presetAgent.protocol || defaultsAgent.protocol || 'tavern.rpg.agent'),
    version: Number(worldAgent.version ?? presetAgent.version ?? defaultsAgent.version ?? 1),
    mode: String(worldAgent.mode || presetAgent.mode || defaultsAgent.mode || 'tool-candidate'),
    maxSteps: Number.isInteger(maxSteps) ? Math.max(1, Math.min(8, maxSteps)) : 1,
    tools: mergedTools,
  };
}

/* Native OpenAI tool names are an allowlist, while their descriptions and
 * JSON Schemas remain data-driven through defaults / preset / world card. */
const RPG_NATIVE_TOOL_NAMES = new Set(['dice.roll', 'rules.check', 'state.patch', 'objective.upsert', 'entity.create', 'memory.record', 'context.retrieve']);
const RPG_NATIVE_TOOL_WIRE_NAMES = Object.fromEntries([...RPG_NATIVE_TOOL_NAMES].map(name => [name, name.replace(/[^a-zA-Z0-9_-]/g, '_')]));
const RPG_NATIVE_TOOL_INTERNAL_NAMES = Object.fromEntries(Object.entries(RPG_NATIVE_TOOL_WIRE_NAMES).map(([internal, wire]) => [wire, internal]));
function normalizeRpgAgentToolName(name) {
  const raw = String(name || '');
  return RPG_NATIVE_TOOL_INTERNAL_NAMES[raw] || (RPG_NATIVE_TOOL_NAMES.has(raw) ? raw : raw);
}
function buildRpgNativeToolDefinitions(profile = buildRpgAgentProfile()) {
  if (!profile || !profile.tools) return [];
  return Object.entries(profile.tools)
    .filter(([name, config]) => RPG_NATIVE_TOOL_NAMES.has(name) && config && config.enabled !== false)
    .map(([name, config]) => {
      let parameters = { type: 'object', properties: {}, additionalProperties: false };
      if (config.parameters && typeof config.parameters === 'object' && !Array.isArray(config.parameters)) {
        try {
          const candidate = cloneValue(config.parameters);
          if (JSON.stringify(candidate).length <= 12000) parameters = candidate;
        } catch { /* malformed local schema falls back to an empty object schema */ }
      }
      return {
        type: 'function',
        function: {
          name: RPG_NATIVE_TOOL_WIRE_NAMES[name],
          description: String(config.description || name).slice(0, 1000),
          parameters,
        },
      };
    });
}

/*
 * RPG 输出协议边界。
 * 新协议使用独立标签承载机器数据；旧版 ```rpg``` 仅作为兼容输入。
 * 这些函数只负责定位、解码和报告错误，不修改任何存档状态。
 */
const RPG_UPDATE_TAG = 'tavern_state_update';
const RPG_UPDATE_OPEN = `<${RPG_UPDATE_TAG}>`;
const RPG_UPDATE_CLOSE = `</${RPG_UPDATE_TAG}>`;

function stripJsonFence(text) {
  return String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function parseRpgUpdatePayload(rawUpdate) {
  const raw = String(rawUpdate || '').trim();
  if (!raw) return { payload: null, errorCode: 'update.empty', errorMessage: '状态更新区为空', repairable: true };
  try {
    const payload = JSON.parse(stripJsonFence(raw));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { payload: null, errorCode: 'update.root_not_object', errorMessage: '状态更新根节点必须是对象', repairable: false };
    }
    return { payload, errorCode: null, errorMessage: null, repairable: false };
  } catch (error) {
    return { payload: null, errorCode: 'update.invalid_json', errorMessage: error.message, repairable: true };
  }
}

function parseTaggedRpgOutput(text) {
  const first = text.indexOf(RPG_UPDATE_OPEN);
  if (first < 0) return null;
  const second = text.indexOf(RPG_UPDATE_OPEN, first + RPG_UPDATE_OPEN.length);
  const close = text.indexOf(RPG_UPDATE_CLOSE, first + RPG_UPDATE_OPEN.length);
  if (second >= 0) {
    return {
      format: 'tagged', found: true, complete: false,
      narrative: text.slice(0, first).trim(), rawUpdate: null, payload: null,
      errorCode: 'update.duplicate', errorMessage: '状态更新标签重复', repairable: false,
    };
  }
  if (close < 0) {
    return {
      format: 'tagged', found: true, complete: false,
      narrative: text.slice(0, first).trim(), rawUpdate: text.slice(first + RPG_UPDATE_OPEN.length).trim(), payload: null,
      errorCode: 'update.missing_end', errorMessage: `缺少 ${RPG_UPDATE_CLOSE}`, repairable: true,
    };
  }
  const trailing = text.slice(close + RPG_UPDATE_CLOSE.length).trim();
  if (trailing) {
    return {
      format: 'tagged', found: true, complete: true,
      narrative: text.slice(0, first).trim(), rawUpdate: text.slice(first + RPG_UPDATE_OPEN.length, close).trim(), payload: null,
      errorCode: 'update.trailing_content', errorMessage: '状态更新结束标签后存在额外内容', repairable: false,
    };
  }
  const rawUpdate = text.slice(first + RPG_UPDATE_OPEN.length, close).trim();
  const parsed = parseRpgUpdatePayload(rawUpdate);
  return {
    format: 'tagged', found: true, complete: true,
    narrative: text.slice(0, first).trim(), rawUpdate,
    payload: parsed.payload, errorCode: parsed.errorCode, errorMessage: parsed.errorMessage, repairable: parsed.repairable,
  };
}

/* RPG 输出分为叙事正文与末尾控制块；流式输出未闭合时也不把控制 JSON 混进叙事栏。 */
function splitRpgOutput(reply) {
  const text = String(reply || '');
  const start = text.match(/(?:^|\r?\n)[ \t]*```rpg(?:[ \t]*\r?\n|[ \t]*$)/i);
  if (!start) return { content: text.trim(), payload: null, found: false, complete: true };
  const rest = text.slice(start.index + start[0].length);
  const end = rest.match(/\r?\n?[ \t]*```[ \t]*$/);
  return {
    content: text.slice(0, start.index).trim(),
    payload: end ? rest.slice(0, end.index).trim() : null,
    found: true,
    complete: !!end,
  };
}

/* 新协议优先，旧 ```rpg``` 只读兼容；不会在此处应用状态。 */
function parseRpgOutput(reply) {
  const text = String(reply || '');
  const tagged = parseTaggedRpgOutput(text);
  if (tagged) return tagged;
  const legacy = splitRpgOutput(text);
  if (!legacy.found) {
    return { format: 'none', found: false, complete: true, narrative: text.trim(), rawUpdate: null, payload: null, errorCode: null, errorMessage: null, repairable: false };
  }
  if (!legacy.complete) {
    return { format: 'legacy-rpg', found: true, complete: false, narrative: legacy.content, rawUpdate: null, payload: null, errorCode: 'legacy.missing_end', errorMessage: '旧版 rpg 代码块未闭合', repairable: true, legacy: true };
  }
  const parsed = parseRpgUpdatePayload(legacy.payload);
  return {
    format: 'legacy-rpg', found: true, complete: true, narrative: legacy.content, rawUpdate: legacy.payload,
    payload: parsed.payload, errorCode: parsed.errorCode, errorMessage: parsed.errorMessage, repairable: parsed.repairable, legacy: true,
  };
}

function normalizeTavernReplyOptions(value, preset = null) {
  const rules = tavernReplyOptionRules(preset);
  if (!rules.enabled) return [];
  const source = Array.isArray(value) ? value : (value && typeof value === 'object' && Array.isArray(value.options) ? value.options : []);
  const seen = new Set();
  return source
    .map(item => typeof item === 'string' ? item : (item && typeof item === 'object' ? item.text || item.label || '' : ''))
    .map(item => String(item || '').replace(/\s+/g, ' ').trim().slice(0, 240))
    .filter(item => item && !seen.has(item) && seen.add(item))
    .slice(0, rules.max);
}

function hasTavernReplyOptionsProtocol(text) {
  return /<tavern_options\b/i.test(String(text || ''));
}

function builtInTavernReplyOptionsInstruction() {
  return String(defaults?.presets?.['RP 基础（示例）']?.postHistory || '').match(/【AI 回复选项协议】[\s\S]*$/)?.[0] || '';
}

/* Tavern 模式的选项协议：隐藏标签只负责把 AI 建议传给快捷栏，不进入正文。 */
function parseTavernReplyOutput(reply, preset = null) {
  const text = String(reply || '');
  const open = /<tavern_options\b[^>]*>/i.exec(text);
  if (!open) return { content: text.trim(), options: null, found: false, complete: true, errorCode: null };
  const closeRe = /<\/tavern_options\s*>/ig;
  closeRe.lastIndex = open.index + open[0].length;
  const close = closeRe.exec(text);
  if (!close) {
    // 不要因模型漏写结束标签而丢掉标签后的正文；协议修复会另行处理选项。
    const visible = text.slice(0, open.index) + text.slice(open.index + open[0].length);
    return { content: visible.trim(), options: null, found: true, complete: false, errorCode: 'options.missing_end' };
  }
  const raw = text.slice(open.index + open[0].length, close.index).trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      content: text.replace(/<tavern_options\b[^>]*>[\s\S]*?(?:<\/tavern_options\s*>|$)/gi, '').trim(),
      options: null, found: true, complete: true, errorCode: 'options.invalid_json', errorMessage: error.message,
    };
  }
  const options = normalizeTavernReplyOptions(parsed, preset);
  // 即使模型重复输出协议标签，也全部从可见正文移除，避免把内部 JSON 泄露到聊天栏。
  const visibleContent = text.replace(/<tavern_options\b[^>]*>[\s\S]*?(?:<\/tavern_options\s*>|$)/gi, '').trim();
  return {
    content: visibleContent,
    options: options.length ? options : null,
    found: true,
    complete: true,
    errorCode: null,
  };
}

/* AI 输出处理：先解析 RPG 控制块，再对可见正文执行当前模式输出正则。 */
function processAIOutput(reply) {
  if (mode !== 'rpg') {
    const parsed = parseTavernReplyOutput(reply, resolvePromptPreset()?.preset || null);
    if (parsed.errorCode) console.warn('[Tavern] RP 选项标签解析失败:', parsed.errorCode, parsed.errorMessage || '');
    const rawContent = String(parsed.content || '');
    return { content: applyOutputRegex(rawContent), rawContent, options: parsed.options, protocol: parsed };
  }
  const parsed = parseRpgOutput(reply);
  if (parsed.errorCode) console.warn('[Tavern] RPG 状态块解析失败:', parsed.errorCode, parsed.errorMessage || '');
  const update = parsed.format === 'tagged' ? parsed.payload : applyRpgUpdate(parsed.payload ? JSON.stringify(parsed.payload) : null); // 新协议交给服务端原子提交，旧协议保留兼容适配器
  let patch = parsed.format === 'tagged' && parsed.payload ? { ...parsed.payload } : null;
  if (patch) {
    // toolCalls 只是候选元数据，不能随 patch 进入服务端状态校验或获得执行权。
    delete patch.toolCalls;
    patch = normalizeRpgPatch(patch);
  }
  const rawContent = stripRpgNarrativeOptions(parsed.narrative);
  return {
    content: applyOutputRegex(rawContent),
    rawContent,
    options: Array.isArray(update?.options) ? update.options : null,
    createEntities: update?.createEntities || null,
    eventMemory: update?.eventMemory || null,
    agentCalls: parsed.payload?.toolCalls ?? null,
    patch,
    protocol: parsed,
  };
}

// 叙事正文只保留故事；选项统一来自控制块并由底部快捷栏渲染。
function stripRpgNarrativeOptions(text) {
  const source = String(text || '').trim();
  const match = source.match(/\n(?:#{1,3}\s*)?(?:行动选项|可选行动|可选动作|下一步行动|选项|接下来(?:你)?可以|你可以(?:选择)?)\s*[:：]?\s*\n([\s\S]*)$/i);
  if (!match) return source;
  const optionLines = match[1].split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const marked = optionLines.filter(line => /^(?:[-*•]|\d+[.)、])\s+/.test(line));
  return marked.length >= 2 ? source.slice(0, match.index).trim() : source;
}

function normalizeRpgPatch(patch) {
  if (!patch || !Array.isArray(patch.updates)) return patch;
  return {
    ...patch,
    updates: patch.updates.map(update => {
      if (update?.type !== 'location.set') return update;
      const raw = update.locationId ?? update.location ?? update.id ?? update.value;
      const locationId = raw && typeof raw === 'object' ? raw.id : raw;
      return locationId === undefined || locationId === null
        ? update
        : { type: 'location.set', locationId: String(locationId).trim() };
    }),
  };
}

const RPG_PATCH_UPDATE_KEYS = Object.freeze({
  'player.resource.delta': ['type', 'id', 'delta'],
  'player.attribute.delta': ['type', 'id', 'delta'],
  'player.skill.delta': ['type', 'id', 'delta'],
  'currency.delta': ['type', 'id', 'delta'],
  'inventory.delta': ['type', 'itemId', 'delta', 'name', 'desc', 'weight'],
  'location.set': ['type', 'locationId'],
  'effect.add': ['type', 'value'],
  'effect.remove': ['type', 'value'],
  'objective.status': ['type', 'kind', 'id', 'status'],
  'objective.upsert': ['type', 'kind', 'id', 'title', 'desc', 'status', 'actorId', 'locationId', 'deadline', 'tags'],
  'runtime.variable.set': ['type', 'id', 'value'],
  'runtime.variable.delta': ['type', 'id', 'delta'],
  'runtime.collection.add': ['type', 'collectionId', 'value'],
  'runtime.collection.remove': ['type', 'collectionId', 'entryId'],
  'runtime.action.execute': ['type', 'actionId', 'input'],
});

/* 提交前拦截最常见的“格式漂移”，避免等服务端拒绝后才让玩家重试。 */
function validateRpgPatchShape(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return 'patch 必须是对象';
  const allowedPatchKeys = ['protocol', 'version', 'baseRevision', 'updates', 'options', 'createEntities', 'eventMemory'];
  const extraPatchKey = Object.keys(patch).find(key => !allowedPatchKeys.includes(key));
  if (extraPatchKey) return `patch 含有未声明字段 ${extraPatchKey}`;
  if (!Array.isArray(patch.updates)) return 'patch.updates 必须是数组';
  for (const update of patch.updates) {
    const allowedKeys = RPG_PATCH_UPDATE_KEYS[update?.type];
    if (!allowedKeys) return 'patch.updates 含有不受支持的操作';
    const extraKey = Object.keys(update).find(key => !allowedKeys.includes(key));
    if (extraKey) return `patch.${update.type} 含有未声明字段 ${extraKey}`;
  }
  return null;
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
    if (!Number.isInteger(n) || n < 1 || !Number.isInteger(d) || d < 1 || d > 1000000) return m;
    const bonus = mod ? parseInt(mod, 10) : 0;
    const rolls = [];
    for (let i = 0; i < n; i++) rolls.push(1 + Math.floor(Math.random() * d));
    const sum = rolls.reduce((a, b) => a + b, 0);
    results.push({ expr: m, rolls, bonus, total: sum + bonus });
    return m;
  });
  return results;
}
function rollWorldDice(text) {
  const expressions = [];
  String(text || '').replace(DICE_RE, match => { if (!expressions.includes(match)) expressions.push(match); return match; });
  if (!expressions.length) return [];
  return rollDiceIn(expressions.join(' '));
}

/* ─────────── Markdown 渲染（marked + DOMPurify 消毒） ───────────
 * 参考 Open WebUI：解析后必须消毒（AI / 用户内容不可信）
 * 返回 { html, md }：md=true 表示已渲染，气泡加 .md 类取消 pre-wrap */
function normalizeTavernHtmlBlocks(content) {
  const source = String(content ?? '');
  const hasLayoutHtml = (value) => /<(?:html|body|main|section|article|header|footer|aside|nav|div|span|table|details|style|h[1-6]|p)\b/i.test(value)
    && /<\/[A-Za-z][\w:-]*\s*>/i.test(value);
  const htmlLine = /^\s*(?:<!--|<\/?[A-Za-z][\w:-]*(?:\s+[^<>]*|\/?\s*>))/i;

  // ST/JS-Slash-Runner 卡片常把正则替换结果标成 ```text```，但内容本身是完整 HTML。
  // 只在检测到完整布局时展开；最终仍交给 DOMPurify，脚本另经授权后进入隔离 iframe。
  let normalized = source.replace(/(^|\n)[ \t]*```(?:html?|xhtml|text|plaintext|markdown)?\s*\r?\n([\s\S]*?)\r?\n[ \t]*```/gi, (full, prefix, body) => (
    hasLayoutHtml(body) ? `${prefix}${body}` : full
  ));

  // Markdown 会把 4 个以上的前导空格当作代码块；卡片常把 HTML 子节点缩进，
  // 因此只在检测到完整 HTML 布局时去掉标签行缩进，保留普通文本与非 HTML 代码块。
  const chunks = normalized.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g);
  normalized = chunks.map((chunk, index) => {
    if (index % 2 || !hasLayoutHtml(chunk)) return chunk;
    return chunk.split(/\r?\n/).map(line => htmlLine.test(line) ? line.replace(/^[ \t]+/, '') : line).join('\n');
  }).join('');
  return normalized;
}

function expandDisplayMacros(content) {
  const userName = String(currentUserPreset()?.name || '玩家').replace(/[\r\n]+/g, ' ');
  return String(content ?? '').replace(/\{\{\s*user\s*\}\}/gi, userName);
}

/* DOMPurify 会移除 style 元素；卡片的声明式 HTML/CSS 需要保留样式，
 * 但不能把 CSS 变成主页面的任意脚本/外链入口。样式规则统一限定在当前消息容器。 */
const TAVERN_RENDER_SCOPE = '[data-tavern-rendered]';
function sanitizeTavernCss(css, scope = true) {
  let safe = String(css || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@(?:import|charset|namespace)[^;{}]*;?/gi, '')
    .replace(/url\s*\([^)]*\)/gi, '')
    .replace(/\b(?:expression|behavior|-moz-binding)\s*\([^)]*\)/gi, '')
    .replace(/(?:javascript|vbscript|data):/gi, '')
    .replace(/<\/?style/gi, '');
  if (!scope) return safe;
  return safe.replace(/(^|[{}])\s*([^{}@][^{]*)\{/g, (full, open, selectors) => {
    const scoped = selectors.split(',').map(selector => selector.trim())
      .filter(Boolean)
      .map(selector => {
        // 卡片常用 body/html/:root 作为整页背景选择器；消息气泡没有这些节点，
        // 将根选择器映射到当前消息容器，不能简单删掉（否则会留下裸 CSS 声明）。
        const rest = selector.replace(/^(?:(?:html\s+)?body|html|:root)\b/i, '').trim();
        if (!rest) return TAVERN_RENDER_SCOPE;
        return `${TAVERN_RENDER_SCOPE}${/^(?::|[>+~])/.test(rest) ? '' : ' '}${rest}`;
      }).join(', ');
    return scoped ? `${open}${scoped}{` : open;
  });
}

function extractTavernStyles(source, scope = true) {
  const styles = [];
  const chunks = String(source || '').split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g);
  const markup = chunks.map((chunk, index) => {
    if (index % 2) return chunk; // 代码块内的示例只能按文本显示
    return chunk.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (full, css) => {
      const safe = sanitizeTavernCss(css, scope);
      if (safe.trim()) styles.push(`<style data-tavern-card-style>${safe}</style>`);
      return '';
    });
  }).join('');
  return { markup, styles: styles.join('') };
}

/* 卡片脚本只在显式授权的完整兼容 iframe 中运行；代码块里的脚本仍是普通文本。 */
function extractTavernScripts(source) {
  const scripts = [];
  const chunks = String(source || '').split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g);
  const markup = chunks.map((chunk, index) => {
    if (index % 2) return chunk;
    return chunk.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (full, attrs, code) => {
      const src = String(attrs || '').match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || '';
      scripts.push({ src: String(src).trim(), code: String(code || '') });
      return '';
    });
  }).join('');
  return { markup, scripts };
}

const TAVERN_CARD_EVENT_ATTRS = ['onclick', 'ondblclick', 'onchange', 'oninput', 'onsubmit', 'onload', 'onerror', 'onkeydown', 'onkeyup', 'onfocus', 'onblur'];

function safeTavernCardScriptUrl(value) {
  try {
    const parsed = new URL(String(value || ''), window.location.href);
    // ST 角色卡允许声明外部脚本；仍拒绝 javascript/data/file 等可执行协议。
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.href;
  } catch { return ''; }
}

function cardScriptInventory(char = currentChar()) {
  const entries = [];
  const seen = new Set();
  const visit = node => {
    if (typeof node === 'string') {
      if (!/<script\b/i.test(node)) return;
      // 角色卡正则常把完整 HTML（含脚本）放在 ```text``` 围栏里；
      // 与实际渲染保持同一解围栏规则，避免授权清单误判为未知脚本。
      for (const entry of extractTavernScripts(normalizeTavernHtmlBlocks(node)).scripts) entries.push(entry);
      return;
    }
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { node.forEach(visit); return; }
    Object.values(node).forEach(visit);
  };
  visit(char?.firstMes || '');
  visit(char?.cardData);
  visit(char?.cardExtensions);
  const unique = new Map(entries.map(entry => [`${entry.src}\n${entry.code}`, entry]));
  return [...unique.values()];
}

function approveCharacterCardScripts(scripts) {
  const character = currentChar();
  if (!character || !Array.isArray(scripts) || !scripts.length) return false;
  const inventory = cardScriptInventory(character);
  const inventoryKeys = new Set(inventory.map(entry => `${entry.src}\n${entry.code}`));
  if (scripts.some(entry => !inventoryKeys.has(`${entry.src}\n${entry.code}`))) return false;
  const supportedExternal = scripts.filter(entry => entry.src).map(entry => safeTavernCardScriptUrl(entry.src));
  if (supportedExternal.some(src => !src)) return false;
  const key = `${character.id || 'character'}:${lorebookHash(JSON.stringify(inventory))}`;
  const approvals = prefs.cardScriptApprovals && typeof prefs.cardScriptApprovals === 'object' ? prefs.cardScriptApprovals : {};
  if (approvals[key] === true) return true;
  if (cardScriptDeniedApprovals.has(key)) return false;
  const inlineCount = scripts.filter(entry => !entry.src).length;
  const externalCount = scripts.filter(entry => entry.src).length;
  const approved = typeof window !== 'undefined' && typeof window.confirm === 'function'
    ? window.confirm(`当前角色卡包含 ${inlineCount} 个内联脚本${externalCount ? `和 ${externalCount} 个外部依赖` : ''}。\n确认后将在同源完整兼容 iframe 中运行，不启用 sandbox/CSP 隔离；卡片脚本可访问宿主 DOM、localStorage、外部脚本和网络请求。\n已提供 triggerSlash('/send …|/trigger')、copyToTavernDialog()、TavernCard.send/copy，以及只读的 getLastMessageId()/getCurrentMessageId()/getChatMessages()/getCharWorldbookNames()/getWorldbook()，用于兼容读取当前对话和角色卡世界书。\n仅导入你信任的角色卡；是否启用本卡脚本？`)
    : false;
  if (approved) {
    prefs.cardScriptApprovals = { ...approvals, [key]: true };
    saveJSON(LS_PREFS, prefs);
  } else {
    cardScriptDeniedApprovals.add(key);
  }
  return approved;
}

// ST 角色卡脚本需要同步读取聊天/角色书；仍注入只读快照，避免卡内脚本依赖宿主内部实现。
function tavernCardCompatibilitySnapshot() {
  const char = currentChar();
  const sourceMessages = curMessages();
  // ponytail: cap the injected snapshot at 200 messages; raise only for cards that need deeper history.
  const messages = (Array.isArray(sourceMessages) ? sourceMessages : []).slice(-200).map((message, index) => {
    // ST's getChatMessages() returns the pre-display message. Keep that
    // channel when available so card-side loaders can still see structured
    // tags that a display regex intentionally removes from `content`.
    const content = String(message?.rawContent ?? message?.content ?? '');
    const isUser = message?.role === 'user';
    const isSystem = message?.role === 'system' || message?.meta === true;
    return {
      message_id: index,
      message: content,
      mes: content,
      content,
      name: isUser ? String(currentUserPreset()?.name || '玩家') : (isSystem ? '系统' : String(char?.name || '角色')),
      is_user: isUser,
      is_system: isSystem,
      role: String(message?.role || 'assistant'),
      send_date: message?.ts ? new Date(message.ts).toISOString() : '',
    };
  });
  const books = {};
  const names = { primary: '', additional: [] };
  const addBook = (bookId, fallbackName = '') => {
    const book = bookId && lorebooks && lorebooks[bookId];
    if (!book) return '';
    const name = String(book.name || fallbackName || bookId);
    books[name] = (Array.isArray(book.entries) ? book.entries : Object.values(book.entries || {})).map((entry, index) => {
      const serialized = serializeSTWorldInfoEntry(entry, index);
      return { ...serialized, name: serialized.comment };
    });
    return name;
  };
  const primaryName = addBook(char?.characterBookLoreId) || addBook(char?.loreId) || '';
  if (primaryName) names.primary = primaryName;
  const activeName = addBook(prefs?.activeLoreId);
  if (activeName && activeName !== primaryName) names.additional.push(activeName);
  const inlineBook = characterBookForChar(char);
  if (inlineBook && !primaryName) {
    const name = String(inlineBook.name || `${char?.name || '角色'} · 角色卡世界书`);
    books[name] = normalizeCharacterBookEntries(inlineBook).map((entry, index) => {
      const serialized = serializeSTWorldInfoEntry(entry, index);
      return { ...serialized, name: serialized.comment };
    });
    names.primary = name;
  }
  return { messages, worldbooks: { names, books }, currentChatId: String(currentSessionId || '') };
}

function sanitizeTavernMarkup(source, parser, allowEvents = false) {
  const raw = parser ? parser.parse(source, {
    gfm: true,
    breaks: true,
    headerIds: false,
    mangle: false,
    smartypants: false,
  }) : source;
  const div = document.createElement('div');
  div.innerHTML = window.DOMPurify.sanitize(raw, {
    DATA_URI_TAGS: ['img'],
    ADD_ATTR: ['target', 'rel', ...(allowEvents ? TAVERN_CARD_EVENT_ATTRS : [])],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
  });
  div.querySelectorAll('[style]').forEach(node => {
    const safe = sanitizeTavernCss(node.getAttribute('style'), false).trim();
    if (safe) node.setAttribute('style', safe);
    else node.removeAttribute('style');
  });
  div.querySelectorAll('a').forEach(link => {
    if (/^https?:\/\//i.test(link.getAttribute('href') || '')) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer nofollow';
    }
  });
  return div.innerHTML;
}

function tavernCardFrameBridgeSource(nonce, compatibility = {}) {
  const token = JSON.stringify(String(nonce || ''));
  const snapshot = JSON.stringify(compatibility).replace(/</g, '\\u003c');
  return `(function(global){
  if (global.__tavernCardBridge) { global.__tavernCardBridge.install(); return; }
  const nonce = ${token};
  const compatibility = ${snapshot};
  const pending = new Map();
  let sequence = 0;
  function request(action, payload) {
    return new Promise(resolve => {
      const requestId = 'card-' + (++sequence);
      pending.set(requestId, resolve);
      try {
        parent.postMessage({ channel: 'tavern.card.frame', type: 'action', nonce, action, requestId, payload }, '*');
      } catch (_) {
        pending.delete(requestId);
        resolve({ ok: false, error: '宿主桥不可用' });
        return;
      }
      setTimeout(() => {
        if (!pending.has(requestId)) return;
        pending.delete(requestId);
        resolve({ ok: false, error: '宿主响应超时' });
      }, 5000);
    });
  }
  function text(value) { return String(value == null ? '' : value); }
  function copy(value) { return request('copy', { text: text(value) }); }
  function send(value) { return request('send', { text: text(value) }); }
  function notice(value) { return request('notice', { text: text(value).slice(0, 4000) }); }
  function triggerSlash(command) {
    const value = text(command).trim();
    if (!/^\\/send(?:\\s|$)/i.test(value)) {
      console.warn('[Tavern] 角色卡仅兼容 /send 命令');
      return Promise.resolve({ ok: false, error: '仅支持 /send 命令' });
    }
    const body = value.replace(/^\\/send\\s*/i, '').replace(/\\s*\\|\\/trigger\\s*$/i, '').trim();
    return body ? send(body) : Promise.resolve({ ok: false, error: '发送内容为空' });
  }
  function chatRange(range) {
    const list = Array.isArray(compatibility.messages) ? compatibility.messages : [];
    if (range == null || range === '') return list.slice();
    const value = String(range).trim();
    let start = 0;
    let end = list.length - 1;
    const match = value.match(/^(-?\\d+)\\s*-\\s*(-?\\d+)$/);
    if (match) {
      start = Number(match[1]);
      end = Number(match[2]);
    } else if (/^-?\\d+$/.test(value)) {
      start = Number(value);
      end = start;
    }
    if (start < 0) start = Math.max(0, list.length + start);
    if (end < 0) end = Math.max(0, list.length + end);
    if (end < start) return [];
    return list.slice(Math.max(0, start), Math.min(list.length, end + 1));
  }
  function getLastMessageId() { return Math.max(-1, (compatibility.messages || []).length - 1); }
  function getCurrentMessageId() { return getLastMessageId(); }
  function getChatMessages(range) { return chatRange(range); }
  function getAllChatMessages() { return chatRange(); }
  function getCharWorldbookNames() { return compatibility.worldbooks?.names || { primary: '', additional: [] }; }
  function getWorldbook(name) { return compatibility.worldbooks?.books?.[String(name || '')] || []; }
  function getCurrentChatId() { return String(compatibility.currentChatId || ''); }
  function memoryStorage() {
    const values = Object.create(null);
    return {
      get length() { return Object.keys(values).length; },
      key(index) { return Object.keys(values)[Number(index)] ?? null; },
      getItem(key) { const name = String(key); return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : null; },
      setItem(key, value) { values[String(key)] = String(value); },
      removeItem(key) { delete values[String(key)]; },
      clear() { Object.keys(values).forEach(key => delete values[key]); },
    };
  }
  function installStorage() {
    ['localStorage', 'sessionStorage'].forEach(name => {
      let available = false;
      try { available = !!global[name]; } catch (_) {}
      if (available) return;
      try { Object.defineProperty(global, name, { configurable: true, enumerable: true, value: memoryStorage() }); } catch (_) {}
    });
  }
  function jsonResponse(value) {
    const body = JSON.stringify(value);
    if (typeof global.Response === 'function') return Promise.resolve(new global.Response(body, { status: 200, headers: { 'content-type': 'application/json' } }));
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(value), text: () => Promise.resolve(body) });
  }
  function installFixtureFetch() {
    if (global.__tavernCardFetchInstalled) return;
    try {
      const nativeFetch = typeof global.fetch === 'function' ? global.fetch.bind(global) : null;
      Object.defineProperty(global, 'fetch', {
        configurable: true,
        writable: true,
        value(input, init) {
          const raw = typeof input === 'string' ? input : input?.url;
          const path = String(raw || '').split(/[?#]/, 1)[0];
          if (/(?:^|\\/)(?:testMessage_data|testWorldBooks)\\.json$/i.test(path)) {
            if (/testWorldBooks/i.test(path)) {
              const books = compatibility.worldbooks?.books || {};
              const firstBook = Object.keys(books)[0];
              return jsonResponse(firstBook ? books[firstBook] : []);
            }
            return jsonResponse(Array.isArray(compatibility.messages) ? compatibility.messages : []);
          }
          return nativeFetch ? nativeFetch(input, init) : Promise.reject(new TypeError('角色卡运行环境没有 fetch'));
        },
      });
      global.__tavernCardFetchInstalled = true;
    } catch (_) {}
  }
  function worldbookContent(fragment) {
    const books = compatibility.worldbooks?.books || {};
    for (const entries of Object.values(books)) {
      for (const entry of Array.isArray(entries) ? entries : []) {
        if (String(entry?.name || '').includes(fragment) && String(entry?.content || '').trim()) return String(entry.content);
      }
    }
    return '[]';
  }
  function installSTDataGlobals() {
    const values = {
      POV_Style: worldbookContent('视角标签数据源'),
      worldview_list_data: worldbookContent('世界观标签数据源'),
      character_list_data: worldbookContent('角色标签数据源'),
      rule_list_data: worldbookContent('规则标签数据源'),
      writing_new_style_list_data: worldbookContent('文风标签数据源'),
    };
    Object.entries(values).forEach(([name, value]) => {
      try {
        if (typeof global[name] === 'undefined') global[name] = value;
      } catch (_) {}
    });
  }
  function install() {
    installStorage();
    installFixtureFetch();
    installSTDataGlobals();
    global.TavernCard = { send, copy, setInput: copy };
    global.triggerSlash = triggerSlash;
    global.copyToTavernDialog = copy;
    global.getLastMessageId = getLastMessageId;
    global.getCurrentMessageId = getCurrentMessageId;
    global.getChatMessages = getChatMessages;
    global.getAllChatMessages = getAllChatMessages;
    global.getCharWorldbookNames = getCharWorldbookNames;
    global.getWorldbook = getWorldbook;
    global.getCurrentChatId = getCurrentChatId;
    if (typeof global.simpleLog !== 'function') global.simpleLog = (...args) => console.debug('[Tavern card]', ...args);
    if (typeof global.writeLog !== 'function') global.writeLog = (...args) => console.debug('[Tavern card]', ...args);
  }
  global.addEventListener('message', event => {
    const data = event.data;
    if (!data || data.channel !== 'tavern.card.frame' || data.nonce !== nonce || data.type !== 'response') return;
    const resolve = pending.get(data.requestId);
    if (!resolve) return;
    pending.delete(data.requestId);
    resolve(data.ok ? { ok: true, result: data.result } : { ok: false, error: data.error || '宿主桥请求失败' });
  });
  global.__tavernCardBridge = { install };
  install();
})(window);`;
}

function tavernCardScriptFrame(css, markup, scripts, compatibility = {}) {
  const nonce = uid() + '-' + uid();
  const scriptMarkup = scripts.map(entry => {
    if (entry.src) {
      const src = safeTavernCardScriptUrl(entry.src);
      return src ? `<script src="${esc(src)}"></script>` : '';
    }
    const code = String(entry.code || '').replace(/<\/script/gi, '<\\/script');
    return `<script>(function(){\n${code}\n}).call(window);</script>`;
  }).join('');
  // `extractTavernStyles()` returns style wrappers for the host renderer; the
  // iframe owns the wrapper, so keep only the sanitized declarations here.
  const safeCss = String(css || '')
    .replace(/<\/?style\b[^>]*>/gi, '')
    .replace(/<\/style/gi, '<\\/style');
  const bridge = tavernCardFrameBridgeSource(nonce, compatibility).replace(/<\/script/gi, '<\\/script');
  const srcdoc = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;min-height:0;overflow:auto}#tavern-card-frame-root{width:100%;min-height:0;box-sizing:border-box}${safeCss}</style></head><body><main id="tavern-card-frame-root">${markup}</main><script>(function(){const nonce=${JSON.stringify(nonce)};function report(){try{const root=document.getElementById('tavern-card-frame-root');const rect=root?.getBoundingClientRect();const height=Math.ceil(Math.max(root?.scrollHeight||0,rect?.height||0));parent.postMessage({channel:'tavern.card.frame',type:'resize',nonce,height},'*')}catch(_){}}addEventListener('load',report);setTimeout(report,0);const root=document.getElementById('tavern-card-frame-root');if(typeof ResizeObserver==='function'&&root)new ResizeObserver(report).observe(root);})();</script><script>${bridge}</script>${scriptMarkup}<script>${bridge}</script></body></html>`;
  return `<div class="tavern-card-script-shell" data-tavern-card-script data-tavern-card-mode="full"><iframe class="tavern-card-script-frame" title="角色卡完整兼容运行区" data-tavern-card-nonce="${esc(nonce)}" referrerpolicy="no-referrer" srcdoc="${esc(srcdoc)}"></iframe></div>`;
}

let tavernCardFrameBridgeReady = false;
function setTavernCardDialogInput(value) {
  const input = $('input');
  if (!input) throw new Error('当前页面没有 Tavern 输入框');
  input.value = String(value || '').trim();
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
  setApiStatus('角色卡内容已填入当前对话框');
  return { textLength: input.value.length };
}

function tavernCardActionText(data) {
  const value = data?.payload && typeof data.payload === 'object' ? data.payload.text : data?.text;
  const text = String(value == null ? '' : value).trim();
  if (!text) throw new Error('角色卡发送内容为空');
  if (text.length > 40000) throw new Error('角色卡发送内容超过 40000 字符限制');
  return text;
}

function initTavernCardFrameBridge() {
  if (tavernCardFrameBridgeReady || typeof window === 'undefined') return;
  tavernCardFrameBridgeReady = true;
  window.addEventListener('message', event => {
    if (event.data?.channel !== 'tavern.card.frame') return;
    const frame = [...document.querySelectorAll('[data-tavern-card-script] iframe')]
      .find(item => item.contentWindow === event.source && item.dataset.tavernCardNonce === String(event.data.nonce || ''));
    if (!frame) return;
    const data = event.data;
    if (data.type === 'resize') {
      const height = Math.max(1, Math.min(2400, Number(data.height) || 1));
      frame.style.height = `${height}px`;
      return;
    }
    if (data.type !== 'action' || !data.requestId) return;
    const respond = (ok, result, error) => event.source.postMessage({
      channel: 'tavern.card.frame', type: 'response', nonce: frame.dataset.tavernCardNonce,
      requestId: data.requestId, ok, ...(ok ? { result } : { error: String(error || '角色卡桥请求失败') }),
    }, '*');
    try {
      const text = tavernCardActionText(data);
      if (data.action === 'notice') {
        setApiStatus(`角色卡：${text.slice(0, 4000)}`);
        respond(true, { shown: true });
        return;
      }
      if (data.action === 'copy') {
        respond(true, setTavernCardDialogInput(text));
        return;
      }
      if (data.action === 'send') {
        if (mode === 'rpg') throw new Error('角色卡桥只能在 Tavern 模式发送');
        if (sending || worldTurnPreparing || worldTurnPending) throw new Error('当前对话正在生成，请稍后再试');
        setTavernCardDialogInput(text);
        void sendMessage().catch(error => setApiStatus(`角色卡发送失败：${error.message}`, true));
        respond(true, { sent: true, textLength: text.length });
        return;
      }
      throw new Error('角色卡桥 action 不受支持');
    } catch (error) {
      respond(false, null, error.message);
    }
  });
}

function renderBubble(content, options = {}) {
  const source = expandDisplayMacros(content);
  const hasSanitizer = typeof window !== 'undefined' && window.DOMPurify && typeof document !== 'undefined' && typeof document.createElement === 'function';
  if (hasSanitizer) {
    try {
      const parser = window.marked && typeof window.marked.parse === 'function' ? window.marked : null;
      // marked 不可用时仍把卡片生成的 HTML 交给 DOMPurify，避免安全库缺少时只能把标签当纯文本显示。
      // 先解开 HTML 代码块，再提取 style；否则 ```text 内的 CSS 会继续被当作代码显示。
      const normalizedSource = normalizeTavernHtmlBlocks(source);
      const extracted = extractTavernStyles(normalizedSource);
      const renderSource = extractTavernScripts(extracted.markup);
      const runCardScripts = options.allowCardScripts === true
        && approveCharacterCardScripts(renderSource.scripts);
      if (runCardScripts) {
        const frameStyles = extractTavernStyles(normalizedSource, false);
        const frameSource = extractTavernScripts(frameStyles.markup);
        const frameMarkup = sanitizeTavernMarkup(frameSource.markup, parser, true);
        return { html: tavernCardScriptFrame(frameStyles.styles, frameMarkup, frameSource.scripts, tavernCardCompatibilitySnapshot()), md: false, scripted: true };
      }
      return { html: extracted.styles + sanitizeTavernMarkup(renderSource.markup, parser), md: !!parser };
    } catch { /* 解析失败则回退纯文本 */ }
  }
  return { html: esc(source), md: false };
}

/* 拆分旁白 / 对白：使用括号范围区分角色发言与叙述引用。
 * “对白” 在括号外进入气泡；（旁白“引用”旁白）整体保留为旁白。 */
function splitNarration(text) {
  const OPEN = { '“': '”' };
  const PAREN_OPEN = { '（': '）', '(': ')' };
  const segs = [];
  let cur = '';
  const stack = []; // 引号栈（期望的闭符）
  let parenDepth = 0;
  let inlineCode = false;
  let fence = '';
  const flush = (type) => {
    if (cur.trim()) segs.push({ type, text: cur });
    cur = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '`' || ch === '~') {
      let run = 1;
      while (text[i + run] === ch) run++;
      if (run >= 3 && !inlineCode) {
        if (!fence) fence = ch.repeat(3);
        else if (fence[0] === ch) fence = '';
        cur += ch.repeat(run);
        i += run - 1;
        continue;
      }
      if (ch === '`' && !fence && run === 1) inlineCode = !inlineCode;
      cur += ch.repeat(run);
      i += run - 1;
      continue;
    }
    // Markdown 代码跨度/围栏内的引号只是代码，不得触发 Tavern 对白拆分。
    if (fence || inlineCode) {
      cur += ch;
      continue;
    }
    if (stack.length) {
      // 引号内：继续累积，匹配到闭符出栈
      cur += ch;
      if (ch === stack[stack.length - 1]) stack.pop();
      if (!stack.length) flush('dialogue');
    } else if (PAREN_OPEN[ch] !== undefined) {
      parenDepth++;
      cur += ch;
    } else if ((ch === '）' || ch === ')') && parenDepth > 0) {
      parenDepth--;
      cur += ch;
    } else if (OPEN[ch] !== undefined && parenDepth === 0) {
      // 引号只在括号外开启对白；括号内的同类引号属于旁白引用
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
  } else if (cur.trim()) {
    // 对白结束后的尾部正文仍属于旁白，不能丢失
    if (segs.length && segs[segs.length - 1].type === 'narration') segs[segs.length - 1].text += cur;
    else segs.push({ type: 'narration', text: cur });
  }
  if (!segs.length) segs.push({ type: 'narration', text });
  return segs;
}

/* ─────────── 会话管理 ─────────── */
function saveSessions() {
  const cur = curSession();
  if (cur) cur.updatedAt = Date.now(); // 跨浏览器合并时按更新时间取新
  try {
    // 图片消息存的是本地相对路径（/images/xxx.png，很小），可以安全持久化
    saveJSON(LS_SESSIONS, sessions);
  } catch (e) {
    console.warn('[Tavern] 会话保存失败（可能超出本地存储配额）:', e.message);
  }
  saveJSON(LS_SESSIONS_DELETED, sessionsDeleted);
  // server JSON 是权威源：与 characters / lorebooks 等一致的双写
  saveServerData('sessions', { schemaVersion: 1, sessions: Array.isArray(sessions) ? sessions : [], deletedIds: sessionsDeleted });
}

/* 会话跨浏览器同步：server 未同步时推送本地（迁移）；已同步时按 ID 取并集、冲突取 updatedAt 新者，
   双方删除墓碑都生效，合并结果推回 server，让另一台浏览器下次加载也能收敛。 */
function syncSessionsFromServer(remote) {
  const local = Array.isArray(sessions) ? sessions : [];
  if (!remote || typeof remote !== 'object' || !Array.isArray(remote.sessions)) {
    // server 无会话文件（新装 / 旧版本升级）或不可达：本地会话原样推送上去，完成首次迁移
    if (local.length || sessionsDeleted.length) {
      saveServerData('sessions', { schemaVersion: 1, sessions: local, deletedIds: sessionsDeleted });
    }
    return;
  }
  const remoteDeleted = Array.isArray(remote.deletedIds)
    ? remote.deletedIds.filter(id => typeof id === 'string') : [];
  const byId = new Map();
  for (const s of local) {
    if (!s || typeof s !== 'object' || !s.id || sessionsDeleted.includes(s.id) || remoteDeleted.includes(s.id)) continue;
    byId.set(s.id, s);
  }
  for (const s of remote.sessions) {
    if (!s || typeof s !== 'object' || !s.id || sessionsDeleted.includes(s.id) || remoteDeleted.includes(s.id)) continue;
    const mine = byId.get(s.id);
    if (!mine) { byId.set(s.id, s); continue; }
    const lt = mine.updatedAt || mine.createdAt || 0;
    const rt = s.updatedAt || s.createdAt || 0;
    byId.set(s.id, rt > lt ? s : mine); // 同 ID 双端都改过：保留更新的一方
  }
  sessions = [...byId.values()].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  sessionsDeleted = [...new Set([...sessionsDeleted, ...remoteDeleted])];
  saveJSON(LS_SESSIONS, sessions);
  saveJSON(LS_SESSIONS_DELETED, sessionsDeleted);
  // 与 server 完全一致时不再回写，避免每次启动都重写文件
  if (JSON.stringify(sessions) !== JSON.stringify(remote.sessions) || JSON.stringify(sessionsDeleted) !== JSON.stringify(remoteDeleted)) {
    saveServerData('sessions', { schemaVersion: 1, sessions, deletedIds: sessionsDeleted });
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

/* 默认模板：从 server /api/data/seed 拉取 _defaults.json，代码不写死内容 */
async function fetchDefaults() {
  try {
    const resp = await fetch('/api/data/seed');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.json();
  } catch (e) {
    console.warn('[Tavern] 无法加载默认模板（server 未运行?）:', e.message);
    return null;
  }
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
  if (mode === 'rpg') { openWorldLibrary(); return; }
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
  if (!sessionsDeleted.includes(id)) sessionsDeleted.push(id); // 墓碑：另一台浏览器合并时不再复活
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
  if (mode === 'rpg') {
    if (nameEl) nameEl.textContent = '选择世界存档';
    const hdrName = $('hdr-char-name');
    const hdrRace = $('hdr-char-race');
    if (hdrName) hdrName.textContent = '选择世界存档';
    if (hdrRace) hdrRace.textContent = 'RPG 只使用世界存档中的玩家角色';
    const saveMark = $('rpg-world-save');
    if (saveMark) saveMark.hidden = true;
    const ml = $('session-menu-list');
    if (ml) ml.innerHTML = '<div class="sess-empty">请先从世界库创建或打开世界存档</div>';
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
  if (name && name.trim()) { s.name = name.trim(); s.updatedAt = Date.now(); saveSessions(); renderSessions(); }
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
  // 无旧数据：不创建占位角色，由服务端首次初始化的内置角色卡决定内容
  currentCharId = null;
  localStorage.removeItem(LS_CURRENT_CHAR);
}

function renderCharacter() {
  if (mode === 'rpg' && !worldModeActive()) {
    $('hdr-char-name').textContent = '选择世界存档';
    $('hdr-char-race').textContent = 'RPG 只使用世界存档中的玩家角色';
    return;
  }
  // 兜底：角色库为空时保持空状态；此处仅选当前角色
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
    el.tabIndex = 0;
    el.innerHTML = `<span class="cm-name">${esc(c.name || '未命名')}${inUse ? '<span class="cm-inuse-mark">使用中</span>' : ''}</span><span class="cm-x" title="删除">✕</span>`;
    el.addEventListener('click', (ev) => {
      if (ev.target.classList.contains('cm-x')) { deleteChar(c.id); return; }
      setMobileManagerPanel('char-mgr', 'detail');
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
  personality: 'cm-personality', scenario: 'cm-scenario', firstMes: 'cm-first-mes', tags: 'cm-tags',
};

function charFieldDefs() {
  const fields = genSettings && genSettings.charFields;
  return Array.isArray(fields) ? fields.filter(f => f && typeof f === 'object' && !Array.isArray(f)
    && /^[A-Za-z][A-Za-z0-9_-]{0,48}$/.test(String(f.key || ''))
    && typeof f.label === 'string' && f.label.trim().length > 0 && f.label.trim().length <= 120) : [];
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
  $('cm-persona').value = c.description != null ? c.description : (c.persona || '');
  $('cm-personality').value = c.personality || '';
  $('cm-scenario').value = c.scenario || '';
  $('cm-first-mes').value = c.firstMes || '';
  $('cm-mes-example').value = c.mesExample || '';
  $('cm-system').value = c.systemPrompt || '';
  $('cm-post').value = c.postHistory || '';
  $('cm-creator-notes').value = c.creatorNotes || '';
  $('cm-creator').value = c.creator || '';
  $('cm-character-version').value = c.characterVersion || '';
  $('cm-preset').value = c.presetName || '';
  $('cm-lore').value = c.loreId || '';
  $('cm-ref-image').value = c.refImage || '';
  updateRefPreview(c.refImage || '');
  $('cm-tags').value = c.tags || '';
  $('cm-alt-greetings').value = Array.isArray(c.alternateGreetings) ? c.alternateGreetings.join('\n\n') : '';
  $('cm-alt-greetings').dataset.initial = $('cm-alt-greetings').value;
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
  setMobileManagerPanel('char-mgr', 'detail');
  cmCreating = true;
  cmEditingId = null;
  $('cm-edit-title').textContent = '新建角色';
  $('cm-del').textContent = '取消新建';
  ['cm-name', 'cm-race', 'cm-role', 'cm-persona', 'cm-personality', 'cm-scenario', 'cm-first-mes', 'cm-mes-example', 'cm-system', 'cm-post', 'cm-creator-notes', 'cm-creator', 'cm-character-version', 'cm-ref-image', 'cm-tags', 'cm-alt-greetings']
    .forEach(id => { $(id).value = ''; });
  $('cm-alt-greetings').dataset.initial = '';
  $('cm-ai-desc').value = '';
  $('cm-ai-status').textContent = '';
  renderCharProfileFields(null);
  setCharWizardStep(1);
  updateRefPreview(''); // 清空参考图预览（新建角色不复用上个角色的图）
  renderCharList();
  $('cm-ai-desc').focus();
}

function saveCharFromEditor() {
  const existing = cmEditingId ? characters.find(x => x.id === cmEditingId) : null;
  const alternateText = $('cm-alt-greetings').value;
  const alternateGreetings = existing && $('cm-alt-greetings').dataset.initial === alternateText && Array.isArray(existing.alternateGreetings)
    ? existing.alternateGreetings
    : alternateText.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  const data = {
    name: $('cm-name').value.trim() || '未命名',
    race: $('cm-race').value.trim(),
    role: $('cm-role').value.trim(),
    description: $('cm-persona').value,
    personality: $('cm-personality').value,
    // persona 是旧版内部字段：保留它以兼容旧提示词和外部数据。
    persona: $('cm-personality').value || $('cm-persona').value,
    scenario: $('cm-scenario').value,
    firstMes: $('cm-first-mes').value,
    mesExample: $('cm-mes-example').value,
    systemPrompt: $('cm-system').value,
    postHistory: $('cm-post').value,
    creatorNotes: $('cm-creator-notes').value,
    creator: $('cm-creator').value.trim(),
    characterVersion: $('cm-character-version').value.trim(),
    presetName: $('cm-preset').value || '',
    loreId: $('cm-lore').value || '',
    characterBookLoreId: existing?.characterBookLoreId || '',
    refImage: $('cm-ref-image').value.trim(),
    tags: $('cm-tags').value.trim(),
    alternateGreetings,
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

/* 角色卡导入 / 导出（Character Card V1/V2/V3） */
function cloneCardJson(value) {
  if (value == null) return value;
  try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
}

function cardTags(value) {
  return Array.isArray(value)
    ? value.map(String).map(s => s.trim()).filter(Boolean)
    : String(value || '').split(',').map(s => s.trim()).filter(Boolean);
}

function cardAssetImage(assets) {
  if (!Array.isArray(assets)) return '';
  const asset = assets.find(a => a && a.type === 'icon' && (a.name === 'main' || a.name === 'avatar'))
    || assets.find(a => a && a.type === 'icon');
  const uri = asset && (asset.uri || asset.url);
  return typeof uri === 'string' && /^(?:data:|https?:|\/|blob:)/i.test(uri) ? uri : '';
}

function characterCardData(input) {
  if (!input || typeof input !== 'object') throw new Error('角色卡不是有效 JSON 对象');
  if (input.data && typeof input.data === 'object' && !Array.isArray(input.data)) return input.data;
  if (typeof input.name === 'string') return input; // V1 平铺，或部分旧导出
  throw new Error('无法识别的角色卡格式（需 Character Card V1/V2/V3 JSON）');
}

function cardExtensions(data) {
  const extensions = data && data.extensions && typeof data.extensions === 'object' ? data.extensions : {};
  const tavern = extensions.tavern && typeof extensions.tavern === 'object' ? extensions.tavern : {};
  return { extensions, tavern };
}

function characterBookValue(value) {
  let book = value;
  if (typeof book === 'string') {
    try { book = JSON.parse(book); } catch { return null; }
  }
  if (book && book.data && typeof book.data === 'object' && book.data.entries && typeof book.data.entries === 'object') return book.data;
  return book && typeof book === 'object' ? book : null;
}

function firstCharacterBook(...values) {
  for (const value of values) {
    const book = characterBookValue(value);
    const entries = book?.entries;
    if (Array.isArray(entries) ? entries.length : entries && typeof entries === 'object' && Object.keys(entries).length) return book;
  }
  return null;
}

function characterFromCard(input) {
  const data = characterCardData(input);
  const { extensions, tavern } = cardExtensions(data);
  const assets = Array.isArray(data.assets) ? cloneCardJson(data.assets) : [];
  const description = String(data.description || data.persona || '');
  const personality = String(data.personality || '');
  const alternateGreetings = Array.isArray(data.alternate_greetings)
    ? data.alternate_greetings.map(String).filter(Boolean)
    : [];
  const topExtensions = input && input.extensions && typeof input.extensions === 'object' ? input.extensions : {};
  const characterBook = firstCharacterBook(
    data.character_book,
    data.characterBook,
    tavern.character_book,
    tavern.characterBook,
    extensions.character_book,
    extensions.characterBook,
    input?.character_book,
    input?.characterBook,
    topExtensions.character_book,
    topExtensions.characterBook,
  );
  return {
    id: uid(), name: String(data.name || '未命名'),
    race: String(tavern.race || data.race || '待定'), role: String(tavern.role || data.role || '待定'),
    description, personality, persona: personality || description,
    scenario: String(data.scenario || ''), firstMes: String(data.first_mes || ''),
    mesExample: String(data.mes_example || ''),
    systemPrompt: String(data.system_prompt || ''),
    postHistory: String(data.post_history_instructions || ''),
    creatorNotes: String(data.creator_notes || ''),
    creator: String(data.creator || ''),
    characterVersion: String(data.character_version || ''),
    alternateGreetings,
    presetName: String(tavern.presetName || ''), loreId: String(tavern.loreId || ''),
    characterBookLoreId: String(tavern.characterBookLoreId || ''),
    profileFields: normalizeCharProfileFields(tavern.profileFields),
    tags: cardTags(data.tags).join(', '),
    refImage: String(tavern.refImage || cardAssetImage(assets) || ''),
    characterBook: characterBook ? cloneCardJson(characterBook) : null,
    assets,
    // 保留 V3 未被编辑器使用的字段，导出时合并回去，避免导入再导出丢数据。
    cardData: cloneCardJson(data),
    cardSpec: String(input.spec || (input.data ? 'chara_card_v2' : 'chara_card_v1')),
    cardSpecVersion: String(input.spec_version || ''),
    cardExtensions: cloneCardJson(extensions),
    createdAt: Date.now(),
  };
}

function charToV3(c) {
  const preserved = c && c.cardData && typeof c.cardData === 'object' ? cloneCardJson(c.cardData) : {};
  const oldExtensions = preserved.extensions && typeof preserved.extensions === 'object' ? preserved.extensions : {};
  const oldTavern = oldExtensions.tavern && typeof oldExtensions.tavern === 'object' ? oldExtensions.tavern : {};
  const data = {
    ...preserved,
    name: c.name || '',
    description: c.description != null ? c.description : (c.persona || ''),
    personality: c.personality != null ? c.personality : '',
    scenario: c.scenario || '',
    first_mes: c.firstMes || '',
    mes_example: c.mesExample != null ? c.mesExample : (preserved.mes_example || ''),
    creator_notes: c.creatorNotes != null ? c.creatorNotes : (preserved.creator_notes || ''),
    system_prompt: c.systemPrompt || '',
    post_history_instructions: c.postHistory || '',
    alternate_greetings: Array.isArray(c.alternateGreetings) ? cloneCardJson(c.alternateGreetings) : (preserved.alternate_greetings || []),
    tags: cardTags(c.tags),
    creator: c.creator != null ? c.creator : (preserved.creator || ''),
    character_version: c.characterVersion != null ? c.characterVersion : (preserved.character_version || '1.0'),
    extensions: {
      ...oldExtensions,
      tavern: {
        ...oldTavern,
        race: c.race || '', role: c.role || '', presetName: c.presetName || '', loreId: c.loreId || '', characterBookLoreId: c.characterBookLoreId || '',
        profileFields: cloneCardJson(c.profileFields || []),
        refImage: c.refImage || '',
      },
    },
  };
  if (c.characterBook) data.character_book = cloneCardJson(c.characterBook);
  if (Array.isArray(c.assets) && c.assets.length) data.assets = cloneCardJson(c.assets);
  return { spec: 'chara_card_v3', spec_version: '3.0', data };
}

function charToV2(c) {
  const v3 = charToV3(c);
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: { ...v3.data, personality: c.personality || '', assets: undefined },
  };
}

function v2ToChar(j) { return characterFromCard(j); }

function decodeBase64Utf8(value) {
  const raw = String(value || '').trim().replace(/^\uFEFF/, '');
  if (/^(?:\{|\[)/.test(raw)) return raw;
  if (/^%(?:7b|5b)/i.test(raw)) {
    try { return decodeURIComponent(raw); } catch { /* 继续按 Base64 尝试 */ }
  }
  const encoded = raw.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (encoded.length > 8 * 1024 * 1024) throw new Error('角色卡元数据过大');
  const padded = encoded + '='.repeat((4 - encoded.length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

function bytesToLatin1(bytes) {
  let output = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    output += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return output;
}

function pngTextChunks(buffer) {
  const bytes = new Uint8Array(buffer);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 8 || !signature.every((n, i) => bytes[i] === n)) return null;
  const view = new DataView(buffer);
  let offset = 8;
  const text = {};
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) break;
    if (length > 4 * 1024 * 1024) throw new Error('PNG 角色卡元数据过大');
    if (type === 'tEXt') {
      const payload = bytes.subarray(start, end);
      const split = payload.indexOf(0);
      if (split > 0) {
        const keyword = bytesToLatin1(payload.subarray(0, split));
        const valueBytes = payload.subarray(split + 1);
        text[keyword] = bytesToLatin1(valueBytes);
      }
    } else if (type === 'iTXt') {
      // 兼容部分制卡工具使用的未压缩 iTXt；压缩 iTXt 仍跳过，避免把异步解压塞进导入链。
      const payload = bytes.subarray(start, end);
      const keywordEnd = payload.indexOf(0);
      if (keywordEnd > 0 && keywordEnd + 2 < payload.length && payload[keywordEnd + 1] === 0 && payload[keywordEnd + 2] === 0) {
        let cursor = keywordEnd + 3; // compression flag + method
        const languageEnd = payload.indexOf(0, cursor);
        if (languageEnd >= 0) {
          cursor = languageEnd + 1;
          const translatedEnd = payload.indexOf(0, cursor);
          if (translatedEnd >= 0) {
            cursor = translatedEnd + 1;
            const keyword = bytesToLatin1(payload.subarray(0, keywordEnd));
            text[keyword] = new TextDecoder('utf-8').decode(payload.subarray(cursor));
          }
        }
      }
    }
    offset = end + 4;
    if (type === 'IEND') break;
  }
  return text;
}

function characterCardTextFromBuffer(buffer) {
  const chunks = pngTextChunks(buffer);
  if (chunks) {
    const encoded = chunks.ccv3 || chunks.chara;
    if (!encoded) throw new Error('PNG 中没有找到 ccv3 / chara 角色卡元数据');
    return decodeBase64Utf8(encoded);
  }
  return new TextDecoder('utf-8').decode(new Uint8Array(buffer));
}

function importCharFromText(text) {
  const c = v2ToChar(JSON.parse(text));
  const lorebook = registerCharacterBookLorebook(c);
  characters.push(c);
  saveChars();
  if (lorebook?.created) saveLore();
  renderBindSelects();
  renderLBList();
  if ($('world-draft-lorebooks')) renderWorldDraftLorebookOptions(worldDraft?.world?.lorebookIds || []);
  renderCharList();
  selectCharForEdit(c.id);
  return { character: c, lorebook };
}

function importCharFromBuffer(buffer) {
  return importCharFromText(characterCardTextFromBuffer(buffer));
}

// 用户有时会把 ST 世界书误拖到“角色卡”入口；世界书本身不是角色卡，
// 但可以安全地转入世界书库，避免只得到“格式不支持”的死路。
function importCharOrLorebookFromBuffer(buffer, fileName = '') {
  const text = characterCardTextFromBuffer(buffer);
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* 让角色卡导入给出原有 JSON 错误 */ }
  const root = parsed && typeof parsed === 'object' ? parsed : null;
  const cardSignals = root && (
    root.spec || root.spec_version || root.data?.first_mes || root.data?.description
    || root.first_mes || root.personality || root.scenario
  );
  const standaloneLorebook = root && !cardSignals && importedLorebookEntries(root).length;
  if (standaloneLorebook) return { kind: 'lorebook', report: importSTLorebookText(text, fileName) };
  return { kind: 'character', report: importCharFromText(text) };
}

async function exportCurrentChar() {
  const c = currentChar();
  if (!c) return alert('请先创建 / 选择一个角色');
  await downloadBlob(new Blob([JSON.stringify(charToV3(c), null, 2)], { type: 'application/json' }), (c.name || 'character').replace(/[\\/:*?"<>|]/g, '_') + '.card.json');
}

/* ─────────── 提示词预设（独立栏目） ─────────── */

function currentLB() { return (lorebooks && lorebooks[lbEditingId]) || null; }

function lorebookHash(value) {
  let hash = 2166136261;
  for (const ch of String(value || '')) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function importedLorebookEntries(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  const entries = value.entries ?? value.worldInfo?.entries ?? value.world_info?.entries;
  if (Array.isArray(entries)) return entries;
  if (entries && typeof entries === 'object') return Object.values(entries);
  return Object.values(value).filter(entry => entry && typeof entry === 'object'
    && ('content' in entry || 'key' in entry || 'keys' in entry || 'comment' in entry));
}

function normalizeImportedLorebook(raw, fallbackName = '') {
  const root = raw && typeof raw === 'object' && raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)
    ? raw.data : raw;
  const source = root && typeof root === 'object' && (root.worldInfo || root.world_info)
    ? (root.worldInfo || root.world_info) : root;
  const entries = importedLorebookEntries(source);
  if (!entries.length) throw new Error('未找到可导入的世界书 entries');
  const settingSource = source?.settings && typeof source.settings === 'object' ? { ...source, ...source.settings } : source;
  const normalized = normalizeCharacterBookEntries({
    scan_depth: settingSource?.scan_depth ?? settingSource?.scanDepth,
    entries: entries.map(rawEntry => {
      const entry = rawEntry && typeof rawEntry === 'object' ? rawEntry : {};
      const extensions = entry?.extensions && typeof entry.extensions === 'object' ? entry.extensions : {};
      const primary = entry.keys ?? entry.key ?? entry.primaryKeys ?? entry.primary_keys ?? [];
      const secondary = entry.secondary_keys ?? entry.keysecondary ?? entry.secondaryKeys ?? [];
      return {
        ...entry,
        id: uid(),
        comment: entry.comment || entry.title || entry.name || '',
        keys: primary,
        secondary_keys: secondary,
        insertion_order: entry.insertion_order ?? entry.order ?? 100,
      scan_depth: entry.scan_depth ?? entry.scanDepth ?? extensions.scan_depth,
        use_regex: entry.use_regex === true || entry.useRegex === true || extensions.use_regex === true || extensions.useRegex === true,
        case_sensitive: entry.case_sensitive ?? entry.caseSensitive ?? extensions.case_sensitive ?? extensions.caseSensitive,
        selective: entry.selective === true,
        constant: entry.constant === true,
        enabled: entry.enabled !== false && entry.disable !== true,
        content: String(entry.content || ''),
      };
    }),
  });
  const name = String(source?.name || source?.title || raw?.name || raw?.title || fallbackName || '导入世界书').trim();
  return {
    name: name || '导入世界书',
    entries: normalized,
    settings: {
      scanDepth: Number.isFinite(Number(settingSource?.scan_depth ?? settingSource?.scanDepth)) ? Math.max(0, Number(settingSource.scan_depth ?? settingSource.scanDepth)) : null,
      caseSensitive: typeof settingSource?.case_sensitive === 'boolean' ? settingSource.case_sensitive : (typeof settingSource?.caseSensitive === 'boolean' ? settingSource.caseSensitive : null),
      matchWholeWords: typeof settingSource?.match_whole_words === 'boolean' ? settingSource.match_whole_words : (typeof settingSource?.matchWholeWords === 'boolean' ? settingSource.matchWholeWords : null),
      includeNames: typeof settingSource?.include_names === 'boolean' ? settingSource.include_names : (typeof settingSource?.includeNames === 'boolean' ? settingSource.includeNames : null),
      recursive: typeof settingSource?.recursive === 'boolean' ? settingSource.recursive : null,
      maxRecursionSteps: Number.isFinite(Number(settingSource?.max_recursion_steps ?? settingSource?.maxRecursionSteps)) ? Math.max(0, Number(settingSource.max_recursion_steps ?? settingSource.maxRecursionSteps)) : null,
      minActivations: Number.isFinite(Number(settingSource?.min_activations ?? settingSource?.minActivations)) ? Math.max(0, Number(settingSource.min_activations ?? settingSource.minActivations)) : null,
      minActivationsDepthMax: Number.isFinite(Number(settingSource?.min_activations_depth_max ?? settingSource?.minActivationsDepthMax)) ? Math.max(0, Number(settingSource.min_activations_depth_max ?? settingSource.minActivationsDepthMax)) : null,
      budget: Number.isFinite(Number(settingSource?.budget)) ? Math.max(0, Number(settingSource.budget)) : null,
      useGroupScoring: typeof settingSource?.use_group_scoring === 'boolean' ? settingSource.use_group_scoring
        : (typeof settingSource?.group_scoring === 'boolean' ? settingSource.group_scoring : null),
      insertionStrategy: ['evenly', 'character_first', 'global_first'].includes(settingSource?.insertion_strategy ?? settingSource?.strategy)
        ? (settingSource.insertion_strategy ?? settingSource.strategy) : null,
    },
  };
}

function normalizeLorebookSettings(bookOrSettings) {
  const source = bookOrSettings?.settings && typeof bookOrSettings.settings === 'object'
    ? { ...bookOrSettings, ...bookOrSettings.settings } : (bookOrSettings || {});
  const number = (value, fallback = null) => value === null || value === undefined || value === ''
    ? fallback : (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : fallback);
  const bool = (value, fallback = null) => typeof value === 'boolean' ? value : fallback;
  return {
    scanDepth: number(source.scanDepth ?? source.scan_depth),
    caseSensitive: bool(source.caseSensitive ?? source.case_sensitive),
    matchWholeWords: bool(source.matchWholeWords ?? source.match_whole_words),
    includeNames: bool(source.includeNames ?? source.include_names),
    recursive: bool(source.recursive),
    maxRecursionSteps: number(source.maxRecursionSteps ?? source.max_recursion_steps),
    minActivations: number(source.minActivations ?? source.min_activations),
    minActivationsDepthMax: number(source.minActivationsDepthMax ?? source.min_activations_depth_max),
    budget: number(source.budget),
    useGroupScoring: bool(source.useGroupScoring ?? source.use_group_scoring ?? source.groupScoring ?? source.group_scoring),
    insertionStrategy: ['evenly', 'character_first', 'global_first'].includes(source.insertionStrategy ?? source.insertion_strategy ?? source.strategy)
      ? (source.insertionStrategy ?? source.insertion_strategy ?? source.strategy) : null,
  };
}

// SillyTavern 旧导出可能把世界书包在 worldInfo/world_info/data 下；读取时即时映射，避免启动迁移改写原件。
function lorebookEntriesForPrompt(book) {
  if (book && typeof book === 'object' && Array.isArray(book.entries)) return normalizeCharacterBookEntries(book);
  try { return normalizeImportedLorebook(book, book?.name || book?.title || '').entries; }
  catch { return []; }
}

function registerCharacterBookLorebook(char) {
  const book = characterBookValue(char?.characterBook);
  const entries = book?.entries;
  if (!(Array.isArray(entries) ? entries.length : entries && typeof entries === 'object' && Object.keys(entries).length)) return null;
  if (!lorebooks || typeof lorebooks !== 'object' || Array.isArray(lorebooks)) lorebooks = { default: { name: '默认世界书', entries: [] } };
  if (!lorebooks.default) lorebooks.default = { name: '默认世界书', entries: [] };
  const fingerprint = lorebookHash(JSON.stringify(book));
  const existing = Object.entries(lorebooks).find(([, lore]) => lore?.source?.type === 'character-card' && lore.source.fingerprint === fingerprint);
  if (existing) {
    char.characterBookLoreId = existing[0];
    return { id: existing[0], name: existing[1].name, created: false };
  }
  const id = `char-book-${fingerprint}`;
  lorebooks[id] = {
    name: `${char.name || '未命名角色'} · 角色卡世界书`,
    entries: normalizeCharacterBookEntries(book),
    source: { type: 'character-card', fingerprint, characterName: char.name || '' },
  };
  char.characterBookLoreId = id;
  return { id, name: lorebooks[id].name, created: true };
}

function ensureCharacterBookLorebooks() {
  if (!Array.isArray(characters) || !characters.length) return;
  let charactersChanged = false;
  let lorebooksChanged = false;
  for (const char of characters) {
    // 已有绑定被用户删除时不在每次启动中强行复活；重新导入角色卡即可恢复。
    if (char?.characterBookLoreId && !lorebooks?.[char.characterBookLoreId]) continue;
    const before = char?.characterBookLoreId || '';
    const result = registerCharacterBookLorebook(char);
    if (!result) continue;
    if (char.characterBookLoreId !== before) charactersChanged = true;
    if (result.created) lorebooksChanged = true;
  }
  if (lorebooksChanged) saveLore();
  if (charactersChanged) saveChars();
}

function importSTLorebookText(text, fileName = '') {
  const parsed = JSON.parse(text);
  const imported = normalizeImportedLorebook(parsed, String(fileName).replace(/\.[^.]+$/, ''));
  if (!lorebooks || typeof lorebooks !== 'object' || Array.isArray(lorebooks)) lorebooks = { default: { name: '默认世界书', entries: [] } };
  if (!lorebooks.default) lorebooks.default = { name: '默认世界书', entries: [] };
  const id = `st-${lorebookHash(JSON.stringify({ name: imported.name, entries: imported.entries }))}-${uid().slice(-6)}`;
  lorebooks[id] = {
    name: imported.name,
    entries: imported.entries,
    settings: imported.settings,
    source: { type: 'sillytavern-world-info', fileName: String(fileName || '') },
  };
  saveLore();
  lbEditingId = id;
  wiEditingId = null;
  renderLBList();
  selectLB(id);
  renderBindSelects();
  if ($('world-draft-lorebooks')) renderWorldDraftLorebookOptions(worldDraft?.world?.lorebookIds || []);
  return { id, name: imported.name, entries: imported.entries.length };
}

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

/* ─────────── 输出正则（预设 + 模式自定义） ─────────── */
const OUTPUT_REGEX_FLAGS = 'dgimsuvy';

function normalizeOutputRegexRule(source, index = 0, origin = 'custom') {
  const raw = source && typeof source === 'object' ? source : {};
  const trimStrings = Array.isArray(raw.trimStrings)
    ? raw.trimStrings.filter(value => typeof value === 'string')
    : (typeof raw.trimStrings === 'string' && raw.trimStrings
      ? raw.trimStrings.split(/\r?\n/).filter(Boolean)
      : []);
  const placement = raw.placement ?? raw.affects ?? raw.affected ?? raw.placements;
  return {
    id: String(raw.id || `${origin}-regex-${index + 1}`),
    name: String(raw.name || raw.title || raw.id || `输出正则 ${index + 1}`),
    findRegex: String(raw.findRegex ?? raw.pattern ?? raw.find ?? ''),
    flags: String(raw.flags || ''),
    replaceString: String(raw.replaceString ?? raw.replacement ?? raw.replace ?? ''),
    trimStrings,
    enabled: raw.enabled !== false && raw.disabled !== true,
    placement: Array.isArray(placement) ? placement.slice(0, 8) : placement,
    markdownOnly: raw.markdownOnly === true,
    promptOnly: raw.promptOnly === true,
    runOnEdit: raw.runOnEdit === true,
    substituteRegex: raw.substituteRegex !== false,
    minDepth: Number.isFinite(Number(raw.minDepth)) ? Number(raw.minDepth) : null,
    maxDepth: Number.isFinite(Number(raw.maxDepth)) ? Number(raw.maxDepth) : null,
    source: origin,
  };
}

function normalizeOutputRegexRules(source, origin = 'custom') {
  const list = Array.isArray(source) ? source : (source && typeof source === 'object' ? Object.values(source) : []);
  return list.map((rule, index) => normalizeOutputRegexRule(rule, index, origin));
}

function buildOutputRegex(rule) {
  const raw = String(rule?.findRegex || '').trim();
  if (!raw || raw.length > 2000) return null;
  let pattern = raw;
  let flags = String(rule?.flags || '');
  const literal = raw.match(/^\/([\s\S]*)\/([a-z]*)$/i);
  if (literal) {
    pattern = literal[1];
    flags = literal[2];
  }
  flags = [...new Set((flags + 'g').split('').filter(flag => OUTPUT_REGEX_FLAGS.includes(flag)))].join('');
  try { return new RegExp(pattern, flags); }
  catch { return null; }
}

function modeOutputRegexes(targetMode = mode) {
  prefs.outputRegex = prefs.outputRegex && typeof prefs.outputRegex === 'object' ? prefs.outputRegex : {};
  if (!Array.isArray(prefs.outputRegex[targetMode])) prefs.outputRegex[targetMode] = [];
  return prefs.outputRegex[targetMode];
}

function characterCardOutputRegexes(char = currentChar()) {
  const extensions = char?.cardExtensions && typeof char.cardExtensions === 'object' ? char.cardExtensions : {};
  const cardDataExtensions = char?.cardData?.extensions && typeof char.cardData.extensions === 'object' ? char.cardData.extensions : {};
  return extensions.regex_scripts || extensions.regexScripts || extensions.tavern?.regex_scripts || extensions.tavern?.regexScripts
    || cardDataExtensions.regex_scripts || cardDataExtensions.regexScripts || [];
}

function activeOutputRegexRules(targetMode = mode) {
  const character = targetMode === 'tavern' && targetMode === mode ? currentChar() : null;
  const preset = targetMode === mode ? resolvePromptPreset()?.preset : null;
  const world = targetMode === 'rpg' && targetMode === mode && worldModeActive() ? currentWorldCard() : null;
  return [
    // SillyTavern 角色卡常用自身 regex_scripts 把状态标签转换为 HTML；RP 中先执行卡片规则，再执行预设/自定义规则。
    ...normalizeOutputRegexRules(characterCardOutputRegexes(character), 'character'),
    ...normalizeOutputRegexRules(world?.regexes, 'world'),
    ...normalizeOutputRegexRules(preset?.regexes, 'preset'),
    ...normalizeOutputRegexRules(modeOutputRegexes(targetMode), 'custom'),
  ].filter(rule => {
    const placements = Array.isArray(rule.placement) ? rule.placement : (rule.placement == null ? [] : [rule.placement]);
    if (!placements.length || rule.promptOnly) return !rule.promptOnly;
    return placements.some(value => {
      const normalized = String(value).trim().toUpperCase().replace(/[\s-]+/g, '_');
      return Number(value) === 2 || normalized === 'AI_RESPONSE' || normalized === 'RESPONSE'
        || normalized === 'DISPLAY' || normalized === 'CHAT_DISPLAY';
    });
  });
}

function applyOutputRegexRule(output, rule, regex) {
  const replacement = String(rule.replaceString || '');
  if (!replacement.includes('{{match}}') && !rule.trimStrings.length) return output.replace(regex, replacement);
  return output.replace(regex, (...args) => {
    const match = String(args[0] || '');
    const groups = typeof args.at(-1) === 'object' ? args.at(-1) : null;
    const captures = args.slice(1, groups ? -3 : -2);
    let trimmed = match;
    for (const trim of rule.trimStrings) if (trim) trimmed = trimmed.split(trim).join('');
    return replacement
      .replace(/\{\{match\}\}/g, trimmed)
      .replace(/\$(\d+)/g, (_, index) => captures[Number(index) - 1] ?? '');
  });
}

function applyOutputRegexRules(text, rules) {
  const original = String(text || '');
  let output = original;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const regex = buildOutputRegex(rule);
    if (!regex) continue;
    output = applyOutputRegexRule(output, rule, regex);
  }
  // A broad imported rule must not erase an otherwise visible response. The
  // known hidden protocol blocks are the only intentional empty result.
  const visibleOriginal = original
    .replace(/<(?:think|analysis|reasoning|tavern_state_update|tavern_options)\b[^>]*>[\s\S]*?<\/(?:think|analysis|reasoning|tavern_state_update|tavern_options)\s*>/gi, '')
    .trim();
  if (!output.trim() && visibleOriginal) return original.trim();
  return output.trim();
}

/*
 * 卡片正则通常把整组状态标签作为一个整体匹配；模型被截断或漏掉一个字段时，
 * 整组替换会完全失效，原始 XML 标签就会直接落进聊天正文。保留已配置正则的
 * 优先级，同时给连续的自定义标签一个安全的降级展示，至少不把协议原文泄露给玩家。
 */
const STRUCTURED_TAG_FALLBACK_EXCLUDED = new Set([
  'a', 'article', 'aside', 'audio', 'b', 'body', 'blockquote', 'br', 'button', 'code', 'details', 'div',
  'em', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'html', 'i', 'img',
  'input', 'kbd', 'label', 'li', 'link', 'main', 'mark', 'meta', 'nav', 'ol', 'option', 'p', 'pre',
  'script', 'section', 'select', 'small', 'span', 'strong', 'style', 'summary', 'table', 'tbody', 'td',
  'textarea', 'tfoot', 'th', 'thead', 'title', 'tr', 'u', 'ul', 'video', 'tavern_options',
  'tavern_state_update', 'think', 'reasoning',
]);
const STRUCTURED_TAG_PAIR_RE = /<([^\s<>/]+)>([\s\S]*?)<\/\1\s*>/g;

function recoverStructuredTagOutput(text) {
  const source = String(text || '').trim();
  if (!source || /(^|\n)[ \t]*(?:```|~~~)/.test(source)) return source;
  const pairs = [];
  const scanner = new RegExp(STRUCTURED_TAG_PAIR_RE.source, 'g');
  let match;
  while ((match = scanner.exec(source))) {
    if (!STRUCTURED_TAG_FALLBACK_EXCLUDED.has(String(match[1]).toLowerCase())) pairs.push(match);
  }
  if (pairs.length < 2) return source;
  return source.replace(STRUCTURED_TAG_PAIR_RE, (full, name, value) => {
    if (STRUCTURED_TAG_FALLBACK_EXCLUDED.has(String(name).toLowerCase())) return full;
    return `<span class="tavern-tag-field"><span class="tavern-tag-label">${esc(name)}</span><span class="tavern-tag-value">${esc(String(value || '').trim())}</span></span>`;
  }).trim();
}

/* 渲染旧消息时重新检查当前规则；避免消息首次生成时规则尚未载入而永久保留原始标签。 */
function renderOutputContent(text, targetMode = mode) {
  const source = String(text || '');
  const rules = activeOutputRegexRules(targetMode);
  const needsRegex = rules.some(rule => {
    const regex = buildOutputRegex(rule);
    if (!regex) return false;
    regex.lastIndex = 0;
    return regex.test(source);
  });
  return recoverStructuredTagOutput(needsRegex ? applyOutputRegexRules(source, rules) : source);
}

function applyCharacterCardOutputRegex(text) {
  return recoverStructuredTagOutput(applyOutputRegexRules(text, activeOutputRegexRules('tavern').filter(rule => rule.source === 'character')));
}

function applyOutputRegex(text, targetMode = mode) {
  return renderOutputContent(text, targetMode);
}

function serializeOutputRegexRule(rule) {
  return {
    id: rule.id,
    name: rule.name,
    findRegex: rule.findRegex,
    ...(rule.flags ? { flags: rule.flags } : {}),
    replaceString: rule.replaceString,
    trimStrings: rule.trimStrings,
    disabled: rule.enabled === false,
    ...(rule.placement !== undefined ? { placement: rule.placement } : {}),
    ...(rule.markdownOnly ? { markdownOnly: true } : {}),
    ...(rule.promptOnly ? { promptOnly: true } : {}),
    ...(rule.runOnEdit ? { runOnEdit: true } : {}),
    ...(rule.substituteRegex === false ? { substituteRegex: false } : {}),
    ...(rule.minDepth !== null ? { minDepth: rule.minDepth } : {}),
    ...(rule.maxDepth !== null ? { maxDepth: rule.maxDepth } : {}),
  };
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
    const jailbreak = prompts.find(prompt => prompt.identifier === 'jailbreak');
    const jailbreakOrder = promptOrder.find(item => item.identifier === 'jailbreak');
    const explicitPostHistory = String(src.postHistory || '');
    const migratedPostHistory = explicitPostHistory.trim() || (jailbreakOrder?.enabled !== false ? String(jailbreak?.content || '') : '');
    // 旧版把后指令放在 jailbreak 固定条目；迁移到独立字段后清空旧条目，避免保存编辑器后重复注入。
    if (!explicitPostHistory.trim() && jailbreak?.content) jailbreak.content = '';
    return { ...src, version: PRESET_SCHEMA_VERSION, mode: presetMode(name, src), firstMes: String(src.firstMes || ''), postHistory: migratedPostHistory, prompts, promptOrder, regexes: normalizeOutputRegexRules(src.regexes, 'preset') };
  }

  const prompts = PRESET_MARKERS.map(([id, label]) => makePresetMarker(
    id,
    label,
    id === 'main' ? String(src.systemPrompt || '') : '',
  ));
  const promptOrder = prompts.map(p => ({ identifier: p.identifier, enabled: p.identifier !== 'tavernRpg' || presetMode(name, src) !== 'tavern' }));
  const formatIndex = promptOrder.findIndex(o => o.identifier === 'tavernFormat');
  for (const [i, module] of (Array.isArray(src.modules) ? src.modules : []).entries()) {
    let identifier = String(module.id || `module-${i + 1}`);
    while (prompts.some(p => p.identifier === identifier)) identifier += '-copy';
    prompts.push({ identifier, name: String(module.name || identifier), role: 'system', content: String(module.content || ''), marker: false, position: 'relative', depth: 4, order: 100 });
    promptOrder.splice(formatIndex + i, 0, { identifier, enabled: module.enabled !== false });
  }
  return { version: PRESET_SCHEMA_VERSION, mode: presetMode(name, src), firstMes: String(src.firstMes || ''), postHistory: String(src.postHistory || ''), prompts, promptOrder, regexes: normalizeOutputRegexRules(src.regexes, 'preset'), ...(src.agent && typeof src.agent === 'object' && !Array.isArray(src.agent) ? { agent: cloneValue(src.agent) } : {}) };
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

// 仅替换未被用户改写的旧内置酒馆预设，并把回复选项协议迁移到 RP 基础预设后预设。
function migrateBuiltInTavernPreset(defaults) {
  const name = 'RP 基础（示例）';
  const builtin = defaults?.presets?.[name];
  let changed = false;
  const current = promptPresets[name];
  if (builtin && current) {
    const main = current.prompts?.find(p => p.identifier === 'main')?.content || current.systemPrompt || '';
    if (main.includes('角色的每一句话都必须使用中文引号 “ ” 包裹')) {
      promptPresets[name] = cloneValue(builtin);
      changed = true;
    }
  }
  const target = promptPresets[name];
  const optionConfig = defaults?.tavern?.replyOptions;
  // 兼容旧版 server.js：/api/data/seed 暂时没有 tavern 段时，仍从内置 RP 预设取协议。
  const builtinOptionInstruction = builtInTavernReplyOptionsInstruction() || String(builtin?.postHistory || '').match(/【AI 回复选项协议】[\s\S]*$/)?.[0] || '';
  const optionInstruction = String(optionConfig?.instruction || builtinOptionInstruction).trim();
  if (target && optionConfig?.enabled !== false && optionInstruction && !hasTavernReplyOptionsProtocol(target.postHistory)) {
    const rules = optionConfig ? tavernReplyOptionRules() : { enabled: true, min: 4, max: 4, count: 4 };
    target.postHistory = [String(target.postHistory || '').trim(), formatTavernReplyOptionsInstruction(optionInstruction, rules)].filter(Boolean).join('\n\n');
    changed = true;
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
  const world = currentWorldCard();
  const bound = mode === 'tavern' && char?.presetName && promptPresets[char.presetName]
    && ['tavern', 'both'].includes(presetMode(char.presetName, promptPresets[char.presetName])) ? char.presetName : '';
  const worldBound = mode === 'rpg' && world?.rpgPresetName && promptPresets[world.rpgPresetName]
    && ['rpg', 'both'].includes(presetMode(world.rpgPresetName, promptPresets[world.rpgPresetName])) ? world.rpgPresetName : '';
  const name = bound || worldBound || activePresetNameForMode(mode);
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
      setMobileManagerPanel('prompt-mgr', 'detail');
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
  const active = sel.value || '全局默认';
  const note = $('pg-active-note');
  if (note) note.textContent = `当前${mode === 'rpg' ? 'RPG' : '酒馆'}模式实际使用：${active}。左侧列表用于编辑预设内容。`;
}

function selectPresetForEdit(name) {
  setMobilePromptPanel('sequence');
  pgEditingName = name || GLOBAL_PRESET_KEY;
  pgEditingPreset = normalizePromptPreset(pgEditingName, promptPresets[pgEditingName]);
  pgEditingPromptId = pgEditingPreset.promptOrder.find(item => item.identifier !== 'jailbreak')?.identifier || null;
  $('pg-edit-title').textContent = pgEditingName === GLOBAL_PRESET_KEY ? '编辑全局默认' : '编辑预设：' + pgEditingName;
  $('pg-mode').value = pgEditingPreset.mode;
  $('pg-first-mes').value = pgEditingPreset.firstMes;
  $('pg-post-history').value = pgEditingPreset.postHistory || '';
  fillPGActive();
  renderPGPrompts();
  renderPGList();
}

function pgNew() {
  setMobileManagerPanel('prompt-mgr', 'detail');
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
  pgEditingPreset.postHistory = $('pg-post-history').value;
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
  const visibleOrder = (pgEditingPreset?.promptOrder || []).map((item, index) => ({ item, index })).filter(({ item }) => item.identifier !== 'jailbreak');
  if (!visibleOrder.length) box.innerHTML = '<div class="hint">提示词顺序为空。请新建条目或从素材库插入。</div>';
  const promptMap = new Map(pgEditingPreset?.prompts.map(p => [p.identifier, p]) || []);
  visibleOrder.forEach(({ item, index: promptIndex }) => {
    const p = promptMap.get(item.identifier);
    if (!p) return;
    const el = document.createElement('div');
    el.className = 'pg-prompt-row' + (p.identifier === pgEditingPromptId ? ' active' : '');
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.innerHTML = `<input type="checkbox" data-enable="${promptIndex}" aria-label="启用 ${esc(p.name)}" ${item.enabled ? 'checked' : ''} />
      <div class="pg-prompt-main"><span class="pg-prompt-name">${esc(p.name)}</span><span class="pg-prompt-meta"><span>${esc(p.role)}</span><span>${p.marker ? '固定槽位' : (p.position === 'in_chat' ? `历史深度 ${p.depth}` : '相对位置')}</span></span></div>
      <div class="pg-prompt-move"><button class="ghost-btn" type="button" data-move="-1" data-index="${promptIndex}" aria-label="上移 ${esc(p.name)}">↑</button><button class="ghost-btn" type="button" data-move="1" data-index="${promptIndex}" aria-label="下移 ${esc(p.name)}">↓</button></div>`;
    const selectPrompt = () => {
      capturePGPromptEditor();
      pgEditingPromptId = p.identifier;
      setMobilePromptPanel('entry');
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
  setMobilePromptPanel('entry');
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
  const promptList = Array.isArray(data?.prompts)
    ? data.prompts
    : (data?.prompts && typeof data.prompts === 'object'
      ? Object.entries(data.prompts).map(([identifier, prompt]) => ({ ...(prompt || {}), identifier: prompt?.identifier || identifier }))
      : []);
  const rawOrders = Array.isArray(data?.prompt_order)
    ? data.prompt_order
    : (data?.prompt_order && typeof data.prompt_order === 'object'
      ? Object.entries(data.prompt_order).map(([characterId, profile]) => Array.isArray(profile)
        ? { character_id: characterId, order: profile }
        : { ...(profile || {}), character_id: profile?.character_id ?? characterId })
      : []);
  if (!data || !promptList.length) throw new Error('不是 SillyTavern Chat Completion 预设');
  if (promptList.length > 2000) throw new Error('预设素材超过 2000 条，拒绝导入');
  if (!rawOrders.length) throw new Error('不是 SillyTavern Chat Completion 预设');
  const profile = rawOrders.find(x => String(x?.character_id ?? x?.characterId ?? x?.id ?? '') === '100001') || rawOrders.at(-1);
  const rawOrderValue = profile?.order;
  const rawOrder = Array.isArray(profile?.order)
    ? profile.order
    : (profile?.order && typeof profile.order === 'object' ? Object.values(profile.order) : []);
  if (!profile || !(Array.isArray(rawOrderValue) || (rawOrderValue && typeof rawOrderValue === 'object'))) throw new Error('预设缺少 prompt_order');
  if (rawOrder.length > 2000) throw new Error('提示词顺序超过 2000 条，拒绝导入');
  const prompts = promptList.map((rawPrompt, i) => {
    const p = rawPrompt && typeof rawPrompt === 'object' ? rawPrompt : {};
    return {
    ...p,
    identifier: String(p.identifier || p.id || `prompt-${i + 1}`),
    name: String(p.name || p.title || p.identifier || p.id || `提示词 ${i + 1}`),
    role: ['system', 'user', 'assistant'].includes(p.role) ? p.role : (p.role === 'ai' ? 'assistant' : 'system'),
    content: String(p.content || ''),
    marker: !!p.marker || p.system_prompt === true || PRESET_MARKER_IDS.has(p.identifier || p.id),
    position: Number(p.injection_position ?? p.position) === 1 || String(p.position || '').toLowerCase() === 'in_chat' ? 'in_chat' : 'relative',
    depth: Math.max(0, Number(p.injection_depth ?? p.depth ?? 4) || 0),
    order: Number(p.injection_order ?? p.order ?? 100) || 0,
    };
  });
  const promptOrder = rawOrder.map(o => {
    const item = typeof o === 'string' ? { identifier: o } : (o || {});
    return { identifier: String(item.identifier || item.id || ''), enabled: item.enabled !== false };
  }).filter(item => item.identifier);
  const modelParameters = Object.fromEntries([
    'temperature', 'frequency_penalty', 'presence_penalty', 'top_p', 'top_k', 'top_a', 'min_p',
    'repetition_penalty', 'openai_max_context', 'openai_max_tokens', 'max_tokens', 'max_completion_tokens', 'stop', 'seed', 'n', 'stream', 'stream_openai',
    'reasoning_effort', 'verbosity', 'assistant_prefill', 'continue_prefill', 'continue_postfix',
    'chat_completion_source', 'openai_model', 'custom_prompt_post_processing',
  ].filter(key => data[key] !== undefined).map(key => [key, data[key]]));
  const importedMode = ['tavern', 'rpg', 'both'].includes(data.tavern_meta?.mode) ? data.tavern_meta.mode : 'tavern';
  const regexes = normalizeOutputRegexRules(data.extensions?.regex_scripts ?? data.extensions?.regexScripts, 'preset');
  const importedPostHistory = String(data.tavern_meta?.postHistory || '') || String(prompts.find(prompt => prompt.identifier === 'jailbreak')?.content || '');
  return {
    preset: { version: PRESET_SCHEMA_VERSION, mode: importedMode, firstMes: String(data.tavern_meta?.firstMes || ''), postHistory: importedPostHistory, prompts, promptOrder, regexes, modelParameters, source: { format: 'sillytavern-chat-completion', profile: profile.character_id ?? profile.characterId ?? profile.id, unusedPrompts: Math.max(0, prompts.length - promptOrder.length) } },
    report: { prompts: prompts.length, ordered: promptOrder.length, regexes: regexes.length },
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

async function exportPromptPreset() {
  if (!pgEditingPreset || pgEditingName === GLOBAL_PRESET_KEY) return;
  capturePGPromptEditor();
  const prompts = pgEditingPreset.prompts.map(p => ({
    name: p.name, system_prompt: p.marker, role: p.role, content: p.identifier === 'jailbreak' ? (pgEditingPreset.postHistory || p.content) : p.content,
    identifier: p.identifier, marker: p.marker || undefined,
    injection_position: p.position === 'in_chat' ? 1 : 0,
    injection_depth: p.depth, injection_order: p.order,
  }));
  const payload = { ...(pgEditingPreset.modelParameters || {}), prompts, prompt_order: [{ character_id: 100001, order: pgEditingPreset.promptOrder }], extensions: { regex_scripts: (pgEditingPreset.regexes || []).map(serializeOutputRegexRule) }, tavern_meta: { version: PRESET_SCHEMA_VERSION, mode: pgEditingPreset.mode, firstMes: pgEditingPreset.firstMes, postHistory: pgEditingPreset.postHistory || '' } };
  await downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), pgEditingName.replace(/[\\/:*?"<>|]/g, '_') + '.json');
}

/* ─────────── 输出正则管理 ─────────── */
function activePresetOutputRegexes() {
  return normalizeOutputRegexRules(resolvePromptPreset()?.preset?.regexes, 'preset');
}

function saveOutputRegexPrefs() {
  saveJSON(LS_PREFS, prefs);
}

function selectedOutputRegex() {
  if (!regexEditingId) return null;
  const list = regexEditingSource === 'preset' ? activePresetOutputRegexes()
    : regexEditingSource === 'world' ? normalizeOutputRegexRules(currentWorldCard()?.regexes, 'world')
      : modeOutputRegexes();
  return list.find(rule => rule.id === regexEditingId) || null;
}

function renderRegexEditor(rule = null, source = 'custom') {
  const readOnly = source === 'preset' || source === 'world';
  const label = source === 'preset' ? '预设正则' : source === 'world' ? '世界卡正则' : '自定义正则';
  $('regex-edit-title').textContent = rule ? `${label}：${rule.name}` : '新建自定义正则';
  $('regex-name').value = rule?.name || '';
  $('regex-find').value = rule?.findRegex || '';
  $('regex-replace').value = rule?.replaceString || '';
  $('regex-trim').value = (rule?.trimStrings || []).join(', ');
  $('regex-enabled').checked = rule ? rule.enabled !== false : true;
  ['regex-name', 'regex-find', 'regex-replace', 'regex-trim', 'regex-enabled'].forEach(id => { $(id).disabled = readOnly; });
  $('regex-save').disabled = readOnly;
  $('regex-del').disabled = readOnly || !rule;
  $('regex-copy').classList.toggle('hidden', !readOnly);
  $('regex-note').textContent = readOnly
    ? `这是当前${source === 'world' ? '世界卡' : '预设'}携带的正则，只读；复制后可作为当前模式的自定义正则调整。`
    : '自定义正则只作用于当前模式，并会在世界卡 / 预设正则之后执行。';
}

function resetRegexEditor() {
  setMobileManagerPanel('regex-mgr', 'detail');
  regexEditingId = null;
  regexEditingSource = 'custom';
  renderRegexEditor();
  renderRegexList();
}

function selectRegexForEdit(source, id) {
  setMobileManagerPanel('regex-mgr', 'detail');
  regexEditingSource = source;
  regexEditingId = id;
  renderRegexList();
  renderRegexEditor(selectedOutputRegex(), source);
}

function renderRegexList() {
  const list = $('regex-list');
  if (!list) return;
  const presetRules = activePresetOutputRegexes();
  const worldRules = mode === 'rpg' && worldModeActive() ? normalizeOutputRegexRules(currentWorldCard()?.regexes, 'world') : [];
  const customRules = normalizeOutputRegexRules(modeOutputRegexes(), 'custom');
  const modeNote = $('regex-mode-note');
  if (modeNote) modeNote.textContent = `当前模式：${mode === 'rpg' ? 'RPG' : '酒馆'} · 世界卡 ${worldRules.length} 条 · 预设 ${presetRules.length} 条 · 自定义 ${customRules.length} 条`;
  list.innerHTML = '';
  if (!presetRules.length && !worldRules.length && !customRules.length) {
    list.innerHTML = '<div class="hint">当前没有输出正则。可新建一条，或导入带正则的 SillyTavern 预设。</div>';
    return;
  }
  const appendGroup = (label, rules, source) => {
    if (!rules.length) return;
    const heading = document.createElement('div');
    heading.className = 'hint regex-group-title';
    heading.textContent = label;
    list.appendChild(heading);
    for (const rule of rules) {
      const item = document.createElement('div');
      item.className = 'cm-item' + (source === regexEditingSource && rule.id === regexEditingId ? ' active' : '') + (rule.enabled === false ? ' regex-off' : '');
      item.innerHTML = `<span>${rule.enabled === false ? '🚫 ' : ''}${esc(rule.name)}</span><small>${source === 'preset' ? '预设' : source === 'world' ? '世界卡' : '当前模式'}</small>`;
      item.addEventListener('click', () => selectRegexForEdit(source, rule.id));
      list.appendChild(item);
    }
  };
  appendGroup('当前世界卡自动携带', worldRules, 'world');
  appendGroup('当前预设自动携带', presetRules, 'preset');
  appendGroup(`${mode === 'rpg' ? 'RPG' : '酒馆'}模式自定义`, customRules, 'custom');
}

function saveRegexEditor() {
  if (['preset', 'world'].includes(regexEditingSource)) return;
  const name = $('regex-name').value.trim() || '未命名正则';
  const findRegex = $('regex-find').value.trim();
  const candidate = normalizeOutputRegexRule({
    id: regexEditingId || uid(),
    name,
    findRegex,
    replaceString: $('regex-replace').value,
    trimStrings: $('regex-trim').value.split(',').map(value => value.trim()).filter(Boolean),
    enabled: $('regex-enabled').checked,
  }, 0, 'custom');
  if (!buildOutputRegex(candidate)) {
    alert('匹配表达式为空或不是有效正则。');
    $('regex-find').focus();
    return;
  }
  const rules = modeOutputRegexes();
  const index = rules.findIndex(rule => rule.id === regexEditingId);
  if (index >= 0) rules[index] = candidate;
  else rules.push(candidate);
  regexEditingId = candidate.id;
  regexEditingSource = 'custom';
  saveOutputRegexPrefs();
  renderRegexList();
  renderRegexEditor(candidate, 'custom');
}

function copyPresetRegexToCustom() {
  const rule = selectedOutputRegex();
  if (!rule || !['preset', 'world'].includes(regexEditingSource)) return;
  const copy = normalizeOutputRegexRule({ ...rule, id: uid(), name: `${rule.name}（自定义）` }, 0, 'custom');
  modeOutputRegexes().push(copy);
  saveOutputRegexPrefs();
  regexEditingId = copy.id;
  regexEditingSource = 'custom';
  renderRegexList();
  renderRegexEditor(copy, 'custom');
}

function deleteRegexEditor() {
  if (['preset', 'world'].includes(regexEditingSource) || !regexEditingId) return;
  const rules = modeOutputRegexes();
  const index = rules.findIndex(rule => rule.id === regexEditingId);
  if (index < 0 || !confirm(`删除正则「${rules[index].name || regexEditingId}」？`)) return;
  rules.splice(index, 1);
  saveOutputRegexPrefs();
  resetRegexEditor();
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
    el.tabIndex = 0;
    const sourceMark = lb.source?.type === 'character-card' ? ' · 角色卡' : (lb.source?.type === 'sillytavern-world-info' ? ' · ST' : '');
    const active = id === prefs.activeLoreId;
    const entryCount = Array.isArray(lb.entries) ? lb.entries.length
      : (lb.entries && typeof lb.entries === 'object' ? Object.keys(lb.entries).length : 0);
    el.innerHTML = `<span class="cm-name">${esc(lb.name)}${esc(sourceMark)}<small>${entryCount} 条目</small></span><span class="world-lb-actions"><button class="cm-x world-lb-use" type="button" data-act="act" aria-pressed="${active ? 'true' : 'false'}" title="${active ? '当前正在使用' : '设为当前使用'}">${active ? '使用中' : '设为使用'}</button><button class="cm-x world-lb-delete" type="button" data-act="delete" aria-label="删除 ${esc(lb.name)}" title="删除世界书">删除</button></span>`;
    el.addEventListener('click', (ev) => {
      const action = ev.target.closest?.('[data-act]')?.dataset.act;
      if (action === 'act') { setActiveLB(id); return; }
      if (action === 'delete') { deleteLBById(id); return; }
      setMobileManagerPanel('lore-mgr', 'detail');
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
  setMobileLorePanel('book');
  lbEditingId = id;
  wiEditingId = null;
  $('lb-edit-title').textContent = '世界书：' + lorebooks[id].name;
  fillLorebookSettings();
  renderLBList();
  renderWIList();
}

function fillLorebookSettings() {
  const bookSettings = normalizeLorebookSettings(currentLB());
  const fields = {
    'lb-name': currentLB()?.name || '',
    'lb-scan-depth': bookSettings.scanDepth ?? prefs.wiScanDepth ?? 6,
    'lb-budget': bookSettings.budget ?? prefs.wiBudget ?? 0,
    'lb-max-recursion': bookSettings.maxRecursionSteps ?? prefs.wiMaxRecursionSteps ?? 3,
    'lb-min-activations': bookSettings.minActivations ?? prefs.wiMinActivations ?? 0,
    'lb-min-depth': bookSettings.minActivationsDepthMax ?? prefs.wiMinActivationsDepthMax ?? 0,
  };
  for (const [id, value] of Object.entries(fields)) if ($(id)) $(id).value = value;
  if ($('lb-include-names')) $('lb-include-names').checked = bookSettings.includeNames ?? (prefs.wiIncludeNames !== false);
  if ($('lb-case-sensitive')) $('lb-case-sensitive').checked = bookSettings.caseSensitive ?? (prefs.wiCaseSensitive === true);
  if ($('lb-whole-word')) $('lb-whole-word').checked = bookSettings.matchWholeWords ?? (prefs.wiWholeWord === true);
  if ($('lb-recursive')) $('lb-recursive').checked = bookSettings.recursive ?? (prefs.wiRecursive === true);
  if ($('lb-group-scoring')) $('lb-group-scoring').checked = bookSettings.useGroupScoring ?? (prefs.wiUseGroupScoring === true);
  if ($('lb-strategy')) $('lb-strategy').value = bookSettings.insertionStrategy || prefs.wiInsertionStrategy || 'evenly';
}

function saveLorebookSettings() {
  const book = currentLB();
  if (!book) return;
  book.settings = {
    scanDepth: Math.max(0, Math.min(1000, parseInt($('lb-scan-depth')?.value, 10) || 0)),
    budget: Math.max(0, Math.min(200000, parseInt($('lb-budget')?.value, 10) || 0)),
    maxRecursionSteps: Math.max(1, Math.min(8, parseInt($('lb-max-recursion')?.value, 10) || 3)),
    minActivations: Math.max(0, Math.min(100, parseInt($('lb-min-activations')?.value, 10) || 0)),
    minActivationsDepthMax: Math.max(0, Math.min(1000, parseInt($('lb-min-depth')?.value, 10) || 0)),
    includeNames: !!$('lb-include-names')?.checked,
    caseSensitive: !!$('lb-case-sensitive')?.checked,
    matchWholeWords: !!$('lb-whole-word')?.checked,
    recursive: !!$('lb-recursive')?.checked,
    useGroupScoring: !!$('lb-group-scoring')?.checked,
    insertionStrategy: ['evenly', 'character_first', 'global_first'].includes($('lb-strategy')?.value) ? $('lb-strategy').value : 'evenly',
  };
  // 旧调用路径仍读取 prefs；当前选中的“全局世界书”同步回退值，旧数据不会失效。
  if (prefs.activeLoreId === lbEditingId) {
    prefs.wiScanDepth = book.settings.scanDepth;
    prefs.wiBudget = book.settings.budget;
    prefs.wiMaxRecursionSteps = book.settings.maxRecursionSteps;
    prefs.wiMinActivations = book.settings.minActivations;
    prefs.wiMinActivationsDepthMax = book.settings.minActivationsDepthMax;
    prefs.wiIncludeNames = book.settings.includeNames;
    prefs.wiCaseSensitive = book.settings.caseSensitive;
    prefs.wiWholeWord = book.settings.matchWholeWords;
    prefs.wiRecursive = book.settings.recursive;
    prefs.wiUseGroupScoring = book.settings.useGroupScoring;
    prefs.wiInsertionStrategy = book.settings.insertionStrategy;
  }
  saveLore();
  saveJSON(LS_PREFS, prefs);
}

function renameCurrentLB() {
  const book = currentLB();
  const name = String($('lb-name')?.value || '').trim();
  if (!book || !name) return;
  book.name = name.slice(0, 120);
  $('lb-edit-title').textContent = '世界书：' + book.name;
  saveLore();
  renderLBList();
}

function lbNew() {
  setMobileManagerPanel('lore-mgr', 'detail');
  const name = prompt('新世界书名称：', '世界书 ' + (Object.keys(lorebooks).length + 1));
  if (!name || !name.trim()) return;
  const id = uid();
  lorebooks[id] = { name: name.trim(), entries: [], settings: {} };
  saveLore();
  selectLB(id);
}

function deleteLBById(id) {
  if (!id || !lorebooks[id]) return;
  const lb = lorebooks[id];
  if (!confirm(`删除世界书「${lb.name}」？其条目将一并删除。`)) return;
  delete lorebooks[id];
  const nextId = Object.keys(lorebooks)[0] || null;
  if (prefs.activeLoreId === id || !lorebooks[prefs.activeLoreId]) prefs.activeLoreId = nextId;
  if (lbEditingId === id) lbEditingId = nextId;
  saveJSON(LS_PREFS, prefs);
  saveLore();
  renderLBList();
  if (lbEditingId) selectLB(lbEditingId);
}

function lbDelete() { deleteLBById(lbEditingId); }

function currentLBEntries() {
  const lb = currentLB();
  if (!lb) return [];
  if (!Array.isArray(lb.entries)) lb.entries = lorebookEntriesForPrompt(lb);
  return lb.entries;
}

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
    el.className = 'wi-item' + (e.id === wiEditingId ? ' active' : '') + (e.enabled === false ? ' wi-off' : '');
    el.tabIndex = 0;
    const position = worldInfoPositionLabel(e);
    el.innerHTML = `<span class="wi-title-wrap">${e.enabled === false ? '🚫 ' : ''}${esc(e.title || '（无标题）')}<small>${esc(position)}</small></span><span class="wi-keys-preview">${esc(e.keys || '')}</span><span class="wi-const" data-act="enabled" title="${e.enabled === false ? '启用条目' : '停用条目'}">${e.enabled === false ? '○' : '●'}</span><span class="wi-const" data-act="const" title="${e.constant ? '取消常驻（改为触发注入）' : '设为常驻（不触发也总是注入）'}">${e.constant ? '🔒' : '🔓'}</span>`;
    el.addEventListener('click', (ev) => {
      if (ev.target.dataset && ev.target.dataset.act === 'enabled') { toggleWIEnabled(e.id); return; }
      if (ev.target.dataset && ev.target.dataset.act === 'const') { toggleConst(e.id); return; }
      setMobileLorePanel('entry');
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
  $('wi-secondary').value = Array.isArray(e.secondaryKeys) ? e.secondaryKeys.join(', ') : String(e.keysecondary || '');
  $('wi-content').value = e.content || '';
  $('wi-order').value = e.order || 100;
  $('wi-position').value = String(normalizeWorldInfoPosition(e.wiPosition ?? e.position));
  $('wi-depth').value = Number(e.depth ?? 4);
  $('wi-role').value = String(worldInfoRoleValue(e.role));
  $('wi-selective-logic').value = String(normalizeWorldInfoLogic(e.selectiveLogic));
  $('wi-outlet').value = e.outletName || '';
  $('wi-enabled').checked = e.enabled !== false;
  $('wi-constant').checked = !!e.constant;
  $('wi-selective').checked = !!e.selective;
  $('wi-use-regex').checked = !!e.useRegex;
  $('wi-case-sensitive').checked = e.caseSensitive === true;
  $('wi-whole-words').checked = e.matchWholeWords === true;
  $('wi-probability').value = Number(e.probability ?? 100);
  $('wi-use-probability').checked = e.useProbability !== false;
  $('wi-ignore-budget').checked = !!e.ignoreBudget;
  $('wi-group').value = e.group || '';
  $('wi-group-weight').value = Number(e.groupWeight ?? 100);
  $('wi-group-override').checked = !!e.groupOverride;
  $('wi-group-scoring').checked = e.useGroupScoring === true;
  $('wi-sticky').value = Number(e.sticky || 0);
  $('wi-cooldown').value = Number(e.cooldown || 0);
  $('wi-delay').value = Number(e.delay || 0);
  $('wi-exclude-recursion').checked = !!e.excludeRecursion;
  $('wi-prevent-recursion').checked = !!e.preventRecursion;
  $('wi-delay-recursion').checked = !!e.delayUntilRecursion;
  $('wi-automation').value = e.automationId || '';
  renderWIList();
}

/* 注入测试：按当前最近消息即时计算哪些世界书条目会命中 */
function wiTestHits() {
  const injected = buildWorldInfo({ dryRun: true });
  const el = $('wi-test-result');
  if (!el) return;
  el.textContent = injected.length
    ? `✅ 将注入 ${injected.length} 条：` + injected.map(c => c.slice(0, 24)).join(' / ')
    : 'ℹ️ 当前无命中 —— 检查触发词是否出现在最近消息中、扫描深度、条目是否已保存（常驻条目始终注入）';
}

function newWIEditor() {
  if (!lbEditingId) return;
  setMobileLorePanel('entry');
  wiEditingId = null;
  $('wi-title').value = '';
  $('wi-keys').value = '';
  $('wi-secondary').value = '';
  $('wi-content').value = '';
  $('wi-order').value = 100;
  $('wi-position').value = String(WORLD_INFO_POSITION.after);
  $('wi-depth').value = 4;
  $('wi-role').value = String(WORLD_INFO_ROLE.system);
  $('wi-selective-logic').value = String(WORLD_INFO_LOGIC.AND_ANY);
  $('wi-outlet').value = '';
  $('wi-enabled').checked = true;
  $('wi-constant').checked = false;
  $('wi-selective').checked = false;
  $('wi-use-regex').checked = false;
  $('wi-case-sensitive').checked = false;
  $('wi-whole-words').checked = false;
  $('wi-probability').value = 100;
  $('wi-use-probability').checked = true;
  $('wi-ignore-budget').checked = false;
  $('wi-group').value = '';
  $('wi-group-weight').value = 100;
  $('wi-group-override').checked = false;
  $('wi-group-scoring').checked = false;
  $('wi-sticky').value = 0;
  $('wi-cooldown').value = 0;
  $('wi-delay').value = 0;
  $('wi-exclude-recursion').checked = false;
  $('wi-prevent-recursion').checked = false;
  $('wi-delay-recursion').checked = false;
  $('wi-automation').value = '';
  renderWIList();
}

function saveWI() {
  if (!lbEditingId) return;
  const primaryKeys = String($('wi-keys').value || '').split(',').map(k => k.trim()).filter(Boolean);
  const secondaryKeys = String($('wi-secondary').value || '').split(',').map(k => k.trim()).filter(Boolean);
  const data = {
    title: $('wi-title').value.trim(),
    comment: $('wi-title').value.trim(),
    keys: [...primaryKeys, ...secondaryKeys].join(', '),
    key: primaryKeys,
    keysecondary: secondaryKeys,
    primaryKeys,
    secondaryKeys,
    content: $('wi-content').value,
    order: parseInt($('wi-order').value, 10) || 100,
    position: parseInt($('wi-position').value, 10) || 0,
    wiPosition: parseInt($('wi-position').value, 10) || 0,
    depth: Math.max(0, parseInt($('wi-depth').value, 10) || 4),
    role: parseInt($('wi-role').value, 10) || 0,
    selective: $('wi-selective').checked,
    selectiveLogic: parseInt($('wi-selective-logic').value, 10) || 0,
    outletName: $('wi-outlet').value.trim(),
    constant: $('wi-constant').checked,
    enabled: $('wi-enabled').checked,
    useRegex: $('wi-use-regex').checked,
    caseSensitive: $('wi-case-sensitive').checked ? true : null,
    matchWholeWords: $('wi-whole-words').checked ? true : null,
    probability: Math.max(0, Math.min(100, Number($('wi-probability').value) || 0)),
    useProbability: $('wi-use-probability').checked,
    ignoreBudget: $('wi-ignore-budget').checked,
    group: $('wi-group').value.trim(),
    groupWeight: Math.max(0, Number($('wi-group-weight').value) || 0),
    groupOverride: $('wi-group-override').checked,
    useGroupScoring: $('wi-group-scoring').checked ? true : null,
    sticky: Math.max(0, Number($('wi-sticky').value) || 0),
    cooldown: Math.max(0, Number($('wi-cooldown').value) || 0),
    delay: Math.max(0, Number($('wi-delay').value) || 0),
    excludeRecursion: $('wi-exclude-recursion').checked,
    preventRecursion: $('wi-prevent-recursion').checked,
    delayUntilRecursion: $('wi-delay-recursion').checked,
    automationId: $('wi-automation').value.trim(),
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

function toggleWIEnabled(id) {
  const e = currentLBEntries().find(x => x.id === id);
  if (!e) return;
  e.enabled = e.enabled === false;
  saveLore();
  renderWIList();
}

/* SillyTavern World Info 的数值枚举；保留字符串别名，方便旧角色卡继续读取。 */
const WORLD_INFO_LOGIC = Object.freeze({ AND_ANY: 0, NOT_ALL: 1, NOT_ANY: 2, AND_ALL: 3 });
const WORLD_INFO_POSITION = Object.freeze({ before: 0, after: 1, anTop: 2, anBottom: 3, atDepth: 4, exampleTop: 5, exampleBottom: 6, outlet: 7 });
const WORLD_INFO_ROLE = Object.freeze({ system: 0, user: 1, assistant: 2 });

function normalizeWorldInfoLogic(value) {
  if (Number.isFinite(Number(value))) return Math.max(0, Math.min(3, Number(value)));
  const key = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  return ({ and_any: 0, and: 0, not_all: 1, not_any: 2, and_all: 3 }[key] ?? WORLD_INFO_LOGIC.AND_ANY);
}

function normalizeWorldInfoPosition(value) {
  if (Number.isFinite(Number(value))) return Math.max(0, Math.min(7, Number(value)));
  const key = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  return ({ before_char: 0, before: 0, after_char: 1, after: 1, top_an: 2, an_top: 2,
    bottom_an: 3, an_bottom: 3, at_depth: 4, depth: 4, before_examples: 5,
    example_top: 5, after_examples: 6, example_bottom: 6, outlet: 7 }[key] ?? WORLD_INFO_POSITION.after);
}

function worldInfoRoleValue(value) {
  if (Number.isFinite(Number(value))) return Math.max(0, Math.min(2, Number(value)));
  return ({ system: 0, user: 1, assistant: 2, bot: 2 }[String(value || '').trim().toLowerCase()] ?? WORLD_INFO_ROLE.system);
}

function worldInfoPositionLabel(entry) {
  switch (normalizeWorldInfoPosition(entry?.wiPosition ?? entry?.position)) {
    case WORLD_INFO_POSITION.before: return '角色前';
    case WORLD_INFO_POSITION.after: return '角色后';
    case WORLD_INFO_POSITION.anTop: return '作者注记前';
    case WORLD_INFO_POSITION.anBottom: return '作者注记后';
    case WORLD_INFO_POSITION.atDepth: return `深度 ${Number(entry?.depth ?? 4)}`;
    case WORLD_INFO_POSITION.exampleTop: return '示例前';
    case WORLD_INFO_POSITION.exampleBottom: return '示例后';
    case WORLD_INFO_POSITION.outlet: return `Outlet ${entry?.outletName || '未命名'}`;
    default: return '角色后';
  }
}

function normalizeCharacterBookEntries(book) {
  const entries = Array.isArray(book?.entries) ? book.entries : (book?.entries && typeof book.entries === 'object' ? Object.values(book.entries) : []);
  const bookDepth = Number(book?.scan_depth);
  const scanDepth = Number.isFinite(bookDepth) && bookDepth >= 0 ? Math.floor(bookDepth) : null;
  const keyList = value => {
    if (Array.isArray(value)) return value.flatMap(item => keyList(item));
    const text = String(value || '').trim();
    if (!text) return [];
    // 正则字面量可能包含逗号；普通旧格式字符串才按逗号拆分。
    if (text.startsWith('/') && text.lastIndexOf('/') > 0) return [text];
    return text.split(',').map(item => item.trim()).filter(Boolean);
  };
  return entries.filter(Boolean).map((entry, index) => {
    const extensions = entry.extensions && typeof entry.extensions === 'object' ? entry.extensions : {};
    // ST World Info V2 把多数高级字段放在 extensions 下，旧版/角色书则常直接放在条目上。
    const primary = keyList(entry.primaryKeys ?? entry.key ?? entry.primary_keys ?? entry.keys);
    const secondary = keyList(entry.secondaryKeys ?? entry.keysecondary ?? entry.secondary_keys);
    const entryDepth = Number(entry.scan_depth ?? entry.scanDepth ?? extensions.scan_depth);
    const numberOr = (value, fallback = null) => {
      const number = Number(value);
      return Number.isFinite(number) ? number : fallback;
    };
    const position = normalizeWorldInfoPosition(entry.position ?? extensions.position);
    const depth = numberOr(entry.depth ?? extensions.depth, 4);
    const uidValue = entry.uid ?? entry.id ?? ('character-book-' + index);
    const title = entry.comment || entry.title || ('角色书条目 ' + (index + 1));
    const keys = [...primary, ...secondary].map(String).filter(Boolean).join(', ');
    const booleanOrNull = (...values) => {
      for (const value of values) if (typeof value === 'boolean') return value;
      return null;
    };
    return {
      ...entry,
      id: String(entry.id ?? uidValue),
      uid: uidValue,
      title,
      comment: String(entry.comment ?? title),
      keys,
      key: primary,
      keysecondary: secondary,
      primaryKeys: primary,
      secondaryKeys: secondary,
      selective: entry.selective === true,
      selectiveLogic: normalizeWorldInfoLogic(entry.selectiveLogic ?? extensions.selective_logic ?? extensions.selectiveLogic),
      useRegex: entry.use_regex === true || entry.useRegex === true || extensions.use_regex === true || extensions.useRegex === true,
      caseSensitive: booleanOrNull(entry.case_sensitive, entry.caseSensitive, extensions.case_sensitive, extensions.caseSensitive),
      matchWholeWords: booleanOrNull(entry.match_whole_words, entry.matchWholeWords, extensions.match_whole_words, extensions.matchWholeWords),
      scanDepth: Number.isFinite(entryDepth) && entryDepth >= 0 ? Math.floor(entryDepth) : scanDepth,
      position,
      wiPosition: position,
      depth: Math.max(0, depth),
      role: entry.role ?? extensions.role ?? 'system',
      probability: Math.max(0, Math.min(100, numberOr(entry.probability ?? extensions.probability, 100))),
      useProbability: entry.useProbability ?? extensions.use_probability ?? extensions.useProbability ?? true,
      group: String(entry.group ?? extensions.group ?? '').trim(),
      groupOverride: entry.groupOverride ?? extensions.group_override ?? extensions.groupOverride ?? false,
      groupWeight: Math.max(0, numberOr(entry.groupWeight ?? extensions.group_weight ?? extensions.groupWeight, 100)),
      useGroupScoring: booleanOrNull(entry.useGroupScoring, extensions.use_group_scoring, extensions.useGroupScoring),
      sticky: Math.max(0, numberOr(entry.sticky ?? extensions.sticky, 0)),
      cooldown: Math.max(0, numberOr(entry.cooldown ?? extensions.cooldown, 0)),
      delay: Math.max(0, numberOr(entry.delay ?? extensions.delay, 0)),
      excludeRecursion: entry.excludeRecursion ?? entry.nonRecursable ?? extensions.exclude_recursion ?? false,
      preventRecursion: entry.preventRecursion ?? extensions.prevent_recursion ?? false,
      delayUntilRecursion: entry.delayUntilRecursion ?? extensions.delay_until_recursion ?? false,
      vectorized: entry.vectorized ?? extensions.vectorized ?? false,
      triggers: Array.isArray(entry.triggers ?? extensions.triggers) ? [...(entry.triggers ?? extensions.triggers)] : [],
      automationId: String(entry.automationId ?? extensions.automation_id ?? ''),
      outletName: String(entry.outletName ?? extensions.outlet_name ?? '').trim(),
      matchPersonaDescription: entry.matchPersonaDescription ?? extensions.match_persona_description ?? false,
      matchCharacterDescription: entry.matchCharacterDescription ?? extensions.match_character_description ?? false,
      matchCharacterPersonality: entry.matchCharacterPersonality ?? extensions.match_character_personality ?? false,
      matchCharacterDepthPrompt: entry.matchCharacterDepthPrompt ?? extensions.match_character_depth_prompt ?? false,
      matchScenario: entry.matchScenario ?? extensions.match_scenario ?? false,
      matchCreatorNotes: entry.matchCreatorNotes ?? extensions.match_creator_notes ?? false,
      ignoreBudget: entry.ignoreBudget ?? entry.ignore_budget ?? extensions.ignore_budget ?? false,
      content: String(entry.content || ''),
      order: Number.isFinite(Number(entry.insertion_order ?? entry.order)) ? Number(entry.insertion_order ?? entry.order) : 100,
      enabled: entry.enabled !== false && entry.disable !== true,
      constant: entry.constant === true,
    };
  });
}

function characterBookForChar(char) {
  if (!char || typeof char !== 'object') return null;
  const candidates = [
    char.characterBook,
    char.character_book,
    char.cardData?.character_book,
    char.cardData?.characterBook,
    char.cardData?.extensions?.character_book,
    char.cardData?.extensions?.characterBook,
  ];
  for (const candidate of candidates) {
    const book = characterBookValue(candidate);
    const entries = book?.entries;
    if (Array.isArray(entries) ? entries.length : entries && typeof entries === 'object' && Object.keys(entries).length) return book;
  }
  return null;
}

function worldInfoKeyMatches(key, entry, text) {
  const source = String(key || '').trim();
  if (!source) return false;
  const bookSettings = entry.__bookSettings || {};
  const caseSensitive = entry.caseSensitive ?? bookSettings.caseSensitive ?? prefs.wiCaseSensitive === true;
  const regexLiteral = source.startsWith('/') && source.lastIndexOf('/') > 0;
  try {
    if (entry.useRegex || regexLiteral) {
      let pattern = source;
      let flags = '';
      if (regexLiteral) {
        const end = source.lastIndexOf('/');
        pattern = source.slice(1, end);
        flags = source.slice(end + 1);
      }
      // Imported World Info is untrusted input; cap regex size to avoid a client-side freeze.
      if (pattern.length > 500) return false;
      if (!caseSensitive && !flags.includes('i')) flags += 'i';
      return new RegExp(pattern, flags).test(text);
    }
  } catch {
    return false;
  }
  const wholeWord = entry.matchWholeWords ?? bookSettings.matchWholeWords ?? prefs.wiWholeWord;
  if (wholeWord) {
    // 与 ST 的自定义边界保持一致；中文等无空格语言仍可正常按字面匹配。
    const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flags = caseSensitive ? '' : 'i';
    if (/^[A-Za-z0-9_]+$/.test(source)) return new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`, flags).test(text);
  }
  return caseSensitive ? text.includes(source) : text.toLowerCase().includes(source.toLowerCase());
}

function worldInfoMatchStats(entry, text) {
  const primary = Array.isArray(entry.primaryKeys) ? entry.primaryKeys : (Array.isArray(entry.key) ? entry.key : []);
  const secondary = Array.isArray(entry.secondaryKeys) ? entry.secondaryKeys : (Array.isArray(entry.keysecondary) ? entry.keysecondary : []);
  const primaryHits = primary.filter(key => worldInfoKeyMatches(key, entry, text));
  const secondaryHits = secondary.filter(key => worldInfoKeyMatches(key, entry, text));
  const logic = normalizeWorldInfoLogic(entry.selectiveLogic);
  let secondaryOk = true;
  if (entry.selective && secondary.length) {
    if (logic === WORLD_INFO_LOGIC.AND_ALL) secondaryOk = secondaryHits.length === secondary.length;
    else if (logic === WORLD_INFO_LOGIC.NOT_ANY) secondaryOk = secondaryHits.length === 0;
    else if (logic === WORLD_INFO_LOGIC.NOT_ALL) secondaryOk = secondaryHits.length !== secondary.length;
    else secondaryOk = secondaryHits.length > 0;
  }
  return { primaryHits, secondaryHits, ok: primaryHits.length > 0 && secondaryOk,
    score: primaryHits.length + (logic === WORLD_INFO_LOGIC.AND_ALL ? secondaryHits.length : Math.min(1, secondaryHits.length)) };
}

function worldInfoScopeEffects(scope) {
  if (!scope || typeof scope !== 'object') return { sticky: {}, cooldown: {} };
  if (!scope.worldInfoState || typeof scope.worldInfoState !== 'object') scope.worldInfoState = {};
  if (!scope.worldInfoState.sticky || typeof scope.worldInfoState.sticky !== 'object') scope.worldInfoState.sticky = {};
  if (!scope.worldInfoState.cooldown || typeof scope.worldInfoState.cooldown !== 'object') scope.worldInfoState.cooldown = {};
  return scope.worldInfoState;
}

function serializeSTWorldInfoEntry(entry, index = 0) {
  const normalized = normalizeCharacterBookEntries({ entries: [entry] })[0] || entry;
  const position = normalizeWorldInfoPosition(normalized.wiPosition ?? normalized.position);
  const extension = {
    ...(normalized.extensions && typeof normalized.extensions === 'object' ? normalized.extensions : {}),
    position,
    depth: Number(normalized.depth ?? 4),
    role: worldInfoRoleValue(normalized.role),
    scan_depth: normalized.scanDepth ?? null,
    case_sensitive: normalized.caseSensitive ?? null,
    match_whole_words: normalized.matchWholeWords ?? null,
    use_group_scoring: normalized.useGroupScoring ?? null,
    group: normalized.group || '',
    group_override: !!normalized.groupOverride,
    group_weight: Number(normalized.groupWeight ?? 100),
    automation_id: normalized.automationId || '',
    outlet_name: normalized.outletName || '',
    sticky: Number(normalized.sticky || 0),
    cooldown: Number(normalized.cooldown || 0),
    delay: Number(normalized.delay || 0),
    ignore_budget: !!normalized.ignoreBudget,
  };
  return {
    uid: normalized.uid ?? index,
    key: Array.isArray(normalized.primaryKeys) ? normalized.primaryKeys : [],
    keysecondary: Array.isArray(normalized.secondaryKeys) ? normalized.secondaryKeys : [],
    comment: String(normalized.comment ?? normalized.title ?? ''),
    content: String(normalized.content || ''),
    constant: !!normalized.constant,
    selective: !!normalized.selective,
    selectiveLogic: normalizeWorldInfoLogic(normalized.selectiveLogic),
    order: Number(normalized.order ?? 100),
    position,
    depth: Number(normalized.depth ?? 4),
    role: worldInfoRoleValue(normalized.role),
    disable: normalized.enabled === false,
    addMemo: true,
    excludeRecursion: !!normalized.excludeRecursion,
    preventRecursion: !!normalized.preventRecursion,
    delayUntilRecursion: !!normalized.delayUntilRecursion,
    probability: Number(normalized.probability ?? 100),
    useProbability: normalized.useProbability !== false,
    ignoreBudget: !!normalized.ignoreBudget,
    group: normalized.group || '',
    groupOverride: !!normalized.groupOverride,
    groupWeight: Number(normalized.groupWeight ?? 100),
    vectorized: !!normalized.vectorized,
    triggers: Array.isArray(normalized.triggers) ? normalized.triggers : [],
    automationId: normalized.automationId || '',
    outletName: normalized.outletName || '',
    extensions: extension,
  };
}

async function exportCurrentLorebook() {
  const book = currentLB();
  if (!book) return alert('请先选择世界书');
  const bookSettings = normalizeLorebookSettings(book);
  const entries = {};
  currentLBEntries().forEach((entry, index) => { entries[String(entry.uid ?? index)] = serializeSTWorldInfoEntry(entry, index); });
  const payload = {
    name: String(book.name || '世界书'),
    entries,
    scan_depth: Number(bookSettings.scanDepth ?? prefs.wiScanDepth ?? 0),
    include_names: bookSettings.includeNames ?? (prefs.wiIncludeNames !== false),
    case_sensitive: bookSettings.caseSensitive ?? (prefs.wiCaseSensitive === true),
    match_whole_words: bookSettings.matchWholeWords ?? (prefs.wiWholeWord === true),
    recursive: bookSettings.recursive ?? (prefs.wiRecursive === true),
    max_recursion_steps: Number(bookSettings.maxRecursionSteps ?? prefs.wiMaxRecursionSteps ?? 0),
    min_activations: Number(bookSettings.minActivations ?? prefs.wiMinActivations ?? 0),
    min_activations_depth_max: Number(bookSettings.minActivationsDepthMax ?? prefs.wiMinActivationsDepthMax ?? 0),
    budget: Number(bookSettings.budget ?? prefs.wiBudget ?? 0),
    use_group_scoring: bookSettings.useGroupScoring ?? (prefs.wiUseGroupScoring === true),
    group_scoring: bookSettings.useGroupScoring ?? (prefs.wiUseGroupScoring === true),
    insertion_strategy: bookSettings.insertionStrategy || prefs.wiInsertionStrategy || 'evenly',
  };
  await downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), (book.name || 'worldbook').replace(/[\\/:*?"<>|]/g, '_') + '.world-info.json');
}

/* 世界书匹配：最近 N 条消息里找触发词（含正则），实现 ST 的选择性、递归、分组和定时效果。 */
function buildWorldInfo({ dryRun = false, withOutlets = false } = {}) {
  const char = currentChar();
  const sources = [];
  const worldLoreIds = worldModeActive()
    ? (Array.isArray(currentWorldCard()?.lorebookIds) && currentWorldCard().lorebookIds.length
      ? currentWorldCard().lorebookIds
      : ['default'])
    : (prefs.activeLoreId ? [prefs.activeLoreId] : []);
  for (const loreId of [...new Set(worldLoreIds)]) {
    const book = lorebooks && lorebooks[loreId];
    const entries = book ? lorebookEntriesForPrompt(book) : [];
    const bookSettings = normalizeLorebookSettings(book);
    if (entries.length) sources.push(...entries.map(entry => ({ ...entry, __worldId: loreId, __sourceType: 'global', __bookSettings: bookSettings })));
  }
  if (!worldModeActive() && char && char.loreId && lorebooks && lorebooks[char.loreId] && char.loreId !== prefs.activeLoreId) {
    const book = lorebooks[char.loreId];
    const bookSettings = normalizeLorebookSettings(book);
    sources.push(...lorebookEntriesForPrompt(book).map(entry => ({ ...entry, __worldId: char.loreId, __sourceType: 'character', __bookSettings: bookSettings })));
  }
  // V3 character_book 属于角色卡本身，只对绑定该角色的对话生效，不能并入全局世界书。
  const characterBook = characterBookForChar(char);
  // 如果用户选择了系统自动注册的角色书副本，就只注入副本，避免原书 + 副本重复。
  const registeredBookSelected = char?.characterBookLoreId && (char.loreId === char.characterBookLoreId || prefs.activeLoreId === char.characterBookLoreId);
  if (!worldModeActive() && characterBook && !registeredBookSelected) {
    const bookSettings = normalizeLorebookSettings(characterBook);
    sources.push(...normalizeCharacterBookEntries(characterBook).map(entry => ({ ...entry, __worldId: char?.id || 'character-book', __sourceType: 'character', __bookSettings: bookSettings })));
  }
  const defaultDepth = Math.max(0, prefs.wiScanDepth || 0);
  const allMessages = curMessages();
  const sourceSettings = sources.map(source => source.__bookSettings || {}).filter(Boolean);
  const bookRecursion = sourceSettings.some(settings => settings.recursive === true);
  const bookRecursionSteps = sourceSettings.map(settings => Number(settings.maxRecursionSteps)).filter(Number.isFinite);
  const bookMinActivations = sourceSettings.map(settings => Number(settings.minActivations)).filter(value => Number.isFinite(value) && value > 0);
  const bookMinDepths = sourceSettings.map(settings => Number(settings.minActivationsDepthMax)).filter(value => Number.isFinite(value) && value > 0);
  const bookBudgets = sourceSettings.map(settings => Number(settings.budget)).filter(value => Number.isFinite(value) && value > 0);
  const bookStrategies = sourceSettings.map(settings => settings.insertionStrategy).filter(strategy => ['evenly', 'character_first', 'global_first'].includes(strategy));
  const settings = {
    includeNames: prefs.wiIncludeNames !== false,
    minActivations: Math.max(Number(prefs.wiMinActivations) || 0, ...bookMinActivations),
    minActivationsDepthMax: Math.max(Number(prefs.wiMinActivationsDepthMax) || 0, ...bookMinDepths),
    recursive: (prefs.wiRecursive === true || bookRecursion) && !(Number(prefs.wiMinActivations) > 0 || bookMinActivations.length),
    maxRecursion: Math.min(8, Math.max(1, Math.max(Number(prefs.wiMaxRecursionSteps) || 3, ...bookRecursionSteps))),
    budget: Math.max(0, Number(prefs.wiBudget) || (bookBudgets.length ? Math.min(...bookBudgets) : 0)),
    groupScoring: prefs.wiUseGroupScoring === true || sourceSettings.some(book => book.useGroupScoring === true),
    insertionStrategy: bookStrategies[0] || prefs.wiInsertionStrategy || 'evenly',
  };
  const scanTextFor = (depth, extra = '', includeNames = settings.includeNames) => {
    const msgs = depth ? allMessages.slice(-depth) : [];
    const lines = msgs.map(m => (includeNames ? (m.role === 'user' ? '玩家：' : '角色：') : '') + m.content);
    return [lines.join('\n'), extra].filter(Boolean).join('\n');
  };
  const scope = activeConversationScope();
  const effects = dryRun ? { sticky: {}, cooldown: {} } : worldInfoScopeEffects(scope);
  const messageCount = allMessages.length;
  const entryKey = e => `${e.__worldId || 'world'}.${e.uid ?? e.id ?? e.title}`;
  const active = new Map();
  let recursionText = '';
  const chooseGroups = candidates => {
    const grouped = new Map();
    candidates.forEach(item => String(item.entry.group || '').split(',').map(x => x.trim()).filter(Boolean).forEach(group => {
      if (!grouped.has(group)) grouped.set(group, []);
      grouped.get(group).push(item);
    }));
    const keep = new Set(candidates);
    for (const group of grouped.values()) {
      if (group.length < 2) continue;
      const winner = group.some(item => item.entry.groupOverride)
        ? [...group].sort((a, b) => Number(b.entry.order || 0) - Number(a.entry.order || 0))[0]
        : settings.groupScoring || group.some(item => item.entry.useGroupScoring === true)
          ? [...group].sort((a, b) => b.score - a.score || Number(b.entry.order || 0) - Number(a.entry.order || 0))[0]
          : (() => {
            const total = group.reduce((sum, item) => sum + Math.max(0, Number(item.entry.groupWeight ?? 100)), 0);
            let roll = Math.random() * (total || 1);
            return group.find(item => (roll -= Math.max(0, Number(item.entry.groupWeight ?? 100))) <= 0) || group[0];
          })();
      group.forEach(item => { if (item !== winner) keep.delete(item); });
    }
    return candidates.filter(item => keep.has(item));
  };
  const evaluate = (level, extra, minActivationScan = false) => {
    const candidates = [];
    for (const e of sources) {
      const key = entryKey(e);
      if (active.has(key) || e.enabled === false) continue;
      if (level === 0 && e.delayUntilRecursion) continue;
      if (level > 0 && e.excludeRecursion) continue;
      const stickyUntil = Number(effects.sticky[key] || 0);
      const cooldownUntil = Number(effects.cooldown[key] || 0);
      if (stickyUntil && stickyUntil > messageCount) { candidates.push({ entry: e, score: 999 }); continue; }
      if (stickyUntil && stickyUntil <= messageCount && e.cooldown > 0 && !dryRun) {
        effects.cooldown[key] = stickyUntil + Number(e.cooldown);
        delete effects.sticky[key];
      }
      if (cooldownUntil && cooldownUntil > messageCount) continue;
      if (e.delay > 0 && messageCount < e.delay) continue;
      const extraSources = [];
      if (e.matchPersonaDescription) extraSources.push(currentUserPreset()?.persona);
      if (e.matchCharacterDescription) extraSources.push(char?.description);
      if (e.matchCharacterPersonality) extraSources.push(char?.personality);
      if (e.matchCharacterDepthPrompt) extraSources.push(char?.depthPrompt || char?.note);
      if (e.matchScenario) extraSources.push(char?.scenario);
      if (e.matchCreatorNotes) extraSources.push(char?.creatorNotes);
      const bookSettings = e.__bookSettings || {};
      const depth = minActivationScan
        ? (settings.minActivationsDepthMax || allMessages.length)
        : (Number.isInteger(e.scanDepth) ? e.scanDepth : (bookSettings.scanDepth ?? defaultDepth));
      const text = scanTextFor(depth, [extra, ...extraSources].filter(Boolean).join('\n'), bookSettings.includeNames ?? settings.includeNames);
      const stats = worldInfoMatchStats(e, text);
      const triggered = e.constant || stats.ok;
      if (!triggered) continue;
      if (!e.constant && !stats.ok) continue;
      if (e.useProbability !== false && Number(e.probability ?? 100) < 100 && Math.random() * 100 >= Number(e.probability)) continue;
      candidates.push({ entry: e, score: stats.score });
    }
    return chooseGroups(candidates);
  };
  const allHits = [];
  const maxLevel = settings.recursive ? settings.maxRecursion : 0;
  for (let level = 0; level <= maxLevel; level++) {
    let chosen = evaluate(level, recursionText);
    if (level === 0 && settings.minActivations > chosen.length && allMessages.length > defaultDepth) {
      // ST 的最少激活会扩大扫描窗口；这里保留同一套筛选/分组规则，避免另造一条激活管线。
      chosen = evaluate(level, recursionText, true);
    }
    if (!chosen.length) break;
    for (const item of chosen) {
      const e = item.entry;
      const key = entryKey(e);
      active.set(key, e);
      allHits.push(e);
      if (!dryRun) {
        if (e.sticky > 0) effects.sticky[key] = messageCount + Number(e.sticky);
        else if (e.cooldown > 0) effects.cooldown[key] = messageCount + Number(e.cooldown);
      }
      if (!e.preventRecursion && e.content) recursionText += '\n' + e.content;
    }
    if (!settings.recursive) break;
  }
  const positionOrder = [WORLD_INFO_POSITION.before, WORLD_INFO_POSITION.exampleTop, WORLD_INFO_POSITION.anTop,
    WORLD_INFO_POSITION.atDepth, WORLD_INFO_POSITION.after, WORLD_INFO_POSITION.exampleBottom, WORLD_INFO_POSITION.anBottom, WORLD_INFO_POSITION.outlet];
  const sourceRank = entry => entry.__sourceType === 'character' ? 0 : 1;
  allHits.sort((a, b) => (Number(b.constant) - Number(a.constant))
    || (positionOrder.indexOf(normalizeWorldInfoPosition(a.wiPosition ?? a.position)) - positionOrder.indexOf(normalizeWorldInfoPosition(b.wiPosition ?? b.position)))
    || (settings.insertionStrategy === 'character_first' || settings.insertionStrategy === 'global_first'
      ? ((settings.insertionStrategy === 'character_first' ? sourceRank(a) : sourceRank(b)) - (settings.insertionStrategy === 'character_first' ? sourceRank(b) : sourceRank(a))) : 0)
    || (Number(a.order || 0) - Number(b.order || 0)));
  let used = 0;
  const outlets = {};
  const entries = allHits.map(e => {
    const content = String(e.content || '').trim();
    if (!content) return '';
    if (normalizeWorldInfoPosition(e.wiPosition ?? e.position) === WORLD_INFO_POSITION.outlet) {
      const name = String(e.outletName || '').trim();
      if (!name) return '';
      if (settings.budget > 0 && !e.ignoreBudget && used + content.length > settings.budget) return '';
      if (name) (outlets[name] ||= []).push(content);
      used += content.length;
      return '';
    }
    if (settings.budget > 0 && !e.ignoreBudget && used + content.length > settings.budget) return '';
    used += content.length;
    return content;
  }).filter(Boolean);
  return withOutlets ? { entries, outlets: Object.fromEntries(Object.entries(outlets).map(([name, values]) => [name, values.join('\n\n')])) } : entries;
}

/* ─────────── 提示词构建管线（ST 风格素材库 + 顺序，运行时保持唯一 system） ─────────── */
function buildCharacterPromptParts(char) {
  if (!char) return { description: '', personality: '', scenario: '' };
  const lines = [];
  if (char.name?.trim()) lines.push('名字：' + char.name.trim());
  if (char.race?.trim()) lines.push('种族：' + char.race.trim());
  if (char.role?.trim()) lines.push('身份：' + char.role.trim());
  const description = char.description != null ? char.description : '';
  if (description.trim()) lines.push('描述：' + description.trim());
  const coreKeys = new Set(['name', 'race', 'role', 'persona', 'personality', 'scenario', 'firstMes', 'tags']);
  for (const field of normalizeCharProfileFields(char.profileFields)) {
    if (!coreKeys.has(field.key) && field.value) lines.push(field.label.trim() + '：' + field.value.trim());
  }
  if (mode === 'rpg' && char.systemPrompt?.trim()) lines.push('角色专属指令：' + char.systemPrompt.trim());
  return {
    description: lines.length ? '【角色描述】\n' + lines.join('\n') : '',
    personality: (char.personality != null ? char.personality : (char.description == null ? char.persona : ''))?.trim()
      ? '【角色性格】\n' + (char.personality != null ? char.personality : char.persona).trim() : '',
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

function tavernReplyOptionsConfig(preset = null) {
  const base = defaults?.tavern?.replyOptions;
  const override = preset?.replyOptions;
  if (!base && !override) {
    // 兼容旧版 server.js 返回的 seed：内置 RP 预设已经带有协议时，解析仍需启用选项。
    const instruction = mode === 'tavern' ? builtInTavernReplyOptionsInstruction() : '';
    return instruction ? { enabled: true, min: 4, max: 4, count: 4, instruction, noOptions: '（等待 AI 生成可选行动…）' } : null;
  }
  return {
    ...(base && typeof base === 'object' ? base : {}),
    ...(override && typeof override === 'object' ? override : {}),
  };
}

function tavernReplyOptionRules(preset = null) {
  const config = tavernReplyOptionsConfig(preset);
  if (!config || config.enabled === false) return { enabled: false, min: 0, max: 0, count: 0, noOptions: '' };
  const rawMin = Number(config.min);
  const rawMax = Number(config.max);
  const min = Number.isFinite(rawMin) ? Math.max(0, Math.min(8, Math.floor(rawMin))) : 4;
  const max = Number.isFinite(rawMax) ? Math.max(min, Math.min(8, Math.floor(rawMax))) : Math.max(min, 4);
  const rawCount = Number(config.count);
  const count = Number.isFinite(rawCount) ? Math.max(min, Math.min(max, Math.floor(rawCount))) : max;
  return { enabled: true, min, max, count, noOptions: String(config.noOptions || '（等待 AI 生成可选行动…）') };
}

function buildTavernReplyOptionsPrompt(preset = null) {
  if (mode !== 'tavern') return '';
  const config = tavernReplyOptionsConfig(preset);
  const rules = tavernReplyOptionRules(preset);
  const instruction = String(config?.instruction || '').trim();
  if (!rules.enabled || !instruction) return '';
  return formatTavernReplyOptionsInstruction(instruction, rules);
}

function formatTavernReplyOptionsInstruction(instruction, rules) {
  return String(instruction || '')
    .replace(/\{count\}/g, String(rules?.count ?? 4))
    .replace(/\{min\}/g, String(rules?.min ?? 4))
    .replace(/\{max\}/g, String(rules?.max ?? 4));
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
  const sections = parts.map((part, index) => ({
    part,
    index,
    text: typeof part === 'object' && part !== null ? String(part.text || '') : String(part || ''),
  }));
  const entries = sections.map(entry => ({ ...entry, priority: worldPromptPriority(entry.text) }))
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
  return sections.map(({ part, text, index }) => {
    const priority = worldPromptPriority(text);
    if (priority === null) return part;
    const clipped = kept.get(index) || '';
    return typeof part === 'object' && part !== null ? { ...part, text: clipped } : clipped;
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
    if (npcState.lastActivity) fields.push(`最近活动：${npcState.lastActivity}`);
    if (npcState.lastActionId) fields.push(`最近行动模板：${npcState.lastActionId}`);
    if (npcState.relation && Object.keys(npcState.relation).length) fields.push(`当前存档关系：${JSON.stringify(npcState.relation)}`);
    if (Array.isArray(npcState.knowledge) && npcState.knowledge.length) fields.push(`当前存档已知事实：${npcState.knowledge.join('；')}`);
    if (Array.isArray(npcState.status) && npcState.status.length) fields.push(`当前存档状态：${npcState.status.join('；')}`);
    const openingContext = Array.isArray(save.state?.openingScenario?.npcContexts)
      ? save.state.openingScenario.npcContexts.find(context => context?.npcId === id)
      : null;
    if (openingContext) fields.push(`开局上下文：${JSON.stringify({ relationship: openingContext.relationship || '', currentGoal: openingContext.currentGoal || '', currentState: openingContext.currentState || '', knowsPlayer: openingContext.knowsPlayer === true, playerKnowsTruth: openingContext.playerKnowsTruth === true })}`);
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
  const setting = world?.setting && typeof world.setting === 'object' ? Object.entries(world.setting).filter(([, value]) => typeof value === 'string' && value.trim()).map(([key, value]) => `${key}：${value.trim()}`).join('\n') : '';
  const rules = world?.rules && typeof world.rules === 'object' ? [
    Array.isArray(world.rules.hard) && world.rules.hard.length ? `硬规则：${world.rules.hard.join('；')}` : '',
    Array.isArray(world.rules.soft) && world.rules.soft.length ? `软规则：${world.rules.soft.join('；')}` : '',
    Array.isArray(world.rules.checks) && world.rules.checks.length ? `可用判定：${world.rules.checks.map(check => typeof check === 'string' ? check : `${check.id}${check.label ? `（${check.label}）` : ''}${check.roll ? ` ${check.roll}` : ''}${check.target !== undefined ? ` vs ${check.target}` : ''}`).join('；')}` : '',
  ].filter(Boolean).join('\n') : '';
  return `【世界事实分层】
稳定设定来源：WorldCard ${staticScope}。世界简介、登记地点、NPC 公共资料、派系定义、事件模板和规则属于稳定设定；不要因为某个存档的变化而改写它们。
${setting ? `世界观设定（只读）：\n${setting}\n` : ''}${rules ? `作者规则（只读；硬规则优先，软规则用于叙事取舍）：\n${rules}\n` : ''}
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
  return `【成长候选与人物经历】\n成长来源属于当前世界卡，候选记录只属于当前存档；来源=${sources || '无'}。可提议候选=${candidates || '无'}。当前待确认=${proposedText}。已确认人物经历=${experienceText}。当前 typed patch 只允许更新已存在的数值与目标，不要在状态更新块中创建或接受成长候选；成长候选将在专用回合协议中提交。`;
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

function buildWorldReopenPromptPart() {
  if (!worldModeActive()) return '';
  const info = currentWorldSave?.reopenInfo;
  if (!info) return '';
  const summary = info.sourceSummary && typeof info.sourceSummary === 'object' ? JSON.stringify(info.sourceSummary).slice(0, 12000) : '无可用总结';
  return `【世界线重开上下文】当前存档来自 ${info.sourceSaveId || '上一条世界线'}（${info.sourceStatus || 'reopen'}）。以下内容是只读的过去世界线记录，必须作为背景连续性参考，不得直接改写当前 state、结局或回合账本：${summary}`;
}

function buildRpgPromptSections() {
  if (mode !== 'rpg') return [];
  const sections = [];
  const pushSection = (id, text, source = 'runtime') => {
    if (text) sections.push({ id, source, text: String(text) });
  };
  const unshiftSection = (id, text, source = 'runtime') => {
    if (text) sections.unshift({ id, source, text: String(text) });
  };
  const rs = curRpgState();
  const agentProfile = buildRpgAgentProfile();
  const enabledAgentTools = Object.entries(agentProfile.tools)
    .filter(([, config]) => config.enabled !== false)
    .map(([name, config]) => `${name}（${config.execution || 'server'}）`);
  pushSection('agent.profile', `【Agent Runtime】protocol=${agentProfile.protocol} v${agentProfile.version}；mode=${agentProfile.mode}；maxSteps=${agentProfile.maxSteps}；可用工具=${enabledAgentTools.length ? enabledAgentTools.join('、') : '无'}。工具只能通过当前存档的服务端校验产生结果，不能跨 saveId 或直接写入未声明字段。多步骤行动先用 objective.upsert 提出可忽略的目标/线索计划，再提交实际状态候选；计划不是强制主线，玩家可以无视。`);
  if (rs) {
    if (worldModeActive()) pushSection('turn.commit-contract', `【结构化回合提交】当前 saveId=${currentWorldSave.id}，revision=${currentWorldSave.revision}。回复末尾的 <tavern_state_update> 必须原样使用 protocol=tavern.rpg.turn、version=1、baseRevision=${currentWorldSave.revision}；服务端会以此 revision 做原子提交。`);
    pushSection('save.rpg-state', '【RPG 状态】' + `等级 ${rs.level}（经验 ${rs.exp}/${rs.expNext}），HP ${rs.hp}/${rs.maxHp}，MP ${rs.mp}/${rs.maxMp}，金币 ${rs.gold}，当前位置：${rs.location}`
      + (rs.buffs?.length ? `，状态效果：${rs.buffs.join('、')}` : ''));
    pushSection('save.inventory', '【背包】' + (rs.inventory.length ? rs.inventory.map(i => `${i.name}×${i.count}${i.desc ? `（${i.desc}）` : ''}`).join('、') : '（空）'));
    if (worldModeActive()) {
      const economy = currentWorldCard()?.playerCreation?.economy;
      if (economy) {
        const rules = economy.inventory || {};
        const currencies = Array.isArray(economy.currencies) ? economy.currencies.map(currency => `${currency.id}=${rs.currencies?.[currency.id] ?? currency.initial ?? currency.min ?? 0}`).join('、') : '';
        const equipment = economy.equipment?.enabled !== false && Array.isArray(economy.equipment?.slots)
          ? economy.equipment.slots.map(slot => `${slot.id}=${rs.equipment?.[slot.id] || '空'}`).join('、') : '';
        pushSection('rules.economy', '【物品 / 装备 / 经济规则】' + [
          rules.enabled === false ? '背包关闭' : `背包 ${rs.inventory.length}/${rules.maxSlots || '∞'} 格`,
          rules.maxWeight === undefined || rules.maxWeight === null ? '' : `最大重量 ${rules.maxWeight}`,
          currencies ? `货币：${currencies}` : '',
          equipment ? `装备位：${equipment}` : '',
        ].filter(Boolean).join('；') + '。只能使用世界卡声明的物品、装备位和货币，不能突破格数、堆叠或重量限制。');
      }
      const runtime = currentWorldSave.state?.runtime;
      if (runtime) {
        pushSection('save.runtime', '【RPG GEN 3 运行态】\n' + JSON.stringify({
          schema: runtime.schema,
          variables: runtime.variables,
          collections: runtime.collections,
        }).slice(0, 50000) + '\n这是当前存档的独立 runtime 快照。只允许使用 Schema 声明的变量、集合和动作；状态更新必须使用 runtime.variable.set/delta、runtime.collection.add/remove 或 runtime.action.execute。');
      }
    }
    pushSection('save.quests', '【任务】' + (rs.quests.length ? rs.quests.map(x => `${x.title}${x.status === 'done' ? '（已完成）' : ''}`).join('、') : '（无）'));
    if (worldModeActive()) {
      const hooks = Array.isArray(currentWorldSave.state?.activeHooks) ? currentWorldSave.state.activeHooks : [];
      pushSection('save.active-hooks', '【开放 Hook】' + (hooks.length ? hooks.map(x => `${x.title || x.id}${x.status && !['active', 'open'].includes(x.status) ? `（${x.status}）` : ''}${x.optional ? '（可选）' : ''}`).join('、') : '（无）'));
    }
    pushSection('save.goals', '【目标】' + (rs.goals?.length ? rs.goals.map(x => `${x.title}${x.status && x.status !== 'active' ? `（${x.status}）` : ''}`).join('、') : '（无）'));
    pushSection('save.leads', '【线索】' + (rs.leads?.length ? rs.leads.map(x => `${x.title}${x.status && x.status !== 'active' ? `（${x.status}）` : ''}`).join('、') : '（无）'));
    const deadlineObjectives = worldModeActive()
      ? [...(currentWorldSave.state?.goals || []), ...(currentWorldSave.state?.leads || [])]
      : [...(rs.goals || []), ...(rs.leads || [])];
    const deadlineText = deadlineObjectives.filter(item => item?.deadline && item.status === 'active' && Number.isFinite(item.deadline.value) && item.deadline.unit).map(item => `${item.title || item.id} 截止 ${item.deadline.value} ${item.deadline.unit}`).join('；');
    if (deadlineText) pushSection('save.deadlines', '【目标 / 线索时限】' + deadlineText);
    const mapCtx = buildMapContext();
    if (mapCtx) pushSection('world.map', mapCtx);
  }
  if (worldModeActive()) {
    const world = currentWorldCard();
    if (world) {
      const factLayerPrompt = buildWorldFactLayerPromptPart();
      if (factLayerPrompt) pushSection('world.fact-layer', factLayerPrompt);
      const setupPrompt = buildWorldSetupPromptPart();
      if (setupPrompt) pushSection('save.setup', setupPrompt);
      const knowledgePrompt = buildWorldKnowledgePromptPart();
      if (knowledgePrompt) pushSection('knowledge.scope', knowledgePrompt);
      const worldTime = currentWorldSave.state?.time;
      if (worldTime) unshiftSection('world.time', `【世界时间】${worldTime.value} ${worldTime.unit}（每次正式回合由服务端推进，AI 不得直接篡改）`);
      unshiftSection('world.card', '【当前世界卡】\n' + [
        `世界：${world.title || world.id}（v${world.version || 1}）`,
        world.summary || '',
        '位置协议：state.locationId 与 NPC locationId 只能使用已登记的稳定 locationId；地点名称只用于叙事，不得写入状态。',
        world.locations?.length ? '已登记地点：' + world.locations.map(x => `${x.name || x.id}（id: ${x.id}；${x.type || '地点'}）`).join('、') : '',
        currentWorldSave.opening ? '开局：' + currentWorldSave.opening : '',
      ].filter(Boolean).join('\n'));
      const player = currentWorldSave.player?.snapshot;
      if (player) unshiftSection('save.player-snapshot', '【世界存档中的玩家快照】\n' + Object.entries(player).filter(([k, v]) => k !== 'profileFields' && v != null && String(v).trim()).map(([k, v]) => `${k}：${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n'));
      const dynamicPlayer = currentWorldSave.state?.player;
      if (dynamicPlayer) unshiftSection('save.player-state', '【当前玩家动态状态】\n' + ['attributes', 'skills', 'resources', 'traits', 'relations', 'identity', 'effects'].filter(key => dynamicPlayer[key] !== undefined).map(key => `${key}：${JSON.stringify(dynamicPlayer[key])}`).join('\n'));
      const derivedValues = evaluateWorldDerivedValues(world.playerCreation, dynamicPlayer);
      if (derivedValues.length) unshiftSection('save.derived-values', '【当前玩家只读派生值】\n' + derivedValues.map(item => `${item.id}: ${item.value === null ? 'N/A' : item.value}`).join('\n') + '\n这些值由属性/技能/资源实时计算，仅供阅读，禁止写回 ```rpg``` 状态块。');
      const optionRules = worldOptionRules();
      pushSection('turn.options-contract', `【回合契约】行动选项数量 ${optionRules.min}-${optionRules.max}；自由文本输入始终可用。AI 不得替玩家补写未表达的核心意图、台词或不可逆行动。`);
      pushSection('turn.side-effects', '【副作用边界】Markdown 叙事、NPC 台词、行动选项和普通文本中的骰子表达式都只是文本，不会自动执行骰子或改写状态；只有协议中通过服务端校验的结构化更新才可产生状态变化。');
      pushSection('turn.tool-candidates', agentProfile.mode === 'native'
        ? '【Agent 原生工具】本回合可按工具 Schema 调用已启用的 Agent 工具；工具调用会在当前请求内最多循环 maxSteps 次。dice.roll 由客户端生成并绑定到本回合 actionIntent，服务端只校验结果，不能自行掷骰；context.retrieve 只能读取当前存档作用域；state.patch、entity.create、memory.record 先形成候选，最终仍须通过服务端 Typed Patch、实体和记忆校验。RPG GEN 3 的变量、集合和声明式动作只能通过 state.patch 的 runtime.* 更新，不能写任意路径。目标 / 线索只能通过 objective.upsert(kind=goals|leads) 创建或更新，不能直接写入其他数组。最后必须返回叙事正文与唯一 <tavern_state_update>，并提供回合契约要求的行动选项。'
        : '【Agent 工具候选（兼容层）】当前模型不支持原生 function calling 时，仍可在唯一 <tavern_state_update> JSON 的 toolCalls 数组中声明 dice.roll、rules.check、state.patch、objective.upsert、entity.create、memory.record、context.retrieve。客户端会执行只读 / 客户端工具，把结构化 tool_result 回传后再次请求你；收到 tool_result 后必须继续当前回合，最终再输出叙事与唯一状态块。只有 rules.check 通过后才允许 dice.roll；不得重复已经成功的骰子。state.patch 可提交 runtime.variable.set/delta、runtime.collection.add/remove、runtime.action.execute，但仍须通过服务端 Typed Patch 校验。');
      const npcPrompt = buildWorldNpcPromptPart();
      if (npcPrompt) pushSection('world.npcs', npcPrompt);
      const factionPrompt = buildWorldFactionPromptPart();
      if (factionPrompt) pushSection('world.factions', factionPrompt);
      const eventPrompt = buildWorldEventPromptPart();
      if (eventPrompt) pushSection('world.events', eventPrompt);
      const eventMemoryPrompt = buildWorldEventMemoryPromptPart();
      if (eventMemoryPrompt) pushSection('memory.event-candidates', eventMemoryPrompt);
      const conflictPrompt = buildWorldConflictPromptPart();
      if (conflictPrompt) pushSection('rules.conflict', conflictPrompt);
      const failurePrompt = buildWorldFailurePromptPart();
      if (failurePrompt) pushSection('rules.failure', failurePrompt);
      const endingPrompt = buildWorldEndingPromptPart();
      if (endingPrompt) pushSection('rules.ending', endingPrompt);
      const reopenPrompt = buildWorldReopenPromptPart();
      if (reopenPrompt) pushSection('world.reopen', reopenPrompt);
      const growthPrompt = buildWorldGrowthPromptPart();
      if (growthPrompt) pushSection('save.growth', growthPrompt);
    }
  }
  if (worldModeActive()) {
    const budgeted = budgetWorldPromptParts(sections);
    sections.length = 0;
    sections.push(...budgeted);
  }
  if (defaults?.rpg?.diceInstruction) pushSection('turn.dice-contract', defaults.rpg.diceInstruction, 'preset');
  pushSection('output.protocol', (defaults?.rpg?.stateInstruction) || '每次回复末尾输出唯一的 <tavern_state_update> JSON 状态更新块。', 'preset');
  if (defaults?.rpg?.eventMemoryInstruction) pushSection('output.event-memory', defaults.rpg.eventMemoryInstruction, 'preset');
  return sections;
}

function buildRpgPromptPart() {
  return buildRpgPromptSections().map(section => section.text).join('\n\n');
}

function expandPresetMacros(text, macroContext, variables) {
  let output = String(text || '').replace(/\{\{\/\/[\s\S]*?\}\}/g, '');
  output = output.replace(/\{\{setvar::([^}:]+)::([\s\S]*?)\}\}/g, (_, key, value) => {
    variables[key.trim()] = value;
    return '';
  });
  output = output.replace(/\{\{setglobalvar::([^}:]+)::([\s\S]*?)\}\}/gi, (_, key, value) => {
    // ST 的全局变量在本项目中降级为本次请求变量，避免预设静默改写存档/用户数据。
    variables[key.trim()] = value;
    return '';
  });
  output = output.replace(/\{\{(?:getvar|getglobalvar)::([^}]+)\}\}/gi, (_, key) => variables[key.trim()] ?? '');
  output = output.replace(/\{\{outlet::([^}]+)\}\}/gi, (_, name) => macroContext.outlets?.[String(name).trim()] || '');
  output = output.replace(/\{\{(user|char|persona|description|personality|scenario|mesExamplesRaw|mesExamples|lastMessage|lastUserMessage|lastCharMessage|messageCount|group|charIfNotGroup)\}\}/gi, (_, key) => {
    const actualKey = Object.keys(macroContext).find(name => name.toLowerCase() === String(key).toLowerCase()) || key;
    return macroContext[actualKey] ?? '';
  });
  output = output.replace(/\{\{(newline|space|noop)\}\}/gi, (_, key) => key.toLowerCase() === 'newline' ? '\n' : (key.toLowerCase() === 'space' ? ' ' : ''));
  output = output.replace(/\{\{(?:random|pick)::([\s\S]*?)\}\}/gi, (_, values) => {
    const options = String(values).split(/::|[|,，]/).map(value => value.trim()).filter(Boolean);
    return options.length ? options[Math.floor(Math.random() * options.length)] : '';
  });
  return output.replace(/\{\{trim\}\}/gi, '').trim();
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
  const wiResult = buildWorldInfo({ withOutlets: true });
  const wi = wiResult.entries;
  const charParts = worldModeActive() ? { description: '', personality: '', scenario: '' } : buildCharacterPromptParts(promptChar);
  const userPart = worldModeActive() ? '' : buildUserPromptPart();
  const rpgSections = buildRpgPromptSections();
  const macroMessages = (worldModeActive() ? worldTimelineMessages() : curMessages())
    .filter(message => message && (message.role === 'user' || message.role === 'assistant'));
  const lastMacroMessage = macroMessages.at(-1)?.content || '';
  const lastMacroUserMessage = [...macroMessages].reverse().find(message => message.role === 'user')?.content || '';
  const lastMacroCharMessage = [...macroMessages].reverse().find(message => message.role === 'assistant')?.content || '';
  const runtime = {
    worldInfoBefore: wi.length ? '【世界设定】\n' + wi.join('\n\n') : '',
    worldInfoAfter: '',
    personaDescription: userPart,
    charDescription: charParts.description,
    charPersonality: charParts.personality,
    scenario: charParts.scenario,
    tavernMemory: buildMemoryPromptPart(),
    tavernFormat: buildFormatPromptPart(),
    tavernRpg: rpgSections.map(section => section.text).join('\n\n'),
    tavernRpgSections: rpgSections,
    outlets: wiResult.outlets,
    dialogueExamples: promptChar?.mesExample || promptChar?.mes_example || '',
  };
  const macroContext = {
    user: currentUserPreset()?.name || '玩家',
    char: worldModeActive() ? (currentWorldCard()?.title || '世界') : (promptChar?.name || '角色'),
    persona: currentUserPreset()?.persona || '',
    description: charParts.description,
    personality: promptChar?.personality != null ? promptChar.personality : (promptChar?.description == null ? (promptChar?.persona || '') : ''),
    scenario: promptChar?.scenario || '',
    mesExamples: promptChar?.mesExample || promptChar?.mes_example || '',
    mesExamplesRaw: promptChar?.mesExample || promptChar?.mes_example || '',
    lastMessage: lastMacroMessage,
    lastUserMessage: lastMacroUserMessage,
    lastCharMessage: lastMacroCharMessage,
    messageCount: String(macroMessages.length),
    outlets: wiResult.outlets,
    group: '',
    charIfNotGroup: worldModeActive() ? (currentWorldCard()?.title || '世界') : (promptChar?.name || '角色'),
  };
  const variables = {};
  const promptMap = new Map(preset.prompts.map(p => [p.identifier, p]));
  const systemParts = [];
  const beforeHistory = [];
  const afterHistory = [];
  const injections = [];
  let worldInfoInjected = false;
  const charPostHistory = String(promptChar?.postHistory || '').trim();
  const presetPostHistory = String(preset.postHistory || '').trim();
  const hasStandalonePostHistory = !!(charPostHistory || presetPostHistory);
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
    if (prompt.identifier === 'jailbreak') {
      // 新版后预设独立于提示词顺序；有独立字段时跳过旧 jailbreak 固定槽位，避免重复注入。
      if (hasStandalonePostHistory) continue;
      content = prompt.content || settings.postHistory || '';
    }
    content = expandPresetMacros(content, macroContext, variables);
    if (!content) continue;
    if (prompt.position === 'in_chat' && !prompt.marker) {
      if (prompt.role === 'system') systemParts.push(`【历史深度 ${prompt.depth} 的 System 指令】\n${content}`);
      else injections.push({ role: prompt.role, content, depth: prompt.depth, order: prompt.order });
    } else if (prompt.role === 'system' || prompt.marker) {
      if (prompt.marker && (prompt.identifier === 'worldInfoBefore' || prompt.identifier === 'worldInfoAfter') && wi.length) {
        worldInfoInjected = true;
      }
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
  const standalonePost = [];
  if (charPostHistory) standalonePost.push(expandPresetMacros(charPostHistory, macroContext, variables));
  if (presetPostHistory) standalonePost.push(expandPresetMacros(presetPostHistory, macroContext, variables));
  const optionPrompt = hasTavernReplyOptionsProtocol(presetPostHistory)
    ? ''
    : buildTavernReplyOptionsPrompt(preset);
  if (optionPrompt) standalonePost.push(expandPresetMacros(optionPrompt, macroContext, variables));
  return { system: systemParts.join('\n\n'), wi, history: [...beforeHistory, ...history, ...afterHistory], post: standalonePost.filter(Boolean).join('\n\n'), worldInfoInSystem: worldInfoInjected, recentContext, rpgSections };
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
  const { system, wi, history, post, worldInfoInSystem, rpgSections } = buildPromptBlocks();
  const agentProfile = mode === 'rpg' ? buildRpgAgentProfile() : null;
  // 唯一 system 消息：身份 + 角色卡 + 模块 + 格式 + 世界设定 + 后预设 合并为一条，
  // 避免多条 system 穿插在 user/assistant 之间导致模型混淆 role 边界（DeepSeek/本地模型尤其敏感）
  const sysParts = [];
  if (system && system.trim()) sysParts.push(system);
  if (!worldInfoInSystem && wi && wi.length) sysParts.push('【世界设定】\n' + wi.join('\n\n'));
  if (post && post.trim()) sysParts.push('【后预设 / Post-History】\n' + post);
  body.messages = [];
  if (sysParts.length) body.messages.push({ role: 'system', content: sysParts.join('\n\n') });
  body.messages.push(...history);
  const nativeTools = mode === 'rpg' ? buildRpgNativeToolDefinitions(agentProfile) : [];
  if (nativeTools.length && agentProfile?.mode === 'native') {
    body.tools = nativeTools;
    body.tool_choice = 'auto';
  }
  return { baseUrl: s.baseUrl, apiKey: s.apiKey, body, wi, promptSections: rpgSections || [], agentProfile, nativeTools };
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

function mergeNativeToolCall(toolCalls, delta) {
  if (!delta || typeof delta !== 'object') return;
  const index = Number.isInteger(delta.index) ? delta.index : toolCalls.length;
  const current = toolCalls[index] || { index, id: '', type: 'function', function: { name: '', arguments: '' } };
  if (delta.id && !current.id) current.id = String(delta.id);
  if (delta.type) current.type = String(delta.type);
  const fn = delta.function;
  if (fn && typeof fn === 'object') {
    if (fn.name) current.function.name += String(fn.name);
    if (fn.arguments) current.function.arguments += String(fn.arguments);
  }
  toolCalls[index] = current;
}

function normalizeNativeToolCalls(message) {
  const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  return calls.map((call, index) => ({
    index,
    callId: String(call?.id || `tool-${index + 1}`),
    name: normalizeRpgAgentToolName(call?.function?.name || ''),
    rawArguments: String(call?.function?.arguments || ''),
    rawCall: cloneValue(call),
  })).filter(call => call.name);
}

function parseNativeToolArguments(call) {
  try {
    const args = JSON.parse(call.rawArguments || '{}');
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数必须是 JSON 对象');
    return { ...call, arguments: args };
  } catch (error) {
    return { ...call, arguments: null, error: `工具 ${call.name || call.callId} 参数 JSON 无效：${error.message}` };
  }
}

function retrieveRpgAgentContext(query, scope = 'known', limit = 6, snapshot = null) {
  if (!snapshot && !worldModeActive()) return { scope, matches: [] };
  const world = snapshot?.world || currentWorldCard() || {};
  const save = snapshot?.save || currentWorldSave;
  if (!save) return { scope, matches: [] };
  const state = save.state || {};
  const wanted = String(query || '').trim().toLowerCase();
  const docs = [];
  const add = (id, text, docScope) => {
    if (!text) return;
    if (scope === 'world' && docScope !== 'world') return;
    if (scope === 'public' && docScope !== 'public') return;
    if (scope === 'known' && !['public', 'known', 'character'].includes(docScope)) return;
    if (scope === 'character' && docScope !== 'character') return;
    if (scope === 'hidden' && docScope !== 'hidden') return;
    docs.push({ id, scope: docScope, text: String(text).slice(0, 1800) });
  };
  add('world.setting', Object.entries(world.setting && typeof world.setting === 'object' ? world.setting : {}).map(([key, value]) => `${key}：${value}`).join('\n'), 'world');
  const locations = Array.isArray(world.locations) ? world.locations : [];
  locations.forEach(item => add(`location:${item.id}`, `${item.name || item.id}：${item.summary || item.description || ''}`, 'public'));
  const npcs = Array.isArray(world.npcs) ? world.npcs : [];
  npcs.forEach(item => add(`npc:${item.id}`, `${item.name || item.id}：${item.description || item.persona || ''}`, 'public'));
  const info = state.knownInformation && typeof state.knownInformation === 'object' ? state.knownInformation : {};
  (Array.isArray(info.worldTruth) ? info.worldTruth : []).forEach((item, index) => add(`fact:world:${index}`, item, 'world'));
  (Array.isArray(info.characterKnowledge) ? info.characterKnowledge : []).forEach((item, index) => add(`fact:character:${index}`, item, 'character'));
  (Array.isArray(info.playerVisible) ? info.playerVisible : []).forEach((item, index) => add(`fact:public:${index}`, item, 'public'));
  (Array.isArray(info.rumors) ? info.rumors : []).forEach((item, index) => add(`fact:rumor:${index}`, item, 'known'));
  (Array.isArray(info.hidden) ? info.hidden : []).forEach((item, index) => add(`fact:hidden:${index}`, item, 'hidden'));
  const ranked = docs.map((doc, index) => ({ doc, index, score: wanted ? wanted.split(/\s+/).filter(Boolean).reduce((score, token) => score + (doc.text.toLowerCase().includes(token) ? 1 : 0), 0) : 0 }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(1, Math.min(12, Number(limit) || 6)));
  return { scope, query: wanted, matches: ranked.map(({ doc, score }) => ({ ...doc, score })) };
}

async function executeRpgNativeToolCalls(calls, profile, targetScope, snapshot = null, gate = {}) {
  const trace = [];
  const accepted = [];
  gate.checkApproved = gate.checkApproved === true;
  gate.diceUses = Number.isInteger(gate.diceUses) ? gate.diceUses : 0;
  const declaredRules = new Set();
  const world = snapshot?.world;
  const addRule = value => {
    const id = typeof value === 'string' ? value.trim() : value && typeof value === 'object' ? (value.id || value.ruleId || value.name || '') : '';
    if (id) declaredRules.add(String(id));
  };
  const configuredRules = world?.rules?.checks || world?.checks;
  if (typeof configuredRules === 'string') addRule(configuredRules);
  else if (Array.isArray(configuredRules)) configuredRules.forEach(addRule);
  else if (configuredRules && typeof configuredRules === 'object') Object.entries(configuredRules).forEach(([id, definition]) => { addRule(id); addRule(definition); });
  const activeTemplates = new Set(Object.values(snapshot?.save?.state?.conflicts || {}).filter(item => item?.status === 'active').map(item => item.templateId).filter(Boolean));
  (Array.isArray(world?.conflicts) ? world.conflicts : []).filter(definition => activeTemplates.has(definition.id)).forEach(definition => {
    (Array.isArray(definition.actions) ? definition.actions : []).filter(action => action?.check).forEach(action => {
      addRule(action.id);
      addRule(`${definition.id}.${action.id}`);
    });
  });
  // 模型可能在同一批 tool_calls 中同时声明判定和骰子，先识别有效门控，避免调用顺序造成误拒绝。
  if (Array.isArray(calls) && calls.some(call => call?.name === 'rules.check'
    && profile?.tools?.['rules.check']?.enabled !== false
    && declaredRules.has(String(call.arguments?.ruleId || '').trim()))) gate.checkApproved = true;
  for (const call of Array.isArray(calls) ? calls : []) {
    const config = profile?.tools?.[call.name];
    if (!RPG_NATIVE_TOOL_NAMES.has(call.name) || !config || config.enabled === false) {
      trace.push({ callId: call.callId, name: call.name, phase: rpgAgentToolPhase(call.name), result: { ok: false, error: '工具未在当前 RPG 配置中启用' } });
      continue;
    }
    if (call.error || !call.arguments) {
      trace.push({ callId: call.callId, name: call.name, phase: rpgAgentToolPhase(call.name), result: { ok: false, error: call.error || '参数无效' } });
      continue;
    }
    let result;
    try {
      if (call.name === 'dice.roll') {
        const expr = String(call.arguments.expr || '').trim();
        if (!expr || expr.length > 80) throw new Error('expr 为空或过长');
        if (!gate.checkApproved) {
          result = { ok: false, error: '必须先调用 rules.check；没有真实判定时禁止掷骰' };
        } else if (gate.diceUses >= 4) {
          result = { ok: false, error: '本次判定最多允许 4 次骰子调用' };
        } else {
          const rolls = await rollWorldDice(expr);
          if (!rolls.length) throw new Error('expr 不是受支持的骰子表达式');
          result = { ok: true, rolls };
          gate.diceUses += 1;
        }
      } else if (call.name === 'context.retrieve') {
        result = { ok: true, ...retrieveRpgAgentContext(call.arguments.query, call.arguments.scope, call.arguments.limit, snapshot) };
      } else if (call.name === 'rules.check') {
        const ruleId = String(call.arguments.ruleId || '').trim();
        if (!ruleId || ruleId.length > 120) throw new Error('ruleId 为空或过长');
        if (!world || !declaredRules.has(ruleId)) throw new Error('ruleId 未在当前世界规则或进行中的冲突中声明');
        gate.checkApproved = true;
        result = { ok: true, kind: 'rules.check', ruleId, requiresRoll: true, instruction: '仅本次行动允许掷骰；请根据结果在叙事中分支并说明后果。' };
      } else {
        // Typed patch / entity / memory remain candidates until final narrative
        // submit, so native tools cannot mutate state during the model loop.
        result = { ok: true, accepted: 'candidate', name: call.name, arguments: call.arguments };
      }
      if (result?.ok) accepted.push({ callId: call.callId, name: call.name, arguments: call.arguments });
    } catch (error) {
      result = { ok: false, error: error.message };
    }
    trace.push({ callId: call.callId, name: call.name, phase: rpgAgentToolPhase(call.name), result });
  }
  if (targetScope && trace.length) setDebugTrace(targetScope, { agentToolTrace: trace });
  return { trace, accepted };
}

function rpgAgentToolPhase(name) {
  if (name === 'context.retrieve') return 'observe';
  if (name === 'rules.check' || name === 'dice.roll') return 'guard';
  return 'decide';
}
function buildRpgAgentPhaseHistory(trace, currentPhase = null) {
  const phases = [];
  for (const item of Array.isArray(trace) ? trace : []) {
    const phase = item?.phase || rpgAgentToolPhase(item?.name);
    if (phase && !phases.includes(phase)) phases.push(phase);
  }
  if (currentPhase && !phases.includes(currentPhase)) phases.push(currentPhase);
  return phases.map((phase, index) => ({ phase, status: 'completed', order: index + 1 }));
}
function nativeCandidatesToRpgData(calls, baseRevision) {
  const list = Array.isArray(calls) ? calls : [];
  const patchCalls = list.filter(call => call?.name === 'state.patch' && Array.isArray(call.arguments?.updates));
  const objectiveCalls = list.filter(call => call?.name === 'objective.upsert' && call.arguments?.kind && call.arguments?.id && call.arguments?.title);
  const patch = patchCalls.length || objectiveCalls.length ? normalizeRpgPatch({
    protocol: 'tavern.rpg.turn',
    version: 1,
    baseRevision,
    updates: [
      ...patchCalls.flatMap(call => call.arguments.updates),
      ...objectiveCalls.map(call => ({ type: 'objective.upsert', ...cloneValue(call.arguments) })),
    ].slice(0, 32),
  }) : null;
  const createEntities = list.filter(call => call?.name === 'entity.create' && call.arguments?.name)
    .map(call => {
      const kind = ['npc', 'item', 'quest', 'location'].includes(call.arguments.type) ? call.arguments.type : 'npc';
      return { ...cloneValue(call.arguments), kind, tempId: call.arguments.tempId || call.callId };
    }).slice(0, 32);
  const eventMemory = list.filter(call => call?.name === 'memory.record' && call.arguments?.summary)
    .map(call => cloneValue(call.arguments)).slice(0, 8);
  return { patch, createEntities: createEntities.length ? createEntities : null, eventMemory: eventMemory.length ? eventMemory : null };
}

async function requestRpgAgentReply(payload, targetScope) {
  const profile = payload.agentProfile;
  const nativeTools = Array.isArray(payload.nativeTools) ? payload.nativeTools : [];
  if (profile && profile.mode !== 'native' && nativeTools.length) {
    return requestRpgCompatReply(payload, targetScope);
  }
  if (!profile || profile.mode !== 'native' || !nativeTools.length) {
    if (payload.body.stream) {
      const stream = await callAPIStream(payload);
      return { reply: stream.content, cot: stream.cot, nativeCalls: stream.toolCalls || [], toolTrace: [] };
    }
    const data = await callAPI(payload);
    const message = data?.choices?.[0]?.message || {};
    return { reply: message.content || '', cot: message.reasoning_content || '', nativeCalls: normalizeNativeToolCalls(message).map(parseNativeToolArguments), toolTrace: [] };
  }
  const messages = payload.body.messages.map(message => cloneValue(message));
  const snapshot = worldModeActive() && currentWorldSave
    ? { world: cloneValue(currentWorldCard()), save: cloneValue(currentWorldSave) }
    : null;
  const maxSteps = Math.max(1, Math.min(8, Number(profile.maxSteps) || 1));
  const accepted = [];
  const toolTrace = [];
  const diceGate = {};
  let cot = '';
  for (let step = 0; step <= maxSteps; step++) {
    const request = { ...payload, body: { ...payload.body, messages } };
    let response;
    if (request.body.stream) {
      const stream = await callAPIStream(request);
      response = { content: stream.content, cot: stream.cot, calls: stream.toolCalls || [] };
    } else {
      const data = await callAPI(request);
      const message = data?.choices?.[0]?.message || {};
      response = { content: message.content || '', cot: message.reasoning_content || '', calls: normalizeNativeToolCalls(message).map(parseNativeToolArguments), rawMessage: message };
    }
    cot += response.cot || '';
    if (!response.calls.length) return { reply: response.content, cot, nativeCalls: accepted, toolTrace };
    if (step >= maxSteps) throw new Error(`Agent 工具调用超过 maxSteps=${maxSteps}`);
    const rawCalls = response.calls.map(call => call.rawCall || { id: call.callId, type: 'function', function: { name: call.name, arguments: call.rawArguments } });
    messages.push({ role: 'assistant', content: response.content || null, tool_calls: rawCalls });
    const executed = await executeRpgNativeToolCalls(response.calls, profile, targetScope, snapshot, diceGate);
    accepted.push(...executed.accepted);
    toolTrace.push(...executed.trace.map(item => ({ ...item, step: step + 1 })));
    for (const item of executed.trace) {
      messages.push({ role: 'tool', tool_call_id: item.callId, content: JSON.stringify(item.result) });
    }
  }
  throw new Error('Agent 未返回最终叙事');
}

function normalizeCompatToolCalls(calls, step = 0) {
  return (Array.isArray(calls) ? calls : []).map((call, index) => {
    const name = normalizeRpgAgentToolName(call?.name || call?.tool || '');
    const args = call?.arguments && typeof call.arguments === 'object' && !Array.isArray(call.arguments) ? call.arguments : null;
    let serialized = '';
    try { serialized = args ? JSON.stringify(args) : ''; } catch { serialized = ''; }
    const argsError = args && serialized.length <= 4000 ? null : '兼容 Agent 工具参数必须是 JSON 对象且不超过 4000 字符';
    return {
      callId: String(call?.callId || call?.id || `compat-${step + 1}-${index + 1}`),
      name,
      arguments: args,
      rawArguments: serialized,
      ...(argsError ? { error: argsError } : {}),
    };
  }).filter(call => call.name);
}

function buildCompatToolResultMessage(trace, step) {
  const results = (Array.isArray(trace) ? trace : []).map(item => ({
    callId: item.callId,
    name: item.name,
    result: item.result,
  }));
  return [
    '【tavern.rpg.agent.tool_result】',
    `step=${Number(step) || 1}`,
    JSON.stringify(results),
    '以上是本回合工具执行结果，不是新的玩家输入。请继续当前回合；如仍需工具，请只在唯一状态更新块的 toolCalls 数组中声明；否则直接输出最终叙事正文与唯一状态更新块。不得重复执行已经返回成功的骰子。',
  ].join('\n');
}

/*
 * 兼容不支持原生 function calling 的模型：用现有 toolCalls 控制块模拟
 * assistant → tool → assistant 循环。工具仍走同一执行器，写入仍延迟到
 * agent-execute / narrate，不在这里直接修改 WorldSave。
 */
async function requestRpgCompatReply(payload, targetScope) {
  const profile = payload.agentProfile;
  const messages = payload.body.messages.map(message => cloneValue(message));
  const snapshot = worldModeActive() && currentWorldSave
    ? { world: cloneValue(currentWorldCard()), save: cloneValue(currentWorldSave) }
    : null;
  const maxSteps = Math.max(1, Math.min(8, Number(profile?.maxSteps) || 1));
  const accepted = [];
  const toolTrace = [];
  const diceGate = {};
  let cot = '';
  for (let step = 0; step <= maxSteps; step++) {
    const request = { ...payload, body: { ...payload.body, messages } };
    delete request.body.tools;
    delete request.body.tool_choice;
    let response;
    if (request.body.stream) {
      const stream = await callAPIStream(request);
      response = { content: stream.content, cot: stream.cot, calls: normalizeCompatToolCalls(processAIOutput(stream.content).agentCalls, step) };
    } else {
      const data = await callAPI(request);
      const message = data?.choices?.[0]?.message || {};
      const content = message.content || '';
      response = { content, cot: message.reasoning_content || '', calls: normalizeCompatToolCalls(processAIOutput(content).agentCalls, step) };
    }
    cot += response.cot || '';
    if (!response.calls.length) return { reply: response.content, cot, nativeCalls: accepted, toolTrace };
    if (step >= maxSteps) throw new Error(`兼容 Agent 工具调用超过 maxSteps=${maxSteps}`);
    const executed = await executeRpgNativeToolCalls(response.calls, profile, targetScope, snapshot, diceGate);
    accepted.push(...executed.accepted);
    toolTrace.push(...executed.trace.map(item => ({ ...item, step: step + 1, mode: 'compat' })));
    messages.push({ role: 'assistant', content: response.content || '' });
    messages.push({ role: 'user', content: buildCompatToolResultMessage(executed.trace, step + 1) });
  }
  throw new Error('兼容 Agent 未返回最终叙事');
}

/*
 * 模型已经完成叙事、但末尾控制块不合规时，只请求一次“协议修复”。
 * 仍复用原 system（含世界书 / 状态 / 输出守则），不在前端臆造 options，
 * 也不把修复结果直接写入存档；最终仍走同一套服务端 Typed Patch 校验。
 */
async function repairRpgOutput(payload, reply, optionRules, targetScope, toolTrace = [], validationError = '') {
  const body = {
    ...payload.body,
    stream: false,
    messages: [
      ...(Array.isArray(payload.body?.messages) ? payload.body.messages.map(cloneValue) : []),
      { role: 'assistant', content: String(reply || '') },
      { role: 'user', content: `上一条回复未通过 RPG 输出协议校验：必须在末尾输出唯一 <tavern_state_update> JSON 标签，且 options 必须有 ${optionRules.min}-${optionRules.max} 个。${validationError ? `具体结构错误：${validationError}。` : ''}请保留已经发生的叙事，不要新增未发生的状态变化，只修复并完整重发合规的叙事正文与控制块。每个 updates 对象只能包含协议声明的字段；runtime.action.execute 只能写 type、actionId 和可选的 input，input 也只能包含动作 Schema 声明的字段，禁止写 result、args、value、execute、target 或其他解释字段。不要解释修复过程，不要输出额外代码块。` },
    ],
  };
  delete body.tools;
  delete body.tool_choice;
  const diceResults = toolTrace.filter(item => item?.name === 'dice.roll' && Array.isArray(item.result?.rolls))
    .flatMap(item => item.result.rolls).map(roll => `${roll.expr}=${roll.total}`).join('、');
  if (diceResults && body.messages.length) body.messages[body.messages.length - 1].content += ` 本回合已完成客户端判定：${diceResults}。修复时必须让该结果在叙事中产生明确后果，不得重新掷骰。`;
  const data = await callAPI({ ...payload, body });
  const message = data?.choices?.[0]?.message || {};
  const repaired = String(message.content || '').trim();
  if (!repaired) throw new Error('AI 协议修复没有返回内容');
  setDebugTrace(targetScope, { status: '协议修复已收到', output: repaired });
  return repaired;
}

function tavernReplyNeedsOptionRepair(processed, preset = null) {
  const rules = tavernReplyOptionRules(preset);
  if (!rules.enabled) return false;
  const options = Array.isArray(processed?.options) ? processed.options : [];
  return !!processed?.protocol?.errorCode || options.length < rules.min || options.length > rules.max;
}

/* Tavern 模式只修复一次缺失的选项标签，正文仍以模型输出为准，不在客户端臆造行动。 */
async function repairTavernReplyOptions(payload, reply, preset, targetScope) {
  const protocol = buildTavernReplyOptionsPrompt(preset) || '请在正文末尾追加唯一 <tavern_options>["行动 1","行动 2","行动 3","行动 4"]</tavern_options> 标签。';
  const body = {
    ...payload.body,
    stream: false,
    messages: [
      ...(Array.isArray(payload.body?.messages) ? payload.body.messages.map(cloneValue) : []),
      { role: 'assistant', content: String(reply || '') },
      { role: 'user', content: `上一条酒馆回复缺少合规的行动选项标签。请保留已经写出的故事正文与剧情事实，只在正文末尾补齐唯一的结构化标签；不要解释修复过程，不要输出代码围栏，不要替玩家补写台词、思想或行动。${protocol}` },
    ],
  };
  delete body.tools;
  delete body.tool_choice;
  // 修复请求只需要结构化正文，避免思维链占满预算后再次截断标签。
  delete body.thinking;
  delete body.reasoning_effort;
  const data = await callAPI({ ...payload, body });
  const message = data?.choices?.[0]?.message || {};
  const repaired = String(message.content || '').trim();
  if (!repaired) throw new Error('RP 选项协议修复没有返回内容');
  setDebugTrace(targetScope, {
    status: 'RP 选项协议已修复',
    output: repaired,
    rawOutput: String(reply || ''),
    outputTag: extractDebugOutputTag(repaired),
    reasoning: String(message.reasoning_content || ''),
  });
  return { content: repaired, cot: String(message.reasoning_content || '') };
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
  const toolCalls = [];
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
      const nativeCalls = json?.choices?.[0]?.delta?.tool_calls ?? json?.choices?.[0]?.message?.tool_calls;
      if (Array.isArray(nativeCalls)) nativeCalls.forEach(call => mergeNativeToolCall(toolCalls, call));
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
  return { content, cot, toolCalls: normalizeNativeToolCalls({ tool_calls: toolCalls }).map(parseNativeToolArguments) };
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
    const preview = mode === 'rpg' ? parseRpgOutput(typingText).narrative : typingText;
    const content = applyOutputRegex(mode === 'rpg' ? stripRpgNarrativeOptions(preview) : preview);
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
/* ─────────── 排版设置（设置 → 排版；改动即时生效并自动保存到 prefs） ─────────── */
const TYPO_DEFAULTS = { font: 'default', fontSize: 15, lineHeight: 1.8, paraGap: 0.7, indent: 'none', sidePad: 24 };
const TYPO_FONT_STACKS = {
  default: 'var(--font-body)',
  sans: '-apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", "Songti SC", "STSong", "SimSun", "Noto Serif SC", serif',
  kai: '"Kaiti SC", "STKaiti", "KaiTi", "TW-Kai", "DFKai-SB", serif',
  fangsong: '"Fangsong SC", "STFangsong", "FangSong", "FangSong_GB2312", serif',
  mono: 'ui-monospace, "Cascadia Mono", Consolas, "JetBrains Mono", "Courier New", monospace',
};
function typographyFromPrefs() {
  const saved = prefs && prefs.typography && typeof prefs.typography === 'object' ? prefs.typography : {};
  const merged = { ...TYPO_DEFAULTS, ...saved };
  for (const key of ['fontSize', 'lineHeight', 'paraGap', 'sidePad']) {
    merged[key] = typoNum(merged[key], TYPO_DEFAULTS[key]); // Number(null)/Number('') 是 0，必须显式排除
  }
  if (!TYPO_FONT_STACKS[merged.font]) merged.font = 'default';
  if (!['2em', '1em'].includes(merged.indent)) merged.indent = 'none';
  return merged;
}
function typoNum(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function applyTypography(typo = typographyFromPrefs()) {
  const style = document.documentElement.style;
  const fontSize = typoNum(typo.fontSize, TYPO_DEFAULTS.fontSize);
  const lineHeight = typoNum(typo.lineHeight, TYPO_DEFAULTS.lineHeight);
  const paraGap = typoNum(typo.paraGap, TYPO_DEFAULTS.paraGap);
  const sidePad = typoNum(typo.sidePad, TYPO_DEFAULTS.sidePad);
  style.setProperty('--chat-font', TYPO_FONT_STACKS[typo.font] || TYPO_FONT_STACKS.default);
  style.setProperty('--chat-font-size', fontSize + 'px');
  style.setProperty('--chat-line-height', String(lineHeight));
  style.setProperty('--chat-para-gap', paraGap + 'em');
  style.setProperty('--chat-indent', typo.indent === '2em' || typo.indent === '1em' ? typo.indent : '0em');
  style.setProperty('--chat-side-pad', sidePad + 'px');
}
function clampNum(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
function updateTypographyLabels(typo = typographyFromPrefs()) {
  const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };
  set('t-font-size-val', typo.fontSize + 'px');
  set('t-line-height-val', String(typo.lineHeight));
  set('t-para-gap-val', typo.paraGap + 'em');
  set('t-side-pad-val', typo.sidePad + 'px');
}
function fillTypographyForm() {
  const typo = typographyFromPrefs();
  $('t-font').value = TYPO_FONT_STACKS[typo.font] ? typo.font : 'default';
  $('t-font-size').value = typo.fontSize;
  $('t-line-height').value = typo.lineHeight;
  $('t-para-gap').value = typo.paraGap;
  $('t-indent').value = typo.indent;
  $('t-side-pad').value = typo.sidePad;
  updateTypographyLabels(typo);
}
function readTypographyForm() {
  prefs.typography = {
    font: TYPO_FONT_STACKS[$('t-font').value] ? $('t-font').value : 'default',
    fontSize: clampNum($('t-font-size').value, 10, 32, TYPO_DEFAULTS.fontSize),
    lineHeight: clampNum($('t-line-height').value, 1, 4, TYPO_DEFAULTS.lineHeight),
    paraGap: clampNum($('t-para-gap').value, 0, 4, TYPO_DEFAULTS.paraGap),
    indent: ['2em', '1em'].includes($('t-indent').value) ? $('t-indent').value : 'none',
    sidePad: clampNum($('t-side-pad').value, 0, 320, TYPO_DEFAULTS.sidePad),
  };
  updateTypographyLabels(prefs.typography);
  applyTypography(prefs.typography);
}
function resetTypography() {
  prefs.typography = { ...TYPO_DEFAULTS };
  fillTypographyForm();
  applyTypography(prefs.typography);
  saveJSON(LS_PREFS, prefs);
}

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
  $('f-bubbles').checked = !!prefs.tavernDialogueBubbles;
  $('s-cot').checked = !!prefs.cotEnabled;
  $('s-cot-effort').value = prefs.cotEffort || 'medium';
  const g = genSettings || {};
  if ($('g-char-basic')) $('g-char-basic').value = g.charBasicPrompt || '';
  if ($('g-char-full')) $('g-char-full').value = g.charFullPrompt || '';
  if ($('g-lore')) $('g-lore').value = g.lorePrompt || '';
  if ($('g-char-fields')) $('g-char-fields').value = JSON.stringify(Array.isArray(g.charFields) ? g.charFields : [], null, 2);
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
  fillTypographyForm();
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
  if (!Number.isFinite(settings.seed)) settings.seed = -1; // 热保存下空输入不能落成 NaN
  settings.history = parseInt($('s-history').value, 10) || 20;
  settings.stream = $('s-stream').checked;
  prefs.formatPreset = $('f-preset').value;
  prefs.formatCustom = $('f-custom').value;
  prefs.stop = $('f-stop').value;
  prefs.tavernDialogueBubbles = $('f-bubbles').checked;
  prefs.cotEnabled = $('s-cot').checked;
  prefs.cotEffort = $('s-cot-effort').value || 'medium';
  if (!readGenerationForm()) return false;
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
  readTypographyForm();
  saveSettings();
  saveJSON(LS_PREFS, prefs);
  return true;
}

function readGenerationForm() {
  if (!$('g-char-fields')) return true;
  let fields;
  try { fields = JSON.parse($('g-char-fields').value || '[]'); }
  catch {
    $('g-gen-status').textContent = '字段定义不是有效 JSON，尚未保存。';
    $('g-gen-status').className = 'hint err';
    return false;
  }
  const valid = Array.isArray(fields) && fields.length <= 64 && fields.every(field => field && typeof field === 'object' && !Array.isArray(field) && /^[A-Za-z][A-Za-z0-9_-]{0,48}$/.test(String(field.key || '')) && String(field.label || '').trim());
  if (!valid) {
    $('g-gen-status').textContent = '字段定义必须是最多 64 项的 JSON 数组，每项至少包含安全 key 与 label。';
    $('g-gen-status').className = 'hint err';
    return false;
  }
  genSettings = {
    ...genSettings,
    charBasicPrompt: $('g-char-basic').value,
    charFullPrompt: $('g-char-full').value,
    lorePrompt: $('g-lore').value,
    charFields: fields.map(field => ({ ...field, key: String(field.key), label: String(field.label).trim() })),
  };
  saveGenerationSettings();
  $('g-gen-status').textContent = 'AI 工坊配置已保存。';
  $('g-gen-status').className = 'hint ok';
  return true;
}

function resetGenerationForm() {
  if (!defaults?.gen || !confirm('恢复内置的一键写卡提示词和角色字段？当前自定义内容会被覆盖。')) return;
  genSettings = cloneValue(defaults.gen);
  fillSettingsForm();
  saveGenerationSettings();
  $('g-gen-status').textContent = '已恢复内置提示词。';
  $('g-gen-status').className = 'hint ok';
}

function setApiStatus(text, isErr = false) {
  const el = $('api-status');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('ok', !isErr && !!settings.baseUrl);
}

function openSettings() {
  closeNavDrawer();
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

function selectDebugTab(tab = 'output') {
  const allowed = new Set(['output', 'input', 'sections', 'memory']);
  debugTab = allowed.has(tab) ? tab : 'output';
  document.querySelectorAll('[data-debug-tab]').forEach(button => {
    const active = button.dataset.debugTab === debugTab;
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll('[data-debug-pane]').forEach(pane => {
    pane.hidden = pane.dataset.debugPane !== debugTab;
  });
}

function extractDebugOutputTag(text) {
  const matches = String(text || '').match(/<tavern_state_update>[\s\S]*?<\/tavern_state_update>|<tavern_options\b[\s\S]*?<\/tavern_options\s*>|```rpg[\s\S]*?```/gi);
  return matches?.length ? matches.join('\n\n') : '本次输出未找到结构化标签。';
}

function formatDebugOutput(trace) {
  const raw = trace?.rawOutput ?? trace?.output ?? '';
  const tag = trace?.outputTag || extractDebugOutputTag(raw);
  const reasoning = trace?.reasoning || '本次响应未返回 reasoning_content。';
  return [
    '── 正则前原始输出（完整响应） ──', raw || '尚未收到 AI 响应。',
    '── 结构化标签（原文摘录） ──', tag,
    '── 思维链 reasoning_content ──', reasoning,
  ].join('\n\n');
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
  $('debug-output').textContent = formatDebugOutput(trace);
  $('debug-sections').textContent = trace?.promptSections?.length
    ? JSON.stringify({ agentProfile: trace.agentProfile || null, sections: trace.promptSections }, null, 2)
    : '尚未生成 RPG Prompt 分区。';
  renderDebugMemory();
  selectDebugTab(debugTab);
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
  const sections = trace.promptSections?.length ? JSON.stringify({ agentProfile: trace.agentProfile || null, sections: trace.promptSections }, null, 2) : '';
  const text = `INPUT\n${trace.input || ''}\n\nOUTPUT\n${formatDebugOutput(trace)}${sections ? `\n\nSECTIONS\n${sections}` : ''}${memory ? `\n\nMEMORY\n${memory}` : ''}`;
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard')))
    .catch(() => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); });
}

/* ─────────── 开发者实验台（?dev=1，仅复用正式世界存档提交链） ─────────── */
function devtoolsConfig() {
  return defaults?.devtools && typeof defaults.devtools === 'object' ? defaults.devtools : {};
}
function devtoolsTokens() {
  const world = currentWorldCard() || {};
  const save = currentWorldSave || {};
  const locationId = save.state?.locationId || world.start?.locationId || world.locations?.[0]?.id || '';
  const locations = Array.isArray(world.locations) ? world.locations : [];
  const nextLocationId = locations.find(item => item?.id && item.id !== locationId)?.id || locationId;
  const resource = Array.isArray(world.playerCreation?.resources) ? world.playerCreation.resources.find(item => item?.id) : null;
  const resourceId = resource?.id || '';
  const current = Number(save.state?.player?.resources?.[resourceId] ?? resource?.initial ?? resource?.default ?? 0);
  const min = Number(resource?.min ?? 0);
  const max = Number(resource?.max ?? Number.POSITIVE_INFINITY);
  const resourceDelta = current < max ? 1 : current > min ? -1 : 0;
  const activeTemplateIds = new Set(Object.values(save.state?.conflicts || {}).filter(item => item?.status === 'active').map(item => item.templateId).filter(Boolean));
  const conflictDefinitions = Array.isArray(world.conflicts) ? world.conflicts : [];
  const checkDefinition = [...conflictDefinitions.filter(definition => activeTemplateIds.has(definition.id)), ...conflictDefinitions]
    .map(definition => ({ definition, action: (definition.actions || []).find(item => item?.check) }))
    .find(item => item.action);
  const configuredChecks = world.rules?.checks || world.checks;
  const configuredCheckId = typeof configuredChecks === 'string' ? configuredChecks
    : Array.isArray(configuredChecks) ? (configuredChecks.find(item => typeof item === 'string') || configuredChecks.find(item => item?.id || item?.ruleId)?.id || configuredChecks.find(item => item?.ruleId)?.ruleId || '')
      : configuredChecks && typeof configuredChecks === 'object' ? Object.keys(configuredChecks)[0] || '' : '';
  return {
    locationId,
    nextLocationId,
    firstResourceId: resourceId,
    resourceDelta,
    timeValue: Number(save.state?.time?.value ?? save.revision ?? 0),
    checkRuleId: checkDefinition?.action?.id || configuredCheckId,
  };
}
function resolveDevtoolsTemplate(value, tokens = devtoolsTokens()) {
  if (typeof value === 'string') {
    const exact = value.match(/^\{\{([A-Za-z0-9_]+)\}\}$/);
    if (exact && Object.prototype.hasOwnProperty.call(tokens, exact[1])) return tokens[exact[1]];
    return value.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (match, key) => Object.prototype.hasOwnProperty.call(tokens, key) ? String(tokens[key]) : match);
  }
  if (Array.isArray(value)) return value.map(item => resolveDevtoolsTemplate(item, tokens));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveDevtoolsTemplate(item, tokens)]));
  return value;
}
function devtoolsScenario() {
  const id = $('devtools-scenario')?.value;
  return devtoolsScenarios.find(item => item?.id === id) || devtoolsScenarios[0] || null;
}
function devtoolsSetOutput(value) {
  const output = $('devtools-output');
  if (output) output.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}
function devtoolsJson(id, fallback) {
  const text = $(id)?.value?.trim() || '';
  if (!text) return fallback;
  try { return JSON.parse(text); } catch (error) { throw new Error(`${id} JSON 无效：${error.message}`); }
}
function devtoolsFillJson(id, value) {
  const input = $(id);
  if (input) input.value = JSON.stringify(value ?? [], null, 2);
}
function devtoolsFeedback({ dice, patch, options, agentCalls, agentTrace, entities, memory }) {
  const lines = ['---', '**开发者测试反馈**'];
  const check = (agentTrace || []).find(item => item?.name === 'rules.check');
  const roll = (agentTrace || []).find(item => item?.name === 'dice.roll');
  if (check || roll) {
    lines.push('**Agent 判定回路**');
    lines.push(`- rules.check：${check?.result?.ok ? '通过' : `失败（${check?.result?.error || '未通过'}）`}`);
    lines.push(`- dice.roll：${roll?.result?.ok ? '客户端已执行' : `未执行（${roll?.result?.error || '未通过'}）`}`);
    lines.push('- tool 回传 → AI 继续叙事：已模拟');
  }
  if (dice.length) {
    lines.push('**骰子**');
    for (const roll of dice) lines.push(`- 🎲 ${roll.expr}：${roll.rolls.join(' + ')}${roll.bonus ? ` ${roll.bonus > 0 ? '+' : '-'} ${Math.abs(roll.bonus)}` : ''} = **${roll.total}**`);
  }
  const updates = Array.isArray(patch?.updates) ? patch.updates : [];
  if (updates.length) {
    lines.push('**状态变更**');
    for (const update of updates) {
      const detail = update.type === 'location.set' ? `→ ${update.locationId}` : `${update.id || update.itemId || ''} ${update.delta > 0 ? '+' : ''}${update.delta}`;
      lines.push(`- ${update.type}：${detail}`);
    }
  } else lines.push('- 状态变更：无（仅验证提交链）');
  if (options.length) lines.push(`**行动选项**：已生成 ${options.length} 个，可在叙事栏下方直接点击。`);
  if (agentCalls.length) lines.push(`**Agent 工具**：已记录 ${agentCalls.length} 个候选调用。`);
  if (entities.length) lines.push(`**实体**：已提交 ${entities.length} 个实体候选。`);
  if (memory.length) lines.push(`**记忆**：已提交 ${memory.length} 条事件记忆候选。`);
  return lines.join('\n');
}
function loadDevtoolsScenario() {
  const scenario = devtoolsScenario();
  if (!scenario) return;
  const resolved = resolveDevtoolsTemplate(scenario);
  $('devtools-action').value = resolved.action || '';
  $('devtools-dice').value = resolved.dice || '';
  $('devtools-narrative').value = resolved.narrative || '';
  devtoolsFillJson('devtools-options', resolved.options || []);
  devtoolsFillJson('devtools-patch', resolved.patch || { updates: [] });
  devtoolsFillJson('devtools-agent-calls', resolved.agentCalls || []);
  devtoolsFillJson('devtools-entities', resolved.createEntities || []);
  devtoolsFillJson('devtools-memory', resolved.eventMemory || []);
  devtoolsSetOutput(`${scenario.label || scenario.id}\n\n${scenario.description || ''}`);
}
function copyDevtoolsState() {
  if (!currentWorldSave) return;
  const text = JSON.stringify(currentWorldSave, null, 2);
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard')))
    .then(() => devtoolsSetOutput('已复制当前世界存档 JSON。'))
    .catch(() => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); devtoolsSetOutput('已复制当前世界存档 JSON。'); });
}
function devtoolsAgentSnapshot() {
  const world = currentWorldCard();
  const save = cloneValue(currentWorldSave);
  const active = Object.values(save.state?.conflicts || {}).some(item => item?.status === 'active');
  if (!active) {
    const definition = (Array.isArray(world?.conflicts) ? world.conflicts : []).find(item => Array.isArray(item.actions) && item.actions.some(action => action?.check));
    if (definition) save.state.conflicts = { ...(save.state.conflicts || {}), [`devtools-${definition.id}`]: { status: 'active', templateId: definition.id } };
  }
  return { world: cloneValue(world), save };
}
function renderDevtools() {
  const button = $('btn-devtools');
  if (!button) return;
  button.hidden = !devtoolsEnabled;
  if (!devtoolsEnabled) return;
  const select = $('devtools-scenario');
  const configured = Array.isArray(devtoolsConfig().scenarios) ? devtoolsConfig().scenarios : [];
  devtoolsScenarios = configured.filter(item => item && item.id);
  if (select) {
    const selected = select.value;
    select.innerHTML = devtoolsScenarios.map(item => `<option value="${esc(item.id)}">${esc(item.label || item.id)}</option>`).join('');
    if (devtoolsScenarios.some(item => item.id === selected)) select.value = selected;
  }
  const scope = $('devtools-scope');
  if (scope) scope.textContent = worldModeActive()
    ? `${currentWorldCard()?.title || currentWorldSave.worldId} · ${currentWorldSave.name} · revision ${currentWorldSave.revision}`
    : '仅在 ?dev=1 开启 · 当前没有世界存档';
  const submit = $('devtools-submit');
  if (submit) submit.disabled = !worldModeActive() || worldSavePlanning() || worldTurnPendingActive() || sending;
}
function openDevtools() {
  if (!devtoolsEnabled) return;
  renderDevtools();
  const panel = $('devtools-panel');
  if (!panel.open) panel.showModal();
  $('btn-devtools')?.setAttribute('aria-expanded', 'true');
  if (!$('devtools-action')?.value) loadDevtoolsScenario();
  $('devtools-close')?.focus();
}
function closeDevtools() {
  const panel = $('devtools-panel');
  if (panel?.open) panel.close();
  $('btn-devtools')?.setAttribute('aria-expanded', 'false');
  $('btn-devtools')?.focus();
}
async function submitDevtoolsScenario() {
  if (!worldModeActive()) throw new Error('请先打开正式 RPG 世界存档');
  if (worldSavePlanning()) throw new Error('当前存档仍在开局规划，请先完成开局配置');
  if (worldTurnPendingActive()) throw new Error('当前已有回合正在提交');
  const options = devtoolsJson('devtools-options', []);
  if (!Array.isArray(options)) throw new Error('行动选项必须是 JSON 数组');
  const parsedPatch = devtoolsJson('devtools-patch', { updates: [] });
  if (!parsedPatch || typeof parsedPatch !== 'object' || Array.isArray(parsedPatch)) throw new Error('Typed Patch 必须是 JSON 对象');
  const patch = resolveDevtoolsTemplate(cloneValue(parsedPatch));
  const currentLocationId = currentWorldSave.state?.locationId || null;
  patch.updates = (Array.isArray(patch.updates) ? patch.updates : []).filter(update => {
    if (!update || typeof update !== 'object') return false;
    if (update.type === 'player.resource.delta' && Number(update.delta) === 0) return false;
    if (update.type === 'location.set' && update.locationId === currentLocationId) return false;
    return true;
  });
  patch.protocol = 'tavern.rpg.turn';
  patch.version = 1;
  patch.baseRevision = currentWorldSave.revision;
  patch.options = options;
  const action = $('devtools-action')?.value?.trim() || '[开发者测试] 推进一回合。';
  const narrative = $('devtools-narrative')?.value?.trim() || '开发者实验台提交了一个测试回合。';
  const diceText = $('devtools-dice')?.value?.trim() || '';
  const agentCalls = devtoolsJson('devtools-agent-calls', []);
  const entities = devtoolsJson('devtools-entities', []);
  const memory = devtoolsJson('devtools-memory', []);
  if (!Array.isArray(agentCalls)) throw new Error('Agent 工具调用必须是 JSON 数组');
  if (diceText && !agentCalls.some(call => call?.name === 'dice.roll')) agentCalls.push({ callId: 'dev-dice', name: 'dice.roll', arguments: { expr: diceText } });
  const profile = buildRpgAgentProfile();
  const executed = await executeRpgNativeToolCalls(agentCalls, profile, null, devtoolsAgentSnapshot(), {});
  const agentTrace = executed.trace;
  const toolErrors = agentTrace.filter(item => item?.result?.ok === false);
  if (toolErrors.length) throw new Error(`Agent 工具测试失败：${toolErrors.map(item => `${item.name}：${item.result.error}`).join('；')}`);
  const dice = agentTrace.filter(item => item?.name === 'dice.roll' && Array.isArray(item.result?.rolls)).flatMap(item => item.result.rolls);
  const visibleNarrative = `${narrative}\n\n${devtoolsFeedback({ dice: [], patch, options, agentCalls, agentTrace, entities, memory })}`;
  const diceMessages = dice.map(roll => {
    const detail = roll.rolls.length > 1
      ? `（${roll.rolls.join(' + ')}${roll.bonus ? (roll.bonus > 0 ? ` + ${roll.bonus}` : ` - ${Math.abs(roll.bonus)}`) : ''}）`
      : (roll.bonus ? `（${roll.bonus > 0 ? '+' : ''}${roll.bonus}）` : '');
    return { role: 'user', content: `🎲 工具掷骰 ${roll.expr} = ${roll.total} ${detail}`, meta: true };
  });
  const payload = {
    commandId: 'dev-' + uid(),
    expectedRevision: currentWorldSave.revision,
    actionIntent: { raw: action, ...(dice.length ? { dice } : {}) },
    patch,
    turns: [{ role: 'user', content: action }, ...diceMessages, { role: 'assistant', content: visibleNarrative }],
    options,
    ...(Array.isArray(agentCalls) && agentCalls.length ? { agentCalls } : {}),
    ...(Array.isArray(entities) && entities.length ? { createEntities: resolveDevtoolsTemplate(entities) } : {}),
    ...(Array.isArray(memory) && memory.length ? { eventMemory: resolveDevtoolsTemplate(memory) } : {}),
  };
  const response = await fetch('/api/world-saves/' + encodeURIComponent(currentWorldSave.id), {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.id) throw new Error(worldApiError(data, `开发者回合提交失败（HTTP ${response.status}）`));
  hydrateWorldSave(data);
  currentWorldSave = data;
  currentWorldSaveId = data.id;
  renderRPG(); renderSessions(); renderMessages(); renderWorldDetail(); renderDevtools();
  devtoolsSetOutput({ ok: true, revision: data.revision, agentTrace, evidence: data.lastReceipt || data.lastTurn || null, dice: dice.length ? dice : undefined });
}
async function runDevtoolsSubmit() {
  const button = $('devtools-submit');
  if (button) button.disabled = true;
  try { await submitDevtoolsScenario(); }
  catch (error) { devtoolsSetOutput(`提交失败：${error.message}`); }
  finally { renderDevtools(); }
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

async function exportSettings() {
  readSettingsForm();
  await downloadBlob(new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' }), 'tavern-settings.json');
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
  if (ta) { m.content = ta.value; delete m.rawContent; }
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
  initTavernCardFrameBridge();
  renderDebugTerminal();
  if (mode !== 'rpg') clearWorldExtension();
  applyWorldUiSlots();
  chat.innerHTML = '';
  if (mode === 'rpg') renderRPG(); // RPG 模式联动状态面板
  const msgs = curMessages();
  renderQuickActions(); // 从当前会话最后一条 AI 回复恢复选项，切换会话不串线
  const ended = mode === 'rpg' && worldModeActive() && (currentWorldSave?.state?.ending?.status === 'ended' || currentWorldSave?.state?.failure?.status === 'terminal');
  const input = $('input');
  const sendButton = $('btn-send');
  if (input) { input.disabled = ended; input.placeholder = ended ? '世界线已终止，请从右侧重开独立存档后继续…' : '写下你的话或行动（可用 *动作* 表示）… Enter 发送 · Shift+Enter 换行'; }
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
          const { html, md } = renderBubble(renderOutputContent(m.content, 'rpg'));
          el.innerHTML = `<div class="rpg-prose${md ? ' md' : ''}" data-tavern-rendered>${html}</div>`;
          attachMsgActions(el, m, m._opening ? { copy: true } : { regen: true, edit: true, copy: true, del: true });
        }
        chat.appendChild(el);
        continue;
      }
      const tavernContent = renderOutputContent(m.content, 'tavern');
      const bubbleDialogue = !!prefs.tavernDialogueBubbles;
      const segs = bubbleDialogue ? splitNarration(tavernContent) : [{ type: 'narration', text: tavernContent }];
      segs.forEach((seg, si) => {
        const el = document.createElement('div');
        let html;
        if (m._editing) {
          el.className = 'msg assistant';
          el.innerHTML = renderEditBubble(m);
        } else {
          const { html: h, md } = renderBubble(seg.type === 'dialogue' ? seg.text.slice(1, -1) : seg.text, { allowCardScripts: true });
          html = h;
          if (seg.type === 'narration') {
            el.className = `msg narration${bubbleDialogue ? '' : ' tavern-prose'}`;
            el.innerHTML = `<div class="nar-icon">✦</div><div class="bubble${md ? ' md' : ''}" data-tavern-rendered>${html}</div>`;
          } else {
            el.className = 'msg assistant';
            el.innerHTML = `<div class="avatar">${PAW_SVG}</div><div class="bubble tavern-dialogue${md ? ' md' : ''}" data-tavern-rendered>${html}</div>`;
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
      el.innerHTML = `<div class="avatar">${avatar}</div><div class="bubble${md ? ' md' : ''}" data-tavern-rendered>${html}</div>`;
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
    ? '<div class="rpg-prose" data-tavern-rendered>世界正在回应…</div>'
    : `<div class="avatar">${PAW_SVG}</div><div class="bubble" data-tavern-rendered>正在思索…</div>`;
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
          temperature: settings.temperature,
          max_tokens: settings.maxTokens,
          top_p: settings.topP,
          frequency_penalty: settings.frequencyPenalty,
          presence_penalty: settings.presencePenalty,
          stream: false,
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.choices || !data.choices[0]) throw new Error('提示词生成失败（对话 API 未配置？）');
    const choice = data.choices[0];
    const content = choice.message && choice.message.content;
    if (!content || choice.finish_reason === 'length') {
      throw new Error('提示词生成被截断：请在设置中提高最大 Token，或关闭模型思维链。');
    }
    return content.trim();
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
      promptSections: (payload.promptSections || []).map(section => ({ id: section.id, source: section.source, chars: section.text.length })),
      agentProfile: payload.agentProfile || null,
      output: '等待 AI 响应…',
      rawOutput: '等待 AI 响应…',
      outputTag: '等待 AI 响应…',
      reasoning: '',
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
    let nativeCalls = [];
    let toolTrace = [];
    if (mode === 'rpg') {
      const r = await requestRpgAgentReply(payload, targetScope);
      reply = r.reply;
      cot = r.cot;
      nativeCalls = r.nativeCalls || [];
      toolTrace = r.toolTrace || [];
      postWorldExtensionEvent('agent.complete', {
        commandId: worldTurnPending?.commandId || null,
        revision: currentWorldSave?.revision ?? null,
        calls: toolTrace.filter(item => item?.callId && item?.name).map(item => ({
          callId: item.callId,
          name: item.name,
          phase: item.phase || rpgAgentToolPhase(item.name),
          status: item.result?.ok === true ? 'passed' : 'rejected',
        })),
      });
    } else if (payload.body.stream) {
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
      rawOutput: String(reply),
      outputTag: extractDebugOutputTag(reply),
      reasoning: cot || '',
      agentToolTrace: toolTrace,
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
    let processed = processAIOutput(reply);
    if (mode !== 'rpg' && tavernReplyNeedsOptionRepair(processed, resolvePromptPreset()?.preset || null)) {
      const tavernPreset = resolvePromptPreset()?.preset || null;
      setDebugTrace(targetScope, { status: 'RP 输出缺少行动选项，正在修复', output: String(reply || ''), rawOutput: String(reply || '') });
      try {
        const repaired = await repairTavernReplyOptions(payload, reply, tavernPreset, targetScope);
        processed = processAIOutput(repaired.content);
        if (repaired.cot) cot += (cot ? '\n\n' : '') + repaired.cot;
        reply = repaired.content;
      } catch (error) {
        console.warn('[Tavern] RP 选项协议修复失败:', error.message);
        setDebugTrace(targetScope, { status: 'RP 选项修复失败（保留原正文）', output: String(reply || ''), rawOutput: String(reply || ''), outputTag: extractDebugOutputTag(reply) });
      }
    }
    if (activeConversationKey() !== targetKey) {
      setDebugTrace(targetScope, { status: '已完成（修复响应因切换存档/会话未写入历史）' });
      console.warn('[Tavern] 修复期间切换了存档/会话，已丢弃迟到响应');
      return;
    }
    if (worldTurnPendingActive()) {
      const optionRules = worldOptionRules();
      const options = Array.isArray(processed.options) ? processed.options : [];
      const patchContractInvalid = processed.patch && (
        processed.patch.protocol !== 'tavern.rpg.turn'
        || Number(processed.patch.version) !== 1
        || Number(processed.patch.baseRevision) !== Number(currentWorldSave?.revision)
      );
      const patchShapeError = processed.patch ? validateRpgPatchShape(processed.patch) : '';
      const outputContractInvalid = !!processed.protocol?.errorCode || patchContractInvalid || !!patchShapeError || options.length < optionRules.min || options.length > optionRules.max;
      if (outputContractInvalid) {
        const originalPatch = processed.patch;
        const originalEntities = processed.createEntities;
        const originalMemory = processed.eventMemory;
        setDebugTrace(targetScope, { status: '输出协议不合规，正在修复', output: String(reply || '') });
        const repairedReply = await repairRpgOutput(payload, reply, optionRules, targetScope, toolTrace, patchShapeError);
        processed = processAIOutput(repairedReply);
        if (!processed.patch && originalPatch) processed.patch = originalPatch;
        if (!processed.createEntities && originalEntities) processed.createEntities = originalEntities;
        if (!processed.eventMemory && originalMemory) processed.eventMemory = originalMemory;
        reply = repairedReply;
      }
    }
    const nativeCandidate = mode === 'rpg' ? nativeCandidatesToRpgData(nativeCalls, currentWorldSave?.revision) : { patch: null, createEntities: null, eventMemory: null };
    if (!processed.patch && nativeCandidate.patch) processed.patch = nativeCandidate.patch;
    if (!processed.createEntities && nativeCandidate.createEntities) processed.createEntities = nativeCandidate.createEntities;
    if (!processed.eventMemory && nativeCandidate.eventMemory) processed.eventMemory = nativeCandidate.eventMemory;
    const clean = processed.content;
    const extra = {
      outputRegexApplied: true,
      ...(typeof processed.rawContent === 'string' ? { rawContent: processed.rawContent } : {}),
      ...(mode === 'tavern' ? { cardOutputRegexApplied: true } : {}),
    };
    if (cot) extra.cot = cot;
    if (processed.options && processed.options.length) extra.options = processed.options;
    if (worldTurnPendingActive()) {
      const agentToolRolls = toolTrace.filter(item => item.name === 'dice.roll' && Array.isArray(item.result?.rolls)).flatMap(item => item.result.rolls);
      // 原生与兼容 Agent 都只有在工具循环内完成客户端掷骰并回传结果后，
      // 才把骰子记录写入待提交回合；这里不再对 toolCalls 事后补掷。
      const toolRolls = agentToolRolls;
      for (const r of toolRolls) {
        const detail = r.rolls.length > 1 ? `（${r.rolls.join(' + ')}${r.bonus ? (r.bonus >= 0 ? ' + ' + r.bonus : ' - ' + Math.abs(r.bonus)) : ''}）` : (r.bonus ? `（${r.bonus > 0 ? '+' : ''}${r.bonus}）` : '');
        worldTurnPending.messages.push({ id: uid(), role: 'user', content: `🎲 工具掷骰 ${r.expr} = ${r.total} ${detail}`, ts: Date.now(), meta: true });
      }
      if (toolRolls.length) worldTurnPending.actionIntent.dice = [...(worldTurnPending.actionIntent.dice || []), ...toolRolls];
      // 世界回合的 assistant 正文先留在 pending turn；只有服务端原子提交成功后才进入正式历史。
      worldTurnPending.messages.push({ id: uid(), role: 'assistant', content: clean, ts: Date.now(), ...extra });
      renderMessages();
      const optionRules = worldOptionRules();
      const options = Array.isArray(processed.options) ? processed.options : [];
      if (options.length < optionRules.min || options.length > optionRules.max) throw new Error(`RPG 回合需要 ${optionRules.min}-${optionRules.max} 个行动选项，当前候选未提交`);
      worldTurnPending.options = options;
      worldTurnPending.createEntities = processed.createEntities;
      worldTurnPending.eventMemory = processed.eventMemory;
      const calls = [...nativeCalls, ...(Array.isArray(processed.agentCalls) ? processed.agentCalls : [])]
        // context.retrieve is read-only and exists only inside the model loop;
        // it must never be sent as a state-changing server candidate.
        .filter(call => call?.name !== 'context.retrieve');
      worldTurnPending.agentCalls = calls.filter((call, index, list) => call?.callId && list.findIndex(item => item.callId === call.callId) === index);
      worldTurnPending.agentToolTrace = toolTrace.filter(item => item?.callId && item?.name).map(item => ({
        callId: item.callId,
        name: item.name,
        phase: item.phase || rpgAgentToolPhase(item.name),
        result: item.result,
        ...(item.step ? { step: item.step } : {}),
        ...(item.mode ? { mode: item.mode } : {}),
      }));
      worldTurnPending.patch = processed.patch;
      worldTurnPending.state = processed.patch ? worldTurnPending.beforeState : serializeWorldState(currentWorldSave);
      if (worldTurnPending.patch) {
        worldTurnPending.agentPhase = 'execute';
        const history = buildRpgAgentPhaseHistory(worldTurnPending.agentToolTrace, 'execute');
        worldTurnPending.agentPhaseHistory = [...history, { phase: 'narrate', status: 'pending', order: history.length + 1 }];
      }
      await submitWorldTurn(worldTurnPending);
    } else {
      pushMessage('assistant', clean, extra);
    }
    // 文生图（测试）：回复完成后自动生图（异步，不阻塞对话）
    const ig = settings.imageGen;
    if (ig && ig.enabled && ig.auto && ig.baseUrl) {
      generateImageFor(clean).catch(e => console.error('[Tavern] 文生图失败', e.message));
    }
  } catch (err) {
    console.error('[Tavern] ✗ 请求失败', err.message);
    if (worldModeActive()) postWorldExtensionEvent('turn.error', { commandId: worldTurnPending?.commandId || null, message: String(err.message || '请求失败').slice(0, 240) });
    removeTyping();
    const keptWorldTurn = failWorldTurnPending(err.message);
    setDebugTrace(targetScope, { status: '失败', output: `ERROR\n${err.message}`, rawOutput: `ERROR\n${err.message}`, outputTag: '未生成结构化标签。', reasoning: '' });
    if (activeConversationKey() === targetKey && !keptWorldTurn) pushMessage('system', `⚠️ 请求失败：${err.message}`);
    setApiStatus(`最近一次请求失败：${err.message}`, true);
  } finally {
    sending = false;
    $('btn-send').disabled = false;
    const input = $('input');
    if (input) input.focus();
  }
}

async function submitWorldActionText(text, { throwOnError = false } = {}) {
  if (sending || worldTurnPreparing || worldTurnPending || !worldModeActive()) {
    const message = !worldModeActive() ? '当前没有打开的世界存档' : '当前回合仍在处理中';
    if (throwOnError) throw new Error(message);
    return false;
  }
  if (worldSavePlanning() || currentWorldSave?.state?.ending?.status === 'ended' || currentWorldSave?.state?.failure?.status === 'terminal') {
    const message = worldSavePlanning() ? '当前存档仍在开局规划' : '当前世界线已经终止';
    if (throwOnError) throw new Error(message);
    return false;
  }
  const value = String(text || '').trim();
  if (!value) {
    if (throwOnError) throw new Error('行动不能为空');
    return false;
  }
  worldTurnPreparing = true;
  try {
    await worldSaveWriteChain.catch(() => {});
    if (!worldModeActive()) throw new Error('世界存档已切换');
    worldTurnEpoch++;
    worldTurnPending = {
      commandId: uid(),
      saveId: currentWorldSave.id,
      expectedRevision: currentWorldSave.revision,
      beforeState: cloneValue(serializeWorldState(currentWorldSave)),
      state: serializeWorldState(currentWorldSave),
      messages: [{ id: uid(), role: 'user', content: value, ts: Date.now() }],
      actionIntent: { raw: value },
      options: null,
      createEntities: null,
      eventMemory: null,
      agentCalls: null,
      agentToolTrace: null,
      patch: null,
      agentPhase: null,
      agentPhaseHistory: [],
      agentOrchestration: null,
      agentExecution: null,
    };
    postWorldExtensionEvent('turn.start', { commandId: worldTurnPending.commandId, revision: worldTurnPending.expectedRevision });
    renderMessages();
    const rolls = await rollWorldDice(value);
    for (const r of rolls) {
      const detail = r.rolls.length > 1 ? `（${r.rolls.join(' + ')}${r.bonus ? (r.bonus >= 0 ? ' + ' + r.bonus : ' - ' + Math.abs(r.bonus)) : ''}）` : (r.bonus ? `（+${r.bonus}）` : '');
      pushMessage('user', `🎲 ${r.expr} = ${r.total} ${detail}`, { meta: true });
    }
    worldTurnPending.actionIntent.dice = rolls;
    await requestReply();
    return true;
  } catch (err) {
    failWorldTurnPending(err.message);
    setApiStatus(`最近一次请求失败：${err.message}`, true);
    if (throwOnError) throw err;
    return false;
  } finally {
    worldTurnPreparing = false;
  }
}

async function sendMessage() {
  if (sending || worldTurnPreparing || worldTurnPending || (worldModeActive() && (worldSavePlanning() || currentWorldSave?.state?.ending?.status === 'ended' || currentWorldSave?.state?.failure?.status === 'terminal'))) return;
  if (mode === 'rpg' && !worldModeActive()) { openWorldLibrary(); return; }
  const input = $('input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  if (worldModeActive()) {
    await submitWorldActionText(text);
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

function syncModeNavigation(view = 'chat') {
  const visibleButtons = [...document.querySelectorAll('.nav-item[data-view]')].filter(button => {
    const group = button.closest('[data-mode-nav]');
    return !group || group.dataset.modeNav === mode;
  });
  const activeView = visibleButtons.some(button => button.dataset.view === view) ? view : 'chat';
  document.body.dataset.uiView = activeView;
  const main = document.querySelector('.main');
  if (main) main.dataset.uiView = activeView;
  document.querySelectorAll('.nav-item[data-view]').forEach(button => {
    const group = button.closest('[data-mode-nav]');
    const visible = !group || group.dataset.modeNav === mode;
    const active = visible && button.dataset.view === activeView;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

// 手机端管理页采用“列表 → 详情”钻取；桌面端继续保留双栏编辑器。
const MOBILE_MANAGER_IDS = ['char-mgr', 'prompt-mgr', 'regex-mgr', 'lore-mgr', 'memory-mgr', 'world-mgr'];
function isMobileViewport() { return window.matchMedia('(max-width: 960px)').matches; }
function syncMobileManagerBackLabel(managerId) {
  const manager = $(managerId);
  if (!manager) return;
  const backs = [...manager.querySelectorAll('[data-manager-back]')];
  if (!backs.length) return;
  const detail = manager.dataset.mobilePanel === 'detail';
  if (managerId === 'world-mgr') {
    const label = isMobileViewport() && detail ? '‹ 返回世界库' : '返回工作台';
    backs.forEach(back => {
      back.textContent = label;
      back.setAttribute('aria-label', label);
    });
    return;
  }
  const nestedParent = managerId === 'prompt-mgr' && manager.dataset.mobilePromptPanel === 'entry'
    ? '提示词顺序'
    : managerId === 'lore-mgr' && manager.dataset.mobileLorePanel === 'entry'
      ? '世界书条目' : (backs[0].dataset.parentLabel || '列表');
  const label = isMobileViewport() && detail ? `‹ 返回${nestedParent}` : '回到对话';
  backs.forEach(back => {
    back.textContent = label;
    back.setAttribute('aria-label', isMobileViewport() && detail ? `返回${nestedParent}` : '回到对话');
  });
}
function setMobileManagerPanel(managerId, panel = 'list', options = {}) {
  const manager = $(managerId);
  if (!manager || !MOBILE_MANAGER_IDS.includes(managerId)) return;
  const detail = panel === 'detail';
  manager.dataset.mobilePanel = detail ? 'detail' : 'list';
  manager.querySelector('.cm-side')?.setAttribute('aria-hidden', detail ? 'true' : 'false');
  manager.querySelector('.cm-edit')?.setAttribute('aria-hidden', detail ? 'false' : 'true');
  syncMobileManagerBackLabel(managerId);
  const back = manager.querySelector('.cm-edit-head [data-manager-back]') || manager.querySelector('[data-manager-back]');
  if (isMobileViewport() && detail && options.focus !== false) {
    requestAnimationFrame(() => back?.focus());
  }
}

function handleManagerBack(button) {
  const manager = button.closest('.char-mgr');
  if (manager && isMobileViewport() && manager.dataset.mobilePanel === 'detail') {
    if (manager.id === 'prompt-mgr' && manager.dataset.mobilePromptPanel === 'entry') {
      setMobilePromptPanel('sequence');
      requestAnimationFrame(() => manager.querySelector('.pg-prompt-row')?.focus());
      return;
    }
    if (manager.id === 'lore-mgr' && manager.dataset.mobileLorePanel === 'entry') {
      setMobileLorePanel('book');
      requestAnimationFrame(() => manager.querySelector('#wi-list .wi-item')?.focus());
      return;
    }
    setMobileManagerPanel(manager.id, 'list', { focus: false });
    requestAnimationFrame(() => manager.querySelector('.cm-side :is(.cm-item, button, input, select, textarea)')?.focus());
    return;
  }
  switchView('chat');
}

function setMobilePromptPanel(panel = 'sequence') {
  const manager = $('prompt-mgr');
  if (manager) {
    manager.dataset.mobilePromptPanel = panel === 'entry' ? 'entry' : 'sequence';
    syncMobileManagerBackLabel('prompt-mgr');
  }
}

function setMobileLorePanel(panel = 'book') {
  const manager = $('lore-mgr');
  if (manager) {
    manager.dataset.mobileLorePanel = panel === 'entry' ? 'entry' : 'book';
    syncMobileManagerBackLabel('lore-mgr');
  }
}
function openMobileMemoryEntries() {
  setMobileManagerPanel('memory-mgr', 'detail');
}

function buildWorldSetupPromptPart() {
  if (!worldModeActive()) return '';
  const save = currentWorldSave;
  const setup = save.setup || {};
  const world = currentWorldCard() || {};
  const game = setup.game && typeof setup.game === 'object' ? setup.game : {};
  const sessionFields = Array.isArray(world.sessionSetup?.fields) ? world.sessionSetup.fields : [];
  const gameText = sessionFields.map(field => `${field.label || field.id}=${game[field.id] ?? field.default ?? '未设置'}`).join('；');
  const plan = setup.plan && typeof setup.plan === 'object' ? setup.plan : null;
  const planText = plan ? JSON.stringify(plan) : '尚未提交开局规划';
  const hooks = Array.isArray(save.state?.activeHooks) ? save.state.activeHooks.filter(hook => hook && hook.status !== 'done' && hook.status !== 'failed') : [];
  const hookText = hooks.length ? hooks.map(hook => `${hook.title || hook.id}${hook.description ? `：${hook.description}` : ''}${hook.optional ? '（可选）' : ''}`).join('；') : '无';
  return `【本局游戏配置】
本局绑定 WorldCard ${world.id || save.worldId}@v${world.version || save.worldVersion}；Worldbook=${Array.isArray(world.lorebookIds) && world.lorebookIds.length ? world.lorebookIds.join(',') : 'default'}；RPG Preset=${world.rpgPresetName || '当前默认预设'}。
存档专属规则：${gameText || '世界卡未声明额外动态规则，遵循 WorldCard 已有 time / turnContract / failure / ending 规则。'}
开局配置（只读事实来源）：${planText}
当前开放 Hook（可选叙事抓手，不是强制主线）：${hookText}
Hook 状态只能通过唯一状态块的 objective.status(kind=hooks) 更新，不能凭正文宣称完成。`;
}

function buildWorldKnowledgePromptPart() {
  if (!worldModeActive()) return '';
  const state = currentWorldSave?.state || {};
  const info = state.knownInformation && typeof state.knownInformation === 'object' ? state.knownInformation : {};
  const lines = [
    ['World Truth（叙事者可见，玩家不自动知道）', info.worldTruth],
    ['Character Knowledge（玩家角色已知）', info.characterKnowledge],
    ['Player-visible Information（可直接作为玩家可见内容）', info.playerVisible],
    ['Hidden Information（仅叙事者内部使用，禁止直接泄露）', info.hidden],
    ['Rumor / Unconfirmed（必须明确是不确定传闻）', info.rumors],
  ].filter(([, values]) => Array.isArray(values) && values.length).map(([label, values]) => `${label}：\n${values.map(value => `- ${value}`).join('\n')}`);
  return lines.length ? `【开局知识权限】\n${lines.join('\n')}` : '';
}

function switchView(name) {
  closeNavDrawer(); // 手机抽屉：切换视图后自动收起
  renderDebugTerminal();
  syncModeNavigation(name);
  ['char-mgr', 'prompt-mgr', 'regex-mgr', 'lore-mgr', 'memory-mgr', 'world-mgr'].forEach(id => { const el = $(id); if (el) el.classList.add('hidden'); });
  if (name === 'worlds') { openWorldLibrary(false); return; }
  if (name === 'chat') {
    if (mode === 'rpg' && !worldModeActive()) openWorldLibrary(false);
    return;
  }
  if (name === 'chars') {
    if (mode === 'rpg') { openWorldLibrary(false); return; }
    renderBindSelects();
    $('char-mgr').classList.remove('hidden');
    renderCharList();
    if (!cmEditingId && !cmCreating && characters.length) selectCharForEdit(currentCharId || characters[0].id);
    setMobileManagerPanel('char-mgr', 'list', { focus: false });
    return;
  }
  if (name === 'prompts') {
    $('prompt-mgr').classList.remove('hidden');
    const editingPreset = promptPresets[pgEditingName];
    if (!editingPreset || !['both', mode].includes(presetMode(pgEditingName, editingPreset))) selectPresetForEdit(activePresetNameForMode(mode) || GLOBAL_PRESET_KEY);
    else renderPGList();
    setMobilePromptPanel('sequence');
    setMobileManagerPanel('prompt-mgr', 'list', { focus: false });
    return;
  }
  if (name === 'regex') {
    $('regex-mgr').classList.remove('hidden');
    renderRegexList();
    const selected = selectedOutputRegex();
    if (selected) renderRegexEditor(selected, regexEditingSource);
    else resetRegexEditor();
    setMobileManagerPanel('regex-mgr', 'list', { focus: false });
    return;
  }
  if (name === 'lore') {
    $('lore-mgr').classList.remove('hidden');
    if (!lbEditingId) lbEditingId = Object.keys(lorebooks)[0] || null;
    fillLorebookSettings();
    renderLBList();
    renderWIList();
    setMobileLorePanel('book');
    setMobileManagerPanel('lore-mgr', 'list', { focus: false });
    return;
  }
  if (name === 'memory') {
    $('memory-mgr').classList.remove('hidden');
    ensureUserData();
    fillUserForm();
    renderMemList();
    setMobileManagerPanel('memory-mgr', 'list', { focus: false });
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
  setRpgMobileDrawer('');
  closeNavDrawer();
  mode = (name === 'rpg') ? 'rpg' : 'tavern';
  document.body.dataset.mode = mode;
  localStorage.setItem(LS_MODE, mode);
  document.querySelectorAll('.js-mode-switch').forEach(btn => {
    btn.querySelector('.icon').textContent = mode === 'rpg' ? '⚔' : '🍺';
    btn.querySelector('.mode-switch-label').textContent = mode === 'rpg' ? '模式：RPG' : '模式：酒馆';
  });
  syncModeNavigation('chat');
  if (mode === 'tavern') activateSessionScope();
  // 酒馆使用角色会话；RPG 只使用 WorldCard → WorldSave，不创建/激活普通角色会话。
  renderSessions();
  renderMessages();
  if (mode === 'rpg') {
    ['char-mgr', 'prompt-mgr', 'regex-mgr', 'lore-mgr', 'memory-mgr'].forEach(id => $(id)?.classList.add('hidden'));
    openWorldLibrary(true);
  }
  else { exitWorldImmersiveMode(); closeWorldLibrary(); renderCharacter(); }
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
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        top_p: settings.topP,
        frequency_penalty: settings.frequencyPenalty,
        presence_penalty: settings.presencePenalty,
        ...(settings.seed != null && settings.seed >= 0 ? { seed: settings.seed } : {}),
        stream: false,
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.choices || !data.choices[0]) {
    throw new Error('生成失败：' + ((data.error && data.error.message) || ('HTTP ' + res.status)));
  }
  const choice = data.choices[0];
  const content = choice.message && choice.message.content;
  if (!content || choice.finish_reason === 'length') {
    throw new Error('AI 输出被截断：请在设置中提高最大 Token，或关闭模型思维链。');
  }
  return parseLLMJson(content);
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
  const gen = genSettings || {};
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
  const gen = genSettings || {};
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
      description: 'cm-persona', personality: 'cm-personality',
      scenario: 'cm-scenario', firstMes: 'cm-first-mes', systemPrompt: 'cm-system',
      mesExample: 'cm-mes-example', postHistory: 'cm-post', creatorNotes: 'cm-creator-notes',
      creator: 'cm-creator', characterVersion: 'cm-character-version', tags: 'cm-tags',
    };
    for (const [key, id] of Object.entries(bindings)) {
      const value = Object.prototype.hasOwnProperty.call(confirmed, key) ? confirmed[key] : obj[key];
      if (typeof value === 'string') $(id).value = value;
    }
    if (Array.isArray(obj.alternateGreetings)) $('cm-alt-greetings').value = obj.alternateGreetings.join('\n\n');
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
  const gen = genSettings || {};
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

/* ═══════════ 世界地图兼容层（世界卡数据 + 上下文注入；运行时 UI 暂隐藏） ═══════════ */
/* 世界模式地图归属 WorldSave.state.map；旧 RPG 兼容路径仍读 session.rpgState。 */

function currentWorldMapState() {
  if (!worldModeActive()) return null;
  const state = currentWorldSave.state || (currentWorldSave.state = {});
  state.map = state.map && typeof state.map === 'object' ? state.map : { strategy: 'worldCard', data: null, imagePath: null, markers: [] };
  return state.map;
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
    return worldMap.data || null;
  }
  const rs = curRpgState();
  if (!rs) return null;
  return rs.mapData || null;
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

/* 兼容入口：地图现在只由世界卡提供，运行时不再随机重建。 */
function mapRegenerate() {
  // 地图由世界卡提供；不再在运行时随机生成或重生成。
  return null;
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
  lines.push('【地图】当前世界卡提供一张地图，共 ' + map.regions.length + ' 个区域。'
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

/* 快捷行动栏：RPG / 酒馆模式都读取最后一条 AI 回复的结构化 options（点击即发送）。 */
function renderQuickActions() {
  const qa = $('quick-actions');
  if (!qa) return;
  qa.innerHTML = '';
  if (worldTurnPendingActive() && worldTurnPending.agentExecution && !worldTurnErrorActive()) {
    const box = document.createElement('div');
    box.className = 'world-turn-error';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    const text = document.createElement('span');
    text.className = 'world-turn-error-text';
    const phase = worldTurnPending.agentPhase || 'narrate';
    const counts = worldTurnPending.agentOrchestration?.counts;
    const planCount = Array.isArray(worldTurnPending.agentOrchestration?.plan) ? worldTurnPending.agentOrchestration.plan.length : 0;
    const summary = counts ? `计划 ${planCount}，候选 ${Number(counts.candidates) || 0}，通过 ${Number(counts.passed) || 0}，拒绝 ${Number(counts.rejected) || 0}` : '暂无工具摘要';
    text.textContent = `已恢复 Agent 回合：当前阶段 ${phase}；${summary}。正式状态尚未提交。`;
    const actions = document.createElement('span');
    actions.className = 'world-turn-error-actions';
    const resume = document.createElement('button');
    resume.type = 'button';
    resume.className = 'btn gold small';
    resume.textContent = '继续提交';
    resume.addEventListener('click', resumeWorldAgentNarration);
    const discard = document.createElement('button');
    discard.type = 'button';
    discard.className = 'ghost-btn small';
    discard.textContent = '放弃本回合';
    discard.addEventListener('click', discardWorldTurnPending);
    actions.append(resume, discard);
    box.append(text, actions);
    qa.appendChild(box);
    return;
  }
  if (worldTurnErrorActive()) {
    const box = document.createElement('div');
    box.className = 'world-turn-error';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    const text = document.createElement('span');
    text.className = 'world-turn-error-text';
    const phase = worldTurnPendingActive() && worldTurnPending.agentPhase ? `（Agent ${worldTurnPending.agentPhase} 阶段）` : '';
    text.textContent = `本回合未提交${phase}：${worldTurnError.message}`;
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
    if (worldModeActive() && (currentWorldSave?.state?.ending?.status === 'ended' || currentWorldSave?.state?.failure?.status === 'terminal')) {
      const done = document.createElement('span');
      done.className = 'quick-hint';
      done.textContent = '世界线已终止；如要继续，请从右侧重开独立存档。';
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
  // 酒馆模式：与 RPG 相同，读取最后一条 AI 回复生成的选项；没有标签时只显示提示。
  const msgs = curMessages();
  let opts = null;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role !== 'assistant') continue;
    opts = Array.isArray(msgs[i].options) && msgs[i].options.length ? msgs[i].options : null;
    break;
  }
  if (opts) {
    for (const option of opts) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = option;
      b.addEventListener('click', () => { $('input').value = option; sendMessage(); });
      qa.appendChild(b);
    }
  } else {
    const hint = tavernReplyOptionRules(resolvePromptPreset()?.preset).noOptions;
    if (hint) {
      const s = document.createElement('span');
      s.className = 'quick-hint';
      s.textContent = hint;
      qa.appendChild(s);
    }
  }
}

function setRpgMobileDrawer(panel) {
  const current = document.body.dataset.rpgDrawer || '';
  const next = panel && current !== panel ? panel : '';
  if (!current && next) {
    rpgDrawerReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  if (next) document.body.dataset.rpgDrawer = next;
  else delete document.body.dataset.rpgDrawer;
  const scrim = $('rpg-mobile-scrim');
  if (scrim) scrim.hidden = !next;
  document.querySelectorAll('[data-rpg-drawer]').forEach(button => {
    button.setAttribute('aria-expanded', button.dataset.rpgDrawer === next ? 'true' : 'false');
  });
  if (next) {
    requestAnimationFrame(() => document.querySelector(`#rpg-${next} [data-rpg-drawer-close]`)?.focus());
  } else if (current && rpgDrawerReturnFocus instanceof HTMLElement && document.contains(rpgDrawerReturnFocus)) {
    const restore = rpgDrawerReturnFocus;
    rpgDrawerReturnFocus = null;
    requestAnimationFrame(() => restore.focus());
  }
}

/* ─────────── 事件绑定 ─────────── */
function bindEvents() {
  window.addEventListener('message', handleWorldExtensionMessage);
  $('rpg-extension-reload')?.addEventListener('click', () => {
    clearWorldExtension();
    renderWorldExtension();
  });
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
  window.addEventListener('resize', () => {
    for (const id of MOBILE_MANAGER_IDS) {
      const manager = $(id);
      if (manager && !manager.classList.contains('hidden')) setMobileManagerPanel(id, manager.dataset.mobilePanel || 'list', { focus: false });
    }
  });
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
    if (mode === 'rpg') { openWorldLibrary(); return; }
    $('session-menu').classList.toggle('hidden');
  });
  document.addEventListener('click', e => {
    if (!$('session-menu').contains(e.target)) $('session-menu').classList.add('hidden');
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
      alert(`已导入「${report.name}」：素材 ${report.prompts} 条，当前顺序 ${report.ordered} 条。${report.regexes ? `已识别并启用 ${report.regexes} 条输出正则。` : ''}`);
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
  // 输出正则
  $('regex-new').addEventListener('click', resetRegexEditor);
  $('regex-reset').addEventListener('click', resetRegexEditor);
  $('regex-save').addEventListener('click', saveRegexEditor);
  $('regex-copy').addEventListener('click', copyPresetRegexToCustom);
  $('regex-del').addEventListener('click', deleteRegexEditor);
  // 世界书页
  $('lb-new').addEventListener('click', lbNew);
  $('lb-import').addEventListener('click', () => $('lb-import-file').click());
  $('lb-import-file').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('世界书文件超过 10 MB，拒绝导入');
      const report = importSTLorebookText(await file.text(), file.name);
      alert(`✅ 世界书已导入：「${report.name}」· ${report.entries} 条目`);
    } catch (error) {
      alert('❌ 世界书导入失败：' + error.message);
    } finally {
      event.target.value = '';
    }
  });
  $('lb-export').addEventListener('click', exportCurrentLorebook);
  $('lb-del').addEventListener('click', lbDelete);
  $('lb-rename').addEventListener('click', renameCurrentLB);
  ['lb-scan-depth', 'lb-budget', 'lb-max-recursion', 'lb-min-activations', 'lb-min-depth', 'lb-include-names', 'lb-case-sensitive', 'lb-whole-word', 'lb-recursive', 'lb-group-scoring', 'lb-strategy']
    .forEach(id => $(id).addEventListener('change', saveLorebookSettings));
  // 设置 tab
  document.querySelectorAll('.st-tab').forEach(b =>
    b.addEventListener('click', () => {
      document.querySelectorAll('.st-tab').forEach(x => {
        const active = x === b;
        x.classList.toggle('active', active);
        x.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      document.querySelectorAll('#settings-modal [id^="st-panel-"]').forEach(p => {
        const active = p.id === 'st-panel-' + b.dataset.st;
        p.classList.toggle('hidden', !active);
        p.toggleAttribute('hidden', !active);
      });
      const box = $('settings-modal').querySelector('.modal-box');
      if (box) box.scrollTop = 0;
    }));
  // 设置
  document.querySelectorAll('.js-settings').forEach(b => b.addEventListener('click', openSettings));
  $('btn-debug').addEventListener('click', () => $('debug-panel').open ? closeDebugTerminal() : openDebugTerminal());
  $('btn-devtools')?.addEventListener('click', () => $('devtools-panel')?.open ? closeDevtools() : openDevtools());
  const debugTabs = [...document.querySelectorAll('[data-debug-tab]')];
  debugTabs.forEach((button, index) => {
    button.addEventListener('click', () => selectDebugTab(button.dataset.debugTab));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? debugTabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + debugTabs.length) % debugTabs.length;
      debugTabs[next].focus();
      selectDebugTab(debugTabs[next].dataset.debugTab);
    });
  });
  $('rpg-end-world').addEventListener('click', endCurrentWorld);
  $('rpg-reopen-world').addEventListener('click', reopenCurrentWorld);
  $('rpg-summary-rebuild').addEventListener('click', rebuildWorldLineSummary);
  $('debug-close').addEventListener('click', closeDebugTerminal);
  $('debug-clear').addEventListener('click', clearDebugTerminal);
  $('debug-copy').addEventListener('click', copyDebugTerminal);
  $('debug-memory-rebuild').addEventListener('click', rebuildDebugMemory);
  $('debug-panel').addEventListener('cancel', e => { e.preventDefault(); closeDebugTerminal(); });
  $('debug-panel').addEventListener('click', e => { if (e.target === e.currentTarget) closeDebugTerminal(); });
  $('devtools-scenario')?.addEventListener('change', loadDevtoolsScenario);
  $('devtools-submit')?.addEventListener('click', runDevtoolsSubmit);
  $('devtools-copy-state')?.addEventListener('click', copyDevtoolsState);
  $('devtools-close')?.addEventListener('click', closeDevtools);
  $('devtools-panel')?.addEventListener('cancel', e => { e.preventDefault(); closeDevtools(); });
  $('devtools-panel')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeDevtools(); });
  // 模式切换：刷新快捷行动与 RPG 面板
  document.querySelectorAll('.js-mode-switch').forEach(button => button.addEventListener('click', switchMode));
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
  $('world-new-draft').addEventListener('click', openWorldDraftChoice);
  $('world-draft-open-existing').addEventListener('click', openSelectedWorldDraft);
  $('world-draft-create-blank').addEventListener('click', openBlankWorldDraft);
  $('world-draft-choice-close').addEventListener('click', closeWorldDraftChoice);
  $('world-draft-choice-cancel').addEventListener('click', closeWorldDraftChoice);
  $('world-draft-choice-dialog').addEventListener('cancel', e => { e.preventDefault(); closeWorldDraftChoice(); });
  $('world-draft-choice-dialog').addEventListener('click', e => { if (e.target === e.currentTarget) closeWorldDraftChoice(); });
  $('world-import').addEventListener('click', openWorldPackageImport);
  $('world-import-file').addEventListener('change', e => previewWorldPackageImport(e.target.files?.[0]));
  $('world-import-form').addEventListener('submit', async e => { e.preventDefault(); await commitWorldPackageImport(); });
  $('world-import-close').addEventListener('click', closeWorldPackageImport);
  $('world-import-cancel').addEventListener('click', closeWorldPackageImport);
  $('world-import-dialog').addEventListener('cancel', e => { e.preventDefault(); closeWorldPackageImport(); });
  $('world-import-dialog').addEventListener('click', e => { if (e.target === e.currentTarget) closeWorldPackageImport(); });
  $('world-export').addEventListener('click', exportCurrentWorldPackage);
  $('world-edit-draft').addEventListener('click', () => openWorldDraftEditor({ createNew: false }));
  $('world-lorebook-edit').addEventListener('click', () => openWorldDraftEditor({ createNew: false }));
  $('world-delete').addEventListener('click', event => deleteWorldCard(currentWorldId, event.currentTarget));
  $('world-draft-form').addEventListener('input', () => { worldDraftDirty = true; worldDraftPublishId = null; clearWorldDraftCheckReport(); });
  $('world-ui-load-template').addEventListener('click', loadWorldUiTemplate);
  $('world-extension-load-json').addEventListener('click', () => {
    const text = $('world-draft-ui').value.trim();
    let ui = {};
    if (text) {
      try { ui = JSON.parse(text); }
      catch { setWorldDraftStatus('RPG 界面配置不是有效 JSON，无法载入扩展。', 'error'); $('world-draft-ui').focus(); return; }
    }
    fillWorldDraftExtensionEditor(ui?.extension);
    worldDraftDirty = true;
    setWorldDraftStatus('已从高级 JSON 载入扩展字段，保存草稿后生效。', 'ok');
  });
  $('world-draft-map-regions').addEventListener('input', updateWorldDraftMapOutputs);
  $('world-draft-map-land').addEventListener('input', updateWorldDraftMapOutputs);
  $('world-draft-map-random').addEventListener('click', randomizeWorldDraftMapSeed);
  $('world-draft-map-preview').addEventListener('click', previewWorldDraftMap);
  $('world-draft-player-schema').addEventListener('input', () => { if (requireWorldDraftPlayerRawSync()) syncWorldDraftPlayerCreationFromForm(); worldDraftPlayerPreview(); });
  $('world-draft-player-schema').addEventListener('click', handleWorldDraftPlayerCreationClick);
  $('world-draft-player-creation').addEventListener('input', e => setWorldDraftJsonRawState(e.target));
  $('world-draft-player-validate-json').addEventListener('click', validateWorldDraftPlayerCreationJson);
  $('world-draft-player-load-json').addEventListener('click', loadWorldDraftPlayerCreationJson);
  for (const definition of WORLD_DRAFT_JSON_ARRAY_DEFS) {
    const editor = $(definition.editorId || `world-draft-${definition.key}-editor`);
    editor?.addEventListener('input', () => { if (requireWorldDraftJsonArraysRawSync()) syncWorldDraftJsonArraysFromForm(); worldDraftJsonArrayPreview(definition.key); });
    editor?.parentElement?.addEventListener('click', handleWorldDraftJsonArrayClick);
    const raw = $(definition.rawId || `world-draft-${definition.key}`);
    raw?.addEventListener('input', e => setWorldDraftJsonRawState(e.target));
    $(definition.validateId || `world-draft-${definition.key}-validate-json`)?.addEventListener('click', () => validateWorldDraftJsonArrayRaw(definition.key));
    $(definition.loadId || `world-draft-${definition.key}-load-json`)?.addEventListener('click', () => loadWorldDraftJsonArray(definition.key));
  }
  $('world-draft-add-location').addEventListener('click', addWorldDraftLocation);
  $('world-draft-add-npc').addEventListener('click', addWorldDraftNpc);
  $('world-draft-check').addEventListener('click', () => checkWorldDraftPublishability({ focus: true }));
  $('world-draft-check-report').addEventListener('click', event => {
    const button = event.target.closest('[data-world-draft-check-target]');
    if (button) focusWorldDraftCheckTarget(button.dataset.worldDraftCheckTarget);
  });
  $('world-draft-form').addEventListener('submit', async e => { e.preventDefault(); await saveWorldDraft(); });
  $('world-draft-publish').addEventListener('click', publishWorldDraft);
  $('world-draft-close').addEventListener('click', requestCloseWorldDraft);
  $('world-draft-cancel').addEventListener('click', requestCloseWorldDraft);
  $('world-draft-dialog').addEventListener('cancel', e => { e.preventDefault(); requestCloseWorldDraft(); });
  $('world-draft-dialog').addEventListener('click', e => { if (e.target === e.currentTarget) requestCloseWorldDraft(); });
  $('world-player-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = $('world-player-form');
    if (!form.reportValidity() || (!pendingWorldSaveName && !editingWorldPlayerSaveId)) return;
    const createButton = $('world-player-create');
    const worldButton = pendingWorldSaveButton;
    createButton.disabled = true;
    setWorldPlayerStatus('正在创建独立存档…');
    try {
      const player = collectWorldPlayerInput();
      if (editingWorldPlayerSaveId && currentWorldSave?.id === editingWorldPlayerSaveId) {
        const response = await fetch('/api/world-saves/' + encodeURIComponent(currentWorldSave.id) + '/setup', { method: 'PUT', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ commandId: 'player-' + uid(), expectedRevision: currentWorldSave.revision, player, playerPresetId: $('world-player-preset')?.value || currentWorldSave.setup?.playerPresetId || '', game: currentWorldSave.setup?.game || {}, plan: currentWorldSave.setup?.plan || null }) });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(worldApiError(data, '角色保存失败（HTTP ' + response.status + '）'));
        hydrateWorldSave(data); currentWorldSave = data;
        closeWorldPlayerDialog('updated'); renderWorldOpeningDialog(currentWorldSave); $('world-opening-dialog').showModal();
      } else {
        await createWorldSave(pendingWorldSaveName, player, $('world-player-preset')?.value || pendingWorldPlayerPresetId);
        const input = $('world-save-name');
        if (input) input.value = '';
        closeWorldPlayerDialog('created');
        const status = $('world-open-status');
        if (status) status.textContent = `已创建存档「${currentWorldSave.name}」；完成开局配置并确认后才会开始 RPG。`;
        enterWorldWorkspace();
        if (worldSavePlanning()) openWorldOpeningDialog(currentWorldSave);
      }
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
  $('world-opening-form').addEventListener('submit', async e => {
    e.preventDefault();
    try { await saveWorldOpeningPlan(); }
    catch (err) { $('world-opening-status').textContent = err.message; }
  });
  $('world-player-ai-basic').addEventListener('click', aiFillWorldPlayerBasic);
  $('world-player-ai-full').addEventListener('click', aiFillWorldPlayerFull);
  $('world-player-preset').addEventListener('change', () => {
    const world = currentWorldCard();
    if (!world || editingWorldPlayerSaveId) return;
    pendingWorldPlayerPresetId = $('world-player-preset').value || '';
    renderWorldPlayerForm(world, 'world-player-fields', worldPlayerWithPreset(world, pendingWorldPlayerPresetId));
    setWorldPlayerStatus(pendingWorldPlayerPresetId ? '已套用预设；仍可继续让 AI 填写或手动修改。' : '已切换为自定义配置。');
  });
  $('world-save-preset').addEventListener('change', () => { pendingWorldPlayerPresetId = $('world-save-preset').value || ''; });
  $('world-opening-confirm').addEventListener('click', confirmWorldOpeningCandidate);
  $('world-opening-edit-player').addEventListener('click', () => { closeWorldOpeningDialog(); openWorldPlayerEditor(currentWorldSave); });
  $('world-opening-regenerate').addEventListener('click', async () => {
    if (!currentWorldSave || worldOpeningGeneration) return;
    currentWorldSave.setup.candidate = null;
    renderWorldOpeningDialog(currentWorldSave);
    try { await saveWorldOpeningPlan(); }
    catch (err) { $('world-opening-status').textContent = err.message; }
  });
  $('world-opening-npcs').addEventListener('change', () => { const plan = collectWorldOpeningPlan(); renderWorldOpeningNpcContexts(plan); });
  $('world-opening-close').addEventListener('click', closeWorldOpeningDialog);
  $('world-opening-cancel').addEventListener('click', closeWorldOpeningDialog);
  $('world-opening-dialog').addEventListener('cancel', e => { e.preventDefault(); closeWorldOpeningDialog(); });
  $('world-opening-dialog').addEventListener('click', e => { if (e.target === e.currentTarget) closeWorldOpeningDialog(); });
  $('world-opening-dialog').addEventListener('input', e => { if (!e.target.closest('#world-opening-candidate')) { renderWorldOpeningConfirmSummary(currentWorldSave, collectWorldOpeningPlan()); scheduleWorldSetupAutosave(); } });
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
      const bypassGate = worldEntryGateBypass;
      worldEntryGateBypass = false;
      if (!bypassGate && await openWorldEntryGate(name, btn)) return;
      const created = await openWorldPlayerCreation(name, btn);
      if (created) {
        input.value = '';
        const status = $('world-open-status');
        if (status) status.textContent = `已创建并打开「${currentWorldSave.name}」——世界状态、地图和叙事已绑定当前存档；当前存档 ID：${currentWorldSave.id}`;
        enterWorldWorkspace();
        if (worldSavePlanning()) openWorldOpeningDialog(currentWorldSave);
      }
    } catch (err) {
      showWorldError(err.message);
      input.focus();
    } finally {
      if (!$('world-player-dialog')?.open) btn.disabled = false;
      btn.textContent = old;
    }
  });
  $('world-close').addEventListener('click', () => {
    if (isMobileViewport() && $('world-mgr')?.dataset.mobilePanel === 'detail') {
      setMobileManagerPanel('world-mgr', 'list', { focus: false });
      requestAnimationFrame(() => $('world-list')?.querySelector('[data-world-id]')?.focus());
      return;
    }
    exitWorldImmersiveMode();
    if (mode === 'rpg' && worldModeActive()) {
      closeWorldLibrary();
      enterWorldWorkspace();
      syncModeNavigation('chat');
      return;
    }
    if (mode === 'rpg' && !worldModeActive()) {
      closeWorldLibrary();
      renderMessages();
      syncModeNavigation('chat');
      return;
    }
    closeWorldLibrary();
    switchView('chat');
  });
  $('memory-open-entries')?.addEventListener('click', openMobileMemoryEntries);
  $('world-entry-gate-form')?.addEventListener('submit', e => { e.preventDefault(); confirmWorldEntryGate(); });
  $('world-entry-gate-cancel')?.addEventListener('click', closeWorldEntryGate);
  $('world-entry-gate-dialog')?.addEventListener('cancel', e => { e.preventDefault(); closeWorldEntryGate(); });
  $('world-entry-gate-dialog')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeWorldEntryGate(); });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && worldImmersiveSession) exitWorldImmersiveMode();
    else if (!document.fullscreenElement) document.body.classList.remove('world-immersive');
  });
  document.querySelectorAll('[data-rpg-drawer]').forEach(button => button.addEventListener('click', () => setRpgMobileDrawer(button.dataset.rpgDrawer)));
  document.querySelectorAll('[data-rpg-drawer-close]').forEach(button => button.addEventListener('click', () => setRpgMobileDrawer('')));
  $('rpg-mobile-scrim')?.addEventListener('click', () => setRpgMobileDrawer(''));
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (worldImmersiveSession) {
      const escapeMode = worldUiShell().escape;
      if (escapeMode === 'none') return;
      e.preventDefault();
      e.stopPropagation();
      if (escapeMode === 'world') {
        exitWorldImmersiveMode();
        setWorldCustomLayout(false);
        clearWorldExtension();
        openWorldLibrary(false);
        return;
      }
      exitWorldImmersiveMode();
      return;
    }
    if (document.body.dataset.rpgDrawer) setRpgMobileDrawer('');
  });
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeSettings));
  $('btn-test-image').addEventListener('click', testImageGen);
  $('settings-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeSettings(); });
  // 热保存：排版控件拖动即时预览（防抖写盘）；任意设置 change 即读取并保存，不再依赖「保存」按钮
  let typoSaveTimer = null;
  $('settings-modal').addEventListener('input', e => {
    if (!e.target.closest || !e.target.closest('#st-panel-typo')) return;
    readTypographyForm();
    clearTimeout(typoSaveTimer);
    typoSaveTimer = setTimeout(() => saveJSON(LS_PREFS, prefs), 400);
  });
  $('settings-modal').addEventListener('change', e => {
    if (e.target.closest && e.target.closest('#st-panel-typo')) {
      clearTimeout(typoSaveTimer);
      saveJSON(LS_PREFS, prefs);
      return;
    }
    readSettingsForm();
    renderMessages();
  });
  $('btn-typo-reset').addEventListener('click', resetTypography);
  $('g-gen-save').addEventListener('click', () => { if (readGenerationForm()) renderMessages(); });
  $('g-gen-reset').addEventListener('click', resetGenerationForm);
  $('btn-save-settings').addEventListener('click', () => { if (readSettingsForm() === false) return; closeSettings(); renderMessages(); });
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
  cfgFileInput.id = 'settings-import-file';
  cfgFileInput.name = 'settingsImportFile';
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
  charFileInput.id = 'character-import-file';
  charFileInput.name = 'characterImportFile';
  charFileInput.type = 'file';
  charFileInput.accept = '.json,.png,application/json,image/png';
  charFileInput.style.display = 'none';
  charFileInput.addEventListener('change', () => {
    const file = charFileInput.files[0];
    if (!file) return;
    const fileName = file.name;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = importCharOrLorebookFromBuffer(reader.result, fileName);
        if (result.kind === 'lorebook') {
          switchView('lore');
          alert(`✅ 检测到这是 ST 世界书，已导入「${result.report.name}」· ${result.report.entries} 条目`);
        } else {
          const report = result.report;
          alert(report?.lorebook?.created
            ? `✅ 角色卡已导入；内嵌世界书已注册为「${report.lorebook.name}」`
            : '✅ 角色卡已导入');
        }
      }
      catch (err) { alert('❌ 导入失败：' + err.message); }
    };
    reader.readAsArrayBuffer(file);
    charFileInput.value = '';
  });
  document.body.appendChild(charFileInput);
  // 回到对话
  document.querySelectorAll('[data-back-chat]').forEach(b =>
    b.addEventListener('click', () => handleManagerBack(b)));
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
  // 从 server 加载默认模板（服务预设 / 格式指令 / 偏好），失败回退空结构
  defaults = await fetchDefaults();
  if (!defaults) defaults = { characters: [], presets: {}, lorebooks: {}, settings: {}, prefs: {}, format: {}, providers: [] };
  providers = Array.isArray(defaults.providers) ? defaults.providers : [];
  formatInstructions = (defaults.format && typeof defaults.format === 'object') ? defaults.format : {};

  settings = { ...DEFAULT_SETTINGS, ...settings };
  prefs = { ...(defaults.prefs || {}), ...prefs };
  genSettings = { ...(defaults.gen || {}), ...genSettings };

  // 从 server 加载 JSON 数据（失败回退本地缓存）
  const [chars, presets, lore, s, u, srvSessions, g] = await Promise.all([
    loadServerData('characters'),
    loadServerData('presets'),
    loadServerData('lorebooks'),
    loadServerData('settings'),
    loadServerData('user'),
    loadServerData('sessions'),
    loadServerData('gen'),
  ]);
  if (chars && Array.isArray(chars)) characters = chars;
  if (presets && typeof presets === 'object') promptPresets = presets;
  if (lore && typeof lore === 'object') lorebooks = lore;
  if (u && typeof u === 'object' && u.presets) userData = u;
  if (s && typeof s === 'object') settings = { ...DEFAULT_SETTINGS, ...s };
  if (g && typeof g === 'object' && !Array.isArray(g)) genSettings = { ...(defaults.gen || {}), ...g };
  saveGenerationSettings();
  // 会话与 server 合并（首次迁移 / 跨浏览器取并集），必须在 ensureSessions 之前
  syncSessionsFromServer(srvSessions);

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
  ensureCharacterBookLorebooks();
  renderBindSelects();
  ensureEntryIds();
  // 清理旧版遗留的纯占位角色
  if (characters.length && characters.every(c => !c.name || c.name === '？？？')) {
    characters = [];
    currentCharId = null;
    localStorage.removeItem(LS_CURRENT_CHAR);
    saveChars();
  }
  let presetsMigrated = ensurePromptPresetsV2();
  if (migrateBuiltInTavernPreset(defaults)) presetsMigrated = true;
  prefs.currentPresetByMode = { ...(prefs.currentPresetByMode || {}) };
  for (const targetMode of ['tavern', 'rpg']) {
    const hasSavedPreset = Object.prototype.hasOwnProperty.call(prefs.currentPresetByMode, targetMode);
    const savedPreset = prefs.currentPresetByMode[targetMode];
    if (!hasSavedPreset || (savedPreset && !promptPresets[savedPreset])) prefs.currentPresetByMode[targetMode] = activePresetNameForMode(targetMode);
  }
  prefs.currentPreset = prefs.currentPresetByMode[mode] || '';
  saveJSON(LS_PREFS, prefs);
  if (presetsMigrated) savePresets();
  applyTypography(); // 启动即恢复用户排版（覆盖 :root 默认变量）
  ensureSessions();
  applyTheme();
  applyMode(mode);
  bindEvents();
  renderMessages();
  renderCharacter();
  renderSessions();
  renderCharList();
  renderDevtools();
  updateApiStatusFromSettings();
}
init();
