# World App Contract（世界卡应用契约）

> 状态：W1 runtime 垂直切片已实现。本文描述当前代码证据与后续契约，未实现的扩展仍以明确的兼容边界标注。
>
> 目标：让世界卡从“固定 RPG 页面的一组配置”逐步成为一个可自定义、可保存、可恢复、可隔离的独立叙事应用包。

## 1. 设计边界

世界卡可以定义世界内容、AI 行为、存档状态和界面；世界存档只保存这一局已经发生的正式事实。角色卡仍然是酒馆模式的内容对象，不自动成为 RPG 世界的主入口。

```text
WorldCard(worldId, worldVersion)
├─ setting / rules / locations / NPC
├─ lorebookIds / rpgPresetName / regexes
├─ agent profile / ui declaration / extension
└─ package assets
          │ 创建时快照
          ▼
WorldSave(saveId, worldId, worldVersion, revision)
├─ player snapshot / party
├─ state / runtime values / NPC states
├─ opening / turns / receipts / event ledger
├─ derived memory / summary / UI projection
└─ agentRuntime（短暂协调信息，不是第二状态源）
```

不可违反的不变量：

1. 世界定义只由 `worldId + worldVersion` 定位；变化事实只由 `saveId + revision` 定位。
2. 角色卡对话只由 `charId + chatSessionId` 定位；世界模式不得从 `currentCharId` 推断存档。
3. UI、AI 原始输出、Memory 和摘要都不能直接成为正式状态；只有校验后的提交结果能改变 `WorldSave`。
4. 卡内界面只读取当前存档投影；不能读取其他世界、存档、API key 或本机文件。
5. 未知字段和未知扩展不能静默删除，必须标记为“保留但未执行”或“需要转换”。

## 2. 当前代码基线

| 能力 | 当前 owner / 入口 | 当前状态 |
|---|---|---|
| 世界版本 | `server.js` 的 `worlds.json`、`worldVersion` | 已实现；存档钉住版本 |
| 世界草稿 | `world-drafts.json`、草稿校验与发布接口 | 已实现 |
| 世界存档 | `saves/<saveId>.json`、`revision`、CAS 写入 | 已实现 |
| 世界书 / 预设 / 正则 | `lorebookIds`、`rpgPresetName`、`regexes` | 已绑定；按世界版本读取 |
| RPG 状态 | 角色、属性、资源、地点、时间与世界卡声明的 runtime | 新世界卡唯一正式状态；物品、任务、关系等自定义数据走 runtime |
| Agent | `agent` profile、`agent-execute` / `agentPhase` | 已实现工具候选 / 原生循环 |
| 自定义 UI | `ui.sidebar` / `ui.extension` | 已实现有限数据源；只能提交玩家行动 |
| 旧卡脚本 | 绑定角色卡中的 HTML/CSS/JS；预设中的 EJS、MVU、脚本 | 角色卡脚本需用户授权后在同源完整兼容 iframe 中运行，可访问宿主 DOM、localStorage、外部脚本和网络；预设脚本与模板保留但不执行 |
| 世界包 | `tavern_world_package` 导入 / 导出 | 已实现；未知可执行内容不执行 |

当前扩展桥接入口为 `TavernExtension`：

- `requestContext()`：读取当前世界和当前存档的白名单投影；
- `choose(text, options)`：复用普通 RPG 回合管线；卡内 UI 只提交玩家行动，runtime 变量/集合/动作由 AI 回合统一产生 Typed Patch。
- `fullscreen()`：由卡内按钮请求浏览器全屏；失败时仍保持整页沉浸视图；
- `exitFullscreen()`：退出浏览器全屏和沉浸布局，恢复窗口化卡内界面；Esc 使用同一退出路径；
- `exitWorld()`：退出当前世界工作区，回到世界库；适用于世界卡隐藏宿主导航时提供卡内返回入口。
- `openTerminal()`：打开宿主 AI 往返终端；适用于卡内隐藏顶栏后仍保留调试入口。

绑定角色卡脚本另有一组只读 ST 兼容快照接口：`getLastMessageId()`、`getCurrentMessageId()`、`getChatMessages(range)`、`getAllChatMessages()`、`getCharWorldbookNames()`、`getWorldbook(name)` 和 `getCurrentChatId()`。快照在角色卡消息渲染时注入，只包含当前 Tavern 会话及绑定角色书；完整兼容 iframe 另提供宿主 DOM、localStorage、外部脚本、网络和原生 `alert()`，因此依赖这些同步接口或卡内资源的“加载本卡设置”类脚本可以运行。角色卡脚本仅在用户明确确认后启用；世界卡 `ui.extension` 仍维持 sandbox 边界。

现有 `ui.extension` 是 W1 的兼容入口，不立即删除或改名。新的 UI 插槽和权限契约必须能从旧扩展配置降级出来。游玩阶段的 `getContext()` / `runtime.get()` 只读 runtime 快照；状态变化统一进入 AI 的声明式 runtime patch，避免扩展脚本绕过回合与存档 CAS。

## 3. World App Package 草案

当前世界包继续使用：

```json
{
  "spec": "tavern_world_package",
  "specVersion": 1,
  "manifest": {
    "appContractVersion": 1,
    "capabilities": {}
  },
  "content": {
    "world": {},
    "characters": [],
    "lorebooks": {},
    "presets": {}
  },
  "assets": []
}
```

`manifest.appContractVersion` 是世界应用契约版本，当前为 `1`；缺失时按旧包兼容处理，未来版本高于宿主能力会拒绝导入。导出时同时写入 `capabilities`，只描述包声明了哪些 UI、Agent、正则和引用能力，不包含运行时状态。

当前实现扩展 `content.world` 的已知字段，不另起第二份状态仓库。目标结构如下：

```json
{
  "schemaVersion": 1,
  "world": {},
  "lorebookIds": [],
  "rpgPresetName": "",
  "regexes": [],
  "runtime": {},
  "agent": {},
  "ui": {
    "schemaVersion": 1,
    "layout": "host",
    "theme": {},
    "slots": {},
    "regions": {},
    "sidebar": { "panels": [] },
    "extension": {},
    "entryGate": {}
  },
  "assets": []
}
```

字段规则：

- `lorebookIds`、`rpgPresetName`、`regexes` 是当前世界版本的 AI 依赖快照；不会读取酒馆模式当前选择。
- runtime 属于新世界卡契约：世界卡声明变量、集合、动作和 entry schema，存档只保存按该 schema 初始化并经回合校验后的 runtime state。旧的物品、任务、地图、势力、成长硬编码投影仅作兼容读取，不再作为世界卡的写入入口。
- `ui` 定义界面和权限，不保存对话或正式数值；自定义侧栏可读取 `runtime.variables.*` / `runtime.collections.*` 的当前存档投影。
- `ui.schemaVersion` 当前为 `1`；缺失按旧格式兼容，未知版本拒绝发布。
- `assets` 只允许受校验的相对路径 / 数据资源引用；不允许本机绝对路径和带认证参数的 URL。
- 导入必须保留原始包、来源、版本和哈希；确认后才命名空间化落库。
- 导入旧包时仅在内存映射阶段补齐缺省的 `ui`、`agent`、`regexes` 和引用数组；原始封存文本与内容哈希不改写。

## 4. 自定义 UI 契约

宿主 UI 按五级组织；三级区域按声明选择渲染策略，允许世界卡局部接管而不必整页替换：

```text
一级  app shell       全局导航、移动抽屉、设置/终端/确认覆盖层（宿主）
二级  workspace       Tavern / RPG / 世界库等视图路由（宿主）
三级  workspace slots  顶栏、叙事、侧栏、状态、选项、输入（宿主或世界卡）
四级  components       卡片、列表、按钮、表单、消息和滚动容器（当前渲染 owner）
五级  bridge            投影读取、统一回合与选项提交（宿主校验）
```

移动端不改变这五级归属，但把同级管理器收敛为“父级列表 → 子级详情”的钻取流程；列表和详情顶部都固定显示返回条，详情返回只回到上一级，嵌套的预设条目与世界书条目继续使用各自的二级返回；玩家设定页先显示设定列表，再从顶部按钮进入记忆条目。

`ui.layout:"custom"` 仍是完整扩展的兼容模式：它接管 RPG 的三级工作区；默认保留一级应用导航，但可由 `ui.shell.navigation:"hide"` / `ui.shell.topbar:"hide"` 在当前世界工作区隐藏。浏览器全屏后会连应用级导航一起隐藏；Esc 按 `ui.shell.escape` 统一退出沉浸、返回世界库或保持不变（`none`）。需要局部接管时使用 `ui.regions`；旧卡的 `ui.slots` 继续有效，并会映射为同名区域的 `decorate` / `hide` 策略。

`layout` 仍接受旧卡的自定义标识（例如 `world-desk`），但只有 `host`、`immersive`、`custom` 会触发当前宿主布局策略；未知标识按宿主布局处理，不会阻断旧世界卡导入。

完整的字段示例、四种区域模式、主题 Token、声明式侧栏、扩展桥和无障碍约束见 [docs/ui-beauty-declaration.md](ui-beauty-declaration.md)。

世界卡可以声明共用 CSS Token，作用于宿主投影和卡内 sandbox：

```json
{
  "ui": {
    "theme": {
      "tokens": {
        "accent": "#77e6d5",
        "accent-rgb": "119,230,213",
        "panel": "#10262d"
      }
    }
  }
}
```

Token 名称和值会经过服务端和客户端限制；不允许外链、脚本协议或 CSS 块注入。未声明主题时继承 Tavern 的黑色 macOS 基础主题。

目标插槽：

```text
shell
├─ topbar
├─ sidebar.left
├─ narrative
├─ options
├─ input
├─ sidebar.right
├─ status
└─ overlay
```

每个插槽只能做三类事情：

1. 渲染当前存档的只读投影；
2. 发出声明式 UI Command；
3. 请求进入统一 AI / Agent 回合。

UI 不直接写 `WorldSave`。卡内控件应通过稳定绑定描述数据源，例如：

```json
{
  "id": "shop",
  "slot": "sidebar.right",
  "source": "state.player",
  "layout": "cards",
  "actions": [{ "type": "player.choose", "text": "查看状态" }]
}
```

宿主支持通过 `ui.regions` 控制固定三级插槽：`topbar`、`sidebar.left`、`narrative`、`options`、`input`、`sidebar.right`、`status`、`overlay`。每个区域可以独立声明四种模式，因此它们可以在同一张世界卡中共存：

| 模式 | 宿主行为 | 适用场景 |
|---|---|---|
| `decorate` | 保留宿主内容，并应用世界卡主题/区域元数据 | 只改颜色、标签、间距或外观 |
| `replace` | 标记该区域由世界卡组件负责，保留宿主安全回退 | 世界卡提供自己的叙事/侧栏/选项组件 |
| `append` | 保留宿主内容，同时声明世界卡组件可追加内容 | 在原有选项或状态旁增加卡专属信息 |
| `hide` | 隐藏宿主区域但保留 DOM 和状态，离开世界卡后恢复 | 卡内完全接管输入、选项或侧栏 |

示例：

```json
{
  "ui": {
    "regions": {
      "topbar": { "mode": "decorate", "label": "世界时间" },
      "sidebar.left": { "mode": "append", "component": "character-panel" },
      "narrative": { "mode": "replace", "component": "world-narrative", "fallback": "host" },
      "options": { "mode": "append", "component": "choice-deck" },
      "input": { "mode": "hide", "fallback": "host" }
    }
  }
}
```

`component` 是受限组件 ID（不是 HTML/JS），作为世界卡扩展/宿主声明式面板之间的稳定标识；本轮不会把一个 sandbox iframe 自动拆分注入多个主页面区域，卡内前端仍通过现有 `ui.extension` 或 `ui.sidebar.panels` 实现具体内容。当前没有可用组件时默认保留宿主，避免出现空白工作区；`fallback:"empty"` 先作为协议保留，待组件注册表启用后生效；不会在主页面执行卡内脚本。

旧字段 `ui.slots` 仍可控制这些插槽的显示与无障碍标签：未声明的插槽保持宿主默认；声明 `visible:false` 会映射为 `hide`。若需要让卡内前端统一接管 RPG 工作区，使用 `ui.layout:"custom"` 或 `ui.extension.immersive:true`；`custom` 会隐藏宿主 RPG 的同级工作区（叙事、状态、选项、输入和 RPG 两侧栏）。默认保留应用级导航；若卡声明 `ui.shell.navigation:"hide"` / `ui.shell.topbar:"hide"`，窗口化时也隐藏对应宿主壳层，卡内通过 `TavernExtension.exitWorld()` 返回世界库；卡内请求浏览器全屏后会连应用级导航一起隐藏，Esc 按 `ui.shell.escape` 回到窗口化 custom 或退出世界。消息接口以 `data-tavern-messages` 为唯一记录流；同一页面同时声明 `data-tavern-narrative` 时，后者默认隐藏（除非设置 `data-tavern-allow-duplicate="true"`），避免重复叙事与嵌套滚动条。

旧配置兼容：

- `ui.sidebar.panels` 继续由宿主声明式渲染；
- `ui.extension` 继续作为完整自定义界面的 sandbox 入口；
- `data-tavern-messages`、`data-tavern-narrative`、`data-tavern-options`、`data-tavern-input` 等标记继续有效；消息与叙事会提供已安全清洗的 Markdown HTML，卡内可用单一消息流自行控制滚动；
- `data-tavern-bind="save.state.player.resources.hp"` 将白名单投影写入 `textContent`，`data-tavern-show="turn.canChoose"` 控制显示；路径只允许有限层级的对象键，绑定不会执行表达式或写入主页面。
- 扩展脚本可用 `TavernExtension.on(name, handler)` 监听 `turn.start`、`agent.execute`、`agent.complete`、`turn.commit`、`turn.error`；事件只发送脱敏的回合号、版本、工具状态或错误摘要，不携带工具结果与隐藏世界数据。
- 新插槽缺失时回退到当前宿主 RPG 布局；扩展加载失败时不能让存档无法打开。
- ST 世界书的 `entries` 数组 / 对象及 `worldInfo`、`world_info`、`data` 包装在读取时统一映射；读取兼容不会改写原始 JSON，条目正则、选择性关键词和常用高级字段继续交给既有匹配器。

## 5. 状态与绑定契约

状态作用域固定为：

| 作用域 | 例子 | 是否进入存档 |
|---|---|---|
| `world` | 世界天气、全局事件 | 由世界版本定义；变化写入当前存档投影 |
| `save` | 商城库存、任务、地点 | 是 |
| `player` | 玩家属性、技能、资源 | 是 |
| `session` | 当前回合 pending、输入草稿 | 仅运行时 / 可恢复协调信息 |
| `ui` | 当前弹窗、选中页签 | 否，可重建 |

所有修改必须经过：

```text
UI / Agent action
→ commandId + saveId + expectedRevision
→ Typed Patch / action Schema 校验
→ 权限与世界版本校验
→ 原子写入 WorldSave
→ revision + receipt
→ UI projection / history / memory
```

禁止：

- 任意 JSON Path 写入；
- 用正文暗示替代状态提交；
- 客户端自带 `saveId` 覆盖目标存档；
- 由扩展脚本直接改全局变量；
- 将一个存档的 UI 缓存复用于另一个存档。

## 6. 脚本、模板与权限

### 6.1 三档执行策略

| 模式 | 默认 | 能力 |
|---|---:|---|
| 声明式 | 开启 | HTML 片段、CSS、数据绑定、动作描述 |
| sandbox | 关闭，首次询问 | 世界卡 `ui.extension` 的隔离 JS / 桥接 MVU |
| 角色卡完整兼容 | 关闭，首次询问 | 绑定角色卡的同源 HTML/CSS/JS、外部依赖、宿主 DOM、localStorage、网络与 ST 兼容桥 |
| 主页面任意脚本 | 永不默认开启 | 当前项目不提供 |

授权规则：

- 首次检测到扩展脚本、MVU 或 EJS 标记时询问；
- 授权只对当前世界版本和扩展代码哈希生效；
- iframe 使用 `sandbox="allow-scripts"` 和 CSP；
- 不提供 `allow-same-origin`、网络、文件系统、主页面 DOM 或 API key；
- 只读投影与玩家行动提交分开处理；不提供状态/变量写入桥；
- 扩展超时、异常或权限失败时只停用扩展，不污染存档。

### 6.2 EJS / MVU 兼容边界

- 角色卡中的 HTML/CSS/JS：首次显示前需用户授权，在同源完整兼容 iframe 中运行；角色卡可使用宿主 DOM、localStorage、外部脚本、网络和原生 `alert()`；预设中的 EJS / MVU / 脚本仍保存、导出并标记为不执行；
- 角色卡 EJS / MVU 模板：只保留原文，不解释模板变量；脚本提供 ST 兼容桥：`triggerSlash('/send …|/trigger')`、`copyToTavernDialog(text)`、`TavernCard.send/copy` 分别发送到当前 Tavern 对话或填入输入框，并注入当前对话/角色书的只读快照；
- 世界卡中的 EJS：第一阶段只做安全模板子集或原文保留，不执行任意 Node/EJS 代码；
- 世界卡中的 MVU：保留原文用于兼容展示；游玩态扩展可读取 runtime，但不直接写入。变量、集合和 Typed Patch 由世界卡 schema 声明，并由 AI 回合提交。
- 世界卡扩展的交互脚本只能走授权后的 sandbox Bridge；角色卡脚本则走用户确认后的完整兼容 iframe。

角色卡完整兼容模式不使用 `sandbox` 或 `connect-src 'none'`，因为部分 ST 卡依赖 `parent.document`、localStorage、外部 CDN、卡内相对路径和网络请求。它仍要求逐卡确认，并只接受 `http:` / `https:` 外部脚本 URL；不要导入不可信角色卡。该模式不等于把脚本直接拼进宿主主页面，卡内代码仍位于独立 iframe 文档中。

兼容报告必须区分：`完整支持`、`映射但有差异`、`保留但不执行`、`需要人工转换`、`存在风险并隔离`。

## 7. AI / Agent 生命周期

```text
加载 WorldCard@version
→ 读取当前 WorldSave@revision
→ 组装世界书 / Preset / Regex / Agent 上下文
→ 玩家输入或卡内 UI Command
→ Agent observe / decide / execute
→ 工具结果回传模型
→ CandidateTurn（正文、选项、候选变化）
→ 服务端校验并提交
→ 更新世界 UI 与派生层
```

世界卡可以声明：

- Agent 最大步骤数和允许工具；
- 选项数量与输出标签；
- 是否允许创建 NPC、地点；
- 是否需要骰子或规则检查；
- 回合后触发哪些声明式动作。

但 AI 不能获得状态写入权限。工具和 Patch 的最终校验永远在客户端 / 服务端统一入口完成。

## 8. 版本与迁移

- 世界定义发布后形成不可变 `worldVersion`；
- 现有存档继续读取旧版本；
- 新 UI 字段必须提供默认值或迁移函数；
- 升级前先 dry-run，列出缺失 ID、字段变化、权限变化和脚本风险；
- 迁移成功才更新 `worldVersion` 与 `revision`；
- 导入失败、用户取消或扩展校验失败不得写入活动世界。

## 9. W0 验收基线

以下现有检查必须保持通过：

- `node scripts/check_rpg_minimal_world.js`
- `node scripts/check_rpg_agent.js`
- `node scripts/check_rpg_agent_compat.js`
- `node scripts/check_session_binding.js`
- `node --check public/app.js`
- `node --check server.js`

浏览器基线：

1. 世界卡创建两个存档，切换后 UI、状态、回合和扩展上下文不串；
2. 拒绝世界扩展授权时，存档仍能正常打开；
3. 授权后扩展只能读取当前投影并通过 Bridge 提交；
4. 切换到酒馆模式会卸载 iframe，不残留世界 UI；
5. 刷新后世界版本、存档 revision 和扩展授权状态一致恢复。

## 10. 后续变更顺序

W1 先实现 Package Normalizer、校验和兼容迁移；W2 再实现 UI 插槽；W3 统一 MVU / Typed Patch；W4 扩展脚本权限与模板；W5 接入 Agent 事件；W6 扩大 ST 映射范围。任何阶段都不另起一套保存系统，也不修改酒馆模式的 `ChatSession` owner。
