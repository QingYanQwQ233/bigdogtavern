# 更新日志
## 2026-09-25 · 缺选项手动补全（正文零改写）
- 世界回合缺行动选项时，快捷栏在原提示旁显示「补全选项」按钮：仅请求控制数据（协议修复器不输出正文），补出后经编辑消息同款保存通道写回存档。
- 协议修复器提示词明示「绝不改变、重写或续写正文内容」；check_rpg_protocol 增加 extractRpgRepairPayload 与提示词约束断言。

## 2026-09-25 · 协议容错：state.locationId 地点漂移归一化
- 模型把地点切换写成状态字段路径（`state.locationId`）时，前端与服务端均归一为 `location.set`（原先按未知操作逐条丢弃）。
- 实机捕获：模型发出 `{"type":"state.locationId","id":"wolf-tooth-inn"}` 被丢弃；`check_rpg_protocol` 增加同名回归断言。
## 2026-09-25 · 设置滑杆浮点限位补全（步进 / 填充 / 拖拽 / 落盘）
- 四个采样滑杆 `step="any"` → `0.01`：拖拽 / 方向键原生按百分位步进，不再产生长尾浮点。
- 填充、拖拽即时标签与保存读取统一两位小数量化（`fmtSetting` / `readSettingNumber`）；历史长浮点随下次保存收敛（0.582801… → 0.58）。

## 2026-09-25 · UI 审计清单批量修复（13 项）

- 排版文案：设置参数浮点限位（-1.560860… → -1.56）；顶栏 / 存档卡地点显示名（`断牙之角`）；世界详情 / 存档卡 / 世界书按钮窄屏折行修复；Base URL 与正则空态文案校正。
- 样式一致：危险按钮红色样式落地（删除世界卡 / 世界书）；状态条与快捷选项行右缘渐隐；设置标签页渐隐可滚动；消息操作图标 22→30px；导航抽屉与吸顶头部背景提实（0.92→0.98 + blur）；手机端隐藏「⌘ 终端 / 🧪 开发者」入口；返回按钮统一靠左。
- 结构清理：「🔒 W2」标记与「0 世界角色」统计项退役。

## 2026-09-25 · 右侧状态面板改为区块级声明控制（默认不再全量铺开）

- 面板十个数据区块各自独立：世界卡 `ui.sections` 用 `true`（常显）/ `false`（隐藏）控制；未声明 = auto（有内容才出现）。
- 默认态实测：本局只显示「世界线」与「世界线总结」（10 块 → 2 块）；强制 `quests` / `factions` 显示验证通过。
- 顺带修复「世界事件 / 派系」占位归属混乱（派系区块此前由 JS 动态插在事件标题下）；「返回工作台」独立置顶。

## 2026-09-25 · 角色面板资源条对齐规则（角色当前上限 / 无上限不画条）

- `renderRpgSheetMetric`：资源条目改用「角色当前上限」做分母（生命/魔力恢复满条 100%）；无角色上限的资源（金币）不再画空条。
- 实测：生命 100%、魔力 100%、金币无条。

## 2026-09-25 · 协议容错：未知更新操作不再拒绝整个回合

- `normalizeRpgPatch` 丢弃白名单外的操作（console 告警），契约初检与修复循环都先归一化；模型发明 `npc.relation.set` / `memory.local.add` 不再毁掉回合。
- 实测：同一选项重放，模型仍发协议外操作，回合正常提交（revision 8→9、turns 10→12）。

## 2026-09-25 · 修复金币被持久化层误删（compactRpgState）

- `compactRpgState(state, world)` 不再无条件剥掉 `state.player.resources.gold`：只有世界卡未声明 gold 时才清掉遗留值；4 个调用点传入 world。
- 实测：回合提交后存档 `resources={hp:20,mp:5,gold:10}`（revision 7）存活；状态提示不再出现「金币已移除」。

## 2026-09-25 · 状态条分母修正：角色当前上限 ≠ 世界卡变量上限

- 状态条 meter 分母改用「角色当前上限」（约定存于 `state.stats.max<Id>`，如 `maxHp` / `maxMp`），不再拿世界卡声明的变量 `max` 当分母；生命/魔力按角色满值显示（实测 20/20、5/5）。
- 回滚上一条对种子卡数值的误改：`hp` / `mp` 上限恢复 999、`gold` 上限恢复 1000000——世界卡 `min`/`max` 是变量域约束，不参与角色"满值"显示。
- 没有角色上限的资源（如金币）不再画进度条，按纯数值 chip 渲染。

## 2026-09-25 · 修复「任务与世界状态」右栏在世界模式被整块隐藏

- `renderRPG()` 里 8/28 遗留的 `legacyWorldRight.hidden = worldRuntime` 会让所有世界会话隐藏宿主右栏（任务 / 目标 / 开局 Hook / 线索 / 世界线 / 人物经历）；改为只跟随世界卡槽位声明：`hide` / `replace` 才隐藏。
- 移动端「任务与世界状态」抽屉与桌面右栏不再空白（实测 322×806 可见，此前内容高度 0）。

## 2026-09-25 · 手机端底栏整治（状态条 / 陈旧选项 / 提示语）

- 状态条：`#rpg-dynamic-stats` 在 ≤960 布局不再被压成窄竖列，与资源 meter 同排横滚；手机端状态块高度从 382px 收回到约一行。
- 快捷行动：最后一条 AI 回复没有选项时不再回退到开场选项（仅本会话尚无玩家发言时允许回退）。
- 输入提示语缩短为「写下你的话或行动…」，修掉窄屏下截断出孤立「·」的问题。

## 2026-09-25 · 修复初始化绑定中断（大量 UI「点了没反应」）

- `bindEvents` 里 4 条指向已删除元素（角色编辑器）的绑定在初始化时抛错，其后整段绑定不再执行；已删除残留绑定。
- 清理前端孤儿的「旧 RPG 会话迁移」块（无入口、DOM 不存在；后端 `/api/rpg-migrations` 接口保留）。
- 新增 `scripts/check_ui_bindings.js` 守卫：引用不存在的元素 id 必须走白名单。

## 2026-09-25 · APK 改为仅手动构建

- `android-apk.yml` 取消 `push` 自动触发（避免日常提交浪费构建额度），保留 `workflow_dispatch`：需要 APK 时在 Actions 页 Run workflow；README / AGENTS / docs 同步更新。

## 2026-09-25 · 世界包 `characters` 字段退役（specVersion 2）

- `content` 不再携带角色实体：导出停写 `characters` / `characterIds` / `start.playerTemplateId`；导入忽略旧包里的这些字段，v1 旧包仍可导入并给出警告。
- 导入不再写 `characters.json`；`specVersion` 升到 2，接受 v1（`LEGACY_WORLD_PACKAGE_VERSIONS`）。
- 新增 `scripts/check_world_package_contract.js` 守卫（v1 忽略 / v2 无角色字段 / 导出回环）；7 个示例包与文档同步更新。

## 2026-09-25 · ST（酒馆）模式全面移除，应用固定为 RPG 单模式

- 删除模式开关、角色卡 prompt 覆盖链、自动写卡 / 角色工坊、回复选项指令构造器、ST 自动滚动记忆、角色卡脚本帧与兼容桥、角色库 UI 与编辑器函数族；界面文本「酒馆」清零。
- 解耦：`sessionMatches` 只按 kind 匹配、`charId` 停止写入；共享路径去掉 `char.loreId` / `getGreeting` 等角色依赖。
- 世界书保留并接入 RPG 导航；`characterBookForChar`、`normalizeCharProfileFields`、卡片序列化工具族、`saveChars` / `ensureChars` 被 RPG 复用，保留。
- 新增 `scripts/check_st_removed.js` 守卫（移除项不得复活 + 保留项必须留存）。
- 遗留：存档 / 协议层 `hp / mp / exp / gold` 未动（`DESIGN_CONSTITUTION §11.1`）。

## 2026-09-25 · 杀掉 RPG 状态条的写死玩法数值（UI 层）

- `public/index.html` / `styles.css` 删除写死 HP / MP / EXP / 金币 / 状态五行与按玩法字段配色；资源条改用 `var(--accent)`。
- `frontend/rpg-world.js` 新增 `statusMeters()` / `renderStatusMeters()`：有 `min`/`max` 的资源出通用 meter，其余维度走 `#rpg-dynamic-stats`。
- `check_frontend_state_guards.js` 换成 4 条断言：不得写死玩法数值行 / 资源条不得按字段配色 / meter 必须取自运行时声明 / `renderRPG` 先渲染声明驱动部分。

## 2026-09-25 · 追加两个流程图 skill + RPG 玩法中立性立为硬约束

- 安装 `screen-flow-diagram` / `interactive-flow-diagram`（MIT；开发侧产物，不进 `public/`、不进 APK）；已装第三方技能 11 → 13，Operit 全局目录 31 → 33。
- `DESIGN_CONSTITUTION §11.1`：RPG 是「高度自定义的玩法框架」，UI 不得写死任何玩法数值；新增玩法维度时改数据声明，而不是 `public/index.html`。
- 同步落点：`AGENTS.md §5`、`skills/ui-design-system/SKILL.md`、「玩法中立性」参考文档。

## 2026-09-25 · 安装 UI/UX 设计技能体系 + 建立设计总纲

- 新建 `skills/`：收录 11 个第三方 MIT 技能（原样收录、各自带 LICENSE）+ 自写入口 `ui-design-system`。
- 新增 `scripts/sync_skills.js` / `check_skills_sync.js`（逐文件哈希比对仓库与全局 skill 目录）；全局技能数 19 → 31。
- 新建 `docs/design/DESIGN_CONSTITUTION.md`；`ui-beauty-declaration.md` 降级为「宿主契约」子文档；三层文档只允许引用不复制。
- 修掉 `AGENTS.md §7` 指向已删除 `check_webview83_compat.js` 的腐坏引用。

## 2026-09-25 · §7 无障碍约束变成可检查项（并修掉两个实测缺陷）

- 新增 `check_ui_accessibility.js`（静态）与 `audit_ui_accessibility.js`（运行时测量）：焦点环、`outline: none` 配对指示、`prefers-reduced-motion`、16px 输入字号、44px 命中区、弹窗 Escape 与焦点归还。
- 修复：设置弹窗与两个地图弹窗补 Escape 分支 + 焦点归还；移动端 14 个输入框从 13px 统一到 16px（防 WebView 聚焦缩放）。
- 约束条目改为标注验证方式（`[静态]` / `[运行时]` / `[未强制]`）与已知偏差实测数据。

## 2026-09-25 · 剩余尺度债务清理：圆角 / 动效 / 字号

- 圆角归 9 种取值、动效统一 `ms` 并归 11 种时长、字号归 12 种（半像素居中取较小者）。
- `check_spacing_scale.js` 升级为 `check_design_scales.js`：一次守卫四类尺度 +「动效必须用 ms」断言。

## 2026-09-25 · 间距债务一次还清：全量对齐 2px 基尺度

- `styles.css` 215 个间距 token 对齐到 2px 网格（16 以下 2px 步进、16–40 为 4px、以上 8px）；保留 0 / 1px 为非节奏值。
- 新增 `scripts/check_spacing_scale.js` 守卫全部间距值。

## 2026-09-25 · 修复未定义 CSS 变量 + 新增变量守卫

- 修复未定义变量：`--font-mono`（代码 / JSON 编辑面失去等宽字体）、`--border`（`.message-window-control` 整条声明失效）、`--warning`。
- 新增 `scripts/check_css_vars.js` 守卫：无 fallback 引用的变量必须能解析到定义或运行时注入。

## 2026-09-25 · 校准 Android WebView 内核下限（83 → 111）

- 声明下限与实际代码脱钩（`color-mix()` / `:has()` 等 274 处需要 Chromium 111）；下限校准为 111，未改 CSS。
- 新增 `check_webview_floor.js`（替代 `check_webview83_compat.js`）：断言「声明下限 ≥ 代码实际特性」，并校验入口 / iframe 两份降级层逐字同步。
- 告警判定改为 `CSS.supports` 能力检测；移除 `:is()` 禁令等过时约束；`webview83Compat*` 更名为 `webCompat*`。

## 2026-09-19 · Android 后端单源化（内嵌 Node 运行 server.js）

- App 内嵌 Node.js（nodejs-mobile）直接执行与桌面端同一份 `server.js`；删除 1495 行 `TavernServer.kt` 与 nanohttpd。
- 新增 `android/native/node_bridge.cpp`、`NodeRuntime.kt`、`NodeBootstrap.kt`；启动迁移旧数据到 `filesDir/nodejs/public/`，localStorage 跨升级保留。
- 新增 `scripts/fetch_android_node.sh` / `sync_android_assets.sh` / `build_android_apk.sh`；`libnode.so` 构建时现取不入库。
- 新增守卫：`check_android_api.js`（禁第二份后端 / JNI 符号 / `server.js` 入包）、`check_android_protocol.js`（零 npm 依赖 / Node 18 API 边界）。
- APK 约 19 MB（`libnode.so` 约 17 MB），仅分发 `arm64-v8a`。

## 2026-09-06 · 修复预设正则解除绑定

- 修复预设内置正则只能显示为标签、无法卸下的问题；所有预设正则都可取消携带。
- 取消绑定会把最近编辑的规则移回当前模式自定义列表并立即保存；缺少原自定义来源的规则也会保留。

## 2026-09-05 · 提示词缓存观测与兼容参数

- 请求前缀保持稳定（预设 / 角色卡 / 世界书）以复用上游提示词缓存；不本地缓存模型回复。
- 新增可选 `prompt_cache_key` 与流式 `usage` 统计开关；AI 往返终端展示缓存读取 / 写入 / 未命中与共同前缀估算。
- 兼容说明：Claude `cache_control` 与 Gemini `cachedContents` 需原生适配，代理不伪造。

## 2026-09-05 · 预设正则可编辑与切换隔离

- 预设绑定正则可在「正则」栏目直接修改 / 保存 / 删除并写回当前预设；解除绑定保留最新编辑内容。
- 切换预设自动卸下上一预设的正则，只执行新预设携带的规则。

## 2026-09-05 · 正则隔离与预设生成参数

- 正则来源与格式化目标分离（仅显示 / 仅提示词 / 两者）；深度 `0` / 留空 / `-1` 语义修正；Trim Out 按行。
- 设置页显示实际生效参数与来源、当前预设编辑入口；修复温度 `0` 被覆盖、小数被取整；`stop: []` 可禁用全局停止词。
- `openai_max_context` 扣除回复预算后按估算裁剪最旧历史、保留本轮输入；不截断、不追加请求。
- 请求历史可从 `rawContent` 恢复可精确匹配旧版 HTML。

## 2026-09-05 · 紧凑顶栏与透明 UI

- 聊天顶栏改单排：限宽、省略长名，移动端菜单按钮保留 44 px。
- 清空对话、终端和开发者入口收进「⋯」展开菜单；外部点击 / Escape 关闭，与导航、会话菜单互斥。
- 新增透明 UI 开关（0–100%），即时预览、自动保存、独立于主题；同步更新前端 / PWA 资源版本。

## 2026-09-05 · 自定义聊天背景

- 「界面」新增聊天背景：本地 PNG / JPG / WebP / GIF（≤12 MB）、预览、开关、铺满 / 完整、对齐与遮罩。
- 背景保存到本机（设置只记路径），刷新 / 重启恢复；RP / RPG 普通聊天区共用，不注入世界卡 iframe。

## 2026-09-05 · RP 单次请求与 char 格式引导

- 移除 RP 选项掉格式后的自动纠正请求；缺标签 / JSON 错误 / 数量不足时保留正文，不伪造按钮。
- 回复选项开启时在请求末尾合成一条 char（Assistant）引导消息（可编辑、支持数量占位符），仅用于请求、不显示不存档；RPG 协议修复不变。

## 2026-09-04 · RP Prompt Manager 架构对齐

- 提示词预设升级 v3：`prompts + promptOrder` 为唯一顺序与开关来源；固定提示词与运行时 Marker 分离。
- 预设编辑器补齐 ST 采样参数、格式模板、新聊天 / 示例提示与 assistant prefill；ST 导入导出保留多个 Prompt Order Profile。
- 删除全局对白输出协议与 `tavernFormat` 隐式注入；Post-History 改为可编辑的 `jailbreak`；旧预设自动迁移。

## 2026-09-03 · RP 回复选项与当前回合结构

- 预设可开启 / 关闭回复选项、设置每轮 1–8 项与偏好提示词；遗漏 `<tavern_options>` 时自动补默认协议；ST 配置保留在 `tavern_meta.replyOptions`。
- RP 请求拆分旧历史与当前玩家回合：关闭历史 / 裁剪 / 自动摘要 / 骰点记录不再挤掉当前输入。

## 2026-09-04 · 原创代码改为非商用许可

- 原创代码改用 PolyForm Noncommercial License 1.0.0：个人 / 非商业可用，商业用途需书面授权。
- 保留截至 `984446947993c7177bd7fb0c3dc133f1637a099b` 的 MIT 历史授权、不追溯撤销；`public/vendor/` 第三方库各按原许可证。

## 2026-08-28 · 前端源码拆分

- 前端源码拆为 `frontend/*.js`；`public/app.js` 由 `scripts/build_frontend.js` 生成，检查阻止源码 / 产物不同步。
- 修复「关闭聊天历史仍丢失本轮输入」；终端请求历史按会话 / 世界存档保留。
- Android WebView 基线由 92 下调至 83（后于「WebView 下限校准」中改为 111）。

## 2026-08-28 · RP 回复生命周期修复

- 回复完成先移除临时预览再写历史；清空对话时中止进行中请求与残留占位；`<tavern_options>` 解析兼容反斜杠转义写法。

## 2026-08-20 · RP 消息布局与兼容性修订

- 消息操作栏改为底部独立行，不再覆盖正文 / 跑出屏幕；移除宿主头像与「放弃本回合」按钮。
- 开场白与 AI 回复统一走 `<tavern_options>` 解析；更新前端 / PWA 缓存版本。

## 2026-08-19 · Android 导出与发布准备

- 新增 `TavernAndroid.saveFile()` 导出桥：角色卡 / 预设 / 世界书 / 世界包 / WorldSave / 设置写入系统 `Download`（Android 10+ MediaStore，旧版申请权限）；浏览器回退不变。
- 新增 `scripts/check_android_api.js` 桥契约检查；README 能力清单同步更新。

## 2026-08-17 · World App Contract W0–W6

- 冻结世界卡 / 世界存档 / UI 插槽 / runtime / Agent 分层契约；世界包写入能力清单与版本号。
- 世界卡扩展支持 `data-tavern-bind` / `data-tavern-show` 绑定与 `TavernExtension` 生命周期事件；ST 世界书读取兼容多种包装、不改写原文。

## 2026-08-17 · RPG 输出协议稳健性修复

- 强化 RPG 状态块字段规范（`runtime.action.execute` 的 `type` / `actionId` / `input`）；未声明字段在提交前拦截并走一次协议修复。

## 2026-08-17 · v0.1.50

- 发布 `tavern-v0.1.50-portable-win-x64.zip`（内置 Node.js，双击「启动 Tavern.bat」）；便携版只带 `_defaults.json` 模板，运行数据写入包内 `data/`。

## 2026-08-17 · RPG GEN 3 / 世界卡扩展版本

- 世界卡可声明隔离 HTML/CSS/JS 前端、沉浸布局、入口警告、全屏与自定义输入 / 叙事 / 选项挂载点。
- 新增 runtime 变量 / 集合 / 动作与 `TavernExtension.choose()`；Agent 增加 Guard trace、两阶段提交、pending 恢复与回执诊断。
- 新增 Character Card V3 / PNG 元数据读取、角色书注册与角色级输出正则；RP / RPG 结构化选项协议与消息编辑框。
- 修复：RP 缩进 HTML 被当代码块、`{{user}}` 显示替换、角色卡示例图 / 世界书绑定等；Android 端补 `user.json` 原子写入。

## 2026-08-15 · WorldSave / Agent Runtime 版本

- 世界卡与 WorldSave 分离：RPG 存档按 `saveId` 独立保存玩家 / 状态 / 回合 / 事件 / 记忆；新增草稿、版本发布、世界包导入导出与旧 RPG 会话迁移。
- 开局规划：Schema 驱动建角、属性 / 能力、规则、Opening Scenario 与 Knowledge Scope。
- Typed Patch、revision/CAS、幂等回执、冲突 / 事件 / 成长 / 失败 / 结局与重开存档；Agent 两阶段提交与声明式工具候选。
- 分层 RPG 记忆（回合 / 事件 / 账本 / 知识权限 / 重建诊断）；AI 调试终端分区（请求 / 输入 / 输出 / Prompt / 记忆）。
- 修复：会话状态串联、客户端骰子权威化、地图随机漂移（改为世界卡提供、UI 暂隐藏）等。
- 兼容：旧 `rpg` 控制块只读；`/api/dice` 保留为诊断接口。
