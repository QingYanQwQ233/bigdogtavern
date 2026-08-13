# Tavern 世界卡 / 世界存档架构草案

> 状态：**W1 世界库与 W2 Web 世界存档主链已实现；NPC、回合事务提交与旧 RPG 迁移仍按路线图进行。**
>
> 本文定义目标结构与迁移边界；W1/W2 已落地 Web 存档边界，旧 RPG 用户数据仍不自动迁移。
>
> 分阶段任务、验收门与回退入口见 [world-card-implementation-plan.md](world-card-implementation-plan.md)。

## 1. 已确定的方向

- RPG 不再是“角色卡的一种对话模式”；它是进入一个可复用大世界后创建的一次游玩。
- 当前 RPG 的“对话”在目标模型中改为“世界存档”；开局叙事与 `turns` 是存档的一部分。
- 世界卡负责可复用的世界内容；世界存档负责会变化的事实。两者不能互相覆盖。
- 角色卡在世界模式中分为玩家角色、世界 NPC 与临时 NPC，不再成为 RPG 会话的唯一归属。
- 沿用 SillyTavern 的世界书 / 提示词素材库 / Prompt 顺序思想，但 UI 由 Tavern 原生数据渲染，不执行导入 HTML、EJS、MVU、插件脚本或正则脚本。

## 2. 目标与非目标

### 目标

1. 一个世界卡可创建多个互不串数据的世界存档。
2. 一个世界内可有多个 NPC、队伍成员、地点、派系与任务。
3. 地图、背包、任务、NPC 关系、已发现地点与剧情记录都只属于一个世界存档。
4. RPG Prompt 从当前世界与当前存档动态装配；不读取酒馆角色卡绑定的预设或会话。
5. 酒馆模式保留“角色卡 → 对话存档”的轻量 RP 体验，和世界模式真正隔离。

### 明确非目标（第一阶段不做）

- 不运行任意 HTML / JavaScript 作为世界界面。
- 不把 AI 叙事正文直接当作已提交状态。
- 不自动把所有生成 NPC 晋升到全局角色库。
- 不做多人联机、云同步、完整 Mod 沙箱、无限分支存档或通用脚本引擎。
- 不强制世界必须有完整大陆设定；单地点、小城镇和大世界使用同一结构。

## 3. 名词与所有权

```text
世界卡 WorldCard           可复用、可编辑的内容定义
世界存档 WorldSave         一次游玩的正式事实与叙事时间线
玩家角色 PlayerCharacter   某个世界存档中由玩家控制的角色快照
世界 NPC WorldNPC          世界卡定义的可复用角色资料
存档 NPC 状态 NpcState     NPC 在某个存档里的关系、位置、认知与临时变化
地点 Location              世界卡中的稳定地点 ID；存档只引用 ID
世界地图 MapBase           世界卡的地图底图或生成规则
地图状态 MapState          存档中的发现、标记、占领、损坏等可变化层
回合 Turn                  已提交的玩家输入、叙事、状态变化与选项
```

| 数据 | 唯一 owner | 可写者 | 典型消费者 |
|---|---|---|---|
| 世界观、地点、NPC 定义、世界书、RPG Profile | `WorldCard` | 世界编辑器 | 新存档、Prompt、世界入口页 |
| 玩家身份、队伍、任务、地图探索、关系、叙事历史 | `WorldSave` | 世界回合提交 / 明确编辑命令 | 游戏 UI、Prompt、读档 |
| NPC 原始性格、外形、语言档案 | `WorldNPC` / 角色库 | 世界编辑器 | Prompt、图鉴 |
| NPC 好感、当前位置、已知秘密、受伤等 | `WorldSave.npcStates` | 世界回合提交 / 明确编辑命令 | Prompt、关系 UI |
| 流式文本、原始模型响应、调试 Trace | 临时运行时 | 仅运行时 | 调试窗口 |

**不变量：** 任何可变化的 RPG 数据都必须带 `saveId`；任何世界定义数据都必须带 `worldId`；NPC 的动态数据必须带 `saveId + npcId`。不允许用“当前角色”或全局 `mode` 推断归属。

## 4. 内容与存档关系

```text
世界卡（worldId, version）
├─ 世界书 / 世界规则 / RPG Profile
├─ 地点目录与地图底图
├─ NPC 目录与派系目录
└─ 开局方案
       │ 创建时快照引用
       ▼
世界存档（saveId, worldId, worldVersion, revision）
├─ 玩家角色快照与队伍
├─ 当前地点、地图状态、任务、背包、数值
├─ NPC 存档状态、关系与认知
├─ 已提交回合时间线
└─ 由正式事实派生的记忆 / 摘要 / UI 投影
```

世界卡发布后形成不可变的 `worldVersion` 快照；编辑世界卡会创建下一版本，而不是原地改写已发布内容。旧存档仍钉住创建时的版本。是否升级内容包必须由玩家显式选择并产生迁移记录；不能静默用新版地点、Prompt 或 NPC 定义改写进行中的世界。

## 5. 目标数据结构

### 5.1 世界卡 `WorldCard`

```js
{
  schemaVersion: 1,
  id: 'world-aurora',
  version: 1,
  title: '极光大陆',
  summary: '一句话世界简介',
  coverImage: '/images/world-aurora.png',
  tags: ['日式西幻', '福瑞', '冒险'],

  start: {
    locationId: 'wolf-tooth-inn',
    opening: '进入世界时展示的叙事入口，不属于 NPC 开场白',
    playerTemplateId: 'adventurer',
  },
  lorebookIds: ['lore-aurora-core'],
  rpgPresetName: '极光大陆 · DM',
  npcIds: ['npc-lily', 'npc-ranger'],
  factionIds: ['faction-guild'],
  itemIds: ['wolf-fang'],
  questTemplateIds: ['cross-wilds'],
  locations: [{ id: 'wolf-tooth-inn', name: '断牙之角', type: 'inn' }],
  map: {
    strategy: 'fixed', // fixed | perSave
    baseMapId: 'map-aurora-v1', // fixed 时读取的底图
    generation: { seed: 12345, size: 128, regionCount: 10, landRatio: 0.55, mapgenSize: 'small' }, // perSave 时的生成参数
  },
  ui: { layout: 'world-desk' }, // 仅声明式布局，不含可执行 HTML/JS
  source: { format: 'native', rawAssetRef: null },
}
```

世界卡可以引用全局角色库和世界书；导出世界卡时应连同被引用内容导出为一个不可执行的世界包，并保留来源和版本信息。

### 5.2 世界存档 `WorldSave`

```js
{
  schemaVersion: 1,
  id: 'save-7f3',
  name: '初次踏入极光大陆',
  worldId: 'world-aurora',
  worldVersion: 1,
  createdAt: 0,
  updatedAt: 0,
  revision: 12,

  player: {
    characterId: 'pc-fox',
    snapshot: { name: '艾岚', race: '狐族', role: '游侠', profileFields: [] },
  },
  party: { memberIds: ['pc-fox'], leaderId: 'pc-fox' },
  state: {
    locationId: 'wolf-tooth-inn',
    stats: { level: 1, exp: 0, expNext: 100, hp: 20, maxHp: 20, mp: 5, maxMp: 5, gold: 10, buffs: [] },
    inventory: [],
    quests: [],
    map: {
      strategy: 'fixed',
      baseMapId: 'map-aurora-v1',
      data: null, // perSave 地图使用可 JSON 化的 SerializedWorldMap
      imagePath: null,
      discoveredLocationIds: ['wolf-tooth-inn'],
      markers: [],
    },
  },
  npcStates: {
    'npc-lily': { locationId: 'wolf-tooth-inn', relation: {}, knowledge: [], status: [] },
  },
  turns: [
    // W2 先保存可恢复的消息时间线；W3 再扩展为带 command/receipt 的回合提交
    { id: 'turn-12', role: 'user', content: '推门进入旅店', ts: 0 },
    { id: 'turn-13', role: 'assistant', content: '你推开了旅店的门。', options: [], ts: 0 },
  ],
  receipts: [], // commandId 幂等记录，按上限裁剪
  eventLedger: [], // 长期提交索引：每条记录带 sourceRevision，引用已提交事实而不复制第二份状态
  eventMemory: [], // 服务端从已提交回合规范化的长期事件记忆；带来源、实体、地点和时间作用域
  generatedEntities: {}, // save:* ID 的临时 NPC、道具、任务或地点；只属于此存档
  migrationHistory: [],
}
```

WorldCard 的简介、地点、NPC 公共资料、派系定义、事件模板和规则属于 `worldVersion` 的稳定设定；WorldSave 的位置、时间、NPC 状态、目标、冲突、事件和记忆属于 `saveId + revision` 的当前事实。两层在 Prompt 中同时保留，存档变化只解释当前世界线，不反向改写已发布世界卡。

### 5.3 NPC 与临时角色

- `WorldNPC`：世界卡引用的长期角色，保存身份、人格、语言、认知边界与静态资料。作用域 Prompt 只读取公开字段；`secrets: [{ id, content }]` 只有在当前存档 `npcStates[npcId].knowledge` 持有对应 ID 时才解锁。
- `npcStates[npcId]`：该 NPC 在此存档中的动态事实。好感、位置、已知线索、队伍状态都在这里；这些状态只对当前 `saveId` 有效。
- AI 临时生成的路人进入 `WorldSave.generatedEntities.npcs`，只对该存档可见；只有用户执行“收录到世界”时才创建稳定 `npcId` 与世界定义资料。

世界卡可预定义物品和任务模板。AI 需要创造新道具、任务、路人或临时地点时，只能提出 `createEntities` 候选；校验器为其生成 `save:<saveId>:<kind>:<n>` 稳定 ID 并写入 `WorldSave.generatedEntities`。因此开放生成仍是“此存档的事实”，不会污染世界卡、其他存档或全局角色库。

地图运行时继续使用 `Uint16Array` 网格；写入 JSON 前必须显式序列化为数字数组，读取后再恢复成 `Uint16Array`，避免区域编号和类型在持久化时丢失。AI 美化图只保存本地相对路径，并由所属 `WorldSave.state.map.imagePath` 引用。

世界卡只定义生成参数；地图首次生成或重新生成后，使用的 `generation` 快照随地图数据写入当前存档。草稿参数变更不会回写已发布版本，也不会改变已有存档地图。

## 6. RPG Prompt 与世界书装配

目标的 RPG 输入只使用当前 `worldId + saveId` 的内容：

```text
DM 身份与玩家主权
→ 世界卡的稳定世界规则 / 常驻世界书
→ 玩家角色快照、队伍与当前地点
→ 当前存档的正式状态（任务、背包、地图、关系、已发现事实）
→ 当前地点 / 队伍 / 历史命中的 NPC 与世界书
→ 已提交回合窗口与存档记忆
→ RPG 输出协议与最终自检
```

- 不注入全部 NPC；仅注入队伍成员、当前地点角色、与当前任务或历史命中的角色。
- `location` 从自由文本升级为稳定 `locationId`；展示名由世界卡读取。
- 世界书仍可关键词触发，但必须带作用域（世界 / 地点 / NPC / 存档事件）与稳定 ID。
- RPG 预设由世界卡引用；存档只记录其版本，不能回退到酒馆角色卡的 `presetName`。
- 导入的 ST 正则、EJS、MVU 和脚本保留在来源 sidecar，默认不执行；展示清理规则也不得写入 RPG 正式状态。

## 7. 回合、状态与保存

当前实现中 `processAIOutput()` 会直接把 JSON 写入 `session.rpgState`。目标架构将其替换为单一提交链：

```text
玩家输入 / 点击选项
→ AdvanceWorldTurn(commandId, saveId, expectedRevision)
→ 固定 WorldSave@revision 快照并装配 Prompt
→ StreamDraft（仅显示，未保存）
→ RawModelResponse
→ 解码为 CandidateTurn（叙事 + 候选状态变化 + 4 个选项）
→ 校验世界/地点/NPC/物品/任务引用与数值边界
→ 原子写入 WorldSave（turn + state + npcStates + revision + receipt）
→ 保存确认后更新世界 UI、时间线与派生记忆
```

失败规则：

- 流式中断、模型失败、JSON 解析失败或状态校验失败：存档 revision 不变；正文最多显示为“未提交草稿”，不得变更地图/任务/背包。
- 同一 `commandId` 重试：只返回同一已提交结果，不重复调用模型或重复发奖励。
- 保存结果未知：先按 `saveId + commandId` 对账，再允许下一回合。
- 当前阶段只需要线性存档 revision；分支 / reroll 是后续能力，不预先实现。

### 目标 RPG 输出契约

```json
{
  "version": 3,
  "locationId": "wolf-tooth-inn",
  "changes": {
    "stats": { "hp": -2, "gold": null },
    "inventory": [{ "itemId": "wolf-fang", "count": 1, "add": true }],
    "quests": [{ "questId": "cross-wilds", "status": "active" }],
    "npcs": [{ "npcId": "npc-lily", "relation": { "trust": 1 } }]
  },
  "createEntities": [
    { "kind": "item", "tempId": "herb-1", "name": "月露草", "count": 1, "reason": "在月港湿地采得" }
  ],
  "options": [
    { "id": "ask-lily", "label": "向莉莉询问北境消息" }
  ]
}
```

叙事仍在 `rpg` 块之前。`changes` 和 `createEntities` 都是候选，不是模型的直接写权限；未知 ID、越权修改和不合规则拒绝提交或显示为待处理错误。`createEntities` 只能创建声明允许的存档内实体，不能修改世界规则、已发布地点或其他存档。

## 8. UI 结构

### 8.1 世界库（替代 RPG 直接进入角色会话）

```text
世界库
├─ 世界卡列表：封面、题材、版本、存档数量
├─ 世界详情：简介、地点、NPC、世界书、地图、使用的 RPG 预设
├─ 新建世界存档：选玩家角色 / 创建玩家角色 / 存档名称
└─ 存档列表：当前地点、队伍、最后回合、更新时间、导出 / 删除
```

### 8.2 世界桌面（打开一个世界存档）

```text
世界标题 + 存档名 + 保存状态
├─ 左：玩家 / 队伍 / 背包
├─ 中：世界叙事时间线 + 输入 + 四个行动选项
├─ 右：地点、任务、关系、地图与已发现地标
└─ 底：状态条 + 当前 revision + 调试入口
```

世界入口页和世界桌面由原生组件根据 `WorldCard` 与 `WorldSave` 渲染。它可以拥有鲜明主题和视觉布局，但不接受世界卡内任意可执行网页代码。

## 9. 与酒馆模式的边界

| 能力 | 酒馆模式 | 世界模式 |
|---|---|---|
| 主入口 | 角色卡 | 世界卡 |
| 记录单位 | 角色对话存档 | 世界存档 |
| 当前角色 | 对话对象 | 玩家角色 / NPC / 队伍成员 |
| 状态 owner | 对话本身（轻量） | `WorldSave`（正式 RPG 事实） |
| Prompt | 角色绑定预设可覆盖 | 世界卡 RPG Profile |
| 地图、任务、背包 | 不适用 | 仅世界存档 |

酒馆已有 `sessions` 将保留为聊天存档；目标实现中不再用 `kind: 'rpg'` 把 RPG 与角色卡强行绑在同一个会话集合。

## 10. 文件、迁移与兼容

目标存储布局：

```text
public/data/
├─ worlds.json                 世界卡索引与内容定义
├─ world-drafts.json           世界卡草稿（未发布，不参与正式版本读取）
├─ saves/<saveId>.json         单个世界存档的正式状态与时间线
├─ characters.json             角色库（酒馆角色 / 玩家模板 / NPC 原始资料）
├─ lorebooks.json              世界书库
└─ presets.json                Prompt 素材库与 Profile
```

单存档单文件避免大型地图、长时间线和图片路径让所有存档一起读写；服务端必须用受控 `saveId` 路径映射，不接受客户端任意文件路径。运行时 JSON 只能通过受校验的 API 读取，静态文件服务不得直接暴露 `/data/`。

世界草稿发布是显式的版本边界：服务端在同一世界写锁内确认草稿修订号和 `baseVersion` 仍匹配当前最新版本，再追加 `version + 1`。新版本记录 `publication.commandId`、基础版本和草稿修订号，以便网络超时后幂等对账。先写新版本、后清理草稿：如果清理失败，重试同一 `commandId` 会返回已发布版本并再次尝试清理，不会产生第二个版本。`WorldSave.worldVersion` 始终保持原值，版本升级必须由后续的显式迁移流程完成。

存档升级分为两步：先对目标版本做只读 dry-run，列出地点、NPC 和任务稳定 ID 的增删，并检查 `state`、`npcStates`、队伍、地图发现与任务的实际引用；任一非存档生成实体引用在目标版本缺失都是硬错误。用户确认后，服务端在同一 `saveId` 锁内按 `expectedRevision` 重新计算；只有仍可升级时才切换 `worldVersion`、为新增世界 NPC 创建该存档的初始状态、提升 revision 并追加 `migrationHistory`。地图、回合、背包与存档生成实体原样保留；相同 `commandId` 重试不会重复升级。

世界包导出使用版本化、纯数据 JSON 容器：一个包只绑定一个已发布 `worldId + worldVersion`，复制世界定义及其明确引用的全局角色、世界书和 RPG 预设，并生成覆盖 `content + assets` 的确定性 SHA-256。资源当前只输出清单：本地 `/images/...` 记录内容哈希，外部 URL 不下载，本机绝对路径及带查询参数或认证信息的 URL 拒绝进入包。服务端递归剔除凭据字段、来源存档 ID，并完全排除 `settings`、`user` 和 `WorldSave`；NPC 叙事 `secrets` 正常保留，世界书正则只标记数量、导出时不执行。JSON 包为 W5.7 导入的契约基础；需要实际携带图片、音频等二进制时，再沿用 CHARX 的“根清单 + assets 目录”思路增加 ZIP 容器，而不改变内容 owner。

W5.7 导入保持两段式：`原文封存 + 只读报告 → 用户确认 → 命名空间化落库`。封存件是导入记录唯一的原件 owner，原文和哈希永不经由普通 API 回显；世界库只收到经过已知引用映射的新实体。未知顶层字段、脚本/EJS/MVU/Macro sidecar 保留在封存原件，报告明确标记为未执行，不混入运行时。世界书正则只做安全编译校验，导入后的对应条目默认禁用，需由用户在世界书页审阅保存才会按既有机制匹配。失败或取消停留在封存记录，不写入活动世界；同一封存记录的重复确认返回同一导入结果。

第一版不维护第二份 `world-saves.json` 索引：存档列表由服务端扫描 `saves/*.json` 的顶层元数据生成，避免索引与正式存档分叉。这个实现面向本地单用户、数百个以内的存档；只有实测扫描成为瓶颈时，才增加可从正式存档重建的派生索引。

### 旧 RPG 会话迁移

1. 迁移前创建可恢复备份和 dry-run 报告。
2. 每个旧 `kind: 'rpg'` 会话默认迁为**独立**世界存档，保留其消息、`rpgState`、地图数据与美化图路径。
3. 因旧结构无法可靠判断多个会话是否同属一个世界，绝不自动合并；用户可在迁移向导中手动合并或指定目标世界卡。
4. 旧会话的 `charId` 仅用于创建初始玩家角色快照，不再作为存档归属键。
5. 迁移失败不覆盖旧会话；保留只读原件、错误报告和重试入口。

## 11. 阶段路线图

| 阶段 | 可交付切片 | 不做什么 |
|---|---|---|
| A | 世界卡 / 世界存档 JSON Schema、世界库、创建与打开空存档 | 不迁旧档、不改 AI 回合 |
| B | `saveId` 范围内的 RPG 时间线、状态、地图与任务读取 | 不自动生成 NPC |
| C | 原子 `AdvanceWorldTurn`、候选变化校验、存档 revision | 不做分支 / 云同步 |
| D | NPC 状态、队伍、地点与世界书作用域 | 不做脚本插件 |
| E | 旧 RPG 会话迁移向导、导入导出、世界包兼容报告 | 不自动合并旧档 |

每个阶段先以新建的测试世界和新存档验证，再接触用户现有 RPG 会话。

## 12. 关键风险与验证

| 风险 | 缓解 / 验证 |
|---|---|
| AI 返回错误或虚构 ID | 输出契约校验；未知地点/NPC/物品不提交 |
| 世界卡编辑污染旧存档 | `worldVersion` + 显式升级迁移；新旧存档回放 |
| 多世界 / 多存档串数据 | 所有读取以 `saveId` / `worldId` 明确筛选；回归断言 |
| 存档过大 | 单存档文件；时间线窗口与派生记忆分离 |
| 旧会话迁移误合并 | 默认一会话一存档；dry-run 与备份 |
| “网页世界卡”成为执行入口 | 声明式 UI 配置；不执行导入 HTML/JS/模板脚本 |

首批行为验收：

1. 同一世界创建两个存档：地图探索、任务、NPC 关系与叙事完全隔离。
2. 两个不同世界：NPC、世界书、预设与地图绝不互相注入。
3. 一个玩家角色进入两个世界：角色基础资料可复用，但数值、背包和关系各自独立。
4. 模型输出无效地点 ID：叙事可标为未提交，正式存档不变。
5. 存档重开后：最后已提交回合、地图、美化图、任务、背包、地点与关系一致恢复。

## 13. 待确认的创作决定

1. 世界模式中，玩家默认是“自建角色”，还是“世界卡提供的预设主角”？
2. 玩家能否在一个世界存档内切换控制多个队伍成员，还是只控制一个主角？
3. 顶部模式名称是否由“RPG”改为“世界”，酒馆则保留“酒馆”？（建议改为“世界”，因为世界卡可承载冒险、经营、群像等不止 RPG 的玩法。）
4. 世界卡的主要入口是“世界桌面”，还是保留一个可选“角色 / 开场白入口”作为兼容体验？

在这些决定确认前，本文中的玩家模型和 UI 命名均为暂定，不进入实施。
