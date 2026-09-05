'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const context = vm.createContext({ console: { debug() {}, warn() {}, error() {} }, localStorage: { getItem: () => null }, window: {}, document: {}, AbortController });
const source = fs.readFileSync('public/app.js', 'utf8').replace(/\ninit\(\);\s*$/, '');
assert.doesNotMatch(source, /(?:async function|await) repairTavernReplyOptions/);
vm.runInContext(source, context);
context.seed = JSON.parse(fs.readFileSync('public/data/_defaults.json', 'utf8'));
vm.runInContext(`
defaults = seed;
mode = 'tavern';
settings = { ...DEFAULT_SETTINGS, baseUrl: 'http://example.test', stream: false };
prefs = { currentPresetByMode: { tavern: 'P' } };
userData = { currentPreset: 'default', presets: { default: { name: '玩家' } } };
characters = [{ id: 'c', name: '角色' }]; currentCharId = 'c';
sessions = [{ id: 's', charId: 'c', kind: 'tavern', messages: [{role:'user',content:'本轮输入'}] }]; currentSessionId = 's'; lorebooks = {};
promptPresets = { P: normalizePromptPreset('P', {mode:'tavern', replyOptions:{enabled:true,count:3}, modelParameters:{assistant_prefill:'CUSTOM_PREFILL'}}) };
globalThis.before = JSON.stringify(sessions[0].messages);
globalThis.payload = buildPayload();
globalThis.again = buildPayload();
globalThis.after = JSON.stringify(sessions[0].messages);
`, context);
const messages = context.payload.body.messages;
assert.strictEqual(messages.at(-1).role, 'assistant');
assert.match(messages.at(-1).content, /恰好 3 个/);
assert.ok(messages.at(-1).content.endsWith('CUSTOM_PREFILL'));
assert.strictEqual(messages.filter(m => m.role === 'assistant').length, 1);
assert.strictEqual(context.before, context.after);
assert.strictEqual(JSON.stringify(context.payload), JSON.stringify(context.again));
assert.strictEqual(messages.filter(m => m.content === '本轮输入').length, 1);
vm.runInContext(`
promptPresets.P.replyOptions.assistantMessage = '我会遵守 {count}/{min}/{max}';
globalThis.custom = buildPayload();
globalThis.normalized = normalizePromptPreset('P', promptPresets.P);
promptPresets.P.replyOptions.enabled = false;
globalThis.disabled = buildPayload();
mode = 'rpg'; globalThis.rpgCue = buildTavernReplyOptionsAssistantMessage(promptPresets.P); mode = 'tavern';
promptPresets.P.replyOptions.enabled = true;
`, context);
assert.strictEqual(context.custom.body.messages.at(-1).content, '我会遵守 3/3/3\n\nCUSTOM_PREFILL');
assert.strictEqual(context.normalized.replyOptions.assistantMessage, '我会遵守 {count}/{min}/{max}');
assert.strictEqual(context.disabled.body.messages.at(-1).content, 'CUSTOM_PREFILL');
assert.doesNotMatch(JSON.stringify(context.disabled.body.messages), /tavern_options/);
assert.strictEqual(context.rpgCue, '');
// Exercise the real requestReply lifecycle with a fake upstream (no paid requests).
vm.runInContext(`
document.getElementById = () => ({disabled:false, focus(){}});
activeConversationScope = () => ({kind:'tavern',id:'s'});
activeConversationKey = () => 'tavern:s';
worldModeActive = () => false; worldTurnPendingActive = () => false;
clearResponsePreview = clearRpgCheckAnimation = syncSendButton = addTyping = removeTyping = () => {};
beginDebugRequest = setDebugTrace = setResponsePreview = () => {};
maybeRollTavernMemory = () => {};
applyOutputRegex = text => text;
applyRegexStage = text => text;
globalThis.calls = 0; globalThis.saved = [];
pushMessage = (role,content,extra) => saved.push({role,content,extra});
callAPI = async () => { calls++; return {choices:[{message:{content:globalThis.responseText}}]}; };
callAPIStream = async () => { calls++; return {content:globalThis.responseText,cot:''}; };
`, context);
(async () => {
  for (const stream of [false, true]) {
    vm.runInContext('settings.stream = ' + stream, context);
    for (const reply of ['正文', '正文<tavern_options>{oops}</tavern_options>', '正文<tavern_options>["A"]</tavern_options>', '正文<tavern_options>["A","B","C"]</tavern_options>']) {
      context.responseText = reply;
      const previous = context.calls;
      assert.strictEqual(await vm.runInContext('requestReply()', context), true);
      assert.strictEqual(context.calls, previous + 1, 'RP must never send a format-repair request');
      assert.strictEqual(context.saved.at(-1).content, '正文');
      assert.strictEqual(context.saved.at(-1).role, 'assistant');
      assert.strictEqual(context.saved.at(-1).extra.options?.length || 0, reply.includes('"B","C"') ? 3 : 0);
    }
  }
  assert.strictEqual(vm.runInContext('JSON.stringify(sessions[0].messages)', context), context.before);
  console.log('RP single-request checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
