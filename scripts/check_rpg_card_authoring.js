'use strict';

const assert = require('assert');
const fs = require('fs');
const { applyRpgPatch, materializeWorldRuntimeState, ensureRuntimeActionIntentUpdate } = require('../server');

const html = fs.readFileSync('public/index.html', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');

for (const id of [
  'world-draft-runtime-form',
  'world-draft-runtime-variables',
  'world-draft-runtime-items',
  'world-draft-runtime-actions',
  'world-draft-runtime-advanced',
  'world-draft-runtime-load-json',
]) {
  assert.ok(new RegExp(`\\bid="${id}"`).test(html), `missing RPG card authoring control: ${id}`);
}

for (const kind of ['variable', 'item', 'action']) {
  assert.ok(new RegExp(`data-world-runtime-add=["']${kind}["']`).test(html), `missing runtime ${kind} add control`);
}

assert.ok(/<textarea\b[^>]*\bid="world-draft-runtime"/.test(html), 'advanced JSON compatibility textarea must remain available');
for (const id of ['world-draft-runtime-form', 'world-draft-runtime-variables', 'world-draft-runtime-items', 'world-draft-runtime-actions', 'world-draft-runtime-load-json']) {
  assert.ok(app.includes(`'${id}'`) || app.includes(`"${id}"`), `public app must wire runtime control: ${id}`);
}
assert.ok(/data-world-runtime-add|worldRuntimeAdd/.test(app), 'public app must handle runtime form additions');
assert.ok(/function syncWorldDraftRuntimeSourceIds\(\)/.test(app), 'live form edits must refresh their source identifiers');
assert.ok(/syncWorldDraftRuntimeSourceIds\(\);/.test(app), 'runtime synchronization must refresh source identifiers');
assert.ok(/function refreshWorldDraftRuntimeActionVariables\(/.test(app), 'renaming a variable must keep form action targets selectable');
assert.ok(/function worldDraftRuntimeVariableIsReferenced\(/.test(app), 'a referenced variable must not be deleted into an invalid form state');
assert.ok(/function runtimeAuthoringDefaultPanels\(/.test(app), 'form-authored runtime data must get a player-visible default panel');
assert.ok(/function recoverExplicitWorldActionPatch\(/.test(app), 'explicit card actions must recover from model-authored legacy patches');
assert.ok(/recoverExplicitWorldActionPatch\(processed\.patch, worldTurnPending\.actionIntent/.test(app), 'RPG response handling must normalize invalid explicit-action patches before submission');
assert.ok(/function matchExactWorldRuntimeAction\(/.test(app), 'free input must be able to resolve a unique declared runtime action');
assert.ok(/matchExactWorldRuntimeAction\(value\)/.test(app), 'world turn submission must resolve exact free-input actions before prompting the Agent');
assert.ok(/isExplicitWorldRuntimeActionIntent\(actionIntent\)/.test(app), 'a resolved free-input action must recover from malformed legacy model patches');
assert.ok(/const committed = await requestReply\(\);[\s\S]{0,240}throwOnError/.test(app), 'extension actions must reject when their world turn was not committed');
assert.ok(/async function submitWorldExtensionChoice[\s\S]{0,900}throwOnError:\s*true/.test(app), 'the extension bridge must propagate a failed world turn to its caller');
assert.ok(/WORLD_DRAFT_AUTO_PANEL_LIMIT = 24/.test(app), 'automatic runtime panels must keep the established sidebar limit');
assert.ok(/function presentWorldDraftEditor[\s\S]{0,300}closeWorldOpeningDialog\(\)/.test(app), 'the full-screen authoring route must not sit behind an opening dialog');
assert.ok(/function openWorldOpeningDialog[\s\S]{0,180}worldDraftEditorActive\(\)/.test(app), 'opening planning must not reopen above the authoring route');
assert.ok(/field\.key === '\$value' \? entry\.value/.test(app), 'default variable panels must render their actual value');
assert.ok(/field\.key === '\$value'\) return root \? worldStatePathKey\(root\)/.test(app), 'default variable panels must retain state-change feedback');
assert.ok(/world\.ui\?\.sidebar \? configuredPanels/.test(app), 'an explicit sidebar must remain in full author control');
assert.ok(/!items\.length \|\| items\.some[\s\S]{0,500}!worldDraftRuntimeGeneratedItemAction/.test(app), 'partial durable JSON must remain in the advanced compatibility area');
assert.ok(/JSON\.stringify\(\s*world\.runtime\b/.test(app), 'loading a draft must retain its runtime schema');
assert.ok(/\/api\/world-drafts\/[\s\S]{0,2000}body:\s*JSON\.stringify\(\{[\s\S]{0,2000}\bruntime\b/.test(app), 'saving a draft must serialize runtime');

assert.ok(/state\.runtime 不能省略/.test(server), 'runtime state must not be silently dropped from a save');
assert.ok(/state\.runtime\.schema 必须与当前世界卡快照一致/.test(server), 'runtime state must remain bound to its world-card schema');
assert.ok(/function recoverMalformedExplicitActionIntentPatch\(/.test(server), 'server must recover malformed model patches for explicit world-card actions');

const durabilityWorld = {
  runtime: {
    version: 1,
    variables: [],
    collections: [{
      id: 'durable-items',
      label: '耐久物品',
      scope: 'save',
      entrySchema: {
        type: 'object',
        properties: { id: { type: 'string' }, label: { type: 'string' }, durability: { type: 'number', min: 0 }, maxDurability: { type: 'number', min: 0 }, uses: { type: 'number', min: 0 } },
        required: ['id', 'label', 'durability', 'maxDurability', 'uses'],
        additionalProperties: false,
      },
      initial: [{ id: 'torch', label: '火把', durability: 1, maxDurability: 1, uses: 0 }],
    }],
    actions: [{
      id: 'use-torch',
      label: '点燃火把',
      availability: [{ type: 'collection.number', collectionId: 'durable-items', entryId: 'torch', field: 'durability', operator: '>=', value: 1 }],
      effects: [{ type: 'collection.patch', collectionId: 'durable-items', entryId: 'torch', delta: { durability: -1, uses: 1 } }],
    }],
  },
};
const durabilityState = { runtime: materializeWorldRuntimeState(durabilityWorld.runtime) };
const usedOnce = applyRpgPatch(durabilityWorld, durabilityState, { baseRevision: 0, updates: [{ type: 'runtime.action.execute', actionId: 'use-torch', input: {} }] });
assert.strictEqual(usedOnce.error, undefined, 'durable item action should execute while durability remains');
assert.deepStrictEqual(usedOnce.state.runtime.collections['durable-items'][0], { id: 'torch', label: '火把', durability: 0, maxDurability: 1, uses: 1 });
const usedEmpty = applyRpgPatch(durabilityWorld, usedOnce.state, { baseRevision: 1, updates: [{ type: 'runtime.action.execute', actionId: 'use-torch', input: {} }] });
assert.match(usedEmpty.error, /当前不可用/, 'zero durability must prevent a second execution');

const intentPatch = ensureRuntimeActionIntentUpdate(
  durabilityWorld,
  durabilityState,
  { protocol: 'tavern.rpg.turn', version: 1, baseRevision: 0, updates: [] },
  { actionId: 'use-torch', input: {} },
  [],
);
assert.strictEqual(intentPatch.updates.length, 1, 'an explicit action intent must keep its declared effect in the turn patch');
assert.deepStrictEqual(intentPatch.updates[0], { type: 'runtime.action.execute', actionId: 'use-torch' });
const partialIntentPatch = ensureRuntimeActionIntentUpdate(
  durabilityWorld,
  durabilityState,
  { protocol: 'tavern.rpg.turn', version: 1, baseRevision: 0, updates: [{ type: 'runtime.collection.patch', collectionId: 'durable-items', entryId: 'torch', delta: { uses: 1 } }] },
  { actionId: 'use-torch', input: {} },
  [],
);
assert.deepStrictEqual(partialIntentPatch.updates, [{ type: 'runtime.action.execute', actionId: 'use-torch' }], 'partial direct writes must be replaced by the declared action');
const duplicateIntentPatch = ensureRuntimeActionIntentUpdate(
  durabilityWorld,
  durabilityState,
  { protocol: 'tavern.rpg.turn', version: 1, baseRevision: 0, updates: [{ type: 'runtime.action.execute', actionId: 'use-torch' }, { type: 'runtime.collection.patch', collectionId: 'durable-items', entryId: 'torch', delta: { durability: -1 } }] },
  { actionId: 'use-torch', input: {} },
  [],
);
assert.deepStrictEqual(duplicateIntentPatch.updates, [{ type: 'runtime.action.execute', actionId: 'use-torch' }], 'a direct duplicate must not apply alongside the declared action');
durabilityWorld.runtime.actions.push({ id: 'wrong-action', label: '不相关动作', effects: [] });
const mismatchedIntentPatch = ensureRuntimeActionIntentUpdate(
  durabilityWorld,
  durabilityState,
  { protocol: 'tavern.rpg.turn', version: 1, baseRevision: 0, updates: [{ type: 'runtime.action.execute', actionId: 'wrong-action' }] },
  { actionId: 'use-torch', input: {} },
  [],
);
assert.deepStrictEqual(mismatchedIntentPatch.updates, [{ type: 'runtime.action.execute', actionId: 'use-torch' }], 'a model action must not override the card action intent');
const emptyIntentPatch = ensureRuntimeActionIntentUpdate(
  durabilityWorld,
  usedOnce.state,
  { protocol: 'tavern.rpg.turn', version: 1, baseRevision: 1, updates: [] },
  { actionId: 'use-torch', input: {} },
  [],
);
assert.deepStrictEqual(emptyIntentPatch.updates, [], 'an exhausted resource must not synthesize an unavailable action');
const emptyCandidatePatch = ensureRuntimeActionIntentUpdate(
  durabilityWorld,
  usedOnce.state,
  { protocol: 'tavern.rpg.turn', version: 1, baseRevision: 1, updates: [{ type: 'runtime.action.execute', actionId: 'use-torch' }] },
  { actionId: 'use-torch', input: {} },
  [],
);
assert.deepStrictEqual(emptyCandidatePatch.updates, [], 'an exhausted resource must discard a model action candidate instead of returning an error');

const fogPackage = JSON.parse(fs.readFileSync('docs/fog-harbor-keeper.tavern-world.json', 'utf8'));
const fogWorld = fogPackage.content.world;
const matcherStart = app.indexOf('function normalizeRuntimeActionIntentText(');
const matcherEnd = app.indexOf('\nfunction hydrateWorldSave(', matcherStart);
assert.ok(matcherStart >= 0 && matcherEnd > matcherStart, 'free-input action matcher must remain independently evaluable');
const freeInputAction = new Function(`${app.slice(matcherStart, matcherEnd)}\nreturn { matchExactWorldRuntimeAction, isExplicitWorldRuntimeActionIntent };`)();
assert.strictEqual(freeInputAction.matchExactWorldRuntimeAction('点亮盐火提灯。', fogWorld.runtime.actions)?.id, 'use-salt-lantern', 'terminal punctuation must not stop a free-input action from binding');
assert.strictEqual(freeInputAction.matchExactWorldRuntimeAction('不要点亮盐火提灯', fogWorld.runtime.actions), null, 'free-input matching must not infer actions from longer narrative text');
assert.strictEqual(freeInputAction.matchExactWorldRuntimeAction('点亮盐火提灯', [...fogWorld.runtime.actions, { id: 'duplicate-lantern', label: '点亮盐火提灯', effects: [] }]), null, 'ambiguous action labels must remain free text');
assert.strictEqual(freeInputAction.isExplicitWorldRuntimeActionIntent({ kind: 'action', source: 'input', actionId: 'use-salt-lantern' }), true, 'a matched free-input action must be eligible for malformed-patch recovery');
const recoveryStart = app.indexOf('function recoverExplicitWorldActionPatch(');
const recoveryEnd = app.indexOf('\nfunction applyRpgUpdate(', recoveryStart);
assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart, 'legacy-patch recovery must remain independently evaluable');
const recoverFreeInputActionPatch = new Function(
  'currentWorldSave', 'currentWorldCard', 'normalizeRpgPatch', 'validateRpgPatchShape', 'validateRpgPatchRuntimeActions',
  `${app.slice(matcherStart, matcherEnd)}\n${app.slice(recoveryStart, recoveryEnd)}\nreturn recoverExplicitWorldActionPatch;`,
)({ revision: 7 }, () => fogWorld, patch => patch, patch => patch.updates[0]?.type === 'player.resource.delta' ? 'patch.player.resource.delta 引用了未声明条目 lantern-durability' : null, () => null);
assert.deepStrictEqual(
  recoverFreeInputActionPatch(
    { protocol: 'tavern.rpg.turn', version: 1, baseRevision: 7, updates: [{ type: 'player.resource.delta', id: 'lantern-durability', delta: -1 }] },
    { kind: 'action', source: 'input', actionId: 'use-salt-lantern' },
    7,
  )?.patch,
  { protocol: 'tavern.rpg.turn', version: 1, baseRevision: 7, updates: [] },
  'a malformed lantern resource patch must be replaced by the bound free-input action',
);
const fogExtension = fogWorld.ui.extension;
const fogRuntimeState = { runtime: materializeWorldRuntimeState(fogWorld.runtime) };
const fogLanternPatch = ensureRuntimeActionIntentUpdate(
  fogWorld,
  fogRuntimeState,
  { protocol: 'tavern.rpg.turn', version: 1, baseRevision: 0, updates: [] },
  { actionId: 'use-salt-lantern', input: {} },
  [],
);
const fogLanternUsed = applyRpgPatch(fogWorld, fogRuntimeState, fogLanternPatch);
assert.strictEqual(fogLanternUsed.error, undefined, 'fog harbor lantern intent must execute through its declared action');
assert.deepStrictEqual(
  fogLanternUsed.state.runtime.collections['durable-items'].find(item => item.id === 'salt-lantern'),
  { id: 'salt-lantern', label: '盐火提灯', durability: 2, maxDurability: 3, uses: 1 },
  'using the fog harbor lantern must reduce durability and increase uses together',
);
for (const id of ['keeper-terminal', 'keeper-end', 'keeper-fullscreen', 'keeper-exit']) {
  assert.match(fogExtension.html, new RegExp(`\\bid="${id}"`), `fog harbor UI must expose ${id}`);
}
assert.match(fogExtension.js, /TavernExtension\.openTerminal\(\)/);
assert.match(fogExtension.js, /TavernExtension\.endWorld\(/);
assert.match(fogExtension.js, /TavernExtension\.exitFullscreen\(\)/);
assert.match(fogExtension.js, /TavernExtension\.on\("turn\.error"/);
assert.match(fogExtension.css, /repeating-linear-gradient/);
assert.doesNotMatch(fogExtension.html + fogExtension.css + fogExtension.js, /<svg\b|url\(/i, 'fog harbor UI must remain CSS-only');
assert.deepStrictEqual(fogExtension.permissions, ['read.public', 'read.save']);
assert.doesNotThrow(() => new Function(fogExtension.js));

console.log('check_rpg_card_authoring: ok');
