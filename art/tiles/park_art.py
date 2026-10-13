"""
Construction stages and re:Play Park (the AWS theme park), plus pocket-park pieces for the districts.

Construction: crane1x1 (a tower crane whose jib overhangs its neighbours) and scaffold1x1.
re:Play Park: park:arch (2×1), park:booth, park:fenceX/Y, and six rides on 2×2 footprints, each themed on a
service by shape and colour only (no logos): park:coaster (Lambda: λ cars), park:flume0..2 (S3: bucket boats),
park:carousel0..2 (Route 53: purple canopy), park:wheel0..2 (EventBridge: magenta wheel, the showpiece),
park:teacups0..2 (SQS: cups queued round a teapot) and park:droptower (CloudFront: a mast with a globe on top).
Every ride also has park:<ride>:locked: the ride's own silhouette under a tarp behind hoarding, unlit.
Pocket parks: park:gazebo, park:amphitheatre (2×2 band shell) and park:playground.

Animated sets share one canvas size and anchor per set, like windTurbine0..2.
Called from generate_tiles.main as park_art.build(add).
"""
import math

from PIL import Image, ImageChops, ImageDraw, ImageFilter

from generate_tiles import (A, CLEAR, CON_D, CON_L, CON_M, GLASS, GLASS_D, GRASS, GRASS_D, HH, HW, NAVY, NAVY_D,  # noqa: F401
                            ORANGE, ORANGE_D, WATER, WHITE, WOOD, WOOD_D, Canvas, seeded, shade)
from landmarks_aws_a import bucket, cyl
from landmarks_aws_b import globe

LIT = (255, 214, 120)
BULB = (255, 236, 150)
RED = (226, 64, 56)
YELLOW = (255, 196, 40)
PINK = (231, 21, 123)       # AWS integration (EventBridge, SQS)
PURPLE = (140, 79, 255)     # AWS networking (Route 53, CloudFront)
LEAF = (122, 161, 22)       # AWS storage (S3)
COMPUTE = (237, 113, 0)     # AWS compute (Lambda)
TEAL = (20, 170, 160)
SKY = (59, 130, 246)
CREAM = (246, 236, 210)
SAND = (230, 212, 164)
TARP = (64, 112, 168)
CANDY = [PINK, ORANGE, PURPLE, TEAL, SKY, YELLOW]

# 3×5 pixel glyphs for the arch's sign.
FONT = {
    "R": ["XX.", "X.X", "XX.", "X.X", "X.X"], "E": ["XXX", "X..", "XX.", "X..", "XXX"],
    ":": ["...", ".X.", "...", ".X.", "..."], "P": ["XX.", "X.X", "XX.", "X..", "X.."],
    "L": ["X..", "X..", "X..", "X..", "XXX"], "A": [".X.", "X.X", "XXX", "X.X", "X.X"],
    "Y": ["X.X", "X.X", ".X.", ".X.", ".X."],
}
LAMBDA = ["X..", ".X.", ".X.", "X.X", "X.X"]


# ── helpers ───────────────────────────────────────────────────────────────────

def px(c, x, y, col, lit=False):
    c.d.point([(x, y)], fill=A(col))
    if lit:
        c.ld.point([(x, y)], fill=A(col))


def bulb(c, x, y, col=BULB, glow=True):
    """A festoon bulb: one bright pixel by day, a small cross of light at night."""
    c.d.point([(x, y)], fill=A(col))
    c.ld.point([(x, y)], fill=A(col))
    if glow:
        c.ld.point([(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)], fill=A(col, 150))


def glyph(c, g, x, y, col, lit=False, shear=0):
    """A pixel glyph at screen (x, y) = top-left; shear 1/-1 slopes it along a left/right face."""
    for r, row in enumerate(g):
        for k, ch in enumerate(row):
            if ch == "X":
                px(c, x + k, y + r + (k // 2) * shear, col, lit)


def text_l(c, s, x, y, col, lit=False):
    """Pixel text along a left (v = const) face: each glyph steps 4 px right and 2 px down."""
    for i, ch in enumerate(s):
        glyph(c, FONT[ch], x + i * 4, y + i * 2, col, lit)


def ell(c, x, y, rx, ry, fill, d=None, outline=None):
    (d or c.d).ellipse((x - rx, y - ry, x + rx, y + ry), fill=A(fill) if fill else None, outline=A(outline) if outline else None)


def disc(c, x, y, rx, ry, h, col, top=None):
    """A round platform in screen space: (x, y) is the centre of its base, h its height in px."""
    ell(c, x, y, rx, ry, shade(col, 0.7))
    c.d.rectangle((x - rx, y - h, x + rx, y), fill=A(shade(col, 0.7)))
    c.d.rectangle((x - rx, y - h, x - rx // 3, y), fill=A(shade(col, 0.85)))
    ell(c, x, y - h, rx, ry, top or col)
    return y - h


def path_points(nodes, step=1.0):
    """Resample a 3-D polyline [(u, v, z), ...] at roughly `step` screen px; returns [(u, v, z), ...]."""
    out = []
    for (u0, v0, z0), (u1, v1, z1) in zip(nodes, nodes[1:]):
        dx, dy = (u1 - v1 - u0 + v0) * HW, (u1 + v1 - u0 - v0) * HH - (z1 - z0)
        n = max(1, round(math.hypot(dx, dy) / step))
        for k in range(n):
            t = k / n
            out.append((u0 + (u1 - u0) * t, v0 + (v1 - v0) * t, z0 + (z1 - z0) * t))
    out.append(nodes[-1])
    return out


def post(c, u, v, z0, z1, col, w=0.03):
    c.box(u - w, v - w, u + w, v + w, z0, z1, col)


def hoarding_edge(c, fw, fh, h=11):
    """Locked rides: friendly white hoarding with an orange chevron band along the two front edges."""
    for k in range(int(fw * 3)):
        a, b = k / 3 + 0.02, (k + 1) / 3 - 0.02
        c.box(a, fh - 0.08, b, fh - 0.02, 0, h, WHITE)
    for k in range(int(fh * 3)):
        a, b = k / 3 + 0.02, (k + 1) / 3 - 0.02
        c.box(fw - 0.08, a, fw - 0.02, b, 0, h, WHITE)
    c.lface(fh - 0.02, 0.02, fw - 0.02, 4, 6, ORANGE)
    c.rface(fw - 0.02, 0.02, fh - 0.02, 4, 6, shade(ORANGE, 0.85))
    c.lface(fh - 0.02, 0.02, fw - 0.02, h - 1, h, ORANGE_D)
    c.rface(fw - 0.02, 0.02, fh - 0.02, h - 1, h, ORANGE_D)
    for t in range(int(fw) + 1):
        post(c, min(t, fw - 0.05), fh - 0.05, 0, h + 2, WOOD)
    for t in range(int(fh)):
        post(c, fw - 0.05, t + 0.05, 0, h + 2, WOOD)


def locked(ride, fw, fh, zmax, pad=2, close=5):
    """The ride's silhouette draped in a blue tarp (gaps closed, folds kept from the ride's own shading, rope
    lashings), standing behind hoarding. No lights."""
    src = ride.img
    a = src.getchannel("A").point(lambda v: 255 if v else 0)
    m = close
    big = Image.new("L", (a.width + 2 * m, a.height + 2 * m), 0)
    big.paste(a, (m, m))  # pad so the closing never sticks to the canvas edge
    big = big.filter(ImageFilter.MaxFilter(close)).filter(ImageFilter.MinFilter(close))
    closed = big.crop((m, m, m + a.width, m + a.height))
    lum = src.convert("L")
    c = Canvas(fw, fh, zmax, pad)
    tarp = Image.new("RGBA", src.size, CLEAR)
    tp = tarp.load()
    lp, ap, cp = lum.load(), a.load(), closed.load()
    w, h = src.size
    for y in range(h):
        for x in range(w):
            if not cp[x, y]:
                continue
            level = lp[x, y] if ap[x, y] else 120
            f = 0.72 if level < 90 else (0.9 if level < 170 else 1.08)
            tp[x, y] = A(shade(TARP, f))
    # ropes: diagonal lashings every 9 px, only on the tarp
    rope = Image.new("L", src.size, 0)
    rd = ImageDraw.Draw(rope)
    for k in range(-h, w + h, 9):
        rd.line([(k, 0), (k + h // 2, h)], fill=255)
    rope = ImageChops.multiply(rope, closed.filter(ImageFilter.MinFilter(3)))
    tarp.paste(Image.new("RGBA", src.size, A(shade(TARP, 0.55))), (0, 0), rope)
    # the tarp's bottom hem, weighted with sandbags
    c.img.alpha_composite(tarp)
    hoarding_edge(c, fw, fh)
    return c


# ── construction ──────────────────────────────────────────────────────────────

def lattice_mast(c, u, v, z0, z1, col, r=0.09):
    """A square lattice mast: dark core, bright chords on the edges, zigzag bracing on both faces."""
    c.box(u - r, v - r, u + r, v + r, z0, z1, shade(col, 0.42), left=shade(col, 0.42), right=shade(col, 0.32))
    xl, _ = c.P(u - r, v + r, 0)
    xm, _ = c.P(u + r, v + r, 0)
    xr, _ = c.P(u + r, v - r, 0)
    _, yb = c.P(u + r, v + r, z0)
    _, yt = c.P(u + r, v + r, z1)
    dark = shade(col, 0.78)
    for x in (xl, xm, xr):
        c.d.line([(x, yb), (x, yt)], fill=A(col if x != xr else dark))
    step = 5
    for k, y in enumerate(range(yb, yt, -step)):
        y1 = max(yt, y - step)
        # left face (from xl to xm, sloping down 1 per 2)
        if k % 2 == 0:
            c.d.line([(xl, y - (0)), (xm, y1 + (xm - xl) // 2)], fill=A(col))
            c.d.line([(xm, y), (xr, y1 - (xr - xm) // 2)], fill=A(dark))
        else:
            c.d.line([(xm, y + (xm - xl) // 2 - (xm - xl) // 2), (xl, y1)], fill=A(col))
            c.d.line([(xr, y - (xr - xm) // 2), (xm, y1)], fill=A(dark))


def truss(c, a, b, col, depth=3):
    """A horizontal screen-space truss from a to b (x, y): top and bottom chords with a zigzag."""
    (x0, y0), (x1, y1) = a, b
    c.d.line([(x0, y0), (x1, y1)], fill=A(col))
    c.d.line([(x0, y0 + depth), (x1, y1 + depth)], fill=A(shade(col, 0.75)))
    n = max(1, abs(x1 - x0) // 3)
    for k in range(n):
        xa = x0 + (x1 - x0) * k // n
        xb = x0 + (x1 - x0) * (k + 1) // n
        ya = y0 + (y1 - y0) * k // n
        yb = y0 + (y1 - y0) * (k + 1) // n
        if k % 2 == 0:
            c.d.line([(xa, ya), (xb, yb + depth)], fill=A(shade(col, 0.85)))
        else:
            c.d.line([(xa, ya + depth), (xb, yb)], fill=A(shade(col, 0.85)))


def crane():
    """A tower crane: concrete footing, yellow lattice mast, an orange cab, a long jib that overhangs the
    neighbouring tiles, a counter-jib with concrete counterweights, a trolley and hook carrying a steel beam,
    pendant ties to the tower head and red aircraft beacons at night."""
    c = Canvas(1, 1, 100, pad=20)
    c.box(0.22, 0.22, 0.78, 0.78, 0, 4, CON_M, top=CON_L)
    for (u, v) in ((0.3, 0.3), (0.7, 0.3), (0.3, 0.7), (0.7, 0.7)):
        c.box(u - 0.05, v - 0.05, u + 0.05, v + 0.05, 4, 6, CON_D)
    lattice_mast(c, 0.5, 0.5, 4, 74, YELLOW)
    # slewing ring + cab
    c.box(0.36, 0.36, 0.64, 0.64, 74, 77, NAVY)
    c.box(0.44, 0.52, 0.7, 0.74, 70, 80, COMPUTE)
    c.lface(0.74, 0.47, 0.67, 74, 78, GLASS, light=True)
    c.rface(0.7, 0.55, 0.7, 74, 78, GLASS_D, light=True)
    hx, hy = c.P(0.5, 0.5, 80)
    # tower head (an A-frame peak)
    c.d.polygon([(hx - 3, hy), (hx + 3, hy), (hx, hy - 14)], fill=A(shade(YELLOW, 0.5)))
    c.d.line([(hx - 3, hy), (hx, hy - 14), (hx + 3, hy)], fill=A(YELLOW))
    c.d.line([(hx - 2, hy - 5), (hx + 2, hy - 5)], fill=A(YELLOW))
    peak = (hx, hy - 14)
    # jib (right, long) and counter-jib (left, short), screen-horizontal like a real crane seen side-on
    jl, jr = hx - 16, hx + 32
    truss(c, (hx, hy - 1), (jr, hy - 1), YELLOW, depth=3)
    c.d.line([(jr, hy - 1), (jr, hy + 2)], fill=A(YELLOW))
    truss(c, (jl, hy), (hx, hy), YELLOW, depth=2)
    # pendant ties
    c.d.line([peak, (jr - 6, hy - 1)], fill=A(CON_D))
    c.d.line([peak, (jl + 1, hy)], fill=A(CON_D))
    # counterweights
    c.d.rectangle((jl, hy + 3, jl + 7, hy + 9), fill=A(CON_M))
    c.d.rectangle((jl, hy + 3, jl + 2, hy + 9), fill=A(CON_L))
    c.d.line([(jl, hy + 6), (jl + 7, hy + 6)], fill=A(CON_D))
    # trolley, cable, hook block and a steel beam on the hook
    tx = hx + 24
    c.d.rectangle((tx - 2, hy + 2, tx + 2, hy + 4), fill=A(NAVY))
    cy = hy + 30
    c.d.line([(tx - 1, hy + 4), (tx - 1, cy)], fill=A(CON_D))
    c.d.line([(tx + 1, hy + 4), (tx + 1, cy)], fill=A(CON_D))
    c.d.rectangle((tx - 2, cy, tx + 2, cy + 3), fill=A(YELLOW))
    c.d.point([(tx, cy + 4), (tx + 1, cy + 5)], fill=A(NAVY_D))
    c.d.line([(tx, cy + 5), (tx - 7, cy + 9)], fill=A(CON_D))
    c.d.line([(tx, cy + 5), (tx + 7, cy + 9)], fill=A(CON_D))
    c.d.polygon([(tx - 10, cy + 9), (tx + 10, cy + 9), (tx + 10, cy + 12), (tx - 10, cy + 12)], fill=A(COMPUTE))
    c.d.line([(tx - 10, cy + 9), (tx + 10, cy + 9)], fill=A(shade(COMPUTE, 1.2)))
    c.d.line([(tx - 10, cy + 12), (tx + 10, cy + 12)], fill=A(ORANGE_D))
    # beacons
    for (x, y) in (peak, (jr, hy - 2), (jl, hy - 1)):
        c.d.point([(x, y - 1)], fill=A(RED))
        c.ld.rectangle((x - 1, y - 2, x + 1, y), fill=A(RED))
    return c


def scaffold():
    """Scaffolding round a rising concrete core: steel tubes, timber planks on three lifts, cross-bracing,
    a ladder, rebar on top and a green safety net hung on the right face's lower lifts."""
    c = Canvas(1, 1, 56)
    c.box(0.06, 0.06, 0.94, 0.94, 0, 1, CON_M, top=(170, 160, 146))
    c.box(0.2, 0.2, 0.74, 0.74, 1, 34, CON_L)
    for z in (11, 22, 33):
        c.lface(0.74, 0.2, 0.74, z, z + 1, shade(CON_L, 0.8))
        c.rface(0.74, 0.2, 0.74, z, z + 1, shade(CON_L, 0.62))
    c.lface(0.74, 0.3, 0.46, 3, 9, NAVY_D)
    c.lface(0.74, 0.3, 0.46, 14, 19, GLASS_D)
    c.rface(0.74, 0.3, 0.46, 14, 19, shade(GLASS_D, 0.8))
    for k in range(4):  # rebar
        x, y = c.P(0.26 + k * 0.14, 0.24, 34)
        c.d.line([(x, y), (x, y - 5)], fill=A((150, 90, 60)))
    steel = (176, 186, 196)
    front = [(0.06, 0.92), (0.5, 0.92), (0.92, 0.92), (0.92, 0.5), (0.92, 0.06)]
    for u, v in front:
        post(c, u, v, 1, 44, steel, w=0.025)
    for z in (12, 24, 36):  # planks + guard rails
        c.box(0.04, 0.8, 0.94, 0.94, z, z + 2, WOOD, top=shade(WOOD, 1.08))
        c.box(0.8, 0.04, 0.94, 0.8, z, z + 2, WOOD, top=shade(WOOD, 1.08))
        c.line((0.06, 0.94, z + 7), (0.94, 0.94, z + 7), steel)
        c.line((0.94, 0.94, z + 7), (0.94, 0.06, z + 7), steel)
        c.lface(0.94, 0.06, 0.94, z, z + 1, WOOD_D)
    # cross-bracing on the front face
    for z0, z1 in ((1, 12), (12, 24), (24, 36)):
        c.line((0.06, 0.94, z0), (0.5, 0.94, z1), shade(steel, 0.8))
        c.line((0.5, 0.94, z1), (0.92, 0.94, z0), shade(steel, 0.8))
    # ladder
    for t in (0.3, 0.4):
        c.line((t, 0.95, 1), (t, 0.95, 36), WOOD_D)
    for z in range(4, 36, 3):
        c.line((0.3, 0.95, z), (0.4, 0.95, z), WOOD)
    # safety net on the right face's lower lifts (semi-transparent green with a mesh)
    net = (40, 150, 70)
    c.rface(0.95, 0.06, 0.9, 2, 24, net)
    for z in range(4, 24, 3):
        c.line((0.95, 0.9, z), (0.95, 0.06, z), shade(net, 0.75))
    for k in range(6):
        v = 0.12 + k * 0.14
        c.line((0.95, v, 2), (0.95, v, 24), shade(net, 0.75))
    c.line((0.95, 0.9, 24), (0.95, 0.06, 24), shade(net, 1.3))
    # a warning lamp on top
    x, y = c.P(0.92, 0.92, 44)
    c.d.point([(x, y - 1)], fill=A(ORANGE))
    c.ld.rectangle((x - 1, y - 2, x + 1, y), fill=A(ORANGE))
    return c


# ── re:Play Park: entrance ────────────────────────────────────────────────────

def candy_post(c, u, v, z0, z1, cols, r=0.1):
    c.box(u - r, v - r, u + r, v + r, z0, z1, WHITE)
    for k, z in enumerate(range(z0 + 2, z1 - 2, 6)):
        col = cols[k % len(cols)]
        c.lface(v + r, u - r, u + r, z, z + 3, col)
        c.rface(u + r, v - r, v + r, z, z + 3, shade(col, 0.8))


def arch():
    """The park gate (2×1, the path runs through along v): candy-striped pillars topped with balls, a navy
    banner arched over the path with "RE:PLAY" in lit pixel letters, a bulb border and pennants."""
    c = Canvas(2, 1, 64)
    c.box(0.0, 0.25, 2.0, 0.75, 0, 1, CON_L, top=(226, 220, 206))
    for u in (0.2, 1.8):
        c.box(u - 0.16, 0.34, u + 0.16, 0.66, 0, 3, CON_M)
        candy_post(c, u, 0.5, 3, 40, [PINK, ORANGE, PURPLE], r=0.11)
        x, y = c.P(u, 0.5, 40)
        ell(c, x, y - 3, 3, 3, YELLOW)
        px(c, x - 1, y - 4, (255, 240, 180))
        bulb(c, x, y - 7, BULB)
    # the banner: a board on the v = 0.5 plane, with an arched top
    u0, u1 = 0.05, 1.95
    zb, zt = 30, 42
    c.box(u0, 0.44, u1, 0.56, zb, zt, NAVY)
    xa, ya = c.P(u0, 0.56, zt)
    xb, yb = c.P(u1, 0.56, zt)
    # the arch crown above the board (a half-ellipse sheared along the face)
    w = xb - xa
    for i in range(w + 1):
        t = i / w
        bump = round(7 * math.sin(math.pi * t))
        y = ya + round((yb - ya) * t)
        c.d.line([(xa + i, y), (xa + i, y - bump)], fill=A(NAVY))
        c.d.point([(xa + i, y - bump)], fill=A(ORANGE))
        if i % 4 == 2 and 0.05 < t < 0.95:
            bulb(c, xa + i, y - bump - 1, BULB, glow=False)
    c.lface(0.56, u0, u1, zb, zb + 1, ORANGE)
    c.lface(0.56, u0, u1, zt - 1, zt, ORANGE)
    # pixel letters, centred
    tx, ty = c.P(0.12 + 0.07, 0.56, zt - 3)
    text_l(c, "RE:PLAY", tx + 1, ty, WHITE, lit=True)
    # bulbs on the board's bottom edge
    for k in range(9):
        u = 0.15 + k * 0.21
        x, y = c.P(u, 0.56, zb)
        bulb(c, x, y + 1, (255, 200, 120), glow=False)
    # pennant strings from each pillar to the ground beside it
    for u, du in ((0.2, -0.18), (1.8, 0.18)):
        for k in range(4):
            x, y = c.P(u + du * (k + 1) / 4, 0.5, 38 - k * 8)
            c.d.polygon([(x - 1, y), (x + 1, y), (x, y + 3)], fill=A(CANDY[k]))
    return c


def booth():
    """Ticket booth: a little candy-coloured kiosk with a lit window, a striped awning and a pennant on top."""
    c = Canvas(1, 1, 50)
    c.box(0.15, 0.15, 0.85, 0.85, 0, 2, CON_M, top=CON_L)
    c.box(0.25, 0.25, 0.75, 0.75, 2, 22, CREAM)
    c.lface(0.75, 0.25, 0.75, 2, 5, PINK)
    c.rface(0.75, 0.25, 0.75, 2, 5, shade(PINK, 0.8))
    c.lface(0.75, 0.34, 0.66, 9, 17, GLASS, light=True)
    c.lface(0.75, 0.34, 0.66, 9, 10, WHITE)
    c.box(0.3, 0.75, 0.7, 0.85, 8, 9, WOOD)  # the counter
    c.rface(0.75, 0.38, 0.62, 9, 17, GLASS_D, light=True)
    # striped awning, sloping out over the counter
    for k in range(5):
        a, b = 0.2 + k * 0.12, 0.32 + k * 0.12
        col = PINK if k % 2 == 0 else WHITE
        c.poly([(a, 0.75, 22), (b, 0.75, 22), (b, 0.9, 18), (a, 0.9, 18)], col)
        c.poly([(0.75, a, 22), (0.75, b, 22), (0.9, b, 18), (0.9, a, 18)], shade(col, 0.82))
    c.box(0.22, 0.22, 0.78, 0.78, 22, 25, PURPLE)
    c.pyramid(0.22, 0.22, 0.78, 0.78, 25, 10, PINK)
    x, y = c.P(0.5, 0.5, 35)
    c.d.line([(x, y), (x, y - 9)], fill=A(CON_L))
    c.d.polygon([(x + 1, y - 9), (x + 6, y - 7), (x + 1, y - 5)], fill=A(ORANGE))
    bulb(c, x, y - 10, BULB)
    return c


def fence(along_u):
    """Festive park fence: white posts with coloured ball finials, two rails and bunting on a string."""
    c = Canvas(1, 1, 16)
    pt = (lambda t: (t, 0.5)) if along_u else (lambda t: (0.5, t))
    rail = (236, 238, 242)
    for t in (0.04, 0.5):
        u, v = pt(t)
        post(c, u, v, 0, 9, rail, w=0.035)
    for t, col in ((0.04, PINK), (0.5, SKY)):
        x, y = c.P(*pt(t), 10)
        c.d.rectangle((x - 1, y - 1, x + 1, y + 1), fill=A(col))
        c.ld.point([(x, y)], fill=A(LIT))
    for z in (3, 7):
        a, b = (*pt(0), z), (*pt(1), z)
        c.line(a, b, rail)
    for k in range(4):  # bunting below the top rail
        t = 0.08 + k * 0.24
        x, y = c.P(*pt(t), 7)
        c.d.polygon([(x - 1, y + 1), (x + 2, y + 1), (x, y + 3)], fill=A(CANDY[k]))
    return c


# ── rides ─────────────────────────────────────────────────────────────────────

def track(c, pts, col, lights_every=7, ties=True):
    """A coaster rail along screen points: a dark 3-px ribbon with a bright top rail, ties and bulbs."""
    sp = [c.P(*p) for p in pts]
    for i in range(len(sp) - 1):
        (x0, y0), (x1, y1) = sp[i], sp[i + 1]
        c.d.line([(x0, y0 + 1), (x1, y1 + 1)], fill=A(shade(col, 0.6)), width=2)
        c.d.line([(x0, y0), (x1, y1)], fill=A(col))
        c.d.line([(x0, y0 - 1), (x1, y1 - 1)], fill=A(shade(col, 1.15)))
        if ties and i % 4 == 0:
            c.d.point([(x0, y0 + 2)], fill=A(NAVY_D))
        if lights_every and i % lights_every == 3:
            c.ld.point([(x0, y0 - 1)], fill=A(BULB))


def supports(c, pts, every=6, col=CON_M, min_z=6):
    for i, (u, v, z) in enumerate(pts):
        if i % every == 0 and z > min_z:
            x, y = c.P(u, v, z)
            _, yg = c.P(u, v, 0)
            c.d.line([(x, y + 2), (x, yg)], fill=A(col))
            c.d.point([(x, yg)], fill=A(shade(col, 0.7)))


def coaster():
    """Lambda Coaster: an orange steel coaster on a plaza: a chain lift up the left, a drop along the back, a
    vertical loop on the right and a station at the front where three λ-marked cars wait. Bulbs along the
    track at night."""
    c = Canvas(2, 2, 72)
    c.box(0.04, 0.04, 1.96, 1.96, 0, 1, CON_L, top=(226, 220, 206))
    for k in range(1, 4):
        c.line((0.04, k * 0.5, 1), (1.96, k * 0.5, 1), shade((226, 220, 206), 0.92))
    lift = [(0.3, 1.45, 7), (0.3, 0.3, 52)]
    crest = [(0.3, 0.3, 52), (0.45, 0.2, 55), (0.7, 0.2, 52)]
    drop = [(0.7, 0.2, 52), (1.15, 0.22, 12), (1.5, 0.3, 6), (1.65, 0.5, 6)]
    vc, zc, rz, rv = 1.0, 21, 15, 0.55
    loop = [(1.65, 0.5, 6), (1.7, vc - 0.1, 6)]
    for k in range(1, 33):
        th = k / 32 * 2 * math.pi
        loop.append((1.7 - 0.14 * k / 32, vc - 0.1 + rv * math.sin(th), zc - rz * math.cos(th)))
    home = [(1.56, 0.9, 6), (1.56, 1.45, 6), (1.4, 1.62, 6), (0.5, 1.62, 6), (0.3, 1.45, 7)]
    back = path_points(lift + crest[1:] + drop[1:], step=1.5)
    # lift-hill trestle: a ladder of posts under the chain lift, every 10 px
    for t in (0.45, 0.8):
        u, v, z = 0.3, 1.45 + (0.3 - 1.45) * t, 7 + 45 * t
        post(c, u, v, 1, z - 2, CON_M, w=0.025)
    post(c, 0.45, 0.2, 1, 52, CON_M, w=0.03)
    post(c, 1.0, 0.21, 1, 25, CON_M, w=0.025)
    track(c, back, ORANGE)
    # chain-lift dogs: dark ticks up the lift
    for (u, v, z) in path_points(lift, step=4)[1:-1]:
        x, y = c.P(u, v, z)
        c.d.point([(x, y)], fill=A(NAVY_D))
    lp = path_points(loop, step=1.0)
    half = len(lp) * 5 // 9
    track(c, lp[:half], ORANGE)          # entry and the loop's far side
    post(c, 1.66, vc - 0.1, 1, 6, CON_M, w=0.05)
    track(c, lp[half - 1:], ORANGE)      # the loop's near side and the exit
    track(c, path_points(home, step=1.5), ORANGE)
    # station: a striped canopy on the left, the platform along the front
    c.box(0.45, 1.72, 1.45, 1.92, 1, 4, CON_M, top=CON_L)
    c.box(0.05, 1.35, 0.42, 1.92, 1, 14, CREAM)
    c.lface(1.92, 0.12, 0.34, 4, 10, GLASS, light=True)
    c.rface(0.42, 1.45, 1.8, 6, 10, GLASS_D, light=True)
    for k in range(4):
        a0, a1 = 1.33 + k * 0.15, 1.48 + k * 0.15
        col = COMPUTE if k % 2 == 0 else WHITE
        c.poly([(0.0, a0, 18), (0.48, a0, 18), (0.48, a1, 18), (0.0, a1, 18)], col)
    c.lface(1.95, 0.0, 0.48, 16, 18, NAVY)
    c.rface(0.48, 1.33, 1.95, 16, 18, shade(NAVY, 0.8))
    x, y = c.P(0.24, 1.64, 18)
    bulb(c, x, y - 1)
    # three cars at the station, each with a white λ on its side
    for k in range(3):
        u = 0.62 + k * 0.27
        c.box(u, 1.52, u + 0.24, 1.72, 6, 12, COMPUTE)
        c.lface(1.72, u, u + 0.24, 11, 12, shade(COMPUTE, 1.2))
        x, y = c.P(u + 0.06, 1.72, 11)
        glyph(c, LAMBDA, x, y + 1, WHITE)
        hx, hy = c.P(u + 0.12, 1.62, 14)
        c.d.rectangle((hx - 1, hy - 1, hx, hy), fill=A((232, 190, 150)))
    for k in range(5):
        x, y = c.P(0.5 + k * 0.22, 1.92, 4)
        bulb(c, x, y, BULB, glow=False)
    return c


def flume_path():
    top = [(0.75, 0.35, 40), (1.6, 0.35, 38), (1.65, 0.75, 36)]
    drop = [(1.65, 0.75, 36), (1.1, 1.05, 22), (0.75, 1.25, 3)]
    out = [(0.75, 1.25, 3), (0.75, 1.62, 2), (1.3, 1.65, 2), (1.95, 1.65, 2)]
    return top, drop, out


def channel(c, pts, wall=WOOD, water=WATER):
    sp = [c.P(*p) for p in pts]
    for i in range(len(sp) - 1):
        (x0, y0), (x1, y1) = sp[i], sp[i + 1]
        c.d.line([(x0, y0 + 1), (x1, y1 + 1)], fill=A(shade(wall, 0.7)), width=5)
        c.d.line([(x0, y0 - 1), (x1, y1 - 1)], fill=A(water), width=2)
        c.d.line([(x0, y0 + 2), (x1, y1 + 2)], fill=A(wall))
    for i in range(0, len(sp) - 1, 7):
        x, y = sp[i]
        c.d.point([(x + 1, y - 1)], fill=A(shade(water, 1.35)))


def flume(f):
    """S3 Log Flume: a green timber tower at the back, a water channel along its top, a steep chute into a splash
    pool and an exit channel; bucket-shaped boats ride it (frames move them on) and the splash rises and falls."""
    c = Canvas(2, 2, 72)
    c.box(0.04, 0.04, 1.96, 1.96, 0, 1, CON_L, top=(212, 206, 192))
    top, drop, out = flume_path()
    # the tower: green timber frame with a stair, under the channel's start
    c.box(0.25, 0.2, 0.75, 0.6, 1, 38, shade(LEAF, 0.7))
    for z in range(6, 38, 8):
        c.lface(0.6, 0.25, 0.75, z, z + 2, LEAF)
        c.rface(0.75, 0.2, 0.6, z, z + 2, shade(LEAF, 0.8))
    for k in range(7):
        x, y = c.P(0.3 + k * 0.06, 0.6, 4 + k * 5)
        c.d.line([(x, y), (x + 2, y + 1)], fill=A(WOOD))
    c.box(0.2, 0.15, 0.8, 0.65, 38, 40, WOOD)
    c.pyramid(0.2, 0.15, 0.8, 0.65, 46, 8, LEAF)
    for (u, v) in ((0.22, 0.17), (0.78, 0.17), (0.22, 0.63), (0.78, 0.63)):
        post(c, u, v, 40, 46, WOOD_D, w=0.02)
    x, y = c.P(0.5, 0.4, 54)
    bulb(c, x, y, (180, 255, 140))
    # trestles under the top run and the chute
    for p in path_points(top + drop[1:], step=6):
        u, v, z = p
        if z > 6:
            post(c, u, v + 0.06, 0, z - 2, WOOD_D, w=0.025)
    channel(c, path_points(top, step=1))
    # pool (behind the chute's foot)
    c.box(0.15, 1.15, 1.45, 1.9, 0, 3, CON_M, top=CON_M)
    c.poly([(0.2, 1.2, 3), (1.4, 1.2, 3), (1.4, 1.85, 3), (0.2, 1.85, 3)], WATER)
    r = seeded("flume-pool")
    for _ in range(8):
        x, y = c.P(0.3 + r(100) / 100, 1.3 + r(50) / 100, 3)
        c.d.line([(x, y), (x + 2, y)], fill=A(shade(WATER, 1.3)))
    channel(c, path_points(drop, step=1))
    channel(c, path_points(out[1:], step=1))
    # boats: S3 buckets riding the line (three along the route, phased by frame)
    route = path_points(top + drop[1:] + out[1:], step=1)
    n = len(route)
    for k in range(3):
        i = int((k / 3 + f / 9) * n) % n
        u, v, z = route[i]
        x, y = c.P(u, v, z)
        bucket(c, u, v, z + 1, LEAF, s=0.75)
        c.d.point([(x - 1, y - 7), (x + 1, y - 7)], fill=A((232, 190, 150)))
    # the splash where the chute meets the pool
    sx, sy = c.P(0.8, 1.3, 4)
    big = [9, 6, 3][f]
    for k in range(7):
        ang = math.pi * (0.15 + 0.7 * k / 6)
        ex = sx + round(math.cos(ang) * (big + 2)) * (-1)
        ey = sy - round(math.sin(ang) * big)
        c.d.line([(sx, sy), (ex, ey)], fill=A((214, 240, 255)))
        c.d.point([(ex, ey - 1)], fill=A(WHITE))
    ell(c, sx, sy, 4 + f, 2, (214, 240, 255))
    # a lamp post by the pool, lit at night
    x, y = c.P(1.55, 1.95, 0)
    c.d.line([(x, y), (x, y - 16)], fill=A(NAVY))
    bulb(c, x, y - 17, LIT)
    return c


HORSE = [".....XX", "....XXX", "XXXXXX.", "XXXXX..", "X...X..", "X...X.."]


def horse(c, x, y, col, face_right):
    for r, row in enumerate(HORSE):
        for k, ch in enumerate(row):
            if ch == "X":
                xx = x + (k - 3 if face_right else 3 - k)
                c.d.point([(xx, y + r)], fill=A(col if r < 4 else shade(col, 0.7)))
    c.d.point([(x, y + 2)], fill=A(RED))  # the saddle


def carousel(f):
    """Route 53 Carousel: a round deck, a mirrored centre column, eight horses on gilded poles that rise and fall,
    and a purple-and-white striped canopy with a scalloped valance and a ring of bulbs (frames turn it)."""
    c = Canvas(2, 2, 66)
    cx, cy = c.P(1, 1, 0)
    c.box(0.06, 0.06, 1.94, 1.94, 0, 1, CON_L, top=(226, 220, 206))
    deck = disc(c, cx, cy, 27, 13, 4, shade(PURPLE, 0.6), top=(232, 222, 200))
    ell(c, cx, deck, 20, 9, None, outline=shade((232, 222, 200), 0.85))
    rot = f * (2 * math.pi / 8) / 3
    horses = []
    for k in range(8):
        th = rot + k * 2 * math.pi / 8
        hx, hy = cx + round(math.cos(th) * 19), deck + round(math.sin(th) * 9)
        bob = round(2 * math.sin(th * 2 + k))
        horses.append((hy, hx, th, bob, k))
    gold = (232, 186, 70)
    canopy_z = 30

    def draw_horse(hy, hx, th, bob, k):
        c.d.line([(hx, hy), (hx, hy - canopy_z + 2)], fill=A(gold))
        col = [WHITE, (210, 160, 110), (90, 70, 60), WHITE][k % 4]
        horse(c, hx, hy - 15 - bob, col, math.sin(th) > 0)

    for h in sorted(horses):
        if h[0] <= deck:
            draw_horse(*h)
    # centre column with mirror panels
    c.d.rectangle((cx - 5, deck - canopy_z, cx + 5, deck), fill=A(shade(PURPLE, 0.75)))
    for k, x in enumerate(range(cx - 4, cx + 5, 3)):
        c.d.rectangle((x, deck - canopy_z + 6, x + 1, deck - 4), fill=A(GLASS if k % 2 == 0 else GLASS_D))
        c.ld.rectangle((x, deck - canopy_z + 8, x, deck - 6), fill=A(LIT, 200))
    for h in sorted(horses):
        if h[0] > deck:
            draw_horse(*h)
    # canopy: a striped cone from the rim (y = top) up to the apex
    top = deck - canopy_z
    rx, ry, hgt = 29, 14, 14
    n = 16
    segs = []
    for k in range(n):
        a0 = rot * 2 + k * 2 * math.pi / n
        a1 = a0 + 2 * math.pi / n
        segs.append((math.sin((a0 + a1) / 2), a0, a1, k))
    for s, a0, a1, k in sorted(segs):
        p0 = (cx + math.cos(a0) * rx, top + math.sin(a0) * ry)
        p1 = (cx + math.cos(a1) * rx, top + math.sin(a1) * ry)
        mid = math.cos((a0 + a1) / 2)
        col = PURPLE if k % 2 == 0 else WHITE
        col = shade(col, 1.0 - 0.18 * max(0, mid))
        c.d.polygon([(cx, top - hgt), p0, p1], fill=A(col))
    # valance: a scalloped skirt round the front of the rim, with bulbs
    for k in range(18):
        a = k * math.pi / 17
        x, y = cx + round(math.cos(a) * rx), top + round(math.sin(a) * ry)
        col = PINK if k % 2 == 0 else (255, 200, 60)
        c.d.rectangle((x - 2, y, x + 2, y + 2), fill=A(col))
        c.d.point([(x, y + 3)], fill=A(col))
        if k % 2 == 1:
            bulb(c, x, y + 1, BULB, glow=False)
    # finial + pennant
    c.d.line([(cx, top - hgt), (cx, top - hgt - 7)], fill=A(gold))
    c.d.polygon([(cx + 1, top - hgt - 7), (cx + 6, top - hgt - 5), (cx + 1, top - hgt - 3)], fill=A(PINK))
    bulb(c, cx, top - hgt - 8, BULB)
    return c


def wheel(f):
    """EventBridge Ferris Wheel, the park's showpiece: a magenta double rim on a white A-frame, sixteen spokes,
    eight colourful gondolas that always hang level (frames turn the wheel), a boarding deck and a rim of lights
    that glows at night."""
    pad = 8
    c = Canvas(2, 2, 104, pad=pad)
    c.box(0.06, 0.06, 1.94, 1.94, 0, 1, CON_L, top=(226, 220, 206))
    c.box(0.55, 0.55, 1.45, 1.45, 1, 4, CON_M, top=CON_L)
    gx, gy = c.P(1, 1, 4)
    hub = (gx, gy - 54)
    R = 37
    hx, hy = hub
    frame_col, leg = WHITE, shade(WHITE, 0.72)
    # back legs
    for dx in (-24, 24):
        c.d.line([(hx, hy), (hx + dx + 3, gy - 6)], fill=A(leg), width=2)
    # outer and inner rims (back), spokes
    rot = f * (2 * math.pi / 8) / 3
    for k in range(16):
        a = rot + k * 2 * math.pi / 16
        c.d.line([hub, (hx + round(math.cos(a) * R), hy + round(math.sin(a) * R))], fill=A(shade(PINK, 0.9)))
    c.d.ellipse((hx - R, hy - R, hx + R, hy + R), outline=A(PINK), width=2)
    c.d.ellipse((hx - R + 5, hy - R + 5, hx + R - 5, hy + R - 5), outline=A(shade(PINK, 0.75)))
    c.ld.ellipse((hx - R, hy - R, hx + R, hy + R), outline=A((255, 120, 200)), width=1)
    for k in range(32):  # rim bulbs
        a = rot + k * 2 * math.pi / 32
        x, y = hx + round(math.cos(a) * R), hy + round(math.sin(a) * R)
        c.d.point([(x, y)], fill=A((255, 200, 230)))
        c.ld.point([(x, y)], fill=A(BULB))
    # gondolas
    for k in range(8):
        a = rot + k * 2 * math.pi / 8 + math.pi / 16
        x, y = hx + round(math.cos(a) * R), hy + round(math.sin(a) * R)
        col = CANDY[k % len(CANDY)]
        c.d.line([(x, y), (x, y + 3)], fill=A(NAVY_D))
        c.d.rectangle((x - 4, y + 3, x + 4, y + 4), fill=A(shade(col, 1.15)))   # roof
        c.d.rectangle((x - 3, y + 5, x + 3, y + 10), fill=A(col))
        c.d.rectangle((x - 2, y + 6, x + 2, y + 8), fill=A(GLASS))
        c.d.point([(x - 1, y + 7)], fill=A((232, 190, 150)))
        c.ld.rectangle((x - 2, y + 6, x + 2, y + 8), fill=A(LIT, 220))
        c.d.line([(x - 3, y + 10), (x + 3, y + 10)], fill=A(shade(col, 0.7)))
    # front legs and the hub
    for dx in (-24, 24):
        c.d.line([(hx, hy), (hx + dx, gy + 2)], fill=A(frame_col), width=3)
        c.d.line([(hx + dx // 3, hy + 16), (hx - dx // 3, hy + 16)], fill=A(frame_col)) if dx > 0 else None
    c.d.line([(hx - 16, gy - 16), (hx + 16, gy - 16)], fill=A(frame_col), width=2)
    ell(c, hx, hy, 5, 5, NAVY)
    ell(c, hx, hy, 3, 3, PINK)
    px(c, hx, hy, (255, 220, 240), lit=True)
    # boarding deck and a little ticket hut at the front
    c.box(0.85, 1.45, 1.35, 1.85, 1, 6, WOOD, top=shade(WOOD, 1.1))
    c.box(1.45, 1.45, 1.8, 1.8, 1, 14, CREAM)
    c.lface(1.8, 1.52, 1.72, 6, 11, GLASS, light=True)
    c.pyramid(1.42, 1.42, 1.83, 1.83, 14, 6, PINK)
    # a flag on top of the topmost spoke? no: a beacon on the hub's crown
    return c


def teacup(c, x, y, col, spin):
    ell(c, x, y + 1, 7, 3, shade(col, 0.6))                   # saucer
    c.d.polygon([(x - 6, y - 5), (x + 6, y - 5), (x + 4, y), (x - 4, y)], fill=A(col))
    c.d.polygon([(x - 6, y - 5), (x - 4, y - 5), (x - 2, y), (x - 4, y)], fill=A(shade(col, 1.18)))
    ell(c, x, y - 5, 6, 2, shade(col, 0.55))                  # inside
    c.d.line([(x - 6, y - 5), (x + 6, y - 5)], fill=A(WHITE))
    hxo = [7, -7, 0][spin % 3]
    if hxo:
        c.d.rectangle((x + hxo - (1 if hxo > 0 else 0), y - 4, x + hxo + (0 if hxo > 0 else 1), y - 2), fill=A(shade(col, 0.8)))
    else:
        c.d.point([(x + 1, y - 3), (x + 2, y - 3)], fill=A(WHITE))
    for dx in (-2, 2):
        c.d.rectangle((x + dx, y - 8, x + dx + 1, y - 7), fill=A((232, 190, 150)))


def teacups(f):
    """SQS Teacups: four cups queued round a spinning platform, a giant teapot in the middle and a ring of bulbs
    on the platform's rim (frames turn the platform and spin each cup)."""
    c = Canvas(2, 2, 50)
    cx, cy = c.P(1, 1, 0)
    c.box(0.06, 0.06, 1.94, 1.94, 0, 1, CON_L, top=(226, 220, 206))
    top = disc(c, cx, cy, 29, 14, 3, shade(PINK, 0.7), top=(250, 222, 236))
    for k in range(12):  # checker ring
        a0 = k * 2 * math.pi / 12 + f * 0.17
        a1 = a0 + 2 * math.pi / 12
        if k % 2 == 0:
            c.d.polygon([(cx + math.cos(a0) * 29, top + math.sin(a0) * 14), (cx + math.cos(a1) * 29, top + math.sin(a1) * 14),
                         (cx + math.cos(a1) * 22, top + math.sin(a1) * 10.5), (cx + math.cos(a0) * 22, top + math.sin(a0) * 10.5)],
                        fill=A(PINK))
    rot = f * (2 * math.pi / 4) / 3
    cups = []
    for k in range(4):
        th = rot + k * 2 * math.pi / 4 + math.pi / 4
        cups.append((top + round(math.sin(th) * 8), cx + round(math.cos(th) * 17), k))
    cols = [SKY, (255, 170, 60), TEAL, PURPLE]
    for y, x, k in sorted(cups):
        if y <= top:
            teacup(c, x, y, cols[k], f + k)
    # teapot: body, lid, spout and handle
    c.d.ellipse((cx - 8, top - 14, cx + 8, top + 1), fill=A(WHITE))
    c.d.ellipse((cx - 8, top - 14, cx - 2, top), fill=A((255, 255, 255)))
    c.d.chord((cx - 8, top - 14, cx + 8, top + 1), 20, 160, fill=A(shade(WHITE, 0.85)))
    c.d.line([(cx - 8, top - 7), (cx + 8, top - 7)], fill=A(PINK), width=2)
    c.d.polygon([(cx + 7, top - 7), (cx + 14, top - 15), (cx + 15, top - 14), (cx + 8, top - 4)], fill=A(shade(WHITE, 0.9)))
    c.d.arc((cx - 13, top - 12, cx - 5, top - 3), 90, 270, fill=A(shade(WHITE, 0.85)), width=2)
    ell(c, cx, top - 14, 5, 2, PINK)
    c.d.rectangle((cx - 1, top - 18, cx + 1, top - 16), fill=A(PINK))
    bulb(c, cx, top - 19, BULB)
    for y, x, k in sorted(cups):
        if y > top:
            teacup(c, x, y, cols[k], f + k)
    for k in range(10):  # rim bulbs, front half
        a = k * math.pi / 9
        bulb(c, cx + round(math.cos(a) * 29), top + round(math.sin(a) * 14) + 1, BULB, glow=False)
    return c


def droptower():
    """CloudFront Drop Tower: a purple lattice mast rising from a round station, a ring of seats part-way up
    (riders' legs dangling), a white crown with a small globe on top and a red beacon; lit strips at night."""
    c = Canvas(2, 2, 132)
    c.box(0.06, 0.06, 1.94, 1.94, 0, 1, CON_L, top=(226, 220, 206))
    cx, cy = c.P(1, 1, 0)
    base = disc(c, cx, cy, 22, 11, 6, shade(PURPLE, 0.55), top=(228, 222, 240))
    # station canopy posts
    for k in range(6):
        a = k * 2 * math.pi / 6 + 0.3
        if math.sin(a) < 0:
            x, y = cx + round(math.cos(a) * 18), base + round(math.sin(a) * 9)
            c.d.line([(x, y), (x, y - 10)], fill=A(WHITE))
    lattice_mast(c, 1, 1, 6, 112, PURPLE, r=0.11)
    # lit strips up the mast
    x, _ = c.P(1, 1.11, 0)
    for z in [z for z in range(10, 108, 4) if not 58 <= z <= 76]:
        _, y = c.P(1, 1.11, z)
        c.ld.point([(x - 2, y), (x + 1, y)], fill=A((200, 170, 255)))
    # the seat ring part-way up
    rz = 70
    _, ry = c.P(1, 1, rz)
    ell(c, cx, ry + 4, 13, 6, shade(CON_D, 0.9))
    c.d.rectangle((cx - 13, ry - 2, cx + 13, ry + 4), fill=A(shade(CON_D, 0.9)))
    ell(c, cx, ry - 2, 13, 6, CON_L)
    ell(c, cx, ry - 2, 7, 3, shade(PURPLE, 0.45))
    for k in range(7):
        a = k * math.pi / 6
        sx, sy = cx + round(math.cos(a) * 12), ry + 3 + round(math.sin(a) * 5)
        col = CANDY[k % len(CANDY)]
        c.d.rectangle((sx - 1, sy - 4, sx + 1, sy), fill=A(col))
        c.d.point([(sx, sy - 5)], fill=A((232, 190, 150)))
        c.d.line([(sx, sy + 1), (sx, sy + 3)], fill=A(NAVY))
        c.ld.point([(sx, sy - 4)], fill=A(LIT))
    # crown and globe
    _, ty = c.P(1, 1, 112)
    c.d.rectangle((cx - 6, ty - 3, cx + 6, ty + 1), fill=A(WHITE))
    c.d.line([(cx - 6, ty - 1), (cx + 6, ty - 1)], fill=A(PURPLE))
    globe(c, cx, ty - 10, 7, PURPLE, light=True)
    c.d.line([(cx, ty - 17), (cx, ty - 21)], fill=A(CON_L))
    c.d.point([(cx, ty - 22)], fill=A(RED))
    c.ld.rectangle((cx - 1, ty - 23, cx + 1, ty - 21), fill=A(RED))
    # station roof in front of the mast foot (front arc only)
    for k in range(6):
        a = k * 2 * math.pi / 6 + 0.3
        if math.sin(a) >= 0:
            x, y = cx + round(math.cos(a) * 18), base + round(math.sin(a) * 9)
            c.d.line([(x, y), (x, y - 10)], fill=A(WHITE))
    c.d.arc((cx - 20, base - 19, cx + 20, base - 1), 0, 180, fill=A(PURPLE), width=3)
    for k in range(7):
        a = k * math.pi / 6
        bulb(c, cx + round(math.cos(a) * 20), base - 10 + round(math.sin(a) * 9), BULB, glow=False)
    return c


# ── pocket parks ──────────────────────────────────────────────────────────────

def gazebo():
    """A white gazebo: a round stone step, six slim posts, a green conical roof with a finial and a bulb
    string under the eaves."""
    c = Canvas(1, 1, 46)
    cx, cy = c.P(0.5, 0.5, 0)
    top = disc(c, cx, cy, 13, 6, 3, (206, 200, 188), top=(232, 226, 214))
    posts = [(math.sin(k * math.pi / 3 + 0.5), k) for k in range(6)]
    for s, k in sorted(posts):
        a = k * math.pi / 3 + 0.5
        x, y = cx + round(math.cos(a) * 10), top + round(math.sin(a) * 5)
        if s < 0:
            c.d.line([(x, y), (x, y - 15)], fill=A(shade(WHITE, 0.8)))
    c.d.rectangle((cx - 4, top - 4, cx + 4, top - 2), fill=A(WOOD))  # a bench inside
    for s, k in sorted(posts):
        a = k * math.pi / 3 + 0.5
        x, y = cx + round(math.cos(a) * 10), top + round(math.sin(a) * 5)
        if s >= 0:
            c.d.line([(x, y), (x, y - 15)], fill=A(WHITE))
    ry = top - 15
    ell(c, cx, ry, 14, 6, shade(GRASS_D, 0.9))
    c.d.polygon([(cx - 14, ry), (cx + 14, ry), (cx, ry - 13)], fill=A(GRASS_D))
    c.d.polygon([(cx - 14, ry), (cx - 2, ry), (cx, ry - 13)], fill=A(GRASS))
    c.d.chord((cx - 14, ry - 6, cx + 14, ry + 6), 0, 180, fill=A(shade(GRASS_D, 0.8)))
    c.d.line([(cx - 14, ry), (cx + 14, ry)], fill=A(WHITE))
    for k in range(7):
        a = k * math.pi / 6
        bulb(c, cx + round(math.cos(a) * 13), ry + 1 + round(math.sin(a) * 5), BULB, glow=False)
    c.d.line([(cx, ry - 13), (cx, ry - 17)], fill=A(WHITE))
    px(c, cx, ry - 18, YELLOW)
    return c


def amphitheatre():
    """Band shell (2×2): a white ribbed quarter-dome at the back opening toward the viewer, a stage with
    footlights, a bandstand's instruments, and curved timber benches on the lawn."""
    c = Canvas(2, 2, 60)
    c.poly([(0.04, 0.04, 0), (1.96, 0.04, 0), (1.96, 1.96, 0), (0.04, 1.96, 0)], GRASS)
    r = seeded("amph")
    for _ in range(14):
        x, y = c.P(r(190) / 100, r(190) / 100, 0)
        c.d.point([(x, y)], fill=A(GRASS_D))
    sx, sy = c.P(0.55, 0.55, 0)
    # stage (a semicircular deck in front of the shell)
    stage = disc(c, sx, sy + 4, 22, 11, 5, (180, 150, 110), top=(214, 182, 136))
    # the shell: nested arcs, outer white rim, inner bands darkening toward the back
    base = stage
    for k, (rx, ry, col) in enumerate(((24, 34, WHITE), (21, 30, (226, 230, 238)), (17, 25, (200, 206, 218)),
                                       (13, 19, (172, 180, 196)), (9, 13, (142, 150, 170)))):
        c.d.pieslice((sx - rx, base - ry, sx + rx, base + ry), 180, 360, fill=A(col))
    for k in range(5):  # ribs
        a = math.pi + (k + 1) * math.pi / 6
        c.d.line([(sx, base), (sx + round(math.cos(a) * 24), base + round(math.sin(a) * 34))], fill=A((236, 240, 246)))
    c.d.arc((sx - 24, base - 34, sx + 24, base + 34), 180, 360, fill=A(PINK), width=1)
    c.ld.arc((sx - 23, base - 33, sx + 23, base + 33), 180, 360, fill=A(BULB), width=1)
    # bandstand: a mic stand and a drum
    c.d.line([(sx - 6, base), (sx - 6, base - 8)], fill=A(NAVY))
    c.d.point([(sx - 7, base - 9), (sx - 6, base - 9)], fill=A(CON_L))
    ell(c, sx + 6, base - 2, 3, 2, RED)
    c.d.line([(sx + 3, base - 2), (sx + 9, base - 2)], fill=A(WHITE))
    # stage front edge and footlights
    c.d.arc((sx - 22, base - 11, sx + 22, base + 11), 0, 180, fill=A(ORANGE), width=1)
    for k in range(7):
        a = k * math.pi / 6
        bulb(c, sx + round(math.cos(a) * 21), base + round(math.sin(a) * 10), BULB, glow=False)
    # stage lights on two poles
    for dx in (-26, 26):
        x, y = sx + dx, base + 2
        c.d.line([(x, y + 4), (x, y - 26)], fill=A(NAVY))
        c.d.rectangle((x - 2, y - 28, x + 2, y - 26), fill=A(CON_D))
        c.ld.rectangle((x - 1, y - 27, x + 1, y - 26), fill=A((255, 240, 200)))
    # curved benches on the lawn
    for k, (rx, ry) in enumerate(((34, 17), (44, 22), (54, 27))):
        for i in range(9):
            a = 0.12 + i * (math.pi / 2 - 0.24) / 8
            x, y = sx + round(math.cos(a) * rx), sy + 4 + round(math.sin(a) * ry)
            c.d.rectangle((x - 2, y - 2, x + 2, y - 1), fill=A(WOOD))
            c.d.point([(x - 2, y), (x + 2, y)], fill=A(WOOD_D))
    return c


def playground():
    """Playground (1×1): soft sand, a slide with a ladder, a swing frame and a spring rider."""
    c = Canvas(1, 1, 34)
    c.poly([(0.06, 0.06, 0), (0.94, 0.06, 0), (0.94, 0.94, 0), (0.06, 0.94, 0)], SAND)
    c.d.line([c.P(0.06, 0.94), c.P(0.94, 0.94), c.P(0.94, 0.06)], fill=A(WOOD_D))
    # swing frame along u at the back
    for u in (0.12, 0.62):
        x, y = c.P(u, 0.22, 0)
        c.d.line([(x - 2, y), (x, y - 18)], fill=A(SKY))
        c.d.line([(x + 2, y), (x, y - 18)], fill=A(SKY))
    c.line((0.12, 0.22, 18), (0.62, 0.22, 18), shade(SKY, 0.8))
    for u in (0.28, 0.46):
        a, b = c.P(u, 0.22, 18), c.P(u, 0.22, 5)
        c.d.line([a, b], fill=A(CON_D))
        c.d.line([(b[0] - 1, b[1]), (b[0] + 2, b[1] + 1)], fill=A(RED))
    # slide: platform tower + ladder + chute
    c.box(0.6, 0.5, 0.82, 0.72, 0, 12, YELLOW)
    c.box(0.58, 0.48, 0.84, 0.74, 12, 14, RED)
    c.pyramid(0.58, 0.48, 0.84, 0.74, 20, 6, RED)
    for (u, v) in ((0.6, 0.5), (0.82, 0.5), (0.6, 0.72), (0.82, 0.72)):
        post(c, u, v, 14, 20, YELLOW, w=0.015)
    c.poly([(0.36, 0.56, 13), (0.36, 0.68, 13), (0.08, 0.86, 1), (0.08, 0.74, 1)], shade(TEAL, 1.1))
    c.poly([(0.36, 0.68, 13), (0.36, 0.7, 15), (0.08, 0.88, 3), (0.08, 0.86, 1)], shade(TEAL, 0.75))
    c.poly([(0.36, 0.56, 13), (0.6, 0.56, 13), (0.6, 0.68, 13), (0.36, 0.68, 13)], RED)
    for z in range(2, 12, 3):
        c.line((0.86, 0.52, z), (0.86, 0.7, z), WOOD_D)
    # spring rider (a little duck)
    x, y = c.P(0.72, 0.9, 0)
    c.d.line([(x, y), (x, y - 3)], fill=A(CON_D))
    c.d.rectangle((x - 3, y - 7, x + 2, y - 4), fill=A(YELLOW))
    c.d.rectangle((x + 1, y - 9, x + 3, y - 7), fill=A(YELLOW))
    c.d.point([(x + 4, y - 8)], fill=A(ORANGE))
    return c


# ── build ─────────────────────────────────────────────────────────────────────

RIDES = {
    # name: (drawer, frames, footprint, zmax, pad, tarp gap-closing kernel)
    "coaster": (coaster, 0, (2, 2), 72, 2, 7),
    "flume": (flume, 3, (2, 2), 72, 2, 7),
    "carousel": (carousel, 3, (2, 2), 66, 2, 7),
    "wheel": (wheel, 3, (2, 2), 104, 8, 13),
    "teacups": (teacups, 3, (2, 2), 50, 2, 5),
    "droptower": (droptower, 0, (2, 2), 132, 2, 7),
}


def build(add):
    add("crane1x1", crane())
    add("scaffold1x1", scaffold())
    add("park:arch", arch())
    add("park:booth", booth())
    add("park:fenceX", fence(True), do_outline=False)
    add("park:fenceY", fence(False), do_outline=False)
    for name, (draw, frames, (fw, fh), zmax, pad, close) in RIDES.items():
        if frames:
            first = None
            for f in range(frames):
                c = draw(f)
                first = first or c
                add(f"park:{name}{f}", c)
        else:
            first = draw()
            add(f"park:{name}", first)
        add(f"park:{name}:locked", locked(first, fw, fh, zmax, pad, close), lights=False)
    add("park:gazebo", gazebo())
    add("park:amphitheatre", amphitheatre())
    add("park:playground", playground())
