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
const defaultData = JSON.parse(fs.readFileSync('public/data/_defaults.json', 'utf8'));
vm.runInContext(source, context);
vm.runInContext(`
  defaults = { gen: {}, rpg: {} };
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
    payload: buildPayload(),
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

assert.strictEqual(context.check.migratedVersion, 2);
assert.strictEqual(context.check.escaped, '&quot; onmouseover=&quot;x');
assert.strictEqual(context.check.activeTavern, '旧预设');
assert.strictEqual(context.check.activeRpg, 'RPG 预设');
assert.strictEqual(context.check.explicitGlobal, '');
assert.match(context.check.blocks.system, /你是 夏瑾 的叙事者/);
assert.match(context.check.blocks.system, /与 旅人 合作/);
assert.match(context.check.blocks.system, /保持轻快/);
assert.strictEqual((context.check.blocks.system.match(/月港终年有雾/g) || []).length, 1);
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
const exampleState = JSON.parse(defaultData.rpg.exampleTurn.assistant.match(/```rpg\n([\s\S]*?)\n```/)[1]);
assert.strictEqual(exampleState.options.length, 4);

console.log('prompt preset check passed');
