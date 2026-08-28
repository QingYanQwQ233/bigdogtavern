# RPG 世界卡、运行时与 HTTP 接口参考

> 适用版本：2026-08-26 当前仓库实现。本文以 server.js、public/app.js 和现行世界草稿工作台为准，并优先于旧文档中已经过期的 RPG API 描述。
>
> 面向高级世界卡作者、扩展作者和本地 API 集成者。只想用界面制卡，请先读 [从零创建一张可玩的 RPG 世界卡](rpg-card-tutorial.md)。

## 1. 核心模型与通用约定

| 对象 | 作用 | 是否随游玩变化 |
|---|---|---|
| WorldCard | 世界规则、地点、NPC、建角 Schema、Runtime Schema、UI 与 Agent 配置 | 发布后不可变 |
| WorldDraft | 尚未发布的 WorldCard 候选 | 可保存、可继续编辑 |
| WorldSave | 一条独立世界线：玩家、地点、Runtime、回合、记忆与回执 | 每次正式提交递增 revision |
| World Package | 可导入/导出的世界内容包 | 不含玩家存档和本机设置 |

固定身份是 **WorldCard@worldVersion**，动态事实是 **WorldSave@revision**。发布新版本不会覆盖旧存档；升级存档必须单独预演并确认。

### 地址、JSON 与错误

- 本地默认根地址是 http://localhost:3000。
- 除下载和 AI 流式代理外，请求/响应都是 UTF-8 JSON。
- 成功响应没有统一 envelope：可能直接返回 WorldSave，也可能返回 { "ok": true } 或 { "world": ... }。
- 通常失败响应是 { "error": "可读错误说明" }；代理上游失败也可能是 { "error": { "message": "..." } }。
- 常见状态码：400 参数错误；404 不存在；409 并发或工作流冲突；413 请求过大；422 导入/迁移预检失败；500 本地持久化失败；502/504 上游代理失败/超时。

### ID、并发与幂等

世界、存档、Runtime 条目等稳定 ID：

~~~text
^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$
~~~

命令 ID 使用同类字符，长度为 8–96。每次会改变存档的命令应创建新的 commandId；因断网重试时必须复用原 commandId。

| 场景 | 防冲突字段 | 收到 409 后的处理 |
|---|---|---|
| 保存草稿 | expectedUpdatedAt + baseVersion | 重新读取草稿，合并再保存 |
| 写入 WorldSave | expectedRevision + commandId | 重新读取存档，重新生成本回合 |
| 发布草稿 | expectedUpdatedAt + baseVersion + commandId | 同命令可幂等重试；版本落后时先处理差异 |

### 安全边界

服务默认没有鉴权，AI/图片代理也没有 SSRF 防护，只可本机开发/演示使用。不要把 API Key、WorldSave、浏览器设置或本机文件路径写入世界包。

## 2. HTTP 端点

### 数据与代理

| 方法 / 路径 | 请求 | 成功响应 | 说明 |
|---|---|---|---|
| POST /api/chat | { baseUrl, apiKey?, extraHeaders?, body } | 上游 Chat Completions 的 JSON 或 SSE 原样透传 | 代理到 Base URL 的 chat/completions；超时为 504 |
| GET /api/models | Headers：X-Base-Url、X-Api-Key? | 上游 models 原样 JSON | 缺少 Base URL 为 400 |
| POST /api/image | { baseUrl, apiKey?, kind, body } | 上游图片 API 原样 JSON | kind 为 sd 时走 SD WebUI；否则走 OpenAI 兼容图片接口 |
| POST /api/image-save | { b64 } 或 { url } | { "path": "/images/<name>.png" } | 本地持久化图片 |
| POST /api/dice | { "expressions": ["1d20+2"] }，最多 16 条 | { "rolls": [{ "expr", "rolls", "bonus", "total" }] } | 兼容/诊断接口；正式 RPG 骰子走客户端骰面 + 服务端复核 |
| GET /api/data/seed | 无 | 默认模板深拷贝 | 读取 _defaults.json，不是用户当前数据 |
| GET /api/data/:type | 无 | 对应 JSON 文档 | type：characters、presets、lorebooks、settings、user、gen、sessions |
| PUT /api/data/:type | 整份 JSON 文档 | { "ok": true } | worlds 禁止从此入口写入；sessions 必须有 schemaVersion、sessions、deletedIds |

### 世界卡、版本与草稿

| 方法 / 路径 | 核心请求 | 成功响应 | 关键语义 |
|---|---|---|---|
| GET /api/worlds | 无 | WorldSummary 数组 | 每个 worldId 只返回最新版本摘要和 saveCount |
| GET /api/worlds/:worldId?version=n | 可选 version | 完整 WorldCard | 省略 version 时读取最新版本 |
| GET /api/worlds/:worldId/versions | 无 | WorldSummary 数组 | 该世界所有已发布版本 |
| DELETE /api/worlds/:worldId | 无 | { ok, worldId, versions, draftDeleted } | 存在任一 WorldSave 时返回 409 |
| GET /api/worlds/:worldId/export?version=n | 可选 version | 下载 world package JSON | 不含存档、用户设置、API Key |
| POST /api/worlds/:worldId/versions | { sourceSaveId, npcId, expectedRevision?, title? } | { world, npcId, idempotent } | 将当前存档的生成 NPC 收录进下一世界版本 |
| GET /api/world-drafts?worldId=... | 可选筛选 | WorldDraft 数组 | 返回完整草稿，但会按当前最小 RPG 契约精简 |
| POST /api/world-drafts | 三种 mode，见下文 | WorldDraft | 新建、复制、编辑草稿 |
| GET /api/world-drafts/:worldId | 无 | WorldDraft | 不存在时 404 |
| PUT /api/world-drafts/:worldId | 草稿字段 + 乐观锁字段 | 更新后的 WorldDraft | updatedAt 或 baseVersion 过期时 409 |
| GET /api/world-drafts/:worldId/check | 无 | 发布检查报告 | 只读，按 definition/references/runtime/prompt 分组 |
| POST /api/world-drafts/:worldId/publish | { commandId, expectedUpdatedAt, baseVersion } | { world, idempotent, draftRemoved } | 再校验后发布不可变的新版本 |

创建草稿：

~~~json
{ "mode": "blank" }
~~~

~~~json
{ "worldId": "ashen-frontier", "baseVersion": 1 }
~~~

~~~json
{ "mode": "new", "sourceWorldId": "ashen-frontier", "baseVersion": 1 }
~~~

依次表示：创建空白世界、编辑已有世界、克隆为一个新的独立世界。

草稿保存的最小请求：

~~~json
{
  "expectedUpdatedAt": 1720000000000,
  "baseVersion": 1,
  "title": "世界标题",
  "summary": "",
  "tags": [],
  "lorebookIds": []
}
~~~

可选字段：rpgPresetName、agent、ui、regexes、runtime、setting、rules、playerCreation、sessionSetup、turnContract、failure、ending、time、locations、npcs。

### 世界包与旧会话迁移

| 方法 / 路径 | 请求 | 成功响应 | 说明 |
|---|---|---|---|
| POST /api/world-imports | { raw: 完整 package JSON 文本 } | 201 或 422 的 WorldImportView | 无论是否通过均封存预览；最大 2 MiB；响应不回传 raw |
| GET /api/world-imports/:importId | 无 | WorldImportView | 含 hash、兼容报告、状态与导入后的世界信息 |
| POST /api/world-imports/:importId | 无 body | { import, world, idempotent } | 用户确认后再次校验 hash/结构，再命名空间化导入 |
| POST /api/rpg-migrations | { raw: 旧 RPG 会话 JSON } | 201 或 422 MigrationView | 封存并预演旧会话迁移 |
| GET /api/rpg-migrations/:migrationId | 无 | MigrationView | 只返回元数据和报告，不回传 raw |
| POST /api/rpg-migrations/:migrationId | 无 body | { migration, save, idempotent } | 生成确定 ID 的迁移存档 |

世界包外层：

~~~json
{
  "spec": "tavern_world_package",
  "specVersion": 1,
  "manifest": { "appContractVersion": 1 },
  "content": {
    "world": {},
    "characters": [],
    "lorebooks": {},
    "presets": {}
  },
  "assets": []
}
~~~

导出会写入内容 hash、引用和资源清单，并剔除私密数据。导入会拒绝不安全资源路径、私密字段、hash 不一致和无效 Runtime/UI/引用；包中的未知可执行内容不会自动执行。

### WorldSave 创建、管理与开局

| 方法 / 路径 | 核心请求 | 成功响应 | 说明 |
|---|---|---|---|
| GET /api/world-saves?worldId=... | 可选 worldId | SaveSummary 数组 | 包含 version、revision、地点、setupStatus |
| POST /api/world-saves | { worldId, worldVersion?, name, player?, playerPresetId?, setupOnly? } | 完整 WorldSave | revision 初始为 0；player 按建角 Schema 校验 |
| GET /api/world-saves/:saveId | 无 | 完整 WorldSave | 读取世界线 |
| DELETE /api/world-saves/:saveId | 无 | { ok, saveId, worldId } | 不影响世界卡或其他存档 |
| POST /api/world-saves/:saveId/rename | { name } | 完整 WorldSave | 名称为 1–120 字符 |
| GET /api/world-saves/:saveId/export | 无 | 下载 tavern_world_save JSON | 导出一条世界线 |
| POST /api/world-saves/:saveId/copy | { commandId, name? } | { save, idempotent } | 复制为独立存档 |
| POST /api/world-saves/:saveId/reset | { commandId, expectedRevision } | 完整 WorldSave | 回到开局基线，清空回合、记忆和 pending Agent |
| PATCH /api/world-saves/:saveId/setup | { commandId, expectedRevision, draft } | 完整 WorldSave | 仅 planning；供卡内开局页保存草稿 |
| PUT /api/world-saves/:saveId/setup | { commandId, expectedRevision, player?, playerPresetId?, game?, plan? } | 完整 WorldSave | 校验建角、本局规则、开局计划，仍是 planning |
| POST /api/world-saves/:saveId/opening-candidate | { commandId, expectedRevision, candidate } | 完整 WorldSave | 保存候选开场，不激活 |
| POST /api/world-saves/:saveId/opening | { commandId, expectedRevision, opening, options, candidateCommandId? } | 完整 WorldSave | 原子切换为 active，保存 opening 与 openingOptions |

注意：opening-candidate 和 opening 当前都硬性要求恰好 4 个不重复的非空字符串选项；这是独立于正式回合 turnContract 的开局接口约束。正式回合才按 turnContract.options 的 0–4 范围校验。

创建存档示例：

~~~json
{
  "worldId": "ashen-frontier",
  "worldVersion": 1,
  "name": "我的第一条世界线",
  "player": {
    "fields": { "name": "伊芙" },
    "attributes": {},
    "skills": {},
    "resources": {},
    "traits": [],
    "relations": {}
  }
}
~~~

PATCH setup 的 draft 仅允许 player、game、plan、ui 四个段。PUT setup 则提交最终建角/本局设置/开局规划。plan 可包含地点、在场 NPC、局势、语气、时间、开局事实、知识边界和 initialHook；它只属于当前 WorldSave。

### 正式回合、Agent、记忆与结局

| 方法 / 路径 | 请求 | 成功响应 | 说明 |
|---|---|---|---|
| POST /api/world-saves/:saveId | 正式回合 payload | 完整 WorldSave | 唯一正式回合提交入口 |
| PUT /api/world-saves/:saveId | { expectedRevision, state, turns, opening? } | 完整 WorldSave | 旧完整快照兼容入口；新实现优先 Typed Patch |
| POST /api/world-saves/:saveId/agent-execute | execute phase payload | 含 execution.status 的 WorldSave | 暂存已校验状态，不推进正式 revision |
| POST /api/world-saves/:saveId/agent-cancel | { commandId, expectedRevision } | 完整 WorldSave | 取消 pending，不改变 revision |
| GET /api/world-saves/:saveId/memory | 无 | memory diagnostics | 事件记忆派生诊断 |
| POST /api/world-saves/:saveId/memory/rebuild | { commandId, expectedRevision } | { save, diagnostics, idempotent } | 重建 eventMemory，不递增 revision |
| GET /api/world-saves/:saveId/summary | 无 | summary view | 含 stale，表示总结是否落后正式事实 |
| POST /api/world-saves/:saveId/summary/rebuild | { commandId, expectedRevision } | summary view | 重建世界线总结，不递增 revision |
| GET /api/world-saves/:saveId/upgrade?targetVersion=n | targetVersion | UpgradeReport | 只读升级预演 |
| POST /api/world-saves/:saveId/upgrade | { targetVersion, expectedRevision, commandId } | { save, report, idempotent } | 无硬错误才升级 |
| POST /api/world-saves/:saveId/end | { commandId, expectedRevision, endingId?, confirm? } | 完整 WorldSave | 仅卡声明允许且条件满足时结束 |
| POST /api/world-saves/:saveId/reopen | { commandId, name? } | { save, idempotent } | 仅 ended/terminal failure；源存档不变 |

### 已移除：不要调用

| 方法 / 路径 | 实际结果 | 替代方案 |
|---|---|---|
| POST /api/world-saves/:saveId/growth | 410，成长系统已从当前 RPG 世界卡移除 | 用 Runtime 变量、集合和动作表达成长/解锁 |
| POST /api/world-saves/:saveId/runtime | 410，禁止直接写 Runtime | 玩家行动 → AI 回合 → Typed Patch/action |

## 3. WorldCard 内容契约

### 顶层字段

| 字段 | 类型 | 用途 |
|---|---|---|
| id | 安全 ID | 世界的稳定标识；发布后不能在原世界内改名 |
| version | 正整数 | 已发布版本号；由服务端管理 |
| title、summary、tags | 文本、文本、字符串数组 | 世界库显示信息 |
| lorebookIds、rpgPresetName | ID 数组、名称 | 绑定世界书与 RPG 预设 |
| setting、rules | 文本 / 结构化 JSON | 世界设定、明确规则；供开局和 AI 上下文使用 |
| locations、npcs | 数组 | 可游玩的地点与静态 NPC 定义 |
| playerCreation、sessionSetup | JSON Schema | 建角与本局配置的界面/校验契约 |
| runtime | JSON DSL | 变量、集合与世界卡动作 |
| turnContract、time | JSON | 每回合选项数量、行动意图开关、世界时间 |
| failure、ending | JSON | 失败后果与结束世界线的规则 |
| agent、ui、regexes | JSON | Agent 循环、展示界面与兼容正则 |

新世界卡正式写入只认上表字段。旧版本曾出现的 events、factions、conflicts、map、mapGeneration、itemIds、questTemplateIds、factionIds、playerCreation.economy、playerCreation.growth 与 initialInventory 不是新卡写入模型；草稿保存会清理这些历史投影。用 Runtime 变量、集合和动作表达同类玩法。

### 地点与 NPC

地点最多 256 个，每项至少包含 id、name；可选 type、summary、tags。NPC 也最多 256 个，每项至少包含 id、name；可选字段如下。

| NPC 字段 | 含义 |
|---|---|
| role、description、persona、personality、appearance、speechStyle | 给叙事与 AI 使用的人物描述 |
| publicFacts、publicGoals、desires、fears、goals | 字符串列表；前两者适合公开信息，后几者适合人物动机 |
| secrets | { id, content } 数组；应只在适当情景向 AI 注入，不应直接显示给玩家 |
| locationId、homeLocationId | 必须引用已声明地点 |
| activity | 当前活动描述 |
| actions | 旧 NPC 行为兼容层；新玩法优先写入 runtime.actions |

不要删除已经被发布版本 start.locationId 引用的地点；服务端会拒绝这种草稿。

### 建角与本局配置

playerCreation 的 mode 可为 custom；字段最多 64 个，字段类型是 text、textarea、select、number。属性、技能、资源和特质都属于该 Schema，玩家提交的 player 必须与之匹配。

~~~json
{
  "mode": "custom",
  "title": "创建调查员",
  "pointBudget": { "total": 10, "min": 0, "mode": "pool", "cost": "above-min" },
  "fields": [
    { "id": "name", "label": "名字", "type": "text", "required": true, "maxLength": 80 },
    {
      "id": "origin",
      "label": "来处",
      "type": "select",
      "required": true,
      "options": [
        { "value": "city", "label": "城市" },
        { "value": "wild", "label": "荒野" }
      ],
      "default": "city"
    }
  ],
  "attributes": [
    { "id": "insight", "label": "洞察", "min": 0, "max": 10, "default": 2 }
  ],
  "skills": [
    { "id": "investigate", "label": "调查", "min": 0, "max": 10, "default": 1 }
  ],
  "resources": [
    { "id": "hp", "label": "生命", "min": 0, "max": 20, "default": 10 }
  ],
  "traits": [
    { "id": "keen-eye", "label": "敏锐观察", "description": "擅长发现细节。" }
  ]
}
~~~

属性、技能、资源的每项都应有安全 ID、label、min、max、default；属性可受 pointBudget 限制。buildPresets 最多 32 个，用 values.attributes、values.skills、values.resources、values.traits 提供预填方案。sessionSetup 的 fields 最多 64 个，类型是 text、textarea、select、number、boolean，服务端把其提交保存到当前 WorldSave 的 game/plan，而非 WorldCard。

### 回合、时间、失败与结局

~~~json
{
  "turnContract": {
    "options": { "min": 3, "max": 4 },
    "actionIntent": true
  },
  "time": { "unit": "日", "start": 1, "turnAdvance": 1 },
  "failure": {
    "defaultMode": "continue",
    "onZeroHp": "injured",
    "modes": [
      {
        "id": "injured",
        "label": "负伤",
        "description": "保留世界线，恢复少量生命并附加状态。",
        "hpRatio": 0.25,
        "effect": "负伤"
      },
      {
        "id": "continue",
        "label": "带着代价继续",
        "description": "失败改变局面，不强制结束故事。"
      }
    ]
  },
  "ending": {
    "enabled": true,
    "allowPlayerEnd": true,
    "requireConfirm": true,
    "defaultEndingId": "player-choice",
    "endings": [
      {
        "id": "player-choice",
        "kind": "player-choice",
        "label": "玩家主动结束",
        "description": "保留当前存档并结束本次旅程。",
        "terminal": true
      }
    ]
  }
}
~~~

turnContract.options 的 min/max 范围均为 0–4；未设置时默认恰好 4 个选项。failure.mode 可以声明 terminal、cardDefined、hpRatio、effect、resourceLoss；zero HP 和冲突失败仅会引用已声明或内建模式。ending 的 kind 只支持 player-choice、card-defined，terminal 只能为 true。

## 4. Runtime DSL

Runtime 是当前 RPG 玩法状态的唯一正式数据模型。定义发布在 WorldCard 中，每个 WorldSave 创建时都会材料化一份独立 Runtime 状态。

> scope 可以取 world、save、player、entity、session，但当前实现仍把这些值存入目标 WorldSave；它们用于声明语义和未来兼容性，不能实现跨存档共享世界状态。

### 变量

变量定义字段为 id、label、scope、type、initial、min、max、options、visible。

| type | 初始值要求 | 说明 |
|---|---|---|
| string | 字符串 | 普通文本状态 |
| number | 有限数字，可配 min/max | 计数、体力、警戒等 |
| boolean | 布尔值 | 开关 |
| enum | options 中的一项 | 离散状态 |
| list | 数组 | 小型列表 |
| map、json | 对象 | 受大小限制的结构化状态 |

variables、collections、actions 各最多 128 项。visible 为 true 的变量会进入默认侧栏。

### 集合

集合定义字段为 id、label、scope、entrySchema、initial。每项 initial 必须是带安全 id 的对象；若 entrySchema 指定 required 或 additionalProperties: false，初始化、添加和 patch 后的条目都必须满足它。

~~~json
{
  "id": "durable-items",
  "label": "耐久物品",
  "scope": "save",
  "entrySchema": {
    "type": "object",
    "properties": {
      "id": { "type": "string" },
      "label": { "type": "string" },
      "durability": { "type": "number" },
      "maxDurability": { "type": "number" }
    },
    "required": ["id", "label", "durability", "maxDurability"],
    "additionalProperties": false
  },
  "initial": [
    { "id": "old-lantern", "label": "旧提灯", "durability": 3, "maxDurability": 3 }
  ]
}
~~~

### 动作、可用条件与效果

动作字段为 id、label、description、category、inputs、availability、check、effects。一个动作至少有 1 个 effect，最多 16 个。

| effect.type | 必填字段 | 作用 |
|---|---|---|
| variable.set | variableId、value | 直接设置变量 |
| variable.delta | variableId、delta | 数字变量增减，受 min/max 约束 |
| collection.add | collectionId、value | 添加带安全 id 的条目 |
| collection.remove | collectionId、entryId | 移除条目 |
| collection.patch | collectionId、entryId、set 或 delta | 修改条目字段；delta 只用于数字字段 |

可用条件是 AND 关系：collection.exists、collection.number、variable.compare。比较运算符只有 ==、!=、>、>=、<、<=。若条件不满足，动作不可执行；这正是数量为 0 的口粮、耐久为 0 的工具应使用的兼容机制。

~~~json
{
  "id": "use-lantern",
  "label": "点亮旧提灯",
  "category": "item",
  "description": "消耗 1 点耐久；耐久归零时按钮不可用。",
  "availability": [
    {
      "type": "collection.number",
      "collectionId": "durable-items",
      "entryId": "old-lantern",
      "field": "durability",
      "operator": ">",
      "value": 0
    }
  ],
  "effects": [
    {
      "type": "collection.patch",
      "collectionId": "durable-items",
      "entryId": "old-lantern",
      "delta": { "durability": -1 }
    }
  ]
}
~~~

动作 inputs 可声明 string、number、boolean、enum、list、map、json 等 Runtime 类型；动态条目 ID 只允许使用安全 ID 或 {{ input.<id> }} 模板。不要把玩家文字直接拼成字段名、集合 ID 或任意 JSON Path。

### 判定动作

check 只能声明 sides、target、modifiers。sides 为 2–1000，modifier 最多 8 个，必须引用真实玩家属性/技能/资源、已声明 Runtime 或常数。带 check 的 Runtime 动作必须经历规则复核和骰子结果，成功后才允许执行完整 effects；不能由 AI 伪造骰子、目标或成功。

~~~json
{
  "id": "inspect-clue",
  "label": "调查玻璃爪印",
  "check": {
    "sides": 20,
    "target": 12,
    "modifiers": [
      { "source": "player", "bucket": "skills", "id": "investigate" }
    ]
  },
  "effects": [
    { "type": "variable.delta", "variableId": "clues", "delta": 1 },
    {
      "type": "collection.patch",
      "collectionId": "clue-board",
      "entryId": "glass-paw",
      "set": { "status": "confirmed" }
    }
  ]
}
~~~

## 5. Typed Patch、Agent 与 AI 输出

### 正式回合 payload

新客户端应通过 POST /api/world-saves/:saveId 提交用户与 AI 已生成的回合内容，服务端只接受与当前 revision 一致的有界 Typed Patch。

宿主会把自由输入精确匹配到的无参数 Runtime 动作也标为 `kind: "action"`：忽略空白和标点后，文本必须唯一等于动作的 `label` 或 `id`，例如“点亮盐火提灯。”会绑定 `use-salt-lantern`。其余自然语言仍是普通 `text`，不会做语义猜测或自动执行动作。

~~~json
{
  "commandId": "turn-20260826-0001",
  "expectedRevision": 7,
  "actionIntent": {
    "version": 1,
    "kind": "action",
    "source": "world-card",
    "raw": "调查玻璃爪印",
    "actionId": "inspect-clue",
    "input": {}
  },
  "patch": {
    "protocol": "tavern.rpg.turn",
    "version": 1,
    "baseRevision": 7,
    "updates": []
  },
  "turns": [
    { "role": "user", "content": "调查玻璃爪印" },
    { "role": "assistant", "content": "叙事正文……" }
  ],
  "options": [
    "继续调查",
    "前往城门",
    "询问守卫"
  ]
}
~~~

patch 的 protocol 必须是 tavern.rpg.turn，version 为 1，baseRevision 必须等于 expectedRevision，updates 最多 32 条。正式回合的 options 是不重复的非空字符串数组，数量受 turnContract 约束。顶层 options 与结构化块中的 options 同时出现时必须完全一致；否则回合被拒绝。

允许的 updates：

| update.type | 作用 |
|---|---|
| player.resource.delta | 改变已声明玩家资源 |
| player.attribute.delta、player.skill.delta | 改变已声明属性/技能 |
| location.set | 切换到已声明地点 |
| effect.add、effect.remove | 玩家效果变化 |
| runtime.variable.set、runtime.variable.delta | Runtime 变量变化 |
| runtime.collection.add、runtime.collection.remove、runtime.collection.patch | Runtime 集合变化 |
| runtime.action.execute | 执行已声明世界卡动作 |

currency.delta、inventory.delta、objective.status、objective.upsert 只保留旧存档兼容痕迹，当前新世界卡不应使用。

### Agent 两阶段

Agent profile 最小可用配置如下。

~~~json
{
  "protocol": "tavern.rpg.agent",
  "version": 1,
  "mode": "native",
  "maxSteps": 4,
  "tools": {
    "rules.check": { "enabled": true, "execution": "client-readonly" },
    "dice.roll": { "enabled": true, "execution": "client" },
    "state.patch": { "enabled": true, "execution": "server" },
    "memory.record": { "enabled": true, "execution": "server" },
    "context.retrieve": { "enabled": true, "execution": "server" }
  }
}
~~~

WorldCard 的 agent.tools Schema 可以声明 dice.roll、rules.check、state.patch、objective.upsert、entity.create、memory.record、context.retrieve、runtime.action.execute。但当前 Agent 候选调用实际只接受 dice.roll、rules.check、state.patch、memory.record、runtime.action.execute；context.retrieve 是宿主读取/trace 能力，objective.upsert、entity.create 是历史声明，不应作为新卡玩法或客户端调用。

执行顺序：

1. AI 的 execute 阶段读取上下文，需要判定时先提出 rules.check。
2. 客户端以世界卡声明的 modifiers 调用规则复核，再掷出真实骰面。
3. AI 根据真实结果选择 runtime.action.execute 或 Typed Patch，服务端校验并暂存 execution。
4. AI 的 narrate 阶段只写叙事和选项；客户端用同一 commandId 提交正式回合。

判定的真实骰面放在 actionIntent.dice，而不是写在叙事文本中：

~~~json
{
  "actionIntent": {
    "version": 1,
    "kind": "action",
    "source": "world-card",
    "raw": "调查玻璃爪印",
    "actionId": "inspect-clue",
    "input": {},
    "dice": [
      { "expr": "1d20", "rolls": [14], "bonus": 0, "total": 14 }
    ]
  }
}
~~~

expr 必须是世界卡声明的基础骰式，rolls 的每个骰面在合法范围内，total 必须等于骰面和加上 expr 自带 bonus。属性/技能修正由服务端根据 rules.check 的 modifiers 单独计算，不能偷偷写进 expr 或伪造 total。

不要把 reasoning_content、工具调用草稿或第二个结构化块显示给玩家。AI 正文末尾只能有一个 tavern_state_update 块：

~~~text
<tavern_state_update>
{"protocol":"tavern.rpg.turn","version":1,"baseRevision":7,"updates":[],"options":[],"eventMemory":[]}
</tavern_state_update>
~~~

eventMemory 是玩家已经历的短事实，不是 AI 的隐含思考；内容必须与提交的状态一致。

## 6. UI 与世界扩展

ui 的可写顶层字段是 schemaVersion、layout、theme、slots、regions、shell、sidebar、extension。schemaVersion 目前只支持 1。

| 字段 | 当前契约 |
|---|---|
| layout | 字符串；常用 host、world-desk、custom。custom 只控制工作区布局，不授予状态写权限 |
| theme.tokens | 最多 32 个受校验 CSS Token；值不能含脚本、URL、花括号或分号 |
| slots | 旧兼容可见性声明 |
| regions | 每个区域独立选择 decorate、replace、append、hide；区域名只允许 topbar、sidebar.left、narrative、options、input、sidebar.right、status、overlay |
| shell | navigation/topbar 为 show 或 hide；fullscreen 为布尔；escape 为 fullscreen、world、none |
| sidebar.panels | 最多 24 个声明式数据面板 |
| extension | 隔离 HTML/CSS/JS 配置；permissions 是请求的能力标签，不是直接写存档的授权 |

regions 配置可写 mode、visible、label、fallback、component。fallback 只支持 host、empty；component 必须是安全组件 ID。没有对应的宿主组件时应保留安全回退，不要假设 replace/append 会执行任意页面脚本。

未写 ui.sidebar 时，宿主会自动展示 visible Runtime 变量、集合和动作。写入 sidebar 后，该数组完全接管侧栏，因而每个仍需展示的区域都要显式声明。

~~~json
{
  "schemaVersion": 1,
  "layout": "world-desk",
  "shell": {
    "navigation": "show",
    "topbar": "show",
    "fullscreen": true,
    "escape": "fullscreen"
  },
  "sidebar": {
    "panels": [
      {
        "id": "inventory",
        "title": "随身物品",
        "side": "left",
        "source": "runtime.collections.durable-items",
        "layout": "cards",
        "fields": ["label", "durability"]
      },
      {
        "id": "lantern",
        "title": "提灯",
        "side": "left",
        "source": "runtime.actions.use-lantern",
        "layout": "actions"
      }
    ]
  }
}
~~~

自定义 world extension 被 sandbox，不能直接碰宿主 DOM、网络或存档。当前 Bridge 只有：

| Bridge | 作用 |
|---|---|
| TavernExtension.requestContext()、getContext() | 请求/读取宿主上下文 |
| TavernExtension.runtime.get() | 只读 Runtime |
| TavernExtension.on()、off() | 监听/注销宿主事件 |
| TavernExtension.choose(text, options?) | 让宿主提交一次玩家选择；`options.actionId` 可绑定已声明 Runtime 动作，`options.input` 传递该动作的已声明输入 |
| TavernExtension.setup.get()、patch()、commit()、cancel() | 仅开局 planning 表单 |
| TavernExtension.fullscreen()、exitFullscreen()、exitWorld()、openTerminal() | 宿主界面操作；`fullscreen()` / `exitFullscreen()` 成对切换浏览器全屏，`openTerminal()` 打开 AI 往返终端 |
| TavernExtension.endWorld({ endingId?, confirm }) | 在卡内发起“提前结束本局”；必须传 `confirm: true`，宿主仍会按 `world.ending` 和当前存档 revision 校验并写入 `state.ending` |

扩展没有 TavernExtension.action() 或 TavernExtension.patch()。游玩时要改变状态，必须让玩家选择进入 Agent/Typed Patch；不要绕过服务端请求已经移除的 Runtime 写接口。`getContext()` 的 `world.ending` 提供可选结局，`save.state.ending` 表示当前存档是否已经结束；结束后 `turn.canChoose` 会变为 `false`。

## 7. 常见拒绝原因

| 报错 / 现象 | 根因 | 正确做法 |
|---|---|---|
| options 在请求顶层与 patch 内不一致 | 两处各自生成，内容不同 | 只生成一份，或保证字节语义完全一致 |
| 动作当前不可用 | availability 条件不满足，例如 count 为 0 | AI 叙事承认资源已耗尽，前端禁用按钮，不提交 execute |
| runtime.action.execute 未声明动作 | actionId 不在 WorldCard.runtime.actions | 先在世界卡声明，再让 AI/玩家引用 |
| 动作判定不可信 | modifiers 或骰面没有按卡声明复核 | 先 rules.check，再真实 dice.roll，再执行 |
| 草稿保存后旧字段消失 | 写入了已退休的硬编码系统 | 使用 Runtime 变量/集合/动作重建玩法 |
| 回合 409 | revision 已被其他请求推进 | 重新读取存档，丢弃旧 patch，再生成 |
| 结构化格式掉失 | 模型没有只输出一个状态块 | 在预设中明确协议；客户端保留原文和校验错误供重试 |

## 8. 参考实现与相关文档

- [从零创建一张可玩的 RPG 世界卡](rpg-card-tutorial.md)：界面操作、完整样例和测试清单。
- [灰烬边境完整世界包](demo-western-fantasy-ashen-frontier.tavern-world.json)：本仓库可导入的正式参考。
- [灰烬边境说明](demo-western-fantasy-ashen-frontier.md)：参考包的设计说明。
- [数据结构与兼容历史](data-structure.md)：旧存档/存储背景；与本文冲突时以本文和服务端校验为准。
