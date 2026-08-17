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

### Windows 便携版

GitHub Release 提供 `tavern-*-portable-win-x64.zip`。解压后双击「启动 Tavern.bat」即可运行，包内已包含 Node.js，不需要另行安装 Node.js、npm 或配置环境变量。运行时数据保存在同目录的 `data/`，不会把本机 API Key 和存档打进发布包。

## 本次更新 · 2026-08-17

- RPG 世界卡支持自定义 HTML/CSS/JS 前端、沉浸模式、入口警告、声明式 runtime 变量/集合/动作和 Agent 选择桥接；新增“电子病娇 · 由依协议”测试世界卡。
- Agent 回合统一接入规则检查、客户端骰子、工具 Guard trace、两阶段提交、pending 恢复和结构化回执。
- 酒馆模式补齐 Character Card V3 / PNG 元数据、角色书绑定、卡片级输出正则、HTML/Markdown 安全渲染和 `{{user}}` 显示宏。
- RP / RPG 回复选项改为预设协议驱动，选项不再写死在前端；编辑消息时输入框按聊天区域自适应并支持拖高。
- Android 套壳补齐 `user.json` 与数组/对象 JSON 原子持久化校验；推送后由 GitHub Actions 构建 APK。
- 发布 Windows x64 便携文件夹包，内置 Node.js，解压即可启动。

详细变更与验证命令见 [CHANGELOG.md](CHANGELOG.md)。

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
  ├─ sessions.json         酒馆会话库（含删除墓碑，首次保存时创建）
  └─ worlds.json            世界卡目录

saves/<saveId>.json        RPG WorldSave，服务端按存档独立读写
world-deleted.json         已删除世界卡 ID（防止默认模板重新出现）
```

`localStorage` 只保存离线缓存和当前 ID，服务端 JSON 是权威源。酒馆会话同样走服务端：启动时与服务端 `sessions.json` 按 ID 取并集合并（冲突保留更新时间新者），删除的会话以墓碑记录，不会在其他浏览器复活，因此更换浏览器聊天记录不丢失。`WorldCard@worldVersion` 保存稳定世界资料；`WorldSave@revision` 保存本局玩家、状态、事件、回合和记忆。世界卡或角色卡后续编辑不会静默覆盖已有存档。

世界库中的存档可单独删除；删除世界卡前必须先删除该世界的全部存档，确认后会移除所有已发布版本和未发布草稿。默认世界通过 `world-deleted.json` 记录删除标记，刷新后不会被 `_defaults.json` 自动补回。

## 酒馆模式

酒馆模式围绕“角色卡 + 对话会话”工作：

- 角色卡创建、编辑、删除，以及 Character Card V1/V2/V3 JSON 导入导出；支持读取 PNG 内嵌的 `ccv3` / `chara` 元数据，V3 的角色书与扩展字段按角色卡绑定保存；
- 三步 AI 写卡：一句话定角色 → JSON Schema 动态填表 → 生成完整结构化角色卡；
- 动态角色字段、可自定义栏目和运行时保存，不把世界观字段写死在前端；
- SillyTavern 风格提示词预设：System、历史前/后指令、In-Chat、Relative、宏、排序和导入导出；
- 独立「后预设 / Post-History」栏目：预设组装完成后追加高优先级指令；RP 基础示例已内置 AI 回复选项协议，其他预设仍按全局配置自动追加；
- 独立「正则」设置：RP / RPG 分模式保存自定义输出正则，并自动识别预设携带的 `extensions.regex_scripts`；
- 多本世界书：触发词、正则、常驻、扫描深度、整词匹配和角色绑定；
- 玩家设定、手动记忆、消息编辑/删除/复制/重生成；
- 可选旁白/对白拆分：默认整条回复作为连续正文，按需在「设置 → 格式」开启对白气泡；
- AI 回复选项：RP 与 RPG 都由模型生成结构化快捷行动，点击后直接发送；RP 缺少标签时最多自动修复一次；选项标签不会进入正文，也不再使用写死的快捷按钮；
- 「设置 → 排版」热调整聊天正文：字体、字号、行间距、段间距、段首缩进（空两格）与左右间距，拖动即时预览、自动保存；
- AI 消息完整 GFM Markdown 渲染与安全清洗：标题、列表/任务列表、表格、引用、代码块、行内代码、链接、图片、删除线、键盘标记和分隔线；
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

不支持原生 function calling 的模型可使用兼容 Agent 模式：模型在唯一状态块的 `toolCalls` 中声明工具，客户端执行受控工具后以 `tavern.rpg.agent.tool_result` 回传，并在 `maxSteps` 内继续请求模型；原生与兼容模式共用工具白名单、客户端骰子和存档提交链。

Agent 模式、最大步骤数和工具开关可在世界卡编辑器中按卡配置；留空时继承 RPG 预设 / 全局默认。

世界卡还可以通过声明式 `ui.sidebar.panels[]` 增加关系、事件、资源等侧栏投影；数据源使用白名单路径，动态内容始终读取当前存档。
RPG GEN 3 增加受限 `runtime` DSL：世界卡可声明变量、集合（例如商城）和动作；创建存档时快照到 `state.runtime`，AI 只能通过 Typed Patch 的 `runtime.*` 更新，侧栏可读取 `runtime.variables.<id>` / `runtime.collections.<id>`。
GEN 3.1 支持世界卡 `ui.extension`：HTML/CSS/JS 在 `sandbox="allow-scripts"` 的隔离 iframe 中运行，CSP 禁止网络、表单、嵌套 frame 和主页面访问；通过 `TavernExtension.requestContext()`、`patch()`、`action()`、`choose()` 和 `mvu()` 走白名单消息协议。`TavernExtension.on/off()` 可监听 `turn.start`、`agent.execute`、`agent.complete`、`turn.commit`、`turn.error` 脱敏事件，让卡内 HUD 跟随 Agent 生命周期变化，但不会收到隐藏状态或工具结果。`choose(text, { actionId, input, updates })` 会把扩展按钮当作普通 RPG 玩家行动送入现有 Agent 回合（需要 `read.save`）；有 `actionId/updates` 时仍需 `write.runtime`，纯文本选择不需要额外运行时权限。`context.turn.options` 与底部快捷回复读取同一份结构化选项，`context.turn.narrative/hasResponse` 提供最新 AI 正文，`context.messages` 提供当前存档最近 40 条用户 / AI 消息。卡内 HTML 可用 `data-tavern-narrative`（最新叙事）、`data-tavern-messages`（消息历史）、`data-tavern-options`（AI 选项）、`data-tavern-bind` / `data-tavern-show`（白名单状态绑定）和 `data-tavern-input` / `data-tavern-submit`（自定义输入）接入；按钮和表单提交会复用当前 Agent 回合，卡可以自行决定结构与 CSS。沉浸扩展没有这些标记时不会被框架偷偷补第二个叙事框或输入框。扩展桥为长思维链和 Agent 工具循环保留 120 秒等待时间。只要世界卡存在扩展，默认独立接管页面；扩展设置 `immersive:false` 才嵌回宿主 RPG 布局（草稿页有对应勾选项），`ui.layout: "immersive"` 仍可作为显式标记。沉浸布局会隐藏主应用侧栏、顶栏、RPG 状态栏和底部输入框，只保留世界卡自己的前端与退出按钮。世界草稿页提供扩展字段可视化编辑器，也保留高级 JSON 入口；点击“从高级 JSON 载入扩展”后再保存即可合并两种视图。写入统一提交 `/api/world-saves/:id/runtime`，前后端都强制检查 `write.runtime`，仍受存档 revision、runtime Schema 和 Typed Patch 校验，不执行主页面脚本。Agent 两阶段回合的 pending 还会保存受限的待叙事消息和选项，页面刷新后可继续提交或放弃，正式状态仍只在 narrate 阶段写入。
世界卡还可以声明 `ui.entryGate`，在“建立新存档”真正创建前显示卡片自定义的内容警告；取消会回到世界库，确认后才进入玩家建角。`fullscreen: true` 会在确认点击的用户手势内请求浏览器全屏，权限被浏览器拒绝时自动降级为普通沉浸布局。默认种子新增 `world-electronic-yandere`「电子病娇 · 由依协议」，用于验收入口门禁、隔离前端、runtime action 和 Agent 回合：扩展会提出“你爱我吗？”，选择“不爱”后把可见选项锁成“爱”并弹出二次询问。
Agent 回合还会保存受限的工具 Guard trace，并在 receipt 中记录每个工具的通过 / 拒绝结果；服务端会校验工具阶段顺序（`observe → decide → guard`），成功的 `dice.roll` 必须先有同回合通过的 `rules.check`。trace 只用于诊断，不能绕过服务端 Typed Patch、规则和 CAS 校验。
Agent 执行摘要还会绑定候选 `agentCalls` 与 trace 的 `callId/name`，并保存候选、观察、通过、拒绝计数；只读 `context.retrieve` 不进入状态候选。
多步骤行动可把 `objective.upsert` 作为可忽略的计划步骤；计划会随 orchestration 摘要进入 pending/receipt，不会自动变成强制主线。
工具 trace 同时标注 `observe / decide / guard`，两阶段提交标注 `execute / narrate`；待叙事 pending 还会保存 `phase/phaseHistory`，刷新后可显示并恢复当前阶段，便于在终端追踪 Agent 回合阶段。
世界卡也可绑定自己的 `regexes[]`，在该世界的 RPG 预设和模式自定义规则之前执行；正则仅做输出替换，不执行脚本。

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
GEN 3 服务端闭环可用 `node scripts/check_rpg_gen3.js` 快速验收；扩展沙箱和 runtime action 可用 `node scripts/check_rpg_extension.js` 验收；电子病娇世界卡可用 `node scripts/check_world_electronic_yandere.js` 验收。

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

### 本版本可直接验收的闭环

```text
世界卡 / 世界书 / RPG 预设
  → 开局规划与角色建角
  → WorldSave 初始化
  → Agent 工具回合（规则检查 / 客户端骰子 / 状态候选）
  → 服务端校验与两阶段提交
  → 叙事、选项、侧栏和记忆同步
```

本版本重点补齐了 RPG 的可玩基础设施：世界卡可以携带自己的规则、正则、侧栏投影、GEN 3 runtime 变量/集合/动作和受限 UI 扩展；Agent 的工具阶段、候选绑定、计划摘要、pending 恢复和回执诊断均进入同一套存档协议。酒馆与 RPG 仍使用各自的角色/世界/会话/存档边界，删除和刷新不会把数据重新串回默认模板。

### 当前限制

- 世界观与角色内容仍有占位，需要实际世界卡填充；
- 地图展示暂时关闭，地图生成调优暂缓；
- 酒馆手动记忆仍是用户级共享；
- RPG 记忆尚无向量检索、自动聚类和完整人工编辑器；
- Agent 兼容模式不会在模型回复后补掷骰；需要把结果回传给模型时使用原生 Agent 工具模式；
- 队伍管理和部分作者工作台仍需完善；
- 服务端默认无鉴权和 SSRF 防护，只适合本地开发/演示；
- 扩展事件是只读前端通知，不是服务端 Hook；EJS、角色卡/预设脚本和任意主页面 JS 仍不会执行，需通过 sandbox Bridge、runtime Schema 或 Agent 工具表达行为；
- Android 需要在真实设备上继续验收。

### 未来规划（未完成内容）

按优先级排列，以下内容目前只保留扩展点，不应视为已经实现：

1. **内容与开局**：补充可玩的示例世界卡、角色模板和开局方案；增加队伍/多玩家角色管理与更轻量的预设式建档。
2. **叙事与记忆**：完善 RPG 记忆人工编辑、自动聚类/向量检索、NPC 独立知识和跨事件回溯；继续收紧“世界真相 / 玩家已知 / 谣言”的注入边界。
3. **Agent 与规则**：增加更多可配置工具（任务、商店、制作、战斗等）的 schema 校验、失败重试和可视化 trace；原生 function calling 与兼容模式继续保持同一协议。
4. **世界卡工作台**：把侧栏、runtime、扩展和正则做成更完整的可视化编辑器，并提供版本差异、回滚和迁移提示。
5. **地图与表现**：重新设计固定地图的展示与地点导航；随机地图仍关闭，直到世界卡数据、区域绑定和存档隔离都能稳定验收。
6. **安全与发布**：补充本地鉴权、SSRF/资源白名单、扩展沙箱审计和错误脱敏；完成 Android 真机回归后再恢复 APK Action 发布。

这些规划不会改变当前的核心约束：数据由 WorldCard / Preset / WorldSave 分层拥有，AI 只能提交候选，服务端才是状态权威源。

详细数据结构见 [docs/data-structure.md](docs/data-structure.md)，产品路线见 [docs/rpg-card-product-roadmap.md](docs/rpg-card-product-roadmap.md)。

## 安全提醒

不要把此开发服务器直接暴露到公网。API Key 只应保存在本地运行时数据中；`public/data/*.json`、存档和图片目录已加入 `.gitignore`。
