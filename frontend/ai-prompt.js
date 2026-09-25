/* ═══════════════ Tavern · 提示词组装层 ═══════════════
 * prompt 组装、World Info 激活与分节、预设解析。
 * 由 ai-runtime.js 的 buildPromptBlocks() 入口调用，RP / RPG 两条链路共用。
 */
function lorebookEntriesForPrompt(book) {
  if (book && typeof book === 'object' && Array.isArray(book.entries)) return normalizeCharacterBookEntries(book);
  try { return normalizeImportedLorebook(book, book?.name || book?.title || '').entries; }
  catch { return []; }
}

function presetMode(name, preset) {
  if (preset && ['tavern', 'rpg', 'both'].includes(preset.mode)) return preset.mode;
  if (name === GLOBAL_PRESET_KEY) return 'both';
  return /RPG/i.test(name || '') ? 'rpg' : 'tavern';
}

function resolvePromptPreset() {
  const world = currentWorldCard();
  const worldBound = mode === 'rpg' && world?.rpgPresetName && promptPresets[world.rpgPresetName]
    && ['rpg', 'both'].includes(presetMode(world.rpgPresetName, promptPresets[world.rpgPresetName])) ? world.rpgPresetName : '';
  const name = worldBound || activePresetNameForMode(mode);
  return { name, preset: promptPresets[name] || promptPresets[GLOBAL_PRESET_KEY] || normalizePromptPreset(GLOBAL_PRESET_KEY, {}) };
}

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
function formatWorldInfoPrompt(entries, presetSettings = {}) {
  const content = (Array.isArray(entries) ? entries : []).filter(Boolean).join('\n\n');
  return applySTFormatTemplate(presetSettings.wi_format, '{0}', content);
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

function buildPromptBlocks() {
  const promptChar = null;
  const { preset: rawPreset } = resolvePromptPreset();
  const preset = normalizePromptPreset('', rawPreset);
  const presetSettings = preset.modelParameters && typeof preset.modelParameters === 'object' ? preset.modelParameters : {};
  const wiResult = buildWorldInfo({ withOutlets: true });
  // 提示词正则只作用于本次请求副本；世界书/历史原文与会话存档保持不变。
  const wi = wiResult.entries.map(entry => applyRegexStage(entry, 'world_info', { includePromptOnly: true }));
  const formatWorldInfoEntries = entries => (Array.isArray(entries) ? entries : [])
    .map(entry => applyRegexStage(entry, 'world_info', { includePromptOnly: true }));
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
      content = prompt.content || RPG_TASK_FALLBACK;
    }
    if (prompt.identifier === 'jailbreak') {
      content = prompt.content;
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
    const content = expandPresetMacros(applyRegexStage(entry.content, 'world_info', { includePromptOnly: true }), macroContext, variables);
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
  previousHistory = previousHistory.map(message => ({ ...message, _history: true }));
  // “聊天历史”只控制已完成的旧上下文；本轮玩家输入是当前请求参数，始终保留。
  const exampleHistory = [];
  if (mode === 'rpg' && defaults?.rpg?.exampleTurn) {
    const ex = defaults.rpg.exampleTurn;
    if (ex.user && ex.assistant) exampleHistory.push({ role: 'user', content: ex.user }, { role: 'assistant', content: ex.assistant });
  }
  let history = [...exampleHistory, ...(includeHistory ? previousHistory : [])];
  history = mergeHistoryInjections(history, injections);
  const orderedChat = mergeHistoryInjections([...exampleHistory, ...(includeHistory ? previousHistory : []), ...currentTurn], injections);
  // 兼容调试投影仍把本轮玩家输入保留为最后一条 user；真实请求使用下方 orderedPromptMessages。
  const promptHistory = [...beforeHistory, ...history, ...afterHistory, ...currentTurn].map((message, index, list) => ({
    role: message.role,
    content: applyRegexStage(message.content, 'prompt_history', { role: message.role, depth: Math.max(0, list.filter(item => item.role !== 'system').length - list.slice(0, index + 1).filter(item => item.role !== 'system').length) }),
  }));
  const orderedPromptMessages = [...relativeBefore, ...orderedChat, ...relativeAfter].map((message, index, list) => ({
    role: message.role,
    content: applyRegexStage(message.content, message.role === 'system' ? 'system_prompt' : 'prompt_history', { role: message.role, depth: Math.max(0, list.filter(item => item.role !== 'system').length - list.slice(0, index + 1).filter(item => item.role !== 'system').length) }),
    ...(message._example ? { _example: true } : {}),
    ...(message._history ? { _history: true } : {}),
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
