'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const data = new Map();
const context = vm.createContext({
  console,
  localStorage: {
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
  },
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  window: {},
  document: {},
  Date,
  Math,
  JSON,
  Set,
});

const source = fs.readFileSync('public/app.js', 'utf8').replace(/\ninit\(\);\s*$/, '');
vm.runInContext(source, context);
vm.runInContext(`
  characters = [{ name: '旧角色' }, { id: 'b', name: '角色 B' }];
  currentCharId = 'undefined';
  ensureChars();
  const a = characters[0].id;
  sessions = [
    { id: 'a-t', charId: a, kind: 'tavern', messages: [{ role: 'assistant', content: 'A 酒馆' }] },
    { id: 'a-r', charId: a, kind: 'rpg', messages: [], rpgState: { mapData: { seed: 1 }, mapImage: '/images/a.png' } },
    { id: 'b-t', charId: 'b', kind: 'tavern', messages: [{ role: 'assistant', content: 'B 酒馆' }] },
    { id: 'legacy', kind: 'tavern', messages: [] },
  ];
  currentCharId = a; mode = 'tavern'; currentSessionId = 'b-t'; ensureSessions();
  globalThis.check = {
    a,
    current: curSession().id,
    legacyChar: sessions.find(s => s.id === 'legacy').charId,
  };
  mode = 'rpg'; currentSessionId = 'a-r';
  globalThis.check.mapSeed = curRpgState().mapData.seed;
  globalThis.check.mapImage = curRpgState().mapImage;
  currentCharId = 'b';
  globalThis.check.crossScope = curSession();
`, context);

assert.ok(context.check.a);
assert.strictEqual(context.check.current, 'a-t');
assert.strictEqual(context.check.legacyChar, context.check.a);
assert.strictEqual(context.check.mapSeed, 1);
assert.strictEqual(context.check.mapImage, '/images/a.png');
assert.strictEqual(context.check.crossScope, null);

vm.runInContext(`
  const fence = String.fromCharCode(96).repeat(3);
  const complete = splitRpgOutput('狼低声说：“别动。”\\n\\n' + fence + 'RPG\\n{"options":["掷 d20 观察"],"hp":null}\\n' + fence);
  const streaming = splitRpgOutput('雾气漫过石阶。\\n' + fence + 'rpg\\n{"options":[');
  mode = 'tavern';
  const tavern = processAIOutput('保留代码\\n' + fence + 'rpg\\n{"hp":-1}\\n' + fence);
  globalThis.outputCheck = { complete, streaming, tavern, narrativeRolls: rollDiceIn(complete.content).length };
`, context);
assert.strictEqual(context.outputCheck.complete.content, '狼低声说：“别动。”');
assert.match(context.outputCheck.complete.payload, /掷 d20 观察/);
assert.strictEqual(context.outputCheck.streaming.content, '雾气漫过石阶。');
assert.strictEqual(context.outputCheck.streaming.payload, null);
assert.match(context.outputCheck.tavern.content, /```rpg/);
assert.strictEqual(context.outputCheck.narrativeRolls, 0);

vm.runInContext(`
  mode = 'rpg'; currentCharId = 'b'; currentSessionId = 'rpg-process';
  sessions = [{ id: 'rpg-process', charId: 'b', kind: 'rpg', messages: [], rpgState: defaultRpgState() }];
  globalThis.pushed = [];
  pushMessage = (...args) => pushed.push(args);
  saveSessions = () => {};
  renderRPG = () => {};
  globalThis.processed = processAIOutput('守卫摇头。\\n' + fence + 'rpg\\n{"options":["掷 d20 观察"],"hp":null}\\n' + fence);
`, context);
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.processed.options)), ['掷 d20 观察']);
assert.strictEqual(context.pushed.length, 0);

vm.runInContext(`
  debugTraces.clear(); debugTraceSelection.clear(); renderDebugTerminal = () => {};
  const first = sessions[0];
  const second = { id: 'other-trace', charId: 'b', kind: 'rpg', messages: [] };
  const sanitized = { id: 'sanitized-trace', charId: 'b', kind: 'rpg', messages: [] };
  setDebugTrace(first, { input: 'first input', output: 'first output' });
  setDebugTrace(first, { input: 'first retry input', output: 'first retry output', status: '已完成' });
  setDebugTrace(second, { input: 'second input' });
  beginDebugRequest(sanitized, {
    baseUrl: 'https://example.test/v1',
    apiKey: 'must-not-appear-in-terminal',
    body: { model: 'test-model', messages: [{ role: 'user', content: 'sanitized request' }] },
  });
  globalThis.traceCheck = {
    first: debugTraces.get(first.id),
    second: debugTraces.get(second.id),
    firstHistory: debugTraces.get(first.id).history,
    selectedFirst: debugTraceSelection.get(first.id),
    sanitizedInput: debugTraces.get(sanitized.id).input,
    persisted: JSON.stringify(sessions).includes('first input'),
  };
`, context);
assert.strictEqual(context.traceCheck.first.output, 'first retry output');
assert.strictEqual(context.traceCheck.second.input, 'second input');
assert.strictEqual(context.traceCheck.firstHistory.length, 2);
assert.strictEqual(context.traceCheck.firstHistory[0].input, 'first input');
assert.strictEqual(context.traceCheck.firstHistory[0].output, 'first output');
assert.strictEqual(context.traceCheck.firstHistory[1].input, 'first retry input');
assert.strictEqual(context.traceCheck.firstHistory[1].output, 'first retry output');
assert.strictEqual(context.traceCheck.selectedFirst, context.traceCheck.firstHistory[1].id);
assert.match(context.traceCheck.sanitizedInput, /https:\/\/example\.test\/v1\/chat\/completions/);
assert.doesNotMatch(context.traceCheck.sanitizedInput, /must-not-appear-in-terminal/);
assert.strictEqual(context.traceCheck.persisted, false);
console.log('session binding check passed');
