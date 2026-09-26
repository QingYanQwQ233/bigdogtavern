# D&D 模组 → Tavern 世界卡：复刻方案

> 示范对象：《Lost Mine of Phandelver（凡戴尔的失落矿坑）》第一章 —— D&D 5e 新手套组（Starter Set）内置冒险。
> 结论先行：**可以复刻**。卡系统现有构件足以承载 D&D 入门模组的完整结构；「剧情」不需要新字段。

## 0. TL;DR

- 核心映射：D&D 的 `d20 + 调整值 vs DC` ≡ Runtime 动作的 `check { sides, target, modifiers }`；宝箱 ≡ `collection.add`；剧情进度 ≡ `variable`；结局 ≡ `ending.card-defined`。
- 「剧情」= **四件套**：阶段变量 + 任务/情报集合 + 闸门动作（availability）+ 卡定义结局；外加 AI 行为约束。
- 分工本质：**模组 = 卡（骨架与闸门），DM = AI（叙事与后果）**。这正是这套系统最贴 D&D 的地方。

## 1. 选题与版权策略

- 选它是因为它是最标准的「教学结构」：伏击 → 追踪 → 地城 → 营救 → 首领 → 钩子，几乎是最适合做复刻验证的模组。
- 版权原则：
  - 只复刻**结构与玩法框架**（房间拓扑、遭遇配置、情节脉络、DC 这类机制参数）；
  - 卡内**文本全部重写**（中文原创叙述），不搬运原文段落；
  - 怪物数值使用开放规则素材或等价抽象，发布前复核素材许可；
  - 个人存档游玩属于私人使用；对外发布需进一步原创化。

## 2. 第一章结构拆解（Goblin Arrows）

| # | 节点 | 内容 | 可复刻的机制参数 |
|---|------|------|------------------|
| A | 开场 | 护送货车，雇主矮人先行失踪 | 开场钩子 → `openingScenario` |
| B | 地精伏击 | 4 只地精（2 近战 2 远程）；3 死 1 逃 | 叙事遭遇 + 检定；逃兵留下小径线索 |
| C | 地精小径 | 5 英里追踪，2 个陷阱 | 追迹 DC10 求生；索套（察觉 DC12 / 敏捷 DC10）；落穴（察觉 DC15 / 敏捷 DC10） |
| D | 洞窟入口 | 灌木掩护 | 潜行/察觉对抗 |
| E | 洞窟 8 房间 | 哨位→狼舍→陡道→天桥→地精窝→双池→首领洞 | 地点拓扑 + 各房间交互（见下） |
| F | 营救西尔达 | 谈判或武力 | 开启情报线 |
| G | 首领克拉格 | 熊地精 + 火坑 + 战利品 | 终局遭遇 + 真相揭底 |
| H | 钩子 | 西尔达求援 → 凡戴尔镇 | 下一章任务（任务集合） |

洞窟内关键交互（可直接转成动作的）：

- **狼舍**：安抚 DC15 驯兽（先喂食则容易）；裂隙爬升 DC10 运动
- **陡道**：脆石台 DC10 敏捷豁免，失败 2d6 坠落
- **天桥**：爬墙 DC15 运动；水闸机关 → 冲洪（Flood!）
- **情报链**：约 15 只地精、首领克拉格、国王格罗尔（克拉格城堡）、**「黑蜘蛛」**买通部落抓捕矮人 —— 这是全章的钩子

## 3. 元素映射表

| D&D 元素 | Tavern 卡字段 | 说明 |
|---|---|---|
| 地点 / 房间 | `locations[]` | 8 房间 → 8 地点，或按幕合并 |
| NPC（克拉格/西尔达/耶米克…） | `npcs[]` | 动机、秘密用 `secrets` |
| 技能检定 DC | `runtime.actions[].check` | `sides:20, target:DC, modifiers:[技能]` |
| 叙事用检定点 | `rules.checks` | 不强制骰子的软判定 |
| 陷阱 / 机关 | 动作 `check` + `failure` | 索套、落穴、水闸 |
| 战利品 / 宝箱 | `collection.add` | 进「物资」集合 |
| 剧情进度 | `variable`（enum） | `story: ambush → … → boss` |
| 任务 / 情报 | `collection` | 任务日志、已知情报 |
| 幕后势力（黑蜘蛛） | `npcs.secrets` + 世界书 | 只按情景注入 |
| 休息 / 时间 | `time.turnAdvance` | 每回合推进 |
| 结局 | `ending.card-defined` | 仅用于**世界线终结** |
| 失败 | `failure.modes` | `injured` / `continue`，不结束故事 |
| DM 手册提示 | `rules.soft` | 写入「推进当前阶段」的要求 |
| 职业 / 背景 | `playerCreation.buildPresets` | 战士/游荡者/法师预设包 |

## 4. 「剧情」四件套（设计模式 + 示例）

> 章节推进用**变量**，世界线终结才用**结局**。两者不要混。

**① 阶段变量**（AI 与玩家都看得见的主要进度）：

```json
{ "id": "story", "label": "主线进度", "scope": "save", "type": "enum",
  "options": ["ambush", "trail", "hideout", "rescue", "boss", "epilogue"],
  "initial": "ambush", "visible": true }
```

**② 任务 / 情报集合**（记录「知道了什么、欠谁什么」）：

```json
{ "id": "intel", "label": "已知情报", "scope": "save",
  "entrySchema": { "type": "object",
    "properties": { "id": {"type":"string"}, "title": {"type":"string"},
      "text": {"type":"string"}, "status": {"type":"string"} },
    "required": ["id","title","text","status"], "additionalProperties": false },
  "initial": [] }
```

**③ 闸门动作**（条件满足才出现；检定过了才生效；生效即推进剧情）：

```json
{ "id": "calm-wolves", "label": "安抚狼群", "category": "skill",
  "description": "尝试安抚被拴住的狼。",
  "check": { "sides": 20, "target": 15,
    "modifiers": [ { "source": "player", "bucket": "skills", "id": "animal-handling" } ] },
  "effects": [ { "type": "variable.set", "variableId": "wolves", "value": "calm" } ] }

{ "id": "free-sildar", "label": "解救西尔达", "category": "story",
  "availability": [ { "type": "variable.compare", "variableId": "story",
    "operator": "==", "value": "hideout" } ],
  "effects": [
    { "type": "variable.set", "variableId": "story", "value": "rescue" },
    { "type": "collection.add", "collectionId": "intel",
      "value": { "id": "black-spider", "title": "黑蜘蛛",
        "text": "有人出钱让部落抓捕矮人。", "status": "new" } } ] }
```

**④ 卡定义结局**（只在世界线终结时用）：

```json
{ "id": "hideout-ending", "kind": "card-defined", "label": "地窟惊魂",
  "description": "你带着情报离开了地窟，但黑蜘蛛的名字第一次浮出水面。",
  "terminal": true }
```

**⑤ AI 行为约束**（`rules.soft` + 预设）：要求 AI 始终跟随 `story` 当前阶段推进、不跳节点；章节细节放世界书按触发词注入。

## 5. 复刻工作流（从模组文本到可玩卡）

1. 拆结构：列出全部节点/房间/NPC/检定点（本方案 §2 已完成）
2. 写 `setting` 五字段：背景重写为原创中文叙述
3. 录 `locations` / `npcs`（稳定安全 ID）
4. 写 Runtime：变量 → 集合 → 动作（含闸门与判定）
5. `rules.checks` 对齐 DC；`turnContract` / `time` / `failure` / `ending`
6. 世界书：每章节的细节文本 + 触发词
7. 发布 → 开档实测 → 逐场景走查

## 6. 建议的落地切片（第一个可玩版本）

先做「伏击 + 小径」两节点，小而闭合、可验证：

- 1 张卡（独立或挂在现有卡上试验）
- 地点 ×3（公路伏击点、小径、洞口）
- NPC ×4（地精 ×2 类型、俘虏、雇主信息面）
- Runtime：2 变量（`story`、`alarm`）+ 2 集合（`intel`、`supplies`）+ 5~6 动作（追迹 / 拆索套 / 绕落穴 / 搜尸 / 审俘 / 进洞）
- 验收：3~5 回合走完伏击 → 追迹 → 洞口；判定结果与叙事吻合、闸门按预期解锁

## 7. 开放问题

- 多敌人「血量」的抽象：用威胁值变量，还是纯叙事（当前引擎无网格战斗）
- 章节推进的呈现：侧栏可见变量已够用，还是需要章节横幅（可走世界扩展）
- 「模组文本 → 卡草案」的半自动生成工具（后续可做，属于生产管线）
