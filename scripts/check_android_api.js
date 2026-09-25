'use strict';

/**
 * Android 端 API 契约检查。
 *
 * 架构约定（Step 1 起）：**Android 后端就是仓库里的 server.js 本体**，由内嵌 Node
 * 运行时（nodejs-mobile）执行。历史上 Android 端曾用 Kotlin 重写一份后端
 * （TavernServer.kt，1495 行），与桌面端双份维护并逐渐漂移，已删除。
 *
 * 因此本检查从「校验 Kotlin 重写是否覆盖契约」改为「守卫单源架构」：
 * 一旦有人重新引入第二份后端实现、或让 APK 带上运行时不需要的东西，这里会失败。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const APP = 'android/app/src/main/java/com/tavern/app';
const server = read('server.js');
const activity = read(`${APP}/MainActivity.kt`);
const app = read('public/app.js');
const gradle = read('android/app/build.gradle.kts');
const workflow = read('.github/workflows/android-apk.yml');
const syncScript = read('scripts/sync_android_assets.sh');

// ── 1. 后端必须单源：不能再有第二份 Kotlin 实现 ──────────────────────────────
assert.ok(!exists(`${APP}/TavernServer.kt`), '不允许恢复 TavernServer.kt：Android 后端必须与桌面端同源（server.js）');
assert.ok(!exists(`${APP}/TavernServer.java`), '不允许新增第二份 Android 后端实现');
assert.ok(!/org\.nanohttpd/i.test(gradle), 'Android 不应再依赖 NanoHTTPD：后端已由内嵌 Node 承担');

// ── 2. Android 侧必须真的把 server.js 跑起来 ────────────────────────────────
assert.ok(exists(`${APP}/NodeRuntime.kt`), '缺少 NodeRuntime.kt（JNI 桥入口）');
assert.ok(exists(`${APP}/NodeBootstrap.kt`), '缺少 NodeBootstrap.kt（解包 + 启动 + 等待端口）');
const runtime = read(`${APP}/NodeRuntime.kt`);
assert.ok(runtime.includes('System.loadLibrary("node_bridge")'), 'NodeRuntime 必须加载 libnode_bridge');
assert.ok(runtime.includes('external fun startNode'), 'NodeRuntime 必须声明 native startNode');

// JNI 函数名写死包路径：cpp 与 Kotlin 包名必须一致，否则运行期 UnsatisfiedLinkError
const bridgeSrc = read('android/native/node_bridge.cpp');
assert.ok(
  bridgeSrc.includes('Java_com_tavern_app_NodeRuntime_startNode'),
  'node_bridge.cpp 的 JNI 符号必须与 com.tavern.app.NodeRuntime 匹配'
);
assert.ok(runtime.includes('package com.tavern.app'), 'NodeRuntime 包名必须与 JNI 符号一致');

assert.ok(activity.includes('NodeBootstrap.start('), 'MainActivity 必须通过 NodeBootstrap 启动后端');
assert.ok(!activity.includes('TavernServer'), 'MainActivity 不得再引用 TavernServer');

// ── 3. 唯一的后端文件必须真的进 APK ─────────────────────────────────────────
assert.ok(
  syncScript.includes('cp server.js "$ASSET_ROOT/server.js"'),
  'sync_android_assets.sh 必须把 server.js 原样打包进 assets/nodejs/'
);
assert.ok(syncScript.includes('public/app.js public/mapgen.js'), 'APK assets 必须包含 mapgen.js');
assert.ok(syncScript.includes('LICENSE LICENSE-MIT-LEGACY THIRD_PARTY_NOTICES.md'), 'APK assets 必须包含许可与第三方声明');
assert.ok(!syncScript.includes('cp -r public/data'), 'APK 构建不得复制 public/data 运行时文件（含用户 API key）');

// ── 4. 单源后端必须覆盖 Android 需要的 RPG 路由面 ───────────────────────────
// 这些字符串都在 server.js 里实际存在，等价于原先对 Kotlin 重写的路由覆盖检查。
for (const route of ['/opening-candidate', '/opening', '/rename', '/export', '/copy',
                     '/upgrade', '/agent-execute', '/agent-cancel', '/growth', '/reopen',
                     '/summary', '/memory', '/api/world-imports']) {
  assert.ok(server.includes(route), `server.js 缺少 Android 依赖的路由面: ${route}`);
}
for (const marker of ['baseRevision', 'tavern_world_save', 'tavern_world_package',
                      'regexDisabledOnImport', 'world-version-upgrade', 'awaiting-narration',
                      'setupStatus']) {
  assert.ok(server.includes(marker), `server.js 缺少 Android 依赖的协议标记: ${marker}`);
}

// ── 5. 导出桥与前端调用必须保持 ─────────────────────────────────────────────
assert.ok(activity.includes('addJavascriptInterface(DownloadBridge(), "TavernAndroid")'), 'Android 必须暴露导出桥');
assert.ok(activity.includes('MediaStore.Downloads'), 'Android 导出必须落到公共 Download 目录');
assert.ok(activity.includes('saveFile(rawName'), 'Android 导出桥必须接收前端文件');
assert.match(app, /async function downloadBlob\(blob, filename\)/);
assert.ok(app.includes('bridge.saveFile(filename'), '前端导出必须优先走 Android 桥');

// ── 6. 构建流程必须仍然装配 Node 运行时与资源 ───────────────────────────────
assert.ok(workflow.includes('scripts/fetch_android_node.sh'), 'APK 构建必须先获取 Node 运行时');
assert.ok(workflow.includes('scripts/sync_android_assets.sh'), 'APK 构建必须走统一的资源同步脚本');
assert.ok(workflow.includes('node scripts/build_frontend.js --check'), 'APK 构建必须拒绝过期的前端产物');
assert.ok(!workflow.includes('cp -r public/data'), 'APK 构建不得复制运行时数据');
assert.match(workflow, /permissions:\s*\n\s+contents:\s*read\b/, 'APK workflow token 必须保持只读');

console.log('android API contract check passed (single-source backend)');
