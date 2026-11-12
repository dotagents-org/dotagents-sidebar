# Writes the dotagents-sidebar lockup (the stacked faces + "dotagents-sidebar" in Geist Mono 600,
# the text as outlines, since GitHub shows SVGs through <img>, which loads no web fonts) for
# light and dark backgrounds. The same recipe as dotagents' scripts/lockup.py, with this mark.
#
#   curl -sA "Mozilla/4.0" "https://fonts.googleapis.com/css2?family=Geist+Mono:wght@600" | grep -o 'https://[^)]*' | head -1 | xargs curl -so /tmp/geistmono600.ttf
#   uvx --from fonttools python -I scripts/lockup.py /tmp/geistmono600.ttf assets
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

NAME = "dotagents-sidebar"
font_path, out_dir = sys.argv[1], sys.argv[2]
font = TTFont(font_path)
gs = font.getGlyphSet()
cmap = font.getBestCmap()
upm = font["head"].unitsPerEm
xh = font["OS/2"].sxHeight

SIZE = 64.0                 # font size, px
scale = SIZE / upm
TRACK = -0.02 * SIZE
SYM = 72.0                  # symbol size
GAP = 20.0
H = SYM
s = SYM / 100

paths = []
x = SYM + GAP
# The x-height sits centered on the front face's eyes (cy = 0.57 of the symbol)
baseline = SYM * 0.57 + (xh * scale) / 2
for ch in NAME:
    pen = SVGPathPen(gs)
    gs[cmap[ord(ch)]].draw(TransformPen(pen, (scale, 0, 0, -scale, x, baseline)))
    paths.append(pen.getCommands())
    x += gs[cmap[ord(ch)]].width * scale + TRACK
W = x - TRACK

def svg(text_color, behind):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.1f} {H:.1f}" width="{W:.0f}" height="{H:.0f}" role="img" aria-label="{NAME}">
  <rect x="{20*s:.2f}" y="{4*s:.2f}" width="{76*s:.2f}" height="{76*s:.2f}" rx="{22*s:.2f}" fill="{behind}"/>
  <rect x="{4*s:.2f}" y="{20*s:.2f}" width="{76*s:.2f}" height="{76*s:.2f}" rx="{22*s:.2f}" fill="#171717"/>
  <circle cx="{29*s:.2f}" cy="{57*s:.2f}" r="{7.5*s:.2f}" fill="#ededed"/>
  <circle cx="{55*s:.2f}" cy="{57*s:.2f}" r="{7.5*s:.2f}" fill="#ededed"/>
  <path fill="{text_color}" d="{" ".join(paths)}"/>
</svg>
'''

open(f"{out_dir}/{NAME}-lockup-light.svg", "w").write(svg("#171717", "#8f8f8f"))
open(f"{out_dir}/{NAME}-lockup-dark.svg", "w").write(svg("#ededed", "#6b6b6b"))
print("width", round(W), "height", H)
