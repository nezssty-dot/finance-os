#!/usr/bin/env python3
"""
Generates the Finance OS app icon in the three formats electron-builder needs:

    assets/icon.png   512x512   -> Linux (AppImage)
    assets/icon.ico   multi-size -> Windows (NSIS)
    assets/icon.icns  multi-size -> macOS (DMG)

Run:  python3 scripts/make_icons.py
(Only needed if you want to change the artwork — the icons are committed.)

Pillow cannot write .icns outside macOS (it shells out to `iconutil`), so the
ICNS is assembled by hand: modern .icns is just a header plus typed chunks that
may contain raw PNG data.
"""
import os
import struct
from io import BytesIO

from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")
os.makedirs(OUT, exist_ok=True)

GOLD_TOP = (231, 189, 82)     # #e7bd52
GOLD_BOTTOM = (168, 125, 31)  # #a87d1f
INK = (26, 18, 6)             # #1a1206


def render(size: int) -> Image.Image:
    """Draw the icon at `size` px: a gold gradient rounded square with a dark F."""
    # 4x supersampling, then downscale — gives clean antialiased edges.
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))

    # Vertical gold gradient
    grad = Image.new("RGBA", (1, s))
    gp = grad.load()
    for y in range(s):
        t = y / max(s - 1, 1)
        gp[0, y] = (
            round(GOLD_TOP[0] + (GOLD_BOTTOM[0] - GOLD_TOP[0]) * t),
            round(GOLD_TOP[1] + (GOLD_BOTTOM[1] - GOLD_TOP[1]) * t),
            round(GOLD_TOP[2] + (GOLD_BOTTOM[2] - GOLD_TOP[2]) * t),
            255,
        )
    grad = grad.resize((s, s))

    # Rounded-square mask (macOS "squircle"-ish corner radius ≈ 22%)
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=255
    )
    img.paste(grad, (0, 0), mask)

    # The "F" — drawn as geometry so it never depends on a font being installed.
    d = ImageDraw.Draw(img)
    stem_w = int(s * 0.115)
    left = int(s * 0.315)
    top = int(s * 0.245)
    bottom = int(s * 0.755)
    arm_top_w = int(s * 0.345)
    arm_mid_w = int(s * 0.255)
    arm_h = int(s * 0.105)
    mid_y = int(s * 0.455)

    d.rectangle([left, top, left + stem_w, bottom], fill=INK)                    # stem
    d.rectangle([left, top, left + arm_top_w, top + arm_h], fill=INK)            # top arm
    d.rectangle([left, mid_y, left + arm_mid_w, mid_y + arm_h], fill=INK)        # middle arm

    return img.resize((size, size), Image.LANCZOS)


def write_icns(path: str, sizes_by_type: dict[str, int]) -> None:
    """Assemble an .icns from PNG-encoded chunks (supported since macOS 10.7)."""
    chunks = b""
    for ostype, px in sizes_by_type.items():
        buf = BytesIO()
        render(px).save(buf, format="PNG")
        data = buf.getvalue()
        chunks += ostype.encode("ascii") + struct.pack(">I", len(data) + 8) + data
    with open(path, "wb") as f:
        f.write(b"icns" + struct.pack(">I", len(chunks) + 8) + chunks)


# ── PNG (Linux) ──
render(512).save(os.path.join(OUT, "icon.png"), format="PNG")

# ── ICO (Windows) — Pillow writes the whole multi-size set ──
render(256).save(
    os.path.join(OUT, "icon.ico"),
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)

# ── ICNS (macOS) ──
write_icns(
    os.path.join(OUT, "icon.icns"),
    {
        "ic11": 32,    # 16pt @2x
        "ic12": 64,    # 32pt @2x
        "ic07": 128,
        "ic13": 256,   # 128pt @2x
        "ic08": 256,
        "ic14": 512,   # 256pt @2x
        "ic09": 512,
        "ic10": 1024,  # 512pt @2x
    },
)

for name in ("icon.png", "icon.ico", "icon.icns"):
    p = os.path.join(OUT, name)
    print(f"  {name:10} {os.path.getsize(p):>8,} bytes")
print("\nIconos generados en electron/assets/")
