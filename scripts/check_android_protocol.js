'use strict';

/**
 * Android 端协议/运行时约束检查。
 *
 * 历史上这里校验的是 TavernServer.kt 的 Kotlin 协议标记。现在 Android 后端
 * 与桌面端共用 server.js，需要守的是「这份 server.js 能不能在嵌入的
 * Node 18 运行时里跑起来」以及「它是否被原样打包」。
 *
 * 关键约束：内嵌的 nodejs-mobile 运行时**没有 npm 安装步骤**，
 * 所以 server.js 必须保持零 npm 依赖。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const server = read('server.js');
const syncScript = read('scripts/sync_android_assets.sh');
const fetchScript = read('scripts/fetch_android_node.sh');

// ── 1. server.js 必须零 npm 依赖（内嵌 Node 无法安装依赖）────────────────────
const builtins = new Set(builtinModules);
const requires = [...server.matchAll(/require\(\s*(['"])([^'"]+)\1\s*\)/g)].map((m) => m[2]);
assert.ok(requires.length > 0, 'server.js 应当有 require 调用');
for (const dep of requires) {
  if (dep.startsWith('.')) continue;
  const name = dep.replace(/^node:/, '');
  assert.ok(
    builtins.has(name),
    `server.js 引入了非内建依赖 "${dep}"：内嵌 Node 没有 npm 安装步骤，Android 端会在启动时失败`
  );
}

// ── 2. server.js 必须原样进 APK（不做任何改写）──────────────────────────────
assert.ok(
  syncScript.includes('cp server.js "$ASSET_ROOT/server.js"'),
  'sync_android_assets.sh 必须原样复制 server.js（不得内联/改写后打包）'
);
assert.ok(!/sed[^\n]*server\.js/.test(syncScript), '资源同步不得改写 server.js 本体');

// ── 3. 运行时版本约束（内嵌 nodejs-mobile 为 Node 18）────────────────────────
assert.ok(
  /NODEJS_MOBILE_TAG="\$\{NODEJS_MOBILE_TAG:-v18\./.test(fetchScript),
  '内嵌 Node 运行时固定为 nodejs-mobile v18.x：server.js 不得使用 Node 19+ 独有 API'
);

// ── 4. 协议关键点必须保留 ──────────────────────────────────────────────────
for (const marker of [
  'baseRevision',            // Typed Patch 的 CAS 基线
  'awaiting-narration',      // Agent 执行后必须落一个待提交结果
  'setupStatus',             // 摘要必须暴露开局状态
  'world-version-upgrade',   // 升级必须留迁移记录
]) {
  assert.ok(server.includes(marker), `server.js 缺少协议标记: ${marker}`);
}

console.log('android protocol checks passed (single-source backend)');
