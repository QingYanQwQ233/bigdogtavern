'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const storage = new Map();
const context = vm.createContext({
  console,
  atob,
  TextDecoder,
  Uint8Array,
  DataView,
  Buffer,
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

vm.runInContext(`
  const v3 = {
    spec: 'chara_card_v3', spec_version: '3.0',
    data: {
      name: 'V3 测试角色', description: '来自 V3 的角色描述', personality: '谨慎但温柔',
      first_mes: '欢迎。', mes_example: '<START>\\n{{user}}: 你好\\n{{char}}: 请坐。',
      alternate_greetings: ['备用开场'], tags: ['v3', 'roundtrip'], creator: 'tester',
      character_version: '2.1', creator_notes: '保留备注',
      extensions: { tavern: { race: '狐族', role: '向导', profileFields: [{ key: 'age', label: '年龄', value: '21' }], customFlag: true } },
      character_book: { name: '角色专属书', scan_depth: 1, entries: [
        { keys: ['潮汐'], secondary_keys: ['港口'], content: '专属设定', constant: true },
        { keys: ['秘密[0-9]+'], content: '正则设定', use_regex: true, insertion_order: 10, constant: false },
        { keys: ['核心'], secondary_keys: ['钥匙'], content: '选择性设定', selective: true, insertion_order: 20, constant: false },
      ] },
      assets: [{ type: 'icon', name: 'main', uri: '/assets/v3.png' }], unknownField: { keep: true },
    },
  };
  const importedV3 = characterFromCard(v3);
  const roundtripV3 = charToV3(importedV3);
  const embedded = normalizeCharacterBookEntries(importedV3.characterBook);
  globalThis.v3Result = { importedV3, roundtripV3, embedded };
`, context);
assert.strictEqual(context.v3Result.importedV3.description, '来自 V3 的角色描述');
assert.strictEqual(context.v3Result.importedV3.personality, '谨慎但温柔');
assert.strictEqual(context.v3Result.importedV3.refImage, '/assets/v3.png');
assert.strictEqual(context.v3Result.roundtripV3.spec, 'chara_card_v3');
assert.strictEqual(context.v3Result.roundtripV3.data.unknownField.keep, true);
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.v3Result.roundtripV3.data.alternate_greetings)), ['备用开场']);
assert.strictEqual(context.v3Result.embedded[0].keys, '潮汐, 港口');
assert.strictEqual(context.v3Result.roundtripV3.data.character_book.entries[0].content, '专属设定');
vm.runInContext(`
  globalThis.extensionOnlyCard = characterFromCard({ data: {
    name: '扩展书卡', extensions: { tavern: { character_book: { entries: [{ keys: ['扩展'], content: '扩展角色书' }] } } },
  } });
`, context);
assert.strictEqual(context.extensionOnlyCard.characterBook.entries[0].content, '扩展角色书');
vm.runInContext("globalThis.wrappedBook = characterBookValue(JSON.stringify({ spec: 'lorebook_v3', data: { entries: [{ keys: ['包装'], content: '包装条目' }] } }));", context);
assert.strictEqual(context.wrappedBook.entries[0].content, '包装条目');
vm.runInContext(`
  lorebooks = { default: { name: '默认', entries: [] } };
  const cardCharacter = { id: 'card-import', name: '卡片角色', characterBook: { entries: [{ keys: ['卡片'], content: '卡片世界设定', constant: true }] } };
  const firstBook = registerCharacterBookLorebook(cardCharacter);
  const secondCharacter = { id: 'card-import-again', name: '卡片角色', characterBook: cardCharacter.characterBook };
  const secondBook = registerCharacterBookLorebook(secondCharacter);
  const stBook = normalizeImportedLorebook({ name: 'ST 测试书', entries: {
    '0': { uid: 7, key: ['青石镇'], keysecondary: ['夜雨'], comment: '地点', content: 'ST 内容', order: 12, disable: false },
  } }, 'fallback');
  globalThis.lorebookImportResult = { firstBook, secondBook, cardCharacter, secondCharacter, stBook };
`, context);
assert.strictEqual(context.lorebookImportResult.firstBook.created, true);
assert.strictEqual(context.lorebookImportResult.secondBook.created, false);
assert.strictEqual(context.lorebookImportResult.firstBook.id, context.lorebookImportResult.secondBook.id);
assert.strictEqual(context.lorebookImportResult.cardCharacter.characterBookLoreId, context.lorebookImportResult.firstBook.id);
assert.strictEqual(context.lorebookImportResult.stBook.name, 'ST 测试书');
assert.strictEqual(context.lorebookImportResult.stBook.entries[0].keys, '青石镇, 夜雨');
assert.strictEqual(context.lorebookImportResult.stBook.entries[0].title, '地点');
assert.strictEqual(context.lorebookImportResult.stBook.entries[0].order, 12);
vm.runInContext(`
  mode = 'tavern'; currentWorldSave = null; currentWorldSaveId = null;
  characters = [{ id: 'nested-book-card', name: '嵌套世界书卡', loreId: 'nested-st' }]; currentCharId = 'nested-book-card';
  sessions = [{ id: 'nested-book-session', charId: currentCharId, kind: 'tavern', messages: [{ role: 'user', content: '嵌套触发词' }] }]; currentSessionId = 'nested-book-session';
  lorebooks = { default: { name: '默认', entries: [] }, 'nested-st': { worldInfo: { entries: { '0': { key: ['嵌套触发词'], content: '嵌套 ST 世界书' } } } } };
  prefs = { activeLoreId: 'default', wiScanDepth: 20, wiWholeWord: false };
  globalThis.nestedStPrompt = buildWorldInfo();
`, context);
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.nestedStPrompt)), ['嵌套 ST 世界书']);
vm.runInContext(`
  globalThis.extendedStBook = normalizeImportedLorebook({ entries: {
    '0': { key: ['雾港'], keysecondary: ['钟声'], content: '高级条目', extensions: {
      depth: 2, position: 1, probability: 50, group: '港口', group_weight: 30, scan_depth: 3,
      case_sensitive: true, sticky: 2, cooldown: 1, delay: 1, role: 'user',
    } },
  } });
`, context);
const extendedEntry = context.extendedStBook.entries[0];
assert.deepStrictEqual(JSON.parse(JSON.stringify(extendedEntry.primaryKeys)), ['雾港']);
assert.strictEqual(extendedEntry.secondaryKeys[0], '钟声');
assert.strictEqual(extendedEntry.depth, 2);
assert.strictEqual(extendedEntry.position, 1);
assert.strictEqual(extendedEntry.probability, 50);
assert.strictEqual(extendedEntry.group, '港口');
assert.strictEqual(extendedEntry.groupWeight, 30);
assert.strictEqual(extendedEntry.scanDepth, 3);
assert.strictEqual(extendedEntry.caseSensitive, true);
assert.strictEqual(extendedEntry.role, 'user');
vm.runInContext(`
  lorebooks = { default: { name: '默认', entries: [] } };
  characters = [{ id: 'legacy-card', name: '旧卡', characterBook: { entries: [{ keys: [], content: '旧卡书', constant: true }] } }];
  ensureCharacterBookLorebooks();
  globalThis.legacyBookMigration = { characterBookLoreId: characters[0].characterBookLoreId, count: Object.keys(lorebooks).length };
`, context);
assert.ok(context.legacyBookMigration.characterBookLoreId);
assert.strictEqual(context.legacyBookMigration.count, 2);
vm.runInContext(`
  delete lorebooks[characters[0].characterBookLoreId];
  ensureCharacterBookLorebooks();
  globalThis.deletedBookStaysDeleted = Object.keys(lorebooks).length;
`, context);
assert.strictEqual(context.deletedBookStaysDeleted, 1);
vm.runInContext(`
  mode = 'tavern'; currentWorldSave = null; currentWorldSaveId = null;
  const selectedCard = lorebookImportResult.cardCharacter;
  lorebooks = { default: { name: '默认', entries: [] }, [lorebookImportResult.firstBook.id]: { name: lorebookImportResult.firstBook.name, entries: normalizeCharacterBookEntries(selectedCard.characterBook), source: { type: 'character-card', fingerprint: 'test' } } };
  selectedCard.loreId = lorebookImportResult.firstBook.id;
  characters = [selectedCard]; currentCharId = selectedCard.id;
  sessions = [{ id: 'card-book-session', charId: selectedCard.id, kind: 'tavern', messages: [] }]; currentSessionId = 'card-book-session';
  prefs = { activeLoreId: 'default', wiScanDepth: 20, wiWholeWord: false };
  globalThis.selectedCardWorldInfo = buildWorldInfo();
`, context);
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.selectedCardWorldInfo)), ['卡片世界设定']);

vm.runInContext(`
  mode = 'tavern'; currentWorldSave = null; currentWorldSaveId = null;
  characters = [v3Result.importedV3]; currentCharId = v3Result.importedV3.id;
  sessions = [{ id: 'v3-session', charId: currentCharId, kind: 'tavern', messages: [{ role: 'user', content: '潮汐' }, { role: 'user', content: '秘密42 核心' }] }];
  currentSessionId = 'v3-session';
  lorebooks = { default: { name: '默认', entries: [] } };
  prefs = { activeLoreId: 'default', wiScanDepth: 20, wiWholeWord: false };
  globalThis.characterBookPrompt = buildWorldInfo();
`, context);
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.characterBookPrompt)), ['专属设定', '正则设定']);
vm.runInContext("sessions[0].messages[1].content = '秘密42 核心 钥匙'; characterBookPrompt = buildWorldInfo();", context);
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.characterBookPrompt)), ['专属设定', '正则设定', '选择性设定']);

vm.runInContext(`
  // SillyTavern 预设可以完全不声明 worldInfoBefore/After；角色书仍必须进入唯一 system。
  promptPresets = { '无世界书槽': {
    version: 2, mode: 'tavern',
    prompts: [{ identifier: 'main', name: '主提示词', role: 'system', content: '基础指令', marker: true }],
    promptOrder: [{ identifier: 'main', enabled: true }],
  } };
  prefs = { currentPresetByMode: { tavern: '无世界书槽' }, activeLoreId: '', wiScanDepth: 20, wiWholeWord: false };
  settings = { baseUrl: 'https://example.test/v1', apiKey: '', model: 'test', maxTokens: 128, history: 20 };
  const oldCard = { id: 'old-card', name: '旧卡', characterBook: { entries: [] }, cardData: { character_book: {
    entries: [{ keys: [], content: '旧卡固定世界书', constant: true }],
  } } };
  characters = [oldCard]; currentCharId = oldCard.id;
  sessions = [{ id: 'old-session', charId: oldCard.id, kind: 'tavern', messages: [] }]; currentSessionId = 'old-session';
  lorebooks = {};
  globalThis.fallbackPayload = buildPayload();
`, context);
const fallbackMessages = JSON.parse(JSON.stringify(context.fallbackPayload.body.messages));
assert.strictEqual(context.fallbackPayload.wi[0], '旧卡固定世界书');
assert.match(fallbackMessages[0].content, /旧卡固定世界书/);

const pngCard = { spec: 'chara_card_v3', spec_version: '3.0', data: {
  name: 'PNG V3 世界书',
  extensions: { tavern: { characterBook: { entries: [{ keys: ['PNG 秘密'], content: 'PNG 角色书' }] } } },
  character_book: { entries: [{ keys: ['PNG 核心'], content: 'PNG 标准角色书', constant: true }] },
} };
const cardB64 = Buffer.from(JSON.stringify(pngCard), 'utf8').toString('base64');
const payload = Buffer.from('ccv3\0' + cardB64, 'latin1');
const chunk = Buffer.alloc(payload.length + 12);
chunk.writeUInt32BE(payload.length, 0); chunk.write('tEXt', 4, 4, 'ascii'); payload.copy(chunk, 8);
const iend = Buffer.alloc(12); iend.write('IEND', 4, 4, 'ascii');
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk, iend]);
const pngText = vm.runInContext('characterCardTextFromBuffer(new Uint8Array(pngBuffer).buffer)', Object.assign(context, { pngBuffer: png }));
const parsedPngCard = JSON.parse(pngText);
assert.strictEqual(parsedPngCard.data.name, 'PNG V3 世界书');
const importedPng = vm.runInContext('characterFromCard(pngCardInput)', Object.assign(context, { pngCardInput: parsedPngCard }));
assert.strictEqual(importedPng.characterBook.entries[0].content, 'PNG 标准角色书');

// iTXt + 原文 JSON 兼容：部分制卡工具不会使用 tEXt/base64。
const itxtText = Buffer.from(JSON.stringify(pngCard), 'utf8');
const itxtPayload = Buffer.concat([Buffer.from('ccv3\0\0\0\0\0', 'latin1'), itxtText]);
const itxtChunk = Buffer.alloc(itxtPayload.length + 12);
itxtChunk.writeUInt32BE(itxtPayload.length, 0); itxtChunk.write('iTXt', 4, 4, 'ascii'); itxtPayload.copy(itxtChunk, 8);
const pngItxt = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), itxtChunk, iend]);
const itxtCard = JSON.parse(vm.runInContext('characterCardTextFromBuffer(new Uint8Array(pngItxtBuffer).buffer)', Object.assign(context, { pngItxtBuffer: pngItxt })));
assert.strictEqual(itxtCard.data.character_book.entries[0].content, 'PNG 标准角色书');

const list = {
  children: [],
  set innerHTML(value) { this.children = []; },
  appendChild(child) { this.children.push(child); },
};
const worldLoreHost = { innerHTML: '', querySelectorAll: () => [] };
context.document.getElementById = id => id === 'cm-list' ? list : (id === 'cm-name' ? { value: '' } : (id === 'world-draft-lorebooks' ? worldLoreHost : null));
vm.runInContext(`
  lorebooks = { default: { name: '默认世界书', entries: [] }, 'lore-test': { name: '测试世界书', entries: [] } };
  renderWorldDraftLorebookOptions(['lore-test', 'missing-book']);
`, context);
assert.match(worldLoreHost.innerHTML, /测试世界书/);
assert.match(worldLoreHost.innerHTML, /缺失引用/);
worldLoreHost.querySelectorAll = selector => selector.includes(':checked') ? [{ value: 'lore-test' }, { value: 'missing-book' }] : [];
assert.deepStrictEqual(JSON.parse(JSON.stringify(vm.runInContext('collectWorldDraftLorebookIds()', context))), ['lore-test', 'missing-book']);
context.document.createElement = () => ({ className: '', innerHTML: '', addEventListener() {} });
vm.runInContext(`
  characters = [{ id: 'saved', name: '已保存角色' }];
  currentCharId = 'saved'; cmEditingId = null; cmCreating = true;
  renderCharList();
`, context);
assert.match(list.children[0].className, /active/);
assert.match(list.children[0].innerHTML, /新角色.*未保存/);
assert.doesNotMatch(list.children[1].className, /active/);
assert.match(list.children[1].innerHTML, /已保存角色.*使用中/);
console.log('character fields check passed');
