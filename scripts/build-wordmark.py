# /// script
# dependencies = ["fonttools", "brotli", "uharfbuzz"]
# ///
"""Writes assets/wordmark.svg: the header wordmark set in Inter and turned into outlines,
so it renders the same anywhere. Colors come from brand.config.js.

    uv run scripts/build-wordmark.py
"""
import io
import re
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parent.parent
config = (root / "brand.config.js").read_text()
colors = {name: re.search(rf"{name}:\s*'(#[0-9a-fA-F]{{6}})'", config).group(1) for name in ("vibe", "step")}

# Same as the app header: Inter Variable, 400 for "Vibe" and 800 for "step", letter-spacing -0.04em.
parts = [("Vibe", 400, colors["vibe"]), ("step", 800, colors["step"])]
size, tracking, pad = 100, -0.04, 6

source = TTFont(root / "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2")
buffer = io.BytesIO()
source.flavor = None
source.save(buffer)
face = hb.Face(buffer.getvalue())
upem = face.upem
scale = size / upem

paths, x = [], 0.0
bounds = BoundsPen(None)
for text, weight, color in parts:
    font = hb.Font(face)
    font.set_variations({"wght": weight})
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": True})
    pen = SVGPathPen(None, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        transform = (scale, 0, 0, -scale, x + pos.x_offset * scale, 0)
        font.draw_glyph_with_pen(info.codepoint, TransformPen(pen, transform))
        font.draw_glyph_with_pen(info.codepoint, TransformPen(bounds, transform))
        x += pos.x_advance * scale + tracking * size
    paths.append(f'  <path fill="{color}" d="{pen.getCommands()}"/>')

left, top, right, bottom = bounds.bounds
width, height = right - left + 2 * pad, bottom - top + 2 * pad
svg = (
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{left - pad:.2f} {top - pad:.2f} {width:.2f} {height:.2f}" '
    f'width="{width:.0f}" height="{height:.0f}" role="img" aria-label="Vibestep">\n'
    + "\n".join(paths)
    + "\n</svg>\n"
)
out = root / "assets/wordmark.svg"
out.write_text(svg)
print(f"wrote {out.relative_to(root)} ({len(svg)} bytes)")
