# 交付给下一 Harness 的项目接手提示词

下面的代码块可以直接复制给下一位 Harness。它把当前仓库的边界、检查命令、修改习惯和验收要求集中在一处；具体字段仍以仓库代码和 [项目总览](project-overview.md)、[RPG API 参考](rpg-card-api.md) 为准。

```text
你正在接手 Tavern（AI RP / RPG 本地 Web 应用）。请把仓库源码当作唯一事实来源，先读文档和代码，再开始改动。

【仓库与 Git】
- 工作区：A:\test-rpg-airp（如果路径不同，以当前工作目录为准）。
- 当前工作分支：codex/webview-83-compat；不要自行合并或改写 main，除非用户明确要求。
- 先执行：git status --short --branch、git log -1 --oneline、git diff --stat。
- 工作区可能有 .pw-*、.tmp-*、artifacts/、截图、日志等用户生成的未跟踪文件。不要删除、清理、reset 或纳入提交；只 stage 本次任务明确修改的文件。
- 不要使用 git reset --hard、git checkout -- 或宽泛的 git clean。

【先读这些】
1. README.md
2. docs/project-overview.md
3. docs/rpg-card-api.md
4. docs/data-structure.md
5. docs/world-app-contract.md
6. docs/world-card-architecture.md
7. 与任务相关的 frontend/*.js、server.js、public/index.html、public/styles.css 和 scripts/check_*.js

【产品模型】
- RP 模式是 Character Card + server-backed sessions；RPG 模式是 WorldCard@worldVersion + 独立 WorldSave@revision。两条链路不能串数据。
- WorldCard 是可复用、发布后不可变的内容/规则；WorldSave 才拥有本局玩家、Runtime、NPC 状态、turns、记忆和回执。
- AI 的叙事不是状态事实。正式 RPG 回合必须通过唯一 tavern_state_update、Typed Patch、expectedRevision 和 commandId，最终由 server.js 校验、持久化和返回 receipt。
- Runtime 是新玩法入口：variables、collections、actions、availability、inputs、check、effects。数量/耐久为零时动作应在 UI/Agent 阶段不可用，服务端仍必须拒绝无效执行。
- 带 check 的动作必须 rules.check → 客户端真实 dice.roll → 服务端验证 → action/patch；不得让 AI 伪造骰面或成功。
- Agent 是 observe → decide → guard → commit 的受限工具链，回合提交是 agent-execute → narrate 两阶段。不要新增绕过 Typed Patch 的直接写状态接口。

【代码入口】
- server.js：零依赖 Node 18+ 静态服务、/api/chat、图片代理、数据、世界卡、草稿、WorldSave、Agent、记忆和结局 API。
- frontend/app-core.js：共享状态、初始化、数据同步、连接/排版/界面设置。
- frontend/tavern-rp.js：RP 角色、会话、世界书、预设、记忆和正则。
- frontend/rpg-world.js：RPG 世界库、存档、建角、开局、侧栏、世界扩展。
- frontend/ai-protocol.js：输出标签、选项、协议解析、Typed Patch、兼容修复。
- frontend/ai-runtime.js：请求、流式响应、Agent、工具和回合提交。
- frontend/app-render.js：Markdown、消息和选项渲染。
- frontend/app-ui.js：设置页、终端、抽屉、主题和事件绑定。
- public/app.js 是由 scripts/build_frontend.js 生成的产物，不能直接编辑；改 frontend 后运行 node scripts/build_frontend.js。
- Android MainActivity.kt/TavernServer.kt 是离线 WebView 壳；Android 资源只应复制公开前端与 _defaults.json，不得带入本机数据/API Key。

【修改流程】
1. 明确用户目标、受影响模式和数据 owner；用 rg 搜索函数的所有调用方，先追完整数据流。
2. 复用现有 helper、协议和样式 token，做最小、局部、可回滚的改动；不要为一个实现新增抽象层。
3. 如果改 frontend 源，重新生成 public/app.js；如果改 API/协议，更新 docs/rpg-card-api.md 或 project-overview.md。
4. 不把 stale 的终端输出、截图、附件或旧文档当作需求；以当前代码、测试和用户最新消息为准。
5. UI 变更要考虑桌面、窄屏、Android WebView 83、键盘/触控、焦点、滚动位置和消息加载中状态。不要使用 WebView 83 无法解析的语法（例如 ||=、&&=、??=）。
6. 输入/API/世界包/扩展都是不可信边界：保留长度限制、ID 校验、白名单、CAS、原子写入、HTML/CSS 消毒和脚本授权确认。

【验证门】
- 最少：node scripts/build_frontend.js --check、node --check server.js、node --check public/app.js。
- 常规提交前：node scripts/run_checks.js（它包含所有 check_*.js）。
- RPG/协议改动：至少运行 check_rpg_protocol.js、check_runtime_roundtrip.js、check_rpg_agent.js、check_rpg_agent_compat.js、check_output_regex.js、check_frontend_state_guards.js。
- UI/移动端改动：运行 check_ui_regions.js、check_ui_theme.js、check_message_window.js、check_webview83_compat.js，并用真实浏览器或 Playwright 验证关键路径；Android 改动还要检查 check_android_api.js、check_android_protocol.js。
- 看到失败先按“复现 → 找调用链 → 证明根因 → 最小修复 → 回归检查”处理，不要只在 UI 上吞掉错误或盲目重试。
- 完成后检查 git diff --cached、git status --short，确认没有把用户临时文件带入提交。

【当前已知边界】
- 服务默认无鉴权/SSRF 防护，只适合本机或可信局域网。
- 地图 UI 和随机地图暂时隐藏；新存档只读取卡声明的地图数据。
- RPG 记忆暂无向量检索、自动聚类和完整人工编辑器。
- growth/runtime 旧直写接口已 410；新玩法请声明 Runtime action/Typed Patch。
- Android APK 是 GitHub Actions 生成的 Debug APK；main push 自动构建，其他分支可在 Actions 手动选择。不要把本地构建产物或 API Key 提交。
- 当前分支最近修复了 Android/WebView 83 下“三条杠”抽屉点击无效的问题；涉及导航、触控或 media query 时要保留对应回归检查。

【提交与交付】
- 只提交本次任务相关文件，提交信息简洁说明根因/行为。
- 用户要求 push 时，先跑检查、查看 diff，再 push 当前分支；不要未经要求合并 main。
- 最终回复说明：改了哪些文件、行为变化、实际运行的检查、commit/push 结果、未解决风险。不要声称没有运行过的测试通过。
```

## 当前接手重点

1. 先确认工作区状态和当前分支，不要误删已有未跟踪测试资料。
2. 把用户最新反馈按 RP、RPG、共享 UI、Android 兼容和协议/存档五类归档，再选择对应入口。
3. 优先保持 `WorldCard → WorldSave → revision/CAS → receipt` 主链完整；出现“AI 回复了但变量没变”时先查结构化块、Agent trace、服务端拒绝原因和回执，不要直接把正文解析成状态。
4. 新增功能时同时补一个最小回归检查或复用现有 `scripts/check_*.js`，并把用户可见行为写回 README/项目总览。

## 交接验收清单

- [ ] `git status --short --branch` 已确认，用户临时文件未被删除或提交。
- [ ] 已读本提示词引用的文档和受影响源码。
- [ ] `public/app.js` 与 `frontend/` 一致。
- [ ] 相关协议/服务端/浏览器检查通过，失败项有根因说明。
- [ ] 桌面与窄屏路径至少各验证一次；Android 变更已安排真机或 Actions 验证。
- [ ] 提交只包含本任务文件，push 目标分支明确。
