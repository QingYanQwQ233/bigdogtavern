"""生成 Tavern PWA 图标（192/512 PNG，爪印图案，暖木色调）"""
from PIL import Image, ImageDraw
import os

def make_icon(size, path):
    # 圆角方块底色（暖木渐变模拟：深→浅）
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = size * 0.22
    # 圆角矩形（用多次椭圆+矩形近似）
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=(44, 39, 32, 255))
    # 底部大椭圆 + 顶部内渐变
    grad = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    gd.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=(120, 84, 48, 255))
    # 叠加爪印（米色）
    paw = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    pd = ImageDraw.Draw(paw)
    c = (232, 214, 180, 255)  # 米色爪印
    cx, cy = size * 0.5, size * 0.60
    # 主掌垫
    pd.ellipse([cx - size*0.26, cy - size*0.14, cx + size*0.26, cy + size*0.24], fill=c)
    # 四个脚趾
    for dx, dy, s in [(-0.20, -0.34, 0.13), (-0.07, -0.44, 0.14), (0.07, -0.44, 0.14), (0.20, -0.34, 0.13)]:
        pd.ellipse([cx + dx*size - size*s, cy + dy*size - size*s*1.15, cx + dx*size + size*s, cy + dy*size + size*s*0.85], fill=c)
    # 底部稍深形成层次
    img = Image.alpha_composite(img, grad)
    img = Image.alpha_composite(img, paw)
    img.save(path, 'PNG')

os.makedirs('public/icons', exist_ok=True)
make_icon(192, 'public/icons/icon-192.png')
make_icon(512, 'public/icons/icon-512.png')
print('图标已生成')
