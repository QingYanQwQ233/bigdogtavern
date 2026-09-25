# 候选评估表

评估日期：2026-09-25。评估对象是当时各仓库的默认分支 HEAD。

## 评估标准（三条线）

1. **UI/UX 知识覆盖** —— 是否包含 IA / User Flow / Visual Hierarchy / Layout / Typography / Color / Spacing / Components / Design Tokens / Interaction / Responsive / Accessibility
2. **工程适配** —— 能否被本地读取；不依赖付费 SaaS；不需要 API Key；不与本项目"离线 + 零 npm 依赖 + 手写 CSS"的约束冲突
3. **内容质量** —— 优先结构化知识、设计原则、设计模式、检查清单、组件规范；**降级**营销文案、纯案例展示、纯图片、UI 生成器、强绑定某个 SaaS

## 已安装（11）

### 来源 A：`richhemsley3/claude-design-skills`（MIT）

| skill | 体积 | 为什么装 |
|---|---|---|
| `information-architect` | 5.5 KB | **本地最大的缺口**。定义内容结构、导航层级、分类法、信息分组 |
| `ux-flow-planner` | 4.8 KB | 多步流程与边界路径分析（brief 明确要求 User Flow 知识） |
| `ux-heuristics` | 8.5 KB + references | 按 Nielsen 10 + Laws of UX 逐条评分，带评估框架参考文件 |
| `design-reviewer` | 5.2 KB + references | 对着 token 做设计系统一致性审计（token / 状态 / 间距 / 暗色） |
| `component-builder` | 5.9 KB + references | 组件规格：状态覆盖 + token 引用 + a11y 要求。对应"同级组件不一致" |
| `page-designer` | 6.6 KB + references | 整页布局规格，输出声明为 framework-agnostic |
| `content-copy-designer` | 6.4 KB | 按钮 / 错误 / 空状态文案。对应"出口文案不统一"的文案侧 |

### 来源 B：`mae616/design-skills`（MIT）

| skill | 体积 | 为什么装 |
|---|---|---|
| `ui-designer` | 2.4 KB | 从屏幕目标到可实施规格的产出顺序。**stack 无关**，是决策框架不是代码模板 |
| `usability-psychologist` | 2.6 KB | 认知负荷 / 防错 / 最小无障碍检查清单。填补 UX 评估缺口 |
| `accessibility-engineer` | 4.1 KB | 语义结构 / ARIA 最小化 / 键盘焦点 / 表单 / 反模式。**比同类更 stack 无关** |

### 来源 C：`ibelick/ui-skills`（MIT）

| skill | 体积 | 为什么装 |
|---|---|---|
| `improve-ui` | 7.8 KB + references | **本批质量最高的一份**：只读审计 + 三道证据闸门（契约 / 运行时 / 修正）+ 证伪环节 + 最多 3 条发现 + 输出自包含实施方案。与这个项目的证据文化同构 |

## 未安装

### `mae616/design-skills`

| skill | 不装的理由 |
|---|---|
| `frontend-implementation` | 与本地已装的 `frontend-design` + `web-html-development` 重叠 |
| `creative-coder` | 与本地 `frontend-design` 的动效部分重叠；且本项目已有动效尺度契约 |

### `ibelick/ui-skills`

| skill | 不装的理由 |
|---|---|
| `baseline-ui` | **Stack 冲突**：强制要求 Tailwind CSS + `motion/react` + `tw-animate-css`。本项目零 npm 依赖、手写 CSS |
| `fixing-accessibility` | 与已装的 `accessibility-engineer` 重叠（后者更 stack 无关） |
| `fixing-metadata` | **场景不适用**：SEO / Open Graph / canonical。本项目是离线本地应用，没有爬虫 |
| `fixing-motion-performance` | 与本地 `web-perf` + `web-interface-guidelines` 重叠 |
| `ui-skills-root` | 是 CLI 路由层，依赖 `npx ui-skills` 联网拉取。本项目需要离线自包含，统一入口由 `ui-design-system` 承担 |

### `richhemsley3/claude-design-skills`

| skill | 不装的理由 |
|---|---|
| `design-critique`（23 KB） | 与 `ux-heuristics` **高度重复**（同一套 Nielsen 10 + Laws of UX） |
| `accessibility-auditor` | 与已装的 `accessibility-engineer` 重叠；且 WCAG 审计侧本项目已有 `check_ui_accessibility.js` / `audit_ui_accessibility.js` |
| `design-pipeline` | 编排器，会与本项目的 `ui-design-system` 入口冲突；且它依赖的 `user-researcher` / `journey-map` 未安装，链是断的 |
| `product-designer` | 定位是**数据管理软件**（表格 / 筛选 / CRUD / 权限），与叙事驱动的 RPG 应用不对口 |
| `qa-specialist` | 与项目已有的 96 项检查脚本体系重叠 |
| `user-researcher` | 需要真实用户研究流程，对当前单人开发阶段边际收益低 |
| `wireframe-agent` | 低保真线框，与 `page-designer` 前置阶段重叠 |
| `interactive-flow-diagram`（26 KB） | 生成 D3.js 独立 HTML，**需要外链 CDN**，违反离线约束 |
| `journey-map`（32 KB） | 同上 |
| `screen-flow-diagram`（31 KB） | 同上 |
| `ux-map-maker` | 元技能，只负责在上面三个之间选择 |

> 四个图表类 skill 合计约 90 KB，占该仓库 `skills/` 体积的绝大部分，且都违反离线约束 —— 这是它们被整体排除的主因。

### 整体排除的仓库

| 仓库 | 结论 | 理由 |
|---|---|---|
| `charlomrt-boop/ui-design-skill` | **不装** | 附件是风格推荐库（`design-trends-2026.md` / `font-pairings.md` / `palettes.md`），与"不复制产品视觉风格"冲突；且用户正在自行确定视觉参考，此时间点安装视觉风格库会造成冲突。其 SKILL.md 有 55 KB，单文件承载全部知识，也不符合"知识分层"原则 |
| `tyfarrago-hub/taste` | **不装** | 34 个单文件 skill，大量是**特定视觉风格**（工业风 / 极简 / 宇宙玻璃 / 高端视觉）。同样的理由：视觉风格由用户决定。其中通用的审计类与已装集合重复 |
| `Hitbullets/codex-skills` | **不装** | 只有 2 个 skill，均为二手改编：`frontend-design` 改编自 anthropics/skills（本地已装同源版本），`ui-ux-pro-max` 改编自 nextlevelbuilder 的原仓库。**要装应该装原仓库，而不是转手版本** |

## 不可达 / 未评估

本轮**没有**"声称评估了但实际没抓到"的条目。事实状态：

- `charlomrt-boop/ui-design-skill` 首次 clone **网络失败**（`Failed to connect to github.com port 443`），第二次成功。其内容已按上面的理由排除，但可以确认是**已读到内容后**做的判断
- 其余 5 个候选仓库全部成功 clone 或读取

## 与本地已有 skill 的去重分析

评估时本地已有 19 个 skill（`/sdcard/Download/Operit/skills/`）。与本批相关的重复项：

| 本地已有 | 覆盖内容 | 导致哪些候选被排除 |
|---|---|---|
| `frontend-design` | 高设计质量的前端界面、避免通用 AI 审美 | mae616 的 `frontend-implementation`、`creative-coder` |
| `web-interface-guidelines` | 无障碍 / 键盘 / 表单 / 动画 / 性能 / 暗色主题的评审清单 | ibelick 的 `fixing-accessibility`、`fixing-motion-performance` |
| `web-html-development` | HTML / CSS / JS、移动优先 UI | mae616 的 `frontend-implementation` |
| `web-perf` | Core Web Vitals 审计 | ibelick 的 `fixing-motion-performance` |

**结论**：本批补的是 **IA / UX 评估 / 设计系统审计 / 组件规格 / 页面规格 / UI 文案 / 无障碍实现规则 / 审计纪律**这 8 个本地完全空白的领域，没有制造重复。
