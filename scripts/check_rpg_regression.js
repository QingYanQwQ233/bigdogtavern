'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-rpg-regression-'));
const defaults = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', '_defaults.json'), 'utf8'));
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

async function jsonRequest(base, pathname, options) {
  const response = await fetch(base + pathname, options);
  const body = await response.json().catch(() => null);
  return { response, body };
}

function firstOption(field) {
  const option = Array.isArray(field.options) ? field.options[0] : '';
  return typeof option === 'string' ? option : option?.value || '';
}

function playerFor(world, label) {
  const schema = world.playerCreation;
  return {
    fields: Object.fromEntries((schema.fields || []).map(field => [field.id, field.id === 'name' ? label : firstOption(field) || field.default || (field.type === 'textarea' ? '测试背景' : '')])),
    attributes: Object.fromEntries((schema.attributes || []).map(definition => [definition.id, definition.default ?? definition.min ?? 0])),
    skills: Object.fromEntries((schema.skills || []).map(definition => [definition.id, definition.default ?? definition.min ?? 0])),
    resources: Object.fromEntries((schema.resources || []).map(definition => [definition.id, definition.initial ?? definition.min ?? 0])),
    traits: (schema.traits || []).slice(0, 1).map(definition => definition.id),
    relations: {},
  };
}

function activeConflict(definition, id) {
  const action = (definition.actions || []).find(item => item.check) || definition.actions[0];
  const phase = definition.phases?.[0]?.id || null;
  const participants = definition.type === 'combat'
    ? [{ id: `${id}-player`, role: 'player', hp: 10, maxHp: 10, defense: 10 }, { id: `${id}-target`, role: 'target', hp: 8, maxHp: 8, defense: 8 }]
    : [{ id: `${id}-player`, role: 'player' }, { id: `${id}-target`, role: 'opponent' }];
  return {
    id, templateId: definition.id, type: definition.type, status: 'active', phase, round: 1,
    participants, ...(definition.type === 'combat' ? { targetId: `${id}-target` } : {}),
    availableActions: action ? [action.id] : [],
  };
}

async function main() {
  try {
    await startServer(0);
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;
    const worldsResponse = await jsonRequest(base, '/api/worlds');
    assert.strictEqual(worldsResponse.response.status, 200);
    for (const id of ['world-aurora', 'world-grey-harbor', 'world-orbit-station']) assert.ok(worldsResponse.body.some(world => world.id === id), `${id} sample world is available`);

    const created = {};
    for (const id of ['world-grey-harbor', 'world-orbit-station']) {
      const worldResponse = await jsonRequest(base, `/api/worlds/${id}?version=1`);
      assert.strictEqual(worldResponse.response.status, 200);
      const world = worldResponse.body;
      const player = playerFor(world, `${id}-player`);
      const saveResponse = await jsonRequest(base, '/api/world-saves', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worldId: id, worldVersion: 1, name: `${id} regression`, player }),
      });
      assert.strictEqual(saveResponse.response.status, 201, `${id} save creates`);
      const save = saveResponse.body;
      created[id] = save;
      assert.strictEqual(save.state.failure, null, `${id} save starts without failure`);
      assert.ok(world.failure && world.failure.modes.some(mode => mode.id === 'injured'), `${id} declares failure modes`);
      const firstResource = world.playerCreation.resources[0];
      assert.strictEqual(save.state.player.resources[firstResource.id], player.resources[firstResource.id]);
      assert.ok(save.state.map && save.state.map.strategy, `${id} keeps per-save map state`);

      const combat = world.conflicts.find(definition => definition.type === 'combat');
      const social = world.conflicts.find(definition => definition.type === 'social');
      assert.ok(combat && social, `${id} declares combat and social conflicts`);
      const combatKey = `${id}-combat`;
      const socialKey = `${id}-social`;
      const startState = { ...save.state, conflicts: { [combatKey]: activeConflict(combat, combatKey), [socialKey]: activeConflict(social, socialKey) } };
      const started = await jsonRequest(base, `/api/world-saves/${save.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandId: `${id}-start-1`, expectedRevision: save.revision, state: startState, turns: [{ role: 'assistant', content: '冲突开始。' }], options: [] }),
      });
      assert.strictEqual(started.response.status, 200, `${id} conflict start commits: ${JSON.stringify(started.body)}`);
      const nextConflicts = JSON.parse(JSON.stringify(started.body.state.conflicts));
      for (const [key, definition] of [[combatKey, combat], [socialKey, social]]) {
        const state = nextConflicts[key];
        const action = definition.actions.find(item => item.check);
        state.round = 2;
        state.actionId = action.id;
        if (key === 'combat') state.targetId = state.participants[1].id;
      }
      const advanced = await jsonRequest(base, `/api/world-saves/${save.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandId: `${id}-advance-1`, expectedRevision: started.body.revision, state: { ...started.body.state, conflicts: nextConflicts }, turns: [{ role: 'assistant', content: '冲突判定完成。' }], options: [], eventMemory: [{ summary: '冲突中的一次判定已经完成。', locationId: started.body.state.locationId, time: { unit: 'tick', value: 2 }, visibility: 'local' }] }),
      });
      assert.strictEqual(advanced.response.status, 200, `${id} conflict advance commits`);
      assert.ok(advanced.body.receipts.at(-1).combatChecks.length === 1, `${id} server rolls combat`);
      assert.strictEqual(advanced.body.receipts.at(-1).conflictChecks[0].type, 'social', `${id} server records social check`);
      const turnLedger = advanced.body.eventLedger.find(entry => entry.commandId === `${id}-advance-1`);
      assert.ok(turnLedger, `${id} committed turn has an event ledger entry`);
      assert.strictEqual(turnLedger.sourceRevision, advanced.body.revision, `${id} ledger keeps source revision`);
      assert.deepStrictEqual(turnLedger.turnIds, advanced.body.receipts.at(-1).turnIds, `${id} ledger points to committed turns`);
      const memory = advanced.body.eventMemory.at(-1);
      assert.ok(memory, `${id} committed turn extracts event memory`);
      assert.strictEqual(memory.sourceRevision, advanced.body.revision, `${id} memory keeps source revision`);
      assert.deepStrictEqual(memory.sourceTurnIds, turnLedger.turnIds, `${id} memory points to committed turns`);
      assert.strictEqual(memory.locationId, advanced.body.state.locationId, `${id} memory keeps location scope`);
      assert.deepStrictEqual(memory.time, advanced.body.state.time, `${id} memory binds committed time scope`);
      const invalidMemory = await jsonRequest(base, `/api/world-saves/${save.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandId: `${id}-invalid-memory-1`, expectedRevision: advanced.body.revision, state: advanced.body.state, turns: [{ role: 'assistant', content: '无效记忆。' }], options: [], eventMemory: [{ summary: '跨地点伪造的记忆。', locationId: 'not-a-registered-location' }] }),
      });
      assert.strictEqual(invalidMemory.response.status, 400, `${id} rejects memory outside the world location scope`);

      const failedState = { ...advanced.body.state, stats: { ...advanced.body.state.stats, hp: 0 } };
      const failed = await jsonRequest(base, `/api/world-saves/${save.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandId: `${id}-failure-1`, expectedRevision: advanced.body.revision, state: failedState, turns: [{ role: 'assistant', content: 'HP 归零，触发失败结算。' }], options: [] }),
      });
      assert.strictEqual(failed.response.status, 200, `${id} hp zero commits failure settlement`);
      assert.strictEqual(failed.body.state.failure.mode, 'injured', `${id} selects injured mode`);
      assert.strictEqual(failed.body.state.failure.status, 'active', `${id} keeps injured mode recoverable`);
      assert.ok(failed.body.state.stats.hp > 0, `${id} injured mode restores hp`);
      assert.strictEqual(failed.body.receipts.at(-1).failure.cause, 'hp_zero', `${id} receipt records hp failure cause`);
      const tamperedFailure = await jsonRequest(base, `/api/world-saves/${save.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandId: `${id}-failure-tamper-1`, expectedRevision: failed.body.revision, state: { ...failed.body.state, failure: { mode: 'permadeath', status: 'terminal' } }, turns: [{ role: 'assistant', content: '尝试伪造失败状态。' }], options: [] }),
      });
      assert.strictEqual(tamperedFailure.response.status, 400, `${id} rejects client-owned failure mutation`);

      const candidate = world.playerCreation.growth.candidates[0];
      const candidateRecord = { id: `${id}-growth-1`, candidateId: candidate.id, sourceId: candidate.sourceId, reason: '回归测试产生候选', status: 'proposed' };
      const proposed = await jsonRequest(base, `/api/world-saves/${save.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandId: `${id}-growth-1`, expectedRevision: failed.body.revision, state: { ...failed.body.state, growthCandidates: [candidateRecord] }, turns: [{ role: 'assistant', content: '记录一项成长。' }], options: [] }),
      });
      assert.strictEqual(proposed.response.status, 200, `${id} growth proposal commits`);
      const accepted = await jsonRequest(base, `/api/world-saves/${save.id}/growth`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandId: `${id}-growth-accept`, expectedRevision: proposed.body.revision, candidateId: candidateRecord.id, decision: 'accepted' }),
      });
      assert.strictEqual(accepted.response.status, 200, `${id} growth accepts`);
      assert.strictEqual(accepted.body.state.growthApplications.at(-1).decision, 'accepted');
      assert.strictEqual(accepted.body.state.experiences.at(-1).candidateId, candidate.id);
      assert.strictEqual(accepted.body.state.player[candidate.bucket][candidate.targetId], player[candidate.bucket][candidate.targetId] + candidate.delta);
      const growthLedger = accepted.body.eventLedger.find(entry => entry.commandId === `${id}-growth-accept`);
      assert.strictEqual(growthLedger.growthApplicationId, accepted.body.state.growthApplications.at(-1).id, `${id} growth ledger points to application`);
      const reloaded = await jsonRequest(base, `/api/world-saves/${save.id}`);
      assert.strictEqual(reloaded.response.status, 200);
      assert.strictEqual(reloaded.body.state.experiences.at(-1).id, accepted.body.state.experiences.at(-1).id, `${id} growth survives reload`);
      assert.strictEqual(reloaded.body.eventLedger.length, accepted.body.eventLedger.length, `${id} ledger survives reload`);
      assert.strictEqual(reloaded.body.eventMemory.at(-1).id, accepted.body.eventMemory.at(-1).id, `${id} event memory survives reload`);
      const saveFile = path.join(tempDir, 'saves', `${save.id}.json`);
      const diskSave = JSON.parse(fs.readFileSync(saveFile, 'utf8'));
      diskSave.state.worldEvents = [...(diskSave.state.worldEvents || []), {
        eventId: `${id}-hidden-event`, title: '隐藏标题 secret', description: '隐藏描述 secret',
        locationId: diskSave.state.locationId, time: diskSave.state.time, visibility: 'hidden', revision: diskSave.revision,
      }];
      fs.writeFileSync(saveFile, JSON.stringify(diskSave, null, 2));
      const diagnostics = await jsonRequest(base, `/api/world-saves/${save.id}/memory`);
      assert.strictEqual(diagnostics.response.status, 200, `${id} memory diagnostics read`);
      assert.strictEqual(diagnostics.body.revision, reloaded.body.revision, `${id} diagnostics bind current revision`);
      assert.ok(diagnostics.body.rebuild.entryCount >= 2, `${id} rebuild has structured sources`);
      assert.ok(!JSON.stringify(diagnostics.body.rebuild.entries).includes('secret'), `${id} diagnostics redact hidden memory`);
      const rebuildCommand = `${id}-memory-rebuild-1`;
      const rebuilt = await jsonRequest(base, `/api/world-saves/${save.id}/memory/rebuild`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandId: rebuildCommand, expectedRevision: reloaded.body.revision }),
      });
      assert.strictEqual(rebuilt.response.status, 200, `${id} derived memory rebuild commits`);
      assert.strictEqual(rebuilt.body.save.revision, reloaded.body.revision, `${id} rebuild does not rewrite formal revision`);
      assert.ok(rebuilt.body.save.eventMemory.some(item => item.kind === 'fact'), `${id} rebuild restores growth fact memory`);
      assert.ok(rebuilt.body.save.eventMemory.some(item => item.visibility === 'hidden'), `${id} rebuild preserves hidden visibility`);
      assert.ok(!JSON.stringify(rebuilt.body.diagnostics.rebuild.entries).includes('secret'), `${id} rebuild response redacts hidden memory`);
      assert.strictEqual(rebuilt.body.save.memoryRebuild.sourceRevision, reloaded.body.revision, `${id} rebuild records source revision`);
      const preEndingSummary = await jsonRequest(base, `/api/world-saves/${save.id}/summary/rebuild`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandId: `${id}-summary-pre`, expectedRevision: rebuilt.body.save.revision }),
      });
      assert.strictEqual(preEndingSummary.response.status, 200, `${id} builds pre-ending summary`);
      assert.strictEqual(preEndingSummary.body.stale, false, `${id} pre-ending summary is current`);
      const rebuildAgain = await jsonRequest(base, `/api/world-saves/${save.id}/memory/rebuild`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandId: rebuildCommand, expectedRevision: reloaded.body.revision }),
      });
      assert.strictEqual(rebuildAgain.response.status, 200, `${id} rebuild is idempotent`);
      assert.strictEqual(rebuildAgain.body.idempotent, true, `${id} rebuild idempotent receipt`);
      const endingPreview = await jsonRequest(base, `/api/world-saves/${save.id}/end`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandId: `${id}-ending-preview`, expectedRevision: rebuilt.body.save.revision, endingId: 'player-choice', confirm: false }),
      });
      assert.strictEqual(endingPreview.response.status, 409, `${id} requires explicit ending confirmation`);
      assert.strictEqual(endingPreview.body.confirmationRequired, true, `${id} exposes confirmation requirement`);
      const ended = await jsonRequest(base, `/api/world-saves/${save.id}/end`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandId: `${id}-ending-1`, expectedRevision: rebuilt.body.save.revision, endingId: 'player-choice', confirm: true }),
      });
      assert.strictEqual(ended.response.status, 200, `${id} commits player ending`);
      assert.strictEqual(ended.body.state.ending.status, 'ended', `${id} marks save ended`);
      assert.strictEqual(ended.body.receipts.at(-1).kind, 'ending', `${id} records ending receipt`);
      const staleSummaryRead = await jsonRequest(base, `/api/world-saves/${save.id}/summary`);
      assert.strictEqual(staleSummaryRead.response.status, 200, `${id} reads stale summary after ending`);
      assert.strictEqual(staleSummaryRead.body.stale, true, `${id} marks summary stale after new formal fact`);
      const summaryCommand = `${id}-summary-1`;
      const summaryRebuild = await jsonRequest(base, `/api/world-saves/${save.id}/summary/rebuild`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandId: summaryCommand, expectedRevision: ended.body.revision }),
      });
      assert.strictEqual(summaryRebuild.response.status, 200, `${id} builds world-line summary`);
      assert.strictEqual(summaryRebuild.body.stale, false, `${id} summary is current`);
      assert.strictEqual(summaryRebuild.body.summary.sourceRevision, ended.body.revision, `${id} summary binds source revision`);
      assert.ok(Array.isArray(summaryRebuild.body.summary.worldChanges), `${id} summary includes world changes`);
      assert.ok(Array.isArray(summaryRebuild.body.summary.experiences), `${id} summary includes experiences`);
      const summaryRetry = await jsonRequest(base, `/api/world-saves/${save.id}/summary/rebuild`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandId: summaryCommand, expectedRevision: ended.body.revision }),
      });
      assert.strictEqual(summaryRetry.response.status, 200, `${id} summary command is idempotent`);
      assert.strictEqual(summaryRetry.body.idempotent, true, `${id} summary retry is idempotent`);
      const summaryRead = await jsonRequest(base, `/api/world-saves/${save.id}/summary`);
      assert.strictEqual(summaryRead.response.status, 200, `${id} reads world-line summary`);
      assert.strictEqual(summaryRead.body.stale, false, `${id} read summary is current`);
      const endingRetry = await jsonRequest(base, `/api/world-saves/${save.id}/end`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandId: `${id}-ending-1`, expectedRevision: rebuilt.body.save.revision, endingId: 'player-choice', confirm: true }),
      });
      assert.strictEqual(endingRetry.response.status, 200, `${id} ending command is idempotent`);
      const afterEndTurn = await jsonRequest(base, `/api/world-saves/${save.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandId: `${id}-after-ending-1`, expectedRevision: ended.body.revision, state: ended.body.state, turns: [{ role: 'assistant', content: '尝试在结束后继续。' }], options: [] }),
      });
      assert.strictEqual(afterEndTurn.response.status, 409, `${id} rejects ordinary turns after ending`);
      created[id] = ended.body;
    }

    const legacy = {
      id: 'legacy-rpg-grey', kind: 'rpg', name: 'legacy grey', opening: 'legacy opening',
      messages: [{ role: 'assistant', content: '旧存档内容', ts: 1 }],
      rpgState: { locationId: 'grey-dock', stats: { level: 2, hp: 9, maxHp: 12, gold: 20 }, inventory: [], quests: [] },
    };
    const migration = await jsonRequest(base, '/api/rpg-migrations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: JSON.stringify({ schemaVersion: 1, kind: 'legacy-rpg-session', name: legacy.name, worldId: 'world-grey-harbor', worldVersion: 1, session: legacy, characterSnapshot: { name: 'legacy', race: 'human', role: 'investigator' } }) }),
    });
    assert.strictEqual(migration.response.status, 201);
    const migrated = await jsonRequest(base, `/api/rpg-migrations/${migration.body.id}`, { method: 'POST' });
    assert.strictEqual(migrated.response.status, 201, 'legacy RPG save migrates into sample world');
    assert.deepStrictEqual(migrated.body.save.state.growthCandidates, []);
    assert.deepStrictEqual(migrated.body.save.state.growthApplications, []);
    assert.deepStrictEqual(migrated.body.save.state.experiences, []);
    assert.strictEqual(migrated.body.save.state.locationId, 'grey-dock');
    assert.strictEqual(migrated.body.save.eventLedger[0].kind, 'migration', 'legacy migration records its source event');
    assert.strictEqual(migrated.body.save.eventLedger[0].sourceRevision, 0, 'migration ledger starts at revision 0');
    assert.strictEqual(created['world-grey-harbor'].state.experiences.length, 1, 'sample saves remain isolated');
    console.log('RPG regression check passed');
  } finally {
    await closeServer();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
