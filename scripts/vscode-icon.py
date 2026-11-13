# Writes surfaces/vscode/media/icons.woff: the accounts mark (the face with the presence dot cut
# into its corner), in line, as one glyph of an icon font, so the status bar can show it as
# $(dotagents-accounts). The status bar takes icons only from fonts. Same shape as media/icon.svg.
#   uv run --with fonttools --with skia-pathops python scripts/vscode-icon.py
import pathlib
import pathops
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.t2CharStringPen import T2CharStringPen

K = 0.5523  # a quarter circle as a cubic


def rrect(x0, y0, x1, y1, r):
    p = pathops.Path()
    p.moveTo(x0 + r, y0)
    p.lineTo(x1 - r, y0)
    p.cubicTo(x1 - r + r * K, y0, x1, y0 + r - r * K, x1, y0 + r)
    p.lineTo(x1, y1 - r)
    p.cubicTo(x1, y1 - r + r * K, x1 - r + r * K, y1, x1 - r, y1)
    p.lineTo(x0 + r, y1)
    p.cubicTo(x0 + r - r * K, y1, x0, y1 - r + r * K, x0, y1 - r)
    p.lineTo(x0, y0 + r)
    p.cubicTo(x0, y0 + r - r * K, x0 + r - r * K, y0, x0 + r, y0)
    p.close()
    return p


def circle(cx, cy, r):
    return rrect(cx - r, cy - r, cx + r, cy + r, r)


def op(a, b, kind):
    return pathops.op(a, b, kind)


# In the 24-unit box of media/icon.svg, y down.
ring = op(rrect(1.7, 1.7, 22.3, 22.3, 6.8), rrect(3.3, 3.3, 20.7, 20.7, 5.2), pathops.PathOp.DIFFERENCE)
ring = op(ring, circle(19, 19, 5), pathops.PathOp.DIFFERENCE)
shape = ring
for c in (circle(8.6, 11, 2.1), circle(15.4, 11, 2.1), circle(19, 19, 2.6)):
    shape = op(shape, c, pathops.PathOp.UNION)

UPM = 1000
S = UPM / 24
pen = T2CharStringPen(UPM, None)


class Flip:
    # Font units: y up, the box from the baseline to the em's top.
    def __init__(self, out):
        self.out = out

    def moveTo(self, p):
        self.out.moveTo(self.t(p))

    def lineTo(self, p):
        self.out.lineTo(self.t(p))

    def curveTo(self, *ps):
        self.out.curveTo(*[self.t(p) for p in ps])

    def qCurveTo(self, *ps):
        self.out.qCurveTo(*[self.t(p) for p in ps])

    def closePath(self):
        self.out.closePath()

    def endPath(self):
        self.out.endPath()

    def t(self, p):
        return (round(p[0] * S), round((24 - p[1]) * S - 125))


shape.draw(Flip(pen))

fb = FontBuilder(UPM, isTTF=False)
fb.setupGlyphOrder([".notdef", "accounts"])
fb.setupCharacterMap({0xE001: "accounts"})
empty = T2CharStringPen(UPM, None)
fb.setupCFF("dotagentsicons", {"FullName": "dotagents icons"}, {".notdef": empty.getCharString(), "accounts": pen.getCharString()}, {})
fb.setupHorizontalMetrics({".notdef": (UPM, 0), "accounts": (UPM, 0)})
fb.setupHorizontalHeader(ascent=875, descent=-125)
fb.setupNameTable({"familyName": "dotagents icons", "styleName": "Regular"})
fb.setupOS2(sTypoAscender=875, sTypoDescender=-125, usWinAscent=875, usWinDescent=125)
fb.setupPost()
fb.font.flavor = "woff"
out = pathlib.Path(__file__).resolve().parent.parent / "surfaces" / "vscode" / "media" / "icons.woff"
fb.save(str(out))
print(out, out.stat().st_size, "bytes")
