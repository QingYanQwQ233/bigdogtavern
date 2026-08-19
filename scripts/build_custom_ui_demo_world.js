'use strict';

const fs = require('fs');
const crypto = require('crypto');

const clone = value => JSON.parse(JSON.stringify(value));
const canonicalJson = value => Array.isArray(value)
  ? '[' + value.map(canonicalJson).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}'
    : JSON.stringify(value);

const source = JSON.parse(fs.readFileSync('docs/demo-script-compat-world.tavern-world.json', 'utf8'));
const world = clone(source.content.world);
world.schemaVersion = 1;
world.id = 'world-custom-ui-lab';
world.version = 1;
world.title = '雨幕协议 · 自定义界面实验室';
world.summary = '一张导入即接管的世界卡：宿主壳层、叙事、选项、输入和存档状态全部由卡内前端统一呈现。';
world.coverImage = '';
world.tags = ['自定义 UI', 'MVU', 'Agent', '整页接管'];
world.setting = {
  premise: '你在雨幕协议的控制舱醒来。这里没有宿主 RPG 外壳，所有可见界面都属于这张世界卡。',
  currentSituation: '控制舱正在等待你的第一条指令；左侧状态、中央叙事和右侧日志都由隔离扩展实时更新。',
};
world.rules = {
  hard: [
    '世界卡前端负责呈现，不直接修改主页面；状态变化必须通过 TavernExtension 桥接提交。',
    'AI 只根据当前存档和世界卡状态叙事，不把隐藏数据当作玩家已知信息。',
  ],
  soft: ['优先使用卡内选项和输入框推进；需要自由行动时再使用底部输入。'],
};
world.playerCreation = {
  mode: 'custom',
  title: '连接控制舱',
  description: '只填写一个称呼，其他界面状态由本示例卡初始化。',
  fields: [{ id: 'name', label: '称呼', type: 'text', required: true, maxLength: 80, default: '访客' }],
  attributes: [],
  skills: [],
  resources: [],
  traits: [],
  choices: [],
  initialInventory: [],
};
world.turnContract = { options: { min: 3, max: 3 }, actionIntent: true };
world.failure = { defaultMode: 'continue', modes: [{ id: 'continue', label: '继续', description: '演示不会因状态变化而结束。' }] };
world.ending = { enabled: false, allowPlayerEnd: false, requireConfirm: false, endings: [] };
world.time = { unit: '回合', start: 1, turnAdvance: 1 };
world.start = {
  locationId: 'compat-lab',
  openingMode: 'static',
  opening: '**雨幕协议已上线。**\n\n雨声敲在控制舱外壳上，卡内界面先于世界本身醒来：\n\n- 左侧是你的存档状态；\n- 中央是唯一消息流；\n- 右侧是尚未确认的协议。',
  options: ['查看控制舱状态', '读取右侧协议日志', '对雨幕协议说“你好”'],
  playerTemplate: { name: '访客', race: '人类', role: '协议观察员', profileFields: [] },
  initialState: {
    stats: { level: 1, exp: 0, expNext: 10, hp: 10, maxHp: 10, mp: 3, maxMp: 3, gold: 0, buffs: [] },
    inventory: [],
    quests: [],
    goals: [{ id: 'custom-ui-tour', title: '走完一次界面回路', desc: '点击 MVU、Action、选项和自由输入，观察同一存档如何驱动整页 UI。', status: 'active' }],
  },
};
world.runtime = {
  version: 1,
  variables: [
    { id: 'signal', label: '信号强度', scope: 'save', type: 'number', min: 0, max: 9, initial: 0, visible: false },
    { id: 'mode', label: '协议状态', scope: 'save', type: 'enum', options: ['待机', '巡航', '警报'], initial: '待机', visible: false },
  ],
  actions: [{
    id: 'pulse',
    label: '发送脉冲',
    description: '通过声明式 runtime action 将信号强度提高 1。',
    effects: [{ type: 'variable.delta', variableId: 'signal', delta: 1 }],
  }],
};
world.agent = {
  protocol: 'tavern.rpg.agent',
  version: 1,
  mode: 'native',
  maxSteps: 3,
  tools: {
    'state.patch': { enabled: true, execution: 'server', description: '按世界卡 Schema 更新存档状态。' },
    'objective.upsert': { enabled: true, execution: 'server', description: '维护当前目标。' },
  },
};
world.lorebookIds = [];
world.rpgPresetName = '';
world.regexes = [];
world.source = { format: 'native', rawAssetRef: 'docs/demo-custom-ui-world.tavern-world.json' };

const html = `<section class="custom-demo" aria-labelledby="custom-demo-title">
  <header class="custom-top">
    <div class="custom-heading">
      <span class="custom-eyebrow">WORLD CARD / IMMERSIVE UI LAB</span>
      <h1 id="custom-demo-title">雨幕协议</h1>
      <p>本卡通过世界声明接管 RPG 工作区：宿主壳层、叙事、选项、输入和状态栏全部隐藏，只保留这一套卡内界面。</p>
    </div>
    <div class="custom-top-actions" aria-label="界面控制">
      <button class="custom-control custom-control-enter" type="button" data-custom-action="fullscreen">进入浏览器全屏</button>
      <button class="custom-control custom-control-exit" type="button" data-custom-action="exit">退出沉浸</button>
      <button class="custom-control custom-control-world-exit" type="button" data-custom-action="world-exit">返回世界库</button>
      <button class="custom-control custom-control-terminal" type="button" data-custom-action="terminal">AI 终端</button>
      <div class="custom-connection" role="status"><i aria-hidden="true"></i><span id="custom-connection-label">sandbox 连接中</span></div>
    </div>
  </header>
  <div class="custom-body">
    <aside class="custom-rail custom-left" aria-label="卡内存档状态">
      <section class="custom-card custom-profile"><span class="custom-label">SESSION</span><strong data-tavern-bind="save.name">访客</strong><small data-tavern-bind="save.state.locationId">compat-lab</small></section>
      <section class="custom-card" aria-label="协议信号"><span class="custom-label">SIGNAL</span><div class="custom-metric"><b data-tavern-bind="save.state.runtime.variables.signal">0</b><span>/ 9</span></div><div class="custom-meter" aria-hidden="true"><i data-custom-signal-meter></i></div><span class="custom-subtle">协议状态 · <b data-tavern-bind="save.state.runtime.variables.mode">待机</b></span></section>
      <section class="custom-card custom-card-actions" aria-label="运行时测试"><span class="custom-label">RUNTIME BRIDGE</span><button class="custom-action" type="button" data-custom-action="mvu">MVU · 切换巡航</button><button class="custom-action quiet" type="button" data-custom-action="pulse">Action · 发送脉冲</button></section>
    </aside>
    <main class="custom-stage">
      <div class="custom-stage-head"><span class="custom-label">MESSAGE STREAM / 唯一消息区</span><span id="custom-revision">revision —</span></div>
      <section class="custom-message-stream" aria-label="唯一叙事消息流"><div class="custom-stream-head"><span class="custom-label">NARRATIVE</span><span>Markdown · Agent · State</span></div><div data-tavern-messages aria-live="polite">暂无消息</div></section>
      <section class="custom-choice-card" aria-label="可选行动"><div class="custom-choice-head"><span class="custom-label">NEXT MOVE</span><span>选择会进入同一回合</span></div><div data-tavern-options></div></section>
      <form class="custom-input" data-tavern-input><label class="sr-only" for="custom-action-input">自定义行动</label><textarea id="custom-action-input" rows="2" aria-label="自定义行动输入" placeholder="写下自由行动……"></textarea><button type="submit" data-tavern-submit>发送行动</button></form>
    </main>
    <aside class="custom-rail custom-right" aria-label="卡内协议面板">
      <section class="custom-card"><span class="custom-label">PROTOCOL LOG</span><ol class="custom-list"><li>宿主 RPG 同级区域已隐藏</li><li>消息、选项、输入由本卡渲染</li><li>状态写入经过隔离 Bridge</li></ol></section>
      <section class="custom-card custom-note"><span class="custom-label">CONTROL STATE</span><p>浏览器全屏可选；<kbd>Esc</kbd> 或“退出沉浸”会回到窗口化界面。</p><span id="custom-event-status">窗口化界面已恢复</span></section>
    </aside>
  </div>
  <footer class="custom-foot"><span>WORLD CARD owns the surface</span><span>MVU / ACTION / AGENT bridge ready</span><span>单一消息流 · 无重复滚动</span></footer>
</section>`;

const css = `.custom-demo{height:100%;min-height:100%;display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:20px;padding:clamp(20px,3vw,42px);color:#e8f3f6;background:radial-gradient(circle at 92% -12%,rgba(108,232,222,.18),transparent 34%),radial-gradient(circle at 8% 110%,rgba(240,148,83,.12),transparent 32%),linear-gradient(145deg,#081319,#0f242d 58%,#17222e);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}.custom-demo *{box-sizing:border-box}.custom-top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:20px;border-bottom:1px solid rgba(176,221,225,.2)}.custom-eyebrow,.custom-label{font:11px ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.16em;color:#77e6d5}.custom-top h1{margin:9px 0 6px;font-size:clamp(28px,4vw,46px);letter-spacing:.04em}.custom-top p{max-width:680px;margin:0;color:#a8c2c9;line-height:1.7}.custom-top-actions{display:flex;align-items:center;gap:10px}.custom-fullscreen{padding:8px 11px;border:1px solid rgba(247,189,115,.55);border-radius:999px;background:rgba(247,189,115,.1);color:#ffe1b2;font:12px ui-monospace,SFMono-Regular,Consolas,monospace;white-space:nowrap;cursor:pointer}.custom-fullscreen:hover{background:rgba(247,189,115,.2)}.custom-connection{display:flex;align-items:center;gap:8px;padding:8px 11px;border:1px solid rgba(119,230,213,.42);border-radius:999px;color:#77e6d5;font:12px ui-monospace,SFMono-Regular,Consolas,monospace;white-space:nowrap}.custom-connection i{width:7px;height:7px;border-radius:50%;background:#77e6d5;box-shadow:0 0 14px #77e6d5}.custom-body{display:grid;grid-template-columns:minmax(190px,250px) minmax(0,1fr) minmax(190px,250px);gap:18px;min-height:0}.custom-rail{display:flex;flex-direction:column;gap:12px;min-width:0}.custom-card{padding:16px;border:1px solid rgba(176,221,225,.18);border-radius:14px;background:rgba(13,34,43,.72);box-shadow:0 18px 36px rgba(0,0,0,.16)}.custom-profile strong{display:block;margin-top:12px;font-size:20px}.custom-profile small{display:block;margin-top:5px;color:#9cb9c0;font:12px ui-monospace,SFMono-Regular,Consolas,monospace}.custom-metric{display:flex;align-items:baseline;gap:5px;margin:13px 0 8px}.custom-metric b{font-size:34px;color:#f7bd73}.custom-metric span{color:#8ca9b0}.custom-meter{height:6px;overflow:hidden;border-radius:99px;background:rgba(255,255,255,.1)}.custom-meter i{display:block;width:0;height:100%;border-radius:inherit;background:linear-gradient(90deg,#f7bd73,#77e6d5);transition:width .25s ease}.custom-subtle{display:block;margin-top:11px;color:#9cb9c0;font-size:12px}.custom-subtle b{color:#e7f7f3}.custom-action{width:100%;padding:11px 12px;border:1px solid rgba(119,230,213,.54);border-radius:10px;background:rgba(119,230,213,.12);color:#e9fffb;font-weight:650;cursor:pointer}.custom-action:hover{background:rgba(119,230,213,.22)}.custom-action.quiet{border-color:rgba(247,189,115,.45);background:rgba(247,189,115,.08);color:#ffe1b2}.custom-stage{display:grid;grid-template-rows:auto auto minmax(110px,1fr) auto auto;gap:12px;min-width:0;min-height:0}.custom-stage-head{display:flex;justify-content:space-between;align-items:center;color:#95b5bc}.custom-stage-head>span:last-child{font:11px ui-monospace,SFMono-Regular,Consolas,monospace}.custom-narrative{min-height:128px;padding:20px;border:1px solid rgba(119,230,213,.34);border-radius:16px;background:linear-gradient(140deg,rgba(119,230,213,.12),rgba(13,34,43,.7));font-size:clamp(16px,2vw,21px);line-height:1.85;white-space:pre-wrap}.custom-log{min-height:0;overflow:auto;padding:14px;border:1px solid rgba(176,221,225,.14);border-radius:12px;background:rgba(7,19,25,.44)}[data-tavern-messages]{display:flex;flex-direction:column;gap:7px;max-height:150px;margin-top:10px;overflow:auto}.tavern-message{padding:7px 9px;border-left:2px solid rgba(119,230,213,.42);color:#abc5cb;font-size:12px;line-height:1.55;white-space:pre-wrap}.tavern-message-user{border-left-color:#f7bd73;color:#f6d6a4}.custom-choice-card{padding:14px;border:1px solid rgba(247,189,115,.34);border-radius:14px;background:rgba(53,39,25,.34)}[data-tavern-options]{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:10px}[data-tavern-options] .tavern-option{min-height:44px;padding:10px;border:1px solid rgba(247,189,115,.54);border-radius:9px;background:rgba(247,189,115,.08);color:#ffe1b2;text-align:left}[data-tavern-options] .tavern-option:hover{background:rgba(247,189,115,.18)}.custom-input{display:flex;gap:9px}.custom-input textarea{min-width:0;flex:1;resize:vertical;padding:11px 12px;border:1px solid rgba(176,221,225,.24);border-radius:10px;background:rgba(7,19,25,.72);color:#e8f3f6;outline:none}.custom-input textarea:focus{border-color:#77e6d5;box-shadow:0 0 0 3px rgba(119,230,213,.12)}.custom-input button{min-width:84px;border:1px solid rgba(119,230,213,.54);border-radius:10px;background:#77e6d5;color:#082026;font-weight:700;cursor:pointer}.custom-list{margin:13px 0 0;padding-left:18px;color:#aac4ca;font-size:12px;line-height:1.9}.custom-note{margin-top:auto;color:#a8c2c9;font-size:12px;line-height:1.7}.custom-note code,.custom-note kbd{padding:2px 5px;border-radius:4px;background:rgba(255,255,255,.1);color:#f7bd73;font:11px ui-monospace,SFMono-Regular,Consolas,monospace}.custom-note p{margin:12px 0}.custom-note span:last-child{color:#77e6d5}.custom-foot{display:flex;flex-wrap:wrap;gap:9px;padding-top:14px;border-top:1px solid rgba(176,221,225,.14);color:#89aab2;font:11px ui-monospace,SFMono-Regular,Consolas,monospace}.custom-foot span{padding:6px 8px;border:1px solid rgba(176,221,225,.14);border-radius:7px}@media(max-width:900px){.custom-demo{padding:20px}.custom-body{grid-template-columns:180px minmax(0,1fr)}.custom-right{display:none}}@media(max-width:640px){.custom-demo{display:block;overflow:auto;padding:16px}.custom-top{display:block}.custom-top-actions{margin-top:14px;flex-wrap:wrap}.custom-connection{display:inline-flex}.custom-body{display:block;margin-top:18px}.custom-rail{display:grid;grid-template-columns:1fr 1fr;margin-top:12px}.custom-right{display:grid}.custom-stage{display:flex;flex-direction:column}.custom-narrative{min-height:150px}.custom-log [data-tavern-messages]{max-height:180px}[data-tavern-options]{grid-template-columns:1fr}.custom-input{position:sticky;bottom:0;padding-top:12px;background:linear-gradient(180deg,transparent,#081319 24%)}.custom-foot{margin-top:18px}}@media(prefers-reduced-motion:reduce){.custom-meter i{transition:none}}`;

const cssOverrides = `.custom-stage{grid-template-rows:auto minmax(0,1fr) auto auto}.custom-message-stream{display:flex;flex-direction:column;min-height:0;overflow:hidden;padding:14px;border:1px solid rgba(176,221,225,.14);border-radius:12px;background:rgba(7,19,25,.44)}.custom-message-stream>[data-tavern-messages]{flex:1;min-height:0;max-height:none;margin-top:10px;overflow:auto;scrollbar-width:thin}.custom-message-stream [data-tavern-rendered] p{margin:.45em 0;line-height:1.7}.custom-message-stream [data-tavern-rendered] p:first-child{margin-top:0}.custom-message-stream [data-tavern-rendered] p:last-child{margin-bottom:0}@media(max-width:640px){.custom-stage{display:flex;flex-direction:column}.custom-message-stream{min-height:260px}.custom-message-stream>[data-tavern-messages]{max-height:none}[data-tavern-options]{grid-template-columns:1fr}}`;

const cssOverridesExtra = `.custom-heading{min-width:0}.custom-control{min-height:44px;padding:10px 13px;border:1px solid rgba(247,189,115,.58);border-radius:999px;background:rgba(247,189,115,.1);color:#ffe1b2;font:600 12px ui-monospace,SFMono-Regular,Consolas,monospace;white-space:nowrap;cursor:pointer;transition:background .2s ease,border-color .2s ease,transform .2s ease}.custom-control:hover{background:rgba(247,189,115,.2);border-color:#f7bd73;transform:translateY(-1px)}.custom-control:focus-visible,.custom-action:focus-visible,.custom-input button:focus-visible,[data-tavern-options] .tavern-option:focus-visible{outline:3px solid rgba(119,230,213,.72);outline-offset:3px}.custom-control-exit{border-color:rgba(119,230,213,.58);background:rgba(119,230,213,.1);color:#cffff7}.custom-control-exit:hover{background:rgba(119,230,213,.2);border-color:#77e6d5}.custom-control[hidden]{display:none}.custom-stream-head,.custom-choice-head{display:flex;justify-content:space-between;align-items:center;gap:10px;color:#95b5bc;font-size:11px}.custom-stream-head>span:last-child,.custom-choice-head>span:last-child{font:11px ui-monospace,SFMono-Regular,Consolas,monospace}.custom-choice-head{margin-bottom:8px}.custom-card-actions{display:flex;flex-direction:column;gap:9px}.custom-card-actions .custom-label{margin-bottom:2px}.custom-input{align-items:stretch}.custom-input textarea{font-size:16px;line-height:1.5}.custom-input button{min-height:44px;padding:10px 14px}.custom-demo kbd{font:inherit}.custom-demo .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:900px){.custom-body{grid-template-columns:minmax(170px,220px) minmax(0,1fr)}.custom-right{display:none}.custom-top-actions{flex-wrap:wrap;justify-content:flex-end}}@media(max-width:640px){.custom-demo{min-height:100%;padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}.custom-top-actions{justify-content:flex-start;gap:8px}.custom-control{flex:1 1 150px}.custom-body{display:block}.custom-left{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.custom-profile,.custom-card-actions{grid-column:1/-1}.custom-stage{margin-top:16px}.custom-message-stream{min-height:280px}.custom-message-stream>[data-tavern-messages]{max-height:none}.custom-input{position:sticky;bottom:0;z-index:2;padding-top:12px;background:linear-gradient(180deg,transparent,#081319 24%)}.custom-input button{flex:0 0 auto}.custom-foot{margin-top:18px}}@media(prefers-reduced-motion:reduce){.custom-control{transition:none}.custom-control:hover{transform:none}}`;

const js = `(()=>{const root=document.querySelector('.custom-demo');if(!root)return;const connection=root.querySelector('#custom-connection-label');const eventStatus=root.querySelector('#custom-event-status');const revision=root.querySelector('#custom-revision');const meter=root.querySelector('[data-custom-signal-meter]');const signalValue=root.querySelector('[data-tavern-bind="save.state.runtime.variables.signal"]');const mvuButton=root.querySelector('[data-custom-action="mvu"]');const pulseButton=root.querySelector('[data-custom-action="pulse"]');const fullscreenButton=root.querySelector('[data-custom-action="fullscreen"]');const exitButton=root.querySelector('[data-custom-action="exit"]');const worldExitButton=root.querySelector('[data-custom-action="world-exit"]');const terminalButton=root.querySelector('[data-custom-action="terminal"]');let busy=false;const runtime=context=>context&&context.save&&context.save.state&&context.save.state.runtime&&context.save.state.runtime.variables||{};function setImmersive(active){if(fullscreenButton)fullscreenButton.hidden=active;if(exitButton)exitButton.hidden=!active;if(eventStatus&&!busy)eventStatus.textContent=active?'沉浸界面已启用 · Esc 可退出':'窗口化界面已恢复';}function paint(context){const values=runtime(context);const signal=Math.max(0,Math.min(9,Number(values.signal||0)));if(meter)meter.style.width=(signal/9*100)+'%';if(signalValue)signalValue.textContent=String(signal);if(revision)revision.textContent='revision '+String(context&&context.save&&context.save.revision||0);if(connection)connection.textContent='sandbox 已连接';}async function run(button,task,success){if(busy)return;busy=true;if(button)button.disabled=true;if(eventStatus)eventStatus.textContent='提交中…';try{const result=await task();if(result&&result.fullscreen===false&&eventStatus)eventStatus.textContent='沉浸视图已启用（浏览器未授权全屏）';else if(eventStatus)eventStatus.textContent=success;if(success==='已退出沉浸')setImmersive(false);if(success==='已进入浏览器全屏')setImmersive(true);}catch(error){if(eventStatus)eventStatus.textContent='失败：'+error.message;}finally{busy=false;if(button)button.disabled=false;}}fullscreenButton?.addEventListener('click',()=>run(fullscreenButton,()=>TavernExtension.fullscreen(),'已进入浏览器全屏'));exitButton?.addEventListener('click',()=>run(exitButton,()=>TavernExtension.exitFullscreen(),'已退出沉浸'));worldExitButton?.addEventListener('click',()=>run(worldExitButton,()=>TavernExtension.exitWorld(),'正在返回世界库'));terminalButton?.addEventListener('click',()=>run(terminalButton,()=>TavernExtension.openTerminal(),'已打开 AI 终端'));mvuButton?.addEventListener('click',()=>run(mvuButton,()=>TavernExtension.mvu({variables:{mode:'巡航',signal:7}}),'MVU 已写入当前存档'));pulseButton?.addEventListener('click',()=>run(pulseButton,()=>TavernExtension.action('pulse',{}),'Action 已写入当前存档'));TavernExtension.on('turn.start',()=>{if(eventStatus)eventStatus.textContent='正在请求 AI…';});TavernExtension.on('turn.commit',()=>{if(eventStatus)eventStatus.textContent='回合已提交';});TavernExtension.on('turn.error',event=>{if(eventStatus)eventStatus.textContent='失败：'+String(event&&event.message||'回合未提交');});TavernExtension.on('agent.complete',()=>{if(eventStatus)eventStatus.textContent='Agent 已完成一回合';});root.addEventListener('tavern-input-error',event=>{if(eventStatus)eventStatus.textContent='失败：'+String(event.detail&&event.detail.message||'输入未提交');});window.addEventListener('tavern-context',event=>paint(event.detail));setImmersive(true);TavernExtension.requestContext().then(paint).catch(error=>{if(connection)connection.textContent='桥接失败';if(eventStatus)eventStatus.textContent=error.message;});})()`;

const jsContextSync = `(()=>{const enter=document.querySelector('[data-custom-action="fullscreen"]');const exit=document.querySelector('[data-custom-action="exit"]');const status=document.querySelector('#custom-event-status');window.addEventListener('tavern-context',event=>{const active=Boolean(event.detail&&event.detail.ui&&event.detail.ui.immersive);if(enter)enter.hidden=active;if(exit)exit.hidden=!active;if(status)status.textContent=active?'沉浸界面已启用 · Esc 可退出':'窗口化界面已恢复';});})();`;

world.ui = {
  schemaVersion: 1,
  layout: 'custom',
  shell: { navigation: 'hide', topbar: 'hide', fullscreen: true, escape: 'fullscreen' },
  regions: {
    topbar: { mode: 'hide' },
    'sidebar.left': { mode: 'hide' },
    narrative: { mode: 'hide' },
    options: { mode: 'hide' },
    input: { mode: 'hide' },
    'sidebar.right': { mode: 'hide' },
    status: { mode: 'hide' },
    overlay: { mode: 'hide' },
  },
  extension: {
    enabled: true,
    immersive: false,
    title: '雨幕协议 · 自定义界面',
    maxHeight: 800,
    timeoutMs: 1800,
    actionNarrates: false,
    permissions: ['read.public', 'read.save', 'write.runtime', 'tool.call'],
    mvu: { protocol: 'mvu.compat', version: 1 },
    html,
    css: css + cssOverrides + cssOverridesExtra,
    js: js + '\n;' + jsContextSync,
  },
};

const content = {
  world,
  characters: [],
  lorebooks: { default: { name: '雨幕协议默认世界书', entries: [] } },
  presets: {},
};
const assets = [];
const contentHash = 'sha256:' + crypto.createHash('sha256').update(canonicalJson({ content, assets })).digest('hex');
const pkg = {
  spec: 'tavern_world_package',
  specVersion: 1,
  exportedAt: new Date().toISOString(),
  manifest: {
    packageId: world.id,
    appContractVersion: 1,
    worldVersion: 1,
    worldSchemaVersion: 1,
    title: world.title,
    author: 'Tavern Custom UI Lab',
    license: null,
    contentHash,
    hashScope: 'canonical-json(content,assets)',
    capabilities: { ui: { layout: 'custom', regions: 8, shell: { navigation: 'hide', topbar: 'hide', fullscreen: true, escape: 'fullscreen' }, extension: true }, runtime: true, agent: true, regexes: 0 },
    references: { characters: 0, lorebooks: 1, presets: 0, assets: 0 },
    privacy: { excludes: ['settings', 'user', 'worldSaves'], redactedPaths: [] },
    executableContent: { html: true, scripts: true, regexTriggers: 0, executedDuringExport: false },
    warnings: ['扩展只在用户授权的 sandbox iframe 中运行；角色卡与预设脚本仍保持不执行。'],
  },
  content,
  assets,
};

fs.writeFileSync('docs/demo-custom-ui-world.tavern-world.json', JSON.stringify(pkg, null, 2) + '\n');
console.log(`built ${world.id} · ${contentHash}`);
