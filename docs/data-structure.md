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
  start: {
    locationId: 'wolf-tooth-inn', opening: '…',
    playerTemplateId: null, playerTemplate: { name: '未命名冒险者', ... },
    initialState: { stats: { level: 1, hp: 100, mp: 50, ... }, inventory: [], quests: [] }
  },
  lorebookIds: [], rpgPresetName: 'RPG 叙事引擎（示例）',
  locations: [], npcs: [], factions: [], items: [], quests: [],
  map: { strategy: 'perSave', generation: { seed, size, regionCount } },
  ui: { layout: 'world-desktop', source: 'json' }
}
```

世界卡是可复用的静态定义，不保存某个玩家的回合、背包或地图图片。W1 暂不提供世界卡写接口，内容来自 `_defaults.json.worlds` 初始化的 `worlds.json`。

### 世界存档 WorldSave（saves/<saveId>.json）

```js
{
  id, worldId, worldVersion, name, createdAt, updatedAt,
  schemaVersion: 1, revision: 0,
  player: { templateId, snapshot },
  party: { memberIds: [], leaderId: null },
  npcStates: { [npcId]: { locationId, relation, knowledge: [], status: [] } },
  state: {
    stats, inventory: [], quests: [], locationId,
    map: { strategy: 'perSave', data: null, imagePath: null, markers: [] }
  },
  opening: '世界卡 start.opening 的开局叙事',
  turns: [{ id, role: 'user' | 'assistant' | 'system', content, ts, options? }],
  receipts: [], generatedEntities: {}, migrationHistory: []
}
```

创建时由服务端从当前 `WorldCard.start` 复制玩家快照、初始状态和 NPC 初始状态；角色库或世界卡后续编辑不会静默改写已有存档。世界卡的 `npcIds` / `npcs` 只负责静态登记，关系、位置、认知和状态只写当前 `WorldSave.npcStates`。客户端不能提交文件路径或自行指定 `saveId`。普通存档维护可通过 `PUT /api/world-saves/<saveId>` 提交完整的 `state + turns + opening`，带 `expectedRevision` 做顺序校验；正式 RPG 新行动使用 `POST /api/world-saves/<saveId>`，携带稳定 `commandId`、`expectedRevision`、候选 `state`、本回合 `turns`、恰好 4 个 `options`，以及可选的 `npcStates`，服务端在同一临界区校验版本、追加带 revision 的回合并写入幂等 `receipts`。地图网格写入 JSON 前转为数字数组，读取后恢复为 `Uint16Array`，图片只保存受校验的本地 `/images/...` 路径。

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
| `POST /api/chat` | AI 代理：拼 `baseUrl + /chat/completions`，注入 Bearer，SSE 透传 |
| `POST /api/image` | 文生图代理：`kind='openai'` → `/images/generations`；`kind='sd'` → `/sdapi/v1/txt2img`，原样转发 |
| `GET /api/models` | 模型列表代理（读 X-Base-Url / X-Api-Key 头） |
| `GET /api/data/seed` | 返回 _defaults.json 全量（深拷贝） |
| `GET/PUT /api/data/:type` | 读写 characters / presets / lorebooks / settings |
| `GET /api/worlds` | 返回世界卡摘要与每个世界的存档数量 |
| `GET /api/world-saves?worldId=<worldId>` | 列出指定世界的存档摘要 |
| `POST /api/world-saves` | 按世界卡创建一个独立空存档；服务端分配 `saveId` |
| `GET /api/world-saves/<saveId>` | 读取一个完整 WorldSave |
| `PUT /api/world-saves/<saveId>` | 使用 `expectedRevision` 原子提交当前存档的 `state`、`turns` 与 `opening`；版本冲突返回 409 |
| `POST /api/world-saves/<saveId>` | 提交一次 RPG 回合候选；校验 `commandId`、assistant 回合、4 个唯一选项、状态数值/背包/任务边界和 revision，成功后追加带 revision 的回合并记录 receipt；相同 commandId 幂等返回 |

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
