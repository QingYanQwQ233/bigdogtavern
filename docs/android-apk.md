# 打包离线 APK（GitHub Actions）

把 Tavern 打包成**真离线 Android APK**：前端资源内置进 APK，App 内嵌 Node.js 运行时（nodejs-mobile），直接运行与桌面端**同一份** `server.js`，WebView 加载 `http://127.0.0.1:3000`。前端代码**零改动**，后端**零分叉**，不依赖任何外部服务器。

## 原理

```
APK 结构：
  assets/nodejs/          ← server.js + 前端静态资源（由 scripts/sync_android_assets.sh 同步）
  jniLibs/arm64-v8a/      ← libnode.so / libc++_shared.so / libnode_bridge.so（构建时现取，不入库）
  native/node_bridge.cpp  ← JNI 胶水：解包 assets → chdir → node::Start（不含业务逻辑）
  NodeRuntime.kt          ← JNI 声明（System.loadLibrary("node_bridge")）
  NodeBootstrap.kt        ← 解包 assets → 启动 Node → 轮询端口就绪 → 迁移旧版数据
  MainActivity.kt         ← WebView 加载 http://127.0.0.1:3000/ + 原生导出桥

server.js 与桌面端是同一份，提供全部 /api/*：
  静态资源      filesDir/nodejs/public/
  /images/*     filesDir/nodejs/public/images/
  /api/data/*   filesDir/nodejs/public/data/（首次从 _defaults.json 初始化）
```

- **离线**：全部代码/数据在手机本地；联网仅用于调用你配置的 LLM / 生图 API
- **前端零改动**：页面与 /api/* 同源，无 CORS；localStorage 作为缓存，角色卡、世界书、预设、用户设定和会话通过 `/api/data/*` 持久保存到 `filesDir/nodejs/public/data/`，大退/重启不会依赖 WebView 缓存
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
5. 内嵌前端最低支持 Android System WebView / Chromium 111。宿主与两种隔离卡片 iframe 会注入同一份兼容降级层（`Array.prototype.at`、`Object.hasOwn`、`Element.replaceChildren`）；内核能力不足时由 `CSS.supports` 判定并提示更新，提示可关闭。世界卡脚本运行在同一内核上，可使用 ES2021 语法。

## 已知限制

- 内嵌服务监听 127.0.0.1，理论上同机其他 App 可访问（本地单机演示可接受；如需加固可在 server 加 token）
- 构建产物为 debug APK（签名可直接安装；上架需自己配 release 签名）
- Android 端运行的就是桌面端同一份 `server.js`，因此 API 覆盖、校验与结算逻辑天然一致（不存在需要对齐的第二份实现）；真机仍需回归 Runtime、结局和重开等高级入口。
