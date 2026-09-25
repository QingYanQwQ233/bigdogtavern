# skills/

本目录是 BigDogTavern 的 **UI/UX 设计技能来源**，也是这些技能的**唯一可信副本**。

## 为什么放在仓库里

Agent 实际读取技能的位置是 Operit 的全局目录：

```
/sdcard/Download/Operit/skills/<skill_name>/SKILL.md
```

那个目录在设备上、不进版本控制、换机就没了。所以本仓库保留一份来源，用 `scripts/sync_skills.js` 推过去。

**本目录是来源，全局目录是部署目标。** 两者不一致时以本目录为准，用同步脚本收敛。

## 加载机制（Operit）

- 每个 skill 是一个**目录**，目录内必须有 `SKILL.md`（`skill.md` 也认）
- `SKILL.md` 顶部用 frontmatter 写 `name` 和 `description`
- `description` 决定什么时候被触发 —— 写清楚"做什么 + 什么时候用"
- 可选子目录：`references/` / `scripts/` / `templates/` / `examples/` / `assets/`
- 目录名与 `name` 不一致时以扫描到的目录为准，**不要改名**

## 同步

```bash
node scripts/sync_skills.js --check   # 只比对，不写
node scripts/sync_skills.js           # 只推送差异 / 新增，不覆盖同名冲突
node scripts/sync_skills.js --force   # 强制覆盖目标
```

`scripts/check_skills_sync.js` 会随 `run_checks.js` 跑，逐文件比对两侧。全局目录不存在时会**优雅跳过**并说明原因（保证在别的环境不误报）。

## 目录结构

```
skills/
├── README.md              ← 本文件
├── EVALUATION.md          ← 候选评估表：装了什么、拒了什么、为什么
├── ui-design-system/      ← 本项目的统一入口（自写，中文）
│   ├── SKILL.md           ← 只做路由，不塞知识
│   └── references/        ← 10 个主题参考文件
└── <第三方 skill>/        ← 原样收录，见下表
```

## 来源与许可证

所有第三方技能均为 **MIT**，**原样收录、未做任何内容修改**，每个目录内保留上游 `LICENSE`。

| skill | 上游仓库 | 上游提交 | 许可证 |
|---|---|---|---|
| `information-architect` | richhemsley3/claude-design-skills | `1185d0d84974eaed6e927b953243c96754de02b6` | MIT © 2026 Rich Hemsley |
| `ux-flow-planner` | 同上 | 同上 | 同上 |
| `ux-heuristics` | 同上 | 同上 | 同上 |
| `design-reviewer` | 同上 | 同上 | 同上 |
| `component-builder` | 同上 | 同上 | 同上 |
| `page-designer` | 同上 | 同上 | 同上 |
| `content-copy-designer` | 同上 | 同上 | 同上 |
| `ui-designer` | mae616/design-skills | `79e3398bee27664de70c7b97a30dd928f6fe7976` | MIT © 2025 mae616 |
| `usability-psychologist` | 同上 | 同上 | 同上 |
| `accessibility-engineer` | 同上 | 同上 | 同上 |
| `improve-ui` | ibelick/ui-skills | `fd0889bdf72aee45c32028b4643b09735d5b5a34` | MIT © 2026 Julien Thibeaut |

**不要修改这些第三方文件的内容。** 需要调整行为时：

1. 优先在 `ui-design-system/references/` 里写项目层的覆盖说明
2. 确实需要改动时，写进 `EVALUATION.md` 并在 `CHANGELOG` 记录理由

## 项目层覆盖约定

第三方技能是通用的，有几处约定与本项目不同。**以本项目的约定为准**：

| 第三方约定 | 本项目约定 |
|---|---|
| `create-design-md` 要求产出根目录的 `DESIGN.md` + YAML frontmatter + `npx @google/design.md spec` 校验 | **未采用该技能**。本项目的设计总纲是 `docs/design/DESIGN_CONSTITUTION.md`，Markdown 散文，不引入 npm 依赖 |
| `improve-ui` 要求把整改计划写到 `design-plans/` | 沿用，但目录为 `.design-plans/`（点前缀，避免被 `run_checks.js` 扫描） |
| 各技能假设存在 `tokens/colors.css` 之类的设计系统路径 | 本项目的 token 在 `public/styles.css` 的 `:root`，契约在 `docs/ui-beauty-declaration.md §4` |
| 部分技能假设 Tailwind / React | **本项目零 npm 依赖、手写 CSS。** 相关技能已在评估阶段排除 |

## 如何新增一个 skill

1. 按 `EVALUATION.md` 的三条标准评估（知识覆盖 / 工程适配 / 内容质量）
2. 确认与已有 11 个以及本地 19 个不重复
3. clone 上游，原样复制到 `skills/<name>/`，带上 `LICENSE`
4. 更新 `EVALUATION.md` 与本文件的来源表
5. 跑同步 + `node scripts/run_checks.js`

## 已知限制

- 技能是**知识**，不是**执行器**。它们不会自动改代码。
- `description` 写得不好会导致不触发 —— 这是最常见的失效模式，改动时优先检查它。
- 本目录的内容会随上游演进过时。需要更新时重新 clone 并更新提交哈希，不要手工打补丁。