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

## Android APK

推送到 `main` 会触发 [Build Tavern APK](.github/workflows/android-apk.yml)。功能分支已推送时，可在 GitHub 的 **Actions → Build Tavern APK → Run workflow** 选择该分支手动构建。构建完成后，在对应运行页下载 `tavern-apk` artifact；当前产物是已签名的 Debug APK，不会自动发布为 GitHub Release。

本地构建需要 JDK 17、Android SDK 与 Gradle 8.7。构建前只复制前端资源和默认模板，不会把本地 API Key、存档或其他运行时数据打进 APK：

```powershell
$assets = 'android\app\src\main\assets'
New-Item -ItemType Directory -Force "$assets\data", "$assets\licenses" | Out-Null
node scripts\build_frontend.js
Copy-Item public\index.html, public\styles.css, public\app.js, public\mapgen.js, public\manifest.json, public\sw.js, public\favicon.png -Destination $assets -Force
Copy-Item public\vendor -Destination $assets -Recurse -Force
Copy-Item public\icons -Destination $assets -Recurse -Force
Copy-Item LICENSE, LICENSE-MIT-LEGACY, THIRD_PARTY_NOTICES.md -Destination "$assets\licenses" -Force
Copy-Item public\data\_defaults.json "$assets\data\_defaults.json" -Force
Push-Location android
gradle assembleDebug --no-daemon -Pvc=1 -Pvn=alpha-local
Pop-Location
```

APK 输出路径：`android/app/build/outputs/apk/debug/app-debug.apk`。

## 本次更新 · 2026-09-05

- 「设置 → 界面 → 聊天背景」支持选择本地 PNG / JPG / WebP / GIF，可开关、移除、调整铺满 / 完整显示、对齐位置和遮罩深浅，实时预览并自动保存。图片保存在本机，RP / RPG 普通聊天区共用，Android 重启后自动恢复。
- RP 选项不再掉格式后重试：首轮请求末尾加入临时 char（Assistant）历史消息，引导先写正文、再按格式输出选项。缺少合法选项时保留正文，可继续自由输入。
- 在提示词预设的回复选项区域编辑「末尾 char 引导消息」，支持 `{count}`、`{min}`、`{max}`；留空继承默认。随回复选项开关生效，与已有 assistant_prefill 合成一条，不进入真实聊天历史或摘要。
- 这是单次请求的格式引导，不保证模型必然遵守；RPG 状态协议的修复不受影响。

## 本次更新 · 2026-09-04

- RP 提示词预设升级为 v3：`prompts` 保存素材，`promptOrder` 同时决定开关与实际消息顺序；固定可编辑提示词与运行时 Marker 分离。
- 删除无法单独关闭的全局“对白输出协议”和 `tavernFormat` 隐式槽位；Post-History 改为预设列表中可见、可编辑、可排序、可关闭的 `jailbreak` 项。
- 世界书 Before / After、示例前后和 At Depth 按位置注入；角色卡 main / Post-History 覆盖支持 `{{original}}`。
- 预设页新增 ST 生成参数与 Utility Prompt 配置；导入的采样参数、格式模板、新聊天提示和 assistant prefill 会进入实际请求，模型/服务商字段只做无损往返。
- SillyTavern 导入正确区分 `system_prompt` 与 `marker`，保留多个 `prompt_order` Profile；v1/v2 预设和旧全局提示词会自动迁移。
- 当前玩家输入独立于旧聊天历史组装：即使关闭 Chat History、缩短历史窗口或启用自动摘要，也会在请求中准确保留一次。
- 本轮实现依据 SillyTavern 官方的 [Prompt Manager](https://docs.sillytavern.app/usage/prompts/prompt-manager/)、[World Info](https://docs.sillytavern.app/usage/core-concepts/worldinfo/) 与 [Character Design](https://docs.sillytavern.app/usage/core-concepts/characterdesign/) 结构；完整仓库检查为 84/84 通过，包括 Android WebView 83 兼容检查。

## 本次更新 · 2026-09-03

- 酒馆提示词预设新增独立的「普通 RP 回复预设选项」配置：可按预设开启/关闭、设置每轮 1–8 个选项，并自定义选项偏好提示词；未改动时继承项目默认，导入/导出通过 `tavern_meta.replyOptions` 保留配置。
- 自定义提示词可以只描述选项风格；若省略 `<tavern_options>` 机器协议，运行时自动补入默认结构要求。关闭后不注入、不修复，也不显示等待提示。
- 旧版写在 `postHistory` 尾部的「AI 回复选项协议」会迁入独立字段，普通后预设原文保留，避免重复注入。
- RP 请求把已完成历史和当前玩家回合分开组装；历史条数、关闭聊天历史、自动摘要或骰点附加记录都不会挤掉当前输入。当前玩家内容在 Chat History 边界只注入一次；排在历史后的 Relative / In-Chat 提示词仍按预设有意跟随。
- 上述配置只属于酒馆 RP；RPG 的 WorldSave、`<tavern_state_update>` 与行动选项协议保持独立。

## 本次更新 · 2026-08-26

- RPG 回合的 `runtime.collection.add` 统一要求使用 `value: { id: "stable-entry-id", ... }`；字段平铺或漏掉条目 ID 会在提交前触发精确的协议修复，不再直接落到服务端报错。
- Runtime 动作会在零库存或条件不足时禁用，Agent 同步收到不可用上下文，避免继续尝试无效动作。
- 世界卡草稿现可通过 `?worldDraft=<id>` 进入可刷新恢复的全屏制卡工作台；状态变量、耐久物品和固定使用动作均可填表创建，复杂 Runtime JSON 仍保留在折叠的兼容区。未声明侧栏时，表单创建的耐久表、使用按钮和可见变量会自动显示给玩家（最多 24 个面板，超出部分请手写侧栏）；一旦手写 `ui.sidebar`（包括空面板）即完全按手写配置显示。
- 耐久物品会生成声明式 `runtime.action`：每次使用固定扣除耐久并增加使用次数；耐久不足时服务端拒绝执行，不会写入半个状态更新。
- RPG 继承「设置 → 排版 / 界面」配置；消息窗口在发送、点击选项和回合提交后保持当前位置，回合内状态增减会以轻微动画保留到下一行动。
- RP / RPG 输入栏统一为紧凑等高布局；支持全屏多行输入，AI 生成时发送按钮变为可点击停止。
- 移动端 RPG 工具栏恢复「任务与世界状态」右侧抽屉入口，左右侧栏均可从手机端打开；世界存档态不再保留空的旧状态栏占位。
- Android 构建会携带当前 `mapgen.js`，并为每次 APK 生成独立的前端资源版本，避免覆盖安装后 WebView 命中旧 Service Worker 缓存。

## 本次更新 · 2026-08-20

- RPG Agent 判定增加短促的客户端反馈动画：掷骰时显示判定中，收到结果后收束为骰点/结果状态；失败和减少动态效果时会自动清理或降级。
- 增加自动总结
- 增加自定义界面
- 修复消息操作按钮在窄屏或长正文上覆盖内容、跑出聊天区域的问题；操作栏现在独立占用消息底部一行，手机端也保持在消息容器内。
- 移除宿主头像和 RPG 回合中的“放弃本回合”入口，减少与世界卡自定义界面的视觉冲突。
- 酒馆开场白与 AI 回复共用 `<tavern_options>` 解析协议，开场白中的快捷选项也会进入底部选项栏。
- 补充 RP 自动记忆、输出正则阶段、世界卡前端桥接和主题自定义的回归检查，更新 PWA 资源缓存版本。

### Windows 便携版

GitHub Release 提供 `tavern-*-portable-win-x64.zip`。解压后双击「启动 Tavern.bat」即可运行，包内已包含 Node.js，不需要另行安装 Node.js、npm 或配置环境变量。运行时数据保存在同目录的 `data/`，不会把本机 API Key 和存档打进发布包。

## 本次更新 · 2026-08-19

- RPG 世界卡支持自定义 HTML/CSS/JS 前端、沉浸模式、入口警告、声明式 runtime 变量/集合/动作和 Agent 选择桥接。
- Agent 回合统一接入规则检查、客户端骰子、工具 Guard trace、两阶段提交、pending 恢复和结构化回执。
- 酒馆模式补齐 Character Card V3 / PNG 元数据、角色书绑定、卡片级输出正则、HTML/Markdown 安全渲染和 `{{user}}` 显示宏；兼容 ST 角色卡把前端包在带 `text` 标记的代码围栏正则替换中的写法，角色卡消息会占满当前聊天列，iframe 高度跟随卡内内容与折叠状态变化，移动端会将卡内宽度收进消息容器。卡内 HTML/CSS/JS 经用户逐卡确认后进入同源完整兼容 iframe，支持 `parent.document`、localStorage、外部脚本/网络和 ST 聊天/世界书桥；预设 EJS/MVU 仍只保留原文。
- 角色卡导入入口可自动识别误选的 ST World Info JSON，并转入世界书库；世界书页仍提供独立的 ST 世界书导入入口。
- RP / RPG 回复选项改为预设协议驱动，选项不再写死在前端；编辑消息时输入框按聊天区域自适应并支持拖高。
- Android 套壳补齐 `user.json` 与数组/对象 JSON 原子持久化校验；推送后由 GitHub Actions 构建 APK。
- Android APK 支持 Android System WebView/Chromium 83 起；入口会在加载本地依赖前补齐 `Array.prototype.at`、`Object.hasOwn` 和 `Element.replaceChildren`，并避开 83 无法解析的逻辑赋值语法；低于 83 才提示更新。
- Android 导出桥接：角色卡、预设、世界书、世界包、世界存档和设置可直接导出到系统 `Download` 文件夹；Android 10+ 使用 MediaStore，旧系统按需申请存储权限，浏览器端仍保留下载回退。
- 新增 Android 导出回归检查 `node scripts/check_android_api.js`，覆盖 WebView JavaScript bridge、文件名清理、大小限制和前端下载回退。
- 发布 Windows x64 便携文件夹包，内置 Node.js，解压即可启动。

详细变更与验证命令见 [CHANGELOG.md](CHANGELOG.md)。

常用检查：

```bash
node scripts/run_checks.js

# 也可以只运行当前改动涉及的检查
node --check server.js
node --check public/app.js
node scripts/check_rpg_protocol.js
node scripts/check_runtime_roundtrip.js
node scripts/check_frontend_state_guards.js
node scripts/check_player_creation.js
node scripts/check_session_sync.js
node scripts/check_android_api.js
```

`node scripts/run_checks.js` 会先检查核心与脚本 JavaScript 语法，再顺序执行全部 `scripts/check_*.js`；GitHub Actions 在 main 和 Pull Request 上运行同一入口。

前端源码按职责拆在 `frontend/`。修改分片后先运行：

```bash
node scripts/build_frontend.js
```

再运行 `node scripts/run_checks.js`。检查会验证源码分片与 `public/app.js` 完全一致，避免 APK 或 PWA 打入过期前端。

## 数据所有权

默认模板只有一个来源：`public/data/_defaults.json`。首次启动时，服务端根据它初始化运行时 JSON。

```text
_defaults.json
  ├─ characters.json       角色库
  ├─ presets.json          提示词预设
  ├─ lorebooks.json        世界书
  ├─ settings.json         连接与运行设置
  ├─ user.json             玩家设定与酒馆手动记忆
  ├─ gen.json              AI 辅助生成字段与提示模板
  ├─ sessions.json         酒馆会话库（含删除墓碑，首次保存时创建）
  └─ worlds.json            世界卡目录

saves/<saveId>.json        RPG WorldSave，服务端按存档独立读写
world-deleted.json         已删除世界卡 ID（防止默认模板重新出现）
```

`localStorage` 只保存离线缓存和当前 ID，服务端 JSON 是权威源。酒馆会话同样走服务端：启动时与服务端 `sessions.json` 按 ID 取并集合并（冲突保留更新时间新者），删除的会话以墓碑记录，不会在其他浏览器复活，因此更换浏览器聊天记录不丢失。`WorldCard@worldVersion` 保存稳定世界资料；`WorldSave@revision` 保存本局玩家、状态、事件、回合和记忆。世界卡或角色卡后续编辑不会静默覆盖已有存档。

世界库中的存档可单独删除；删除世界卡前必须先删除该世界的全部存档，确认后会移除所有已发布版本和未发布草稿。默认世界通过 `world-deleted.json` 记录删除标记，刷新后不会被 `_defaults.json` 自动补回。

## 酒馆模式

酒馆模式围绕“角色卡 + 对话会话”工作：

- 角色卡创建、编辑、删除，以及 Character Card V1/V2/V3 JSON 导入导出；支持读取 PNG 内嵌的 `ccv3` / `chara` 元数据，V3 的角色书与扩展字段按角色卡绑定保存；导出时会把角色绑定的世界书一并写入 `data.character_book`；
- 三步 AI 写卡：一句话定角色 → JSON Schema 动态填表 → 生成完整结构化角色卡；
- 动态角色字段、可自定义栏目和运行时保存，不把世界观字段写死在前端；
- SillyTavern 风格提示词预设：固定提示词、运行时 Marker、世界书前后、Post-History、In-Chat、Relative、宏、Prompt Order、生成参数和导入导出；
- Post-History 作为提示词顺序中的 `jailbreak` 固定项显示，可编辑、排序和关闭；回复选项协议由同一预设的独立 `replyOptions` 配置管理，不占用普通 Post-History；
- 独立「正则」设置：RP / RPG 分模式保存自定义规则，兼容 SillyTavern `extensions.regex_scripts` 的 `placement`、`trimStrings`、`substituteRegex`、深度、`markdownOnly`、`promptOnly`、`runOnEdit` 等字段；规则可作用于用户输入、AI 原始回复、聊天显示、历史/提示词、System/后预设、世界书、思维链和斜杠命令。自定义规则默认绑定当前提示词预设，切换预设不会串用其他预设规则，也可改为模式全局；提示词/显示专用规则只改请求副本或渲染结果，不覆盖存档原文；预设编辑页可绑定当前模式自定义正则，保存或导出预设时会一并写入 ST 的 `extensions.regex_scripts`，运行时避免重复执行；
- 多本世界书：兼容 SillyTavern World Info JSON 的主 / secondary 关键词、四种选择性逻辑、正则、常驻、概率、分组、递归、Sticky / Cooldown / Delay、扫描设置、Outlet 宏、角色绑定，以及 ST JSON 导入 / 导出；
- 玩家设定、手动记忆、消息编辑/删除/复制/重生成；可在「记忆」页开启 RP 自动滚动记忆：每 20 个完整对话轮次把最早 15 轮压缩为约 100 字摘要，也可随时手动触发总结；原始消息仍保留在当前会话；窗口、总结轮数和摘要字数均可调整；尚未收到 AI 回复的当前玩家回合不会进入摘要覆盖，也不会因历史窗口裁剪而丢失；
- 可选旁白/对白拆分：默认整条回复作为连续正文，按需在「设置 → 输出」开启对白气泡；
- AI 回复选项：RP 与 RPG 都由模型生成结构化快捷行动，点击后直接发送；酒馆预设可独立开启/关闭、指定 1–8 个选项并自定义提示词，通过末尾临时 char（Assistant）历史消息引导格式，掉格式不再自动重试；关闭后不注入协议、不请求修复、不显示等待提示。RP 的 `<tavern_options>` 与 RPG 的 `<tavern_state_update>` 分别解析，互不复用；
- 「设置 → 排版」热调整聊天正文：字体、字号、行间距、段间距、段首缩进（空两格）与左右间距，拖动即时预览、自动保存；RPG 默认工作区同样继承这些设置；
- 「设置 → 界面」可即时调整 Tavern 的颜色 token、边框透明度、圆角、应用侧栏/RPG 两侧栏宽度和界面缩放；RPG 默认工作区同样继承，世界卡显式声明的同名 token 才会覆盖对应项；支持受校验的高级 CSS 变量 JSON，并可一键恢复默认，刷新后自动恢复；
- 「设置 → 界面」内置 macOS 深色、Nord、Dracula、Catppuccin Mocha、Tokyo Night 五套界面预设；预设来自公开主题调色板，套用后仍可继续微调并自动保存；
- AI 消息完整 GFM Markdown 渲染与安全清洗：标题、列表/任务列表、表格、引用、代码块、行内代码、链接、图片、删除线、键盘标记和分隔线；
- 文生图消息（OpenAI 兼容或 Stable Diffusion），图片保存后可持久化。

酒馆手动记忆仍保存在用户级 `user.json`；自动滚动摘要则保存在对应 `sessions.json` 的当前酒馆会话中，不会跨角色或跨会话共享。关闭自动记忆时继续使用设置里的普通历史条数。

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

> 当前 RPG 世界卡采用“可声明契约”：角色字段、地点与时间、叙事、行动选项、必要判定，以及由世界卡自行声明的 runtime 变量/集合/动作是正式能力。旧版硬编码物品、任务、派系、世界事件、冲突和成长投影不再作为通用系统；需要这些玩法时请在卡内声明 schema，由 AI 通过 Typed Patch 驱动。

### 可信回合内核

AI 输出的结构化控制块是：

```text
<tavern_state_update>{...}</tavern_state_update>
```

服务端会校验 `protocol`、`version`、`baseRevision`、typed updates、行动选项、地点 ID、玩家状态和存档 revision，再执行原子提交。旧版 `rpg` 控制块只作为兼容输入，不绕过新校验。

提交成功后，RPG 侧栏会保留本回合的数值、状态和条目增减提示；开始下一行动时以轻微动画淡出。

当前世界卡回合只接受资源、属性、技能、地点和效果等核心更新，以及当前世界卡声明的 runtime 更新，并按存档 revision 原子提交；物品/任务/关系等玩法请通过 runtime schema + Typed Patch 定义。

runtime 动作 effect 支持 `{{input.field}}` 绑定本回合输入；服务端解析后仍按世界卡 schema 校验，示例卡因此可以把 AI 提交的承诺标题、对象和代价保存为独立存档事实。

### 客户端骰子

骰子由客户端生成，服务端只验证结果：

```text
客户端随机 → actionIntent.dice → 服务端校验 → 规则结算
```

AI 或叙事文本不能直接产生权威骰子结果。缺少客户端结果时，服务端会拒绝本回合，而不是偷偷重新随机。`POST /api/dice` 仅保留为兼容/诊断接口。

### Agent Runtime

RPG 支持声明式 OpenAI-compatible tools：

- `dice.roll`：仅在同一回合先通过 `rules.check` 后由客户端执行，并绑定本回合结果；动态判定统一使用 `1dN + Σ(modifiers)`，修正只读取当前玩家/Runtime 快照；
- `context.retrieve`：当前世界存档范围内的只读检索；
- `runtime.action.execute`：世界卡声明的物品/技能动作候选；含 `runtime.actions` 的世界卡会自动开放，服务端复核输入、可用性与判定后才提交；
- `state.patch`、`entity.create`、`memory.record`：候选操作；`state.patch.updates` 不得伪装成 `runtime.action.execute`，没有对应声明动作时应改用当前协议已声明的其他 Typed Patch；
- `rules.check`：本回合判定门控，不改写存档；可引用固定 `ruleId`，也可提交 `actionId/sides/target/modifiers` 动态判定；没有真实不确定性时禁止继续掷骰。

Agent 回合采用 `agent-execute → narrate` 两阶段提交。正式状态仍由 WorldSave 服务端校验，Agent 不能直接改写存档。

RPG 顶栏按钮显示为“重置对话”：它会把当前存档的 `turns`、MVU/runtime、NPC 动态状态、事件记忆和 Agent 临时态恢复到该存档的开局基线；酒馆模式仍保留“清空对话”。

不支持原生 function calling 的模型可使用兼容 Agent 模式：模型在唯一状态块的 `toolCalls` 中声明工具，客户端执行受控工具后以 `tavern.rpg.agent.tool_result` 回传，并在 `maxSteps` 内继续请求模型；原生与兼容模式共用工具白名单、客户端骰子和存档提交链。

Agent 模式、最大步骤数和工具开关可在世界卡编辑器中按卡配置；留空时继承 RPG 预设 / 全局默认。

世界卡仍可通过 `ui.extension` 声明自己的前端，但新卡不再依赖宿主的物品、任务等侧栏面板；`ui.sidebar` 可读取当前存档的 runtime 投影，runtime 变量/集合/动作由世界卡声明并进入新的最小回合契约。`runtime.actions.<id>` 配合 `layout: "actions"` 可直接生成卡内动作表单，输入会作为世界回合的 action intent 交给 AI 决定并提交效果；动作的 `availability` 会在动作表单和 Agent 工具候选阶段先行检查，零库存等条件不足时按钮会禁用、AI 会收到不可用结果；服务端仍作原子校验，不存在或当前不可用的物品/技能不会被执行。动作还可声明 `check: { sides, target, modifiers }`：技能/物品等有风险动作必须先以同一 `actionId` 完成客户端掷骰并由服务端复核，判定失败不产生状态变化；无 `check` 的日常动作直接执行。
世界卡可通过 `ui.extension` 声明自己的 HTML/CSS/JS 前端，消息、选项和输入仍复用当前 Agent 回合；`TavernExtension.choose()` 提交玩家行动，卡内前端可只读读取 runtime，状态统一由 AI 回合通过世界卡声明的 Typed Patch 更新，避免出现第二套未保存 MVU 状态。`data-tavern-messages`、`data-tavern-options`、`data-tavern-input` 等标记仍可用于自定义界面，沉浸布局仍支持全屏、Esc 和返回世界库。
GEN 3.2 增加 `ui.extension.surfaces:['setup','play']`：创建存档时可由卡自己的 HTML/CSS/JS 接管开局配置，服务端先建立 `planning` 存档，再通过 `TavernExtension.setup.get/patch/commit/cancel` 保存草稿、提交 Schema 校验后的玩家快照并进入原生开场规划；需显式声明 `write.setup`，草稿与最终状态只属于当前 WorldSave。旧卡未声明 `setup` 时继续使用宿主建角表单。
世界卡还可以声明 `ui.entryGate`，在“建立新存档”真正创建前显示卡片自定义的内容警告；取消会回到世界库，确认后才进入玩家建角。`fullscreen: true` 会在确认点击的用户手势内请求浏览器全屏，权限被浏览器拒绝时自动降级为普通沉浸布局。
Agent 回合还会保存受限的工具 Guard trace，并在 receipt 中记录每个工具的通过 / 拒绝结果；服务端会校验工具阶段顺序（`observe → decide → guard → commit`），成功的 `dice.roll` 必须先有同回合通过的 `rules.check`，状态/记忆候选只能在判定阶段之后提交。trace 只用于诊断，不能绕过服务端 Typed Patch、规则和 CAS 校验。
Agent 执行摘要还会绑定候选 `agentCalls` 与 trace 的 `callId/name`，并保存候选、观察、通过、拒绝计数；只读 `context.retrieve` 不进入状态候选。
回合只保留玩家行动、叙事和必要判定；不再生成任务/目标计划。
工具 trace 同时标注 `observe / decide / guard / commit`，两阶段提交标注 `execute / narrate`；待叙事 pending 还会保存 `phase/phaseHistory`，刷新后可显示并恢复当前阶段，便于在终端追踪 Agent 回合阶段。
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

- 请求历史：当前角色会话或世界存档在本页产生的全部 AI 请求；点击任一条即可回看对应记录，普通回复、Agent 多步调用、协议修复和开场候选会分别保留；
- INPUT：发送给 AI 的完整请求；
- OUTPUT：正则处理前的完整原文、结构化标签摘录和 `reasoning_content`；
- Prompt：本次请求的 Prompt 分区与字符预算；
- MEMORY：当前 RPG 存档的记忆诊断与重建入口。

调试记录只保存在当前页面内存，不写入角色、会话或 RPG 存档；每个会话/存档最多保留最近 120 条请求，终端的「复制全部」会导出当前范围的全部保留记录。

### RPG 开发者实验台

启动页面时追加 `?dev=1`，顶栏会显示「🧪 开发者」。选择一个外置测试场景后直接点击「运行所选测试」即可；场景内部自动填充 `rules.check → dice.roll → tool 回传`、Typed Patch、实体候选和事件记忆，不需要填写 JSON。另有“生命值 -1”和“runtime 数值 -1”调试场景，可快速验证角色资源及 MVU 式 runtime 变量是否写入存档。测试反馈会写入本次 RPG 叙事，选项会恢复为叙事栏下方的快捷按钮。没有完成开局规划的存档不会允许提交。它直接复用正式 `/api/world-saves/:id` 回合协议，不会创建第二套状态路径。
RPG 世界卡当前验收 AI 回合闭环、客户端骰子、Agent 阶段顺序和声明式 runtime Typed Patch；历史硬编码系统不再作为统一 API，复杂玩法应由卡内 schema + action 自己定义。
开局扩展面板的 planning 存档、草稿修订和提交可用 `node scripts/check_world_setup_surface.js` 验收。
脚本兼容实验室示例见 `docs/demo-script-compat-world.tavern-world.json`：导入后可直接点击 EJS、MVU、JS 三个面板验收，说明见同名 `.md` 文件。
自定义 UI 演示卡见 `docs/demo-custom-ui-world.tavern-world.json`：导入后由 `ui.layout:"custom"` + `ui.shell` 接管宿主 RPG 区域、应用导航和顶栏，并提供唯一消息流、自定义选项/输入、MVU/Action、AI 终端、回合状态回执、浏览器全屏、Esc 和返回世界库按钮，说明见 `docs/demo-custom-ui-world.md`。
开局配置演示卡见 `docs/demo-setup-surface-world.tavern-world.json`：导入后直接体验卡内角色创建、草稿保存、提交后进入原生开场规划，以及正式游玩页的自定义消息/选项/输入；说明见 `docs/demo-setup-surface-world.md`。
手机端管理页采用父子钻取：先进入角色/预设/正则/世界书/记忆/世界库列表，再进入详情；列表和详情顶部都保留返回条，详情返回只回到上一级，预设条目和世界书条目也有独立的二级返回，不再把两个层级并列堆在小屏幕上。

## 项目结构

```text
server.js                     Node 静态服务、AI/图片代理、世界与存档 API
frontend/                     前端可编辑源码分片（按 RP / RPG / 共享职责拆分）
frontend/tavern-rp.js         酒馆 RP：会话、角色、记忆、正则、世界书与 Prompt
frontend/rpg-world.js         RPG：世界卡、存档、建角、世界 UI 与状态面板
frontend/ai-protocol.js       双模式输出协议与结构化状态边界
frontend/ai-runtime.js        AI 请求、流式响应与 RPG Agent
public/index.html             双模式页面与弹窗
public/styles.css             macOS 深色主题与响应式布局
public/app.js                 由 frontend/ 生成的兼容运行产物（勿直接编辑）
scripts/build_frontend.js     生成 / 校验 public/app.js 与源码分片一致性
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

本版本把 RPG 运行面收敛到一个可扩展核心：世界卡声明 runtime 变量/集合/动作，AI 负责观察、决策、判定并提交 Typed Patch；宿主只负责校验、持久化和绑定当前存档。旧硬编码投影不再进入新协议，酒馆与 RPG 仍使用各自的角色/世界/会话/存档边界，删除和刷新不会把数据重新串回默认模板。

### 当前限制

- 世界观与角色内容仍有占位，需要实际世界卡填充；
- 地图展示暂时关闭，地图生成调优暂缓；
- 酒馆手动记忆仍是用户级共享；
- RPG 记忆尚无向量检索、自动聚类和完整人工编辑器；
- Agent 兼容模式不会在模型回复后补掷骰；需要把结果回传给模型时使用原生 Agent 工具模式；
- 队伍管理和部分作者工作台仍需完善；
- 服务端默认无鉴权和 SSRF 防护，只适合本地开发/演示；
- 扩展事件是只读前端通知，不是服务端 Hook；世界卡 `ui.extension` 仍通过 sandbox Bridge、runtime Schema 或 Agent 工具表达行为。绑定角色卡中明确存在的 HTML/CSS/JS 可在显示前经用户确认后进入同源完整兼容 iframe；角色卡脚本可访问宿主 DOM、localStorage、外部脚本和网络，并提供 `triggerSlash('/send …|/trigger')`、`copyToTavernDialog(text)`、`TavernCard.send/copy` 以及注入当前会话/角色书快照的只读 `getLastMessageId()`、`getCurrentMessageId()`、`getChatMessages()`、`getCharWorldbookNames()`、`getWorldbook()` 和 `getCurrentChatId()`，并兼容常见的 `$(selector).load('https://…')` 外部界面加载写法。预设中的 EJS、MVU 和脚本仍保留并标记为不执行；完整兼容模式只对用户明确授权的角色卡开启，请勿导入不可信卡；
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

项目总览（功能、架构、接口和开发命令）见 [docs/project-overview.md](docs/project-overview.md)；交给下一位 Harness 的接手提示词见 [docs/handoff-next-harness.md](docs/handoff-next-harness.md)。

制作世界卡请先读 [从零创建一张可玩的 RPG 世界卡](docs/rpg-card-tutorial.md)，接口、Runtime 与回合协议见 [RPG 世界卡、运行时与 HTTP 接口参考](docs/rpg-card-api.md)。兼容历史见 [docs/data-structure.md](docs/data-structure.md)，世界卡 UI 美化声明见 [docs/ui-beauty-declaration.md](docs/ui-beauty-declaration.md)，产品路线见 [docs/rpg-card-product-roadmap.md](docs/rpg-card-product-roadmap.md)。

## 代码许可

自 2026-09-04 的许可变更提交起，A2th0 拥有版权的 BigDogTavern 原创代码采用
[PolyForm Noncommercial License 1.0.0](LICENSE) 授权。

- 允许个人学习、研究、测试、私人娱乐、爱好项目以及许可证列明的非商业组织使用、修改和分发代码；
- 任何不属于许可证列明非商业目的的使用，都必须事先取得版权持有人的书面商业授权；
- 本许可证属于 source-available（源码可用）许可证，不属于 OSI 定义的开源许可证；
- `public/vendor/` 中的第三方库不适用 PolyForm，继续遵循各自的上游许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)；
- 用户自行创建或导入的角色卡、世界卡、预设、聊天和存档不因使用本软件而改为本项目许可证。

截至并包括提交 `984446947993c7177bd7fb0c3dc133f1637a099b` 的历史版本已经按 MIT 许可证发布，既有授权不受本次变更影响；原 MIT 文本保存在 [LICENSE-MIT-LEGACY](LICENSE-MIT-LEGACY) 供历史版本查阅。商业授权请通过 GitHub Issues 联系版权持有人。

## 安全提醒

不要把此开发服务器直接暴露到公网。API Key 只应保存在本地运行时数据中；`public/data/*.json`、存档和图片目录已加入 `.gitignore`。

角色卡完整兼容模式会在用户确认后允许卡内脚本访问同源宿主 DOM、localStorage、外部脚本和网络；只导入信任的角色卡。世界卡 `ui.extension` 仍使用隔离 sandbox Bridge。
