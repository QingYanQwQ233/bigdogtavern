# Tavern 数据结构清单

> 原则：**所有内容数据（提示词 / 示例 / 服务商 / 格式 / 文案）都在 JSON 文件，代码零写死**。
> 本地开发用，server 无鉴权，勿部署公网。

## 一、存储位置总览

```
public/data/
  _defaults.json   ← 唯一默认模板（首次启动初始化各文件；/api/data/seed 读取）
  characters.json  ← 用户角色库（数组）
  presets.json     ← 提示词预设（对象，key=预设名）
  lorebooks.json   ← 世界书集合（对象，key=世界书 id）
  worlds.json      ← 世界卡运行时库（数组；来源为 _defaults.json.worlds）
  settings.json    ← 全局连接设置（平铺对象）

  saves/<saveId>.json ← 世界存档（WorldSave；服务端按存档独立读写）

localStorage（前缀 rpg-airp:）→ server JSON 的离线缓存，server 为权威源
  settings / prefs / profiles / chars / current-char / sessions / lore / prompt-presets / theme
  current-world / current-world-save（只保存最近打开的 ID，不保存正式世界状态）
```

`theme` 仅为兼容旧缓存保留，界面固定使用 `vibrancy`（macOS 深色主题）。

## 二、_defaults.json（唯一数据源）的 9 个段

| 段 | 结构 | 用途 |
|---|---|---|
| `providers` | `[{id,label,baseUrl,model}]` | 设置面板「服务预设」下拉（动态渲染） |
| `format` | `{key:{label,text}}` | 格式指令（对白协议/长叙事/JSON…），附加到 system |
| `prefs` | `{formatPreset,formatCustom,stop,wiScanDepth,wiWholeWord,currentPresetByMode,cotEnabled,cotEffort}` | 界面偏好默认值；酒馆/RPG 分别记忆当前预设 |
| `ui` | `{emptyTitle,emptyGuideWithChar,emptyGuide}` | 空状态文案（`{name}`/`{role}` 插值） |
| `settings` | 连接参数 + `systemPrompt/postHistory/firstMes` | settings.json 初始内容 |
| `gen` | `{charFields,charBasicPrompt,charFullPrompt,lorePrompt}` | AI 三步生成角色卡与世界书条目；基本信息栏目由 JSON 动态渲染 |
| `characters` | 数组，示例角色 | characters.json 初始内容 |
| `lorebooks` | `{id:{name,entries[]}}` | lorebooks.json 初始内容 |
| `worlds` | `[{id,version,title,start,...}]` | worlds.json 初始内容；W1 世界卡目录 |
| `presets` | `{预设名:{version,mode,firstMes,prompts[],promptOrder[]}}` | presets.json 初始内容；旧结构启动时迁移 |

## 三、核心数据结构

### 数据所有权

当前正式路径分成两个闭环：

```text
酒馆：角色卡 → ChatSession → 酒馆 Prompt → 对话历史
世界：WorldCard → WorldSave → 世界 Prompt → 回合 / 状态 / 地图 / NPC
```

W1 已实现世界卡目录到存档的创建、列表和打开；W2 已把当前 RPG 叙事、状态、地图数据与美化图路径接入 WorldSave。世界卡由 `worldId + worldVersion` 定位，动态事实只由 `saveId + revision` 定位。浏览器 localStorage 只记住最近 ID，服务端 JSON 才是正式世界存档的权威来源。

运行时数据按两条 owner 链隔离：酒馆仍是 `角色卡 → ChatSession`，RPG 世界模式是 `WorldCard → WorldSave`。世界模式的开场白与 `turns` 组成叙事投影，状态、背包、任务、地图数据和美化图路径只从当前 `saveId` 读取；切换世界存档不会读取旧 RPG 会话，也不会把当前角色卡开场白混入世界时间线。旧 `kind: 'rpg'` 会话保留兼容路径，尚未自动迁移。

```js
{
  id, charId, kind: 'tavern' | 'rpg', name, createdAt,
  messages: [{ role, content, options?, ts }],
  rpgState: { hp, mp, inventory, quests, mapData, mapImage }
}
```

旧会话缺少 `kind` 时迁移为 `tavern`，缺少 `charId` 时绑定到迁移时的当前角色；已有归属不会被改写。

消息显示也按 `kind` 分流：酒馆模式保留引号对白/旁白拆分；RPG 模式把 AI 正文作为一条连续叙事渲染，不按引号生成气泡。末尾 ` ```rpg ```` 控制块只由 RPG 会话解析，不进入正文或酒馆消息。

AI 调试终端以 `session.id` 为键仅在内存保存各会话最近一次最终请求体和原始响应；不写入 `session`、localStorage 或 server JSON，刷新页面即清空。请求视图不包含单独传给代理的 `apiKey`。

### 世界卡 worlds[]（worlds.json）

```js
{
  id: 'world-aurora', version: 1, title: '极光大陆', summary: '…', tags: ['…'],
  playerCreation: {
    mode: 'custom', title: '创建你的冒险者',
    pointBudget: { label: '属性点', total: 8, min: 0 },
    fields: [{ id: 'name', label: '名字', type: 'text', required: true }],
    attributes: [{ id: 'might', label: '力量', min: 1, max: 5, default: 2, step: 1 }],
    skills: [{ id: 'scouting', label: '侦察', min: 0, max: 10, default: 1, step: 1, description: '发现环境细节' }],
    resources: [{ id: 'hp', label: '生命', type: 'number', min: 1, max: 999, initial: 20 }],
    traits: [{ id: 'keen-sense', label: '敏锐感知', description: '…' }],
    relations: [{ npcId: 'npc-lily', label: '起始关系', min: -100, max: 100, default: 0 }]
  },
  turnContract: { options: { min: 0, max: 4 }, actionIntent: true },
  conflicts: [{ id: 'wolf-skirmish', label: '荒野遭遇', type: 'combat', phases: [], actions: [], outcomes: [] }],
  time: { unit: 'hour', start: 8, turnAdvance: 1 },
  events: [{ id: 'aurora-omen', title: '极光异动', description: '…', trigger: { at: 10 }, visibility: 'public', once: true, consequences: ['…'] }],
  start: {
    locationId: 'wolf-tooth-inn', opening: '…',
    playerTemplateId: null, playerTemplate: { name: '未命名冒险者', ... },
    initialState: { stats: { level: 1, hp: 100, mp: 50, ... }, inventory: [], quests: [] }
  },
  lorebookIds: [], rpgPresetName: 'RPG 叙事引擎（示例）',
  locations: [], npcs: [], factions: [], items: [], quests: [],
  map: { strategy: 'perSave', generation: { seed, size, regionCount, landRatio, mapgenSize } },
  ui: { layout: 'world-desktop', source: 'json' }
}
```

世界卡是可复用的静态定义，不保存某个玩家的回合、背包或地图图片。初始内容来自 `_defaults.json.worlds` 初始化的 `worlds.json`；W5 草稿层保存在独立的 `world-drafts.json`，可编辑世界元数据、声明式 `locations` 与 `npcs`，并通过稳定 ID 互相引用；保存草稿不会改写 `worlds.json` 或已有存档。发布会基于当前最新版本追加不可变的 `version + 1`，然后消费该草稿；旧版本仍可按版本号读取，已有 `WorldSave.worldVersion` 不会自动迁移。服务端只接受白名单字段，不接受可执行 HTML/JS。W4.7 仍提供“从指定存档收录 NPC”这一条显式版本创建接口。

`map.generation` 是世界版本的地图生成配置：`seed`、`size`、`regionCount`、`landRatio` 与 `mapgenSize`。`landRatio` 在 fallback 引擎中是目标陆地占比，在 Mapgen2 中映射为大陆膨胀参数，因此 UI 预览会另外显示实际陆地占比。地图首次生成后，完整数据和生成参数一起写入所属 `WorldSave.state.map.data`；重生成只影响当前存档。

`playerCreation.economy` 是可选的声明式经济规则：`inventory.enabled/maxSlots/maxWeight/items[]` 控制背包、物品重量与堆叠；`equipment.enabled/slots[]` 控制装备位；`currencies[]` 控制货币 ID、范围和初始值。启用后，存档状态使用 `state.inventory`、`state.equipment` 与 `state.currencies`，每次创建、普通保存和正式回合都会按当前世界卡重新校验；未声明该段的旧世界继续使用兼容的自由背包 / `stats.gold`。

`playerCreation.growth` 是可选的成长声明：`sources[]` 记录训练、学习、探索、关系与事件等来源，`candidates[]` 只声明允许的目标 bucket、目标 ID 与 delta/value；bucket 可为属性、技能、资源、特质、NPC 关系、阵营声望或身份标签。运行态 `WorldSave.state.growthCandidates` 只保存当前存档的 `proposed` 候选及其 `reason`；玩家通过 `POST /api/world-saves/<saveId>/growth` 的 `accepted/rejected` 决策处理候选，服务端才会应用世界卡声明的变化。接受结果写入 `state.growthApplications` 与 `state.experiences`，人物经历带有 candidate/source、效果、地点和 revision，可回溯且不会跨存档共享。

默认种子还包含 `world-grey-harbor` 与 `world-orbit-station` 两张不同题材卡；服务端加载世界库时只在内存补入缺失的默认世界，不覆盖用户已有的 `worlds.json` 内容；后续创建草稿、发布或导入等写操作才会按现有流程落盘。

RPG 前端角色状态面板按 `playerCreation.attributes/skills/resources/derived/traits/relations` 和存档 `state.player` 动态投影；不会根据固定 ID 绘制新字段。装备面板按 `economy.equipment.slots` 与 `economy.inventory.items` 显示声明的装备位和物品名，冲突面板按 `conflicts[]` 模板与 `state.conflicts` 显示实例；缺少声明时保留空状态提示，旧存档继续使用兼容的固定状态栏。

`conflicts[]` 是世界卡声明的冲突模板：`type`、`phases[]`、`actions[]`、`outcomes[]` 与可选 `maxRounds` 只定义规则；运行态只属于当前存档的 `state.conflicts`，按实例 ID 保存 `templateId/status/phase/round/participants/objectives/availableActions/outcome`。行动可声明 `check: { roll, modifier: { bucket, id, factor?, bonus? }, target, damage?: { roll, modifier? } }`；参与者可带 `hp/maxHp/defense`，实例用 `targetId` 指向目标。AI 只能通过 `start`、`advance`、`end` 候选推进，服务端在同一 CAS 回合边界校验模板引用、轮次、阶段和结束结果；combat 按当前存档玩家数值执行 `d20 + 修正 >= target/防御`，命中后才掷伤害骰并写回目标 HP；social / stealth 只执行 `d20 + 技能修正 >= target`，结果写入 receipt 的 `conflictChecks`，不读取或扣除 HP。AI 不能提交伪造的骰子、判定或战斗数值；已结束冲突不可重开，receipt 会记录冲突生命周期变化。

其中 `locations[].id` 是世界内稳定的地点主键；`start.locationId`、`WorldSave.state.locationId` 和 `npcStates[*].locationId` 只能引用当前世界已登记的 ID，地点名称只用于展示与叙事。RPG Prompt 只注入当前地点 NPC、队伍成员和当前任务引用的 NPC；未命中的世界 NPC 不进入上下文。世界模式的世界书只读取当前 `WorldCard.lorebookIds`，不会使用全局酒馆世界书选择；旧世界卡未声明时仅兼容读取 `default`。

WorldNPC 的静态资料按公开边界读取：`role`、`description`、`persona`、`personality`、`appearance`、`speechStyle`、`publicFacts`、`publicGoals`、`desires`、`fears`、`goals`、`activity` 可进入当前作用域 Prompt；`secrets` 采用 `[{ id, content }]`，只有当前存档 `npcStates[npcId].knowledge` 包含对应 `id` 时才注入。其他静态字段不会自动展开，跨存档的 `knowledge` / `relation` 永不共享。

`events[]` 是不可执行的声明式事件模板：`trigger.at`、`trigger.afterTurns` 和 `trigger.locationId` 可组合为 AND 条件，默认只触发一次；`visibility` 控制后续上下文可见范围。每次成功回合由服务端在同一存档锁内推进时间并结算到期事件，结果写入 `state.worldEvents` 与回合 receipt；重复 commandId 不会重复触发，未提交回合不会推进时间。

正式回合 receipt 采用 `{ kind: 'turn', commandId, revision, turnIds, eventIds, committedAt }`，开场等其他 receipt 不计入成功回合数。

`state.goals` 与 `state.leads` 是存档级目标 / 线索投影，使用稳定 `id`、`title`、`desc`、`status`，可选引用当前世界的 `actorId` / `locationId` 与 `deadline`；它们与旧 `quests` 并存，AI 只能通过本回合结构化控制块增量 upsert，服务端会校验 ID、状态和地点引用。

兼容旧 WorldSave 时，前端仅在 `state.goals` 缺失且存在 `state.quests` 时生成 `legacy-*` 目标投影；原 `quests` 不删除，下一次正式提交才会把投影随当前存档一起保存。

RPG 控制块的 `player.attributes` / `player.skills` / `player.resources` 使用相对数值变化（例如 `{ "player": { "skills": { "scouting": 1 }, "resources": { "focus": -2 } } }`）；客户端按卡片范围预览，服务端按当前 `playerCreation` 再校验。玩家创建字段、特质和关系在正式回合中保持不可变，避免 AI 通过叙事篡改身份。

`generatedEntities` 按 `npcs` / `items` / `quests` / `locations` 分桶保存 AI 提出的临时实体。回合请求只能提交候选 `createEntities`（最多 32 个），服务端按当前 `saveId` 生成 `save:<saveId>:<kind>:<n>` ID 后写入当前存档；重复命令不会重复创建，其他世界存档不可见。

如需把存档 NPC 收录为长期世界 NPC，客户端必须显式调用 `POST /api/worlds/<worldId>/versions`，提交 `sourceSaveId`、`expectedRevision` 和该存档生成的 `npcId`。服务端会复制来源世界卡为下一 `version`，分配新的稳定 NPC ID 并写入来源映射；来源世界版本与来源存档均不改写。同一来源 NPC 重复调用会返回已创建版本（幂等）。

### 世界存档 WorldSave（saves/<saveId>.json）

```js
{
  id, worldId, worldVersion, name, createdAt, updatedAt,
  schemaVersion: 1, revision: 0,
  player: { characterId, snapshot: { fields, attributes, skills, resources, traits, relations, name, race, role, profileFields } },
  party: { memberIds: [], leaderId: null },
  npcStates: { [npcId]: { locationId, relation, knowledge: [], status: [] } },
  state: {
    stats, player: { fields, attributes, skills, resources, traits, relations, identity: {}, effects: [] }, time: { unit, value }, worldEvents: [], goals: [], leads: [], inventory: [], equipment: {}, currencies: {}, conflicts: {}, growthCandidates: [], growthApplications: [], experiences: [], quests: [], locationId,
    map: { strategy: 'perSave', data: null, imagePath: null, markers: [] }
  },
  opening: '世界卡 start.opening 的开局叙事',
  openingMode: 'static' | 'ai', openingOptions: [], openingCommandId: null,
  turns: [{ id, role: 'user' | 'assistant' | 'system', content, ts, options?, actionIntent?: { raw, verb?, target?, method?, risk? } }],
  receipts: [], generatedEntities: {},
  migrationHistory: [{ kind: 'world-version-upgrade', commandId, fromVersion, toVersion, changes, addedNpcStateIds, revision, migratedAt }]
}
```

创建时由服务端从当前 `WorldCard.start` 复制玩家快照、初始状态和 NPC 初始状态；角色库或世界卡后续编辑不会静默改写已有存档。`playerCreation` 只声明字段与范围，客户端提交的 `player.fields / attributes / skills / resources / traits / relations` 会在 `POST /api/world-saves` 处重新校验；未知 ID、缺失必填项、越界数值或超预算都会被拒绝。每个存档保存一份规范化 `player.snapshot`，并把可变化部分复制到 `state.player`，因此不同存档的建角数据、关系和资源互不共享。世界卡的 `npcIds` / `npcs` 只负责静态登记，关系、位置、认知和状态只写当前 `WorldSave.npcStates`。客户端不能提交文件路径或自行指定 `saveId`。`turnContract.options.min/max` 定义本卡建议行动数量（0–4），自由文本不受限制；服务端按当前 `worldVersion` 二次校验，未达到规则的候选回合不会写入。普通存档维护可通过 `PUT /api/world-saves/<saveId>` 提交完整的 `state + turns + opening`，带 `expectedRevision` 做顺序校验；正式 RPG 新行动使用 `POST /api/world-saves/<saveId>`，携带稳定 `commandId`、`expectedRevision`、候选 `state`、本回合 `turns`、卡片允许数量的 `options`，以及可选的 `npcStates`，服务端在同一临界区校验版本、追加带 revision 的回合并写入幂等 `receipts`。`state.conflicts` 与其他存档状态一样必须随当前 revision 完整提交；冲突状态只允许从当前值推进一轮，已结束冲突不能重开，receipt 的 `conflictTransitions` 记录生命周期变化。存档升级必须先对目标世界版本预演；地点、NPC 或任务稳定 ID 缺失时拒绝写入，成功时只更新 `worldVersion`、为新增世界 NPC 初始化本存档状态，并追加幂等 `migrationHistory`。地图网格写入 JSON 前转为数字数组，读取后恢复为 `Uint16Array`，图片只保存受校验的本地 `/images/...` 路径。

### 世界包 `*.tavern-world.json`

```js
{
  spec: 'tavern_world_package', specVersion: 1, exportedAt,
  manifest: {
    packageId, worldVersion, worldSchemaVersion, title, author, license, source,
    contentHash: 'sha256:...', hashScope: 'canonical-json(content,assets)',
    references: { characters, lorebooks, presets, assets },
    privacy: { excludes: ['settings', 'user', 'worldSaves'], redactedPaths: [] },
    executableContent: { html: false, scripts: false, regexTriggers, executedDuringExport: false },
    warnings: []
  },
  content: { world, characters: [], lorebooks: {}, presets: {} },
  assets: [{ id, role, ownerId, uri, status, mime?, bytes?, sha256? }]
}
```

世界包只导出所选不可变世界版本及其明确引用：内嵌 `npcs` 不重复复制为全局角色；未声明世界书时按当前运行时兼容规则包含 `default`。资源清单记录本地 `/images/...` 的大小与 SHA-256；不含查询参数或认证信息的外部 HTTP(S) 资源仅记录 URI、不联网抓取，当前 JSON 包不嵌入二进制文件。`settings`、`user`、玩家存档、来源存档 ID、凭据字段和本机绝对资源路径不会进入内容；剔除位置写入 `redactedPaths`，NPC 的叙事 `secrets` 仍作为世界内容保留。世界书正则触发器作为数据保留并计数，但导出过程不执行；W5.7 导入器仍需在激活前校验。

导入时客户端先提交原文，服务端把精确原文封存到 `data/world-imports/<importId>.json`，并回传不含原文的预演报告。报告校验 `spec/specVersion`、`contentHash`、已知角色/世界书/预设引用、私密字段及资源 URI；未知顶层 sidecar 与脚本命名字段只记录为“保留但未执行”。世界书正则只做长度、flags 和编译校验，落库时默认 `enabled: false`，需在世界书页审阅保存后才会参与匹配。当前包不携带任务、物品或阵营模板定义，因此声明了非空 `questTemplateIds` / `itemIds` / `factionIds` 的包会被拒绝，避免错误借用本地数据。确认导入后，世界、角色、世界书和预设都会按 `importId` 生成新的稳定 ID（预设名称也命名空间化），并重写已知绑定：`characterIds`、`npcIds`、`start.playerTemplateId`、`lorebookIds`、`rpgPresetName`、角色的 `loreId/presetName`。因此不会覆盖或借用本地同名数据；导入世界没有 `lorebookIds` 时也会绑定其专属的 `default` 副本。封存哈希或预演不通过时不写入世界库；同一 `importId` 的确认请求幂等。

### 角色卡 characters[]（characters.json）
```js
{
  id: 'uid', name: '莉莉（示例）', race: '猫族', role: '旅店老板娘',
  persona: '外貌与性格描述', scenario: '当前场景', firstMes: '开场白',
  systemPrompt: '',            // 角色专属 system（可空，由预设/全局兜底）
  postHistory: '',
  presetName: '',              // 绑定的酒馆提示词预设名；RPG 使用独立的模式预设
  loreId: '',                  // 绑定的世界书 id（可空 → 只用全局世界书）
  profileFields: [             // AI 基本信息表；默认栏目来自 gen.charFields，也可按角色增加自定义条目
    { key: 'age', label: '年龄', value: '24' },
  ],
  tags: '', createdAt: 0,
}
```

`profileFields` 随角色保存，并写入 Character Card V2 的 `extensions.tavern.profileFields`；导入时恢复。构建对话提示词时，非核心字段会追加到唯一的 `【角色卡】` system 段，因此自定义条目不仅用于展示，也会实际参与 AI 对话。

### 提示词预设 presets{}（presets.json）
```js
{
  'RP 基础（示例）': {
    version: 2,
    mode: 'tavern',            // tavern | rpg | both
    firstMes: '…',
    prompts: [                 // 素材库；未进入顺序的素材仍会保留
      {
        identifier: 'main', name: '主提示词', role: 'system', content: '…',
        marker: true, position: 'relative', depth: 4, order: 100,
      },
      {
        identifier: 'custom-id', name: '文风', role: 'user', content: '…',
        marker: false, position: 'in_chat', depth: 2, order: 100,
      },
    ],
    promptOrder: [             // 当前 Profile 的顺序与开关
      { identifier: 'main', enabled: true },
      { identifier: 'chatHistory', enabled: true },
    ],
  },
}
```

固定槽位包括主提示词、世界书前/后、玩家设定、角色描述、角色性格、场景、记忆、格式指令、RPG 状态与协议、对话示例、聊天历史和历史后指令。槽位可关闭和排序，但不可删除；其内容在每次请求时从当前角色与当前会话动态生成，避免把角色、地图或状态复制进预设造成串数据。

内置酒馆基础预设启用玩家主权、角色稳定、连续性、白描与抗重复模块；内置 RPG 基础预设启用玩家主权、世界连续性、判定、Markdown 叙事和福瑞种族表现模块。RPG 状态协议要求每回合输出恰好 4 个行动选项。

提示词页可导入/导出 SillyTavern Chat Completion 的 `prompts + prompt_order`。导入优先选择 `character_id: 100001`；未进入该顺序的 prompts 保留在素材库。常见采样参数会保存在 `modelParameters` 供无损导出，但连接设置仍是运行时权威，不会因导入而静默改动 API 参数。支持安全宏 `{{user}}`、`{{char}}`、`{{persona}}`、`{{description}}`、`{{personality}}`、`{{scenario}}`、`{{setvar::名称::值}}`、`{{getvar::名称}}` 和 `{{trim}}`；未知宏原样保留。EJS、MVU、扩展脚本和正则不会执行。

### 世界书 lorebooks{}（lorebooks.json）
```js
{
  default: {
    name: '默认世界书',
    entries: [
      { title, keys: '触发词,逗号分隔', content, enabled, constant, order },
    ],
  },
}
```
- `constant: true` 常驻注入；`keys` 支持 `/正则/`；`order` 决定命中顺序
- 条目**无 `id` 字段**：匹配去重以 `id || title` 为键（app.js buildWorldInfo）
- 默认世界书已内置：大陆概览 + 种族总览（常驻）、人类 + 10 兽人种族外貌特征、旅店/龙谷等地点条目

### 全局设置 settings（settings.json）
```js
{
  preset: '',               // 服务商 id（providers 的 key），⚠️ 与提示词预设无关
  baseUrl: '', apiKey: '', model: '',
  temperature: 0.9, maxTokens: 1024, topP: 1,
  frequencyPenalty: 0, presencePenalty: 0, seed: -1,
  history: 20, stream: true,
  systemPrompt: '',         // 最后兜底（提示词栏不再直接编辑它；全局默认在 __global__）
  postHistory: '', firstMes: '',
}
```

## 四、提示词构建管线 buildPromptBlocks

1. 选择当前模式的预设；酒馆允许角色卡 `presetName` 覆盖，RPG 不读取酒馆绑定。
2. 按 `promptOrder` 遍历启用条目，固定槽位从当前角色/会话求值，自定义条目展开安全宏。
3. 所有 System 和固定槽位合并为唯一一条 `system`；Relative User/Assistant 条目按聊天历史槽位分到历史前后。
4. In-Chat User/Assistant 按 `depth + order` 插入历史；In-Chat System 为保持唯一 system 而提升到唯一 system，并标注原深度。
5. `chatHistory` 关闭时不发送会话历史；RPG 示例回合只在 RPG 模式加入。
6. 开场白仍按 `char.firstMes → preset.firstMes → settings.firstMes` 读取。

旧版 `{systemPrompt,postHistory,firstMes,modules[]}` 在启动时原位迁移到 v2；迁移前可用 `presets.v1.backup-*.json` 回滚。迁移不修改 `_defaults.json` 中的提示词正文来源。

## 五、数据流向

```
首次启动：_defaults.json → ensureDataFiles → 各 :type.json
运行中：  前端状态 ← GET /api/data/:type（server 权威）
         前端保存 → localStorage 缓存 + PUT /api/data/:type（双写）
模板恢复：前端「📦 载入示例」→ GET /api/data/seed（返回 _defaults.json 深拷贝）
```

## 六、API 端点（server.js）

| 端点 | 说明 |
|---|---|
| `POST /api/chat` | AI 代理：拼 `baseUrl + /chat/completions`，注入 Bearer，SSE 透传；上游默认 120 秒超时，超时返回 504（可用 `TAVERN_PROXY_TIMEOUT_MS` 调整，仅用于本地测试/运维） |
| `POST /api/image` | 文生图代理：`kind='openai'` → `/images/generations`；`kind='sd'` → `/sdapi/v1/txt2img`，原样转发 |
| `GET /api/models` | 模型列表代理（读 X-Base-Url / X-Api-Key 头）；上游默认 120 秒超时，超时返回 504 |
| `POST /api/dice` | 由 Node 服务生成最多 16 个标准骰子表达式结果；世界回合把结果写入 `actionIntent.dice` |
| `GET /api/data/seed` | 返回 _defaults.json 全量（深拷贝） |
| `GET/PUT /api/data/:type` | 读写 characters / presets / lorebooks / settings |
| `GET /api/worlds` | 返回世界卡摘要与每个世界的存档数量 |
| `GET /api/worlds/<worldId>?version=<n>` | 读取指定世界卡版本；省略 `version` 时读取最新版本 |
| `GET /api/worlds/<worldId>/versions` | 按版本号升序列出世界卡版本摘要 |
| `GET /api/worlds/<worldId>/export?version=<n>` | 导出指定不可变版本的 `tavern_world_package` JSON；返回精确引用、资源清单、隐私剔除报告和内容哈希，不包含玩家存档或设置 |
| `POST /api/world-imports` | 提交 `{ raw }` 以封存并预演一个世界包；通过时 201，未通过时 422，二者均不写入世界库 |
| `GET /api/world-imports/<importId>` | 读取封存件元数据与兼容报告；不返回原文 |
| `POST /api/world-imports/<importId>` | 确认导入已封存且仍通过哈希/引用校验的世界包；按导入命名空间创建新世界与专属引用；重复确认幂等 |
| `GET /api/world-drafts?worldId=<worldId>` | 列出世界草稿摘要；不传 worldId 时列出全部草稿 |
| `GET /api/world-drafts/<worldId>` | 读取指定世界草稿 |
| `POST /api/world-drafts` | 从指定 `worldId` / `baseVersion` 创建草稿；同一世界重复调用幂等 |
| `PUT /api/world-drafts/<worldId>` | 使用 `expectedUpdatedAt` 乐观锁保存标题、简介、标签、`lorebookIds`、地图生成参数、声明式 `playerCreation`、`turnContract`、`time`、`events`、`locations` 与 `npcs`；事件条件、建角字段、回合选项范围、时间参数、地点/NPC ID 必须受服务端白名单校验 |
| `POST /api/world-drafts/<worldId>/publish` | 提交 `commandId`、`expectedUpdatedAt` 与 `baseVersion`，把草稿发布为不可变的下一版本。命令可幂等重试；草稿落后最新版本时返回 409 并保留草稿 |
| `POST /api/worlds/<worldId>/versions` | 显式把来源存档中的生成 NPC 收录进下一不可变世界版本；要求 `sourceSaveId`、`npcId`，可选 `expectedRevision` / `title` |
| `GET /api/world-saves?worldId=<worldId>` | 列出指定世界的存档摘要 |
| `POST /api/world-saves` | 按世界卡创建一个独立存档；可提交 `player: { fields, attributes, skills, resources, traits, relations }`，服务端按当前卡规则校验并分配 `saveId` |
| `POST /api/world-saves/<saveId>/opening` | 以 `commandId + expectedRevision` 幂等提交 AI 开场正文与 4 个选项；只更新当前存档的 `opening` / `openingOptions` |
| `GET /api/world-saves/<saveId>` | 读取一个完整 WorldSave |
| `PUT /api/world-saves/<saveId>` | 使用 `expectedRevision` 原子提交当前存档的 `state`、`turns` 与 `opening`；版本冲突返回 409 |
| `POST /api/world-saves/<saveId>` | 提交一次 RPG 回合候选；校验 `commandId`、assistant 回合、卡片允许数量的唯一选项、玩家 `actionIntent.raw`、状态数值/背包/任务/目标/线索边界和 revision，成功后在原子提交中推进时间、结算 `events`、把行动意图附着到本回合并记录 receipt；相同 commandId 幂等返回 |
| `POST /api/world-saves/<saveId>/growth` | 使用 `commandId + expectedRevision` 接受或拒绝一个当前存档的成长候选；接受时服务端应用能力 / 特质 / 关系 / 阵营声望 / 身份标签并追加人物经历，拒绝时只追加处理记录；相同 commandId 幂等返回 |
| `GET /api/world-saves/<saveId>/upgrade?targetVersion=<n>` | 只读预演存档升级；返回地点/NPC/任务增删与硬错误，不修改 revision |
| `POST /api/world-saves/<saveId>/upgrade` | 提交 `commandId`、`expectedRevision` 与 `targetVersion`；服务端在存档锁内重新预演，无硬错误时升级并写入迁移历史，相同命令幂等 |

运行时 JSON 不通过静态文件直接暴露：`/data/` 路径拒绝读取，世界卡和存档只能通过上述 API 访问。

## 七、文生图（测试功能）

- **总开关**：设置 → 文生图 → 「启用文生图（测试）」（默认关）
- **API 类型**：`openai`（OpenAI 兼容 `/images/generations`，模型 dall-e-3/gpt-image-1 等）/ `sd`（Stable Diffusion WebUI `/sdapi/v1/txt2img`）
- **参数**：Base URL / API Key / 模型 / 尺寸 / steps / CFG / 采样器 / 负面提示词 / 提示词来源（LLM 生成 | 直接剧情） / 回复后自动生图
- **触发**：① 回复完成后自动（需开 auto）；② 设置面板「生成测试图」按钮（手动测试提示词）
- **LLM 提示词生成**：走 `/api/chat` 代理（复用对话配置），指令为 `imageGen.promptInstruction`（JSON 可编辑）
- **图片消息**：酒馆模式存入 ChatSession；世界模式存入当前 WorldSave.turns。两者都渲染为 `<img>`，且**不进对话上下文**（buildPromptBlocks history 过滤 image 角色）
- 响应解析：`data[].b64_json ? 'data:image/png;base64,'+… : data[].url`；SD 取 `images[0]` base64

## 七、已知冗余（设计取舍）

- `settings.systemPrompt/postHistory/firstMes` 与 `__global__` 预设语义重叠：`__global__` 是提示词栏的编辑入口，settings 三字段仅作最后兜底（兼容旧数据）
- 数据双写 localStorage + JSON：server 文件权威，localStorage 为离线降级
- 命名易混淆：`settings.preset`（服务商）vs `prefs.currentPresetByMode`（酒馆/RPG 当前提示词预设）
### 派系定义与存档状态（R4.11）

世界卡的 `factions` 保存静态定义：`{ id, name, description?, goals?, resources?, initialState? }`。资源定义包含 `id/label/min/max/initial`，初始关系与影响力也可写在 `initialState`。创建 `WorldSave` 时，服务端把这些定义投影为当前存档独立的 `state.factionStates[factionId]`，其中保存目标、资源、关系和影响力；正式回合与存档 PUT 必须提交完整的已有派系状态，服务端按世界卡白名单校验，禁止未知派系、未知资源或越界数值。世界升级只为目标版本的派系补齐初始状态，不会引用其他存档。

派系可声明一次性 `actions`：`{ id, title, description, trigger: { at?, afterTurns?, locationId? }, changes: { relation?, influence?, resources? }, consequences?, visibility? }`。正式回合推进时间后，服务端只结算满足时间与地点条件的行动，把变化写入当前存档，并生成带 `factionId/actionId` 的 `state.worldEvents`；同一行动通过稳定 event ID 去重，receipt 记录 `factionActionIds`。Prompt 只注入当前地点相关或最近已发生的派系，避免无关派系污染回合上下文。

### Legacy RPG session migration (W6)

`POST /api/rpg-migrations` receives `{ raw }`, where `raw` is a browser legacy session envelope containing the target `worldId/worldVersion`. The server seals the exact source at `data/rpg-migrations/<migrationId>.json` and returns only a hash, source/target summary, state counts, and warnings. The raw session is never echoed by the GET endpoint. A second, explicit `POST /api/rpg-migrations/<migrationId>` creates `data/saves/migrated-<migrationId>.json`.

The mapping is `messages -> WorldSave.turns`, `opening -> opening`, and `rpgState -> state`. Locations must belong to the target world; otherwise the world start is used and a warning is reported. Only a credential-scrubbed character snapshot is copied. Unknown fields remain in the sealed source and are never executed. `migrationInfo` records the source session ID and exact source hash. Confirming twice returns the same deterministic save; the original browser session is not changed or deleted.

API additions: `POST /api/rpg-migrations` (preview/seal), `GET /api/rpg-migrations/<migrationId>` (summary only), and `POST /api/rpg-migrations/<migrationId>` (explicit commit, idempotent).

### playerCreation.derived（R5.4）

世界卡可声明只读派生值：`{ id, label, formula, visible?, description? }`。`formula` 只允许数字、`+ - * /`、括号，以及 `attributes.<id>`、`skills.<id>`、`resources.<id>`、`derived.<id>` 引用；服务端拒绝非法 ID、循环依赖、除任意 JavaScript 外的表达式。派生值不写入 `WorldSave.state.player`，由当前存档的属性、技能与资源实时计算并注入 RPG 面板和提示词，切换存档不会串值。

### 目标 / 线索截止时限（R4.10）

`deadline` 使用当前世界时钟的绝对值 `{ unit, value }`。每次正式回合先由服务端推进 `state.time`，再把同单位且已达到时限的 `active` 目标 / 线索原子标记为 `failed`，写入 `deadlineStatus: 'expired'`、`deadlineResolvedAt` 和回合 receipt 的 `deadlineIds`；重试不会重复结算，不同存档互不影响。
