# Tavern · AI RP / RPG 框架

Tavern 是一个面向 AI 角色扮演的本地 Web 应用。它把普通的角色卡聊天和“大世界” RPG 存档拆成两条独立链路：

- **酒馆模式**：角色卡是创作对象，AI 负责连续的 RP 叙事。
- **RPG 模式**：世界卡是规则与世界的来源，AI 负责扮演 DM / 世界化身，玩家通过存档参与一条独立世界线。

项目的核心不变量是：**数据按所有权分层绑定，不跨角色、跨会话、跨存档串数据；能结构化保存的状态不只依赖 AI 记忆。**

## 快速开始

需要 Node.js 18+，运行时零 npm 依赖。

```bash
node server.js
```

打开 <http://localhost:3000>，然后在「设置 → 连接」中填写 OpenAI 兼容接口的 Base URL、API Key 和模型。支持 OpenAI、DeepSeek、OpenRouter、Ollama、LM Studio 以及其他 `/chat/completions` 兼容服务。

常用检查：

```bash
node --check server.js
node --check public/app.js
node scripts/check_rpg_protocol.js
```

完整回归脚本位于 `scripts/check_*.js`。

## 数据所有权

默认模板只有一个来源：`public/data/_defaults.json`。首次启动时，服务端根据它初始化运行时 JSON。

```text
_defaults.json
  ├─ characters.json       角色库
  ├─ presets.json          提示词预设
  ├─ lorebooks.json        世界书
  ├─ settings.json         连接与运行设置
  ├─ user.json             玩家设定与酒馆手动记忆
  └─ worlds.json            世界卡目录

saves/<saveId>.json        RPG WorldSave，服务端按存档独立读写
world-deleted.json         已删除世界卡 ID（防止默认模板重新出现）
```

`localStorage` 只保存离线缓存和当前 ID，服务端 JSON 是权威源。`WorldCard@worldVersion` 保存稳定世界资料；`WorldSave@revision` 保存本局玩家、状态、事件、回合和记忆。世界卡或角色卡后续编辑不会静默覆盖已有存档。

世界库中的存档可单独删除；删除世界卡前必须先删除该世界的全部存档，确认后会移除所有已发布版本和未发布草稿。默认世界通过 `world-deleted.json` 记录删除标记，刷新后不会被 `_defaults.json` 自动补回。

## 酒馆模式

酒馆模式围绕“角色卡 + 对话会话”工作：

- 角色卡创建、编辑、删除，以及 Character Card V1/V2 JSON 导入导出；
- 三步 AI 写卡：一句话定角色 → JSON Schema 动态填表 → 生成完整结构化角色卡；
- 动态角色字段、可自定义栏目和运行时保存，不把世界观字段写死在前端；
- SillyTavern 风格提示词预设：System、历史前/后指令、In-Chat、Relative、宏、排序和导入导出；
- 多本世界书：触发词、正则、常驻、扫描深度、整词匹配和角色绑定；
- 玩家设定、手动记忆、消息编辑/删除/复制/重生成；
- 旁白/对白拆分状态机；
- AI 消息 Markdown 渲染与安全清洗；
- 文生图消息（OpenAI 兼容或 Stable Diffusion），图片保存后可持久化。

酒馆记忆目前是用户级手动记忆，保存在 `user.json`，尚未完全绑定到单一角色和单一会话。

## RPG 世界卡模式

RPG 不再把普通角色卡当作世界入口。流程是：

```text
选择世界卡
  → 创建独立 WorldSave
  → 待开局规划
  → 配置玩家角色与建角数据
  → 配置本局规则
  → 规划 Opening Scenario
  → 确认并初始化 Save State
  → 正式 RPG 回合
```

开局配置由世界卡 Schema 驱动，可包括：

- 玩家身份、出身、地区、势力、职业、性格和经历；
- 基础属性、技能、资源、特质、缺陷、初始装备；
- 属性点预算、最低/最高值、预设与自由模式；
- 世界书、RPG Preset、难度、时间、战斗/死亡规则；
- 开场时间、地点、NPC、事件、前置事实、知识权限和 Initial Hook。

### 可信回合内核

AI 输出的结构化控制块是：

```text
<tavern_state_update>{...}</tavern_state_update>
```

服务端会校验 `protocol`、`version`、`baseRevision`、typed updates、行动选项、地点 ID、玩家状态和存档 revision，再执行原子提交。旧版 `rpg` 控制块只作为兼容输入，不绕过新校验。

支持的状态更新包括资源、属性、技能、货币、背包、地点、效果和目标状态。正式回合还会推进世界时间、结算世界事件、派系行动、截止时间、冲突、失败、结局和成长记录。

### 客户端骰子

骰子由客户端生成，服务端只验证结果：

```text
客户端随机 → actionIntent.dice → 服务端校验 → 规则结算
```

AI 或叙事文本不能直接产生权威骰子结果。缺少客户端结果时，服务端会拒绝本回合，而不是偷偷重新随机。`POST /api/dice` 仅保留为兼容/诊断接口。

### Agent Runtime

RPG 支持声明式 OpenAI-compatible tools：

- `dice.roll`：仅在同一回合先通过 `rules.check` 后由客户端执行，并绑定本回合结果；
- `context.retrieve`：当前世界存档范围内的只读检索；
- `state.patch`、`entity.create`、`memory.record`：候选操作；
- `rules.check`：本回合判定门控，不改写存档；没有真实不确定性时禁止继续掷骰。

Agent 回合采用 `agent-execute → narrate` 两阶段提交。正式状态仍由 WorldSave 服务端校验，Agent 不能直接改写存档。

## RPG 记忆与上下文

RPG 记忆不是一段模糊的 AI 摘要，而是几层结构化事实：

- `turns[]`：当前存档的短期回合历史；
- `eventMemory[]`：长期事件记忆，最多 512 条；
- `eventLedger[]`：服务端维护的事实来源索引；
- `state.knownInformation`：World Truth、Character Knowledge、Player-visible、Hidden、Rumor；
- `npcStates.knowledge`：每个 NPC 的已知事实。

长期记忆由 AI 提交候选，服务端在正式回合后补充来源 revision、回合、事件、地点和时间，并按 `public / local / hidden` 控制注入。当前地点不匹配的 local 记忆和 hidden 记忆不会直接注入玩家上下文。

记忆诊断窗口支持查看来源统计和从正式世界事件、成长事实、账本重建 `eventMemory`。重建不读取原始叙事，也不改变正式世界 revision。

## 地图状态

地图生成与渲染代码仍保留在 `public/mapgen.js`，但当前地图 UI 和运行时随机生成已隐藏。新存档只读取世界卡明确提供的 `map.data` / `map.imagePath`；没有地图时保持空状态。这样地图属于世界卡，不会在不同存档之间随机漂移或串联。

## AI 调试终端

对话顶栏的「⌘ 终端」打开独立调试窗口，分区查看：

- INPUT：发送给 AI 的完整请求；
- OUTPUT：正则处理前的完整原文、结构化标签摘录和 `reasoning_content`；
- Prompt：本次请求的 Prompt 分区与字符预算；
- MEMORY：当前 RPG 存档的记忆诊断与重建入口。

调试记录只保存在当前页面内存，不写入角色、会话或 RPG 存档。

### RPG 开发者实验台

启动页面时追加 `?dev=1`，顶栏会显示「🧪 开发者」。选择一个外置测试场景后直接点击「运行所选测试」即可；场景内部自动填充 `rules.check → dice.roll → tool 回传`、Typed Patch、实体候选和事件记忆，不需要填写 JSON。测试反馈会写入本次 RPG 叙事，选项会恢复为叙事栏下方的快捷按钮。没有完成开局规划的存档不会允许提交。它直接复用正式 `/api/world-saves/:id` 回合协议，不会创建第二套状态路径。

## 项目结构

```text
server.js                     Node 静态服务、AI/图片代理、世界与存档 API
public/index.html             双模式页面与弹窗
public/styles.css             macOS 深色主题与响应式布局
public/app.js                 前端状态、会话、Prompt、解析和 UI
public/mapgen.js               地图生成兼容代码（当前隐藏）
public/data/_defaults.json    默认配置、预设、世界卡与输出协议
public/data/*.json             本地运行时数据（含 API Key，不入库）
public/data/saves/*.json       WorldSave（不入库）
public/vendor/                 marked、DOMPurify、mapgen2 本地依赖
android/                       NanoHTTPD + WebView Android 套壳
scripts/                       回归检查、打包与图标脚本
docs/                          数据结构、世界卡与 Android 文档
```

## 当前状态

### 已完成

- 酒馆 / RPG 双模式与会话隔离；
- 角色卡、提示词预设、世界书、世界卡和 WorldSave；
- Schema 驱动的 RPG 建角与开局规划；
- Typed Patch、revision/CAS、幂等回执和服务端状态校验；
- 客户端骰子与冲突/事件/成长/失败/结局结算；
- Agent 两阶段执行与工具候选协议；
- 分层 Prompt、知识权限、长期事件记忆和记忆诊断；
- 文生图、PWA、Android 套壳与本地调试终端；
- 世界卡草稿、版本发布、导入导出和旧 RPG 会话迁移。

### 当前限制

- 世界观与角色内容仍有占位，需要实际世界卡填充；
- 地图展示暂时关闭，地图生成调优暂缓；
- 酒馆手动记忆仍是用户级共享；
- RPG 记忆尚无向量检索、自动聚类和完整人工编辑器；
- Agent 兼容模式不会在模型回复后补掷骰；需要把结果回传给模型时使用原生 Agent 工具模式；
- 队伍管理和部分作者工作台仍需完善；
- 服务端默认无鉴权和 SSRF 防护，只适合本地开发/演示；
- Android 需要在真实设备上继续验收。

详细数据结构见 [docs/data-structure.md](docs/data-structure.md)，产品路线见 [docs/rpg-card-product-roadmap.md](docs/rpg-card-product-roadmap.md)。

## 安全提醒

不要把此开发服务器直接暴露到公网。API Key 只应保存在本地运行时数据中；`public/data/*.json`、存档和图片目录已加入 `.gitignore`。
