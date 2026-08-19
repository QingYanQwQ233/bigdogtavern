# RPG 世界卡 UI 美化声明

这份声明是世界卡的 UI 契约，不是第二套客户端代码。世界卡只描述“想要什么样的界面”和“哪些区域由谁负责”，宿主负责安全渲染、状态投影、回退和通用返回/全屏桥接；用户导入世界包后即可生效，不需要为某一张卡修改客户端。

## 1. 完整结构

下面的 JSON 可以直接放进世界卡的 `ui` 字段。编辑器中的「载入完整模板…」来自 `_defaults.json.ui.worldUiTemplate`，不是前端写死的内容。

```json
{
  "schemaVersion": 1,
  "layout": "host",
  "shell": {
    "navigation": "show",
    "topbar": "show",
    "fullscreen": true,
    "escape": "fullscreen"
  },
  "theme": {
    "tokens": {
      "bg-scene": "#101217",
      "bg-0": "#17181c",
      "bg-1": "#202228",
      "panel": "#24262d",
      "panel-2": "#2d3038",
      "panel-rgb": "36,38,45",
      "accent": "#0a84ff",
      "accent-2": "#0066cc",
      "accent-rgb": "10,132,255",
      "text": "rgba(255,255,255,0.92)",
      "muted": "#a6a7ad",
      "line": "rgba(255,255,255,0.12)",
      "line-soft": "rgba(255,255,255,0.06)",
      "radius": "12px",
      "chat-font-size": "16px",
      "chat-line-height": "1.85",
      "chat-para-gap": "0.8em",
      "chat-side-pad": "28px"
    }
  },
  "regions": {
    "topbar": { "mode": "decorate", "label": "世界标题" },
    "sidebar.left": { "mode": "append", "component": "character-panel", "fallback": "host" },
    "narrative": { "mode": "replace", "component": "world-narrative", "fallback": "host" },
    "options": { "mode": "append", "component": "choice-deck", "fallback": "host" },
    "input": { "mode": "decorate", "label": "玩家行动" },
    "sidebar.right": { "mode": "append", "component": "world-panels", "fallback": "host" },
    "status": { "mode": "decorate", "label": "当前状态" },
    "overlay": { "mode": "hide", "fallback": "host" }
  },
  "sidebar": {
    "panels": [
      {
        "id": "player-resources",
        "title": "资源",
        "icon": "◈",
        "side": "left",
        "source": "save.state.player.resources",
        "layout": "cards",
        "fields": ["$key"]
      },
      {
        "id": "active-goals",
        "title": "当前目标",
        "icon": "◎",
        "side": "right",
        "source": "save.state.goals",
        "layout": "list",
        "fields": [
          { "key": "status", "label": "状态" },
          { "key": "description", "label": "说明" }
        ]
      }
    ]
  },
  "entryGate": {
    "enabled": false,
    "title": "进入世界",
    "message": "即将载入本世界的 UI 与规则。",
    "confirmText": "进入",
    "cancelText": "返回",
    "fullscreen": false
  },
  "extension": {
    "enabled": false,
    "immersive": false,
    "title": "世界卡扩展",
    "html": "<section data-tavern-messages></section><div data-tavern-options></div><form data-tavern-input><textarea placeholder=\"输入行动…\"></textarea><button data-tavern-submit>发送</button></form>",
    "css": "section{padding:16px;border:1px solid var(--accent);border-radius:12px}",
    "js": "",
    "mvu": { "protocol": "mvu.compat", "version": 1 },
    "permissions": ["read.public", "read.save"],
    "maxHeight": 420,
    "timeoutMs": 1200,
    "actionNarrates": false
  }
}
```

## 2. UI 分级

```text
一级  app shell       应用导航、移动抽屉、设置、终端、确认弹窗（默认保留，可由 shell 声明隐藏）
二级  workspace       酒馆 / RPG / 世界库当前工作区
三级  regions         顶栏、叙事、侧栏、状态、选项、输入、覆盖层
四级  components       消息、按钮、表单、列表、面板、滚动容器
五级  bridge           存档投影、选项、Agent、runtime Patch、事件
```

世界卡可以声明 app shell 的导航/顶栏可见性，但不能删除宿主逻辑。若隐藏导航，卡内应提供 `TavernExtension.exitWorld()` 返回世界库；宿主仍保留统一返回路径。`TavernExtension.fullscreen()`、`exitFullscreen()`、`openTerminal()` 和 iframe `Esc` 使用同一套宿主桥接，不依赖卡内脚本访问父页面。

`shell` 字段：

- `navigation` / `topbar`：`show` 或 `hide`；只影响当前世界工作区，离开后自动恢复；
- `fullscreen`：是否允许卡内请求浏览器全屏；浏览器拒绝时仍可使用宿主沉浸布局；
- `escape`：`fullscreen`（默认，Esc 退出沉浸）、`world`（Esc 直接返回世界库）或 `none`。

## 3. 四种区域模式

每个区域独立设置 `mode`，同一张卡可以混合使用：

| 模式 | 作用 | 宿主状态 |
|---|---|---|
| `decorate` | 保留宿主区域，使用世界卡主题和标签美化 | 保留、可交互 |
| `replace` | 声明卡组件负责该区域；组件不可用时回退宿主 | 当前版本以安全回退为准 |
| `append` | 保留宿主区域，声明卡组件可以追加内容 | 保留、可交互 |
| `hide` | 隐藏宿主区域但不删除 DOM 和状态 | 离开世界卡后自动恢复 |

支持的区域：`topbar`、`sidebar.left`、`narrative`、`options`、`input`、`sidebar.right`、`status`、`overlay`。

`component` 只能是安全 ID（字母开头、最多 64 个字母/数字/`_`/`-`），不是 HTML、CSS 选择器或脚本。`fallback` 目前支持 `host` 和 `empty`；当前没有组件注册表时默认保留宿主，`empty` 为后续组件注册表预留。

旧卡可以继续使用：

```json
{
  "slots": {
    "options": { "visible": false },
    "input": { "visible": true, "label": "玩家行动" }
  }
}
```

旧 `visible:false` 会映射为 `hide`，其他旧槽位映射为 `decorate`。

## 4. 主题 Token

Token 会同时作用于宿主投影和扩展 sandbox 的 `:root`。值只允许安全 CSS 值，不允许尖括号、花括号、反斜杠、分号、`url()`、`expression()`、脚本协议或外链资源。

推荐 Token：

| 类别 | Token |
|---|---|
| 背景 | `bg-scene`、`bg-0`、`bg-1`、`panel`、`panel-2`、`panel-rgb` |
| 强调 | `accent`、`accent-2`、`accent-rgb`、`danger`、`danger-2`、`danger-rgb`、`ok`、`warning` |
| 文字 | `text`、`muted`、`on-accent` |
| 边界 | `line`、`line-soft`、`scrim`、`glow` |
| 字体 | `font-body`、`font-display`、`font-mono` |
| 正文 | `chat-font-size`、`chat-line-height`、`chat-para-gap`、`chat-indent`、`chat-side-pad` |
| 形状/动效 | `radius`、`motion-out`、`motion-in-out` |

不要用 Token 伪造布局脚本；布局接管使用 `regions` 或 `layout:"custom"`。

## 5. 声明式侧栏

`sidebar.panels[]` 只能读取当前世界/当前存档的白名单投影：

- 世界：`world.npcs`、`world.locations`；
- 存档：`save.npcStates`、`save.state.goals`、`save.state.leads`、`save.state.activeHooks`、`save.state.worldEvents`、`save.state.factionStates`；
- 玩家：`save.state.player.attributes`、`save.state.player.skills`、`save.state.player.resources`、`save.state.player.traits`；
- RPG GEN 3：`runtime.variables.<id>`、`runtime.collections.<id>`，隐藏变量不可展示。

面板只读，不直接改存档。需要修改状态时，必须走扩展 Bridge 的 `patch` / `action`，由服务端做世界版本、权限和 revision 校验。

## 6. 扩展与沉浸布局

需要卡内 HTML/CSS/JS/MVU 时使用 `ui.extension`：

- 运行在 `sandbox="allow-scripts"` iframe；
- 不提供主页面 DOM、网络、文件系统、API key 或 `allow-same-origin`；
- 首次发现脚本/MVU/EJS 标记时询问授权；拒绝时世界仍可打开；
- 消息统一使用 `data-tavern-messages`；选项使用 `data-tavern-options`；输入使用 `data-tavern-input` / `data-tavern-submit`；
- `TavernExtension.requestContext()` 读取当前存档白名单投影；`choose()`、`action()`、`patch()` 复用现有 Agent / runtime 管线；
- `layout:"custom"` 是整页工作区接管兼容模式；配合 `shell.navigation:"hide"` / `shell.topbar:"hide"` 可在窗口化直接隐藏宿主同级壳层，浏览器全屏和 Esc 仍走宿主桥；`TavernExtension.exitWorld()` 用于卡内返回世界库。

扩展不应再创建第二份聊天记录、状态或存档。所有展示都从当前存档投影重绘。

## 7. 设计与无障碍约束

- 移动端按钮命中区域至少 44px；输入框字体至少 16px，避免移动端自动缩放；
- 任何弹窗/抽屉都可用键盘关闭，焦点回到触发按钮；
- 必须保留 `:focus-visible` 焦点环；
- 尊重系统 `prefers-reduced-motion`，卡内 CSS 不得强制无限动画；
- 长正文、长标题、空列表和错误状态都要有可读回退；
- 状态不能只用颜色表达，图标或文字必须同步出现；
- 卡内自定义消息区只能有一个滚动容器，禁止同时渲染重复叙事流。

## 8. 迁移顺序

1. 旧卡继续使用 `ui.slots`、`ui.sidebar.panels` 和 `ui.extension`；
2. 新卡写 `schemaVersion:1` 和 `ui.regions`；
3. 需要整页自定义时再使用 `layout:"custom"`；
4. 组件注册表和跨区域挂载尚未启用前，`replace/append` 保留宿主安全回退；
5. 不把 UI 配置复制进 `WorldSave`，存档只保存世界版本和运行状态快照。
