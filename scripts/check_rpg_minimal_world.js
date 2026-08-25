'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'app.js'), 'utf8');
const start = source.indexOf('function compactRpgWorldCard(');
const end = source.indexOf('function currentWorldCard(', start);
assert.ok(start >= 0 && end > start, 'compact world card helper missing');
const sandbox = { cloneValue: value => JSON.parse(JSON.stringify(value)) };
vm.runInNewContext(source.slice(start, end), sandbox);
const result = sandbox.compactRpgWorldCard({
  title: 'test', events: [{}], factions: [{}], conflicts: [{}], runtime: {}, map: {}, mapGeneration: {}, itemIds: ['item'], questTemplateIds: ['quest'], factionIds: ['faction'],
  playerCreation: { fields: [], economy: {}, growth: {}, initialInventory: {} },
  start: { initialState: { inventory: [], equipment: {}, currencies: {}, quests: [], goals: [], leads: [], activeHooks: [], conflicts: {}, growthCandidates: [], growthApplications: [], experiences: [], runtime: {}, player: { initialInventory: {} } } },
});
assert.strictEqual(result.title, 'test');
for (const key of ['events', 'factions', 'conflicts', 'map', 'mapGeneration', 'itemIds', 'questTemplateIds', 'factionIds']) assert.ok(!(key in result), `${key} should be removed`);
assert.ok(result.runtime && typeof result.runtime === 'object', 'declared runtime schema should remain available');
for (const key of ['economy', 'growth', 'initialInventory']) assert.ok(!(key in result.playerCreation), `${key} should be removed`);
for (const key of ['inventory', 'equipment', 'currencies', 'quests', 'goals', 'leads', 'activeHooks', 'conflicts', 'growthCandidates', 'growthApplications', 'experiences', 'map']) assert.ok(!(key in result.start.initialState), `start.initialState.${key} should be removed`);
assert.ok(!('initialInventory' in result.start.initialState.player), 'start.initialState.player.initialInventory should be removed');
console.log('check_rpg_minimal_world: ok');
