# 更新日志

## 2026-09-25 · 安装 UI/UX 设计技能体系 + 建立设计总纲

- **仓库成为技能唯一来源**：新建 `skills/`，收录 11 个第三方 MIT 技能（原样收录、零内容修改、各自带 LICENSE）+ 自写的统一入口 `ui-design-system`（`SKILL.md` 只做路由 + 10 个主题参考文件）。候选评估表与「不装的理由」记在 `skills/EVALUATION.md`。
- **同步与防漂移**：新增 `scripts/sync_skills.js`（默认不覆盖同名冲突，带 `--check` / `--force`）与 `scripts/check_skills_sync.js`（随 `run_checks` 跑，逐文件哈希比对仓库与 Operit 全局 skill 目录；目标不存在时优雅跳过）。全局目录技能数从 19 → 31。
- **设计总纲**：新建 `docs/design/DESIGN_CONSTITUTION.md`（14 节）。`docs/ui-beauty-declaration.md` 降级为「宿主契约」子文档，两边建立双向引用；三层文档之间只允许引用不允许复制。
- **修掉一处腐坏引用**：`AGENTS.md §7` 的验证门仍指向已删除的 `check_webview83_compat.js`，改为 `check_webview_floor.js`。
- **`AGENTS.md`**：新增设计类改动的文档同步分工，以及「改 `skills/` 必须同步」的硬要求。

## 2026-09-25 · §7 无障碍约束变成可检查项（并修掉两个实测缺陷）

- **§7 之前是纯文案**：7 条约束没有任何检查覆盖。现在每条都标注了验证方式（`[静态]` / `[运行时]` / `[未强制]`+原因），并附「当前已知偏差」的实测数据。没有标注的条款等于没有约束——这正是它此前失效的原因。
- 新增 **`scripts/check_ui_accessibility.js`**（静态，随 `run_checks` 跑）：全局 `:focus-visible` 焦点环存在；**每一处 `outline: none` 必须有配对的焦点指示**；`prefers-reduced-motion` 块真正关掉过渡；移动端 16px 输入字号覆盖存在；关键控件 44px；**每个弹窗都被 Escape 分支覆盖**且 close 函数归还焦点；扩展 iframe 消息区只有一个滚动容器。
- 新增 **`scripts/audit_ui_accessibility.js`**（运行时测量，浏览器控制台/Playwright 调用）：逐元素量 44px 命中区与 16px 输入字号，实测 Escape 关闭与焦点归还。静态证明不了的事（选择器匹配不到、规则被覆盖、祖先容器决定实际尺寸）只能测量。
- **修掉实测抓到的两个真缺陷**：
  - §7-3：`#settings-modal` 与两个地图弹窗**都不在 Escape 分支链里**，键盘用户无法关闭；`closeSettings()` 也从不归还焦点（只加 `hidden`）。已为三个弹窗补 Escape 分支 + 焦点归还（`openXxx` 记录触发元素，`closeXxx` 还回去；`document.body` 不作为归还目标）。新静态断言「弹窗识别数 = Escape 覆盖数」正是为了守住这个。
  - §7-2：设置弹窗内 **14 个输入框/下拉在移动端是 13px**，会触发 WebView 聚焦自动缩放。已在移动端媒体查询内统一到 16px（顺带把表单输入高度从 33px 提到 37px）。
- 对比度：确认 6 处 `outline: none` 全部配了 `:focus` 的 box-shadow 替代指示（按钮走 `:focus-visible` + outline，输入框走 `:focus` + box-shadow，是刻意的双轨模式），未改动。
- **验证**：静态检查 96/96；运行时审计实测 `closedAfterEsc: true`、`focusReturnedToTrigger: true`、输入字号偏差 14 → 1（剩下的是复选框，不触发文字缩放）。

## 2026-09-25 · 剩余尺度债务清理：圆角 / 动效 / 字号

- **圆角**（153 声明 / 22 种取值 → 9 种）：42 个 token 对齐。奇数档 `9/7/11/5/3px` 归位；`99px` 与 `999px` 两套胶囊写法统一为 `999px`（**注意：`99px` 就近对齐会落到 `20px` 把小圆角化，必须用阈值规则**）；`--radius` token 保留不动。
- **动效**（109 token / 17 种时长 → 11 种）：全部统一为 `ms` 单位并对齐刻度。`0.15s`/`.16s`/`160ms` 这类同义写法归一；`140/160/180/220/240/420ms` 六个「近义」时长归位；`60s`→`60000ms`、`1.4s`→`1400ms`。确认过没有任何 JS 依赖具体时长字符串。
- **字号**（214 声明 / 23 种 → 12 种）：67 个 token 对齐。5 个半像素值（`11.5px`×28、`10.5px`×18、`12.5px`×13、`13.5px`×3、`9.5px`×1）归位到整数字号——**居中时统一取较小者**（与间距迁移同一规则）。`var(--chat-font-size)` / `calc()` / `em` 保留。
- `check_spacing_scale.js` 升级为 **`check_design_scales.js`**：一次守卫四类尺度，并新增「动效必须使用 ms」的单位断言。
- **验证**：浏览器几何回归（Playwright，390×844，3 个 UI 状态共 356 个可见元素）对「仅间距迁移」状态做前后对比：**结构差异 0**，酒馆/抽屉两态**无任何元素位移超过 8px**，设置弹窗最大 23.1px（列表内累积）。字号缩小 0.5px 未引发重排。三道负向测试（圆角 9px / 时长用 s / 字号 11.5px）均触发失败；全量 93/93。

## 2026-09-25 · 间距债务一次还清：全量对齐 2px 基尺度

- **基线测量**：`styles.css` 的间距声明用了 24 个不同的 px 值（几乎是从 1 到 16 的每个整数 + 若干散值）。其中 71% 落在 2px 网格上，**22.5%（177 处）偏离网格 1px**（3/5/7/9/11/13/15）——这才是节奏散乱的来源。
- **一次迁移**：694 条间距声明中的 **215 个 px token** 对齐到尺度 `2 4 6 8 10 12 14 16 20 24 28 32 40 48 56 64 72`（16 以下 2px 步进，16–40 为 4px 步进，40 以上 8px 步进）。保留 `0` 与 `1px` 作为非节奏值（贴边 / 发丝线 / 亚像素分隔，共 14 处）。
- 迁移是**值级等距改写**：最大位移 2px（唯一例外 `52→48` 为 4px），控件尺寸与 DOM 结构不变。`calc()` 内的数字与注释内的数字不参与迁移。
- 新增 `scripts/check_spacing_scale.js`：断言 `styles.css` 的每个间距值都落在尺度上（允许 0/1px）。1px 级偏移不会报错，但会累积成节奏散乱——与内核下限、CSS 变量同属静默退化，必须靠检查兜住。
- `check_typography.js` 的 `padding: 22px var(--chat-side-pad)` 断言同步为 `20px`。
- **验证**：真机无关的浏览器几何回归——用 Playwright 在 390×844 视口对 3 个 UI 状态（酒馆默认 / 抽屉展开 / 设置弹窗，共 356 个可见元素）做迁移前后 `getBoundingClientRect` 对比：**结构差异 0**，全部位移均为列表内 1–2px 的累积（最大 23px），无单元素自身位移超过 2px。负向测过（引入 5px 触发失败）；全量 93/93（连续三次）。

## 2026-09-25 · 修复未定义 CSS 变量 + 新增变量守卫

- **审计范围**：`styles.css` 有 43 个变量被以「无 fallback」形式引用。其中 6 个依赖 JS 运行时注入（`--chat-background-*`、`--ok-rgb`、`--ui-panel-opacity`，正常），其余应来自 CSS 定义；有 2 个两头都没有。
- 修复 `--font-mono`（未定义、12 处引用）：所有代码 / JSON 编辑面失去等宽字体——世界卡扩展编辑器、玩家 JSON、运行时高级 JSON、数组 JSON 预览、UI 自定义变量框等。补上系统本地等宽栈（末尾 generic 兜底；离线应用不允许外链字体）。
- 修复 `--border`（未定义、1 处引用）：`.message-window-control` 的 `border: 1px solid var(--border)` 整条声明失效——不仅没有边框，hover 只写 `border-color` 也无从渲染，交互反馈同时消失。改为 `--line`（同文件有 53 处以该 token 写边框）。
- 补上 `--warning`（未定义但有一处内联回退）：值取原回退 `#d8a64a`，视觉不变；随后删除该内联回退，使这处引用纳入守卫覆盖。
- 新增 `scripts/check_css_vars.js`：断言「styles.css 无 fallback 引用的变量，必须能从 CSS 定义或 JS/HTML 运行时注入得到值」。无 fallback 且未定义的引用会让**整条 CSS 声明被静默丢弃**——与「内核版本过低」属同一类静默失败，此前没有任何检查覆盖。
- `README.md` 的检查计数改为指向命令而非写死数字（该数字一轮内即过期，是文档腐坏源）。
- 验证：负向测过（引入 `var(--font-mono-x)` 触发失败）；全量 91/91。

## 2026-09-25 · 校准 Android WebView 内核下限（83 → 111）

- **发现声明与代码脱钩**：`index.html` 声明 Chromium 83，但 `styles.css` 已在使用 Chromium 111 才有的 `color-mix()`（9 处），以及 `:has()`(105)、`:is()`(88)、`inset`(87)、`aspect-ratio`(88)、`:focus-visible`(86)、flex `gap`(84)，共 274 处。83~110 的设备上这些规则被静默丢弃（布局塌陷、选中态反馈消失、背景丢失），而旧门槛是「低于 83 才提示」，这些用户看不到任何警告。
- 下限校准为 **Chromium 111**（等于代码的实际要求），未改动任何 CSS。`README.md`、`docs/android-apk.md`、`docs/project-overview.md`、`AGENTS.md` 与 `styles.css` 注释同步更新。
- 新增 **`scripts/check_webview_floor.js`**（替代 `check_webview83_compat.js`）：静态扫描前端产物，断言「声明的下限 ≥ 代码实际用到的最高特性」，并校验 `index.html` 与 `app.js` 里的两份兼容降级层逐字同步。旧检查只守 bootstrap 能否在 83 上解析，对样式兼容性零覆盖——这是脱钩长期未被发现的根因。
- 告警判定从 UA 版本号改为 **`CSS.supports` 能力检测**：版本号可被改写、降级或缺失，能力不会说谎；文案仍显示检测到的版本与平台。低于下限时提示可关闭，不阻断使用。
- 移除已过时的约束：`:is()` 使用禁令（88 < 111）、导航抽屉/遮罩/弹窗的物理四边定位强制要求、逻辑赋值语法禁令（85 < 111）。保留 44px 触控命中区、16px 输入字号、`pointer-events` 命中区等无障碍断言。
- 兼容降级层（`Array.prototype.at` / `Object.hasOwn` / `Element.replaceChildren`）**保留**：它是低于下限时用户关闭提示后继续使用的 JS 降级路径，不是死代码。`webview83CompatBootstrap` / `webview83CompatSource` 更名为 `webCompatBootstrap` / `webCompatSource`，去掉会随版本变动腐坏的数字。
- 新增负向测试验证守卫有效性：把下限调低到 90 触发「声明与代码脱钩」失败；只改一份降级层触发「两拷贝漂移」失败。

## 2026-09-19 · Android 后端单源化（内嵌 Node 运行 server.js）

- Android 端不再用 Kotlin 重写第二份后端：App 内嵌 Node.js 运行时（nodejs-mobile）直接执行与桌面端同一份 `server.js`，删除 1495 行的 `TavernServer.kt` 与 nanohttpd 依赖；PC 端改完 `server.js` 重新打包即生效，不再需要同步第二份实现。
- 新增 `android/native/node_bridge.cpp`（JNI 胶水，只负责启动 Node 与转发 stdout/stderr）、`NodeRuntime.kt`、`NodeBootstrap.kt`（解包 assets → 启动 Node → 轮询端口就绪 → 迁移旧版数据），`MainActivity.kt` 收敛为 WebView 与原生导出桥。
- 首次启动把旧版 `filesDir/data`、`filesDir/images` 迁移到新布局 `filesDir/nodejs/public/{data,images}`，仅在目标不存在时执行一次，旧目录保留以便回退；WebView localStorage（角色、会话、设置）跨升级自动保留。
- 新增 `scripts/fetch_android_node.sh`、`scripts/sync_android_assets.sh`、`scripts/build_android_apk.sh`；`libnode.so` 等二进制不入库，构建时现取，GitHub Actions 增加 NDK 安装步骤。
- 两条架构守卫：`check_android_api.js` 禁止恢复第二份后端实现、校验 JNI 符号与包名一致、确认 `server.js` 打进 APK；`check_android_protocol.js` 守卫 `server.js` 零 npm 依赖与 Node 18 API 边界。
- 移动端移除 WebView 默认点击高亮（`-webkit-tap-highlight-color`），宿主样式与两个隔离卡片 iframe 统一置为透明，交互反馈交给各控件自身的 `:hover` / `:active`。
- 体积与 ABI：APK 由 1.4 MB 增至约 19 MB（`libnode.so` 压缩后约 17 MB），仅分发 `arm64-v8a`，32 位设备与模拟器无法安装。

## 2026-09-06 · 修复预设正则解除绑定

- 修复提示词设置页中 ST 导入或预设内置正则只能显示为标签、无法卸下的问题；现在所有预设正则都可取消携带。
- 取消绑定会将最近编辑的规则移回当前模式自定义列表，并立即保存，不会因切换页面或预设而复原；缺少原自定义来源的规则也会保留。

## 2026-09-05 · 提示词缓存观测与兼容参数

- 请求管线保留稳定的预设 / 角色卡 / 世界书前缀，交给支持的 OpenAI / DeepSeek 上游自动判断提示词缓存；不在本地缓存模型回复，不会跳过新一轮生成。
- 设置 → 连接新增可选 `prompt_cache_key` 与流式 `usage` 统计开关；默认不向未知兼容端点追加流式统计参数，避免破坏旧接口。
- AI 往返终端新增缓存诊断：展示上游缓存读取、写入、未命中 Token，以及当前请求和上一次同范围请求的共同前缀估算；没有缓存字段时明确显示“上游未提供”。
- 兼容说明补充：Claude 原生 `cache_control` 与 Gemini 显式 `cachedContents` 需要各自原生 API 适配，当前 `/chat/completions` 代理不会伪造这些字段。

## 2026-09-05 · 预设正则可编辑与切换隔离

- 预设绑定的输出正则不再只读，可在「正则」栏目直接修改、保存或删除，改动会写回当前预设并保留绑定关系。
- 解除绑定时保留预设副本的最新编辑内容，避免恢复成绑定前的旧规则。
- 切换当前预设后自动刷新预设编辑对象和正则列表，只执行新预设携带的规则；上一预设的绑定正则自动卸下，不会跨预设残留。

## 2026-09-05 · 正则隔离与预设生成参数

- 修复正则替换为空后恢复原文的问题；空消息不再进入最终请求。角色卡的 `markdownOnly` 不再例外写入聊天存档，结构标签的 HTML 降级展示仅用于渲染。
- 分离正则来源与格式化目标：支持仅显示、仅提示词、两者同时开启；AI 来源规则不误处理用户/System/世界书，未选作用来源时不执行。深度 `0` 保持“最后一条”，留空或 `-1` 表示不限；Trim Out 改为每行一段。
- 请求历史可从 `rawContent` 恢复能精确匹配当前显示规则的旧版 HTML；不覆盖原存档或手工修改。不具备原始快照的旧消息无法自动还原。
- 设置页新增实际生效参数与来源、当前预设编辑入口；补齐惩罚参数数值，修复温度 `0` 被默认值覆盖、导入小数被滑条步长取整的问题。
- 预设生成参数默认展开并前移，增加就近保存按钮、继承值占位提示与上下文 Token 上限。预设优先于连接默认值和全局停止词，思考开关不再静默提高回复 Token 预算；`stop: []` 可禁用全局停止词。
- `openai_max_context` 扣除回复预算后按本地 Token 估算移除最旧历史回合；保留本轮输入与提示词，预算不足时明确报错，不截断消息、不追加模型请求。该估算与模型实际分词可能不同。
- 增加正则目标组合、旧历史隔离、预设导入/编辑/请求往返、参数显示与上下文保留回归检查；共用前端及 PWA 资源版本更新，Android 打包同步带入。

## 2026-09-05 · 紧凑顶栏与透明 UI

- 聊天顶栏改为单排：缩小留白与字号、限制会话按钮宽度、长角色名称省略显示，移动端菜单按钮保留至少 44 px 点击区域。
- 清空对话、终端和开发者入口收进原生「⋯」展开菜单；支持外部点击 / Escape 关闭，与导航、会话菜单互斥，终端关闭后焦点回到可见入口。
- 设置的「界面」页新增透明 UI 开关和 0–100% 透明度，默认关闭；启用时背景延伸到整个聊天工作区，调整顶栏、输入区、普通消息气泡和 RPG 宿主面板的底色，文字不变透明。
- 透明度即时预览并自动保存，保存失败可重试；独立于主题和背景选择，关闭透明 UI 恢复常规面板。世界卡自有界面保持自身样式。
- 顶栏间距使用 WebView 83 支持的 margin；同步更新前端 / PWA 资源版本。

## 2026-09-05 · 自定义聊天背景

- 设置的「界面」页新增聊天背景：导入本地 PNG / JPG / WebP / GIF（最大 12 MB）、实时预览、开关、移除、铺满 / 完整显示、对齐位置与遮罩调节。
- 背景图通过桌面和 Android 共用的图片接口保存到本机，设置仅记录图片路径；刷新、重启后恢复，不进入模型请求或聊天历史。
- RP / RPG 普通聊天区共用背景，主题切换保留背景选择；不向世界卡自带的 iframe 界面注入样式。
- 无效图片、导入失败保留原背景；导入中移除不会被迟到的上传结果覆盖；设置保存失败可重试。

## 2026-09-05 · RP 单次请求与 char 格式引导

- 移除 RP 选项掉格式后的自动纠正请求；缺标签、JSON 错误或数量不足时保留正文，不追加模型调用，也不伪造按钮。
- 回复选项开启时在请求末尾合成一条 char（Assistant）承诺消息；可编辑、支持数量占位符，和已有 assistant_prefill 合成一条，仅用于请求，不显示、不存档、不进入摘要。
- 普通角色卡、示例或提示词提到选项标签，不再使正式选项协议被误跳过；RPG 协议修复保持不变。
- 新增流式/非流式单次请求、合法与损坏输出、开关、数量和历史隔离回归测试。

## 2026-09-04 · RP Prompt Manager 架构对齐

### 新增

- 提示词预设升级为 v3，以 `prompts + promptOrder` 作为唯一顺序和开关来源；固定可编辑提示词与运行时 Marker 分离。
- 预设编辑器增加 ST 采样参数、世界书/场景/性格格式模板、新聊天/示例提示和 assistant prefill 设置。
- ST 导入/导出保留多个 Prompt Order Profile，并正确区分 `system_prompt` 固定项与 `marker` 动态项。

### 修复

- 删除无法单独关闭的全局对白输出协议和 `tavernFormat` 隐式注入；旧内置 `protocol` 模块在迁移时定向清理。
- Post-History 改为列表内可见、可编辑、可排序、可关闭的 `jailbreak`；世界书 Before/After、示例位置和 At Depth 进入对应消息位置。
- 当前预设的采样参数与 Utility Prompt 设置会实际进入请求；世界书槽位关闭后不再通过隐藏兜底重新注入。
- 旧全局 main/Post-History、v1/v2 预设和旧回复选项协议自动迁移；旧 `formatCustom` 变成可关闭的普通提示词，保留用户自定义内容与当前未回复输入。

## 2026-09-03 · RP 回复选项与当前回合结构

### 新增

- 酒馆/通用提示词预设可分别开启或关闭回复选项、设置每轮 1–8 个选项并自定义偏好提示词；未修改的预设继续继承项目默认。
- ST 预设在 `tavern_meta.replyOptions` 中保留该配置；旧 `postHistory` 尾部协议会迁入独立字段。

### 修复

- 自定义提示词遗漏 `<tavern_options>` 时自动补入默认机器协议，避免界面显示已开启却无法解析选项。
- 默认机器协议移除固定四项示例，避免与用户选择的 1–8 项数量互相矛盾。
- 保存纯 RPG 预设时不再由禁用的 RP 控件生成 `replyOptions`；RPG 状态与行动选项协议保持独立。
- RP 请求明确拆分旧历史与当前玩家回合；历史关闭/裁剪、自动摘要、连续待回复输入和骰点记录不再挤掉当前输入，`meta` 记录也不再覆盖 `{{lastMessage}}`。

## 2026-09-04 · 原创代码改为非商用许可

### 许可

- 自本次变更起，A2th0 拥有版权的 BigDogTavern 原创代码改用 PolyForm Noncommercial License 1.0.0。
- 明确个人学习、研究、测试、私人娱乐、爱好项目和许可证列明的非商业组织用途可以继续使用、修改及分发代码；其他用途需要另行取得书面商业授权。
- 保留截至提交 `984446947993c7177bd7fb0c3dc133f1637a099b` 的 MIT 许可文本与历史授权说明；本次变更不追溯撤销旧版本已经授予的 MIT 权限。
- 明确 `public/vendor/` 中的 marked、DOMPurify、MapGen2 及其依赖继续适用各自的第三方许可证，用户自行创建或导入的内容不受项目代码许可证约束。

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
