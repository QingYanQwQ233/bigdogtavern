# Tavern · AI RP / RPG 框架

福瑞（furry）异世界 × AI 角色扮演 × AI 驱动 RPG 的前端框架 demo。

**双模式**：🍺 酒馆模式（AI RP 聊天）+ ⚔ RPG 模式（AI 驱动冒险）——同一套数据基建，两种玩法形态。
**世界地图**：🗺 算法生成 + 数据层 + AI 美化 + 上下文注入（RPG 模式右栏，可重新生成 / AI 作画 / 查看数据）。
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

- **角色卡**：多角色创建/编辑；AI 按“一句话定角色 → 动态基本信息表 → 完整 JSON 角色卡”三步生成；支持 Character Card V1/V2 JSON 导入导出
- **提示词预设**（「提示词」栏）：多套 System Prompt + 历史后指令模板，命名保存/切换/删除；角色卡可绑定预设
- **世界书**：多本世界书 × 条目（触发词支持正则 / 常驻 / 顺序 / 扫描深度 / 整词匹配）；一本全局生效，其余可绑定角色
- **记忆 / 玩家设定**：玩家外形背景偏好 + 记忆条目（注入上下文）
- **旁白 / 对白拆分（状态机）**：引号内 → 角色气泡，其余 → 旁白；支持中文「」『』“”/ 英文 `"` `'`、嵌套引号、不成对回退、`*动作*` 归旁白
- **消息操作**：hover 重新生成 / 编辑 / 删除 / 复制
- **AI 调试终端**：对话顶栏「⌘ 终端」查看当前角色、模式与会话最近一次发给 AI 的完整消息数组及原始响应；记录仅驻留内存，不写入存档

## ⚔ RPG 模式（AI 驱动冒险）

**布局**：顶栏（角色 / Lv / 金币 / 位置）· 左栏（角色面板 + 背包）· 中央 AI 叙事流 · 右栏（任务 + 世界地图）· 底栏（HP/MP/EXP 状态条 + 快捷行动 + 输入）

**一切由 AI 驱动**（AI 输出 → 正则处理 → 自动执行）：

| AI 输出 | 正则规则 | 前端处理 |
|---|---|---|
| ` ```rpg ```` JSON 代码块 | ` ```rpg ... ```` 提取 | 状态/数值自动计算（HP/MP/金币/等级/经验/最大值的相对增减 + 上下限）、道具增删、任务推进、位置移动、回复选项 |
| 骰子表达式 `d20+5` / `2d6` | `(\d*)d(\d+)([+-]\d+)?` | 自动掷骰，结果以 meta 消息注入并**进入 AI 上下文**（AI 能基于结果推进） |
| 叙事正文 | 不做引号拆分 | 对白、旁白统一显示为连续叙事，支持 GFM Markdown，不生成 AI 气泡 |
| `options` 字段 | ````rpg ```` 内 JSON | 渲染为底部**快捷行动栏**（点击即发送该行动） |

RPG 的末尾控制块只在 RPG 模式解析；流式生成时不会显示未闭合的控制 JSON。骰子仅扫描叙事正文，行动选项中的 `d20` 会等玩家真正选择后再掷。

- **DM 身份**：RPG 模式下 AI 是"世界的化身 / 地下城主"，直接扮演所有 NPC、称呼玩家为"你"，禁止以"作者"口吻自称（含反例约束）
- **正反示例**：预设内置 1 个完整正例 + 4 个反例（缺选项 / 空泛选项 / 凭空物品 / 对白混旁白），并在对话历史最前注入示例回合（in-context few-shot）
- **每会话独立状态**：`session.rpgState` 持久化，切换会话恢复各自进度
- **禁止凭空添加**：道具/任务必须由剧情产出（掉落、NPC 委托等）

## 🗺 世界地图系统（AI 协作生成）

三步法：**算法生成 → 数据层 → AI 美化**，地图数据同时注入 AI 上下文参与叙事。

### 算法生成（`public/mapgen.js`）

- 优先使用 `vendor/mapgen2.bundle.js`（Red Blob Games mapgen2，Apache-2.0，bundle 含 Delaunator / Poisson / Simplex），加载失败自动回退自研噪声 + Voronoi 实现（`generateViaOwn`）
- **单地区图**：区域数按 `regionCount` 目标收敛（默认约 8-14 个大区域），被剔除的小胞腔归属最近的保留区域（大陆完整、邻接真实）
- 输出：`{size, regions[], points[], grid(Uint16Array), adjacency, engine, seed}`——`grid` 用 **Uint16Array**（区域 >255 不会溢出）
- **biome 6 大类**：海岸 / 草原 / 森林 / 荒野 / 雪原 / 湿地——`elevation` 取 mapgen2 均值、`moisture` 用「到水域的 BFS 距离场」（天然空间连续）+ 各一次邻域平滑；**高对比色板**（跨 biome 边界色差 127-179，色块可辨）

### 渲染（`renderWorldMap`）

- 像素级**反距离加权混合**区域颜色 → 地形渐变（告别色块拼图，数据层不变）
- 区域边界地形符号：山脉 ▲ / 森林树形 / 湿地波纹（白描边）；两种文字模式：参考图大字 biome 标注 / 展示图浅色小字区域名

### 地图窗口（点击地图预览打开）

- 功能集中：**重新生成 / ✨ AI 美化 / 🏷 参考图 / 📋 数据（JSON 一键复制）/ 🔍 大图 / 关闭**
- 窗口内点击区域 → 显示区域/地点信息（预览图仅作入口）
- 有美化图时可切换「🖼 原始底图 ⇄ ✨ 美化图」对比查看

### AI 美化（`mapBeautify`）

- 独立渲染**标注参考图**（地形符号 + biome 大字标注）→ `POST /api/image`（edits 接口）→ 替换为真实地形插画
- 提示词携带地图约束（`regionCount` / biome 列表 / 区域明细），并要求：不写任何文字、不画边界线与连接线、按原图群系替换为真实地形

### 上下文注入

- 地图数据（区域 / 可达性 / 当前位置 / 地标）注入 RPG system；AI 输出协议中 `location` 支持「区域 N」与地图联动

## 预设与数据外置（不写死）

所有可编辑内容在 `public/data/_defaults.json`（新环境自动初始化），运行时数据存 `public/data/*.json`：

- `presets`：提示词预设——「RP 基础（示例）」（酒馆 writer 身份）、**「RPG 叙事引擎（示例）」**（DM 身份 + 正反例，可在「提示词」页直接编辑）
- `rpg`：初始状态 / 输出协议（stateInstruction）/ 行动选项空提示 / 示例回合（exampleTurn，few-shot 注入 history 最前）
- `gen`：角色基本信息动态栏目（`charFields`）+ 两阶段角色卡生成指令 + 世界书条目生成指令
- `user`：玩家设定（外形 / 背景 / 偏好）+ 记忆条目
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
server.js                     # 本地服务器：静态服务 + /api/chat + /api/image + /api/image-save + /api/models + /api/data 代理（零依赖）
public/
  index.html                  # 双模式布局（酒馆三区 / RPG 五区）+ 设置弹窗 + 管理页 + 地图窗口
  styles.css                  # 语义化 CSS 变量 + 5 套色调（含 macOS 毛玻璃）+ 双模式布局
  app.js                      # 前端逻辑：模式/会话/角色/预设/世界书/记忆/生图/RPG 状态机/掷骰/地图窗口/AI 美化
  mapgen.js                   # 世界地图：mapgen2 适配 + 自研 fallback + 渲染 + biome 气候
  manifest.json + sw.js       # PWA（离线壳）
  data/_defaults.json         # 模板数据（预设/世界书/角色/rpg 协议/生成指令/UI 文案）
  data/*.json                 # 运行时数据（本地生成，不入库）
  vendor/                     # marked + DOMPurify + mapgen2.bundle（本地依赖，零网络）
android/                      # WebView 套壳工程（NanoHTTPD 内嵌服务器）
docs/                         # 架构与数据结构文档（data-structure.md / android-apk.md）
scripts/                      # 辅助脚本（图标生成 / 打包上传 zip）
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
- [x] 世界地图系统（mapgen2 算法 + 单地区图 + biome 气候 + AI 美化 + 地图窗口 + 上下文注入）
- [ ] 世界观 / 角色设定（全部占位）
- [ ] 地图参数可视化调节（landRatio / regionCount 等 biome 配置暴露到 UI）
- [ ] 地图生成调优（海岸占比偏大、山脉偏少）
- [ ] 短期 / 长期记忆分层
- [ ] 风格定稿（5 套色调对比中）

## 安全提醒

`server.js` 的代理不做鉴权与 SSRF 防护，**仅供本地开发 / 演示**，勿部署公网。
API Key 只存浏览器本地与本地数据文件（`public/data/*.json` 已在 `.gitignore`），代理仅转发不落盘。
