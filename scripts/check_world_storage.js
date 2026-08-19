'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const MapGen = require(path.join(root, 'public', 'mapgen.js'));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-world-'));
const defaults = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', '_defaults.json'), 'utf8'));
// This suite exercises storage/versioning; keep its fixture's opening static so
// revision assertions remain focused on the APIs under test. AI planning is
// covered by check_player_creation.js.
defaults.worlds[0].start = { ...(defaults.worlds[0].start || {}), openingMode: 'static' };
defaults.worlds[0].npcIds = ['npc-lily'];
defaults.worlds[0].npcs = [{ id: 'npc-lily', name: 'Lily', role: 'innkeeper', secrets: [{ id: 'story-secret', content: 'narrative content' }] }];
defaults.worlds[0].locations.push({ id: 'region-2', name: 'Region Two', type: 'region' });
defaults.worlds[0].characterIds = ['char-export'];
defaults.worlds[0].coverImage = 'https://example.invalid/aurora-cover.png';
defaults.worlds[0].source = { ...(defaults.worlds[0].source || {}), rawAssetRef: 'https://cdn.invalid/world.png?token=secret-url-token' };
defaults.worlds[0].ui = { ...(defaults.worlds[0].ui || {}), slots: {
  narrative: { visible: true },
  options: { visible: false },
  input: { visible: false, label: '卡内输入' },
} };
defaults.characters = [{
  id: 'char-export', name: 'Export Character', loreId: 'default', presetName: 'RPG 叙事引擎（示例）',
  refImage: 'C:\\private\\character.png', openai_api_key: 'character-export-secret', hf_token: 'custom-token-secret',
}];
defaults.settings.apiKey = 'settings-export-secret';
defaults.worlds.push({
  ...defaults.worlds[0],
  id: 'world-second',
  title: '第二个世界',
  start: { ...defaults.worlds[0].start, locationId: 'second-start' },
  locations: [...defaults.worlds[0].locations, { id: 'second-start', name: 'Second Start', type: 'region' }],
});
fs.writeFileSync(path.join(tempDir, '_defaults.json'), JSON.stringify(defaults, null, 2));
fs.writeFileSync(path.join(tempDir, 'worlds.json'), JSON.stringify(defaults.worlds, null, 2));
process.env.TAVERN_DATA_DIR = tempDir;

const { server, startServer } = require(path.join(root, 'server.js'));

function closeServer() {
  return new Promise(resolve => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
  });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

function packageHash(pkg) {
  return 'sha256:' + crypto.createHash('sha256').update(canonicalJson({ content: pkg.content, assets: pkg.assets })).digest('hex');
}

async function jsonRequest(base, pathname, options) {
  const response = await fetch(base + pathname, options);
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function main() {
  try {
    const generatedMap = MapGen.generateWorldMap(7, { size: 24, regionCount: 4 });
    const serializedMap = MapGen.serializeMap(generatedMap);
    assert.ok(Array.isArray(serializedMap.grid), 'map grid crosses JSON boundary as an array');
    const hydratedMap = MapGen.hydrateMap(serializedMap);
    assert.ok(hydratedMap.grid instanceof Uint16Array, 'map grid hydrates to Uint16Array');
    assert.deepStrictEqual(Array.from(hydratedMap.grid), Array.from(generatedMap.grid));
    const sparseLand = MapGen.generateWorldMap(11, { size: 48, regionCount: 6, landRatio: 0.3 });
    const broadLand = MapGen.generateWorldMap(11, { size: 48, regionCount: 6, landRatio: 0.75 });
    const landPixels = map => map.grid.reduce((count, value) => count + (value ? 1 : 0), 0);
    assert.ok(landPixels(broadLand) > landPixels(sparseLand), 'landRatio changes generated land coverage');
    await startServer(0);
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;

    const worlds = await jsonRequest(base, '/api/worlds');
    assert.strictEqual(worlds.response.status, 200);
    assert.ok(Array.isArray(worlds.body) && worlds.body.length >= 1);
    const world = worlds.body.find(item => item.id === 'world-aurora');
    assert.ok(world, 'seed world is listed');
    const secondWorld = worlds.body.find(item => item.id === 'world-second');
    assert.ok(secondWorld, 'second world is listed');

    const worldExport = await jsonRequest(base, `/api/worlds/${encodeURIComponent(world.id)}/export?version=${world.version}`);
    assert.strictEqual(worldExport.response.status, 200);
    assert.match(worldExport.response.headers.get('content-disposition') || '', /\.tavern-world\.json/);
    assert.strictEqual(worldExport.body.spec, 'tavern_world_package');
    assert.strictEqual(worldExport.body.specVersion, 1);
    assert.strictEqual(worldExport.body.manifest.appContractVersion, 1);
    assert.strictEqual(worldExport.body.manifest.capabilities.ui.layout, 'world-desk');
    assert.deepStrictEqual(worldExport.body.manifest.capabilities.ui.slots, ['narrative', 'options', 'input']);
    assert.strictEqual(worldExport.body.manifest.capabilities.references.preset, true);
    assert.strictEqual(worldExport.body.content.world.id, world.id);
    assert.strictEqual(worldExport.body.content.world.ui.slots.input.visible, false);
    assert.deepStrictEqual(worldExport.body.content.characters.map(character => character.id), ['char-export']);
    assert.deepStrictEqual(Object.keys(worldExport.body.content.lorebooks), ['default']);
    assert.deepStrictEqual(Object.keys(worldExport.body.content.presets), ['RPG 叙事引擎（示例）']);
    assert.strictEqual(worldExport.body.manifest.references.assets, 1);
    assert.strictEqual(worldExport.body.assets[0].status, 'external', 'external assets are listed without being fetched');
    assert.match(worldExport.body.manifest.contentHash, /^sha256:[a-f0-9]{64}$/);
    assert.ok(worldExport.body.manifest.privacy.redactedPaths.includes('content.characters[0].refImage'));
    assert.ok(worldExport.body.manifest.privacy.redactedPaths.includes('content.characters[0].openai_api_key'));
    assert.ok(worldExport.body.manifest.privacy.redactedPaths.includes('content.characters[0].hf_token'));
    assert.ok(worldExport.body.manifest.privacy.redactedPaths.includes('content.world.source.rawAssetRef'));
    assert.strictEqual(worldExport.body.content.world.npcs[0].secrets[0].content, 'narrative content', 'world narrative secrets are content, not credentials');
    const exportedText = JSON.stringify(worldExport.body);
    assert.ok(!exportedText.includes('character-export-secret') && !exportedText.includes('settings-export-secret')
      && !exportedText.includes('custom-token-secret') && !exportedText.includes('secret-url-token'), 'world package excludes credentials');
    assert.ok(!Object.hasOwn(worldExport.body.content, 'settings') && !Object.hasOwn(worldExport.body.content, 'worldSaves'), 'world package excludes settings and saves');
    const repeatedExport = await jsonRequest(base, `/api/worlds/${encodeURIComponent(world.id)}/export?version=${world.version}`);
    assert.strictEqual(repeatedExport.body.manifest.contentHash, worldExport.body.manifest.contentHash, 'content hash is deterministic across exports');
    const invalidExportVersion = await jsonRequest(base, `/api/worlds/${encodeURIComponent(world.id)}/export?version=0`);
    assert.strictEqual(invalidExportVersion.response.status, 400);
    const importPackage = JSON.parse(JSON.stringify(worldExport.body));
    importPackage.sidecars = { customScript: 'alert("never execute")' };
    importPackage.content.lorebooks.default.entries.push({ id: 'import-regex', title: 'Regex', keys: '/aurora/i', content: 'kept but disabled', enabled: true });
    importPackage.manifest.contentHash = packageHash(importPackage);
    const importPreview = await jsonRequest(base, '/api/world-imports', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: JSON.stringify(importPackage) }),
    });
    assert.strictEqual(importPreview.response.status, 201);
    assert.strictEqual(importPreview.body.status, 'pending');
    assert.ok(importPreview.body.report.canImport);
    assert.ok(importPreview.body.report.unknownTopLevelKeys.includes('sidecars'));
    assert.ok(importPreview.body.report.inertPaths.includes('sidecars.customScript'));
    assert.strictEqual(importPreview.body.report.disabledRegexEntries, 1);
    assert.ok(fs.existsSync(path.join(tempDir, 'world-imports', importPreview.body.id + '.json')), 'raw package is sealed before confirmation');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(tempDir, 'world-imports', importPreview.body.id + '.json'), 'utf8')).raw, JSON.stringify(importPackage), 'sealed package preserves the exact raw text');
    const importRead = await jsonRequest(base, '/api/world-imports/' + encodeURIComponent(importPreview.body.id));
    assert.strictEqual(importRead.response.status, 200);
    assert.strictEqual(importRead.body.rawHash, importPreview.body.rawHash);
    assert.ok(!Object.hasOwn(importRead.body, 'raw'), 'import API does not expose sealed package text');
    const imported = await jsonRequest(base, '/api/world-imports/' + encodeURIComponent(importPreview.body.id), { method: 'POST' });
    assert.strictEqual(imported.response.status, 201);
    assert.strictEqual(imported.body.idempotent, false);
    assert.notStrictEqual(imported.body.world.id, world.id, 'import always gets an isolated world ID');
    const originalWorldAfterImport = await jsonRequest(base, `/api/worlds/${encodeURIComponent(world.id)}?version=${world.version}`);
    assert.strictEqual(originalWorldAfterImport.response.status, 200);
    assert.strictEqual(originalWorldAfterImport.body.id, world.id, 'import never overwrites the source world');
    const importedWorld = await jsonRequest(base, `/api/worlds/${encodeURIComponent(imported.body.world.id)}?version=1`);
    assert.strictEqual(importedWorld.response.status, 200);
    assert.strictEqual(importedWorld.body.importInfo.importId, importPreview.body.id);
    assert.strictEqual(importedWorld.body.importInfo.rawHash, importPreview.body.rawHash);
    assert.ok(importedWorld.body.lorebookIds[0].startsWith('imp-lore-'), 'fallback default lorebook is isolated per imported world');
    assert.ok(importedWorld.body.characterIds[0].startsWith('imp-char-'), 'world character binding is remapped into its import namespace');
    const importedCharacters = await jsonRequest(base, '/api/data/characters');
    const importedCharacter = importedCharacters.body.find(character => character.importInfo?.importId === importPreview.body.id);
    assert.ok(importedCharacter && importedCharacter.id === importedWorld.body.characterIds[0]);
    assert.ok(importedCharacters.body.some(character => character.id === 'char-export' && !character.importInfo), 'local character remains separate from imported copy');
    const importedLorebooks = await jsonRequest(base, '/api/data/lorebooks');
    assert.strictEqual(importedLorebooks.body[importedWorld.body.lorebookIds[0]].importInfo.importId, importPreview.body.id);
    assert.strictEqual(importedLorebooks.body[importedWorld.body.lorebookIds[0]].entries.find(entry => entry.id === 'import-regex').enabled, false, 'imported regex remains inert until reviewed');
    const importedPresets = await jsonRequest(base, '/api/data/presets');
    assert.ok(Object.values(importedPresets.body).some(preset => preset.importInfo?.importId === importPreview.body.id));

    const legacyPackage = JSON.parse(JSON.stringify(worldExport.body));
    delete legacyPackage.manifest.appContractVersion;
    delete legacyPackage.manifest.capabilities;
    for (const key of ['ui', 'runtime', 'agent', 'regexes']) delete legacyPackage.content.world[key];
    legacyPackage.manifest.contentHash = packageHash(legacyPackage);
    const legacyPreview = await jsonRequest(base, '/api/world-imports', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: JSON.stringify(legacyPackage) }),
    });
    assert.strictEqual(legacyPreview.response.status, 201, 'legacy world package remains importable');
    assert.strictEqual(legacyPreview.body.report.appContractVersion, 1);
    const legacyImported = await jsonRequest(base, '/api/world-imports/' + encodeURIComponent(legacyPreview.body.id), { method: 'POST' });
    assert.strictEqual(legacyImported.response.status, 201);
    const legacyWorld = await jsonRequest(base, `/api/worlds/${encodeURIComponent(legacyImported.body.world.id)}?version=1`);
    assert.deepStrictEqual(legacyWorld.body.ui, {}, 'legacy package gets a default UI declaration during mapping');
    assert.deepStrictEqual(legacyWorld.body.runtime, {}, 'legacy package gets a default runtime schema during mapping');
    assert.deepStrictEqual(legacyWorld.body.agent, {}, 'legacy package gets a default agent profile during mapping');
    assert.deepStrictEqual(legacyWorld.body.regexes, [], 'legacy package gets a default regex list during mapping');
    const duplicateImport = await jsonRequest(base, '/api/world-imports/' + encodeURIComponent(importPreview.body.id), { method: 'POST' });
    assert.strictEqual(duplicateImport.response.status, 200);
    assert.strictEqual(duplicateImport.body.idempotent, true, 'same sealed package commits idempotently');
    const tamperedPackage = JSON.parse(JSON.stringify(worldExport.body));
    tamperedPackage.content.world.title = 'Tampered World';
    const tamperedPreview = await jsonRequest(base, '/api/world-imports', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: JSON.stringify(tamperedPackage) }),
    });
    assert.strictEqual(tamperedPreview.response.status, 422);
    assert.ok(tamperedPreview.body.report.errors.includes('contentHash 校验失败'));
    const forbiddenContentPackage = JSON.parse(JSON.stringify(worldExport.body));
    forbiddenContentPackage.content.settings = { apiKey: 'must-not-import' };
    forbiddenContentPackage.manifest.contentHash = packageHash(forbiddenContentPackage);
    const forbiddenPreview = await jsonRequest(base, '/api/world-imports', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: JSON.stringify(forbiddenContentPackage) }),
    });
    assert.strictEqual(forbiddenPreview.response.status, 422);
    assert.ok(forbiddenPreview.body.report.errors.includes('世界包不得包含运行时设置或玩家存档'));
    const unsafeAssetPackage = JSON.parse(JSON.stringify(worldExport.body));
    unsafeAssetPackage.content.world.coverImage = 'data:image/svg+xml,<svg onload=alert(1)>';
    unsafeAssetPackage.manifest.contentHash = packageHash(unsafeAssetPackage);
    const unsafeAssetPreview = await jsonRequest(base, '/api/world-imports', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: JSON.stringify(unsafeAssetPackage) }),
    });
    assert.strictEqual(unsafeAssetPreview.response.status, 422);
    assert.ok(unsafeAssetPreview.body.report.errors.some(error => error.includes('content.world.coverImage')));
    const danglingReferencePackage = JSON.parse(JSON.stringify(worldExport.body));
    danglingReferencePackage.content.world.questTemplateIds = ['quest-template-1'];
    danglingReferencePackage.manifest.contentHash = packageHash(danglingReferencePackage);
    const danglingReferencePreview = await jsonRequest(base, '/api/world-imports', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: JSON.stringify(danglingReferencePackage) }),
    });
    assert.strictEqual(danglingReferencePreview.response.status, 422);
    assert.ok(danglingReferencePreview.body.report.errors.includes('questTemplateIds 尚无随世界包导入的定义'));
    const invalidSlotsPackage = JSON.parse(JSON.stringify(worldExport.body));
    invalidSlotsPackage.content.world.ui.slots.input.visible = 'yes';
    invalidSlotsPackage.manifest.contentHash = packageHash(invalidSlotsPackage);
    const invalidSlotsPreview = await jsonRequest(base, '/api/world-imports', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: JSON.stringify(invalidSlotsPackage) }),
    });
    assert.strictEqual(invalidSlotsPreview.response.status, 422);
    assert.ok(invalidSlotsPreview.body.report.errors.includes('ui.slots.input.visible 无效'));
    const sealedStaticRead = await fetch(base + '/data/world-imports/' + encodeURIComponent(importPreview.body.id) + '.json');
    assert.strictEqual(sealedStaticRead.status, 403, 'sealed raw packages are not exposed as static data');

    const noDrafts = await jsonRequest(base, '/api/world-drafts?worldId=' + encodeURIComponent(world.id));
    assert.strictEqual(noDrafts.response.status, 200);
    assert.deepStrictEqual(noDrafts.body, [], 'world drafts start empty');
    const draftCreated = await jsonRequest(base, '/api/world-drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: world.id, baseVersion: world.version }),
    });
    assert.strictEqual(draftCreated.response.status, 201);
    assert.strictEqual(draftCreated.body.worldId, world.id);
    assert.strictEqual(draftCreated.body.baseVersion, world.version);
    assert.strictEqual(draftCreated.body.world.title, '极光大陆');
    const duplicateDraft = await jsonRequest(base, '/api/world-drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: world.id, baseVersion: world.version }),
    });
    assert.strictEqual(duplicateDraft.response.status, 200, 'draft creation is idempotent');
    const newWorldDraft = await jsonRequest(base, '/api/world-drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'new', sourceWorldId: world.id, baseVersion: world.version }),
    });
    assert.strictEqual(newWorldDraft.response.status, 201, 'new world draft creates an independent draft');
    assert.strictEqual(newWorldDraft.body.kind, 'new');
    assert.notStrictEqual(newWorldDraft.body.worldId, world.id, 'new world draft gets a new world ID');
    assert.strictEqual(newWorldDraft.body.world.version, 1);
    const originalDraftAfterNew = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(world.id));
    assert.strictEqual(originalDraftAfterNew.body.world.title, '极光大陆', 'new draft does not open the source draft');
    const newWorldPublish = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(newWorldDraft.body.worldId) + '/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'publish-new-world-0001', expectedUpdatedAt: newWorldDraft.body.updatedAt, baseVersion: 1 }),
    });
    assert.strictEqual(newWorldPublish.response.status, 201, 'new world draft publishes as a new world card');
    assert.strictEqual(newWorldPublish.body.world.id, newWorldDraft.body.worldId);
    assert.strictEqual(newWorldPublish.body.world.version, 1);
    const publishedNewWorld = await jsonRequest(base, '/api/worlds/' + encodeURIComponent(newWorldDraft.body.worldId));
    assert.strictEqual(publishedNewWorld.response.status, 200);
    assert.strictEqual(publishedNewWorld.body.title, '极光大陆（新建）');
    const blankWorldDraft = await jsonRequest(base, '/api/world-drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'blank' }),
    });
    assert.strictEqual(blankWorldDraft.response.status, 201, 'blank world draft creates without a source card');
    assert.strictEqual(blankWorldDraft.body.kind, 'blank');
    assert.deepStrictEqual(blankWorldDraft.body.world.locations, []);
    assert.deepStrictEqual(blankWorldDraft.body.world.npcs, []);
    const blankWorldPublish = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(blankWorldDraft.body.worldId) + '/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'publish-blank-world-0001', expectedUpdatedAt: blankWorldDraft.body.updatedAt, baseVersion: 1 }),
    });
    assert.strictEqual(blankWorldPublish.response.status, 201, 'blank world draft publishes as a new world card');
    assert.strictEqual(blankWorldPublish.body.world.id, blankWorldDraft.body.worldId);
    assert.strictEqual(blankWorldPublish.body.world.version, 1);
    const draftLocations = [
      { id: 'wolf-tooth-inn', name: '断牙之角', type: 'inn', summary: '雨幕下的旅店', tags: ['安全区'] },
      { id: 'region-2', name: 'Region Two', type: 'region', summary: '', tags: [] },
    ];
    const draftNpcs = [{ id: 'npc-lily', name: 'Lily', role: 'innkeeper', locationId: 'wolf-tooth-inn', description: '旅店老板', publicFacts: ['认识本地客人'], publicGoals: [], secrets: [{ id: 'lily-secret', content: '保留的秘密' }] }];
    const draftMapGeneration = { seed: 67890, size: 96, regionCount: 12, landRatio: 0.62, mapgenSize: 'tiny' };
    const draftUpdate = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(world.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedUpdatedAt: draftCreated.body.updatedAt,
        baseVersion: world.version,
        title: '极光大陆（草稿）',
        summary: '草稿简介',
        tags: ['日式西幻', '草稿'],
        lorebookIds: ['default'],
        agent: { mode: 'tool-candidate', maxSteps: 2, tools: { 'rules.check': { enabled: true }, 'dice.roll': { enabled: true } } },
        ui: { layout: 'world-desk', sidebar: { panels: [{ id: 'relations', title: '人物关系', side: 'right', source: 'save.npcStates', layout: 'cards', fields: [{ key: 'locationId', label: '位置' }] }, { id: 'hooks', title: '开放 Hook', side: 'left', source: 'save.state.activeHooks', layout: 'table', fields: [{ key: 'status', label: '状态' }] }] } },
        regexes: [{ id: 'hide-state', name: '隐藏状态块', findRegex: '/<tavern_state_update>[\\s\\S]*?<\\/tavern_state_update>/gi', replaceString: '', enabled: true }],
        setting: { premise: '以契约维系的雨港边境。', history: '旧王国在三十年前分裂。', currentSituation: '港口正在封锁。' },
        rules: { hard: ['魔法必须有媒介。'], soft: ['居民优先遵守公开契约。'], checks: [{ id: 'notice', label: '观察', roll: '1d20', target: 10 }] },
        mapGeneration: draftMapGeneration,
        factions: [{ id: 'north-guild', name: 'North Guild', resources: [{ id: 'funds', label: 'Funds', min: 0, max: 100, initial: 40 }] }],
        events: [{ id: 'rain-warning', title: '雨势加剧', description: '山路即将封闭。', trigger: { locationId: 'wolf-tooth-inn' }, visibility: 'public', once: true }],
        locations: draftLocations,
        npcs: draftNpcs,
      }),
    });
    assert.strictEqual(draftUpdate.response.status, 200);
    assert.strictEqual(draftUpdate.body.world.title, '极光大陆（草稿）');
    assert.deepStrictEqual(draftUpdate.body.world.tags, ['日式西幻', '草稿']);
    assert.strictEqual(draftUpdate.body.world.setting.premise, '以契约维系的雨港边境。');
    assert.deepStrictEqual(draftUpdate.body.world.rules.hard, ['魔法必须有媒介。']);
    assert.strictEqual(draftUpdate.body.world.rules.checks[0].id, 'notice');
    assert.strictEqual(draftUpdate.body.world.agent.mode, 'tool-candidate');
    assert.strictEqual(draftUpdate.body.world.agent.maxSteps, 2);
    assert.strictEqual(draftUpdate.body.world.ui.sidebar.panels[0].source, 'save.npcStates');
    assert.strictEqual(draftUpdate.body.world.ui.sidebar.panels[1].source, 'save.state.activeHooks');
    assert.strictEqual(draftUpdate.body.world.ui.sidebar.panels[1].layout, 'table');
    assert.strictEqual(draftUpdate.body.world.regexes[0].id, 'hide-state');
    assert.deepStrictEqual(draftUpdate.body.world.locations, draftLocations);
    assert.deepStrictEqual(draftUpdate.body.world.npcs, draftNpcs);
    assert.deepStrictEqual(draftUpdate.body.world.npcIds, ['npc-lily']);
    assert.deepStrictEqual(draftUpdate.body.world.map.generation, draftMapGeneration);
    assert.strictEqual(draftUpdate.body.world.factions[0].id, 'north-guild');
    assert.strictEqual(draftUpdate.body.world.events[0].id, 'rain-warning');
    const ruleWorld = draftUpdate.body.world;
    const rulePlayerCreation = JSON.parse(JSON.stringify(ruleWorld.playerCreation || { mode: 'custom', fields: [], attributes: [], skills: [], resources: [], traits: [] }));
    rulePlayerCreation.growth = {
      sources: [{ id: 'training-test', label: '训练', kind: 'training', description: '通过训练成长。' }],
      candidates: [{ id: 'identity-test', label: '身份成长', sourceId: 'training-test', bucket: 'identity', targetId: 'identity', value: '见习者', description: '测试成长候选。' }],
    };
    const ruleDraftUpdate = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(world.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedUpdatedAt: draftUpdate.body.updatedAt,
        baseVersion: world.version,
        title: draftUpdate.body.world.title,
        summary: draftUpdate.body.world.summary,
        tags: draftUpdate.body.world.tags,
        lorebookIds: draftUpdate.body.world.lorebookIds,
        setting: draftUpdate.body.world.setting,
        rules: draftUpdate.body.world.rules,
        playerCreation: rulePlayerCreation,
        turnContract: { options: { min: 2, max: 4 }, actionIntent: true },
        failure: { defaultMode: 'test-failure', onZeroHp: 'test-failure', onConflictDefeat: 'test-failure', modes: [{ id: 'test-failure', label: '测试失败', description: '继续测试。', effect: '测试状态' }] },
        ending: { enabled: true, allowPlayerEnd: true, requireConfirm: true, endings: [{ id: 'test-ending', kind: 'card-defined', label: '测试结局', description: '测试结局描述。', terminal: true }] },
        conflicts: [{ id: 'test-conflict', label: '测试冲突', type: 'combat', phases: [{ id: 'start', label: '开始' }], actions: [{ id: 'strike', label: '攻击', check: { roll: '1d20', target: 10 } }], outcomes: [{ id: 'win', label: '胜利', consequences: ['测试完成'] }] }],
        mapGeneration: draftUpdate.body.world.map?.generation,
        locations: draftLocations,
        npcs: draftNpcs,
        events: draftUpdate.body.world.events,
        factions: draftUpdate.body.world.factions,
      }),
    });
    assert.strictEqual(ruleDraftUpdate.response.status, 200, 'rule collections save through the world draft chain');
    assert.strictEqual(ruleDraftUpdate.body.world.conflicts[0].actions[0].check.roll, '1d20');
    assert.strictEqual(ruleDraftUpdate.body.world.failure.modes[0].id, 'test-failure');
    assert.strictEqual(ruleDraftUpdate.body.world.ending.endings[0].id, 'test-ending');
    assert.strictEqual(ruleDraftUpdate.body.world.playerCreation.growth.candidates[0].sourceId, 'training-test');
    const invalidUiDraft = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(world.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedUpdatedAt: ruleDraftUpdate.body.updatedAt, baseVersion: world.version, title: ruleDraftUpdate.body.world.title, summary: ruleDraftUpdate.body.world.summary, tags: ruleDraftUpdate.body.world.tags, lorebookIds: ruleDraftUpdate.body.world.lorebookIds, ui: { sidebar: { panels: [{ id: 'unsafe', title: '脚本面板', source: 'save.secret' }] } }, locations: draftLocations, npcs: draftNpcs }),
    });
    assert.strictEqual(invalidUiDraft.response.status, 400, 'world UI only accepts allowlisted sources');
    const invalidAgentDraft = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(world.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedUpdatedAt: ruleDraftUpdate.body.updatedAt, baseVersion: world.version, title: ruleDraftUpdate.body.world.title, summary: ruleDraftUpdate.body.world.summary, tags: ruleDraftUpdate.body.world.tags, lorebookIds: ruleDraftUpdate.body.world.lorebookIds, agent: { mode: 'native', maxSteps: 99 }, locations: draftLocations, npcs: draftNpcs }),
    });
    assert.strictEqual(invalidAgentDraft.response.status, 400, 'world Agent maxSteps is bounded');
    const invalidRegexDraft = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(world.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedUpdatedAt: ruleDraftUpdate.body.updatedAt, baseVersion: world.version, title: ruleDraftUpdate.body.world.title, summary: ruleDraftUpdate.body.world.summary, tags: ruleDraftUpdate.body.world.tags, lorebookIds: ruleDraftUpdate.body.world.lorebookIds, regexes: [{ id: 'bad-regex', name: '坏规则', findRegex: '/[/' }], locations: draftLocations, npcs: draftNpcs }),
    });
    assert.strictEqual(invalidRegexDraft.response.status, 400, 'world output regex must be valid');
    const invalidDerivedDraft = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(world.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedUpdatedAt: ruleDraftUpdate.body.updatedAt,
        baseVersion: world.version,
        title: draftUpdate.body.world.title,
        summary: draftUpdate.body.world.summary,
        tags: draftUpdate.body.world.tags,
        lorebookIds: draftUpdate.body.world.lorebookIds,
        playerCreation: { ...draftUpdate.body.world.playerCreation, derived: [{ id: 'unsafe', label: 'unsafe', formula: 'Math.max(1, 2)' }] },
        locations: draftLocations,
        npcs: draftNpcs,
      }),
    });
    assert.strictEqual(invalidDerivedDraft.response.status, 400, 'derived formulas reject arbitrary JavaScript');
    const invalidDraftEvent = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(world.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedUpdatedAt: ruleDraftUpdate.body.updatedAt, baseVersion: world.version, title: 'invalid', summary: '', tags: [], lorebookIds: [], events: [{ id: 'bad-event', title: '越界事件', trigger: { locationId: 'missing-location' } }], locations: draftLocations, npcs: draftNpcs }),
    });
    assert.strictEqual(invalidDraftEvent.response.status, 400, 'event location references are validated against draft locations');
    const invalidDraftFactionAction = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(world.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedUpdatedAt: ruleDraftUpdate.body.updatedAt, baseVersion: world.version, title: 'invalid', summary: '', tags: [], lorebookIds: [], factions: [{ id: 'north-guild', name: 'North Guild', actions: [{ id: 'patrol', title: '巡逻', description: '', trigger: { locationId: 'missing-location' }, changes: {} }] }], locations: draftLocations, npcs: draftNpcs }),
    });
    assert.strictEqual(invalidDraftFactionAction.response.status, 400, 'faction action location references are validated against draft locations');
    const invalidDraftMap = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(world.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedUpdatedAt: ruleDraftUpdate.body.updatedAt, baseVersion: world.version, title: 'invalid', summary: '', tags: [], lorebookIds: [], mapGeneration: { ...draftMapGeneration, landRatio: 2 }, locations: draftLocations, npcs: draftNpcs }),
    });
    assert.strictEqual(invalidDraftMap.response.status, 400, 'unsafe map generation values are rejected');
    const invalidAuthorRules = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(world.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedUpdatedAt: ruleDraftUpdate.body.updatedAt, baseVersion: world.version, title: draftUpdate.body.world.title, summary: draftUpdate.body.world.summary, tags: draftUpdate.body.world.tags, lorebookIds: draftUpdate.body.world.lorebookIds, setting: { unknown: '不允许' }, rules: { hard: [''] }, locations: draftLocations, npcs: draftNpcs }),
    });
    assert.strictEqual(invalidAuthorRules.response.status, 400, 'world setting and author rules are validated');
    const invalidDraftCollections = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(world.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedUpdatedAt: ruleDraftUpdate.body.updatedAt, baseVersion: world.version, title: 'invalid', summary: '', tags: [], lorebookIds: [], locations: [{ id: 'wolf-tooth-inn', name: 'Inn' }], npcs: [{ id: 'npc-lily', name: 'Lily', locationId: 'missing-location' }] }),
    });
    assert.strictEqual(invalidDraftCollections.response.status, 400, 'dangling NPC location is rejected');
    const invalidDraftStartLocation = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(world.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedUpdatedAt: ruleDraftUpdate.body.updatedAt, baseVersion: world.version, title: 'invalid', summary: '', tags: [], lorebookIds: [], locations: [{ id: 'region-2', name: 'Region Two', type: 'region' }], npcs: draftNpcs }),
    });
    assert.strictEqual(invalidDraftStartLocation.response.status, 400, 'start.locationId cannot be deleted from a draft');
    const staleDraftUpdate = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(world.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedUpdatedAt: draftCreated.body.updatedAt, baseVersion: world.version, title: '过期草稿', summary: '', tags: [], lorebookIds: [] }),
    });
    assert.strictEqual(staleDraftUpdate.response.status, 409, 'stale draft writes are rejected');
    const draftRead = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(world.id));
    assert.strictEqual(draftRead.response.status, 200);
    assert.strictEqual(draftRead.body.world.title, '极光大陆（草稿）');
    const publishedWorldUnchanged = await jsonRequest(base, `/api/worlds/${encodeURIComponent(world.id)}?version=${world.version}`);
    assert.strictEqual(publishedWorldUnchanged.response.status, 200);
    assert.strictEqual(publishedWorldUnchanged.body.title, '极光大陆', 'draft edits do not mutate published world');

    const dataFile = await fetch(base + '/data/worlds.json');
    assert.strictEqual(dataFile.status, 403, 'runtime data is not exposed as static file');
    const genericWorldRead = await fetch(base + '/api/data/worlds');
    assert.strictEqual(genericWorldRead.status, 400, 'world cards do not use generic data API');

    const makeSave = name => jsonRequest(base, '/api/world-saves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: world.id, worldVersion: world.version, name }),
    });
    const first = await makeSave('第一份存档');
    const second = await makeSave('第二份存档');
    const otherWorld = await jsonRequest(base, '/api/world-saves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: secondWorld.id, worldVersion: secondWorld.version, name: '第二世界存档' }),
    });
    assert.strictEqual(first.response.status, 201);
    assert.strictEqual(second.response.status, 201);
    assert.strictEqual(otherWorld.response.status, 201);
    assert.notStrictEqual(first.body.id, second.body.id);
    assert.strictEqual(first.body.revision, 0);
    assert.strictEqual(first.body.state.locationId, 'wolf-tooth-inn');
    assert.deepStrictEqual(first.body.npcStates, {
      'npc-lily': { locationId: 'wolf-tooth-inn', relation: {}, knowledge: [], status: [] },
    });
    assert.deepStrictEqual(second.body.npcStates, first.body.npcStates, 'NPC states are seeded per save');
    assert.deepStrictEqual(otherWorld.body.npcStates, {
      'npc-lily': { locationId: 'second-start', relation: {}, knowledge: [], status: [] },
    }, 'NPC states follow the world start location');

    const list = await jsonRequest(base, '/api/world-saves?worldId=' + encodeURIComponent(world.id));
    assert.strictEqual(list.response.status, 200);
    assert.strictEqual(list.body.length, 2);
    assert.deepStrictEqual(new Set(list.body.map(item => item.id)).size, 2);
    const otherList = await jsonRequest(base, '/api/world-saves?worldId=' + encodeURIComponent(secondWorld.id));
    assert.strictEqual(otherList.response.status, 200);
    assert.strictEqual(otherList.body.length, 1, 'world save lists stay isolated');

    const renamed = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id) + '/rename', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '第一份存档（重命名）' }),
    });
    assert.strictEqual(renamed.response.status, 200);
    assert.strictEqual(renamed.body.name, '第一份存档（重命名）');
    assert.strictEqual(renamed.body.revision, first.body.revision, 'rename does not mutate game revision');
    const firstSavePath = path.join(tempDir, 'saves', first.body.id + '.json');
    const firstSaveWithRuntimeData = JSON.parse(fs.readFileSync(firstSavePath, 'utf8'));
    firstSaveWithRuntimeData.settings = { apiKey: 'save-settings-secret', theme: 'dark' };
    const copyGeneratedNpcId = `save:${first.body.id}:npc:1`;
    firstSaveWithRuntimeData.player.characterId = `pc-${first.body.id}`;
    firstSaveWithRuntimeData.party = { memberIds: [`pc-${first.body.id}`, copyGeneratedNpcId], leaderId: `pc-${first.body.id}` };
    firstSaveWithRuntimeData.npcStates[copyGeneratedNpcId] = { locationId: 'wolf-tooth-inn', relation: {}, knowledge: [], status: [] };
    firstSaveWithRuntimeData.generatedEntities = { npcs: { [copyGeneratedNpcId]: { id: copyGeneratedNpcId, kind: 'npc', name: '副本旅人', commandId: 'old-command', revision: 0 } } };
    firstSaveWithRuntimeData.turns = [{ id: 'old-turn', role: 'assistant', content: '已提交叙事' }];
    firstSaveWithRuntimeData.receipts = [{ kind: 'turn', commandId: 'old-command', revision: 0, turnIds: ['old-turn'] }];
    firstSaveWithRuntimeData.eventLedger = [{ id: 'old-ledger', kind: 'turn', commandId: 'old-command', sourceRevision: 0, revision: 0, locationId: 'wolf-tooth-inn', time: { unit: 'tick', value: 0 }, turnIds: ['old-turn'] }];
    firstSaveWithRuntimeData.state.goals = [{ id: 'copy-goal', title: '副本隔离', desc: '', status: 'active' }];
    fs.writeFileSync(firstSavePath, JSON.stringify(firstSaveWithRuntimeData));
    const saveExport = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id) + '/export');
    assert.strictEqual(saveExport.response.status, 200);
    assert.match(saveExport.response.headers.get('content-disposition') || '', /\.tavern-save\.json/);
    assert.strictEqual(saveExport.body.spec, 'tavern_world_save');
    assert.strictEqual(saveExport.body.save.id, first.body.id);
    assert.strictEqual(saveExport.body.save.name, '第一份存档（重命名）');
    assert.ok(!JSON.stringify(saveExport.body).includes(second.body.id), 'save export excludes other saves');
    assert.ok(!Object.hasOwn(saveExport.body, 'settings'), 'save export excludes runtime settings');
    assert.ok(!JSON.stringify(saveExport.body).includes('save-settings-secret'), 'save export excludes runtime credentials');
    const copied = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id) + '/copy', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId: 'copy-storage-check', name: '第一份存档副本' }),
    });
    assert.strictEqual(copied.response.status, 201);
    assert.notStrictEqual(copied.body.save.id, first.body.id);
    assert.strictEqual(copied.body.save.name, '第一份存档副本');
    assert.strictEqual(copied.body.save.copyInfo.sourceSaveId, first.body.id);
    const copiedNpcId = Object.keys(copied.body.save.generatedEntities.npcs)[0];
    assert.ok(copiedNpcId.startsWith(`save:${copied.body.save.id}:npc:`), 'generated entity owner is remapped');
    assert.strictEqual(copied.body.save.player.characterId, `pc-${copied.body.save.id}`, 'player owner is remapped');
    assert.ok(copied.body.save.party.memberIds.includes(copiedNpcId), 'party references follow remapped entity');
    assert.notStrictEqual(copied.body.save.receipts[0].commandId, 'old-command', 'receipt command is remapped');
    assert.notStrictEqual(copied.body.save.eventLedger[0].id, 'old-ledger', 'ledger owner is remapped');
    const copiedAgain = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id) + '/copy', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId: 'copy-storage-check', name: '第一份存档副本' }),
    });
    assert.strictEqual(copiedAgain.response.status, 200);
    assert.strictEqual(copiedAgain.body.idempotent, true);
    const sourceAfterCopy = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id));
    assert.strictEqual(sourceAfterCopy.body.player.characterId, `pc-${first.body.id}`, 'source remains unchanged');
    assert.ok(sourceAfterCopy.body.generatedEntities.npcs[copyGeneratedNpcId], 'source generated entity remains owned by source');
    fs.writeFileSync(firstSavePath, JSON.stringify(renamed.body));

    const secondDraftCreated = await jsonRequest(base, '/api/world-drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: secondWorld.id, baseVersion: secondWorld.version }),
    });
    assert.strictEqual(secondDraftCreated.response.status, 201);
    const secondDraftUpdate = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(secondWorld.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedUpdatedAt: secondDraftCreated.body.updatedAt,
        baseVersion: secondWorld.version,
        title: 'Second World Published',
        summary: secondDraftCreated.body.world.summary || '',
        tags: secondDraftCreated.body.world.tags || [],
        lorebookIds: secondDraftCreated.body.world.lorebookIds || [],
        setting: { premise: '第二世界的发布设定。' },
        rules: { hard: ['只能使用登记地点。'], soft: ['优先描述环境线索。'] },
        mapGeneration: draftMapGeneration,
        locations: secondDraftCreated.body.world.locations || [],
        npcs: secondDraftCreated.body.world.npcs || [],
      }),
    });
    assert.strictEqual(secondDraftUpdate.response.status, 200);
    const readyPublishCheck = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(secondWorld.id) + '/check');
    assert.strictEqual(readyPublishCheck.response.status, 200);
    assert.strictEqual(readyPublishCheck.body.ready, true, 'a valid draft passes the full publication check');
    assert.ok(readyPublishCheck.body.checks.every(check => check.ok), 'all publication check groups are reported as ready');
    const missingLorebookDraft = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(secondWorld.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedUpdatedAt: secondDraftUpdate.body.updatedAt,
        baseVersion: secondWorld.version,
        title: secondDraftUpdate.body.world.title,
        summary: secondDraftUpdate.body.world.summary || '',
        tags: secondDraftUpdate.body.world.tags || [],
        lorebookIds: ['missing-lorebook'],
        mapGeneration: secondDraftUpdate.body.world.map.generation,
        locations: secondDraftUpdate.body.world.locations || [],
        npcs: secondDraftUpdate.body.world.npcs || [],
      }),
    });
    assert.strictEqual(missingLorebookDraft.response.status, 200);
    const blockedPublishCheck = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(secondWorld.id) + '/check');
    assert.strictEqual(blockedPublishCheck.response.status, 200);
    assert.strictEqual(blockedPublishCheck.body.ready, false, 'missing Prompt lorebooks block publication');
    assert.ok(blockedPublishCheck.body.errors.some(error => error.section === 'prompt' && error.target === 'world-draft-lorebooks'));
    const blockedPublish = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(secondWorld.id) + '/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'publish-second-blocked', expectedUpdatedAt: missingLorebookDraft.body.updatedAt, baseVersion: secondWorld.version }),
    });
    assert.strictEqual(blockedPublish.response.status, 400, 'publish repeats the full check instead of trusting the client');
    const restoredDraft = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(secondWorld.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedUpdatedAt: missingLorebookDraft.body.updatedAt,
        baseVersion: secondWorld.version,
        title: missingLorebookDraft.body.world.title,
        summary: missingLorebookDraft.body.world.summary || '',
        tags: missingLorebookDraft.body.world.tags || [],
        lorebookIds: secondDraftUpdate.body.world.lorebookIds || [],
        mapGeneration: missingLorebookDraft.body.world.map.generation,
        locations: missingLorebookDraft.body.world.locations || [],
        npcs: missingLorebookDraft.body.world.npcs || [],
      }),
    });
    assert.strictEqual(restoredDraft.response.status, 200);
    const invalidPublish = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(secondWorld.id) + '/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'bad', expectedUpdatedAt: restoredDraft.body.updatedAt, baseVersion: secondWorld.version }),
    });
    assert.strictEqual(invalidPublish.response.status, 400, 'invalid publication command IDs are rejected');
    const publishPayload = { commandId: 'publish-second-0001', expectedUpdatedAt: restoredDraft.body.updatedAt, baseVersion: secondWorld.version };
    const secondPublish = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(secondWorld.id) + '/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(publishPayload),
    });
    assert.strictEqual(secondPublish.response.status, 201);
    assert.strictEqual(secondPublish.body.world.version, Number(secondWorld.version) + 1);
    assert.strictEqual(secondPublish.body.world.title, 'Second World Published');
    assert.strictEqual(secondPublish.body.world.setting.premise, '第二世界的发布设定。');
    assert.deepStrictEqual(secondPublish.body.world.rules.soft, ['优先描述环境线索。']);
    assert.strictEqual(secondPublish.body.world.publication.commandId, publishPayload.commandId);
    assert.strictEqual(secondPublish.body.idempotent, false);
    assert.strictEqual(secondPublish.body.draftRemoved, true);
    const duplicatePublish = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(secondWorld.id) + '/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(publishPayload),
    });
    assert.strictEqual(duplicatePublish.response.status, 200, 'draft publication is idempotent');
    assert.strictEqual(duplicatePublish.body.world.version, secondPublish.body.world.version);
    assert.strictEqual(duplicatePublish.body.idempotent, true);
    const reusedPublishCommand = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(secondWorld.id) + '/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...publishPayload, expectedUpdatedAt: publishPayload.expectedUpdatedAt + 1 }),
    });
    assert.strictEqual(reusedPublishCommand.response.status, 409, 'a publication command ID cannot be reused for another revision');
    const consumedDraft = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(secondWorld.id));
    assert.strictEqual(consumedDraft.response.status, 404, 'published draft is consumed');
    const oldSecondWorld = await jsonRequest(base, `/api/worlds/${encodeURIComponent(secondWorld.id)}?version=${secondWorld.version}`);
    assert.strictEqual(oldSecondWorld.response.status, 200);
    assert.strictEqual(oldSecondWorld.body.title, secondWorld.title, 'publication does not mutate the source version');
    const latestSecondWorld = await jsonRequest(base, `/api/worlds/${encodeURIComponent(secondWorld.id)}`);
    assert.strictEqual(latestSecondWorld.body.version, secondPublish.body.world.version);
    const secondVersions = await jsonRequest(base, `/api/worlds/${encodeURIComponent(secondWorld.id)}/versions`);
    assert.strictEqual(secondVersions.response.status, 200);
    assert.deepStrictEqual(secondVersions.body.map(version => version.version), [1, 2], 'world versions are listed in ascending order');
    const oldSecondSave = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(otherWorld.body.id));
    assert.strictEqual(oldSecondSave.body.worldVersion, secondWorld.version, 'existing save stays pinned after draft publication');
    const upgradePreview = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(otherWorld.body.id)}/upgrade?targetVersion=${secondPublish.body.world.version}`);
    assert.strictEqual(upgradePreview.response.status, 200);
    assert.strictEqual(upgradePreview.body.canUpgrade, true);
    assert.strictEqual(upgradePreview.body.fromVersion, secondWorld.version);
    assert.strictEqual(upgradePreview.body.targetVersion, secondPublish.body.world.version);
    const upgradePayload = { commandId: 'upgrade-second-0001', expectedRevision: oldSecondSave.body.revision, targetVersion: secondPublish.body.world.version };
    const upgradedSecondSave = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(otherWorld.body.id) + '/upgrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(upgradePayload),
    });
    assert.strictEqual(upgradedSecondSave.response.status, 200);
    assert.strictEqual(upgradedSecondSave.body.idempotent, false);
    assert.strictEqual(upgradedSecondSave.body.save.worldVersion, secondPublish.body.world.version);
    assert.strictEqual(upgradedSecondSave.body.save.revision, oldSecondSave.body.revision + 1);
    assert.strictEqual(upgradedSecondSave.body.save.migrationHistory.at(-1).commandId, upgradePayload.commandId);
    const duplicateUpgrade = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(otherWorld.body.id) + '/upgrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(upgradePayload),
    });
    assert.strictEqual(duplicateUpgrade.response.status, 200, 'save upgrade is idempotent');
    assert.strictEqual(duplicateUpgrade.body.idempotent, true);
    assert.strictEqual(duplicateUpgrade.body.save.revision, upgradedSecondSave.body.save.revision);
    const reusedUpgradeCommand = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(otherWorld.body.id) + '/upgrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...upgradePayload, expectedRevision: upgradePayload.expectedRevision + 1 }),
    });
    assert.strictEqual(reusedUpgradeCommand.response.status, 409, 'upgrade command ID cannot be reused for another revision');
    const newSecondSave = await jsonRequest(base, '/api/world-saves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: secondWorld.id, worldVersion: secondPublish.body.world.version, name: 'Published World Save' }),
    });
    assert.strictEqual(newSecondSave.response.status, 201);
    assert.strictEqual(newSecondSave.body.worldVersion, secondPublish.body.world.version, 'new saves can use the published version');

    const thirdDraftCreated = await jsonRequest(base, '/api/world-drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: secondWorld.id, baseVersion: secondPublish.body.world.version }),
    });
    assert.strictEqual(thirdDraftCreated.response.status, 201);
    const thirdLocations = thirdDraftCreated.body.world.locations.filter(location => location.id !== 'region-2');
    const thirdNpcs = [...(thirdDraftCreated.body.world.npcs || []), { id: 'npc-new-guide', name: 'New Guide', role: 'guide', locationId: 'second-start' }];
    const thirdDraftUpdate = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(secondWorld.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedUpdatedAt: thirdDraftCreated.body.updatedAt,
        baseVersion: secondPublish.body.world.version,
        title: 'Second World Without Region Two',
        summary: thirdDraftCreated.body.world.summary || '',
        tags: thirdDraftCreated.body.world.tags || [],
        lorebookIds: thirdDraftCreated.body.world.lorebookIds || [],
        mapGeneration: thirdDraftCreated.body.world.map.generation,
        locations: thirdLocations,
        npcs: thirdNpcs,
      }),
    });
    assert.strictEqual(thirdDraftUpdate.response.status, 200);
    const thirdPublish = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(secondWorld.id) + '/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'publish-second-0003', expectedUpdatedAt: thirdDraftUpdate.body.updatedAt, baseVersion: secondPublish.body.world.version }),
    });
    assert.strictEqual(thirdPublish.response.status, 201);
    const addedNpcPreview = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(newSecondSave.body.id)}/upgrade?targetVersion=${thirdPublish.body.world.version}`);
    assert.strictEqual(addedNpcPreview.response.status, 200);
    assert.strictEqual(addedNpcPreview.body.canUpgrade, true);
    assert.ok(addedNpcPreview.body.changes.npcs.added.some(npc => npc.id === 'npc-new-guide'));
    const addedNpcUpgrade = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(newSecondSave.body.id) + '/upgrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'upgrade-new-save-0003', expectedRevision: newSecondSave.body.revision, targetVersion: thirdPublish.body.world.version }),
    });
    assert.strictEqual(addedNpcUpgrade.response.status, 200);
    assert.strictEqual(addedNpcUpgrade.body.save.npcStates['npc-new-guide'].locationId, 'second-start', 'new world NPC receives an isolated save state');
    const regionState = JSON.parse(JSON.stringify(upgradedSecondSave.body.save.state));
    regionState.locationId = 'region-2';
    const secondSaveAtRegion = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(otherWorld.body.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: upgradedSecondSave.body.save.revision, state: regionState, turns: upgradedSecondSave.body.save.turns, opening: upgradedSecondSave.body.save.opening }),
    });
    assert.strictEqual(secondSaveAtRegion.response.status, 200);
    const blockedUpgradePreview = await jsonRequest(base, `/api/world-saves/${encodeURIComponent(otherWorld.body.id)}/upgrade?targetVersion=${thirdPublish.body.world.version}`);
    assert.strictEqual(blockedUpgradePreview.response.status, 200);
    assert.strictEqual(blockedUpgradePreview.body.canUpgrade, false);
    assert.ok(blockedUpgradePreview.body.hardErrors.some(error => error.path === 'state.locationId' && error.id === 'region-2'));
    assert.ok(blockedUpgradePreview.body.hardErrors.some(error => error.kind === 'location'), 'upgrade errors expose the stable entity kind');
    const blockedUpgrade = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(otherWorld.body.id) + '/upgrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'upgrade-second-0003', expectedRevision: secondSaveAtRegion.body.revision, targetVersion: thirdPublish.body.world.version }),
    });
    assert.strictEqual(blockedUpgrade.response.status, 409, 'missing references block save upgrade');
    assert.strictEqual(blockedUpgrade.body.report.canUpgrade, false);
    const blockedSaveUnchanged = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(otherWorld.body.id));
    assert.strictEqual(blockedSaveUnchanged.body.worldVersion, secondPublish.body.world.version);
    assert.strictEqual(blockedSaveUnchanged.body.revision, secondSaveAtRegion.body.revision, 'blocked upgrade does not change revision');
    assert.strictEqual(blockedSaveUnchanged.body.migrationHistory.length, 1, 'blocked upgrade does not append migration history');

    const saved = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id));
    assert.strictEqual(saved.response.status, 200);
    assert.strictEqual(saved.body.name, '第一份存档（重命名）');
    assert.strictEqual(saved.body.worldId, world.id);
    const statePatch = JSON.parse(JSON.stringify(saved.body.state));
    statePatch.locationId = 'region-2';
    const saveMapGeneration = { ...draftMapGeneration, size: 64 };
    statePatch.map.data = MapGen.serializeMap(MapGen.generateWorldMap(saveMapGeneration.seed, saveMapGeneration));
    statePatch.map.imagePath = '/images/world-map.png';
    const savedUpdate = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: saved.body.revision, state: statePatch, turns: [{ id: 'turn-1', role: 'assistant', content: '世界存档内的叙事' }], opening: saved.body.opening }),
    });
    assert.strictEqual(savedUpdate.response.status, 200);
    assert.strictEqual(savedUpdate.body.revision, 1);
    assert.strictEqual(savedUpdate.body.state.map.data.grid.length, 64 * 64);
    assert.deepStrictEqual(savedUpdate.body.state.map.data.generation, saveMapGeneration);
    const turnPayload = {
      commandId: 'command-0001',
      expectedRevision: 1,
      state: statePatch,
      turns: [
        { id: 'turn-user-1', role: 'user', content: '进入旅店' },
        { id: 'turn-ai-1', role: 'assistant', content: '你推开了旅店的门。' },
      ],
      options: ['观察炉火', '询问老板', '检查背包', '走向窗边'],
    };
    const turnCommit = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(turnPayload),
    });
    assert.strictEqual(turnCommit.response.status, 200);
    assert.strictEqual(turnCommit.body.revision, 2);
    assert.strictEqual(turnCommit.body.turns.at(-1).commandId, 'command-0001');
    assert.strictEqual(turnCommit.body.receipts.at(-1).commandId, 'command-0001');
    const npcTurn = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...turnPayload,
        commandId: 'command-0005',
        expectedRevision: 2,
        npcStates: { 'npc-lily': { locationId: 'region-2', relation: { trust: 1 }, knowledge: ['玩家曾帮助她'], status: ['alert'] } },
        turns: [
          { id: 'turn-user-2', role: 'user', content: '询问莉莉' },
          { id: 'turn-ai-2', role: 'assistant', content: '莉莉抬头。' },
        ],
        createEntities: [
          { kind: 'npc', tempId: 'traveler-1', name: '临时旅人', role: 'witness', description: '只属于本次存档的目击者', locationId: 'region-2' },
          { kind: 'item', tempId: 'blue-key', name: '蓝色钥匙', count: 1, locationId: 'region-2' },
        ],
      }),
    });
    assert.strictEqual(npcTurn.response.status, 200);
    assert.strictEqual(npcTurn.body.revision, 3);
    assert.strictEqual(npcTurn.body.npcStates['npc-lily'].locationId, 'region-2');
    const generatedNpcId = Object.keys(npcTurn.body.generatedEntities.npcs || {})[0];
    assert.match(generatedNpcId, new RegExp(`^save:${first.body.id}:npc:1$`));
    assert.strictEqual(npcTurn.body.generatedEntities.npcs[generatedNpcId].name, '临时旅人');
    assert.strictEqual(npcTurn.body.generatedEntities.npcs[generatedNpcId].role, 'witness');
    assert.strictEqual(Object.keys(npcTurn.body.generatedEntities.items || {}).length, 1);
    const sourceWorldCard = await jsonRequest(base, `/api/worlds/${encodeURIComponent(world.id)}?version=${world.version}`);
    assert.strictEqual(sourceWorldCard.response.status, 200);
    assert.strictEqual(sourceWorldCard.body.version, world.version);
    assert.ok(!sourceWorldCard.body.npcs.some(npc => npc.id === generatedNpcId), 'source world remains unchanged');
    const promotion = await jsonRequest(base, `/api/worlds/${encodeURIComponent(world.id)}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceSaveId: first.body.id, expectedRevision: 3, npcId: generatedNpcId, title: '极光大陆 · 收录旅人' }),
    });
    assert.strictEqual(promotion.response.status, 201);
    assert.strictEqual(promotion.body.world.id, world.id);
    assert.strictEqual(promotion.body.world.version, Number(world.version) + 1);
    assert.ok(promotion.body.npcId && promotion.body.npcId !== generatedNpcId);
    assert.ok(promotion.body.world.npcIds.includes(promotion.body.npcId));
    assert.strictEqual(promotion.body.world.npcs.find(npc => npc.id === promotion.body.npcId).sourceGeneratedEntityId, generatedNpcId);
    const duplicatePromotion = await jsonRequest(base, `/api/worlds/${encodeURIComponent(world.id)}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceSaveId: first.body.id, expectedRevision: 3, npcId: generatedNpcId }),
    });
    assert.strictEqual(duplicatePromotion.response.status, 200, 'promotion is idempotent');
    assert.strictEqual(duplicatePromotion.body.npcId, promotion.body.npcId);
    const latestWorld = await jsonRequest(base, `/api/worlds/${encodeURIComponent(world.id)}`);
    assert.strictEqual(latestWorld.response.status, 200);
    assert.strictEqual(latestWorld.body.version, promotion.body.world.version);
    assert.ok(latestWorld.body.npcIds.includes(promotion.body.npcId));
    const promotedWorldExport = await jsonRequest(base, `/api/worlds/${encodeURIComponent(world.id)}/export?version=${latestWorld.body.version}`);
    const exportedPromotedNpc = promotedWorldExport.body.content.world.npcs.find(npc => npc.id === promotion.body.npcId);
    assert.ok(exportedPromotedNpc && !Object.hasOwn(exportedPromotedNpc, 'sourceSaveId') && !Object.hasOwn(exportedPromotedNpc, 'sourceGeneratedEntityId'));
    assert.notStrictEqual(promotedWorldExport.body.manifest.contentHash, worldExport.body.manifest.contentHash, 'content changes produce a new package hash');
    assert.ok(promotedWorldExport.body.manifest.privacy.redactedPaths.some(value => value.endsWith('.sourceSaveId')), 'source save ownership is excluded from exported content');
    const staleDraftPublish = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(world.id) + '/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: 'publish-aurora-stale-0001', expectedUpdatedAt: ruleDraftUpdate.body.updatedAt, baseVersion: world.version }),
    });
    assert.strictEqual(staleDraftPublish.response.status, 409, 'draft cannot publish over a newer world version');
    assert.strictEqual(staleDraftPublish.body.latestVersion, promotion.body.world.version);
    const retainedStaleDraft = await jsonRequest(base, '/api/world-drafts/' + encodeURIComponent(world.id));
    assert.strictEqual(retainedStaleDraft.response.status, 200, 'conflicted draft remains available for recovery');
    const promotedSave = await jsonRequest(base, '/api/world-saves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: world.id, worldVersion: latestWorld.body.version, name: '收录后新存档' }),
    });
    assert.strictEqual(promotedSave.response.status, 201);
    assert.ok(promotedSave.body.npcStates[promotion.body.npcId], 'new version seeds promoted NPC state');
    const oldSaveAfterPromotion = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id));
    assert.strictEqual(oldSaveAfterPromotion.body.worldVersion, world.version, 'old save stays pinned to source version');
    assert.ok(!oldSaveAfterPromotion.body.npcStates[promotion.body.npcId], 'old save does not receive promoted NPC');
    const duplicateGeneratedTurn = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...turnPayload,
        commandId: 'command-0005',
        expectedRevision: 2,
        npcStates: { 'npc-lily': { locationId: 'region-2', relation: { trust: 1 }, knowledge: ['玩家曾帮助她'], status: ['alert'] } },
        turns: [{ id: 'turn-user-2', role: 'user', content: '询问莉莉' }, { id: 'turn-ai-2', role: 'assistant', content: '莉莉抬头。' }],
        createEntities: [
          { kind: 'npc', tempId: 'traveler-1', name: '临时旅人', role: 'witness', description: '只属于本次存档的目击者', locationId: 'region-2' },
          { kind: 'item', tempId: 'blue-key', name: '蓝色钥匙', count: 1, locationId: 'region-2' },
        ],
      }),
    });
    assert.strictEqual(duplicateGeneratedTurn.response.status, 200, 'generated entity command is idempotent');
    assert.strictEqual(Object.keys(duplicateGeneratedTurn.body.generatedEntities.npcs || {}).length, 1);
    const invalidLocation = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...turnPayload, commandId: 'command-0008', expectedRevision: 3, state: { ...statePatch, locationId: '自由文本地点' } }),
    });
    assert.strictEqual(invalidLocation.response.status, 400, 'free-text locations are rejected');
    const unknownNpcState = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...turnPayload, commandId: 'command-0007', expectedRevision: 3, npcStates: { 'npc-other-save': { locationId: 'region-9' } } }),
    });
    assert.strictEqual(unknownNpcState.response.status, 400, 'NPC state cannot cross save/world ownership');
    const secondReload = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(second.body.id));
    assert.strictEqual(secondReload.response.status, 200);
    assert.strictEqual(secondReload.body.revision, 0);
    assert.strictEqual(secondReload.body.npcStates['npc-lily'].locationId, 'wolf-tooth-inn', 'NPC state does not leak across saves');
    assert.deepStrictEqual(secondReload.body.generatedEntities, {}, 'generated entities do not leak across saves');
    const duplicateTurn = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(turnPayload),
    });
    assert.strictEqual(duplicateTurn.response.status, 200, 'duplicate command is idempotent');
    assert.strictEqual(duplicateTurn.body.revision, 3);
    const badOptions = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...turnPayload, commandId: 'command-0002', expectedRevision: 2, options: ['重复', '重复', '三', '四'] }),
    });
    assert.strictEqual(badOptions.response.status, 400, 'candidate options are validated');
    const badState = JSON.parse(JSON.stringify(statePatch));
    badState.stats.hp = 1000000001;
    const invalidState = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...turnPayload, commandId: 'command-0003', expectedRevision: 2, state: badState }),
    });
    assert.strictEqual(invalidState.response.status, 400, 'candidate numeric state is bounded');
    const badInventory = JSON.parse(JSON.stringify(statePatch));
    badInventory.inventory = [{ name: '超大数量', count: 1000001 }];
    const invalidInventory = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...turnPayload, commandId: 'command-0004', expectedRevision: 2, state: badInventory }),
    });
    assert.strictEqual(invalidInventory.response.status, 400, 'candidate inventory is bounded');
    const invalidNpcState = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...turnPayload, commandId: 'command-0006', expectedRevision: 3, npcStates: { 'npc-lily': { knowledge: new Array(129).fill('x') } } }),
    });
    assert.strictEqual(invalidNpcState.response.status, 400, 'candidate NPC state is bounded');
    const invalidCreateEntity = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...turnPayload, commandId: 'command-0009', expectedRevision: 3, createEntities: [{ kind: 'world-rule', tempId: 'bad', name: '越界实体' }] }),
    });
    assert.strictEqual(invalidCreateEntity.response.status, 400, 'unsupported generated entity kind is rejected');
    const conflict = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 0, state: statePatch, turns: [], opening: saved.body.opening }),
    });
    assert.strictEqual(conflict.response.status, 409, 'stale revision is rejected');
    const badImagePath = await jsonRequest(base, '/api/world-saves/' + encodeURIComponent(first.body.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, state: { ...statePatch, map: { ...statePatch.map, imagePath: '../secret.png' } }, turns: [], opening: saved.body.opening }),
    });
    assert.strictEqual(badImagePath.response.status, 400, 'external image path is rejected');

    const legacySession = {
      id: 'legacy-rpg-001', kind: 'rpg', charId: 'char-export', name: '旧 RPG 旅程', opening: '旧开场白',
      messages: [{ role: 'assistant', content: '旧世界在雨中醒来', ts: 1 }, { role: 'user', content: '我走进旅店', ts: 2 }],
      rpgState: { locationId: 'wolf-tooth-inn', stats: { level: 3, hp: 18, maxHp: 20, gold: 42 }, inventory: [{ name: '旧钥匙', count: 1 }], quests: [{ title: '旧任务', status: 'active' }], map: { imagePath: '../unsafe.png' } },
    };
    const migrationRaw = JSON.stringify({ schemaVersion: 1, kind: 'legacy-rpg-session', name: legacySession.name, worldId: world.id, worldVersion: world.version, session: legacySession, characterSnapshot: { name: 'Export Character', race: '狐', role: '旅人', openai_api_key: 'must-not-leak' } });
    const migrationPreview = await jsonRequest(base, '/api/rpg-migrations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: migrationRaw }) });
    assert.strictEqual(migrationPreview.response.status, 201, 'legacy RPG session preview succeeds');
    assert.ok(migrationPreview.body.report.canMigrate);
    assert.ok(!Object.hasOwn(migrationPreview.body, 'raw'), 'migration preview does not expose raw source');
    const migrationGet = await jsonRequest(base, '/api/rpg-migrations/' + encodeURIComponent(migrationPreview.body.id));
    assert.strictEqual(migrationGet.response.status, 200);
    assert.ok(!Object.hasOwn(migrationGet.body, 'raw'), 'migration GET keeps raw source sealed');
    const migrated = await jsonRequest(base, '/api/rpg-migrations/' + encodeURIComponent(migrationPreview.body.id), { method: 'POST' });
    assert.strictEqual(migrated.response.status, 201, 'legacy RPG session commit succeeds');
    assert.strictEqual(migrated.body.save.worldId, world.id);
    assert.strictEqual(migrated.body.save.turns.length, 2);
    assert.strictEqual(migrated.body.save.state.locationId, 'wolf-tooth-inn');
    assert.ok(migrated.body.save.migrationInfo);
    assert.ok(!JSON.stringify(migrated.body.save).includes('must-not-leak'), 'migration strips credentials from player snapshot');
    const migratedAgain = await jsonRequest(base, '/api/rpg-migrations/' + encodeURIComponent(migrationPreview.body.id), { method: 'POST' });
    assert.strictEqual(migratedAgain.response.status, 200, 'legacy migration is idempotent');
    assert.strictEqual(migratedAgain.body.save.id, migrated.body.save.id);

    const traversal = await jsonRequest(base, '/api/world-saves/%2e%2e%2fworlds');
    assert.strictEqual(traversal.response.status, 400, 'path traversal is rejected');
    const badWorld = await jsonRequest(base, '/api/world-saves?worldId=../secrets');
    assert.strictEqual(badWorld.response.status, 400, 'invalid worldId is rejected');
    const badPayload = await jsonRequest(base, '/api/world-saves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: world.id, worldVersion: world.version, name: '' }),
    });
    assert.strictEqual(badPayload.response.status, 400);
    const badNameType = await jsonRequest(base, '/api/world-saves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: world.id, worldVersion: world.version, name: { value: '对象' } }),
    });
    assert.strictEqual(badNameType.response.status, 400);
    const unknownWorld = await jsonRequest(base, '/api/world-saves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: 'world-missing', worldVersion: 1, name: '未知世界' }),
    });
    assert.strictEqual(unknownWorld.response.status, 404);

    await closeServer();
    await startServer(0);
    const restarted = server.address();
    const afterRestart = await jsonRequest(`http://127.0.0.1:${restarted.port}`, '/api/world-saves?worldId=' + encodeURIComponent(world.id));
    assert.strictEqual(afterRestart.response.status, 200);
    assert.strictEqual(afterRestart.body.length, 5, 'saves survive server restart');
    const draftAfterRestart = await jsonRequest(`http://127.0.0.1:${restarted.port}`, '/api/world-drafts/' + encodeURIComponent(world.id));
    assert.strictEqual(draftAfterRestart.response.status, 200);
    assert.strictEqual(draftAfterRestart.body.world.title, '极光大陆（草稿）', 'draft survives server restart');
    console.log('world storage check passed');
  } finally {
    await closeServer();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
