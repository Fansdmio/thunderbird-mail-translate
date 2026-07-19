"""
从 src/icons/image-476.png 生成亮/暗主题图标（透明底）。

- 亮色主题：透明底 + 深色前景
- 暗色主题：透明底 + 纯白前景
- 扩展管理器：浅灰底品牌图

用法：
  uv run --with pillow python scripts/generate-icons.py
  .\\.venv\\Scripts\\python.exe scripts/generate-icons.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

# 仓库根目录
ROOT = Path(__file__).resolve().parent.parent
# 源图标
SOURCE = ROOT / "src" / "icons" / "image-476.png"
# 输出目录
OUT = ROOT / "src" / "icons"
# 导出尺寸
SIZES = (16, 32, 48, 64, 96, 128)


def is_background(r: int, g: int, b: int, a: int) -> bool:
    """判断是否为近白背景像素。"""
    if a < 10:
        return True
    if r > 245 and g > 245 and b > 245:
        return True
    if r > 250 and g > 248 and b > 248:
        return True
    return False


def extract_foreground(src: Image.Image) -> Image.Image:
    """去除白底，提取前景图案。"""
    w, h = src.size
    pixels = src.load()
    fg = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out = fg.load()

    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if is_background(r, g, b, a):
                continue
            # 边缘近白像素降低不透明度，减少锯齿
            lum = (r + g + b) / 3
            if lum > 230:
                na = int(a * (255 - lum) / 25)
                if na <= 0:
                    continue
                out[x, y] = (r, g, b, min(a, na))
            else:
                out[x, y] = (r, g, b, a)
    return fg


def make_light_variant(fg: Image.Image) -> Image.Image:
    """生成暗色主题用的纯白实心前景（透明底）。"""
    w, h = fg.size
    src = fg.load()
    light = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dst = light.load()

    for y in range(h):
        for x in range(w):
            r, g, b, a = src[x, y]
            if a == 0:
                continue
            lum = (r + g + b) / 3
            # 主体区域直接实心白；边缘保留抗锯齿
            if lum < 200:
                alpha = 255
            else:
                alpha = int(a * max(0.0, (255 - lum) / 55))
            if alpha <= 0:
                continue
            dst[x, y] = (255, 255, 255, min(255, alpha))
    return light


def save_sizes(image: Image.Image, pattern: str) -> None:
    """按尺寸导出 PNG。"""
    for size in SIZES:
        path = OUT / pattern.format(size=size)
        image.resize((size, size), Image.Resampling.LANCZOS).save(
            path, "PNG", optimize=True
        )
        print(f"  {path.relative_to(ROOT)} ({path.stat().st_size} bytes)")


def make_store_icon(fg: Image.Image) -> None:
    """生成扩展管理器图标（浅灰底，列表中始终可见）。"""
    w, h = fg.size
    store = Image.new("RGBA", (w, h), (245, 246, 247, 255))
    store.alpha_composite(fg)
    path = OUT / "icon-store-128.png"
    store.resize((128, 128), Image.Resampling.LANCZOS).save(path, "PNG", optimize=True)
    print(f"  {path.relative_to(ROOT)} ({path.stat().st_size} bytes)")


def cleanup_temp_files() -> None:
    """清理临时/预览文件。"""
    for p in OUT.glob("_*"):
        if p.is_file():
            p.unlink()
    for p in OUT.glob("show-*.png"):
        if p.is_file():
            p.unlink()
    preview = OUT / "preview-toolbar.png"
    if preview.exists():
        preview.unlink()


def main() -> None:
    """主入口：生成透明底亮/暗主题图标。"""
    if not SOURCE.exists():
        raise SystemExit(f"源图标不存在: {SOURCE}")

    OUT.mkdir(parents=True, exist_ok=True)
    src = Image.open(SOURCE).convert("RGBA")
    print(f"source: {SOURCE.relative_to(ROOT)} {src.size}")

    # 亮色工具栏：透明底 + 深色图案
    fg = extract_foreground(src)
    print("light-theme icons (transparent + dark):")
    save_sizes(fg, "icon-{size}.png")

    # 暗色工具栏：透明底 + 纯白图案
    light = make_light_variant(fg)
    print("dark-theme icons (transparent + white):")
    save_sizes(light, "icon-light-{size}.png")

    print("store icon:")
    make_store_icon(fg)

    cleanup_temp_files()
    print("done")


if __name__ == "__main__":
    main()
