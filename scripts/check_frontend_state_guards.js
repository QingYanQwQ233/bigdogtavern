'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('public/app.js', 'utf8').replace(/\ninit\(\);\s*$/, '');
const styles = fs.readFileSync('public/styles.css', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');

assert.match(source, /const token = \+\+worldLoadToken;[\s\S]{0,800}openWorldSave\(btn\.dataset\.openSave, token\)/, '每次打开存档必须签发新 token');
assert.match(source, /if \(worldSavePlanning\(\)\) resumeWorldSaveSetup\(currentWorldSave\);\s*else enterWorldWorkspace\(\);/, 'planning 存档恢复不能落入游玩界面');
assert.match(source, /let payload = null;[\s\S]{0,300}try \{\s*payload = buildPayload\(\);/, 'requestReply 的错误处理必须能访问 payload');
assert.match(source, /const targetWorldTurnEpoch = worldModeActive\(\) \? worldTurnEpoch : null;[\s\S]{0,300}responseOutdated/, 'RPG 请求必须绑定当前回合 epoch');
assert.match(source, /if \(currentWorldSaveId !== saveId \|\| worldExtensionState\.nonce !== nonce \|\| worldExtensionState\.surface !== 'setup'\) throw new Error/g, '开局扩展响应必须绑定存档与 iframe nonce');
assert.match(source, /input\.disabled = ended \|\| planning/, '未完成开局时输入区必须禁用');
const quickActions = source.slice(source.indexOf('function renderQuickActions()'), source.indexOf('function renderMapPreview()'));
assert.ok(quickActions.indexOf('if (worldTurnErrorActive())') < quickActions.indexOf('if (responsePreview &&'), '回合错误必须优先于正文预览显示');
assert.match(quickActions, /reset\.addEventListener\('click', discardWorldTurnPending\)/, '掉格式后必须提供重置本回合入口');
assert.ok(!source.includes('content: `🎲 工具掷骰 ${r.expr}'), 'RPG 回合不能再写入旧版骰子方框消息');
assert.strictEqual((source.match(/showRpgCheckAnimation\(/g) || []).length, 2, '胶囊只能由实际 dice.roll 调用，不能在规则声明阶段重复创建');
assert.match(source, /function scrollChatToLatest\([\s\S]{0,500}requestAnimationFrame/, '进入 RPG 后必须在布局完成后再次定位最新消息');
assert.match(source, /function scrollChatToLatest\([\s\S]{0,500}scrollTo\(\{ top: chat\.scrollHeight, behavior: 'instant' \}\)/, '消息重绘必须使用瞬时滚动，不能继承 CSS 的平滑滚动');
assert.match(source, /function enterWorldWorkspace\([\s\S]{0,900}requestAnimationFrame\?\.\(\(\) => scrollChatToLatest\(\$\('chat'\), conversationKey\)\)/, '打开世界工作区后必须在最终布局帧重定位最新消息');
assert.match(source, /const statusBar = \$\('rpg-status'\);[\s\S]{0,220}statusBar\.hidden = worldRuntime/, '世界存档态不能保留空的旧状态栏占位');
assert.match(source, /function rpgRuntimeActionAvailabilityError\([\s\S]{0,2400}当前值 \$\{actual\}/, '动作可用性检查必须向 Agent 提供当前资源值');
assert.match(source, /submit\.disabled = alreadyConfirmed \|\| !!availabilityError/, '静态不可用的世界卡动作必须在界面中禁用');
assert.match(source, /function hideWorldStateFeedback\(\)[\s\S]{0,350}if \(worldModeActive\(\)\) renderRPG\(\);/, '本轮状态提示退出前必须先重绘以播放消失动画');
assert.doesNotMatch(styles, /\.rpg-prose \{ font-size: 14\.5px;/, '移动端 RPG 不得覆盖用户设置的正文字号');
assert.match(styles, /grid-template-columns:\s*var\(--rpg-panel-width\) minmax\(0, 1fr\) var\(--rpg-panel-width\);/, 'RPG 两侧栏必须使用界面设置宽度');
assert.doesNotMatch(styles, /\.chat > \.msg \{ content-visibility: auto;/, '窗口化已经限制消息数，不能再用估算高度破坏聊天滚动定位');
assert.match(html, /id="btn-input-fullscreen"[\s\S]{0,260}id="btn-send"/, 'RP/RPG 输入区必须提供全屏入口与发送按钮');
assert.match(html, /<dialog id="input-fullscreen-dialog"[\s\S]{0,500}id="input-fullscreen"/, '全屏输入必须使用可访问的原生 dialog');
assert.match(source, /const requestController = new AbortController\(\);[\s\S]{0,180}activeRequestController = requestController;[\s\S]{0,180}syncSendButton\(\);/, '发送时必须创建可中止请求并切换按钮状态');
assert.match(source, /if \(sending\) stopGeneration\(\); else sendMessage\(\)/, '生成中点击发送按钮必须停止当前回复');
const tavernCommit = source.slice(source.indexOf("const clean = processed.content"), source.indexOf('// 文生图（测试）', source.indexOf("const clean = processed.content")));
assert.ok(tavernCommit.indexOf('clearResponsePreview()') < tavernCommit.indexOf("pushMessage('assistant', clean, extra)"), 'RP 正式消息入库前必须清掉临时预览，避免正文重复和选项占位');
const clearChat = source.slice(source.indexOf("$('btn-clear-chat').addEventListener"), source.indexOf("$('btn-clear-chat').addEventListener") + 1800);
assert.match(clearChat, /if \(sending\) stopGeneration\(\);/, '清空对话必须中止进行中的异步回复');
assert.match(clearChat, /clearResponsePreview\(\);[\s\S]{0,120}removeTyping\(\);/, '清空对话必须移除临时回复节点');
assert.match(styles, /\.composer-row \{ display: flex; gap: 12px; align-items: stretch; \}/, '输入栏与按钮必须保持同高布局');
assert.match(styles, /\.send-spinner[\s\S]{0,240}animation: composer-spin/, '发送中按钮必须显示轻量加载动画');

const timers = [];
const context = vm.createContext({
  console,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  window: {}, document: {}, Date, Math, JSON, Set, Map, WeakMap,
  retryCalls: 0,
  setTimeout: callback => (timers.push(callback), timers.length), clearTimeout: () => {},
});
vm.runInContext(source, context);
const cached = vm.runInContext(`(() => {
  const world = { id: 'cache-check', version: 1, events: [{ id: 'legacy' }], playerCreation: { initialInventory: [{ id: 'legacy' }] } };
  const first = compactRpgWorldCard(world);
  const second = compactRpgWorldCard(world);
  return { same: first === second, eventsRemoved: !Object.hasOwn(first, 'events'), inventoryRemoved: !Object.hasOwn(first.playerCreation, 'initialInventory') };
})()`, context);
assert.strictEqual(cached.same, true, '同一世界卡对象只应压缩一次');
assert.strictEqual(cached.eventsRemoved, true);
assert.strictEqual(cached.inventoryRemoved, true);
assert.deepStrictEqual(
  Array.from(vm.runInContext(`RPG_CHECK_TONES['critical-success']`, context)),
  ['is-gold', '★'],
  '远超目标的判定必须使用金色结果态',
);

const feedback = vm.runInContext(`(() => {
  const before = {
    state: {
      player: { resources: { hp: 8 } },
      runtime: { collections: {
        inventory: [{ id: 'ration', label: '口粮', count: 2 }, { id: 'ember', label: '龙火碎片', count: 1 }],
        clues: [{ id: 'paw', title: '玻璃兽爪', status: 'unconfirmed' }],
      } },
    },
  };
  const after = {
    state: {
      player: { resources: { hp: 6 } },
      runtime: { collections: {
        inventory: [{ id: 'ration', label: '口粮', count: 1 }],
        clues: [{ id: 'paw', title: '玻璃兽爪', status: 'confirmed' }],
      } },
    },
  };
  const changes = collectWorldStateFeedbackChanges(before, after);
  const items = worldStateFeedbackItems(before, after);
  return {
    hp: changes.get(worldStatePathKey(['state', 'player', 'resources', 'hp'])),
    ration: changes.get(worldStatePathKey(['state', 'runtime', 'collections', 'inventory', 'ration', 'count'])),
    rationItem: items.find(item => item.label === '口粮'),
    removedItem: items.find(item => item.label === '龙火碎片'),
    clueItem: items.find(item => item.label === '玻璃兽爪'),
  };
})()`, context);
assert.strictEqual(feedback.hp, -2, '角色资源变化必须生成实际差值');
assert.strictEqual(feedback.ration, -1, '集合物品数量变化必须按稳定 ID 生成差值');
assert.strictEqual(feedback.rationItem.delta, -1, '本轮物品变化必须保留可显示的差值');
assert.strictEqual(feedback.removedItem.kind, 'remove', '本轮移除物品必须保留到回合反馈');
assert.strictEqual(feedback.clueItem.value, '已确认', '本轮状态切换必须使用界面文案');

const persistedFeedback = vm.runInContext(`(() => {
  const pending = {
    beforeState: { runtime: { collections: { inventory: [{ id: 'ration', label: '口粮', count: 2 }] } } },
    assistantMessage: { role: 'assistant', content: '吃下口粮。' },
  };
  attachWorldStateFeedback(pending, { runtime: { collections: { inventory: [{ id: 'ration', label: '口粮', count: 1 }] } } });
  restoreWorldStateFeedback({ id: 'save-feedback', turns: [pending.assistantMessage] });
  return { stored: pending.assistantMessage.stateChanges, restored: worldStateFeedback.changes.size };
})()`, context);
assert.strictEqual(persistedFeedback.stored[0].delta, -1, '回合差异必须随 assistant 消息保存');
assert.strictEqual(persistedFeedback.restored, 1, '刷新存档后必须能恢复当前回合差异');

const themed = vm.runInContext(`(() => {
  const makeStyle = () => {
    const values = {};
    return { values, setProperty: (key, value) => { values[key] = value; }, removeProperty: key => { delete values[key]; } };
  };
  const root = makeStyle();
  const body = makeStyle();
  document.documentElement = { style: root };
  document.body = { style: body, dataset: {} };
  mode = 'rpg';
  currentWorldId = 'theme-world';
  currentWorldSaveId = 'theme-save';
  currentWorldSave = { id: 'theme-save', worldVersion: 1, state: {} };
  worldCards = [{ id: 'theme-world', version: 1, ui: { theme: { tokens: { accent: '#abcdef' } } } }];
  applyUiTheme({ ...UI_THEME_DEFAULTS, colors: { ...UI_THEME_DEFAULTS.colors, accent: '#123456' }, rpgPanelWidth: 287, customVars: {} });
  return { rootAccent: root.values['--accent'], bodyAccent: body.values['--accent'], panelWidth: body.values['--rpg-panel-width'], owner: document.body.dataset.uiTheme };
})()`, context);
assert.strictEqual(themed.rootAccent, '#123456', 'RPG 必须继承用户界面主题作为基础');
assert.strictEqual(themed.bodyAccent, '#abcdef', '世界卡显式 token 必须只覆盖对应颜色');
assert.strictEqual(themed.panelWidth, '287px', 'RPG 面板尺寸必须继承用户界面设置');

context.window.requestAnimationFrame = callback => callback();
const scrolled = vm.runInContext(`(() => {
  const chat = { scrollTop: 0, scrollHeight: 481, isConnected: true, scrollTo: ({ top, behavior }) => { chat.scrollTop = top; chat.behavior = behavior; } };
  const key = activeConversationKey();
  scrollChatToLatest(chat, key);
  return { top: chat.scrollTop, behavior: chat.behavior };
})()`, context);
assert.strictEqual(scrolled.top, 481, '布局后的滚动校正必须落在最新消息');
assert.strictEqual(scrolled.behavior, 'instant', '布局后的滚动校正不能被聊天区 CSS 的平滑滚动劫持');

const recovery = vm.runInContext(`(() => {
  mode = 'rpg';
  currentWorldSaveId = 'save-retry';
  currentWorldSave = {
    id: 'save-retry', state: {}, turns: [
      { role: 'user', content: '🎲 工具掷骰 1d20 = 10', meta: true },
      { role: 'user', content: '继续调查' },
    ], setup: { status: 'active' },
  };
  worldTurnPending = { saveId: 'save-retry', commandId: 'cmd-retry', beforeState: {}, state: {}, messages: [], agentExecution: {}, autoRetryCount: 0 };
  worldTurnError = null;
  renderMessages = () => {};
  retryWorldTurn = async () => { retryCalls += 1; };
  failWorldTurnPending('RPG 输出协议仍不完整：options 需要 3-4 个非空字符串');
  return {
    count: worldTurnPending.autoRetryCount,
    queued: worldTurnError.autoRetry,
    permanent: shouldAutoRetryWorldTurn('HTTP 401'),
    timeline: worldTimelineMessages().map(message => message.content),
  };
})()`, context);
assert.strictEqual(recovery.count, 1, '可恢复协议错误必须自动重试一次');
assert.strictEqual(recovery.queued, true);
assert.strictEqual(recovery.permanent, false, '鉴权错误不能自动重试');
assert.deepStrictEqual(Array.from(recovery.timeline), ['继续调查'], '旧版骰子方框消息必须从现有存档时间线隐藏');
assert.strictEqual(timers.length, 1, '可恢复错误必须排入一次自动重试');
timers[0]();
assert.strictEqual(context.retryCalls, 1, '自动重试定时任务必须实际调用重试流程');

console.log('check_frontend_state_guards: ok');
