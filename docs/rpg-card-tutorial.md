# 从零创建一张可玩的 RPG 世界卡

> 适用版本：2026-08-26 当前仓库实现。
>
> 目标：从空白草稿做出一张可以创建角色、进入开局、推进回合、使用物品、消耗耐久、进行判定、确认线索、处理失败与结束、保存/复制/导出的 RPG 世界卡。

这份教程以当前可发布的 RPG 世界卡为准。它不会把历史兼容字段当作新功能教学；如果你在旧 JSON 中见到事件、派系、冲突、地图、经济、成长、背包或任务模板，请先不要照抄。新草稿保存会收敛掉这些旧投影，当前正式玩法统一用 Runtime 的变量、集合和动作表达。

完整 HTTP/JSON 契约见 [RPG 世界卡、运行时与 HTTP 接口参考](rpg-card-api.md)。想先看完成品，可导入 [灰烬边境完整世界包](demo-western-fantasy-ashen-frontier.tavern-world.json)。

如果你希望不跳章节、从空白草稿一路做到一张独立美化卡，请直接跟随第 17 节。前 1–16 节是字段和协议的查阅手册；第 17 节把它们按真实制作顺序串成一个可发布的完整项目。

## 0. 先准备独立制卡页

1. 在左侧进入 **世界与存档**。
2. 点击 **创建新世界草稿**，选择 **空白草稿**。
3. 草稿会在独立制卡页打开；地址栏会带有 worldDraft 参数。刷新、收藏这个地址，或稍后从世界与存档返回，都能继续编辑同一份草稿。
4. 先点击一次 **保存草稿**。之后每完成一个阶段都再保存一次；发布检查失败时回到草稿修复，不要去修改已经发布的版本。

草稿、发布版本和存档是三件不同的东西：草稿可反复改，发布版本不可变，一条存档只记录自己的角色和世界线。下面的实战会一直在草稿中工作，直到最后才发布。

## 1. 先理解：一张卡和一局游戏不是同一个东西

| 对象 | 你在其中编辑什么 | 何时变化 |
|---|---|---|
| 世界卡 WorldCard | 设定、地点、NPC、建角规则、Runtime Schema、UI、Agent | 发布成版本后固定 |
| 世界草稿 WorldDraft | 尚未发布的世界卡 | 可反复保存、检查、修改 |
| 世界存档 WorldSave | 一个玩家的角色、地点、变量、物品、回合、记忆 | 每次正式回合推进 revision |

这意味着：

1. 修改世界卡不会偷偷改掉正在玩的旧存档。
2. 每个存档都有自己的口粮、提灯耐久、线索和关系；两个玩家的世界线互不污染。
3. 要升级旧存档，先使用升级预演；要保留分支，复制存档，而不是覆盖原存档。

## 2. 这份教程完成后能玩什么

完成后，你会拥有以下实际可玩的内容：

- 设定、规则、世界书和 RPG 预设；
- 多个地点、静态 NPC、NPC 的公开信息与秘密；
- 自定义姓名/背景、属性点、技能、资源、特质与出身预设；
- 本局难度、第一条线索等开局配置；
- 时间推进、3–4 个推荐选项和自由文本行动；
- 可见状态变量，例如日期、法力、警戒、线索数；
- 带耐久、使用次数、自动禁用条件的物品；
- 普通动作、输入动作、条件动作和骰子判定动作；
- 线索确认、关系变化、地点移动和玩家效果；
- 失败模式、主动结局、卡定义结局、重开世界线；
- 自动侧栏或声明式侧栏、自定义世界扩展的只读/选择能力；
- 导入、导出、复制、重置、记忆诊断、总结重建和存档升级。

不能当作当前新卡功能使用的是：旧式事件表、派系表、冲突表、地图生成、货币/成长/经验/任务硬编码系统，以及直接写 Runtime 的 HTTP 接口。它们要么已被移除，要么只为旧存档保留兼容读取。

## 3. 最短路径：先创建一个真的能玩的基础卡

在侧栏进入 **世界与存档**，点击 **创建新世界草稿**，选择空白草稿。下面所有操作都发生在草稿工作台；不要直接编辑发布版本。

### 3.1 填写世界身份

先填标题、简介和标签。ID 通常由工作台生成；如果需要自己填，使用字母或数字开头，后面只用字母、数字、连字符、下划线，例如 mist-harbor。

推荐最小内容：

| 字段 | 示例 |
|---|---|
| 标题 | 雾港：失灯调查 |
| 简介 | 在潮汐淹没旧城前，找回港口失落的灯火。 |
| 标签 | 奇幻、调查、低战斗 |
| 设定 | 雾港的灯火维系海门；无灯的夜晚会出现潮影。 |
| 规则 | 没有光源不能安全进入潮雾；危险行动先判定，失败也必须推进局面。 |

设定负责“世界是什么”，规则负责“世界如何运作”。规则应写出资源是否允许凭空获得、什么时候需要判定、失败会付出何种代价、以及哪些知识不能在未调查前断言。

### 3.2 从零创建并绑定世界书和 RPG 预设

世界书负责“在提到某个概念时补入哪条事实”；RPG 预设负责“AI 每回合必须怎样行为”。两者不要混成一大段设定。

先在左侧 **世界书** 中点击 **新建世界书**，命名为“雾港设定”。第一张卡只需逐条添加并启用下面四项；不必一开始使用递归、正则或概率注入：

| 条目标题 | 主关键词 | 建议内容 |
|---|---|---|
| 潮雾与潮影 | 潮雾、潮影、海门 | 无光区域会被潮雾吞没；潮影会模仿声音，但惧怕稳定的盐火。 |
| 锚灯旅店 | 锚灯旅店、伊莱、港务官 | 旅店是港口最后亮着灯的室内地点；伊莱只公开账本缺页，不公开自己参与过转运。 |
| 失踪的港灯 | 失灯、灯塔、搬运记录 | 主灯在涨潮前被人搬离灯塔；调查记录和钟楼密码可分别确认两条线索。 |
| 盐火 | 盐火、盐火提灯、灯塔 | 盐火只能短暂驱散潮雾，不能直接消灭潮影；提灯耐久归零后不能再次点亮。 |

保存世界书后进入 **提示词**，点击 **新建预设**，命名为“RPG · 雾港”，把下列内容放进后预设（Post-History Instructions），保存：

~~~text
你是《雾港：守灯人》的叙事者。玩家拥有完全行动主权；不要替玩家决定态度、台词或最终选择。
只把已声明并已执行的 Runtime 动作或 Typed Patch 写成真实状态变化。物品耐久或数量为零时，说明它已耗尽，不执行也不伪造扣除。
需要判定时，先复核规则，再使用真实骰子；不能在正文伪造骰面或把部分成功写成完全成功。
线索只有在对应动作成功并写入状态后才是 confirmed。失败和部分成功必须推进局面，但不得泄露秘密或思维链。
正文结束时只输出一次 tavern_state_update；选项是 3–4 个不重复的纯字符串，同时允许自由输入。
~~~

回到世界草稿，在 **绑定世界书** 勾选“雾港设定”，在 **RPG 提示词预设** 下拉框选择“RPG · 雾港”。若下拉框没有新预设，先保存预设并刷新草稿页。预设里应明确零资源、判定、线索和单一状态块规则；这比靠输出正则猜测模型意图可靠。

### 3.3 添加地点

在地点区域至少建 3 个地点。每个地点都要有稳定 ID、名称、类型和简短描述。

| ID | 名称 | 类型 | 简介 |
|---|---|---|---|
| harbor-inn | 锚灯旅店 | safe | 港口唯一仍亮着的室内灯火。 |
| old-pier | 旧码头 | danger | 潮雾最先淹没这里，木栈桥随时断裂。 |
| sea-gate | 海门灯塔 | landmark | 失灯所在，只有调查后才能安全进入。 |

地点不是单纯的文案。后续的 location.set、NPC locationId、开局地点和 AI 叙事都会引用它们。发布过的卡不要删除仍被开局或 NPC 引用的地点。

### 3.4 添加 NPC

至少添加两位 NPC，并把每个人的“玩家可知”和“AI 可知但未公开”分开：

| ID | 名称 | 所在地 | 公开事实 | 秘密 |
|---|---|---|---|---|
| npc-elian | 伊莱港务官 | harbor-inn | 他在寻找失灯的搬运记录。 | 他曾私下把一盏备用灯卖给走私者。 |
| npc-mora | 莫拉灯塔守人 | sea-gate | 她拒绝在夜里开门。 | 她知道潮影惧怕盐火。 |

NPC 可填写 role、description、persona、personality、appearance、speechStyle、publicFacts、publicGoals、desires、fears、goals、secrets、activity、locationId、homeLocationId。秘密是给叙事上下文的内容，不应默认出现在玩家侧栏或开场白中。

## 4. 建角：让玩家真的能做选择

在 **玩家创建规则** 区域，依次声明资料字段、属性、技能、资源、特质和预设。可视化编辑器可以完成常用内容；复杂 Schema 才需 JSON。

### 4.1 基本资料字段

添加以下字段：

| ID | 标签 | 类型 | 必填 | 默认值 |
|---|---|---|---|---|
| name | 名字 | text | 是 | 无 |
| origin | 来处 | select | 是 | harbor |
| oath | 对灯火的誓言 | textarea | 否 | 无 |

origin 的选项：harbor（港区）、old-city（旧城）、outsider（外来者）。字段类型只有 text、textarea、select、number；选择项必须有值和显示名称。

### 4.2 属性、技能、资源与特质

建议第一张卡使用少量明确的数值：

| 类别 | ID | 标签 | 最小/最大 | 默认 | 用途 |
|---|---|---|---:|---:|---|
| 属性 | insight | 洞察 | 0 / 10 | 2 | 查找细节、识别潮影 |
| 属性 | nerve | 意志 | 0 / 10 | 2 | 抵抗恐惧 |
| 技能 | investigate | 调查 | 0 / 10 | 1 | 调查判定修正 |
| 技能 | negotiate | 交涉 | 0 / 10 | 1 | 与 NPC 交涉 |
| 资源 | hp | 生命 | 0 / 12 | 12 | 失败系统可监听 |
| 资源 | focus | 专注 | 0 / 8 | 5 | 特殊行动的消耗 |
| 特质 | salt-sense | 盐火感知 | — | — | 叙事特征 |

如果希望玩家分配属性点，设置 pointBudget，例如总点数 12、模式 pool、成本 above-min。不要把“属性值”和“Runtime 变量”混为一谈：属性/技能/资源属于玩家构建，日期/线索/耐久等局势属于 Runtime。

### 4.3 出身预设

为新玩家提供 2–3 个预设即可。示例：

| 预设 ID | 名称 | 偏向 |
|---|---|---|
| dock-scout | 码头斥候 | 洞察 5、调查 4、盐火感知 |
| fallen-keeper | 失职守灯人 | 意志 5、交涉 3、熟悉灯塔 |
| tide-runner | 潮间走私客 | 洞察 3、交涉 4、知道旧城暗道 |

预设只预填属性、技能、资源、特质，不应绕过字段校验或给玩家一个世界中并不存在的物品。

## 5. 开局、本局配置、时间与回合规则

### 5.1 本局配置

在 sessionSetup 中声明“每条世界线创建时选一次”的选项。例如：

~~~json
{
  "title": "本局雾港配置",
  "fields": [
    {
      "id": "difficulty",
      "label": "潮雾压力",
      "type": "select",
      "options": [
        { "value": "story", "label": "故事" },
        { "value": "standard", "label": "标准" },
        { "value": "hard", "label": "严酷" }
      ],
      "default": "standard"
    },
    {
      "id": "first-lead",
      "label": "第一条线索",
      "type": "select",
      "options": [
        { "value": "ledger", "label": "先查搬运记录" },
        { "value": "lighthouse", "label": "先去灯塔" }
      ],
      "default": "ledger"
    }
  ]
}
~~~

sessionSetup 字段可以是 text、textarea、select、number、boolean。它们属于当前存档的 game/plan，不会改写世界卡；同一张卡可以开出难度或开局方向不同的多条世界线。

### 5.2 时间和选项数量

推荐填写：

~~~json
{
  "turnContract": {
    "options": { "min": 3, "max": 4 },
    "actionIntent": true
  },
  "time": {
    "unit": "夜",
    "start": 1,
    "turnAdvance": 1
  }
}
~~~

这会要求每回合给 3–4 个推荐选项，同时仍允许玩家自由输入。AI 不能把推荐选项当成唯一行动范围。若不填 turnContract，当前默认是 4 个选项。

### 5.3 开场

普通新卡由创建存档后的 planning 与 opening 流程生成开场。你需要在设定、地点、NPC 和世界书中提供足够事实，并让开局计划选择起始地点、在场 NPC、时间、局势、玩家已知/未知信息和 initialHook。

如果你导入完整世界包，也可以带 start.locationId、start.opening、start.options 与初始玩家模板；但不要依赖空白草稿工作台用旧 start 结构编辑所有玩法。当前推荐路径是用建角 + sessionSetup + opening 流程。

当前 opening-candidate 与 opening 接口固定要求恰好 4 个不重复的非空字符串选项；这是开局的独立约束。进入正式回合后，选项数量才按 turnContract 的 min/max 校验。

第一次测试可在 planning 表单按下表填写。它是当前存档的开局计划，不是旧式 start.initialState 字段：

| planning 字段 | 雾港测试值 |
|---|---|
| 起始地点 | harbor-inn |
| 在场 NPC | npc-elian |
| 世界纪年 | 潮历 214 年，失灯季 |
| 时间段 | 第一夜，涨潮前 |
| 当前局面 | 港口主灯熄灭，潮雾正在越过旧码头。 |
| 开场 Hook | 伊莱拿着缺页账本，请玩家找回被转移的主灯。 |
| 玩家已知事实 | 潮雾会吞没无光区域；主灯被人为取走。 |
| 知识边界 | 不替玩家决定是否相信伊莱；不公开任何 NPC 秘密。 |
| 叙事基调 | 潮湿、克制、悬疑、低战斗。 |

提交计划后，先检查候选开场是否包含恰好四个不重复选项，再确认进入正式 opening。若它们不对，不要在正式回合里硬改开场；返回 planning 修改局面、Hook 或知识边界后重新生成。

## 6. Runtime：把“能玩的规则”写成可验证状态

Runtime 是这套 RPG 卡最重要的部分。它不是任意脚本，而是一份受限的数据声明：

- **变量**：数值、文本和开关，例如日期、警戒、法力、当前章节；
- **集合**：带稳定 ID 的对象列表，例如物品、线索、关系；
- **动作**：条件满足后执行的有限状态变更，例如使用物品、休息、公开危险；
- **判定**：动作可声明骰子和真实属性/技能修正；只有服务端复核通过才能生效。

状态只会写入当前 WorldSave。因此“雾港警戒”即使声明为 world scope，也不是全服务器共享的世界状态；每条存档各有一份。

### 6.1 用表单添加全局变量

打开 **状态与物品** → **存档全局变量**，添加以下变量：

| ID | 名称 | 类型 | 初始 | 最小 / 最大 | 在状态面板显示 |
|---|---|---|---:|---:|---|
| night | 雾港之夜 | 数值 | 1 | 1 / 7 | 是 |
| clues | 已确认线索 | 数值 | 0 | 0 / 4 | 是 |
| focus | 当前专注 | 数值 | 5 | 0 / 8 | 是 |
| alert | 港口警戒 | 数值 | 0 | 0 / 10 | 是 |
| gate-open | 海门已开启 | 开关 | 否 | — | 是 |

表单的变量类型是数值、文本、开关。枚举、列表、映射和复杂 JSON 仍可在高级 JSON 中使用，但第一张卡完全不需要它们。

### 6.2 用表单添加耐久物品

点击 **物品** → **＋物品**，填写：

| 字段 | 提灯示例 |
|---|---|
| ID | salt-lantern |
| 名称 | 盐火提灯 |
| 当前耐久 | 3 |
| 最大耐久 | 3 |
| 每次使用消耗 | 1 |
| 已使用次数 | 0 |
| 使用动作名称 | 点亮盐火提灯 |
| 使用说明 | 消耗 1 点耐久，驱散附近潮雾。 |

表单会自动生成：

1. 一个 durable-items 集合条目；
2. 一个 use-salt-lantern 动作；
3. 条件“durability 大于等于本次消耗”；
4. 使用效果“durability 减少、uses 增加”。

因此耐久归零时，按钮会自动不可用；AI 也应叙事为“提灯已经熄灭，无法再次使用”，而不是继续提交动作然后报错。这正是“数量为零时不执行”的正式兼容方式。

再添加一份 **潮雾口粮**，耐久 2、每次消耗 1。它可以代表实际数量；使用两次后会自动禁用。

### 6.3 用表单添加普通动作

在 **动作** 区域添加两个简单动作：

| ID | 名称 | 目标变量 | 数值变化 | 说明 |
|---|---|---|---:|---|
| rest-at-inn | 在旅店休整 | focus | +2 | 休整恢复专注。 |
| raise-alert | 敲响港钟 | alert | +1 | 公开潮影踪迹，港口警戒上升。 |

表单动作是“改变一个数值变量”的最短路径。它足以完成休息、章节推进、声望、倒计时、计数式线索和简单资源玩法。

### 6.4 先进行一次表单测试

保存草稿、完成发布检查并发布后，创建测试存档进入游戏：

1. 使用盐火提灯一次，确认侧栏显示耐久 3 → 2、次数 0 → 1；
2. 使用潮雾口粮两次，确认耐久 2 → 0；
3. 确认口粮动作变为不可用，而不是提交后报错；
4. 在旅店休整，确认专注变化显示在本轮状态变化中，并在刷新后仍保留。

如果第一步不成立，不要继续添加高级规则；先检查动作 ID、物品 ID 是否重复，耐久是否为整数，当前耐久是否不小于每次消耗。

## 7. 高级 Runtime：线索、条件、输入与判定

表单已经覆盖最常用的变量、耐久物品和单变量动作。以下内容属于高级 JSON，适合在基础卡已跑通后加入：

- enum/list/map/json 类型变量；
- 多个集合；
- 一个动作改多个字段；
- 线索确认、关系条目变化；
- 自定义输入；
- 骰子判定及成功后的效果；
- 集合条目的添加、删除、精确 patch。

展开 **高级 JSON 兼容**，粘贴 JSON 后必须点击 **从 JSON 载入表单**。未载入的文本不会写回草稿。

> **重要：高级 JSON 不是增量补丁。** 在这个框中粘贴一个新的 Runtime 根对象并点击载入，会替换整份 Runtime。不要把下方任意局部示例单独替换到第 6 节已经生成的表单上，否则 durable-items、提灯、口粮、focus 和现有动作都会消失。先复制完整 JSON 作为备份，再在同一份完整 Runtime 中追加内容；第 17 节提供了一份可以直接替换的最终累积成品。

### 7.1 加入线索板与确认动作

下列对象只展示“线索板与确认动作”的结构，不是可单独载入的完整 Runtime。把其中的 variables、collections、actions 追加进你已经备份的完整对象；不要单独替换第 6 节生成的 Runtime。示例中的变量、集合和动作 ID 必须在整张卡内唯一；需要一份可直接载入的成品时，使用第 17.7 节。

~~~json
{
  "version": 1,
  "variables": [
    {
      "id": "clues",
      "label": "已确认线索",
      "scope": "save",
      "type": "number",
      "initial": 0,
      "min": 0,
      "max": 4,
      "visible": true
    }
  ],
  "collections": [
    {
      "id": "clue-board",
      "label": "线索板",
      "scope": "save",
      "entrySchema": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "title": { "type": "string" },
          "text": { "type": "string" },
          "status": { "type": "string" }
        },
        "required": ["id", "title", "text", "status"],
        "additionalProperties": false
      },
      "initial": [
        {
          "id": "missing-light",
          "title": "失踪的港灯",
          "text": "灯塔主灯在涨潮前被人为取走。",
          "status": "unconfirmed"
        }
      ]
    }
  ],
  "actions": [
    {
      "id": "confirm-ledger-clue",
      "label": "确认搬运记录",
      "category": "investigate",
      "description": "查清失灯的去向，确认一条线索。",
      "effects": [
        { "type": "variable.delta", "variableId": "clues", "delta": 1 },
        {
          "type": "collection.patch",
          "collectionId": "clue-board",
          "entryId": "missing-light",
          "set": { "status": "confirmed" }
        }
      ]
    }
  ]
}
~~~

这个动作在没有判定时可直接执行；适合“玩家已经通过叙事取得足够证据，只需写回事实”的情景。

### 7.2 给线索确认加骰子判定

若确认线索本身有风险，把动作改为：

~~~json
{
  "id": "inspect-shipping-ledger",
  "label": "调查搬运账本",
  "category": "investigate",
  "description": "需要调查判定；成功后确认失灯去向。",
  "check": {
    "sides": 20,
    "target": 12,
    "modifiers": [
      { "source": "player", "bucket": "skills", "id": "investigate" }
    ]
  },
  "effects": [
    { "type": "variable.delta", "variableId": "clues", "delta": 1 },
    {
      "type": "collection.patch",
      "collectionId": "clue-board",
      "entryId": "missing-light",
      "set": { "status": "confirmed" }
    }
  ]
}
~~~

这里的 investigate 必须在第 4 节的玩家技能中真实声明。执行顺序固定：

1. AI 请求 rules.check；
2. 客户端按世界卡中完全相同的 modifiers 做规则复核；
3. 客户端掷出真实骰面；
4. AI 根据结果执行 action，或叙事失败/部分成功的后果；
5. 服务端校验后保存回合。

传输层会把骰面放进 actionIntent.dice，例如 { expr: "1d20", rolls: [14], bonus: 0, total: 14 }；属性/技能修正由规则复核单独计算。不要把修正混进 expr，也不要把叙事中的“成功”当成服务器已确认的结果。

不要让 AI 在正文里自己写“掷出 19，成功”然后直接改线索；那样会破坏判定可信度。

### 7.3 条件动作：资源为零时不执行

普通物品表单已自动生成条件。高级动作可手写条件，例如只有线索数达到 2 才能开海门：

~~~json
{
  "id": "open-sea-gate",
  "label": "开启海门",
  "availability": [
    {
      "type": "variable.compare",
      "variableId": "clues",
      "operator": ">=",
      "value": 2
    },
    {
      "type": "variable.compare",
      "variableId": "focus",
      "operator": ">",
      "value": 0
    }
  ],
  "effects": [
    { "type": "variable.set", "variableId": "gate-open", "value": true },
    { "type": "variable.delta", "variableId": "focus", "delta": -1 }
  ]
}
~~~

availability 中的所有条件都必须满足。条件类型只有 collection.exists、collection.number、variable.compare；比较运算符只有 ==、!=、>、>=、<、<=。

### 7.4 带输入的动作

动作输入适合让玩家选择已经声明的目标，而不是让 AI 任意改路径。例子：把一条临时目击加入线索板。

~~~json
{
  "id": "record-sighting",
  "label": "记录目击",
  "inputs": [
    {
      "id": "sighting-id",
      "label": "记录 ID（例如 fog-bell）",
      "type": "string",
      "required": true
    },
    {
      "id": "title",
      "label": "目击标题",
      "type": "string",
      "required": true
    }
  ],
  "effects": [
    {
      "type": "collection.add",
      "collectionId": "clue-board",
      "value": {
        "id": "{{ input.sighting-id }}",
        "title": "{{ input.title }}",
        "text": "玩家记录的目击。",
        "status": "unconfirmed"
      }
    }
  ]
}
~~~

实际发布时，sighting-id 必须仍符合安全 ID 规则；不要把任意自然语言作为 ID。更稳妥的设计是让界面提供受控 ID 或让 Agent 生成受控 ID，把玩家输入只放进 label/text。

### 7.5 高级 Runtime 的安全边界

- variables、collections、actions 各最多 128 项；
- 一个动作最多 16 个输入、16 个条件、16 个效果；
- 集合初始条目最多 256 个，条目必须是对象且带安全 ID；
- collection.patch 只允许 set 与 delta，不支持任意路径；
- number 的增减仍受 min/max 限制；
- 没有“执行任意 JavaScript”或“直接写任意存档路径”的能力。

这些限制不是缺陷：它们让 AI 产出的状态可以被验证、重试和导出。

## 8. 配置 AI：叙事自由，状态受约束

RPG 模式不是让模型直接改 JSON，而是让模型提供叙事、选择和受校验的状态建议。世界卡的 Agent profile 决定它能进入哪些受控步骤。

### 8.1 最小 Agent 配置

在 Agent JSON 中使用以下配置：

~~~json
{
  "protocol": "tavern.rpg.agent",
  "version": 1,
  "mode": "native",
  "maxSteps": 4,
  "tools": {
    "rules.check": {
      "enabled": true,
      "execution": "client-readonly",
      "description": "只按当前世界卡和玩家数据复核判定。"
    },
    "dice.roll": {
      "enabled": true,
      "execution": "client",
      "description": "只在规则复核后掷真实骰面。"
    },
    "runtime.action.execute": {
      "enabled": true,
      "execution": "server",
      "description": "执行已经声明的 Runtime 动作。"
    },
    "state.patch": {
      "enabled": true,
      "execution": "server",
      "description": "提交有界的状态更新。"
    },
    "memory.record": {
      "enabled": true,
      "execution": "server",
      "description": "记录玩家已经历的稳定事实。"
    }
  }
}
~~~

maxSteps 范围是 1–8。第一张卡用 4 就够；更高不等于更聪明，只会增加一回合内的工具循环。

### 8.2 写入 RPG 预设的行为要求

把下列意思写入你的 RPG 预设或系统提示，语言可按世界风格改写：

~~~text
你是本世界的叙事者。先判断玩家行动是否可行、是否引用已声明动作、是否需要判定。
物品数量或耐久为零时，明确告诉玩家已耗尽，不执行该动作，不伪造扣除。
需要判定时，先 rules.check，再由客户端 dice.roll；只依据真实结果结算。
成功、部分成功和失败都必须推进局面；失败不能简单重播或假装成功。
只有已执行的 Runtime 动作或 Typed Patch 才能改变线索、物品、关系、资源和地点。
正文不要泄露思维链、工具草稿或内部错误。正文后只输出一次 tavern_state_update。
每回合按 turnContract 给出推荐选项，同时保留玩家自由输入。
~~~

### 8.3 唯一结构化状态块

AI 可读正文后，必须只输出一次下列结构化块：

~~~text
<tavern_state_update>
{
  "protocol": "tavern.rpg.turn",
  "version": 1,
  "baseRevision": 7,
  "updates": [],
  "options": [
    "查看账本",
    "去旧码头",
    "询问伊莱"
  ],
  "eventMemory": [
    {
      "summary": "玩家在港务记录中发现主灯被转移。",
      "entityIds": ["npc-elian"],
      "locationId": "harbor-inn",
      "time": { "unit": "夜", "value": 1 },
      "visibility": "local"
    }
  ]
}
</tavern_state_update>
~~~

关键规则：

- protocol 必须是 tavern.rpg.turn，version 必须为 1；
- baseRevision 必须等于本回合开始时的存档 revision；
- updates 最多 32 项，且只能使用世界卡已声明的数据；
- options 必须是符合 turnContract 数量的不重复非空字符串，不能写成 label/value 对象；
- 顶层 options 与状态块里的 options 如果同时存在，必须一致；
- eventMemory 是简短的已发生事实，不是推理过程或未证实猜测；
- 不要输出第二个状态块，不要把 reasoning_content 展示给玩家。

格式仍然掉失时，先从 AI 原始输出检查：是否根本没有块、是否输出了两次、是否把 options 放在两个位置却不一致、是否 JSON 中夹了注释或 Markdown。不要靠正则“猜”模型的意图来偷偷改存档。

## 9. 失败、结局与重开

### 9.1 失败不是报错

新卡的失败系统只处理已经发生的正式状态后果，例如生命降到零。建议使用“失败改变局面，但不抹掉故事”的模式：

~~~json
{
  "defaultMode": "continue",
  "onZeroHp": "injured",
  "modes": [
    {
      "id": "injured",
      "label": "负伤",
      "description": "你被潮影所伤，被迫撤回旅店。",
      "hpRatio": 0.25,
      "effect": "潮雾负伤"
    },
    {
      "id": "continue",
      "label": "带着代价继续",
      "description": "局势恶化，但故事继续。"
    }
  ]
}
~~~

mode 还可以声明 resourceLoss、terminal、cardDefined。不要让 AI 直接伪造失败字段；服务端会根据正式资源和世界卡规则结算。旧包里的 onConflictDefeat、conflicts 等字段只为兼容读取保留，不要把它们当作新卡玩法设计。

### 9.2 结束一条世界线

主动结束和卡定义结局使用 ending：

~~~json
{
  "enabled": true,
  "allowPlayerEnd": true,
  "requireConfirm": true,
  "defaultEndingId": "player-choice",
  "endings": [
    {
      "id": "player-choice",
      "kind": "player-choice",
      "label": "暂别雾港",
      "description": "保留当前进度，结束本次旅程。",
      "terminal": true
    },
    {
      "id": "light-restored",
      "kind": "card-defined",
      "label": "灯火归港",
      "description": "你让海门的灯火重新点亮。",
      "terminal": true
    }
  ]
}
~~~

世界线结束后，使用“重开”创建一条新 WorldSave；源存档不会被覆盖。上例没有 condition，因此“灯火归港”是一个需要玩家确认的命名结局，并不会自动判断主线是否真的完成。当前从零制卡时，可靠地教学 player-choice 与玩家确认的 card-defined 结局即可；不要把旧 goals、leads、quests、conflicts 作为新的结局条件来源。

## 10. 侧栏、排版与自定义扩展

### 10.1 最简单：让宿主自动生成侧栏

不填写 ui.sidebar 时，宿主会自动显示 visible 的 Runtime 变量、集合和动作。这是第一张卡的推荐选择，能减少侧栏漏项和移动端布局问题。

### 10.2 需要定制时才声明侧栏

一旦填写 ui.sidebar.panels，自动侧栏会被完全接管；你必须自己把希望显示的区域都列进去。

~~~json
{
  "schemaVersion": 1,
  "layout": "world-desk",
  "shell": {
    "navigation": "show",
    "topbar": "show",
    "fullscreen": true,
    "escape": "fullscreen"
  },
  "sidebar": {
    "panels": [
      {
        "id": "items",
        "title": "物品",
        "icon": "◇",
        "side": "left",
        "source": "runtime.collections.durable-items",
        "layout": "cards",
        "fields": ["label", "durability", "maxDurability", "uses"],
        "emptyText": "没有可用物品"
      },
      {
        "id": "lantern-action",
        "title": "使用提灯",
        "icon": "◇",
        "side": "left",
        "source": "runtime.actions.use-salt-lantern",
        "layout": "actions"
      },
      {
        "id": "clues",
        "title": "线索",
        "icon": "⌕",
        "side": "right",
        "source": "runtime.collections.clue-board",
        "layout": "cards",
        "fields": ["title", "text", "status"]
      }
    ]
  }
}
~~~

上例中的 layout 只是普通布局名称，不会独立接管页面；继续使用宿主工作区时推荐填 host，要整页接管时使用 custom 并配置 extension。常用 source 是 world.locations、runtime.variables.<变量 ID>、runtime.collections.<集合 ID>、runtime.actions.<动作 ID>。移动端会把左右栏收纳到“角色与背包”和“任务与世界状态”抽屉；不要只在宽屏上检查。

若需要改写工作区区域，再在 ui.regions 中单独配置 topbar、sidebar.left、narrative、options、input、sidebar.right、status、overlay。每个区域只可选 decorate、replace、append、hide；未准备好对应组件时，优先用 decorate，或让 fallback 保持 host。不要为了换一个颜色或隐藏一段文字就启用 custom 整页接管。

### 10.3 自定义世界扩展的真实边界

自定义扩展运行在隔离 sandbox iframe，适合做只读 HUD、开局表单、展示和提交选择。当前可调用的 Bridge 是：

| Bridge | 用途 |
|---|---|
| TavernExtension.requestContext() / getContext() | 读取宿主上下文 |
| TavernExtension.runtime.get() | 只读 Runtime |
| TavernExtension.on() / off() | 订阅宿主事件 |
| TavernExtension.choose(text, options?) | 提交一次玩家选择；动作卡可传 `{ actionId, input }`，输入字段必须与 Runtime action.inputs 声明一致 |
| TavernExtension.setup.get() / patch() / commit() / cancel() | 只在开局 planning 中编辑 |
| TavernExtension.fullscreen() / exitFullscreen() / exitWorld() / openTerminal() | 宿主界面操作；全屏按钮应根据 `context.ui.fullscreen` 在“进入全屏”与“退出全屏”之间切换，终端按钮可打开 AI 往返终端 |
| TavernExtension.endWorld({ endingId?, confirm: true }) | 提前结束当前世界线；宿主按 `world.ending`、确认标记与 revision 校验后写入 `save.state.ending` |

扩展不能直接访问宿主 DOM、网络或存档文件，当前也没有 TavernExtension.action() 或 TavernExtension.patch()。因此不要复制旧模板里“扩展直接调用 action/patch”的示例；游玩状态必须走玩家选择 → Agent → Typed Patch 的正式回合。

## 11. 发布、开局与验收

按以下顺序完成一张卡：

1. 在工作台点击 **保存草稿**。
2. 点击 **检查发布条件**，逐项修正 definition、references、runtime、prompt 分类的报错。
3. 点击 **发布**；发布得到不可变的新 worldVersion。
4. 回到世界库，为该版本创建一个测试 WorldSave。
5. 完成建角和本局配置，进入 planning/opening，确认起始地点、时间、NPC 和 initialHook 正确。
6. 进行至少 6 回合的真测试，不要只看编辑器预览。

推荐验收剧本：

| 回合 | 行动 | 应观察到的结果 |
|---:|---|---|
| 1 | 使用盐火提灯 | 耐久 −1、使用次数 +1，本轮状态变化可见 |
| 2 | 使用口粮 | 数量/耐久 −1 |
| 3 | 再次使用口粮直至零 | 动作禁用；AI 明确说明已耗尽 |
| 4 | 调查搬运账本 | 规则复核和骰子可见；成功后线索由 unconfirmed 变为 confirmed |
| 5 | 休整 | 专注增加，时间/局势按卡规则推进 |
| 6 | 开启海门 | 未满足线索条件时不可用；满足后才改变 gate-open 和专注 |

随后测试：

- 刷新页面后，所有 Runtime 变化仍在；
- 点击预设选项或自由输入后，消息窗口保持在最新消息附近；
- 导出世界包，再导入为新世界，检查引用、世界书和预设是否完整；
- 复制存档，确认两条分支的耐久与线索互不影响；
- 重置原存档，确认回到开局基线；
- 结束并重开，确认原存档仍可阅读；
- 修改并发布 v2 后，先做升级预演，再升级测试存档。

## 12. 常见问题排查

| 现象 | 原因 | 处理 |
|---|---|---|
| AI 说“线索已确认”，侧栏仍是未确认 | 只有叙事，没有 runtime.action.execute 或 runtime.collection.patch | 检查动作的 effect 是否精确 patch 了同一个 collectionId、entryId 和 status；再次测试正式回合 |
| “动作当前不可用” | availability 不满足，通常是耐久、数量或资源为 0 | 这是正常防护。让 AI 说明耗尽，改用补给、休息或其他路线，不要重试同一动作 |
| “未声明动作” | actionId 不在当前发布版本的 runtime.actions 内 | 在草稿加入动作，发布新版本，为测试存档执行升级或重开 |
| “options 在请求顶层与 patch 内不一致” | 两个地方分别生成了选项 | 只保留一份选项来源；两处都存在时内容必须一致 |
| AI 输出被拒绝或格式掉失 | 没有唯一 tavern_state_update、JSON 不合法或泄露了工具草稿 | 从原始响应找第一个结构化错误；固定提示词，不要用模糊正则自动修复状态 |
| 判定成功但没有写入效果 | AI 没有执行世界卡动作，或 check 的 modifiers 与卡声明不同 | actionIntent.actionId、check、rules.check、dice.roll 和 execute 必须指向同一动作 |
| 草稿保存后旧字段没了 | 使用了已退休的 events/factions/map/growth 等字段 | 用 Runtime 重建状态和动作；不要依赖旧字段 |
| 新增侧栏后原来的变量消失 | 显式 sidebar 完全接管了自动侧栏 | 给每个需要显示的变量/集合/动作添加 panel，或删除 sidebar 配置恢复自动模式 |
| 更新被拒绝为 409 | revision 或草稿更新时间已经过期 | 重新读取当前版本，丢弃旧 patch，基于最新状态重新生成 |
| 高级 JSON 改了却没生效 | 没有点击“从 JSON 载入表单” | 先载入，重新展开高级 JSON 确认完整对象被保留；复杂条目不一定回显到可视化表单，再保存草稿 |

## 13. 表单能力、JSON 能力与当前边界

### 无需 JSON 即可完成

- 世界标题、简介、标签、地点和 NPC；
- 常用建角字段、属性、技能、资源、特质与预设；
- 表单化 Runtime 数值/文本/开关变量；
- 耐久物品、使用次数、自动禁用、消耗动作；
- 单数值变量增减动作；
- 保存草稿、发布检查、发布、建档、开局和存档管理。

### 需要高级 JSON 才能完成

- 线索/关系等任意集合；
- enum、list、map、json 变量；
- 一个动作同时影响多个目标；
- 条件组合、输入、集合 add/remove/patch；
- 骰子判定和修正来源；
- turnContract、time、sessionSetup 的复杂配置；
- Agent profile、失败/结局规则；
- 声明式侧栏、区域布局和 sandbox 世界扩展；
- 世界包中携带的世界书、预设、静态开场。

### 当前不要承诺给玩家的功能

- 跨存档共享的“全服世界变量”；
- 直接从扩展或 HTTP 接口写 Runtime；
- 任意 JavaScript 规则、任意数据库查询或任意 JSON Path 写入；
- 旧式事件、派系、冲突、地图、经济、成长、任务模板作为新卡的正式编辑模型；
- 在没有声明相应资源、物品、动作或地点时让 AI 临时创造并写入它们。

## 14. 发布前总清单

### 世界内容

- [ ] 标题、简介、标签说明了玩家将做什么。
- [ ] 设定与规则没有互相矛盾，并写清资源、判定、失败边界。
- [ ] 至少有 3 个地点、2 个 NPC，所有 locationId 都有效。
- [ ] NPC 的公开事实和秘密分开，不会让玩家开局就看到秘密。
- [ ] 世界书关键词能命中重要概念，预设包含玩家主权和状态真实规则。

### 玩家与开局

- [ ] 建角字段有名称，属性/技能/资源 ID 都唯一。
- [ ] 若使用点数池，默认值和预设都不超预算。
- [ ] sessionSetup 的选择项都有默认值。
- [ ] turnContract 的选项范围在 0–4 内。
- [ ] 开局计划有合理地点、时间、Hook 和知识边界。

### Runtime 与玩法

- [ ] 变量、集合、动作 ID 均为安全 ID，且全卡不重复。
- [ ] 数值变量的初始值落在 min/max 内。
- [ ] 每个集合条目都有 ID，entrySchema 与初始条目一致。
- [ ] 物品有耐久/次数、消耗、不可用条件，数量为零时不会执行。
- [ ] 每个线索确认都有真正的 Runtime effect，不只写在叙事里。
- [ ] 判定 action 引用真实的玩家属性/技能，且目标难度合理。
- [ ] 失败与结局能在测试中触发或被安全地拒绝。

### AI、界面与存档

- [ ] AI 只输出一个状态块，不显示思维链和工具草稿。
- [ ] 顶层 options 与状态块 options 不会冲突。
- [ ] 若写了 sidebar，移动端两个抽屉都能看到需要的面板。
- [ ] 物品、变量、线索的变化在本回合可见，刷新后仍保留。
- [ ] 已测试复制、重置、导出、导入、结束/重开和升级预演。

## 15. 作者自检命令

在仓库根目录运行以下针对 RPG 世界卡的检查：

~~~powershell
node scripts/check_rpg_card_authoring.js
node scripts/check_rpg_protocol.js
node scripts/check_runtime_roundtrip.js
node scripts/check_rpg_agent.js
~~~

完整项目检查使用：

~~~powershell
node scripts/run_checks.js
~~~

检查通过不等于故事体验已通过。仍要按第 11 节的 6 回合剧本手工试玩，尤其验证“资源为零不执行”“判定成功真正确认线索”“自由输入与预设选项都不会把消息滚回顶部”三件事。

## 16. 可以直接学习的参考

- **从零实战**：先完成本教程第 17 节《雾港：守灯人》；它是当前推荐的连续制卡路径和独立界面范本。
- [雾港：守灯人成品世界包](fog-harbor-keeper.tavern-world.json)：第 17 节的可直接导入版本，含独立界面、耐久物品、真实判定、线索与结局。
- [灰烬边境完整世界包](demo-western-fantasy-ashen-frontier.tavern-world.json)：地点、NPC、建角、Runtime、Agent、失败、结局、时间、世界书和预设齐全。
- [灰烬边境说明](demo-western-fantasy-ashen-frontier.md)：参考包的玩法意图。
- [接口与状态契约](rpg-card-api.md)：HTTP、Typed Patch、Runtime 和扩展 Bridge 的精确定义。
- [数据结构与兼容历史](data-structure.md)：处理旧包/旧存档时查阅；与本教程冲突时，以本教程和服务端校验为准。

历史的 demo-custom-ui-world 只用于兼容实验，不是当前新卡模板；其中的旧式直写扩展 API 已不能作为游玩态实现依据。要做 custom 页面，请使用第 17.9 节的 Bridge 和插槽方式。

第一张卡不必同时做完所有高级系统。先做“3 地点、2 NPC、1 个耐久物品、1 个线索、1 个判定、1 个结局”，把它玩通；再增加复杂集合、扩展 UI 和更多世界线分支。

## 17. 完整实战：从空白草稿做到《雾港：守灯人》

这一节是一条连续的制作线。不要把它当成另一套格式：它只是在前面各节的正式字段上，给出一份能够从头做到尾的卡。按顺序完成一个检查点再进入下一步，出错时就能知道是哪个阶段的问题。

### 17.1 先看成品：这张卡能玩什么

完成后，玩家会在潮雾逼近的港口调查失踪的主灯，并拥有：

- 3 个有用途的地点、3 位带公开事实与秘密的 NPC；
- 可分配的属性、技能、资源、特质和 3 个出身预设；
- 每局难度与第一条线索选择；
- 2 个耐久物品：盐火提灯和潮雾口粮；
- 专注、已确认线索、海门状态等保存到当前 WorldSave 的变量；
- 两条需要真实骰子判定的线索、一个有前置条件的终局动作；
- 失败继续、主动结束和命名结局；
- 一张不依赖外部图片或脚本的独立沉浸界面：顶部 HUD、可滚动消息、选项、自由输入、物品快捷按钮、全屏和退出；
- 移动端仍可点击的 44px 控件，以及资源为零时不提交动作的兼容行为。

空白草稿的世界 ID 由工作台生成，不需要手动填写；其余地点 ID、NPC ID 和 Runtime ID 一旦写下就不要随意改名。为了避免复制时出错，先记住这一张 ID 表：

| 类型 | ID |
|---|---|
| 世界 | 由空白草稿自动生成 |
| 地点 | harbor-inn、drowned-pier、sea-gate |
| NPC | npc-elian、npc-vessa、npc-mora |
| 耐久物品 | salt-lantern、fog-ration |
| 关键动作 | use-salt-lantern、eat-fog-ration、inspect-lost-ledger、decode-bell-code、open-sea-gate |

### 17.2 检查点 A：创建并保存空白草稿

1. 进入 **世界与存档** → **创建新世界草稿** → **空白草稿**。
2. 在标题填入“雾港：守灯人”。
3. 简介填入“在涨潮吞没旧城前调查失踪的港灯，以盐火穿过潮雾并决定海门的命运。”
4. 标签填入“奇幻，调查，潮雾，低战斗，独立界面”。
5. 点击 **保存草稿**，确认页面提示保存成功。

第一次保存后，地址中的草稿参数就是这张卡的编辑入口。此时还不要发布；发布后的版本不能直接改。

在“设定”输入框粘贴下面这份有效 JSON：

~~~json
{
  "premise": "雾港依靠海门灯塔的主灯阻挡潮雾。主灯失踪后，旧码头首先被雾吞没。",
  "history": "二十年前，守灯人用盐火封住海门下的潮影。如今封印仍在，但主灯的搬运记录被人为撕走。",
  "geography": "锚灯旅店位于高处；淹没旧码头通向潮雾；海门灯塔在礁石尽头。",
  "magic": "盐火只能短暂驱散潮雾，不能直接消灭潮影。潮影会模仿熟人的声音。",
  "currentSituation": "第一夜涨潮前，港务官伊莱拿着缺页账本，请玩家找回被转移的主灯。"
}
~~~

在“规则”输入框粘贴：

~~~json
{
  "hard": [
    "没有可用盐火时，角色不能把潮雾当作安全区域。",
    "物品耐久或数量为零时，不执行对应动作，也不把数值扣成负数。",
    "线索只有在声明动作成功写入 Runtime 后才可称为 confirmed。",
    "NPC 的 secrets 不会自动变成玩家已知事实。"
  ],
  "soft": [
    "叙事保持潮湿、克制、悬疑的低战斗气质。",
    "失败或部分成功要改变局面并保留选择，不要简单重播同一段结果。"
  ]
}
~~~

再次保存。检查点 A 的通过标准是：标题、简介、标签、设定和规则在刷新页面后仍存在，而且没有 JSON 格式错误。

### 17.3 检查点 B：从零创建世界书和预设

这一阶段只创建两种资产，再回到草稿绑定它们。不要把所有设定塞进同一个世界书条目，也不要把世界书当作状态系统。

#### B1. 创建世界书

1. 打开侧栏 **世界书**。
2. 点击 **新建世界书**，名称填“雾港设定”，保存。
3. 逐条新建以下条目；第一张卡只填“关键词、内容、启用”，其余高级选项保持默认。
4. 保存每条后，使用页面的注入检查确认关键词能命中。
5. 返回世界草稿，在 **绑定世界书** 中勾选“雾港设定”。

| 条目标题 | 关键词 | 可直接粘贴的内容 |
|---|---|---|
| 潮雾与潮影 | 潮雾，潮影，海门 | 潮雾会吞没没有稳定光源的区域。潮影会模仿熟悉的声音，把人引向水边；它惧怕盐火，但不会被一盏手提灯永久消灭。 |
| 锚灯旅店 | 锚灯旅店，伊莱，港务官 | 锚灯旅店是港口最后一处稳定灯火。港务官伊莱负责账本和潮汐通行证，只公开账本缺页，不公开自己曾参与主灯转运。 |
| 失踪的港灯 | 失灯，主灯，灯塔，搬运记录 | 海门灯塔的主灯在涨潮前被人搬离。旧账本和钟楼密码各能确认一部分路线；没有证据时不能断言是谁偷走主灯。 |
| 盐火 | 盐火，盐火提灯，潮雾口粮 | 盐火提灯每次点亮都会消耗耐久。潮雾口粮能恢复一点专注，但吃完后不能凭空再获得。 |

#### B2. 创建 RPG 预设

1. 打开侧栏 **提示词**。
2. 点击 **新建预设**，名称填“RPG · 雾港”。
3. 找到“后预设”或 Post-History Instructions，粘贴下列文本后保存。
4. 回到草稿，在 **RPG 提示词预设** 下拉框选择“RPG · 雾港”。

~~~text
你是《雾港：守灯人》的叙事者。玩家拥有完全行动主权；不要替玩家决定态度、台词或最终选择。

先判断行动是否引用已声明的 Runtime 动作，是否满足 availability，是否需要判定。物品耐久或数量为零时，要明确说明它已经耗尽；不得执行，不得伪造扣除，也不得报成系统错误。

需要判定时，先按世界卡检查规则复核，再由客户端掷真实骰子；正文不能伪造骰面。成功、部分成功和失败都必须推进局面，但线索只有在成功执行对应 Runtime 动作后才是 confirmed。

只把已执行的 Runtime 动作或已校验 Typed Patch 写成真实状态变化。不要泄露 secrets、思维链、工具草稿、内部错误或假想 API。

正文后只输出一次 tavern_state_update。推荐选项按 turnContract 给出 3–4 个不重复的纯字符串；玩家仍可自由输入行动。
~~~

检查点 B 的通过标准是：草稿中已勾选世界书、预设下拉框已选择“RPG · 雾港”，并且刷新草稿后这两个绑定仍在。

### 17.4 检查点 C：填写可调查的地点和 NPC

在草稿的地点区域逐项点击 **添加地点**。不要把名称当 ID；后续开局、NPC 和状态更新都引用 ID。

| ID | 名称 | 类型 | 简介 | 标签 |
|---|---|---|---|---|
| harbor-inn | 锚灯旅店 | safe | 高处旅店仍有盐火，伊莱在此保管残缺账本。 | 起点，安全，社交 |
| drowned-pier | 淹没旧码头 | danger | 涨潮后木栈桥半沉，潮影的低语从水下传来。 | 调查，危险，潮雾 |
| sea-gate | 海门灯塔 | landmark | 礁石尽头的灯塔失去主灯，海门锁芯等待两条线索。 | 主线，终局，盐火 |

再在 NPC 区域逐项点击 **添加 NPC**。公开事实可以被叙事自然提起；秘密只应在满足剧情证据后出现。

| ID | 姓名与角色 | 所在地 | 公开事实 | 公开目标 | 秘密 |
|---|---|---|---|---|---|
| npc-elian | 伊莱，港务官 | harbor-inn | 他保管一份被撕掉末页的搬运账本。 | 在涨潮前找回主灯。 | 他亲自签过一次不合规的转运许可。 |
| npc-vessa | 维萨，值夜人 | drowned-pier | 她昨夜听见钟楼里有人敲三短两长。 | 不让任何人独自走上码头。 | 她把密码卖给过一个戴潮纹戒指的人。 |
| npc-mora | 莫拉，守灯人 | sea-gate | 她守在封锁的灯塔门前，拒绝让没有盐火的人进入。 | 保住海门的旧封印。 | 她知道主灯并非被偷走，而是被人故意藏起。 |

推荐补全字段如下：

- 伊莱的 persona：谨慎、疲惫、精于账目；speechStyle：语句短，常用“按规矩”开头。
- 维萨的 persona：警觉、嘴硬、害怕孤独；speechStyle：用海员俗语，避免直接说出潮影。
- 莫拉的 persona：克制、固执、对盐火近乎虔诚；speechStyle：先问代价，再回答问题。

保存草稿。检查点 C 的通过标准是：3 个 locationId 与 3 个 NPC 的 locationId 都能互相对应，且秘密没有被写进公开摘要或初始侧栏。

### 17.5 检查点 D：做出可选择的角色

在 **玩家创建规则** 使用可视化表单，依次添加。这里先用少量数值，让骰子、资源和出身真正改变玩法。

#### D1. 基本资料

| ID | 标签 | 类型 | 必填 | 值或选项 |
|---|---|---|---|---|
| name | 角色名 | text | 是 | 不填默认值 |
| origin | 来处 | select | 是 | harbor：港区；old-city：旧城；outsider：外来者 |
| oath | 对灯火的誓言 | textarea | 否 | 让玩家自由填写 |

#### D2. 点数、属性、技能与资源

把属性点设置为：标签“能力点”、总数 10、最低值 1、模式 pool、成本 above-min。添加：

| 类别 | ID | 标签 | 最小 / 最大 | 默认 | 用途 |
|---|---|---|---:|---:|---|
| 属性 | insight | 洞察 | 1 / 6 | 3 | 解读账本、钟楼、潮雾细节 |
| 属性 | nerve | 意志 | 1 / 6 | 3 | 面对潮影和秘密时保持镇定 |
| 属性 | stride | 身手 | 1 / 6 | 2 | 走过旧码头、脱离危险 |
| 技能 | investigate | 调查 | 0 / 6 | 1 | 搬运记录和密码判定 |
| 技能 | negotiate | 交涉 | 0 / 6 | 1 | 与伊莱、维萨、莫拉谈判 |
| 资源 | hp | 生命 | 0 / 12 | 12 | 失败规则可监听 |
| 资源 | courage | 勇气 | 0 / 6 | 4 | 叙事资源，不与 Runtime 专注混用 |

再添加特质：

| ID | 标签 | 说明 |
|---|---|---|
| salt-sense | 盐火感知 | 靠近残留盐火或被潮雾污染的物件时能觉察异样。 |
| dock-born | 港区出身 | 知道旧码头的潮位、值夜人和黑市传闻。 |
| old-debt | 旧债 | 有人会认出你，但每次帮助可能附带条件。 |

把特质选择数设为 1。这样玩家能选一项明确的故事偏向，而不是把所有好处都带走。

#### D3. 出身预设

添加 3 个预设；每个预设只预填已有字段，不能创造物品或地点：

| 预设 ID | 名称 | 属性倾向 | 技能 / 特质 |
|---|---|---|---|
| harbor-scout | 港区斥候 | 洞察 4、意志 3、身手 3 | 调查 3、交涉 1、salt-sense |
| fallen-keeper | 失职守灯人 | 洞察 3、意志 5、身手 2 | 调查 2、交涉 2、old-debt |
| tide-smuggler | 潮间走私客 | 洞察 2、意志 3、身手 5 | 调查 1、交涉 3、dock-born |

选择 harbor-scout 作为默认预设并保存草稿。草稿阶段先确认预设列表、字段和默认值都显示在制卡表单中；WorldSave 只能基于发布版本创建，因此实际切换三个预设、验证点数和特质的测试放到第 17.10 节发布后进行。

### 17.6 检查点 E：填写本局配置、回合、失败和结束

在“本局配置”输入以下 JSON。它只在创建一条 WorldSave 时选择一次：

~~~json
{
  "title": "本局雾港配置",
  "fields": [
    {
      "id": "difficulty",
      "label": "潮雾压力",
      "type": "select",
      "options": [
        { "value": "story", "label": "故事：失败代价较轻" },
        { "value": "standard", "label": "标准：资源与线索并重" },
        { "value": "hard", "label": "严酷：潮雾更快逼近" }
      ],
      "default": "standard"
    },
    {
      "id": "first-lead",
      "label": "第一条线索",
      "type": "select",
      "options": [
        { "value": "ledger", "label": "先查伊莱的搬运账本" },
        { "value": "bell", "label": "先查旧码头的钟声" }
      ],
      "default": "ledger"
    }
  ]
}
~~~

在“回合约定”输入：

~~~json
{
  "options": { "min": 3, "max": 4 },
  "actionIntent": true
}
~~~

在“时间”输入：

~~~json
{
  "unit": "更",
  "start": 1,
  "turnAdvance": 1
}
~~~

在“失败”输入：

~~~json
{
  "defaultMode": "continue",
  "onZeroHp": "injured",
  "modes": [
    {
      "id": "injured",
      "label": "潮雾负伤",
      "description": "角色被迫撤回锚灯旅店，保留世界线但带着代价继续。",
      "hpRatio": 0.25,
      "effect": "潮雾负伤"
    },
    {
      "id": "continue",
      "label": "带着代价继续",
      "description": "失败改变局面，不删除故事。"
    }
  ]
}
~~~

在“结局”输入：

~~~json
{
  "enabled": true,
  "allowPlayerEnd": true,
  "requireConfirm": true,
  "defaultEndingId": "player-choice",
  "endings": [
    {
      "id": "player-choice",
      "kind": "player-choice",
      "label": "暂别雾港",
      "description": "保留进度，结束这一次旅程。",
      "terminal": true
    },
    {
      "id": "light-restored",
      "kind": "card-defined",
      "label": "灯火归港",
      "description": "在玩家确认后，以重新点亮海门作为命名结局。",
      "terminal": true
    }
  ]
}
~~~

保存草稿。检查点 E 的通过标准是：所有 JSON 都可保存；发布后创建测试存档时，planning 能填写难度与第一条线索，opening 候选恰好给出 4 个不重复选项。

### 17.7 检查点 F：先用表单做物品，再升级成完整 Runtime

先在 **状态与物品** 的可视化表单添加三个变量：

| ID | 标签 | 类型 | 初始 | 最小 / 最大 | 显示 |
|---|---|---|---:|---:|---|
| focus | 专注 | 数值 | 4 | 0 / 8 | 是 |
| clues | 已确认线索 | 数值 | 0 | 0 / 2 | 是 |
| gate-open | 海门已开启 | 开关 | false | — | 是 |

然后添加两件物品：

| 字段 | 盐火提灯 | 潮雾口粮 |
|---|---|---|
| ID | salt-lantern | fog-ration |
| 名称 | 盐火提灯 | 潮雾口粮 |
| 当前耐久 | 3 | 2 |
| 最大耐久 | 3 | 2 |
| 每次使用消耗 | 1 | 1 |
| 已使用次数 | 0 | 0 |
| 表单自动动作 ID（不用填） | use-salt-lantern | use-fog-ration |
| 使用动作名称 | 点亮盐火提灯 | 食用潮雾口粮 |

现在保存草稿并确认表单自动生成 durable-items、use-salt-lantern、use-fog-ration。这一步只验证“标准耐久物品”模板能正常工作；它还没有口粮恢复专注、判定、线索和多条件动作。

接下来进入高级 Runtime JSON：先复制完整内容备份，然后将下面这整份最终 Runtime 一次性替换进去，点击 **从 JSON 载入表单**，再保存草稿。此后这份最终对象以高级 JSON 为唯一编辑源；不要试图用上方物品/动作表单编辑它。

~~~json
{
  "version": 1,
  "variables": [
    {
      "id": "focus",
      "label": "专注",
      "scope": "save",
      "type": "number",
      "initial": 4,
      "min": 0,
      "max": 8,
      "visible": true
    },
    {
      "id": "clues",
      "label": "已确认线索",
      "scope": "save",
      "type": "number",
      "initial": 0,
      "min": 0,
      "max": 2,
      "visible": true
    },
    {
      "id": "missing-light-confirmed",
      "label": "失灯记录已确认",
      "scope": "save",
      "type": "boolean",
      "initial": false,
      "visible": false
    },
    {
      "id": "bell-code-confirmed",
      "label": "钟楼密码已确认",
      "scope": "save",
      "type": "boolean",
      "initial": false,
      "visible": false
    },
    {
      "id": "gate-open",
      "label": "海门已开启",
      "scope": "save",
      "type": "boolean",
      "initial": false,
      "visible": true
    }
  ],
  "collections": [
    {
      "id": "durable-items",
      "label": "随身物品",
      "scope": "save",
      "entrySchema": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "label": { "type": "string" },
          "durability": { "type": "number", "min": 0, "max": 1000000 },
          "maxDurability": { "type": "number", "min": 0, "max": 1000000 },
          "uses": { "type": "number", "min": 0, "max": 1000000000 }
        },
        "required": ["id", "label", "durability", "maxDurability", "uses"],
        "additionalProperties": false
      },
      "initial": [
        {
          "id": "salt-lantern",
          "label": "盐火提灯",
          "durability": 3,
          "maxDurability": 3,
          "uses": 0
        },
        {
          "id": "fog-ration",
          "label": "潮雾口粮",
          "durability": 2,
          "maxDurability": 2,
          "uses": 0
        }
      ]
    },
    {
      "id": "clue-board",
      "label": "线索板",
      "scope": "save",
      "entrySchema": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "title": { "type": "string" },
          "text": { "type": "string" },
          "status": { "type": "string" }
        },
        "required": ["id", "title", "text", "status"],
        "additionalProperties": false
      },
      "initial": [
        {
          "id": "missing-light",
          "title": "失踪的港灯",
          "text": "伊莱的搬运账本缺失最后一页，主灯去向尚未确认。",
          "status": "unconfirmed"
        },
        {
          "id": "bell-code",
          "title": "钟楼密码",
          "text": "旧码头有人敲出三短两长，含义尚未确认。",
          "status": "unconfirmed"
        }
      ]
    }
  ],
  "actions": [
    {
      "id": "use-salt-lantern",
      "label": "点亮盐火提灯",
      "category": "item",
      "description": "消耗 1 点提灯耐久，驱散近处潮雾。耐久归零时不可用。",
      "availability": [
        {
          "type": "collection.number",
          "collectionId": "durable-items",
          "entryId": "salt-lantern",
          "field": "durability",
          "operator": ">=",
          "value": 1
        }
      ],
      "effects": [
        {
          "type": "collection.patch",
          "collectionId": "durable-items",
          "entryId": "salt-lantern",
          "delta": { "durability": -1, "uses": 1 }
        }
      ]
    },
    {
      "id": "eat-fog-ration",
      "label": "食用潮雾口粮",
      "category": "item",
      "description": "消耗 1 份口粮，恢复 1 点专注。口粮或可恢复空间不足时不可用。",
      "availability": [
        {
          "type": "collection.number",
          "collectionId": "durable-items",
          "entryId": "fog-ration",
          "field": "durability",
          "operator": ">=",
          "value": 1
        },
        {
          "type": "variable.compare",
          "variableId": "focus",
          "operator": "<",
          "value": 8
        }
      ],
      "effects": [
        {
          "type": "collection.patch",
          "collectionId": "durable-items",
          "entryId": "fog-ration",
          "delta": { "durability": -1, "uses": 1 }
        },
        {
          "type": "variable.delta",
          "variableId": "focus",
          "delta": 1
        }
      ]
    },
    {
      "id": "rest-at-inn",
      "label": "在旅店休整",
      "category": "rest",
      "description": "在安全处恢复 2 点专注；当前专注高于 6 时不可用，避免超过上限。",
      "availability": [
        {
          "type": "variable.compare",
          "variableId": "focus",
          "operator": "<=",
          "value": 6
        }
      ],
      "effects": [
        {
          "type": "variable.delta",
          "variableId": "focus",
          "delta": 2
        }
      ]
    },
    {
      "id": "inspect-lost-ledger",
      "label": "调查搬运账本",
      "category": "investigate",
      "description": "使用调查技能判定；成功后确认主灯被转移的记录。",
      "availability": [
        {
          "type": "variable.compare",
          "variableId": "missing-light-confirmed",
          "operator": "==",
          "value": false
        }
      ],
      "check": {
        "sides": 20,
        "target": 12,
        "modifiers": [
          { "source": "player", "bucket": "skills", "id": "investigate" }
        ]
      },
      "effects": [
        {
          "type": "variable.delta",
          "variableId": "clues",
          "delta": 1
        },
        {
          "type": "variable.set",
          "variableId": "missing-light-confirmed",
          "value": true
        },
        {
          "type": "collection.patch",
          "collectionId": "clue-board",
          "entryId": "missing-light",
          "set": { "status": "confirmed" }
        }
      ]
    },
    {
      "id": "decode-bell-code",
      "label": "解读钟楼密码",
      "category": "investigate",
      "description": "在已有账本线索的基础上，以洞察判定解读三短两长。",
      "availability": [
        {
          "type": "variable.compare",
          "variableId": "missing-light-confirmed",
          "operator": "==",
          "value": true
        },
        {
          "type": "variable.compare",
          "variableId": "bell-code-confirmed",
          "operator": "==",
          "value": false
        }
      ],
      "check": {
        "sides": 20,
        "target": 11,
        "modifiers": [
          { "source": "player", "bucket": "attributes", "id": "insight" }
        ]
      },
      "effects": [
        {
          "type": "variable.delta",
          "variableId": "clues",
          "delta": 1
        },
        {
          "type": "variable.set",
          "variableId": "bell-code-confirmed",
          "value": true
        },
        {
          "type": "collection.patch",
          "collectionId": "clue-board",
          "entryId": "bell-code",
          "set": { "status": "confirmed" }
        }
      ]
    },
    {
      "id": "open-sea-gate",
      "label": "开启海门",
      "category": "world",
      "description": "需要两条已确认线索与至少 1 点专注；开启后不再重复执行。",
      "availability": [
        {
          "type": "variable.compare",
          "variableId": "clues",
          "operator": ">=",
          "value": 2
        },
        {
          "type": "variable.compare",
          "variableId": "focus",
          "operator": ">=",
          "value": 1
        },
        {
          "type": "variable.compare",
          "variableId": "gate-open",
          "operator": "==",
          "value": false
        }
      ],
      "effects": [
        {
          "type": "variable.set",
          "variableId": "gate-open",
          "value": true
        },
        {
          "type": "variable.delta",
          "variableId": "focus",
          "delta": -1
        }
      ]
    }
  ]
}
~~~

这份对象同时保留了物品、口粮、专注、线索、判定和海门，不会出现“加载线索 JSON 后提灯没了”的问题。它故意使用布尔变量防止同一条线索反复确认，因为当前 availability 只支持集合存在、集合数字比较和变量比较。

这里有一个刻意的表单边界：最终的 eat-fog-ration 同时恢复专注，inspect-lost-ledger、decode-bell-code 和 open-sea-gate 也有多条件、骰子或多效果。它们不符合“可视化物品/普通动作表单”的严格自动模板，因此表单物品区或动作区不一定显示全部条目。这不是丢失状态，也不要为了让它们显示而删掉条件或效果。

保存后重新展开高级 Runtime JSON，确认同一份文本仍同时含有 durable-items、clue-board，以及 6 个 actions。今后要修改这张成品卡的 Runtime，先备份这个完整 JSON，再在这里修改、载入、保存；不要把局部线索片段覆盖回去。

### 17.8 检查点 G：给 AI 配置正式执行边界

在草稿的 **Agent 回合配置** 粘贴下面内容。它让 AI 能复核骰子、请求真实骰子、执行已声明动作、写入受限状态和记录记忆；它不授予任意脚本或直接写文件的能力。

~~~json
{
  "protocol": "tavern.rpg.agent",
  "version": 1,
  "mode": "native",
  "maxSteps": 4,
  "tools": {
    "rules.check": {
      "enabled": true,
      "execution": "client-readonly",
      "description": "只按当前世界卡和玩家数据复核判定。"
    },
    "dice.roll": {
      "enabled": true,
      "execution": "client",
      "description": "只在 rules.check 后请求真实骰子。"
    },
    "runtime.action.execute": {
      "enabled": true,
      "execution": "server",
      "description": "执行已经声明且可用的 Runtime 动作。"
    },
    "state.patch": {
      "enabled": true,
      "execution": "server",
      "description": "提交受 Typed Patch 校验的存档变化。"
    },
    "memory.record": {
      "enabled": true,
      "execution": "server",
      "description": "记录玩家已经历的稳定事实。"
    }
  }
}
~~~

保存草稿后，做一次发布检查，但先不要发布。检查点 G 的通过标准是：

1. Runtime、Agent、references 和 prompt 分类都没有阻塞错误；
2. 检查报告没有把 use-salt-lantern、eat-fog-ration、inspect-lost-ledger 或 open-sea-gate 标成未声明；
3. 如果报告说属性或技能不存在，回到第 17.5 节确认 investigate 和 insight 的 ID 没拼错；
4. 如果报告说 UI 不合法，先完成下一节的全部字段再重试。

### 17.9 检查点 H：把工作区变成独立美化页面

这一节不是“贴一段 CSS”。它会让世界卡接管 RPG 工作区，保留一个卡内消息流、卡内选项和卡内输入框，并提供盐火快捷按钮。所有运行时变化仍通过正常玩家回合保存。

先理解两个约束：

- 自定义页面只能调用读取、提交玩家选择、全屏和退出等 Bridge；不能在卡内 JavaScript 直接写 Runtime。
- 当前编辑器的“完整模板”和某些旧示例仍可能出现 action、patch 或 mvu 直写字样。不要复制它们；本章只使用 choose、数据绑定和宿主自动挂载槽位。

#### H1. 先填 UI 壳，不写 extension

在 **RPG 界面配置** 输入框粘贴下面对象。此时不要点击“载入完整模板”，也不要手动添加 extension 字段；下一步的可视化扩展编辑器会负责生成 extension。

~~~json
{
  "schemaVersion": 1,
  "layout": "custom",
  "theme": {
    "tokens": {
      "bg-scene": "#061217",
      "bg-0": "#091a20",
      "bg-1": "#102a31",
      "panel": "#102a31",
      "panel-2": "#153940",
      "panel-rgb": "16,42,49",
      "accent": "#78dccb",
      "accent-2": "#5f9de0",
      "accent-rgb": "120,220,203",
      "text": "#edf7f6",
      "muted": "#a9c3c3",
      "line": "rgba(120,220,203,0.25)",
      "line-soft": "rgba(120,220,203,0.10)",
      "radius": "14px",
      "chat-font-size": "17px",
      "chat-line-height": "1.8",
      "chat-para-gap": "0.76em",
      "chat-side-pad": "24px"
    }
  },
  "shell": {
    "navigation": "hide",
    "topbar": "hide",
    "fullscreen": true,
    "escape": "fullscreen"
  },
  "entryGate": {
    "enabled": true,
    "title": "雾港：守灯人",
    "message": "潮雾正在越过旧码头。带好盐火，决定你要追查、谈判，还是先守住海门。",
    "confirmText": "进入雾港",
    "cancelText": "返回世界库",
    "fullscreen": false
  },
  "regions": {
    "topbar": { "mode": "hide" },
    "sidebar.left": { "mode": "hide" },
    "narrative": { "mode": "hide" },
    "options": { "mode": "hide" },
    "input": { "mode": "hide" },
    "sidebar.right": { "mode": "hide" },
    "status": { "mode": "hide" },
    "overlay": { "mode": "hide" }
  }
}
~~~

这里的 theme.tokens 只在这张世界卡激活时覆盖宿主主题；退出世界卡后会恢复用户设置。layout 为 custom 时，只有在下一步真的配置了 extension 后才会接管工作区，所以不要在填完这一段后半途保存并离开。

#### H2. 用可视化编辑器填写扩展元数据

展开 **扩展可视化设置**，按下表设置：

| 控件 | 取值 |
|---|---|
| 启用世界扩展 | 勾选 |
| 独立沉浸页面 | 制作和调试时先取消勾选；稳定后可勾选为进入世界即以沉浸布局接管（不是浏览器原生全屏） |
| 扩展 action 触发 AI 回合 | 不勾选 |
| 挂载阶段 | 只勾选“正式游玩” |
| 标题 | 雾港航海日志 |
| 高度 | 800 |
| 超时 | 1200 |
| 读取世界公开资料 | 勾选 |
| 读取当前存档投影 | 勾选 |
| 保存开局配置 | 不勾选 |
| MVU 协议配置 | 留空 |

这个可视化编辑器在保存时会覆盖 ui.extension。因此后续需要改 HTML、CSS 或 JS 时，始终回到这三个字段改；不要在上方 UI JSON 里同时维护第二份 extension。

#### H3. 填入 HTML

把下面 HTML 完整粘贴到扩展的 HTML 字段。不要在 HTML 里写 script 标签；脚本只能放在下一步的 JS 字段。

~~~html
<section class="keeper-shell" aria-labelledby="keeper-title">
  <header class="keeper-head">
    <div class="keeper-brand">
      <p class="keeper-kicker">MIST HARBOR · LOGBOOK</p>
      <h1 id="keeper-title" data-tavern-bind="world.title">雾港：守灯人</h1>
      <p class="keeper-place">当前位置：<span data-tavern-bind="save.state.locationId">载入中</span></p>
    </div>
    <div class="keeper-head-actions">
      <button id="keeper-fullscreen" type="button">全屏</button>
      <button id="keeper-exit" type="button">返回世界库</button>
    </div>
  </header>

  <section class="keeper-hud" aria-label="当前状态">
    <article class="keeper-stat">
      <span>更次</span>
      <strong data-tavern-bind="save.state.time.value">—</strong>
      <small data-tavern-bind="save.state.time.unit">更</small>
    </article>
    <article class="keeper-stat">
      <span>专注</span>
      <strong data-tavern-bind="save.state.runtime.variables.focus">—</strong>
      <small>/ 8</small>
    </article>
    <article class="keeper-stat">
      <span>线索</span>
      <strong data-tavern-bind="save.state.runtime.variables.clues">—</strong>
      <small>/ 2</small>
    </article>
    <article class="keeper-stat">
      <span>海门</span>
      <strong data-tavern-bind="save.state.runtime.variables.gate-open">未开</strong>
      <small>状态</small>
    </article>
  </section>

  <section class="keeper-board">
    <aside class="keeper-side keeper-side-left" aria-label="装备与提示">
      <p class="keeper-side-title">盐火装备</p>
      <button id="keeper-lantern" class="keeper-lantern" type="button">
        <span>点亮盐火提灯</span>
        <small id="keeper-lantern-count">读取耐久中</small>
      </button>
      <p class="keeper-note">快捷按钮只提交一次正式玩家行动；耐久为零时会自动禁用。</p>
    </aside>

    <main class="keeper-story">
      <div class="keeper-feed" data-tavern-messages aria-live="polite">
        正在连接雾港……
      </div>
      <section class="keeper-options" aria-label="推荐行动">
        <p class="keeper-side-title">下一步</p>
        <div data-tavern-options></div>
      </section>
      <form class="keeper-composer" data-tavern-input>
        <label class="keeper-sr-only" for="keeper-action">自由行动</label>
        <textarea id="keeper-action" rows="2" placeholder="写下你的行动；Enter 发送，Shift+Enter 换行"></textarea>
        <button type="submit" data-tavern-submit>发送</button>
      </form>
    </main>

    <aside class="keeper-side keeper-side-right" aria-label="本局状态">
      <p class="keeper-side-title">本局世界线</p>
      <p>存档：<span data-tavern-bind="save.name">载入中</span></p>
      <p>版本：<span data-tavern-bind="save.revision">—</span></p>
      <p class="keeper-side-title keeper-clue-title">线索板</p>
      <ul id="keeper-clue-list" class="keeper-clue-list" aria-label="线索状态"></ul>
      <p id="keeper-status" class="keeper-status" role="status">正在连接……</p>
      <p class="keeper-note">使用推荐选项、快捷按钮和自由输入都会走同一条可校验回合链。</p>
    </aside>
  </section>
</section>
~~~

#### H4. 填入 CSS

把下面 CSS 完整粘贴到扩展的 CSS 字段。它不下载字体、图片或第三方资源；界面由渐变、边框和少量低调动画组成，因此可以在隔离 iframe 的 CSP 中正常运行。

~~~css
:root {
  color-scheme: dark;
}

.keeper-shell {
  min-height: 100%;
  box-sizing: border-box;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 16px;
  padding: clamp(14px, 2.8vw, 34px);
  color: var(--text, #edf7f6);
  background:
    radial-gradient(circle at 80% 0%, rgba(95, 157, 224, .18), transparent 32%),
    radial-gradient(circle at 15% 100%, rgba(120, 220, 203, .10), transparent 38%),
    var(--bg-0, #091a20);
}

.keeper-head,
.keeper-head-actions,
.keeper-hud,
.keeper-composer {
  display: flex;
  align-items: center;
  gap: 10px;
}

.keeper-head {
  justify-content: space-between;
  padding: 2px 2px 14px;
  border-bottom: 1px solid var(--line, rgba(120,220,203,.25));
}

.keeper-brand h1,
.keeper-brand p,
.keeper-side p {
  margin: 0;
}

.keeper-brand h1 {
  font-size: clamp(22px, 3vw, 34px);
  letter-spacing: .03em;
}

.keeper-kicker {
  margin-bottom: 5px !important;
  color: var(--accent, #78dccb);
  font: 700 11px ui-monospace, "Cascadia Code", monospace;
  letter-spacing: .16em;
}

.keeper-place,
.keeper-side,
.keeper-note,
.keeper-status {
  color: var(--muted, #a9c3c3);
}

.keeper-hud {
  flex-wrap: wrap;
}

.keeper-stat {
  min-width: 108px;
  flex: 1 1 108px;
  padding: 11px 13px;
  border: 1px solid var(--line, rgba(120,220,203,.25));
  border-radius: var(--radius, 14px);
  background: linear-gradient(145deg, rgba(255,255,255,.06), rgba(255,255,255,.015));
}

.keeper-stat span,
.keeper-stat small {
  display: block;
}

.keeper-stat span {
  color: var(--muted, #a9c3c3);
  font-size: 11px;
}

.keeper-stat strong {
  display: inline-block;
  margin: 2px 4px 0 0;
  color: var(--accent, #78dccb);
  font-size: 25px;
}

.keeper-stat small {
  font-size: 11px;
}

.keeper-board {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(168px, .55fr) minmax(0, 2fr) minmax(168px, .55fr);
  gap: 14px;
}

.keeper-story,
.keeper-side {
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--line, rgba(120,220,203,.25));
  border-radius: var(--radius, 14px);
  background: rgba(9, 26, 32, .72);
  box-shadow: 0 18px 46px rgba(0, 0, 0, .16);
}

.keeper-story {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto auto;
  gap: 12px;
  padding: 13px;
}

.keeper-side {
  align-self: start;
  padding: 14px;
}

.keeper-side-title {
  margin-bottom: 10px !important;
  color: var(--accent, #78dccb);
  font-weight: 700;
}

.keeper-clue-title {
  margin-top: 18px !important;
}

.keeper-clue-list {
  display: grid;
  gap: 7px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.keeper-clue-list li {
  padding: 8px 9px;
  border: 1px solid var(--line-soft, rgba(120,220,203,.10));
  border-radius: 9px;
  background: rgba(255,255,255,.025);
  color: var(--muted, #a9c3c3);
  font-size: 12px;
  line-height: 1.45;
}

.keeper-clue-list li[data-confirmed="true"] {
  border-color: rgba(120,220,203,.34);
  color: var(--text, #edf7f6);
}

.keeper-feed {
  min-height: 0;
  overflow: auto;
  padding: 5px 7px 12px;
  scrollbar-gutter: stable;
}

.keeper-feed .tavern-message {
  max-width: min(100%, 74ch);
  padding: 12px 13px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: rgba(255,255,255,.035);
}

.keeper-feed .tavern-message-user {
  border-color: rgba(95,157,224,.34);
  background: rgba(95,157,224,.13);
}

.keeper-feed .tavern-message-assistant {
  border-color: rgba(120,220,203,.14);
}

.keeper-options [data-tavern-options] {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.keeper-shell button,
.keeper-shell textarea {
  box-sizing: border-box;
  min-height: 44px;
  border: 1px solid var(--line, rgba(120,220,203,.25));
  border-radius: 10px;
  color: inherit;
  background: rgba(21,57,64,.82);
  font: inherit;
}

.keeper-shell button {
  padding: 9px 12px;
  cursor: pointer;
  transition: transform .16s ease, border-color .16s ease, background .16s ease, opacity .16s ease;
}

.keeper-shell button:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: var(--accent, #78dccb);
  background: rgba(35,79,84,.95);
}

.keeper-shell button:disabled {
  cursor: not-allowed;
  opacity: .45;
}

.keeper-shell button:focus-visible,
.keeper-shell textarea:focus-visible {
  outline: 3px solid var(--accent, #78dccb);
  outline-offset: 2px;
}

.keeper-lantern {
  width: 100%;
  text-align: left;
  border-color: rgba(255,193,89,.42) !important;
  background: linear-gradient(135deg, rgba(255,193,89,.20), rgba(120,220,203,.10)) !important;
}

.keeper-lantern span,
.keeper-lantern small {
  display: block;
}

.keeper-lantern small {
  margin-top: 3px;
  color: var(--muted, #a9c3c3);
}

.keeper-note {
  margin-top: 12px !important;
  font-size: 12px;
  line-height: 1.6;
}

.keeper-composer textarea {
  min-width: 0;
  flex: 1;
  padding: 10px 12px;
  resize: vertical;
}

.keeper-composer button {
  min-width: 76px;
  background: var(--accent, #78dccb);
  color: #062024;
  font-weight: 800;
}

.keeper-status {
  margin-top: 16px !important;
  line-height: 1.55;
}

.keeper-status[data-busy="true"]::before {
  content: "● ";
  color: var(--accent, #78dccb);
}

.keeper-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}

@media (prefers-reduced-motion: no-preference) {
  .keeper-lantern:not(:disabled) {
    animation: keeper-lantern-glow 4s ease-in-out infinite;
  }
}

@keyframes keeper-lantern-glow {
  50% { box-shadow: 0 0 20px rgba(255,193,89,.18); }
}

@media (max-width: 900px) {
  .keeper-board {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(420px, 1fr) auto;
  }

  .keeper-side {
    display: grid;
    gap: 8px;
  }
}

@media (max-width: 620px) {
  .keeper-shell {
    gap: 12px;
    padding: 12px;
  }

  .keeper-head,
  .keeper-composer {
    align-items: stretch;
    flex-direction: column;
  }

  .keeper-head-actions {
    width: 100%;
  }

  .keeper-head-actions button {
    flex: 1;
  }

  .keeper-options [data-tavern-options] {
    grid-template-columns: 1fr;
  }

  .keeper-composer button {
    width: 100%;
  }
}
~~~

#### H5. 填入 JS

把下面 JavaScript 完整粘贴到扩展的 JS 字段。它只读 Runtime 来显示提灯耐久，耐久归零时禁用快捷按钮；点击按钮后调用 choose 提交一回合，而不是直接扣耐久。

~~~js
(() => {
  const status = document.querySelector("#keeper-status");
  const lanternButton = document.querySelector("#keeper-lantern");
  const lanternCount = document.querySelector("#keeper-lantern-count");
  const clueList = document.querySelector("#keeper-clue-list");
  const fullscreenButton = document.querySelector("#keeper-fullscreen");
  const exitButton = document.querySelector("#keeper-exit");
  let submittingLantern = false;

  const setStatus = (text, busy) => {
    if (!status) return;
    status.textContent = text;
    status.dataset.busy = busy ? "true" : "false";
  };

  const findLantern = runtime => {
    const entries = runtime && runtime.collections && runtime.collections["durable-items"];
    if (!Array.isArray(entries)) return null;
    return entries.find(entry => entry && entry.id === "salt-lantern") || null;
  };

  const renderLantern = runtime => {
    const lantern = findLantern(runtime);
    const durability = Number(lantern && lantern.durability);
    const maxDurability = Number(lantern && lantern.maxDurability);
    const available = Number.isFinite(durability) && durability >= 1;
    if (lanternCount) {
      lanternCount.textContent = Number.isFinite(durability)
        ? "耐久 " + durability + " / " + (Number.isFinite(maxDurability) ? maxDurability : "—")
        : "未找到提灯";
    }
    if (lanternButton) lanternButton.disabled = !available || submittingLantern;
  };

  const renderClues = runtime => {
    if (!clueList) return;
    const entries = runtime && runtime.collections && runtime.collections["clue-board"];
    const clues = Array.isArray(entries) ? entries : [];
    clueList.replaceChildren();
    if (!clues.length) {
      const empty = document.createElement("li");
      empty.textContent = "尚无线索。";
      clueList.append(empty);
      return;
    }
    clues.forEach(clue => {
      const item = document.createElement("li");
      const confirmed = clue && clue.status === "confirmed";
      item.dataset.confirmed = confirmed ? "true" : "false";
      item.textContent = (confirmed ? "已确认 · " : "待确认 · ") + String(clue && clue.title ? clue.title : "未命名线索");
      clueList.append(item);
    });
  };

  const renderRuntime = runtime => {
    renderLantern(runtime);
    renderClues(runtime);
  };

  const readRuntime = async () => {
    try {
      renderRuntime(await TavernExtension.runtime.get());
    } catch (error) {
      setStatus("读取状态失败：" + error.message, false);
    }
  };

  lanternButton?.addEventListener("click", async () => {
    if (submittingLantern || lanternButton.disabled) return;
    submittingLantern = true;
    try {
      renderRuntime(await TavernExtension.runtime.get());
      setStatus("正在请求点亮提灯……", true);
      await TavernExtension.choose(
        "点亮盐火提灯，驱散近处的潮雾。",
        { actionId: "use-salt-lantern" }
      );
      setStatus("本回合已提交并保存。", false);
    } catch (error) {
      setStatus("提灯行动失败：" + error.message, false);
    } finally {
      submittingLantern = false;
      readRuntime();
    }
  });

  fullscreenButton?.addEventListener("click", async () => {
    try {
      const result = await TavernExtension.fullscreen();
      setStatus(result && result.fullscreen ? "已进入浏览器全屏。" : "沉浸界面已启用；浏览器未授权全屏。", false);
    } catch (error) {
      setStatus("全屏失败：" + error.message, false);
    }
  });

  exitButton?.addEventListener("click", async () => {
    try {
      await TavernExtension.exitWorld();
    } catch (error) {
      setStatus("退出失败：" + error.message, false);
    }
  });

  TavernExtension.on("turn.start", () => setStatus("正在请求 AI……", true));
  TavernExtension.on("agent.execute", () => setStatus("正在结算声明动作……", true));
  TavernExtension.on("agent.complete", () => setStatus("正在写入叙事……", true));
  TavernExtension.on("turn.commit", () => {
    setStatus("本回合已保存。", false);
    readRuntime();
  });
  TavernExtension.on("turn.error", event => {
    setStatus("回合失败：" + (event && event.message ? event.message : "请重试"), false);
    readRuntime();
  });

  window.addEventListener("tavern-context", event => {
    const context = event.detail;
    renderRuntime(context && context.save && context.save.state && context.save.state.runtime);
    const revision = context && context.save && context.save.revision;
    if (Number.isInteger(revision) && !submittingLantern) {
      setStatus("已同步至 revision " + revision + "。", false);
    }
  });

  TavernExtension.getContext()
    .then(context => {
      renderRuntime(context && context.save && context.save.state && context.save.state.runtime);
      setStatus("雾港界面已连接。", false);
    })
    .catch(error => setStatus("连接失败：" + error.message, false));
})();
~~~

保存草稿。第一次进入这张有脚本的世界卡时，宿主会要求确认扩展代码；只对自己阅读过的 HTML、CSS、JS 授权。扩展运行在隔离 iframe，不能访问宿主 DOM、API Key、文件、网络或外部图片，因此不要试图在这里接入不受控的第三方脚本。

检查点 H 的通过标准是：

1. 进入游戏后只显示这张卡的 HUD、消息、选项和输入，而不是宿主的两侧栏和底部输入；
2. 消息始终出现在唯一的 data-tavern-messages 中，新回合会滚到最新消息；
3. 选项、Enter 发送和 Shift+Enter 换行都正常；
4. 点击盐火提灯后，它提交一整回合，耐久由服务端正式结算，再从 3 变 2；
5. 两条线索在真正成功后，从“待确认”变为“已确认”；只有叙事没有状态写入时不会假装变化；
6. “点亮盐火提灯。”这类与无参数动作标签精确相同的自由输入会走正式动作结算；提灯耐久为 0 后，卡内快捷按钮变灰，自由输入也必须说明无法执行；
7. 小屏宽度下按钮仍不小于 44px，布局改为单列；
8. 全屏和返回世界库不会丢失存档。

如果你希望进入世界时立即以**沉浸布局**接管，回到扩展可视化设置勾选“独立沉浸页面”后保存。它不是浏览器原生全屏：制作阶段建议先保持未勾选，方便从工作台返回修正；浏览器原生全屏仍必须由用户点击卡内“全屏”按钮，浏览器也可能拒绝授权。

### 17.10 检查点 I：发布并完成第一条世界线

现在按下面顺序操作，不要跳过发布检查：

1. 点击 **保存草稿**。
2. 点击 **检查发布条件**。
3. 先修复 definition 和 runtime 错误，再修 references，最后修 prompt。不要靠删掉一半功能让报告暂时变绿。
4. 检查通过后点击 **发布为新世界**。
5. 回到 **世界与存档**，为“雾港：守灯人”新建存档，名称填“雾港测试世界线”。
6. 新建存档后会先出现入口页；点击“进入雾港”。入口页确认发生在建角前，这是正常顺序。
7. 在建角页选择 harbor-scout，角色名填“岚”，选择 salt-sense，并确认属性和技能仍在预算内。
8. 在本局配置选择“标准”和“先查伊莱的搬运账本”。
9. 在 planning 按第 5.3 节的雾港表填写起始地点 harbor-inn、在场 NPC npc-elian、当前局面与知识边界。
10. 确认进入 opening 前，候选开场只有 4 个互不重复的纯文本选项；进入后检查自定义界面加载完成。

开局出现以下四类行动就说明世界内容基本连通：查账本、问伊莱、去旧码头、点亮盐火。它们不必逐字一致，但不能在没有调查前宣布谁偷走了主灯，也不能把 NPC 秘密直接放进选项。

### 17.11 检查点 J：按这一张试玩表验证所有功能

下面不是“看看大概效果”，而是发布测试版本后的手工回归。每一行通过后再走下一行。判定有随机性；若失败，验证失败后果和状态未误写，再通过另一条路线或再次符合条件地尝试。

| 顺序 | 玩家操作 | 必须看到的结果 | 不应出现的结果 |
|---:|---|---|---|
| 1 | 新建存档时确认入口页，再完成建角、planning 与 opening | 自定义 HUD、消息、选项和输入完整出现 | 宿主侧栏和第二个输入框同时出现 |
| 2 | 点击卡内“点亮盐火提灯” | 产生一个正式回合；提灯耐久 3 → 2，uses 0 → 1 | 点击后立即本地改数值、没有 AI 回合 |
| 3 | 用选项或自由输入食用潮雾口粮 | 耐久 2 → 1，uses +1，专注在未满时 +1 | 专注超过 8 或口粮变为负数 |
| 4 | 再吃一次口粮 | 耐久 1 → 0 | 物品消失但动作仍可用 |
| 5 | 尝试第三次吃口粮 | 动作不可用；AI 说明已耗尽并提供别的行动 | Agent execute 阶段报错，或仍扣成 -1 |
| 6 | 调查伊莱的搬运账本 | 先规则复核和真实骰子；成功时 clues 0 → 1，失踪的港灯变 confirmed | 正文说确认，线索板仍为 unconfirmed |
| 7 | 解读钟楼密码 | 仅在第一条线索已确认时可执行；成功时 clues 1 → 2 | 未确认账本就直接开启第二条线索 |
| 8 | 线索不足时尝试开启海门 | 动作不可用，叙事说明还缺线索或专注 | gate-open 变 true |
| 9 | 两条线索确认且专注至少为 1 后开启海门 | gate-open 变 true，focus −1，动作之后不可再执行 | 同一动作反复扣专注 |
| 10 | 点击预设选项、发送自由输入、刷新页面 | 消息始终停留在最新回合；所有耐久、线索和 gate-open 保持 | 消息回到最顶端或刷新后丢状态 |
| 11 | 缩到约 390px 宽，测试输入和按钮 | 单列布局、控件可点、输入不横向溢出 | 小屏文字被裁切，按钮小于手指可点范围 |
| 12 | 复制存档、重置原存档、导出世界包 | 副本与原存档状态互不影响；重置回到初始 Runtime | 副本继承后续扣除，或导出时混入 API Key |

对于第 6、7 步，成功不是由文字宣告决定的。成功时，原始回合里必须有与动作 ID 对应的正式执行；失败或部分成功时，线索保持未确认并给出新的局面或路线。若一次骰子失败，不要强制让 AI 再写成功文本。

### 17.12 格式、动作或界面异常时：按终端定位，而不是盲目重试

右上角的 **终端** 是排查一回合的最快入口。遇到问题后，先保存屏幕和这一回合的 RAW，再按以下顺序看：

1. 在 INPUT 中确认玩家实际提交的文本与 actionId；例如卡内提灯快捷按钮应提交 use-salt-lantern。
2. 在 RAW 中确认正文末尾只有一个 tavern_state_update，且 JSON 没有注释、半截代码块或第二个 options。
3. 在结构化状态块中确认 baseRevision 是本回合开始时的 revision，options 是 3–4 个不重复字符串。
4. 在 Agent 轨迹中确认判定动作顺序是 rules.check → dice.roll → runtime.action.execute，而不是模型在正文里自己编骰面。
5. 在错误提示中按“根因”修，不要反复点击重试把同一个无效请求送给 AI。

| 终端或界面现象 | 真正原因 | 修复位置 |
|---|---|---|
| 动作当前不可用，durable-items 的耐久为 0 | 正常的 availability 防护 | 不要重试同一动作；让 AI 提供补给、休息或其他路线 |
| patch.runtime.action.execute 未声明动作 | 模型输出了不存在的 actionId，或世界卡 ID 拼错 | Runtime actions、RPG 预设、玩家原始输入三处统一 ID |
| options 在请求顶层与 patch 内不一致 | 模型生成了两套不同选项 | 预设要求只保留唯一状态块；不要在正文另外拼 options |
| 结构化标签缺失或 JSON 无效 | 模型掉格式、正则破坏标签，或提示词泄露工具草稿 | 看 RAW；修正预设后重试，不要用正则猜测并写入状态 |
| 线索正文已说确认，面板未确认 | 只写叙事，没有执行 inspect-lost-ledger 或 decode-bell-code | 检查 Agent 是否执行同一 actionId；线索状态必须由 action effect 写入 |
| 自定义页面空白 | extension 没启用、脚本未授权、HTML 为空，或 custom 把宿主区域隐藏后没有扩展 | 检查 H1–H5 的所有字段；先在同一草稿修复后保存 |
| 控制台说 TavernExtension.action 不是函数 | 复制了旧模板或旧演示卡 | 删除旧 action、patch、mvu 调用；改用 TavernExtension.choose 提交行动 |
| revision 409 或回应被拒绝 | 页面上有过期回合、旧响应或并发提交 | 重新读取当前状态，放弃旧响应，只从最新回合继续 |

如果必须暂时救回一张自定义界面卡，先在 UI JSON 把 layout 改回 host 并删除 extension，再保存草稿。宿主界面恢复后，再逐项重新填 H1–H5；这比在空白 custom 页面里盲猜字段快得多。

### 17.13 发布后的维护：版本、导出与安全边界

一张发布卡的后续修改也按同一纪律进行：

1. 编辑草稿，先在新的测试 WorldSave 中验证，不要拿用户正在玩的存档试错。
2. 发布 v2 后，旧 WorldSave 仍绑在旧 worldVersion；先做升级预演，再决定是否升级某一条存档。
3. 改动 Runtime ID、删除地点或 NPC 前，先检查是否有旧存档、开局计划、动作和 UI 数据绑定引用它们。
4. 导出世界包前，手工打开导出预览，确认没有玩家存档、服务商设置或 API Key。
5. 每次改 UI 都在宽屏和约 390px 的窄屏各测一轮；每次改 Agent/Runtime 都至少测一次零资源、一次判定、一次失败或拒绝路径。

当前系统的安全边界也决定了“功能丰富”应怎样扩展：

| 想增加的玩法 | 当前正式做法 |
|---|---|
| 更多消耗品、次数、耐久 | 在 durable-items 增加条目和 availability，不用旧背包投影 |
| 声望、倒计时、章节、警戒 | 新增 Runtime number、boolean 或 enum 变量 |
| 线索、人物关系、战利品清单 | 新增 Runtime collection，并用 collection.add、remove、patch |
| 复杂门槛 | 多个 availability 条件做 AND；不要让 UI 直接绕过条件 |
| 骰子动作 | 在 action.check 绑定真实 player attribute 或 skill |
| 更漂亮的侧栏和 HUD | 先用 theme、sidebar 或 data-tavern-bind；需要整页体验才用 custom extension |
| 开局问卷 | 使用 playerCreation 与 sessionSetup；需要卡内开局页时才使用 setup surface 和 write.setup |

不要为“更丰富”重新启用旧 events、factions、conflicts、growth、经济、硬编码任务或可直接写 Runtime 的接口。它们不是当前新卡的可发布模型；新的状态应始终能落到 Runtime 的变量、集合、动作与受校验回合中。

### 17.14 最终验收清单

在把《雾港：守灯人》分享给他人前，逐项确认：

- [ ] 空白草稿、世界书、RPG 预设、地点、NPC、建角和本局配置都已保存。
- [ ] Runtime 是第 17.7 节的完整对象，而不是把局部线索 JSON 覆盖掉表单生成物。
- [ ] 两件耐久物品都能从正数用到 0，0 时不执行、不报 Agent 错误、不变负数。
- [ ] 两条线索都有真实 check、成功写入 confirmed、失败不伪造 confirmed。
- [ ] 海门动作需要两条线索和专注，成功后只执行一次。
- [ ] AI 每回合只有一个状态块、选项数量符合约定、不会把思维链显示给玩家。
- [ ] 自定义界面只有一个消息槽、一个输入槽和一组选项；卡内快捷按钮只调用 choose。
- [ ] 扩展未声明 write.runtime、tool.call 或 MVU，也没有调用 action、patch 等不存在的方法。
- [ ] 宽屏、窄屏、刷新、复制、重置、导出、导入、主动结束和重开都已试过。
- [ ] 发布检查通过，且作者自己完成过第 17.11 节的完整试玩表。

完成这些检查后，你拥有的不是“看起来像 RPG 的文案卡”，而是一张有可验证状态、可恢复世界线、可独立美化、能继续扩充内容的可玩世界卡。下一张卡可以复用这个结构，只替换世界书、地点、NPC、Runtime 条目和扩展配色；不要复制一份旧世界线数据当作新规则。
