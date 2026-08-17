"""打包 GitHub 网页上传用的 zip（排除敏感/无关文件）"""
import zipfile, os

SRC = 'A:/test-rpg-airp'
OUT = 'A:/test-rpg-airp/tavern-upload.zip'
EXCLUDE_DIRS = {
    '.git', '.reasonix', 'node_modules', '__pycache__', '.gradle', 'build', '.idea', 'images',
    '.playwright', '.playwright-cli', 'test-results', 'tmp',
}
EXCLUDE_FILES = {
    'tavern-upload.zip', 'cloudflared.exe', 'make_icons.py',
    # Release 包不携带 Android 签名私钥；仓库内的构建仍可继续使用它。
    'android/app/tavern.p12',
}

count = 0
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(SRC):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for f in files:
            p = os.path.join(root, f)
            rel = os.path.relpath(p, SRC).replace('\\', '/')
            if rel in EXCLUDE_FILES or f.lower().endswith('.zip'):
                continue
            # public/data 只留 _defaults.json（运行时文件含 API key，绝不上传）
            if rel.startswith('public/data/') and f != '_defaults.json':
                continue
            z.write(p, rel)
            count += 1

print(f'打包完成: {OUT} ({count} 个文件, {os.path.getsize(OUT)//1024} KB)')
