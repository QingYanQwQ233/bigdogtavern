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
  characters = [{ id: 'c', name: '测试角色', presetName: '带正则', cardExtensions: { regex_scripts: [
    { id: 'card-html', scriptName: '卡片 HTML', findRegex: '/<状态>([\\\\s\\\\S]*?)<\\\\/状态>/g', replaceString: '<strong>$1</strong>', placement: [1, 2] },
  ] } }];
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
    character: applyOutputRegex('<状态>在线</状态>'),
    legacyCharacter: applyCharacterCardOutputRegex('<状态>在线</状态>'),
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
assert.strictEqual(context.check.character, '<strong>在线</strong>');
assert.strictEqual(context.check.legacyCharacter, '<strong>在线</strong>');
assert.strictEqual(context.check.matchMacro, '标签：【秘密】');
assert.strictEqual(context.check.converted.report.regexes, 1);
assert.strictEqual(context.check.converted.preset.regexes[0].id, 'st-hide');
assert.strictEqual(context.check.rpg, 'visible');
assert.strictEqual(context.check.world, 'visible');

// V3 风格的长状态栏正则：多行标签也必须在首次响应时转成卡片 HTML。
// 运行时角色库被 .gitignore 排除（其中可能包含 API Key）；测试使用仓库内的最小夹具。
const simulatorCard = Object.values(require('./fixtures/output-regex-character.json')).find(item => item.name === '人生模拟器，我进入了诡异修仙界');
assert.ok(simulatorCard, 'simulator character card fixture should exist');
vm.runInContext(`characters = ${JSON.stringify([simulatorCard])}; currentCharId = ${JSON.stringify(simulatorCard.id)}; mode = 'tavern';`, context);
const simulatorRaw = [
  '<姓名>五气</姓名>', '<寿命>16/150</寿命>', '<修为>凡人</修为>', '<灵根>待觉醒</灵根>',
  '<地点>徐州城</地点>', '<灵石>0</灵石>', '<装备>无</装备>', '<功法>无</功法>', '<技艺>无</技艺>',
  '<关系>无</关系>', '<天赋>无</天赋>', '<资产>无</资产>', '<模拟器剩余次数>3</模拟器剩余次数>',
  '<模拟器已模拟次数>0</模拟器已模拟次数>', '<模拟器等级>1</模拟器等级>', '<当前模拟所需货币>0</当前模拟所需货币>',
  '<人生选择>A. 选项一\nB. 选项二\nC. 选项三\nD. 选项四</人生选择>', '<正文>正文内容</正文>',
].join('\n');
const simulatorHtml = vm.runInContext(`applyCharacterCardOutputRegex(${JSON.stringify(simulatorRaw)})`, context);
assert.ok(simulatorHtml.includes('<div style='), 'long card regex should produce HTML');
assert.ok(!simulatorHtml.includes('<姓名>'), 'long card regex should hide raw state tags');

const simulatorPartial = simulatorRaw.split('<装备>')[0];
const simulatorFallback = vm.runInContext(`applyCharacterCardOutputRegex(${JSON.stringify(simulatorPartial)})`, context);
assert.ok(simulatorFallback.includes('tavern-tag-field'), 'partial card output should use a structured fallback');
assert.ok(!simulatorFallback.includes('<姓名>'), 'partial card output should hide raw state tags');
const simulatorLegacyRender = vm.runInContext(`renderOutputContent(${JSON.stringify(simulatorPartial)}, 'tavern')`, context);
assert.ok(simulatorLegacyRender.includes('tavern-tag-field'), 'legacy messages should retry the active output rules before fallback');

console.log('output regex check passed');
