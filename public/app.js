/* ═══════════════ Tavern · AI RP 框架 —— 前端逻辑 ═══════════════
 * 数据层（localStorage）：
 *   角色库 characters / 会话 sessions / 世界书 lorebook /
 *   提示词预设 promptPresets / 偏好 prefs（格式·世界书设置）
 * 提示词管线（参考 SillyTavern）：
 *   角色 system_prompt → 预设/全局 → 格式指令 → 世界书命中条目
 *   → 最近历史 → post_history_instructions（历史后，权重高）
 */

'use strict';

/* ─────────── 常量 ─────────── */
const LS_SETTINGS = 'rpg-airp:settings';
const LS_CHAT = 'rpg-airp:chat';
const LS_CHAR = 'rpg-airp:char';
const LS_THEME = 'rpg-airp:theme';
const LS_LAYOUT = 'rpg-airp:layout';
const LS_PROFILES = 'rpg-airp:profiles';
const LS_CHARS = 'rpg-airp:chars';
const LS_CURRENT_CHAR = 'rpg-airp:current-char';
const LS_SESSIONS = 'rpg-airp:sessions';
const LS_LORE = 'rpg-airp:lore';
const LS_PRESETS = 'rpg-airp:prompt-presets';
const LS_PREFS = 'rpg-airp:prefs';
const GLOBAL_PRESET_KEY = '__global__'; // 全局默认提示词 = presets.json 固定键（与普通预设同构，含 modules）

const PAW_SVG = `<svg class="mini-crest" viewBox="0 0 100 100" aria-hidden="true"><ellipse cx="50" cy="64" rx="20" ry="15"/><ellipse cx="28" cy="38" rx="10" ry="13"/><ellipse cx="46" cy="25" rx="9" ry="13"/><ellipse cx="66" cy="30" rx="9" ry="13"/><ellipse cx="76" cy="49" rx="8" ry="11"/></svg>`;

/* 风格主题（色调）——UI 设计配置，保留在代码（驱动 CSS 变量） */
const THEMES = {
  tavern:   { label: '酒馆 · 暖木烛光', hues: [38, 24] },
  washi:    { label: '和纸 · 明亮日系', hues: [12, 148] },
  night:    { label: '夜霓虹 · 暗夜光影', hues: [214, 328] },
  moss:     { label: '林间 · 苔绿自然', hues: [95, 42] },
  vibrancy: { label: 'macOS 毛玻璃', hues: [0, 0] },
};

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
let promptPresets = loadJSON(LS_PRESETS, {});
let theme = localStorage.getItem(LS_THEME) || 'tavern';
let sending = false;
let cmEditingId = null;
let wiEditingId = null;
let lbEditingId = null;
let pgEditingName = null;
let pgEditingModules = null;

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
      headers: { 'Content-Type': 'application/json' },
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
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function currentChar() { return characters.find(c => c.id === currentCharId) || null; }
function curSession() { return sessions.find(s => s.id === currentSessionId) || null; }
function curMessages() { const s = curSession(); return s ? s.messages : []; }

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

/* 拆分对白 / 旁白：引号（“ ” 「 」 『 』 " "）内 → 对白，其余 → 旁白 */
function splitNarration(text) {
  const segs = [];
  const re = /[“"「『]([^”"」』]{1,300}?)[”"」』]/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) {
      const t = text.slice(last, m.index);
      if (t.trim()) segs.push({ type: 'narration', text: t });
    }
    segs.push({ type: 'dialogue', text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    const t = text.slice(last);
    if (t.trim()) segs.push({ type: 'narration', text: t });
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
    if (!currentSessionId || !sessions.find(s => s.id === currentSessionId)) {
      currentSessionId = sessions[0].id;
    }
    return;
  }
  // 迁移旧单会话
  const oldMsgs = loadJSON(LS_CHAT, null);
  sessions = [{
    id: uid(), name: '会话 1', charId: currentCharId,
    messages: (oldMsgs && oldMsgs.length) ? oldMsgs : [],
    createdAt: Date.now(),
  }];
  currentSessionId = sessions[0].id;
  saveSessions();
}

function newSession() {
  const char = currentChar();
  const preset = promptPresets[(char && char.presetName)] || promptPresets[prefs.currentPreset] || promptPresets[GLOBAL_PRESET_KEY] || null;
  const defaultName = '会话 ' + (sessions.length + 1);
  const name = (prompt('新会话名称：', defaultName) || defaultName).trim() || defaultName;
  const messages = [];
  const greeting = (char && char.firstMes && char.firstMes.trim())
    || (preset && preset.firstMes && preset.firstMes.trim())
    || settings.firstMes || '';
  if (greeting) {
    messages.push({ role: 'assistant', content: greeting, ts: Date.now() });
  }
  sessions.unshift({ id: uid(), name, charId: currentCharId, messages, createdAt: Date.now() });
  currentSessionId = sessions[0].id;
  saveSessions();
  renderSessions();
  renderMessages();
}

function switchSession(id) {
  if (!sessions.find(s => s.id === id)) return;
  currentSessionId = id;
  saveSessions();
  renderSessions();
  renderMessages();
}

function deleteSession(id) {
  if (!confirm('删除该会话？此操作不可撤销。')) return;
  sessions = sessions.filter(s => s.id !== id);
  if (currentSessionId === id) {
    if (!sessions.length) {
      sessions = [{ id: uid(), name: '会话 1', charId: currentCharId, messages: [], createdAt: Date.now() }];
    }
    currentSessionId = sessions[0].id;
  }
  saveSessions();
  renderSessions();
  renderMessages();
}

function renderSessions() {
  const nameEl = $('session-name');
  const s = curSession();
  if (nameEl) nameEl.textContent = s ? s.name : '—';
  // 头部下拉
  const ml = $('session-menu-list');
  if (ml) {
    ml.innerHTML = '';
    for (const ses of sessions) {
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
    if (!currentCharId || !characters.find(c => c.id === currentCharId)) {
      currentCharId = characters[0].id;
      localStorage.setItem(LS_CURRENT_CHAR, currentCharId);
    }
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
  for (const c of characters) {
    const el = document.createElement('div');
    el.className = 'cm-item' + (c.id === currentCharId ? ' active' : '');
    el.innerHTML = `<span>${esc(c.name || '未命名')}</span><span class="cm-x" title="删除">✕</span>`;
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

function selectCharForEdit(id) {
  const c = characters.find(x => x.id === id);
  if (!c) return;
  cmEditingId = id;
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
  $('cm-tags').value = c.tags || '';
}

function newCharEditor() {
  cmEditingId = null;
  $('cm-edit-title').textContent = '新建角色';
  ['cm-name', 'cm-race', 'cm-role', 'cm-persona', 'cm-scenario', 'cm-first-mes', 'cm-system', 'cm-post', 'cm-tags']
    .forEach(id => { $(id).value = ''; });
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
    tags: $('cm-tags').value.trim(),
  };
  if (cmEditingId) {
    const c = characters.find(x => x.id === cmEditingId);
    Object.assign(c, data);
  } else {
    characters.push({ id: uid(), ...data, createdAt: Date.now() });
  }
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
  renderCharacter();
  renderCharList();
  switchView('chat');
}

function deleteChar(id) {
  if (!confirm('删除该角色？关联会话保留但不再绑定角色。')) return;
  characters = characters.filter(c => c.id !== id);
  if (currentCharId === id) { currentCharId = characters.length ? characters[0].id : null; localStorage.setItem(LS_CURRENT_CHAR, currentCharId || ''); }
  saveChars();
  if (cmEditingId === id) newCharEditor();
  renderCharList();
  renderCharacter();
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
      extensions: { tavern: { race: c.race || '', role: c.role || '', presetName: c.presetName || '', loreId: c.loreId || '' } },
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

function renderPGList() {
  const list = $('pg-list');
  if (!list) return;
  list.innerHTML = '';
  const names = Object.keys(promptPresets);
  if (!names.length) { list.innerHTML = '<div class="hint">尚无预设 —— 点击「＋ 新建预设」。</div>'; }
  for (const name of names) {
    const display = name === GLOBAL_PRESET_KEY ? '⭐ 全局默认' : name;
    const el = document.createElement('div');
    el.className = 'cm-item' + (name === pgEditingName ? ' active' : '') + (name === prefs.currentPreset ? ' pg-inuse' : '');
    el.innerHTML = `<span>${esc(display)}${name === prefs.currentPreset ? ' ●' : ''}</span>${name === GLOBAL_PRESET_KEY ? '' : '<span class="cm-x" data-act="del" title="删除">✕</span>'}`;
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
    const o = document.createElement('option');
    o.value = name;
    o.textContent = name;
    sel.appendChild(o);
  }
  if (cur && promptPresets[cur]) sel.value = cur;
  else sel.value = prefs.currentPreset || '';
}

function selectPresetForEdit(name) {
  pgEditingName = name || GLOBAL_PRESET_KEY; // 编辑全局默认 = 编辑 __global__ 预设
  let sys = '', post = '', fm = '';
  const target = promptPresets[pgEditingName];
  if (target) {
    sys = target.systemPrompt || '';
    post = target.postHistory || '';
    fm = target.firstMes || '';
    pgEditingModules = (target.modules || []).map(m => ({ ...m }));
  } else {
    pgEditingModules = null;
  }
  $('pg-edit-title').textContent = pgEditingName === GLOBAL_PRESET_KEY ? '编辑全局默认' : '编辑预设：' + pgEditingName;
  $('pg-system').value = sys;
  $('pg-post').value = post;
  $('pg-first-mes').value = fm;
  renderPGModules();
  renderPGList();
}

function pgNew() {
  const name = prompt('新预设名称：', '预设 ' + (Object.keys(promptPresets).length + 1));
  if (!name || !name.trim()) return;
  const baseModules = (promptPresets['RP 基础（示例）'] && promptPresets['RP 基础（示例）'].modules) || [];
  promptPresets[name.trim()] = {
    systemPrompt: '', postHistory: '', firstMes: '',
    modules: baseModules.map(m => ({ ...m })),
  };
  savePresets();
  selectPresetForEdit(name.trim());
}

function pgDelete(name) {
  if (!promptPresets[name] || name === GLOBAL_PRESET_KEY) return; // 全局默认不可删
  if (!confirm(`删除预设「${name}」？`)) return;
  delete promptPresets[name];
  if (prefs.currentPreset === name) { prefs.currentPreset = ''; saveJSON(LS_PREFS, prefs); }
  if (pgEditingName === name) pgEditingName = null;
  savePresets();
  renderPGList();
}

function pgSave() {
  const name = pgEditingName || GLOBAL_PRESET_KEY;
  const data = {
    systemPrompt: $('pg-system').value,
    postHistory: $('pg-post').value,
    firstMes: $('pg-first-mes').value,
    modules: pgEditingModules ? pgEditingModules.map(m => ({ ...m })) : [],
  };
  promptPresets[name] = data;
  savePresets();
  renderPGList();
}

function pgSaveGlobal() {
  pgSave();
  alert('✅ 已保存为全局默认（System Prompt / 历史后指令 / 开场白 / 模块）');
}

/* 模块开关渲染 */
function renderPGModules() {
  const box = $('pg-modules');
  if (!box) return;
  if (!pgEditingModules || !pgEditingModules.length) {
    box.innerHTML = '<div class="hint">该预设无模块。新预设会从示例预设继承模块。</div>';
    return;
  }
  box.innerHTML = '';
  pgEditingModules.forEach((m, i) => {
    const el = document.createElement('div');
    el.className = 'mod-item';
    el.innerHTML = `<label class="check"><input type="checkbox" data-mi="${i}" ${m.enabled ? 'checked' : ''} /><span>${esc(m.name)}</span></label>`;
    box.appendChild(el);
  });
  box.querySelectorAll('input[data-mi]').forEach(cb => {
    cb.addEventListener('change', () => {
      const i = parseInt(cb.dataset.mi, 10);
      pgEditingModules[i].enabled = cb.checked;
    });
  });
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
  if (prefs.activeLoreId && lorebooks && lorebooks[prefs.activeLoreId]) {
    sources.push(...lorebooks[prefs.activeLoreId].entries);
  }
  if (char && char.loreId && lorebooks && lorebooks[char.loreId] && char.loreId !== prefs.activeLoreId) {
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

/* ─────────── 提示词构建管线 ─────────── */
function buildPromptBlocks() {
  const char = currentChar();
  const preset = promptPresets[(char && char.presetName)] || promptPresets[prefs.currentPreset] || promptPresets[GLOBAL_PRESET_KEY] || null;
  const parts = [];
  // System Prompt（身份定位在前：作者视角，再注入角色素材）
  const inst = (char && char.systemPrompt && char.systemPrompt.trim())
    || (preset && preset.systemPrompt && preset.systemPrompt.trim())
    || settings.systemPrompt
    || '';
  parts.push(inst);
  // 角色卡信息
  if (char) {
    const descLines = [];
    if (char.name && char.name.trim()) descLines.push('名字：' + char.name.trim());
    if (char.race && char.race.trim()) descLines.push('种族：' + char.race.trim());
    if (char.role && char.role.trim()) descLines.push('身份：' + char.role.trim());
    if (char.persona && char.persona.trim()) descLines.push('外貌与性格：' + char.persona.trim());
    if (char.scenario && char.scenario.trim()) descLines.push('当前场景：' + char.scenario.trim());
    if (descLines.length) parts.push('【角色卡】\n' + descLines.join('\n'));
  }
  // 预设模块（受 SillyTavern prompts 启发：可开关的提示词条目）
  if (preset && preset.modules) {
    for (const m of preset.modules) {
      if (m.enabled && m.content && m.content.trim()) parts.push(m.content);
    }
  }
  // 格式指令
  const fmtLines = [];
  const fi = formatInstructions[prefs.formatPreset];
  if (fi) fmtLines.push(typeof fi === 'string' ? fi : (fi.text || ''));
  if (prefs.formatCustom && prefs.formatCustom.trim()) fmtLines.push(prefs.formatCustom.trim());
  if (fmtLines.length) parts.push(fmtLines.join('\n'));
  const system = parts.join('\n\n');
  const wi = buildWorldInfo();
  const history = curMessages().slice(-Math.max(1, settings.history || 20))
    .filter(m => m.role === 'user' || m.role === 'assistant') // 图片消息不进对话上下文
    .map(m => ({ role: m.role, content: m.content }));
  const post = (char && char.postHistory && char.postHistory.trim())
    || (preset && preset.postHistory && preset.postHistory.trim())
    || settings.postHistory || '';
  return { system, wi, history, post };
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
  const { system, wi, history, post } = buildPromptBlocks();
  // 唯一 system 消息：身份 + 角色卡 + 模块 + 格式 + 世界设定 + 历史后指令 合并为一条，
  // 避免多条 system 穿插在 user/assistant 之间导致模型混淆 role 边界（DeepSeek/本地模型尤其敏感）
  const sysParts = [];
  if (system && system.trim()) sysParts.push(system);
  if (wi && wi.length) sysParts.push('【世界设定】\n' + wi.join('\n\n'));
  if (post && post.trim()) sysParts.push('【历史后指令】\n' + post);
  body.messages = [];
  if (sysParts.length) body.messages.push({ role: 'system', content: sysParts.join('\n\n') });
  body.messages.push(...history);
  return { baseUrl: s.baseUrl, apiKey: s.apiKey, body, wi };
}

async function callAPI(payload) {
  const resp = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = data?.error?.message || `HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return data;
}

async function callAPIStream(payload) {
  const resp = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
    if (t) t.querySelector('.bubble').innerHTML = renderBubble(typingText).html;
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

/* ─────────── 调试终端已移除：请求 / 响应日志输出到浏览器控制台 ─────────── */

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
function renderMessages() {
  const chat = $('chat');
  chat.innerHTML = '';
  const msgs = curMessages();
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
      chat.appendChild(imgEl);
      continue;
    }
    // 角色回复：拆分为「旁白行 + 角色气泡」，气泡只放角色说的话
    if (m.role === 'assistant') {
      // 思维链独立呈现（旁白样式），不占用角色气泡
      if (m.cot) {
        const cotEl = document.createElement('div');
        cotEl.className = 'msg cot-msg';
        cotEl.innerHTML = `<div class="nar-icon">🧠</div><div class="bubble"><details class="cot"><summary>🧠 思维链</summary><pre>${esc(m.cot)}</pre></details></div>`;
        chat.appendChild(cotEl);
      }
      const segs = splitNarration(m.content);
      segs.forEach((seg) => {
        const el = document.createElement('div');
        const { html, md } = renderBubble(seg.type === 'dialogue' ? seg.text.slice(1, -1) : seg.text);
        if (seg.type === 'narration') {
          el.className = 'msg narration';
          el.innerHTML = `<div class="nar-icon">✦</div><div class="bubble${md ? ' md' : ''}">${html}</div>`;
        } else {
          el.className = 'msg assistant';
          el.innerHTML = `<div class="avatar">${PAW_SVG}</div><div class="bubble${md ? ' md' : ''}">${html}</div>`;
        }
        chat.appendChild(el);
      });
      continue;
    }
    // 用户 / 系统消息
    const el = document.createElement('div');
    el.className = 'msg ' + m.role;
    const avatar = m.role === 'user' ? '<span>🧑</span>'
      : (m.role === 'system' ? '<span>❖</span>' : PAW_SVG);
    const { html, md } = renderBubble(m.content);
    el.innerHTML = `<div class="avatar">${avatar}</div><div class="bubble${md ? ' md' : ''}">${html}</div>`;
    chat.appendChild(el);
  }
  chat.scrollTop = chat.scrollHeight;
}

function pushMessage(role, content, extra) {
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
  const el = document.createElement('div');
  el.className = 'msg assistant typing';
  el.id = 'typing-msg';
  el.innerHTML = `<div class="avatar">${PAW_SVG}</div><div class="bubble">正在思索…</div>`;
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

function buildImageBody(ig, prompt) {
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
  } else {
    if (ig.model) body.model = ig.model;
    if (ig.size) body.size = ig.size;
    body.n = 1;
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

/* 生图请求（120s 超时防挂起） */
async function callImageAPI(ig, prompt) {
  if (!ig.baseUrl) throw new Error('请先在 设置 → 文生图 中填写 Base URL');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch('/api/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({ baseUrl: ig.baseUrl, apiKey: ig.apiKey, kind: ig.kind || 'openai', body: buildImageBody(ig, prompt) }),
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
      headers: { 'Content-Type': 'application/json' },
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(src.startsWith('data:') ? { b64: src } : { url: src }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.path) throw new Error('图片本地保存失败: ' + (data.error || res.status));
  return data.path;
}

/* 点击图片放大查看（lightbox） */
let lightboxEl = null;
function openLightbox(src) {
  if (!lightboxEl) {
    lightboxEl = document.createElement('div');
    lightboxEl.className = 'lightbox hidden';
    lightboxEl.innerHTML = '<img alt="大图" />';
    lightboxEl.addEventListener('click', closeLightbox);
    document.body.appendChild(lightboxEl);
  }
  lightboxEl.querySelector('img').src = src;
  lightboxEl.classList.remove('hidden');
}
function closeLightbox() { if (lightboxEl) lightboxEl.classList.add('hidden'); }

/* 生图并作为图片消息上屏 */
async function generateImageFor(story) {
  const ig = igSettings();
  if (!ig.enabled || !ig.baseUrl) return;
  const status = $('ig-test-result');
  if (status) status.textContent = '⏳ 正在生成图片…';
  addImagePending(); // 聊天栏占位提示：开始生图
  try {
    let prompt;
    if (ig.promptSource === 'story') {
      prompt = story;
    } else {
      try { prompt = await llmImagePrompt(ig, story); }
      catch (e) { console.warn('[Tavern] LLM 提示词生成失败，回退用剧情文本:', e.message); prompt = story; }
    }
    console.info('[Tavern] 🖼 生图提示词', prompt.slice(0, 120));
    const src = await callImageAPI(ig, prompt);
    removeImagePending();
    let local = src;
    try { local = await saveImageLocally(src); } // 存本地，刷新不丢
    catch (e) { console.warn('[Tavern] 图片本地保存失败，本轮仍显示:', e.message); }
    pushMessage('image', local, { imgPrompt: prompt }); // 记住提示词，供「重新生成」复用
    if (status) status.textContent = '✅ 图片已生成并显示在聊天栏';
  } catch (err) {
    console.error('[Tavern] 文生图失败:', err.message);
    removeImagePending();
    if (status) status.textContent = '❌ ' + err.message;
    pushMessage('system', `⚠️ 文生图失败：${err.message}`);
  }
}

/* 测试按钮：用测试提示词直接生图 */
async function testImageGen() {
  const ig = igSettings();
  const prompt = ($('ig-test-prompt').value || '').trim() || 'a fox knight in a tavern, anime style';
  const status = $('ig-test-result');
  if (status) status.textContent = '⏳ 正在生成测试图…';
  addImagePending();
  try {
    const src = await callImageAPI(ig, prompt);
    removeImagePending();
    if (status) status.textContent = '✅ 成功（见聊天栏）';
    let local = src;
    try { local = await saveImageLocally(src); }
    catch (e) { console.warn('[Tavern] 图片本地保存失败，本轮仍显示:', e.message); }
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
  addImagePending();
  try {
    const src = await callImageAPI(ig, msg.imgPrompt);
    removeImagePending();
    let local = src;
    try { local = await saveImageLocally(src); }
    catch (e) { console.warn('[Tavern] 图片本地保存失败，本轮仍显示:', e.message); }
    msg.content = local;
    msg.ts = Date.now();
    saveSessions();
    renderMessages();
  } catch (err) {
    console.error('[Tavern] 重新生成失败:', err.message);
    removeImagePending();
    pushMessage('system', `⚠️ 重新生成失败：${err.message}`);
  }
}

async function sendMessage() {
  if (sending) return;
  const input = $('input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  pushMessage('user', text);

  sending = true;
  $('btn-send').disabled = true;
  addTyping();
  let cot = '';
  try {
    const payload = buildPayload();
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
    console.debug('[Tavern] ← 响应', reply);
    if (cot) console.debug('[Tavern] 🧠 思维链', cot);
    removeTyping();
    pushMessage('assistant', reply.trim(), cot ? { cot } : undefined);
    // 文生图（测试）：回复完成后自动生图（异步，不阻塞对话）
    const ig = settings.imageGen;
    if (ig && ig.enabled && ig.auto && ig.baseUrl) {
      generateImageFor(reply.trim()).catch(e => console.error('[Tavern] 文生图失败', e.message));
    }
  } catch (err) {
    console.error('[Tavern] ✗ 请求失败', err.message);
    removeTyping();
    pushMessage('system', `⚠️ 请求失败：${err.message}`);
    setApiStatus(`最近一次请求失败：${err.message}`, true);
  } finally {
    sending = false;
    $('btn-send').disabled = false;
    input.focus();
  }
}

/* ─────────── 视图切换 ─────────── */
const VIEW_PLACEHOLDER = {};

function switchView(name) {
  document.querySelectorAll('.nav-item[data-view]').forEach(b =>
    b.classList.toggle('active', b.dataset.view === name));
  ['char-mgr', 'prompt-mgr', 'lore-mgr'].forEach(id => $(id).classList.add('hidden'));
  if (name === 'chat') return;
  if (name === 'chars') {
    renderBindSelects();
    $('char-mgr').classList.remove('hidden');
    renderCharList();
    if (!cmEditingId && characters.length) selectCharForEdit(currentCharId || characters[0].id);
    return;
  }
  if (name === 'prompts') {
    $('prompt-mgr').classList.remove('hidden');
    if (!pgEditingName) selectPresetForEdit(null);
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
}

/* ─────────── 主题 / 布局 ─────────── */
let bgRaf = null;
function initBackground() {
  const canvas = $('bg-fx');
  if (!canvas) return;
  if (bgRaf) cancelAnimationFrame(bgRaf);
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = canvas.getContext('2d');
  const hues = (THEMES[theme] || THEMES.tavern).hues;
  let w = 0, h = 0;
  const parts = [];
  const resize = () => { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; };
  resize();
  window.addEventListener('resize', resize);
  const N = 26;
  for (let i = 0; i < N; i++) {
    parts.push({
      x: Math.random() * w, y: Math.random() * h,
      r: 0.7 + Math.random() * 1.7,
      vx: (Math.random() - 0.5) * 0.16,
      vy: -0.06 - Math.random() * 0.22,
      a: 0.14 + Math.random() * 0.34,
      hue: hues[Math.random() < 0.72 ? 0 : 1],
      ph: Math.random() * Math.PI * 2,
    });
  }
  function tick(t) {
    ctx.clearRect(0, 0, w, h);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy;
      if (p.y < -8) { p.y = h + 8; p.x = Math.random() * w; }
      if (p.x < -8) p.x = w + 8;
      if (p.x > w + 8) p.x = -8;
      const tw = 0.55 + 0.45 * Math.sin(t / 900 + p.ph);
      ctx.beginPath();
      ctx.fillStyle = `hsla(${p.hue}, 62%, 62%, ${p.a * tw})`;
      ctx.shadowColor = `hsla(${p.hue}, 62%, 58%, 0.85)`;
      ctx.shadowBlur = 7;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    bgRaf = requestAnimationFrame(tick);
  }
  bgRaf = requestAnimationFrame(tick);
}

function applyTheme(name) {
  theme = THEMES[name] ? name : 'tavern';
  document.body.dataset.theme = theme;
  localStorage.setItem(LS_THEME, theme);
  document.querySelectorAll('.theme-dot').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === theme));
  initBackground();
}

function applyLayout() {
  document.body.dataset.layout = 'classic';
}


/* ─────────── 事件绑定 ─────────── */
function bindEvents() {
  // 发送
  $('btn-send').addEventListener('click', sendMessage);
  $('input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  // 快捷行动
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const input = $('input');
      const act = chip.dataset.action;
      input.value = input.value.trim() ? input.value.trimEnd() + '\n' + act : act;
      input.focus();
    });
  });
  // 导航
  document.querySelectorAll('.nav-item[data-view]').forEach(b =>
    b.addEventListener('click', () => switchView(b.dataset.view)));
  // 会话
  $('btn-session').addEventListener('click', e => {
    e.stopPropagation();
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
  $('cm-save').addEventListener('click', () => { saveCharFromEditor(); renderCharList(); });
  $('cm-use').addEventListener('click', useCharInEditor);
  $('cm-del').addEventListener('click', deleteChar);
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
  $('pg-save-global').addEventListener('click', pgSaveGlobal);
  $('pg-active').addEventListener('change', () => {
    prefs.currentPreset = $('pg-active').value || '';
    saveJSON(LS_PREFS, prefs);
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
    }));
  // 设置
  document.querySelectorAll('.js-settings').forEach(b => b.addEventListener('click', openSettings));
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
    if (!confirm('确定清空当前对话？')) return;
    const s = curSession();
    if (s) { s.messages = []; saveSessions(); renderMessages(); renderSessions(); }
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
  // 主题 / 布局
  document.querySelectorAll('.theme-dot').forEach(b =>
    b.addEventListener('click', () => applyTheme(b.dataset.theme)));
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
  const [chars, presets, lore, s] = await Promise.all([
    loadServerData('characters'),
    loadServerData('presets'),
    loadServerData('lorebooks'),
    loadServerData('settings'),
  ]);
  if (chars && Array.isArray(chars)) characters = chars;
  if (presets && typeof presets === 'object') promptPresets = presets;
  if (lore && typeof lore === 'object') lorebooks = lore;
  if (s && typeof s === 'object') settings = { ...DEFAULT_SETTINGS, ...s };

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
  // currentPreset 兜底：指向已删除/无效预设时回落示例预设（保证 writer 身份等生效）
  if (!promptPresets[prefs.currentPreset]) {
    const fallback = promptPresets['RP 基础（示例）']
      ? 'RP 基础（示例）'
      : (Object.keys(promptPresets).filter(k => k !== GLOBAL_PRESET_KEY)[0] || '');
    prefs.currentPreset = fallback;
    saveJSON(LS_PREFS, prefs);
  }
  ensureSessions();
  applyTheme(theme);
  bindEvents();
  renderMessages();
  renderCharacter();
  renderSessions();
  renderCharList();
  updateApiStatusFromSettings();
}
init();
