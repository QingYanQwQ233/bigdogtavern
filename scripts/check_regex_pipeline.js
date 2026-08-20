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
