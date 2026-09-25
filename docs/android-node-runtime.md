# Android 端内嵌 Node 运行时

> 自本改动起，**Android 后端与桌面端是同一份 `server.js`**。Kotlin 只保留外壳与系统能力。

## 为什么

此前 Android 端用 Kotlin 重写了一份后端（`TavernServer.kt`，1495 行，基于 NanoHTTPD），
与桌面端**双份维护**。它自己的注释就承认：

> 「Android 端的**完整世界规则校验仍由 Node server 维护**」

结果必然漂移：桌面端新增的校验、协议修复、Agent 能力，Android 端不会自动获得。
现在改为让 APK **直接运行 `server.js`**，这类分叉从结构上消失。

## 结构

```
server.js                     ← 唯一后端实现（桌面端也是它）
public/                       ← 唯一前端实现

android/
├── native/node_bridge.cpp    ← JNI 胶水（只负责把 Node 跑起来，不含业务逻辑）
└── app/src/main/
    ├── java/com/tavern/app/
    │   ├── MainActivity.kt   ← WebView 外壳 + 导出桥 + 文件选择器
    │   ├── NodeBootstrap.kt  ← 解包 assets → 启动 Node → 等端口就绪
    │   └── NodeRuntime.kt    ← JNI 声明（System.loadLibrary("node_bridge")）
    └── assets/nodejs/        ← 构建产物，已 gitignore
        ├── server.js
        └── public/...

scripts/
├── fetch_android_node.sh     ← 取 nodejs-mobile 的 libnode.so + 编译 JNI 桥
├── sync_android_assets.sh    ← 把 server.js + public/ 同步进 assets
└── build_android_apk.sh      ← 一键：上面两步 + gradle
```

APK 首次启动把 `assets/nodejs/` 解包到 `filesDir/nodejs/`，因此 `server.js` 里
`path.join(__dirname, 'public')` 成立，数据目录沿用其默认值 `public/data`
（落在应用私有目录内，与桌面端语义一致）。

## 构建

```bash
# 本地（需 JDK 17 + Android SDK + Gradle）
bash scripts/build_android_apk.sh 80 alpha-0.1.80

# CI 在 push 到 main 时自动执行（见 .github/workflows/android-apk.yml）
```

产物 `libnode.so` / `libc++_shared.so` / `libnode_bridge.so` **不入库**，每次构建现取。

### aarch64 宿主（Termux / proot 设备）

官方 NDK 只提供 `linux-x86_64` 工具链，无法直接在 arm64 设备上跑。
`fetch_android_node.sh` 会自动改用**宿主 clang + NDK 的 android sysroot** 交叉编译。

两个必须注意的坑（脚本里已处理）：

1. `-L` 只能指向**只含 `.so`** 的目录。否则链接器会误拉静态 `libc.a`，其
   `gwp_asan_wrappers.o` 带 IE 模式 TLS 符号，运行期表现为
   `dlopen: TLS symbol ... using IE access model` 而加载失败。
2. 官方 zip 里**没有** `libc++_shared.so`，需要从 NDK sysroot 取。

若宿主 `aapt2` 是 x86_64 版，还需在 `~/.gradle/gradle.properties` 里设置
`android.aapt2FromMavenOverride=<arm64 版 aapt2 路径>`。

## 约束（改动前请先看）

| 约束 | 原因 |
|---|---|
| `server.js` **必须零 npm 依赖** | 内嵌运行时没有 npm 安装步骤。由 `check_android_protocol.js` 守卫 |
| 只能用 **Node 18** 可用的 API | 内嵌的是 nodejs-mobile v18.20.4。Node 19+ 独有 API 在手机上会报错 |
| JNI 符号名含包路径 | `node_bridge.cpp` 的 `Java_com_tavern_app_NodeRuntime_startNode` 必须与 Kotlin 包名一致，否则 `UnsatisfiedLinkError` |
| 只分发 `arm64-v8a` | `abiFilters` 已显式声明，避免 32 位/模拟器设备装了却在运行期失败 |
| 端口固定 3000 | 与桌面端一致；同一设备上不要同时运行两个占用 3000 的构建 |

## 数据迁移

旧版（Kotlin 后端）的数据位于 `filesDir/data` 与 `filesDir/images`；
新版沿用 `server.js` 的布局（`public/data`、`public/images`）。
`NodeBootstrap.migrateLegacyData()` 会在**首次启动且目标不存在时**复制一次，
旧目录原样保留以便回退。

前端自身的角色/会话存在 WebView 的 localStorage，跨升级自动保留。

## 体积

APK 约 19 MB，其中 `libnode.so` 压缩后约 17 MB（占 90%）。这是 V8 + ICU + OpenSSL + libuv
的固有体积，strip 无法再压（AGP 已自动 strip）。换来的是：**PC 端改完 `server.js`，
重新打包即可，无需再写 Kotlin**。

## 相关检查

- `scripts/check_android_api.js` —— 守卫单源架构：不得恢复第二份后端实现、
  必须装配 `server.js`、导出桥与构建流程保持完好。
- `scripts/check_android_protocol.js` —— 守卫运行时约束：零 npm 依赖、
  `server.js` 原样打包、Node 18 版本、协议关键点保留。