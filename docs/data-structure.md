# Tavern 数据结构清单

> 原则：**当前可编辑内容（提示词 / 示例 / 服务商 / 文案）以 JSON 为权威源**；代码只保留协议边界、运行时 Marker 和一次性旧数据迁移。
> 本地开发用，server 无鉴权，勿部署公网。
>
> 本文同时保留旧存档/旧字段的兼容背景。新建 RPG 世界卡的可发布字段、Runtime 契约和当前 HTTP 端点以 [RPG 世界卡、运行时与 HTTP 接口参考](rpg-card-api.md) 为准；下文出现的 events、factions、conflicts、growth、地图等内容如未特别标为当前能力，均不应作为新卡写入方案。

## 一、存储位置总览

```
public/data/
  _defaults.json   ← 唯一默认模板（首次启动初始化各文件；/api/data/seed 读取）
  characters.json  ← 用户角色库（数组）
  presets.json     ← 提示词预设（对象，key=预设名）
  lorebooks.json   ← 世界书集合（对象，key=世界书 id）
  worlds.json      ← 世界卡运行时库（数组；来源为 _defaults.json.worlds）
  world-deleted.json ← 已删除世界卡 ID（防止默认模板重新补回）
  settings.json    ← 全局连接设置（平铺对象）
  sessions.json    ← 酒馆会话库 { schemaVersion, sessions[], deletedIds[] }（客户端首次保存时创建，不在启动时预建）

  saves/<saveId>.json ← 世界存档（WorldSave；服务端按存档独立读写）

localStorage（前缀 rpg-airp:）→ server JSON 的离线缓存，server 为权威源
  settings / prefs / profiles / chars / current-char / sessions / lore / prompt-presets / gen / theme
  current-world / current-world-save（只保存最近打开的 ID，不保存正式世界状态）
  sessions-deleted（已删会话 ID 墓碑，与服务端 deletedIds 合并，防止已删会话在跨浏览器同步时复活）
```

酒馆会话跨浏览器同步：启动时 `GET /api/data/sessions`（404/`_empty` 表示从未同步，此时把 localStorage 会话整体推送上去完成迁移）；已同步时按会话 ID 取并集，同 ID 冲突保留 `updatedAt` 新者，双方删除墓碑都生效，合并结果回写服务端，使另一浏览器下次加载收敛。

`theme` 仅为兼容旧缓存保留，界面固定使用 `vibrancy`（macOS 深色主题）。

`gen` 是可编辑的 AI 工坊配置；首次启动从 `_defaults.json.gen` 初始化并同步到 `gen.json`，设置页修改后只覆盖当前用户的 `charBasicPrompt`、`charFullPrompt`、`lorePrompt` 与 `charFields`，角色字段仍按 JSON Schema 动态读取。

## 二、_defaults.json（唯一数据源）的主要段

| 段 | 结构 | 用途 |
|---|---|---|
| `providers` | `[{id,label,baseUrl,model}]` | 设置面板「服务预设」下拉（动态渲染） |
| `tavern` | `{replyOptions:{enabled,min,max,count,label,noOptions,instruction}}` | 酒馆 RP 回复选项的项目默认；具体酒馆/通用预设可用同名字段覆盖，RPG 不读取 |
| `prefs` | `{stop,tavernAutoMemory,uiTheme,uiThemePreset,uiThemePresets,wiScanDepth,wiIncludeNames,wiCaseSensitive,wiWholeWord,wiRecursive,wiMaxRecursionSteps,wiMinActivations,wiMinActivationsDepthMax,wiBudget,wiUseGroupScoring,wiInsertionStrategy,currentPresetByMode,outputRegex,cotEnabled,cotEffort,worldContextBudget,typography}` | 界面偏好默认值；`tavernAutoMemory` 控制 RP 自动滚动记忆（开关、窗口轮数、每次总结轮数和摘要字数）；`uiTheme` 覆盖现有 CSS token（颜色、边框透明度、圆角、侧栏宽度、RPG 两侧栏宽度、缩放和受校验的高级 CSS 变量），改动即时写入 `:root` 并自动保存；`uiThemePreset` 保存当前界面预设 ID，`uiThemePresets` 是从 `_defaults.json` 读取的预设目录；世界书缺少独立 settings 时的兼容回退；酒馆/RPG 分别记忆当前预设与自定义输出正则；RPG 世界上下文字符预算；`typography` 是聊天正文排版（字体/字号/行距/段距/段首缩进/左右间距），改动即时写入 `--chat-*` CSS 变量并自动保存 |
| `ui` | `{emptyTitle,emptyGuideWithChar,emptyGuide}` | 空状态文案（`{name}`/`{role}` 插值） |
| `settings` | 连接参数 + `firstMes`；旧缓存可能含 `systemPrompt/postHistory` | settings.json 初始内容；旧全局提示词启动时迁入 `__global__` 的 `main/jailbreak` 后清空 |
| `gen` | `{charFields,charBasicPrompt,charFullPrompt,lorePrompt}` | AI 三步生成角色卡与世界书条目；基本信息栏目由 JSON 动态渲染 |
| `characters` | 数组，示例角色 | characters.json 初始内容 |
| `lorebooks` | `{id:{name,entries[]}}` | lorebooks.json 初始内容 |
| `worlds` | `[{id,version,title,start,...}]` | worlds.json 初始内容；W1 世界卡目录 |
| `presets` | `{预设名:{version,mode,firstMes,replyOptions?,prompts[],promptOrder[],modelParameters?}}` | presets.json 初始内容；当前 Schema 为 v3，提示词内容和开关只由 `prompts + promptOrder` 表达，旧结构启动时迁移 |

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
  messages: [{ id?, role, content, options?, meta?, ts }],
  autoMemory: { version, summaries: [{ id, text, sourceMessageIds[], createdAt }] }, // 仅 kind=tavern
  rpgState: { hp, mp, inventory, quests, mapData, mapImage }
}
```

酒馆自动记忆只在 `prefs.tavernAutoMemory.enabled` 开启时自动参与请求：按完整的用户消息 + AI 回复计为一轮，达到 `windowTurns` 后把最早 `summarizeTurns` 轮压缩为 `summaryChars` 字左右的摘要；「立即总结」按钮可在不开启自动触发的情况下手动总结当前未总结轮次。原始 `messages` 不删除，Prompt 发送当前会话摘要、尚未总结的完整回合，以及尚未收到 AI 回复的当前玩家回合。开场白和 system 消息不计入轮次；骰点等 `meta` 消息不会单独创建一轮，但会附着在对应玩家回合中一起保留和总结。若摘要请求失败，原始历史保留并在后续 AI 回复完成后重试；编辑或删除已被摘要覆盖的消息会清空该会话的派生摘要，避免旧摘要覆盖新剧情。

RP 请求组装时先分离最后一个未配对玩家回合，再对旧上下文应用 `chatHistory` 开关和 `settings.history` 限制。连续待回复的普通用户消息会按原顺序合并，随后附加本轮 `meta` 记录，并在 Chat History 边界只注入一次；排在历史之后或 Depth 0 的提示词仍可按预设跟随。`{{lastMessage}}`、`{{lastUserMessage}}` 与 `{{messageCount}}` 忽略 `meta`，因此骰点不会覆盖真实玩家输入；RPG 仍使用独立的 WorldSave 回合链。

旧会话缺少 `kind` 时迁移为 `tavern`，缺少 `charId` 时绑定到迁移时的当前角色；已有归属不会被改写。

消息显示也按 `kind` 分流：酒馆模式保留引号对白/旁白拆分；RPG 模式把 AI 正文作为一条连续叙事渲染，不按引号生成气泡。末尾 `<tavern_state_update>` 控制块只由 RPG 回合解析，不进入正文或酒馆消息；旧 ` ```rpg ```` 仅作兼容输入。

AI 调试终端以 `session.id` 为键仅在内存保存各会话最近一次最终请求体和原始响应；不写入 `session`、localStorage 或 server JSON，刷新页面即清空。请求视图不包含单独传给代理的 `apiKey`。

### 世界卡 worlds[]（worlds.json）

```js
{
  id: 'world-aurora', version: 1, title: '极光大陆', summary: '…', tags: ['…'],
  playerCreation: {
    mode: 'custom', title: '创建你的冒险者',
    pointBudget: { label: '属性点', total: 12, min: 0, mode: 'pool', cost: 'above-min' },
    defaultPresetId: 'wanderer',
    buildPresets: [{ id: 'wanderer', label: '自由旅人', values: { fields: { role: '旅人' }, attributes: { might: 2 } } }],
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
  agent: { protocol: 'tavern.rpg.agent', mode: 'native', maxSteps: 2, tools: {} },
  regexes: [{ id: 'hide-state', name: '隐藏状态块', findRegex: '/<tavern_state_update>[\\s\\S]*?<\\/tavern_state_update>/gi', replaceString: '', enabled: true }],
  ui: {
    layout: 'world-desk',
    entryGate: { enabled: true, title: '警告', message: '进入前提示', confirmText: '确认', cancelText: '退出', fullscreen: false },
    sidebar: { panels: [{ id: 'relations', title: '人物关系', side: 'right', source: 'save.npcStates', layout: 'cards', fields: [{ key: 'locationId', label: '位置' }] }] },
    extension: { enabled: true, immersive: true, surfaces: ['play'], title: '世界 HUD', html: '<section>…</section><div data-tavern-messages></div>', css: '', js: '', permissions: ['read.public', 'read.save'] }
  },
  locations: [], npcs: [],
}
```

世界卡是可复用的静态定义，不保存某个玩家的回合或存档状态。初始内容来自 `_defaults.json.worlds` 初始化的 `worlds.json`；草稿层保存在独立的 `world-drafts.json`，可编辑世界元数据、声明式 `locations` 与 `npcs`；保存草稿不会改写 `worlds.json` 或已有存档。发布会基于当前最新版本追加不可变的 `version + 1`，然后消费该草稿；旧版本仍可按版本号读取，已有 `WorldSave.worldVersion` 不会自动迁移。

当前 RPG 世界卡的正式运行契约是声明式的：`playerCreation`（字段、属性、技能、资源、特质与关系）、`locations` / `npcs`、世界时间、开局文本、回合选项、必要判定以及当前存档的叙事历史，加上世界卡自行声明的 `runtime.variables`、`runtime.collections`、`runtime.actions`。旧版 `economy`、`growth`、`events`、`factions`、`conflicts` 和硬编码物品/任务投影仍可兼容读取，但不会作为统一系统继续生成；需要这些玩法时应放进 runtime schema，由 AI 通过 Typed Patch 更新。

`ui.entryGate` 是可选的存档入口门禁，只有在用户点击“创建存档”时才显示；它不提前创建 `WorldSave`。`cancelText` 退回世界库，`fullscreen: true` 在确认手势内请求浏览器全屏，失败会降级为普通布局。`ui.sidebar.panels[]` 只声明侧边栏面板的标题、位置、布局、字段和白名单数据源（例如 `save.npcStates`、`save.state.goals`、`save.state.player.resources`）；面板是当前 `WorldSave` 的投影，不把动态数据写回世界卡，也不执行模板、HTML 或脚本。集合卡片的默认 `status` 字段会把 `confirmed` / `unconfirmed` 显示为“已确认”/“未确认”，并在面板标题汇总确认数量；这只是当前存档状态的可见投影。`source: "runtime.actions.<id>"` 配合 `layout: "actions"` 会按动作 Schema 生成输入表单；若动作声明的 `collection.patch` 已把目标状态置为 `confirmed`，宿主会把该确认动作标为已完成并禁止重复提交。其他动作提交仍复用世界回合管线，动作 ID 进入 `actionIntent`，最终由 AI 叙事与 Typed Patch 决定是否产生效果。

`ui.worldUiTemplate` 位于 `_defaults.json.ui`，是世界草稿编辑器的“载入完整模板”数据源，不属于任何具体世界或存档；模板包含 `schemaVersion`、主题 Token、八个区域策略、声明式侧栏和入口门禁示例，载入后会复制到草稿 JSON，用户可按世界需求调整。

`ui.extension` 的 HTML/CSS/JS 在隔离 iframe 中运行，只能读取当前世界 / 存档并提交玩家行动；扩展不能访问主页面、网络或其他存档。`surfaces` 可选为 `['play']`、`['setup']` 或 `['setup','play']`：声明 `setup` 后，创建存档会生成一个 `planning` 存档并把卡前端作为开局配置页加载；卡内通过 `TavernExtension.setup.get/patch/commit/cancel` 保存角色与规则草稿。游玩阶段可用 `TavernExtension.getContext()` 或 `TavernExtension.runtime.get()` 读取当前 runtime 快照，但不提供 runtime/MVU/action 直写桥；变量、集合与动作效果必须由 AI 回合提交声明式 patch，扩展不能创建第二套状态系统。

正式游玩阶段的桥接 API `TavernExtension.choose(text)` 会复用主 RPG 回合管线；`context.turn.options` 与底部快捷回复使用同一份 AI 结构化选项，`context.turn.narrativeHtml` / `hasResponse` 用于把已清洗的 Markdown 正文重新绘制到自定义界面，`context.messages[].html` 提供当前存档最近 40 条用户 / AI 消息的安全 HTML。卡内 HTML 可放置 `data-tavern-messages`、`data-tavern-options`、`data-tavern-input` / `data-tavern-submit` 接入自定义界面；桥接会在卡自己的 DOM 内更新内容，选项和表单仍复用 Agent 回合。`TavernExtension.fullscreen()` 与 `exitFullscreen()` 是可重复调用的进入/退出切换；`openTerminal()` 打开当前回合的 AI 往返终端；`endWorld({ endingId?, confirm: true })` 走宿主结束接口，服务端按 `world.ending`、确认标记和 revision 校验后写入 `state.ending`。

`regexes[]` 是世界卡绑定的输出替换规则，按角色卡/世界卡、当前预设、当前模式自定义的顺序执行；客户端兼容 SillyTavern 的 `placement`（0 旧版显示、1 用户输入、2 AI 回复、3 斜杠命令、5 世界书、6 思维链）、`trimStrings`、`substituteRegex`（0 不替换、1 原值、2 正则转义）、`minDepth/maxDepth`、`markdownOnly`、`promptOnly` 与 `runOnEdit`，并提供聊天显示、历史/提示词和 System/后预设等细分阶段。自定义规则默认写入当前提示词预设作用域，切换预设时自动隔离；取消专属后才作为当前模式全局规则。提示词/显示阶段只改请求副本或渲染结果，不覆盖会话原文。服务端只接受有限正则字段并校验表达式，不执行脚本、EJS 或 MVU。消息另存 `rawContent` 作为正则前快照，角色卡兼容桥优先读取它，避免状态标签被显示正则覆盖后无法回读。

`setting` 保存世界观稳定段；`rules.hard` / `rules.soft` 保存作者的硬 / 软叙事约束，`rules.checks[]` 声明 Agent 可引用的固定判定 ID 与可选目标 / 骰式。需要根据当前行动临时决定属性时，Agent 可直接调用动态 `rules.check`，提交 `actionId`、`sides`、`target` 与最多 8 条 `modifiers`，统一公式为 `1dN + Σ(modifier)`；修正来源只能是当前玩家的 `attributes/skills/resources`、已声明 runtime 集合的数字字段或常数。`rules.check` 通过后，`dice.roll.expr` 只写基础骰式（如 `1d20`，不得写 `1d20+1`），并原样传回 `modifierRules`。客户端只负责生成随机骰面，服务端从当前存档快照重新解析修正并复核最终总值，不能由 AI 直接伪造修正。固定规则仍兼容旧的单个 `modifier` / `modifierRule`。不同世界使用不同字段时完全以本次判定声明为准；判定提案只属于当前回合，不写入 `WorldSave`。

地图生成和地图状态不属于当前最小 RPG 世界卡契约；旧卡字段只读兼容，不会进入新存档。

`playerCreation.economy`、`playerCreation.growth` 以及 `events` / `factions` / `conflicts` 是旧版本兼容字段；新的物品、任务、关系和其他世界专属数据应声明在 `runtime.variables`、`runtime.collections`、`runtime.actions`，由 AI 回合通过 Typed Patch 更新。

`sessionSetup.fields[]` 是本局游戏规则 Schema；字段类型只允许 `text/textarea/select/number/boolean`，可声明默认值、必填、选项、范围和自定义值。世界草稿编辑器以高级 JSON 保存它，创建存档时物化为 `WorldSave.setup.game`，因此难度、Sandbox、战斗开关、世界推进与新实体许可等规则不会写死在前端。

`playerCreation.buildPresets[]` 只声明建角起点，`values` 可按同一 Schema 提供 fields、attributes、skills、resources、traits、choices 和 relations 的默认值；用户和 AI 的后续修改会覆盖预设。创建接口会校验 `playerPresetId` 并将其写入当前 `WorldSave.setup`，但最终实际值仍独立保存到 `player.snapshot` 与 `state.player`。`pointBudget.mode` 支持 `pool` / `free`，`cost: 'above-min'` 表示只计算超过各属性最低值的部分。

旧的成长、物品、任务、地图、派系宿主投影不会在新草稿和回合中生成；runtime 是新世界卡的通用扩展边界，支持变量、集合、动作以及 `collection.patch` 的 set/delta 局部修改。动作可声明 `inputs`、`availability`（持有物品、数量、变量比较等前置条件）和可选 `check: { sides, target, modifiers }`。带 `check` 的物品/技能动作必须先由 Agent 调用同一 `actionId` 的 `rules.check` 与客户端骰子，再由服务端按当前存档快照复核骰面、属性/技能修正和目标值；判定失败或缺少判定时，动作效果不会执行。无 `check` 的日常动作可直接执行。所有动作仍在原子提交前复核动作存在、输入类型和前置条件；不满足时整次动作拒绝，不留下半截状态。动作 effect 可用 `{{input.field}}` 绑定本回合输入，服务端解析后仍会按 entry schema 校验，适合登记物品、关系、线索等动态条目。

世界草稿编辑器对 `playerCreation.fields/attributes/skills/resources/traits` 提供分组条目操作；条目顺序就是数组顺序，新增、删除和排序只改变当前世界草稿，不会改写已发布世界版本或已有存档。每条可保留 schema 允许之外的扩展键，保存时仍由服务端 `validatePlayerCreationSchema` 负责最终校验；高级 JSON 可显式载入编辑器，若直接修改后保存也会按原始文本校验，解析失败不会覆盖最近一次有效草稿。

当前世界草稿工作台把 `locations[]`、`npcs[]`、建角、Runtime、失败和结局作为正式作者入口。旧 `events[]`、`factions[]`、`conflicts[]`、成长/经济和地图编辑描述仅属于兼容历史；新草稿保存会清理这些投影。删除地点或 NPC 时，服务端仍会校验稳定 ID、重复项和 `locationId` 引用；发布后定义属于对应不可变世界版本。

默认种子还包含 `world-grey-harbor` 与 `world-orbit-station` 两张不同题材卡；服务端加载世界库时只在内存补入缺失的默认世界，不覆盖用户已有的 `worlds.json` 内容；后续创建草稿、发布或导入等写操作才会按现有流程落盘。

RPG 前端角色状态面板按 `playerCreation.attributes/skills/resources/derived/traits/relations` 和存档 `state.player` 动态投影；不会根据固定 ID 绘制新字段。世界模式的自定义侧栏还可按 `runtime.variables.<id>` / `runtime.collections.<id>` 读取声明式状态；宿主不再提供物品、任务、装备或冲突的写入控件，旧存档仅保留兼容读取。

`conflicts[]` 是世界卡声明的冲突模板：`type`、`phases[]`、`actions[]`、`outcomes[]` 与可选 `maxRounds` 只定义规则；运行态只属于当前存档的 `state.conflicts`，按实例 ID 保存 `templateId/status/phase/round/participants/objectives/availableActions/outcome`。行动可声明 `check: { roll, modifier: { bucket, id, factor?, bonus? }, target, damage?: { roll, modifier? } }`；参与者可带 `hp/maxHp/defense`，实例用 `targetId` 指向目标。AI 只能通过 `start`、`advance`、`end` 候选推进，服务端在同一 CAS 回合边界校验模板引用、轮次、阶段和结束结果；combat 按当前存档玩家数值执行 `d20 + 修正 >= target/防御`，命中后才掷伤害骰并写回目标 HP；social / stealth 只执行 `d20 + 技能修正 >= target`，结果写入 receipt 的 `conflictChecks`，不读取或扣除 HP。AI 不能提交伪造的骰子、判定或战斗数值；已结束冲突不可重开，receipt 会记录冲突生命周期变化。

其中 `locations[].id` 是世界内稳定的地点主键；`start.locationId`、`WorldSave.state.locationId` 和 `npcStates[*].locationId` 只能引用当前世界已登记的 ID，地点名称只用于展示与叙事。RPG Prompt 只注入当前地点 NPC、队伍成员和当前任务引用的 NPC；未命中的世界 NPC 不进入上下文。世界模式的世界书只读取当前 `WorldCard.lorebookIds`，不会使用全局酒馆世界书选择；世界卡草稿编辑器会从运行时世界书库渲染可多选列表，并保留已删除 ID 作为“缺失引用”供发布预检提示；旧世界卡未声明时仅兼容读取 `default`。

WorldNPC 的静态资料按公开边界读取：`role`、`description`、`persona`、`personality`、`appearance`、`speechStyle`、`publicFacts`、`publicGoals`、`desires`、`fears`、`goals`、`activity` 可进入当前作用域 Prompt；`actions[]` 是带 `trigger` 与可选 `changes` 的一次性主动行动模板，只在成功回合的时间推进点由服务端结算；`secrets` 采用 `[{ id, content }]`，只有当前存档 `npcStates[npcId].knowledge` 包含对应 `id` 时才注入。其他静态字段不会自动展开，跨存档的 `knowledge` / `relation` 永不共享。

`events[]` 是不可执行的声明式事件模板：`trigger.at`、`trigger.afterTurns` 和 `trigger.locationId` 可组合为 AND 条件，默认只触发一次；`visibility` 控制后续上下文可见范围。每次成功回合由服务端在同一存档锁内推进时间并结算到期事件，结果写入 `state.worldEvents` 与回合 receipt；重复 commandId 不会重复触发，未提交回合不会推进时间。

`eventLedger[]` 是服务端维护的长期提交索引（当前最多 4096 条），不接受客户端直接改写。每条记录带稳定 `id`、`kind`、`commandId`、`sourceRevision` 和时间 / 地点作用域，并引用已提交的回合、世界事件或成长应用；它与按上限裁剪的 `receipts[]` 分离，后续长期记忆应引用账本记录而不是复制一份状态摘要。Agent 两阶段执行期间只写入 `WorldSave.agentRuntime.pending`，不会提前推进 revision、turns 或 eventLedger；正式 narrate 提交后才生成 receipt 与账本记录。

RPG Prompt 的短期窗口由前端 `buildWorldRecentContext()` 在请求前从当前 `WorldSave.turns`、待提交消息和 `eventLedger` 重建：默认使用设置中的最近 N 条消息；若账本记录出当前位置切换，则优先保留当前位置之后的消息。该窗口只作为本次请求的 history 投影，不写入存档，也不替代 `turns`、`state` 或账本事实。

`eventMemory[]` 是服务端在正式回合提交后规范化的长期事件记忆（最多 512 条），只接受 AI 提交的本回合候选摘要；来源回合、来源事件、`sourceRevision`、地点和时间由服务端绑定，不能由客户端伪造或改写。每项带 `entityIds`、`locationId`、`time`、`visibility` 与来源 ID，Prompt 只注入当前存档可见且地点匹配的记忆；删除或清理派生记忆不会改变 `turns`、`state` 或 `eventLedger`。R6.6 增加 `GET /api/world-saves/<saveId>/memory` 诊断和 `POST /api/world-saves/<saveId>/memory/rebuild` 重建：重建只读取结构化世界事件、成长事实及账本来源引用，不读取原始叙事正文，不改变正式 `revision`；诊断中的隐藏记忆只保留脱敏占位。

RPG Agent Profile 来自 `_defaults.json.rpg.agent`，可由 RPG Preset 的 `agent` 和未来 WorldCard 的 `agent` 覆盖。它只声明协议、模式、最大步骤数和工具执行策略，不保存玩家状态。`tools.*.parameters` 是 OpenAI-compatible JSON Schema，可被世界卡 / 预设调整，但不能注入 handler、任意路径或脚本。含有 `runtime.actions` 的世界卡会自动开放一等候选工具 `runtime.action.execute`；服务端仍会校验动作 ID、输入 Schema、availability 与判定结果后才提交效果。原生请求对外使用符合 OpenAI 函数名约束的 wire name（如 `dice_roll`），收到后映射回内部能力 ID（如 `dice.roll`），服务端兼容层仍使用内部 ID。原生 `mode: native` 请求会在同一模型请求链中循环 `assistant.tool_calls → tool`，最多 `maxSteps` 次；兼容 `mode: tool-candidate` / 非 native 模式会从唯一状态块读取 `toolCalls`，客户端执行同一工具白名单，再以 `tavern.rpg.agent.tool_result` 消息回传并继续请求模型，最多 `maxSteps` 次。两种模式都把 `context.retrieve` 限制为当前 WorldSave 作用域内的只读工具，不进入提交候选；客户端骰子结果必须在工具循环内回传，不能在模型回复后补掷。`WorldSave.agentRuntime` 仅保存 `{ version, status, pending }` 的短暂执行协调信息：pending 绑定 `commandId + baseRevision`，包含已校验的预览 state、NPC 状态、生成实体和规则结果；正式事实仍以 `state`、`turns`、`receipts` 和 `eventLedger` 为准。前端 Typed Patch 回合会先调用 `agent-execute`，叙事提交失败可复用同一 pending，放弃回合则调用 `agent-cancel`。

R6.4 的事实层级不复制一份“当前世界”：`WorldCard@worldVersion` 保留稳定简介、地点、NPC 公共资料、NPC 行动模板、派系定义、事件模板和规则；`WorldSave@revision` 保留当前地点、时间、NPC 状态、目标、冲突、已提交事件和记忆。Prompt 同时标明两者的来源与作用，冲突时只让存档状态解释当前局面，不回写世界卡，也不让旧静态默认值覆盖已提交状态。

R6.5 的上下文组装是请求级派生结果：NPC 按当前地点、队伍、任务 / 目标 / 线索、冲突参与者和已召回记忆筛选；地图只注入当前位置及相邻区域；事件、派系和长期记忆按当前地点与最近记录裁剪。所有作用域段共享 `prefs.worldContextBudget` 字符预算（默认 24000，范围 6000–60000），按当前状态、目标、记忆、NPC、事件到地图 / 派系的优先级保留；超预算只裁剪请求文本，不删除或改写 `WorldSave` 正式事实。

正式回合 receipt 采用 `{ kind: 'turn', commandId, revision, turnIds, eventIds, agent, committedAt }`，开场等其他 receipt 不计入成功回合数。`agent.proposedTools` 只保存经过 Schema 校验的 AI 候选名称；`agent-execute` 阶段不写正式 receipt，`narrate` 阶段才把预览结果转为一次正式提交。正式 RPG 回合的骰子由客户端生成并写入 `actionIntent.dice`，服务端只校验表达式、面值和总和；原生与兼容 Agent 都必须先调用 `rules.check` 才能调用 `dice.roll`，并在同一 Agent 循环内把结果回传给模型后再生成叙事。`/api/dice` 保留为兼容/诊断接口，不再是世界回合的随机源。

`rules.check` 的结果是只读 `CheckProposal`：固定规则回传当前世界卡或活动冲突动作声明的 `id`、`label`、`description`、基础 `roll`、`target`、`modifier`、`modifierRule`；动态规则回传临时 `actionId`、`1dN`、`target` 与 `modifierRules`。客户端不会把判定定义当作存档事实，也不会让 AI 自行改写难度或修正。后续 `dice.roll` 必须提交基础骰式与匹配的 `modifier` / `modifiers` 参数，仍由客户端生成骰点；服务端在 `agent-execute` 依据当前 `state.player`、runtime 快照和已校验的 `actionIntent.dice` 重算只读 `ResolutionCandidate`（骰点、修正、总值、目标、差值、结果等级），并把它保存到 `agentRuntime.pending.outcome`，在 `narrate`/receipt 中复用，AI 不能提交自定义结果或覆盖它。活动冲突仍由冲突结算器负责，避免重复结算。

`actionIntent` 从旧版 `{ raw, verb?, target?, method?, risk?, dice? }` 兼容迁移为版本化 `TurnIntent@1`：`kind` 区分玩家文本、卡内选项和卡内动作，`source` 标记输入来源，`optionId` 可绑定世界卡声明的动作 ID。旧请求缺少这些字段时，服务端按 `kind: 'text'`、`source: 'input'` 补齐；其他未声明字段仍会被拒绝。这样同一条回合链可以保留玩家输入、卡内 UI、开发者测试和 Agent 工具产生的行动来源，而不把来源信息写进叙事正文。

`state.goals` 与 `state.leads` 是存档级目标 / 线索投影，使用稳定 `id`、`title`、`desc`、`status`，可选引用当前世界的 `actorId` / `locationId` 与 `deadline`；它们与旧 `quests` 并存，AI 只能通过本回合结构化 `objective.upsert` 增量写入或 `objective.status` 推进，服务端会校验 ID、状态和地点引用。

存档可通过 `POST /api/world-saves/:saveId/rename` 修改名称（不改变游戏 `revision`），通过 `POST /api/world-saves/:saveId/copy` 创建独立副本，或通过 `GET /api/world-saves/:saveId/export` 下载脱敏的 `tavern_world_save` 包。复制会分配新的 `saveId`，重映射存档自有玩家 / 临时实体 / 回合 / 账本 / 命令 ID，清空 Agent pending，源存档保持不变；导出只包含当前存档，服务端会递归移除 API key、token、本机路径和其他私密字段，不包含设置或其他存档。

兼容旧 WorldSave 时，前端仅在 `state.goals` 缺失且存在 `state.quests` 时生成 `legacy-*` 目标投影；原 `quests` 不删除，下一次正式提交才会把投影随当前存档一起保存。

RPG 控制块使用 `protocol: 'tavern.rpg.turn'`、`version: 1`、`baseRevision` 与 `updates[]` typed patch；允许的更新类型由服务端白名单约束（资源 / 属性 / 技能 / 货币增量、背包、地点、效果和目标状态），不接受任意路径或完整 state。可选 `toolCalls` 只允许声明式工具名称和受限参数，前端将其从 patch 中剥离，通过回合请求的 `agentCalls` 单独提交；服务端只做候选校验和证据记录。客户端只把候选 patch 交给服务端，服务端在当前 `WorldSave@revision` 上物化、校验并原子提交；玩家创建字段、特质和关系在正式回合中保持不可变，避免 AI 通过叙事篡改身份。

`generatedEntities` 按 `npcs` / `items` / `quests` / `locations` 分桶保存 AI 提出的临时实体。回合请求只能提交候选 `createEntities`（最多 32 个），服务端按当前 `saveId` 生成 `save:<saveId>:<kind>:<n>` ID 后写入当前存档；重复命令不会重复创建，其他世界存档不可见。

如需把存档 NPC 收录为长期世界 NPC，客户端必须显式调用 `POST /api/worlds/<worldId>/versions`，提交 `sourceSaveId`、`expectedRevision` 和该存档生成的 `npcId`。服务端会复制来源世界卡为下一 `version`，分配新的稳定 NPC ID 并写入来源映射；来源世界版本与来源存档均不改写。同一来源 NPC 重复调用会返回已创建版本（幂等）。

### 世界存档 WorldSave（saves/<saveId>.json）

RPG 请求还会派生不落盘的 `tavern.rpg.context@1` 快照，供提示词与终端调试共用：`scope` 绑定 `worldId/worldVersion/saveId/revision`；`world` 只标记稳定 WorldCard 事实来源及当前地点 / 时间；`save` 只标记当前 WorldSave 动态事实与短期窗口账本来源；`action` 记录本回合 `TurnIntent` 是否待提交；`tools` 列出本次请求启用的工具、只读工具、候选工具及客户端骰子来源。快照不复制完整状态，也不改变事实权限；缺失字段不能由模型猜测，完整内容仍按各 Prompt section 的来源与 Knowledge Scope 注入。

```js
{
  id, worldId, worldVersion, name, createdAt, updatedAt,
  schemaVersion: 1, revision: 0,
  player: { characterId, snapshot: { fields, attributes, skills, resources, traits, relations, name, race, role, profileFields } },
  party: { memberIds: [], leaderId: null },
  npcStates: { [npcId]: { locationId, relation, knowledge: [], status: [], lastActionId?, lastActivity? } },
  state: {
    stats, player: { fields, attributes, skills, resources, traits, relations, identity: {}, effects: [] }, time: { unit, value }, worldEvents: [], goals: [], leads: [], inventory: [], equipment: {}, currencies: {}, conflicts: {}, growthCandidates: [], growthApplications: [], experiences: [], quests: [], locationId,
    map: { strategy: 'worldCard', data: null, imagePath: null, markers: [] }
  },
  opening: '世界卡 start.opening 的开局叙事',
  setup: {
    status: 'planning' | 'active',
    game: { /* 由 WorldCard.sessionSetup.fields 动态物化的本局规则 */ },
    plan: null | { locationId, presentNpcIds, situation, hook, knownFacts, boundaries, tone, time, event, npcContexts, preGameFacts, knowledge, initialHook },
    candidate: null
  },
  openingMode: 'static' | 'ai', openingOptions: [], openingCommandId: null,
  turns: [{ id, role: 'user' | 'assistant' | 'system', content, ts, options?, actionIntent?: { version: 1, kind: 'text' | 'option' | 'action', source: 'input' | 'option' | 'world-card' | 'devtools' | 'system', raw, optionId?, verb?, target?, method?, risk?, dice? } }],
  initialState: { /* 创建/确认开局时固化的本存档状态基线，包含 runtime/MVU 初值 */ },
  initialNpcStates: { /* 本存档 NPC 初始状态 */ }, initialEventLedger: [],
  receipts: [], eventLedger: [], eventMemory: [], memoryRebuild: null, worldLineSummary: null, generatedEntities: {},
  reopenInfo: null, // 重开存档的只读来源摘要；不与当前回合、状态或结局共享写入
  migrationHistory: [{ kind: 'world-version-upgrade', commandId, fromVersion, toVersion, changes, addedNpcStateIds, revision, migratedAt }]
}
```

创建时由服务端从当前 `WorldCard.start` 复制玩家快照、初始状态和 NPC 初始状态；角色库或世界卡后续编辑不会静默改写已有存档。`playerCreation` 只声明字段与范围，客户端提交的 `player.fields / attributes / skills / resources / traits / relations` 会在 `POST /api/world-saves` 处重新校验；未知 ID、缺失必填项、越界数值或超预算都会被拒绝。每个存档保存一份规范化 `player.snapshot`，并把可变化部分复制到 `state.player`，因此不同存档的建角数据、关系和资源互不共享。世界卡的 `npcIds` / `npcs` 只负责静态登记，关系、位置、认知和状态只写当前 `WorldSave.npcStates`。客户端不能提交文件路径或自行指定 `saveId`。`turnContract.options.min/max` 定义本卡建议行动数量（0–4），自由文本不受限制；服务端按当前 `worldVersion` 二次校验，未达到规则的候选回合不会写入。普通存档维护可通过 `PUT /api/world-saves/<saveId>` 提交完整的 `state + turns + opening`，带 `expectedRevision` 做顺序校验；正式 RPG 新行动使用 `POST /api/world-saves/<saveId>`，携带稳定 `commandId`、`expectedRevision`、`patch: { protocol, version, baseRevision, updates }`、本回合 `turns` 和卡片允许数量的 `options`，服务端在同一临界区物化 patch、推进时间、追加带 revision 的回合并写入幂等 `receipts`；旧客户端仍可提交完整 `state`。`state.conflicts` 与其他存档状态一样必须随当前 revision 完整提交；冲突状态只允许从当前值推进一轮，已结束冲突不能重开，receipt 的 `conflictTransitions` 记录生命周期变化。存档升级必须先对目标世界版本预演；地点、NPC 或任务稳定 ID 缺失时拒绝写入，成功时只更新 `worldVersion`、为新增世界 NPC 初始化本存档状态，并追加幂等 `migrationHistory`。地图网格写入 JSON 前转为数字数组，读取后恢复为 `Uint16Array`，图片只保存受校验的本地 `/images/...` 路径。

`setup.game` 只接受当前世界卡 `sessionSetup.fields` 声明的键；`setup.plan` 是本局开场配置草稿，确认后会物化为 `state.openingScenario`、`state.preGameFacts`、分层 `state.knownInformation`、可选 `state.activeHooks`，并把 NPC 的开局关系与认知写入当前存档的 `npcStates`。`state.activeHooks[]` 是存档级、可选的开局叙事抓手，状态为 `active/done/failed/paused`；AI 只能通过 `objective.status` 且 `kind: "hooks"` 推进，不能用正文伪造完成。

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

`profileFields` 随角色保存，并写入 Character Card V3 的 `extensions.tavern.profileFields`（仍可导出为 V2）；导入时恢复。角色卡编辑器兼容 V1/V2/V3 JSON，并可从 PNG 的 `ccv3` / `chara` 文本块读取卡片元数据（同时兼容未压缩 `iTXt`）；V3 的 `description`、`personality`、`mes_example`、备用开场白、作者字段、`character_book`、`assets` 与未知扩展字段都会保留；`character_book` 只在绑定该角色的酒馆对话中注入，不会并入全局世界书，也不会自动变成 RPG 世界卡的全局绑定。角色书运行时支持卡片级 `scan_depth`、`use_regex`、`case_sensitive`、`selective` 与 `secondary_keys`。角色卡 `extensions.regex_scripts` 在 RP 模式作为卡片级输出正则执行，先于预设与当前模式正则，用于兼容状态栏/HTML 卡面；卡内明确存在的脚本会在首次显示前征得用户确认，随后在同源完整兼容 iframe 中运行，可使用宿主 DOM、localStorage、外部脚本、网络与 ST 兼容桥。预设脚本、EJS/MVU 仍只保留原文。生成的 HTML 仍经 DOMPurify 清洗。构建对话提示词时，非核心字段会追加到 `charDescription` 动态槽位，因此自定义条目不仅用于展示，也会实际参与 AI 对话。

ST Lite 兼容桥向已授权的角色卡脚本提供 `SillyTavern`、`getContext`、`eventSource`、`substituteParams`、`getChatMessages`、角色卡世界书读取、`/send` 与当前 Tavern 会话变量读写；变量只写入当前 `ChatSession` 的 `stVariables`，不会进入其他角色卡或 RPG 存档。该桥只覆盖轻量卡片 API，不承诺兼容依赖 ST 私有 DOM、后端扩展或 npm/Node 的大型插件。

RP 消息显示会优先识别缩进的 HTML 布局与 HTML 代码块，再交给 Markdown 与 DOMPurify；ST 常见的带 `text` 标记的 HTML 正则替换结果也会在完整布局检测后展开，并先提取卡内样式；角色卡消息会占满当前聊天列，iframe 高度跟随卡内根节点内容与折叠状态变化，移动端会把卡内固定宽度和横向内容收进当前消息容器。角色卡可在 `extensions.tavern.ui.scrollMode` 声明 `host`（宿主滚动）、`card`（卡内滚动）或 `auto`（默认，兼容未知卡）；未知卡不强制隐藏内部滚动，避免固定高度面板被裁剪。显示阶段的 `{{user}}` 会替换为当前玩家设定名字。绑定角色卡脚本只有在用户授权后进入同源完整兼容 iframe；拒绝授权或脚本来自预设时按原文 / 清洗后的 HTML 显示。世界卡 `ui.extension` 仍维持单独的无同源 sandbox/CSP 边界。

卡内“加载本卡所有设置”之类的 ST 脚本会读取当前会话快照；只有聊天中实际存在 `<world_view>`、`<character_design_complex>`、`<rule_setting_*>` 等结构化标签时才会填充预览，普通叙事文本为空是正常结果，不代表角色书没有绑定。

### 提示词预设 presets{}（presets.json）
```js
{
  'RP 基础（示例）': {
    version: 3,
    mode: 'tavern',            // tavern | rpg | both
    firstMes: '…',
    replyOptions: {             // 可选；仅 tavern / both 覆盖项目默认
      enabled: true,
      min: 4,
      max: 4,
      count: 4,
      instruction: '生成偏向调查与对话的选项；数量为 {count}。',
    },
    prompts: [                 // 素材库；未进入顺序的素材仍会保留
      {
        identifier: 'main', name: '主提示词', role: 'system', content: '…',
        marker: false, pinned: true, systemPrompt: true,
      },
      {
        identifier: 'custom-id', name: '文风', role: 'user', content: '…',
        marker: false, position: 'in_chat', depth: 2, order: 100,
      },
      {
        identifier: 'jailbreak', name: '历史后指令', role: 'system', content: '…',
        marker: false, pinned: true, systemPrompt: true,
      },
    ],
    promptOrder: [             // 当前 Profile 的顺序与开关
      { identifier: 'main', enabled: true },
      { identifier: 'chatHistory', enabled: true },
      { identifier: 'jailbreak', enabled: false },
    ],
    modelParameters: {         // 可选；从 ST 导入或在预设编辑器配置
      temperature: 0.8, top_p: 0.95, openai_max_tokens: 2048,
      wi_format: '{0}', scenario_format: '{{scenario}}',
    },
  },
}
```

固定项分成两类：`main`、`enhanceDefinitions`、`nsfw`、`jailbreak` 是可编辑的固定提示词；世界书前/后、玩家设定、角色描述、角色性格、场景、记忆、RPG 状态、对话示例和聊天历史是运行时 Marker。两类都可在 `promptOrder` 中排序和关闭，固定项不可删除；只有 Marker 的内容会在每次请求时从当前角色、世界书、会话或世界存档生成。旧的 `tavernFormat` 固定槽位和全局“对白协议”来源已移除，不再有绕过预设开关的隐式输出提示词。

`promptOrder` 直接决定发送给模型的消息顺序，不再先拼成一条隐藏的总 System。Relative 提示词按列表位置进入消息流；In-Chat 提示词按 `depth + order + role` 注入聊天历史。`chatHistory` 控制已完成历史的插入点，但尚未收到回复的当前玩家输入始终保留。`jailbreak` 就是可见、可编辑、可关闭的 Post-History；默认位于完整聊天历史之后，移动后严格遵循新顺序。角色卡的 main / Post-History 覆盖支持 `{{original}}` 合并原预设。

世界书条目按 ST 位置拆分：Before / After 分别进入 `worldInfoBefore` / `worldInfoAfter`，Example Top / Bottom 包住对话示例，At Depth 按条目的 role、depth 和 order 注入历史。Author's Note Top / Bottom 因项目目前没有 Author's Note 槽位而不注入。`wi_format`、`scenario_format`、`personality_format`、新聊天提示、示例分隔符和 assistant prefill 从当前预设读取。

对齐依据为 SillyTavern 官方的 [Prompt Manager](https://docs.sillytavern.app/usage/prompts/prompt-manager/)、[Prompts](https://docs.sillytavern.app/usage/prompts/)、[World Info](https://docs.sillytavern.app/usage/core-concepts/worldinfo/) 与 [Character Design](https://docs.sillytavern.app/usage/core-concepts/characterdesign/) 文档；字段往返以官方 [Default Chat Completion preset](https://raw.githubusercontent.com/SillyTavern/SillyTavern/refs/heads/release/default/content/presets/openai/Default.json) 为基准。

内置酒馆基础预设启用玩家主权、角色稳定、连续性、白描与抗重复模块；内置 RPG 基础预设启用玩家主权、世界连续性、判定、Markdown 叙事和福瑞种族表现模块。RPG 状态协议要求每回合输出恰好 4 个行动选项。

提示词页可导入/导出 SillyTavern Chat Completion 的 `prompts + prompt_order + extensions.regex_scripts`。`system_prompt` 代表固定/钉住的可编辑提示词，`marker` 才代表运行时内容；导入时不会再把 Main Prompt、NSFW 或 Post-History 错当成空 Marker。项目专属的 `mode`、`firstMes` 与 `replyOptions` 在 `tavern_meta` 中往返保留；普通 ST 会忽略该扩展字段。导入同时接受数组、对象映射和字符串 `character_id`，运行时优先采用 `character_id: 100001`，其他 Profile 和未进入当前顺序的 prompts 仍保留并可无损导出。

常见采样参数、停止词、流式开关、seed、reasoning effort、utility templates、assistant prefill 和相邻 System 合并设置保存在 `modelParameters`，当前预设启用后会实际应用到请求；预设里的服务来源和模型 ID 只为无损往返保留，不会静默切换当前连接。支持安全宏 `{{user}}`、`{{char}}`、`{{persona}}`、`{{description}}`、`{{personality}}`、`{{scenario}}`、`{{mesExamples}}`、`{{mesExamplesRaw}}`、`{{lastMessage}}`、`{{lastUserMessage}}`、`{{lastCharMessage}}`、`{{messageCount}}`、`{{newline}}`、`{{space}}`、`{{setvar::名称::值}}` / `{{setglobalvar::名称::值}}`、`{{getvar::名称}}` / `{{getglobalvar::名称}}`、`{{random::甲::乙}}` / `{{pick::甲::乙}}` 和 `{{trim}}`；全局变量兼容宏只在本次请求内生效，未知宏原样保留。导入的输出正则会保留 ST 的 `placement/affects`、`trimStrings`、`markdownOnly`、`promptOnly`、`runOnEdit`、深度等元数据，并在用户输入、AI 回复、聊天显示、提示词/历史、世界书、思维链和斜杠命令阶段执行；侧栏「正则」可为酒馆 / RPG 分别添加自定义规则，默认绑定当前预设且可切为模式全局。角色卡 / 预设中的 EJS、MVU 仍保持原文保留；绑定角色卡的 HTML/CSS/JS 在用户确认后进入同源完整兼容 iframe，世界卡 `ui.extension` 检测到 EJS、MVU 或扩展脚本时则在现有隔离 sandbox iframe 中运行，拒绝授权时保持停用。授权按世界版本或角色卡代码内容哈希保存在本地，代码或版本改变会重新询问。

`_defaults.json.tavern.replyOptions` 定义 RP 自动选项的项目默认（数量、提示词和无选项提示）；酒馆/通用预设的可选 `replyOptions` 以字段覆盖默认，纯 RPG 预设不读取也不会因保存而自动生成该字段。编辑器的“恢复默认”会重新进入继承状态；修改任一控件后才随当前预设保存。旧版写在 `postHistory` 尾部、带「AI 回复选项协议」标题的块会迁入 `replyOptions.instruction`，其余后预设原文保留。自定义提示词可只描述选项风格；若未包含 `<tavern_options>`，运行时在其后补入 JSON 默认模板中的机器协议。客户端解析并移除该标签，只把去重后的选项保存到 assistant 消息的 `options[]`，底部快捷栏据此渲染；关闭时不注入、不修复且不显示等待提示。RP 开启选项时在请求末尾追加临时 Assistant 承诺消息（replyOptions.assistantMessage，可编辑，留空继承默认，支持 {count}/{min}/{max}），与已有 assistant_prefill 合成一条消息；只存在于请求副本，不写入历史或摘要。掉格式只保留正文与合法选项，不追加纠正请求；普通提示词提到标签不会跳过正式协议；RPG 控制块缺失或不合规时最多额外请求两次协议修复。已通过执行器校验的原生工具候选会先转换成内部 Typed Patch，模型正文里的重复 patch 不能覆盖它；协议修复也只替换坏字段，保留本回合已经合法的 options 或 patch。RPG 修复优先强制模型通过专用 function schema 返回控制数据；不支持 function calling 的兼容接口可回退为专用裸 JSON，再由客户端注入固定 `protocol`、`version` 与当前 `baseRevision`，最终仍经同一 Typed Patch 和服务端 revision 校验。修复失败仍保留已生成正文，不在客户端臆造选项。正文、正则和选项数据分开处理，AI 未返回标签时不再回退到写死按钮。兼容模型偶发返回的 `{ label, value }` 选项对象；客户端会在最终提交前统一为字符串，并确保顶层 `options` 与 `patch.options` 同源。RP 的 `<tavern_options>` 与 RPG 的 `<tavern_state_update>` 分别解析，不能互相替代。`variable.*` / `collection.*` 是世界卡 action effects 的内部名；若模型把这五种内部名复制到回合 `updates`，客户端与服务端只为它们补 `runtime.`（变量键同时从 `variableId` 规范为 `id`），随后仍执行完整 ID 与 Schema 校验；其他未知操作仍拒绝。

DeepSeek V4 默认开启 thinking，但 thinking 模式不接受强制 `tool_choice`；专用 RPG 协议修复请求会显式切换为 non-thinking，普通叙事请求仍遵循用户的思维链设置。强制工具请求被拒绝或返回不可解析内容时，官方 DeepSeek 接口才使用 `response_format: { type: "json_object" }` 兜底；JSON Output 仍可能为空，因此返回值不会直接提交，必须继续通过客户端协议解析和服务端校验。

### 世界书 lorebooks{}（lorebooks.json）
```js
{
  default: {
    name: '默认世界书',
    settings: { scanDepth, includeNames, caseSensitive, matchWholeWords, recursive, maxRecursionSteps, minActivations, minActivationsDepthMax, budget, useGroupScoring, insertionStrategy },
    entries: [
      { uid, title, key: [], keysecondary: [], content, enabled, constant, selective, selectiveLogic, order, position, depth, role },
    ],
  },
}
```
- `settings` 按本书保存；旧书没有该字段时回退 `prefs.wi*`。多本书可分别设置扫描深度、大小写 / 整词、角色名扫描、递归、最少激活 / 最大扫描深度、预算、分组评分和角色书 / 全局书排序；世界书页的“导出 ST 世界书”会写出 ST 根级设置与条目对象。
- `constant: true` 常驻注入；`key` 是主关键词，`keysecondary` 是过滤关键词；`selectiveLogic` 支持 ST 的 `AND ANY / NOT ALL / NOT ANY / AND ALL`；`keys` 仅作为旧格式显示兼容；`order` 与 `position/depth/role` 决定候选排序与注入位置标签。
- 世界书页支持导入 / 导出常见 SillyTavern World Info JSON（`entries` 对象/数组，以及 `key`、`keysecondary`、`comment`、`disable`、`order` 等字段）；同时保留并读取 `extensions` 下的 `depth`、`position`、`role`、`scan_depth`、`case_sensitive`、`probability`、`group/group_weight`、`sticky/cooldown/delay`、递归和匹配来源字段。当前运行时实现选择性、概率、分组、递归、Sticky/Cooldown/Delay、常驻、整词 / 大小写、按书扫描设置和 `{{outlet::名称}}` 提示词宏；Before / After、Example Top / Bottom 与 At Depth 会进入对应原生位置，Outlet 由宏取用。项目尚无 Author's Note 槽位，因此 A/N Top / Bottom 保留字段但不注入；向量检索和 Quick Reply Automation 仍只保留字段，不执行。
- 导入带 `character_book` 的 V1/V2/V3 JSON 或 PNG 角色卡时，内嵌角色书会按内容指纹自动注册为独立世界书并显示“角色卡”来源标记；启动时也会迁移已经存在的旧角色卡。角色卡仍保留原始内嵌副本。角色编辑器和世界卡草稿可分别选择绑定，选择自动注册副本时不会重复注入。
- 世界卡详情页会直接展示“使用世界书”绑定结果；点击“选择世界书”进入草稿选择器，世界书列表中的“设为使用”仅控制酒馆模式全局世界书，不会串入 RPG 世界卡。
- 默认世界书已内置：大陆概览 + 种族总览（常驻）、人类 + 10 兽人种族外貌特征、旅店/龙谷等地点条目

### 全局设置 settings（settings.json）
```js
{
  preset: '',               // 服务商 id（providers 的 key），⚠️ 与提示词预设无关
  baseUrl: '', apiKey: '', model: '',
  temperature: 0.9, maxTokens: 32000, topP: 1, // 所有文本生成请求共用
  frequencyPenalty: 0, presencePenalty: 0, seed: -1,
  history: 20, stream: true,
  systemPrompt: '',         // 仅旧缓存迁移；启动后写入 __global__.main 并清空
  postHistory: '',          // 仅旧缓存迁移；启动后写入 __global__.jailbreak 并清空
  firstMes: '',             // 旧开场白兜底
  chatBackground: {        // RP / RPG 普通聊天区共用的本机背景，独立于界面主题预设
    enabled: false, path: '', name: '', // path 仅接受 /images/ 下的本机图片
    fit: 'cover',           // cover | contain
    position: 'center',     // center | top | bottom
    overlay: 0.55,          // 0–1，当前主题背景色遮罩强度
  },
  uiTransparency: {        // 宿主聊天 UI，独立于背景图片和 prefs.uiTheme
    enabled: false,
    amount: 0.6,           // 0–1，越大越透明；仅面板底色，文字保持原透明度
  },
}
```

聊天背景在「设置 → 界面」选择图片后通过 `/api/image-save` 持久保存；JSON 与 localStorage 只存路径和显示参数，不保存图片 base64，也不参与模型请求。Android 使用系统文件选择器，图片位于 `filesDir/images/`，参数随 `settings.json` 恢复。导出的连接配置只包含图片路径，跨设备使用时需重新选择图片。关闭开关保留图片选择，移除恢复默认背景但不删除共享图片文件；加载失败回退主题背景。

透明 UI 与背景开关独立，缺失配置时默认关闭，透明度默认 60%。启用后由工作区绘制连续背景，顶栏、输入区、普通消息气泡及 RPG 宿主面板使用 `1 - amount` 作为底色 alpha；关闭后图片回到聊天滚动区。配置随 `settings.json` 自动保存 / 导入恢复，主题切换或移除背景均保留该选择；不进入模型请求，也不覆盖世界卡自有界面。顶栏本身使用紧凑单排布局，低频操作位于原生 `details` 菜单，保留宿主与世界卡 topbar 的所有权边界。

## 四、提示词构建管线 buildPromptBlocks

1. 选择当前模式的预设；酒馆允许角色卡 `presetName` 覆盖，RPG 允许世界卡 `rpgPresetName` 覆盖。
2. 归一化到 v3 后按 `promptOrder` 遍历启用条目；运行时 Marker 从当前角色、世界书、会话或世界存档求值，固定/自定义提示词展开安全宏。
3. Relative 提示词按列表位置生成原生 System/User/Assistant 消息；`chatHistory` 是真实历史插入点，不再把所有内容预先合成一条 System。
4. In-Chat 提示词和 At Depth 世界书按 `depth + order + role` 注入历史；只有预设显式启用 `squash_system_messages` 才合并相邻 System。
5. `chatHistory` 和历史条数只控制已完成旧上下文，尚未配对的当前玩家回合始终在历史边界保留一次；默认顺序中的 `jailbreak` 随后加入，移动后服从新位置，assistant prefill 再作为最后一条 Assistant 消息加入。
6. 开场白仍按 `char.firstMes → preset.firstMes → settings.firstMes` 读取。

旧版 `{systemPrompt,postHistory,firstMes,modules[]}`、v2 `tavernFormat` 和旧全局提示词在启动时原位迁移到 v3。内置模板中可精确识别的旧隐藏输出协议以及默认 `dialogue` 格式会删除；用户填写的 `formatCustom` 和其他旧格式选择会迁成每个预设中可关闭、可删除的普通提示词，不会静默丢失。

## 五、数据流向

```
首次启动：_defaults.json → ensureDataFiles → 各 :type.json
运行中：  前端状态 ← GET /api/data/:type（server 权威）
         前端保存 → localStorage 缓存 + PUT /api/data/:type（双写）
默认模板：前端启动时 GET /api/data/seed（读取 _defaults.json 深拷贝）；角色、世界书和预设由运行时数据文件独立管理
```

## 六、API 端点（server.js）

| 端点 | 说明 |
|---|---|
| `POST /api/chat` | AI 代理：拼 `baseUrl + /chat/completions`，注入 Bearer，SSE 透传；上游默认 120 秒超时，超时返回 504（可用 `TAVERN_PROXY_TIMEOUT_MS` 调整，仅用于本地测试/运维） |
| `POST /api/image` | 文生图代理：`kind='openai'` → `/images/generations`；`kind='sd'` → `/sdapi/v1/txt2img`，原样转发 |
| `GET /api/models` | 模型列表代理（读 X-Base-Url / X-Api-Key 头）；上游默认 120 秒超时，超时返回 504 |
| `POST /api/dice` | 兼容/诊断用的标准骰子接口；正式世界回合由客户端生成 `actionIntent.dice`，服务端只校验 |
| `GET /api/data/seed` | 返回 _defaults.json 全量（深拷贝） |
| `GET/PUT /api/data/:type` | 读写 characters / presets / lorebooks / settings / user / sessions；sessions PUT 必须是 `{ schemaVersion, sessions: [], deletedIds: [] }`，GET 文件缺失返回 404（表示尚未同步） |
| `GET /api/worlds` | 返回世界卡摘要与每个世界的存档数量 |
| `GET /api/worlds/<worldId>?version=<n>` | 读取指定世界卡版本；省略 `version` 时读取最新版本 |
| `GET /api/worlds/<worldId>/versions` | 按版本号升序列出世界卡版本摘要 |
| `GET /api/worlds/<worldId>/export?version=<n>` | 导出指定不可变版本的 `tavern_world_package` JSON；返回精确引用、资源清单、隐私剔除报告和内容哈希，不包含玩家存档或设置 |
| `DELETE /api/worlds/<worldId>` | 删除世界卡的全部已发布版本和未发布草稿；若仍有存档则返回 `409`，默认世界通过 `world-deleted.json` 保持删除标记 |
| `POST /api/world-imports` | 提交 `{ raw }` 以封存并预演一个世界包；通过时 201，未通过时 422，二者均不写入世界库 |
| `GET /api/world-imports/<importId>` | 读取封存件元数据与兼容报告；不返回原文 |
| `POST /api/world-imports/<importId>` | 确认导入已封存且仍通过哈希/引用校验的世界包；按导入命名空间创建新世界与专属引用；重复确认幂等 |
| `GET /api/world-drafts?worldId=<worldId>` | 列出世界草稿摘要；不传 worldId 时列出全部草稿 |
| `GET /api/world-drafts/<worldId>` | 读取指定世界草稿 |
| `GET /api/world-drafts/<worldId>/check` | 预检当前持久化草稿的发布条件，返回按世界定义、稳定引用、开局运行态和 Prompt 契约分组的 `report`；不修改草稿 |
| `POST /api/world-drafts` | 默认从指定 `worldId` / `baseVersion` 创建或读取同一世界的幂等编辑草稿；提交 `mode: "new"` 与 `sourceWorldId` 会克隆为新的独立世界草稿，提交 `mode: "blank"` 会创建不绑定已有世界卡的空白草稿，二者发布后都会获得新的世界 ID |
| `PUT /api/world-drafts/<worldId>` | 使用 `expectedUpdatedAt + baseVersion` 乐观锁保存标题、简介、标签、`lorebookIds`、`rpgPresetName`、`agent`、`regexes`、`ui`、`runtime`、`setting`、`rules`、`playerCreation`、`sessionSetup`、`turnContract`、`failure`、`ending`、`time`、`locations` 与 `npcs`；旧 `events/factions/conflicts/map/growth` 投影会被收敛，不是新卡写入入口。完整字段见 `docs/rpg-card-api.md` |
| `POST /api/world-drafts/<worldId>/publish` | 提交 `commandId`、`expectedUpdatedAt` 与 `baseVersion`，服务端会再次执行同一份完整性检查；通过后把草稿发布为不可变的下一版本。命令可幂等重试；草稿落后最新版本时返回 409 并保留草稿 |
| `POST /api/worlds/<worldId>/versions` | 显式把来源存档中的生成 NPC 收录进下一不可变世界版本；要求 `sourceSaveId`、`npcId`，可选 `expectedRevision` / `title` |
| `GET /api/world-saves?worldId=<worldId>` | 列出指定世界的存档摘要 |
| `POST /api/world-saves` | 按世界卡创建一个独立存档；可提交 `player: { fields, attributes, skills, resources, traits, relations }`，服务端按当前卡规则校验并分配 `saveId` |
| `DELETE /api/world-saves/<saveId>` | 删除单个世界存档 JSON；不会删除世界卡或其他存档 |
| `PATCH /api/world-saves/<saveId>/setup` | 仅在 `planning` 状态，以 `commandId + expectedRevision` 保存 `{ draft: { player?, game?, plan?, ui? } }`；不激活开局 |
| `PUT /api/world-saves/<saveId>/setup` | 在 `planning` 状态，以 `commandId + expectedRevision` 提交最终 `player/playerPresetId/game/plan`；服务端校验建角与开局方案 |
| `POST /api/world-saves/<saveId>/opening-candidate` | 在 `planning` 状态下，以 `commandId + expectedRevision` 保存独立的 OpeningCandidate（叙事正文 + 恰好 4 个非空字符串选项）；不写入正式开场 |
| `POST /api/world-saves/<saveId>/opening` | 以 `commandId + expectedRevision` 幂等提交 AI 开场正文与恰好 4 个非空字符串选项；原子把 `setup.status` 切为 `active` 并更新当前存档的 `opening` / `openingOptions` |
| `GET /api/world-saves/<saveId>` | 读取一个完整 WorldSave |
| `PUT /api/world-saves/<saveId>` | 使用 `expectedRevision` 原子提交当前存档的 `state`、`turns` 与 `opening`；版本冲突返回 409 |
| `POST /api/world-saves/<saveId>/reset` | 使用 `commandId + expectedRevision` 将当前 RPG 存档恢复到 `initialState` / `initialNpcStates` 基线，同时清空回合、MVU/runtime 动态值、事件记忆和 Agent 临时态 |
| `POST /api/world-saves/<saveId>` | 提交一次 RPG 正式回合；新协议携带 `patch { protocol, version, baseRevision, updates }`、`commandId`、`expectedRevision`、回合文本、选项和可选 actionIntent。服务端校验 Runtime/Typed Patch 后原子推进 revision；旧完整 state 提交仅兼容保留 |
| `POST /api/world-saves/<saveId>/agent-execute` | 先执行 Typed Patch 与世界规则，结果写入带 `baseRevision` 的 `agentRuntime.pending`，不推进正式 revision；相同 commandId 幂等返回 |
| `POST /api/world-saves/<saveId>/agent-cancel` | 使用 `commandId + expectedRevision` 清理未提交的 Agent pending，不改变正式 revision |
| `POST /api/world-saves/<saveId>/growth` | 已移除，当前返回 `410`；请使用 `runtime.variables`、`runtime.collections`、`runtime.actions` 表达成长与解锁 |
| `GET /api/world-saves/<saveId>/memory` | 只读返回当前存档的派生记忆统计、正式来源数量与脱敏重建预览；隐藏记忆不展开内容 |
| `POST /api/world-saves/<saveId>/memory/rebuild` | 使用 `commandId + expectedRevision` 从世界事件、成长事实与 `eventLedger` 来源引用重建 `eventMemory`；不改变正式 world revision，重复 commandId 幂等 |
| `GET /api/world-saves/<saveId>/summary` | 读取绑定当前存档 revision 的世界线总结；若正式事实已变化则标记 `stale` |
| `POST /api/world-saves/<saveId>/summary/rebuild` | 使用 `commandId + expectedRevision` 从正式事件、经历、关系、阵营状态与结局重建 `worldLineSummary`；不改变正式 world revision，重复 commandId 幂等 |
| `POST /api/world-saves/<saveId>/reopen` | 仅允许已结束或终止失败的存档；按 `commandId` 创建确定 ID 的独立重开存档，继承过去记忆与只读总结，清除当前终止锁，源存档保持不变；重复命令幂等 |
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
### WorldSave 失败结算（R6.7）
`state.failure` 由服务端依据 `WorldCard.failure` 在正式回合提交时写入，状态为 `resolved`、`active` 或 `terminal`。客户端和 AI 不能直接修改；`terminal` 存档会拒绝新的普通回合，重试同一 `commandId` 仍返回原提交结果。规则支持继续、重伤、俘虏、资源损失、永久死亡与卡定义模式，世界卡可以用 `defaultMode`、`onZeroHp`、`onConflictDefeat` 和 `modes[]` 覆盖描述与效果。

### WorldSave 开放式结局（R6.8）
`WorldCard.ending` 只声明可用结局与可选条件；玩家通过 `/api/world-saves/<saveId>/end` 明确确认后，服务端才写入 `state.ending`、receipt 和事件账本。结局不要求唯一正确答案；`state.ending.status = 'ended'` 后普通回合、成长应用和手工存档更新都会被拒绝，重复 `commandId` 仍幂等返回原存档。

### WorldSave 世界线总结（R6.9）
`worldLineSummary` 是当前存档的派生投影，不是第二份可写状态。服务端只读取已提交的 `state.worldEvents`、人物经历、玩家 / NPC 关系、阵营状态、失败 / 结局和 `eventLedger`，生成带 `sourceRevision` 与 `sourceHash` 的结构化总结；正式事实变化后旧总结会标记为 `stale`，重建不改变正式 world revision，也不读取未提交叙事正文或隐藏事件描述。

### WorldSave 失败 / 结局重开（R6.10）
`POST /api/world-saves/<saveId>/reopen` 只接受 `state.ending.status = 'ended'` 或 `state.failure.status = 'terminal'` 的世界线。新存档使用 `reopen-<source+command hash>` 的确定 ID，复制当前状态与长期记忆但把 `revision`、回合、receipt、账本和当前 `worldLineSummary` 重新置空；过去结局 / 失败与总结放入只读 `reopenInfo`，并在 Prompt 中标记为背景连续性。终止失败重开时仅把当前存档的 HP 恢复到至少 1，新存档的后续写入不会改动源存档；相同 `commandId` 重试返回同一重开存档。

### Android 内嵌服务器同步（R6.11）

Android 内嵌服务器按 URL 的 `path` 与查询参数分开路由，因此 `worldId`、`version`、`targetVersion` 等查询参数与 Web 端一致。`PUT /api/world-saves/<saveId>` 的 `turns` 是完整快照替换，`POST` 才是增量回合追加；Agent 执行暂存会保留 `turns`、`options`、`agentToolTrace` 与阶段历史，重启后可继续 narrate 阶段。
