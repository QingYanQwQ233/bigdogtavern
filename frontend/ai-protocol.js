/* 应用 AI 输出的 ```rpg``` JSON 状态变更；返回本轮行动选项 */
/* RPG 任务定义兜底（仅当「RPG 叙事引擎」预设被删除时使用；正常内容在预设 JSON 里可编辑） */
const RPG_TASK_FALLBACK = '你是这个幻想世界的地下城主（DM）与世界化身，始终以“你”称呼玩家。直接呈现场景、事件与 NPC，不以作者或助手自称。根据当前状态公平裁定行动；状态变化必须先在叙事中发生，再写入回复末尾唯一一个 <tavern_state_update> JSON 更新块。更新块必须使用 protocol=tavern.rpg.turn、version=1、当前 revision；除了项目启用的玩家状态/地点/效果更新，只能提交当前世界卡 runtime schema 已声明的变量、集合或动作更新，不能猜测 ID、修改 schema 或提交完整 state。runtime.collection.patch 用 set 修改字段、delta 修改已有数字字段；options 必须遵守当前世界卡回合契约（0-4 条），具体、可执行且不重复；自由输入始终可用。';

function worldOptionRules() {
  const options = currentWorldCard()?.turnContract?.options;
  return { min: Number.isInteger(options?.min) ? options.min : 4, max: Number.isInteger(options?.max) ? options.max : 4 };
}

function normalizeRpgOptions(value, rules = worldOptionRules()) {
  const source = Array.isArray(value)
    ? value
    : (value && typeof value === 'object' && Array.isArray(value.options) ? value.options : []);
  const max = Number.isInteger(rules?.max) ? Math.max(0, rules.max) : 4;
  const seen = new Set();
  return source.map(item => {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
    return item.text ?? item.label ?? item.title ?? item.action ?? item.value ?? '';
  }).map(item => String(item || '').replace(/\s+/g, ' ').trim().slice(0, 240))
    .filter(item => item && !seen.has(item) && seen.add(item))
    .slice(0, max);
}

function previousWorldTurnOptions() {
  const rules = worldOptionRules();
  const timeline = Array.isArray(currentWorldSave?.turns) ? currentWorldSave.turns : [];
  for (let i = timeline.length - 1; i >= 0; i--) {
    const turn = timeline[i];
    if (turn?.role !== 'assistant') continue;
    const options = normalizeRpgOptions(turn.options, rules);
    if (options.length >= rules.min && options.length <= rules.max) return options;
  }
  const openingOptions = normalizeRpgOptions(currentWorldSave?.openingOptions, rules);
  return openingOptions.length >= rules.min && openingOptions.length <= rules.max ? openingOptions : [];
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
  if (worldModeActive()) {
    const allowed = new Set(['dice.roll', 'rules.check', 'state.patch', 'memory.record', 'context.retrieve', 'runtime.action.execute']);
    for (const name of Object.keys(mergedTools)) if (!allowed.has(name)) delete mergedTools[name];
    const runtimeActions = currentWorldCard()?.runtime?.actions;
    const actionTool = mergedTools['runtime.action.execute'];
    if (Array.isArray(runtimeActions) && runtimeActions.length && (!actionTool || actionTool.enabled !== false)) {
      mergedTools['runtime.action.execute'] = {
        enabled: true,
        execution: 'server',
        description: '执行当前世界卡已声明的物品、技能或其他 runtime action；需要判定的动作必须先 rules.check 再 dice.roll。',
        ...(actionTool || {}),
      };
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

/*
 * RPG Agent 请求级上下文快照。
 * ponytail: 只保存作用域与边界元数据，不复制完整 WorldCard/WorldSave；完整事实仍由各自 Prompt section 提供。
 */
function buildRpgAgentContext(profile = buildRpgAgentProfile()) {
  if (mode !== 'rpg' || !worldModeActive()) return null;
  const world = currentWorldCard() || {};
  const save = currentWorldSave;
  const recent = buildWorldRecentContext();
  const enabledTools = Object.entries(profile?.tools || {})
    .filter(([, config]) => config && config.enabled !== false)
    .map(([name]) => name)
    .filter(name => RPG_NATIVE_TOOL_NAMES.has(name));
  return {
    protocol: 'tavern.rpg.context',
    version: 1,
    scope: {
      worldId: world.id || save.worldId || currentWorldId || null,
      worldVersion: world.version ?? save.worldVersion ?? 1,
      saveId: save.id || currentWorldSaveId || null,
      revision: Number.isInteger(save.revision) ? save.revision : 0,
    },
    world: {
      title: String(world.title || world.id || '未命名世界'),
      facts: 'WorldCard@worldVersion（稳定设定、公开资料、规则）',
      locationId: save.state?.locationId || null,
      time: save.state?.time ? cloneValue(save.state.time) : null,
    },
    save: {
      setupStatus: save.setup?.status || null,
      recentWindow: {
        revision: recent.revision,
        sceneStartRevision: recent.sceneStartRevision,
        sourceLedgerIds: Array.isArray(recent.sourceLedgerIds) ? recent.sourceLedgerIds.slice(-64) : [],
      },
      facts: 'WorldSave@revision（本局动态状态、记忆、事件、关系）',
    },
    action: {
      intent: worldTurnPendingActive() ? cloneValue(worldTurnPending.actionIntent || null) : null,
      pending: worldTurnPendingActive(),
    },
    tools: {
      mode: profile?.mode || 'tool-candidate',
      maxSteps: profile?.maxSteps || 1,
      enabled: enabledTools,
      readOnly: enabledTools.filter(name => name === 'context.retrieve'),
      candidateOnly: enabledTools.filter(name => !['context.retrieve', 'dice.roll', 'rules.check'].includes(name)),
      diceSource: enabledTools.includes('dice.roll') ? 'client' : 'disabled',
    },
  };
}

/* Native OpenAI tool names are an allowlist, while their descriptions and
 * JSON Schemas remain data-driven through defaults / preset / world card. */
const RPG_NATIVE_TOOL_NAMES = new Set(['dice.roll', 'rules.check', 'state.patch', 'objective.upsert', 'entity.create', 'memory.record', 'context.retrieve', 'runtime.action.execute']);
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
      if (name === 'dice.roll') {
        parameters.type = 'object';
        parameters.properties = {
          ...(parameters.properties && typeof parameters.properties === 'object' ? parameters.properties : {}),
          expr: { type: 'string', description: 'Base dice expression declared by rules.check; never include +N/-N.' },
          modifier: {
            type: 'object',
            description: 'Copy the modifierRule returned by rules.check exactly; the runtime reads the current player field.',
            properties: {
              bucket: { type: 'string', enum: ['attributes', 'skills', 'resources'] },
              id: { type: 'string' }, factor: { type: 'number' }, bonus: { type: 'number' },
            },
            required: ['bucket', 'id'], additionalProperties: false,
          },
          modifiers: {
            type: 'array', maxItems: 8,
            description: '动态判定的多个修正来源；必须原样复制 rules.check 返回的 modifierRules。',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                source: { type: 'string', enum: ['player', 'runtime', 'constant'] },
                bucket: { type: 'string', enum: ['attributes', 'skills', 'resources'] },
                id: { type: 'string' }, collectionId: { type: 'string' }, entryId: { type: 'string' }, field: { type: 'string' },
                factor: { type: 'number' }, bonus: { type: 'number' },
              },
            },
          },
        };
        parameters.required = [...new Set([...(Array.isArray(parameters.required) ? parameters.required : []), 'expr'])];
      }
      if (name === 'rules.check') {
        parameters.type = 'object';
        parameters.properties = {
          ruleId: { type: 'string', description: '旧世界卡已声明的判定 ID；兼容旧规则。' },
          actionId: { type: 'string', description: '动态判定对应的世界动作/玩家行动标识。' },
          reason: { type: 'string', description: '为什么本次行动具有真实不确定性与后果。' },
          sides: { type: 'integer', minimum: 2, maximum: 1000, description: '动态基础骰面的数量 N，公式固定为 1dN。' },
          target: { type: 'number', description: '动态判定目标值。' },
          modifiers: {
            type: 'array', maxItems: 8,
            description: '按顺序列出属性、技能、runtime 状态或常数修正。',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                source: { type: 'string', enum: ['player', 'runtime', 'constant'] },
                bucket: { type: 'string', enum: ['attributes', 'skills', 'resources'] },
                id: { type: 'string' }, collectionId: { type: 'string' }, entryId: { type: 'string' }, field: { type: 'string' },
                factor: { type: 'number' }, bonus: { type: 'number' },
              },
            },
          },
        };
        parameters.required = [];
      }
      if (name === 'runtime.action.execute') {
        parameters.type = 'object';
        parameters.properties = {
          actionId: { type: 'string', description: '当前世界卡 runtime.actions 中已声明的动作 ID。' },
          input: { type: 'object', description: '动作 Schema 声明的输入；服务端会按当前动作定义校验。', additionalProperties: true },
        };
        parameters.required = ['actionId'];
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
const RPG_PROTOCOL_REPAIR_ATTEMPTS = 2;
const RPG_REPAIR_TOOL_NAME = 'tavern_rpg_turn_repair';
const RPG_RUNTIME_UPDATE_FORMAT_HINT = 'Runtime 更新格式：runtime.variable.set 使用 {"type":"runtime.variable.set","id":"变量 ID","value":值}；runtime.variable.delta 使用 {"type":"runtime.variable.delta","id":"变量 ID","delta":数值}；runtime.collection.add 必须使用 {"type":"runtime.collection.add","collectionId":"集合 ID","value":{"id":"stable-entry-id",…}}。新增条目的 title、text、status 等字段一律放在 value 内，不能平铺在 update 顶层；条目 ID 只能使用字母、数字、_、-，缺少稳定条目 ID 时不要提交 collection.add。';

function stripJsonFence(text) {
  return String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function buildRpgRepairToolDefinition(optionRules = worldOptionRules()) {
  const minItems = Math.max(0, Number(optionRules?.min) || 0);
  const maxItems = Math.max(minItems, Number(optionRules?.max) || minItems);
  return {
    type: 'function',
    function: {
      name: RPG_REPAIR_TOOL_NAME,
      description: 'Return the repaired Tavern RPG turn control data. Do not continue or rewrite the narrative.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          updates: {
            type: 'array', maxItems: 32,
            description: 'Typed updates already supported by the current world contract; use an empty array when nothing changed.',
            items: { type: 'object' },
          },
          options: {
            type: 'array', minItems, maxItems,
            description: 'Concrete, non-duplicated player actions. Keep options out of the narrative.',
            items: { type: 'string', minLength: 1, maxLength: 240 },
          },
          eventMemory: {
            type: 'array', maxItems: 32,
            description: 'Optional event-memory candidates from facts already present in this turn.',
            items: { type: 'object' },
          },
          createEntities: {
            type: 'array', maxItems: 16,
            description: 'Optional entity candidates already present in this turn.',
            items: { type: 'object' },
          },
        },
        required: ['updates', 'options'],
      },
    },
  };
}

/* Dedicated repair responses contain no narrative, so provider JSON/tool output can be
 * converted to the single internal tag without making the ordinary narrative parser lenient. */
function canonicalizeRpgRepairOutput(value, revision = currentWorldSave?.revision ?? 0) {
  let candidate = value;
  if (typeof candidate === 'string') {
    const text = String(candidate || '').trim();
    const tagged = parseTaggedRpgOutput(text);
    if (tagged?.payload) candidate = tagged.payload;
    else {
      const unfenced = stripJsonFence(text);
      const start = unfenced.indexOf('{');
      const end = unfenced.lastIndexOf('}');
      const json = start >= 0 && end >= start ? unfenced.slice(start, end + 1) : unfenced;
      try { candidate = JSON.parse(json); }
      catch (error) { throw new Error(`AI 协议修复 JSON 无效：${error.message}`); }
    }
  }
  if (candidate?.function?.arguments !== undefined) candidate = candidate.function.arguments;
  else if (candidate?.name === RPG_REPAIR_TOOL_NAME && candidate.arguments !== undefined) candidate = candidate.arguments;
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate); }
    catch (error) { throw new Error(`AI 协议修复参数无效：${error.message}`); }
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('AI 协议修复必须返回 JSON 对象');
  const numericRevision = Number(revision);
  const payload = {
    protocol: 'tavern.rpg.turn',
    version: 1,
    baseRevision: Number.isInteger(numericRevision) && numericRevision >= 0 ? numericRevision : 0,
  };
  for (const key of ['updates', 'options', 'eventMemory', 'createEntities']) {
    if (Object.prototype.hasOwnProperty.call(candidate, key)) payload[key] = candidate[key];
  }
  return `${RPG_UPDATE_OPEN}${JSON.stringify(payload)}${RPG_UPDATE_CLOSE}`;
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
  // Markdown/模型有时会在隐藏标签前加反斜杠（例如 `\<tavern_options>`）。
  // 反斜杠只是转义，不应让协议检测失效。
  return /\\?<tavern_options\b/i.test(String(text || ''));
}

function builtInTavernReplyOptionsInstruction() {
  const configured = String(defaults?.tavern?.replyOptions?.instruction || '').trim();
  if (configured) return configured;
  const preset = defaults?.presets?.['RP 基础（示例）'];
  const explicit = String(preset?.replyOptions?.instruction || '').trim();
  if (explicit) return explicit;
  // 兼容尚未升级的 seed：旧版把协议塞在 postHistory 尾部。
  return String(preset?.postHistory || '').match(/【AI 回复选项协议】[\s\S]*$/)?.[0] || '';
}

/* Tavern 模式的选项协议：隐藏标签只负责把 AI 建议传给快捷栏，不进入正文。 */
function parseTavernReplyOutput(reply, preset = null) {
  const text = String(reply || '');
  // 兼容模型为避免 Markdown 解析而输出的 `\<...>` / `\</...>`。
  // 标签仍只作为控制块处理，绝不把转义符泄露到正文。
  const open = /\\?<tavern_options\b[^>]*>/i.exec(text);
  if (!open) return { content: text.trim(), options: null, found: false, complete: true, errorCode: null };
  const closeRe = /\\?<\/tavern_options\s*>/ig;
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
      content: text.replace(/\\?<tavern_options\b[^>]*>[\s\S]*?(?:\\?<\/tavern_options\s*>|$)/gi, '').trim(),
      options: null, found: true, complete: true, errorCode: 'options.invalid_json', errorMessage: error.message,
    };
  }
  const options = normalizeTavernReplyOptions(parsed, preset);
  // 即使模型重复输出协议标签，也全部从可见正文移除，避免把内部 JSON 泄露到聊天栏。
  const visibleContent = text.replace(/\\?<tavern_options\b[^>]*>[\s\S]*?(?:\\?<\/tavern_options\s*>|$)/gi, '').trim();
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
    options: (() => {
      const options = normalizeRpgOptions(update?.options);
      return options.length ? options : null;
    })(),
    createEntities: update?.createEntities || null,
    eventMemory: update?.eventMemory || null,
    agentCalls: parsed.payload?.toolCalls ?? null,
    patch,
    protocol: parsed,
  };
}

/* 协议修复只应补齐机器标签，不能用修复请求的重写正文替换已展示内容。 */
function mergeRepairedReply(originalReply, repairedReply, targetMode = mode) {
  const original = String(originalReply || '').trim();
  const repaired = String(repairedReply || '').trim();
  if (!original || !repaired) return repaired || original;
  if (targetMode !== 'rpg') {
    const visible = String(parseTavernReplyOutput(original, resolvePromptPreset()?.preset || null).content || original).trim();
    const tag = repaired.match(/\\?<tavern_options\b[^>]*>[\s\S]*?\\?<\/tavern_options\s*>/i)?.[0];
    return tag ? `${visible}\n${tag}`.trim() : visible;
  }
  const visible = String(parseRpgOutput(original).narrative || original).trim();
  const tag = repaired.match(/<tavern_state_update\b[^>]*>[\s\S]*?<\/tavern_state_update\s*>/i)?.[0]
    || repaired.match(/```rpg[\s\S]*?```/i)?.[0];
  return tag ? `${visible}\n${tag}`.trim() : visible;
}

/* 协议修复只替换坏字段；本回合已经通过校验的 options / patch 不再交给模型重写。 */
function preserveValidRpgRepairFields(original, repaired, optionRules = worldOptionRules(), revision = currentWorldSave?.revision ?? 0) {
  const options = normalizeRpgOptions(original?.options, optionRules);
  if (options.length >= optionRules.min && options.length <= optionRules.max) repaired.options = options;
  const patch = original?.patch;
  if (patch
    && patch.protocol === 'tavern.rpg.turn'
    && Number(patch.version) === 1
    && Number(patch.baseRevision) === Number(revision)
    && !validateRpgPatchShape(patch)
    && !validateRpgPatchRuntimeActions(patch)) repaired.patch = patch;
  if (!repaired.createEntities && original?.createEntities) repaired.createEntities = original.createEntities;
  if (!repaired.eventMemory && original?.eventMemory) repaired.eventMemory = original.eventMemory;
  return repaired;
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

const RPG_RUNTIME_UPDATE_ALIASES = new Set([
  'variable.set', 'variable.delta', 'collection.add', 'collection.remove', 'collection.patch',
]);

function normalizeRpgPatch(patch, options = patch?.options) {
  if (!patch || !Array.isArray(patch.updates)) return patch;
  return {
    ...patch,
    ...(options === undefined ? {} : { options: normalizeRpgOptions(options) }),
    updates: patch.updates.filter(update => !(worldModeActive() && RPG_WORLD_DISABLED_UPDATE_TYPES.has(update?.type))).map(update => {
      if (RPG_RUNTIME_UPDATE_ALIASES.has(update?.type)) {
        const type = `runtime.${update.type}`;
        if (!update.type.startsWith('variable.')) return { ...update, type };
        const { variableId, ...rest } = update;
        return { ...rest, type, id: update.id ?? variableId };
      }
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
  'runtime.collection.patch': ['type', 'collectionId', 'entryId', 'set', 'delta'],
  'runtime.action.execute': ['type', 'actionId', 'input'],
});
const RPG_WORLD_DISABLED_UPDATE_TYPES = new Set([
  'currency.delta', 'inventory.delta', 'objective.status', 'objective.upsert',
]);

/* 提交前拦截最常见的“格式漂移”，避免等服务端拒绝后才让玩家重试。 */
function validateRpgPatchShape(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return 'patch 必须是对象';
  const allowedPatchKeys = ['protocol', 'version', 'baseRevision', 'updates', 'options', 'createEntities', 'eventMemory'];
  const extraPatchKey = Object.keys(patch).find(key => !allowedPatchKeys.includes(key));
  if (extraPatchKey) return `patch 含有未声明字段 ${extraPatchKey}`;
  if (!Array.isArray(patch.updates)) return 'patch.updates 必须是数组';
  for (const update of patch.updates) {
    if (update?.type === 'runtime.collection.add') {
      if (!update.value || typeof update.value !== 'object' || Array.isArray(update.value)) return `patch.runtime.collection.add 必须把新增条目放进 value 对象；${RPG_RUNTIME_UPDATE_FORMAT_HINT}`;
      if (update.value.id === undefined || update.value.id === null || !String(update.value.id).trim()) return `patch.runtime.collection.add.value.id 必填；${RPG_RUNTIME_UPDATE_FORMAT_HINT}`;
    }
    const allowedKeys = RPG_PATCH_UPDATE_KEYS[update?.type];
    if (!allowedKeys) return 'patch.updates 含有不受支持的操作';
    const extraKey = Object.keys(update).find(key => !allowedKeys.includes(key));
    if (extraKey) return `patch.${update.type} 含有未声明字段 ${extraKey}`;
  }
  return null;
}

function validateRpgPatchRuntimeActions(patch, world = currentWorldCard()) {
  if (!worldModeActive() || !Array.isArray(patch?.updates)) return null;
  const actionIds = new Set((Array.isArray(world?.runtime?.actions) ? world.runtime.actions : []).map(action => String(action?.id || '')));
  const unknown = patch.updates.find(update => update?.type === 'runtime.action.execute' && !actionIds.has(String(update.actionId || '').trim()));
  return unknown ? `patch.runtime.action.execute 未声明动作 ${String(unknown.actionId || '').trim() || '（空）'}` : null;
}

/*
 * 卡内按钮或唯一精确匹配的自由输入已经把 actionId 作为玩家的明确意图提交给宿主。模型仍可能把
 * 旧版 item.delta 等草稿塞进标签；这类草稿既不能执行，也不应阻断已声明
 * 的卡动作。保留叙事、选项和顶层元数据，状态效果交由服务端按 actionId
 * 的 availability / check / effects 重新结算。
 */
function recoverExplicitWorldActionPatch(patch, actionIntent, revision = currentWorldSave?.revision) {
  if (!patch || !isExplicitWorldRuntimeActionIntent(actionIntent)) return null;
  if (!Number.isSafeInteger(revision) || revision < 0) return null;
  const actionId = String(actionIntent.actionId).trim();
  const declared = (Array.isArray(currentWorldCard()?.runtime?.actions) ? currentWorldCard().runtime.actions : [])
    .some(action => String(action?.id || '').trim() === actionId);
  if (!declared) return null;
  const normalized = normalizeRpgPatch(patch);
  const rootContractValid = normalized
    && typeof normalized === 'object'
    && !Array.isArray(normalized)
    && normalized.protocol === 'tavern.rpg.turn'
    && Number(normalized.version) === 1
    && Number(normalized.baseRevision) === Number(revision)
    && Array.isArray(normalized.updates)
    && !Object.keys(normalized).some(key => !['protocol', 'version', 'baseRevision', 'updates', 'options', 'createEntities', 'eventMemory'].includes(key));
  if (!rootContractValid) return null;
  const shapeError = validateRpgPatchShape(normalized) || validateRpgPatchRuntimeActions(normalized);
  if (!shapeError) return null;
  return {
    patch: { protocol: 'tavern.rpg.turn', version: 1, baseRevision: revision, updates: [] },
    reason: shapeError,
  };
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
  if (!worldModeActive() && typeof upd.gold === 'number' && !(hasDeclaredGold && currencyUpdates && Object.prototype.hasOwnProperty.call(currencyUpdates, 'gold'))) {
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
  if (!worldModeActive() && worldModeActive() && economy && currencyUpdates) {
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
  if (!worldModeActive() && Array.isArray(upd.inventory)) {
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
  if (!worldModeActive() && worldModeActive() && economy && upd.equipment && typeof upd.equipment === 'object' && !Array.isArray(upd.equipment)) {
    const slotIds = new Set((Array.isArray(economy.equipment?.slots) ? economy.equipment.slots : []).map(slot => slot.id));
    if (!rs.equipment || typeof rs.equipment !== 'object') rs.equipment = {};
    const inventoryIds = new Set(rs.inventory.filter(item => item?.itemId).map(item => String(item.itemId)));
    for (const [slotId, itemId] of Object.entries(upd.equipment)) {
      if (!slotIds.has(slotId) || itemId !== null && (typeof itemId !== 'string' || !inventoryIds.has(itemId))) continue;
      rs.equipment[slotId] = itemId;
    }
  }
  if (!worldModeActive() && worldModeActive() && Array.isArray(upd.conflicts)) {
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
  if (!worldModeActive() && worldModeActive() && Array.isArray(upd.growth)) {
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
  if (!worldModeActive() && Array.isArray(upd.quests)) {
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
  const normalizedOptions = normalizeRpgOptions(upd.options);
  const options = normalizedOptions.length ? normalizedOptions : null;
  const createEntities = Array.isArray(upd.createEntities) ? cloneValue(upd.createEntities) : null;
  const eventMemory = worldModeActive() && Array.isArray(upd.eventMemory) ? cloneValue(upd.eventMemory) : null;
  commitRpgState(rs);
  renderRPG();
  return { options, createEntities, eventMemory };
}
