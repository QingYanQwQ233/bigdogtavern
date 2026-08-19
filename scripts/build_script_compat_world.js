'use strict';

const fs = require('fs');
const crypto = require('crypto');

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const canonicalJson = value => Array.isArray(value)
  ? '[' + value.map(canonicalJson).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}'
    : JSON.stringify(value);

const defaults = read('public/data/_defaults.json');
const source = defaults.worlds.find(world => world.id === 'world-grey-harbor') || defaults.worlds[0];
if (!source) throw new Error('没有可用的世界卡模板');

const world = clone(source);
world.schemaVersion = 1;
world.id = 'world-script-compat-lab';
world.version = 1;
world.title = '脚本兼容实验室 · MVU / JS / EJS';
world.summary = '用一张可直接游玩的世界卡，展示安全 EJS 模板、MVU 状态写入和隔离 JS 交互。';
world.coverImage = '';
world.tags = ['兼容测试', 'MVU', 'JS', 'EJS', 'sandbox'];
world.setting = {
  premise: '你进入了一间不会执行未知脚本的兼容实验室。每个面板都把原文、结果和安全边界分开显示。',
  currentSituation: '实验室等待你的第一次点击：先观察 EJS，再写入 MVU，最后触发隔离 JS。',
};
world.rules = {
  hard: [
    '角色卡和预设中的 EJS、MVU、JS 只保留原文，不进入主页面执行。',
    '世界卡 ui.extension 只在用户授权的 sandbox iframe 中运行。',
    'MVU 只能写入本卡声明的 runtime 变量。',
  ],
  soft: ['先看结果，再看源代码；每个按钮只改变它对应的演示状态。'],
};
world.playerCreation = {
  mode: 'custom',
  title: '进入兼容实验室',
  description: '只需要一个显示名；其余内容由演示卡固定，避免把测试变成建档流程。',
  fields: [{ id: 'name', label: '显示名', type: 'text', required: true, maxLength: 80, default: '测试者' }],
  attributes: [],
  skills: [],
  resources: [{ id: 'hp', label: '稳定度', type: 'number', min: 1, max: 1, initial: 1 }],
  traits: [],
  choices: [],
  initialInventory: [],
};
world.turnContract = { options: { min: 0, max: 0 }, actionIntent: false };
world.failure = { defaultMode: 'continue', modes: [{ id: 'continue', label: '继续', description: '演示状态不会导致世界线失败。' }] };
world.ending = { enabled: false, allowPlayerEnd: false, requireConfirm: false, endings: [] };
world.time = { unit: '测试步', start: 0, turnAdvance: 1 };
world.start = {
  locationId: 'compat-lab',
  openingMode: 'static',
  opening: '欢迎来到脚本兼容实验室。请在上方三个面板中依次点击 EJS、MVU、JS；每次结果都会直接显示在卡内。',
  playerTemplate: { name: '测试者', race: '人类', role: '兼容性测试员', profileFields: [] },
  initialState: {
    stats: { level: 1, exp: 0, expNext: 1, hp: 1, maxHp: 1, mp: 0, maxMp: 0, gold: 0, buffs: [] },
    inventory: [],
    quests: [],
  },
};
world.npcIds = [];
world.npcs = [];
world.characterIds = [];
world.factionIds = [];
world.factions = [];
world.itemIds = [];
world.questTemplateIds = [];
world.locations = [{ id: 'compat-lab', name: '兼容实验室', type: 'facility', summary: '一个用于验证隔离前端和声明式状态的测试房间。' }];
delete world.map;
world.events = [];
world.conflicts = [];
world.lorebookIds = [];
world.rpgPresetName = '';
world.sessionSetup = { title: '兼容演示设置', fields: [{ id: 'showSource', label: '显示源代码', type: 'boolean', default: true }] };
world.agent = {};
world.runtime = {
  version: 1,
  variables: [
    { id: 'demo_status', label: 'MVU 状态', scope: 'save', type: 'enum', options: ['等待写入', 'MVU 已写入'], initial: '等待写入', visible: false },
    { id: 'demo_count', label: 'MVU 写入次数', scope: 'save', type: 'number', min: 0, max: 99, initial: 0, visible: false },
  ],
};
world.ui = {
  layout: 'immersive',
  extension: {
    enabled: true,
    immersive: true,
    title: '脚本兼容实验室',
    maxHeight: 680,
    timeoutMs: 1800,
    permissions: ['read.public', 'read.save', 'write.runtime'],
    mvu: { protocol: 'mvu.compat', version: 1 },
    html: `<section class="compat-demo" aria-labelledby="compat-title">
  <header class="compat-head">
    <div><span class="compat-eyebrow">TAVERN / SCRIPT COMPAT LAB</span><h1 id="compat-title">脚本兼容实验室</h1><p>同一张世界卡，分别展示安全 EJS、持久化 MVU 和隔离 JS。</p></div>
    <span id="compat-bridge" class="compat-bridge" role="status">连接中…</span>
  </header>
  <div class="compat-grid">
    <article class="compat-card compat-ejs"><div class="compat-label">01 / EJS</div><h2>安全模板渲染</h2><p class="compat-muted">只解析两个模板占位符，不执行任意代码。</p><pre>&lt;% if (user) { %&gt;你好，&lt;%= user.name %&gt;&lt;% } %&gt;</pre><output id="compat-ejs-output">等待上下文…</output></article>
    <article class="compat-card compat-mvu"><div class="compat-label">02 / MVU</div><h2>写入存档状态</h2><p class="compat-muted">按钮通过 TavernExtension.mvu 提交声明式变量。</p><pre>{"variables":{"demo_status":"MVU 已写入","demo_count":1}}</pre><output id="compat-mvu-output">等待上下文…</output><button id="compat-mvu-button" type="button">写入 MVU</button></article>
    <article class="compat-card compat-js"><div class="compat-label">03 / JS</div><h2>隔离脚本交互</h2><p class="compat-muted">按钮只作用于当前 sandbox iframe，不接触主页面。</p><pre>button.addEventListener('click', render)</pre><output id="compat-js-output">尚未点击</output><button id="compat-js-button" type="button">点击测试 JS</button></article>
  </div>
  <footer class="compat-foot"><span>角色卡脚本：保留但不执行</span><span>世界卡扩展：用户授权后 sandbox</span><span id="compat-revision">revision —</span></footer>
</section>`,
    css: `.compat-demo{height:100%;min-height:100%;padding:28px;color:#edf7ff;background:radial-gradient(circle at 86% 0,rgba(93,129,255,.26),transparent 38%),linear-gradient(145deg,#111923,#172c39 58%,#241a35);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}.compat-demo *{box-sizing:border-box}.compat-head{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;padding-bottom:22px;border-bottom:1px solid rgba(255,255,255,.16)}.compat-eyebrow,.compat-label{font:11px ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.16em;color:#79f2d2}.compat-head h1{margin:8px 0 7px;font-size:30px;letter-spacing:.03em}.compat-head p{margin:0;color:#afc4d0;line-height:1.6}.compat-bridge{padding:7px 10px;border:1px solid rgba(121,242,210,.42);border-radius:999px;color:#79f2d2;font:11px ui-monospace,SFMono-Regular,Consolas,monospace;white-space:nowrap}.compat-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:22px}.compat-card{display:flex;flex-direction:column;min-height:330px;padding:18px;border:1px solid rgba(255,255,255,.16);border-radius:16px;background:rgba(255,255,255,.06);box-shadow:0 18px 38px rgba(0,0,0,.2)}.compat-card h2{margin:9px 0 7px;font-size:20px}.compat-muted{min-height:48px;margin:0;color:#aac0cb;font-size:13px;line-height:1.6}.compat-card pre{min-height:86px;margin:14px 0;padding:12px;overflow:auto;border-radius:9px;background:rgba(0,0,0,.3);color:#ffd891;font:12px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.compat-card output{display:block;min-height:46px;margin-top:auto;padding:12px;border-left:2px solid #79f2d2;background:rgba(0,0,0,.18);color:#f4fbff;line-height:1.6}.compat-card button{margin-top:12px;padding:11px 14px;border:1px solid rgba(121,242,210,.55);border-radius:9px;background:rgba(121,242,210,.12);color:#eafffa;font-weight:600;cursor:pointer}.compat-card button:hover{background:rgba(121,242,210,.24)}.compat-card button:disabled{opacity:.6;cursor:wait}.compat-mvu{border-color:rgba(255,216,145,.46)}.compat-js{border-color:rgba(160,143,255,.54)}.compat-foot{display:flex;flex-wrap:wrap;gap:12px;margin-top:20px;color:#9cb4c0;font-size:12px}.compat-foot span{padding:7px 9px;border:1px solid rgba(255,255,255,.12);border-radius:8px}@media(max-width:720px){.compat-demo{height:auto;min-height:100%;padding:18px}.compat-head{display:block}.compat-bridge{display:inline-block;margin-top:14px}.compat-head h1{font-size:24px}.compat-grid{grid-template-columns:1fr}.compat-card{min-height:0}.compat-muted{min-height:0}}@media(prefers-reduced-motion:reduce){.compat-card button{transition:none}}`,
    js: `(()=>{const root=document.querySelector('.compat-demo');if(!root)return;const ejsOutput=root.querySelector('#compat-ejs-output');const mvuOutput=root.querySelector('#compat-mvu-output');const jsOutput=root.querySelector('#compat-js-output');const bridge=root.querySelector('#compat-bridge');const revision=root.querySelector('#compat-revision');const mvuButton=root.querySelector('#compat-mvu-button');const jsButton=root.querySelector('#compat-js-button');const template='<% if (user) { %>你好，<%= user.name %><% } %>';let last=null;let jsClicks=0;let busy=false;const vars=context=>context&&context.save&&context.save.state&&context.save.state.runtime&&context.save.state.runtime.variables||{};const renderSafeEjs=(source,user)=>user?source.replace('<% if (user) { %>','').replace('<%= user.name %>',String(user.name||'')).replace('<% } %>',''):'';function paint(context){last=context||last;const user=last&&last.save&&last.save.player&&last.save.player.snapshot||{};const values=vars(last);ejsOutput.textContent='结果：'+renderSafeEjs(template,user)+'（安全模板子集）';mvuOutput.textContent='存档变量：'+String(values.demo_status||'等待写入')+' · 次数 '+String(values.demo_count||0);revision.textContent='revision '+String(last&&last.save&&last.save.revision||0);bridge.textContent='sandbox 已连接';}async function refresh(){try{paint(await TavernExtension.requestContext())}catch(error){bridge.textContent='同步失败';mvuOutput.textContent=error.message}}mvuButton.addEventListener('click',async()=>{if(busy)return;busy=true;mvuButton.disabled=true;try{const values=vars(last);await TavernExtension.mvu({variables:{demo_status:'MVU 已写入',demo_count:Math.min(99,Number(values.demo_count||0)+1)}});await refresh()}catch(error){mvuOutput.textContent='MVU 失败：'+error.message}finally{busy=false;mvuButton.disabled=false}});jsButton.addEventListener('click',()=>{jsClicks+=1;jsOutput.textContent='JS 事件已触发 '+jsClicks+' 次（仅在隔离 iframe 内）';bridge.textContent='sandbox JS 已运行'});window.addEventListener('tavern-context',event=>paint(event.detail));refresh()})()`,
  },
};
world.source = { format: 'native', rawAssetRef: 'docs/demo-script-compat-world.tavern-world.json' };

const content = {
  world,
  characters: [],
  lorebooks: { default: { name: '脚本兼容实验室默认世界书', entries: [] } },
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
    author: 'Tavern Compatibility Lab',
    license: null,
    contentHash,
    hashScope: 'canonical-json(content,assets)',
    capabilities: { ui: { layout: 'immersive', extension: true }, runtime: true, agent: false, regexes: 0 },
    references: { characters: 0, lorebooks: 1, presets: 0, assets: 0 },
    privacy: { excludes: ['settings', 'user', 'worldSaves'], redactedPaths: [] },
    executableContent: { html: true, scripts: true, regexTriggers: 0, executedDuringExport: false },
    warnings: ['扩展只在用户授权的 sandbox iframe 中运行；角色卡与预设脚本仍保持不执行。'],
  },
  content,
  assets,
};
fs.writeFileSync('docs/demo-script-compat-world.tavern-world.json', JSON.stringify(pkg, null, 2) + '\n');
console.log(`built ${pkg.manifest.packageId} · ${pkg.manifest.contentHash}`);
