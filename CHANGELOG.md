# 更新日志

## 2026-08-28 · 前端源码拆分

### 维护

- 前端可编辑源码拆为 `frontend/rpg-world.js`、`frontend/tavern-rp.js`、`frontend/ai-protocol.js`、`frontend/ai-runtime.js` 与共享 UI 分片。
- `public/app.js` 保持为兼容运行产物；`node scripts/build_frontend.js` 负责生成，检查会阻止源码与产物不同步。
- 未改变浏览器、PWA、Android APK 的资源加载路径、接口或存档格式。

### 修复

- 自定义提示词预设缺少或禁用“聊天历史”时，仍会向模型发送本轮最新玩家输入；该开关现在只省略旧上下文，避免不同输入被构造成相同请求。
- AI 往返终端改为按当前角色会话或世界存档保留请求历史，可逐条回看普通回复、Agent 步骤、协议修复与开场候选；完整 Prompt 仍只在本页内存中保留。
- Android WebView 最低兼容基线从 Chromium 92 下调至 83：入口和隔离 iframe 会补齐缺失 API，主程序不再包含 83 无法解析的逻辑赋值语法。

## 2026-08-28 · RP 回复生命周期修复

### 修复

- RP 回复完成后会先移除临时预览再写入历史，避免正文重复渲染，并恢复底部快捷行动选项。
- 清空对话时同步中止进行中的请求、移除思考占位和临时预览，避免旧回复异步回写或残留。
- `<tavern_options>` 解析兼容模型为避免 Markdown 解析而添加的反斜杠转义写法。

## 2026-08-20 · RP 消息布局与兼容性修订

### 修复

- 修复消息重新生成、编辑、复制、删除按钮使用绝对定位时覆盖正文或跑出手机屏幕的问题；操作栏改为消息底部独立行。
- 移除 Tavern 宿主头像渲染和 RPG 回合的可见“放弃本回合”按钮，避免与世界卡自定义 UI 重叠。

### 兼容与验证

- 酒馆开场白和 AI 回复统一走 `<tavern_options>` 结构化选项解析，开场白也能生成底部快捷行动。
- 更新前端/PWA 缓存版本，避免旧 CSS 在浏览器或 Android WebView 中继续生效。
- 新增/补充 RP 正则、自动记忆、主题和消息布局回归检查。

### 验证

- `node --check public/app.js`
- `node --check public/mapgen.js`
- `node scripts/check_tavern_narration.js`
- `node scripts/check_ui_theme.js`
- `node scripts/check_pwa.js`
- Playwright 桌面与 381×875 移动视口检查消息操作栏不再覆盖正文。

## 2026-08-19 · Android 导出与发布准备

### 新增

- Android WebView 增加 `TavernAndroid.saveFile(name, mime, base64)` 导出桥，将前端导出的角色卡、预设、世界书、世界包、WorldSave 和设置写入系统 `Download` 文件夹。
- Android 10 及以上通过 MediaStore 写入并标记完成；Android 9 及以下兼容公共 Downloads 目录并在首次导出时申请存储权限。
- 导出文件名经过路径字符清理并限制长度，Base64 数据超过约 36 MB 时拒绝写入，避免误用导致内存异常。
- 浏览器和非 Android 环境继续使用标准 `<a download>` 回退，不改变桌面端导出行为。
- 新增 `node scripts/check_android_api.js`，检查前端下载 helper 与 Android bridge 契约。

### 文档与发布

- 更新 README 的能力清单、手机端使用说明和验证命令。
- Android APK 仍由 `.github/workflows/android-apk.yml` 在推送或手动触发时构建；本次推送后将触发一次 Debug APK 构建。

### 验证

- `node --check public/app.js`
- `node scripts/check_android_api.js`
- `node scripts/check_ui_regions.js`
- Playwright 已验证 Android bridge 被调用时不创建浏览器下载锚点，浏览器回退路径仍可用。

## 2026-08-17 · World App Contract W0–W6

### 新增与兼容

- 冻结世界卡 / 世界存档 / UI 插槽 / runtime / Agent 的分层契约，并为世界包写入能力清单与版本号。
- 世界卡扩展支持白名单 `data-tavern-bind` / `data-tavern-show` 状态绑定，以及 `TavernExtension.on/off()` 的脱敏 Agent 生命周期事件。
- 读取 SillyTavern 世界书时兼容 `entries` 数组 / 对象与 `worldInfo`、`world_info`、`data` 包装，不改写原始 JSON；补充 Character Card V3 / PNG / 预设 / 正则回归断言。

## 2026-08-17 · RPG 输出协议稳健性修复

### 修复

- 强化 RPG 状态块的字段级输出规范，明确 `runtime.action.execute` 只能使用 `type`、`actionId` 和可选 `input`。
- 客户端提交前拦截未声明字段，并将具体校验错误交给一次协议修复请求，减少 AI 格式漂移导致的整回合失败。

## 2026-08-17 · v0.1.50

### 发布

- 新增 `tavern-v0.1.50-portable-win-x64.zip`：内置 Node.js 的 Windows x64 独立文件夹版本，解压后双击「启动 Tavern.bat」即可运行。
- 便携版只携带 `_defaults.json` 模板，API Key、角色卡、世界书和存档首次启动后写入包内 `data/`，不会随发布包泄露。

## 2026-08-17 · RPG GEN 3 / 世界卡扩展版本

### 新增

- 世界卡可声明隔离的 HTML/CSS/JS 前端、沉浸布局、入口内容警告、全屏请求和自定义输入/叙事/选项挂载点。
- RPG GEN 3 runtime 变量、集合、动作与 `TavernExtension.choose()`，统一复用 Agent 回合和 WorldSave 权限校验。
- Agent 工具阶段 Guard trace、两阶段 `execute → narrate`、pending 恢复、计划摘要和回执诊断。
- Character Card V3 / PNG 元数据读取、角色书自动注册与角色级输出正则；新增电子病娇测试世界卡和验收脚本。
- RP / RPG 结构化回复选项协议、Markdown/HTML 安全渲染，以及可拖拽扩大的消息编辑框。

### 修复

- 修复 RP 卡片缩进 HTML 被 Markdown 当作代码块显示的问题，并在显示阶段将 `{{user}}` 替换为当前玩家名。
- 修复角色卡示例图、世界书绑定、存档删除刷新和模式间界面串联等累计问题。
- Android 运行时新增 `user.json`，JSON PUT 校验同时支持数组和对象，并使用原子写入避免大退后数据丢失。
- 更新 PWA/前端资源版本，避免浏览器或 APK WebView 继续命中旧缓存。

### 验证与构建

- 通过 `node --check server.js`、`node --check public/app.js` 与现有 `scripts/check_*.js` 回归脚本。
- 通过 Playwright 验证 RP HTML、`{{user}}` 宏和桌面/手机编辑框尺寸。
- 推送 `main` 后由 `.github/workflows/android-apk.yml` 自动复制前端资源并构建 Debug APK；真实设备安装与功能回归仍需人工验收。

### 发布

- 移除宣传图及 README 图片引用；纯净源码包随 `v0.1.49` Release 发布。

## 2026-08-15 · WorldSave / Agent Runtime 版本

### 新增

- 世界卡与 WorldSave 分离，RPG 存档按 `saveId` 独立保存玩家、状态、回合、事件和记忆。
- RPG 开局规划流程：玩家角色、Schema 驱动建角、属性与能力、游戏规则、Opening Scenario 和 Knowledge Scope。
- 世界卡草稿、版本发布、世界包导入导出、发布前完整性检查和旧 RPG 会话迁移。
- RPG Typed Patch、revision/CAS、幂等回执、冲突、事件、成长、失败、结局和重开存档。
- Agent Runtime 的 `agent-execute → narrate` 两阶段提交与声明式工具候选。
- 分层 RPG 记忆：短期回合、事件记忆、事实账本、知识权限和记忆重建诊断。
- AI 调试终端：输入、输出、Prompt 分区、记忆诊断；输出页展示正则前原文、结构化标签和 reasoning_content。

### 修复

- 修复不同角色、世界存档和模式之间的会话状态串联问题。
- 修复 `location.set` 结构化更新携带额外字段时的兼容问题，并继续校验稳定地点 ID。
- 修复 RPG 隐式骰子判定：正式骰子改为客户端生成，服务端只校验，不再使用 AI 或服务端随机结果。
- 修复 RPG 叙事中的普通骰子文本被错误执行的问题。
- 修复 RPG 模式 Markdown 叙事与旧对白气泡解析混用的问题。
- 修复地图随机生成导致存档地图不稳定的问题；地图改为由世界卡提供，地图 UI 暂时隐藏。
- 修复移动端布局、设置导航、角色卡示例图绑定和角色库选中状态等交互问题。

### 兼容性与限制

- 旧版 `rpg` 控制块仍可作为只读兼容输入；正式提交统一走 WorldSave 校验。
- `/api/dice` 保留为兼容/诊断接口，正式 RPG 回合不再使用它作为随机源。
- 地图生成器代码暂时保留，但运行时不自动生成地图。
- Agent `rules.check`、向量记忆检索、队伍管理和真实 Android 设备验收仍待后续完善。

### 验证

- `node --check server.js`
- `node --check public/app.js`
- `node scripts/check_*.js`
- Playwright 浏览器加载、终端打开和分区切换验证
