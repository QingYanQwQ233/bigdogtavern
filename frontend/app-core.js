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
const PRESET_SCHEMA_VERSION = 3;
// SillyTavern Prompt Manager separates pinned/default prompts from runtime markers.
// The third tuple value is true only when content comes from the active chat/card at request time.
const PRESET_MARKERS = [
  ['main', '主提示词', false],
  ['worldInfoBefore', '世界书（前）', true],
  ['personaDescription', '玩家设定', true],
  ['charDescription', '角色描述', true],
  ['charPersonality', '角色性格', true],
  ['scenario', '场景', true],
  ['enhanceDefinitions', '增强定义', false],
  ['nsfw', '辅助提示词', false],
  ['tavernMemory', '记忆', true],
  ['tavernRpg', 'RPG 状态与协议', true],
  ['worldInfoAfter', '世界书（后）', true],
  ['dialogueExamples', '对话示例', true],
  ['chatHistory', '聊天历史', true],
  ['jailbreak', '历史后指令', false],
];
const PRESET_MARKER_IDS = new Set(PRESET_MARKERS.filter(([, , runtime]) => runtime).map(([id]) => id));
const PRESET_PINNED_IDS = new Set(PRESET_MARKERS.map(([id]) => id));
const ST_PRESET_SETTING_KEYS = Object.freeze([
  'temperature', 'frequency_penalty', 'presence_penalty', 'top_p', 'top_k', 'top_a', 'min_p',
  'repetition_penalty', 'openai_max_context', 'openai_max_tokens', 'max_tokens', 'max_completion_tokens',
  'stop', 'seed', 'n', 'stream', 'stream_openai', 'reasoning_effort', 'verbosity',
  'assistant_prefill', 'continue_prefill', 'continue_postfix', 'custom_prompt_post_processing',
  'wi_format', 'scenario_format', 'personality_format', 'new_chat_prompt', 'new_group_chat_prompt',
  'new_example_chat_prompt', 'continue_nudge_prompt', 'group_nudge_prompt', 'names_behavior',
  'send_if_empty', 'squash_system_messages', 'use_sysprompt', 'media_inlining',
  'chat_completion_source', 'openai_model', 'claude_model', 'openrouter_model', 'google_model',
  'vertexai_model', 'mistralai_model', 'custom_model',
]);


/* 风格主题（色调）——UI 设计配置，保留在代码（驱动 CSS 变量） */
const FIXED_THEME = 'vibrancy';

const DEFAULT_SETTINGS = {
  preset: '', baseUrl: '', apiKey: '', model: '',
  temperature: 0.9, maxTokens: 32000,
  topP: 1, frequencyPenalty: 0, presencePenalty: 0, seed: -1,
  history: 20, stream: true,
  promptCache: { cacheKey: '', includeUsage: false },
  firstMes: '',
  toast: { bg: '#1c1c1e', fg: '#f2f2f7', accent: '#77e6d5', success: '#30d158', warning: '#ffd60a', error: '#ff453a', fontSize: 13, padding: 'normal', speed: 'normal', shape: 'pill', max: 2 },
};

/* 服务预设 / 界面偏好：从 public/data/_defaults.json 加载，代码不写死 */
let defaults = null;
let providers = [];        // [{ id, label, baseUrl, model }]

/* 空状态提示：从 _defaults.json 的 ui 段读取模板，{name}/{role} 插值当前角色，不写死文案 */
function buildGuide() {
  const ui = (defaults && defaults.ui) || {};
  if (mode === 'rpg') {
    if (!worldModeActive()) return 'RPG 模式不读取普通角色卡，请先从世界库创建或打开世界存档。';
    return String(ui.rpgEmptyGuide || '当前存档：{save}。RPG 叙事只读取这条世界线。')
      .replace('{save}', currentWorldSave?.name || currentWorldSaveId || '当前世界存档');
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
// 回合级提示（如动作判定缺失警告）：显示在玩家行动区，新回合开始时清除。
let worldActionNotice = '';
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
// ponytail: 仅在超长会话窗口化，保留“加载更早消息”入口；短会话继续走原渲染路径。
const MESSAGE_RENDER_WINDOW_SIZE = 120;
const MESSAGE_RENDER_WINDOW_STEP = 80;
let messageRenderWindow = { key: '', start: 0, preserveScroll: false, stickToLatest: false };
let theme = FIXED_THEME;
// ST（酒馆）模式已移除，应用固定为 RPG 单模式。LS_MODE 已无读取方，
// 旧存档里的 'tavern' 一并改写，避免留下一个指向已删除模式的化石值。
let mode = 'rpg';
if (localStorage.getItem(LS_MODE) !== mode) localStorage.setItem(LS_MODE, mode);
let sending = false;
let activeRequestController = null;
let requestAbortRequested = false;
// 旧内核缺少 at / Object.hasOwn / replaceChildren。函数体保持 ES5：既供隔离 iframe 原样注入，
// 也作为低于最低内核版本时的 JS 降级层（内核过旧的用户关闭提示后仍可继续使用）。
/* 应用内浮层提示（灵动岛式）：替代零散的内联状态文字与原生 alert。
 * kind: '' | 'success' | 'error'；action: { label, onClick }；duration: ms（0 = 不自动关闭）
 * 错误带 role=alert 并停留更久；支持手动关闭与 Esc。 */
/* 普通层浮层（灵动岛、应用内弹窗、设置面板）必须浮在模态 <dialog> 之上。
   <dialog> 用 showModal() 打开时会进浏览器的 top layer，普通 fixed 层哪怕 z-index 上万也压不住它 ——
   表现就是“点了没反应 / 提示被挡住”。统一策略：显示前把浮层容器挪进【最后打开】那个 dialog（同处 top layer），
   dialog 关闭时再挪到下一个还开着的 dialog（没有就回 body）。 */
const OVERLAY_IDS = ['toast-host', 'dialog-host', 'settings-modal'];
let overlayReturnBound = false;
let activeOverlayDialog = null;
function topMostDialog() {
  const list = document.querySelectorAll('dialog[open]');
  if (!list.length) return null;
  // 最近打开的那个还开着的话，它就在 top layer 最上面
  if (activeOverlayDialog && activeOverlayDialog.open) return activeOverlayDialog;
  return list[list.length - 1];
}
function bindOverlayReturn() {
  if (overlayReturnBound) return;
  overlayReturnBound = true;
  // dialog 的 open / close 都不冒泡，要在捕获阶段听
  document.addEventListener('open', (event) => {
    if (event.target && event.target.tagName === 'DIALOG') activeOverlayDialog = event.target;
  }, true);
  document.addEventListener('close', (event) => {
    const target = event.target;
    if (!target || target.tagName !== 'DIALOG') return;
    if (activeOverlayDialog === target) activeOverlayDialog = null;
    const list = document.querySelectorAll('dialog[open]');
    activeOverlayDialog = list.length ? list[list.length - 1] : null;
    const dest = activeOverlayDialog || document.body;
    OVERLAY_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.parentElement && el.parentElement.tagName === 'DIALOG') dest.appendChild(el);
    });
  }, true);
}
function raiseOverlay(el) {
  if (!el) return el;
  bindOverlayReturn();
  const target = topMostDialog() || document.body;
  if (el.parentElement !== target) target.appendChild(el);
  return el;
}
/* ─────────── 灵动岛（消息胶囊）外观 ───────────
   颜色 / 字号 / 内边距 / 样式 / 动画速度 / 同屏数量都由设置决定，
   统一落到 :root 的 CSS 变量上；档位取值都落在设计刻度内。 */
const TOAST_PADDING = { tight: { y: 6, x: 10 }, compact: { y: 8, x: 12 }, normal: { y: 10, x: 16 }, loose: { y: 12, x: 20 }, loose2: { y: 16, x: 24 } };
const TOAST_SHAPE_RADIUS = { pill: 999, round: 16, soft: 12, sharp: 8, square: 0 };
const TOAST_SPEED_FACTOR = { slow: 1.6, normal: 1, fast: 0.6 };
/* 定时器要比动画晚一步，否则动画会被截断。250/300 是入场/退场基准。 */
const TOAST_DURATIONS = {
  slowest: { in: 600, out: 800, clear: 1000, pulse: 600 },
  slow: { in: 400, out: 480, clear: 640, pulse: 400 },
  normal: { in: 250, out: 300, clear: 400, pulse: 250 },
  fast: { in: 150, out: 200, clear: 250, pulse: 150 },
  fastest: { in: 100, out: 150, clear: 200, pulse: 100 },
};
function toastConfig() {
  const raw = (settings && settings.toast) || {};
  return {
    bg: String(raw.bg || '#1c1c1e'),
    fg: String(raw.fg || '#f2f2f7'),
    accent: String(raw.accent || '#77e6d5'),
    success: String(raw.success || '#30d158'),
    warning: String(raw.warning || '#ffd60a'),
    error: String(raw.error || '#ff453a'),
    fontSize: Number(raw.fontSize) || 13,
    padding: TOAST_PADDING[raw.padding] ? raw.padding : 'normal',
    speed: TOAST_DURATIONS[raw.speed] ? raw.speed : 'normal',
    shape: TOAST_SHAPE_RADIUS[raw.shape] !== undefined ? raw.shape : 'pill',
    max: Math.max(1, Math.min(10, Number(raw.max) || 2)),
  };
}
function toastDurations() {
  return TOAST_DURATIONS[toastConfig().speed] || TOAST_DURATIONS.normal;
}
/* #rrggbb -> rgba(r, g, b, a)；解析失败时返回兜底色（背景仍可读）。 */
function toastRgba(hex, alpha, fallback) {
  const m = String(hex || '').trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
function applyToastTheme() {
  const cfg = toastConfig();
  const pad = TOAST_PADDING[cfg.padding];
  const root = document.documentElement;
  if (!root) return;
  const d = toastDurations();
  root.style.setProperty('--toast-bg', toastRgba(cfg.bg, 0.92, 'rgba(28, 28, 30, 0.92)'));
  root.style.setProperty('--toast-border', toastRgba(cfg.accent, 0.45, 'rgba(255, 255, 255, 0.12)'));
  root.style.setProperty('--toast-accent', cfg.accent);
  root.style.setProperty('--toast-fg', cfg.fg);
  root.style.setProperty('--toast-font-size', cfg.fontSize + 'px');
  root.style.setProperty('--toast-pad-y', pad.y + 'px');
  root.style.setProperty('--toast-pad-x', pad.x + 'px');
  root.style.setProperty('--toast-radius', TOAST_SHAPE_RADIUS[cfg.shape] + 'px');
  /* 每种提示类型一套色：文字/图标用实色，边框用同色低透明度 */
  [['success', 0.55], ['warning', 0.55], ['error', 0.55]].forEach(([key, alpha]) => {
    root.style.setProperty('--toast-' + key, cfg[key]);
    root.style.setProperty('--toast-' + key + '-border', toastRgba(cfg[key], alpha, cfg[key]));
  });
  root.style.setProperty('--toast-in', d.in + 'ms');
  root.style.setProperty('--toast-out', d.out + 'ms');
  root.style.setProperty('--toast-pulse', d.pulse + 'ms');
}
function showToast(message, options = {}) {
  // 每次弹出前同步一次外观：设置改完立刻生效，不必等重启。
  applyToastTheme();
  raiseOverlay($('toast-host'));
  const host = $('toast-host');
  if (!host || !message) return null;
  // 同屏最多两条。超量的旧胶囊走正规退场（有高度过渡），直接 remove 会让下面那条跳一下
  Array.prototype.slice.call(host.children).forEach(k => {
    if (k.classList.contains('toast-out')) k.remove(); // 已退场中的：直接清掉，避免和新胶囊抢位置
  });
  if (host.children.length >= toastConfig().max) {
    const oldest = host.firstElementChild;
    if (typeof oldest._dismiss === 'function') oldest._dismiss();
    else oldest.remove();
  }
  const toast = document.createElement('div');
  const body = document.createElement('span');
  body.className = 'toast-msg';
  toast.appendChild(body);
  let iconEl = null;
  let timer = null;
  let sizeClearTimer = null;
  let kind = '';
  let closeEl = null;
  const dismiss = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (toast.classList.contains('toast-out')) return;
    if (sizeClearTimer) { clearTimeout(sizeClearTimer); sizeClearTimer = null; }
    const h = toast.offsetHeight;
    if (!h) { toast.remove(); return; } // 还没布局就被收起，直接清掉
    // 先把高度与间距锁成像素值，再过渡到 0/-gap：直接 remove 的话，
    // 下方那条胶囊会“瞬移”上去（上方卡片收起时看着很鬼畜）。
    const gap = parseFloat(getComputedStyle(host).rowGap) || 0;
    toast.style.width = '';
    toast.style.height = h + 'px';
    toast.style.marginBottom = '0px';
    toast.classList.add('toast-out');
    requestAnimationFrame(() => {
      toast.style.height = '0px';
      toast.style.marginBottom = (-gap) + 'px';
    });
    // 要比退场动画（300ms）晚一步，确保动画播完再摘
    setTimeout(() => toast.remove(), toastDurations().clear);
  };
  // 按内容重绘图标 / 语义 / 计时。切换内容时复用同一个元素：
  // 否则「旧的还在淡出、新的已入场」两条胶囊会互相挤，看起来像抽搐。
  const paint = (text, nextKind, nextOptions = {}) => {
    const iconText = nextKind === 'error' ? '⚠' : (nextKind === 'warning' ? '!' : (nextKind === 'success' ? '✓' : ''));
    if (iconText && nextOptions.icon !== false) {
      if (!iconEl) {
        iconEl = document.createElement('span');
        iconEl.className = 'toast-icon';
        iconEl.setAttribute('aria-hidden', 'true');
        toast.insertBefore(iconEl, body);
      }
      iconEl.textContent = iconText;
    } else if (iconEl) {
      iconEl.remove();
      iconEl = null;
    }
    body.textContent = String(text);
    kind = nextKind || '';
    toast.className = 'toast' + (kind ? ' toast-' + kind : '');
    toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    // 单行放不下就切成宽条多行（宽度恒定）——判定必须先按“满宽单行”量：
    // 若拿当前 fit-content 宽度去量，短提示也会被误判为放不下，宽度平滑伸缩就白白没有了。
    // 必须放在 className 赋值之后，否则会被覆盖掉。
    toast.classList.remove('is-multiline');
    const keepWidth = toast.style.width;
    toast.style.width = '100%';
    const singleLineOverflows = body.scrollWidth > body.clientWidth + 1;
    toast.style.width = keepWidth;
    if (singleLineOverflows) toast.classList.add('is-multiline');
    if (timer) { clearTimeout(timer); timer = null; }
    const duration = nextOptions.duration ?? (kind === 'error' ? 8000 : 3200);
    if (duration > 0 && toast.isConnected) timer = setTimeout(dismiss, duration);
  };
  // 原地换内容：胶囊宽度用 FLIP 平滑跟随，避免宽度瞬间跳变挂一下
  const update = (text, nextOptions = {}) => {
    if (!toast.isConnected) return showToast(text, nextOptions);
    // 量旧尺寸 -> 文字隐去 -> 换内容并量新尺寸 -> 从旧尺寸过渡到新尺寸。
    // 重排发生在文字不可见的那一瞬间，所以既拿得到平滑的伸缩/长高，
    // 也不会看到文字在中间宽度里反复换行（那才是“抽”的来源）。
    if (sizeClearTimer) { clearTimeout(sizeClearTimer); sizeClearTimer = null; }
    toast.style.width = '';
    toast.style.height = '';
    toast.style.marginBottom = '';
    const prevText = body.textContent;
    const firstW = toast.offsetWidth;
    const firstH = toast.offsetHeight;
    body.style.opacity = '0';
    void body.offsetWidth; // 让“隐去”先落地，否则与下一步合并成同一帧
    paint(text, nextOptions.kind === undefined ? kind : nextOptions.kind, nextOptions);
    setAction(nextOptions.action);
    const lastW = toast.offsetWidth;
    const lastH = toast.offsetHeight;
    if (Math.abs(lastW - firstW) > 1 || Math.abs(lastH - firstH) > 1) {
      toast.style.width = firstW + 'px';
      toast.style.height = firstH + 'px';
      void toast.offsetWidth; // 强制一次布局，让尺寸过渡有起点
      toast.style.width = lastW + 'px';
      toast.style.height = lastH + 'px';
      sizeClearTimer = setTimeout(() => {
        toast.style.width = '';
        toast.style.height = '';
        sizeClearTimer = null;
      }, toastDurations().clear);
    }
    body.style.opacity = ''; // .toast-msg 的 transition 会把它淡回来
    // 文字没变就不放脉冲：快速连发同一条提示时，反复动一下反而像在抽
    if (prevText !== String(text)) {
      toast.classList.remove('is-updating');
      void toast.offsetWidth;
      toast.classList.add('is-updating');
      setTimeout(() => toast.classList.remove('is-updating'), toastDurations().pulse);
    }
    return handle;
  };
  const handle = { dismiss, update, element: toast };
  toast._dismiss = dismiss; // 同屏超量时让外部也能走正规退场
  // 操作按钮（如“去设置”）：原地换内容时也要能补上 / 换掉，所以抽成函数
  const setAction = (action) => {
    const existing = toast.querySelector('.toast-action');
    if (existing) existing.remove();
    if (!action || !action.label) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => { dismiss(); action.onClick?.(); });
    if (closeEl && closeEl.parentElement === toast) toast.insertBefore(btn, closeEl);
    else toast.appendChild(btn);
  };
  if (options.closable !== false) {
    closeEl = document.createElement('button');
    closeEl.type = 'button';
    closeEl.className = 'toast-close';
    closeEl.setAttribute('aria-label', '关闭提示');
    closeEl.textContent = '✕';
    closeEl.addEventListener('click', dismiss);
    toast.appendChild(closeEl);
  }
  host.appendChild(toast);
  setAction(options.action);
  paint(message, options.kind, options);
  // 入场也要“长出来”：直接占满高度的话，新胶囊会把下面那条一帧推开（连发时最明显）
  const enterH = toast.offsetHeight;
  if (enterH) {
    const enterGap = parseFloat(getComputedStyle(host).rowGap) || 0;
    toast.style.height = '0px';
    toast.style.marginBottom = (-enterGap) + 'px';
    void toast.offsetHeight;
    toast.style.height = enterH + 'px';
    toast.style.marginBottom = '0px';
    sizeClearTimer = setTimeout(() => {
      toast.style.height = '';
      toast.style.marginBottom = '';
      sizeClearTimer = null;
    }, toastDurations().clear);
  }
  // 紧跟着上一条出现时改用轻快的淡入（在 paint 之后加，否则会被 className 覆盖）
  const now = Date.now();
  if (now - lastToastEnterAt < 250) toast.classList.add('is-quick');
  lastToastEnterAt = now;
  return handle;
}
/* ─────────── 应用内对话框（替代原生 alert / confirm / prompt） ───────────
   原生对话框在 WebView 里样式不可控、出现位置随内核变化，用户容易错过；
   这里统一成应用内浮层。alert 的语义是「告知」，做成不阻塞的浮层（不要求调用方 await）；
   confirm / prompt 需要用户选择，返回 Promise。宿主缺失时退回原生，功能不丢。 */
let appDialogSeq = 0;
function openAppDialog(options = {}) {
  const mode = options.mode || 'alert';
  return new Promise(resolve => {
    const host = $('dialog-host');
    const message = String(options.message == null ? '' : options.message);
    if (!host) {
      if (mode === 'confirm') return resolve(typeof window.confirm === 'function' ? window.confirm(message) : true);
      if (mode === 'prompt') return resolve(typeof window.prompt === 'function' ? window.prompt(message, options.defaultValue || '') : null);
      if (typeof window.alert === 'function') window.alert(message);
      return resolve(true);
    }
    raiseOverlay(host);
    const kind = options.kind || '';
    const titleId = 'dialog-title-' + (++appDialogSeq);
    const veil = document.createElement('div');
    veil.className = 'dialog-veil';
    const card = document.createElement('section');
    card.className = 'dialog-card' + (kind ? ' dialog-' + kind : '');
    card.setAttribute('role', kind === 'error' ? 'alertdialog' : 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', titleId);
    const title = document.createElement('h2');
    title.className = 'dialog-title';
    title.id = titleId;
    title.textContent = options.title || (kind === 'error' ? '出错了' : kind === 'success' ? '已完成' : '提示');
    card.appendChild(title);
    const body = document.createElement('p');
    body.className = 'dialog-body';
    body.textContent = message;
    card.appendChild(body);
    let inputEl = null;
    if (mode === 'prompt') {
      inputEl = document.createElement('input');
      inputEl.type = 'text';
      inputEl.className = 'dialog-input';
      inputEl.value = options.defaultValue == null ? '' : String(options.defaultValue);
      if (options.placeholder) inputEl.placeholder = String(options.placeholder);
      if (options.maxLength) inputEl.maxLength = options.maxLength;
      card.appendChild(inputEl);
    }
    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    card.appendChild(actions);
    const cancelValue = mode === 'prompt' ? null : false;
    let settled = false;
    const prevFocus = document.activeElement;
    const close = value => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      veil.remove();
      card.remove();
      if (!host.querySelector('.dialog-card')) {
        host.replaceChildren();
        host.classList.remove('has-dialog');
      }
      if (prevFocus && typeof prevFocus.focus === 'function' && document.contains(prevFocus)) prevFocus.focus();
      resolve(value);
    };
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); close(mode === 'alert' ? true : cancelValue); return; }
      if (event.key === 'Enter' && mode === 'prompt') { event.preventDefault(); close(String(inputEl.value)); }
    };
    const addButton = (label, value, className) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dialog-btn' + (className ? ' ' + className : '');
      btn.textContent = label;
      btn.addEventListener('click', () => close(typeof value === 'function' ? value() : value));
      actions.appendChild(btn);
      return btn;
    };
    if (mode === 'alert') {
      actions.classList.add('is-single');
      addButton(options.confirmText || '知道了', true, 'primary');
    } else {
      addButton(options.cancelText || '取消', cancelValue, '');
      addButton(options.confirmText || '确定', mode === 'prompt' ? () => String(inputEl.value) : true, options.danger ? 'danger' : 'primary');
    }
    veil.addEventListener('click', () => { if (mode === 'alert') close(true); });
    host.appendChild(veil);
    host.appendChild(card);
    host.classList.add('has-dialog');
    document.addEventListener('keydown', onKey, true);
    const focusTarget = mode === 'prompt' ? inputEl : actions.querySelector('.dialog-btn.primary') || actions.querySelector('.dialog-btn');
    if (focusTarget) {
      try { focusTarget.focus(); } catch { /* 焦点失败不影响可用性 */ }
      if (mode === 'prompt' && typeof inputEl.select === 'function') inputEl.select();
    }
  });
}
/* 告知类：不阻塞调用方，返回 Promise 供需要时等待用户确认。 */
function showAppAlert(message, options = {}) {
  const text = String(message == null ? '' : message);
  const kind = options.kind || (/^✅|^✔|^☑|^已完成/.test(text) ? 'success' : /^❌|^⚠|^✕/.test(text) ? 'error' : '');
  return openAppDialog(Object.assign({}, options, { mode: 'alert', message: text, kind }));
}
function showAppConfirm(message, options = {}) {
  return openAppDialog(Object.assign({}, options, { mode: 'confirm', message: String(message == null ? '' : message) }));
}
function showAppPrompt(message, defaultValue = '', options = {}) {
  return openAppDialog(Object.assign({}, options, { mode: 'prompt', message: String(message == null ? '' : message), defaultValue }));
}
/* 操作结果统一播报：页面内保留文字方便回看，同时在顶部「灵动岛」弹一条。
   通知统一走 showToast：操作结果 -> 弹 toast；进行中 -> 用不自动消失的 busy toast 占位，
   完成时被结果替换。silent 只留给「只写消息栏」的次要提示（例如上游没返回候选）。 */
// 消息自带的 ✅/❌ 前缀会被剥掉：灵动岛自己有 ✓ / ⚠ 图标，两个叠一起反而乱。
const LEAD_RESULT_ICONS = ['✅', '❌', '⚠', '❗', '✓', '✕'];
function stripResultIcon(message) {
  let text = String(message == null ? '' : message).trimStart();
  for (const icon of LEAD_RESULT_ICONS) {
    if (text.startsWith(icon)) { text = text.slice(icon.length).trimStart(); break; }
  }
  return text;
}
let appBusyToast = null;
// 上一次胶囊入场的时间：隔着太近就不走回弹，避免连续弹出时“一下一下地跳”
let lastToastEnterAt = 0;
function dismissProgress() {
  if (!appBusyToast) return;
  try { appBusyToast.dismiss(); } catch { /* 已被关闭的 toast 再 dismiss 无副作用 */ }
  appBusyToast = null;
}
function notifyProgress(message) {
  if (!message) return null;
  // 已有进行中的胶囊就原地换文案，不再叠一条新的
  if (appBusyToast && appBusyToast.element && appBusyToast.element.isConnected) {
    appBusyToast.update(message, { kind: '', duration: 0 });
    return appBusyToast;
  }
  dismissProgress();
  appBusyToast = showToast(message, { duration: 0 });
  return appBusyToast;
}
/* 全站唯一的通知出口。
   以前通知散成三种形态：模态弹窗（showAppAlert）、直接写内联状态槽、零散 showToast，
   结果就是“有些提示有灵动岛、有些只在页面某个角落”。现在统一走这里：
   - slot：要留痕的内联状态槽 id（可空）；slotClass：该槽的 className
   - level：'info' | 'success' | 'error'，决定图标 / 颜色 / 停留时长
   - silent：只留痕不弹（常态文案，例如“修改即时预览并自动保存”）
   有进行中的胶囊时原地变成结果，避免新旧两条互相挤。 */
function notify(message, options = {}) {
  const text = stripResultIcon(message);
  const level = options.level || 'info';
  const slot = options.slot ? $(options.slot) : null;
  if (slot) {
    slot.textContent = text;
    if (options.slotClass !== undefined) slot.className = options.slotClass;
  }
  if (options.silent || !text) {
    if (appBusyToast) { appBusyToast.dismiss(); appBusyToast = null; }
    return text;
  }
  const kind = level === 'error' ? 'error' : (level === 'warning' ? 'warning' : (level === 'success' ? 'success' : ''));
  const duration = options.duration ?? (kind === 'error' || kind === 'warning' ? 8000 : 5000);
  const busy = appBusyToast;
  appBusyToast = null;
  if (busy && busy.element && busy.element.isConnected) busy.update(text, { kind, duration, action: options.action });
  else showToast(text, { kind, duration, action: options.action });
  return text;
}
/* 兼容旧调用点：设置面板的结果播报（test-result 槽） */
function notifyResult(message, ok, options = {}) {
  return notify(message, {
    slot: 'test-result',
    slotClass: ok ? 'ok' : 'err',
    level: ok ? 'success' : 'error',
    silent: options.silent,
    duration: options.duration,
  });
}
/* ─────────── 自定义下拉（替代原生 <select>） ───────────
   部分 Android WebView 在 <dialog> / modal 内无法弹出原生选择器（点了没反应），
   项目此前只在一个世界预设下拉上绕开了它。现在做成通用能力并自动应用到所有下拉：
   保留原生 <select>（value / change 语义、表单校验、无障碍全部不变），
   只在它旁边渲染一个可见触发器 + 列表，原生控件视觉隐藏。 */
// 惰性获取：本文件也会在 node vm 沙箱里被加载（没有 DOM），顶层不能直接摸 HTMLSelectElement。
let nativeSelectValueDesc;
function nativeSelectValueDescriptor() {
  if (nativeSelectValueDesc === undefined) {
    nativeSelectValueDesc = (typeof HTMLSelectElement === 'function' && HTMLSelectElement.prototype)
      ? Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value') || null
      : null;
  }
  return nativeSelectValueDesc;
}
function nativeSelectValue(select) {
  const desc = nativeSelectValueDescriptor();
  return desc ? desc.get.call(select) : select.value;
}
function setNativeSelectValue(select, value) {
  const desc = nativeSelectValueDescriptor();
  if (desc) desc.set.call(select, value);
  else select.value = value;
}
function customSelectPickerOf(select) { return select.closest('.custom-select-picker'); }
function customSelectLabelText(select) {
  if (!select.id) return '';
  const label = document.querySelector('label[for="' + select.id + '"]');
  return label ? (label.textContent || '').trim() : '';
}
function syncCustomSelect(select) {
  const picker = customSelectPickerOf(select);
  if (!picker) return;
  const valueEl = picker.querySelector('.custom-select-value');
  if (valueEl) {
    const option = select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
    const text = option ? option.textContent : '';
    valueEl.textContent = text;
    valueEl.classList.toggle('is-placeholder', !option);
  }
  const current = nativeSelectValue(select);
  picker.querySelectorAll('.custom-select-menu li[data-value]').forEach(li => {
    li.setAttribute('aria-selected', String(li.dataset.value === current));
  });
}
function renderCustomSelectMenu(select) {
  const picker = customSelectPickerOf(select);
  const menu = picker && picker.querySelector('.custom-select-menu');
  if (!menu) return;
  const current = nativeSelectValue(select);
  menu.innerHTML = Array.from(select.options).map(option => {
    const disabled = option.disabled ? ' aria-disabled="true"' : '';
    return `<li role="option" data-value="${esc(option.value)}"${disabled} aria-selected="${option.value === current}">${esc(option.textContent)}</li>`;
  }).join('');
}
function closeCustomSelects(except) {
  document.querySelectorAll('.custom-select-picker.is-open').forEach(picker => {
    if (picker === except) return;
    picker.classList.remove('is-open');
    const menu = picker.querySelector('.custom-select-menu');
    const trigger = picker.querySelector('.custom-select-trigger');
    if (menu) menu.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  });
}
function enhanceCustomSelect(select) {
  if (!select || select.dataset.customSelect === '1') return null;
  if (select.multiple || Number(select.size) > 1) return null;
  if (select.closest('.custom-select-picker')) return null;
  select.dataset.customSelect = '1';
  const wrap = document.createElement('div');
  wrap.className = 'custom-select-picker';
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);
  select.classList.add('custom-select-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  // 用 hidden 而不是只靠 CSS：.field select 的宽度规则会盖掉低特异性的隐藏样式。
  select.hidden = true;
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'custom-select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const labelText = customSelectLabelText(select);
  if (labelText) trigger.setAttribute('aria-label', labelText);
  trigger.innerHTML = '<span class="custom-select-value"></span><span class="custom-select-caret" aria-hidden="true">\u25be</span>';
  const menu = document.createElement('ul');
  menu.className = 'custom-select-menu';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;
  wrap.appendChild(trigger);
  wrap.appendChild(menu);
  const setOpen = open => {
    wrap.classList.toggle('is-open', open);
    menu.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (open) renderCustomSelectMenu(select);
  };
  trigger.addEventListener('click', event => {
    event.stopPropagation();
    const willOpen = !wrap.classList.contains('is-open');
    closeCustomSelects(wrap);
    setOpen(willOpen);
  });
  menu.addEventListener('click', event => {
    const item = event.target.closest('li[data-value]');
    if (!item || item.getAttribute('aria-disabled') === 'true') return;
    setNativeSelectValue(select, item.dataset.value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    setOpen(false);
    syncCustomSelect(select);
  });
  // 代码直接赋值 select.value 时（不触发 change）也要跟手刷新显示。
  Object.defineProperty(select, 'value', {
    configurable: true,
    get() { return nativeSelectValue(select); },
    set(next) { setNativeSelectValue(select, next); syncCustomSelect(select); },
  });
  select.addEventListener('change', () => syncCustomSelect(select));
  // 选项被整体重写时（innerHTML = ...）重建菜单。
  new MutationObserver(() => { renderCustomSelectMenu(select); syncCustomSelect(select); })
    .observe(select, { childList: true, subtree: true, attributes: true, characterData: true });
  renderCustomSelectMenu(select);
  syncCustomSelect(select);
  return { trigger, menu, sync: () => syncCustomSelect(select) };
}
function enhanceCustomSelectsIn(root = document) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  root.querySelectorAll('select:not([data-custom-select])').forEach(enhanceCustomSelect);
}
let customSelectObserver = null;
function autoEnhanceCustomSelects() {
  enhanceCustomSelectsIn(document);
  if (!autoEnhanceCustomSelects.bound) {
    autoEnhanceCustomSelects.bound = true;
    document.addEventListener('click', () => closeCustomSelects());
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeCustomSelects(); });
  }
  if (customSelectObserver || typeof MutationObserver !== 'function' || !document.body) return;
  customSelectObserver = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!node || node.nodeType !== 1) continue;
        if (node.tagName === 'SELECT') enhanceCustomSelect(node);
        else enhanceCustomSelectsIn(node);
      }
    }
  });
  customSelectObserver.observe(document.body, { childList: true, subtree: true });
}
/* 可输入的候选下拉：替代原生 <datalist>。
   原生 datalist 在各平台外观/行为不一致，部分 WebView 里弹不出来（会盖住输入框）。
   input 仍可手输，另给一个可见的展开按钮 + 应用内菜单，样式与其他下拉一致。 */
function enhanceComboInput(input, options = {}) {
  if (!input || input.dataset.comboEnhanced === '1') return null;
  input.dataset.comboEnhanced = '1';
  const sourceId = options.source || input.getAttribute('list');
  if (sourceId) input.removeAttribute('list'); // 禁用原生 datalist
  const wrap = document.createElement('div');
  wrap.className = 'combo-input';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'combo-toggle';
  toggle.setAttribute('aria-haspopup', 'listbox');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', options.toggleLabel || '展开候选项');
  toggle.textContent = '\u25be';
  const menu = document.createElement('ul');
  menu.className = 'custom-select-menu combo-menu';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;
  wrap.appendChild(toggle);
  wrap.appendChild(menu);
  const candidateValues = () => {
    const dl = sourceId ? document.getElementById(sourceId) : null;
    return dl ? Array.from(dl.options).map(option => option.value).filter(Boolean) : [];
  };
  const render = () => {
    const values = candidateValues();
    menu.innerHTML = values.length
      ? values.map(value => `<li role="option" data-value="${esc(value)}">${esc(value)}</li>`).join('')
      : `<li class="combo-empty" aria-disabled="true">${esc(options.emptyText || '暂无候选，请先点「获取」')}</li>`;
  };
  const close = () => {
    menu.hidden = true;
    wrap.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
  };
  const open = () => {
    render();
    if (!candidateValues().length) { close(); return false; }
    menu.hidden = false;
    wrap.classList.add('is-open');
    toggle.setAttribute('aria-expanded', 'true');
    return true;
  };
  toggle.addEventListener('click', event => {
    event.stopPropagation();
    if (wrap.classList.contains('is-open')) close();
    else open();
  });
  menu.addEventListener('click', event => {
    const item = event.target.closest('li[data-value]');
    if (!item) return;
    input.value = item.dataset.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    close();
  });
  document.addEventListener('click', () => close());
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  input.comboMenu = { open, close, render };
  return input.comboMenu;
}
function webCompatBootstrap() {
  try {
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
  } catch (error) {}
  try {
    if (typeof Object.hasOwn !== 'function') {
      Object.hasOwn = function(object, property) {
        if (object === null || object === undefined) throw new TypeError('Cannot convert undefined or null to object');
        return Object.prototype.hasOwnProperty.call(object, property);
      };
    }
  } catch (error) {}
  try {
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
  } catch (error) {}
}
function webCompatSource() {
  return `(${webCompatBootstrap.toString()}());`;
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
// 提示词编辑器内存态：true 表示当前预设未声明 replyOptions，保存时继续继承项目默认。
let pgReplyOptionsInherited = true;
let regexEditingId = null;
let regexEditingSource = 'custom';
let rpgDrawerReturnFocus = null;
const serverDataWriteQueues = new Map();
const WORLD_EXTENSION_CHANNEL = 'tavern.rpg.extension';
let worldExtensionState = { iframe: null, nonce: '', signature: '', ready: false, timer: null, pending: new Map(), nextRequestId: 0, surface: 'play' };
const worldExtensionDeniedApprovals = new Set();
// 已弹窗询问、等待用户答复的扩展：避免同一轮渲染重复弹窗
const worldExtensionApprovalPending = new Set();
const cardScriptDeniedApprovals = new Set();

/* ─────────── 数据加载 / 保存（JSON 文件存储） ─────────── */
function saveSettings() {
  localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
  return saveServerData('settings', settings);
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
      return true;
    } catch (e) {
      console.error('[Tavern] 保存 ' + type + ' 失败:', e.message);
      return false;
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
function sessionMatches(s) { return !!s && s.kind === mode; }
function saveSessions(updatedSession = curSession()) {
  const cur = updatedSession && Array.isArray(sessions)
    ? sessions.find(session => session.id === updatedSession.id) || curSession()
    : curSession();
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
function lorebookHash(value) {
  let hash = 2166136261;
  for (const ch of String(value || '')) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function currentUserPreset() {
  ensureUserData();
  return userData.presets[userData.currentPreset] || Object.values(userData.presets)[0] || userData.presets.default;
}
