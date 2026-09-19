#!/usr/bin/env bash
#
# 把 PC 端的唯一来源（server.js + public/）同步进 APK assets。
#
# 产物（android/app/src/main/assets/nodejs/，已被 .gitignore 忽略）：
#   server.js                 ← 与桌面端同一个文件，零改动
#   public/...                ← 前端资源
#   licenses/...              ← 许可与第三方声明（分发用，非 Web 资源）
#
# 桌面端与 Android 端因此共享同一份后端实现，不再有第二份 Kotlin 重写。
#
# 用法：
#   bash scripts/sync_android_assets.sh [资源版本号]
#   资源版本号用于给 index.html / sw.js 打版本戳，避免覆盖安装后
#   WebView Service Worker 命中旧壳。省略时为 dev。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSETS_DIR="$REPO_ROOT/android/app/src/main/assets"
ASSET_ROOT="$ASSETS_DIR/nodejs"
VERSION="${1:-dev}"

cd "$REPO_ROOT"

echo "== 1/4 重建前端 bundle =="
node scripts/build_frontend.js

echo "== 2/4 资源版本戳 =="
# index.html / sw.js 是仓库文件，改完要还原，避免污染工作区
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp public/index.html "$TMP/index.html"
cp public/sw.js "$TMP/sw.js"
sed -E -i "s#(styles.css\?v=)[^\" ]+#\1${VERSION}#; s#(app.js\?v=)[^\" ]+#\1${VERSION}#" public/index.html
sed -E -i "s#const ASSET_VERSION = '[^']+';#const ASSET_VERSION = '${VERSION}';#" public/sw.js

echo "== 3/4 写入 assets =="
# assets/ 整体都是构建产物：整目录重建，避免上一次构建的旧文件残留进 APK
rm -rf "$ASSETS_DIR"
mkdir -p "$ASSET_ROOT/public/data" "$ASSET_ROOT/licenses"

# 后端：唯一来源，原样打包（零 npm 依赖的纯 Node）
cp server.js "$ASSET_ROOT/server.js"

# 前端资源（明确列出；绝不复制 public/data/ 下的运行时文件——含用户 API key）
cp public/index.html public/styles.css public/app.js public/mapgen.js \
   public/manifest.json public/sw.js public/favicon.png \
   "$ASSET_ROOT/public/"
cp -r public/vendor public/icons "$ASSET_ROOT/public/"

# 许可与第三方声明随 APK 分发
cp LICENSE LICENSE-MIT-LEGACY THIRD_PARTY_NOTICES.md "$ASSET_ROOT/licenses/"

# 仅模板数据（_defaults.json），其余运行时文件由 App 首次启动生成
cp public/data/_defaults.json "$ASSET_ROOT/public/data/_defaults.json"

echo "== 4/4 还原 index.html / sw.js =="
cp "$TMP/index.html" public/index.html
cp "$TMP/sw.js" public/sw.js
git diff --quiet -- public/index.html public/sw.js || echo "⚠️  index.html / sw.js 仍有改动，请检查"

echo "✅ assets 已同步：android/app/src/main/assets/nodejs/（server.js + public/）"