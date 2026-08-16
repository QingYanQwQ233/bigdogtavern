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
vm.runInContext(source, context);
vm.runInContext(`
  defaults = { gen: {}, rpg: {} };
  mode = 'tavern';
  prefs = { outputRegex: {
    tavern: [{ id: 'custom-tavern', name: '去掉标记', findRegex: '/\\\\[secret\\\\]/g', replaceString: '' }],
    rpg: [{ id: 'custom-rpg', name: 'RPG 标签', findRegex: '/<hidden>[\\\\s\\\\S]*?<\\\\/hidden>/g', replaceString: '' }],
  } };
  settings = { ...DEFAULT_SETTINGS };
  characters = [{ id: 'c', name: '测试角色', presetName: '带正则' }];
  currentCharId = 'c';
  currentWorldId = null;
  currentWorldSave = null;
  currentWorldSaveId = null;
  worldCards = [];
  worldCardVersions.clear();
  promptPresets = {
    '带正则': normalizePromptPreset('带正则', { mode: 'tavern', prompts: [], promptOrder: [], regexes: [
      { id: 'preset-hide', name: '隐藏 think', findRegex: '/<think>[\\\\s\\\\S]*?<\\\\/think>/g', replaceString: '' },
    ] }),
  };
  globalThis.check = {
    tavern: applyOutputRegex('正文<think>secret</think>[secret]保留'),
    matchMacro: applyOutputRegexRule('标签：秘密', { replaceString: '【{{match}}】', trimStrings: [] }, buildOutputRegex({ findRegex: '/秘密/g' })),
    converted: convertSTPresetData({
      prompts: [{ identifier: 'main', content: '' }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
      extensions: { regex_scripts: [{ id: 'st-hide', findRegex: '/\\[x\\]/g', replaceString: '' }] },
    }),
    rpg: (() => { mode = 'rpg'; promptPresets = { 'RPG': normalizePromptPreset('RPG', { mode: 'rpg', prompts: [], promptOrder: [], regexes: [] }) }; return applyOutputRegex('<hidden>secret</hidden>visible'); })(),
    world: (() => { currentWorldId = 'world'; currentWorldSave = { id: 'save', worldVersion: 1 }; currentWorldSaveId = 'save'; worldCards = [{ id: 'world', version: 1, regexes: [{ id: 'world-hide', name: '世界规则', findRegex: '/<world>[\\\\s\\\\S]*?<\\\\/world>/g', replaceString: '' }] }]; worldCardVersions.set('world@1', worldCards[0]); return applyOutputRegex('<world>secret</world><hidden>also</hidden>visible'); })(),
  };
`, context);

assert.strictEqual(context.check.tavern, '正文保留');
assert.strictEqual(context.check.matchMacro, '标签：【秘密】');
assert.strictEqual(context.check.converted.report.regexes, 1);
assert.strictEqual(context.check.converted.preset.regexes[0].id, 'st-hide');
assert.strictEqual(context.check.rpg, 'visible');
assert.strictEqual(context.check.world, 'visible');

console.log('output regex check passed');
