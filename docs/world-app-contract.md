# World App Contract（世界卡应用契约）

> 状态：W0 基线冻结 / W1 设计输入。本文描述当前代码证据与下一阶段契约，不代表所有目标能力已经实现。
>
> 目标：让世界卡从“固定 RPG 页面的一组配置”逐步成为一个可自定义、可保存、可恢复、可隔离的独立叙事应用包。

## 1. 设计边界

世界卡可以定义世界内容、AI 行为、存档状态和界面；世界存档只保存这一局已经发生的正式事实。角色卡仍然是酒馆模式的内容对象，不自动成为 RPG 世界的主入口。

```text
WorldCard(worldId, worldVersion)
├─ setting / rules / locations / NPC / factions
├─ lorebookIds / rpgPresetName / regexes
├─ runtime schema / agent profile
├─ ui declaration / sandbox extension
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
| runtime | `runtime.variables / collections / actions` 与服务端 Typed Patch | 已实现受限 JSON DSL |
| Agent | `agent` profile、`agent-execute` / `agentPhase` | 已实现工具候选 / 原生循环 |
| 自定义 UI | `ui.sidebar` 声明式面板 | 已实现有限数据源 |
| 扩展 UI | `ui.extension` HTML/CSS/JS/MVU + sandbox iframe | 已实现；首次授权后运行 |
| 旧卡脚本 | 角色卡 / 预设中的 EJS、MVU、脚本 | 保留但不执行 |
| 世界包 | `tavern_world_package` 导入 / 导出 | 已实现；未知可执行内容不执行 |

当前扩展桥接入口为 `TavernExtension`：

- `requestContext()`：读取当前世界和当前存档的白名单投影；
- `patch(updates)`：提交受限 runtime Patch；
- `action(actionId, input)`：调用世界卡声明式动作；
- `choose(text, options)`：复用普通 RPG 回合管线；
- `mvu(message)`：把兼容消息映射到受限 runtime 更新。

现有 `ui.extension` 是 W1 的兼容入口，不立即删除或改名。新的 UI 插槽和权限契约必须能从旧扩展配置降级出来。

## 3. World App Package 草案

当前世界包继续使用：

```json
{
  "spec": "tavern_world_package",
  "specVersion": 1,
  "manifest": {},
  "content": {
    "world": {},
    "characters": [],
    "lorebooks": {},
    "presets": {}
  },
  "assets": []
}
```

W1 只扩展 `content.world` 的已知字段，不另起第二份状态仓库。目标结构如下：

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
    "layout": "host | immersive | custom",
    "theme": {},
    "slots": {},
    "sidebar": { "panels": [] },
    "extension": {}
  },
  "assets": []
}
```

字段规则：

- `lorebookIds`、`rpgPresetName`、`regexes` 是当前世界版本的 AI 依赖快照；不会读取酒馆模式当前选择。
- `runtime` 只定义 Schema；本局的值在创建存档时复制到 `WorldSave.state.runtime`。
- `ui` 定义界面和权限，不保存对话或正式数值。
- `assets` 只允许受校验的相对路径 / 数据资源引用；不允许本机绝对路径和带认证参数的 URL。
- 导入必须保留原始包、来源、版本和哈希；确认后才命名空间化落库。

## 4. 自定义 UI 契约

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
  "source": "runtime.collections.shop",
  "layout": "cards",
  "actions": [{ "type": "runtime.action", "actionId": "buy" }]
}
```

旧配置兼容：

- `ui.sidebar.panels` 继续由宿主声明式渲染；
- `ui.extension` 继续作为完整自定义界面的 sandbox 入口；
- `data-tavern-narrative`、`data-tavern-options`、`data-tavern-input` 等标记继续有效；
- 新插槽缺失时回退到当前宿主 RPG 布局；扩展加载失败时不能让存档无法打开。

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
| 主页面任意脚本 | 永不默认开启 | 当前项目不提供 |

授权规则：

- 首次检测到扩展脚本、MVU 或 EJS 标记时询问；
- 授权只对当前世界版本和扩展代码哈希生效；
- iframe 使用 `sandbox="allow-scripts"` 和 CSP；
- 不提供 `allow-same-origin`、网络、文件系统、主页面 DOM 或 API key；
- `read.*`、`write.runtime`、`tool.call` 分开授权；
- 扩展超时、异常或权限失败时只停用扩展，不污染存档。

### 6.2 EJS / MVU 兼容边界

- 角色卡、预设中的 EJS / MVU / 脚本：保存、导出、兼容报告，默认不执行；
- 世界卡中的 EJS：第一阶段只做安全模板子集或原文保留，不执行任意 Node/EJS 代码；
- 世界卡中的 MVU：映射到受限变量、集合和 Typed Patch，不实现无限制 `eval`；
- 真正的交互脚本只能走授权后的 sandbox Bridge。

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
- 是否允许创建 NPC、地点、任务、物品；
- 是否需要骰子或规则检查；
- 回合后触发哪些声明式动作。

但 AI 不能获得状态写入权限。工具和 Patch 的最终校验永远在客户端 / 服务端统一入口完成。

## 8. 版本与迁移

- 世界定义发布后形成不可变 `worldVersion`；
- 现有存档继续读取旧版本；
- 新 UI / runtime 字段必须提供默认值或迁移函数；
- 升级前先 dry-run，列出缺失 ID、字段变化、权限变化和脚本风险；
- 迁移成功才更新 `worldVersion` 与 `revision`；
- 导入失败、用户取消或扩展校验失败不得写入活动世界。

## 9. W0 验收基线

以下现有检查必须保持通过：

- `node scripts/check_world_storage.js`
- `node scripts/check_world_electronic_yandere.js`
- `node scripts/check_rpg_extension.js`
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
