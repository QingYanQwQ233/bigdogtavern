# 电子病娇 · 开局配置演示

文件：`demo-setup-surface-world.tavern-world.json`

这张世界卡专门展示 `ui.extension.surfaces: ["setup", "play"]`：

1. 导入世界包后，在 RPG 世界库选择「电子病娇 · 开局配置演示」。
2. 创建存档。因为卡声明了 `setup`，这里不会先出现宿主角色表，而是进入卡内全屏开局页。
3. 填写称呼、系统称呼、第一印象、开局记忆和两个滑条；点击「保存草稿」可验证 `TavernExtension.setup.patch()`，不会开始游戏。
4. 点击「确认身份并继续」，卡内页面调用 `TavernExtension.setup.commit()`，提交后回到原生开场规划。
5. 完成开场后进入正式游玩页：消息、AI 选项、输入栏、全屏、终端和返回世界库按钮都由同一张卡渲染。

导入时如果出现“是否启用世界扩展”，选择确认。扩展代码只在隔离 iframe 中运行；角色卡本身不会写入其他存档。
