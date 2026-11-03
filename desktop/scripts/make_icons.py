"""Generate the OpenGene app icon set.

Draws a small plasmid map (backbone ring + directional feature arcs in the
app's feature-type colours) as SVG, rasterises it with Playwright's Chromium,
and writes:

    desktop/build/icon.svg        macOS-style tile (Big Sur grid, with margin)
    desktop/build/icon.icns       macOS app icon
    desktop/build/icon.ico        Windows app icon (full-bleed tile)
    desktop/build/icon.png        1024 px full-bleed (Linux / fallback)
    frontend/public/favicon.svg   web favicon (full-bleed)

Requires: Pillow, and Node with the `playwright` package resolvable.
Run from the repo root:  python desktop/scripts/make_icons.py
"""

from __future__ import annotations

import math
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / "desktop" / "build"
PUBLIC = ROOT / "frontend" / "public"

# Feature arcs: (start_deg, end_deg, colour, directional). 0 deg = top,
# clockwise, like the app's circular map. Colours = app feature palette.
FEATURES = [
    (16, 38, "#5CC463", True),     # promoter
    (48, 252, "#3FA2F7", True),    # CDS (the long arc)
    (264, 302, "#F25C4F", True),   # terminator
    (314, 350, "#FFA94D", False),  # origin
]


def _pt(cx: float, cy: float, r: float, deg: float) -> tuple[float, float]:
    a = math.radians(deg)
    return cx + r * math.sin(a), cy - r * math.cos(a)


def _arc(cx, cy, r_in, r_out, a0, a1, arrow) -> str:
    """Annular sector from a0 to a1 (degrees), with an arrowhead at a1."""
    head = min(14.0, (a1 - a0) * 0.45) if arrow else 0.0
    body_end = a1 - head
    large = 1 if (body_end - a0) > 180 else 0
    o0, ob = _pt(cx, cy, r_out, a0), _pt(cx, cy, r_out, body_end)
    i0, ib = _pt(cx, cy, r_in, a0), _pt(cx, cy, r_in, body_end)
    d = [f"M{o0[0]:.2f},{o0[1]:.2f}",
         f"A{r_out:.2f},{r_out:.2f} 0 {large} 1 {ob[0]:.2f},{ob[1]:.2f}"]
    if arrow:
        # Arrowhead flares slightly past the band, like a map feature arrow.
        flare = (r_out - r_in) * 0.18
        po = _pt(cx, cy, r_out + flare, body_end)
        tip = _pt(cx, cy, (r_in + r_out) / 2, a1)
        pi = _pt(cx, cy, r_in - flare, body_end)
        d += [f"L{po[0]:.2f},{po[1]:.2f}", f"L{tip[0]:.2f},{tip[1]:.2f}",
              f"L{pi[0]:.2f},{pi[1]:.2f}"]
    d += [f"L{ib[0]:.2f},{ib[1]:.2f}",
          f"A{r_in:.2f},{r_in:.2f} 0 {large} 0 {i0[0]:.2f},{i0[1]:.2f}", "Z"]
    return " ".join(d)


def make_svg(tile_x: float, tile_size: float, radius: float, shadow: bool) -> str:
    size = 1024
    cx = cy = size / 2
    r_ring = tile_size * 0.31
    band = tile_size * 0.095
    r_out = r_ring + band / 2
    r_in = r_ring - band / 2

    arcs = "\n    ".join(
        f'<path d="{_arc(cx, cy, r_in, r_out, a0, a1, arrow)}" fill="{color}"/>'
        for a0, a1, color, arrow in FEATURES
    )
    shadow_filter = (
        '<filter id="s" x="-20%" y="-20%" width="140%" height="140%">'
        '<feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#06121f" '
        'flood-opacity="0.35"/></filter>'
        if shadow else ""
    )
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#16456E"/>
      <stop offset="1" stop-color="#0B2742"/>
    </linearGradient>
    {shadow_filter}
  </defs>
  <rect x="{tile_x}" y="{tile_x}" width="{tile_size}" height="{tile_size}" rx="{radius}"
        fill="url(#bg)"{' filter="url(#s)"' if shadow else ''}/>
  <circle cx="{cx}" cy="{cy}" r="{r_ring:.2f}" fill="none" stroke="#D6E6F5"
          stroke-opacity="0.42" stroke-width="{tile_size * 0.022:.2f}"/>
  <g>
    {arcs}
  </g>
</svg>
"""


RENDER_JS = """
const { chromium } = require('playwright');
(async () => {
  const [svgPath, outPath] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  await p.goto('file://' + svgPath);
  await p.screenshot({ path: outPath, omitBackground: true });
  await b.close();
})();
"""


def rasterise(svg: str, out_png: Path) -> Image.Image:
    with tempfile.TemporaryDirectory() as tmp:
        svg_path = Path(tmp) / "icon.svg"
        js_path = Path(tmp) / "render.cjs"
        svg_path.write_text(svg)
        js_path.write_text(RENDER_JS)
        subprocess.run(["node", str(js_path), str(svg_path), str(out_png)], check=True)
    return Image.open(out_png).convert("RGBA")


def main() -> None:
    BUILD.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)

    # macOS: Big Sur grid — 824 px tile centred on a 1024 canvas, soft shadow.
    mac_svg = make_svg(tile_x=100, tile_size=824, radius=185, shadow=True)
    # Windows / Linux / web: the tile fills the canvas so it doesn't look small.
    full_svg = make_svg(tile_x=24, tile_size=976, radius=200, shadow=False)

    (BUILD / "icon.svg").write_text(mac_svg)
    (PUBLIC / "favicon.svg").write_text(full_svg)

    with tempfile.TemporaryDirectory() as tmp:
        mac = rasterise(mac_svg, Path(tmp) / "mac.png")
        full = rasterise(full_svg, Path(tmp) / "full.png")

    full.save(BUILD / "icon.png")
    full.save(
        BUILD / "icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    mac.save(BUILD / "icon.icns")
    for name in ("icon.svg", "icon.icns", "icon.ico", "icon.png"):
        print("wrote", (BUILD / name).relative_to(ROOT))
    print("wrote", (PUBLIC / "favicon.svg").relative_to(ROOT))


if __name__ == "__main__":
    main()
