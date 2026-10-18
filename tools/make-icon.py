"""PixYang 应用图标生成器（Windows ICO）。

用法: python tools/make-icon.py
输出: src-tauri/icons/icon.ico —— 16/24/32/48/64/128 为 32bpp BMP 层（Explorer/任务栏兼容），
      256 为 PNG 层（Vista+ 大图标标准）。字形用 Segoe UI Bold 在 16x 超采样下逐尺寸渲染后
      LANCZOS 缩小，避免单张栅格放缩导致的模糊。
"""

import io
import os
import struct

from PIL import Image, ImageDraw, ImageFilter, ImageFont

TOP = (108, 92, 231)
BOT = (139, 92, 246)
SIZES = [16, 24, 32, 48, 64, 128, 256]
FONT = 'C:/Windows/Fonts/segoeuib.ttf'
SS = 16
OUT = os.path.join(os.path.dirname(__file__), '..', 'src-tauri', 'icons', 'icon.ico')


def gradient(s):
    col = Image.new('RGB', (1, s))
    px = col.load()
    for y in range(s):
        t = y / (s - 1)
        px[0, y] = tuple(int(round(TOP[i] + (BOT[i] - TOP[i]) * t)) for i in range(3))
    return col.resize((s, s), Image.NEAREST)


def render(size):
    s = size * SS
    bg = gradient(s).convert('RGBA')
    mask = Image.new('L', (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=0.225 * s, fill=255)
    bg.putalpha(mask)

    cap = 0.50 if size <= 20 else (0.485 if size <= 32 else 0.47)
    f = ImageFont.truetype(FONT, int(s * 0.7))
    probe = ImageDraw.Draw(Image.new('L', (8, 8)))
    height = probe.textbbox((0, 0), 'P', font=f)[3] - probe.textbbox((0, 0), 'P', font=f)[1]
    f = ImageFont.truetype(FONT, max(4, int(s * 0.7 * (cap * s) / height)))

    glyph = Image.new('L', (s, s), 0)
    gd = ImageDraw.Draw(glyph)
    box = gd.textbbox((0, 0), 'P', font=f)
    tw, th = box[2] - box[0], box[3] - box[1]
    x = (s - tw) / 2 - box[0] - s * 0.006
    y = (s - th) / 2 - box[1]
    gd.text((x, y), 'P', font=f, fill=255)
    if size <= 32:
        glyph = glyph.filter(ImageFilter.MaxFilter(5))

    white = Image.new('RGBA', (s, s), (255, 255, 255, 0))
    white.putalpha(glyph)
    return Image.alpha_composite(bg, white).resize((size, size), Image.LANCZOS)


def dib_bytes(im):
    w, h = im.size
    px = im.load()
    header = struct.pack('<IiiHHIIiiII', 40, w, h * 2, 1, 32, 0, w * h * 4, 0, 0, 0, 0)
    body = bytearray()
    for y in range(h - 1, -1, -1):
        for x in range(w):
            r, g, b, a = px[x, y]
            body += bytes((b, g, r, a))
    row = ((w + 31) // 32) * 4
    body += bytes(row * h)
    return header + bytes(body)


def png_bytes(im):
    buf = io.BytesIO()
    im.save(buf, format='PNG')
    return buf.getvalue()


def write_ico(images, path):
    frames = [(s, dib_bytes(images[s]) if s < 256 else png_bytes(images[s])) for s in SIZES]
    out = bytearray(struct.pack('<HHH', 0, 1, len(frames)))
    offset = 6 + 16 * len(frames)
    for s, data in frames:
        out += struct.pack('<BBBBHHII', s % 256, s % 256, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    for _, data in frames:
        out += data
    with open(path, 'wb') as fh:
        fh.write(out)


if __name__ == '__main__':
    images = {s: render(s) for s in SIZES}
    write_ico(images, os.path.normpath(OUT))
    print('wrote', os.path.normpath(OUT))
