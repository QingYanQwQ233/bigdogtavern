# Tavern 项目总览

这份文档是项目的入口说明，面向使用者、世界卡作者、前端/后端开发者和维护项目的自动化 Harness。它描述当前仓库已经实现的能力、数据边界、接口入口、开发命令和已知限制；字段级契约以 [RPG 世界卡、运行时与 HTTP 接口参考](rpg-card-api.md) 为准。

## 1. 项目是什么

Tavern 是一个本地运行的 AI 角色扮演 Web 应用。它把两种体验放在同一个界面中，但使用两套互相隔离的数据链路：

| 模式 | 核心对象 | 适合场景 | 权威状态 |
| --- | --- | --- | --- |
| RP / 酒馆 | 角色卡 + 对话会话 | 连续角色扮演、角色卡、世界书和提示词预设 | 服务端 `sessions.json`，浏览器缓存只作离线副本 |
| RPG / 世界卡 | WorldCard + WorldSave | 有地点、角色创建、规则、资源、动作和世界线的可玩 RPG | 服务端 WorldSave，按 `saveId` 与 `revision` 原子推进 |

项目的核心不变量是：可复用定义与游玩事实分离；每个角色、会话和世界存档按所有权隔离；AI 只能提交受约束的候选更新，服务端校验后才写入正式状态。

## 2. 功能地图

### 2.1 RP / 酒馆模式

- Character Card V1/V2/V3 JSON 导入、导出、PNG 元数据读取和角色绑定世界书。
- 角色创建、编辑、删除、动态自定义字段和 AI 辅助三步制卡。
- SillyTavern 风格提示词预设：固定可编辑提示词、运行时 Marker、世界书位置、Post-History、In-Chat、Relative、宏、Prompt Order、生成参数和导入导出。
- 多本世界书：关键词、secondary 条件、常驻、概率、分组、递归、Sticky/Cooldown/Delay、正则、Outlet 和角色绑定。
- 会话消息编辑、删除、复制、重生成、手动记忆和可选自动摘要；尚未配对 AI 回复的当前玩家回合始终保留在本次请求末尾。
- 每个酒馆/通用提示词预设可独立开启或关闭回复选项、设置 1–8 个选项并自定义提示词；未声明时继承项目默认，旧 `postHistory` 尾部协议自动迁移，ST 导入/导出通过 `tavern_meta.replyOptions` 往返保留。
- 输出正则按模式、预设和阶段隔离，可作用于输入、原始 AI 输出、显示、Prompt、世界书和思维链；规则只替换文本，不执行脚本。
- GFM Markdown 安全渲染；经用户明确确认的角色卡 HTML/CSS/JS 才进入同源兼容 iframe。未确认的卡片脚本不执行。
- 可选对白气泡、消息操作、图片消息和 OpenAI/Stable Diffusion 兼容文生图。

### 2.2 RPG / 世界卡模式

RPG 流程为：

```text
选择 WorldCard → 创建 WorldSave → planning 开局配置
→ Schema 驱动建角 → 配置本局 → Opening 候选与确认
→ active 世界线 → AI/Agent 回合 → 记忆、选项和侧栏同步
```

当前正式能力包括：

- 世界卡发布版本、草稿、导入导出和旧 RPG 会话迁移。
- 多个互不串数据的 WorldSave；每个存档固定 `worldVersion`，动态事实以 `revision` 推进。
- Schema 驱动的玩家字段、属性、技能、资源、特质、点数预算、出身预设和本局配置。
- 地点、NPC、时间、开场计划、知识边界、失败模式、提前结束和世界线重开。
- 声明式 Runtime：变量、集合、动作、可用条件、输入绑定、资源/耐久扣除和客户端骰子判定。
- RPG Agent：`observe → decide → guard → commit` 工具轨迹，以及 `agent-execute → narrate` 两阶段提交。
- `rules.check`、客户端 `dice.roll`、`runtime.action.execute`、`state.patch`、`memory.record` 和受限 `context.retrieve`。
- 唯一 `<tavern_state_update>` 控制块、Typed Patch、CAS/revision、commandId 幂等回执和零库存禁用。
- 长期事件记忆、事件账本、世界真相/角色知识/玩家可见/隐藏/谣言分层，以及记忆和总结诊断/重建。
- 默认侧栏自动展示可见 Runtime；声明 `ui.sidebar` 后由世界卡完全接管。
- 世界卡自定义主题、区域、侧栏、HTML/CSS/JS 扩展、setup/play surfaces、入口警告、沉浸全屏和 Bridge。

### 2.3 共享界面与运行环境

- RP 与 RPG 共用连接设置、模型列表、流式输出、停止生成、全屏输入、排版和界面主题。
- 「设置 → 界面」可选择本机聊天背景，支持开关、遮罩、铺满 / 完整显示和对齐位置；图片与参数在桌面 / Android 本机持久保存，普通聊天区共用。
- AI 调试终端保留当前页面的请求历史、完整 INPUT/OUTPUT、正则前原文、结构化标签、Prompt 分区、Agent trace 和 RPG 记忆诊断。
- PWA 离线资源、Android 内嵌 NanoHTTPD 服务和 Android System WebView/Chromium 83 起的兼容补丁。
- 手机端左右工具抽屉、消息窗口位置保持、轻量回合状态增减动画和响应式布局。

酒馆请求会先把消息拆成“已完成的旧上下文”和“尚未收到 AI 回复的当前玩家回合”。`chatHistory` 开关与历史条数只裁剪旧上下文；自动摘要只覆盖完整的用户/AI 回合；骰点等 `meta` 记录附在当前玩家内容之后。当前玩家内容在 Chat History 边界只注入一次，因此关闭历史、极小历史窗口、摘要滚动或请求失败后连续输入都不会静默丢失；预设明确放在历史之后的 Relative / In-Chat 条目仍按 Prompt Order 跟随。该结构不参与 RPG 的 WorldSave 回合提交。

RP 预设以 `prompts + promptOrder` 作为唯一提示词来源：顺序表直接生成模型消息，Post-History 是其中可见且可关闭的 `jailbreak` 项。旧的全局格式选择器、默认“对白输出协议”和 `tavernFormat` 隐式槽位已删除；v1/v2 数据只在迁移阶段读取。ST 导入的采样参数和 Utility Prompt 模板会随当前预设应用，但预设内的服务商/模型标识不会越权切换当前连接。

## 3. 架构与代码入口

```text
浏览器 / Android WebView
        │ 同源 HTTP
        ▼
server.js ── /api/chat、图片代理、数据/世界/存档 API
        │
        ├─ public/index.html       页面骨架与弹窗
        ├─ public/styles.css       主题、布局、响应式规则
        ├─ public/app.js           生成后的浏览器运行产物（不要直接编辑）
        ├─ public/mapgen.js        地图兼容代码（当前地图 UI 隐藏）
        └─ public/data/_defaults.json 默认模板

frontend/（编辑源）
  app-core.js      共享状态、初始化、数据同步、设置
  tavern-rp.js     RP 会话、角色、世界书、预设、记忆、正则
  rpg-world.js     WorldCard/WorldSave、建角、开局、世界 UI
  ai-protocol.js   输出标签、Typed Patch、RPG 协议和兼容解析
  ai-runtime.js    请求、流式响应、Agent 工具和回合提交
  app-render.js    Markdown、消息、选项和消息窗口渲染
  app-ui.js        设置表单、侧栏、主题、终端和事件绑定
```

`node scripts/build_frontend.js` 按固定顺序把 `frontend/*.js` 拼接为 `public/app.js`。修改前端时只改 `frontend/`，提交前必须运行生成/校验命令；APK、PWA 和浏览器都使用生成后的 `public/app.js`。

Android 目录是离线壳：`MainActivity.kt` 启动 WebView，`TavernServer.kt` 在本机 127.0.0.1:3000 提供前端和核心 API。GitHub Actions 会复制前端与 `_defaults.json`，不会把本地 `public/data/*.json`、API Key 或存档打进 APK。

## 4. 数据所有权与生命周期

```text
public/data/_defaults.json  → 首次运行模板
public/data/characters.json  → 角色库
public/data/presets.json     → 提示词预设
public/data/lorebooks.json   → 世界书
public/data/settings.json    → 连接/运行设置
public/data/user.json        → 玩家设定与酒馆手动记忆
public/data/gen.json         → AI 制卡字段与提示模板
public/data/sessions.json    → RP 会话与删除墓碑
public/data/worlds.json      → WorldCard 目录
public/data/saves/*.json     → RPG WorldSave（不入库）
public/data/world-deleted.json → 删除默认世界的墓碑
```

- `WorldCard@worldVersion` 是可复用、发布后不可变的规则和内容快照。
- `WorldDraft` 是未发布草稿；保存使用 `expectedUpdatedAt/baseVersion` 乐观锁。
- `WorldSave@revision` 是一条独立世界线；正式回合使用 `expectedRevision + commandId`，冲突返回 409。
- `localStorage` 只做缓存和当前 ID；服务端 JSON 是跨浏览器/重启后的权威源。
- 世界包只含可复用内容和资源清单，不含 API Key、用户设置、RP 会话或 WorldSave。
- 可变化的 Runtime、NPC 状态、记忆和回合都必须归属某个 `saveId`，不能通过全局 `mode` 或当前角色推断归属。

## 5. HTTP 接口速查

默认地址：`http://localhost:3000`。除下载和 AI 流式代理外，请求/响应为 UTF-8 JSON；常见错误为 `{ "error": "..." }`，并发冲突为 409。所有路径 ID 都经过安全 ID 校验。

完整请求字段、WorldCard Schema、Runtime DSL、Typed Patch 和 Agent 示例见 [rpg-card-api.md](rpg-card-api.md)。下表是 `server.js` 当前实际路由的导航：

### AI、图片与基础数据

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/chat` | OpenAI 兼容 Chat Completions 代理，支持 JSON/SSE、超时和请求头注入 |
| `GET` | `/api/models` | 按 `X-Base-Url`/`X-Api-Key` 获取模型列表 |
| `POST` | `/api/image` | OpenAI 兼容或 SD WebUI 文生图代理 |
| `POST` | `/api/image-save` | 保存 base64/URL 图片到本地，返回 `/images/<name>.png` |
| `POST` | `/api/dice` | 兼容/诊断骰子接口；正式 RPG 判定仍走客户端骰面与存档协议 |
| `GET` | `/api/data/seed` | 读取 `_defaults.json` 深拷贝 |
| `GET/PUT` | `/api/data/:type` | 读取或整份写入 characters、presets、lorebooks、settings、user、gen、sessions 等数据 |

### 世界卡、草稿和世界包

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/worlds` | 世界摘要列表 |
| `GET/DELETE` | `/api/worlds/:worldId` | 读取指定版本或删除世界（有存档时拒绝） |
| `GET` | `/api/worlds/:worldId/versions` | 读取发布版本列表 |
| `GET` | `/api/worlds/:worldId/export` | 导出世界包 |
| `POST` | `/api/worlds/:worldId/versions` | 将存档生成 NPC 收录到下一版本 |
| `GET/POST` | `/api/world-drafts` | 列出或创建空白/复制/编辑草稿 |
| `GET/PUT` | `/api/world-drafts/:worldId` | 读取/保存草稿 |
| `GET` | `/api/world-drafts/:worldId/check` | 只读发布检查报告 |
| `POST` | `/api/world-drafts/:worldId/publish` | 乐观锁发布新版本 |
| `POST` | `/api/world-imports` | 预览并封存世界包导入 |
| `GET/POST` | `/api/world-imports/:importId` | 查看预览或确认导入 |
| `POST` | `/api/rpg-migrations` | 预演旧 RPG 会话迁移 |
| `GET/POST` | `/api/rpg-migrations/:migrationId` | 查看或确认迁移 |

### WorldSave、回合与诊断

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET/POST` | `/api/world-saves` | 列出或创建 planning 存档 |
| `GET/PUT/POST/DELETE` | `/api/world-saves/:saveId` | 读取、旧快照写入、正式回合提交或删除 |
| `POST` | `/api/world-saves/:saveId/rename` | 重命名存档 |
| `POST` | `/api/world-saves/:saveId/copy` | 复制为独立世界线 |
| `GET` | `/api/world-saves/:saveId/export` | 导出单条存档 |
| `PATCH/PUT` | `/api/world-saves/:saveId/setup` | 保存 planning 草稿或提交建角/本局配置 |
| `POST` | `/api/world-saves/:saveId/opening-candidate` | 保存未激活的开场候选 |
| `POST` | `/api/world-saves/:saveId/opening` | 原子确认开场并进入 active |
| `POST` | `/api/world-saves/:saveId/reset` | 回到开局基线，清空回合和临时状态 |
| `GET/POST` | `/api/world-saves/:saveId/upgrade` | 版本升级预演/确认 |
| `POST` | `/api/world-saves/:saveId` | 唯一正式 Typed Patch 回合入口 |
| `POST` | `/api/world-saves/:saveId/agent-execute` | Agent execute 阶段，暂存已校验候选 |
| `POST` | `/api/world-saves/:saveId/agent-cancel` | 取消 pending Agent，不推进 revision |
| `GET` | `/api/world-saves/:saveId/memory` | 读取记忆诊断 |
| `POST` | `/api/world-saves/:saveId/memory/rebuild` | 重建事件记忆，不推进正式 revision |
| `GET` | `/api/world-saves/:saveId/summary` | 读取世界线总结 |
| `POST` | `/api/world-saves/:saveId/summary/rebuild` | 重建世界线总结，不推进正式 revision |
| `POST` | `/api/world-saves/:saveId/end` | 按世界卡规则提前结束世界线 |
| `POST` | `/api/world-saves/:saveId/reopen` | 从 ended/terminal failure 复制出可继续存档 |

以下入口已经移除，调用会返回 410：

- `POST /api/world-saves/:saveId/runtime`：扩展不能直接写 Runtime，必须提交玩家行动后由 AI/Typed Patch 更新。
- `POST /api/world-saves/:saveId/growth`：成长不再是宿主硬编码系统，应使用 Runtime 变量、集合和动作。

## 6. RPG 回合协议的关键规则

1. AI 正文可以叙事，但正式状态只能来自唯一 `<tavern_state_update>` 和服务端允许的 Typed Patch。
2. `patch.protocol` 必须是 `tavern.rpg.turn`，`version=1`，`baseRevision` 必须等于请求的 `expectedRevision`。
3. 顶层 `options` 与结构化块中的 `options` 必须完全一致；选项数量遵守 `turnContract.options`（0–4，默认 4）。
4. Runtime action 先检查 `availability`；数量/耐久为零时按钮禁用、Agent 收到不可用结果，服务端拒绝执行而不是落半个更新。
5. 带 `check` 的动作必须先 `rules.check`，再由客户端生成合法骰面，最后才允许执行 effects；AI 不能伪造骰子或成功。
6. 断网重试复用同一 `commandId`；遇到 409 先重新读取 WorldSave，丢弃旧 patch，再按新 revision 生成回合。
7. `eventMemory` 只能记录已经发生且与提交状态一致的短事实；不要把 reasoning/tool 草稿当作玩家可见事实。
8. 世界卡扩展在游玩态只能通过只读 Bridge、`choose()`、setup Bridge 或宿主界面操作；不能绕过服务端写状态。

## 7. 本地开发与发布

### 启动与构建

```bash
# Node.js 18+；运行时零 npm 依赖
node server.js

# 前端源分片 → public/app.js
node scripts/build_frontend.js

# 只校验生成物是否最新
node scripts/build_frontend.js --check
```

访问 <http://localhost:3000>，在「设置 → 连接」填写 OpenAI-compatible Base URL、Key 和模型。使用 `node server.js --api-only` 可启动只提供 API 的模式。

### 验证

```bash
node scripts/run_checks.js

# 常用局部检查
node --check server.js
node --check public/app.js
node scripts/check_rpg_protocol.js
node scripts/check_runtime_roundtrip.js
node scripts/check_frontend_state_guards.js
node scripts/check_webview83_compat.js
```

`run_checks.js` 会先校验源分片、所有核心/脚本语法，再顺序运行 `scripts/check_*.js`。前端变更、协议变更或移动端变更完成后至少运行完整入口，并用真实浏览器/Android 真机复核对应流程。

### APK

`.github/workflows/android-apk.yml` 在 `main` push 自动构建，也可在 Actions 手动选择任意分支。产物名为 `tavern-apk`，当前是可直接安装的 Debug APK。流程会使用 JDK 17、Gradle 8.7，复制前端资源并用 run number 更新资源版本，避免覆盖安装后命中旧 Service Worker。详细说明见 [android-apk.md](android-apk.md)。

## 8. 安全、兼容与当前限制

- 默认服务无鉴权和 SSRF 防护，只适合本机/可信局域网开发；不要直接暴露公网。
- API Key 只保存于本地运行时数据；不要提交 `public/data/*.json`、`data/saves`、图片或调试记录。
- 世界卡扩展使用隔离 sandbox Bridge；经用户确认的角色卡完整兼容 iframe 具有同源 DOM、localStorage、外部脚本/网络能力，只导入信任卡片。
- Android 端覆盖核心世界卡、存档、开局和 Agent 入口，但完整 Runtime/结局/重开仍需真机回归；最低目标为 WebView/Chromium 83。
- 地图生成代码仍保留，但当前地图 UI 与运行时随机生成关闭；新存档只读取世界卡明确提供的地图数据。
- RPG 记忆目前是结构化事件记忆和摘要，不包含向量检索、自动聚类或完整人工编辑器。
- 不要把旧的 events/factions/inventory/growth 等硬编码投影重新接回新回合；需要新玩法时在 WorldCard Runtime schema 中声明。

## 9. 文档导航

- [RPG 卡制作教程](rpg-card-tutorial.md)：从空白草稿、表单 Runtime 到可玩的完整世界卡。
- [RPG API 与 Runtime 参考](rpg-card-api.md)：字段、请求体、Typed Patch、Agent、UI Bridge。
- [数据结构与兼容历史](data-structure.md)：文件、所有权、Prompt 管线和迁移背景。
- [World App 契约](world-app-contract.md)：自定义 UI、扩展权限、生命周期和迁移边界。
- [世界卡架构](world-card-architecture.md)：WorldCard / WorldSave 设计与隔离原则。
- [世界测试实验台](world-test-lab.md)：开发者实验台和验收路径。
- [Android APK](android-apk.md)：GitHub Actions、离线壳和手机端限制。
- [下一 Harness 交接提示词](handoff-next-harness.md)：交给下一位自动化 Harness 的可复制工作说明。
