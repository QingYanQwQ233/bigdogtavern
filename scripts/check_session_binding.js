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
console.log('session binding check passed');
