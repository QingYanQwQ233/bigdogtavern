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
