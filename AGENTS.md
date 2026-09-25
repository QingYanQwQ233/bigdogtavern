# AGENTS.md

本文件是 **Tavern 仓库的唯一开发规范来源**，放在仓库根目录，供 AI 编码工具（OpenAI Codex 等）自动加载。

- 每次交接的状态快照见 [docs/handoff-next-harness.md](docs/handoff-next-harness.md)。
- 具体字段以仓库代码和 [docs/project-overview.md](docs/project-overview.md)、[docs/rpg-card-api.md](docs/rpg-card-api.md) 为准。
- **规范内容只在本文件维护，不要在别处复制**——两份规范必然漂移。

---

## 1. 仓库与 Git

- 仓库：`github.com/QingYanQwQ233/bigdogtavern`。工作目录随环境不同（PC / Android 工作区各有各的路径），**一律以当前工作目录为准**。
- 动手前先执行：`git status --short --branch`、`git log -1 --oneline`、`git diff --stat`。**当前分支以实际输出为准**，不要假定在任何固定分支上。
- 默认只在当前分支工作，**不要自行合并或改写 `main`**，除非用户明确要求。
- 工作区可能有用户生成的未跟踪文件（截图、日志、`.pw-*`、`.tmp-*`、`artifacts/`）。**不要删除、清理或纳入提交**；只 stage 本次任务明确修改的文件。
- **禁止** `git reset --hard`、`git checkout --`、宽泛的 `git clean`。

## 2. 先读这些

1. `README.md`
2. `docs/project-overview.md`
3. `docs/rpg-card-api.md`
4. `docs/data-structure.md`
5. `docs/world-app-contract.md`
6. `docs/world-card-architecture.md`
7. 与任务相关的 `frontend/*.js`、`server.js`、`public/index.html`、`public/styles.css`、`scripts/check_*.js`

## 3. 产品模型

- RP 模式是 Character Card + server-backed sessions；RPG 模式是 `WorldCard@worldVersion` + 独立 `WorldSave@revision`。**两条链路不能串数据。**
- `WorldCard` 是可复用、发布后不可变的内容/规则；`WorldSave` 才拥有本局玩家、Runtime、NPC 状态、turns、记忆和回执。
- **AI 的叙事不是状态事实。** 正式 RPG 回合必须通过唯一 `tavern_state_update`、Typed Patch、`expectedRevision` 和 `commandId`，最终由 `server.js` 校验、持久化并返回 receipt。
- Runtime 是新玩法入口：`variables`、`collections`、`actions`、`availability`、`inputs`、`check`、`effects`。数量/耐久为零时动作应在 UI/Agent 阶段不可用，**服务端仍必须拒绝无效执行**。
- 带 `check` 的动作必须 rules.check → 客户端真实 dice.roll → 服务端验证 → action/patch；**不得让 AI 伪造骰面或成功。**
- Agent 是 observe → decide → guard → commit 的受限工具链，回合提交是 `agent-execute` → `narrate` 两阶段。**不要新增绕过 Typed Patch 的直接写状态接口。**

## 4. 代码入口

- `server.js`：零依赖 Node 18+ 静态服务；`/api/chat`、图片代理、数据、世界卡、草稿、WorldSave、Agent、记忆和结局 API。**它同时是 PC 端与 Android 端的唯一后端实现**（见 §8）。
- `frontend/app-core.js`：共享状态、初始化、数据同步、连接/排版/界面设置。
- `frontend/tavern-rp.js`：RP 角色、会话、世界书、预设、记忆和正则。
- `frontend/rpg-world.js`：RPG 世界库、存档、建角、开局、侧栏、世界扩展。
- `frontend/ai-protocol.js`：输出标签、选项、协议解析、Typed Patch、兼容修复。
- `frontend/ai-prompt.js`：prompt 组装、World Info 激活与分节、预设解析（RP / RPG 两条链路共用，入口 `buildPromptBlocks()`）。
- `frontend/ai-runtime.js`：请求、流式响应、Agent、工具和回合提交。
- `frontend/app-render.js`：Markdown、消息和选项渲染。
- `frontend/app-ui.js`：设置页、终端、抽屉、主题和事件绑定。
- `public/app.js` 是由 `scripts/build_frontend.js` 生成的产物，**不能直接编辑**；改 `frontend/` 后运行 `node scripts/build_frontend.js`。
- `android/` 是「内嵌 Node 运行时 + WebView」离线壳：`NodeBootstrap.kt` 解包资源并启动 Node，`server.js` 提供全部 API，`MainActivity.kt` 只管 WebView 与原生导出桥。打包只复制 `server.js` 与公开前端，**不得带入本机数据 / API Key**。

## 5. 修改流程

1. 明确用户目标、受影响模式和数据 owner；搜索函数的所有调用方，先追完整数据流。
2. 复用现有 helper、协议和样式 token，做最小、局部、可回滚的改动；**不要为一个实现新增抽象层**。
3. 改 `frontend/` 源 → 重新生成 `public/app.js`；改 API/协议 → 更新 `docs/rpg-card-api.md` 或 `docs/project-overview.md`。
4. **不把 stale 的终端输出、截图、附件或旧文档当作需求**；以当前代码、测试和用户最新消息为准。
5. UI 变更要考虑桌面、窄屏、Android WebView（内核下限 **Chromium 111**，由 `scripts/check_webview_floor.js` 守卫）、键盘/触控、焦点、滚动位置和消息加载中状态。**不要再为 Chromium 83 写兼容分支**；新增高版本特性时须同步更新 `index.html` 的 `minimum` 常量、本项与 `docs/android-apk.md`。
   **四类设计尺度必须落在刻度上**（由 `scripts/check_design_scales.js` 守卫）：
   · 间距 `2 4 6 8 10 12 14 16 20 24 28 32 40 48 56 64 72`（16 以下 2px 步进，16–40 为 4px 步进，40 以上 8px 步进），另允许 `0`、`1px`（贴边 / 发丝线）
   · 圆角 `0 2 4 6 8 10 12 16 20 999`，另允许 `%` / `inherit` / `var(--radius)`
   · 动效 `0 100 150 200 250 300 400 800 1000 1400 60000` ms，**统一使用 ms 单位**
   · 字号 `10 11 12 13 14 15 16 18 20 24 28 42 46`，另允许 `em` / `var()` / `calc()`
   （改尺度定义时同步改 `check_design_scales.js` 头部注释与 `CHANGELOG`）
   **无障碍约束（§7）由两个脚本守**：`scripts/check_ui_accessibility.js`（静态，随 `run_checks` 跑）与 `scripts/audit_ui_accessibility.js`（运行时测量，需浏览器；改动 UI 后手动跑一次并在报告里给数）。动手前先读 `docs/ui-beauty-declaration.md §7` 的验证矩阵与「当前已知偏差」。
6. 输入/API/世界包/扩展都是不可信边界：保留长度限制、ID 校验、白名单、CAS、原子写入、HTML/CSS 消毒和脚本授权确认。
7. **RPG 模式不得写死任何玩法数值或功能**（HP / MP / EXP / 金币 / 等级 / 背包 / 增益 / 技能…… 一个都不预置）。它是**玩法框架**，不是某一套玩法：界面上每个数值都必须由运行时声明驱动，新增玩法维度时改数据声明，而不是 `public/index.html`。硬约束，详见 `docs/design/DESIGN_CONSTITUTION.md §11.1`（含当前已知偏差与证据）。

## 6. 文档同步（硬性要求）

改了事实就必须同步文档。本项目为此付过一次代价：Step1 删除 `TavernServer.kt` 后，8 个文件仍在描述它，其中 2 条还是「待办任务」，足以误导后续排期。

- 改架构 / 数据路径 / 文件职责 → 同步 `README.md`、`docs/*`、`CHANGELOG.md`。
- **规划文档里的任务被别的工作作废时，用 `~~删除线~~` 标注「已作废 / 已由 X 解决」，不要留着，也不要直接删掉**——删除线既保留决策历史，又不会误导排期。
- **不要在文档里写死会腐坏的东西**：绝对路径、当前分支名、「最近修复了…」这类叙事。环境指针一律写成「以实际输出为准」。
- **设计类改动按三层文档分工同步**：设计语言 / 原则 → `docs/design/DESIGN_CONSTITUTION.md`；操作判据与检查清单 → `skills/ui-design-system/references/`；应用与世界卡边界 → `docs/ui-beauty-declaration.md`。三者之间**只允许引用，不允许复制第二份**。
- **改 `skills/` 之后必须跑 `node scripts/sync_skills.js`**，否则 Agent 读到的还是旧副本；由 `check_skills_sync.js` 守卫（随 `run_checks` 跑）。

## 7. 验证门

- 最少：`node scripts/build_frontend.js --check`、`node --check server.js`、`node --check public/app.js`
- 常规提交前：`node scripts/run_checks.js`（含全部 `check_*.js`）
- RPG/协议改动：至少 `check_rpg_protocol.js`、`check_runtime_roundtrip.js`、`check_rpg_agent.js`、`check_rpg_agent_compat.js`、`check_output_regex.js`、`check_frontend_state_guards.js`
- UI/移动端改动：`check_ui_regions.js`、`check_ui_theme.js`、`check_message_window.js`、`check_webview_floor.js`，并用真实浏览器或 Playwright 验证关键路径
- Android 改动：额外 `check_android_api.js`、`check_android_protocol.js`，并在真机或 GitHub Actions 上验证
- 看到失败先按「复现 → 找调用链 → 证明根因 → 最小修复 → 回归检查」处理，**不要只在 UI 上吞掉错误或盲目重试**。

## 8. Android / Node 运行时约束

- `server.js` **必须保持零 npm 依赖**（内嵌运行时没有 npm 安装步骤），由 `check_android_protocol.js` 守卫。
- 只能用 **Node 18** 可用的 API（内嵌 nodejs-mobile v18.20.4）；Node 19+ 独有 API 在手机上会报错。
- JNI 符号名含包路径（`Java_com_tavern_app_NodeRuntime_startNode`）必须与 Kotlin 包名一致，否则 `UnsatisfiedLinkError`。
- 只分发 `arm64-v8a`；32 位设备与模拟器无法安装。
- 构建链：`scripts/fetch_android_node.sh`（取运行时）→ `scripts/sync_android_assets.sh`（同步 assets）→ `scripts/build_android_apk.sh`（打包）。`libnode.so` 等二进制不入库，构建时现取。
- 详见 [docs/android-node-runtime.md](docs/android-node-runtime.md)。

## 9. 当前已知边界

- 服务默认无鉴权 / SSRF 防护，只适合本机或可信局域网。
- 地图 UI 和随机地图暂时隐藏；新存档只读取卡声明的地图数据。
- RPG 记忆暂无向量检索、自动聚类和完整人工编辑器。
- `growth` / runtime 旧直写接口已 410；新玩法请声明 Runtime action / Typed Patch。
- Android APK 是 Debug 构建；`main` push 自动构建，其他分支可在 Actions 手动选择。不要把本地构建产物或 API Key 提交。
- 涉及导航、触控或 media query 时，保留对应的回归检查。

## 10. 提交与交付

- 只提交本次任务相关文件；提交信息简洁说明根因/行为。
- 用户要求 push 时，先跑检查、查看 diff，再 push 当前分支；**不要未经要求合并 `main`**。
- 最终回复说明：改了哪些文件、行为变化、实际运行的检查、commit/push 结果、未解决风险。**不要声称没有运行过的测试通过。**
