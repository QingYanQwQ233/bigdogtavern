'use strict';
// 世界包契约：characters 退役后的兼容面与防回退守卫。
// 覆盖：① v1 旧包（含角色字段）可导入且被忽略并警告；② 导入不写 characters.json；
//      ③ 新导出（v2）不含角色字段；④ 导出产物可回环通过导入校验。
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-world-contract-'));
const defaults = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', '_defaults.json'), 'utf8'));
fs.writeFileSync(path.join(tempDir, '_defaults.json'), JSON.stringify(defaults));
fs.writeFileSync(path.join(tempDir, 'worlds.json'), '[]');
process.env.TAVERN_DATA_DIR = tempDir;

const { server, startServer } = require(path.join(root, 'server.js'));

const canonicalJson = value => Array.isArray(value)
  ? '[' + value.map(canonicalJson).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}'
    : JSON.stringify(value);
const sha256Json = value => 'sha256:' + crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');

async function main() {
  try {
    await startServer(0);
    const port = server.address().port;
    const base = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'demo-setup-surface-world.tavern-world.json'), 'utf8'));

    // 1) 旧版（v1）包带角色字段：必须可导入；角色字段被忽略并给出警告。
    const legacy = JSON.parse(JSON.stringify(base));
    legacy.specVersion = 1;
    legacy.content.characters = [{ id: 'legacy-hero', name: '旧版角色' }];
    legacy.content.world.characterIds = ['legacy-hero'];
    legacy.content.world.start.playerTemplateId = 'legacy-hero';
    legacy.content.world.npcIds = ['legacy-hero'];
    legacy.manifest.references = { ...(legacy.manifest.references || {}), characters: 1 };
    legacy.manifest.contentHash = sha256Json({ content: legacy.content, assets: legacy.assets });
    const rawLegacy = JSON.stringify(legacy);

    const preview = await fetch(`http://127.0.0.1:${port}/api/world-imports`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: rawLegacy }),
    });
    const previewBody = await preview.json();
    assert.strictEqual(preview.status, 201, JSON.stringify(previewBody));
    assert.strictEqual(previewBody.report.canImport, true, JSON.stringify(previewBody.report));
    assert(previewBody.report.warnings.some(w => String(w).includes('已忽略')), '旧版角色字段应给出忽略警告: ' + JSON.stringify(previewBody.report.warnings));
    assert.strictEqual(previewBody.report.references.characters, undefined, '报告不应再统计 characters');

    // 导入前后 characters.json 必须保持原样（server 启动会播种示例角色；导入不得改写它）。
    const charsPath2 = path.join(tempDir, 'characters.json');
    const charsBefore = fs.existsSync(charsPath2) ? fs.readFileSync(charsPath2, 'utf8') : null;
    const commit = await fetch(`http://127.0.0.1:${port}/api/world-imports/${encodeURIComponent(previewBody.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const commitBody = await commit.json();
    assert.strictEqual(commit.status, 201, JSON.stringify(commitBody));
    const worldId = commitBody.world.id;

    const worlds = JSON.parse(fs.readFileSync(path.join(tempDir, 'worlds.json'), 'utf8'));
    const stored = worlds.find(w => w.id === worldId);
    assert(stored, '导入后的世界应写入 worlds.json');
    assert.strictEqual(stored.characterIds, undefined, 'characterIds 不得随导入保留');
    assert.strictEqual(stored.start?.playerTemplateId, undefined, 'playerTemplateId 不得随导入保留');
    assert.deepStrictEqual(stored.npcIds || [], [], '非内嵌 npcIds（旧角色引用）必须被剔除');
    const charsAfter = fs.existsSync(charsPath2) ? fs.readFileSync(charsPath2, 'utf8') : null;
    assert.strictEqual(charsAfter, charsBefore, '导入不得改动 characters.json');
    assert(!charsAfter || !charsAfter.includes('legacy-hero'), '导入的角色不得写入 characters.json');

    // 2) 新导出（v2）：不含角色字段；且导出的包可再次通过导入校验（回环）。
    const exported = await fetch(`http://127.0.0.1:${port}/api/worlds/${encodeURIComponent(worldId)}/export`);
    assert.strictEqual(exported.status, 200);
    const pkgText = await exported.text();
    const pkg = JSON.parse(pkgText);
    assert.strictEqual(pkg.specVersion, 2, '新导出必须是 specVersion 2');
    assert.strictEqual(pkg.content.characters, undefined, '导出不得包含 characters');
    assert.strictEqual(pkg.content.world.characterIds, undefined, '导出不得包含 characterIds');
    assert.strictEqual(pkg.content.world.start?.playerTemplateId, undefined, '导出不得包含 playerTemplateId');
    assert.strictEqual(pkg.manifest.references.characters, undefined, 'manifest.references 不得统计 characters');

    const roundtrip = await fetch(`http://127.0.0.1:${port}/api/world-imports`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: pkgText }),
    });
    const roundtripBody = await roundtrip.json();
    assert.strictEqual(roundtrip.status, 201, JSON.stringify(roundtripBody));
    assert.strictEqual(roundtripBody.report.canImport, true, JSON.stringify(roundtripBody.report));
    assert(roundtripBody.report.warnings.every(w => !String(w).includes('已忽略')), '新格式包不应触发旧版角色警告');

    console.log('check_world_package_contract: ok');
  } finally {
    await new Promise(resolve => server.listening ? server.close(resolve) : resolve());
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });