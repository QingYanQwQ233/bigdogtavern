---
name: ui-design-system
description: BigDogTavern 的 UI/UX 设计总入口。做任何界面设计、交互设计、信息架构、组件规范、响应式、无障碍或 UI 评审之前，先读这个 skill，再按路由表加载 references/ 里的对应知识。触发词：设计、改版、布局、导航、返回、出口、组件、样式、交互、UI 评审、无障碍。
---

# UI Design System — BigDogTavern

这是一个**路由层**，不是知识库。它只负责两件事：判断当前任务需要哪些设计知识，以及告诉你去读哪个文件。

## 这个项目的 UI 是什么

BigDogTavern 是**离线 AI RP/RPG 应用的本地 Web UI**。它不是 SaaS Dashboard，是叙事驱动的游戏平台。

由此推出三条不可协商的前提：

1. **叙事内容是主角，chrome 是配角。** UI 抢戏就是设计失败。
2. **宿主必须中立。** World Card 会覆盖 8 个区域的视觉（decorate / replace / append / hide），组件设计不能依赖某一套具体配色。
3. **离线、零依赖。** 前端是手写 CSS + 拼接 JS，没有构建器、没有 Tailwind、没有 npm 依赖，禁止外链资源（字体 / CSS / JS / 图标）。

## 何时使用

- 设计或改版任何界面、面板、弹窗、抽屉
- 决定信息层级、导航结构、返回路径
- 定义或修改组件、尺寸、间距、状态
- UI 评审、无障碍检查、设计债清理
- 编写或修改 World Card 的 UI 覆盖层

## 动手前的三步

1. **先定任务** —— 这个界面存在的目的是什么？"成功"长什么样？谁是主要使用者？
2. **再定结构** —— 信息架构 → 布局 → 组件 → 状态。**不要从样式开始。**
3. **最后定样式** —— token 已经有了，不要发明。

## 路由表

| 你要做的事 | 读这个 |
|---|---|
| 组织页面 / 导航 / 层级 / 出口 | `references/information-architecture.md` |
| 判断可用性、降低认知负担、防错 | `references/ux-principles.md` |
| 决定什么先被看到 | `references/visual-hierarchy.md` |
| 字号、行高、字体角色 | `references/typography.md` |
| 颜色、对比度、主题覆盖 | `references/color.md` |
| 间距 / 圆角 / 动效尺度 | `references/spacing.md` |
| 设计或统一组件 | `references/components.md` |
| 断点、移动端行为、触控命中区 | `references/responsive.md` |
| 键盘、焦点、命中区、ARIA | `references/accessibility.md` |
| 做评审、找问题、写整改计划 | `references/design-review.md` |

**一次不要读超过 2–3 个 references。** 先读最相关的那一个，不够再读。

## 已安装的专项 skill 与本 skill 的分工

本 skill 是项目层总入口；下面这些是通用专项技能，在你需要更深的方法论时加载：

| 专项 skill | 什么时候它比本 skill 更合适 |
|---|---|
| `information-architect` | 需要完整的 sitemap / taxonomy 产出 |
| `ux-flow-planner` | 需要多步流程与边界路径分析 |
| `ux-heuristics` | 需要按 Nielsen 10 + Laws of UX 逐条评分 |
| `design-reviewer` | 需要对着 token 做设计系统一致性审计 |
| `component-builder` | 需要新组件的完整规格（状态 / token / a11y） |
| `page-designer` | 需要整页布局规格 |
| `content-copy-designer` | 需要按钮文案 / 错误文案 / 空状态文案 |
| `improve-ui` | 需要**只读审计 + 可执行的整改计划** |
| `ui-designer` | 需要从屏幕目标到可实施规格的通用产出顺序 |
| `usability-psychologist` | 需要从认知负荷 / 防错角度评估 |
| `accessibility-engineer` | 需要语义 HTML / ARIA / 键盘操作的实现规则 |

它们都是第三方 MIT 技能，原样收录，来源与许可证见 `skills/README.md`。

## BigDogTavern 特有约束（先读，违反即返工）

1. **叙事优先** —— 对话文本是主角。
2. **宿主中立** —— 不要设计依赖特定配色的组件；主题 token 可被世界卡覆盖。
3. **离线** —— 字体只能用系统本地；图标只能用内联 SVG 或文本符号。
4. **零 npm 依赖** —— 没有 Tailwind，不要产出 Tailwind 类名。
5. **状态优先** —— World State / Player State / Memory / Events 的可见性高于装饰。
6. **可定制** —— 主题值要过安全校验（禁尖括号、花括号、分号、`url()`）。
7. **动态内容** —— 要能容纳任意长度、任意语言的正文。

## 输出格式

设计类任务按这个顺序给结论，不要跳步：

1. 目标与成功标准
2. 信息架构（层级 / 出口 / 优先级）
3. 布局与组件树
4. 状态矩阵（默认 / hover / focus-visible / active / disabled / 空 / 加载 / 错误）
5. token 引用（只引用已有 token；要新增必须说明理由）
6. 响应式行为（三档断点各自的行为）
7. 无障碍检查
8. 风险与已知偏差

## 禁止

- 空泛评价（"更高级"、"更现代"、"更好看"）—— 必须给出可验证的理由或测量
- 发明与现有 token 冲突的新值
- 为一次性需求建立抽象
- 复制 Material Design / Apple HIG 或其他产品的视觉风格
- 声称访问了无法访问的来源
