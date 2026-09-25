#!/usr/bin/env bash
#
# 获取 nodejs-mobile 运行时并编译 JNI 桥，产出 jniLibs。产物不入库（见 .gitignore）。
#
# 产出（android/app/src/main/jniLibs/<abi>/）：
#   libnode.so          ← nodejs-mobile 官方预编译（Node 18.20.4）
#   libc++_shared.so    ← 取自 NDK sysroot（官方 zip 里不含这个）
#   libnode_bridge.so   ← 本仓库 android/native/node_bridge.cpp 编译产物（约 12 KB）
#
# 两种宿主都支持：
#   * x86_64 开发机 / GitHub Actions：直接用 NDK 自带工具链
#   * aarch64 开发机（Termux / proot 设备）：官方 NDK 只提供 linux-x86_64 工具链，
#     因此改用宿主原生 clang + NDK 的 android sysroot 交叉编译
#
# 环境变量：
#   ANDROID_HOME / ANDROID_SDK_ROOT    Android SDK 路径（默认 /opt/android-sdk）
#   ANDROID_NDK_HOME                   指定 NDK（默认取 $SDK/ndk/ 下最新一个）
#   ABI                                默认 arm64-v8a
#   API                                minSdk 对应的 API level，默认 24
#   NODEJS_MOBILE_TAG                  默认 v18.20.4
#   TAVERN_NODE_CACHE                  下载缓存目录（默认 ~/.cache/tavern-android-node）
#   CLANGXX                            仅 aarch64 宿主生效，覆盖 clang++ 路径
#   https_proxy                        下载走代理时按 curl 约定设置即可
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ABI="${ABI:-arm64-v8a}"
API="${API:-24}"
NODEJS_MOBILE_TAG="${NODEJS_MOBILE_TAG:-v18.20.4}"
ARCHIVE="nodejs-mobile-${NODEJS_MOBILE_TAG}-android.zip"
URL="https://github.com/nodejs-mobile/nodejs-mobile/releases/download/${NODEJS_MOBILE_TAG}/${ARCHIVE}"

CACHE="${TAVERN_NODE_CACHE:-$HOME/.cache/tavern-android-node}"
OUT="$REPO_ROOT/android/app/src/main/jniLibs/$ABI"
SRC="$REPO_ROOT/android/native/node_bridge.cpp"

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/opt/android-sdk}}"
NDK="${ANDROID_NDK_HOME:-$(ls -d "$SDK"/ndk/* 2>/dev/null | sort -V | tail -1 || true)}"

case "$ABI" in
  arm64-v8a)         ANDROID_TRIPLE="aarch64-linux-android" ;;
  armeabi-v7a)       ANDROID_TRIPLE="armv7a-linux-androideabi" ;;
  x86_64)            ANDROID_TRIPLE="x86_64-linux-android" ;;
  *) echo "❌ 不支持的 ABI: $ABI"; exit 1 ;;
esac

[ -d "$NDK" ] || { echo "❌ 找不到 NDK。请设置 ANDROID_NDK_HOME，或安装到 $SDK/ndk/"; exit 1; }
PRE="$NDK/toolchains/llvm/prebuilt/linux-x86_64"
SYS="$PRE/sysroot"
[ -d "$SYS" ] || { echo "❌ NDK sysroot 不存在: $SYS"; exit 1; }
[ -f "$SRC" ] || { echo "❌ 缺少 JNI 源文件: $SRC"; exit 1; }

echo "== 1/4 准备 nodejs-mobile ($NODEJS_MOBILE_TAG / $ABI) =="
mkdir -p "$CACHE"
ZIP="$CACHE/$ARCHIVE"
if [ ! -s "$ZIP" ]; then
  echo "   下载 $URL"
  curl -fL --retry 3 --retry-delay 2 -o "$ZIP" "$URL"
else
  echo "   命中缓存 $ZIP"
fi
rm -rf "$CACHE/dist"
mkdir -p "$CACHE/dist"
unzip -oq "$ZIP" -d "$CACHE/dist"

mkdir -p "$OUT"
cp -f "$CACHE/dist/bin/$ABI/libnode.so" "$OUT/libnode.so"

# libc++_shared.so 不在官方 zip 里，从 NDK sysroot 取（与 libnode.so 同 ABI）
LIBCXX="$(find "$SYS/usr/lib" -maxdepth 2 -name 'libc++_shared.so' -path "*${ANDROID_TRIPLE%%-*}*" 2>/dev/null | head -1 || true)"
if [ -z "$LIBCXX" ]; then
  LIBCXX="$(find "$SYS/usr/lib" -maxdepth 2 -name 'libc++_shared.so' 2>/dev/null | head -1 || true)"
fi
[ -n "$LIBCXX" ] || { echo "❌ 找不到 libc++_shared.so（NDK sysroot）"; exit 1; }
cp -f "$LIBCXX" "$OUT/libc++_shared.so"
echo "   libc++_shared.so ← $LIBCXX"

echo "== 2/4 探测宿主工具链 =="
HOST_ARCH="$(uname -m)"
echo "   宿主架构: $HOST_ARCH / NDK: $NDK"

if [ "$HOST_ARCH" = "x86_64" ]; then
  # 标准路径：NDK 自带交叉工具链
  CLANGXX="${CLANGXX:-$PRE/bin/${ANDROID_TRIPLE}${API}-clang++}"
  [ -x "$CLANGXX" ] || { echo "❌ NDK clang++ 不可执行: $CLANGXX"; exit 1; }
  HOST_FLAGS=()
  LINK_EXTRA=()
else
  # aarch64 宿主：NDK 无对应工具链，用宿主 clang + NDK sysroot
  CLANGXX="${CLANGXX:-clang++}"
  command -v "$CLANGXX" >/dev/null || { echo "❌ 找不到宿主 clang++，请先安装（apt install clang）"; exit 1; }
  HOST_FLAGS=(--target="${ANDROID_TRIPLE}${API}" --sysroot="$SYS" -I"$SYS/usr/include/c++/v1")
  # builtins 的 resource-dir 名称随 clang 版本变化，这里动态定位
  CLANG_RT="$(ls -d "$PRE"/lib/clang/*/lib/linux 2>/dev/null | tail -1 || true)"
  [ -n "$CLANG_RT" ] || { echo "❌ 找不到 NDK builtins 目录"; exit 1; }
  # 只收集 .so：否则链接器会误拉静态 libc.a，其 gwp_asan_wrappers.o 带 IE 模式 TLS 符号，
  # 运行期表现为 "dlopen: TLS symbol ... using IE access model" 而加载失败
  DYNLIB="$CACHE/dynlibs-$ABI"
  rm -rf "$DYNLIB"; mkdir -p "$DYNLIB"
  find "$SYS/usr/lib/$ANDROID_TRIPLE" -maxdepth 1 -name '*.so' -exec cp -f {} "$DYNLIB/" \; 2>/dev/null || true
  LINK_EXTRA=(-L"$DYNLIB" -L"$CLANG_RT" -rtlib=compiler-rt
              -ftls-model=global-dynamic
              -Wl,--exclude-libs,ALL -Wl,--allow-shlib-undefined)
fi

echo "== 3/4 编译 libnode_bridge.so =="
"$CLANGXX" \
  "${HOST_FLAGS[@]}" \
  -std=c++17 -fPIC -shared -O2 \
  -I"$CACHE/dist/include/node" \
  "${LINK_EXTRA[@]}" \
  -o "$OUT/libnode_bridge.so" \
  "$SRC" "$OUT/libnode.so" \
  -lc++_shared -llog

echo "== 4/4 结果 =="
ls -l "$OUT"
echo "✅ jniLibs 就绪：$OUT"