# 打包离线 APK（GitHub Actions）

把 Tavern 打包成**真离线 Android APK**：前端资源内置进 APK，App 内嵌一个轻量 HTTP 服务（NanoHTTPD 移植的 server.js），WebView 加载 `http://127.0.0.1:3000`。前端代码**零改动**，不依赖任何外部服务器。

## 原理

```
APK 结构：
  assets/               ← 前端静态资源（index.html / styles.css / app.js / vendor / icons / data/_defaults.json）
  TavernServer.kt       ← NanoHTTPD 内嵌服务（端口 3000）
                            ├ /api/chat        对话代理（SSE 流式转发，同 server.js）
                            ├ /api/image      文生图代理（openai / sd 双格式）
                            ├ /api/image-save 图片落盘 filesDir/images/
                            ├ /api/models     模型列表
                            ├ /api/worlds/*    世界卡详情
                            ├ /api/world-saves 世界存档创建/列表/读取/重命名/复制/删除/脱敏导出/Typed Patch 回合
                            ├ /api/world-saves/:id/setup|opening-candidate|opening 开局规划与候选确认
                            ├ /api/world-saves/:id/agent-execute|agent-cancel + narrate Agent 两阶段回合
                            ├ /api/world-saves/:id/upgrade 世界版本升级预演与确认
                            ├ /api/world-saves/:id/growth|end|reopen 成长、结局、世界线重开
                            ├ /api/world-saves/:id/summary|memory 总结与记忆诊断/重建
                            ├ /api/world-drafts 世界草稿（基础读写）
                            ├ /api/world-imports 世界包预览、封存与确认导入（正则默认禁用）
                            ├ /api/data/*     数据读写 filesDir/data/（首次从 _defaults.json 初始化；角色库数组与其他对象均会原子落盘）
                            └ 静态资源         assets 根；/images/* 读 filesDir/images/
  MainActivity.kt       ← 启动服务 + WebView 加载 http://127.0.0.1:3000/
```

- **离线**：全部代码/数据在手机本地；联网仅用于调用你配置的 LLM / 生图 API
- **前端零改动**：页面与 /api/* 同源，无 CORS；localStorage 作为缓存，角色卡、世界书、预设、用户设定和会话通过 `/api/data/*` 持久保存到 `filesDir/data/`，大退/重启不会依赖 WebView 缓存
- **安全**：`network_security_config.xml` 只允许 127.0.0.1 明文，外部一律 HTTPS

## 构建（你本地不用装任何东西）

1. 把项目推到 GitHub（`public/data/*.json` 已被 .gitignore 排除，**你的 API key 不会进仓库**）
2. GitHub → Actions → **Build Tavern APK** → Run workflow
3. 构建完在 Actions 页面下载 `tavern-apk` artifact → 安装到手机（允许未知来源）

手动触发：Actions 页 → Build Tavern APK → Run workflow。

## 手机端使用

1. 打开 App（首次启动自动生成数据文件）
2. 「设置」里配置 API（与桌面版完全一样）：Base URL / Key / 模型 / 文生图
3. 开聊；生图会落盘到 App 私有目录，刷新不丢
4. 角色卡、预设、世界书、世界包和存档的“导出”会写入系统 `Download` 文件夹；Android 10+ 使用 MediaStore，旧版本首次导出会请求存储权限

## 已知限制

- 内嵌服务监听 127.0.0.1，理论上同机其他 App 可访问（本地单机演示可接受；如需加固可在 server 加 token）
- 构建产物为 debug APK（签名可直接安装；上架需自己配 release 签名）
- Android 内嵌服务已覆盖世界卡、WorldSave 创建/读取/重命名/复制/删除/脱敏导出、待开局 `setup.game / plan / candidate / opening`、版本升级预演/确认、revision 幂等、Agent 两阶段回合与核心 Typed Patch；完整世界规则结算仍以 Node `server.js` 为基准，APK 端应在真机上验证冲突/成长/结局等高级入口。
