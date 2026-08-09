# Tavern · AI RP / RPG 框架

福瑞（furry）异世界 × AI 角色扮演 × AI 驱动 RPG 的前端框架 demo。

**双模式**：🍺 酒馆模式（AI RP 聊天）+ ⚔ RPG 模式（AI 驱动冒险）——同一套数据基建，两种玩法形态。
世界观与角色设定仍未确定，所有设定性文字均为**占位**；提示词与预设数据全部外置可编辑。

## 快速开始

需要 Node.js 18+（零依赖，无需 `npm install`）。

```bash
node server.js
# 打开 http://localhost:3000
```

1. 侧栏左下「设置」→ 连接
2. 选服务预设（OpenAI / DeepSeek / OpenRouter / Ollama / LM Studio / 自定义）或手动填 Base URL + Key
3. 点「获取」从上游拉模型列表，「测试连接」验证后保存
4. 侧栏底部「模式：酒馆 ⇄ 模式：RPG」切换玩法

## 🍺 酒馆模式（AI 角色扮演聊天）

- **角色卡**：多角色创建/编辑，Character Card V1/V2 JSON 导入导出（description / scenario / first_mes / system_prompt / post_history_instructions / tags）
- **提示词预设**（「提示词」栏）：多套 System Prompt + 历史后指令模板，命名保存/切换/删除；角色卡可绑定预设
- **世界书**：多本世界书 × 条目（触发词支持正则 / 常驻 / 顺序 / 扫描深度 / 整词匹配）；一本全局生效，其余可绑定角色
- **记忆 / 玩家设定**：玩家外形背景偏好 + 记忆条目（注入上下文）
- **旁白 / 对白拆分（状态机）**：引号内 → 角色气泡，其余 → 旁白；支持中文「」『』“”/ 英文 `"` `'`、嵌套引号、不成对回退、`*动作*` 归旁白
- **消息操作**：hover 重新生成 / 编辑 / 删除 / 复制

## ⚔ RPG 模式（AI 驱动冒险）

**布局**：顶栏（角色 / Lv / 金币 / 位置）· 左栏（角色面板 + 背包）· 中央 AI 叙事流 · 右栏（任务 + 地图占位）· 底栏（HP/MP/EXP 状态条 + 快捷行动 + 输入）

**一切由 AI 驱动**（AI 输出 → 正则处理 → 自动执行）：

| AI 输出 | 正则规则 | 前端处理 |
|---|---|---|
| ` ```rpg ```` JSON 代码块 | ` ```rpg ... ```` 提取 | 状态/数值自动计算（HP/MP/金币/等级/经验/最大值的相对增减 + 上下限）、道具增删、任务推进、位置移动、回复选项 |
| 骰子表达式 `d20+5` / `2d6` | `(\d*)d(\d+)([+-]\d+)?` | 自动掷骰，结果以 meta 消息注入并**进入 AI 上下文**（AI 能基于结果推进） |
| 引号对白 | 状态机 | 气泡 / 旁白 |
| `options` 字段 | ````rpg ```` 内 JSON | 渲染为底部**快捷行动栏**（点击即发送该行动） |

- **DM 身份**：RPG 模式下 AI 是"世界的化身 / 地下城主"，直接扮演所有 NPC、称呼玩家为"你"，禁止以"作者"口吻自称（含反例约束）
- **正反示例**：预设内置 1 个完整正例 + 4 个反例（缺选项 / 空泛选项 / 凭空物品 / 对白混旁白），并在对话历史最前注入示例回合（in-context few-shot）
- **每会话独立状态**：`session.rpgState` 持久化，切换会话恢复各自进度
- **禁止凭空添加**：道具/任务必须由剧情产出（掉落、NPC 委托等）

## 预设与数据外置（不写死）

所有可编辑内容在 `public/data/_defaults.json`（新环境自动初始化），运行时数据存 `public/data/*.json`：

- `presets`：提示词预设——「RP 基础（示例）」（酒馆 writer 身份）、**「RPG 叙事引擎（示例）」**（DM 身份 + 正反例，可在「提示词」页直接编辑）
- `rpg`：初始状态 / 输出协议（stateInstruction）/ 行动选项空提示 / 示例回合（exampleTurn）
- `gen`：AI 生成角色卡 / 世界书条目的指令
- 切换模式自动切换当前预设（RPG → RPG 叙事引擎；酒馆 → RP 基础）

## 文生图（测试功能，默认关闭）

设置 → 文生图：API 类型 `openai`（`/images/generations`，dall-e-3 / gpt-image-2 等）或 `sd`（Stable Diffusion WebUI `/sdapi/v1/txt2img`）；提示词来源可选 LLM 生成或剧情文本；自动生图（异步）；图片以 `role:'image'` 消息显示、**不进对话上下文**，本地保存后持久化。

## 支持哪些 API

任意 **OpenAI 兼容 Chat Completions** 接口（本地代理 `POST /api/chat` 注入 `Authorization` 并转发，绕 CORS）：

| 服务 | Base URL |
|---|---|
| OpenAI | `https://api.openai.com/v1` |
| DeepSeek | `https://api.deepseek.com/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Ollama（本地） | `http://localhost:11434/v1` |
| LM Studio（本地） | `http://localhost:1234/v1` |
| 任意中转 / 自建 | 兼容 `/chat/completions` 即可 |

## 移动端 / PWA

- 移动优先布局：侧栏默认隐藏，汉堡打开抽屉导航；桌面侧栏可收起（滑出 + 主区让位，动画可靠）
- PWA：manifest + service worker + 图标（对话气泡风格），套壳 APK 全屏可用
- Android 套壳：`android/` 内嵌 NanoHTTPD 服务器（移植 server.js），WebView 加载本地页面，可构建离线 APK（GitHub Actions workflow）

## 项目结构

```
server.js                     # 本地服务器：静态服务 + /api/chat + /api/image + /api/data 代理（零依赖）
public/
  index.html                  # 双模式布局（酒馆三区 / RPG 五区）+ 设置弹窗 + 管理页
  styles.css                  # 语义化 CSS 变量 + 5 套色调（含 macOS 毛玻璃）+ 双模式布局
  app.js                      # 前端逻辑：模式/会话/角色/预设/世界书/记忆/生图/RPG 状态机/掷骰
  data/_defaults.json         # 模板数据（预设/世界书/角色/rpg 协议/生成指令）
  data/*.json                 # 运行时数据（本地生成，不入库）
  vendor/                     # marked + DOMPurify（本地依赖，零网络）
android/                      # WebView 套壳工程（NanoHTTPD 内嵌服务器）
.github/workflows/android-apk.yml  # push 自动构建 APK
```

## 当前状态

- [x] 自定义 API 接入（OpenAI 兼容 + 本地代理 + 测试连接 + 导入导出）
- [x] 双模式（酒馆 RP / RPG 冒险），会话按模式分流
- [x] RPG 全 AI 驱动（状态/数值/道具/任务/骰子/行动选项 正则解析自动执行）
- [x] 提示词预设 / 世界书 / 角色卡 / 记忆系统
- [x] AI 生成角色卡与世界书条目
- [x] 旁白/对白状态机拆分、消息编辑/重生成/复制
- [x] 文生图（openai / SD 双格式）、PWA、Android 套壳
- [ ] 世界观 / 角色设定（全部占位）
- [ ] 地图系统（RPG 右栏占位）
- [ ] 短期 / 长期记忆分层
- [ ] 风格定稿（5 套色调对比中）

## 安全提醒

`server.js` 的代理不做鉴权与 SSRF 防护，**仅供本地开发 / 演示**，勿部署公网。
API Key 只存浏览器本地与本地数据文件（`public/data/*.json` 已在 `.gitignore`），代理仅转发不落盘。
