/* RP 自动滚动记忆最小自检：不启动浏览器、不调用 API，只验证轮次与摘要窗口边界。 */
'use strict';

const fs = require('fs');
const vm = require('vm');

const probeSource = `
this.__tavernMemoryProbe = {
  setPrefs: value => { prefs = value; },
  config: tavernAutoMemoryConfig,
  ensure: ensureTavernSessionMemory,
  turns: getTavernTurns,
  unsummarized: getTavernUnsummarizedTurns,
  history: tavernTurnHistory,
};`;
const source = fs.readFileSync('public/app.js', 'utf8').replace(/\ninit\(\);\s*$/, '') + probeSource;
if (!source.includes("async function maybeRollTavernMemory(session = curSession(), { force = false } = {})")) throw new Error('手动总结入口未接入现有滚动逻辑');
if (!fs.readFileSync('public/index.html', 'utf8').includes('id="mem-auto-run"')) throw new Error('手动总结按钮未渲染');

const storage = { getItem: () => null, setItem: () => {} };
const document = {
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  body: { classList: { add: () => {}, remove: () => {}, toggle: () => {} }, dataset: {} },
  documentElement: {},
  createElement: () => ({ style: {}, classList: { add: () => {}, remove: () => {} }, appendChild: () => {}, remove: () => {} }),
};
const context = {
  console,
  localStorage: storage,
  sessionStorage: storage,
  window: {},
  document,
  location: { search: '' },
  navigator: {},
  URL,
  Blob,
  FileReader: function FileReader() {},
  setTimeout,
  clearTimeout,
  fetch: async () => ({ ok: false, json: async () => ({}) }),
  alert: () => {},
  confirm: () => true,
  prompt: () => null,
};
context.window = context;
vm.runInNewContext(source, context, { filename: 'public/app.js' });

const probe = context.__tavernMemoryProbe;
probe.setPrefs({ tavernAutoMemory: { enabled: true, windowTurns: 20, summarizeTurns: 15, summaryChars: 100 } });
const session = { id: 'test-session', kind: 'tavern', messages: [] };
const addTurns = (count, offset = 0) => {
  for (let i = 0; i < count; i += 1) {
    session.messages.push({ role: 'user', content: `玩家行动 ${offset + i}`, id: `u-${offset + i}` });
    session.messages.push({ role: 'assistant', content: `角色回应 ${offset + i}`, id: `a-${offset + i}` });
  }
};

addTurns(20);
if (probe.turns(session).length !== 20 || probe.unsummarized(session).length !== 20) throw new Error('20轮边界识别失败');
const firstBatch = probe.unsummarized(session).slice(0, 15);
probe.ensure(session).summaries.push({ id: 'summary-1', text: '前十五轮摘要', sourceMessageIds: firstBatch.flatMap(turn => turn.messages.map(message => message.id)) });
if (probe.unsummarized(session).length !== 5 || probe.history(session).length !== 10) throw new Error('总结后应保留5轮未总结历史');

addTurns(15, 20);
if (probe.unsummarized(session).length !== 20) throw new Error('第二个滚动窗口边界识别失败');
const secondBatch = probe.unsummarized(session).slice(0, 15);
probe.ensure(session).summaries.push({ id: 'summary-2', text: '第二批摘要', sourceMessageIds: secondBatch.flatMap(turn => turn.messages.map(message => message.id)) });
if (probe.ensure(session).summaries.length !== 2 || probe.unsummarized(session).length !== 5 || probe.history(session).length !== 10) throw new Error('第二次滚动总结后窗口未收敛');
if (probe.ensure({ id: 'rpg-session', kind: 'rpg', messages: [] }) !== null) throw new Error('自动记忆不应进入 RPG 会话');
probe.setPrefs({ tavernAutoMemory: { enabled: false, windowTurns: 20, summarizeTurns: 15, summaryChars: 100 } });
if (probe.config().enabled !== false) throw new Error('关闭自动记忆配置未生效');
console.log('✓ RP 自动记忆轮次、15轮总结与5轮保留边界通过');
