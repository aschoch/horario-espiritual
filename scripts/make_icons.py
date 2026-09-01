"""Generate PWA icons with Pillow. Run: python3 scripts/make_icons.py"""
from PIL import Image, ImageDraw
import os
BG, FG = "#1f3a5f", "#ffffff"
OUT = os.path.join(os.path.dirname(__file__), "..", "icons")

def icon(size, path, maskable=False):
    img = Image.new("RGB", (size, size), BG)
    d = ImageDraw.Draw(img)
    pad = size * (0.22 if maskable else 0.15)
    ring_w = max(2, round(size * 0.045))
    d.ellipse([pad, pad, size - pad, size - pad], outline=FG, width=ring_w)
    cx = cy = size / 2
    r = size / 2 - pad
    pts = [(cx - r * 0.46, cy + r * 0.02), (cx - r * 0.13, cy + r * 0.36), (cx + r * 0.5, cy - r * 0.34)]
    d.line(pts, fill=FG, width=max(3, round(size * 0.075)), joint="curve")
    img.save(path, optimize=True)

os.makedirs(OUT, exist_ok=True)
icon(180, os.path.join(OUT, "apple-touch-icon.png"))
icon(192, os.path.join(OUT, "icon-192.png"))
icon(512, os.path.join(OUT, "icon-512.png"))
icon(512, os.path.join(OUT, "icon-512-maskable.png"), maskable=True)
print("icons written to", os.path.abspath(OUT))
