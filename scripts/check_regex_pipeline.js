'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const storage = new Map();
const context = vm.createContext({
  console,
  localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  window: {}, document: {}, Date, Math, JSON, Set, Map,
});
const source = fs.readFileSync('public/app.js', 'utf8').replace(/\ninit\(\);\s*$/, '');
vm.runInContext(source, context);
vm.runInContext(`
  defaults = { gen: {}, rpg: {} };
  mode = 'tavern';
  settings = { ...DEFAULT_SETTINGS };
  characters = [{ id: 'c', name: '测试角色', cardExtensions: {} }];
  currentCharId = 'c';
  currentWorldId = null; currentWorldSave = null; currentWorldSaveId = null; worldCards = []; worldCardVersions.clear();
  userData = { currentPreset: 'default', presets: { default: { name: 'a+b', persona: '' } }, memories: [] };
  promptPresets = {
    A: normalizePromptPreset('A', { mode: 'tavern', prompts: [], promptOrder: [], regexes: [{ id: 'preset-a', findRegex: '/A/g', replaceString: 'a' }] }),
    B: normalizePromptPreset('B', { mode: 'tavern', prompts: [], promptOrder: [], regexes: [{ id: 'preset-b', findRegex: '/B/g', replaceString: 'b' }] }),
  };
  prefs = { currentPresetByMode: { tavern: 'A' }, outputRegex: { tavern: [
    { id: 'scope-a', findRegex: '/X/g', replaceString: 'a', presetScope: 'A' },
    { id: 'scope-b', findRegex: '/X/g', replaceString: 'b', presetScope: 'B' },
    { id: 'global', findRegex: '/G/g', replaceString: 'g' },
    { id: 'user', findRegex: '/U/g', replaceString: 'u', stages: ['user_input'] },
    { id: 'prompt', findRegex: '/P/g', replaceString: 'p', onlyFormatPrompt: true },
  ] } };
  globalThis.check = {
    a: applyOutputRegex('AXG'),
    user: applyRegexStage('UX', 'user_input'),
    prompt: applyRegexStage('PX', 'prompt_history'),
    promptNotUser: applyRegexStage('PX', 'user_input'),
    stStages: [0, 1, 2, 3, 5, 6].map(value => normalizeOutputRegexRule({ placement: [value] }).stages[0]),
    escapedMacro: applyOutputRegexRule('name: a+b', { replaceString: 'hit', trimStrings: [], substituteRegex: 2 }, buildOutputRegex({ findRegex: '/{{user}}/', substituteRegex: 2 })),
    namedCapture: applyOutputRegexRule('状态：在线', { replaceString: '[$<value>]', trimStrings: [] }, buildOutputRegex({ findRegex: '/状态：(?<value>[^\\n]+)/' })),
    exportRule: serializeOutputRegexRule(normalizeOutputRegexRule({ name: 'ST', findRegex: '/x/g', replaceString: 'y', placement: [1, 5, 6], substituteRegex: 2 })),
  };
  prefs.currentPresetByMode.tavern = 'B';
  globalThis.switchCheck = applyOutputRegex('ABXG');
`, context);

assert.strictEqual(context.check.a, 'aag');
assert.strictEqual(context.check.user, 'uX');
assert.strictEqual(context.check.prompt, 'pX');
assert.strictEqual(context.check.promptNotUser, 'PX');
assert.deepStrictEqual([...context.check.stStages], ['chat_display', 'user_input', 'ai_response', 'slash_command', 'world_info', 'reasoning']);
assert.strictEqual(context.check.escapedMacro, 'name: hit');
assert.strictEqual(context.check.namedCapture, '[在线]');
assert.strictEqual(JSON.stringify([...context.check.exportRule.placement]), JSON.stringify([1, 5, 6]));
assert.strictEqual(context.check.exportRule.substituteRegex, 2);
assert.strictEqual(context.switchCheck, 'Abbg');
console.log('regex pipeline check passed');

// ST source placement and ephemerality are independent, including both flags and no sources.
for (const markdownOnly of [false, true]) for (const promptOnly of [false, true]) {
  const result = vm.runInContext(`(() => {
    const rule = normalizeOutputRegexRule({ placement: [2], markdownOnly: ${markdownOnly}, promptOnly: ${promptOnly} }, 0, 'character');
    return ['ai_response', 'chat_display', 'prompt_history', 'system_prompt', 'world_info', 'user_input'].map(stage => regexRuleAppliesToStage(rule, stage));
  })()`, context);
  assert.deepStrictEqual([...result], [!markdownOnly && !promptOnly, markdownOnly || !promptOnly, promptOnly, false, false, false]);
}
assert.strictEqual(vm.runInContext(`regexRuleAppliesToStage(normalizeOutputRegexRule({ placement: [2], promptOnly: true }), 'prompt_history', { role: 'user' })`, context), false);
assert.strictEqual(vm.runInContext(`regexRuleAppliesToStage(normalizeOutputRegexRule({ placement: [1], promptOnly: true }), 'prompt_history', { role: 'user' })`, context), true);
assert.strictEqual(vm.runInContext(`regexRuleAppliesToStage(normalizeOutputRegexRule({ placement: [], markdownOnly: true, promptOnly: true }), 'chat_display')`, context), false);
assert.strictEqual(vm.runInContext(`serializeOutputRegexRule(normalizeOutputRegexRule({ placement: [] })).placement.length`, context), 0);
assert.strictEqual(vm.runInContext(`normalizeOutputRegexRule({ maxDepth: -1 }).maxDepth`, context), null);
assert.strictEqual(vm.runInContext(`regexRuleAppliesToStage(normalizeOutputRegexRule({ placement: [2], promptOnly: true, maxDepth: 0 }), 'prompt_history', { depth: 1 })`, context), false);
assert.strictEqual(vm.runInContext(`applyOutputRegexRules('REMOVE ALL', normalizeOutputRegexRules([{ findRegex: '.*', flags: 'gs', replaceString: '' }]))`, context), '');

vm.runInContext(`
  prefs.outputRegex = { tavern: [] };
  characters[0].cardExtensions = { regex_scripts: [{ placement: [2], markdownOnly: true, findRegex: '/<aether>(.*?)<\\/aether>/g', replaceString: '<style>.card{color:red}</style><div>$1</div>' }] };
  const original = '<aether>RAW STATE</aether>';
  const savedDisplay = '<style>.card{color:red}</style><div>RAW STATE</div>';
  const message = { role: 'assistant', content: savedDisplay, rawContent: original };
  globalThis.isolation = {
    persisted: processAIOutput(original).content,
    display: renderOutputContent(original),
    repairedHistory: regexHistoryContent(message),
    stored: message.content,
    edited: regexHistoryContent({ ...message, content: 'manual edit' }),
  };
`, context);
assert.strictEqual(context.isolation.persisted, '<aether>RAW STATE</aether>');
assert.match(context.isolation.display, /<style>/);
assert.strictEqual(context.isolation.repairedHistory, '<aether>RAW STATE</aether>');
assert.match(context.isolation.stored, /<style>/, 'request recovery must not mutate storage');
assert.strictEqual(context.isolation.edited, 'manual edit');

// A regex copied into a preset remains editable in place, and switching the
// active preset activates only the new preset's copy.
vm.runInContext(`
  mode = 'tavern';
  promptPresets = {
    A: normalizePromptPreset('A', { mode: 'tavern', prompts: [], promptOrder: [], regexes: [{ id: 'bound-a', boundCustomId: 'source-a', boundCustomMode: 'tavern', findRegex: '/X/g', replaceString: 'old' }] }),
    B: normalizePromptPreset('B', { mode: 'tavern', prompts: [], promptOrder: [], regexes: [{ id: 'bound-b', findRegex: '/X/g', replaceString: 'B' }] }),
  };
  prefs = { currentPresetByMode: { tavern: 'A' }, outputRegex: { tavern: [
    // A 的绑定副本编辑后，原规则仍受 A 的预设作用域约束；切到 B 时不能复活。
    { id: 'source-a', findRegex: '/B/g', replaceString: 'source', presetScope: 'A' },
  ] } };
  const edited = savePresetRegexRule('bound-a', { name: 'A edited', findRegex: '/X/g', replaceString: 'A', stages: ['ai_response'], trimStrings: [], onlyFormatDisplay: false, onlyFormatPrompt: false, substituteRegex: 1, runOnEdit: false, minDepth: null, maxDepth: null });
  globalThis.presetEditing = { edited, rule: promptPresets.A.regexes[0] };
  globalThis.presetSwitch = applyOutputRegex('X');
  prefs.currentPresetByMode.tavern = 'B';
  globalThis.presetSwitchAfter = applyOutputRegex('X');
`, context);
assert.strictEqual(context.presetEditing.edited.replaceString, 'A');
assert.strictEqual(context.presetEditing.rule.boundCustomId, 'source-a');
assert.strictEqual(context.presetSwitch, 'A');
assert.strictEqual(context.presetSwitchAfter, 'B');

// The prompt settings page must be able to detach both custom-bound and
// ST-imported embedded preset regexes, and the action must persist immediately.
vm.runInContext(`
  document.getElementById = () => null;
  mode = 'tavern';
  prefs = { outputRegex: { tavern: [
    { id: 'source-a', name: '来源 A', findRegex: '/X/g', replaceString: 'source' },
  ] } };
  promptPresets = {
    A: normalizePromptPreset('A', { mode: 'tavern', prompts: [], promptOrder: [], regexes: [
      { id: 'bound-a', boundCustomId: 'source-a', boundCustomMode: 'tavern', findRegex: '/X/g', replaceString: 'edited source' },
      { id: 'embedded-a', findRegex: '/Y/g', replaceString: 'edited embedded' },
    ] }),
  };
  pgEditingName = 'A';
  pgEditingPreset = normalizePromptPreset('A', promptPresets.A);
  togglePGRegexBinding('source-a', false, 'tavern');
  globalThis.afterCustomDetach = {
    presetCount: pgEditingPreset.regexes.length,
    storedCount: promptPresets.A.regexes.length,
    custom: prefs.outputRegex.tavern.map(rule => ({ id: rule.id, replaceString: rule.replaceString })),
  };
  togglePGPresetRegex('embedded-a', false, 'tavern');
  globalThis.afterEmbeddedDetach = {
    presetCount: pgEditingPreset.regexes.length,
    storedCount: promptPresets.A.regexes.length,
    custom: prefs.outputRegex.tavern.map(rule => ({ id: rule.id, replaceString: rule.replaceString })),
  };
`, context);
assert.strictEqual(context.afterCustomDetach.presetCount, 1);
assert.strictEqual(context.afterCustomDetach.storedCount, 1);
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.afterCustomDetach.custom)), [
  { id: 'source-a', replaceString: 'edited source' },
]);
assert.strictEqual(context.afterEmbeddedDetach.presetCount, 0);
assert.strictEqual(context.afterEmbeddedDetach.storedCount, 0);
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.afterEmbeddedDetach.custom)), [
  { id: 'source-a', replaceString: 'edited source' },
  { id: 'embedded-a', replaceString: 'edited embedded' },
]);
