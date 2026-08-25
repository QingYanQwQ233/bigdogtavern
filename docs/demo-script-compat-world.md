# 脚本兼容实验室

文件：`demo-script-compat-world.tavern-world.json`

这是一张可直接导入的世界卡，不是角色卡。进入世界存档后，首次会询问是否启用隔离扩展；确认后可以在卡内看到三个真实演示：

- **EJS**：解析一个受限模板子集，显示 `user.name` 的结果；不执行任意模板代码。
- **MVU / Runtime**：这张旧兼容卡仍展示 MVU 原文；当前 RPG 游玩态不允许扩展直接写状态，持久化变化必须由 AI 回合通过声明式 runtime patch 提交。
- **JS**：点击按钮触发 sandbox iframe 内的 JS 事件，主页面不会被访问或改写。

这张卡使用独立沉浸式布局：扩展 iframe 会接管叙事、选项、侧栏、状态和输入区域，页面不会再叠加宿主 RPG 外壳；按 `Esc` 退出沉浸模式。自定义世界卡可用 `ui.layout: "custom"` 获得相同的整页接管行为。

导入方法：打开“世界与存档” → “导入世界包” → 选择该 JSON → 确认导入 → 创建存档 → 授权扩展。

角色卡 / 预设中的 EJS、MVU、JS 仍然只做兼容保留；需要真正交互时让卡调用 `TavernExtension.choose()` 提交玩家意图，再由 AI 回合执行声明式 runtime 更新。
