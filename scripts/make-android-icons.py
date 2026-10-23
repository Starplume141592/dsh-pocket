from PIL import Image, ImageDraw
from pathlib import Path

root = Path(r'F:\dshapp')
src = Image.open(root / 'app' / 'icon-512.png').convert('RGBA')
res = root / 'mobile' / 'android' / 'app' / 'src' / 'main' / 'res'
sizes = { 'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192 }

for density, size in sizes.items():
    folder = res / ('mipmap-' + density)
    folder.mkdir(parents=True, exist_ok=True)
    icon = src.resize((size, size), Image.LANCZOS)
    icon.save(folder / 'ic_launcher.png')
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    rounded = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    rounded.paste(icon, (0, 0), mask)
    rounded.save(folder / 'ic_launcher_round.png')
    fg_size = int(size * 2.25)
    fg = Image.new('RGBA', (fg_size, fg_size), (0, 0, 0, 0))
    inner = int(fg_size * 0.62)
    inner_img = src.resize((inner, inner), Image.LANCZOS)
    fg.paste(inner_img, ((fg_size - inner) // 2, (fg_size - inner) // 2), inner_img)
    fg.save(folder / 'ic_launcher_foreground.png')

colors = res / 'values' / 'ic_launcher_background.xml'
colors.write_text('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#07080B</color>\n</resources>\n', encoding='utf-8')
print('android launcher icons updated')
