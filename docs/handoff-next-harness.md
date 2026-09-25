# 交付给下一 Harness 的项目接手快照

> **开发规范已移到根目录 [AGENTS.md](../AGENTS.md)** —— 那里是唯一来源，AI 工具会自动加载。
> 本文件只保留**当前交接的状态快照**（易变部分）。规范内容请勿在此复制，避免两份漂移。

## 交接状态

动手前照例先跑 `git status --short --branch`、`git log -1 --oneline`、`git diff --stat`。
**当前分支、工作目录一律以实际输出为准**，不要假定在任何固定分支或固定路径上。

## 当前接手重点

1. 先确认工作区状态和当前分支，不要误删已有未跟踪测试资料。
2. 把用户最新反馈按 RP、RPG、共享 UI、Android 兼容和协议/存档五类归档，再选择对应入口。
3. 优先保持 `WorldCard → WorldSave → revision/CAS → receipt` 主链完整；出现「AI 回复了但变量没变」时先查结构化块、Agent trace、服务端拒绝原因和回执，不要直接把正文解析成状态。
4. 新增功能时同时补一个最小回归检查或复用现有 `scripts/check_*.js`，并把用户可见行为写回 README/项目总览。

## 交接验收清单

- [ ] `git status --short --branch` 已确认，用户临时文件未被删除或提交。
- [ ] 已读 [AGENTS.md](../AGENTS.md) 引用的文档和受影响源码。
- [ ] `public/app.js` 与 `frontend/` 一致。
- [ ] 相关协议/服务端/浏览器检查通过，失败项有根因说明。
- [ ] 桌面与窄屏路径至少各验证一次；Android 变更已安排真机或 Actions 验证。
- [ ] 提交只包含本任务文件，push 目标分支明确。