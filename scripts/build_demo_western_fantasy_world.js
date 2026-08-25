const fs = require('fs');
const crypto = require('crypto');

const canonicalJson = value => Array.isArray(value)
  ? '[' + value.map(canonicalJson).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}'
    : JSON.stringify(value);

const world = {
  schemaVersion: 1,
  id: 'world-ashen-frontier',
  version: 1,
  title: '灰烬边境：龙火余烬',
  summary: '一张以调查、探索、交涉和轻量危险为核心的西幻测试世界卡。玩家抵达边境城后，必须决定是否追查从天而降的龙火碎片。',
  coverImage: '',
  tags: ['西幻', '边境冒险', '调查', '魔法', '多路线', 'runtime测试'],
  setting: {
    premise: '旧王国覆灭后的第七年，一枚不该存在的龙火碎片坠入灰烬边境。它正在唤醒沉睡的古龙，也让城内三方势力开始互相试探。',
    history: '龙族曾与王国签订火印契约。王国覆灭后，契约没有消失，只是被拆成了三枚火印，分别埋在边境、修道院和月井森林。',
    geography: '灰烬关是边境城，北面是黑松林，西面是废弃修道院，城下有旧王国的火印地窖。',
    culture: '骑士团维持秩序，商会控制物资，月井女巫守护旧契约。公开谈论古龙会被视为不祥，但无人真的相信它已经死去。',
    currentSituation: '天火坠落后的第三天，城外出现被烧成玻璃的脚印。守门骑士封锁了北门，商会却在暗中收购所有红色矿石。'
  },
  rules: {
    hard: [
      '玩家拥有行动主权；选项只是建议，不能替玩家说话、思考或完成关键行动。',
      '只有真实风险、不确定性和后果同时存在时才进行判定；日常行动直接执行。',
      '需要判定时由客户端掷 1dN，修正来自当前玩家属性、技能或世界卡声明的数值；AI 不得伪造骰面。',
      '物品、技能、线索和关系必须通过 runtime.actions 修改当前存档，不能只写在叙事里。',
      '世界真相、玩家已知信息和 NPC 私密信息必须分开；未知信息不能因为 AI 知道就自动公开。'
    ],
    soft: [
      '失败改变局面而不是简单回档：可以失去时间、资源、信任或进入另一条路线。',
      '龙火相关的线索应逐步揭示，保留误导、传闻和未确认信息。'
    ],
    checks: [
      { id: 'inspect-ember', label: '龙火调查', description: '理解火印、矿石和现场痕迹。', roll: '1d20', target: 12, modifier: { bucket: 'attributes', id: 'insight', factor: 1 } },
      { id: 'negotiate-warden', label: '边境交涉', description: '争取骑士、商会或女巫的信任。', roll: '1d20', target: 13, modifier: { bucket: 'skills', id: 'negotiate', factor: 1 } },
      { id: 'cross-blackpine', label: '黑松林穿行', description: '在追踪者和魔化野兽之间找到安全路线。', roll: '1d20', target: 12, modifier: { bucket: 'skills', id: 'survival', factor: 1 } }
    ]
  },
  playerCreation: {
    mode: 'custom',
    title: '建立边境旅者',
    description: '选择一个出身预设，或自由分配 18 点属性。出身只提供倾向，不锁死路线。',
    pointBudget: { label: '属性点', total: 18, min: 1, mode: 'pool', cost: 'above-min' },
    defaultPresetId: 'runaway-apprentice',
    buildPresets: [
      { id: 'runaway-apprentice', label: '逃亡学徒', description: '洞察和法术潜力较高，适合调查龙火。', values: { attributes: { might: 2, agility: 4, insight: 7, nerve: 5 }, skills: { investigate: 4, negotiate: 2, survival: 1 }, traits: ['ember-sense'] } },
      { id: 'border-scout', label: '边境斥候', description: '灵巧和求生优先，适合探索黑松林。', values: { attributes: { might: 3, agility: 7, insight: 4, nerve: 4 }, skills: { investigate: 2, negotiate: 1, survival: 5 }, traits: ['trail-reader'] } },
      { id: 'disgraced-knight', label: '失势骑士', description: '力量和交涉较高，适合卷入城内政治。', values: { attributes: { might: 6, agility: 3, insight: 3, nerve: 6 }, skills: { investigate: 1, negotiate: 5, survival: 2 }, traits: ['old-oath'] } }
    ],
    fields: [
      { id: 'name', label: '角色名', type: 'text', required: true, maxLength: 80 },
      { id: 'origin', label: '出身', type: 'select', required: true, options: [{ value: '灰烬关', label: '灰烬关' }, { value: '王都废墟', label: '王都废墟' }, { value: '月井森林', label: '月井森林' }], default: '灰烬关' },
      { id: 'identity', label: '当前身份', type: 'textarea', required: true, maxLength: 1000 },
      { id: 'appearance', label: '外貌', type: 'textarea', maxLength: 1200 },
      { id: 'personality', label: '性格', type: 'textarea', maxLength: 1200 },
      { id: 'customNotes', label: '自定义补充', type: 'textarea', maxLength: 2400 }
    ],
    attributes: [
      { id: 'might', label: '力量', min: 1, max: 9, default: 3, step: 1 },
      { id: 'agility', label: '灵巧', min: 1, max: 9, default: 3, step: 1 },
      { id: 'insight', label: '洞察', min: 1, max: 9, default: 3, step: 1 },
      { id: 'nerve', label: '意志', min: 1, max: 9, default: 3, step: 1 }
    ],
    skills: [
      { id: 'investigate', label: '调查', description: '阅读遗迹、火印和口供。', min: 0, max: 10, default: 1, step: 1 },
      { id: 'negotiate', label: '交涉', description: '在骑士、商会和女巫之间交换承诺。', min: 0, max: 10, default: 1, step: 1 },
      { id: 'survival', label: '求生', description: '处理森林、野兽和边境道路。', min: 0, max: 10, default: 1, step: 1 }
    ],
    resources: [
      { id: 'hp', label: '生命', type: 'number', min: 1, max: 100, initial: 20 },
      { id: 'mana', label: '法力', type: 'number', min: 0, max: 30, initial: 8 },
      { id: 'coins', label: '银币', type: 'number', min: 0, max: 9999, initial: 24 }
    ],
    derived: [
      { id: 'field-readiness', label: '野外准备', formula: 'attributes.agility + skills.survival', description: '探索和撤退时的基础准备度。' },
      { id: 'arcane-leverage', label: '奥术筹码', formula: 'attributes.insight + resources.mana', description: '解读火印和施法时的基础筹码。' }
    ],
    traits: [
      { id: 'ember-sense', label: '火印感知', description: '靠近龙火遗物时能察觉温度变化。' },
      { id: 'trail-reader', label: '追迹者', description: '在黑松林中失败时仍能保留一条退路。' },
      { id: 'old-oath', label: '旧誓言', description: '骑士团更愿意听你说完，但会要求你承担责任。' },
      { id: 'debt-to-witch', label: '女巫债务', description: '月井女巫认识你，也可能要求你偿还旧债。' }
    ],
    choiceBudget: { label: '特质选择数', total: 2, min: 0 },
    choices: [
      { id: 'ember-sense', label: '火印感知', kind: 'trait', cost: 1, description: '调查龙火时更容易找到真实痕迹。' },
      { id: 'trail-reader', label: '追迹者', kind: 'trait', cost: 1, description: '黑松林失败后保留一条退路。' },
      { id: 'old-oath', label: '旧誓言', kind: 'trait', cost: 1, description: '与骑士团交涉时获得额外信任。' },
      { id: 'debt-to-witch', label: '女巫债务', kind: 'flaw', cost: 0, description: '女巫线更容易开启，但会附带代价。' }
    ],
    relations: [
      { npcId: 'npc-seraphine', min: -100, max: 100, default: 0 },
      { npcId: 'npc-calder', min: -100, max: 100, default: 5 },
      { npcId: 'npc-eira', min: -100, max: 100, default: -5 }
    ]
  },
  turnContract: { options: { min: 3, max: 4 }, actionIntent: true },
  failure: {
    defaultMode: 'continue',
    onZeroHp: 'injured',
    modes: [
      { id: 'injured', label: '负伤', description: '保留世界线，恢复少量生命并附加负伤状态。', hpRatio: 0.25, effect: '负伤' },
      { id: 'continue', label: '带着代价继续', description: '失败改变局面，但不替玩家结束故事。' }
    ]
  },
  ending: {
    enabled: true,
    allowPlayerEnd: true,
    requireConfirm: true,
    defaultEndingId: 'player-choice',
    endings: [
      { id: 'player-choice', kind: 'player-choice', label: '玩家主动结束', description: '保留当前存档并结束本次边境旅程。', terminal: true },
      { id: 'dragon-sleeps', kind: 'card-defined', label: '龙火沉睡', description: '你让火印重新闭合，边境暂时恢复平静。', terminal: true },
      { id: 'dragon-wakes', kind: 'card-defined', label: '古龙苏醒', description: '你打开了地窖深处的契约，边境进入新的时代。', terminal: true }
    ]
  },
  time: { unit: '日', start: 3, turnAdvance: 1 },
  locations: [
    { id: 'ashgate', name: '灰烬关', type: 'border-town', summary: '骑士团、商会和旅店聚集的边境城。', tags: ['起点', '安全区', '势力交汇'] },
    { id: 'blackpine-road', name: '黑松林旧道', type: 'forest', summary: '通往月井森林的旧路，最近出现玻璃化兽爪印。', tags: ['探索', '危险'] },
    { id: 'ruined-abbey', name: '灰钟修道院', type: 'ruins', summary: '西境废弃修道院，地下保存着王国火印的残片。', tags: ['遗迹', '调查'] },
    { id: 'moonwell', name: '月井森林', type: 'forest', summary: '女巫伊拉守护的森林，月井能照出契约的真实名字。', tags: ['魔法', 'NPC'] },
    { id: 'ember-vault', name: '龙火地窖', type: 'dungeon', summary: '灰烬关地下的旧王国地窖，终点并不等于唯一结局。', tags: ['终局', '高风险'] }
  ],
  npcs: [
    { id: 'npc-seraphine', name: '塞拉芬·灰盾', role: '边境骑士队长', description: '她把秩序看得比个人荣誉更重，却不愿承认自己害怕龙火。', persona: '克制、直接、相信行动胜过传闻。', publicFacts: ['封锁了北门', '负责调查玻璃化兽爪印'], publicGoals: ['保护灰烬关居民'], secrets: [{ id: 'seraphine-burn', content: '她曾在龙火事故中失去一名弟弟，因此极力主张销毁碎片。' }], locationId: 'ashgate', homeLocationId: 'ashgate' },
    { id: 'npc-calder', name: '卡尔德·铜壶', role: '边境商会药剂师', description: '他卖药、收购红矿，也知道哪些货物从修道院流出来。', persona: '圆滑、务实、讨厌无偿帮忙。', publicFacts: ['掌管旅店和药剂铺', '正在收购红色矿石'], publicGoals: ['在封锁前把货物送出城'], secrets: [{ id: 'calder-route', content: '他收购的红矿来自龙火地窖，并非普通矿石。' }], locationId: 'ashgate', homeLocationId: 'ashgate' },
    { id: 'npc-eira', name: '伊拉·月井', role: '月井女巫', description: '她守护古老契约，不把骑士团或商会视为真正的敌人。', persona: '耐心、神秘、从不免费回答第二个问题。', publicFacts: ['居住在月井森林', '知道旧王国火印的名字'], publicGoals: ['阻止龙火被重新利用'], secrets: [{ id: 'eira-name', content: '她知道第三枚火印其实藏在灰烬关城下。' }], locationId: 'moonwell', homeLocationId: 'moonwell' }
  ],
  npcIds: ['npc-seraphine', 'npc-calder', 'npc-eira'],
  sessionSetup: {
    title: '本局边境配置',
    fields: [
      { id: 'difficulty', label: '边境压力', type: 'select', options: [{ value: 'story', label: '故事：失败代价较轻' }, { value: 'standard', label: '标准：资源与关系并重' }, { value: 'hard', label: '严酷：世界推进更快' }], default: 'standard' },
      { id: 'firstLead', label: '第一个抓手', type: 'select', options: [{ value: 'warden', label: '先找骑士队长' }, { value: 'merchant', label: '先查红矿来源' }, { value: 'forest', label: '直接前往月井森林' }], default: 'warden' },
      { id: 'allowNewEntities', label: '允许 AI 创建新 NPC/地点', type: 'boolean', default: false }
    ]
  },
  start: {
    locationId: 'ashgate',
    openingMode: 'static',
    opening: '第三日傍晚，你走进灰烬关。北门刚刚落锁，城墙外留着一串被高温烧成玻璃的兽爪印。旅店的壁炉里，一枚红色碎片正在无声发光。',
    options: ['去找塞拉芬队长，询问北门封锁的原因', '在铜壶药剂铺打听红色矿石的来源', '趁天黑前沿黑松林旧道离开灰烬关', '观察旅店里的红色碎片，尝试判断它是什么'],
    playerTemplate: { name: '未命名旅者', race: '人类', role: '边境旅者', profileFields: [] },
    initialState: {
      stats: { level: 1, exp: 0, expNext: 100, hp: 20, maxHp: 20, mp: 8, maxMp: 8, buffs: [] },
      player: { attributes: { might: 3, agility: 3, insight: 3, nerve: 3 }, skills: { investigate: 1, negotiate: 1, survival: 1 }, resources: { hp: 20, mana: 8, coins: 24 }, traits: [], relations: { 'npc-seraphine': 0, 'npc-calder': 5, 'npc-eira': -5 }, identity: {} }
    }
  },
  lorebookIds: ['ashen-frontier-lore'],
  rpgPresetName: 'RPG 灰烬边境航线',
  runtime: {
    version: 1,
    variables: [
      { id: 'day', label: '边境日期', scope: 'save', type: 'number', initial: 3, min: 1, max: 30, visible: true },
      { id: 'danger', label: '边境警戒', scope: 'save', type: 'enum', options: ['calm', 'alert', 'critical'], initial: 'calm', visible: true },
      { id: 'favor', label: '骑士团信任', scope: 'save', type: 'number', initial: 0, min: -10, max: 10, visible: true },
      { id: 'clues', label: '龙火线索', scope: 'save', type: 'number', initial: 0, min: 0, max: 8, visible: true },
      { id: 'mana', label: '当前法力', scope: 'save', type: 'number', initial: 8, min: 0, max: 30, visible: true }
    ],
    collections: [
      { id: 'inventory', label: '随身物品', scope: 'save', entrySchema: { type: 'object', properties: { id: { type: 'string' }, itemId: { type: 'string' }, label: { type: 'string' }, count: { type: 'number' } }, required: ['id', 'itemId', 'label', 'count'], additionalProperties: false }, initial: [{ id: 'travel-ration', itemId: 'travel-ration', label: '旅行口粮', count: 2 }, { id: 'mana-vial', itemId: 'mana-vial', label: '法力药剂', count: 1 }, { id: 'ember-shard', itemId: 'ember-shard', label: '龙火碎片', count: 1 }] },
      { id: 'bonds', label: '人物关系', scope: 'save', entrySchema: { type: 'object', properties: { id: { type: 'string' }, npcId: { type: 'string' }, label: { type: 'string' }, value: { type: 'number' } }, required: ['id', 'npcId', 'label', 'value'], additionalProperties: false }, initial: [{ id: 'bond-seraphine', npcId: 'npc-seraphine', label: '塞拉芬', value: 0 }, { id: 'bond-calder', npcId: 'npc-calder', label: '卡尔德', value: 5 }, { id: 'bond-eira', npcId: 'npc-eira', label: '伊拉', value: -5 }] },
      { id: 'clue-board', label: '线索板', scope: 'save', entrySchema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' }, status: { type: 'string' } }, required: ['id', 'title', 'text', 'status'], additionalProperties: false }, initial: [{ id: 'clue-glass-paw', title: '玻璃兽爪', text: '北门外的兽爪印被高温烧成了透明玻璃。', status: 'unconfirmed' }] }
    ],
    actions: [
      { id: 'eat-ration', label: '食用旅行口粮', category: 'item', description: '消耗一份口粮，恢复一点专注。没有口粮时不可用。', availability: [{ type: 'collection.number', collectionId: 'inventory', entryId: 'travel-ration', field: 'count', operator: '>', value: 0 }], effects: [{ type: 'collection.patch', collectionId: 'inventory', entryId: 'travel-ration', delta: { count: -1 } }, { type: 'variable.delta', variableId: 'day', delta: 0 }] },
      { id: 'drink-mana-vial', label: '饮用法力药剂', category: 'item', description: '消耗法力药剂，恢复 3 点当前法力。', availability: [{ type: 'collection.number', collectionId: 'inventory', entryId: 'mana-vial', field: 'count', operator: '>', value: 0 }], effects: [{ type: 'collection.patch', collectionId: 'inventory', entryId: 'mana-vial', delta: { count: -1 } }, { type: 'variable.delta', variableId: 'mana', delta: 3 }] },
      { id: 'inspect-ember', label: '调查龙火碎片', category: 'skill', description: '需要洞察判定；成功后确认一条线索。', check: { sides: 20, target: 12, modifiers: [{ source: 'player', bucket: 'attributes', id: 'insight' }] }, effects: [{ type: 'variable.delta', variableId: 'clues', delta: 1 }, { type: 'collection.patch', collectionId: 'clue-board', entryId: 'clue-glass-paw', set: { status: 'confirmed' } }] },
      { id: 'speak-seraphine', label: '与塞拉芬交涉', category: 'social', description: '需要交涉判定；成功后骑士团信任提高。', check: { sides: 20, target: 13, modifiers: [{ source: 'player', bucket: 'skills', id: 'negotiate' }] }, effects: [{ type: 'variable.delta', variableId: 'favor', delta: 2 }, { type: 'collection.patch', collectionId: 'bonds', entryId: 'bond-seraphine', delta: { value: 1 } }] },
      { id: 'raise-alert', label: '公开龙火危险', category: 'world', description: '不需要判定，但会让边境进入警戒。', effects: [{ type: 'variable.set', variableId: 'danger', value: 'alert' }] },
      { id: 'rest-at-inn', label: '在旅店休整', category: 'travel', description: '日常行动，推进一天并恢复一点法力。', effects: [{ type: 'variable.delta', variableId: 'day', delta: 1 }, { type: 'variable.delta', variableId: 'mana', delta: 1 }] }
    ]
  },
  agent: {
    protocol: 'tavern.rpg.agent',
    version: 1,
    mode: 'native',
    maxSteps: 4,
    tools: {
      'dice.roll': { enabled: true, execution: 'client', description: '只在 rules.check 之后请求客户端骰子。' },
      'rules.check': { enabled: true, execution: 'client-readonly', description: '按当前玩家属性、技能和世界卡目标计算结果。' },
      'state.patch': { enabled: true, execution: 'server', description: '提交校验后的存档状态变化。' },
      'memory.record': { enabled: true, execution: 'server', description: '记录玩家已知的稳定事实。' },
      'context.retrieve': { enabled: true, execution: 'server', description: '只读取当前存档权限范围内的世界信息。' },
      'entity.create': { enabled: false, execution: 'server', description: '测试卡关闭动态实体创建，避免污染世界定义。' }
    }
  },
  ui: {
    schemaVersion: 1,
    layout: 'world-desk',
    shell: { navigation: 'show', topbar: 'show', fullscreen: true, escape: 'fullscreen' },
    sidebar: { panels: [
      { id: 'ashen-locations', title: '边境地点', icon: '⌖', side: 'left', source: 'world.locations', layout: 'list', fields: ['name', 'type', 'summary'], emptyText: '暂无地点' },
      { id: 'ashen-inventory', title: '随身物品', icon: '◇', side: 'left', source: 'runtime.collections.inventory', layout: 'cards', fields: ['label', 'count'], emptyText: '没有可用物品' },
      { id: 'ashen-bonds', title: '人物关系', icon: '♧', side: 'right', source: 'runtime.collections.bonds', layout: 'cards', fields: ['label', 'value'], emptyText: '暂无关系记录' },
      { id: 'ashen-clues', title: '龙火线索', icon: '⌕', side: 'right', source: 'runtime.collections.clue-board', layout: 'cards', fields: ['title', 'text', 'status'], emptyText: '尚未确认线索' },
      { id: 'ashen-danger', title: '边境警戒', icon: '!', side: 'right', source: 'runtime.variables.danger', layout: 'list', fields: ['$key'], emptyText: '警戒状态未初始化' },
      { id: 'ashen-eat', title: '使用口粮', icon: '◇', side: 'left', source: 'runtime.actions.eat-ration', layout: 'actions' },
      { id: 'ashen-inspect', title: '调查龙火', icon: '⌁', side: 'left', source: 'runtime.actions.inspect-ember', layout: 'actions' }
    ] }
  },
  source: { format: 'native', rawAssetRef: null }
};

const content = {
  world,
  characters: [],
  lorebooks: {
    'ashen-frontier-lore': {
      name: '灰烬边境·西幻世界书',
      entries: [
        { title: '[世界]龙火契约', keys: '龙火,火印,古龙,契约', content: '龙火不是普通火焰，而是旧王国与古龙签订契约后留下的魔法媒介。三枚火印必须同时确认，才能打开龙火地窖。', enabled: true, constant: false, order: 100 },
        { title: '[地点]灰烬关', keys: '灰烬关,边境城,北门', content: '灰烬关由边境骑士团守卫。北门封锁后，任何离城行动都需要说明理由或承担警戒代价。', enabled: true, constant: false, order: 90 },
        { title: '[势力]三方关系', keys: '骑士团,商会,月井女巫,塞拉芬,卡尔德,伊拉', content: '骑士团想销毁龙火，商会想利用龙火获利，月井女巫想让契约继续沉睡。三方都不掌握完整真相。', enabled: true, constant: false, order: 80 },
        { title: '[事件]玻璃兽爪', keys: '玻璃兽爪,烧焦脚印,黑松林', content: '玻璃化兽爪是龙火近期活动的证据，但不能直接证明古龙已经苏醒。调查成功后才可把它作为已确认线索。', enabled: true, constant: false, order: 70 },
        { title: '[规则]魔法边界', keys: '法术,魔法,法力,火印', content: '魔法需要消耗法力或媒介。没有对应资源时不能凭空施法；危险施法才需要判定，普通点火和照明不需要判定。', enabled: true, constant: false, order: 60 }
      ]
    }
  },
  presets: {
    'RPG 灰烬边境航线': {
      systemPrompt: '你是《灰烬边境：龙火余烬》的世界叙事者。根据当前存档、世界书和工具结果推进西幻边境冒险。',
      postHistory: '先判断玩家行动是否合法、是否需要判定。需要判定时先调用 rules.check，再由客户端调用 dice.roll，最后根据结果调用 runtime.action.execute 或 state.patch。没有 check 的日常动作直接执行。不要伪造骰面，不要替玩家行动；正文结束后给出 3-4 个可选行动。',
      firstMes: '第三日傍晚，你走进灰烬关。北门刚刚落锁，城墙外留着一串被高温烧成玻璃的兽爪印。',
      modules: [
        { id: 'agency', name: '玩家主权', enabled: true, content: '不替玩家说话、思想、选择或完成关键行动。' },
        { id: 'agent', name: '工具循环', enabled: true, content: '遵守 observe → decide → guard → commit；工具结果返回后再继续叙事。' },
        { id: 'state', name: '状态真实', enabled: true, content: '物品、法力、线索和关系必须通过声明式 runtime action 写回存档。' },
        { id: 'narrative', name: '西幻叙事', enabled: true, content: '使用 Markdown；保留魔法、骑士、商会和女巫之间的冲突，不把传闻写成事实。' }
      ]
    }
  }
};

const assets = [];
const contentHash = 'sha256:' + crypto.createHash('sha256').update(canonicalJson({ content, assets })).digest('hex');
const pkg = {
  spec: 'tavern_world_package',
  specVersion: 1,
  exportedAt: new Date().toISOString(),
  manifest: {
    packageId: world.id,
    worldVersion: world.version,
    worldSchemaVersion: world.schemaVersion,
    appContractVersion: 1,
    title: world.title,
    author: 'Tavern',
    license: null,
    contentHash,
    hashScope: 'canonical-json(content,assets)',
    capabilities: { ui: { layout: 'world-desk', extension: false, fullscreen: true, escape: 'fullscreen' }, runtime: true, agent: true, regexes: 0 },
    references: { characters: 0, lorebooks: 1, presets: 1, assets: 0 },
    privacy: { excludes: ['settings', 'user', 'worldSaves'], redactedPaths: [] },
    executableContent: { html: false, scripts: false, regexTriggers: 0, executedDuringExport: false },
    warnings: ['这是一张用于验证 RPG 闭环的西幻示例卡；动态数据只属于当前存档。']
  },
  content,
  assets
};

fs.writeFileSync('docs/demo-western-fantasy-ashen-frontier.tavern-world.json', JSON.stringify(pkg, null, 2) + '\n');
console.log(`built ${world.id} · ${contentHash}`);
