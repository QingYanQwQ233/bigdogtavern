# Tavern RPG 卡 · 产品契约 v1

> **版本**：1.0 · **状态**：冻结（Frozen） · **冻结日期**：2026-10-01
> **来源**：`docs/rpg-card-product-roadmap.md` §1.1–1.3。本文件是这些内容的**版本化权威副本**。

---

## 0. 本文件的地位

| 文档 | 角色 | 能否推翻本契约 |
|---|---|---|
| **本文件（product-contract-v1）** | **宪法** —— 不可违反项的唯一权威来源 | — |
| `rpg-card-product-roadmap.md` | **计划** —— 任务拆解与进度，随实施推进变化 | ❌ 不能 |
| `rpg-card-api.md` / `world-card-architecture.md` | **实现** —— 字段与协议的细则 | ❌ 不能（只能在契约内细化） |
| `CHANGELOG.md` | **历史** —— 变更记录 | ❌ 不能 |

**引用方式**：不变量用 `INV-1` … `INV-10` 编号。**编号永久稳定**：只允许追加新编号，不允许重编号或改变既有编号的语义。代码审查、提交信息、检查脚本都应直接引用编号。

---

## 1. 产品定义

> RPG 卡不是"只有开场白的角色卡"，而是一个**可运行的世界种子**。

```text
RPG 卡（WorldCard）
  定义世界、规则、玩家创建、NPC、游戏系统、AI 行为与 UI 投影
    ↓ 创建
独立存档（WorldSave）
  保存玩家、时间、世界事实、NPC 状态、地图、记忆与已提交回合
    ↓ 每次行动
观察 → 玩家自由输入 → 行动解析 → 必要时判定 → 世界反馈 → 原子提交 → 新局面
```

**分工**：AI 同时承担世界模拟器、GM / DM、NPC、叙事者和裁定助手，但**不能替玩家决定核心意图**。程序负责身份归属、规则边界、随机数、校验、提交与恢复。

> 由此得到的直接推论（非新增要求，仅为便于实现者理解）：
> AI 产出的一切都只是**候选**；程序是唯一的**仲裁者**与**持久化者**。

---

## 2. 数据所有权

两条互不相通的主链：

```text
CharacterCard → ChatSession        （酒馆 / Tavern）
WorldCard     → WorldSave          （RPG）
```

- `WorldCard` 只定义**世界种子**：静态、不可变、可版本化（`worldVersion`）。
- 一切**可变化事实**必须写入明确的 `saveId`；不存在"全局可变世界状态"。
- 存档的正式事实来源是 `WorldSave@revision`；卡片的稳定设定来源是 `WorldCard@worldVersion`。两者在 Prompt 中必须**分层表达**，存档状态不得回写卡片。

对应不变量：`INV-1`、`INV-2`、`INV-3`。

---

## 3. 不可违反的产品不变量

| 编号 | 不变量 | 可验证判据 |
|---|---|---|
| **INV-1** | `WorldCard` 只定义世界种子；一切可变化事实必须写入明确的 `saveId`。 | `check_session_binding`、`check_runtime_roundtrip` |
| **INV-2** | 一个存档是一条独立世界线。玩家、NPC、关系、地图、图片、时间、选项、状态、记忆和事件不能跨存档串联。 | `check_session_binding`、`check_world_delete`，以及双世界 / 双存档隔离回归 |
| **INV-3** | 酒馆仍是 `CharacterCard → ChatSession`；RPG 是 `WorldCard → WorldSave`，两条历史与 Prompt 路径不得互读。 | `check_session_binding`、`check_rp_single_request` |
| **INV-4** | 玩家拥有角色。AI 可描述已发生的直接后果，不能替玩家选择核心意图、台词、情感立场或不可逆行动。 | `check_rpg_agent`（`ActionIntent.raw` 保留玩家原文）、`check_prompt_presets` |
| **INV-5** | AI 输出只是候选。只有通过规则校验并成功写入存档的变化才是正式事实。 | `check_runtime_roundtrip` + `applyRpgPatch` 的 CAS / receipt 校验 |
| **INV-6** | 随机数由程序产生并记录，AI 不能自行宣称掷骰结果。 | `check_dynamic_adjudication`；`dice.roll` 门控、receipt `diceTotal`、"缺少客户端骰子结果"拒绝 |
| **INV-7** | RPG 卡扩展必须是声明式 JSON；导入的 HTML、JavaScript、EJS、MVU 或脚本默认不执行。 | `check_script_compat_world`、`check_custom_ui_world`、`check_world_package_contract` |
| **INV-8** | 默认数据继续来自 `_defaults.json`，不能把世界内容、属性名、资源名、规则或 UI 栏目写死在前端。 | `check_demo_setup_surface`、`check_css_vars` |
| **INV-9** | 选项只是建议，自由文本输入始终可用，且不能被选项范围限制。 | `check_rpg_protocol`、`check_rpg_minimal_world` |
| **INV-10** | 失败必须生成新局面；是否永久死亡、重伤、俘虏或回退由卡规则定义。 | `check_dynamic_adjudication`、`check_recovery` |

**说明**：判据里列出的脚本是**当前**的守护方式，不是对实现方式的约束 —— 只要不变量成立，实现可以替换；替换时须同步更新本表的判据列。

---

## 4. 模块清单（M0–M9）

横向能力，跨阶段补齐；详细任务拆解见 roadmap §2。

| 编号 | 模块 |
|---|---|
| M0 | 产品契约与数据所有权 |
| M1 | RPG 卡定义与作者工作台 |
| M2 | 玩家创建、初始关系与开场 |
| M3 | 回合内核、行动解析与判定 |
| M4 | NPC、关系与认知 |
| M5 | 世界时间、事件与目标 |
| M6 | 冲突、资源与成长 |
| M7 | 状态、记忆与上下文 |
| M8 | 叙事界面与信息投影 |
| M9 | 存档、失败、结局与平台 |

---

## 5. 变更流程与版本语义

| 变更 | 版本动作 | 必须同时做 |
|---|---|---|
| 新增一条不变量 | MINOR（1.0 → 1.1） | 追加新编号（**不得复用**旧号）；补判据；更新本表与 roadmap §1.3 |
| 修改既有不变量的语义 / 删除 | **MAJOR**（1.x → 2.0） | 新建 `product-contract-v2.md`；写明迁移说明与受影响模块；旧文件保留为历史 |
| 新增 / 调整模块划分 | MINOR | 更新 §4 与 roadmap §1.2 |
| 仅更新判据（实现替换） | PATCH（1.0.0 → 1.0.1） | 同步对应 `scripts/check_*` |

**提交规范**：涉及不变量的改动，commit message 必须引用编号，例如 `fix(INV-2): 复制存档时重映射临时实体 ID`。

---

## 6. 冻结声明

本版本（1.0）为**首次冻结**，内容等同于 `docs/rpg-card-product-roadmap.md` §1.1–1.3 在 2026-10-01 的实际约定。

冻结后：
- 任何实现若与本文件冲突，**以本文件为准**；
- 若认为本文件有误，走 §5 的变更流程，**不得**在实现里"就地绕过"。
