# Writes media/icons.woff, the icon font of the status bar (it takes icons only from fonts):
#   accounts  U+E001  $(dotagents-accounts)  the face with the presence dot cut into its corner,
#                     in line, as media/accounts.svg
#   claude    U+E002  $(dotagents-claude)    the Claude mark
#   openai    U+E003  $(dotagents-openai)    the OpenAI mark
# The two marks are LobeHub's (MIT), read from the paths in webview/accounts/panel.js, so the panel
# and the status bar draw the same shape.
#   uv run --with fonttools --with skia-pathops python scripts/vscode-icon.py
import pathlib
import re
import pathops
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.svgLib.path import parse_path

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


# In the 24-unit box of media/accounts.svg, y down.
ring = op(rrect(1.7, 1.7, 22.3, 22.3, 6.8), rrect(3.3, 3.3, 20.7, 20.7, 5.2), pathops.PathOp.DIFFERENCE)
ring = op(ring, circle(19, 19, 5), pathops.PathOp.DIFFERENCE)
shape = ring
for c in (circle(8.6, 11, 2.1), circle(15.4, 11, 2.1), circle(19, 19, 2.6)):
    shape = op(shape, c, pathops.PathOp.UNION)

ROOT = pathlib.Path(__file__).resolve().parent.parent


def mark(name):
    # A filled path of the 24-unit box, drawn with the even-odd rule: simplify turns it into
    # contours the font's non-zero rule fills the same way.
    d = re.search(rf'const {name} = "([^"]+)"', (ROOT / "webview" / "accounts" / "panel.js").read_text()).group(1)
    path = pathops.Path()
    parse_path(d, path.getPen())
    path.fillType = pathops.FillType.EVEN_ODD
    path.simplify(fix_winding=True)
    return path


UPM = 1000
S = UPM / 24


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


def glyph(shape):
    pen = T2CharStringPen(UPM, None)
    shape.draw(Flip(pen))
    return pen.getCharString()


names = [".notdef", "accounts", "claude", "openai"]
charstrings = {".notdef": T2CharStringPen(UPM, None).getCharString(), "accounts": glyph(shape), "claude": glyph(mark("CLAUDE")), "openai": glyph(mark("OPENAI"))}

fb = FontBuilder(UPM, isTTF=False)
fb.setupGlyphOrder(names)
fb.setupCharacterMap({0xE001: "accounts", 0xE002: "claude", 0xE003: "openai"})
fb.setupCFF("dotagentsicons", {"FullName": "dotagents icons"}, charstrings, {})
fb.setupHorizontalMetrics({n: (UPM, 0) for n in names})
fb.setupHorizontalHeader(ascent=875, descent=-125)
fb.setupNameTable({"familyName": "dotagents icons", "styleName": "Regular"})
fb.setupOS2(sTypoAscender=875, sTypoDescender=-125, usWinAscent=875, usWinDescent=125)
fb.setupPost()
fb.font.flavor = "woff"
out = ROOT / "media" / "icons.woff"
fb.save(str(out))
print(out, out.stat().st_size, "bytes")
