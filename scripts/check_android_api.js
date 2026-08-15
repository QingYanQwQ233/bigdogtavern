'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('android/app/src/main/java/com/tavern/app/TavernServer.kt', 'utf8');
for (const route of ['/api/worlds/', '/api/world-saves', '/setup', '/opening-candidate', '/growth', '/end', '/reopen', '/summary', '/memory']) {
  assert.ok(source.includes(route), `Android route missing: ${route}`);
}
assert.strictEqual((source.match(/\{/g) || []).length, (source.match(/\}/g) || []).length, 'Kotlin braces are unbalanced');
assert.ok(source.includes('saveFile(saveId)'), 'save IDs must pass through the path-safe helper');
assert.ok(source.includes('baseRevision'), 'Android must enforce Typed Patch baseRevision');
assert.ok(source.includes('openingPlanError'), 'Android must validate opening plans');
assert.ok(source.includes('openingCandidateError'), 'Android must validate opening candidates');
assert.ok(source.includes('setupStatus'), 'Android summaries must expose setup status');
assert.ok(source.includes('files["content"]'), 'Android PUT bodies must read NanoHTTPD temp content files');
assert.ok(!source.includes('files["postData"] ?: ""'), 'Android must not silently convert missing bodies to empty JSON');
console.log('android API contract check passed');
