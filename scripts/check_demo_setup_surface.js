'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-demo-import-'));
const defaults = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', '_defaults.json'), 'utf8'));
fs.writeFileSync(path.join(tempDir, '_defaults.json'), JSON.stringify(defaults));
fs.writeFileSync(path.join(tempDir, 'worlds.json'), '[]');
process.env.TAVERN_DATA_DIR = tempDir;

const { server, startServer } = require(path.join(root, 'server.js'));

async function main() {
  try {
    const raw = fs.readFileSync(path.join(root, 'docs', 'demo-setup-surface-world.tavern-world.json'), 'utf8');
    const pkg = JSON.parse(raw);
    const extension = pkg.content.world.ui.extension;
    assert.deepStrictEqual(extension.surfaces, ['setup', 'play']);
    assert(extension.permissions.includes('write.setup'));
    assert(pkg.content.world.ui.extension.js.includes('TavernExtension.setup.commit'));
    assert(pkg.content.world.playerCreation.fields.some(field => field.id === 'bond'));
    await startServer(0);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/world-imports`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }),
    });
    const body = await response.json();
    assert.strictEqual(response.status, 201, JSON.stringify(body));
    assert.strictEqual(body.report.canImport, true, JSON.stringify(body.report));
    console.log('check_demo_setup_surface: ok');
  } finally {
    await new Promise(resolve => server.listening ? server.close(resolve) : resolve());
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
