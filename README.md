# Tavern · AI RP 框架演示

福瑞 / 角色扮演 × AI RP × RPG 的前端框架 demo。
当前版本聚焦「框架」：**自定义 API 接入 + AI 角色扮演聊天**。
世界观与角色设定尚未确定，界面内所有设定性文字均为**占位**。

## 快速开始

需要 Node.js 18+（零依赖，无需 npm install）。

```bash
node server.js
# 打开 http://localhost:3000
```

1. 点击左下角「API 设置」
2. 选择服务预设（OpenAI / DeepSeek / OpenRouter / Ollama / LM Studio），或选「自定义」手动填
3. 填入 Base URL、API Key（本地服务可留空）；点模型旁的「获取」可从上游 `/models` 拉取可用模型列表
4. 点「测试连接」验证，再点「保存」
5. 回到对话页，开始对话（默认流式输出）

## 自定义功能（参考 SillyTavern）

- **模型从上游获取**：设置 → 连接 →「获取」，代理请求 `{Base URL}/models`，列表自动填入输入建议
- **生成参数**：温度、top_p、频率/存在惩罚、seed、最大 Token
- **上下文控制**：「发送历史」限制发给模型的最近消息条数
- **流式输出**：SSE 逐块实时刷新（server.js 流式管道转发）
- **配置存档 Profile**：多套 API 配置命名保存 / 一键切换
- **对话管理**：多会话（顶部「📂」或「会话栏」布局），**可命名**（新建时命名 / 下拉 ✎ 重命名 / 列表双击改名），新建 / 切换 / 删除，数据存本地
- **角色卡管理**：左侧「角色」进入角色库——多角色创建/编辑，支持 **Character Card V1/V2** JSON 导入导出（description / scenario / first_mes / system_prompt / post_history_instructions / tags）
- **提示词预设**（左侧「提示词」独立栏目）：多套 System Prompt + 历史后指令模板，命名保存 / 切换 / 删除；不选预设时编辑「全局默认」
- **世界书**（左侧「世界书」独立栏目）：**多本世界书**，每本含多个条目；一本「设为全局」对所有对话生效，其余可**绑定到角色卡**（仅该角色对话时生效）；触发词（支持正则）命中 → 注入百科内容；常驻条目、顺序、扫描深度、整词匹配（中文建议关闭）
- **角色绑定**：角色卡可绑定「提示词预设」（system_prompt 为空时自动使用）与「世界书」（专属百科）
- **角色提示词**：每个角色可单独设置 system_prompt（非空时覆盖全局/预设）与 post_history_instructions
- **输出格式控制 UI**：回复格式预设（自由/简短/长叙事/动作扮演/JSON）+ 自定义格式指令 + stop sequences

### 提示词构建管线（发送时）

```
角色 system_prompt →（否则）提示词预设 →（否则）全局 System Prompt
→ + 格式指令 + 自定义格式指令
→ 世界书命中条目（常驻优先，按顺序）
→ 最近 N 条对话历史
→ post_history_instructions（角色 → 预设 → 全局，插在历史后，权重高）
```

## 多布局版本 × 多色调（未定稿）

点右下角浮动按钮（🏮）打开「界面设置」面板，可切换 **4 套整体布局** 与 **4 套色调**（两者自由组合）：

| 布局 | 结构 | 特点 |
|---|---|---|
| 🏮 **酒馆** | 三栏工作台 | 左导航 + 对话 + 右侧栏（角色卡常驻） |
| 📜 **书信** | 单栏沉浸 | 顶部导航条 + 居中窄栏对话，角色卡收进右侧抽屉 |
| 🎮 **HUD** | 游戏面板 | 通栏状态条 + 大对白框 + 底部动作区，JRPG 对话框感 |
| 🗂 **会话栏** | Discord 式 | 图标导航 + 会话列表 + 对话三栏 |

| 色调 | 风格 |
|---|---|
| 暖木烛光 / 明亮日系 / 暗夜光影 / 苔绿自然 | 颜色、字体、圆角、发光、背景粒子整套切换 |
| **macOS 毛玻璃**（参考风格） | 纯灰分层 + 系统级 backdrop-blur、1px 边框、无渐变无发光无装饰动画 |

选择会记住（存在浏览器本地）。定稿流程：多版对比 → 选定整体布局与色调 → 再深入定制细节（届时可精简为单一版本）。

> 「macOS 毛玻璃」参考了 macOS Vibrancy 设计语言：层级即色彩（#1c1c1e→#2c2c2e→#3a3a3c）、系统级模糊、衬线标题 + 无衬线正文、1px 半透明边框、无装饰主义。与「会话栏」布局组合即为 macOS 聊天应用形态。

「角色卡」在非三栏布局中通过对话头部「角色卡」按钮以右侧抽屉形式打开。

## 支持哪些 API

任意 **OpenAI 兼容 Chat Completions** 接口，例如：

| 服务 | Base URL | 备注 |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | 需 Key |
| DeepSeek | `https://api.deepseek.com/v1` | 需 Key |
| OpenRouter | `https://openrouter.ai/api/v1` | 需 Key |
| Ollama（本地） | `http://localhost:11434/v1` | 无需 Key |
| LM Studio（本地） | `http://localhost:1234/v1` | 无需 Key |
| 任何中转 / 自建 | 自定义 | 只要兼容 `/chat/completions` |

> 参考 SillyTavern / Open WebUI 的做法：预设下拉 + Base URL + Key + 模型 + 测试连接。

## 文生图（测试功能，默认关闭）

设置 → **文生图** tab 是独立开关，全套参数可配：

| 项 | 说明 |
|---|---|
| API 类型 | `openai`（兼容 `/images/generations`：dall-e-3 / gpt-image-1 等）或 `sd`（Stable Diffusion WebUI `/sdapi/v1/txt2img`） |
| Base URL / Key | OpenAI 系填 `https://api.openai.com/v1`；本地 SD 填 `http://localhost:7860`（Key 留空） |
| 生成参数 | 尺寸 / steps / CFG / 采样器 / 负面提示词（SD 用） |
| 提示词来源 | `LLM 生成`（按剧情写英文提示词，走对话 API）或 `直接用剧情文本` |
| 自动生图 | 回复完成后自动触发（异步，不阻塞对话） |
| 生成测试图 | 手动输入测试提示词，立即出一张图 |

- 图片以 `{role:'image'}` 消息显示在聊天栏（`<img>`），**不会进入对话上下文**
- 请求走本地代理 `/api/image`（绕 CORS），响应解析同时兼容 `url` 与 `base64`（SD 的 `images[]`）
> 浏览器请求统一走本地代理 `POST /api/chat`，由 `server.js` 注入 `Authorization` 头并转发，因此不受 CORS 限制。

## 配置导入 / 导出

- 「导出配置」：把当前 API 设置下载为 JSON。
- 「导入配置」：单击按钮粘贴 JSON；双击按钮选择文件。
- 支持字段：`baseUrl`、`apiKey`、`model`、`temperature`、`maxTokens`、`systemPrompt`、`preset`。

配置 / 对话 / 主题选择保存在浏览器 `localStorage`（键 `rpg-airp:*`），不上传服务器。

## 项目结构

```
server.js          # 本地服务器：静态服务 + /api/chat 代理（零依赖）
public/
  index.html       # 三栏布局：导航 / 对话 / 角色卡，含设置弹窗与风格切换器
  styles.css       # 语义化 CSS 变量 + 4 套主题（body[data-theme]）
  app.js           # 前端逻辑：设置、对话、角色卡、主题切换、背景粒子
```

## 当前状态与后续路线

- [x] 自定义 API 接入（OpenAI 兼容 + 本地代理 + 测试连接 + 导入导出）
- [x] AI RP 对话（System Prompt 引导、快捷行动、角色卡可编辑）
- [x] 多风格主题切换（4 套占位风格，待定稿）
- [ ] 世界观 / 角色设定（全部占位）
- [ ] AI 记忆系统（短期 / 长期 / 关系值）
- [ ] 多角色管理、角色卡导入
- [ ] 流式输出（Streaming）
- [ ] 任务 / 背包 / 属性系统

## 安全提醒

`server.js` 的代理不做鉴权与 SSRF 防护，**仅供本地开发 / 演示**，勿部署公网。
API Key 只存在浏览器本地，代理仅转发不落盘。
