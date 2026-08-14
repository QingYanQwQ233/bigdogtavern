const fs = require('fs');
const crypto = require('crypto');

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const canonicalJson = value => Array.isArray(value)
  ? '[' + value.map(canonicalJson).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}'
    : JSON.stringify(value);

const card = read('docs/maoruyi-rpg-card-draft.json');
const book = read('docs/maoruyi-rpg-worldbook-draft.json');
const defaults = read('public/data/_defaults.json');
const world = JSON.parse(JSON.stringify(card));
// Importer rejects unresolved external faction/item/quest references; definitions remain embedded in world.
world.factionIds = [];
const content = {
  world,
  characters: [],
  lorebooks: { [book.id]: { name: book.name, entries: book.entries } },
  presets: { 'RPG 叙事引擎（示例）': defaults.presets['RPG 叙事引擎（示例）'] },
};
const assets = [];
const contentHash = 'sha256:' + crypto.createHash('sha256').update(canonicalJson({ content, assets })).digest('hex');
const pkg = {
  spec: 'tavern_world_package',
  specVersion: 1,
  exportedAt: new Date().toISOString(),
  manifest: {
    packageId: world.id,
    worldVersion: Number(world.version),
    worldSchemaVersion: Number(world.schemaVersion || 1),
    title: world.title,
    author: null,
    license: null,
    source: world.source,
    contentHash,
    hashScope: 'canonical-json(content,assets)',
    references: { characters: 0, lorebooks: 1, presets: 1, assets: 0 },
    privacy: { excludes: ['settings', 'user', 'worldSaves'], redactedPaths: [] },
    executableContent: { html: false, scripts: false, regexTriggers: 0, executedDuringExport: false },
    warnings: ['这是依据暂定世界观生成的测试包，正式导入前请确认地理、主线和世界意志设定。'],
  },
  content,
  assets,
};
fs.writeFileSync('docs/maoruyi-rpg-card-draft.tavern-world.json', JSON.stringify(pkg, null, 2) + '\n');
console.log(`built ${pkg.manifest.packageId} · ${pkg.manifest.contentHash}`);
