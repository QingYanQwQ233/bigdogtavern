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
let worldWorkspaceActive = false;
let worldSavesByWorld = new Map();
let worldLoadToken = 0;
let worldSaveWriteChain = Promise.resolve();
let worldSavePending = null;
let worldTurnPending = null;
let worldSummaryPending = false;
let worldTurnError = null;
let worldTurnPreparing = false;
let worldTurnEpoch = 0;
let rpgCheckAnimation = null;
// AI 正文已完成、协议/状态仍在收尾时的临时预览；不进入历史，提交成功后原子替换。
let responsePreview = null;
const WORLD_TURN_AUTO_RETRY_MAX = 1;
const WORLD_STATE_FEEDBACK_EXIT_MS = 180;
let worldStateFeedback = { saveId: null, token: 0, changes: new Map(), exiting: false };
let worldDraft = null;
let worldDraftDirty = false;
let worldDraftOpener = null;
let worldDraftChoiceOpener = null;
let worldDraftPublishId = null;
let worldDraftRouteLoadToken = 0;
const APP_DOCUMENT_TITLE = document.title;
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
// ponytail: 仅在超长会话窗口化，保留“加载更早消息”入口；短会话继续走原渲染路径。
const MESSAGE_RENDER_WINDOW_SIZE = 120;
const MESSAGE_RENDER_WINDOW_STEP = 80;
let messageRenderWindow = { key: '', start: 0, preserveScroll: false };
let theme = FIXED_THEME;
let mode = localStorage.getItem(LS_MODE) || 'tavern'; // 'tavern' 酒馆模式 | 'rpg' RPG 模式
let sending = false;
let activeRequestController = null;
let requestAbortRequested = false;
// 83 版 WebView 缺少 at / Object.hasOwn / replaceChildren。函数体保持 ES5，供隔离 iframe 原样注入。
function webview83CompatBootstrap() {
  if (typeof Array.prototype.at !== 'function') {
    Object.defineProperty(Array.prototype, 'at', {
      configurable: true,
      writable: true,
      value: function(index) {
        'use strict';
        if (this === null || this === undefined) throw new TypeError('Cannot convert undefined or null to object');
        var length = Number(this.length) || 0;
        var integer = Number(index);
        if (isNaN(integer) || integer === 0) integer = 0;
        integer = integer < 0 ? Math.ceil(integer) : Math.floor(integer);
        var actual = integer < 0 ? length + integer : integer;
        return actual < 0 || actual >= length ? undefined : this[actual];
      },
    });
  }
  if (typeof Object.hasOwn !== 'function') {
    Object.hasOwn = function(object, property) {
      if (object === null || object === undefined) throw new TypeError('Cannot convert undefined or null to object');
      return Object.prototype.hasOwnProperty.call(object, property);
    };
  }
  if (typeof Element !== 'undefined' && typeof Element.prototype.replaceChildren !== 'function') {
    Element.prototype.replaceChildren = function() {
      var index;
      while (this.firstChild) this.removeChild(this.firstChild);
      for (index = 0; index < arguments.length; index += 1) {
        var child = arguments[index];
        this.appendChild(child && typeof child.nodeType === 'number' ? child : document.createTextNode(String(child)));
      }
    };
  }
}
function webview83CompatSource() {
  return `(${webview83CompatBootstrap.toString()}());`;
}
// 仅本页内存、按 session.id 隔离；完整 Prompt 不写入角色、会话或世界存档。
const debugTraces = new Map();
const debugTraceSelection = new Map();
const DEBUG_TRACE_HISTORY_LIMIT = 120;
const debugMemoryDiagnostics = new Map(); // 仅内存、按 save.id 隔离，不写入世界存档
const debugMemoryPending = new Set();
// ponytail: 事件账本只保留最近 96 条摘要，避免长回合把调试内存变成第二份聊天记录。
const rpgAgentRequestSessions = new WeakMap();
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
let worldExtensionState = { iframe: null, nonce: '', signature: '', ready: false, timer: null, pending: new Map(), nextRequestId: 0, surface: 'play' };
const worldExtensionDeniedApprovals = new Set();
const cardScriptDeniedApprovals = new Set();
const tavernMemoryPending = new Set();
const tavernMemoryStatus = new Map();

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
