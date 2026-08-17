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
assert.match(indexHtml, /id="pg-post-history"/);
assert.doesNotMatch(indexHtml, /摸摸头|观察四周|试探对方|保持戒备/);
assert.match(defaultData.presets['RP 基础（示例）'].postHistory, /<tavern_options>/);
vm.runInContext(source, context);
vm.runInContext(`
  defaults = { gen: {}, rpg: {}, tavern: { replyOptions: { enabled: true, min: 4, max: 4, count: 4, instruction: 'OPT {count}' } } };
  formatInstructions = { prose: { text: '使用 Markdown。' } };
  prefs = { currentPreset: '旧预设', currentPresetByMode: { tavern: '旧预设', rpg: 'RPG 预设' }, formatPreset: 'prose', formatCustom: '' };
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
  ensurePromptPresetsV2();
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
      const previous = promptPresets['旧预设'].postHistory;
      promptPresets['旧预设'].postHistory = previous + '<tavern_options>["内置一"]</tavern_options>';
      const result = buildPromptBlocks();
      promptPresets['旧预设'].postHistory = previous;
      return result;
    })(),
    tavernOptions: parseTavernReplyOutput('正文。<tavern_options>["A","B","A","C","D","E"]</tavern_options>', promptPresets['旧预设']),
    tavernOptionsDuplicate: parseTavernReplyOutput('正文。<tavern_options>["A"]</tavern_options>尾部<tavern_options>["B"]</tavern_options>', promptPresets['旧预设']),
    tavernOptionsMalformed: parseTavernReplyOutput('正文。<tavern_options>{oops}</tavern_options>', promptPresets['旧预设']),
    tavernNeedsRepair: tavernReplyNeedsOptionRepair(parseTavernReplyOutput('正文。', promptPresets['旧预设']), promptPresets['旧预设']),
    tavernDoesNotNeedRepair: tavernReplyNeedsOptionRepair(parseTavernReplyOutput('正文。<tavern_options>["A","B","C","D"]</tavern_options>', promptPresets['旧预设']), promptPresets['旧预设']),
    debugTavernTag: extractDebugOutputTag('正文。<tavern_options>["A","B","C","D"]</tavern_options>'),
    payload: buildPayload(),
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
      prompts: [
        { identifier: 'main', name: 'Main', role: 'system', content: '写作', marker: true },
        { identifier: 'chatHistory', name: 'History', marker: true },
        { identifier: 'spare', name: '未使用素材', role: 'user', content: '备用' },
      ],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true }] }],
      extensions: { regex_scripts: [{ findRegex: '/x/g' }] },
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
  globalThis.check.staleMigration = promptPresets['RP 基础（示例）'].postHistory;
  defaults = { gen: {}, rpg: {}, presets: {
    'RP 基础（示例）': { postHistory: '内置前置。\\n\\n【AI 回复选项协议】输出 <tavern_options>["A","B","C","D"]</tavern_options>。' },
  } };
  mode = 'tavern';
  globalThis.check.staleOptions = parseTavernReplyOutput('正文。<tavern_options>["A","B","C","D"]</tavern_options>', promptPresets['RP 基础（示例）']);
  defaults = previousDefaults;
`, context);

assert.strictEqual(context.check.migratedVersion, 2);
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
assert.match(context.check.blocks.post, /保持轻快/);
assert.match(context.check.blocks.post, /OPT 4/);
assert.strictEqual((context.check.embeddedOptionBlocks.post.match(/<tavern_options\b/gi) || []).length, 1);
assert.doesNotMatch(context.check.embeddedOptionBlocks.post, /OPT 4/);
assert.strictEqual((context.check.blocks.system.match(/月港终年有雾/g) || []).length, 1);
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.check.tavernOptions.options)), ['A', 'B', 'C', 'D']);
assert.strictEqual(context.check.tavernOptions.content, '正文。');
assert.strictEqual(context.check.tavernOptionsDuplicate.content, '正文。尾部');
assert.strictEqual(context.check.tavernOptionsMalformed.content, '正文。');
assert.strictEqual(context.check.tavernNeedsRepair, true);
assert.strictEqual(context.check.tavernDoesNotNeedRepair, false);
assert.match(context.check.debugTavernTag, /<tavern_options>/);
assert.match(context.check.staleMigration, /<tavern_options>/);
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.check.staleOptions.options)), ['A', 'B', 'C', 'D']);
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.check.blocks.history)), [
  { role: 'user', content: '出发吧' },
  { role: 'user', content: '只推进一步。' },
]);
assert.strictEqual(context.check.payload.body.messages.filter(x => x.role === 'system').length, 1);
assert.strictEqual(context.check.converted.report.prompts, 3);
assert.strictEqual(context.check.converted.report.ordered, 2);
assert.strictEqual(context.check.converted.report.regexes, 1);
assert.strictEqual(context.check.converted.preset.modelParameters.temperature, 0.8);
assert.strictEqual(context.check.converted.preset.prompts.find(x => x.identifier === 'spare').content, '备用');
assert.ok(!context.check.converted.preset.promptOrder.some(x => x.identifier === 'spare'));
assert.throws(() => vm.runInContext("convertSTPresetData({ prompts: Array(2001), prompt_order: [] })", context), /超过 2000 条/);

const tavernDefault = defaultData.presets['RP 基础（示例）'];
const rpgDefault = defaultData.presets['RPG 叙事引擎（示例）'];
assert.ok(tavernDefault.systemPrompt.length > 100);
assert.ok(tavernDefault.modules.some(x => x.id === 'agency' && x.enabled));
assert.ok(tavernDefault.modules.some(x => x.id === 'characterIntegrity' && x.enabled));
assert.ok(rpgDefault.systemPrompt.length > 100);
assert.ok(rpgDefault.modules.some(x => x.id === 'rpgAdjudication' && x.enabled));
assert.ok(rpgDefault.modules.some(x => x.id === 'rpgContinuity' && x.enabled));
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
