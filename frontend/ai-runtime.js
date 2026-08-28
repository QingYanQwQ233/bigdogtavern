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
  const rpgContext = mode === 'rpg' ? buildRpgAgentContext(agentProfile) : null;
  // 唯一 system 消息：身份 + 角色卡 + 模块 + 格式 + 世界设定 + 后预设 合并为一条，
  // 避免多条 system 穿插在 user/assistant 之间导致模型混淆 role 边界（DeepSeek/本地模型尤其敏感）
  const sysParts = [];
  if (system && system.trim()) sysParts.push(system);
  if (!worldInfoInSystem && wi && wi.length) {
    sysParts.push('【世界设定】\n' + wi.map(entry => applyRegexStage(entry, 'system_prompt')).join('\n\n'));
  }
  if (post && post.trim()) sysParts.push('【后预设 / Post-History】\n' + post);
  body.messages = [];
  if (sysParts.length) body.messages.push({ role: 'system', content: sysParts.join('\n\n') });
  body.messages.push(...history);
  const nativeTools = mode === 'rpg' ? buildRpgNativeToolDefinitions(agentProfile) : [];
  if (nativeTools.length && agentProfile?.mode === 'native') {
    body.tools = nativeTools;
    body.tool_choice = 'auto';
  }
  return { baseUrl: s.baseUrl, apiKey: s.apiKey, body, wi, promptSections: rpgSections || [], agentProfile, rpgContext, nativeTools };
}

async function callAPI(payload) {
  const resp = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    signal: activeRequestController?.signal,
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

function summarizeTavernTurnText(turns) {
  return turns.map((turn, index) => {
    const parts = turn.messages.map(message => {
      const role = message.role === 'user' ? '玩家' : '角色';
      // ponytail: 每条消息最多取 900 字，避免一次总结请求被单条长文本撑爆；需要更高上限时再改为按 token 预算切分。
      return `${role}：${String(message.content || '').replace(/<tavern_options>[\s\S]*?<\/tavern_options>/gi, '').trim().slice(0, 900)}`;
    });
    return `第${index + 1}轮\n${parts.join('\n')}`;
  }).join('\n\n');
}

async function requestTavernMemorySummary(turns, config) {
  if (!settings.baseUrl) throw new Error('未配置 API，自动记忆将在下一轮重试');
  const payload = {
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    body: {
      model: settings.model || 'default',
      messages: [
        {
          role: 'system',
          content: `你是 RP 对话记忆压缩器。将输入的完整对话压缩成约 ${config.summaryChars} 个中文字符的事实摘要。保留人物关系、关键事件、地点、承诺、未完成目标和重要状态；不要补写未发生的内容。只输出摘要正文，不要标题、解释、JSON、Markdown 代码块或 tavern_options 标签。`,
        },
        { role: 'user', content: summarizeTavernTurnText(turns) },
      ],
      temperature: Math.min(0.4, Number(settings.temperature) || 0.4),
      max_tokens: Math.max(96, Math.min(256, Math.ceil(config.summaryChars * 2.5))),
      top_p: settings.topP,
      frequency_penalty: settings.frequencyPenalty,
      presence_penalty: settings.presencePenalty,
      stream: false,
    },
  };
  const data = await callAPI(payload);
  const content = data?.choices?.[0]?.message?.content;
  if (!content || data?.choices?.[0]?.finish_reason === 'length') throw new Error('摘要输出被截断或为空');
  const text = String(content)
    .replace(/^```[\s\S]*?\n|```$/g, '')
    .replace(/^摘要[:：]\s*/i, '')
    .replace(/<tavern_options>[\s\S]*?<\/tavern_options>/gi, '')
    .trim();
  if (!text) throw new Error('摘要输出为空');
  return Array.from(text).slice(0, config.summaryChars).join('');
}

async function maybeRollTavernMemory(session = curSession(), { force = false } = {}) {
  if (mode !== 'tavern' || !session || session !== curSession()) return;
  const config = tavernAutoMemoryConfig();
  if ((!force && !config.enabled) || tavernMemoryPending.has(session.id)) {
    renderTavernAutoMemoryStatus();
    return;
  }
  const changed = ensureTavernMessageIds(session);
  ensureTavernSessionMemory(session);
  if (changed) saveSessions(session);
  const turns = getTavernUnsummarizedTurns(session);
  if (!turns.length) {
    if (force) tavernMemoryStatus.set(session.id, '暂无可总结的完整对话');
    renderTavernAutoMemoryStatus();
    return;
  }
  if (!force && turns.length < config.windowTurns) {
    renderTavernAutoMemoryStatus();
    return;
  }
  const sourceTurns = turns.slice(0, Math.min(config.summarizeTurns, turns.length));
  const sourceMessageIds = sourceTurns.flatMap(turn => turn.messages.map(message => message.id));
  const requestSessionId = session.id;
  tavernMemoryPending.add(requestSessionId);
  tavernMemoryStatus.set(requestSessionId, '正在生成摘要…');
  renderTavernAutoMemoryStatus();
  try {
    const text = await requestTavernMemorySummary(sourceTurns, config);
    const target = sessions.find(item => item.id === requestSessionId && item.kind === 'tavern');
    if (!target) return;
    const memory = ensureTavernSessionMemory(target);
    memory.summaries.push({ id: uid(), text, sourceMessageIds, createdAt: Date.now() });
    tavernMemoryStatus.delete(requestSessionId);
    saveSessions(target);
  } catch (error) {
    tavernMemoryStatus.set(requestSessionId, `总结失败，将重试：${error.message}`);
    console.warn('[Tavern] 自动记忆总结失败:', error.message);
  } finally {
    tavernMemoryPending.delete(requestSessionId);
    renderTavernAutoMemoryStatus();
    if (curSession()?.id === requestSessionId) renderMessages();
  }
}

async function manualRollTavernMemory() {
  const button = $('mem-auto-run');
  if (button?.disabled) return;
  const label = button?.textContent || '立即总结';
  if (button) { button.disabled = true; button.textContent = '总结中…'; }
  try {
    await maybeRollTavernMemory(curSession(), { force: true });
  } finally {
    if (button) { button.disabled = false; button.textContent = label; }
  }
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
  gate.checkProposal = gate.checkProposal || null;
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
  if (Array.isArray(calls) && calls.some(call => {
    if (call?.name !== 'rules.check' || profile?.tools?.['rules.check']?.enabled === false) return false;
    const args = call.arguments || {};
    return declaredRules.has(String(args.ruleId || '').trim())
      || (String(args.actionId || '').trim() && Number.isInteger(Number(args.sides)) && Number(args.sides) >= 2 && Number.isFinite(Number(args.target)));
  })) gate.checkApproved = true;
  for (const call of Array.isArray(calls) ? calls : []) {
    const config = profile?.tools?.[call.name];
    if (!RPG_NATIVE_TOOL_NAMES.has(call.name) || !config || config.enabled === false) {
      trace.push({ callId: call.callId, name: call.name, phase: rpgAgentToolPhase(call.name), arguments: call.arguments ? cloneValue(call.arguments) : null, result: { ok: false, error: '工具未在当前 RPG 配置中启用' } });
      continue;
    }
    if (call.error || !call.arguments) {
      trace.push({ callId: call.callId, name: call.name, phase: rpgAgentToolPhase(call.name), arguments: call.arguments ? cloneValue(call.arguments) : null, result: { ok: false, error: call.error || '参数无效' } });
      continue;
    }
    let result;
    try {
      if (call.name === 'dice.roll') {
        const expr = String(call.arguments.expr || '').trim();
        if (!expr || expr.length > 80) throw new Error('expr 为空或过长');
        if (!gate.checkApproved) {
          result = { ok: false, error: '必须先调用 rules.check；没有真实判定时禁止掷骰' };
        } else if (!gate.checkProposal) {
          result = { ok: false, error: '必须先收到 rules.check 的判定方案，再调用 dice.roll' };
        } else if (gate.diceUses >= 4) {
          result = { ok: false, error: '本次判定最多允许 4 次骰子调用' };
        } else {
          const proposal = gate.checkProposal;
          const expectedRoll = normalizeRpgBaseDiceExpression(proposal.roll);
          const actualRoll = normalizeRpgBaseDiceExpression(expr);
          if (!actualRoll || rpgDiceHasInlineModifier(expr)) {
            result = { ok: false, error: `dice.roll.expr 只能使用基础骰式（例如 ${expectedRoll || '1d20'}），不要把属性修正写进 expr` };
          } else if (expectedRoll && actualRoll !== expectedRoll) {
            result = { ok: false, error: `本次判定必须使用世界卡声明的基础骰式 ${expectedRoll}` };
          } else if (Array.isArray(proposal.modifierRules) && rpgModifierRulesKey(call.arguments.modifiers) !== rpgModifierRulesKey(proposal.modifierRules)) {
            result = { ok: false, error: `请在 dice.roll.modifiers 中原样传入 ${JSON.stringify(proposal.modifierRules)}；程序会读取当前存档数值计算修正` };
          } else if (proposal.modifierRule && rpgModifierRuleKey(call.arguments.modifier) !== rpgModifierRuleKey(proposal.modifierRule)) {
            result = { ok: false, error: `请在 dice.roll.modifier 中原样传入 ${JSON.stringify(proposal.modifierRule)}；程序会读取当前存档数值计算修正` };
          } else if (!proposal.modifierRules && !proposal.modifierRule && (call.arguments.modifier !== undefined || call.arguments.modifiers !== undefined)) {
            result = { ok: false, error: '当前判定没有声明 modifiers，不能自行添加属性/技能修正' };
          } else {
            const checkFeedback = showRpgCheckAnimation(expr, gate.anchorOffset, gate.checkpoints);
            // 先让浏览器绘制一次短判定动画，再把客户端随机结果交回模型。
            if (checkFeedback) await new Promise(resolve => setTimeout(resolve, 320));
            const rolls = await rollWorldDice(expr);
            if (!rolls.length) throw new Error('expr 不是受支持的骰子表达式');
            const resolution = buildRpgCheckResolution(proposal, rolls[0], snapshot);
            result = {
              ok: true,
              rolls,
              ...(proposal.modifierRule ? { modifierRule: cloneValue(proposal.modifierRule), modifier: proposal.modifier } : {}),
              ...(Array.isArray(proposal.modifierRules) ? { modifierRules: cloneValue(proposal.modifierRules), modifier: rpgDynamicModifierTotal(proposal.modifierRules, snapshot) } : {}),
              ...(resolution ? { resolution } : {}),
            };
            updateRpgCheckAnimation(checkFeedback, rolls[0], resolution);
            finishRpgCheckAnimation(checkFeedback);
            if (resolution) gate.checkProposal = null;
            gate.diceUses += 1;
          }
        }
      } else if (call.name === 'context.retrieve') {
        result = { ok: true, ...retrieveRpgAgentContext(call.arguments.query, call.arguments.scope, call.arguments.limit, snapshot) };
      } else if (call.name === 'rules.check') {
        const ruleId = String(call.arguments.ruleId || '').trim();
        const dynamicActionId = String(call.arguments.actionId || '').trim();
        const dynamic = !ruleId && !!dynamicActionId;
        if (!dynamic && (!ruleId || ruleId.length > 120)) throw new Error('ruleId 为空或过长');
        if (dynamic && (dynamicActionId.length > 120 || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(dynamicActionId))) throw new Error('actionId 为空或格式无效');
        if (!dynamic && (!world || !declaredRules.has(ruleId))) throw new Error('ruleId 未在当前世界规则或进行中的冲突中声明');
        gate.checkApproved = true;
        const definition = dynamic ? null : findRpgCheckDefinition(world, ruleId);
        const proposal = { id: dynamic ? `dynamic:${dynamicActionId}` : ruleId };
        if (dynamic) {
          const sides = Number(call.arguments.sides);
          const target = Number(call.arguments.target);
          if (!Number.isInteger(sides) || sides < 2 || sides > 1000) throw new Error('动态判定 sides 必须是 2-1000 的整数');
          if (!Number.isFinite(target) || target < -1000000 || target > 1000000) throw new Error('动态判定 target 无效');
          const rawModifiers = call.arguments.modifiers === undefined ? [] : call.arguments.modifiers;
          if (!Array.isArray(rawModifiers) || rawModifiers.length > 8) throw new Error('动态判定 modifiers 必须是最多 8 项的数组');
          const modifierRules = normalizeRpgDynamicModifiers(rawModifiers);
          if (modifierRules.length !== rawModifiers.length) throw new Error('动态判定包含无效修正来源');
          const runtimeAction = (Array.isArray(world?.runtime?.actions) ? world.runtime.actions : []).find(action => action?.id === dynamicActionId);
          if (runtimeAction?.check) {
            const declaredCheck = runtimeAction.check;
            const declaredModifiers = normalizeRpgDynamicModifiers(declaredCheck.modifiers || []);
            if (sides !== Number(declaredCheck.sides) || target !== Number(declaredCheck.target)) throw new Error(`动作 ${dynamicActionId} 必须使用世界卡声明的判定配置`);
            if (rpgModifierRulesKey(modifierRules) !== rpgModifierRulesKey(declaredModifiers)) throw new Error(`动作 ${dynamicActionId} 必须使用世界卡声明的 modifiers`);
          }
          proposal.dynamic = true;
          proposal.actionId = dynamicActionId;
          proposal.label = String(call.arguments.reason || dynamicActionId).slice(0, 200);
          proposal.roll = `1d${sides}`;
          proposal.target = target;
          proposal.modifierRules = modifierRules;
          proposal.modifier = rpgDynamicModifierTotal(modifierRules, snapshot);
        } else if (definition) {
          if (definition.label) proposal.label = String(definition.label).slice(0, 200);
          if (definition.description) proposal.description = String(definition.description).slice(0, 1000);
          if (definition.roll) proposal.roll = String(definition.roll).slice(0, 80);
          if (Number.isFinite(Number(definition.target))) proposal.target = Number(definition.target);
          if (Number.isFinite(Number(definition.modifier))) proposal.modifier = Number(definition.modifier);
          else if (definition.modifier && typeof definition.modifier === 'object' && !Array.isArray(definition.modifier)) {
            const modifierSource = definition.modifier;
            const modifier = {
              ...(modifierSource.bucket ? { bucket: String(modifierSource.bucket).slice(0, 80) } : {}),
              ...(modifierSource.id ? { id: String(modifierSource.id).slice(0, 120) } : {}),
              ...(Number.isFinite(Number(modifierSource.factor)) ? { factor: Number(modifierSource.factor) } : {}),
              ...(Number.isFinite(Number(modifierSource.bonus)) ? { bonus: Number(modifierSource.bonus) } : {}),
            };
            proposal.modifierRule = modifier;
            proposal.modifier = rpgCheckModifierValue(modifier, snapshot?.save?.state?.player);
          }
          if (definition.source) proposal.source = String(definition.source).slice(0, 120);
        }
        gate.checkProposal = proposal;
        const modifierInstruction = Array.isArray(proposal.modifierRules)
          ? `；dice.roll 必须使用基础骰式 ${proposal.roll}，并在 modifiers 中原样传入 ${JSON.stringify(proposal.modifierRules)}，程序会从当前存档计算总修正 ${proposal.modifier}`
          : proposal.modifierRule
            ? `；dice.roll 必须使用基础骰式 ${proposal.roll || '世界卡骰式'}，并在 modifier 中原样传入 ${JSON.stringify(proposal.modifierRule)}，程序会从当前玩家状态计算实际修正 ${proposal.modifier}`
            : `；dice.roll 只使用基础骰式 ${proposal.roll || '世界卡骰式'}，不要自行添加 +N 修正`;
        result = { ok: true, kind: 'rules.check', ruleId: dynamic ? null : ruleId, proposal, requiresRoll: true, instruction: `仅本次行动允许掷骰；${modifierInstruction}；请根据结果在叙事中分支并说明后果。` };
      } else if (call.name === 'runtime.action.execute') {
        const actionId = String(call.arguments.actionId || '').trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(actionId)) throw new Error('actionId 为空或格式无效');
        const action = (Array.isArray(world?.runtime?.actions) ? world.runtime.actions : []).find(item => item?.id === actionId);
        if (!action) throw new Error(`动作 ${actionId} 未在当前世界卡 runtime.actions 中声明`);
        const input = call.arguments.input === undefined ? {} : call.arguments.input;
        if (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(input).length > 4000) throw new Error('runtime.action.execute input 无效');
        const availabilityError = rpgRuntimeActionAvailabilityError(action, snapshot?.save?.state?.runtime, input);
        result = availabilityError
          ? { ok: false, error: availabilityError }
          : { ok: true, accepted: 'candidate', name: call.name, arguments: { actionId, input: cloneValue(input) } };
      } else if (call.name === 'state.patch') {
        const updates = call.arguments.updates;
        if (!Array.isArray(updates)) throw new Error('state.patch.updates 必须是数组');
        result = updates.some(update => update?.type === 'runtime.action.execute')
          ? { ok: false, error: 'state.patch 不得包含 runtime.action.execute；执行世界卡动作必须调用 runtime.action.execute。若世界卡未声明对应动作，请改用已声明的 runtime.collection.patch 或 runtime.variable.* 更新，不能编造 actionId。' }
          : { ok: true, accepted: 'candidate', name: call.name, arguments: call.arguments };
      } else {
        // Typed patch / entity / memory remain candidates until final narrative
        // submit, so native tools cannot mutate state during the model loop.
        result = { ok: true, accepted: 'candidate', name: call.name, arguments: call.arguments };
      }
      if (result?.ok) accepted.push({ callId: call.callId, name: call.name, arguments: call.arguments });
    } catch (error) {
      result = { ok: false, error: error.message };
    }
    trace.push({ callId: call.callId, name: call.name, phase: rpgAgentToolPhase(call.name), arguments: call.arguments ? cloneValue(call.arguments) : null, result });
  }
  if (targetScope && trace.length) setDebugTrace(targetScope, { agentToolTrace: trace });
  return { trace, accepted };
}

function rpgAgentToolPhase(name) {
  if (name === 'context.retrieve') return 'observe';
  if (name === 'rules.check' || name === 'dice.roll') return 'guard';
  if (['state.patch', 'objective.upsert', 'entity.create', 'memory.record', 'runtime.action.execute'].includes(name)) return 'commit';
  return 'decide';
}

function rpgAgentFinalStepInstruction() {
  const rules = worldOptionRules();
  return `【tavern.rpg.agent.final】工具阶段已经结束。不得再次调用工具，也不得重复掷骰。现在只提交本回合最终答案：先写连续 Markdown 叙事，再在末尾输出唯一 <tavern_state_update> JSON；删除 toolCalls；options 必须是 ${rules.min}-${rules.max} 个非空、不重复的纯字符串，并且只放在 JSON 中。沿用已返回的真实工具结果，不要重写已经完成的前文。`;
}

function normalizeRpgAgentCommitTrace(trace) {
  const phases = ['observe', 'decide', 'guard', 'commit'];
  const used = new Set();
  return (Array.isArray(trace) ? trace : [])
    .filter(item => item?.name && RPG_NATIVE_TOOL_NAMES.has(item.name))
    .slice(0, 16)
    .map((item, index) => {
      let callId = String(item.callId || '');
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(callId) || used.has(callId)) callId = `agent-${index + 1}-${uid().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24)}`;
      used.add(callId);
      const phase = phases.includes(item.phase) ? item.phase : rpgAgentToolPhase(item.name);
      return {
        callId,
        name: item.name,
        phase,
        ...(item.arguments && typeof item.arguments === 'object' && !Array.isArray(item.arguments) ? { arguments: cloneValue(item.arguments) } : {}),
        result: item.result && typeof item.result === 'object' && !Array.isArray(item.result) ? cloneValue(item.result) : { ok: false, error: '工具未返回结构化结果' },
        step: Math.max(1, Math.min(8, Math.trunc(Number(item.step) || 1))),
        mode: item.mode === 'compat' ? 'compat' : 'native',
      };
    })
    .sort((a, b) => phases.indexOf(a.phase) - phases.indexOf(b.phase) || a.step - b.step);
}

function rpgAgentCallsFromTrace(trace) {
  return (Array.isArray(trace) ? trace : [])
    .filter(item => item.name !== 'context.retrieve' && item.result?.ok === true)
    .map(item => ({ callId: item.callId, name: item.name, arguments: cloneValue(item.arguments || {}) }));
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
  const objectiveCalls = worldModeActive() ? [] : list.filter(call => call?.name === 'objective.upsert' && call.arguments?.kind && call.arguments?.id && call.arguments?.title);
  const actionCalls = list.filter(call => call?.name === 'runtime.action.execute' && call.arguments?.actionId);
  const actionUpdates = actionCalls.map(call => ({
    type: 'runtime.action.execute',
    actionId: String(call.arguments.actionId),
    ...(call.arguments.input !== undefined ? { input: cloneValue(call.arguments.input) } : {}),
  }));
  const seenActions = new Set();
  const uniqueActionUpdates = actionUpdates.filter(update => {
    const key = JSON.stringify([update.actionId, update.input || {}]);
    if (seenActions.has(key)) return false;
    seenActions.add(key);
    return true;
  });
  const patch = patchCalls.length || objectiveCalls.length ? normalizeRpgPatch({
    protocol: 'tavern.rpg.turn',
    version: 1,
    baseRevision,
    updates: [
      ...patchCalls.flatMap(call => call.arguments.updates),
      ...objectiveCalls.map(call => ({ type: 'objective.upsert', ...cloneValue(call.arguments) })),
      ...uniqueActionUpdates,
    ].slice(0, 32),
  }) : (uniqueActionUpdates.length ? normalizeRpgPatch({
    protocol: 'tavern.rpg.turn',
    version: 1,
    baseRevision,
    updates: uniqueActionUpdates.slice(0, 32),
  }) : null);
  const createEntities = list.filter(call => !worldModeActive() && call?.name === 'entity.create' && call.arguments?.name)
    .map(call => {
      const kind = ['npc', 'item', 'quest', 'location'].includes(call.arguments.type) ? call.arguments.type : 'npc';
      return { ...cloneValue(call.arguments), kind, tempId: call.arguments.tempId || call.callId };
    }).slice(0, 32);
  const eventMemory = list.filter(call => call?.name === 'memory.record' && call.arguments?.summary)
    .map(call => cloneValue(call.arguments)).slice(0, 8);
  return { patch, createEntities: createEntities.length ? createEntities : null, eventMemory: eventMemory.length ? eventMemory : null };
}

function findRpgCheckDefinition(world, ruleId) {
  const wanted = String(ruleId || '').trim();
  if (!wanted || !world) return null;
  const pools = [world.rules?.checks, world.checks];
  for (const pool of pools) {
    if (Array.isArray(pool)) {
      for (const item of pool) {
        if (typeof item === 'string' && item === wanted) return { id: wanted };
        if (item && typeof item === 'object' && String(item.id || item.ruleId || '') === wanted) return cloneValue(item);
      }
    } else if (pool && typeof pool === 'object' && !Array.isArray(pool)) {
      const item = pool[wanted];
      if (item && typeof item === 'object' && !Array.isArray(item)) return { id: wanted, ...cloneValue(item) };
    }
  }
  for (const conflict of Array.isArray(world.conflicts) ? world.conflicts : []) {
    for (const action of Array.isArray(conflict?.actions) ? conflict.actions : []) {
      const check = action?.check;
      if (!check || typeof check !== 'object') continue;
      if (action.id === wanted) return { id: wanted, label: action.label || action.id, description: action.description || '', ...cloneValue(check), source: `conflict:${conflict.id}` };
      if (`${conflict.id}.${action.id}` === wanted) return { id: wanted, label: action.label || action.id, description: action.description || '', ...cloneValue(check), source: `conflict:${conflict.id}` };
    }
  }
  return null;
}

function rpgCheckModifierValue(rule, playerState = currentWorldSave?.state?.player) {
  if (!rule || typeof rule !== 'object') return 0;
  const player = playerState || {};
  const raw = Number(player?.[rule.bucket]?.[rule.id]);
  const factor = Number.isFinite(Number(rule.factor)) ? Number(rule.factor) : 1;
  const bonus = Number.isFinite(Number(rule.bonus)) ? Number(rule.bonus) : 0;
  return (Number.isFinite(raw) ? raw : 0) * factor + bonus;
}

function rpgReadPathValue(value, path) {
  return String(path || '').split('.').filter(Boolean).reduce((current, key) => current == null ? undefined : current[key], value);
}

function normalizeRpgDynamicModifier(rule) {
  if (Number.isFinite(Number(rule))) return { source: 'constant', bonus: Number(rule) };
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return null;
  const source = rule.source || (rule.bucket ? 'player' : rule.collectionId ? 'runtime' : 'constant');
  const normalized = { source: String(source) };
  if (source === 'player') {
    if (!['attributes', 'skills', 'resources'].includes(rule.bucket) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(String(rule.id || ''))) return null;
    normalized.bucket = String(rule.bucket); normalized.id = String(rule.id);
  } else if (source === 'runtime') {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(String(rule.collectionId || ''))
      || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(String(rule.entryId || ''))
      || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(String(rule.field || ''))) return null;
    normalized.collectionId = String(rule.collectionId); normalized.entryId = String(rule.entryId); normalized.field = String(rule.field);
  } else if (source !== 'constant') return null;
  const factor = rule.factor === undefined ? null : Number(rule.factor);
  const bonus = rule.bonus === undefined ? null : Number(rule.bonus);
  if (factor !== null && (!Number.isFinite(factor) || factor < -100 || factor > 100)) return null;
  if (bonus !== null && (!Number.isFinite(bonus) || bonus < -100 || bonus > 100)) return null;
  if (factor !== null) normalized.factor = factor;
  if (bonus !== null) normalized.bonus = bonus;
  return normalized;
}

function normalizeRpgDynamicModifiers(value) {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return list.slice(0, 8).map(normalizeRpgDynamicModifier).filter(Boolean);
}

function rpgResolveDynamicModifierValue(rule, snapshot = null) {
  const normalized = normalizeRpgDynamicModifier(rule);
  if (!normalized) return 0;
  let raw = 0;
  if (normalized.source === 'player') {
    raw = Number(snapshot?.save?.state?.player?.[normalized.bucket]?.[normalized.id] ?? currentWorldSave?.state?.player?.[normalized.bucket]?.[normalized.id]);
  } else if (normalized.source === 'runtime') {
    const entries = snapshot?.save?.state?.runtime?.collections?.[normalized.collectionId] || currentWorldSave?.state?.runtime?.collections?.[normalized.collectionId] || [];
    const entry = Array.isArray(entries) ? entries.find(item => String(item?.id || '') === normalized.entryId) : null;
    raw = Number(rpgReadPathValue(entry, normalized.field));
  }
  const factor = Number.isFinite(Number(normalized.factor)) ? Number(normalized.factor) : 1;
  const bonus = Number.isFinite(Number(normalized.bonus)) ? Number(normalized.bonus) : 0;
  return (Number.isFinite(raw) ? raw : 0) * factor + bonus;
}

function rpgDynamicModifierTotal(rules, snapshot = null) {
  return normalizeRpgDynamicModifiers(rules).reduce((sum, rule) => sum + rpgResolveDynamicModifierValue(rule, snapshot), 0);
}

function normalizeRpgBaseDiceExpression(expression) {
  const match = String(expression || '').trim().match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  return match ? `${Number(match[1] || 1)}d${Number(match[2])}` : null;
}

function rpgDiceHasInlineModifier(expression) {
  return !!String(expression || '').trim().match(/^(\d*)d(\d+)([+-]\d+)$/i);
}

function rpgModifierRuleKey(rule) {
  const normalized = normalizeRpgDynamicModifier(rule);
  return normalized ? JSON.stringify(normalized) : null;
}

function rpgModifierRulesKey(rules) {
  const normalized = normalizeRpgDynamicModifiers(rules);
  return JSON.stringify(normalized);
}

function buildRpgCheckResolution(proposal, roll, snapshot = null) {
  const target = Number(proposal?.target);
  const modifier = Array.isArray(proposal?.modifierRules) ? rpgDynamicModifierTotal(proposal.modifierRules, snapshot) : Number(proposal?.modifier);
  const diceTotal = Number(roll?.total);
  if (!proposal?.id || !Number.isFinite(target) || !Number.isFinite(modifier) || !Number.isFinite(diceTotal)) return null;
  const total = diceTotal + modifier;
  const margin = total - target;
  const grade = margin >= 10 ? 'critical-success'
    : margin >= 5 ? 'success'
      : margin >= 0 ? 'success-with-cost'
        : margin >= -4 ? 'partial-success'
          : margin >= -9 ? 'failure' : 'critical-failure';
  const labels = {
    'critical-success': '大成功',
    success: '成功',
    'success-with-cost': '有代价的成功',
    'partial-success': '部分成功',
    failure: '失败',
    'critical-failure': '严重失败',
  };
  return {
    ruleId: String(proposal.id),
    roll: String(roll.expr || proposal.roll || ''),
    diceTotal,
    modifier,
    ...(proposal.modifierRule ? { modifierRule: cloneValue(proposal.modifierRule) } : {}),
    ...(Array.isArray(proposal.modifierRules) ? { modifierRules: cloneValue(proposal.modifierRules) } : {}),
    total,
    target,
    margin,
    grade,
    label: labels[grade],
  };
}

async function requestRpgAgentReply(payload, targetScope) {
  const profile = payload.agentProfile;
  const nativeTools = Array.isArray(payload.nativeTools) ? payload.nativeTools : [];
  const session = createRpgAgentSession(payload, targetScope);
  if (profile && profile.mode !== 'native' && nativeTools.length) {
    return requestRpgCompatReply(payload, targetScope, session);
  }
  if (!profile || profile.mode !== 'native' || !nativeTools.length) {
    if (payload.body.stream) {
      appendRpgAgentEvent(session, 'step.request', { step: 1, messageCount: session.messages.length });
      const stream = await callAPIStream(payload);
      session.cot = stream.cot || '';
      appendRpgAgentPreview(session, stream.content);
      session.status = 'complete';
      appendRpgAgentEvent(session, 'turn.complete', { contentChars: String(stream.content || '').length });
      syncRpgAgentDebug(session, targetScope, 'Agent 已完成');
      return { reply: stream.content, cot: stream.cot, nativeCalls: stream.toolCalls || [], toolTrace: [], session };
    }
    appendRpgAgentEvent(session, 'step.request', { step: 1, messageCount: session.messages.length });
    const data = await callAPI(payload);
    const message = data?.choices?.[0]?.message || {};
    session.cot = message.reasoning_content || '';
    appendRpgAgentPreview(session, message.content || '');
    session.status = 'complete';
    appendRpgAgentEvent(session, 'turn.complete', { contentChars: String(message.content || '').length });
    syncRpgAgentDebug(session, targetScope, 'Agent 已完成');
    return { reply: message.content || '', cot: session.cot, nativeCalls: normalizeNativeToolCalls(message).map(parseNativeToolArguments), toolTrace: [], session };
  }
  const messages = session.messages;
  const snapshot = worldModeActive() && currentWorldSave
    ? { world: cloneValue(currentWorldCard()), save: cloneValue(currentWorldSave) }
    : null;
  const maxSteps = session.maxSteps;
  const accepted = session.accepted;
  const toolTrace = session.toolTrace;
  const diceGate = { checkpoints: session.checkpoints };
  for (let step = 0; step <= maxSteps; step++) {
    const finalOnly = step === maxSteps;
    session.step = step + 1;
    session.phase = finalOnly ? 'commit' : 'observe';
    const requestMessages = finalOnly ? [...messages, { role: 'user', content: rpgAgentFinalStepInstruction() }] : messages;
    appendRpgAgentEvent(session, 'step.request', { step: step + 1, messageCount: requestMessages.length, finalOnly });
    const request = { ...payload, body: { ...payload.body, messages: requestMessages } };
    if (finalOnly) {
      delete request.body.tools;
      delete request.body.tool_choice;
    }
    if (step > 0) beginDebugRequest(targetScope, request, { label: finalOnly ? 'Agent 最终步骤' : `Agent 步骤 ${step + 1}` });
    let response;
    if (request.body.stream) {
      const stream = await callAPIStream(request, { render: false });
      response = { content: stream.content, cot: stream.cot, calls: stream.toolCalls || [] };
    } else {
      const data = await callAPI(request);
      const message = data?.choices?.[0]?.message || {};
      response = { content: message.content || '', cot: message.reasoning_content || '', calls: normalizeNativeToolCalls(message).map(parseNativeToolArguments), rawMessage: message };
    }
    session.cot += `${session.cot && response.cot ? '\n\n' : ''}${response.cot || ''}`;
    const previousPreview = session.previewNarrative;
    publishRpgAgentStep(session, response, targetScope, finalOnly ? 'Agent 最终步骤已完成' : 'Agent 步骤已完成');
    if (finalOnly) {
      if (response.calls.length) appendRpgAgentEvent(session, 'protocol.violation', { reason: '最终步骤仍请求工具', calls: response.calls.map(call => call.name) });
      session.status = 'complete';
      appendRpgAgentEvent(session, 'turn.complete', { contentChars: String(response.content || '').length, forcedFinal: true });
      syncRpgAgentDebug(session, targetScope, 'Agent 已完成');
      return { reply: combineRpgAgentReply({ previewNarrative: previousPreview }, response.content), cot: session.cot, nativeCalls: accepted, toolTrace, session };
    }
    if (!response.calls.length) {
      session.status = 'complete';
      appendRpgAgentEvent(session, 'turn.complete', { contentChars: String(response.content || '').length });
      syncRpgAgentDebug(session, targetScope, 'Agent 已完成');
      return { reply: combineRpgAgentReply({ previewNarrative: previousPreview }, response.content), cot: session.cot, nativeCalls: accepted, toolTrace, session };
    }
    const rawCalls = response.calls.map(call => call.rawCall || { id: call.callId, type: 'function', function: { name: call.name, arguments: call.rawArguments } });
    messages.push({ role: 'assistant', content: rpgAgentNarrative(response.content).slice(-2000) || null, tool_calls: rawCalls });
    session.phase = 'decide';
    response.calls.forEach(call => appendRpgAgentEvent(session, 'tool.call', { callId: call.callId, name: call.name }));
    diceGate.anchorOffset = session.previewNarrative.length;
    const executed = await executeRpgNativeToolCalls(response.calls, profile, targetScope, snapshot, diceGate);
    accepted.push(...executed.accepted);
    toolTrace.push(...executed.trace.map(item => ({ ...item, step: step + 1 })));
    for (const item of executed.trace) {
      messages.push({ role: 'tool', tool_call_id: item.callId, content: JSON.stringify(item.result) });
      appendRpgAgentEvent(session, 'tool.result', { callId: item.callId, name: item.name, ok: item.result?.ok === true });
    }
  }
  throw new Error('Agent 回合异常结束');
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
async function requestRpgCompatReply(payload, targetScope, session = createRpgAgentSession(payload, targetScope)) {
  const profile = payload.agentProfile;
  const messages = session.messages;
  const snapshot = worldModeActive() && currentWorldSave
    ? { world: cloneValue(currentWorldCard()), save: cloneValue(currentWorldSave) }
    : null;
  const maxSteps = session.maxSteps;
  const accepted = session.accepted;
  const toolTrace = session.toolTrace;
  const diceGate = { checkpoints: session.checkpoints };
  for (let step = 0; step <= maxSteps; step++) {
    const finalOnly = step === maxSteps;
    session.step = step + 1;
    session.phase = finalOnly ? 'commit' : 'observe';
    const requestMessages = finalOnly ? [...messages, { role: 'user', content: rpgAgentFinalStepInstruction() }] : messages;
    appendRpgAgentEvent(session, 'step.request', { step: step + 1, messageCount: requestMessages.length, finalOnly });
    const request = { ...payload, body: { ...payload.body, messages: requestMessages } };
    delete request.body.tools;
    delete request.body.tool_choice;
    if (step > 0) beginDebugRequest(targetScope, request, { label: finalOnly ? '兼容 Agent 最终步骤' : `兼容 Agent 步骤 ${step + 1}` });
    let response;
    if (request.body.stream) {
      const stream = await callAPIStream(request, { render: false });
      response = { content: stream.content, cot: stream.cot, calls: normalizeCompatToolCalls(processAIOutput(stream.content).agentCalls, step) };
    } else {
      const data = await callAPI(request);
      const message = data?.choices?.[0]?.message || {};
      const content = message.content || '';
      response = { content, cot: message.reasoning_content || '', calls: normalizeCompatToolCalls(processAIOutput(content).agentCalls, step) };
    }
    session.cot += `${session.cot && response.cot ? '\n\n' : ''}${response.cot || ''}`;
    const previousPreview = session.previewNarrative;
    publishRpgAgentStep(session, response, targetScope, finalOnly ? '兼容 Agent 最终步骤已完成' : '兼容 Agent 步骤已完成');
    if (finalOnly) {
      if (response.calls.length) appendRpgAgentEvent(session, 'protocol.violation', { reason: '最终步骤仍请求工具', calls: response.calls.map(call => call.name) });
      session.status = 'complete';
      appendRpgAgentEvent(session, 'turn.complete', { contentChars: String(response.content || '').length, forcedFinal: true });
      syncRpgAgentDebug(session, targetScope, '兼容 Agent 已完成');
      return { reply: combineRpgAgentReply({ previewNarrative: previousPreview }, response.content), cot: session.cot, nativeCalls: accepted, toolTrace, session };
    }
    if (!response.calls.length) {
      session.status = 'complete';
      appendRpgAgentEvent(session, 'turn.complete', { contentChars: String(response.content || '').length });
      syncRpgAgentDebug(session, targetScope, 'Agent 已完成');
      return { reply: combineRpgAgentReply({ previewNarrative: previousPreview }, response.content), cot: session.cot, nativeCalls: accepted, toolTrace, session };
    }
    session.phase = 'decide';
    response.calls.forEach(call => appendRpgAgentEvent(session, 'tool.call', { callId: call.callId, name: call.name }));
    diceGate.anchorOffset = session.previewNarrative.length;
    const executed = await executeRpgNativeToolCalls(response.calls, profile, targetScope, snapshot, diceGate);
    accepted.push(...executed.accepted);
    toolTrace.push(...executed.trace.map(item => ({ ...item, step: step + 1, mode: 'compat' })));
    messages.push({ role: 'assistant', content: rpgAgentNarrative(response.content).slice(-2000) });
    messages.push({ role: 'user', content: buildCompatToolResultMessage(executed.trace, step + 1) });
    executed.trace.forEach(item => appendRpgAgentEvent(session, 'tool.result', { callId: item.callId, name: item.name, ok: item.result?.ok === true }));
  }
  throw new Error('兼容 Agent 回合异常结束');
}

/*
 * 模型已经完成叙事、但末尾控制块不合规时，只做有限次数“协议修复”。
 * 专用请求只整理草稿中的控制数据，不在前端臆造 options，也不把修复结果
 * 直接写入存档；最终仍走同一套服务端 Typed Patch 校验。
 */
async function repairRpgOutput(payload, reply, optionRules, targetScope, toolTrace = [], validationError = '') {
  const draft = String(reply || '').slice(-10000);
  const successfulTools = (Array.isArray(toolTrace) ? toolTrace : [])
    .filter(item => item?.result?.ok === true)
    .slice(-8)
    .map(item => ({ callId: item.callId, name: item.name, result: item.result }));
  const body = {
    ...payload.body,
    stream: false,
    temperature: 0.1,
    max_tokens: Math.min(2048, Math.max(512, Number(payload.body?.max_tokens) || 2048)),
    messages: [
      { role: 'system', content: '你是 Tavern RPG 协议修复器。只整理已有控制数据，不续写故事、不推演新事实、不执行工具。若收到结构化函数，必须用它返回；否则只输出一个 JSON 对象，不要解释或输出代码围栏。' },
      { role: 'user', content: `修复以下本回合草稿的控制数据。只返回 updates、options、可选 eventMemory/createEntities；protocol、version、baseRevision 由客户端从当前存档注入。options=${optionRules.min}-${optionRules.max} 个非空、不重复的纯字符串，不得含 toolCalls。每个 update 只用协议字段；runtime.action.execute 只允许 type、actionId、可选 input。${RPG_RUNTIME_UPDATE_FORMAT_HINT} JSON 示例：${JSON.stringify({ updates: [], options: Array.from({ length: Math.max(0, Number(optionRules.min) || 0) }, (_, index) => `行动 ${index + 1}`) })}。校验错误：${validationError || '结构不完整'}。已成功工具结果（只可引用，不可重做）：${JSON.stringify(successfulTools)}。草稿：\n${draft}` },
    ],
  };
  body.tools = [buildRpgRepairToolDefinition(optionRules)];
  body.tool_choice = { type: 'function', function: { name: RPG_REPAIR_TOOL_NAME } };
  // 修复请求只需要短而完整的协议，不要让 reasoning_content 抢占末尾 JSON 的输出预算。
  const deepSeekV4 = /^https:\/\/api\.deepseek\.com(?:\/|$)/i.test(String(payload.baseUrl || ''))
    && /^deepseek-v4-(?:flash|pro)$/i.test(String(body.model || ''));
  // DeepSeek V4 默认开启 thinking，而 thinking 模式拒绝强制 tool_choice；这里必须显式关闭，删除字段反而会重新启用默认值。
  if (deepSeekV4) body.thinking = { type: 'disabled' };
  else delete body.thinking;
  delete body.reasoning_effort;
  delete body.stop;
  delete body.response_format;
  const canonicalizeResponse = data => {
    const message = data?.choices?.[0]?.message || {};
    const repairCall = normalizeNativeToolCalls(message).map(parseNativeToolArguments)
      .find(call => call.name === RPG_REPAIR_TOOL_NAME && call.arguments && !call.error);
    return canonicalizeRpgRepairOutput(repairCall?.arguments ?? message.content, currentWorldSave?.revision ?? 0);
  };
  let repaired;
  try {
    const structuredRequest = { ...payload, body };
    beginDebugRequest(targetScope, structuredRequest, { label: 'RPG 协议修复' });
    repaired = canonicalizeResponse(await callAPI(structuredRequest));
  } catch (structuredError) {
    // 强制工具调用被拒绝或返回不可解析内容时，才退回专用 JSON；结果仍须本地 canonicalize。
    setDebugTrace(targetScope, {
      status: 'RPG 协议修复工具调用失败，正在 JSON 回退',
      error: String(structuredError?.message || '强制工具调用失败'),
    });
    delete body.tools;
    delete body.tool_choice;
    if (deepSeekV4) body.response_format = { type: 'json_object' };
    const fallbackRequest = { ...payload, body };
    beginDebugRequest(targetScope, fallbackRequest, { label: 'RPG 协议修复（JSON 回退）' });
    repaired = canonicalizeResponse(await callAPI(fallbackRequest));
  }
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
  const repairRequest = { ...payload, body };
  beginDebugRequest(targetScope, repairRequest, { label: 'RP 选项修复' });
  const data = await callAPI(repairRequest);
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

async function callAPIStream(payload, { previewPrefix = '', render = true } = {}) {
  const resp = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    signal: activeRequestController?.signal,
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
        if (render) updateTypingContent(previewPrefix ? `${previewPrefix}\n\n${content}` : content);
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
function renderTypingContentFrame() {
  if (typeof document?.getElementById !== 'function') return;
  const t = $('typing-msg');
  if (!t) {
    if (mode === 'rpg' && responsePreview?.targetKey === activeConversationKey() && rpgCheckAnimation?.checkpoints) {
      responsePreview.checkpoints = serializeRpgCheckpoints(rpgCheckAnimation.checkpoints);
      renderMessages();
    }
    return;
  }
  const preview = mode === 'rpg' ? parseRpgOutput(typingText).narrative : typingText;
  const target = t.querySelector(mode === 'rpg' ? '.rpg-prose' : '.bubble');
  if (!target) return;
  const rendered = mode === 'rpg'
    ? renderRpgNarrativeWithCheckpoints(stripRpgNarrativeOptions(preview), rpgCheckAnimation?.checkpoints, { streaming: true })
    : renderBubble(applyOutputRegex(preview));
  target.innerHTML = rendered.html;
  target.classList.toggle('md', rendered.md);
  const chat = $('chat');
  if (chat) chat.scrollTop = chat.scrollHeight;
}
function updateTypingContent(text) {
  typingText = text;
  if (typingRaf) return;
  typingRaf = requestAnimationFrame(() => {
    typingRaf = 0;
    renderTypingContentFrame();
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
