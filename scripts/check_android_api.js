'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('android/app/src/main/java/com/tavern/app/TavernServer.kt', 'utf8');
const activity = fs.readFileSync('android/app/src/main/java/com/tavern/app/MainActivity.kt', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
for (const route of ['/api/worlds/', '/api/world-saves', '/setup', '/opening-candidate', '/opening', '/rename', '/export', '/copy', '/upgrade', '/agent-execute', '/agent-cancel', '/growth', '/end', '/reopen', '/summary', '/memory']) {
  assert.ok(source.includes(route), `Android route missing: ${route}`);
}
assert.strictEqual((source.match(/\{/g) || []).length, (source.match(/\}/g) || []).length, 'Kotlin braces are unbalanced');
assert.ok(source.includes('saveFile(saveId)'), 'save IDs must pass through the path-safe helper');
assert.ok(source.includes('baseRevision'), 'Android must enforce Typed Patch baseRevision');
assert.ok(source.includes('openingPlanError'), 'Android must validate opening plans');
assert.ok(source.includes('openingCandidateError'), 'Android must validate opening candidates');
assert.ok(source.includes('"agent"'), 'Android must preserve world Agent configuration');
assert.ok(source.includes('"ui"'), 'Android must preserve world UI configuration');
assert.ok(source.includes('"regexes"'), 'Android must preserve world output regex configuration');
assert.ok(source.includes('setupStatus'), 'Android summaries must expose setup status');
assert.ok(source.includes('files["content"]'), 'Android PUT bodies must read NanoHTTPD temp content files');
assert.ok(!source.includes('files["postData"] ?: ""'), 'Android must not silently convert missing bodies to empty JSON');
assert.ok(source.includes('"characters", "presets", "lorebooks", "settings", "user", "sessions"'), 'Android data API must include user data');
assert.ok(source.includes('JSONTokener(raw).nextValue()'), 'Android data API must accept JSON array roots such as characters.json');
assert.ok(source.includes('writeTextAtomic(f, raw)'), 'Android data API must atomically persist PUT bodies');
assert.ok(source.includes('handleWorldSaveDelete'), 'Android must expose save deletion');
assert.ok(source.includes('tavern_world_save'), 'Android exports the save envelope');
assert.ok(source.includes('exportSecretKey'), 'Android save exports must redact secrets');
assert.ok(source.includes('awaiting-narration'), 'Android Agent execute must persist a pending result');
assert.ok(source.includes('commitWorldAgentNarration'), 'Android Agent narrate must commit the pending result');
assert.ok(source.includes('handleWorldSaveCopy'), 'Android must expose save copying');
assert.ok(source.includes('copyInfo'), 'Android save copies must retain source metadata');
assert.ok(source.includes('/api/world-imports'), 'Android must expose world package import routes');
assert.ok(source.includes('tavern_world_package'), 'Android import must validate world package spec');
assert.ok(source.includes('regexDisabledOnImport'), 'Android imports must keep regex inert by default');
assert.ok(source.includes('worldUpgradeReport'), 'Android must expose save upgrade preview');
assert.ok(source.includes('world-version-upgrade'), 'Android upgrades must leave a migration record');
assert.ok(activity.includes('addJavascriptInterface(DownloadBridge(), "TavernAndroid")'), 'Android must expose the export bridge');
assert.ok(activity.includes('MediaStore.Downloads'), 'Android exports must target the public Download folder');
assert.ok(activity.includes('saveFile(rawName'), 'Android export bridge must receive frontend files');
assert.match(app, /async function downloadBlob\(blob, filename\)/);
assert.ok(app.includes('bridge.saveFile(filename'), 'Frontend exports must use the Android bridge when available');
console.log('android API contract check passed');
