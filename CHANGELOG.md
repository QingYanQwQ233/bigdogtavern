# 更新日志

## 2026-08-15 · WorldSave / Agent Runtime 版本

### 新增

- 世界卡与 WorldSave 分离，RPG 存档按 `saveId` 独立保存玩家、状态、回合、事件和记忆。
- RPG 开局规划流程：玩家角色、Schema 驱动建角、属性与能力、游戏规则、Opening Scenario 和 Knowledge Scope。
- 世界卡草稿、版本发布、世界包导入导出、发布前完整性检查和旧 RPG 会话迁移。
- RPG Typed Patch、revision/CAS、幂等回执、冲突、事件、成长、失败、结局和重开存档。
- Agent Runtime 的 `agent-execute → narrate` 两阶段提交与声明式工具候选。
- 分层 RPG 记忆：短期回合、事件记忆、事实账本、知识权限和记忆重建诊断。
- AI 调试终端：输入、输出、Prompt 分区、记忆诊断；输出页展示正则前原文、结构化标签和 reasoning_content。

### 修复

- 修复不同角色、世界存档和模式之间的会话状态串联问题。
- 修复 `location.set` 结构化更新携带额外字段时的兼容问题，并继续校验稳定地点 ID。
- 修复 RPG 隐式骰子判定：正式骰子改为客户端生成，服务端只校验，不再使用 AI 或服务端随机结果。
- 修复 RPG 叙事中的普通骰子文本被错误执行的问题。
- 修复 RPG 模式 Markdown 叙事与旧对白气泡解析混用的问题。
- 修复地图随机生成导致存档地图不稳定的问题；地图改为由世界卡提供，地图 UI 暂时隐藏。
- 修复移动端布局、设置导航、角色卡示例图绑定和角色库选中状态等交互问题。

### 兼容性与限制

- 旧版 `rpg` 控制块仍可作为只读兼容输入；正式提交统一走 WorldSave 校验。
- `/api/dice` 保留为兼容/诊断接口，正式 RPG 回合不再使用它作为随机源。
- 地图生成器代码暂时保留，但运行时不自动生成地图。
- Agent `rules.check`、向量记忆检索、队伍管理和真实 Android 设备验收仍待后续完善。

### 验证

- `node --check server.js`
- `node --check public/app.js`
- `node scripts/check_*.js`
- Playwright 浏览器加载、终端打开和分区切换验证
