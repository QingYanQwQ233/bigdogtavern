# 潮汐试验场：最小 RPG 冒烟测试

示例世界卡 ID：`world-test-lab`。

## 自动自检

```powershell
node scripts/check_rpg_minimal_world.js
node scripts/check_rpg_agent.js
node scripts/check_rpg_agent_compat.js
node scripts/check_rpg_protocol.js
node scripts/check_world_setup_surface.js
```

这些检查只覆盖当前保留的核心闭环：世界卡压缩、角色/状态初始化、Agent 工具协议、开局配置和选项解析。

## 手动冒烟路径

1. `node server.js`，打开 `http://localhost:3000`。
2. 进入 RPG 模式，选择世界卡并创建存档。
3. 确认可以配置角色、时间/地点和开场计划；确认创建存档不会自动添加宿主硬编码物品、任务、地图或势力状态。
4. 开始游戏后提交一次玩家行动，确认叙事和选项继续推进，必要判定由客户端骰子回执驱动。
5. 刷新或重新打开存档，确认世界、存档和 Tavern 对话彼此独立。

## 当前边界

RPG 世界卡不再提供宿主硬编码物品、装备、货币、任务/目标、势力、世界事件、冲突成长或地图系统；需要这些玩法时，在卡内声明 runtime 变量/集合/动作，由 AI 回合通过 Typed Patch 更新。扩展前端游玩态只读 runtime，不提供第二套直接写入桥。
