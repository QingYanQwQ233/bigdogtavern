'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const storage = new Map();
const context = vm.createContext({
  console,
  localStorage: {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  },
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  window: {}, document: {}, Date, Math, JSON, Set, Map,
});

const source = fs.readFileSync('public/app.js', 'utf8').replace(/\ninit\(\);\s*$/, '');
const indexHtml = fs.readFileSync('public/index.html', 'utf8');
const defaultData = JSON.parse(fs.readFileSync('public/data/_defaults.json', 'utf8'));
assert.strictEqual(defaultData.rpg.agent.protocol, 'tavern.rpg.agent');
assert.strictEqual(defaultData.rpg.agent.tools['state.patch'].execution, 'server');
assert.doesNotMatch(indexHtml, /id="pg-post-history"/);
assert.match(indexHtml, /id="pg-reply-options-enabled"/);
assert.match(indexHtml, /id="pg-reply-options-count"/);
assert.match(indexHtml, /id="pg-reply-options-prompt"/);
assert.match(indexHtml, /id="pg-st-settings"/);
assert.match(indexHtml, /id="pg-format-world-info"/);
assert.match(indexHtml, /id="pg-param-temperature"/);
assert.match(indexHtml, /id="pg-param-top-k"/);
assert.match(indexHtml, /id="pg-param-stop"/);
assert.match(indexHtml, /id="pg-squash-system"/);
assert.doesNotMatch(indexHtml, /id="f-preset"|id="f-custom"/);
assert.doesNotMatch(indexHtml, /摸摸头|观察四周|试探对方|保持戒备/);
assert.ok(!Object.prototype.hasOwnProperty.call(defaultData, 'format'));
assert.ok(!Object.prototype.hasOwnProperty.call(defaultData.prefs, 'formatPreset'));
assert.ok(!Object.prototype.hasOwnProperty.call(defaultData.prefs, 'formatCustom'));
assert.ok(!Object.prototype.hasOwnProperty.call(defaultData.settings, 'systemPrompt'));
assert.ok(!Object.prototype.hasOwnProperty.call(defaultData.settings, 'postHistory'));
const bundledTavernPreset = defaultData.presets['RP 基础（示例）'];
assert.strictEqual(bundledTavernPreset.version, 3);
assert.ok(Array.isArray(bundledTavernPreset.prompts));
assert.ok(Array.isArray(bundledTavernPreset.promptOrder));
assert.doesNotMatch(bundledTavernPreset.prompts.find(prompt => prompt.identifier === 'jailbreak').content, /<tavern_options>/);
assert.match(defaultData.presets['RP 基础（示例）'].replyOptions.instruction, /<tavern_options>/);
assert.match(defaultData.presets['RP 基础（示例）'].replyOptions.instruction, /\{count\}/);
assert.doesNotMatch(defaultData.presets['RP 基础（示例）'].replyOptions.instruction, /观察对方的表情|转身离开房间/);
assert.ok(!bundledTavernPreset.prompts.some(prompt => prompt.identifier === 'protocol'));
vm.runInContext(source, context);
vm.runInContext(`
  defaults = { gen: {}, rpg: {}, tavern: { replyOptions: { enabled: true, min: 4, max: 4, count: 4, instruction: 'OPT {count} <tavern_options>JSON_ARRAY</tavern_options>' } } };
  prefs = { currentPreset: '旧预设', currentPresetByMode: { tavern: '旧预设', rpg: 'RPG 预设' } };
  settings = { ...DEFAULT_SETTINGS, baseUrl: 'http://example.test', history: 20 };
  userData = { currentPreset: 'default', presets: { default: { name: '旅人', persona: '谨慎' } }, memories: [{ content: '记得旧约', enabled: true }] };
  lorebooks = { default: { entries: [{ id: 'lore', content: '月港终年有雾。', constant: true, enabled: true, order: 1 }] } };
  prefs.activeLoreId = 'default';
  characters = [{ id: 'c', name: '夏瑾', race: '狐族', role: '向导', persona: '敏锐', scenario: '月港', presetName: '' }];
  currentCharId = 'c'; mode = 'tavern'; currentSessionId = 's';
  sessions = [{ id: 's', charId: 'c', kind: 'tavern', messages: [{ role: 'user', content: '出发吧' }] }];
  promptPresets = {
    '旧预设': { systemPrompt: '你是 {{char}} 的叙事者。', postHistory: '{{getvar::tone}}', modules: [
      { id: 'vars', name: '变量', enabled: true, content: '{{setvar::tone::保持轻快}}' },
      { id: 'rule', name: '规则', enabled: true, content: '与 {{user}} 合作。' },
    ] },
    'RPG 预设': { systemPrompt: '你是 DM。', modules: [] },
  };
  ensurePromptPresetsV3();
  const tavernPreset = promptPresets['旧预设'];
  const afterHistory = { identifier: 'after', name: '尾部提问', role: 'user', content: '只推进一步。', marker: false, position: 'relative', depth: 4, order: 100 };
  tavernPreset.prompts.push(afterHistory);
  const historyIndex = tavernPreset.promptOrder.findIndex(x => x.identifier === 'chatHistory');
  tavernPreset.promptOrder.splice(historyIndex + 1, 0, { identifier: 'after', enabled: true });
  globalThis.check = {
    escaped: esc('\" onmouseover=\"x'),
    migratedVersion: tavernPreset.version,
    activeTavern: activePresetNameForMode('tavern'),
    activeRpg: activePresetNameForMode('rpg'),
    blocks: buildPromptBlocks(),
    embeddedOptionBlocks: (() => {
      const jailbreak = promptPresets['旧预设'].prompts.find(prompt => prompt.identifier === 'jailbreak');
      const previous = jailbreak.content;
      jailbreak.content = previous + '<tavern_options>["内置一"]</tavern_options>';
      const result = buildPromptBlocks();
      jailbreak.content = previous;
      return result;
    })(),
    tavernOptions: parseTavernReplyOutput('正文。<tavern_options>["A","B","A","C","D","E"]</tavern_options>', promptPresets['旧预设']),
    tavernOptionsEscaped: parseTavernReplyOutput('正文。\\<tavern_options>["A","B","C","D"]\\</tavern_options>', promptPresets['旧预设']),
    tavernOptionsDuplicate: parseTavernReplyOutput('正文。<tavern_options>["A"]</tavern_options>尾部<tavern_options>["B"]</tavern_options>', promptPresets['旧预设']),
    tavernOptionsMalformed: parseTavernReplyOutput('正文。<tavern_options>{oops}</tavern_options>', promptPresets['旧预设']),
    tavernNeedsRepair: tavernReplyOptionsInvalid(parseTavernReplyOutput('正文。', promptPresets['旧预设']), promptPresets['旧预设']),
    tavernDoesNotNeedRepair: tavernReplyOptionsInvalid(parseTavernReplyOutput('正文。<tavern_options>["A","B","C","D"]</tavern_options>', promptPresets['旧预设']), promptPresets['旧预设']),
    customReplyOptions: (() => {
      const custom = normalizePromptPreset('自定义选项', { mode: 'tavern', replyOptions: { enabled: true, count: 2, instruction: 'CUSTOM {count}/{min}/{max}' } });
      return { config: tavernReplyOptionsConfig(custom), rules: tavernReplyOptionRules(custom), prompt: buildTavernReplyOptionsPrompt(custom) };
    })(),
    disabledReplyOptions: (() => {
      const disabled = normalizePromptPreset('关闭选项', { mode: 'tavern', replyOptions: { enabled: false } });
      return {
        prompt: buildTavernReplyOptionsPrompt(disabled),
        parsed: parseTavernReplyOutput('正文。<tavern_options>["A","B"]</tavern_options>', disabled),
        repair: tavernReplyOptionsInvalid(parseTavernReplyOutput('正文。', disabled), disabled),
      };
    })(),
    migratedReplyOptions: normalizePromptPreset('旧协议预设', {
      mode: 'tavern',
      postHistory: '保留后置。\\n\\n【AI 回复选项协议】输出 <tavern_options>["A","B","C","D"]</tavern_options>。',
    }),
    legacyFormatRemoved: normalizePromptPreset('旧 v2', {
      version: 2,
      mode: 'tavern',
      prompts: [
        { identifier: 'main', name: 'Main', role: 'system', content: 'MAIN', marker: true },
        { identifier: 'tavernFormat', name: '格式指令', role: 'system', content: '', marker: true },
        { identifier: 'chatHistory', name: 'History', marker: true },
      ],
      promptOrder: [
        { identifier: 'main', enabled: true },
        { identifier: 'tavernFormat', enabled: true },
        { identifier: 'chatHistory', enabled: true },
      ],
    }),
    postHistorySwitch: (() => {
      const previousPreset = prefs.currentPresetByMode.tavern;
      const testPreset = normalizePromptPreset('可关闭后历史', {
        mode: 'tavern', postHistory: 'POST_ONLY', replyOptions: { enabled: false }, modules: [],
      });
      promptPresets['可关闭后历史'] = testPreset;
      prefs.currentPresetByMode.tavern = '可关闭后历史';
      const order = testPreset.promptOrder.find(item => item.identifier === 'jailbreak');
      order.enabled = false;
      const disabled = JSON.stringify(buildPromptBlocks().promptMessages);
      order.enabled = true;
      const enabledMessages = buildPromptBlocks().promptMessages;
      const originalOrder = testPreset.promptOrder.map(item => ({ ...item }));
      const jailbreakIndex = testPreset.promptOrder.findIndex(item => item.identifier === 'jailbreak');
      const [jailbreakOrder] = testPreset.promptOrder.splice(jailbreakIndex, 1);
      const chatIndex = testPreset.promptOrder.findIndex(item => item.identifier === 'chatHistory');
      testPreset.promptOrder.splice(chatIndex, 0, jailbreakOrder);
      const movedMessages = buildPromptBlocks().promptMessages;
      testPreset.promptOrder = originalOrder;
      delete promptPresets['可关闭后历史'];
      prefs.currentPresetByMode.tavern = previousPreset;
      return { disabled, enabledMessages, movedMessages };
    })(),
    worldInfoSwitch: (() => {
      const target = tavernPreset.promptOrder.find(item => item.identifier === 'worldInfoAfter');
      const previous = target.enabled;
      target.enabled = false;
      const disabled = JSON.stringify(buildPromptBlocks().promptMessages);
      target.enabled = true;
      const enabled = JSON.stringify(buildPromptBlocks().promptMessages);
      target.enabled = previous;
      return { disabled, enabled };
    })(),
    worldInfoPositions: (() => {
      const previousBook = lorebooks.default;
      const previousExample = characters[0].mesExample;
      const previousParameters = tavernPreset.modelParameters;
      lorebooks.default = { entries: [
        { id: 'before', content: 'WI_BEFORE', constant: true, enabled: true, position: 0, order: 40 },
        { id: 'after', content: 'WI_AFTER', constant: true, enabled: true, position: 1, order: 30 },
        { id: 'depth', content: 'WI_AT_DEPTH', constant: true, enabled: true, position: 4, depth: 0, role: 'user', order: 20 },
        { id: 'example-top', content: 'WI_EXAMPLE_TOP', constant: true, enabled: true, position: 5, order: 10 },
        { id: 'example-bottom', content: 'WI_EXAMPLE_BOTTOM', constant: true, enabled: true, position: 6, order: 0 },
      ] };
      characters[0].mesExample = '<START>\\n{{user}}: EXAMPLE_BODY\\n{{char}}: EXAMPLE_REPLY';
      tavernPreset.modelParameters = { ...(previousParameters || {}), new_example_chat_prompt: 'EXAMPLE_SEPARATOR' };
      const result = buildPromptBlocks().promptMessages;
      lorebooks.default = previousBook;
      characters[0].mesExample = previousExample;
      if (previousParameters) tavernPreset.modelParameters = previousParameters;
      else delete tavernPreset.modelParameters;
      return result;
    })(),
    characterPromptOverrides: (() => {
      const previousPreset = prefs.currentPresetByMode.tavern;
      const previousMain = characters[0].systemPrompt;
      const previousPost = characters[0].postHistory;
      promptPresets['角色覆盖'] = normalizePromptPreset('角色覆盖', {
        mode: 'tavern', systemPrompt: 'BASE_MAIN', postHistory: 'BASE_POST', replyOptions: { enabled: false },
      });
      prefs.currentPresetByMode.tavern = '角色覆盖';
      characters[0].systemPrompt = 'CARD_MAIN + {{original}}';
      characters[0].postHistory = 'CARD_POST + {{original}}';
      const result = buildPromptBlocks().promptMessages;
      delete promptPresets['角色覆盖'];
      prefs.currentPresetByMode.tavern = previousPreset;
      characters[0].systemPrompt = previousMain;
      characters[0].postHistory = previousPost;
      return result;
    })(),
    legacyGlobalSettingsMigration: (() => {
      const previousSettings = settings;
      const previousGlobal = promptPresets[GLOBAL_PRESET_KEY];
      settings = { ...settings, systemPrompt: 'GLOBAL_MAIN', postHistory: 'GLOBAL_POST' };
      promptPresets[GLOBAL_PRESET_KEY] = normalizePromptPreset(GLOBAL_PRESET_KEY, {});
      const changed = migrateLegacyGlobalPromptSettings();
      const migrated = promptPresets[GLOBAL_PRESET_KEY];
      const result = {
        changed,
        main: migrated.prompts.find(prompt => prompt.identifier === 'main').content,
        post: migrated.prompts.find(prompt => prompt.identifier === 'jailbreak').content,
        hasMainField: Object.prototype.hasOwnProperty.call(settings, 'systemPrompt'),
        hasPostField: Object.prototype.hasOwnProperty.call(settings, 'postHistory'),
      };
      settings = previousSettings;
      if (previousGlobal) promptPresets[GLOBAL_PRESET_KEY] = previousGlobal;
      else delete promptPresets[GLOBAL_PRESET_KEY];
      return result;
    })(),
    legacyFormatPreferenceMigration: (() => {
      const previousPrefs = prefs;
      const previousPresets = promptPresets;
      prefs = { ...prefs, formatPreset: 'dialogue', formatCustom: 'USER_FORMAT' };
      promptPresets = { '迁移格式': normalizePromptPreset('迁移格式', { mode: 'tavern' }) };
      const changed = migrateLegacyFormatPreferences();
      const migrated = promptPresets['迁移格式'];
      const prompt = migrated.prompts.find(item => item.identifier === 'legacy-format-migrated');
      const result = {
        changed,
        content: prompt?.content,
        enabled: migrated.promptOrder.find(item => item.identifier === 'legacy-format-migrated')?.enabled,
        hasPresetField: Object.prototype.hasOwnProperty.call(prefs, 'formatPreset'),
        hasCustomField: Object.prototype.hasOwnProperty.call(prefs, 'formatCustom'),
      };
      prefs = previousPrefs;
      promptPresets = previousPresets;
      return result;
    })(),
    requestSettings: (() => {
      const body = { temperature: 0.9, max_tokens: 1000, top_p: 1, frequency_penalty: 0, presence_penalty: 0, stream: true, seed: 9 };
      applyPromptPresetRequestSettings(body, { modelParameters: {
        temperature: 0.25, openai_max_tokens: 777, top_p: 0.8,
        frequency_penalty: 0.2, presence_penalty: -0.1, stream_openai: false, seed: -1,
        top_k: 40, top_a: 0.2, min_p: 0.1, repetition_penalty: 1.1,
        stop: ['STOP_A', 'STOP_B'], reasoning_effort: 'high',
      } });
      return body;
    })(),
    squashedSystems: squashConsecutiveSystemMessages([
      { role: 'system', content: 'A' }, { role: 'system', content: 'B' },
      { role: 'user', content: 'U' }, { role: 'system', content: 'C' },
    ]),
    squashedExamples: squashConsecutiveSystemMessages([
      { role: 'system', content: 'A' }, { role: 'system', content: 'EX', _example: true },
      { role: 'system', content: 'B' },
    ]),
    debugTavernTag: extractDebugOutputTag('正文。<tavern_options>["A","B","C","D"]</tavern_options>'),
    payload: buildPayload(),
    missingHistoryFallback: (() => {
      const previousPreset = prefs.currentPresetByMode.tavern;
      const previousMessages = sessions[0].messages;
      promptPresets['无历史预设'] = normalizePromptPreset('无历史预设', {
        version: PRESET_SCHEMA_VERSION,
        mode: 'tavern',
        prompts: [
          { identifier: 'main', name: '主提示词', role: 'system', content: '只回应玩家最新行动。', marker: true },
          { identifier: 'chatHistory', name: '聊天历史', role: 'system', content: '', marker: true },
        ],
        promptOrder: [
          { identifier: 'main', enabled: true },
          { identifier: 'chatHistory', enabled: false },
        ],
      });
      prefs.currentPresetByMode.tavern = '无历史预设';
      sessions[0].messages = [{ role: 'user', content: '向左走' }];
      const first = buildPromptBlocks().history;
      sessions[0].messages = [{ role: 'user', content: '向右走' }];
      const second = buildPromptBlocks().history;
      delete promptPresets['无历史预设'];
      prefs.currentPresetByMode.tavern = previousPreset;
      sessions[0].messages = previousMessages;
      return { first, second };
    })(),
    autoMemoryPendingInput: (() => {
      const previousMessages = sessions[0].messages;
      const previousMemory = prefs.tavernAutoMemory;
      const previousLimit = settings.history;
      prefs.tavernAutoMemory = { enabled: true, windowTurns: 20, summarizeTurns: 15, summaryChars: 100 };
      settings.history = 1;
      sessions[0].messages = [
        { id: 'old-u', role: 'user', content: '已经总结的行动' },
        { id: 'old-a', role: 'assistant', content: '已经总结的回应' },
        { id: 'latest-u', role: 'user', content: '绝不能丢失的本轮输入' },
        { id: 'latest-dice', role: 'user', content: '🎲 d20 = 17', meta: true },
      ];
      sessions[0].autoMemory = { version: 1, summaries: [{ id: 'sum', text: '旧回合摘要', sourceMessageIds: ['old-u', 'old-a'] }] };
      const result = buildPromptBlocks().history;
      sessions[0].messages = previousMessages;
      delete sessions[0].autoMemory;
      prefs.tavernAutoMemory = previousMemory;
      settings.history = previousLimit;
      return result;
    })(),
    pendingInputWithoutMemory: (() => {
      const previousMessages = sessions[0].messages;
      const previousMemory = prefs.tavernAutoMemory;
      const previousLimit = settings.history;
      prefs.tavernAutoMemory = { enabled: false, windowTurns: 20, summarizeTurns: 15, summaryChars: 100 };
      settings.history = 1;
      sessions[0].messages = [
        { id: 'complete-u', role: 'user', content: '旧行动' },
        { id: 'complete-a', role: 'assistant', content: '旧回应' },
        { id: 'retry-u-1', role: 'user', content: '第一次未完成输入' },
        { id: 'retry-u-2', role: 'user', content: '请求失败后补充的输入' },
        { id: 'retry-dice', role: 'user', content: '🎲 d6 = 5', meta: true },
      ];
      const result = buildPromptBlocks().history;
      sessions[0].messages = previousMessages;
      prefs.tavernAutoMemory = previousMemory;
      settings.history = previousLimit;
      return result;
    })(),
    macroPendingInput: (() => {
      const previousPreset = prefs.currentPresetByMode.tavern;
      const previousMessages = sessions[0].messages;
      promptPresets['宏消息预设'] = normalizePromptPreset('宏消息预设', {
        mode: 'tavern',
        systemPrompt: 'LAST={{lastMessage}}|USER={{lastUserMessage}}|COUNT={{messageCount}}',
      });
      prefs.currentPresetByMode.tavern = '宏消息预设';
      sessions[0].messages = [
        { role: 'assistant', content: '上一条角色回复' },
        { role: 'user', content: '真正的玩家输入' },
        { role: 'user', content: '🎲 d20 = 17', meta: true },
      ];
      const result = buildPromptBlocks();
      delete promptPresets['宏消息预设'];
      prefs.currentPresetByMode.tavern = previousPreset;
      sessions[0].messages = previousMessages;
      return result;
    })(),
    rpgReplyOptionsPrompt: (() => {
      const previousMode = mode;
      mode = 'rpg';
      const result = buildTavernReplyOptionsPrompt(promptPresets['旧预设']);
      mode = previousMode;
      return result;
    })(),
    replyOptionsEditorOwnership: (() => {
      const previousGetElementById = document.getElementById;
      const previousEditingPreset = pgEditingPreset;
      const previousInherited = pgReplyOptionsInherited;
      const controls = {
        'pg-mode': { value: 'rpg' },
        'pg-reply-options-enabled': { checked: true },
        'pg-reply-options-count': { value: '3' },
        'pg-reply-options-prompt': { value: '自定义风格' },
      };
      document.getElementById = id => controls[id] || null;
      pgEditingPreset = normalizePromptPreset('纯 RPG', { mode: 'rpg' });
      pgReplyOptionsInherited = false;
      capturePGReplyOptions();
      const rpgHasField = Object.prototype.hasOwnProperty.call(pgEditingPreset, 'replyOptions');

      controls['pg-mode'].value = 'tavern';
      pgEditingPreset = normalizePromptPreset('继承默认', { mode: 'tavern' });
      pgReplyOptionsInherited = true;
      capturePGReplyOptions();
      const inheritedHasField = Object.prototype.hasOwnProperty.call(pgEditingPreset, 'replyOptions');

      pgReplyOptionsInherited = false;
      capturePGReplyOptions();
      const customized = pgEditingPreset.replyOptions;
      document.getElementById = previousGetElementById;
      pgEditingPreset = previousEditingPreset;
      pgReplyOptionsInherited = previousInherited;
      return { rpgHasField, inheritedHasField, customized };
    })(),
    stSettingsEditorRoundtrip: (() => {
      const previousGetElementById = document.getElementById;
      const previousEditingPreset = pgEditingPreset;
      const controls = Object.fromEntries(Object.entries({
        'pg-param-temperature': '0.45', 'pg-param-max-tokens': '2048', 'pg-param-top-p': '0.92',
        'pg-param-frequency-penalty': '0.15', 'pg-param-presence-penalty': '-0.2', 'pg-param-seed': '17',
        'pg-param-top-k': '40', 'pg-param-top-a': '0.1', 'pg-param-min-p': '0.05',
        'pg-param-repetition-penalty': '1.08', 'pg-param-stream': 'false', 'pg-squash-system': 'true',
        'pg-param-reasoning-effort': 'medium', 'pg-param-stop': 'STOP_A\\nSTOP_B',
        'pg-format-world-info': '<world>{0}</world>', 'pg-format-scenario': '<s>{{scenario}}</s>',
        'pg-format-personality': '<p>{{personality}}</p>', 'pg-new-chat-prompt': '[Chat]',
        'pg-new-example-prompt': '[Example]', 'pg-assistant-prefill': 'PREFILL',
      }).map(([id, value]) => [id, { value }]));
      document.getElementById = id => controls[id] || null;
      pgEditingPreset = normalizePromptPreset('设置往返', { mode: 'tavern', modelParameters: { custom_model: 'keep-me' } });
      capturePGSTPresetSettings();
      const result = pgEditingPreset.modelParameters;
      document.getElementById = previousGetElementById;
      pgEditingPreset = previousEditingPreset;
      return result;
    })(),
    worldPrompt: (() => {
      mode = 'rpg';
      currentWorldId = 'world-aurora';
      currentWorldSaveId = 'save-world';
      currentWorldSave = {
        id: 'save-world', worldId: 'world-aurora', worldVersion: 1, revision: 7,
        party: { memberIds: ['npc-party'], leaderId: 'pc-player' },
        state: { locationId: 'wolf-tooth-inn', stats: {}, inventory: [], quests: [{ questId: 'quest-1', npcIds: ['npc-quest'] }], goals: [{ id: 'goal-1', title: '找到联络人', npcIds: ['npc-goal'] }] },
        npcStates: {
          'npc-party': { locationId: 'far-away', relation: { trust: 2 }, knowledge: [], status: [] },
          'npc-local': { locationId: 'wolf-tooth-inn', relation: {}, knowledge: ['见过玩家'], status: [] },
          'npc-quest': { locationId: 'far-away', relation: {}, knowledge: [], status: ['waiting'] },
          'npc-goal': { locationId: 'far-away', relation: {}, knowledge: [], status: ['waiting'] },
          'npc-remote': { locationId: 'far-away', relation: {}, knowledge: [], status: [] },
        },
        generatedEntities: {
          npcs: {
            'save:save-world:npc:1': { id: 'save:save-world:npc:1', kind: 'npc', name: 'Generated Local', role: 'witness', locationId: 'wolf-tooth-inn', publicFacts: ['只存在于当前存档'] },
            'save:save-world:npc:2': { id: 'save:save-world:npc:2', kind: 'npc', name: 'Generated Remote', role: 'stranger', locationId: 'far-away' },
          },
        },
        turns: [], opening: '',
      };
      worldCards = [{
        id: 'world-aurora', version: 1, title: 'Aurora', locations: [{ id: 'wolf-tooth-inn', name: 'Inn' }],
        npcs: [
          { id: 'npc-party', name: 'Party NPC', role: 'ally', locationId: 'far-away' },
          { id: 'npc-local', name: 'Local NPC', role: 'innkeeper', locationId: 'wolf-tooth-inn', secrets: [{ id: 'vault-secret', content: '隐藏宝库位于北墙之后' }] },
          { id: 'npc-quest', name: 'Quest NPC', role: 'quest giver', locationId: 'far-away' },
          { id: 'npc-goal', name: 'Goal NPC', role: 'objective target', locationId: 'far-away' },
          { id: 'npc-remote', name: 'Remote NPC', role: 'stranger', locationId: 'far-away' },
        ],
      }];
      return buildRpgPromptPart();
    })(),
    budgetPrompt: (() => {
      const previous = prefs.worldContextBudget;
      prefs.worldContextBudget = 6000;
      const result = budgetWorldPromptParts([
        '【当前世界卡】\\n' + '稳定设定 '.repeat(3000),
        '【目标】找到联络人',
        '【当前作用域派系】\\n' + '无关派系 '.repeat(3000),
      ]).join('\\n\\n');
      prefs.worldContextBudget = previous;
      return result;
    })(),
    mapPrompt: (() => {
      const previousLocation = currentWorldSave.state.locationId;
      currentWorldSave.state.locationId = '区域 2';
      delete currentWorldSave.state.__runtimeRpg;
      currentWorldSave.state.map = { data: {
        regions: [1, 2, 3, 4].map(id => ({ id, name: 'Region ' + id, biome: '草原' })),
        adjacency: [[1, 2], [2, 3], [3, 4]],
        points: [{ regionId: 2, type: '村庄', name: '当前地标' }, { regionId: 4, type: '遗迹', name: '远方遗迹' }],
      } };
      const result = buildMapContext();
      currentWorldSave.state.locationId = previousLocation;
      delete currentWorldSave.state.__runtimeRpg;
      delete currentWorldSave.state.map;
      return result;
    })(),
    recentContext: (() => {
      const previousWorldId = currentWorldId;
      const previousWorldSaveId = currentWorldSaveId;
      const previousWorldSave = currentWorldSave;
      currentWorldId = 'world-context';
      currentWorldSaveId = 'save-context';
      worldTurnPending = null;
      currentWorldSave = {
        id: 'save-context', worldId: 'world-context', revision: 3,
        state: { locationId: 'new-scene', time: { unit: 'hour', value: 4 } },
        opening: '旧开场',
        turns: [
          { id: 'old-user', role: 'user', content: '旧场景玩家', revision: 1 },
          { id: 'old-assistant', role: 'assistant', content: '旧场景叙事', revision: 1 },
          { id: 'new-user', role: 'user', content: '新场景玩家', revision: 3 },
          { id: 'new-assistant', role: 'assistant', content: '新场景叙事', revision: 3 },
        ],
        eventLedger: [
          { id: 'ledger-old', sourceRevision: 1, locationId: 'old-scene' },
          { id: 'ledger-new', sourceRevision: 3, locationId: 'new-scene' },
        ],
      };
      const result = buildWorldRecentContext();
      currentWorldId = previousWorldId;
      currentWorldSaveId = previousWorldSaveId;
      currentWorldSave = previousWorldSave;
      return result;
    })(),
    hiddenSecretPrompt: (() => {
      currentWorldSave.npcStates['npc-local'].knowledge = ['见过玩家'];
      return buildRpgPromptPart();
    })(),
    unlockedSecretPrompt: (() => {
      currentWorldSave.npcStates['npc-local'].knowledge = ['见过玩家', 'vault-secret'];
      return buildRpgPromptPart();
    })(),
    worldLoreTrace: (() => {
      lorebooks = {
        'lore-a': { entries: [{ id: 'shared-a', keys: 'shared-key', content: 'WORLD_A_LORE' }] },
        'lore-b': { entries: [{ id: 'shared-b', keys: 'shared-key', content: 'WORLD_B_LORE' }] },
      };
      prefs.wiScanDepth = 20;
      worldCards = [
        { id: 'world-a', version: 1, title: 'World A', lorebookIds: ['lore-a'], locations: [{ id: 'a-start', name: 'A Start' }], npcs: [{ id: 'npc-a-twin', name: 'Twin', role: 'WORLD_A_NPC', locationId: 'a-start' }] },
        { id: 'world-b', version: 1, title: 'World B', lorebookIds: ['lore-b'], locations: [{ id: 'b-start', name: 'B Start' }], npcs: [{ id: 'npc-b-twin', name: 'Twin', role: 'WORLD_B_NPC', locationId: 'b-start' }] },
      ];
      const makeSave = (id, worldId, locationId, npcId, generatedName) => ({
        id, worldId, worldVersion: 1, opening: '', turns: [{ role: 'user', content: 'shared-key' }],
        party: { memberIds: [], leaderId: null },
        npcStates: { [npcId]: { locationId, relation: {}, knowledge: [], status: [] } },
        generatedEntities: { npcs: { ['save:' + id + ':npc:1']: { id: 'save:' + id + ':npc:1', kind: 'npc', name: generatedName, role: generatedName, locationId } } },
        state: { locationId, stats: {}, inventory: [], quests: [] },
      });
      prefs.activeLoreId = 'lore-a';
      currentWorldId = 'world-a'; currentWorldSaveId = 'save-a'; currentWorldSave = makeSave('save-a', 'world-a', 'a-start', 'npc-a-twin', 'SAVE_A_NPC');
      const a = buildPromptBlocks().system;
      currentWorldId = 'world-b'; currentWorldSaveId = 'save-b'; currentWorldSave = makeSave('save-b', 'world-b', 'b-start', 'npc-b-twin', 'SAVE_B_NPC');
      const b = buildPromptBlocks().system;
      return { a, b };
    })(),
    converted: convertSTPresetData({
      temperature: 0.8,
      wi_format: '<world>{0}</world>',
      scenario_format: '<scenario>{{scenario}}</scenario>',
      new_chat_prompt: '[Start]',
      assistant_prefill: 'PREFIX',
      prompts: [
        { identifier: 'main', name: 'Main', role: 'system', content: '写作', system_prompt: true },
        { identifier: 'nsfw', name: 'Auxiliary', role: 'system', content: '可编辑辅助', system_prompt: true },
        { identifier: 'chatHistory', name: 'History', marker: true },
        { identifier: 'spare', name: '未使用素材', role: 'user', content: '备用' },
      ],
      prompt_order: [
        { character_id: 100000, order: [{ identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true }] },
        { character_id: 100001, order: [{ identifier: 'main', enabled: true }, { identifier: 'nsfw', enabled: true }, { identifier: 'chatHistory', enabled: true }] },
      ],
      extensions: { regex_scripts: [{ findRegex: '/x/g' }] },
      tavern_meta: { replyOptions: { enabled: false, count: 3, instruction: 'IMPORTED {count}' } },
    }),
  };
  prefs.currentPresetByMode.tavern = '';
  check.explicitGlobal = activePresetNameForMode('tavern');
`, context);

vm.runInContext(`
  var previousDefaults = defaults;
  defaults = { gen: {}, rpg: {} };
  promptPresets['RP 基础（示例）'] = normalizePromptPreset('RP 基础（示例）', {
    mode: 'tavern', systemPrompt: '你是互动小说作者。', postHistory: '旧后预设', modules: [],
  });
  migrateBuiltInTavernPreset({ presets: {
    'RP 基础（示例）': { postHistory: '内置前置。\\n\\n【AI 回复选项协议】输出 <tavern_options>["A","B","C","D"]</tavern_options>。' },
  } });
  globalThis.check.staleMigration = promptPresets['RP 基础（示例）'];
  defaults = { gen: {}, rpg: {}, presets: {
    'RP 基础（示例）': { postHistory: '内置前置。\\n\\n【AI 回复选项协议】输出 <tavern_options>["A","B","C","D"]</tavern_options>。' },
  } };
  mode = 'tavern';
  globalThis.check.staleOptions = parseTavernReplyOutput('正文。<tavern_options>["A","B","C","D"]</tavern_options>', promptPresets['RP 基础（示例）']);
  defaults = previousDefaults;
`, context);

assert.strictEqual(context.check.migratedVersion, 3);
assert.strictEqual(context.check.escaped, '&quot; onmouseover=&quot;x');
assert.strictEqual(context.check.activeTavern, '旧预设');
assert.strictEqual(context.check.activeRpg, 'RPG 预设');
assert.strictEqual(context.check.explicitGlobal, '');
assert.match(context.check.blocks.system, /你是 夏瑾 的叙事者/);
assert.match(context.check.worldPrompt, /state\.locationId/);
assert.match(context.check.worldPrompt, /wolf-tooth-inn/);
assert.match(context.check.worldPrompt, /WorldCard world-aurora@v1/);
assert.match(context.check.worldPrompt, /WorldSave save-world@r7/);
assert.match(context.check.worldPrompt, /不能把一次存档变化宣称为世界卡永久改写/);
assert.match(context.check.worldPrompt, /npc-party/);
assert.match(context.check.worldPrompt, /npc-local/);
assert.match(context.check.worldPrompt, /npc-quest/);
assert.match(context.check.worldPrompt, /npc-goal/);
assert.match(context.check.worldPrompt, /Generated Local/);
assert.doesNotMatch(context.check.worldPrompt, /Generated Remote/);
assert.doesNotMatch(context.check.worldPrompt, /npc-remote/);
assert.match(context.check.budgetPrompt, /找到联络人/);
assert.ok(context.check.budgetPrompt.length <= 6000);
assert.doesNotMatch(context.check.budgetPrompt, /无关派系 无关派系 无关派系 无关派系 无关派系 无关派系 无关派系 无关派系 无关派系 无关派系/);
assert.match(context.check.mapPrompt, /Region 1/);
assert.match(context.check.mapPrompt, /Region 3/);
assert.match(context.check.mapPrompt, /当前地标/);
assert.doesNotMatch(context.check.mapPrompt, /Region 4|远方遗迹/);
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.check.recentContext.messages)), [
  { role: 'user', content: '新场景玩家' },
  { role: 'assistant', content: '新场景叙事' },
]);
assert.strictEqual(context.check.recentContext.sceneStartRevision, 3);
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.check.recentContext.sourceLedgerIds)), ['ledger-new']);
assert.doesNotMatch(context.check.hiddenSecretPrompt, /隐藏宝库位于北墙之后/);
assert.match(context.check.unlockedSecretPrompt, /隐藏宝库位于北墙之后/);
assert.match(context.check.worldLoreTrace.a, /WORLD_A_LORE/);
assert.doesNotMatch(context.check.worldLoreTrace.a, /WORLD_B_LORE/);
assert.match(context.check.worldLoreTrace.a, /WORLD_A_NPC/);
assert.match(context.check.worldLoreTrace.a, /SAVE_A_NPC/);
assert.doesNotMatch(context.check.worldLoreTrace.a, /WORLD_B_NPC|SAVE_B_NPC/);
assert.match(context.check.worldLoreTrace.b, /WORLD_B_LORE/);
assert.doesNotMatch(context.check.worldLoreTrace.b, /WORLD_A_LORE/);
assert.match(context.check.worldLoreTrace.b, /WORLD_B_NPC/);
assert.match(context.check.worldLoreTrace.b, /SAVE_B_NPC/);
assert.doesNotMatch(context.check.worldLoreTrace.b, /WORLD_A_NPC|SAVE_A_NPC/);
assert.match(context.check.blocks.system, /与 旅人 合作/);
assert.match(context.check.blocks.system, /保持轻快/);
assert.doesNotMatch(context.check.blocks.post, /保持轻快/);
assert.match(context.check.blocks.post, /OPT 4/);
const embeddedOptionPrompt = JSON.stringify(context.check.embeddedOptionBlocks.promptMessages) + context.check.embeddedOptionBlocks.post;
assert.strictEqual((embeddedOptionPrompt.match(/<tavern_options\b/gi) || []).length, 2);
assert.match(context.check.embeddedOptionBlocks.post, /OPT 4/);
assert.strictEqual((context.check.blocks.system.match(/月港终年有雾/g) || []).length, 1);
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.check.tavernOptions.options)), ['A', 'B', 'C', 'D']);
assert.strictEqual(context.check.tavernOptions.content, '正文。');
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.check.tavernOptionsEscaped.options)), ['A', 'B', 'C', 'D']);
assert.strictEqual(context.check.tavernOptionsEscaped.content, '正文。');
assert.strictEqual(context.check.tavernOptionsDuplicate.content, '正文。尾部');
assert.strictEqual(context.check.tavernOptionsMalformed.content, '正文。');
assert.strictEqual(context.check.tavernNeedsRepair, true);
assert.strictEqual(context.check.tavernDoesNotNeedRepair, false);
assert.strictEqual(context.check.customReplyOptions.config.count, 2);
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.check.customReplyOptions.rules)), { enabled: true, min: 2, max: 2, count: 2, noOptions: '（等待 AI 生成可选行动…）' });
assert.match(context.check.customReplyOptions.prompt, /^CUSTOM 2\/2\/2/);
assert.match(context.check.customReplyOptions.prompt, /OPT 2/);
assert.match(context.check.customReplyOptions.prompt, /<tavern_options>/);
assert.strictEqual(context.check.disabledReplyOptions.prompt, '');
assert.strictEqual(context.check.disabledReplyOptions.parsed.content, '正文。');
assert.strictEqual(context.check.disabledReplyOptions.parsed.options, null);
assert.strictEqual(context.check.disabledReplyOptions.repair, false);
assert.strictEqual(context.check.migratedReplyOptions.prompts.find(prompt => prompt.identifier === 'jailbreak').content, '保留后置。');
assert.match(context.check.migratedReplyOptions.replyOptions.instruction, /<tavern_options>/);
assert.ok(!context.check.legacyFormatRemoved.prompts.some(prompt => prompt.identifier === 'tavernFormat'));
assert.ok(!context.check.legacyFormatRemoved.promptOrder.some(item => item.identifier === 'tavernFormat'));
assert.doesNotMatch(context.check.postHistorySwitch.disabled, /POST_ONLY/);
const enabledPostMessages = JSON.parse(JSON.stringify(context.check.postHistorySwitch.enabledMessages));
const movedPostMessages = JSON.parse(JSON.stringify(context.check.postHistorySwitch.movedMessages));
assert.ok(enabledPostMessages.findIndex(message => message.content.includes('POST_ONLY'))
  > enabledPostMessages.findIndex(message => message.content.includes('出发吧')));
assert.ok(movedPostMessages.findIndex(message => message.content.includes('POST_ONLY'))
  < movedPostMessages.findIndex(message => message.content.includes('出发吧')));
assert.doesNotMatch(context.check.worldInfoSwitch.disabled, /月港终年有雾/);
assert.match(context.check.worldInfoSwitch.enabled, /月港终年有雾/);
const positionedMessages = JSON.parse(JSON.stringify(context.check.worldInfoPositions));
const positionedContent = positionedMessages.map(message => message.content);
const beforeIndex = positionedContent.findIndex(content => content.includes('WI_BEFORE'));
const characterIndex = positionedContent.findIndex(content => content.includes('名字：夏瑾'));
const afterIndex = positionedContent.findIndex(content => content.includes('WI_AFTER'));
const exampleIndex = positionedContent.findIndex(content => content.includes('EXAMPLE_BODY'));
const exampleReplyIndex = positionedContent.findIndex(content => content.includes('EXAMPLE_REPLY'));
const exampleTopIndex = positionedContent.findIndex(content => content.includes('WI_EXAMPLE_TOP'));
const exampleBottomIndex = positionedContent.findIndex(content => content.includes('WI_EXAMPLE_BOTTOM'));
const depthIndex = positionedContent.findIndex(content => content.includes('WI_AT_DEPTH'));
const currentInputIndex = positionedContent.findIndex(content => content.includes('出发吧'));
assert.ok(beforeIndex >= 0 && beforeIndex < characterIndex);
assert.ok(afterIndex > characterIndex && afterIndex < exampleIndex);
assert.ok(exampleTopIndex < exampleIndex && exampleIndex < exampleReplyIndex && exampleReplyIndex < exampleBottomIndex);
assert.strictEqual(positionedMessages[exampleIndex].role, 'user');
assert.strictEqual(positionedMessages[exampleReplyIndex].role, 'assistant');
assert.strictEqual(positionedContent.filter(content => content === 'EXAMPLE_SEPARATOR').length, 3);
assert.strictEqual(positionedMessages[depthIndex].role, 'user');
assert.ok(depthIndex > currentInputIndex);
const overrideMessages = JSON.stringify(context.check.characterPromptOverrides);
assert.match(overrideMessages, /CARD_MAIN \+ BASE_MAIN/);
assert.match(overrideMessages, /CARD_POST \+ BASE_POST/);
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.check.legacyGlobalSettingsMigration)), {
  changed: true, main: 'GLOBAL_MAIN', post: 'GLOBAL_POST', hasMainField: false, hasPostField: false,
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.check.legacyFormatPreferenceMigration)), {
  changed: true, content: 'USER_FORMAT', enabled: true, hasPresetField: false, hasCustomField: false,
});
assert.strictEqual(context.check.requestSettings.temperature, 0.25);
assert.strictEqual(context.check.requestSettings.max_tokens, 777);
assert.strictEqual(context.check.requestSettings.top_p, 0.8);
assert.strictEqual(context.check.requestSettings.frequency_penalty, 0.2);
assert.strictEqual(context.check.requestSettings.presence_penalty, -0.1);
assert.strictEqual(context.check.requestSettings.stream, false);
assert.ok(!Object.prototype.hasOwnProperty.call(context.check.requestSettings, 'seed'));
assert.strictEqual(context.check.requestSettings.top_k, 40);
assert.strictEqual(context.check.requestSettings.top_a, 0.2);
assert.strictEqual(context.check.requestSettings.min_p, 0.1);
assert.strictEqual(context.check.requestSettings.repetition_penalty, 1.1);
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.check.requestSettings.stop)), ['STOP_A', 'STOP_B']);
assert.strictEqual(context.check.requestSettings.reasoning_effort, 'high');
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.check.squashedSystems)), [
  { role: 'system', content: 'A\n\nB' }, { role: 'user', content: 'U' }, { role: 'system', content: 'C' },
]);
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.check.squashedExamples)), [
  { role: 'system', content: 'A' }, { role: 'system', content: 'EX', _example: true },
  { role: 'system', content: 'B' },
]);
assert.match(context.check.debugTavernTag, /<tavern_options>/);
assert.doesNotMatch(context.check.staleMigration.prompts.find(prompt => prompt.identifier === 'jailbreak').content, /<tavern_options>/);
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.check.staleOptions.options)), ['A', 'B', 'C', 'D']);
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.check.blocks.history)), [
  { role: 'user', content: '只推进一步。' },
  { role: 'user', content: '出发吧' },
]);
assert.ok(context.check.payload.body.messages.filter(x => x.role === 'system').length > 1);
assert.strictEqual(context.check.payload.body.messages.at(-1).role, 'system');
assert.match(context.check.payload.body.messages.at(-1).content, /OPT 4/);
assert.ok(context.check.payload.body.messages.findIndex(message => message.content.includes('出发吧'))
  < context.check.payload.body.messages.findIndex(message => message.content.includes('只推进一步')));
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.check.missingHistoryFallback.first)), [{ role: 'user', content: '向左走' }]);
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.check.missingHistoryFallback.second)), [{ role: 'user', content: '向右走' }]);
assert.notDeepStrictEqual(
  JSON.parse(JSON.stringify(context.check.missingHistoryFallback.first)),
  JSON.parse(JSON.stringify(context.check.missingHistoryFallback.second)),
);
assert.strictEqual(context.check.autoMemoryPendingInput.at(-1).role, 'user');
assert.match(context.check.autoMemoryPendingInput.at(-1).content, /绝不能丢失的本轮输入/);
assert.match(context.check.autoMemoryPendingInput.at(-1).content, /🎲 d20 = 17/);
assert.strictEqual((JSON.stringify(context.check.autoMemoryPendingInput).match(/绝不能丢失的本轮输入/g) || []).length, 1);
assert.doesNotMatch(JSON.stringify(context.check.autoMemoryPendingInput), /已经总结的行动|已经总结的回应/);
assert.strictEqual(context.check.pendingInputWithoutMemory.at(-1).role, 'user');
assert.match(context.check.pendingInputWithoutMemory.at(-1).content, /第一次未完成输入/);
assert.match(context.check.pendingInputWithoutMemory.at(-1).content, /请求失败后补充的输入/);
assert.match(context.check.pendingInputWithoutMemory.at(-1).content, /🎲 d6 = 5/);
assert.doesNotMatch(JSON.stringify(context.check.pendingInputWithoutMemory), /旧行动|旧回应/);
assert.match(context.check.macroPendingInput.system, /LAST=真正的玩家输入\|USER=真正的玩家输入\|COUNT=2/);
assert.match(context.check.macroPendingInput.history.at(-1).content, /真正的玩家输入/);
assert.match(context.check.macroPendingInput.history.at(-1).content, /🎲 d20 = 17/);
assert.strictEqual(context.check.rpgReplyOptionsPrompt, '');
assert.strictEqual(context.check.replyOptionsEditorOwnership.rpgHasField, false);
assert.strictEqual(context.check.replyOptionsEditorOwnership.inheritedHasField, false);
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.check.replyOptionsEditorOwnership.customized)), {
  enabled: true, min: 3, max: 3, count: 3, instruction: '自定义风格',
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.check.stSettingsEditorRoundtrip)), {
  custom_model: 'keep-me', temperature: 0.45, openai_max_tokens: 2048, top_p: 0.92,
  frequency_penalty: 0.15, presence_penalty: -0.2, seed: 17, top_k: 40, top_a: 0.1,
  min_p: 0.05, repetition_penalty: 1.08, stream_openai: false, squash_system_messages: true,
  reasoning_effort: 'medium', stop: ['STOP_A', 'STOP_B'], wi_format: '<world>{0}</world>',
  scenario_format: '<s>{{scenario}}</s>', personality_format: '<p>{{personality}}</p>',
  new_chat_prompt: '[Chat]', new_example_chat_prompt: '[Example]', assistant_prefill: 'PREFILL',
});
assert.strictEqual(context.check.converted.report.prompts, 4);
assert.strictEqual(context.check.converted.report.ordered, 3);
assert.strictEqual(context.check.converted.report.regexes, 1);
assert.strictEqual(context.check.converted.preset.modelParameters.temperature, 0.8);
assert.strictEqual(context.check.converted.preset.modelParameters.wi_format, '<world>{0}</world>');
assert.strictEqual(context.check.converted.preset.modelParameters.scenario_format, '<scenario>{{scenario}}</scenario>');
assert.strictEqual(context.check.converted.preset.modelParameters.new_chat_prompt, '[Start]');
assert.strictEqual(context.check.converted.preset.modelParameters.assistant_prefill, 'PREFIX');
assert.strictEqual(context.check.converted.preset.replyOptions.enabled, false);
assert.strictEqual(context.check.converted.preset.replyOptions.count, 3);
assert.strictEqual(context.check.converted.preset.prompts.find(x => x.identifier === 'main').marker, false);
assert.strictEqual(context.check.converted.preset.prompts.find(x => x.identifier === 'main').pinned, true);
assert.strictEqual(context.check.converted.preset.prompts.find(x => x.identifier === 'nsfw').marker, false);
assert.strictEqual(context.check.converted.preset.prompts.find(x => x.identifier === 'nsfw').content, '可编辑辅助');
assert.strictEqual(context.check.converted.preset.prompts.find(x => x.identifier === 'spare').content, '备用');
assert.ok(!context.check.converted.preset.promptOrder.some(x => x.identifier === 'spare'));
assert.strictEqual(context.check.converted.preset.promptOrderProfiles.length, 2);
assert.throws(() => vm.runInContext("convertSTPresetData({ prompts: Array(2001), prompt_order: [] })", context), /超过 2000 条/);

vm.runInContext(`
  const compatPreset = convertSTPresetData({
    prompts: {
      main: { name: '主提示', role: 'system', system_prompt: true, content: '{{user}}/{{lastMessage}}' },
      history: { name: '历史', marker: true, content: '' },
    },
    prompt_order: { '100001': [{ identifier: 'main' }, 'history'] },
    extensions: { regex_scripts: { hide: { id: 'hide', findRegex: '/\\[x\\]/g', replaceString: '', affects: ['AI Response'], trimStrings: 'a\\nb' } } },
    max_completion_tokens: 4096,
  });
  const macroVars = {};
  globalThis.compatResult = {
    preset: compatPreset,
    macro: expandPresetMacros('{{setglobalvar::tone::冷静}}{{getglobalvar::tone}}|{{mesExamplesRaw}}|{{lastMessage}}|{{newline}}|{{random::甲::乙}}', {
      mesExamplesRaw: '示例', lastMessage: '上一条', user: '玩家', char: '角色',
    }, macroVars),
  };
`, context);
assert.strictEqual(context.compatResult.preset.preset.promptOrder.length, 2);
assert.strictEqual(context.compatResult.preset.preset.modelParameters.max_completion_tokens, 4096);
assert.strictEqual(context.compatResult.preset.preset.regexes[0].placement[0], 'AI Response');
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.compatResult.preset.preset.regexes[0].trimStrings)), ['a', 'b']);
assert.match(context.compatResult.macro, /冷静\|示例\|上一条\|/);
assert.match(context.compatResult.macro, /甲|乙/);

const tavernDefault = defaultData.presets['RP 基础（示例）'];
const rpgDefault = defaultData.presets['RPG 叙事引擎（示例）'];
assert.ok(tavernDefault.prompts.find(x => x.identifier === 'main').content.length > 100);
assert.ok(tavernDefault.promptOrder.some(x => x.identifier === 'agency' && x.enabled));
assert.ok(tavernDefault.promptOrder.some(x => x.identifier === 'characterIntegrity' && x.enabled));
assert.ok(rpgDefault.prompts.find(x => x.identifier === 'main').content.length > 100);
assert.ok(rpgDefault.promptOrder.some(x => x.identifier === 'rpgAdjudication' && x.enabled));
assert.ok(rpgDefault.promptOrder.some(x => x.identifier === 'rpgContinuity' && x.enabled));
assert.deepStrictEqual(defaultData.prefs.currentPresetByMode, { tavern: 'RP 基础（示例）', rpg: 'RPG 叙事引擎（示例）' });
assert.match(defaultData.rpg.stateInstruction, /恰好 4 个/);
assert.match(defaultData.rpg.stateInstruction, /runtime\.action\.execute 只能是/);
assert.match(defaultData.rpg.stateInstruction, /禁止出现 result、args、value/);
assert.match(defaultData.rpg.eventMemoryInstruction, /eventMemory/);
assert.strictEqual(defaultData.prefs.worldContextBudget, 24000);
const exampleState = JSON.parse(defaultData.rpg.exampleTurn.assistant.match(/<tavern_state_update>\n([\s\S]*?)\n<\/tavern_state_update>/)[1]);
assert.strictEqual(exampleState.protocol, 'tavern.rpg.turn');
assert.strictEqual(exampleState.options.length, 4);

console.log('prompt preset check passed');
