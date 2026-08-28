/* ─────────── 世界库 / 世界存档（W2：RPG 主链由当前 WorldSave 持有） ─────────── */
function worldCardById(id) { return worldCards.find(w => w.id === id) || null; }
function worldCardKey(id, version) { return `${id}@${version}`; }
/*
 * RPG 世界卡的运行契约保持小而稳定：角色、地点/时间、叙事、选项与必要判定。
 * 旧卡仍可从服务端读取完整字段，但新回合不会把已废弃的系统暴露给 UI/提示词。
 */
function compactRpgWorldCard(world) {
  if (!world || typeof world !== 'object' || Array.isArray(world)) return world;
  const cached = compactRpgWorldCard.cache.get(world);
  if (cached) return cached;
  const card = cloneValue(world);
  for (const key of ['events', 'factions', 'conflicts', 'map', 'mapGeneration', 'itemIds', 'questTemplateIds', 'factionIds']) delete card[key];
  if (card.playerCreation && typeof card.playerCreation === 'object') {
    for (const key of ['economy', 'growth', 'initialInventory']) delete card.playerCreation[key];
  }
  if (card.start && typeof card.start === 'object' && card.start.initialState && typeof card.start.initialState === 'object') {
    for (const key of ['inventory', 'equipment', 'currencies', 'quests', 'goals', 'leads', 'activeHooks', 'conflicts', 'growthCandidates', 'growthApplications', 'experiences', 'map']) {
      delete card.start.initialState[key];
    }
    if (card.start.initialState.player && typeof card.start.initialState.player === 'object') delete card.start.initialState.player.initialInventory;
    if (card.start.initialState.stats && typeof card.start.initialState.stats === 'object') delete card.start.initialState.stats.gold;
  }
  compactRpgWorldCard.cache.set(world, card);
  return card;
}
compactRpgWorldCard.cache = new WeakMap();
function currentWorldCard() {
  const version = currentWorldSave && currentWorldSave.worldVersion;
  const summary = worldCardById(currentWorldId);
  const targetVersion = version === undefined || version === null ? summary?.version : version;
  return compactRpgWorldCard(worldCardVersions.get(worldCardKey(currentWorldId, targetVersion)) || summary);
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
function syncConversationResetButton() {
  const button = $('btn-clear-chat');
  if (!button) return;
  const reset = worldModeActive();
  button.textContent = reset ? '重置对话' : '清空对话';
  button.title = reset ? '重置当前 RPG 存档到开局状态（含 MVU/runtime）' : '清空当前对话';
}
function activeConversationKey() {
  const scope = activeConversationScope();
  return scope ? `${worldModeActive() ? 'world' : 'session'}:${scope.id}` : '';
}
function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}
function createRpgAgentSession(payload, targetScope) {
  const profile = payload?.agentProfile || {};
  const session = {
    id: uid(),
    commandId: worldTurnPendingActive() ? worldTurnPending.commandId : null,
    worldId: worldModeActive() ? currentWorldId : null,
    saveId: worldModeActive() ? currentWorldSaveId : null,
    baseRevision: worldModeActive() ? currentWorldSave?.revision ?? null : null,
    mode: profile.mode || 'direct',
    maxSteps: Math.max(1, Math.min(8, Number(profile.maxSteps) || 1)),
    status: 'running',
    phase: 'observe',
    step: 0,
    messages: Array.isArray(payload?.body?.messages) ? payload.body.messages.map(cloneValue) : [],
    events: [],
    accepted: [],
    toolTrace: [],
    cot: '',
    previewNarrative: '',
    checkpoints: [],
    targetKey: activeConversationKey(),
  };
  rpgAgentRequestSessions.set(payload, session);
  appendRpgAgentEvent(session, 'turn.start', {
    mode: session.mode,
    messageCount: session.messages.length,
    stream: payload?.body?.stream === true,
  });
  syncRpgAgentDebug(session, targetScope, 'Agent 回合开始');
  return session;
}
function appendRpgAgentEvent(session, type, data = {}) {
  if (!session) return;
  const event = {
    id: uid(),
    ts: Date.now(),
    type: String(type || 'event'),
    step: Number.isInteger(session.step) ? session.step : 0,
    ...data,
  };
  session.events.push(event);
  if (session.events.length > 96) session.events.splice(0, session.events.length - 96);
}
function syncRpgAgentDebug(session, targetScope, status = null) {
  if (!session || !targetScope) return;
  setDebugTrace(targetScope, {
    agentSessionId: session.id,
    agentEvents: cloneValue(session.events),
    ...(status ? { status } : {}),
  });
}
function rpgAgentNarrative(text) {
  if (!text) return '';
  try {
    const parsed = parseRpgOutput(String(text));
    return stripRpgNarrativeOptions(parsed.narrative || '').trim();
  } catch {
    return String(text).trim();
  }
}
// ponytail: merge repeated model prefixes instead of replaying the whole prior paragraph on every tool step.
function mergeRpgAgentNarrative(previous, next) {
  const before = String(previous || '').trim();
  const after = String(next || '').trim();
  if (!before) return after;
  if (!after || before === after || before.includes(after)) return before;
  if (after.startsWith(before)) return after;
  if (before.endsWith(after)) return before;
  const limit = Math.min(before.length, after.length);
  for (let size = limit; size > 0; size--) {
    if (before.slice(-size) === after.slice(0, size)) return before + after.slice(size);
  }
  return `${before}\n\n${after}`;
}
function appendRpgAgentPreview(session, reply) {
  const next = rpgAgentNarrative(reply);
  if (!session || !next) return session?.previewNarrative || '';
  session.previewNarrative = mergeRpgAgentNarrative(session.previewNarrative, next);
  return session.previewNarrative;
}
function publishRpgAgentStep(session, response, targetScope, status = 'Agent 步骤完成') {
  appendRpgAgentPreview(session, response?.content || '');
  appendRpgAgentEvent(session, 'assistant.message', {
    contentChars: String(response?.content || '').length,
    calls: (response?.calls || []).map(call => call.name),
  });
  if (session.previewNarrative && session.targetKey === activeConversationKey()) {
    setResponsePreview(session.previewNarrative, null, session.targetKey, session.checkpoints);
  }
  setDebugTrace(targetScope, {
    status,
    output: response?.cot ? `${response.content || ''}\n\n[reasoning_content]\n${response.cot}` : String(response?.content || ''),
    rawOutput: String(response?.content || ''),
    outputTag: extractDebugOutputTag(response?.content || ''),
    reasoning: String(response?.cot || ''),
    agentToolTrace: cloneValue(session.toolTrace),
    agentEvents: cloneValue(session.events),
  });
}
function combineRpgAgentReply(session, reply) {
  const current = String(reply || '').trim();
  const previous = String(session?.previewNarrative || '').trim();
  if (!previous || !current) return current || previous;
  const currentNarrative = rpgAgentNarrative(current);
  if (currentNarrative.includes(previous) || previous.includes(currentNarrative)) return current;
  return `${previous}\n\n${current}`;
}
function pendingWorldTurnMessages(pending) {
  const messages = Array.isArray(pending?.messages) ? pending.messages : [];
  return cloneValue(pending?.assistantMessage ? [...messages, pending.assistantMessage] : messages);
}
function buildRpgTurnIntent(raw, { kind = 'text', source = 'input', optionId = null, actionId = null, input = null, dice = null } = {}) {
  const intent = {
    version: 1,
    kind: ['text', 'option', 'action'].includes(kind) ? kind : 'text',
    source: ['input', 'option', 'world-card', 'devtools', 'system'].includes(source) ? source : 'input',
    raw: String(raw || '').trim(),
  };
  if (optionId) intent.optionId = String(optionId).slice(0, 160);
  if (actionId) intent.actionId = String(actionId).slice(0, 160);
  if (input && typeof input === 'object' && !Array.isArray(input)) intent.input = cloneValue(input);
  if (Array.isArray(dice) && dice.length) intent.dice = dice;
  return intent;
}
function normalizeRuntimeActionIntentText(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}
function matchExactWorldRuntimeAction(raw, actions = currentWorldCard()?.runtime?.actions) {
  const text = normalizeRuntimeActionIntentText(raw);
  if (!text || !Array.isArray(actions)) return null;
  const matches = actions.filter(action => {
    if (!action || (Array.isArray(action.inputs) && action.inputs.length)) return false;
    return [action.label, action.id].some(value => normalizeRuntimeActionIntentText(value) === text);
  });
  return matches.length === 1 ? matches[0] : null;
}
function isExplicitWorldRuntimeActionIntent(intent) {
  return !!(intent?.actionId && intent.kind === 'action' && ['world-card', 'input'].includes(intent.source));
}
function hydrateWorldSave(data) {
  if (!data || typeof data !== 'object') return data;
  if (!data.state || typeof data.state !== 'object') data.state = {};
  if (!data.setup || typeof data.setup !== 'object') data.setup = { status: 'active', plan: null, candidate: null };
  if (!['planning', 'active'].includes(data.setup.status)) data.setup.status = 'active';
  if (!data.setup.game || typeof data.setup.game !== 'object') data.setup.game = {};
  if (data.setup.plan === undefined) data.setup.plan = null;
  if (data.setup.candidate === undefined) data.setup.candidate = null;
  if (data.setup.draft === undefined) data.setup.draft = null;
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
function isLegacyWorldDiceMessage(message) {
  return message?.meta === true
    && message?.role === 'user'
    && /^🎲\s*(?:工具掷骰\s*)?\d*d\d+/i.test(String(message.content || '').trim());
}
function worldTimelineMessages() {
  if (!worldModeActive()) return [];
  const result = [];
  if (currentWorldSave.setup?.status !== 'planning' && currentWorldSave.opening) result.push({ role: 'assistant', content: currentWorldSave.opening, ts: currentWorldSave.createdAt || Date.now(), _opening: true });
  for (const turn of currentWorldSave.turns || []) {
    if (!turn || typeof turn !== 'object' || !turn.role || isLegacyWorldDiceMessage(turn)) continue;
    result.push(turn);
  }
  if (worldTurnPending && worldTurnPending.saveId === currentWorldSaveId) {
    result.push(...worldTurnPending.messages.filter(message => !isLegacyWorldDiceMessage(message)));
    if (worldTurnPending.assistantMessage) result.push(worldTurnPending.assistantMessage);
  }
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
  const recent = (candidates.length ? candidates : timeline).slice(-worldShortTermWindowSize());
  const charBudget = Math.min(12000, Math.max(4000, Math.floor(worldContextBudget() / 2)));
  const selected = [];
  let used = 0;
  for (let index = recent.length - 1; index >= 0; index--) {
    const message = recent[index];
    const content = String(message.content || '');
    const remaining = charBudget - used;
    if (remaining <= 0) break;
    const limit = Math.min(4000, remaining);
    const marker = '…（较早内容已由记忆/事件账本承接）\n';
    const clipped = content.length <= limit
      ? content
      : limit <= marker.length ? marker.slice(0, limit) : marker + content.slice(-(limit - marker.length));
    selected.unshift({ ...message, content: clipped });
    used += clipped.length;
  }
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
  pending.assistantMessage = null;
  pending.agentSession = null;
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
  pending.protocolRepairDraft = null;
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
  clearResponsePreview();
  worldTurnPending = null;
  worldTurnError = null;
  worldTurnEpoch++;
  resetWorldTurnPending(pending);
  renderMessages();
}
function shouldAutoRetryWorldTurn(message) {
  const text = String(message?.message || message || '');
  return /RPG 输出协议|RPG 回合需要|agentToolTrace|agentCalls|Agent 工具|模型未返回内容|options 需要|输出协议|超时|Failed to fetch|NetworkError|HTTP (?:408|425|429|5\d\d)/i.test(text);
}
function scheduleWorldTurnAutoRetry(message) {
  const pending = worldTurnPending;
  const attempts = Number(pending?.autoRetryCount) || 0;
  if (!pending || attempts >= WORLD_TURN_AUTO_RETRY_MAX || !shouldAutoRetryWorldTurn(message)) return false;
  pending.autoRetryCount = attempts + 1;
  const commandId = pending.commandId;
  if (worldTurnError) {
    worldTurnError.autoRetry = true;
    worldTurnError.message = `${worldTurnError.message}；正在自动重试（${pending.autoRetryCount}/${WORLD_TURN_AUTO_RETRY_MAX}）`;
  }
  let waits = 0;
  const run = () => {
    if (!worldTurnPendingActive() || worldTurnPending.commandId !== commandId || !worldTurnErrorActive()) return;
    if ((sending || worldTurnPreparing) && waits++ < 40) {
      setTimeout(run, 50);
      return;
    }
    void retryWorldTurn();
  };
  setTimeout(run, 0);
  return true;
}
function failWorldTurnPending(message) {
  if (!worldTurnPendingActive()) return false;
  if (!worldTurnPending.agentExecution && !worldTurnPending.assistantMessage && !worldTurnPending.protocolRepairDraft) resetWorldTurnPending(worldTurnPending);
  worldTurnError = {
    saveId: worldTurnPending.saveId,
    commandId: worldTurnPending.commandId,
    message: String(message || '本回合未提交'),
  };
  scheduleWorldTurnAutoRetry(message);
  worldTurnEpoch++;
  renderMessages();
  return true;
}
async function retryWorldTurn() {
  if (!worldTurnPendingActive() || !worldTurnErrorActive() || sending || worldTurnPreparing) return;
  worldTurnError = null;
  const retryCommit = !!worldTurnPending.assistantMessage;
  const retryAgentNarration = !!worldTurnPending.agentExecution;
  const retryProtocol = !!worldTurnPending.protocolRepairDraft;
  if (!retryCommit && !retryAgentNarration && !retryProtocol) resetWorldTurnPending(worldTurnPending);
  worldTurnEpoch++;
  renderMessages();
  if (retryCommit || retryAgentNarration) {
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
        turns: pendingWorldTurnMessages(pending),
        options: pending.options || [],
      }, 'Agent 执行阶段失败');
      pending.agentExecution = data.execution || data.agentRuntime?.pending || null;
      pending.agentPhase = pending.agentExecution?.phase || 'narrate';
      pending.agentPhaseHistory = Array.isArray(pending.agentExecution?.phaseHistory)
        ? cloneValue(pending.agentExecution.phaseHistory) : [];
      pending.agentOrchestration = pending.agentExecution?.orchestration
        ? cloneValue(pending.agentExecution.orchestration) : null;
      attachWorldStateFeedback(pending, data.execution?.state || data.agentRuntime?.pending?.state || data.state);
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
      turns: pendingWorldTurnMessages(pending),
      options: pending.options,
    }, 'Agent 叙事阶段失败');
  } else {
    attachWorldStateFeedback(pending, pending.state);
    data = await request(endpoint, {
      commandId: pending.commandId,
      expectedRevision: pending.expectedRevision,
      turns: pendingWorldTurnMessages(pending),
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
  showWorldStateFeedback({ ...(currentWorldSave || {}), state: pending.beforeState || currentWorldSave?.state }, data);
  currentWorldSave = data;
  currentWorldSaveId = data.id;
  postWorldExtensionEvent('turn.commit', { commandId: pending.commandId, revision: data.revision });
  clearResponsePreview();
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
  worldWorkspaceActive = true;
  syncModeNavigation('chat');
  closeWorldLibrary();
  if (!worldSavePlanning() && worldCardUsesImmersive()) enterWorldImmersiveMode({ fullscreen: false });
  else exitWorldImmersiveMode();
  renderSessions();
  renderMessages();
  const conversationKey = activeConversationKey();
  window.requestAnimationFrame?.(() => scrollChatToLatest($('chat'), conversationKey));
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

/* 表单优先的 runtime 编辑器：只生成已有受限 DSL，不新增第二份状态模型。 */
const WORLD_DRAFT_DURABLE_ITEMS_ID = 'durable-items';
const WORLD_DRAFT_RUNTIME_FORM_TYPES = new Set(['number', 'string', 'boolean']);
const WORLD_DRAFT_RUNTIME_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const WORLD_DRAFT_AUTO_PANEL_LIMIT = 24;

function worldDraftRuntimeValue() {
  const value = worldDraft?.world?.runtime;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}
function worldDraftRuntimeText(value = worldDraftRuntimeValue()) {
  return value ? JSON.stringify(value, null, 2) : '';
}
function worldDraftRuntimeBase() {
  const value = worldDraftRuntimeValue();
  const next = value ? cloneValue(value) : { version: 1, variables: [], collections: [], actions: [] };
  next.version = Number.isInteger(next.version) ? next.version : 1;
  next.variables = Array.isArray(next.variables) ? next.variables : [];
  next.collections = Array.isArray(next.collections) ? next.collections : [];
  next.actions = Array.isArray(next.actions) ? next.actions : [];
  return next;
}
function worldDraftRuntimeRawMatchesForm() {
  const raw = $('world-draft-runtime');
  return !raw || raw.value.trim() === worldDraftRuntimeText();
}
function requireWorldDraftRuntimeRawSync() {
  if (worldDraftRuntimeRawMatchesForm()) return true;
  setWorldDraftStatus('高级 JSON 有未载入修改，请先点击“从 JSON 载入表单”。', 'error');
  $('world-draft-runtime')?.focus();
  return false;
}
function runtimeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function worldDraftRuntimeGeneratedItemAction(action, itemId) {
  const effects = Array.isArray(action?.effects) ? action.effects : [];
  const effect = effects[0];
  const cost = Math.abs(runtimeNumber(effect?.delta?.durability, 0));
  const availability = Array.isArray(action?.availability) ? action.availability : [];
  return action?.id === `use-${itemId}` && action?.category === '物品'
    && action.inputs === undefined && action.check === undefined
    && effects.length === 1 && effect?.type === 'collection.patch'
    && effect.collectionId === WORLD_DRAFT_DURABLE_ITEMS_ID && effect.entryId === itemId
    && cost > 0 && effect?.delta?.durability === -cost && effect?.delta?.uses === 1
    && Object.keys(effect.delta || {}).every(key => ['durability', 'uses'].includes(key))
    && availability.length === 1 && availability[0]?.type === 'collection.number'
    && availability[0]?.collectionId === WORLD_DRAFT_DURABLE_ITEMS_ID
    && availability[0]?.entryId === itemId && availability[0]?.field === 'durability'
    && availability[0]?.operator === '>=' && availability[0]?.value === cost;
}
function worldDraftRuntimeItemCollection(runtime) {
  const collection = (Array.isArray(runtime?.collections) ? runtime.collections : []).find(item => item?.id === WORLD_DRAFT_DURABLE_ITEMS_ID);
  const properties = collection?.entrySchema?.properties;
  const expected = ['id', 'label', 'durability', 'maxDurability', 'uses'];
  if (!collection || !properties || typeof properties !== 'object'
    || collection?.entrySchema?.additionalProperties !== false
    || Object.keys(properties).length !== expected.length
    || expected.some(key => !properties[key])
    || !Array.isArray(collection.entrySchema.required)
    || collection.entrySchema.required.length !== expected.length
    || expected.some(key => !collection.entrySchema.required.includes(key))
    || properties.id?.type !== 'string' || properties.label?.type !== 'string'
    || properties.durability?.type !== 'number' || properties.durability?.min !== 0 || properties.durability?.max !== 1000000
    || properties.maxDurability?.type !== 'number' || properties.maxDurability?.min !== 0 || properties.maxDurability?.max !== 1000000
    || properties.uses?.type !== 'number' || properties.uses?.min !== 0 || properties.uses?.max !== 1000000000) return null;
  const items = Array.isArray(collection.initial) ? collection.initial : [];
  const actions = Array.isArray(runtime?.actions) ? runtime.actions : [];
  // An empty or partially authored collection may be intentional advanced JSON.
  // Only take ownership of the exact complete template produced by this form.
  if (!items.length || items.some(item => {
    const itemId = typeof item?.id === 'string' ? item.id : '';
    const action = actions.find(candidate => candidate?.id === `use-${itemId}`);
    return !itemId || !worldDraftRuntimeGeneratedItemAction(action, itemId);
  })) return null;
  return collection;
}
function worldDraftRuntimeItemAction(runtime, itemId) {
  return (Array.isArray(runtime?.actions) ? runtime.actions : []).find(action => {
    return worldDraftRuntimeGeneratedItemAction(action, itemId);
  }) || null;
}
function worldDraftRuntimeItemActionCost(action) {
  const effect = Array.isArray(action?.effects) ? action.effects.find(item => item?.type === 'collection.patch') : null;
  const cost = Math.abs(runtimeNumber(effect?.delta?.durability, 1));
  return cost > 0 ? cost : 1;
}
function worldDraftRuntimeVariableIsReferenced(runtime, variableId) {
  return (Array.isArray(runtime?.actions) ? runtime.actions : []).some(action => [
    ...(Array.isArray(action?.availability) ? action.availability : []),
    ...(Array.isArray(action?.effects) ? action.effects : []),
  ].some(item => item?.variableId === variableId));
}
function worldDraftRuntimeVariableTemplate(variable, index) {
  const type = WORLD_DRAFT_RUNTIME_FORM_TYPES.has(variable?.type) ? variable.type : 'number';
  const initial = variable?.initial;
  const min = variable?.min;
  const max = variable?.max;
  return `<article class="world-draft-entry world-draft-runtime-entry" data-world-runtime-variable data-world-runtime-source-id="${esc(variable?.sourceId || variable?.id || '')}" data-world-runtime-scope="${esc(variable?.scope || 'save')}">
    <div class="world-draft-entry-head"><strong>变量 ${index + 1}</strong><button class="ghost-btn small danger" type="button" data-world-runtime-remove="variable">删除</button></div>
    <div class="world-draft-entry-grid">
      <label class="field"><span>ID</span><input data-runtime-variable-id value="${esc(variable?.id || '')}" maxlength="64" spellcheck="false" required /></label>
      <label class="field"><span>名称</span><input data-runtime-variable-label value="${esc(variable?.label || '')}" maxlength="120" required /></label>
      <label class="field"><span>类型</span><select data-runtime-variable-type><option value="number"${type === 'number' ? ' selected' : ''}>数值</option><option value="string"${type === 'string' ? ' selected' : ''}>文本</option><option value="boolean"${type === 'boolean' ? ' selected' : ''}>开关</option></select></label>
      <label class="check world-draft-runtime-visible"><input data-runtime-variable-visible type="checkbox"${variable?.visible === false ? '' : ' checked'} /> 在状态面板中可见</label>
    </div>
    <div class="world-draft-entry-grid">
      <label class="field" data-runtime-variable-number${type === 'number' ? '' : ' hidden'}><span>初始值</span><input data-runtime-variable-number-initial type="number" step="any" value="${esc(runtimeNumber(initial, 0))}" /></label>
      <label class="field" data-runtime-variable-number${type === 'number' ? '' : ' hidden'}><span>最小值</span><input data-runtime-variable-min type="number" step="any" value="${min === undefined ? '' : esc(min)}" placeholder="不限制" /></label>
      <label class="field" data-runtime-variable-number${type === 'number' ? '' : ' hidden'}><span>最大值</span><input data-runtime-variable-max type="number" step="any" value="${max === undefined ? '' : esc(max)}" placeholder="不限制" /></label>
      <label class="field" data-runtime-variable-string${type === 'string' ? '' : ' hidden'}><span>初始文本</span><input data-runtime-variable-string-initial value="${esc(initial ?? '')}" maxlength="4000" /></label>
      <label class="check world-draft-runtime-boolean" data-runtime-variable-boolean${type === 'boolean' ? '' : ' hidden'}><input data-runtime-variable-boolean-initial type="checkbox"${initial ? ' checked' : ''} /> 初始为开启</label>
    </div>
  </article>`;
}
function worldDraftRuntimeItemTemplate(item, index) {
  return `<article class="world-draft-entry world-draft-runtime-entry" data-world-runtime-item data-world-runtime-source-id="${esc(item?.sourceId || item?.id || '')}">
    <div class="world-draft-entry-head"><strong>物品 ${index + 1}</strong><button class="ghost-btn small danger" type="button" data-world-runtime-remove="item">删除</button></div>
    <div class="world-draft-entry-grid">
      <label class="field"><span>ID</span><input data-runtime-item-id value="${esc(item?.id || '')}" maxlength="60" spellcheck="false" required /></label>
      <label class="field"><span>名称</span><input data-runtime-item-label value="${esc(item?.label || '')}" maxlength="120" required /></label>
      <label class="field"><span>当前耐久</span><input data-runtime-item-durability type="number" min="0" step="1" value="${esc(runtimeNumber(item?.durability, 1))}" required /></label>
      <label class="field"><span>最大耐久</span><input data-runtime-item-max-durability type="number" min="0" step="1" value="${esc(runtimeNumber(item?.maxDurability, item?.durability ?? 1))}" required /></label>
    </div>
    <div class="world-draft-entry-grid">
      <label class="field"><span>每次使用消耗</span><input data-runtime-item-cost type="number" min="1" step="1" value="${esc(runtimeNumber(item?.cost, 1))}" required /></label>
      <label class="field"><span>已使用次数</span><input data-runtime-item-uses type="number" min="0" step="1" value="${esc(runtimeNumber(item?.uses, 0))}" required /></label>
      <label class="field"><span>使用动作名称</span><input data-runtime-item-use-label value="${esc(item?.useLabel || `使用${item?.label || ''}`)}" maxlength="120" required /></label>
    </div>
    <label class="field"><span>使用说明</span><input data-runtime-item-use-description value="${esc(item?.useDescription || `使用${item?.label || ''}，消耗 ${runtimeNumber(item?.cost, 1)} 点耐久。`)}" maxlength="2000" /></label>
  </article>`;
}
function worldDraftRuntimeActionTemplate(action, index, variables) {
  const effect = Array.isArray(action?.effects) ? action.effects.find(item => item?.type === 'variable.delta') : null;
  const variableId = effect?.variableId || variables[0]?.id || '';
  const options = variables.map(variable => `<option value="${esc(variable.id)}"${variable.id === variableId ? ' selected' : ''}>${esc(variable.label || variable.id)} (${esc(variable.id)})</option>`).join('');
  return `<article class="world-draft-entry world-draft-runtime-entry" data-world-runtime-action data-world-runtime-source-id="${esc(action?.sourceId || action?.id || '')}">
    <div class="world-draft-entry-head"><strong>动作 ${index + 1}</strong><button class="ghost-btn small danger" type="button" data-world-runtime-remove="action">删除</button></div>
    <div class="world-draft-entry-grid">
      <label class="field"><span>ID</span><input data-runtime-action-id value="${esc(action?.id || '')}" maxlength="64" spellcheck="false" required /></label>
      <label class="field"><span>名称</span><input data-runtime-action-label value="${esc(action?.label || '')}" maxlength="120" required /></label>
      <label class="field"><span>目标变量</span><select data-runtime-action-variable${options ? '' : ' disabled'}>${options || '<option value="">先添加数值变量</option>'}</select></label>
      <label class="field"><span>数值变化</span><input data-runtime-action-delta type="number" step="any" value="${esc(runtimeNumber(effect?.delta, 1))}" required /></label>
    </div>
    <label class="field"><span>说明</span><input data-runtime-action-description value="${esc(action?.description || '')}" maxlength="2000" placeholder="例如：完成任务后提高声望…" /></label>
  </article>`;
}
function worldDraftRuntimeFormAction(action) {
  const effects = Array.isArray(action?.effects) ? action.effects : [];
  return effects.length === 1 && effects[0]?.type === 'variable.delta'
    && action?.inputs === undefined && action?.availability === undefined && action?.check === undefined
    && (action?.category === undefined || action.category === '状态');
}
function worldDraftRuntimeAutoActionTemplate(item) {
  return `<article class="world-draft-runtime-auto-action"><strong>${esc(item.useLabel)}</strong><span>使用 ${esc(item.label)}：耐久 −${item.cost}，次数 +1；耐久不足时自动禁用。</span></article>`;
}
function updateWorldDraftRuntimeVariableFields(row) {
  const type = row?.querySelector('[data-runtime-variable-type]')?.value || 'number';
  row?.querySelectorAll('[data-runtime-variable-number]').forEach(field => field.toggleAttribute('hidden', type !== 'number'));
  row?.querySelector('[data-runtime-variable-string]')?.toggleAttribute('hidden', type !== 'string');
  row?.querySelector('[data-runtime-variable-boolean]')?.toggleAttribute('hidden', type !== 'boolean');
}
function worldDraftRuntimeNumericVariablesFromForm() {
  return [...document.querySelectorAll('#world-draft-runtime-variables [data-world-runtime-variable]')].map(row => ({
    id: row.querySelector('[data-runtime-variable-id]')?.value.trim() || '',
    label: row.querySelector('[data-runtime-variable-label]')?.value.trim() || '',
    type: row.querySelector('[data-runtime-variable-type]')?.value || '',
  })).filter(variable => variable.id && variable.type === 'number');
}
function refreshWorldDraftRuntimeActionVariables(previousId = '', nextId = '') {
  const variables = worldDraftRuntimeNumericVariablesFromForm();
  document.querySelectorAll('#world-draft-runtime-actions [data-runtime-action-variable]').forEach(select => {
    const selectedId = select.value === previousId ? nextId : select.value;
    select.replaceChildren();
    if (!variables.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '先添加数值变量';
      select.appendChild(option);
      select.disabled = true;
      return;
    }
    variables.forEach(variable => {
      const option = document.createElement('option');
      option.value = variable.id;
      option.textContent = `${variable.label || variable.id} (${variable.id})`;
      select.appendChild(option);
    });
    select.disabled = false;
    select.value = variables.some(variable => variable.id === selectedId) ? selectedId : variables[0].id;
  });
}
function renderWorldDraftRuntimeForm() {
  const runtime = worldDraftRuntimeValue() || {};
  const variables = (Array.isArray(runtime.variables) ? runtime.variables : []).filter(variable => WORLD_DRAFT_RUNTIME_FORM_TYPES.has(variable?.type));
  const unsupportedVariables = (Array.isArray(runtime.variables) ? runtime.variables : []).length - variables.length;
  const variableHost = $('world-draft-runtime-variables');
  if (variableHost) variableHost.innerHTML = variables.length
    ? variables.map((variable, index) => worldDraftRuntimeVariableTemplate(variable, index)).join('')
    : '<p class="world-draft-runtime-empty">还没有变量。添加后可在本局的所有动作中使用。</p>';

  const itemCollection = worldDraftRuntimeItemCollection(runtime);
  const items = (Array.isArray(itemCollection?.initial) ? itemCollection.initial : []).map(item => {
    const action = worldDraftRuntimeItemAction(runtime, item.id);
    const cost = worldDraftRuntimeItemActionCost(action);
    return { ...item, sourceId: item.id, cost, useLabel: action?.label || `使用${item.label || item.id}`, useDescription: action?.description || `使用${item.label || item.id}，消耗 ${cost} 点耐久。` };
  });
  const itemHost = $('world-draft-runtime-items');
  if (itemHost) {
    itemHost.dataset.runtimeCollectionId = itemCollection?.id || WORLD_DRAFT_DURABLE_ITEMS_ID;
    itemHost.dataset.runtimeScope = itemCollection?.scope || 'save';
    itemHost.dataset.runtimeLabel = itemCollection?.label || '耐久物品';
    itemHost.dataset.runtimeManaged = itemCollection ? 'true' : 'false';
    itemHost.innerHTML = items.length
      ? items.map((item, index) => worldDraftRuntimeItemTemplate(item, index)).join('')
      : '<p class="world-draft-runtime-empty">还没有物品。添加后可为它创建使用动作。</p>';
  }

  const autoActionIds = new Set(items.map(item => `use-${item.id}`));
  const actions = (Array.isArray(runtime.actions) ? runtime.actions : []).filter(action => {
    return !autoActionIds.has(action?.id) && worldDraftRuntimeFormAction(action);
  });
  const actionHost = $('world-draft-runtime-actions');
  if (actionHost) {
    const numericVariables = variables.filter(variable => variable.type === 'number');
    const auto = items.map(worldDraftRuntimeAutoActionTemplate).join('');
    const editable = actions.map((action, index) => worldDraftRuntimeActionTemplate(action, index, numericVariables)).join('');
    actionHost.innerHTML = auto || editable
      ? `${auto}${editable}${unsupportedVariables ? `<p class="hint">另有 ${unsupportedVariables} 个复杂变量保留在高级 JSON 中。</p>` : ''}`
      : '<p class="world-draft-runtime-empty">还没有动作。可从物品的“使用”动作开始。</p>';
  }
}
function worldDraftRuntimeFormError(message, focus) {
  setWorldDraftStatus(message, 'error');
  focus?.focus();
  return { ok: false, error: message, focus };
}
function worldDraftRuntimeSafeId(value) {
  return WORLD_DRAFT_RUNTIME_ID_RE.test(String(value || '').trim());
}
function collectWorldDraftRuntimeForm() {
  const runtime = worldDraftRuntimeBase();
  const variableRows = [...document.querySelectorAll('#world-draft-runtime-variables [data-world-runtime-variable]')];
  const variables = [];
  const variableSourceIds = new Set();
  for (const row of variableRows) {
    const idInput = row.querySelector('[data-runtime-variable-id]');
    const id = idInput?.value.trim() || '';
    const label = row.querySelector('[data-runtime-variable-label]')?.value.trim() || '';
    const type = row.querySelector('[data-runtime-variable-type]')?.value || '';
    if (!worldDraftRuntimeSafeId(id)) return worldDraftRuntimeFormError('变量 ID 只能包含字母、数字、连字符或下划线，且必须以字母或数字开头。', idInput);
    if (!label) return worldDraftRuntimeFormError('变量名称不能为空。', row.querySelector('[data-runtime-variable-label]'));
    if (!WORLD_DRAFT_RUNTIME_FORM_TYPES.has(type)) return worldDraftRuntimeFormError('变量类型无效。', row.querySelector('[data-runtime-variable-type]'));
    const sourceId = row.dataset.worldRuntimeSourceId || '';
    if (sourceId) variableSourceIds.add(sourceId);
    const variable = { id, label, scope: row.dataset.worldRuntimeScope || 'save', type, visible: !!row.querySelector('[data-runtime-variable-visible]')?.checked };
    if (type === 'number') {
      const initial = Number(row.querySelector('[data-runtime-variable-number-initial]')?.value);
      const minText = row.querySelector('[data-runtime-variable-min]')?.value.trim() || '';
      const maxText = row.querySelector('[data-runtime-variable-max]')?.value.trim() || '';
      const min = minText === '' ? undefined : Number(minText);
      const max = maxText === '' ? undefined : Number(maxText);
      if (![initial, min, max].filter(value => value !== undefined).every(Number.isFinite)) return worldDraftRuntimeFormError('变量的初始值、最小值和最大值必须是有效数字。', row.querySelector('[data-runtime-variable-number-initial]'));
      if (min !== undefined && max !== undefined && min > max) return worldDraftRuntimeFormError('变量最小值不能大于最大值。', row.querySelector('[data-runtime-variable-min]'));
      if (min !== undefined && initial < min || max !== undefined && initial > max) return worldDraftRuntimeFormError('变量初始值必须落在最小值和最大值之间。', row.querySelector('[data-runtime-variable-number-initial]'));
      Object.assign(variable, { initial, ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) });
    } else if (type === 'string') {
      variable.initial = row.querySelector('[data-runtime-variable-string-initial]')?.value || '';
    } else {
      variable.initial = !!row.querySelector('[data-runtime-variable-boolean-initial]')?.checked;
    }
    variables.push(variable);
  }
  const ids = new Set();
  for (const variable of [...runtime.variables.filter(variable => !variableSourceIds.has(variable?.id)), ...variables]) {
    if (ids.has(variable.id)) return worldDraftRuntimeFormError(`变量 ID「${variable.id}」重复。`);
    ids.add(variable.id);
  }

  const itemHost = $('world-draft-runtime-items');
  const collectionId = itemHost?.dataset.runtimeCollectionId || WORLD_DRAFT_DURABLE_ITEMS_ID;
  const managesItems = itemHost?.dataset.runtimeManaged === 'true';
  const itemRows = [...document.querySelectorAll('#world-draft-runtime-items [data-world-runtime-item]')];
  const items = [];
  const itemSourceIds = new Set();
  for (const row of itemRows) {
    const idInput = row.querySelector('[data-runtime-item-id]');
    const id = idInput?.value.trim() || '';
    const label = row.querySelector('[data-runtime-item-label]')?.value.trim() || '';
    const durability = Number(row.querySelector('[data-runtime-item-durability]')?.value);
    const maxDurability = Number(row.querySelector('[data-runtime-item-max-durability]')?.value);
    const cost = Number(row.querySelector('[data-runtime-item-cost]')?.value);
    const uses = Number(row.querySelector('[data-runtime-item-uses]')?.value);
    const useLabel = row.querySelector('[data-runtime-item-use-label]')?.value.trim() || '';
    const useDescription = row.querySelector('[data-runtime-item-use-description]')?.value.trim() || '';
    if (!worldDraftRuntimeSafeId(id) || id.length > 60) return worldDraftRuntimeFormError('物品 ID 无效；为生成使用动作，最多 60 个字符。', idInput);
    if (!label || !useLabel) return worldDraftRuntimeFormError('物品名称和使用动作名称不能为空。', row.querySelector('[data-runtime-item-label]'));
    if (![durability, maxDurability, cost, uses].every(Number.isFinite) || ![durability, maxDurability, cost, uses].every(Number.isInteger) || durability < 0 || maxDurability < 0 || cost < 1 || uses < 0) return worldDraftRuntimeFormError('耐久、最大耐久、消耗和使用次数必须是合法整数。', row.querySelector('[data-runtime-item-durability]'));
    if (durability > maxDurability) return worldDraftRuntimeFormError('当前耐久不能大于最大耐久。', row.querySelector('[data-runtime-item-durability]'));
    const sourceId = row.dataset.worldRuntimeSourceId || '';
    if (sourceId) itemSourceIds.add(sourceId);
    items.push({ id, label, durability, maxDurability, uses, cost, useLabel, useDescription });
  }
  const itemIds = new Set();
  for (const item of items) {
    if (itemIds.has(item.id)) return worldDraftRuntimeFormError(`物品 ID「${item.id}」重复。`);
    itemIds.add(item.id);
  }

  const actionRows = [...document.querySelectorAll('#world-draft-runtime-actions [data-world-runtime-action]')];
  const customActions = [];
  const actionSourceIds = new Set();
  const numericIds = new Set([...runtime.variables.filter(variable => !variableSourceIds.has(variable?.id)), ...variables].filter(variable => variable.type === 'number').map(variable => variable.id));
  for (const row of actionRows) {
    const idInput = row.querySelector('[data-runtime-action-id]');
    const id = idInput?.value.trim() || '';
    const label = row.querySelector('[data-runtime-action-label]')?.value.trim() || '';
    const variableId = row.querySelector('[data-runtime-action-variable]')?.value || '';
    const delta = Number(row.querySelector('[data-runtime-action-delta]')?.value);
    const description = row.querySelector('[data-runtime-action-description]')?.value || '';
    if (!worldDraftRuntimeSafeId(id)) return worldDraftRuntimeFormError('动作 ID 无效。', idInput);
    if (!label) return worldDraftRuntimeFormError('动作名称不能为空。', row.querySelector('[data-runtime-action-label]'));
    if (!numericIds.has(variableId)) return worldDraftRuntimeFormError('动作必须选择一个数值变量。', row.querySelector('[data-runtime-action-variable]'));
    if (!Number.isFinite(delta)) return worldDraftRuntimeFormError('动作的数值变化必须是有效数字。', row.querySelector('[data-runtime-action-delta]'));
    const sourceId = row.dataset.worldRuntimeSourceId || '';
    if (sourceId) actionSourceIds.add(sourceId);
    customActions.push({ id, label, ...(description.trim() ? { description: description.trim() } : {}), category: '状态', effects: [{ type: 'variable.delta', variableId, delta }] });
  }

  const durableActionSourceIds = new Set([...itemSourceIds].map(id => `use-${id}`));
  const durableActions = items.map(item => ({
    id: `use-${item.id}`,
    label: item.useLabel,
    description: item.useDescription || `使用${item.label}，消耗 ${item.cost} 点耐久。`,
    category: '物品',
    availability: [{ type: 'collection.number', collectionId, entryId: item.id, field: 'durability', operator: '>=', value: item.cost }],
    effects: [{ type: 'collection.patch', collectionId, entryId: item.id, delta: { durability: -item.cost, uses: 1 } }],
  }));
  const nextVariables = [...runtime.variables.filter(variable => !variableSourceIds.has(variable?.id)), ...variables];
  const nextCollections = (managesItems || items.length) ? runtime.collections.filter(collection => collection?.id !== collectionId) : runtime.collections;
  if (items.length) nextCollections.push({
    id: collectionId,
    label: itemHost?.dataset.runtimeLabel || '耐久物品',
    scope: itemHost?.dataset.runtimeScope || 'save',
    entrySchema: {
      type: 'object',
      properties: {
        id: { type: 'string' }, label: { type: 'string' },
        durability: { type: 'number', min: 0, max: 1000000 },
        maxDurability: { type: 'number', min: 0, max: 1000000 },
        uses: { type: 'number', min: 0, max: 1000000000 },
      },
      required: ['id', 'label', 'durability', 'maxDurability', 'uses'],
      additionalProperties: false,
    },
    initial: items.map(({ cost, useLabel, useDescription, ...item }) => item),
  });
  const nextActions = [...runtime.actions.filter(action => !actionSourceIds.has(action?.id) && !durableActionSourceIds.has(action?.id) && !itemSourceIds.has(String(action?.id || '').replace(/^use-/, ''))), ...customActions, ...durableActions];
  const actionIds = new Set();
  for (const action of nextActions) {
    if (actionIds.has(action.id)) return worldDraftRuntimeFormError(`动作 ID「${action.id}」重复。`);
    actionIds.add(action.id);
  }
  if (!nextVariables.length && !nextCollections.length && !nextActions.length) return { ok: true, value: null };
  return { ok: true, value: { ...runtime, version: runtime.version || 1, variables: nextVariables, collections: nextCollections, actions: nextActions } };
}
function syncWorldDraftRuntimeSourceIds() {
  const rows = [
    ['#world-draft-runtime-variables [data-world-runtime-variable]', '[data-runtime-variable-id]'],
    ['#world-draft-runtime-items [data-world-runtime-item]', '[data-runtime-item-id]'],
    ['#world-draft-runtime-actions [data-world-runtime-action]', '[data-runtime-action-id]'],
  ];
  rows.forEach(([rowSelector, idSelector]) => {
    document.querySelectorAll(rowSelector).forEach(row => {
      const id = row.querySelector(idSelector)?.value.trim();
      if (id) row.dataset.worldRuntimeSourceId = id;
    });
  });
}
function syncWorldDraftRuntimeFromForm({ showError = false } = {}) {
  if (!worldDraft) return { ok: true, value: null };
  if (!requireWorldDraftRuntimeRawSync()) return { ok: false };
  const result = collectWorldDraftRuntimeForm();
  if (!result.ok) return result;
  worldDraft.world.runtime = result.value;
  const raw = $('world-draft-runtime');
  if (raw) {
    raw.value = worldDraftRuntimeText(result.value);
    setWorldDraftJsonRawState(raw);
  }
  syncWorldDraftRuntimeSourceIds();
  if (showError) setWorldDraftStatus('运行态表单已同步。', 'ok');
  return result;
}
function loadWorldDraftRuntimeJson() {
  const raw = $('world-draft-runtime');
  if (!raw || !worldDraft) return;
  try {
    const text = raw.value.trim();
    const value = text ? JSON.parse(text) : null;
    if (value !== null && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error('运行态必须是 JSON 对象');
    worldDraft.world.runtime = value;
    raw.value = worldDraftRuntimeText(value);
    setWorldDraftJsonRawState(raw);
    worldDraftDirty = true;
    renderWorldDraftRuntimeForm();
    setWorldDraftStatus('已从高级 JSON 载入状态与物品表单。', 'ok');
  } catch (error) {
    setWorldDraftStatus(`RPG Runtime Schema 不是有效 JSON：${error.message}`, 'error');
    raw.focus();
  }
}
function mutateWorldDraftRuntime(mutator) {
  if (!worldDraft || !requireWorldDraftRuntimeRawSync()) return false;
  const result = syncWorldDraftRuntimeFromForm();
  if (!result.ok) return false;
  const runtime = worldDraftRuntimeBase();
  mutator(runtime);
  worldDraft.world.runtime = runtime;
  const raw = $('world-draft-runtime');
  if (raw) {
    raw.value = worldDraftRuntimeText(runtime);
    setWorldDraftJsonRawState(raw);
  }
  worldDraftDirty = true;
  renderWorldDraftRuntimeForm();
  return true;
}
function handleWorldDraftRuntimeClick(event) {
  const button = event.target.closest('button');
  if (!button || !worldDraft) return;
  const add = button.dataset.worldRuntimeAdd;
  if (add === 'variable') {
    mutateWorldDraftRuntime(runtime => runtime.variables.push({ id: `variable-${uid()}`, label: '新变量', scope: 'save', type: 'number', initial: 0, visible: true }));
    return;
  }
  if (add === 'item') {
    mutateWorldDraftRuntime(runtime => {
      let collection = worldDraftRuntimeItemCollection(runtime);
      if (!collection) {
        if (runtime.collections.some(item => item?.id === WORLD_DRAFT_DURABLE_ITEMS_ID)) {
          setWorldDraftStatus('现有高级配置已使用 durable-items 集合；请先在高级 JSON 中改名后再添加耐久物品。', 'error');
          return;
        }
        collection = { id: WORLD_DRAFT_DURABLE_ITEMS_ID, label: '耐久物品', scope: 'save', entrySchema: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' }, durability: { type: 'number', min: 0, max: 1000000 }, maxDurability: { type: 'number', min: 0, max: 1000000 }, uses: { type: 'number', min: 0, max: 1000000000 } }, required: ['id', 'label', 'durability', 'maxDurability', 'uses'], additionalProperties: false }, initial: [] };
        runtime.collections.push(collection);
      }
      const id = `item-${uid()}`;
      collection.initial.push({ id, label: '新物品', durability: 1, maxDurability: 1, uses: 0 });
      runtime.actions.push({
        id: `use-${id}`,
        label: '使用新物品',
        description: '使用新物品，消耗 1 点耐久。',
        category: '物品',
        availability: [{ type: 'collection.number', collectionId: WORLD_DRAFT_DURABLE_ITEMS_ID, entryId: id, field: 'durability', operator: '>=', value: 1 }],
        effects: [{ type: 'collection.patch', collectionId: WORLD_DRAFT_DURABLE_ITEMS_ID, entryId: id, delta: { durability: -1, uses: 1 } }],
      });
    });
    return;
  }
  if (add === 'action') {
    const current = worldDraftRuntimeValue();
    const variable = (Array.isArray(current?.variables) ? current.variables : []).find(item => item?.type === 'number');
    if (!variable) return setWorldDraftStatus('请先添加一个数值变量，再创建变量动作。', 'error');
    mutateWorldDraftRuntime(runtime => runtime.actions.push({ id: `action-${uid()}`, label: '新动作', category: '状态', effects: [{ type: 'variable.delta', variableId: variable.id, delta: 1 }] }));
    return;
  }
  const kind = button.dataset.worldRuntimeRemove;
  if (!kind) return;
  const row = button.closest('[data-world-runtime-variable], [data-world-runtime-item], [data-world-runtime-action]');
  const sourceId = row?.dataset.worldRuntimeSourceId || '';
  if (!sourceId) return;
  if (kind === 'variable' && worldDraftRuntimeVariableIsReferenced(worldDraftRuntimeValue(), sourceId)) {
    setWorldDraftStatus(`变量「${sourceId}」仍被动作引用；请先改用其他变量或删除动作。`, 'error');
    return;
  }
  mutateWorldDraftRuntime(runtime => {
    if (kind === 'variable') runtime.variables = runtime.variables.filter(item => item?.id !== sourceId);
    if (kind === 'item') {
      const collection = worldDraftRuntimeItemCollection(runtime);
      if (collection) {
        collection.initial = (Array.isArray(collection.initial) ? collection.initial : []).filter(item => item?.id !== sourceId);
        if (!collection.initial.length) runtime.collections = runtime.collections.filter(item => item !== collection);
      }
      runtime.actions = runtime.actions.filter(item => item?.id !== `use-${sourceId}`);
    }
    if (kind === 'action') runtime.actions = runtime.actions.filter(item => item?.id !== sourceId);
  });
}
function handleWorldDraftRuntimeInput(event) {
  const row = event.target.closest('[data-world-runtime-variable], [data-world-runtime-item], [data-world-runtime-action]');
  if (!row) return;
  if (event.target.matches('[data-runtime-variable-type]')) {
    const id = row.querySelector('[data-runtime-variable-id]')?.value.trim() || '';
    const changesToNonNumber = event.target.value !== 'number';
    const isReferenced = id && [...document.querySelectorAll('#world-draft-runtime-actions [data-runtime-action-variable]')].some(select => select.value === id);
    if (changesToNonNumber && isReferenced && !worldDraftRuntimeNumericVariablesFromForm().length) {
      event.target.value = 'number';
      setWorldDraftStatus('该数值变量仍被动作使用；请先改用其他数值变量或删除动作。', 'error');
    }
    updateWorldDraftRuntimeVariableFields(row);
    refreshWorldDraftRuntimeActionVariables();
  }
  if (event.target.matches('[data-runtime-variable-id], [data-runtime-variable-label]')) {
    const idInput = row.querySelector('[data-runtime-variable-id]');
    const previousId = idInput?.dataset.runtimePreviousValue ?? row.dataset.worldRuntimeSourceId ?? '';
    const nextId = idInput?.value.trim() || '';
    refreshWorldDraftRuntimeActionVariables(previousId, nextId);
    if (idInput) idInput.dataset.runtimePreviousValue = nextId;
  }
  syncWorldDraftRuntimeFromForm();
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
    if (!schema.mode) schema.mode = 'custom';
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
  { key: 'failureModes', label: '失败模式', parentKey: 'failure', nestedKey: 'modes', rawId: 'world-draft-failure', editorId: 'world-draft-failure-modes-editor', previewId: 'world-draft-failure-modes-preview', loadId: 'world-draft-failure-load-modes-json', validateId: 'world-draft-failure-validate-modes-json', template: () => ({ id: 'failure-' + uid(), label: '新失败模式', description: '', effect: '' }) },
  { key: 'endingEndings', label: '结局条目', parentKey: 'ending', nestedKey: 'endings', rawId: 'world-draft-ending', editorId: 'world-draft-ending-endings-editor', previewId: 'world-draft-ending-endings-preview', loadId: 'world-draft-ending-load-endings-json', validateId: 'world-draft-ending-validate-endings-json', template: () => ({ id: 'ending-' + uid(), kind: 'card-defined', label: '新结局', description: '', terminal: true }) },
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
        if (!error) error = `NPC ${index + 1} 的主动行动模板不是有效 JSON：${err.message || '格式错误'}`;
        if (!focus) focus = row.querySelector('[data-npc-actions]');
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
  const surfaces = new Set(Array.isArray(value.surfaces) ? value.surfaces : ['play']);
  $('world-extension-surface-setup').checked = surfaces.has('setup');
  $('world-extension-surface-play').checked = surfaces.has('play');
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
  const surfaces = [...document.querySelectorAll('[id^="world-extension-surface-"]:checked')].map(input => input.value);
  const permissions = [...document.querySelectorAll('[data-world-extension-permission]:checked')].map(input => input.value);
  const hasContent = enabled.checked || !immersive || actionNarrates || title || html.trim() || css.trim() || js.trim() || mvuText || permissions.length || surfaces.length;
  if (!hasContent) return { ok: true, value: null };
  const maxHeight = Number($('world-extension-height').value);
  const timeoutMs = Number($('world-extension-timeout').value);
  if (!Number.isInteger(maxHeight) || maxHeight < 180 || maxHeight > 800) {
    setWorldDraftStatus('扩展高度必须是 180-800 的整数。', 'error'); $('world-extension-height').focus(); return { ok: false };
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 200 || timeoutMs > 5000) {
    setWorldDraftStatus('扩展超时必须是 200-5000 的整数。', 'error'); $('world-extension-timeout').focus(); return { ok: false };
  }
  return { ok: true, value: { enabled: enabled.checked, ...(immersive ? {} : { immersive: false }), ...(actionNarrates ? { actionNarrates: true } : {}), ...(title ? { title } : {}), ...(html ? { html } : {}), ...(css ? { css } : {}), ...(js ? { js } : {}), ...(mvu ? { mvu } : {}), permissions, surfaces: surfaces.length ? surfaces : ['play'], maxHeight, timeoutMs } };
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
  setWorldDraftJsonRawState($('world-draft-runtime'));
  renderWorldDraftRuntimeForm();
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
  if (!worldWorkspaceActive) return `已选择「${save.name}」；点击工作台返回这份存档的对话。`;
  return `存档已打开：「${save.name}」——世界状态、地图和叙事已绑定当前存档；当前存档 ID：${save.id}`;
}
function worldDraftRouteId() {
  const value = new URL(location.href).searchParams.get('worldDraft') || '';
  return WORLD_DRAFT_RUNTIME_ID_RE.test(value) ? value : '';
}
function writeWorldDraftRoute(worldId, { replace = false } = {}) {
  const url = new URL(location.href);
  url.searchParams.set('worldDraft', worldId);
  const state = { ...(history.state || {}), worldDraftRoute: worldId };
  history[replace ? 'replaceState' : 'pushState'](state, '', url);
}
function clearWorldDraftRoute({ replace = true } = {}) {
  const url = new URL(location.href);
  url.searchParams.delete('worldDraft');
  const state = { ...(history.state || {}) };
  delete state.worldDraftRoute;
  history[replace ? 'replaceState' : 'pushState'](state, '', url);
}
function worldDraftEditorActive() {
  return document.body.classList.contains('world-authoring-active') || !!$('world-draft-dialog')?.open;
}
function presentWorldDraftEditor(draft, { route = true, status = '' } = {}) {
  const dialog = $('world-draft-dialog');
  if (!dialog) return;
  // A direct authoring URL owns the modal layer; pause any in-progress setup first.
  closeWorldPlayerDialog();
  closeWorldOpeningDialog();
  worldDraft = draft;
  worldDraftDirty = false;
  worldDraftPublishId = null;
  fillWorldDraftForm(draft);
  document.body.classList.add('world-authoring-active');
  document.title = `制卡 · ${draft?.world?.title || '世界草稿'} · Tavern`;
  if (route && worldDraftRouteId() !== draft.worldId) writeWorldDraftRoute(draft.worldId);
  if (!dialog.open) dialog.showModal();
  if (status) setWorldDraftStatus(status);
  requestAnimationFrame(() => $('world-draft-name')?.focus());
}
function dismissWorldDraftEditor({ restoreFocus = true } = {}) {
  const dialog = $('world-draft-dialog');
  if (dialog?.open) dialog.close('cancel');
  document.body.classList.remove('world-authoring-active');
  document.title = APP_DOCUMENT_TITLE;
  if (restoreFocus) worldDraftOpener?.focus?.();
  worldDraftOpener = null;
}
async function syncWorldDraftRoute({ fromPopstate = false } = {}) {
  const routeId = worldDraftRouteId();
  const dialog = $('world-draft-dialog');
  if (!routeId) {
    worldDraftRouteLoadToken += 1;
    if (dialog?.open && worldDraftDirty && fromPopstate && !confirm('草稿还有未保存的修改，确定离开制卡页吗？')) {
      writeWorldDraftRoute(worldDraft?.worldId || '', { replace: false });
      return;
    }
    worldDraftDirty = false;
    dismissWorldDraftEditor();
    return;
  }
  if (dialog?.open && worldDraft?.worldId === routeId) {
    document.body.classList.add('world-authoring-active');
    document.title = `制卡 · ${worldDraft.world?.title || '世界草稿'} · Tavern`;
    return;
  }
  const token = ++worldDraftRouteLoadToken;
  document.body.classList.add('world-authoring-active');
  try {
    const res = await fetch('/api/world-drafts/' + encodeURIComponent(routeId));
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(worldApiError(data, '世界草稿读取失败（HTTP ' + res.status + '）'));
    if (token !== worldDraftRouteLoadToken || worldDraftRouteId() !== routeId) return;
    presentWorldDraftEditor(data, { route: false, status: '已从制卡页链接恢复草稿。' });
  } catch (error) {
    if (token !== worldDraftRouteLoadToken) return;
    clearWorldDraftRoute({ replace: true });
    dismissWorldDraftEditor({ restoreFocus: false });
    showWorldError(error.message);
  }
}
function leaveWorldDraftEditor() {
  const routeId = worldDraftRouteId();
  if (routeId && history.state?.worldDraftRoute === routeId) {
    history.back();
    return;
  }
  clearWorldDraftRoute({ replace: true });
  dismissWorldDraftEditor();
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
    presentWorldDraftEditor(data, { status: data.createdAt === data.updatedAt
      ? (worldDraftIsNew(data) ? '新世界草稿已创建，修改后点击保存。' : '草稿已创建，修改后点击保存。')
      : '已载入上次保存的草稿。' });
  } catch (err) {
    setWorldDraftStatus(err.message, 'error');
  }
}
function requestCloseWorldDraft() {
  const dialog = $('world-draft-dialog');
  if (!dialog?.open) return;
  if (worldDraftDirty && !confirm('草稿还有未保存的修改，确定关闭吗？')) return;
  worldDraftDirty = false;
  leaveWorldDraftEditor();
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
  const collections = collectWorldDraftCollections();
  if (collections.error) {
    setWorldDraftStatus(collections.error, 'error');
    collections.focus?.focus();
    return false;
  }
  const { locations, npcs } = collections;
  const runtimeResult = syncWorldDraftRuntimeFromForm();
  if (!runtimeResult.ok) return false;
  const runtime = runtimeResult.value;
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
  const duplicate = worldDraftDuplicateIdReport({
    ...worldDraft.world,
    locations,
    npcs,
    playerCreation,
    runtime,
    sessionSetup,
    failure,
    ending,
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
      body: JSON.stringify({ expectedUpdatedAt: worldDraft.updatedAt, baseVersion: worldDraft.baseVersion, title, summary, tags, lorebookIds, rpgPresetName, agent, ui, regexes, runtime, locations, npcs, setting, rules, playerCreation, sessionSetup, turnContract, failure, ending, time }),
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
  if (!worldDraftPublishId) worldDraftPublishId = 'publish-' + uid();
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
    worldDraftDirty = false;
    worldDraftPublishId = null;
    clearWorldDraftRoute({ replace: true });
    dismissWorldDraftEditor({ restoreFocus: false });
    worldDraft = null;
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
  if (restoreWorldAgentPending(data)) clearWorldStateFeedback();
  else restoreWorldStateFeedback(data);
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
  const pendingTurns = cloneValue(pending.turns);
  const lastPendingTurn = pendingTurns.at(-1);
  const assistantMessage = lastPendingTurn?.role === 'assistant' ? pendingTurns.pop() : null;
  worldTurnPending = {
    saveId: save.id,
    commandId: pending.commandId,
    expectedRevision: pending.baseRevision,
    beforeState: cloneValue(save.state),
    state: cloneValue(pending.state || save.state),
    messages: pendingTurns,
    assistantMessage,
    agentSession: null,
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
    autoRetryCount: 0,
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
function scheduleWorldPlayerDraftAutosave() {
  const save = currentWorldSave;
  if (!save || !worldSavePlanning(save) || save.player?.snapshot || !editingWorldPlayerSaveId || editingWorldPlayerSaveId !== save.id) return;
  clearTimeout(worldSetupAutosaveTimer);
  worldSetupAutosaveTimer = setTimeout(async () => {
    const current = currentWorldSave;
    if (!current || current.id !== save.id || !worldSavePlanning(current) || current.player?.snapshot) return;
    try {
      const response = await fetch('/api/world-saves/' + encodeURIComponent(current.id) + '/setup', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ commandId: 'setup-draft-' + uid(), expectedRevision: current.revision, draft: { ...(current.setup?.draft || {}), player: collectWorldPlayerInput() } }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(worldApiError(data, '开局草稿保存失败（HTTP ' + response.status + '）'));
      if (currentWorldSaveId === current.id) { hydrateWorldSave(data); currentWorldSave = data; renderWorldList(); }
    } catch (error) {
      setWorldPlayerStatus(error.message, 'error');
    }
  }, 700);
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
  if (worldCardHasSetupSurface(fullWorld)) {
    const save = await createWorldSave(name, null, $('world-save-preset')?.value || fullWorld.playerCreation?.defaultPresetId || '', true);
    const input = $('world-save-name');
    if (input) input.value = '';
    return save;
  }
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
function setWorldSetupExtensionMode(enabled) {
  const active = Boolean(enabled);
  document.body.classList.toggle('world-setup-extension-mode', active);
  const exit = $('rpg-extension-setup-exit');
  if (exit) exit.hidden = !active;
}
function openWorldSetupExtension(save = currentWorldSave) {
  if (!save || !worldSavePlanning(save) || !worldCardHasSetupSurface()) return false;
  closeWorldPlayerDialog();
  closeWorldOpeningDialog();
  setWorldCustomLayout(false);
  setWorldSetupExtensionMode(true);
  renderWorldExtension('setup');
  return true;
}
function closeWorldSetupExtension() {
  setWorldSetupExtensionMode(false);
  clearWorldExtension();
  if (currentWorldSave?.player?.snapshot) openWorldOpeningDialog(currentWorldSave);
  else if (currentWorldSave) openWorldPlayerEditor(currentWorldSave);
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
  if (!save || !world || !worldSavePlanning(save) || worldDraftEditorActive()) return;
  editingWorldPlayerSaveId = save.id;
  pendingWorldSaveName = save.name || '';
  pendingWorldPlayerPresetId = save.setup?.playerPresetId || '';
  pendingWorldSaveButton = null;
  renderWorldPlayerPresetSelects(world, pendingWorldPlayerPresetId);
  renderWorldPlayerForm(world, 'world-player-fields', save.setup?.draft?.player || save.state?.player || null);
  $('world-player-title').textContent = '编辑本局 RP 角色';
  $('world-player-intro').textContent = '修改只会更新当前 WorldSave，不会改写角色库或世界卡。';
  $('world-player-create').textContent = '保存角色并返回开局配置';
  const dialog = $('world-player-dialog');
  if (!dialog.open) dialog.showModal();
}
function resumeWorldSaveSetup(save = currentWorldSave) {
  if (!save || !worldSavePlanning(save)) return false;
  if (!save.player?.snapshot) {
    if (openWorldSetupExtension(save)) return true;
    openWorldPlayerEditor(save);
    setWorldPlayerStatus('这是一个尚未完成的开局存档。请先完成玩家角色，再继续开场规划。');
    return true;
  }
  openWorldOpeningDialog(save);
  return true;
}
async function createWorldSave(name, player, playerPresetId = '', setupOnly = false) {
  if (worldTurnPending) discardWorldTurnPending();
  const world = worldCardById(currentWorldId);
  if (!world) throw new Error('请先选择一个世界卡');
  const res = await fetch('/api/world-saves', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ worldId: world.id, worldVersion: world.version, name, ...(player ? { player } : {}), ...(playerPresetId ? { playerPresetId } : {}), ...(setupOnly ? { setupOnly: true } : {}) }),
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
  if (!save || !worldSavePlanning(save) || worldDraftEditorActive()) return;
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
    beginDebugRequest(save, payload, { label: '开场候选', kind: 'opening-plan', commandId: traceCommandId });
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
  if (!upgrade.commandId) upgrade.commandId = 'upgrade-' + uid();
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
    // 世界库是宿主层；切卡前先卸载上一张卡的接管状态，避免导航栏被旧卡的
    // custom/immersive 壳层继续隐藏。
    await exitWorldImmersiveMode();
    worldWorkspaceActive = false;
    setWorldCustomLayout(false);
    clearWorldExtension();
    syncModeNavigation('worlds');
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
    showWorldError('当前存档还有未完成的回合，请先处理当前回合。');
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
    if (opened?.setup?.status === 'planning') resumeWorldSaveSetup(opened);
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
  list.innerHTML = saves.length ? saves.map(save => `<div class="world-save-card${worldWorkspaceActive && save.id === currentWorldSaveId ? ' active' : ''}">
    <div class="world-save-main"><span class="world-save-name">${esc(save.name)} ${save.setupStatus === 'planning' ? '<em class="world-save-planning">待开局</em>' : ''}</span><span class="world-save-meta">世界 v${esc(save.worldVersion)} · ${esc(save.locationId || '未定位')} · revision ${esc(save.revision)} · ${esc(formatWorldDate(save.updatedAt))}</span></div>
    <div class="world-save-actions">${Number(save.worldVersion) < latestVersion ? `<button class="ghost-btn small" type="button" data-upgrade-save="${esc(save.id)}">升级…</button>` : ''}<button class="ghost-btn small" type="button" data-open-save="${esc(save.id)}">${save.setupStatus === 'planning' ? '继续规划' : worldWorkspaceActive && save.id === currentWorldSaveId ? '已打开' : '打开存档'}</button><button class="ghost-btn small" type="button" data-copy-save="${esc(save.id)}">复制</button><button class="ghost-btn small" type="button" data-rename-save="${esc(save.id)}">重命名</button><button class="ghost-btn small" type="button" data-export-save="${esc(save.id)}">导出</button><button class="ghost-btn small danger" type="button" data-delete-save="${esc(save.id)}">删除</button></div>
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
    const token = ++worldLoadToken;
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '读取中…';
    try {
      const opened = await openWorldSave(btn.dataset.openSave, token);
      if (!opened || token !== worldLoadToken) return;
      const status = $('world-open-status');
      if (currentWorldSave.setup?.status === 'planning') {
        resumeWorldSaveSetup(currentWorldSave);
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
      if (worldSavePlanning()) resumeWorldSaveSetup(currentWorldSave);
      else enterWorldWorkspace();
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
  worldWorkspaceActive = false;
  // 恢复已有 RPG 存档时先保持管理层隐藏，避免异步读取期间闪出世界卡界面。
  // 没有可恢复的存档则正常展示世界库，让用户选择或创建世界。
  const restoringSave = restoreWorkspace && !!currentWorldSaveId;
  syncModeNavigation(restoringSave ? 'chat' : 'worlds');
  if (!restoringSave) {
    // 离开存档工作区即结束未提交的临时回合；否则删除按钮会被旧回合状态
    // 永久拦截，即使用户已经退出该存档。
    if (worldTurnPending) discardWorldTurnPending();
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
function worldCardHasSetupSurface(world = currentWorldCard()) {
  const extension = world?.ui?.extension;
  return extension?.enabled !== false && Array.isArray(extension?.surfaces) && extension.surfaces.includes('setup')
    && Boolean(extension.html || extension.css || extension.js || extension.mvu != null);
}

/* 开场白与 AI 回复共用同一套 Tavern 协议解析，确保首条消息里的
 * <tavern_options> 也会进入底部快捷行动栏，而不会泄露到正文。 */
function createTavernGreetingMessage(greeting) {
  const processed = processAIOutput(greeting);
  const message = {
    id: uid(),
    role: 'assistant',
    content: processed.content,
    rawContent: processed.rawContent,
    ts: Date.now(),
  };
  if (Array.isArray(processed.options) && processed.options.length) message.options = processed.options;
  return message;
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

function renderRpgSheetMetric(definition, value, deltaKey = '') {
  const numeric = value === null || value === undefined || (typeof value === 'string' && !value.trim()) ? NaN : Number(value);
  const hasRange = Number.isFinite(numeric) && Number.isFinite(Number(definition?.min)) && Number.isFinite(Number(definition?.max)) && Number(definition.max) > Number(definition.min);
  const meter = hasRange ? Math.max(0, Math.min(100, (numeric - Number(definition.min)) / (Number(definition.max) - Number(definition.min)) * 100)) : null;
  const display = Number.isFinite(numeric) ? String(value) : '—';
  return `<div class="rpg-sheet-stat"><div class="rpg-sheet-stat-head"><span title="${esc(definition?.description || definition?.label || definition?.id || '')}">${esc(definition?.label || definition?.id || '未命名')}</span><b>${esc(display)}${worldStateDeltaMarkup(deltaKey)}</b></div>${meter === null ? '' : `<div class="rpg-sheet-meter" aria-hidden="true"><i style="--meter:${meter.toFixed(2)}%"></i></div>`}</div>`;
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
    return renderRpgSheetSection(title, `<div class="rpg-sheet-grid">${definitions.map(definition => renderRpgSheetMetric(definition, values[definition.id] ?? definition.default ?? definition.initial ?? definition.min, worldStatePathKey(['state', 'player', bucket, definition.id]))).join('')}</div>`);
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
    ? `<div class="rpg-sheet-grid">${relations.map(rule => renderRpgSheetMetric({ ...rule, id: rule.npcId, label: npcNames.get(rule.npcId) || rule.npcId, min: rule.min ?? -100, max: rule.max ?? 100 }, relationValues[rule.npcId] ?? rule.default ?? 0, worldStatePathKey(['state', 'player', 'relations', rule.npcId]))).join('')}</div>`
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

/* 渲染 RPG 面板：保留普通 RPG 兼容投影；世界卡游玩态只显示声明式玩家字段和卡内 runtime 面板。 */
const RPG_UI_SOURCES = new Set([
  'world.npcs', 'world.locations', 'save.npcStates', 'save.state.activeHooks', 'save.state.goals', 'save.state.leads',
  'save.state.worldEvents', 'save.state.factionStates', 'save.state.player.attributes',
  'save.state.player.skills', 'save.state.player.resources', 'save.state.player.traits',
]);

function isSupportedRpgUiSource(source) {
  return RPG_UI_SOURCES.has(source) || /^runtime\.(variables|collections|actions)\.[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(String(source || ''));
}

function readRpgUiField(value, path) {
  return String(path || '').split('.').reduce((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return current[key];
  }, value);
}

function rpgUiValueText(value, fieldKey = '') {
  if (value === undefined || value === null || value === '') return '—';
  if (fieldKey === 'status' && value === 'confirmed') return '已确认';
  if (fieldKey === 'status' && value === 'unconfirmed') return '未确认';
  if (Array.isArray(value)) return value.map(item => rpgUiValueText(item, fieldKey)).join('、');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function rpgRuntimeActionIsConfirmed(action, runtime) {
  return (Array.isArray(action?.effects) ? action.effects : []).some(effect => {
    if (effect?.type !== 'collection.patch' || effect.set?.status !== 'confirmed') return false;
    const entries = runtime?.collections?.[effect.collectionId];
    return Array.isArray(entries) && entries.some(entry => String(entry?.id || '') === String(effect.entryId || '') && entry.status === 'confirmed');
  });
}

function rpgRuntimeActionAvailabilityUsesInput(action) {
  return (Array.isArray(action?.availability) ? action.availability : []).some(condition => /\{\{\s*input\./.test(String(condition?.entryId || '')));
}

function rpgRuntimeActionUnavailableStatus(error) {
  return /当前值 0/.test(String(error || '')) ? '资源已耗尽，无法执行此动作。' : '当前条件不足，暂时无法执行此动作。';
}

function rpgRuntimeActionAvailabilityError(action, runtime, input = {}) {
  const resolvedInput = input && typeof input === 'object' && !Array.isArray(input) ? { ...input } : {};
  for (const field of Array.isArray(action?.inputs) ? action.inputs : []) {
    if (field?.id && resolvedInput[field.id] === undefined && field.default !== undefined) resolvedInput[field.id] = field.default;
  }
  const resolveEntryId = value => String(value == null ? '' : value).replace(/\{\{\s*input\.([A-Za-z0-9_-]+)\s*\}\}/g, (_, key) => resolvedInput[key] == null ? '' : String(resolvedInput[key]));
  const compare = (actual, operator, expected) => {
    if (operator === '==') return actual === expected;
    if (operator === '!=') return actual !== expected;
    const left = Number(actual);
    const right = Number(expected);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    return operator === '>' ? left > right : operator === '>=' ? left >= right : operator === '<' ? left < right : operator === '<=' ? left <= right : false;
  };
  const unavailable = detail => `动作 ${action?.id || 'unknown'} 当前不可用：${detail}`;
  for (const condition of Array.isArray(action?.availability) ? action.availability : []) {
    const type = condition?.type;
    const collectionId = String(condition?.collectionId || '');
    const entryId = type?.startsWith('collection.') ? resolveEntryId(condition.entryId) : '';
    if (type === 'collection.exists') {
      const entries = Array.isArray(runtime?.collections?.[collectionId]) ? runtime.collections[collectionId] : [];
      if (!entries.some(entry => String(entry?.id || '') === entryId)) return unavailable(`缺少 ${collectionId}.${entryId}`);
      continue;
    }
    if (type === 'collection.number') {
      const entries = Array.isArray(runtime?.collections?.[collectionId]) ? runtime.collections[collectionId] : [];
      const entry = entries.find(item => String(item?.id || '') === entryId);
      const actual = entry?.[condition.field];
      if (!entry || !Number.isFinite(Number(actual))) return unavailable(`${collectionId}.${entryId}.${condition.field} 不存在或不是数字`);
      if (!compare(actual, condition.operator, condition.value)) return unavailable(`${collectionId}.${entryId}.${condition.field} 当前值 ${actual}，不满足 ${condition.operator} ${condition.value}`);
      continue;
    }
    if (type === 'variable.compare') {
      const actual = runtime?.variables?.[condition.variableId];
      if (!compare(actual, condition.operator, condition.value)) return unavailable(`变量 ${condition.variableId} 当前值 ${actual}，不满足 ${condition.operator} ${condition.value}`);
    }
  }
  return null;
}

function worldStatePathKey(segments) {
  return JSON.stringify(segments.map(segment => String(segment)));
}

function worldStateListKey(value, index) {
  return String(value && typeof value === 'object' && (value.id || value.itemId || value.name || value.title)
    || typeof value === 'string' && value || index + 1);
}

function worldStateFriendlyName(value) {
  return value && typeof value === 'object'
    ? String(value.label || value.title || value.name || value.itemId || value.npcId || value.id || '').trim()
    : '';
}

function collectWorldStateChanges(beforeSave, afterSave) {
  const changes = new Map();
  const visit = (before, after, path, labelHint = '') => {
    if (Object.is(before, after)) return;
    if (Array.isArray(before) || Array.isArray(after)) {
      if (!Array.isArray(before) || !Array.isArray(after)) {
        changes.set(worldStatePathKey(path), { path, before, after, labelHint });
        return;
      }
      const previous = new Map(before.map((value, index) => [worldStateListKey(value, index), value]));
      const next = new Map(after.map((value, index) => [worldStateListKey(value, index), value]));
      for (const key of new Set([...previous.keys(), ...next.keys()])) {
        const oldValue = previous.get(key);
        const newValue = next.get(key);
        const itemLabel = worldStateFriendlyName(newValue) || worldStateFriendlyName(oldValue) || labelHint;
        if (!previous.has(key) || !next.has(key)) changes.set(worldStatePathKey([...path, key]), { path: [...path, key], before: oldValue, after: newValue, labelHint: itemLabel });
        else visit(oldValue, newValue, [...path, key], itemLabel);
      }
      return;
    }
    const beforeObject = before && typeof before === 'object';
    const afterObject = after && typeof after === 'object';
    if (beforeObject && afterObject) {
      const ownLabel = worldStateFriendlyName(after) || worldStateFriendlyName(before) || labelHint;
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) visit(before[key], after[key], [...path, key], ownLabel);
      return;
    }
    changes.set(worldStatePathKey(path), { path, before, after, labelHint });
  };
  const roots = [
    ['state', 'player'], ['state', 'runtime'], ['state', 'activeHooks'], ['state', 'goals'],
    ['state', 'leads'], ['state', 'worldEvents'], ['state', 'factionStates'], ['state', 'inventory'], ['npcStates'],
  ];
  const at = (value, path) => path.reduce((current, key) => current?.[key], value);
  roots.forEach(path => visit(at(beforeSave, path), at(afterSave, path), path));
  return changes;
}

function collectWorldStateFeedbackChanges(beforeSave, afterSave) {
  const deltas = new Map();
  for (const [key, change] of collectWorldStateChanges(beforeSave, afterSave)) {
    const previous = typeof change.before === 'number' && Number.isFinite(change.before) ? change.before : change.before === undefined ? 0 : NaN;
    if (typeof change.after === 'number' && Number.isFinite(change.after) && Number.isFinite(previous) && change.after !== previous) deltas.set(key, change.after - previous);
  }
  return deltas;
}

function worldStateChangeLabel(change, beforeSave, afterSave) {
  const path = change.path;
  const runtime = afterSave?.state?.runtime || beforeSave?.state?.runtime;
  if (path[1] === 'runtime' && path[2] === 'variables') {
    return runtime?.schema?.variables?.find(item => item?.id === path[3])?.label || path[3];
  }
  if (change.labelHint) return change.labelHint;
  if (path[1] === 'player' && ['attributes', 'skills', 'resources'].includes(path[2])) {
    return currentWorldCard()?.playerCreation?.[path[2]]?.find(item => item?.id === path[3])?.label || path[3];
  }
  if (path[1] === 'player' && path[2] === 'relations') {
    return currentWorldCard()?.npcs?.find(item => item?.id === path[3])?.name || path[3];
  }
  return ({ status: '状态', count: '数量', value: '数值' })[path.at(-1)] || path.at(-1) || '状态';
}

function normalizeWorldStateFeedbackItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 16).flatMap(item => {
    const path = Array.isArray(item?.path) && item.path.length && item.path.length <= 12
      ? item.path.map(segment => String(segment).slice(0, 160)) : null;
    const label = typeof item?.label === 'string' ? item.label.trim().slice(0, 120) : '';
    if (!path || !label || !['delta', 'set', 'add', 'remove'].includes(item.kind)) return [];
    if (item.kind === 'delta') {
      const delta = Number(item.delta);
      return Number.isFinite(delta) && delta !== 0 ? [{ path, label, kind: 'delta', delta: Math.round(delta * 1000) / 1000 }] : [];
    }
    if (item.kind === 'set') {
      const value = String(item.value ?? '').trim().slice(0, 80);
      return value ? [{ path, label, kind: 'set', value }] : [];
    }
    return [{ path, label, kind: item.kind }];
  });
}

function worldStateFeedbackItems(beforeSave, afterSave) {
  const items = [];
  for (const change of collectWorldStateChanges(beforeSave, afterSave).values()) {
    const label = worldStateChangeLabel(change, beforeSave, afterSave);
    if (typeof change.before === 'number' && Number.isFinite(change.before) && typeof change.after === 'number' && Number.isFinite(change.after)) {
      items.push({ path: change.path, label, kind: 'delta', delta: change.after - change.before });
    } else if (change.after === undefined) items.push({ path: change.path, label, kind: 'remove' });
    else if (change.before === undefined) items.push({ path: change.path, label, kind: 'add' });
    else if (!change.after || typeof change.after !== 'object') items.push({ path: change.path, label, kind: 'set', value: rpgUiValueText(change.after, change.path.at(-1)) });
  }
  return normalizeWorldStateFeedbackItems(items);
}

function applyWorldStateFeedback(saveId, items, { exiting = false } = {}) {
  const normalized = normalizeWorldStateFeedbackItems(items);
  worldStateFeedback = {
    saveId: normalized.length ? saveId || null : null,
    token: worldStateFeedback.token + 1,
    changes: new Map(normalized.map(item => [worldStatePathKey(item.path), item])),
    exiting,
  };
  return normalized;
}

function clearWorldStateFeedback() {
  worldStateFeedback = { saveId: null, token: worldStateFeedback.token + 1, changes: new Map(), exiting: false };
}

function hideWorldStateFeedback() {
  if (!worldStateFeedback.changes.size || worldStateFeedback.exiting) return;
  const token = worldStateFeedback.token + 1;
  worldStateFeedback = { ...worldStateFeedback, token, exiting: true };
  if (worldModeActive()) renderRPG();
  setTimeout(() => {
    if (worldStateFeedback.token !== token) return;
    clearWorldStateFeedback();
    if (worldModeActive()) renderRPG();
  }, WORLD_STATE_FEEDBACK_EXIT_MS);
}

function restoreWorldStateFeedback(save) {
  const message = [...(Array.isArray(save?.turns) ? save.turns : [])].reverse().find(turn => turn?.role === 'assistant');
  applyWorldStateFeedback(save?.id, message?.stateChanges || []);
}

function attachWorldStateFeedback(pending, afterState) {
  if (!pending?.assistantMessage || !afterState) return [];
  const items = worldStateFeedbackItems({ state: pending.beforeState || {} }, { state: afterState });
  if (items.length) pending.assistantMessage.stateChanges = items;
  else delete pending.assistantMessage.stateChanges;
  return items;
}

function showWorldStateFeedback(beforeSave, afterSave) {
  return applyWorldStateFeedback(afterSave?.id, worldStateFeedbackItems(beforeSave, afterSave));
}

function worldStateDeltaMarkup(key) {
  if (!key || worldStateFeedback.saveId !== currentWorldSaveId) return '';
  const change = worldStateFeedback.changes.get(key);
  if (!change) return '';
  const text = change.kind === 'delta' ? `${change.delta > 0 ? '+' : ''}${change.delta}`
    : change.kind === 'set' ? `→ ${change.value}` : change.kind === 'add' ? '新增' : '已移除';
  const tone = change.kind === 'remove' || change.kind === 'delta' && change.delta < 0 ? 'decrease'
    : change.kind === 'set' ? 'changed' : 'increase';
  return `<span class="rpg-state-delta ${tone}${worldStateFeedback.exiting ? ' leaving' : ''}" data-world-state-delta aria-label="${esc(`${change.label}${text}`)}">${esc(text)}</span>`;
}

function worldPanelStateRoot(source) {
  const text = String(source || '');
  return text.startsWith('runtime.')
    ? ['state', ...text.split('.')]
    : text.startsWith('save.') ? text.slice(5).split('.') : null;
}

function worldPanelStateDeltaKey(source, entry, field) {
  if (!field?.key || field.key === '$key') return '';
  const root = worldPanelStateRoot(source);
  if (field.key === '$value') return root ? worldStatePathKey(root) : '';
  return root ? worldStatePathKey([...root, entry.key, ...String(field.key).split('.')]) : '';
}

function worldPanelEntryFeedbackMarkup(source) {
  const root = worldPanelStateRoot(source);
  if (!root || worldStateFeedback.saveId !== currentWorldSaveId) return '';
  return [...worldStateFeedback.changes.entries()].filter(([, change]) =>
    ['add', 'remove'].includes(change.kind)
    && change.path.length === root.length + 1
    && root.every((segment, index) => change.path[index] === segment))
    .map(([key, change]) => `<span>${esc(change.label)}${worldStateDeltaMarkup(key)}</span>`).join('');
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
  // 世界卡退出后，重新把宿主主题同步到 body；否则进入世界卡前留下的
  // body 内联变量会遮住用户刚在设置里改好的根变量。
  if (!worldModeActive()) applyUiTheme(uiThemeFromPrefs());
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

function runtimeAuthoringDefaultPanels(world, configuredPanels = []) {
  const configuredSources = new Set(configuredPanels.map(panel => String(panel?.source || '')));
  const panels = [];
  const add = panel => {
    if (!configuredSources.has(panel.source) && panels.length < WORLD_DRAFT_AUTO_PANEL_LIMIT) {
      panels.push(panel);
      configuredSources.add(panel.source);
      return true;
    }
    return false;
  };
  const collection = worldDraftRuntimeItemCollection(world?.runtime);
  if (collection) {
    add({
      title: collection.label || '耐久物品',
      side: 'right',
      source: `runtime.collections.${collection.id}`,
      layout: 'table',
      fields: [
        { key: 'durability', label: '耐久' },
        { key: 'maxDurability', label: '最大耐久' },
        { key: 'uses', label: '使用次数' },
      ],
    });
    for (const item of Array.isArray(collection.initial) ? collection.initial : []) {
      const action = worldDraftRuntimeItemAction(world.runtime, item?.id);
      if (action && !add({
        title: action.label || `使用${item?.label || item?.id || ''}`,
        side: 'left',
        source: `runtime.actions.${action.id}`,
        layout: 'actions',
      })) break;
    }
  }
  for (const variable of Array.isArray(world?.runtime?.variables) ? world.runtime.variables : []) {
    if (!variable?.id || variable.visible === false) continue;
    add({
      title: variable.label || variable.id,
      side: 'right',
      source: `runtime.variables.${variable.id}`,
      layout: 'cards',
      fields: [{ key: '$value', label: '当前值' }],
      valueLabel: variable.label || variable.id,
    });
  }
  return panels;
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
  const configuredPanels = Array.isArray(world.ui?.sidebar?.panels) ? world.ui.sidebar.panels : [];
  // A sidebar declaration is an explicit author choice, including panels: [].
  const panels = world.ui?.sidebar ? configuredPanels : [...configuredPanels, ...runtimeAuthoringDefaultPanels(world, configuredPanels)];
  for (const panel of panels) {
    const match = /^runtime\.(variables|collections|actions)\.([A-Za-z0-9][A-Za-z0-9_-]{0,63})$/.exec(String(panel?.source || ''));
    if (!match) continue;
    if (match[1] === 'variables' && currentWorldCard()?.runtime?.variables?.find(item => item.id === match[2])?.visible === false) continue;
    sourceValues[panel.source] = match[1] === 'variables'
      ? { value: runtime?.variables?.[match[2]] }
      : match[1] === 'collections'
        ? (runtime?.collections?.[match[2]] || [])
        : (currentWorldCard()?.runtime?.actions || []).find(item => item?.id === match[2]) || null;
  }
  for (const panel of panels) {
    if (!panel || !isSupportedRpgUiSource(panel.source)) continue;
    const target = targets[panel.side === 'left' ? 'left' : 'right'];
    if (!target) continue;
    const layout = ['cards', 'table', 'actions'].includes(panel.layout) ? panel.layout : 'list';
    const section = document.createElement('section');
    section.className = `rpg-custom-panel rpg-custom-${layout}`;
    const heading = document.createElement('div');
    heading.className = 'rpg-panel-head';
    heading.style.marginTop = '10px';
    heading.textContent = `${panel.icon ? `${panel.icon} ` : ''}${panel.title}`;
    section.appendChild(heading);
    const runtimeAction = /^runtime\.actions\.([A-Za-z0-9][A-Za-z0-9_-]{0,63})$/.exec(String(panel.source || '')) ? sourceValues[panel.source] : null;
    if (layout === 'actions' && runtimeAction && typeof runtimeAction === 'object') {
      const alreadyConfirmed = rpgRuntimeActionIsConfirmed(runtimeAction, runtime);
      const availabilityError = rpgRuntimeActionAvailabilityUsesInput(runtimeAction) ? null : rpgRuntimeActionAvailabilityError(runtimeAction, runtime);
      const description = document.createElement('p');
      description.className = 'hint';
      description.textContent = runtimeAction.description || '提交后由 AI 根据当前世界规则执行。';
      section.appendChild(description);
      const form = document.createElement('form');
      form.className = 'rpg-runtime-action';
      for (const inputDefinition of Array.isArray(runtimeAction.inputs) ? runtimeAction.inputs : []) {
        if (!inputDefinition || typeof inputDefinition !== 'object') continue;
        const field = document.createElement('label');
        field.className = 'rpg-runtime-action-field';
        field.textContent = `${inputDefinition.label || inputDefinition.id}${inputDefinition.required ? '（必填）' : ''}`;
        let control;
        if (inputDefinition.type === 'enum' && Array.isArray(inputDefinition.options)) {
          control = document.createElement('select');
          inputDefinition.options.slice(0, 64).forEach(option => {
            const optionEl = document.createElement('option');
            optionEl.value = String(option);
            optionEl.textContent = String(option);
            control.appendChild(optionEl);
          });
        } else if (['list', 'map', 'json'].includes(inputDefinition.type)) {
          control = document.createElement('textarea');
          control.rows = 2;
        } else {
          control = document.createElement('input');
          control.type = inputDefinition.type === 'number' ? 'number' : inputDefinition.type === 'boolean' ? 'checkbox' : 'text';
        }
        control.name = inputDefinition.id;
        control.dataset.runtimeInput = inputDefinition.id;
        if (inputDefinition.type === 'number') {
          if (Number.isFinite(inputDefinition.min)) control.min = String(inputDefinition.min);
          if (Number.isFinite(inputDefinition.max)) control.max = String(inputDefinition.max);
        }
        if (inputDefinition.type === 'boolean') control.checked = inputDefinition.default === true;
        else if (inputDefinition.default !== undefined) control.value = typeof inputDefinition.default === 'string' ? inputDefinition.default : JSON.stringify(inputDefinition.default);
        field.appendChild(control);
        form.appendChild(field);
      }
      const submit = document.createElement('button');
      submit.type = 'submit';
      submit.className = 'btn gold small';
      submit.textContent = alreadyConfirmed ? `${runtimeAction.label || '执行动作'}（已确认）` : (runtimeAction.label || '执行动作');
      submit.disabled = alreadyConfirmed || !!availabilityError;
      form.appendChild(submit);
      const status = document.createElement('p');
      status.className = 'hint rpg-runtime-action-status';
      status.setAttribute('role', 'status');
      if (alreadyConfirmed) status.textContent = '该线索已确认。';
      else if (availabilityError) status.textContent = rpgRuntimeActionUnavailableStatus(availabilityError);
      form.appendChild(status);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (alreadyConfirmed || availabilityError || sending || worldTurnPreparing || worldTurnPending) return;
        const values = [];
        const input = {};
        for (const inputDefinition of Array.isArray(runtimeAction.inputs) ? runtimeAction.inputs : []) {
          const control = [...form.querySelectorAll('[data-runtime-input]')].find(item => item.dataset.runtimeInput === inputDefinition.id);
          let value = inputDefinition.type === 'boolean' ? !!control?.checked : String(control?.value || '').trim();
          if (inputDefinition.type === 'number' && value !== '') value = Number(value);
          if (inputDefinition.type === 'json' && value) {
            try { value = JSON.parse(value); } catch { status.textContent = `请输入有效 JSON：${inputDefinition.label || inputDefinition.id}`; control?.focus(); return; }
          }
          const empty = value === '' || value === undefined || value === null;
          if (inputDefinition.required && empty) { status.textContent = `请填写：${inputDefinition.label || inputDefinition.id}`; control?.focus(); return; }
          if (!empty) { input[inputDefinition.id] = value; values.push(`${inputDefinition.label || inputDefinition.id}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`); }
        }
        const actionAvailabilityError = rpgRuntimeActionAvailabilityError(runtimeAction, runtime, input);
        if (actionAvailabilityError) { status.textContent = rpgRuntimeActionUnavailableStatus(actionAvailabilityError); return; }
        const text = `【世界卡动作:${runtimeAction.id}】${runtimeAction.label}${values.length ? `\n${values.join('；')}` : ''}`;
        submit.disabled = true;
        status.textContent = '已提交，等待 AI…';
        try {
          await submitWorldActionText(text, { throwOnError: true, kind: 'action', source: 'world-card', optionId: runtimeAction.id, actionId: runtimeAction.id, input });
        } catch (error) {
          status.textContent = error.message;
          submit.disabled = false;
        }
      });
      section.appendChild(form);
      target.appendChild(section);
      continue;
    }
    const list = document.createElement('div');
    list.className = 'rpg-list';
    const raw = sourceValues[panel.source];
    const entries = Array.isArray(raw)
      ? raw.map((value, index) => ({ key: value?.id || value?.name || String(index + 1), value }))
      : raw && typeof raw === 'object' ? Object.entries(raw).map(([key, value]) => ({ key, value })) : [];
    const configuredFields = Array.isArray(panel.fields) ? panel.fields.map(field => typeof field === 'string' ? { key: field, label: field === 'status' ? '状态' : field } : field) : [];
    const inferredFields = entries[0]?.value && typeof entries[0].value === 'object'
      ? Object.keys(entries[0].value).filter(key => !['id', 'name', 'title'].includes(key)).slice(0, 6).map(key => ({ key, label: key === 'status' ? '状态' : key }))
      : [];
    const fields = configuredFields.length ? configuredFields : inferredFields;
    const valueForField = (entry, field) => rpgUiValueText(field.key === '$key' ? entry.key : field.key === '$value' ? entry.value : readRpgUiField(entry.value, field.key), field.key);
    const entryTitle = entry => entry.value && typeof entry.value === 'object'
      ? entry.value?.name || entry.value?.label || entry.value?.title || entry.key
      : panel.valueLabel || entry.key;
    const statusEntries = entries.filter(entry => entry.value && typeof entry.value === 'object' && ['confirmed', 'unconfirmed'].includes(entry.value.status));
    if (statusEntries.length) {
      const summary = document.createElement('span');
      summary.className = 'rpg-panel-summary';
      summary.setAttribute('role', 'status');
      summary.textContent = `${statusEntries.filter(entry => entry.value.status === 'confirmed').length}/${statusEntries.length} 已确认`;
      heading.append(' · ', summary);
    }
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
        name.textContent = String(entryTitle(entry));
        row.appendChild(name);
        fields.forEach(field => {
          const cell = document.createElement('td');
          cell.innerHTML = `${esc(valueForField(entry, field))}${worldStateDeltaMarkup(worldPanelStateDeltaKey(panel.source, entry, field))}`;
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
        title.textContent = String(entryTitle(entry));
        card.appendChild(title);
        fields.forEach(field => {
          const line = document.createElement('div');
          line.className = 'rpg-item-sub';
          if (field.key === 'status') {
            line.classList.add('rpg-item-status');
            line.dataset.status = String(readRpgUiField(entry.value, field.key) || '');
          }
          line.innerHTML = `${esc(field.label || field.key)}：${esc(valueForField(entry, field))}${worldStateDeltaMarkup(worldPanelStateDeltaKey(panel.source, entry, field))}`;
          card.appendChild(line);
        });
        list.appendChild(card);
      });
    }
    section.appendChild(list);
    const entryFeedback = worldPanelEntryFeedbackMarkup(panel.source);
    if (entryFeedback) {
      const feedback = document.createElement('div');
      feedback.className = 'rpg-panel-entry-feedback';
      feedback.setAttribute('role', 'status');
      feedback.innerHTML = entryFeedback;
      section.appendChild(feedback);
    }
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
    phase: worldExtensionState.surface || 'play',
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
      ending: world.ending && typeof world.ending === 'object' ? {
        enabled: world.ending.enabled !== false,
        allowPlayerEnd: world.ending.allowPlayerEnd !== false,
        requireConfirm: world.ending.requireConfirm !== false,
        defaultEndingId: world.ending.defaultEndingId || 'player-choice',
        endings: (Array.isArray(world.ending.endings) ? world.ending.endings : []).filter(Boolean).slice(0, 32).map(item => ({ id: item.id, kind: item.kind, label: item.label, description: item.description, terminal: item.terminal === true })),
      } : null,
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
        ending: save.state?.ending || null,
        failure: save.state?.failure || null,
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
    if (worldExtensionState.surface === 'setup') {
      context.setup = {
        status: save.setup?.status || 'planning',
        draft: save.setup?.draft || { player: save.player?.snapshot || null, game: save.setup?.game || {}, plan: save.setup?.plan || null, ui: {} },
        player: save.player?.snapshot || null,
        game: save.setup?.game || {},
        plan: save.setup?.plan || null,
        canCommit: save.setup?.status === 'planning',
      };
    }
  }
  if (worldExtensionState.surface === 'setup' && save && !context.setup) {
    context.setup = {
      status: save.setup?.status || 'planning',
      draft: save.setup?.draft || { player: save.player?.snapshot || null, game: save.setup?.game || {}, plan: save.setup?.plan || null, ui: {} },
      player: save.player?.snapshot || null,
      game: save.setup?.game || {},
      plan: save.setup?.plan || null,
      canCommit: save.setup?.status === 'planning',
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
    const requestContext = () => send('context.request');
    window.TavernExtension = {
      requestContext,
      getContext: requestContext,
      // Runtime is intentionally read-only in play. State changes belong to
      // the AI turn's declared runtime patch, so a card cannot create a
      // second unsaved MVU store behind the host.
      runtime: { get: async () => (await requestContext())?.save?.state?.runtime || null },
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
      choose: (text, options = {}) => send('turn.choose', {
        text,
        actionId: options && options.actionId,
        input: options && options.input,
      }),
      endWorld: (options = {}) => send('world.end', {
        endingId: options && options.endingId,
        confirm: options && options.confirm === true,
      }),
      setup: {
        get: () => send('setup.get'),
        patch: draft => send('setup.draft.patch', { draft }),
        commit: draft => send('setup.commit', { draft }),
        cancel: () => send('setup.cancel'),
      },
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
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{width:100%;height:100%;margin:0;min-height:100%;overflow:hidden;background:transparent;color:#f2f2f7;font:14px -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;scrollbar-width:thin;scrollbar-color:rgba(119,230,213,.7) transparent}*{scrollbar-width:thin;scrollbar-color:rgba(119,230,213,.7) transparent}*::-webkit-scrollbar{width:8px;height:8px}*::-webkit-scrollbar-track{background:rgba(255,255,255,.04);border-radius:8px}*::-webkit-scrollbar-thumb{background:linear-gradient(180deg,rgba(119,230,213,.85),rgba(93,139,202,.85));border:2px solid transparent;background-clip:padding-box;border-radius:8px}*::-webkit-scrollbar-thumb:hover{background:linear-gradient(180deg,#77e6d5,#6a9de5);border:1px solid transparent;background-clip:padding-box;border-radius:8px}#tavern-extension-root{width:100%;height:100%;min-height:100%;box-sizing:border-box}#tavern-extension-root>:first-child{box-sizing:border-box;min-height:100%}button,input,textarea,select{font:inherit}button{cursor:pointer}[data-tavern-messages]{display:flex;flex-direction:column;gap:10px;min-height:0;overflow:auto;overscroll-behavior:contain}[data-tavern-messages] .tavern-message{white-space:pre-wrap;overflow-wrap:anywhere}[data-tavern-messages] .tavern-message-user{align-self:flex-end}[data-tavern-messages] .tavern-message-assistant{align-self:flex-start}[data-tavern-narrative]{overflow-wrap:anywhere}[data-tavern-narrative][hidden]{display:none!important}[data-tavern-rendered] p{margin:.45em 0;line-height:1.7}[data-tavern-rendered] p:first-child{margin-top:0}[data-tavern-rendered] p:last-child{margin-bottom:0}[data-tavern-rendered] ul,[data-tavern-rendered] ol{padding-left:1.35em}[data-tavern-rendered] blockquote{margin:.7em 0;padding:.2em .8em;border-left:3px solid rgba(119,230,213,.7);background:rgba(119,230,213,.08)}[data-tavern-rendered] pre{max-width:100%;overflow:auto;padding:.7em;border-radius:8px;background:rgba(0,0,0,.28)}[data-tavern-rendered] code{overflow-wrap:anywhere}[data-tavern-options]{display:flex;flex-wrap:wrap;gap:10px}[data-tavern-options] .tavern-option{min-height:44px;padding:10px 14px;border-radius:10px}[data-tavern-input]{display:flex;gap:10px}[data-tavern-input] input,[data-tavern-input] textarea{min-width:0;flex:1;box-sizing:border-box}${css}</style></head><body><main id="tavern-extension-root">${html}</main><script>${webview83CompatSource()}</script><script>${extensionBridgeSource(nonce)}\n${js}</script></body></html>`;
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
  setWorldSetupExtensionMode(false);
  worldExtensionState = { iframe: null, nonce: '', signature: '', ready: false, timer: null, pending: new Map(), nextRequestId: 0, surface: 'play' };
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
async function submitWorldExtensionSetupDraft(draft) {
  if (worldExtensionState.surface !== 'setup' || !worldModeActive() || !currentWorldSave) throw new Error('当前不是世界卡开局配置阶段');
  const saveId = currentWorldSave.id;
  const nonce = worldExtensionState.nonce;
  const value = draft && typeof draft === 'object' && !Array.isArray(draft) ? draft : {};
  const mergedDraft = { ...(currentWorldSave.setup?.draft || {}), ...value };
  const res = await fetch('/api/world-saves/' + encodeURIComponent(saveId) + '/setup', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ commandId: 'setup-draft-' + uid(), expectedRevision: currentWorldSave.revision, draft: mergedDraft }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(worldApiError(data, '开局草稿保存失败（HTTP ' + res.status + '）'));
  if (currentWorldSaveId !== saveId || worldExtensionState.nonce !== nonce || worldExtensionState.surface !== 'setup') throw new Error('开局配置已切换，旧草稿响应已丢弃');
  hydrateWorldSave(data);
  currentWorldSave = data;
  renderWorldList();
  postWorldExtensionContext();
  return { revision: data.revision, draft: data.setup?.draft || null };
}
async function submitWorldExtensionSetupCommit(draft) {
  if (worldExtensionState.surface !== 'setup' || !worldModeActive() || !currentWorldSave) throw new Error('当前不是世界卡开局配置阶段');
  const saveId = currentWorldSave.id;
  const nonce = worldExtensionState.nonce;
  const value = draft && typeof draft === 'object' && !Array.isArray(draft) ? draft : {};
  const res = await fetch('/api/world-saves/' + encodeURIComponent(saveId) + '/setup', {
    method: 'PUT', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ commandId: 'setup-commit-' + uid(), expectedRevision: currentWorldSave.revision, player: value.player, game: value.game || {}, plan: value.plan || null, playerPresetId: value.playerPresetId || currentWorldSave.setup?.playerPresetId || '' }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(worldApiError(data, '开局配置提交失败（HTTP ' + res.status + '）'));
  if (currentWorldSaveId !== saveId || worldExtensionState.nonce !== nonce || worldExtensionState.surface !== 'setup') throw new Error('开局配置已切换，旧提交响应已丢弃');
  hydrateWorldSave(data);
  currentWorldSave = data;
  renderWorldDetail();
  return { revision: data.revision, status: data.setup?.status || 'planning' };
}
async function submitWorldExtensionChoice(text, actionId, input, updates) {
  if (worldExtensionState.surface === 'setup') throw new Error('开局配置请使用 TavernExtension.setup API');
  if (!worldModeActive() || !currentWorldSave) throw new Error('当前没有打开的世界存档');
  const extension = currentWorldCard()?.ui?.extension || {};
  if (!worldExtensionPermissions(extension).has('read.save')) throw new Error('扩展没有 read.save 权限');
  const value = String(text || '').trim().slice(0, 4000);
  if (!value) throw new Error('扩展行动不能为空');
  await submitWorldActionText(value, { throwOnError: true, kind: actionId ? 'action' : 'option', source: 'world-card', optionId: actionId || null, actionId: actionId || null, input });
  return { revision: currentWorldSave?.revision ?? null };
}

async function submitWorldExtensionEnd(endingId, confirm = false) {
  if (worldExtensionState.surface === 'setup') throw new Error('开局配置阶段不能结束世界线');
  if (!worldModeActive() || !currentWorldSave) throw new Error('当前没有打开的世界存档');
  if (!worldExtensionPermissions(currentWorldCard()?.ui?.extension || {}).has('read.save')) throw new Error('扩展没有 read.save 权限');
  if (confirm !== true) throw new Error('结束世界线需要明确确认');
  const value = typeof endingId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(endingId) ? endingId : undefined;
  const saveId = currentWorldSave.id;
  const nonce = worldExtensionState.nonce;
  const res = await fetch('/api/world-saves/' + encodeURIComponent(saveId) + '/end', {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ commandId: uid(), expectedRevision: currentWorldSave.revision, ...(value ? { endingId: value } : {}), confirm: true }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(worldApiError(data, '结束世界线失败（HTTP ' + res.status + '）'));
  if (currentWorldSaveId !== saveId || worldExtensionState.nonce !== nonce) throw new Error('世界线已切换，结束响应已丢弃');
  hydrateWorldSave(data);
  currentWorldSave = data;
  renderRPG();
  renderMessages();
  renderWorldDetail();
  renderWorldList();
  postWorldExtensionContext();
  return { ended: true, revision: data.revision, ending: data.state?.ending || null };
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
  if (data.type === 'world.end') {
    try {
      const result = await submitWorldExtensionEnd(data.endingId, data.confirm === true);
      respondWorldExtension(event, data.requestId, true, result);
    } catch (error) {
      respondWorldExtension(event, data.requestId, false, null, error.message);
    }
    return;
  }
  const extension = currentWorldCard()?.ui?.extension || {};
  const permissions = worldExtensionPermissions(extension);
  try {
    if (data.type === 'setup.get') {
      if (worldExtensionState.surface !== 'setup') throw new Error('当前扩展没有挂载到开局配置');
      respondWorldExtension(event, data.requestId, true, worldExtensionContext().setup || null);
      return;
    }
    if (data.type === 'setup.draft.patch') {
      if (!worldExtensionPermissions(extension).has('write.setup')) throw new Error('扩展没有 write.setup 权限');
      const result = await submitWorldExtensionSetupDraft(data.draft);
      respondWorldExtension(event, data.requestId, true, result);
      return;
    }
    if (data.type === 'setup.commit') {
      if (!worldExtensionPermissions(extension).has('write.setup')) throw new Error('扩展没有 write.setup 权限');
      const result = await submitWorldExtensionSetupCommit(data.draft);
      respondWorldExtension(event, data.requestId, true, result);
      setWorldSetupExtensionMode(false);
      clearWorldExtension();
      openWorldOpeningDialog(currentWorldSave);
      return;
    }
    if (data.type === 'setup.cancel') {
      if (worldExtensionState.surface !== 'setup') throw new Error('当前扩展没有挂载到开局配置');
      respondWorldExtension(event, data.requestId, true, { cancelled: true });
      closeWorldSetupExtension();
      return;
    }
    if (data.type === 'runtime.patch' || data.type === 'mvu' || data.type === 'tool.call') {
      throw new Error('游玩态不允许扩展直接写入 runtime/MVU；请提交玩家行动，由 AI 回合产生声明式更新');
    }
    if (data.type === 'turn.choose') {
      const result = await submitWorldExtensionChoice(data.text, data.actionId, data.input, data.updates);
      respondWorldExtension(event, data.requestId, true, result);
      return;
    }
    throw new Error('扩展消息类型不受支持');
  } catch (error) {
    respondWorldExtension(event, data.requestId, false, null, error.message);
  }
}

function renderWorldExtension(surface = 'play') {
  const host = $('rpg-extension-host');
  const frame = $('rpg-extension-frame');
  if (!host || !frame || !worldModeActive()) { clearWorldExtension(); return; }
  const extension = currentWorldCard()?.ui?.extension;
  const surfaces = Array.isArray(extension?.surfaces) && extension.surfaces.length ? extension.surfaces : ['play'];
  if (!extension || extension.enabled === false || !surfaces.includes(surface) || (!extension.html && !extension.css && !extension.js && extension.mvu == null)) { clearWorldExtension(); return; }
  if (!approveWorldExtensionCode(extension)) {
    clearWorldExtension();
    setWorldCustomLayout(false);
    if (surface === 'setup') {
      openWorldPlayerEditor(currentWorldSave);
      setWorldPlayerStatus('未启用世界卡开局界面，已回退到宿主角色表单。');
      return;
    }
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
  if (iframe && worldExtensionState.signature === signature && worldExtensionState.surface === surface) {
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
  worldExtensionState = { iframe: next, nonce, signature, ready: false, timer: null, pending: new Map(), nextRequestId: 0, surface };
  setWorldSetupExtensionMode(surface === 'setup');
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
  const worldRuntime = worldModeActive();
  const legacyWorldRight = $('rpg-legacy-world-right');
  if (legacyWorldRight) legacyWorldRight.hidden = worldRuntime;
  const statusBar = $('rpg-status');
  if (statusBar) statusBar.hidden = worldRuntime;
  statusBar?.querySelectorAll(':scope > .rpg-stat').forEach(element => { element.hidden = worldRuntime; });
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
