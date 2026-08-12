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
  window: {}, document: {}, Date, Math, JSON, Set,
});

const source = fs.readFileSync('public/app.js', 'utf8').replace(/\ninit\(\);\s*$/, '');
vm.runInContext(source, context);
vm.runInContext(`
  defaults = { gen: {}, rpg: {} };
  promptPresets = {}; formatInstructions = {}; lorebooks = {}; userData = null;
  prefs = { currentPreset: '', formatPreset: '', formatCustom: '' };
  settings = { systemPrompt: '', postHistory: '', history: 20 };
  mode = 'tavern';
  characters = [{
    id: 'c', name: '霜铃', race: '狐族', role: '学者', persona: '', scenario: '',
    profileFields: [{ key: 'weakness', label: '弱点', value: '怕水' }],
  }];
  currentCharId = 'c'; currentSessionId = 's';
  sessions = [{ id: 's', charId: 'c', kind: 'tavern', messages: [] }];
  const card = charToV2(characters[0]);
  const imported = v2ToChar(card);
  globalThis.result = {
    prompt: buildPromptBlocks().system,
    fields: imported.profileFields,
    zero: normalizeCharProfileFields([{ key: 'age', label: '年龄', value: 0 }])[0].value,
  };
`, context);

assert.match(context.result.prompt, /弱点：怕水/);
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.result.fields)), [{ key: 'weakness', label: '弱点', value: '怕水' }]);
assert.strictEqual(context.result.zero, '0');
console.log('character fields check passed');
