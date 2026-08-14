# RPG 开局规划阶段：设计细纲与任务拆分

状态：核心流程已实现；本文保留为契约与扩展说明
范围：RPG 世界存档创建、玩家建角、开局规划、AI 开场候选、确认提交、恢复与兼容
不在本阶段：重做常规回合、战斗系统、世界书系统、地图算法、关系系统

## 1. 当前问题

当前流程已改为：创建 planning 存档 → 动态角色与 Build 配置 → 保存本局游戏规则 → 规划 Opening Scenario → AI 生成候选 → 玩家编辑/确认 → 初始化 Save State → 进入正式世界桌面。`generateWorldOpening()` 只写入 `setup.candidate`，`/api/world-saves/<saveId>/opening` 才会原子提交正式开场。

因此存在四个问题：

1. 玩家没有确认起始地点、在场 NPC、局势、钩子和已知信息。
2. AI 生成结果直接成为正式事实，没有“候选/预览”阶段。
3. AI 生成失败后，存档虽然存在，但界面没有完整的可恢复规划流程。
4. 玩家无法编辑、重生成或拒绝开场后再开始正式回合。

## 2. 目标体验

```text
选择世界卡与存档名
→ 创建待开局存档
→ 角色确认
→ 开局规划
→ AI 生成候选开场
→ 玩家编辑 / 重生成 / 确认
→ 原子提交正式开场
→ 进入首个正式回合
```

完成标准：玩家未点击“确认开局”前，不能发送常规回合，不能推进时间，不能产生正式事件、记忆或状态变化。

## 3. 玩家可见流程细纲

### 3.1 第一步：角色确认

复用世界卡 `playerCreation` 动态表单，不新增写死字段。

- 显示：名字、种族、身份、背景、自定义字段、属性、技能、资源、特质、初始关系。
- 显示世界卡给出的默认值与预算。
- 提交后生成当前存档独立的 `player.snapshot` 与 `state.player`。
- 不写回普通角色库，也不影响同一世界的其他存档。
- 在进入下一步前提供完整预览和返回修改入口。

### 3.2 第二步：开局规划

最小规划字段：

| 字段 | 来源与约束 | 用途 |
|---|---|---|
| `locationId` | 只能来自当前世界版本登记地点；默认 `world.start.locationId` | 起始地点与 NPC 作用域 |
| `presentNpcIds` | 只能来自当前世界版本 NPC；允许为空 | 开场在场角色 |
| `situation` | 玩家填写或使用世界卡默认 | 开场正在发生什么 |
| `hook` | 玩家填写、世界卡默认或 AI 建议 | 第一轮可行动矛盾 |
| `knownFacts` | 文本数组，默认只含公开事实 | 玩家开局已知内容 |
| `boundaries` | 文本数组 | 禁止 AI 替玩家决定的过去、关系与行动 |
| `tone` | 世界卡选项或自由文本 | 日常、冒险、悬疑、混合等节奏偏好 |

世界卡可以锁定地点或在场 NPC；被锁定时只展示说明，不提供无效选择。没有可选配置时直接使用世界卡默认，不制造空表单。

### 3.3 第三步：候选开场

AI 输出为独立的开场候选，不使用常规 `<tavern_state_update>`，不允许携带状态变化。

候选至少包含：

```json
{
  "narrative": "开场正文",
  "options": ["选项1", "选项2", "选项3", "选项4"],
  "locationId": "登记地点 ID",
  "presentNpcIds": ["登记 NPC ID"],
  "situation": "本幕局势",
  "hook": "立即可回应的钩子"
}
```

玩家可执行：

- 返回修改规划。
- 编辑开场正文。
- 重新生成候选。
- 使用世界卡静态开场。
- 确认开局。
- 退出并稍后继续；存档在世界库标为“待开局”。

### 3.4 确认与进入游戏

点击“确认开局”后一次原子提交：

- 固化 `openingPlan`。
- 固化 `opening` 与 `openingOptions`。
- 写入唯一 opening receipt 与 eventLedger。
- 将存档从 `planning` 变为 `active`。
- revision 只增加一次。
- 第一条玩家输入才是第一个普通 RPG 回合。

## 4. 状态与所有权

### 4.1 WorldCard

拥有可复用默认内容：允许的起始地点、默认在场 NPC、静态开场、可选 tone、开局约束。发布后随 `worldVersion` 固定。

### 4.2 WorldSave

拥有当前存档事实：玩家快照、规划选择、正式开场、地图、状态、NPC 状态和后续回合。

建议增加：

```js
setup: {
  status: 'planning' | 'active',
  plan: {
    locationId,
    presentNpcIds,
    situation,
    hook,
    knownFacts,
    boundaries,
    tone,
  },
  candidate: null | {
    narrative,
    options,
    generatedAt,
  },
}
```

`setup.candidate` 是明确标注的未提交候选，不进入 `state`、`turns`、Memory 或 eventLedger。确认后可以清理候选，只保留已确认计划和正式 opening。

### 4.3 生命周期不变量

- `planning`：允许保存规划、生成候选、编辑候选；禁止常规回合。
- `active`：允许常规回合；禁止重新覆盖 opening。
- AI 响应、流式文本和解析结果都不是正式事实。
- opening 提交必须校验当前 saveId、worldVersion、revision、地点和 NPC ID。
- 相同 opening `commandId` 重试返回同一结果，不能重复提升 revision。

## 5. Prompt 与输出协议

### 5.1 开局 Prompt 注入顺序

1. DM 身份与玩家主权。
2. 当前世界卡稳定设定与硬规则。
3. 当前世界书命中内容。
4. 当前存档玩家快照。
5. 已确认的开局规划。
6. 起始地点与在场 NPC 的公开资料。
7. 开场候选协议。

禁止注入其他存档的地图、NPC 状态、关系、记忆或候选开场。

### 5.2 开场候选校验

- 恰好一份候选对象。
- 正文非空且不超过配置上限。
- 恰好四个不重复的具体选项。
- `locationId` 与规划一致。
- `presentNpcIds` 是规划允许集合的子集。
- 不含 typed patch、资源变化、任务变化或正式事件。
- 不替玩家补写核心过去、台词、感情和不可逆行动。

## 6. API 与提交边界

### 6.1 创建存档

`POST /api/world-saves` 创建 `setup.status=planning` 的存档，保存已校验玩家快照和世界卡初始状态，但不开启普通回合。

### 6.2 保存规划

增加或扩展一个受 revision/命令保护的 setup 写入口，负责：

- 校验当前存档仍是 planning。
- 校验地点与 NPC 属于当前世界版本。
- 保存玩家明确确认的规划字段。
- 不写入 eventLedger，不推进世界时间。

### 6.3 生成候选

生成仍走现有模型网关，但请求上下文来自当前 planning save 与 plan。生成失败只更新错误状态，不修改正式 opening、state、turns、eventLedger 或 Memory。

### 6.4 确认开局

扩展现有 `/opening`：

- 只接受 planning 存档。
- 同时提交已确认 plan、opening 和 options。
- 进行 ID、长度、选项、revision 和 commandId 校验。
- 原子写入并切换为 active。
- 已 active 的存档拒绝覆盖开场。

## 7. UI 细纲

### 7.1 桌面

- 独立开局规划窗口或全屏步骤页，不直接显示 RPG 世界桌面。
- 顶部显示：世界名、存档名、步骤进度。
- 底部固定：返回、保存并退出、下一步/生成、确认开局。
- 候选正文使用现有 Markdown 预览；编辑模式使用纯文本输入框。

### 7.2 手机

- 单列步骤页，避免多栏表单。
- 主要按钮固定在安全区上方。
- 长表单分组折叠，但必填错误自动展开并滚动定位。
- AI 生成期间允许取消；取消后保留规划输入。

### 7.3 世界库状态

存档卡片明确显示：

- `待开局`：继续规划。
- `进行中`：打开世界桌面。
- `已结束`：查看或重开世界线。

## 8. 失败与恢复

| 场景 | 行为 |
|---|---|
| AI 请求失败 | 保留规划；可重试或使用静态开场 |
| AI 输出解析失败 | 显示具体错误；候选不进入正式状态 |
| 保存规划失败 | 保留本地输入 overlay；提示重试，不假装已保存 |
| opening revision 冲突 | 重新读取存档；禁止自动覆盖新规划 |
| 重复点击确认 | commandId 幂等，只提交一次 |
| 浏览器/应用重开 | planning 存档恢复到上次已保存步骤 |
| 切换世界或存档 | 当前候选不写入目标存档；迟到响应丢弃 |
| 磁盘空间不足 | 保留错误与候选文本，禁止进入 active |

## 9. 旧数据兼容

- 旧存档没有 `setup`：若已有 opening、openingCommandId 或 turns，则迁移视图按 `active` 处理。
- 旧存档为空但没有 setup：也保持 active，避免升级后突然锁住用户旧档；仅新建存档进入 planning。
- 旧静态开场：首次创建时进入预览确认，不再无提示直接进入世界桌面。
- 旧 AI 开场接口保留相同路径，增加 planning 校验；客户端与服务端同步升级。
- Android 内嵌服务必须实现同样的状态和拒绝规则，不能只在前端隐藏输入框。

## 10. 验收标准

1. 新存档创建后进入开局规划，不进入普通聊天。
2. 角色、地点、NPC、规划和候选只属于当前 saveId。
3. 未确认时 revision、时间、回合、事件账本、记忆和正式 opening 不变化。
4. AI 失败、解析失败、取消和重生成不会污染正式状态。
5. 确认开局只增加一次 revision，并生成一条 opening receipt。
6. 确认后才能发送第一条普通回合。
7. 重开应用能继续待开局存档。
8. 两个存档规划不同角色、地点和 NPC 时不串数据。
9. 切换存档后的迟到 AI 响应不会写入当前存档。
10. 旧存档无需手工迁移即可继续打开。
11. 桌面与手机浏览器流程可完成。
12. Android 服务契约与 Node 服务一致。

## 11. 分阶段任务

### OP0：基线与契约

- OP0.1 记录当前创建、AI 开场、opening 提交和进入世界桌面的行为基线。
- OP0.2 固定 `planning/active` 生命周期及不变量。
- OP0.3 固定 `openingPlan` 与 candidate 字段及长度/数量限制。
- OP0.4 明确旧存档无 `setup` 时的兼容规则。
- OP0.5 建立最小测试夹具：一个静态开场世界、一个 AI 开场世界、两个独立存档。

完成条件：Schema、状态流和迁移规则无未定义分支。

### OP1：服务端 planning 状态

- OP1.1 新建存档时写入 `setup.status=planning`。
- OP1.2 增加 setup/plan 输入校验。
- OP1.3 校验 locationId、presentNpcIds 的世界版本归属。
- OP1.4 阻止 planning 存档提交普通世界回合、成长、结束等命令。
- OP1.5 增加规划保存与读取往返测试。
- OP1.6 增加跨存档 ID 注入拒绝测试。

完成条件：只靠直接 API 也不能绕过 planning 状态。

### OP2：开场候选协议

- OP2.1 定义独立 OpeningCandidate JSON Schema。
- OP2.2 修改开场 Prompt，移除常规 typed patch 要求。
- OP2.3 实现候选解析与错误分类。
- OP2.4 校验四个选项、地点、NPC 和玩家主权边界。
- OP2.5 确保生成、取消、重生成都不修改正式状态。
- OP2.6 增加解析器和非法 ID 回归测试。

完成条件：模型只能提出候选，不能在开场规划阶段改状态。

### OP3：开局规划 UI

- OP3.1 将现有玩家创建表单改为步骤一并保留动态 schema。
- OP3.2 新增开局规划步骤二。
- OP3.3 新增候选预览/编辑步骤三。
- OP3.4 增加返回、保存退出、生成、重生成、静态开场和确认按钮。
- OP3.5 世界库展示“待开局”并支持继续。
- OP3.6 planning 状态隐藏/禁用普通发送入口并给出原因。
- OP3.7 完成手机单列、焦点、键盘和触摸目标适配。

完成条件：桌面和手机均能从建角走到候选预览，刷新后继续。

### OP4：正式开场提交

- OP4.1 扩展 `/opening` 接收 plan + opening + options。
- OP4.2 只允许 planning → active 单向切换。
- OP4.3 保留 commandId 幂等与 expectedRevision CAS。
- OP4.4 原子写入 opening、options、plan、receipt、eventLedger 和 active 状态。
- OP4.5 拒绝 active 存档覆盖开场。
- OP4.6 增加重复确认、revision 冲突和写入失败测试。

完成条件：确认一次只产生一个正式开场事实。

### OP5：Prompt、世界书与调试追踪

- OP5.1 将 plan 注入独立开场 Prompt，不混入常规回合协议。
- OP5.2 世界书仅使用当前世界卡绑定与开局相关条目。
- OP5.3 NPC 注入只包含规划允许的在场角色和公开资料。
- OP5.4 调试窗口区分 opening-plan、opening-candidate、opening-commit。
- OP5.5 隐藏密钥和其他存档内容。

完成条件：调试信息能解释候选来源，且没有跨存档内容。

### OP6：兼容与 Android

- OP6.1 Node 端对旧存档补兼容视图。
- OP6.2 前端打开旧存档时不误进 planning。
- OP6.3 Android TavernServer 补相同 setup/opening 校验。
- OP6.4 Android WebView 验证保存退出与继续规划。
- OP6.5 更新数据结构和 Android 文档。

完成条件：Node 与 Android 对同一存档给出相同生命周期结果。

### OP7：端到端验收

- OP7.1 静态开场：预览、编辑、确认。
- OP7.2 AI 开场：生成、重生成、确认。
- OP7.3 AI 失败与解析失败恢复。
- OP7.4 规划中刷新、关闭应用、重新打开。
- OP7.5 两存档角色/地点/NPC/候选隔离。
- OP7.6 切换存档时丢弃迟到响应。
- OP7.7 确认后首个正式回合与存档重开。
- OP7.8 桌面、手机视口与 Android 真机分别记录证据。

完成条件：十二条验收标准全部有对应证据；未真机验证不得声明 Android 完成。

## 12. 推荐执行顺序

```text
OP0 → OP1 → OP2 → OP4 → OP3 → OP5 → OP6 → OP7
```

先完成服务端状态门和候选协议，再接 UI，避免只隐藏按钮却仍能通过 API 绕过规划阶段。

## 13. 待用户确认的三个产品决定

1. 起始地点与在场 NPC：世界卡可锁定，也可声明允许玩家选择的集合；推荐采用此方案。
2. 开场正文：允许玩家直接编辑 AI 候选；推荐允许，因为确认权属于玩家。
3. 保存退出：待开局存档继续保留在世界库并标注状态，不自动删除；推荐保留。

以上三个决定作为当前默认：世界卡约束范围、玩家可编辑候选、规划存档保留在世界库。

## 14. 当前落地进度

- OP0 / OP1：已完成。AI 开场的新 `WorldSave` 使用 `setup.status = planning`；规划通过 `PUT /api/world-saves/:id/setup` 独立保存，正式回合、成长、结束和普通存档写入在规划期间拒绝；旧存档无 `setup` 时按 `active` 兼容。
- OP2：已完成后端协议。`POST /api/world-saves/:id/opening-candidate` 只保存独立 `OpeningCandidate`，不改正式 `opening`。
- OP3 / OP4：已完成。前端新增开局向导，可编辑规划与候选；确认时才调用 `/opening`，并以候选命令 ID 做绑定校验。
- OP5：已完成。开场规划使用独立调试追踪，候选请求不携带 API 密钥，也不会写入正式回合状态。
- OP6：Node 与 Android 均补齐 setup、opening-candidate、opening 的生命周期校验；旧存档缺少 setup 时按 active 兼容，未声明 openingMode 的新世界卡按 AI 开场处理，显式 static 保持静态开场。Android 真机验证仍待 APK 构建后执行。
- OP7：Node 端 API、桌面浏览器和手机视口回归已通过；Android 真机与真实 AI 网关链路尚未验收。
