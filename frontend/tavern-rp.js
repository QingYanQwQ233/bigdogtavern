/* ─────────── 会话管理 ─────────── */
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
      if (s.kind === 'tavern') ensureTavernSessionMemory(s);
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
  if (oldKind === 'tavern') ensureTavernSessionMemory(sessions[0]);
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
    messages.push(createTavernGreetingMessage(greeting)); // 开场白：与 AI 回复共用协议解析
  } else if (defaults && defaults.ui && defaults.ui.noGreeting) {
    messages.push({ role: 'system', content: defaults.ui.noGreeting, ts: Date.now() });
  }
  const session = { id: uid(), name, charId: currentCharId, kind: mode, messages, createdAt: Date.now() };
  if (mode === 'tavern') ensureTavernSessionMemory(session);
  sessions.unshift(session);
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
    el.innerHTML = `<span class="cm-name">${esc(c.name || '未命名')}</span><span class="world-lb-actions"><button class="cm-x world-lb-use" type="button" data-act="use" aria-pressed="${inUse ? 'true' : 'false'}" title="${inUse ? '当前正在使用' : '设为当前使用'}">${inUse ? '使用中' : '设为使用'}</button><button class="cm-x world-lb-delete" type="button" data-act="delete" aria-label="删除 ${esc(c.name || '未命名')}" title="删除角色">删除</button></span>`;
    el.addEventListener('click', (ev) => {
      const action = ev.target.closest?.('[data-act]')?.dataset.act;
      if (action === 'use') { useCharById(c.id); return; }
      if (action === 'delete') { deleteChar(c.id); return; }
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

function useCharById(id) {
  const target = characters.find(x => x.id === id);
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

function useCharInEditor() {
  saveCharFromEditor();
  useCharById(cmEditingId || characters[characters.length - 1]?.id);
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
  const characterBook = boundCharacterBookForExport(c);
  if (characterBook) data.character_book = characterBook;
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

/* ─────────── RP 自动滚动记忆 ───────────
 * 原始消息始终保留在会话中；这里只记录摘要覆盖了哪些消息，并在发给 AI 时替换旧历史。
 */
function tavernAutoMemoryDefaults() {
  const source = defaults?.prefs?.tavernAutoMemory;
  return {
    enabled: source?.enabled === true,
    windowTurns: Number(source?.windowTurns) || 20,
    summarizeTurns: Number(source?.summarizeTurns) || 15,
    summaryChars: Number(source?.summaryChars) || 100,
  };
}

function tavernAutoMemoryConfig() {
  const base = tavernAutoMemoryDefaults();
  const saved = prefs?.tavernAutoMemory && typeof prefs.tavernAutoMemory === 'object'
    ? prefs.tavernAutoMemory : {};
  const windowTurns = Math.max(2, Math.min(100, Number(saved.windowTurns) || base.windowTurns));
  const summarizeTurns = Math.max(1, Math.min(windowTurns - 1, Number(saved.summarizeTurns) || base.summarizeTurns));
  return {
    enabled: saved.enabled === undefined ? base.enabled : saved.enabled === true,
    windowTurns,
    summarizeTurns,
    summaryChars: Math.max(20, Math.min(500, Number(saved.summaryChars) || base.summaryChars)),
  };
}

function ensureTavernSessionMemory(session) {
  if (!session || session.kind !== 'tavern') return null;
  if (!session.autoMemory || typeof session.autoMemory !== 'object' || Array.isArray(session.autoMemory)) {
    session.autoMemory = { version: 1, summaries: [] };
  }
  if (!Array.isArray(session.autoMemory.summaries)) session.autoMemory.summaries = [];
  session.autoMemory.version = 1;
  return session.autoMemory;
}

function ensureTavernMessageIds(session) {
  if (!session || session.kind !== 'tavern' || !Array.isArray(session.messages)) return false;
  let changed = false;
  for (const message of session.messages) {
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) continue;
    if (!message.id) { message.id = uid(); changed = true; }
  }
  return changed;
}

function getTavernTurns(session) {
  if (!session || session.kind !== 'tavern' || !Array.isArray(session.messages)) return [];
  const turns = [];
  let pendingMessages = [];
  for (const message of session.messages) {
    if (!message) continue;
    if (message.role === 'user') {
      // 骰点等 meta 用户消息属于当前玩家回合，必须随该回合一起总结和保留。
      // 连续的用户消息也视作同一轮，避免在异常恢复后静默覆盖较早输入。
      if (!message.meta || pendingMessages.some(item => !item.meta)) pendingMessages.push(message);
      continue;
    }
    if (message.role !== 'assistant') continue;
    if (!pendingMessages.some(item => !item.meta)) { pendingMessages = []; continue; }
    turns.push({ messages: [...pendingMessages, message] });
    pendingMessages = [];
  }
  return turns;
}

function getTavernSummarizedIds(session) {
  const memory = ensureTavernSessionMemory(session);
  return new Set(memory.summaries.flatMap(summary => Array.isArray(summary.sourceMessageIds) ? summary.sourceMessageIds : []));
}

function getTavernUnsummarizedTurns(session) {
  const summarizedIds = getTavernSummarizedIds(session);
  return getTavernTurns(session).filter(turn => turn.messages.every(message => !summarizedIds.has(message.id)));
}

function tavernTurnHistory(session = curSession()) {
  if (!session || !Array.isArray(session.messages)) return [];
  const summarizedIds = getTavernSummarizedIds(session);
  // 历史请求不能只展开“完整回合”：发送请求时最新玩家输入天然还没有 AI 配对。
  return session.messages
    .filter(message => message && (message.role === 'user' || message.role === 'assistant') && !summarizedIds.has(message.id))
    .map(message => ({
      role: message.role,
      content: message.content || '',
      ...(message.meta ? { meta: true } : {}),
    }));
}

function buildTavernAutoMemoryPromptPart(session = curSession()) {
  if (mode !== 'tavern' || !tavernAutoMemoryConfig().enabled || !session) return '';
  const summaries = ensureTavernSessionMemory(session).summaries.filter(summary => summary?.text?.trim());
  if (!summaries.length) return '';
  return '【本会话自动记忆】\n' + summaries.map((summary, index) => `- ${index + 1}. ${summary.text.trim()}`).join('\n');
}

function renderTavernAutoMemoryStatus() {
  const status = $('mem-auto-status');
  if (!status) return;
  if (mode !== 'tavern') {
    status.textContent = '自动记忆仅在酒馆模式生效。';
    return;
  }
  const config = tavernAutoMemoryConfig();
  const session = curSession();
  if (!session) {
    status.textContent = config.enabled ? '自动记忆：已开启，等待 RP 会话。' : '自动记忆：已关闭。';
    return;
  }
  const memory = ensureTavernSessionMemory(session);
  const pending = getTavernUnsummarizedTurns(session).length;
  const lastError = tavernMemoryStatus.get(session.id);
  status.textContent = config.enabled
    ? `自动记忆：已开启 · 已生成 ${memory.summaries.length} 段摘要 · 待总结 ${pending}/${config.windowTurns} 轮${lastError ? ` · ${lastError}` : ''}`
    : `自动记忆：已关闭 · 当前会话已有 ${memory.summaries.length} 段摘要（重新开启后继续使用）`;
  status.classList.toggle('error', !!lastError);
}

function fillTavernAutoMemoryForm() {
  const config = tavernAutoMemoryConfig();
  if ($('mem-auto-enabled')) $('mem-auto-enabled').checked = config.enabled;
  if ($('mem-auto-window')) $('mem-auto-window').value = config.windowTurns;
  if ($('mem-auto-summarize')) $('mem-auto-summarize').value = config.summarizeTurns;
  if ($('mem-auto-chars')) $('mem-auto-chars').value = config.summaryChars;
  renderTavernAutoMemoryStatus();
}

function readTavernAutoMemoryForm() {
  if (!$('mem-auto-enabled')) return;
  const current = tavernAutoMemoryConfig();
  const windowTurns = Math.max(2, Math.min(100, Number($('mem-auto-window').value) || current.windowTurns));
  const summarizeTurns = Math.max(1, Math.min(windowTurns - 1, Number($('mem-auto-summarize').value) || current.summarizeTurns));
  const summaryChars = Math.max(20, Math.min(500, Number($('mem-auto-chars').value) || current.summaryChars));
  prefs.tavernAutoMemory = {
    enabled: $('mem-auto-enabled').checked,
    windowTurns,
    summarizeTurns,
    summaryChars,
  };
  saveJSON(LS_PREFS, prefs);
  renderTavernAutoMemoryStatus();
}

function clearTavernAutoMemory() {
  const session = curSession();
  if (!session) return;
  const memory = ensureTavernSessionMemory(session);
  if (!memory.summaries.length) return;
  if (!confirm('清空当前会话的自动摘要？原始聊天记录不会删除。')) return;
  memory.summaries = [];
  tavernMemoryStatus.delete(session.id);
  saveSessions(session);
  renderMessages();
}
async function resetCurrentWorldSave() {
  if (!worldModeActive() || !currentWorldSave) return;
  if (worldTurnPendingActive()) discardWorldTurnPending();
  const save = currentWorldSave;
  // 丢弃尚未提交的本地快照，避免它在重置请求之后覆盖基线。
  worldSavePending = null;
  await worldSaveWriteChain.catch(() => {});
  const expectedRevision = currentWorldSave?.id === save.id ? currentWorldSave.revision : save.revision;
  const response = await fetch('/api/world-saves/' + encodeURIComponent(save.id) + '/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ commandId: 'reset-' + uid(), expectedRevision }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.id) throw new Error(worldApiError(data, `RPG 存档重置失败（HTTP ${response.status}）`));
  hydrateWorldSave(data);
  currentWorldSave = data;
  currentWorldSaveId = data.id;
  worldTurnPending = null;
  worldTurnError = null;
  worldTurnEpoch++;
  clearResponsePreview();
  clearRpgCheckAnimation();
  renderRPG();
  renderSessions();
  renderWorldDetail();
  renderMessages();
  renderDebugTerminal();
}

function invalidateTavernAutoMemory(session, messageIds) {
  const memory = ensureTavernSessionMemory(session);
  if (!memory?.summaries?.length) return false;
  const ids = new Set(Array.isArray(messageIds) ? messageIds : [messageIds]);
  const affected = memory.summaries.some(summary => (summary.sourceMessageIds || []).some(id => ids.has(id)));
  if (!affected) return false;
  memory.summaries = [];
  tavernMemoryStatus.set(session.id, '历史已修改，自动摘要已清除');
  return true;
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

/* SillyTavern placement 兼容层。内部统一成阶段名，导入/导出仍保留 ST 的数字字段。 */
const REGEX_STAGE_ALIASES = Object.freeze({
  '0': 'chat_display', MD_DISPLAY: 'chat_display', DISPLAY: 'chat_display',
  '1': 'user_input', USER: 'user_input', USER_INPUT: 'user_input', INPUT: 'user_input',
  '2': 'ai_response', AI: 'ai_response', AI_OUTPUT: 'ai_response', AI_RESPONSE: 'ai_response', RESPONSE: 'ai_response',
  '3': 'slash_command', SLASH: 'slash_command', SLASH_COMMAND: 'slash_command',
  '4': 'send_as', SEND_AS: 'send_as',
  '5': 'world_info', WORLD: 'world_info', WORLD_INFO: 'world_info', WORLDINFO: 'world_info',
  '6': 'reasoning', REASONING: 'reasoning', THINKING: 'reasoning', COT: 'reasoning',
  CHAT_DISPLAY: 'chat_display', VISUAL: 'chat_display', MARKDOWN: 'chat_display',
  PROMPT: 'prompt', PROMPT_HISTORY: 'prompt_history', HISTORY: 'prompt_history', CHAT_HISTORY: 'prompt_history',
  SYSTEM: 'system_prompt', SYSTEM_PROMPT: 'system_prompt', POST_HISTORY: 'system_prompt',
});

const REGEX_STAGE_TO_ST_PLACEMENT = Object.freeze({
  chat_display: 0,
  user_input: 1,
  ai_response: 2,
  slash_command: 3,
  send_as: 4,
  world_info: 5,
  reasoning: 6,
});

function canonicalRegexStage(value) {
  if (value === null || value === undefined || value === '') return '';
  const key = String(value).trim().toUpperCase().replace(/[\s-]+/g, '_');
  return REGEX_STAGE_ALIASES[key] || (key === 'ALL' ? 'all' : key.toLowerCase());
}

function normalizeRegexStages(value, raw = {}) {
  const values = Array.isArray(value) ? value : (value === undefined || value === null || value === '' ? [] : [value]);
  const stages = values.map(canonicalRegexStage).filter(Boolean);
  if (raw.onlyFormatDisplay === true || raw.onlyFormatVisual === true || raw.only_format_visual === true || raw.markdownOnly === true) stages.push('chat_display');
  if (raw.onlyFormatPrompt === true || raw.only_format_prompt === true || raw.promptOnly === true) stages.push('prompt');
  if (!stages.length) stages.push('ai_response');
  return [...new Set(stages)];
}

function regexRulePresetScope(raw) {
  const value = raw?.presetScope ?? raw?.presetName ?? raw?.boundPresetName ?? raw?.preset_scope;
  return value === undefined || value === null || value === '' ? null : String(value);
}

function normalizeOutputRegexRule(source, index = 0, origin = 'custom') {
  const raw = source && typeof source === 'object' ? source : {};
  const trimStrings = Array.isArray(raw.trimStrings)
    ? raw.trimStrings.filter(value => typeof value === 'string')
    : (typeof raw.trimStrings === 'string' && raw.trimStrings
      ? raw.trimStrings.split(/\r?\n/).filter(Boolean)
      : []);
  const placement = raw.placement ?? raw.affects ?? raw.affected ?? raw.placements;
  const stages = normalizeRegexStages(raw.stages ?? raw.tavernStages ?? raw.targets ?? placement, raw);
  const parseDepth = value => value === null || value === undefined || value === ''
    ? null
    : (Number.isFinite(Number(value)) ? Number(value) : null);
  return {
    id: String(raw.id || `${origin}-regex-${index + 1}`),
    // SillyTavern uses scriptName; keep accepting the app's older name field.
    name: String(raw.name || raw.scriptName || raw.title || raw.id || `输出正则 ${index + 1}`),
    findRegex: String(raw.findRegex ?? raw.pattern ?? raw.find ?? ''),
    flags: String(raw.flags || ''),
    replaceString: String(raw.replaceString ?? raw.replacement ?? raw.replace ?? ''),
    trimStrings,
    enabled: raw.enabled !== false && raw.disabled !== true,
    placement: Array.isArray(placement) ? placement.slice(0, 8) : placement,
    stages,
    markdownOnly: raw.markdownOnly === true || raw.onlyFormatDisplay === true || raw.onlyFormatVisual === true || raw.only_format_visual === true,
    promptOnly: raw.promptOnly === true || raw.onlyFormatPrompt === true || raw.only_format_prompt === true,
    onlyFormatDisplay: raw.onlyFormatDisplay === true || raw.onlyFormatVisual === true || raw.only_format_visual === true || raw.markdownOnly === true,
    onlyFormatPrompt: raw.onlyFormatPrompt === true || raw.only_format_prompt === true || raw.promptOnly === true,
    runOnEdit: raw.runOnEdit === true,
    // ST stores this as 0/1/2. Preserve that value instead of coercing 0 to true.
    substituteRegex: raw.substituteRegex === undefined || raw.substituteRegex === null
      ? true
      : (raw.substituteRegex === false ? false : (Number.isFinite(Number(raw.substituteRegex)) ? Number(raw.substituteRegex) : true)),
    minDepth: parseDepth(raw.minDepth),
    maxDepth: parseDepth(raw.maxDepth),
    presetScope: regexRulePresetScope(raw),
    boundCustomId: raw.boundCustomId ? String(raw.boundCustomId) : null,
    boundCustomMode: ['tavern', 'rpg'].includes(raw.boundCustomMode) ? raw.boundCustomMode : null,
    source: origin,
  };
}

function normalizeOutputRegexRules(source, origin = 'custom') {
  const list = Array.isArray(source) ? source : (source && typeof source === 'object' ? Object.values(source) : []);
  return list.map((rule, index) => normalizeOutputRegexRule(rule, index, origin));
}

function escapeRegexMacro(value) {
  return String(value ?? '').replace(/[\\^$.*+?()[\]{}|/\-]/g, '\\$&').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
}

function regexMacroValues() {
  const char = currentChar();
  const world = currentWorldCard();
  const user = currentUserPreset();
  return {
    user: user?.name || '玩家',
    char: mode === 'rpg' && worldModeActive() ? (world?.title || '世界') : (char?.name || '角色'),
    persona: user?.persona || '',
  };
}

function expandRegexMacros(content, escaped = false) {
  const values = regexMacroValues();
  return String(content ?? '').replace(/\{\{\s*(user|char|persona)\s*\}\}/gi, (full, key) => {
    const value = values[String(key).toLowerCase()];
    return value === undefined ? full : (escaped ? escapeRegexMacro(value) : value);
  });
}

function buildOutputRegex(rule) {
  const substituteMode = rule?.substituteRegex === false ? 0 : Number(rule?.substituteRegex);
  const substitute = Number.isFinite(substituteMode) ? substituteMode : 1;
  const raw = String(substitute === 0 ? (rule?.findRegex || '') : expandRegexMacros(rule?.findRegex || '', substitute === 2)).trim();
  if (!raw || raw.length > 2000) return null;
  let pattern = raw;
  let flags = String(rule?.flags || '');
  const literal = raw.match(/^\/([\s\S]*)\/([a-z]*)$/i);
  if (literal) {
    pattern = literal[1];
    flags = literal[2];
  }
  flags = [...new Set(flags.split('').filter(flag => OUTPUT_REGEX_FLAGS.includes(flag)))].join('');
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

function currentRegexPresetScope(targetMode = mode) {
  if (targetMode !== mode) return activePresetNameForMode(targetMode) || GLOBAL_PRESET_KEY;
  return resolvePromptPreset()?.name || GLOBAL_PRESET_KEY;
}

function regexRuleAppliesToStage(rule, stage, { depth = null, editing = false, includePromptOnly = true } = {}) {
  if (!rule || rule.enabled === false) return false;
  if (editing && rule.runOnEdit !== true) return false;
  if (depth !== null && depth !== undefined) {
    if (rule.minDepth !== null && depth < rule.minDepth) return false;
    if (rule.maxDepth !== null && depth > rule.maxDepth) return false;
  }
  const target = canonicalRegexStage(stage);
  const stages = Array.isArray(rule.stages) && rule.stages.length ? rule.stages : ['ai_response'];
  if (rule.onlyFormatDisplay && !['chat_display', 'chat_display_persisted'].includes(target) && rule.source !== 'character') return false;
  if (rule.onlyFormatPrompt && !['prompt_history', 'system_prompt', 'world_info'].includes(target)) return false;
  if (!includePromptOnly && rule.onlyFormatPrompt) return false;
  if (target === 'chat_display') return stages.includes('chat_display') || stages.includes('ai_response') || rule.onlyFormatDisplay;
  if (target === 'chat_display_persisted') return stages.includes('chat_display') || rule.onlyFormatDisplay;
  // 角色卡的 legacy regex 常用 markdownOnly 生成整块 HTML；保留它在首轮响应时落盘，
  // 否则状态栏会在历史消息中失去结构。普通 ST 预设仍遵循“仅显示”语义。
  if (target === 'ai_response') return stages.includes('ai_response') && (!rule.onlyFormatDisplay || rule.source === 'character') && !rule.onlyFormatPrompt;
  if (target === 'prompt_history') return stages.includes('prompt') || stages.includes('prompt_history') || rule.onlyFormatPrompt;
  if (target === 'system_prompt') return stages.includes('prompt') || stages.includes('system_prompt') || rule.onlyFormatPrompt;
  if (target === 'world_info') return stages.includes('world_info') || stages.includes('prompt') || rule.onlyFormatPrompt;
  return stages.includes(target) || stages.includes('all');
}

function activeRegexRules(targetMode = mode) {
  const character = targetMode === 'tavern' && targetMode === mode ? currentChar() : null;
  const preset = targetMode === mode ? resolvePromptPreset()?.preset : null;
  const world = targetMode === 'rpg' && targetMode === mode && worldModeActive() ? currentWorldCard() : null;
  const presetRules = normalizeOutputRegexRules(preset?.regexes, 'preset');
  const boundCustomIds = new Set(presetRules.map(rule => rule.boundCustomId).filter(Boolean));
  const activePreset = currentRegexPresetScope(targetMode);
  return [
    // SillyTavern 角色卡常用自身 regex_scripts 把状态标签转换为 HTML；RP 中先执行卡片规则，再执行预设/自定义规则。
    ...normalizeOutputRegexRules(characterCardOutputRegexes(character), 'character'),
    ...normalizeOutputRegexRules(world?.regexes, 'world'),
    ...presetRules,
    // 绑定到预设的模式正则已在 presetRules 中执行，避免同一条规则重复替换。
    ...normalizeOutputRegexRules(modeOutputRegexes(targetMode), 'custom').filter(rule => !boundCustomIds.has(rule.id)
      && (!rule.presetScope || rule.presetScope === activePreset)),
  ];
}

function activeOutputRegexRules(targetMode = mode, stage = 'ai_response', options = {}) {
  return activeRegexRules(targetMode).filter(rule => regexRuleAppliesToStage(rule, stage, options));
}

function applyRegexStage(text, stage, { targetMode = mode, depth = null, editing = false, includePromptOnly = true } = {}) {
  const rules = activeOutputRegexRules(targetMode, stage, { depth, editing, includePromptOnly });
  return rules.length ? applyOutputRegexRules(text, rules) : String(text ?? '');
}

function applyOutputRegexRule(output, rule, regex) {
  const replacement = expandRegexMacros(rule.replaceString || '');
  if (!replacement.includes('{{match}}') && !rule.trimStrings.length) return output.replace(regex, replacement);
  return output.replace(regex, (...args) => {
    const match = String(args[0] || '');
    const groups = typeof args.at(-1) === 'object' ? args.at(-1) : null;
    const captures = args.slice(1, groups ? -3 : -2);
    let trimmed = match;
    for (const trim of rule.trimStrings) if (trim) trimmed = trimmed.split(expandRegexMacros(trim)).join('');
    return replacement
      .replace(/\{\{match\}\}/g, trimmed)
      .replace(/\$(\d+)|\$<([^>]+)>/g, (_, index, name) => index
        ? (captures[Number(index) - 1] ?? '')
        : (groups?.[name] ?? ''));
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
function renderOutputContent(text, targetMode = mode, { fromRaw = true } = {}) {
  const source = String(text || '');
  const rules = activeOutputRegexRules(targetMode, fromRaw ? 'chat_display' : 'chat_display_persisted');
  const needsRegex = rules.some(rule => {
    const regex = buildOutputRegex(rule);
    if (!regex) return false;
    regex.lastIndex = 0;
    return regex.test(source);
  });
  return recoverStructuredTagOutput(needsRegex ? applyOutputRegexRules(source, rules) : source);
}

function applyCharacterCardOutputRegex(text) {
  return recoverStructuredTagOutput(applyOutputRegexRules(text, activeOutputRegexRules('tavern', 'ai_response').filter(rule => rule.source === 'character')));
}

function applyOutputRegex(text, targetMode = mode) {
  return recoverStructuredTagOutput(applyOutputRegexRules(text, activeOutputRegexRules(targetMode, 'ai_response')));
}

function serializeOutputRegexRule(rule) {
  const substituteRegex = rule.substituteRegex === false
    ? 0
    : (Number.isFinite(Number(rule.substituteRegex)) ? Number(rule.substituteRegex) : 1);
  const stages = Array.isArray(rule.stages) ? rule.stages : [];
  const exportPlacement = [...new Set((stages.length ? stages : (Array.isArray(rule.placement) ? rule.placement : [2]))
    .map(value => REGEX_STAGE_TO_ST_PLACEMENT[canonicalRegexStage(value)] ?? Number(value))
    .filter(value => Number.isFinite(value) && value >= 0 && value <= 6))];
  return {
    id: rule.id,
    // SillyTavern's regex editor requires scriptName; `name` is ignored there.
    scriptName: rule.name,
    findRegex: rule.findRegex,
    ...(rule.flags ? { flags: rule.flags } : {}),
    replaceString: rule.replaceString,
    trimStrings: Array.isArray(rule.trimStrings) ? rule.trimStrings : [],
    disabled: rule.enabled === false,
    placement: exportPlacement.length ? exportPlacement : [2],
    tavernStages: stages,
    markdownOnly: rule.markdownOnly === true,
    promptOnly: rule.promptOnly === true,
    only_format_visual: rule.onlyFormatDisplay === true,
    only_format_prompt: rule.onlyFormatPrompt === true,
    runOnEdit: rule.runOnEdit === true,
    substituteRegex,
    ...(rule.minDepth !== null ? { minDepth: rule.minDepth } : {}),
    ...(rule.maxDepth !== null ? { maxDepth: rule.maxDepth } : {}),
  };
}

function presetMode(name, preset) {
  if (preset && ['tavern', 'rpg', 'both'].includes(preset.mode)) return preset.mode;
  if (name === GLOBAL_PRESET_KEY) return 'both';
  return /RPG/i.test(name || '') ? 'rpg' : 'tavern';
}

function presetPromptEnabledByDefault(identifier, targetMode = mode) {
  if (identifier === 'enhanceDefinitions') return false;
  if (identifier === 'tavernRpg') return targetMode !== 'tavern';
  return true;
}

function makePresetMarker(identifier, name, content = '') {
  const marker = PRESET_MARKER_IDS.has(identifier);
  return {
    identifier,
    name,
    role: 'system',
    content,
    marker,
    pinned: true,
    systemPrompt: true,
    position: 'relative',
    depth: 4,
    order: 100,
  };
}

function normalizeSTPresetSettings(...sources) {
  const normalized = {};
  for (const key of ST_PRESET_SETTING_KEYS) {
    for (const source of sources) {
      if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
      if (!Object.prototype.hasOwnProperty.call(source, key) || source[key] === undefined) continue;
      normalized[key] = cloneValue(source[key]);
      break;
    }
  }
  return normalized;
}

function normalizePromptOrderProfiles(value) {
  if (!Array.isArray(value)) return [];
  return value.map(profile => {
    const source = profile && typeof profile === 'object' ? profile : {};
    const order = Array.isArray(source.order) ? source.order.map(item => {
      const entry = typeof item === 'string' ? { identifier: item } : (item || {});
      return { identifier: String(entry.identifier || entry.id || ''), enabled: entry.enabled !== false };
    }).filter(item => item.identifier && item.identifier !== 'tavernFormat') : [];
    return { ...source, character_id: source.character_id ?? source.characterId ?? source.id, order };
  }).filter(profile => profile.character_id !== undefined && profile.order.length);
}

function insertPinnedPromptOrder(promptOrder, identifier, targetMode) {
  const definitionIndex = PRESET_MARKERS.findIndex(([id]) => id === identifier);
  const laterIds = new Set(PRESET_MARKERS.slice(definitionIndex + 1).map(([id]) => id));
  const before = promptOrder.findIndex(item => laterIds.has(item.identifier));
  const item = { identifier, enabled: presetPromptEnabledByDefault(identifier, targetMode) };
  promptOrder.splice(before < 0 ? promptOrder.length : before, 0, item);
}

function splitTavernReplyOptionsPostHistory(value) {
  const text = String(value || '');
  const marker = '【AI 回复选项协议】';
  const markerIndex = text.lastIndexOf(marker);
  if (markerIndex < 0) return { postHistory: text, instruction: '' };
  const instruction = text.slice(markerIndex).trim();
  // 只迁移确实包含隐藏标签协议的尾段，避免误拆用户碰巧使用同名标题的普通提示词。
  if (!hasTavernReplyOptionsProtocol(instruction)) return { postHistory: text, instruction: '' };
  return { postHistory: text.slice(0, markerIndex).trimEnd(), instruction };
}

function normalizeTavernReplyOptionsOverride(value, migratedInstruction = '') {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  const migrated = String(migratedInstruction || '').trim();
  if (!source && !migrated) return null;
  const normalized = {};
  if (source && Object.prototype.hasOwnProperty.call(source, 'enabled')) normalized.enabled = source.enabled !== false;
  else if (migrated) normalized.enabled = true;

  const numeric = {};
  for (const key of ['min', 'max', 'count']) {
    const parsed = Number(source?.[key]);
    if (Number.isFinite(parsed)) numeric[key] = Math.max(1, Math.min(8, Math.floor(parsed)));
  }
  if (numeric.count !== undefined && numeric.min === undefined && numeric.max === undefined) {
    numeric.min = numeric.count;
    numeric.max = numeric.count;
  }
  Object.assign(normalized, numeric);

  const instruction = String(source?.instruction || migrated).trim();
  if (instruction) normalized.instruction = instruction;
  if (source && Object.prototype.hasOwnProperty.call(source, 'assistantMessage')) normalized.assistantMessage = String(source.assistantMessage || '');
  if (source && Object.prototype.hasOwnProperty.call(source, 'noOptions')) normalized.noOptions = String(source.noOptions || '');
  return Object.keys(normalized).length ? normalized : null;
}

function normalizePromptPreset(name, source) {
  const src = source && typeof source === 'object' ? source : {};
  const sourceRegexes = src.regexes
    ?? src.extensions?.regex_scripts
    ?? src.extensions?.regexScripts
    ?? src.regexScripts;
  if (Array.isArray(src.prompts) && Array.isArray(src.promptOrder)) {
    const seen = new Set();
    const prompts = src.prompts.filter(p => String(p?.identifier || p?.id || '') !== 'tavernFormat').map((p, i) => {
      let identifier = String(p.identifier || p.id || `prompt-${i + 1}`);
      while (seen.has(identifier)) identifier += '-copy';
      seen.add(identifier);
      // In ST, system_prompt marks a pinned/default prompt; marker alone means runtime content.
      // Older Tavern data marked main/jailbreak as runtime slots, so force those editable again.
      const marker = !['main', 'jailbreak', 'enhanceDefinitions', 'nsfw'].includes(identifier)
        && (!!p.marker || PRESET_MARKER_IDS.has(identifier));
      const pinned = p.pinned === true || p.systemPrompt === true || p.system_prompt === true || PRESET_PINNED_IDS.has(identifier);
      return {
        ...p,
        identifier,
        name: String(p.name || identifier),
        role: marker ? 'system' : (['system', 'user', 'assistant'].includes(p.role) ? p.role : 'system'),
        content: String(p.content || ''),
        marker,
        pinned,
        systemPrompt: pinned,
        position: marker ? 'relative' : (p.position === 'in_chat' ? 'in_chat' : 'relative'),
        depth: Math.max(0, Number(p.depth ?? p.injection_depth ?? 4) || 0),
        order: Number(p.order ?? p.injection_order ?? 100) || 0,
      };
    });
    const ids = new Set(prompts.map(p => p.identifier));
    const orderedIds = new Set();
    const promptOrder = src.promptOrder
      .map(o => typeof o === 'string' ? { identifier: o } : o)
      .filter(o => o && o.identifier !== 'tavernFormat' && ids.has(o.identifier) && !orderedIds.has(o.identifier))
      .map(o => {
        orderedIds.add(o.identifier);
        return { identifier: o.identifier, enabled: o.enabled !== false };
      });
    const targetMode = presetMode(name, src);
    for (const [identifier, label] of PRESET_MARKERS) {
      if (!ids.has(identifier)) {
        prompts.push(makePresetMarker(identifier, label));
        ids.add(identifier);
      }
      if (!orderedIds.has(identifier)) {
        insertPinnedPromptOrder(promptOrder, identifier, targetMode);
        orderedIds.add(identifier);
      }
    }
    const jailbreak = prompts.find(prompt => prompt.identifier === 'jailbreak');
    const explicitPostHistory = String(src.postHistory || '');
    const jailbreakContent = String(jailbreak?.content || '');
    let migratedPostHistory = jailbreakContent;
    if (explicitPostHistory.trim()) {
      migratedPostHistory = jailbreakContent.trim() && jailbreakContent.trim() !== explicitPostHistory.trim()
        ? `${jailbreakContent.trim()}\n\n${explicitPostHistory.trim()}`
        : explicitPostHistory;
    }
    const separated = splitTavernReplyOptionsPostHistory(migratedPostHistory);
    if (jailbreak) jailbreak.content = separated.postHistory;
    const replyOptions = normalizeTavernReplyOptionsOverride(src.replyOptions, separated.instruction);
    const modelParameters = normalizeSTPresetSettings(src.modelParameters, src);
    const promptOrderProfiles = normalizePromptOrderProfiles(src.promptOrderProfiles);
    const normalized = {
      ...src,
      version: PRESET_SCHEMA_VERSION,
      mode: targetMode,
      firstMes: String(src.firstMes || ''),
      prompts,
      promptOrder,
      regexes: normalizeOutputRegexRules(sourceRegexes, 'preset'),
    };
    delete normalized.systemPrompt;
    delete normalized.postHistory;
    delete normalized.modules;
    delete normalized.modelParameters;
    delete normalized.promptOrderProfiles;
    delete normalized.replyOptions;
    for (const key of ST_PRESET_SETTING_KEYS) delete normalized[key];
    if (Object.keys(modelParameters).length) normalized.modelParameters = modelParameters;
    if (promptOrderProfiles.length) normalized.promptOrderProfiles = promptOrderProfiles;
    if (replyOptions) normalized.replyOptions = replyOptions;
    return normalized;
  }

  const prompts = PRESET_MARKERS.map(([id, label]) => makePresetMarker(
    id,
    label,
    id === 'main' ? String(src.systemPrompt || '') : '',
  ));
  const targetMode = presetMode(name, src);
  const promptOrder = prompts.map(p => ({ identifier: p.identifier, enabled: presetPromptEnabledByDefault(p.identifier, targetMode) }));
  const moduleIndex = promptOrder.findIndex(o => o.identifier === 'worldInfoAfter');
  for (const [i, module] of (Array.isArray(src.modules) ? src.modules : []).entries()) {
    let identifier = String(module.id || `module-${i + 1}`);
    while (prompts.some(p => p.identifier === identifier)) identifier += '-copy';
    prompts.push({ identifier, name: String(module.name || identifier), role: 'system', content: String(module.content || ''), marker: false, pinned: false, systemPrompt: false, position: 'relative', depth: 4, order: 100 });
    promptOrder.splice(moduleIndex + i, 0, { identifier, enabled: module.enabled !== false });
  }
  const separated = splitTavernReplyOptionsPostHistory(src.postHistory);
  const jailbreak = prompts.find(prompt => prompt.identifier === 'jailbreak');
  if (jailbreak) jailbreak.content = separated.postHistory;
  const replyOptions = normalizeTavernReplyOptionsOverride(src.replyOptions, separated.instruction);
  const modelParameters = normalizeSTPresetSettings(src.modelParameters, src);
  return {
    version: PRESET_SCHEMA_VERSION,
    mode: targetMode,
    firstMes: String(src.firstMes || ''),
    prompts,
    promptOrder,
    regexes: normalizeOutputRegexRules(sourceRegexes, 'preset'),
    ...(Object.keys(modelParameters).length ? { modelParameters } : {}),
    ...(replyOptions ? { replyOptions } : {}),
    ...(src.agent && typeof src.agent === 'object' && !Array.isArray(src.agent) ? { agent: cloneValue(src.agent) } : {}),
  };
}

function ensurePromptPresetsV3() {
  let changed = false;
  for (const name of Object.keys(promptPresets)) {
    const before = JSON.stringify(promptPresets[name]);
    const normalized = normalizePromptPreset(name, promptPresets[name]);
    if (before !== JSON.stringify(normalized)) changed = true;
    promptPresets[name] = normalized;
  }
  return changed;
}

function migrateLegacyGlobalPromptSettings() {
  const hadLegacyFields = Object.prototype.hasOwnProperty.call(settings || {}, 'systemPrompt')
    || Object.prototype.hasOwnProperty.call(settings || {}, 'postHistory');
  const legacyMain = String(settings?.systemPrompt || '').trim();
  const legacyPost = String(settings?.postHistory || '').trim();
  if (legacyMain || legacyPost) {
    const globalPreset = normalizePromptPreset(GLOBAL_PRESET_KEY, promptPresets[GLOBAL_PRESET_KEY] || {});
    const main = globalPreset.prompts.find(prompt => prompt.identifier === 'main');
    const jailbreak = globalPreset.prompts.find(prompt => prompt.identifier === 'jailbreak');
    if (legacyMain && main && !main.content.trim()) main.content = legacyMain;
    if (legacyPost && jailbreak && !jailbreak.content.trim()) jailbreak.content = legacyPost;
    promptPresets[GLOBAL_PRESET_KEY] = globalPreset;
  }
  delete settings.systemPrompt;
  delete settings.postHistory;
  return hadLegacyFields;
}

function migrateLegacyFormatPreferences() {
  const hadLegacyFields = Object.prototype.hasOwnProperty.call(prefs || {}, 'formatPreset')
    || Object.prototype.hasOwnProperty.call(prefs || {}, 'formatCustom');
  if (!hadLegacyFields) return false;
  const selected = String(prefs.formatPreset || '');
  const legacyPresetText = {
    short: '请用简短的一两句话回应。',
    narrative: '请用长叙事风格回应：详细描写场景、氛围与角色内心，至少 2~3 段，推动剧情发展。',
    action: '请以角色扮演风格回应：动作与神态用 *斜体* 描写，对白自然，主动推进互动。',
    json: '请以 JSON 对象输出，字段：{"reply": "对白", "action": "动作/神态", "thought": "内心想法"}。不要输出其他内容。',
  }[selected] || '';
  // dialogue 是本次明确删除的旧内置输出协议；用户亲自填写的 custom 仍迁为可关闭提示词。
  const content = [legacyPresetText, String(prefs.formatCustom || '').trim()].filter(Boolean).join('\n\n');
  if (content) {
    if (!Object.keys(promptPresets).length) promptPresets[GLOBAL_PRESET_KEY] = normalizePromptPreset(GLOBAL_PRESET_KEY, {});
    for (const name of Object.keys(promptPresets)) {
      const preset = normalizePromptPreset(name, promptPresets[name]);
      if (preset.prompts.some(prompt => prompt.identifier === 'legacy-format-migrated')) continue;
      preset.prompts.push({
        identifier: 'legacy-format-migrated', name: '已迁移的旧格式指令', role: 'system', content,
        marker: false, pinned: false, systemPrompt: false, position: 'relative', depth: 4, order: 100,
      });
      const historyIndex = preset.promptOrder.findIndex(item => item.identifier === 'chatHistory');
      preset.promptOrder.splice(historyIndex < 0 ? preset.promptOrder.length : historyIndex, 0, {
        identifier: 'legacy-format-migrated', enabled: true,
      });
      promptPresets[name] = preset;
    }
  }
  delete prefs.formatPreset;
  delete prefs.formatCustom;
  return true;
}

// 只清理旧内置模板中可明确识别的隐藏/重复协议；用户自建提示词不按名称猜测删除。
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
  if (promptPresets[name]) {
    const before = JSON.stringify(promptPresets[name]);
    const normalized = normalizePromptPreset(name, promptPresets[name]);
    const obsoleteProtocol = normalized.prompts.find(prompt => prompt.identifier === 'protocol'
      && /^【输出协议】每轮回复\s*=\s*旁白\s*\+\s*可选对白/.test(String(prompt.content || '').trim()));
    if (obsoleteProtocol) {
      normalized.prompts = normalized.prompts.filter(prompt => prompt !== obsoleteProtocol);
      normalized.promptOrder = normalized.promptOrder.filter(item => item.identifier !== obsoleteProtocol.identifier);
    }
    const normalizedBuiltin = builtin ? normalizePromptPreset(name, builtin) : null;
    const currentMain = normalized.prompts.find(prompt => prompt.identifier === 'main');
    const builtinMain = normalizedBuiltin?.prompts.find(prompt => prompt.identifier === 'main');
    if (currentMain && builtinMain
      && currentMain.content.includes('你是一位互动小说作者（writer）')
      && currentMain.content.includes('严格区分对白与旁白')) {
      currentMain.content = builtinMain.content;
    }
    promptPresets[name] = normalized;
    if (before !== JSON.stringify(normalized)) changed = true;
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
    const regexCount = normalizeOutputRegexRules(promptPresets[name]?.regexes, 'preset').length;
    el.className = 'cm-item' + (name === pgEditingName ? ' active' : '') + (inUse ? ' pg-inuse' : '');
    el.innerHTML = `<span>${esc(display)} <small>${badge}${regexCount ? ` · 正则 ${regexCount}` : ''}</small>${inUse ? ' ●' : ''}</span>${name === GLOBAL_PRESET_KEY ? '' : '<span class="cm-x" data-act="del" title="删除">✕</span>'}`;
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
  // The effective preset can be forced by the current character/world card.
  // Reading the old select value here made the editor display a stale choice.
  const resolved = resolvePromptPreset();
  const actualName = resolved.name || '';
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
  sel.value = actualName && [...sel.options].some(option => option.value === actualName) ? actualName : '';
  const active = actualName || '全局默认';
  const char = currentChar();
  const world = currentWorldCard();
  const boundByCharacter = !!actualName && mode === 'tavern' && char?.presetName === actualName;
  const boundByWorld = !!actualName && mode === 'rpg' && world?.rpgPresetName === actualName;
  const source = boundByCharacter ? '（由当前角色卡绑定）' : (boundByWorld ? '（由当前世界卡绑定）' : '');
  const note = $('pg-active-note');
  if (note) note.textContent = `当前${mode === 'rpg' ? 'RPG' : '酒馆'}模式实际使用：${active}${source}。左侧列表用于编辑预设内容。`;
}

function selectPresetForEdit(name) {
  setMobilePromptPanel('sequence');
  pgEditingName = name || GLOBAL_PRESET_KEY;
  pgEditingPreset = normalizePromptPreset(pgEditingName, promptPresets[pgEditingName]);
  pgEditingPromptId = pgEditingPreset.promptOrder[0]?.identifier || null;
  $('pg-edit-title').textContent = pgEditingName === GLOBAL_PRESET_KEY ? '编辑全局默认' : '编辑预设：' + pgEditingName;
  $('pg-mode').value = pgEditingPreset.mode;
  $('pg-first-mes').value = pgEditingPreset.firstMes;
  fillPGReplyOptions();
  fillPGSTPresetSettings();
  fillPGActive();
  renderPGPrompts();
  renderPGRegexBindings();
  renderPGList();
}

function fillPGReplyOptions() {
  const enabledInput = $('pg-reply-options-enabled');
  const countInput = $('pg-reply-options-count');
  const promptInput = $('pg-reply-options-prompt');
  if (!enabledInput || !countInput || !promptInput) return;
  pgReplyOptionsInherited = !pgEditingPreset?.replyOptions || typeof pgEditingPreset.replyOptions !== 'object';
  const config = tavernReplyOptionsConfig(pgEditingPreset) || {};
  const configuredCount = Number(config.count ?? config.max ?? config.min);
  enabledInput.checked = config.enabled !== false;
  countInput.value = String(Number.isFinite(configuredCount) ? Math.max(1, Math.min(8, Math.floor(configuredCount))) : 4);
  promptInput.value = String(config.instruction || builtInTavernReplyOptionsInstruction() || '');
  if ($('pg-reply-options-assistant')) $('pg-reply-options-assistant').value = String(config.assistantMessage || '');
  syncPGReplyOptionsEditor();
}

function syncPGReplyOptionsEditor() {
  const section = $('pg-reply-options');
  const enabledInput = $('pg-reply-options-enabled');
  const countInput = $('pg-reply-options-count');
  const promptInput = $('pg-reply-options-prompt');
  const resetButton = $('pg-reply-options-reset');
  const note = $('pg-reply-options-note');
  if (!section || !enabledInput || !countInput || !promptInput) return;
  const selectedMode = $('pg-mode')?.value || pgEditingPreset?.mode || 'tavern';
  const appliesToTavern = selectedMode !== 'rpg';
  enabledInput.disabled = !appliesToTavern;
  countInput.disabled = !appliesToTavern || !enabledInput.checked;
  promptInput.disabled = !appliesToTavern || !enabledInput.checked;
  if ($('pg-reply-options-assistant')) $('pg-reply-options-assistant').disabled = promptInput.disabled;
  if (resetButton) resetButton.disabled = !appliesToTavern;
  section.classList.toggle('inactive', !appliesToTavern);
  if (note) {
    note.textContent = appliesToTavern
      ? (enabledInput.checked
        ? `${pgReplyOptionsInherited ? '当前继承项目默认；修改任一项后改为随本预设保存。' : '当前使用本预设的独立配置。'} 可用 {count}、{min}、{max} 代入数量；若省略 <tavern_options> 标签协议，运行时会自动补上默认结构要求。`
        : '已关闭：不会要求或修复普通 RP 的回复选项，底部快捷选项栏也不会等待选项。')
      : '此开关只控制普通 RP（酒馆）回复选项；RPG 世界模式的选项属于状态协议，不受这里影响。';
  }
}

function markPGReplyOptionsCustomized() {
  pgReplyOptionsInherited = false;
  syncPGReplyOptionsEditor();
}

function capturePGReplyOptions() {
  if (!pgEditingPreset) return;
  const selectedMode = $('pg-mode')?.value || pgEditingPreset.mode || 'tavern';
  // 纯 RPG 预设不读取这组字段；保存 RPG 编辑内容时也不能凭禁用控件捏造 RP 配置。
  if (selectedMode === 'rpg') return;
  if (pgReplyOptionsInherited) {
    delete pgEditingPreset.replyOptions;
    return;
  }
  const enabledInput = $('pg-reply-options-enabled');
  const countInput = $('pg-reply-options-count');
  const promptInput = $('pg-reply-options-prompt');
  if (!enabledInput || !countInput || !promptInput) return;
  const count = Math.max(1, Math.min(8, Math.floor(Number(countInput.value) || 4)));
  let instruction = String(promptInput.value || '').trim();
  if (enabledInput.checked && !instruction) {
    instruction = String(defaults?.tavern?.replyOptions?.instruction || builtInTavernReplyOptionsInstruction() || '').trim();
    promptInput.value = instruction;
  }
  const previous = normalizeTavernReplyOptionsOverride(pgEditingPreset.replyOptions) || {};
  pgEditingPreset.replyOptions = {
    enabled: enabledInput.checked,
    min: count,
    max: count,
    count,
    ...(instruction ? { instruction } : {}),
    ...($('pg-reply-options-assistant') ? { assistantMessage: String($('pg-reply-options-assistant').value || '') } :
      (Object.prototype.hasOwnProperty.call(previous, 'assistantMessage') ? { assistantMessage: previous.assistantMessage } : {})),
    ...(Object.prototype.hasOwnProperty.call(previous, 'noOptions') ? { noOptions: previous.noOptions } : {}),
  };
}

function resetPGReplyOptions() {
  if (!pgEditingPreset) return;
  delete pgEditingPreset.replyOptions;
  fillPGReplyOptions();
}

function stPresetUtilityDefaults() {
  return {
    wi_format: '{0}',
    scenario_format: '{{scenario}}',
    personality_format: '{{personality}}',
    new_chat_prompt: '',
    new_example_chat_prompt: '',
    assistant_prefill: '',
  };
}

function fillPGSTPresetSettings() {
  if (!pgEditingPreset) return;
  const parameters = pgEditingPreset.modelParameters && typeof pgEditingPreset.modelParameters === 'object'
    ? pgEditingPreset.modelParameters : {};
  const numberValues = {
    'pg-param-temperature': parameters.temperature,
    'pg-param-max-tokens': parameters.max_completion_tokens ?? parameters.openai_max_tokens ?? parameters.max_tokens,
    'pg-param-top-p': parameters.top_p,
    'pg-param-frequency-penalty': parameters.frequency_penalty,
    'pg-param-presence-penalty': parameters.presence_penalty,
    'pg-param-seed': parameters.seed,
    'pg-param-top-k': parameters.top_k,
    'pg-param-top-a': parameters.top_a,
    'pg-param-min-p': parameters.min_p,
    'pg-param-repetition-penalty': parameters.repetition_penalty,
  };
  for (const [id, value] of Object.entries(numberValues)) {
    const input = $(id);
    if (input) input.value = value === undefined || value === null ? '' : String(value);
  }
  const defaultsMap = stPresetUtilityDefaults();
  const textValues = {
    'pg-format-world-info': parameters.wi_format ?? defaultsMap.wi_format,
    'pg-format-scenario': parameters.scenario_format ?? defaultsMap.scenario_format,
    'pg-format-personality': parameters.personality_format ?? defaultsMap.personality_format,
    'pg-new-chat-prompt': parameters.new_chat_prompt ?? defaultsMap.new_chat_prompt,
    'pg-new-example-prompt': parameters.new_example_chat_prompt ?? defaultsMap.new_example_chat_prompt,
    'pg-assistant-prefill': parameters.assistant_prefill ?? defaultsMap.assistant_prefill,
    'pg-param-stop': Array.isArray(parameters.stop) ? JSON.stringify(parameters.stop) : (parameters.stop ?? ''),
  };
  for (const [id, value] of Object.entries(textValues)) {
    const input = $(id);
    if (input) input.value = String(value || '');
  }
  const fillSelect = (id, value) => {
    const select = $(id);
    if (!select) return;
    select.querySelectorAll('option[data-imported]').forEach(option => option.remove());
    const stringValue = value === undefined || value === null ? '' : String(value);
    if (stringValue && ![...select.options].some(option => option.value === stringValue)) {
      const option = document.createElement('option');
      option.value = stringValue;
      option.textContent = `导入值：${stringValue}`;
      option.dataset.imported = 'true';
      select.appendChild(option);
    }
    select.value = stringValue;
  };
  fillSelect('pg-param-stream', parameters.stream_openai ?? parameters.stream);
  fillSelect('pg-squash-system', parameters.squash_system_messages);
  fillSelect('pg-param-reasoning-effort', parameters.reasoning_effort);
}

function capturePGSTPresetSettings() {
  if (!pgEditingPreset) return;
  const parameters = normalizeSTPresetSettings(pgEditingPreset.modelParameters);
  const captureNumber = (id, key, { min = -Infinity, max = Infinity, integer = false } = {}) => {
    const input = $(id);
    if (!input) return;
    const raw = String(input.value || '').trim();
    if (!raw) { delete parameters[key]; return; }
    let value = Number(raw);
    if (!Number.isFinite(value)) { delete parameters[key]; return; }
    value = Math.max(min, Math.min(max, integer ? Math.floor(value) : value));
    parameters[key] = value;
  };
  captureNumber('pg-param-temperature', 'temperature', { min: 0, max: 2 });
  delete parameters.max_tokens;
  delete parameters.max_completion_tokens;
  captureNumber('pg-param-max-tokens', 'openai_max_tokens', { min: 1, max: 1000000, integer: true });
  captureNumber('pg-param-top-p', 'top_p', { min: 0, max: 1 });
  captureNumber('pg-param-frequency-penalty', 'frequency_penalty', { min: -2, max: 2 });
  captureNumber('pg-param-presence-penalty', 'presence_penalty', { min: -2, max: 2 });
  captureNumber('pg-param-seed', 'seed', { min: -1, max: 2147483647, integer: true });
  captureNumber('pg-param-top-k', 'top_k', { min: 0, max: 1000, integer: true });
  captureNumber('pg-param-top-a', 'top_a', { min: 0, max: 1 });
  captureNumber('pg-param-min-p', 'min_p', { min: 0, max: 1 });
  captureNumber('pg-param-repetition-penalty', 'repetition_penalty', { min: 0.01, max: 2 });

  const streamValue = String($('pg-param-stream')?.value || '');
  delete parameters.stream;
  if (streamValue) parameters.stream_openai = streamValue === 'true';
  else delete parameters.stream_openai;
  const squashValue = String($('pg-squash-system')?.value || '');
  if (squashValue) parameters.squash_system_messages = squashValue === 'true';
  else delete parameters.squash_system_messages;
  const reasoningEffort = String($('pg-param-reasoning-effort')?.value || '').trim();
  if (reasoningEffort) parameters.reasoning_effort = reasoningEffort;
  else delete parameters.reasoning_effort;
  const stopValue = String($('pg-param-stop')?.value || '').trim();
  if (!stopValue) delete parameters.stop;
  else if (stopValue.startsWith('[')) {
    try {
      const parsed = JSON.parse(stopValue);
      parameters.stop = Array.isArray(parsed) ? parsed.map(value => String(value)).filter(Boolean).slice(0, 16) : stopValue;
    } catch {
      parameters.stop = stopValue;
    }
  } else {
    const lines = stopValue.split(/\r?\n/).map(value => value.trim()).filter(Boolean).slice(0, 16);
    parameters.stop = lines.length > 1 ? lines : stopValue;
  }

  const textFields = {
    'pg-format-world-info': 'wi_format',
    'pg-format-scenario': 'scenario_format',
    'pg-format-personality': 'personality_format',
    'pg-new-chat-prompt': 'new_chat_prompt',
    'pg-new-example-prompt': 'new_example_chat_prompt',
    'pg-assistant-prefill': 'assistant_prefill',
  };
  for (const [id, key] of Object.entries(textFields)) {
    const input = $(id);
    if (input) parameters[key] = String(input.value || '');
  }
  pgEditingPreset.modelParameters = parameters;
}

function resetPGSTPresetSettings() {
  if (!pgEditingPreset) return;
  const preserved = normalizeSTPresetSettings(pgEditingPreset.modelParameters);
  for (const key of [
    'temperature', 'openai_max_tokens', 'max_tokens', 'max_completion_tokens', 'top_p',
    'frequency_penalty', 'presence_penalty', 'seed', 'top_k', 'top_a', 'min_p',
    'repetition_penalty', 'stream', 'stream_openai', 'squash_system_messages', 'reasoning_effort',
    'stop', 'wi_format', 'scenario_format', 'personality_format', 'new_chat_prompt',
    'new_example_chat_prompt', 'assistant_prefill',
  ]) delete preserved[key];
  Object.assign(preserved, stPresetUtilityDefaults());
  pgEditingPreset.modelParameters = preserved;
  fillPGSTPresetSettings();
}

function capturePGPresetMetadata() {
  if (!pgEditingPreset) return;
  pgEditingPreset.mode = $('pg-mode').value;
  pgEditingPreset.firstMes = $('pg-first-mes').value;
  capturePGReplyOptions();
  capturePGSTPresetSettings();
}

function presetRegexBindingModes() {
  const selectedMode = $('pg-mode')?.value;
  const targetMode = ['tavern', 'rpg', 'both'].includes(selectedMode) ? selectedMode : pgEditingPreset?.mode;
  return targetMode === 'both' ? ['tavern', 'rpg'] : [targetMode === 'rpg' ? 'rpg' : 'tavern'];
}

function renderPGRegexBindings() {
  const host = $('pg-regex-binding-list');
  if (!host) return;
  const customRules = [];
  const seen = new Set();
  for (const targetMode of presetRegexBindingModes()) {
    for (const rule of normalizeOutputRegexRules(modeOutputRegexes(targetMode), 'custom')) {
      if (seen.has(rule.id)) continue;
      seen.add(rule.id);
      customRules.push({ ...rule, bindingMode: targetMode });
    }
  }
  const boundRules = normalizeOutputRegexRules(pgEditingPreset?.regexes, 'preset');
  const boundIds = new Set(boundRules.map(rule => rule.boundCustomId).filter(Boolean));
  host.innerHTML = '';
  if (!customRules.length && !boundRules.length) {
    host.innerHTML = '<div class="hint">当前模式还没有自定义正则。请先到「正则」栏目创建，或导入带正则的 ST 预设。</div>';
    return;
  }
  if (customRules.length) {
    for (const rule of customRules) {
      const label = document.createElement('label');
      label.className = 'pg-regex-binding';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = boundIds.has(rule.id);
      checkbox.addEventListener('change', () => togglePGRegexBinding(rule.id, checkbox.checked, rule.bindingMode));
      const text = document.createElement('span');
      text.textContent = rule.name;
      const source = document.createElement('small');
      source.textContent = rule.bindingMode === 'rpg' ? 'RPG 自定义' : '酒馆自定义';
      label.append(checkbox, text, source);
      host.appendChild(label);
    }
  }
  const unavailableBound = boundRules.filter(rule => rule.boundCustomId && !seen.has(rule.boundCustomId));
  const embedded = boundRules.filter(rule => !rule.boundCustomId);
  if (unavailableBound.length || embedded.length) {
    const wrap = document.createElement('div');
    wrap.className = 'pg-regex-bound';
    for (const rule of unavailableBound) {
      const label = document.createElement('label');
      label.className = 'pg-regex-binding';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      checkbox.addEventListener('change', () => togglePGRegexBinding(rule.boundCustomId, false, rule.boundCustomMode || mode));
      const text = document.createElement('span');
      text.textContent = `已绑定：${rule.name}`;
      const source = document.createElement('small');
      source.textContent = '来源未找到，可解除';
      label.append(checkbox, text, source);
      wrap.appendChild(label);
    }
    for (const rule of embedded) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = `已携带：${rule.name}`;
      wrap.appendChild(tag);
    }
    host.appendChild(wrap);
  }
}

function togglePGRegexBinding(id, enabled, bindingMode) {
  if (!pgEditingPreset) return;
  const current = normalizeOutputRegexRules(pgEditingPreset.regexes, 'preset');
  const custom = normalizeOutputRegexRules(modeOutputRegexes(bindingMode), 'custom').find(rule => rule.id === id);
  pgEditingPreset.regexes = current.filter(rule => rule.boundCustomId !== id);
  if (enabled && custom) {
    pgEditingPreset.regexes.push(normalizeOutputRegexRule({
      ...custom,
      id: `bound-${bindingMode}-${id}`,
      boundCustomId: id,
      boundCustomMode: bindingMode,
    }, pgEditingPreset.regexes.length, 'preset'));
  }
  renderPGRegexBindings();
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
  capturePGPresetMetadata();
  promptPresets[name] = JSON.parse(JSON.stringify(pgEditingPreset));
  savePresets();
  renderPGRegexBindings();
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
  const visibleOrder = (pgEditingPreset?.promptOrder || []).map((item, index) => ({ item, index }));
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
      <div class="pg-prompt-main"><span class="pg-prompt-name">${esc(p.name)}</span><span class="pg-prompt-meta"><span>${esc(p.role)}</span><span>${p.marker ? '动态槽位' : (p.pinned ? '固定提示词' : (p.position === 'in_chat' ? `历史深度 ${p.depth}` : '相对位置'))}</span></span></div>
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
  const dynamicMarker = p.marker === true;
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
  $('pg-prompt-del').disabled = p.marker || p.pinned;
  $('pg-inchat-fields').classList.toggle('hidden', p.position !== 'in_chat' || p.marker);
  $('pg-prompt-note').textContent = dynamicMarker
    ? '动态槽位由当前角色卡、玩家设定、世界书、记忆或聊天历史填充；可排序和关闭，内容不写入预设。'
    : (p.pinned ? 'SillyTavern 固定提示词：可编辑、排序和关闭，但不可删除。' : '自定义条目可使用常用 SillyTavern 宏。');
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
  pgEditingPreset.prompts.push({ identifier, name: '新提示词', role: 'system', content: '', marker: false, pinned: false, systemPrompt: false, position: 'relative', depth: 4, order: 100 });
  pgEditingPreset.promptOrder.push({ identifier, enabled: true });
  pgEditingPromptId = identifier;
  renderPGPrompts();
  $('pg-prompt-name').focus();
  $('pg-prompt-name').select();
}

function pgPromptDelete() {
  const p = currentPGPrompt();
  if (!p || p.marker || p.pinned) return;
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
    const identifier = String(p.identifier || p.id || `prompt-${i + 1}`);
    const marker = !['main', 'jailbreak', 'enhanceDefinitions', 'nsfw'].includes(identifier)
      && (p.marker === true || PRESET_MARKER_IDS.has(identifier));
    const pinned = p.system_prompt === true || p.systemPrompt === true || p.pinned === true || PRESET_PINNED_IDS.has(identifier);
    return {
      ...p,
      identifier,
      name: String(p.name || p.title || p.identifier || p.id || `提示词 ${i + 1}`),
      role: marker ? 'system' : (['system', 'user', 'assistant'].includes(p.role) ? p.role : (p.role === 'ai' ? 'assistant' : 'system')),
      content: String(p.content || ''),
      marker,
      pinned,
      systemPrompt: pinned,
      position: marker ? 'relative' : (Number(p.injection_position ?? p.position) === 1 || String(p.position || '').toLowerCase() === 'in_chat' ? 'in_chat' : 'relative'),
      depth: Math.max(0, Number(p.injection_depth ?? p.depth ?? 4) || 0),
      order: Number(p.injection_order ?? p.order ?? 100) || 0,
    };
  });
  const promptOrder = rawOrder.map(o => {
    const item = typeof o === 'string' ? { identifier: o } : (o || {});
    return { identifier: String(item.identifier || item.id || ''), enabled: item.enabled !== false };
  }).filter(item => item.identifier);
  const modelParameters = normalizeSTPresetSettings(data);
  const importedMode = ['tavern', 'rpg', 'both'].includes(data.tavern_meta?.mode) ? data.tavern_meta.mode : 'tavern';
  const regexes = normalizeOutputRegexRules(data.extensions?.regex_scripts ?? data.extensions?.regexScripts, 'preset');
  const importedPostHistory = String(data.tavern_meta?.postHistory || '') || String(prompts.find(prompt => prompt.identifier === 'jailbreak')?.content || '');
  const importedReplyOptions = data.tavern_meta?.replyOptions ?? data.replyOptions;
  const promptOrderProfiles = normalizePromptOrderProfiles(rawOrders);
  return {
    preset: { version: PRESET_SCHEMA_VERSION, mode: importedMode, firstMes: String(data.tavern_meta?.firstMes || ''), ...(importedPostHistory ? { postHistory: importedPostHistory } : {}), prompts, promptOrder, promptOrderProfiles, regexes, modelParameters, ...(importedReplyOptions && typeof importedReplyOptions === 'object' ? { replyOptions: cloneValue(importedReplyOptions) } : {}), source: { format: 'sillytavern-chat-completion', profile: profile.character_id ?? profile.characterId ?? profile.id, unusedPrompts: Math.max(0, prompts.length - promptOrder.length) } },
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
  capturePGPresetMetadata();
  const regexes = normalizeOutputRegexRules(pgEditingPreset.regexes, 'preset');
  const prompts = pgEditingPreset.prompts.map(p => ({
    name: p.name, system_prompt: p.systemPrompt === true || p.pinned === true, role: p.role, content: p.content,
    identifier: p.identifier, marker: p.marker || undefined,
    injection_position: p.position === 'in_chat' ? 1 : 0,
    injection_depth: p.depth, injection_order: p.order,
  }));
  const preservedProfiles = normalizePromptOrderProfiles(pgEditingPreset.promptOrderProfiles)
    .filter(profile => String(profile.character_id) !== '100001');
  const promptOrderProfiles = [...preservedProfiles, { character_id: 100001, order: pgEditingPreset.promptOrder }];
  const payload = { ...(pgEditingPreset.modelParameters || {}), prompts, prompt_order: promptOrderProfiles, extensions: { regex_scripts: regexes.map(serializeOutputRegexRule) }, tavern_meta: { version: PRESET_SCHEMA_VERSION, mode: pgEditingPreset.mode, firstMes: pgEditingPreset.firstMes, ...(pgEditingPreset.replyOptions ? { replyOptions: cloneValue(pgEditingPreset.replyOptions) } : {}) } };
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
  document.querySelectorAll('#regex-stages input[type="checkbox"]').forEach(input => {
    input.checked = (rule?.stages || ['ai_response']).includes(input.value);
    input.disabled = readOnly;
  });
  $('regex-display-only').checked = rule?.onlyFormatDisplay === true;
  $('regex-prompt-only').checked = rule?.onlyFormatPrompt === true;
  $('regex-substitute').value = rule?.substituteRegex === false ? '0' : String(Number.isFinite(Number(rule?.substituteRegex)) ? Number(rule.substituteRegex) : 1);
  $('regex-min-depth').value = rule?.minDepth ?? '';
  $('regex-max-depth').value = rule?.maxDepth ?? '';
  $('regex-run-on-edit').checked = rule?.runOnEdit === true;
  $('regex-preset-scope').checked = rule ? !!rule.presetScope : true;
  $('regex-enabled').checked = rule ? rule.enabled !== false : true;
  ['regex-name', 'regex-find', 'regex-replace', 'regex-trim', 'regex-display-only', 'regex-prompt-only', 'regex-substitute', 'regex-min-depth', 'regex-max-depth', 'regex-run-on-edit', 'regex-preset-scope', 'regex-enabled']
    .forEach(id => { $(id).disabled = readOnly; });
  $('regex-save').disabled = readOnly;
  $('regex-del').disabled = readOnly || !rule;
  $('regex-copy').classList.toggle('hidden', !readOnly);
  $('regex-note').textContent = readOnly
    ? `这是当前${source === 'world' ? '世界卡' : '预设'}携带的正则，只读；复制后可作为当前模式的自定义正则调整。`
    : `自定义正则只作用于当前${mode === 'rpg' ? 'RPG' : '酒馆'}模式；${rule?.presetScope ? `当前预设「${rule.presetScope === GLOBAL_PRESET_KEY ? '全局默认' : rule.presetScope}」` : '未勾选预设专属时为模式全局'}。执行顺序为角色卡/世界卡 → 预设 → 自定义。`;
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
      const scopeLabel = source === 'custom' ? (rule.presetScope ? ` · ${rule.presetScope === GLOBAL_PRESET_KEY ? '全局默认' : '预设专属'}` : ' · 模式全局') : '';
      item.innerHTML = `<span>${rule.enabled === false ? '🚫 ' : ''}${esc(rule.name)}</span><small>${source === 'preset' ? '预设' : source === 'world' ? '世界卡' : '当前模式'}${scopeLabel}</small>`;
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
  const selectedStages = [...document.querySelectorAll('#regex-stages input[type="checkbox"]:checked')].map(input => input.value);
  const currentPreset = currentRegexPresetScope(mode);
  const minDepth = $('regex-min-depth').value === '' ? null : Number($('regex-min-depth').value);
  const maxDepth = $('regex-max-depth').value === '' ? null : Number($('regex-max-depth').value);
  const candidate = normalizeOutputRegexRule({
    id: regexEditingId || uid(),
    name,
    findRegex,
    replaceString: $('regex-replace').value,
    trimStrings: $('regex-trim').value.split(',').map(value => value.trim()).filter(Boolean),
    stages: selectedStages.length ? selectedStages : ['ai_response'],
    onlyFormatDisplay: $('regex-display-only').checked,
    onlyFormatPrompt: $('regex-prompt-only').checked,
    substituteRegex: Number($('regex-substitute').value) || 0,
    minDepth: Number.isFinite(minDepth) ? Math.max(0, minDepth) : null,
    maxDepth: Number.isFinite(maxDepth) ? Math.max(0, maxDepth) : null,
    runOnEdit: $('regex-run-on-edit').checked,
    presetScope: $('regex-preset-scope').checked ? currentPreset : null,
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
  renderPGRegexBindings();
  renderRegexEditor(candidate, 'custom');
}

function copyPresetRegexToCustom() {
  const rule = selectedOutputRegex();
  if (!rule || !['preset', 'world'].includes(regexEditingSource)) return;
  const copy = normalizeOutputRegexRule({ ...rule, id: uid(), name: `${rule.name}（自定义）`, presetScope: currentRegexPresetScope(mode) }, 0, 'custom');
  modeOutputRegexes().push(copy);
  saveOutputRegexPrefs();
  regexEditingId = copy.id;
  regexEditingSource = 'custom';
  renderRegexList();
  renderPGRegexBindings();
  renderRegexEditor(copy, 'custom');
}

function deleteRegexEditor() {
  if (['preset', 'world'].includes(regexEditingSource) || !regexEditingId) return;
  const rules = modeOutputRegexes();
  const index = rules.findIndex(rule => rule.id === regexEditingId);
  if (index < 0 || !confirm(`删除正则「${rules[index].name || regexEditingId}」？`)) return;
  rules.splice(index, 1);
  saveOutputRegexPrefs();
  renderPGRegexBindings();
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

/* 将角色绑定的独立世界书打包回 V3 character_book，避免导出后只剩绑定 id。 */
function lorebookToCharacterBook(book) {
  if (!book || typeof book !== 'object') return null;
  const entries = [];
  lorebookEntriesForPrompt(book).forEach((entry, index) => {
    const normalized = normalizeCharacterBookEntries({ entries: [entry] })[0] || entry;
    const serialized = serializeSTWorldInfoEntry(normalized, index);
    entries.push({
      keys: serialized.key,
      secondary_keys: serialized.keysecondary,
      comment: serialized.comment,
      content: serialized.content,
      constant: serialized.constant,
      selective: serialized.selective,
      selectiveLogic: serialized.selectiveLogic,
      insertion_order: serialized.order,
      enabled: !serialized.disable,
      position: serialized.position,
      depth: serialized.depth,
      role: serialized.role,
      ...(normalized.useRegex ? { use_regex: true } : {}),
      ...(normalized.caseSensitive !== null ? { case_sensitive: normalized.caseSensitive } : {}),
      ...(normalized.matchWholeWords !== null ? { match_whole_words: normalized.matchWholeWords } : {}),
      extensions: serialized.extensions,
    });
  });
  if (!entries.length) return null;
  const settings = normalizeLorebookSettings(book);
  return {
    name: String(book.name || book.title || '角色卡世界书'),
    entries,
    ...(settings.scanDepth !== null ? { scan_depth: settings.scanDepth } : {}),
    ...(settings.budget !== null ? { token_budget: settings.budget } : {}),
    ...(settings.recursive !== null ? { recursive_scanning: settings.recursive } : {}),
    ...(book.extensions && typeof book.extensions === 'object' ? { extensions: cloneCardJson(book.extensions) } : {}),
  };
}

function boundCharacterBookForExport(char) {
  if (!char || typeof char !== 'object') return null;
  const inline = characterBookForChar(char);
  if (inline) return cloneCardJson(inline);
  const boundId = String(char.loreId || char.characterBookLoreId || '').trim();
  return boundId && lorebooks?.[boundId] ? lorebookToCharacterBook(lorebooks[boundId]) : null;
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
  const positions = {
    before: [],
    after: [],
    exampleTop: [],
    exampleBottom: [],
    anTop: [],
    anBottom: [],
    atDepth: [],
  };
  const entries = [];
  for (const e of allHits) {
    const content = String(e.content || '').trim();
    if (!content) continue;
    const position = normalizeWorldInfoPosition(e.wiPosition ?? e.position);
    if (position === WORLD_INFO_POSITION.outlet) {
      const name = String(e.outletName || '').trim();
      if (!name) continue;
      if (settings.budget > 0 && !e.ignoreBudget && used + content.length > settings.budget) continue;
      if (name) (outlets[name] || (outlets[name] = [])).push(content);
      used += content.length;
      continue;
    }
    if (settings.budget > 0 && !e.ignoreBudget && used + content.length > settings.budget) continue;
    used += content.length;
    entries.push(content);
    if (position === WORLD_INFO_POSITION.before) positions.before.push(content);
    else if (position === WORLD_INFO_POSITION.after) positions.after.push(content);
    else if (position === WORLD_INFO_POSITION.exampleTop) positions.exampleTop.push(content);
    else if (position === WORLD_INFO_POSITION.exampleBottom) positions.exampleBottom.push(content);
    else if (position === WORLD_INFO_POSITION.anTop) positions.anTop.push(content);
    else if (position === WORLD_INFO_POSITION.anBottom) positions.anBottom.push(content);
    else if (position === WORLD_INFO_POSITION.atDepth) positions.atDepth.push({
      content,
      role: worldInfoRoleValue(e.role) === WORLD_INFO_ROLE.user ? 'user'
        : (worldInfoRoleValue(e.role) === WORLD_INFO_ROLE.assistant ? 'assistant' : 'system'),
      depth: Math.max(0, Number(e.depth ?? 4) || 0),
      order: Number(e.order ?? 100) || 0,
    });
  }
  return withOutlets ? {
    entries,
    positions,
    outlets: Object.fromEntries(Object.entries(outlets).map(([name, values]) => [name, values.join('\n\n')])),
  } : entries;
}

/* ─────────── 提示词构建管线（SillyTavern prompts + prompt_order） ─────────── */
function applySTFormatTemplate(template, marker, content) {
  const value = String(content || '').trim();
  if (!value) return '';
  const format = template === undefined || template === null ? marker : String(template);
  if (!format) return value;
  return format.split(marker).join(value).trim();
}

function buildCharacterPromptParts(char, presetSettings = {}) {
  if (!char) return { description: '', personality: '', scenario: '', rawDescription: '', rawPersonality: '', rawScenario: '' };
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
  const rawDescription = lines.join('\n');
  const rawPersonality = String(char.personality != null ? char.personality : (char.description == null ? char.persona : '') || '').trim();
  const rawScenario = String(char.scenario || '').trim();
  return {
    description: rawDescription,
    personality: applySTFormatTemplate(presetSettings.personality_format, '{{personality}}', rawPersonality),
    scenario: applySTFormatTemplate(presetSettings.scenario_format, '{{scenario}}', rawScenario),
    rawDescription,
    rawPersonality,
    rawScenario,
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
  const parts = [];
  if (mems.length) parts.push('【记忆】\n' + mems.map(m => '- ' + m.content.trim()).join('\n'));
  const rolling = buildTavernAutoMemoryPromptPart();
  if (rolling) parts.push(rolling);
  return parts.join('\n\n');
}

function formatWorldInfoPrompt(entries, presetSettings = {}) {
  const content = (Array.isArray(entries) ? entries : []).filter(Boolean).join('\n\n');
  return applySTFormatTemplate(presetSettings.wi_format, '{0}', content);
}

function parseDialogueExampleBlock(block, userName, charName) {
  const userLabels = new Set(['{{user}}', 'user', '玩家', String(userName || '').trim().toLowerCase()].filter(Boolean));
  const charLabels = new Set(['{{char}}', 'assistant', 'ai', '角色', String(charName || '').trim().toLowerCase()].filter(Boolean));
  const messages = [];
  let role = 'system';
  let lines = [];
  const flush = () => {
    const content = lines.join('\n').trim();
    if (content) messages.push({ role, content });
    lines = [];
  };
  for (const line of String(block || '').split(/\r?\n/)) {
    const match = line.match(/^\s*([^:：\n]{1,80})\s*[:：]\s*(.*)$/);
    const label = String(match?.[1] || '').trim().toLowerCase();
    const nextRole = userLabels.has(label) ? 'user' : (charLabels.has(label) ? 'assistant' : '');
    if (!nextRole) {
      lines.push(line);
      continue;
    }
    flush();
    role = nextRole;
    lines.push(match[2] || '');
  }
  flush();
  return messages;
}

function buildDialogueExampleMessages(rawExamples, beforeEntries = [], afterEntries = [], presetSettings = {}, macroContext = {}) {
  const blocks = [
    ...(Array.isArray(beforeEntries) ? beforeEntries : []),
    ...String(rawExamples || '').split(/\s*<START>\s*/i),
    ...(Array.isArray(afterEntries) ? afterEntries : []),
  ].map(value => String(value || '').trim()).filter(Boolean);
  const separator = String(presetSettings.new_example_chat_prompt || '').trim();
  const messages = [];
  for (const block of blocks) {
    if (separator) messages.push({ role: 'system', content: separator, _example: true });
    messages.push(...parseDialogueExampleBlock(block, macroContext.user, macroContext.char)
      .map(message => ({ ...message, _example: true })));
  }
  return messages;
}

function resolveCharacterPromptOverride(value, original) {
  const override = String(value || '').trim();
  const fallback = String(original || '').trim();
  if (!override) return fallback;
  return /\{\{original\}\}/i.test(override)
    ? override.replace(/\{\{original\}\}/gi, fallback)
    : override;
}

function tavernReplyOptionsConfig(preset = null) {
  const base = defaults?.tavern?.replyOptions && typeof defaults.tavern.replyOptions === 'object'
    ? defaults.tavern.replyOptions : null;
  const override = preset?.replyOptions && typeof preset.replyOptions === 'object'
    ? preset.replyOptions : null;
  if (!base && !override) {
    // 兼容旧版 server.js 返回的 seed：仍可从内置 RP 预设恢复协议。
    const instruction = mode === 'tavern' ? builtInTavernReplyOptionsInstruction() : '';
    return instruction ? { enabled: true, min: 4, max: 4, count: 4, instruction, noOptions: '（等待 AI 生成可选行动…）' } : null;
  }
  const merged = { ...(base || {}), ...(override || {}) };
  // 自定义提示词留空表示继承全局默认；不能让“已开启”悄悄退化成没有协议提示。
  if (!String(merged.instruction || '').trim()) {
    merged.instruction = String(base?.instruction || builtInTavernReplyOptionsInstruction() || '').trim();
  }
  return merged;
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
  const customized = formatTavernReplyOptionsInstruction(instruction, rules);
  // 自定义内容可以只描述选项风格；机器可解析的标签契约仍由 JSON 默认模板兜底。
  const fallbackInstruction = String(defaults?.tavern?.replyOptions?.instruction || builtInTavernReplyOptionsInstruction() || '').trim();
  const fallback = formatTavernReplyOptionsInstruction(fallbackInstruction, rules);
  if (customized === fallback) return customized;
  return fallback && hasTavernReplyOptionsProtocol(fallback)
    ? [customized, fallback].filter(Boolean).join('\n\n')
    : customized;
}

function buildTavernReplyOptionsAssistantMessage(preset = null) {
  if (mode !== 'tavern') return '';
  const rules = tavernReplyOptionRules(preset);
  if (!rules.enabled) return '';
  const config = tavernReplyOptionsConfig(preset);
  const template = String(config?.assistantMessage || defaults?.tavern?.replyOptions?.assistantMessage || '').trim();
  return formatTavernReplyOptionsInstruction(template, rules);
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
    '当前不可用 Runtime 动作': 114,
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
    Array.isArray(world.rules.checks) && world.rules.checks.length ? `可用判定：${world.rules.checks.map(check => {
      if (typeof check === 'string') return check;
      const modifier = check.modifier && typeof check.modifier === 'object' && !Array.isArray(check.modifier)
        ? `；修正来源=${JSON.stringify(check.modifier)}（只在 dice.roll.modifier 传入，禁止写进 expr）`
        : (check.modifier !== undefined ? ` + ${check.modifier}` : '');
      return `${check.id}${check.label ? `（${check.label}）` : ''}${check.roll ? ` ${check.roll}` : ''}${modifier}${check.target !== undefined ? ` vs ${check.target}` : ''}`;
    }).join('；')}` : '',
  ].filter(Boolean).join('\n') : '';
  return `【世界事实分层】
稳定设定来源：WorldCard ${staticScope}。世界简介、登记地点、NPC 公共资料和规则属于稳定设定；不要因为某个存档的变化而改写它们。
${setting ? `世界观设定（只读）：\n${setting}\n` : ''}${rules ? `作者规则（只读；硬规则优先，软规则用于叙事取舍）：\n${rules}\n` : ''}
当前事实来源：WorldSave ${saveScope}。当前地点=${currentLocation}；当前时间=${currentTime}；玩家状态、NPC 位置/关系/认知和长期记忆只属于这个存档。
状态处理：同一实体或地点同时出现静态资料与存档状态时，静态资料解释默认设定，存档状态解释当前局面；两者都要保留，不能把一次存档变化宣称为世界卡永久改写，也不能用旧静态默认值覆盖已提交状态。`;
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
      const checkText = check
        ? ` [基础骰式=${check.roll || '未声明'}${check.modifier && typeof check.modifier === 'object' ? `；modifierRule=${JSON.stringify(check.modifier)}` : check.modifier !== undefined ? `；固定修正=${check.modifier}` : ''}；目标=${check.target}${check.damage ? `；伤害基础骰式=${check.damage.roll}` : ''}]`
        : '';
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
  const agentContext = buildRpgAgentContext(agentProfile);
  const enabledAgentTools = Object.entries(agentProfile.tools)
    .filter(([, config]) => config.enabled !== false)
    .map(([name, config]) => `${name}（${config.execution || 'server'}）`);
  pushSection('agent.profile', `【Agent Runtime】protocol=${agentProfile.protocol} v${agentProfile.version}；mode=${agentProfile.mode}；maxSteps=${agentProfile.maxSteps}；可用工具=${enabledAgentTools.length ? enabledAgentTools.join('、') : '无'}。工具只能通过当前存档的服务端校验产生结果，不能跨 saveId、改写 runtime schema 或直接写入未声明字段。世界卡定义的变量、集合和动作属于本局状态的一部分，必须使用声明式 runtime 更新。`);
  if (agentContext) pushSection('agent.context', `【Agent 请求上下文】以下是本次请求唯一的作用域快照；缺失字段不得由模型猜测，稳定事实与本局状态必须按标注来源区分：\n${JSON.stringify(agentContext)}`);
  if (rs) {
    if (worldModeActive()) pushSection('turn.commit-contract', `【结构化回合提交】当前 saveId=${currentWorldSave.id}，revision=${currentWorldSave.revision}。回复末尾的 <tavern_state_update> 必须原样使用 protocol=tavern.rpg.turn、version=1、baseRevision=${currentWorldSave.revision}；只允许玩家状态、地点/时间、必要判定和 options，服务端会以此 revision 做原子提交。`);
    const stateText = worldModeActive()
      ? `HP ${rs.hp}/${rs.maxHp}，MP ${rs.mp}/${rs.maxMp}，当前位置：${rs.location}`
      : `等级 ${rs.level}（经验 ${rs.exp}/${rs.expNext}），HP ${rs.hp}/${rs.maxHp}，MP ${rs.mp}/${rs.maxMp}，金币 ${rs.gold}，当前位置：${rs.location}`;
    pushSection('save.rpg-state', '【RPG 状态】' + stateText
      + (rs.buffs?.length ? `，状态效果：${rs.buffs.join('、')}` : ''));
    if (!worldModeActive()) pushSection('save.inventory', '【背包】' + (rs.inventory.length ? rs.inventory.map(i => `${i.name}×${i.count}${i.desc ? `（${i.desc}）` : ''}`).join('、') : '（空）'));
    if (!worldModeActive()) {
      pushSection('save.quests', '【任务】' + (rs.quests.length ? rs.quests.map(x => `${x.title}${x.status === 'done' ? '（已完成）' : ''}`).join('、') : '（无）'));
      pushSection('save.goals', '【目标】' + (rs.goals?.length ? rs.goals.map(x => `${x.title}${x.status && x.status !== 'active' ? `（${x.status}）` : ''}`).join('、') : '（无）'));
      pushSection('save.leads', '【线索】' + (rs.leads?.length ? rs.leads.map(x => `${x.title}${x.status && x.status !== 'active' ? `（${x.status}）` : ''}`).join('、') : '（无）'));
      const deadlineObjectives = [...(rs.goals || []), ...(rs.leads || [])];
      const deadlineText = deadlineObjectives.filter(item => item?.deadline && item.status === 'active' && Number.isFinite(item.deadline.value) && item.deadline.unit).map(item => `${item.title || item.id} 截止 ${item.deadline.value} ${item.deadline.unit}`).join('；');
      if (deadlineText) pushSection('save.deadlines', '【目标 / 线索时限】' + deadlineText);
    }
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
      const intent = worldTurnPendingActive() ? currentWorldSave?.agentRuntime?.pending?.actionIntent || worldTurnPending?.actionIntent : null;
      if (intent?.actionId) {
        const intentAction = (Array.isArray(world.runtime?.actions) ? world.runtime.actions : []).find(action => action?.id === intent.actionId);
        const intentAvailability = intentAction && !rpgRuntimeActionAvailabilityUsesInput(intentAction)
          ? rpgRuntimeActionAvailabilityError(intentAction, currentWorldSave?.state?.runtime || {}) : '';
        pushSection('turn.action-intent', `【玩家明确动作意图】本回合 actionId=${intent.actionId}${intentAction ? `（${intentAction.label || intentAction.id}）` : '（未声明，不能执行）'}。actionId 是玩家通过卡内按钮或自由输入精确匹配明确提交的动作，不得只当作叙事描述：动作已声明且可用时必须调用一次 runtime.action.execute；需要判定时先完成该 actionId 的 rules.check → dice.roll，只有达到目标才执行。绝不把该动作的效果手写成 item.delta、runtime.collection.patch 或其他等价 updates；卡内动作的状态效果只能由声明的 runtime.action.execute 结算。${intentAvailability ? `当前不可用：${intentAvailability}。不要调用、不要手写等价 updates，只在正文说明资源或条件不足。` : '若工具返回 accepted=candidate，最终提交必须保留该动作候选。'}`);
      }
      pushSection('turn.side-effects', '【副作用边界】Markdown 叙事、NPC 台词、行动选项和普通文本中的骰子表达式都只是文本，不会自动执行骰子或改写状态；只有协议中通过服务端校验的结构化更新才可产生状态变化。');
      pushSection('turn.tool-candidates', agentProfile.mode === 'native'
        ? '【Agent 步骤协议】每一步只做一件事：需要信息/判定时调用工具并等待真实结果；已有结果时继续叙事。只有同时存在风险、不确定性与后果才判定，顺序固定为 context.retrieve → rules.check → dice.roll → 状态候选。dice.roll 只写基础 1dN，修正必须原样引用已声明的属性/技能/runtime 数值，禁止猜值。最终一步不得再调用工具：输出 Markdown 正文与唯一状态标签，正文不要列行动选项。'
        : '【Agent 兼容步骤协议】中间步骤可在唯一 <tavern_state_update> 的 toolCalls 中请求工具，然后等待真实结果；最终步骤必须删除 toolCalls，只输出 Markdown 正文与唯一状态标签。只有同时存在风险、不确定性与后果才按 context.retrieve → rules.check → dice.roll → 状态候选执行；dice.roll 只写基础 1dN，修正引用已声明数值。正文不要重复行动选项。');
      const npcPrompt = buildWorldNpcPromptPart();
      if (npcPrompt) pushSection('world.npcs', npcPrompt);
      const failurePrompt = buildWorldFailurePromptPart();
      if (failurePrompt) pushSection('rules.failure', failurePrompt);
      const endingPrompt = buildWorldEndingPromptPart();
      if (endingPrompt) pushSection('rules.ending', endingPrompt);
      const reopenPrompt = buildWorldReopenPromptPart();
      if (reopenPrompt) pushSection('world.reopen', reopenPrompt);
      const runtime = world.runtime && typeof world.runtime === 'object' ? world.runtime : null;
      if (runtime) {
        const runtimeState = currentWorldSave.state?.runtime || {};
        const unavailableActions = (Array.isArray(runtime.actions) ? runtime.actions : [])
          .filter(action => !rpgRuntimeActionAvailabilityUsesInput(action))
          .map(action => ({ action, error: rpgRuntimeActionAvailabilityError(action, runtimeState) }))
          .filter(item => item.error)
          // ponytail: prompt only lists 8 unavailable actions; the Agent guard checks every action at execution time.
          .slice(0, 8);
        if (unavailableActions.length) pushSection('world.runtime-unavailable-actions', `【当前不可用 Runtime 动作】${unavailableActions.map(({ action, error }) => `${action.label || action.id}（${action.id}）：${error}`).join('；')}。这些动作已耗尽或条件不足，不能调用 runtime.action.execute，也不得写入 updates；应据此继续叙事或选择其他可用行动。`);
        const runtimeProjection = JSON.stringify({
          schema: runtime,
          state: runtimeState,
        });
        const runtimeLimit = Math.min(12000, Math.max(4000, Math.floor(worldContextBudget() / 2)));
        pushSection('world.runtime-contract', `【世界卡 Runtime 契约】只可使用以下已声明的变量、集合和动作；不得修改 schema 或凭空创建字段。Agent 调用 state.patch 工具时，updates 不得包含 runtime.action.execute；执行声明式动作只能调用同名工具，并使用当前 runtime.actions 已声明的 actionId。玩家行动没有对应 action 时，应使用当前协议已声明的其他 Typed Patch（如 runtime.variable.* 或 runtime.collection.*），不能编造 actionId。状态变化放入唯一标签的 updates，动作有 check 时须先完成同 actionId 判定。\n${runtimeProjection.slice(0, runtimeLimit)}`);
      } else {
        pushSection('world.runtime-contract', '【世界卡 Runtime 契约】当前世界卡未声明自定义 runtime；不要猜测或提交 runtime 更新。');
      }
    }
  }
  if (worldModeActive()) {
    const budgeted = budgetWorldPromptParts(sections);
    sections.length = 0;
    sections.push(...budgeted);
  }
  if (defaults?.rpg?.diceInstruction) pushSection('turn.dice-contract', defaults.rpg.diceInstruction, 'preset');
  const stateInstruction = worldModeActive()
    ? `⚠️ RPG 最终输出：Markdown 正文 + 末尾唯一 <tavern_state_update>JSON</tavern_state_update>。最终 JSON 仅含 protocol、version、baseRevision、updates、options、eventMemory；protocol="tavern.rpg.turn"，version=1，baseRevision 等于当前 revision。updates 只改已声明字段；options 仅在 JSON 中提供，不得写进正文。中间工具步骤可临时包含 toolCalls，收到工具结果后的最终输出必须删除 toolCalls。${RPG_RUNTIME_UPDATE_FORMAT_HINT}`
    : ((defaults?.rpg?.stateInstruction) || '每次回复末尾输出唯一的 <tavern_state_update> JSON 状态更新块。');
  pushSection('output.protocol', stateInstruction, 'preset');
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
  const roleOrder = { user: 0, assistant: 1, system: 2 };
  const result = [];
  for (let i = 0; i <= history.length; i++) {
    const group = grouped.get(i) || [];
    group.sort((a, b) => a.order - b.order || (roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3));
    result.push(...group.map(({ role, content }) => ({ role, content })));
    if (i < history.length) result.push(history[i]);
  }
  return result;
}

function tavernPromptHistoryMessages(session = curSession()) {
  if (!session || !Array.isArray(session.messages)) return [];
  if (tavernAutoMemoryConfig().enabled) return tavernTurnHistory(session);
  return session.messages
    .filter(message => message && (message.role === 'user' || message.role === 'assistant'))
    .map(message => ({
      role: message.role,
      content: message.content || '',
      ...(message.meta ? { meta: true } : {}),
    }));
}

function splitLatestPlayerTurn(messages) {
  const source = (Array.isArray(messages) ? messages : [])
    .filter(message => message && (message.role === 'user' || message.role === 'assistant'))
    .map(message => ({ role: message.role, content: String(message.content || ''), ...(message.meta ? { meta: true } : {}) }));
  let lastAssistantIndex = -1;
  for (let i = source.length - 1; i >= 0; i--) {
    if (source[i].role === 'assistant') { lastAssistantIndex = i; break; }
  }
  const relativeStart = source.slice(lastAssistantIndex + 1).findIndex(message => message.role === 'user' && !message.meta && message.content.trim());
  if (relativeStart < 0) return { history: source, current: [] };
  const currentStart = lastAssistantIndex + 1 + relativeStart;
  const pending = source.slice(currentStart);
  const playerInputs = pending.filter(message => message.role === 'user' && !message.meta && message.content.trim()).map(message => message.content.trim());
  const extraRecords = pending.filter(message => message.role === 'user' && message.meta && message.content.trim()).map(message => message.content.trim());
  let content = playerInputs.join('\n\n');
  if (extraRecords.length) content += `${content ? '\n\n' : ''}【本轮附加记录】\n${extraRecords.join('\n')}`;
  return {
    history: source.slice(0, currentStart),
    current: content ? [{ role: 'user', content }] : [],
  };
}

function buildPromptBlocks() {
  const char = currentChar();
  const promptChar = worldModeActive() ? null : char;
  const { preset: rawPreset } = resolvePromptPreset();
  const preset = normalizePromptPreset('', rawPreset);
  const presetSettings = preset.modelParameters && typeof preset.modelParameters === 'object' ? preset.modelParameters : {};
  const wiResult = buildWorldInfo({ withOutlets: true });
  // 提示词正则只作用于本次请求副本；世界书/历史原文与会话存档保持不变。
  const wi = wiResult.entries.map(entry => applyRegexStage(entry, 'world_info', { includePromptOnly: false }));
  const formatWorldInfoEntries = entries => (Array.isArray(entries) ? entries : [])
    .map(entry => applyRegexStage(entry, 'world_info', { includePromptOnly: false }));
  const wiPositions = wiResult.positions || { before: wi, after: [], exampleTop: [], exampleBottom: [], anTop: [], anBottom: [], atDepth: [] };
  const charParts = worldModeActive()
    ? { description: '', personality: '', scenario: '', rawDescription: '', rawPersonality: '', rawScenario: '' }
    : buildCharacterPromptParts(promptChar, presetSettings);
  const userPart = worldModeActive() ? '' : buildUserPromptPart();
  const rpgSections = buildRpgPromptSections();
  const macroMessages = (worldModeActive() ? worldTimelineMessages() : curMessages())
    // 骰点等 meta 是本轮附加记录，不应覆盖 {{lastMessage}} 或增加 {{messageCount}}。
    .filter(message => message && !message.meta && (message.role === 'user' || message.role === 'assistant'));
  const lastMacroMessage = macroMessages.at(-1)?.content || '';
  const lastMacroUserMessage = [...macroMessages].reverse().find(message => message.role === 'user' && !message.meta)?.content || '';
  const lastMacroCharMessage = [...macroMessages].reverse().find(message => message.role === 'assistant')?.content || '';
  const runtime = {
    worldInfoBefore: formatWorldInfoPrompt(formatWorldInfoEntries(wiPositions.before), presetSettings),
    worldInfoAfter: formatWorldInfoPrompt(formatWorldInfoEntries(wiPositions.after), presetSettings),
    personaDescription: userPart,
    charDescription: charParts.description,
    charPersonality: charParts.personality,
    scenario: charParts.scenario,
    tavernMemory: buildMemoryPromptPart(),
    tavernRpg: rpgSections.map(section => section.text).join('\n\n'),
    tavernRpgSections: rpgSections,
    outlets: wiResult.outlets,
  };
  const macroContext = {
    user: currentUserPreset()?.name || '玩家',
    char: worldModeActive() ? (currentWorldCard()?.title || '世界') : (promptChar?.name || '角色'),
    persona: currentUserPreset()?.persona || '',
    description: charParts.rawDescription,
    personality: charParts.rawPersonality,
    scenario: charParts.rawScenario,
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
  const relativeBefore = [];
  const relativeAfter = [];
  const injections = [];
  const postParts = [];
  let includeHistory = false;
  let reachedHistory = false;

  for (const item of preset.promptOrder) {
    if (item.enabled === false) continue;
    const prompt = promptMap.get(item.identifier);
    if (!prompt) continue;
    if (prompt.identifier === 'chatHistory') {
      includeHistory = true;
      reachedHistory = true;
      const newChatPrompt = expandPresetMacros(presetSettings.new_chat_prompt || '', macroContext, variables);
      if (newChatPrompt) {
        systemParts.push(newChatPrompt);
        relativeBefore.push({ role: 'system', content: newChatPrompt });
      }
      continue;
    }
    if (prompt.identifier === 'dialogueExamples' && prompt.marker) {
      const exampleMessages = buildDialogueExampleMessages(
        promptChar?.mesExample || promptChar?.mes_example || '',
        formatWorldInfoEntries(wiPositions.exampleTop),
        formatWorldInfoEntries(wiPositions.exampleBottom),
        presetSettings,
        macroContext,
      );
      for (const message of exampleMessages) {
        const content = expandPresetMacros(message.content, macroContext, variables);
        if (!content) continue;
        if (message.role === 'system') systemParts.push(content);
        else (reachedHistory ? afterHistory : beforeHistory).push({ role: message.role, content });
        (reachedHistory ? relativeAfter : relativeBefore).push({ role: message.role, content, _example: true });
      }
      continue;
    }
    let content = prompt.marker ? runtime[prompt.identifier] ?? prompt.content : prompt.content;
    if (prompt.identifier === 'main') {
      const base = prompt.content || (mode === 'rpg' ? RPG_TASK_FALLBACK : '');
      content = mode === 'tavern' ? resolveCharacterPromptOverride(promptChar?.systemPrompt, base) : base;
    }
    if (prompt.identifier === 'jailbreak') {
      content = mode === 'tavern'
        ? resolveCharacterPromptOverride(promptChar?.postHistory, prompt.content)
        : prompt.content;
    }
    content = expandPresetMacros(content, macroContext, variables);
    if (!content) continue;
    if (prompt.position === 'in_chat' && !prompt.marker) {
      injections.push({ role: prompt.role, content, depth: prompt.depth, order: prompt.order });
      if (prompt.role === 'system') systemParts.push(content);
    } else if (prompt.role === 'system' || prompt.marker) {
      systemParts.push(content);
      (reachedHistory ? relativeAfter : relativeBefore).push({ role: 'system', content });
    } else {
      (reachedHistory ? afterHistory : beforeHistory).push({ role: prompt.role, content });
      (reachedHistory ? relativeAfter : relativeBefore).push({ role: prompt.role, content });
    }
  }

  for (const entry of Array.isArray(wiPositions.atDepth) ? wiPositions.atDepth : []) {
    const content = expandPresetMacros(applyRegexStage(entry.content, 'world_info', { includePromptOnly: false }), macroContext, variables);
    if (!content) continue;
    injections.push({ role: entry.role, content, depth: entry.depth, order: entry.order });
    if (entry.role === 'system') systemParts.push(content);
  }

  const recentContext = worldModeActive() ? buildWorldRecentContext() : null;
  const historySource = recentContext ? recentContext.messages : tavernPromptHistoryMessages();
  const splitTurn = splitLatestPlayerTurn(historySource);
  let previousHistory = splitTurn.history;
  const currentTurn = splitTurn.current;
  if (!recentContext) {
    // 先过滤对话消息、再限制历史，并为本轮输入保留一个固定槽位；meta 骰点不再挤掉玩家输入。
    const historyLimit = Math.max(1, Math.floor(Number(settings.history) || 20));
    const previousLimit = Math.max(0, historyLimit - currentTurn.length);
    previousHistory = previousLimit ? previousHistory.slice(-previousLimit) : [];
  }
  // “聊天历史”只控制已完成的旧上下文；本轮玩家输入是当前请求参数，始终保留。
  const exampleHistory = [];
  if (mode === 'rpg' && defaults?.rpg?.exampleTurn) {
    const ex = defaults.rpg.exampleTurn;
    if (ex.user && ex.assistant) exampleHistory.push({ role: 'user', content: ex.user }, { role: 'assistant', content: ex.assistant });
  }
  let history = [...exampleHistory, ...(includeHistory ? previousHistory : [])];
  history = mergeHistoryInjections(history, injections);
  const orderedChat = mergeHistoryInjections([...exampleHistory, ...(includeHistory ? previousHistory : []), ...currentTurn], injections);
  const optionPrompt = buildTavernReplyOptionsPrompt(preset);
  if (optionPrompt) postParts.push(expandPresetMacros(optionPrompt, macroContext, variables));
  // 兼容调试投影仍把本轮玩家输入保留为最后一条 user；真实请求使用下方 orderedPromptMessages。
  const promptHistory = [...beforeHistory, ...history, ...afterHistory, ...currentTurn].map((message, index, list) => ({
    role: message.role,
    content: applyRegexStage(message.content, 'prompt_history', { depth: Math.max(0, list.length - index - 1) }),
  }));
  const orderedPromptMessages = [...relativeBefore, ...orderedChat, ...relativeAfter].map((message, index, list) => ({
    role: message.role,
    content: applyRegexStage(message.content, message.role === 'system' ? 'system_prompt' : 'prompt_history', { depth: Math.max(0, list.length - index - 1) }),
    ...(message._example ? { _example: true } : {}),
  }));
  return {
    system: applyRegexStage(systemParts.join('\n\n'), 'system_prompt'),
    wi,
    history: promptHistory,
    promptMessages: orderedPromptMessages,
    post: applyRegexStage(postParts.filter(Boolean).join('\n\n'), 'system_prompt'),
    assistantPrefill: expandPresetMacros(presetSettings.assistant_prefill || '', macroContext, variables),
    recentContext,
    rpgSections,
  };
}
