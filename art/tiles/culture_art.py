"""
Day 1 Quarter, data-centre campus and ops art: sprites named culture:* (see build()).
Called from generate_tiles.build_landmarks as culture_art.build(add).

Footprints match src/world/layout.ts buildSites(): the five big sites are 3x3, plaques/board/kiosk/sign are 1x1,
and the delivery van is a 1x1 vehicle in four facings (src/game/Ops.ts swaps frames, so all four share one canvas).
Amazon culture, drawn in the city's own palette: no third-party logos, only generic shapes and a few pixel letters.
"""
from generate_tiles import (A, CLEAR, CON_D, CON_L, CON_M, GLASS, GLASS_D, GRASS, GRASS_D, HH, HW, NAVY, NAVY_D, ORANGE,  # noqa: F401
                            ORANGE_D, OUTLINE, PACKIMG, WATER, WHITE, WOOD, WOOD_D, Canvas, seeded, shade, stripe_block)
from landmarks_aws_a import cyl, dot, lwin, rwin

LIT = (255, 214, 120)
GOLD = (236, 186, 52)
GOLD_L = (255, 222, 110)
STONE = (222, 214, 196)
STONE_D = (176, 168, 152)
EXPO = (120, 84, 214)       # the expo hall's event purple
EXPO_2 = (40, 186, 196)     # and its teal
LED_G = (90, 240, 150)
LED_O = (255, 170, 40)
GRAVEL = (150, 146, 136)
TRAFO = (128, 140, 128)
PAPER = (246, 240, 222)
RED = (214, 58, 58)

# 3x5 pixel letters for the few words drawn on buildings
FONT = {
    "D": ["XX.", "X.X", "X.X", "X.X", "XX."], "A": [".X.", "X.X", "XXX", "X.X", "X.X"],
    "Y": ["X.X", "X.X", ".X.", ".X.", ".X."], "1": [".X.", "XX.", ".X.", ".X.", "XXX"],
    "E": ["XXX", "X..", "XX.", "X..", "XXX"], "X": ["X.X", "X.X", ".X.", "X.X", "X.X"],
    "P": ["XX.", "X.X", "XX.", "X..", "X.."], "O": [".X.", "X.X", "X.X", "X.X", ".X."],
    "?": ["XX.", "..X", ".X.", "...", ".X."], " ": ["...", "...", "...", "...", "..."],
}


def text_l(c, s, u, v, z, col, light=False):
    """Pixel text on a left-facing (v = const) face; (u, v, z) is the first glyph's top-left."""
    x0, y0 = c.P(u, v, z)
    for i, ch in enumerate(s):
        for r, row in enumerate(FONT[ch]):
            for k, px in enumerate(row):
                if px == "X":
                    xx, yy = x0 + i * 4 + k, y0 + r + (i * 4 + k) // 2
                    c.d.point([(xx, yy)], fill=A(col))
                    if light:
                        c.ld.point([(xx, yy)], fill=A(col))


def tree(c, u, v):
    img, anchor, _, _ = PACKIMG["tree"]
    c.stamp(img, u, v, anchor)


def post(c, u, v, z0, z1, col=CON_D, s=0.04):
    c.box(u - s, v - s, u + s, v + s, z0, z1, col)


def fence(c, u0, v0, u1, v1, h=6, col=CON_M, step=0.5):
    """A low wire fence along the two front edges (v = v1 and u = u1) of a rectangle."""
    for k in range(int((u1 - u0) / step) + 1):
        post(c, u0 + k * step, v1, 0, h, col, 0.03)
    for k in range(int((v1 - v0) / step) + 1):
        post(c, u1, v0 + k * step, 0, h, col, 0.03)
    for z in (h - 1, h // 2):
        c.line((u0, v1, z), (u1, v1, z), shade(col, 1.1))
        c.line((u1, v1, z), (u1, v0, z), shade(col, 0.9))


# ── Day 1 Quarter ─────────────────────────────────────────────────────────────

def day1office():
    """Amazon's Day 1 tower: a glass office tower on a navy podium, 'DAY 1' on the crown."""
    h = 74
    c = Canvas(3, 3, h + 16)
    c.box(0.05, 0.05, 2.95, 2.95, 0, 2, CON_L, top=shade(CON_L, 1.02))
    # podium: lobby glass all round, orange canopy over the door
    c.box(0.3, 0.3, 2.75, 2.75, 2, 14, NAVY)
    for k in range(6):
        lwin(c, 2.75, 0.42 + k * 0.38, 4, w=0.26, h=8, lit=k != 2)
        rwin(c, 2.75, 0.42 + k * 0.38, 4, w=0.26, h=8, lit=k % 2 == 0)
    c.lface(2.75, 1.25, 1.75, 2, 11, NAVY_D)
    c.box(1.1, 2.75, 1.9, 3.0, 11, 13, ORANGE)
    # the tower, set back from the podium's north corner
    u0, v0, u1, v1 = 0.55, 0.55, 2.2, 2.2
    c.box(u0, v0, u1, v1, 14, h, GLASS_D, left=shade(GLASS, 0.9), right=shade(GLASS_D, 0.85), top=CON_M)
    r = seeded("day1office")
    for z in range(17, h - 10, 5):
        for k in range(6):
            lwin(c, v1, u0 + 0.06 + k * 0.27, z, w=0.2, h=3, col=shade(GLASS, 1.05), lit=r(5) > 1)
            rwin(c, u1, v0 + 0.06 + k * 0.27, z, w=0.2, h=3, col=shade(GLASS_D, 1.05), lit=r(5) > 1)
    # vertical mullions
    for k in range(1, 6):
        c.line((u0 + k * 0.275, v1, 15), (u0 + k * 0.275, v1, h - 9), shade(GLASS, 0.72))
        c.line((u1, v0 + k * 0.275, 15), (u1, v0 + k * 0.275, h - 9), shade(GLASS_D, 0.68))
    # crown with the name
    c.lface(v1, u0, u1, h - 9, h, NAVY)
    c.rface(u1, v0, v1, h - 9, h, NAVY_D)
    c.lface(v1, u0, u1, h - 9, h - 8, ORANGE)
    c.rface(u1, v0, v1, h - 9, h - 8, ORANGE_D)
    text_l(c, "DAY 1", u0 + 0.2, v1, h - 1, ORANGE, light=True)
    c.box(u0 + 0.35, v0 + 0.35, u0 + 0.95, v0 + 0.95, h, h + 5, CON_M)
    x, y = c.P(u1 - 0.3, v1 - 0.3, h)
    c.d.line([(x, y), (x, y - 10)], fill=A(CON_L))
    c.d.point([(x, y - 11)], fill=(255, 80, 80, 255))
    c.ld.point([(x, y - 11)], fill=(255, 80, 80, 255))
    tree(c, 0.2, 2.75)
    tree(c, 2.75, 0.2)
    return c


def goldenhall():
    """Golden Jacket Hall: a stone hall of columns under a gold roof, a trophy on the ridge."""
    c = Canvas(3, 3, 72)
    c.box(0.1, 0.1, 2.9, 2.9, 0, 3, STONE_D)
    c.box(0.25, 0.25, 2.8, 2.8, 3, 6, STONE)
    u0, v0, u1, v1 = 0.5, 0.5, 2.45, 2.45
    c.box(u0, v0, u1, v1, 6, 32, shade(STONE, 0.94))
    for k in range(5):  # tall lit windows on the cella between the columns
        lwin(c, v1, u0 + 0.18 + k * 0.38, 12, w=0.16, h=12, col=GLASS, lit=True)
        rwin(c, u1, v0 + 0.18 + k * 0.38, 12, w=0.16, h=12, col=GLASS_D, lit=k != 1)
    c.lface(v1, 1.3, 1.65, 6, 22, shade(GOLD, 0.7))  # golden doors
    c.lface(v1, 1.47, 1.48, 6, 22, shade(GOLD, 0.5))
    # colonnade on the two visible sides
    for k in range(7):
        u = 0.42 + k * 0.33
        c.box(u, 2.58, u + 0.1, 2.68, 6, 32, WHITE)
    for k in range(6):
        v = 0.42 + k * 0.33
        c.box(2.58, v, 2.68, v + 0.1, 6, 32, WHITE)
    c.box(0.35, 0.35, 2.72, 2.72, 32, 36, GOLD, top=GOLD_L)
    c.lface(2.72, 0.35, 2.72, 33, 34, shade(GOLD, 0.6))
    c.gable(0.3, 0.3, 2.77, 2.77, 36, 14, GOLD)
    # pediment medallion
    x, y = c.P(2.77, 1.535, 41)
    c.d.ellipse((x - 3, y - 3, x + 3, y + 3), fill=A(GOLD_L))
    # the trophy on the ridge
    x, y = c.P(1.5, 1.535, 50)
    c.d.rectangle((x - 3, y - 2, x + 3, y), fill=A(STONE_D))
    c.d.rectangle((x - 1, y - 6, x + 1, y - 2), fill=A(GOLD))
    c.d.pieslice((x - 6, y - 16, x + 6, y - 4), 0, 180, fill=A(GOLD))
    c.d.rectangle((x - 6, y - 11, x + 6, y - 10), fill=A(GOLD))
    c.d.arc((x - 9, y - 11, x - 3, y - 5), 90, 270, fill=A(GOLD))
    c.d.arc((x + 3, y - 11, x + 9, y - 5), 270, 90, fill=A(GOLD))
    c.d.point([(x - 3, y - 9)], fill=A(GOLD_L))
    c.ld.ellipse((x - 7, y - 15, x + 7, y - 3), fill=(255, 226, 120, 140))
    return c


def expohall():
    """re:Invent Expo Hall: a long glass convention hall, an LED wall, banners and an entrance canopy."""
    c = Canvas(3, 3, 64)
    c.box(0.05, 0.05, 2.95, 2.95, 0, 2, CON_L)
    u0, v0, u1, v1 = 0.2, 0.25, 2.8, 2.35
    c.box(u0, v0, u1, v1, 2, 24, CON_L)
    c.louvres(u0, v0, u1, v1, 14, 24, CON_L)
    # glass front (left face) with lit halls behind
    r = seeded("expo")
    for k in range(9):
        lwin(c, v1, u0 + 0.06 + k * 0.28, 4, w=0.22, h=9, col=GLASS, lit=r(4) > 0)
    c.lface(v1, u0, u1, 13, 15, EXPO)
    # LED wall on the right face
    c.rface(u1, v0 + 0.25, v1 - 0.25, 6, 21, NAVY_D)
    for i, col in enumerate((EXPO, EXPO_2, ORANGE, EXPO, EXPO_2)):
        c.rface(u1, v0 + 0.35 + i * 0.32, v0 + 0.6 + i * 0.32, 8 + (i % 2) * 3, 18 - (i % 3) * 2, col, light=True)
    # the wave roof: three vaults
    for k in range(3):
        a = u0 + k * (u1 - u0) / 3
        b = a + (u1 - u0) / 3
        m = (a + b) / 2
        c.poly([(a, v1, 24), (m, v1, 32), (m, v0, 32), (a, v0, 24)], shade(EXPO, 0.85 + 0.08 * k))
        c.poly([(m, v1, 32), (b, v1, 24), (b, v0, 24), (m, v0, 32)], shade(EXPO, 0.72 + 0.08 * k))
        c.poly([(a, v1, 24), (m, v1, 32), (b, v1, 24)], shade(EXPO, 1.08))
    # entrance canopy and doors at the front
    c.lface(v1, 1.25, 1.75, 2, 10, NAVY_D)
    c.poly([(1.0, 2.35, 13), (2.0, 2.35, 13), (2.0, 2.85, 12), (1.0, 2.85, 12)], ORANGE)
    for u in (1.05, 1.92):
        post(c, u, 2.8, 2, 12, CON_M)
    # banners
    for i, (u, col) in enumerate(((0.35, EXPO), (0.7, EXPO_2), (2.35, ORANGE), (2.7, EXPO))):
        x, y = c.P(u, 2.75, 2)
        c.d.line([(x, y), (x, y - 26)], fill=A(CON_L))
        c.d.rectangle((x + 1, y - 25, x + 4, y - 15), fill=A(col))
        c.d.point([(x + 2, y - 21)], fill=A(WHITE))
    return c


def fulfilment():
    """Amazon.com fulfilment centre: a vast low warehouse, loading docks along the side, parcels in the yard."""
    c = Canvas(3, 3, 48)
    c.box(0.02, 0.02, 2.98, 2.98, 0, 1, CON_M, top=shade(CON_M, 1.05))
    u0, v0, u1, v1 = 0.12, 0.12, 2.4, 2.75
    c.box(u0, v0, u1, v1, 1, 22, shade(CON_L, 0.97), top=CON_M)
    c.louvres(u0, v0, u1, v1, 1, 18, CON_L, step=4)
    c.lface(v1, u0, u1, 18, 22, NAVY)
    c.rface(u1, v0, v1, 18, 22, NAVY_D)
    c.lface(v1, u0, u1, 18, 19, ORANGE)
    c.rface(u1, v0, v1, 18, 19, ORANGE_D)
    # office corner with lit windows
    for k in range(4):
        lwin(c, v1, u0 + 0.12 + k * 0.3, 5, w=0.2, h=4, lit=k != 1)
        lwin(c, v1, u0 + 0.12 + k * 0.3, 11, w=0.2, h=4, lit=k % 2 == 0)
    c.lface(v1, 1.45, 1.7, 1, 9, NAVY_D)
    # loading docks on the right face, each with a dock light
    for k in range(5):
        v = v0 + 0.2 + k * 0.5
        c.rface(u1, v, v + 0.32, 1, 12, CON_D)
        for z in range(3, 12, 2):
            c.rface(u1, v, v + 0.32, z, z + 1, shade(CON_D, 0.75))
        c.rface(u1, v + 0.12, v + 0.2, 14, 16, LIT, light=True)
        post(c, u1 + 0.12, v - 0.04, 1, 5, ORANGE, 0.03)
    # roof plant and skylights
    for k in range(3):
        u = u0 + 0.3 + k * 0.7
        c.poly([(u, 0.6, 22), (u + 0.35, 0.6, 22), (u + 0.35, 2.3, 22), (u, 2.3, 22)], shade(GLASS_D, 1.05))
    c.box(1.7, 0.4, 2.15, 0.85, 22, 27, CON_M)
    c.fan(1.92, 0.62, 27, r=0.16)
    # parcels in the yard
    for i, (u, v, z) in enumerate(((2.55, 2.3, 1), (2.75, 2.3, 1), (2.65, 2.55, 1), (2.6, 2.4, 6))):
        c.box(u, v, u + 0.18, v + 0.18, z, z + 5, WOOD if i % 2 == 0 else shade(WOOD, 0.9))
        c.lface(v + 0.18, u + 0.07, u + 0.11, z, z + 5, shade(WOOD, 0.75))
    return c


def _dc_shell(c, leds):
    """The data hall: windowless concrete with louvres, a navy band, roof chillers, generators and a fence.
    LED positions are returned through `leds` so the blink overlays can light the same pixels."""
    u0, v0, u1, v1 = 0.25, 0.3, 2.6, 2.6
    c.box(0.05, 0.05, 2.95, 2.95, 0, 1, CON_M)
    stripe_block(c, u0, v0, u1, v1, 26, NAVY, "dc0", lit=False)
    # status LEDs on a navy strip by the door and along the side
    c.lface(v1, u0 + 0.15, u0 + 0.85, 3, 8, NAVY_D)
    c.rface(u1, v0 + 0.3, v1 - 0.3, 3, 8, NAVY_D)
    for k in range(6):
        leds.append(("l", v1, u0 + 0.2 + k * 0.1, 5))
    for k in range(12):
        leds.append(("r", u1, v0 + 0.36 + k * 0.14, 5))
    # roof chillers
    for k in range(3):
        u = u0 + 0.35 + k * 0.7
        c.box(u, v0 + 0.3, u + 0.5, v0 + 0.8, 26, 30, CON_M)
        c.fan(u + 0.25, v0 + 0.55, 30, r=0.17, frame=k)
        c.box(u, v0 + 1.1, u + 0.5, v0 + 1.6, 26, 30, CON_M)
        c.fan(u + 0.25, v0 + 1.35, 30, r=0.17, frame=k + 1)
    # backup generators on the ground at the front-right
    c.box(2.68, 0.35, 2.92, 1.05, 1, 8, (196, 196, 180))
    c.box(2.68, 1.25, 2.92, 1.95, 1, 8, (196, 196, 180))
    for v in (0.5, 1.4):
        cyl(c, 2.8, v, 8, 13, 0.05, CON_D)
    fence(c, 0.05, 0.05, 2.95, 2.95, h=5)


def _led_px(c, leds, pick, cols=(LED_G, LED_O), base=False):
    for i, (face, a, b, z) in enumerate(leds):
        if not pick(i):
            continue
        col = cols[i % 3 == 0]
        if face == "l":
            c.lface(a, b, b + 0.05, z, z + 1, shade(col, 0.45) if base else col, light=not base)
        else:
            c.rface(a, b, b + 0.06, z, z + 1, shade(col, 0.45) if base else col, light=not base)


def data_centre():
    """culture:dc:0 plus two LED-only overlays (culture:dc:blink0/1) the city swaps to make it blink."""
    c = Canvas(3, 3, 40)
    leds = []
    _dc_shell(c, leds)
    _led_px(c, leds, lambda i: True, base=True)          # the LEDs, dim, on the building itself
    _led_px(c, leds, lambda i: i % 2 == 0)               # night layer: half of them lit
    # a beacon on the roof
    x, y = c.P(0.55, 0.6, 26)
    c.d.line([(x, y), (x, y - 9)], fill=A(CON_L))
    c.d.point([(x, y - 10)], fill=(255, 80, 80, 255))
    c.ld.point([(x, y - 10)], fill=(255, 80, 80, 255))
    blinks = []
    for f in range(2):
        b = Canvas(3, 3, 40)
        _led_px(b, leds, lambda i, f=f: (i + f) % 2 == 0 or (i * 7 + f) % 5 == 0)
        blinks.append(b)
    return c, blinks


def substation():
    """culture:dc:1, the campus substation: transformers and gantries on gravel behind a fence, a control hut."""
    c = Canvas(3, 3, 56)
    c.box(0.05, 0.05, 2.95, 2.95, 0, 1, GRAVEL, top=shade(GRAVEL, 1.05))
    r = seeded("gravel")
    for _ in range(40):
        x, y = c.P(0.1 + r(280) / 100, 0.1 + r(280) / 100, 1)
        c.d.point([(x, y)], fill=A(shade(GRAVEL, 0.82)))
    # control hut at the back
    c.box(0.2, 0.2, 1.0, 0.9, 1, 14, CON_L)
    c.gable(0.15, 0.15, 1.05, 0.95, 14, 5, NAVY)
    c.lface(0.9, 0.5, 0.7, 1, 9, NAVY_D)
    # transformers with cooling fins and bushings
    for (u, v) in ((1.3, 0.35), (1.3, 1.45), (0.35, 1.5)):
        c.box(u, v, u + 0.8, v + 0.75, 1, 14, TRAFO)
        for k in range(5):
            c.lface(v + 0.75, u + 0.08 + k * 0.15, u + 0.12 + k * 0.15, 3, 12, shade(TRAFO, 0.7))
        for k in range(3):
            x, y = c.P(u + 0.2 + k * 0.2, v + 0.35, 14)
            c.d.rectangle((x - 1, y - 6, x, y), fill=A((210, 200, 180)))
            c.d.point([(x - 1, y - 7)], fill=A(CON_D))
    # gantries carrying the lines in
    tops = []
    for (u, v) in ((2.5, 0.4), (2.5, 2.5), (0.4, 2.5)):
        post(c, u, v, 1, 40, CON_D, 0.03)
        tops.append(c.P(u, v, 40))
    for (x0, y0), (x1, y1) in ((tops[0], tops[1]), (tops[1], tops[2])):
        c.d.line([(x0, y0), (x1, y1)], fill=A(CON_D))
        c.d.line([(x0, y0 + 5), (x1, y1 + 5)], fill=A(shade(CON_D, 0.8)))
        for t in (0.25, 0.5, 0.75):
            xm, ym = round(x0 + (x1 - x0) * t), round(y0 + (y1 - y0) * t)
            c.d.line([(xm, ym), (xm, ym + 5)], fill=A(CON_D))
    for x, y in tops:
        c.d.line([(x - 4, y), (x + 4, y)], fill=A(CON_D))
    # wires down to the transformers
    for (x, y), (u, v) in zip(tops, ((1.9, 0.7), (1.9, 1.8), (0.75, 1.9))):
        x1, y1 = c.P(u, v, 20)
        c.d.line([(x, y + 1), (x1, y1)], fill=A((70, 76, 90)))
    # yellow hazard sign on the fence
    fence(c, 0.05, 0.05, 2.95, 2.95, h=8)
    x, y = c.P(1.5, 2.95, 7)
    c.d.polygon([(x - 3, y), (x + 3, y), (x, y - 5)], fill=A((255, 214, 60)))
    c.d.point([(x, y - 2)], fill=A(NAVY_D))
    return c


# ── 1x1 props ─────────────────────────────────────────────────────────────────

def plaque(face, plinth, key):
    """A stone plinth with an angled plaque on top (the LP Walk)."""
    c = Canvas(1, 1, 24)
    c.box(0.22, 0.22, 0.78, 0.78, 0, 3, STONE_D)
    c.box(0.32, 0.32, 0.68, 0.68, 3, 13, plinth)
    c.poly([(0.26, 0.74, 13), (0.74, 0.74, 13), (0.74, 0.4, 18), (0.26, 0.4, 18)], face)
    c.poly([(0.74, 0.74, 13), (0.74, 0.4, 18), (0.74, 0.4, 16), (0.74, 0.74, 11)], shade(plinth, 0.7))
    x, y = c.P(0.5, 0.57, 15.5)
    c.d.line([(x - 4, y - 1), (x + 2, y + 2)], fill=A(shade(face, 0.65)))
    c.d.line([(x - 3, y + 1), (x + 1, y + 3)], fill=A(shade(face, 0.65)))
    return c


def coeboard():
    """Correction of Error board: a notice board on legs, pinned with write-ups."""
    c = Canvas(1, 1, 34)
    for u in (0.18, 0.82):
        post(c, u, 0.55, 0, 22, WOOD_D)
    c.box(0.1, 0.5, 0.9, 0.6, 8, 26, WOOD)
    c.lface(0.6, 0.14, 0.86, 10, 24, (196, 160, 112))
    for (u, z, col) in ((0.2, 16, PAPER), (0.45, 18, PAPER), (0.66, 14, (255, 236, 150)), (0.24, 11, (190, 226, 250)), (0.52, 11, PAPER)):
        c.lface(0.6, u, u + 0.16, z, z + 5, col)
        x, y = c.P(u + 0.08, 0.6, z + 5)
        c.d.point([(x, y)], fill=A(RED))
    return c


def kiosk():
    """About Amazon: an info kiosk with a lit screen."""
    c = Canvas(1, 1, 36)
    c.box(0.3, 0.3, 0.7, 0.7, 0, 2, CON_M)
    c.box(0.36, 0.36, 0.64, 0.64, 2, 26, NAVY)
    c.box(0.33, 0.33, 0.67, 0.67, 26, 29, ORANGE)
    c.lface(0.64, 0.4, 0.6, 12, 23, GLASS)
    c.lface(0.64, 0.43, 0.57, 19, 21, WHITE)
    c.lface(0.64, 0.43, 0.53, 15, 16, shade(GLASS, 0.7))
    c.rface(0.64, 0.4, 0.6, 14, 23, shade(ORANGE, 0.85))
    return c


def regionsign():
    """The Region's welcome sign: a navy board on two posts with an orange stripe."""
    c = Canvas(1, 1, 44)
    for u in (0.1, 0.9):
        post(c, u, 0.5, 0, 22, CON_D)
    c.box(-0.15, 0.44, 1.15, 0.56, 20, 36, NAVY)
    c.lface(0.56, -0.15, 1.15, 20, 23, ORANGE)
    c.lface(0.56, -0.05, 1.05, 33, 34, ORANGE)
    for k, w in enumerate((0.7, 0.5)):
        c.lface(0.56, 0.0, w, 28 - k * 3, 29 - k * 3, WHITE)
    x, y = c.P(1.0, 0.56, 31)
    c.d.ellipse((x - 3, y - 2, x + 2, y + 3), fill=A(ORANGE))  # a pin
    return c


def van(d):
    """Delivery van facing d (SE = +x, SW = +y, NE = -y, NW = -x). One canvas for all four so frames swap in place."""
    c = Canvas(1, 1, 24)
    along_u = d in ("SE", "NW")
    lo, hi, w0, w1 = 0.08, 0.92, 0.32, 0.68
    body = WHITE
    if along_u:
        u0, u1, v0, v1 = lo, hi, w0, w1
    else:
        u0, u1, v0, v1 = w0, w1, lo, hi
    fwd = d in ("SE", "SW")  # front at the high end of the axis
    # cargo box and cab
    if along_u:
        cu0, cu1 = (u1 - 0.24, u1) if fwd else (u0, u0 + 0.24)
        bu0, bu1 = (u0, u1 - 0.24) if fwd else (u0 + 0.24, u1)
        c.box(bu0, v0, bu1, v1, 2, 14, body)
        c.box(cu0, v0, cu1, v1, 2, 10, body)
        c.lface(v1, bu0, bu1, 2, 4, NAVY)
        c.lface(v1, cu0, cu1, 2, 4, NAVY)
        c.lface(v1, bu0 + 0.05, bu1 - 0.05, 8, 10, ORANGE)
        c.lface(v1, cu0 + 0.04, cu1 - 0.04, 6, 9, GLASS_D)  # side window
        if fwd:
            c.rface(u1, v0 + 0.05, v1 - 0.05, 6, 9, GLASS)  # windscreen
            c.rface(u1, v0 + 0.04, v0 + 0.1, 3, 4, (255, 236, 150))
            c.rface(u1, v1 - 0.1, v1 - 0.04, 3, 4, (255, 236, 150))
        else:
            c.rface(u1, v0, v1, 2, 14, shade(body, 0.8))
            c.rface(u1, (v0 + v1) / 2 - 0.01, (v0 + v1) / 2 + 0.01, 3, 13, shade(body, 0.6))
            c.rface(u1, v0 + 0.04, v0 + 0.1, 3, 5, RED)
            c.rface(u1, v1 - 0.1, v1 - 0.04, 3, 5, RED)
        wheels = [(bu0 + 0.12, v1), (cu0 + 0.1, v1)]
        for u, v in wheels:
            x, y = c.P(u, v, 1)
            c.d.ellipse((x - 2, y - 2, x + 2, y + 2), fill=A(OUTLINE))
    else:
        cv0, cv1 = (v1 - 0.24, v1) if fwd else (v0, v0 + 0.24)
        bv0, bv1 = (v0, v1 - 0.24) if fwd else (v0 + 0.24, v1)
        c.box(u0, bv0, u1, bv1, 2, 14, body)
        c.box(u0, cv0, u1, cv1, 2, 10, body)
        c.rface(u1, bv0, bv1, 2, 4, NAVY)
        c.rface(u1, cv0, cv1, 2, 4, NAVY)
        c.rface(u1, bv0 + 0.05, bv1 - 0.05, 8, 10, ORANGE)
        c.rface(u1, cv0 + 0.04, cv1 - 0.04, 6, 9, GLASS_D)
        if fwd:
            c.lface(v1, u0 + 0.05, u1 - 0.05, 6, 9, GLASS)
            c.lface(v1, u0 + 0.04, u0 + 0.1, 3, 4, (255, 236, 150))
            c.lface(v1, u1 - 0.1, u1 - 0.04, 3, 4, (255, 236, 150))
        else:
            c.lface(v1, u0, u1, 2, 14, shade(body, 0.9))
            c.lface(v1, (u0 + u1) / 2 - 0.01, (u0 + u1) / 2 + 0.01, 3, 13, shade(body, 0.65))
            c.lface(v1, u0 + 0.04, u0 + 0.1, 3, 5, RED)
            c.lface(v1, u1 - 0.1, u1 - 0.04, 3, 5, RED)
        for u, v in ((u1, bv0 + 0.12), (u1, cv0 + 0.1)):
            x, y = c.P(u, v, 1)
            c.d.ellipse((x - 2, y - 2, x + 2, y + 2), fill=A(OUTLINE))
    return c


def build(add):
    add("culture:day1office", day1office())
    add("culture:goldenhall", goldenhall())
    add("culture:expohall", expohall())
    add("culture:fulfilment", fulfilment())
    dc, blinks = data_centre()
    add("culture:dc:0", dc)
    for i, b in enumerate(blinks):
        img, anchor, _ = b.finish(do_outline=False)
        add(f"culture:dc:blink{i}", img, anchor)
    add("culture:dc:1", substation(), lights=False)
    add("culture:lpplaque", plaque(ORANGE, STONE, "lp"), lights=False)
    add("culture:mechplaque", plaque((120, 200, 230), NAVY, "mech"), lights=False)
    add("culture:coeboard", coeboard(), lights=False)
    add("culture:aboutplaque", kiosk(), lights=False)
    add("culture:regionsign", regionsign(), lights=False)
    for d in ("SE", "SW", "NE", "NW"):
        add(f"culture:van:{d}", van(d), lights=False)
