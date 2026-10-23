from PIL import Image, ImageDraw

SIZE = 1024
BG = (17, 20, 24, 255)
BLUE = (77, 107, 254, 255)
WHITE = (232, 234, 237, 255)


def draw_master(padding_scale: float) -> Image.Image:
    img = Image.new("RGBA", (SIZE, SIZE), BG)
    d = ImageDraw.Draw(img)
    # 内容整体缩放，供 maskable 版本留出安全区
    s = padding_scale
    cx = cy = SIZE / 2

    def pt(x, y):
        return (cx + (x - cx) * s, cy + (y - cy) * s)

    def rect(x0, y0, x1, y1, radius, **kw):
        d.rounded_rectangle([pt(x0, y0), pt(x1, y1)], radius=int(radius * s), **kw)

    # 手机外框
    rect(312, 196, 712, 828, 78, outline=BLUE, width=int(40 * s))
    # 听筒
    rect(466, 248, 558, 262, 7, fill=BLUE)
    # 对话气泡
    rect(392, 396, 632, 572, 44, fill=BLUE)
    # 气泡尾巴
    d.polygon([pt(452, 560), pt(452, 626), pt(516, 566)], fill=BLUE)
    # 三个点
    for x in (468, 512, 556):
        r = 15 * s
        px, py = pt(x, 484)
        d.ellipse([px - r, py - r, px + r, py + r], fill=WHITE)
    # 底部横条
    rect(466, 748, 558, 762, 7, fill=BLUE)
    return img


master = draw_master(1.0)
master.save(r"F:\dshapp\dsh-mobile\assets\icon-source.png")

for name, size in (("icon-512.png", 512), ("icon-192.png", 192), ("icon-180.png", 180)):
    master.resize((size, size), Image.LANCZOS).save(rf"F:\dshapp\dsh-mobile\assets\{name}")

# maskable：内容缩到 72%，四周留出安全区
maskable = draw_master(0.72)
maskable.resize((512, 512), Image.LANCZOS).save(r"F:\dshapp\dsh-mobile\assets\icon-maskable-512.png")

print("icons written")
