"""Bespoke landmarks: Database Row + Network Junction (dynamodb rds aurora elasticache redshift neptune vpc route53 cloudfront apigateway sqs eventbridge). See landmarks_aws.py."""
from generate_tiles import (A, CLEAR, CON_D, CON_L, CON_M, GLASS, GLASS_D, GRASS, GRASS_D, HH, HW, NAVY, NAVY_D, ORANGE,  # noqa: F401
                            ORANGE_D, OUTLINE, PACKIMG, WATER, WHITE, WOOD, WOOD_D, Canvas, seeded, shade, stripe_block)
import math

RED = (214, 58, 58)
RED_D = (160, 36, 44)
YELLOW = (255, 214, 60)
LIGHT = (255, 214, 120)
STONE = (222, 214, 196)
HEDGE = (60, 140, 64)
TEAL = (70, 230, 190)
BULB = (255, 236, 150)

# 3x5 pixel glyphs
FONT = {
    "0": ["XXX", "X.X", "X.X", "X.X", "XXX"], "1": [".X.", "XX.", ".X.", ".X.", "XXX"],
    "2": ["XXX", "..X", "XXX", "X..", "XXX"], "3": ["XXX", "..X", ".XX", "..X", "XXX"],
    "5": ["XXX", "X..", "XXX", "..X", "XXX"], "S": [".XX", "X..", ".X.", "..X", "XX."],
    "Q": [".X.", "X.X", "X.X", "X.X", ".XX"], "D": ["XX.", "X.X", "X.X", "X.X", "XX."],
    "B": ["XX.", "X.X", "XX.", "X.X", "XX."], "A": [".X.", "X.X", "XXX", "X.X", "X.X"],
    "P": ["XX.", "X.X", "XX.", "X..", "X.."], "I": ["XXX", ".X.", ".X.", ".X.", "XXX"],
    "C": [".XX", "X..", "X..", "X..", ".XX"], "F": ["XXX", "X..", "XX.", "X..", "X.."],
    "E": ["XXX", "X..", "XX.", "X..", "XXX"],
}


def text_l(c, s, u, v, z, col, light=False):
    """Pixel text on a left-facing (v = const) face, starting at (u, v, z) = glyph top-left."""
    x0, y0 = c.P(u, v, z)
    i = 0
    for ch in s:
        g = FONT[ch]
        for r, row in enumerate(g):
            for k, px in enumerate(row):
                if px == "X":
                    xx = x0 + i + k
                    yy = y0 + r + (i + k) // 2
                    c.d.point([(xx, yy)], fill=A(col))
                    if light:
                        c.ld.point([(xx, yy)], fill=A(col))
        i += 4


def text_r(c, s, u, v, z, col, light=False):
    """Pixel text on a right-facing (u = const) face, going toward -v (screen right)."""
    x0, y0 = c.P(u, v, z)
    i = 0
    for ch in s:
        g = FONT[ch]
        for r, row in enumerate(g):
            for k, px in enumerate(row):
                if px == "X":
                    xx = x0 + i + k
                    yy = y0 + r - (i + k) // 2
                    c.d.point([(xx, yy)], fill=A(col))
                    if light:
                        c.ld.point([(xx, yy)], fill=A(col))
        i += 4


def bolt(d, x, y, s, col):
    """Lightning bolt centred at (x, y), size s (pixels ~ height/2)."""
    d.polygon([(x + s // 3, y - s), (x - s // 2, y + 1), (x, y + 1), (x - s // 3, y + s), (x + s // 2, y - 1), (x, y - 1)], fill=A(col))


def cylinder(c, u, v, z0, h, r, col, band=None, lit=False):
    """Database cylinder (the RDS/DynamoDB icon shape) standing on (u, v, z0)."""
    cx, cy = c.P(u, v, z0)
    rx, ry = max(2, round(r * HW * 1.4)), max(1, round(r * HH * 1.4))
    c.d.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=A(shade(col, 0.8)))
    c.d.rectangle((cx - rx, cy - h, cx + rx, cy), fill=A(shade(col, 0.92)))
    c.d.rectangle((cx + rx // 3, cy - h, cx + rx, cy), fill=A(shade(col, 0.76)))
    if band:
        for k in range(1, 3):
            yy = cy - h * k // 3
            c.d.arc((cx - rx, yy - ry, cx + rx, yy + ry), 0, 180, fill=A(band))
            if lit:
                c.ld.arc((cx - rx, yy - ry, cx + rx, yy + ry), 0, 180, fill=A(LIGHT))
    c.d.ellipse((cx - rx, cy - h - ry, cx + rx, cy - h + ry), fill=A(shade(col, 1.12)))
    return cx, cy - h


def pole(c, u, v, z0, z1, col=NAVY_D):
    x0, y0 = c.P(u, v, z0)
    x1, y1 = c.P(u, v, z1)
    c.d.line([(x0, y0), (x1, y1)], fill=A(col))
    return x1, y1


def dot(c, x, y, r, col, light=False):
    c.d.ellipse((x - r, y - r, x + r, y + r), fill=A(col))
    if light:
        c.ld.ellipse((x - r - 1, y - r - 1, x + r + 1, y + r + 1), fill=A(col, 200))


def ground(c, fw, fh, col, ins=0.05, z=1):
    c.box(ins, ins, fw - ins, fh - ins, 0, z, col)


# ── Database Row ─────────────────────────────────────────────────────────────

def lm_dynamodb(fw, fh, tier, col, key):
    """A classical library whose purple gable roof carries a lightning bolt (DynamoDB's speed)."""
    z1 = 16 + 5 * tier
    c = Canvas(fw, fh, z1 + 50)
    u0, v0, u1, v1 = 0.35, 0.35, fw - 0.35, fh - 0.45
    if tier >= 2:  # front steps
        c.box(u0 - 0.1, v1 - 0.1, u1 + 0.1, v1 + 0.3, 0, 2, CON_L)
        c.box(u0, v1 - 0.1, u1, v1 + 0.15, 2, 4, CON_L)
    c.box(u0, v0, u1, v1, 0, z1, STONE)
    c.windows(u0, v0, u1, v1, 4, z1 - 3, key, every=0.5, size=0.2, fh=9)
    c.box(u0 - 0.05, v0 - 0.05, u1 + 0.05, v1 + 0.05, z1, z1 + 3, shade(STONE, 0.9))
    if tier >= 2:  # columns along the front
        n = 3 + tier
        for k in range(n):
            a = u0 + 0.1 + k * (u1 - u0 - 0.26) / (n - 1)
            c.box(a, v1, a + 0.08, v1 + 0.08, 0, z1, WHITE)
    c.door(u0, u1, v1 + 0.08, col=WOOD_D, w=0.4, h=11)
    c.gable(u0 - 0.1, v0 - 0.1, u1 + 0.1, v1 + 0.1, z1 + 3, 12 + tier, col)
    # the bolt on the roof face
    x, y = c.P((u0 + u1) / 2, (v0 + v1) / 2 + (v1 - v0) / 4, z1 + 3 + (12 + tier) / 2)
    s = 4 + tier
    bolt(c.d, x, y, s, YELLOW)
    if tier >= 3:
        bolt(c.ld, x, y, s, YELLOW)
    if tier >= 3:  # book-stack wing on the right
        c.box(u1 - 0.1, v0 + 0.2, u1 + 0.25, v0 + 1.0, 0, z1 - 4, shade(STONE, 0.95))
        for zz in range(4, z1 - 6, 4):
            c.rface(u1 + 0.25, v0 + 0.3, v0 + 0.9, zz, zz + 2, [RED, (58, 111, 216), GRASS, ORANGE][zz // 4 % 4])
    if tier >= 4:  # lightning rod + glowing sign "DB"
        ax, ay = c.P((u0 + u1) / 2, (v0 + v1) / 2, z1 + 15 + tier)
        c.d.line([(ax, ay), (ax, ay - 10)], fill=A(CON_L))
        dot(c, ax, ay - 11, 1, YELLOW, light=True)
        text_l(c, "DB", u0 + 0.2, v1 + 0.08, z1 - 1, YELLOW, light=True)
    return c


def lm_rds(fw, fh, tier, col, key):
    """The records hall: a columned hall with the RDS database cylinders standing beside it."""
    z1 = 14 + 4 * tier
    c = Canvas(fw, fh, z1 + 50)
    ground(c, fw, fh, CON_L, ins=0.15, z=1)
    u0, v0, u1, v1 = 0.3, 0.3, 1.9, fh - 0.4
    c.box(u0, v0, u1, v1, 1, z1, CON_L)
    c.louvres(u0, v0, u1, v1, 1, z1 - 4, CON_L)
    c.lface(v1, u0, u1, z1 - 5, z1 - 2, col)
    c.rface(u1, v0, v1, z1 - 5, z1 - 2, shade(col, 0.8))
    c.windows(u0, v0, u1, v1, 3, z1 - 6, key, every=0.4, size=0.22, fh=8)
    c.door(u0, u1, v1, col=NAVY_D)
    c.box(u0 - 0.05, v0 - 0.05, u1 + 0.05, v1 + 0.05, z1, z1 + 2, shade(col, 0.9))
    # cylinders: the primary grows taller; tier 4 adds a Multi-AZ standby joined by a sync line
    spots = [(2.45, 2.3), (2.45, 1.4), (2.45, 0.6)]
    tops = []
    for i in range(min(tier, 3)):
        u, v = spots[i]
        tops.append(cylinder(c, u, v, 1, 12 + 3 * tier - i * 2, 0.32, (58, 111, 216) if i == 0 else col, band=WHITE, lit=True))
    if tier >= 4:
        sx, sy = cylinder(c, 1.1, 0.1, 0, 12, 0.28, CON_M, band=WHITE)
        px, py = tops[0]
        c.d.line([(sx, sy), (px, py)], fill=A(ORANGE))
        c.ld.line([(sx, sy), (px, py)], fill=A(ORANGE))
    if tier >= 3:  # a little rooftop antenna/aircon
        c.box(u0 + 0.3, v0 + 0.3, u0 + 0.8, v0 + 0.8, z1 + 2, z1 + 6, CON_M)
    return c


def lm_aurora(fw, fh, tier, col, key):
    """An observatory dome with its slit open to an aurora ribbon (Aurora)."""
    base = 10 + 3 * tier
    c = Canvas(fw, fh, base + 70)
    ins = 0.4 - 0.04 * tier
    c.box(ins, ins, fw - ins, fh - ins, 0, base, STONE)
    c.louvres(ins, ins, fw - ins, fh - ins, 0, base, STONE)
    c.windows(ins, ins, fw - ins, fh - ins, 2, base - 1, key, every=0.6, size=0.24, fh=9)
    c.door(ins, fw - ins, fh - ins, col=NAVY_D, h=9)
    x, y = c.P(fw / 2, fh / 2, base)
    rad = round((fw / 2 - ins) * HW * 0.8)
    c.d.pieslice((x - rad, y - rad, x + rad, y + rad // 2), 180, 360, fill=A(shade(col, 1.05)))
    c.d.chord((x - rad, y - rad // 4, x + rad, y + rad // 4), 0, 180, fill=A(shade(col, 0.85)))
    c.d.ellipse((x - rad // 2, y - rad + 4, x - rad // 5, y - rad + 8), fill=A(shade(col, 1.45)))
    # the slit + telescope
    c.d.polygon([(x - 2, y - rad + 1), (x + 3, y - rad + 1), (x + 3, y - 2), (x - 2, y - 2)], fill=A(NAVY_D))
    if tier >= 2:
        c.d.line([(x, y - rad // 2), (x + rad // 2 + 4, y - rad - 6)], fill=A(CON_L), width=3)
        c.ld.point([(x + rad // 2 + 4, y - rad - 6)], fill=A(LIGHT))
    # aurora ribbon: wavy bands over the dome (glows at night)
    if tier >= 1:
        bands = [(70, 230, 160), (60, 200, 230), (190, 110, 250)][: 1 + (tier >= 3) + (tier >= 4)]
        length = 30 + 12 * tier
        for bi, bc in enumerate(bands):
            for k in range(length):
                t = k / length
                xx = x - length // 2 + k
                yy = y - rad - 14 - bi * 3 + round(math.sin(t * math.pi * 2.2 + bi) * 4)
                a = int(90 + 140 * math.sin(t * math.pi))
                h = 3 + (k % 5 == 0)
                c.d.line([(xx, yy), (xx, yy + h)], fill=bc + (a,))
                c.ld.line([(xx, yy), (xx, yy + h)], fill=bc + (a,))
    if tier >= 3:  # replica domes (six copies across three AZs)
        for u, v in ((0.3, fh - 0.3), (fw - 0.3, 0.3))[: tier - 2]:
            px, py = c.P(u, v, 0)
            c.d.pieslice((px - 6, py - 7, px + 6, py + 3), 180, 360, fill=A(shade(col, 0.95)))
            c.d.rectangle((px - 6, py - 2, px + 6, py + 1), fill=A(STONE))
            c.ld.point([(px, py - 1)], fill=A(LIGHT))
    return c


def lm_elasticache(fw, fh, tier, col, key):
    """A corner café serving 'lightning cups' — in-memory answers in a flash."""
    z1 = 16 + 3 * tier
    c = Canvas(fw, fh, z1 + 40)
    ground(c, fw, fh, (214, 200, 176), ins=0.1, z=1)
    u0, v0, u1, v1 = 0.4, 0.3, fw - 0.4, 1.7
    c.box(u0, v0, u1, v1, 1, z1, (236, 222, 200))
    # big café windows (lit at night)
    for k in range(3):
        a = u0 + 0.15 + k * 0.72
        c.lface(v1, a, a + 0.5, 4, 12, GLASS, light=True)
    c.rface(u1, v0 + 0.2, v1 - 0.2, 4, 12, GLASS_D, light=True)
    c.door(u0, u1, v1, col=WOOD_D, w=0.3, h=11)
    # striped awning
    for k in range(10):
        a = u0 - 0.05 + k * (u1 - u0 + 0.1) / 10
        b = a + (u1 - u0 + 0.1) / 10
        c.poly([(a, v1, 15), (b, v1, 15), (b, v1 + 0.35, 12), (a, v1 + 0.35, 12)], col if k % 2 else WHITE)
    c.box(u0 - 0.05, v0 - 0.05, u1 + 0.05, v1 + 0.05, z1, z1 + 2, shade(col, 0.8))
    # roof sign: a giant cup with a bolt
    x, y = c.P((u0 + u1) / 2, (v0 + v1) / 2, z1 + 2)
    s = 5 + tier
    c.d.rectangle((x - s, y - 2 * s, x + s, y), fill=A(WHITE))
    c.d.ellipse((x - s, y - 2 * s - 2, x + s, y - 2 * s + 2), fill=A((120, 72, 40)))
    c.d.arc((x + s - 2, y - 2 * s + 3, x + s + 4, y - 3), 270, 90, fill=A(WHITE), width=2)
    bolt(c.d, x, y - s, max(3, s - 2), YELLOW)
    if tier >= 3:
        bolt(c.ld, x, y - s, max(3, s - 2), YELLOW)
    if tier >= 4:
        for k in range(3):  # steam
            c.d.line([(x - 3 + k * 3, y - 2 * s - 4), (x - 2 + k * 3, y - 2 * s - 9)], fill=A((230, 232, 240)))
    # outdoor tables with cups: more tables per tier
    for i in range(tier):
        u = 0.55 + (i % 2) * 1.2 + (i // 2) * 0.6
        v = 2.3 + (i // 2) * 0.35
        c.box(u, v, u + 0.3, v + 0.3, 1, 7, WOOD_D)
        c.box(u - 0.05, v - 0.05, u + 0.35, v + 0.35, 7, 8, WHITE)
        cx, cy = c.P(u + 0.15, v + 0.15, 8)
        c.d.rectangle((cx - 1, cy - 3, cx + 1, cy), fill=A(WHITE))
        c.d.point([(cx, cy - 2)], fill=A(YELLOW))
    return c


def lm_redshift(fw, fh, tier, col, key):
    """A long red-striped data warehouse; bar-chart columns grow on its face (columnar analytics)."""
    z1 = 14 + 4 * tier
    c = Canvas(fw, fh, z1 + 40)
    u0, v0, u1, v1 = 0.2, 0.35, fw - 0.2, fh - 0.35
    c.box(u0, v0, u1, v1, 0, z1, CON_L)
    c.louvres(u0, v0, u1, v1, 0, z1, CON_L)
    for k in range(2 + (tier >= 3)):  # red bands
        z = z1 - 4 - k * 5
        c.lface(v1, u0, u1, z, z + 2, RED)
        c.rface(u1, v0, v1, z, z + 2, RED_D)
    for k in range(min(tier + 1, 3)):  # loading bays
        a = 0.45 + k * 0.8
        c.lface(v1, a, a + 0.5, 0, 8, shade(CON_M, 0.9))
        for z in range(2, 8, 2):
            c.lface(v1, a, a + 0.5, z, z + 1, shade(CON_M, 0.7))
    # lit strip windows on the right face
    c.rface(u1, v0 + 0.2, v1 - 0.2, z1 - 14 if z1 > 20 else 3, (z1 - 14 if z1 > 20 else 3) + 3, GLASS_D, light=True)
    c.gable(u0 - 0.05, v0 - 0.05, u1 + 0.05, v1 + 0.05, z1, 9, shade(RED, 0.9))
    if tier >= 2:  # a truck at the dock
        c.box(0.5, fh - 0.3, 1.3, fh - 0.05, 0, 7, WHITE)
        c.box(1.3, fh - 0.3, 1.6, fh - 0.05, 0, 5, RED)
    if tier >= 3:  # rooftop bar-chart sign
        heights = [6, 10, 14, 9, 17][: 2 + tier - 1]
        for i, h in enumerate(heights):
            u = 0.7 + i * 0.35
            c.box(u, fh / 2 - 0.1, u + 0.22, fh / 2 + 0.1, z1 + 5, z1 + 5 + h, [RED, col, ORANGE, (58, 111, 216), RED][i])
        if tier >= 4:
            x, y = c.P(0.7, fh / 2, z1 + 5)
            for i, h in enumerate(heights):
                xx, yy = c.P(0.81 + i * 0.35, fh / 2, z1 + 5 + h)
                c.ld.rectangle((xx - 2, yy, xx + 2, yy + 2), fill=A(LIGHT))
    return c


def lm_neptune(fw, fh, tier, col, key):
    """A garden of glowing nodes joined by a web of edges (graph database), a trident at its heart."""
    c = Canvas(fw, fh, 70)
    c.box(0, 0, fw, 0.2, 0, 6, HEDGE)
    c.box(0, 0, 0.2, fh, 0, 6, HEDGE)
    c.box(fw - 0.2, 0, fw, fh, 0, 6, HEDGE)
    c.box(0, fh - 0.2, fw * 0.4, fh, 0, 6, HEDGE)
    c.box(fw * 0.6, fh - 0.2, fw, fh, 0, 6, HEDGE)
    r = seeded(key[:-1])  # same node layout across tiers, more of it shown
    pts = [(1.5, 1.5)]
    cands = [(0.6, 0.6), (2.4, 0.6), (0.6, 2.4), (2.4, 2.2), (1.5, 0.5), (0.5, 1.5), (2.5, 1.4), (1.2, 2.5), (1.9, 0.9), (0.9, 1.9)]
    pts += cands[: 3 + 2 * tier]
    nodes = []
    for i, (u, v) in enumerate(pts):
        h = 10 + r(8) if i else 0
        x, y = pole(c, u, v, 0, h, CON_D) if i else c.P(u, v, 0)
        nodes.append((x, y - 2))
    # edges: hub-and-spoke plus neighbours
    edges = [(0, i) for i in range(1, len(nodes))] + [(i, i + 1) for i in range(1, len(nodes) - 1, 2)]
    if tier >= 3:
        edges += [(i, i + 2) for i in range(1, len(nodes) - 2, 3)]
    web = shade(col, 1.3)
    for a, b in edges:
        c.d.line([nodes[a], nodes[b]], fill=A(web))
        if tier >= 2:
            c.ld.line([nodes[a], nodes[b]], fill=A(web, 150))
    for i, (x, y) in enumerate(nodes[1:], 1):
        dot(c, x, y, 2, [col, TEAL, ORANGE][i % 3], light=True)
    # the trident statue in the middle, on a plinth
    c.box(1.3, 1.3, 1.7, 1.7, 0, 4, STONE)
    x, y = c.P(1.5, 1.5, 4)
    th = 18 + 4 * tier
    gold = (240, 196, 70)
    c.d.line([(x, y), (x, y - th)], fill=A(gold), width=2)
    c.d.line([(x - 5, y - th + 6), (x + 5, y - th + 6)], fill=A(gold))
    for dx in (-5, 0, 5):
        c.d.line([(x + dx, y - th + 6), (x + dx, y - th - (3 if dx else 1))], fill=A(gold))
        c.d.point([(x + dx, y - th - (4 if dx else 2))], fill=A(WHITE))
    if tier >= 4:
        c.ld.line([(x, y - 4), (x, y - th)], fill=A(TEAL, 160), width=2)
        c.ld.line([(x - 5, y - th + 6), (x + 5, y - th + 6)], fill=A(TEAL))
    return c


# ── Network Junction ─────────────────────────────────────────────────────────

def lm_vpc(fw, fh, tier, col, key):
    """A walled garden (your private network) with a gate; hedged rooms inside are its subnets."""
    c = Canvas(fw, fh, 60)
    wall = CON_M
    h = 8 + tier
    t = 0.18
    c.box(0, 0, fw, t, 0, h, wall)
    c.box(0, 0, t, fh, 0, h, wall)
    c.box(fw - t, 0, fw, fh, 0, h, wall)
    c.box(0, fh - t, 1.2, fh, 0, h, wall)
    c.box(1.8, fh - t, fw, fh, 0, h, wall)
    # crenellations on the front walls
    for k in range(0, 6):
        a = k * 0.2
        if k % 2 == 0:
            c.box(a, fh - t, a + 0.2, fh, h, h + 2, wall)
            c.box(1.8 + a, fh - t, 2.0 + a, fh, h, h + 2, wall)
    # subnet hedges: a cross splitting the garden into rooms (more rooms per tier)
    c.box(fw / 2 - 0.08, t, fw / 2 + 0.08, fh - 0.9, 0, 5, HEDGE)
    if tier >= 2:
        c.box(t, fh / 2 - 0.08, fw / 2 - 0.25, fh / 2 + 0.08, 0, 5, HEDGE)
    if tier >= 3:
        c.box(fw / 2 + 0.25, fh / 2 - 0.08, fw - t, fh / 2 + 0.08, 0, 5, HEDGE)
    # rooms: public subnet (tree), private subnet (a small locked shed)
    tree, anchor, _, _ = PACKIMG["tree"]
    c.stamp(tree, 0.75, 0.75, anchor)
    c.box(1.85, 0.4, 2.55, 1.1, 0, 10, shade(col, 1.1))
    c.gable(1.8, 0.35, 2.6, 1.15, 10, 5, NAVY)
    lx, ly = c.P(2.2, 1.1, 5)
    c.d.rectangle((lx - 1, ly - 2, lx + 1, ly), fill=A(YELLOW))
    c.ld.rectangle((lx - 1, ly - 2, lx + 1, ly), fill=A(YELLOW))
    if tier >= 2:
        c.stamp(tree, 0.75, 2.0, anchor)
    if tier >= 3:
        c.box(2.0, 1.8, 2.5, 2.3, 0, 7, (58, 111, 216))
        c.windows(2.0, 1.8, 2.5, 2.3, 1, 7, key, every=0.25, size=0.12, fh=5)
    # the gate (Internet Gateway): posts + arch in the district colour
    for u in (1.15, 1.8):
        c.box(u, fh - 0.25, u + 0.1, fh + 0.02, 0, h + 8, col)
    x0, y0 = c.P(1.2, fh - 0.1, h + 8)
    x1, y1 = c.P(1.85, fh - 0.1, h + 8)
    c.d.line([(x0, y0), ((x0 + x1) // 2, (y0 + y1) // 2 - 4), (x1, y1)], fill=A(col), width=2)
    for u in (1.3, 1.45, 1.6):  # gate bars
        c.box(u, fh - 0.12, u + 0.03, fh - 0.09, 0, h + 2, ORANGE if tier >= 2 else NAVY_D)
    # gate lanterns
    for u in (1.2, 1.85):
        x, y = c.P(u, fh - 0.1, h + 10)
        dot(c, x, y, 1, BULB, light=True)
    if tier >= 4:  # watchtowers on the corners
        for u, v in ((0, 0), (fw - 0.5, 0), (0, fh - 0.5)):
            c.box(u, v, u + 0.5, v + 0.5, 0, h + 12, shade(wall, 0.9))
            c.pyramid(u - 0.03, v - 0.03, u + 0.53, v + 0.53, h + 12, 7, col)
    return c


def lm_route53(fw, fh, tier, col, key):
    """A dance hall with a bulb-lit '53' marquee; tier 3 hangs a disco ball, tier 4 sweeps spotlights."""
    z1 = 18 + 4 * tier
    c = Canvas(fw, fh, z1 + 60)
    u0, v0, u1, v1 = 0.3, 0.3, fw - 0.3, fh - 0.5
    c.box(u0, v0, u1, v1, 0, z1, shade(col, 0.55))
    c.box(u0 - 0.05, v0 - 0.05, u1 + 0.05, v1 + 0.05, z1, z1 + 3, shade(col, 0.9))
    # round windows glowing pink/purple
    for k in range(3):
        u = u0 + 0.35 + k * 0.75
        c.lface(v1, u, u + 0.28, 10, 16, (255, 150, 220), light=True)
    c.rface(u1, v0 + 0.3, v0 + 0.6, 10, 16, (220, 140, 255), light=True)
    c.rface(u1, v0 + 1.1, v0 + 1.4, 10, 16, (220, 140, 255), light=True)
    c.door(u0, u1, v1, col=NAVY_D, w=0.5, h=9)
    # marquee canopy over the door
    c.box(u0 + 0.8, v1, u1 - 0.8, v1 + 0.4, 9, 11, ORANGE)
    # the marquee board on the front roof edge
    mz = z1 + 3
    mw = 1.3
    ma = (u0 + u1) / 2 - mw / 2
    c.lface(v1 + 0.05, ma, ma + mw, mz, mz + 11, NAVY_D)
    text_l(c, "53", ma + 0.42, v1 + 0.05, mz + 8, YELLOW, light=True)
    # chasing bulbs around the board
    nb = 6 + 2 * tier
    for k in range(nb + 1):
        uu = ma + k * mw / nb
        for zz in (mz, mz + 11):
            x, y = c.P(uu, v1 + 0.05, zz)
            c.d.point([(x, y)], fill=A(BULB))
            c.ld.point([(x, y)], fill=A(BULB))
    if tier >= 2:  # dance-floor tiles out front
        for i in range(4):
            for j in range(2):
                u = 0.6 + i * 0.45
                v = fh - 0.45 + j * 0.2
                cc = [(255, 90, 170), (90, 200, 255), YELLOW, (140, 255, 140)][(i + j) % 4]
                c.poly([(u, v, 0.5), (u + 0.4, v, 0.5), (u + 0.4, v + 0.18, 0.5), (u, v + 0.18, 0.5)], cc)
                if tier >= 3:
                    c.poly([(u, v, 0.5), (u + 0.4, v, 0.5), (u + 0.4, v + 0.18, 0.5), (u, v + 0.18, 0.5)], cc, c.ld)
    if tier >= 3:  # disco ball on the roof
        x, y = c.P(fw / 2 + 0.3, fh / 2 - 0.3, z1 + 3)
        c.d.line([(x, y), (x, y - 8)], fill=A(CON_D))
        c.d.ellipse((x - 5, y - 18, x + 5, y - 8), fill=A((200, 206, 220)))
        for (dx, dy) in ((-2, -15), (2, -12), (-1, -10), (3, -16)):
            c.d.point([(x + dx, y + dy)], fill=A(WHITE))
            c.ld.point([(x + dx, y + dy)], fill=A(WHITE))
    if tier >= 4:  # spotlight beams into the sky
        for (u, v, dx) in ((u0 + 0.2, v0 + 0.2, -14), (u1 - 0.2, v0 + 0.2, 14)):
            x, y = c.P(u, v, z1 + 3)
            c.d.rectangle((x - 1, y - 3, x + 1, y), fill=A(CON_D))
            beam = [(x - 1, y - 3), (x + 1, y - 3), (x + dx + 3, y - 36), (x + dx - 3, y - 36)]
            c.d.polygon(beam, fill=(255, 250, 200, 70))
            c.ld.polygon(beam, fill=(255, 250, 200, 110))
    return c


def globe(c, x, y, r, col, light=False):
    c.d.ellipse((x - r, y - r, x + r, y + r), fill=A((80, 160, 230)))
    c.d.ellipse((x - r + 2, y - r + 2, x - 1, y - 1), fill=A((110, 200, 110)))  # a continent
    c.d.ellipse((x - r, y - r, x + r, y + r), outline=A(WHITE))
    c.d.ellipse((x - r // 2, y - r, x + r // 2, y + r), outline=A(WHITE))
    c.d.line([(x - r, y), (x + r, y)], fill=A(WHITE))
    if light:
        c.ld.ellipse((x - r, y - r, x + r, y + r), outline=A((180, 230, 255)))
        c.ld.line([(x - r, y), (x + r, y)], fill=A((180, 230, 255)))


def lm_cloudfront(fw, fh, tier, col, key):
    """The edge post office: a globe on the roof, mailboxes out front, parcels heading everywhere."""
    z1 = 16 + 4 * tier
    c = Canvas(fw, fh, z1 + 60)
    u0, v0, u1, v1 = 0.35, 0.3, fw - 0.35, fh - 0.55
    c.box(u0, v0, u1, v1, 0, z1, (232, 214, 180))
    c.windows(u0, v0, u1, v1, 4, z1 - 5, key, every=0.55, size=0.26, fh=10)
    c.lface(v1, u0, u1, z1 - 5, z1 - 2, col)
    c.rface(u1, v0, v1, z1 - 5, z1 - 2, shade(col, 0.8))
    c.door(u0, u1, v1, col=(58, 111, 216), w=0.45, h=11)
    c.box(u0 - 0.06, v0 - 0.06, u1 + 0.06, v1 + 0.06, z1, z1 + 3, shade(col, 0.85))
    # the globe on a pedestal
    x, y = c.P((u0 + u1) / 2, (v0 + v1) / 2, z1 + 3)
    r = 6 + 2 * tier
    c.d.rectangle((x - 2, y - 5, x + 2, y), fill=A(CON_D))
    globe(c, x, y - 5 - r, r, col, light=tier >= 2)
    if tier >= 3:  # orbit ring of delivery routes
        c.d.arc((x - r - 5, y - 5 - r - 3, x + r + 5, y - 5 - r + 3), 0, 180, fill=A(ORANGE))
        c.ld.arc((x - r - 5, y - 5 - r - 3, x + r + 5, y - 5 - r + 3), 0, 180, fill=A(ORANGE))
    # red mailboxes out front (one per tier)
    for i in range(tier):
        u = 0.5 + i * 0.55
        c.box(u, fh - 0.4, u + 0.2, fh - 0.2, 0, 8, RED)
        c.box(u - 0.02, fh - 0.42, u + 0.22, fh - 0.18, 8, 9, RED_D)
    if tier >= 2:  # parcel pile at the side
        for i in range(2 + tier):
            u = fw - 0.3 - (i % 2) * 0.25
            v = 0.9 + (i // 2) * 0.28
            c.box(u - 0.2, v, u, v + 0.22, (i // 4) * 4, (i // 4) * 4 + 4, (206, 150, 86))
    if tier >= 4:  # edge antenna
        ax, ay = c.P(u0 + 0.3, v0 + 0.3, z1 + 3)
        c.d.line([(ax, ay), (ax, ay - 16)], fill=A(CON_L))
        dot(c, ax, ay - 17, 1, RED, light=True)
    return c


def lm_apigateway(fw, fh, tier, col, key):
    """A railway station behind a grand arch — the front door every request walks through."""
    z1 = 14 + 3 * tier
    c = Canvas(fw, fh, z1 + 60)
    # platform + tracks at the back
    c.box(0.1, 0.1, fw - 0.1, 0.9, 0, 2, CON_M)
    for v in (0.3, 0.7):
        c.line((0.1, v, 2), (fw - 0.1, v, 2), (120, 110, 100))
    # station hall
    u0, v0, u1, v1 = 0.3, 0.9, fw - 0.3, fh - 0.7
    c.box(u0, v0, u1, v1, 0, z1, CON_L)
    c.windows(u0, v0, u1, v1, 3, z1 - 3, key, every=0.5, size=0.24, fh=8)
    c.box(u0 - 0.05, v0 - 0.05, u1 + 0.05, v1 + 0.05, z1, z1 + 2, shade(col, 0.85))
    c.poly([(u0, v0, z1 + 2), (u1, v0, z1 + 2), (u1, v1, z1 + 2), (u0, v1, z1 + 2)], shade(col, 0.7))
    # the big arch in front of the hall
    av = fh - 0.35
    ah = z1 + 12 + 3 * tier
    for u in (0.55, fw - 0.75):
        c.box(u, av - 0.1, u + 0.2, av + 0.1, 0, ah - 6, col)
    x0, y0 = c.P(0.65, av, ah - 6)
    x1, y1 = c.P(fw - 0.65, av, ah - 6)
    mx, my = (x0 + x1) // 2, (y0 + y1) // 2
    rise = 10 + 2 * tier
    pts = []
    for k in range(21):
        t = k / 20
        pts.append((round(x0 + (x1 - x0) * t), round(y0 + (y1 - y0) * t - math.sin(t * math.pi) * rise)))
    c.d.line(pts, fill=A(col), width=4)
    c.d.line([(p[0], p[1] - 2) for p in pts], fill=A(shade(col, 1.3)), width=1)
    # sign on the arch keystone
    c.d.rectangle((mx - 7, my - rise - 6, mx + 7, my - rise + 1), fill=A(NAVY_D))
    text_l(c, "API", 0, 0, 0, NAVY_D)  # no-op placement guard (keeps glyph table used)
    xx = mx - 5
    for i, ch in enumerate("API"):
        for r, row in enumerate(FONT[ch]):
            for k, px in enumerate(row):
                if px == "X":
                    c.d.point([(xx + i * 4 + k, my - rise - 5 + r)], fill=A(YELLOW))
                    if tier >= 2:
                        c.ld.point([(xx + i * 4 + k, my - rise - 5 + r)], fill=A(YELLOW))
    if tier >= 2:  # station clock on the hall
        x, y = c.P(fw / 2, v1, z1 - 4)
        c.d.ellipse((x - 4, y - 4, x + 4, y + 4), fill=A(WHITE), outline=A(NAVY_D))
        c.d.line([(x, y), (x, y - 3)], fill=A(NAVY_D))
        c.d.line([(x, y), (x + 2, y)], fill=A(NAVY_D))
    if tier >= 3:  # a train waiting at the platform
        c.box(0.3, 0.35, 2.2, 0.65, 2, 10, col)
        for k in range(4):
            c.lface(0.65, 0.45 + k * 0.45, 0.7 + k * 0.45, 5, 8, GLASS, light=True)
        c.box(2.2, 0.35, 2.5, 0.65, 2, 8, ORANGE)
    if tier >= 4:  # arch lamps
        for u in (0.65, fw - 0.65):
            x, y = c.P(u, av, ah - 6)
            dot(c, x, y - 2, 2, BULB, light=True)
    return c


def lm_sqs(fw, fh, tier, col, key):
    """A bell tower (SNS: ring once, everyone hears) above a conveyor queue of parcels (SQS)."""
    h = 30 + 10 * tier
    c = Canvas(fw, fh, h + 40)
    cu, cv, s = 1.9, 1.1, 0.5
    # the queue: a conveyor belt running to the tower with parcels waiting in line
    c.box(0.15, 1.9, 2.3, 2.35, 0, 5, CON_D, top=NAVY)
    for k in range(9):
        x0, y0 = c.P(0.2 + k * 0.24, 1.9, 5)
        x1, y1 = c.P(0.2 + k * 0.24, 2.35, 5)
        c.d.line([(x0, y0), (x1, y1)], fill=A(CON_M))
    n = 1 + tier
    for i in range(n):
        u = 0.25 + i * 0.4
        cc = [(206, 150, 86), shade(col, 1.2), (206, 150, 86), ORANGE, (206, 150, 86)][i % 5]
        c.box(u, 1.98, u + 0.3, 2.28, 5, 10, cc)
        x, y = c.P(u + 0.15, 2.28, 8)
        c.d.line([(x - 2, y), (x + 2, y + 1)], fill=A(shade(cc, 0.6)))
    # the tower
    c.box(cu - s, cv - s, cu + s, cv + s, 0, h, STONE)
    c.windows(cu - s, cv - s, cu + s, cv + s, 6, h - 16, key, every=0.5, size=0.2, fh=9)
    c.door(cu - s, cu + s, cv + s, col=WOOD_D)
    # open belfry
    bz = h - 14
    for (u, v) in ((cu - s, cv + s - 0.12), (cu + s - 0.12, cv + s - 0.12), (cu + s - 0.12, cv - s)):
        c.box(u, v, u + 0.12, v + 0.12, bz, h, STONE)
    c.lface(cv + s, cu - s + 0.12, cu + s - 0.12, bz, h - 1, NAVY_D)
    c.rface(cu + s, cv - s + 0.12, cv + s - 0.12, bz, h - 1, shade(NAVY_D, 0.8))
    x, y = c.P(cu + 0.1, cv + 0.1, bz + 2)
    gold = (240, 196, 70)
    c.d.polygon([(x - 2, y - 9), (x + 2, y - 9), (x + 4, y - 2), (x + 5, y), (x - 5, y), (x - 4, y - 2)], fill=A(gold))
    c.d.point([(x, y + 1)], fill=A(gold))
    c.ld.polygon([(x - 2, y - 9), (x + 2, y - 9), (x + 4, y - 2), (x + 5, y), (x - 5, y), (x - 4, y - 2)], fill=A(gold, 160))
    c.box(cu - s - 0.05, cv - s - 0.05, cu + s + 0.05, cv + s + 0.05, h, h + 2, col)
    c.pyramid(cu - s - 0.05, cv - s - 0.05, cu + s + 0.05, cv + s + 0.05, h + 2, 14, col)
    if tier >= 3:  # ringing: sound arcs (fan-out)
        for k in range(tier - 2 + 1):
            rr = 9 + k * 4
            c.d.arc((x - rr - 6, y - 4 - rr, x - 6 + rr // 3, y - 4 + rr), 120, 240, fill=A(YELLOW))
            c.d.arc((x + 6 - rr // 3, y - 4 - rr, x + rr + 6, y - 4 + rr), 300, 60, fill=A(YELLOW))
    if tier >= 2:  # a dead-letter bin at the end of the belt
        c.box(2.35, 1.95, 2.75, 2.35, 0, 7, (120, 70, 150) if tier < 4 else RED_D)
    if tier >= 4:
        px, py = c.P(cu, cv, h + 16)
        c.d.line([(px, py), (px, py - 6)], fill=A(CON_L))
        dot(c, px, py - 7, 1, YELLOW, light=True)
    return c


def signal_post(c, u, v, h, lights, lit_idx):
    x, y = pole(c, u, v, 0, h, CON_D)
    c.d.rectangle((x - 2, y - 2 - 4 * len(lights), x + 2, y), fill=A(NAVY_D))
    for i, lc in enumerate(lights):
        yy = y - 3 - i * 4
        on = i == lit_idx
        c.d.rectangle((x - 1, yy, x + 1, yy + 2), fill=A(lc if on else shade(lc, 0.35)))
        if on:
            c.ld.rectangle((x - 2, yy - 1, x + 2, yy + 3), fill=A(lc))


def lm_eventbridge(fw, fh, tier, col, key):
    """A railway crossing of event lines; signals route each event down the matching track (rules)."""
    c = Canvas(fw, fh, 80)
    # gravel bed + two crossing tracks
    c.box(0.05, 1.1, fw - 0.05, 1.9, 0, 1, (170, 160, 150))
    c.box(1.1, 0.05, 1.9, fh - 0.05, 0, 1, (170, 160, 150))
    for v in (1.3, 1.7):
        c.line((0.05, v, 1), (fw - 0.05, v, 1), (110, 100, 96))
    for u in (1.3, 1.7):
        c.line((u, 0.05, 1), (u, fh - 0.05, 1), (110, 100, 96))
    for k in range(10):
        a = 0.1 + k * 0.29
        if not 1.05 < a < 1.95:
            c.line((a, 1.2, 1), (a, 1.8, 1), WOOD_D)
            c.line((1.2, a, 1), (1.8, a, 1), WOOD_D)
    # a turntable/switch disc at the crossing (EventBridge's hub)
    x, y = c.P(1.5, 1.5, 1)
    c.d.ellipse((x - 9, y - 4, x + 9, y + 4), outline=A(col))
    c.ld.ellipse((x - 9, y - 4, x + 9, y + 4), outline=A(col))
    # the signal box
    c.box(0.2, 0.2, 0.95, 0.95, 0, 14 + 2 * tier, (196, 170, 150))
    c.lface(0.95, 0.3, 0.85, 7, 12, GLASS, light=True)
    c.rface(0.95, 0.3, 0.85, 7, 12, GLASS_D, light=True)
    c.gable(0.15, 0.15, 1.0, 1.0, 14 + 2 * tier, 7, col)
    # signals: one per tier-ish, lit different aspects
    GREEN, AMBER = (80, 230, 120), (255, 180, 40)
    posts = [(2.2, 2.2, 0), (0.8, 2.2, 2), (2.2, 0.8, 1), (2.6, 2.6, 0)]
    for i in range(min(tier, 3)):
        u, v, lit = posts[i]
        signal_post(c, u, v, 20 + 2 * i, [GREEN, AMBER, RED], lit)
    if tier >= 2:  # crossing barrier arm (red/white)
        x0, y0 = pole(c, 0.95, 2.05, 0, 8, CON_D)
        for k in range(6):
            c.d.line([(x0 + k * 3, y0 - k), (x0 + k * 3 + 3, y0 - k - 1)], fill=A(RED if k % 2 else WHITE), width=2)
    if tier >= 4:  # a signal gantry spanning the line
        c.box(2.3, 0.9, 2.45, 1.05, 0, 34, CON_D)
        c.box(2.3, 1.95, 2.45, 2.1, 0, 34, CON_D)
        c.box(2.3, 0.9, 2.45, 2.1, 34, 37, NAVY)
        for i, lc in enumerate([GREEN, AMBER, (80, 160, 255)]):
            x, y = c.P(2.45, 1.2 + i * 0.3, 32)
            c.d.rectangle((x - 2, y - 4, x + 2, y), fill=A(NAVY_D))
            c.d.rectangle((x - 1, y - 3, x + 1, y - 1), fill=A(lc))
            c.ld.rectangle((x - 2, y - 4, x + 2, y), fill=A(lc))
    # a little event train on the line
    if tier >= 3:
        c.box(1.25, 2.3, 1.75, 2.9, 1, 8, col)
        c.box(1.25, 2.3, 1.75, 2.45, 8, 10, ORANGE)
        c.rface(1.75, 2.45, 2.8, 4, 6, GLASS_D, light=True)
    return c
