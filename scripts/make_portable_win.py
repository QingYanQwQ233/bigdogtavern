"""构建无需安装 Node.js 的 Windows x64 便携文件夹包。"""
from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_NODE_VERSION = os.environ.get("TAVERN_NODE_VERSION", "v24.19.0")
DEFAULT_TAVERN_VERSION = os.environ.get("TAVERN_VERSION", "v0.1.50")


LAUNCHER = r'''@echo off
setlocal
cd /d "%~dp0"
set "TAVERN_DATA_DIR=%~dp0data"
set "PORT=3000"
if not exist "%TAVERN_DATA_DIR%" mkdir "%TAVERN_DATA_DIR%"
echo Tavern 正在启动，数据目录：%TAVERN_DATA_DIR%
start "Tavern Server" "%~dp0runtime\node.exe" "%~dp0server.js"
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:%PORT%"
echo 浏览器已打开；关闭 Tavern Server 窗口即可停止服务。
endlocal
'''


PORTABLE_README = r'''Tavern · Windows 便携版

使用：双击“启动 Tavern.bat”。

- 本包已内置 Node.js，无需安装 Node.js、npm 或配置环境变量。
- 首次启动会在 data\ 中生成角色卡、预设、世界书、设置和存档。
- API Key 只保存在本机 data\settings.json，不会写入发布包。
- 关闭启动后出现的 Tavern Server 窗口即可停止服务。
- 默认地址：http://localhost:3000
- 服务端默认无鉴权，只建议在本机使用，不要直接暴露到公网。

如果 3000 端口被占用，请关闭已有 Tavern 进程后再启动。
'''


def normalize_version(value: str) -> str:
    value = value.strip()
    return value if value.startswith("v") else f"v{value}"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_node(node_version: str, cache_dir: Path) -> Path:
    archive_name = f"node-{node_version}-win-x64.zip"
    archive_path = cache_dir / archive_name
    if archive_path.exists() and zipfile.is_zipfile(archive_path):
        return archive_path
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    url = f"https://nodejs.org/dist/{node_version}/{archive_name}"
    print(f"下载 Node.js {node_version}: {url}")
    try:
        urllib.request.urlretrieve(url, archive_path)
    except Exception:
        archive_path.unlink(missing_ok=True)
        raise
    if not zipfile.is_zipfile(archive_path):
        archive_path.unlink(missing_ok=True)
        raise RuntimeError(f"Node.js 下载文件不是有效 ZIP：{url}")
    return archive_path


def verify_node_archive(node_zip: Path, node_version: str) -> None:
    archive_name = f"node-{node_version}-win-x64.zip"
    checksum_url = f"https://nodejs.org/dist/{node_version}/SHASUMS256.txt"
    with urllib.request.urlopen(checksum_url, timeout=30) as response:
        checksums = response.read().decode("utf-8")
    expected = next(
        (line.split()[0] for line in checksums.splitlines() if line.strip().endswith(f" {archive_name}")),
        None,
    )
    if not expected:
        raise RuntimeError(f"Node.js 校验清单中未找到 {archive_name}")
    actual = sha256(node_zip)
    if actual.lower() != expected.lower():
        raise RuntimeError(f"Node.js SHA-256 校验失败：expected={expected} actual={actual}")


def extract_runtime(node_zip: Path, target: Path) -> None:
    with zipfile.ZipFile(node_zip) as archive:
        root = next((item for item in archive.namelist() if item.endswith("/node.exe")), None)
        if not root:
            raise RuntimeError("Node.js ZIP 中未找到 node.exe")
        prefix = root[: -len("node.exe")]
        target.mkdir(parents=True, exist_ok=True)
        for filename in ("node.exe", "LICENSE", "README.md"):
            member = prefix + filename
            if member not in archive.namelist():
                if filename == "node.exe":
                    raise RuntimeError("Node.js ZIP 中未找到 node.exe")
                continue
            destination = target / filename
            with archive.open(member) as source, destination.open("wb") as sink:
                shutil.copyfileobj(source, sink)


def copy_public(source: Path, target: Path) -> None:
    def ignore(directory: str, names: list[str]) -> set[str]:
        current = Path(directory)
        return {"images", "data"} if current == source else set()

    shutil.copytree(source, target, ignore=ignore)


def build_package(node_version: str, tavern_version: str, output: Path, node_zip: Path | None) -> Path:
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    (ROOT / "tmp").mkdir(parents=True, exist_ok=True)
    if output.exists():
        raise FileExistsError(f"输出文件已存在，请先移走或删除：{output}")

    cache_dir = ROOT / "tmp" / "node-runtime"
    runtime_zip = node_zip.resolve() if node_zip else download_node(node_version, cache_dir)
    verify_node_archive(runtime_zip, node_version)
    folder_name = f"tavern-{tavern_version}-portable-win-x64"

    with tempfile.TemporaryDirectory(prefix="tavern-portable-", dir=ROOT / "tmp") as temp_dir:
        stage = Path(temp_dir) / folder_name
        stage.mkdir(parents=True)
        shutil.copy2(ROOT / "server.js", stage / "server.js")
        copy_public(ROOT / "public", stage / "public")
        data_dir = stage / "data"
        data_dir.mkdir()
        shutil.copy2(ROOT / "public" / "data" / "_defaults.json", data_dir / "_defaults.json")
        shutil.copy2(ROOT / "LICENSE", stage / "LICENSE")
        (stage / "启动 Tavern.bat").write_text(LAUNCHER, encoding="utf-8")
        (stage / "便携版说明.txt").write_text(PORTABLE_README, encoding="utf-8")
        extract_runtime(runtime_zip, stage / "runtime")

        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(stage.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(stage.parent).as_posix())

    print(f"打包完成: {output}")
    print(f"SHA-256: {sha256(output)}")
    print(f"Node.js: {node_version}")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node-version", default=DEFAULT_NODE_VERSION)
    parser.add_argument("--version", default=DEFAULT_TAVERN_VERSION)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--node-zip", type=Path, help="使用本地 Node.js Windows x64 ZIP，跳过下载")
    args = parser.parse_args()
    node_version = normalize_version(args.node_version)
    tavern_version = normalize_version(args.version)
    output = args.output or (ROOT / "tmp" / f"tavern-{tavern_version}-portable-win-x64.zip")
    build_package(node_version, tavern_version, output, args.node_zip)


if __name__ == "__main__":
    main()
