#!/usr/bin/env bash
#
# 一键构建 Android APK（后端 = 仓库里的 server.js，由内嵌 Node 运行时执行）。
#
# 等价于依次执行：
#   scripts/fetch_android_node.sh      获取 libnode.so 并编译 JNI 桥
#   scripts/sync_android_assets.sh     同步 server.js + public/ 到 assets
#   gradle assembleDebug
#
# 用法：
#   bash scripts/build_android_apk.sh [versionCode] [versionName]
#   bash scripts/build_android_apk.sh 80 alpha-0.1.80
#
# 前置条件：
#   ANDROID_HOME（或 /opt/android-sdk）、JDK 17、Gradle
#   aarch64 宿主额外需要系统 clang（官方 NDK 只带 x86_64 工具链，脚本会自动走 sysroot 交叉编译）
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VC="${1:-1}"
VN="${2:-alpha-local}"

export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-arm64}"
export ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/opt/android-sdk}}"

cd "$REPO_ROOT"

echo "== 1/3 获取 Node 运行时 + 编译 JNI 桥 =="
bash scripts/fetch_android_node.sh

echo "== 2/3 同步 server.js + public/ 到 assets =="
bash scripts/sync_android_assets.sh "apk-$VC"

echo "== 3/3 构建 APK =="
cd android
gradle --no-daemon assembleDebug -Pvc="$VC" -Pvn="$VN"

APK="$REPO_ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
[ -f "$APK" ] || { echo "❌ 构建失败，未找到 APK"; exit 1; }
echo
echo "✅ APK: $APK"
ls -lh "$APK"