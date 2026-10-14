"""
The landscape round the city (src/world/terrain.ts, src/game/Landscape.ts): countryside ground per biome, fields,
the highway, shore / cliff / quay edge slabs, bridges, the gate arch, highway signs, a lighthouse, a pier, a farmhouse,
wind turbines, single trees and rocks, and 2×2 / 3×3 forest clumps and 3×3 hills for four biomes.

The AZ islands (plan B4): a concrete pad (azPad), substation2x2, coolingTower, fenceX/fenceY and azSign.

Called from generate_tiles.main as landscape_art.build(add). The sea is not in the atlas: sea.png and seaGlint.png
are standalone seamless textures (write_sea) that the game tiles across the whole map.
Same construction and palette as the rest of the city: 32×16 tiles, dark navy outlines, AWS navy + orange.
"""
import math
import os

from PIL import Image, ImageDraw

from generate_tiles import (A, ASPHALT, CLEAR, CON_D, CON_L, CON_M, GLASS, GLASS_D, GRASS, GRASS_D, HH, HW, NAVY, NAVY_D,  # noqa: F401
                            ORANGE, ORANGE_D, WHITE, WOOD, WOOD_D, Canvas, ground, seeded, shade, specks)
from landmarks_aws_a import cyl

# The sea: deeper than the city's lake water. src/game/palette.ts SEA_COLOR must match SEA.
SEA = (46, 120, 188)
SEA_L = (88, 164, 222)
SAND = (230, 212, 164)
WET_SAND = (196, 176, 128)
EARTH = (132, 96, 66)
ROCK = (128, 132, 138)
SNOW = (236, 242, 248)
LIT = (255, 214, 120)
RED = (200, 70, 56)

BIOMES = ("temperate", "boreal", "arid", "tropical")
MEADOW = {"temperate": (82, 160, 78), "boreal": (86, 124, 92), "arid": (204, 172, 116), "tropical": (54, 162, 84)}


# ── ground ────────────────────────────────────────────────────────────────────

def rows_deco(col, axis="u", n=4):
    def f(c, r):
        for k in range(n):
            t = (k + 0.5) / n
            a, b = ((t, 0.04), (t, 0.96)) if axis == "u" else ((0.04, t), (0.96, t))
            c.d.line([c.P(*a), c.P(*b)], fill=A(col))
    return f


def meadow_deco(biome, rich):
    base = MEADOW[biome]

    def f(c, r):
        specks(shade(base, 1.16), 5)(c, r)
        specks(shade(base, 0.84), 4)(c, r)
        if not rich:
            return
        for _ in range(5):
            x, y = c.P((r(70) + 15) / 100, (r(70) + 15) / 100)
            if biome == "boreal":
                c.d.rectangle((x, y, x + 2, y), fill=A(SNOW))
            elif biome == "arid":
                c.d.point([(x, y), (x + 1, y)], fill=A((150, 140, 80)))
            else:
                c.d.point([(x, y)], fill=A([(250, 250, 250), (255, 204, 60), (240, 110, 150)][r(3)]))
    return f


def highway_deco(axis):
    def f(c, r):
        specks(shade(ASPHALT, 0.86), 4)(c, r)
        for t in (0.1, 0.9):  # solid edge lines
            a, b = ((0, t), (1, t)) if axis == "x" else ((t, 0), (t, 1))
            c.d.line([c.P(*a), c.P(*b)], fill=A(WHITE))
        for k in range(2):  # dashed centre line
            s, e = k * 0.5 + 0.1, k * 0.5 + 0.35
            a, b = ((s, 0.5), (e, 0.5)) if axis == "x" else ((0.5, s), (0.5, e))
            c.d.line([c.P(*a), c.P(*b)], fill=A((250, 220, 120)))
    return f


def slab(name, side, layers):
    """An edge face hanging below a tile's SW (L: v = 1) or SE (R: u = 1) edge, top layer first: [(depth, colour)]."""
    c = Canvas(1, 1, 0, pad=0)
    total = sum(d for d, _ in layers)
    c.h += total + 2
    c.img = Image.new("RGBA", (c.w, c.h), CLEAR)
    c.d = ImageDraw.Draw(c.img)
    z = 0
    for d, col in layers:
        col = shade(col, 0.9 if side == "L" else 0.74)
        if side == "L":
            c.poly([(0, 1, -z), (1, 1, -z), (1, 1, -z - d), (0, 1, -z - d)], col)
        else:
            c.poly([(1, 1, -z), (1, 0, -z), (1, 0, -z - d), (1, 1, -z - d)], col)
        z += d
    # a foam line where it meets the water
    if side == "L":
        c.d.line([c.P(0.05, 1, -total), c.P(0.95, 1, -total)], fill=A(SEA_L))
    else:
        c.d.line([c.P(1, 0.95, -total), c.P(1, 0.05, -total)], fill=A(SEA_L))
    return c


def quay_joints(c, side, depth):
    for k in range(1, 4):
        t = k / 4
        a, b = ((t, 1, 0), (t, 1, -depth)) if side == "L" else ((1, t, 0), (1, t, -depth))
        c.line(a, b, shade(CON_D, 0.9))


def build_ground(add):
    ground("field0", (120, 168, 64), rows_deco((62, 112, 40), "u", 5))
    ground("field1", (226, 172, 66), rows_deco((176, 118, 44), "v", 5))
    for b in BIOMES:
        ground(f"meadow:{b}:0", MEADOW[b], meadow_deco(b, False))
        ground(f"meadow:{b}:1", shade(MEADOW[b], 0.94), meadow_deco(b, True))
    ground("shingle", (150, 150, 146), specks((120, 120, 118), 9))
    ground("highwayX", shade(ASPHALT, 0.9), highway_deco("x"))
    ground("highwayY", shade(ASPHALT, 0.9), highway_deco("y"))
    for side in ("L", "R"):
        add(f"shore{side}", slab(f"shore{side}", side, [(2, SAND), (2, WET_SAND)]), do_outline=False)
        add(f"cliff{side}", slab(f"cliff{side}", side, [(2, GRASS_D), (5, EARTH), (3, ROCK)]), do_outline=False)
        q = slab(f"quay{side}", side, [(1, CON_L), (6, CON_M)])
        quay_joints(q, side, 7)
        add(f"quay{side}", q, do_outline=False)


# ── trees and small nature ────────────────────────────────────────────────────

def tree_round(c, u, v, s=1.0, col=(80, 180, 88)):
    x, y = c.P(u, v)
    c.d.rectangle((x - 1, y - round(10 * s), x, y), fill=A((112, 78, 48)))
    for dx, dy, rr in [(0, -15, 7), (-5, -11, 5), (5, -11, 5), (0, -20, 5)]:
        rr = max(2, round(rr * s))
        cx, cy = x + round(dx * s), y + round(dy * s)
        c.d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=A(col))
    c.d.ellipse((x - round(4 * s), y - round(21 * s), x - round(1 * s), y - round(18 * s)), fill=A(shade(col, 1.3)))
    c.d.ellipse((x + round(2 * s), y - round(12 * s), x + round(7 * s), y - round(8 * s)), fill=A(shade(col, 0.8)))


def tree_pine(c, u, v, s=1.0, snow=False):
    x, y = c.P(u, v)
    c.d.rectangle((x - 1, y - 4, x, y), fill=A((100, 70, 44)))
    for k, (w, yy) in enumerate([(8, -6), (6, -13), (4, -20)]):
        w, yy = round(w * s), round(yy * s)
        col = shade(GRASS_D, 1 + k * 0.1)
        c.d.polygon([(x - w, y + yy), (x + w, y + yy), (x, y + yy - round(9 * s))], fill=A(col))
        c.d.polygon([(x, y + yy), (x + w, y + yy), (x, y + yy - round(9 * s))], fill=A(shade(col, 0.82)))
        if snow:
            c.d.polygon([(x - w // 2, y + yy - round(4 * s)), (x + w // 2, y + yy - round(4 * s)), (x, y + yy - round(9 * s))], fill=A(SNOW))


def tree_palm(c, u, v, s=1.0):
    x, y = c.P(u, v)
    top = (x + round(3 * s), y - round(20 * s))
    for k in range(6):  # a gently leaning trunk
        t = k / 5
        px, py = round(x + (top[0] - x) * t * t), round(y + (top[1] - y) * t)
        c.d.rectangle((px - 1, py - 2, px, py), fill=A((150, 112, 70) if k % 2 else (124, 90, 56)))
    for ang in (200, 245, 290, 335, 20):
        a = math.radians(ang)
        ex, ey = top[0] + round(math.cos(a) * 9 * s), top[1] + round(math.sin(a) * 5 * s) + 3
        c.d.line([top, ((top[0] + ex) // 2, min(top[1], ey) - 2), (ex, ey)], fill=A((52, 150, 70)), width=2)
    c.d.ellipse((top[0] - 2, top[1] - 1, top[0] + 1, top[1] + 2), fill=A((120, 84, 40)))


def cactus(c, u, v, s=1.0):
    x, y = c.P(u, v)
    g, gd = (88, 150, 76), (60, 112, 56)
    h = round(16 * s)
    c.d.rectangle((x - 2, y - h, x + 1, y), fill=A(g))
    c.d.rectangle((x, y - h, x + 1, y), fill=A(gd))
    c.d.rectangle((x - 6, y - round(11 * s), x - 4, y - round(5 * s)), fill=A(g))
    c.d.rectangle((x - 6, y - round(6 * s), x - 2, y - round(5 * s)), fill=A(g))
    c.d.rectangle((x + 3, y - round(13 * s), x + 5, y - round(8 * s)), fill=A(gd))
    c.d.rectangle((x + 1, y - round(9 * s), x + 5, y - round(8 * s)), fill=A(gd))


def shrub(c, u, v, col):
    x, y = c.P(u, v)
    for dx, rr in ((-3, 3), (3, 3), (0, 4)):
        c.d.ellipse((x + dx - rr, y - 4 - rr, x + dx + rr, y - 4 + rr), fill=A(col))


def boulder(c, u, v, s=1.0):
    x, y = c.P(u, v)
    w, h = round(6 * s), round(5 * s)
    c.d.polygon([(x - w, y), (x - w + 1, y - h + 1), (x - 1, y - h - 1), (x + w - 1, y - h + 2), (x + w, y)], fill=A(ROCK))
    c.d.polygon([(x, y), (x - 1, y - h - 1), (x + w - 1, y - h + 2), (x + w, y)], fill=A(shade(ROCK, 0.78)))
    c.d.point([(x - w + 2, y - h + 2)], fill=A(shade(ROCK, 1.25)))


def tree_for(biome, c, u, v, s, r):
    if biome == "boreal":
        tree_pine(c, u, v, s, snow=r(3) > 0)
    elif biome == "arid":
        (cactus if r(3) == 0 else (lambda c_, u_, v_, s_: shrub(c_, u_, v_, (120, 140, 70))))(c, u, v, s)
    elif biome == "tropical":
        (tree_palm if r(2) == 0 else (lambda c_, u_, v_, s_: tree_round(c_, u_, v_, s_, (40, 160, 80))))(c, u, v, s)
    elif r(3) == 0:
        tree_pine(c, u, v, s)
    else:
        tree_round(c, u, v, s, [(80, 180, 88), (96, 170, 72), (70, 160, 92)][r(3)])


def build_nature(add):
    for name, draw in (("pineSnow", lambda c: tree_pine(c, 0.5, 0.5, 1.3, snow=True)), ("palm", lambda c: tree_palm(c, 0.5, 0.5, 1.2)),
                       ("cactus", lambda c: cactus(c, 0.5, 0.5, 1.2)), ("rock", lambda c: boulder(c, 0.5, 0.5, 1.3))):
        c = Canvas(1, 1, 40)
        draw(c)
        add(name, c, lights=False)
    for b in BIOMES:
        for n in (2, 3):
            c = Canvas(n, n, 44)
            r = seeded(f"forest{n}{b}")
            # a darker floor under the canopy
            c.poly([(0.15, 0.15), (n - 0.15, 0.15), (n - 0.15, n - 0.15), (0.15, n - 0.15)], shade(MEADOW[b], 0.78))
            spots = []
            for i in range(n * 2):
                for j in range(n * 2):
                    spots.append(((i + 0.5) / 2 + (r(20) - 10) / 100, (j + 0.5) / 2 + (r(20) - 10) / 100))
            spots = [p for k, p in enumerate(spots) if r(5) > 0 or k % 3 == 0]
            for u, v in sorted(spots, key=lambda p: p[0] + p[1]):
                tree_for(b, c, u, v, 0.85 + r(30) / 100, r)
            add(f"forest{n}x{n}:{b}", c, lights=False)
        add(f"hill3x3:{b}", hill(b), lights=False)


def hill(biome):
    """A rounded mound: stacked screen-space ellipses, lit from the left, with a cap per biome."""
    c = Canvas(3, 3, 60)
    top = {"temperate": (96, 172, 84), "boreal": (100, 132, 104), "arid": (204, 156, 100), "tropical": (60, 160, 80)}[biome]
    cx, cy = c.P(1.5, 1.5)
    rx0, ry0 = 44, 22
    height = 30 if biome != "arid" else 22
    steps = 12
    for k in range(steps + 1):
        t = k / steps
        rx = round(rx0 * (1 - t * 0.78)) if biome != "arid" else round(rx0 * (1 - t * 0.35))
        ry = max(2, round(ry0 * (1 - t * 0.78))) if biome != "arid" else round(ry0 * (1 - t * 0.35))
        y = cy - round(height * t)
        col = shade(top, 0.78 + 0.28 * t)
        if biome == "boreal" and t > 0.6:
            col = shade(SNOW, 0.9 + 0.1 * t)
        c.d.ellipse((cx - rx, y - ry, cx + rx, y + ry), fill=A(col))
        # the shaded (east) flank
        c.d.pieslice((cx - rx, y - ry, cx + rx, y + ry), -60, 80, fill=A(shade(col, 0.82)))
    r = seeded(f"hill{biome}")
    if biome in ("temperate", "tropical"):
        for _ in range(3):
            tree_for(biome, c, 1.0 + r(60) / 100, 1.9 + r(50) / 100, 0.7, r)
    elif biome == "arid":
        for k in range(1, 4):  # mesa strata
            y = cy - round(height * k / 4)
            c.d.line([(cx - round(rx0 * (1 - 0.35 * k / 4)) + 2, y), (cx + round(rx0 * (1 - 0.35 * k / 4)) - 2, y)], fill=A(shade(top, 1.15)))
    return c


# ── structures ────────────────────────────────────────────────────────────────

def build_structures(add):
    for axis in ("X", "Y", "Highway"):
        c = Canvas(1, 1, 30)
        wide = axis == "Highway"
        lo, hi = (0.04, 0.96) if wide else (0.14, 0.86)
        along_u = axis != "Y"
        # piers into the water, then the deck and its rails
        if along_u:
            c.box(0.4, lo + 0.06, 0.6, hi - 0.06, -10, 0, CON_M)
            c.box(0, lo, 1, hi, 0, 3, CON_L, top=shade(ASPHALT, 0.95 if wide else 1))
            c.line((0.1, 0.5, 3), (0.4, 0.5, 3), (250, 220, 120) if wide else ORANGE)
            c.line((0.6, 0.5, 3), (0.9, 0.5, 3), (250, 220, 120) if wide else ORANGE)
            for v in (lo, hi):
                c.box(0, v - 0.03, 1, v + 0.03, 3, 7, ORANGE if not wide else CON_L)
                for u in (0.1, 0.5, 0.9):
                    c.box(u - 0.03, v - 0.03, u + 0.03, v + 0.03, 3, 8, NAVY)
        else:
            c.box(lo + 0.06, 0.4, hi - 0.06, 0.6, -10, 0, CON_M)
            c.box(lo, 0, hi, 1, 0, 3, CON_L, top=ASPHALT)
            c.line((0.5, 0.1, 3), (0.5, 0.4, 3), ORANGE)
            c.line((0.5, 0.6, 3), (0.5, 0.9, 3), ORANGE)
            for u in (lo, hi):
                c.box(u - 0.03, 0, u + 0.03, 1, 3, 7, ORANGE)
                for v in (0.1, 0.5, 0.9):
                    c.box(u - 0.03, v - 0.03, u + 0.03, v + 0.03, 3, 8, NAVY)
        add(f"bridge{axis}", c, lights=False)

    # The Region gate: an arch over the highway, three tiles across (pillars on the verges).
    c = Canvas(1, 3, 60)
    for v in (0.5, 2.5):
        c.box(0.3, v - 0.2, 0.7, v + 0.2, 0, 40, NAVY)
        c.lface(v + 0.2, 0.3, 0.7, 30, 32, ORANGE)
    c.box(0.25, 0.2, 0.75, 2.8, 38, 48, NAVY)
    c.rface(0.75, 0.2, 2.8, 41, 44, ORANGE)
    for k in range(8):  # lights along the beam
        v = 0.45 + k * 0.3
        c.rface(0.75, v, v + 0.1, 45, 47, GLASS, light=True)
    add("gateArch", c)

    # Highway sign: a navy board with an orange rim on two posts (the game writes the destination on it).
    c = Canvas(1, 1, 56)
    for u in (0.2, 0.8):
        c.box(u - 0.04, 0.46, u + 0.04, 0.54, 0, 30, CON_M)
    c.box(0.05, 0.44, 0.95, 0.56, 28, 46, NAVY)
    c.lface(0.56, 0.05, 0.95, 28, 29, ORANGE)
    c.lface(0.56, 0.05, 0.95, 45, 46, ORANGE)
    c.lface(0.56, 0.12, 0.88, 32, 42, shade(NAVY, 1.2), light=False)
    x, y = c.P(0.78, 0.56, 37)
    c.d.polygon([(x - 2, y - 3), (x + 2, y), (x - 2, y + 3)], fill=A(WHITE))  # the arrow
    add("highwaySign", c, lights=False)

    # Lighthouse: white tower, orange bands, a glowing lantern.
    c = Canvas(1, 1, 80)
    c.box(0.15, 0.15, 0.85, 0.85, 0, 4, CON_M)
    for z0, z1, col in ((4, 14, WHITE), (14, 20, ORANGE), (20, 30, WHITE), (30, 36, ORANGE), (36, 46, WHITE)):
        cyl(c, 0.5, 0.5, z0, z1, 0.3 - z0 * 0.002, col)
    c.box(0.3, 0.3, 0.7, 0.7, 46, 48, NAVY)
    c.box(0.36, 0.36, 0.64, 0.64, 48, 55, GLASS)
    c.lface(0.64, 0.36, 0.64, 49, 54, LIT, light=True)
    c.rface(0.64, 0.36, 0.64, 49, 54, LIT, light=True)
    c.pyramid(0.3, 0.3, 0.7, 0.7, 55, 7, RED)
    add("lighthouse", c)

    # Pier: planks on piles, one tile, either way.
    for axis in ("X", "Y"):
        c = Canvas(1, 1, 16)
        if axis == "X":
            for u in (0.15, 0.85):
                for v in (0.25, 0.75):
                    c.box(u - 0.04, v - 0.04, u + 0.04, v + 0.04, -8, 2, WOOD_D)
            c.box(0, 0.2, 1, 0.8, 2, 4, WOOD, top=shade(WOOD, 1.08))
            for k in range(1, 6):
                c.line((k / 6, 0.2, 4), (k / 6, 0.8, 4), WOOD_D)
        else:
            for u in (0.25, 0.75):
                for v in (0.15, 0.85):
                    c.box(u - 0.04, v - 0.04, u + 0.04, v + 0.04, -8, 2, WOOD_D)
            c.box(0.2, 0, 0.8, 1, 2, 4, WOOD, top=shade(WOOD, 1.08))
            for k in range(1, 6):
                c.line((0.2, k / 6, 4), (0.8, k / 6, 4), WOOD_D)
        add(f"pier{axis}", c, lights=False)

    # Farmhouse: a red barn, a white house and a silo.
    c = Canvas(2, 2, 50)
    c.box(0.2, 0.9, 1.1, 1.8, 0, 14, (176, 64, 52))
    c.gable(0.15, 0.85, 1.15, 1.85, 14, 8, shade((176, 64, 52), 0.8))
    c.lface(1.8, 0.45, 0.85, 0, 9, WHITE)
    c.lface(1.8, 0.5, 0.8, 1, 8, (150, 54, 44))
    c.box(1.25, 0.3, 1.85, 0.9, 0, 12, WHITE)
    c.gable(1.2, 0.25, 1.9, 0.95, 12, 7, NAVY)
    c.lface(0.9, 1.4, 1.55, 4, 8, GLASS, light=True)
    c.rface(1.85, 0.45, 0.6, 4, 8, GLASS_D, light=True)
    cyl(c, 0.5, 0.5, 0, 24, 0.22, CON_L, top=shade(CON_M, 1.0))
    add("farmhouse", c)

    # Wind turbine: three frames of the rotor on one canvas size (Landscape swaps them).
    for f in range(3):
        c = Canvas(1, 1, 92)
        c.box(0.38, 0.38, 0.62, 0.62, 0, 2, CON_M)
        x, y = c.P(0.5, 0.5, 2)
        c.d.polygon([(x - 2, y), (x + 1, y), (x, y - 62), (x - 1, y - 62)], fill=A(WHITE))
        c.d.line([(x + 1, y), (x, y - 62)], fill=A(shade(WHITE, 0.8)))
        hx, hy = x, y - 64
        c.d.rectangle((hx - 3, hy - 2, hx + 3, hy + 2), fill=A(WHITE))
        for k in range(3):
            a = math.radians(-90 + f * 40 + k * 120)
            ex, ey = hx + round(math.cos(a) * 22), hy + round(math.sin(a) * 22)
            c.d.line([(hx, hy), (ex, ey)], fill=A(shade(WHITE, 0.95)), width=2)
        c.d.point([(hx, hy)], fill=A(ORANGE))
        c.ld.rectangle((hx - 1, hy - 3, hx, hy - 2), fill=A((255, 70, 60)))
        add(f"windTurbine{f}", c)


# ── AZ islands (plan B4) ──────────────────────────────────────────────────────

def pad_deco(c, r):
    """Poured concrete: expansion joints in a grid and a few darker specks."""
    for t in (0.5,):
        c.d.line([c.P(t, 0.02), c.P(t, 0.98)], fill=A(shade(CON_L, 0.86)))
        c.d.line([c.P(0.02, t), c.P(0.98, t)], fill=A(shade(CON_L, 0.86)))
    specks(shade(CON_L, 0.9), 4)(c, r)


def build_island(add):
    """An Availability Zone's island: a concrete pad, a substation, cooling towers, a fence and the AZ's sign board.
    Its data halls are the team pack's own (pack:data_center)."""
    ground("azPad", shade(CON_L, 0.97), pad_deco)

    # Substation (2×2): a gravel yard with two transformers (fins, bushings) and a steel gantry carrying the lines.
    c = Canvas(2, 2, 52)
    c.box(0.05, 0.05, 1.95, 1.95, 0, 2, shade(CON_M, 1.05), top=(168, 164, 156))
    for u0, v0 in ((0.25, 0.3), (0.25, 1.15)):
        c.box(u0, v0, u0 + 0.6, v0 + 0.55, 2, 16, (120, 128, 118))
        for k in range(4):  # cooling fins on the front face
            v = v0 + 0.08 + k * 0.12
            c.rface(u0 + 0.6, v, v + 0.05, 4, 14, shade((120, 128, 118), 0.7))
        for k in range(3):  # bushings
            cyl(c, u0 + 0.15 + k * 0.15, v0 + 0.2, 16, 22, 0.04, (196, 140, 96))
    for v in (0.2, 1.8):  # the gantry
        for u in (1.2, 1.8):
            c.box(u - 0.03, v - 0.03, u + 0.03, v + 0.03, 2, 34, CON_D)
    for u in (1.2, 1.8):
        c.box(u - 0.03, 0.17, u + 0.03, 1.83, 32, 34, CON_D)
    for k in range(3):  # lines
        u = 1.25 + k * 0.25
        c.line((u, 0.2, 31), (u, 1.8, 31), NAVY_D)
    c.box(1.4, 1.0, 1.6, 1.2, 2, 10, NAVY)  # control cabinet
    c.lface(1.2, 1.4, 1.6, 7, 9, ORANGE)
    add("substation2x2", c)

    # Cooling tower (1×1): a white hyperboloid shell with an AWS-orange band.
    c = Canvas(1, 1, 50)
    c.box(0.1, 0.1, 0.9, 0.9, 0, 2, CON_M)
    for z in range(2, 34, 2):
        t = (z - 18) / 16
        r = 0.27 + 0.11 * t * t
        cyl(c, 0.5, 0.5, z, z + 2, r, ORANGE if 24 <= z < 28 else WHITE, top=shade(CON_D, 0.9) if z == 32 else None)
    add("coolingTower", c, lights=False)

    # Perimeter fence: galvanised posts, two rails and a light mesh, knee-high; baked into the ground along the edge.
    for name, along_u in (("fenceX", True), ("fenceY", False)):
        c = Canvas(1, 1, 14)
        steel, mesh = (176, 186, 196), (150, 160, 172)
        for t in (0.0, 0.5):
            if along_u:
                c.box(t, 0.48, t + 0.05, 0.53, 0, 10, steel)
            else:
                c.box(0.48, t, 0.53, t + 0.05, 0, 10, steel)
        for z in (3, 6):
            a, b = ((0, 0.5, z), (1, 0.5, z)) if along_u else ((0.5, 0, z), (0.5, 1, z))
            c.line(a, b, mesh)
        a, b = ((0, 0.5, 9), (1, 0.5, 9)) if along_u else ((0.5, 0, 9), (0.5, 1, 9))
        c.line(a, b, steel)
        add(name, c, do_outline=False, lights=False)

    # The AZ's sign (2×1): an AWS-navy board on two posts with an orange rim (the game writes the AZ on it).
    c = Canvas(2, 1, 40)
    for u in (0.3, 1.7):
        c.box(u - 0.04, 0.46, u + 0.04, 0.54, 0, 20, CON_M)
    c.box(0.1, 0.44, 1.9, 0.56, 16, 32, NAVY)
    c.lface(0.56, 0.1, 1.9, 16, 17, ORANGE)
    c.lface(0.56, 0.1, 1.9, 31, 32, ORANGE)
    c.lface(0.56, 0.2, 0.5, 20, 28, ORANGE)  # the AZ tile: a small orange block
    for k, w in enumerate((1.1, 0.8)):
        c.lface(0.56, 0.62, 0.62 + w, 26 - k * 4, 27 - k * 4, WHITE)
    add("azSign", c, lights=False)


def build(add):
    build_ground(add)
    build_nature(add)
    build_structures(add)
    build_island(add)


# ── the sea (standalone seamless textures) ────────────────────────────────────

def write_sea(out_dir):
    """sea.png: deep water with small iso wave dashes; seaGlint.png: sparse highlights drawn ADD over it. Both tile."""
    w, h = 128, 64
    sea = Image.new("RGBA", (w, h), A(SEA))
    d = ImageDraw.Draw(sea)
    r = seeded("sea")
    for _ in range(46):
        x, y = r(w), r(h)
        col = shade(SEA, 1.14) if r(3) else shade(SEA, 0.9)
        for k in range(3 + r(3)):  # a dash along the iso x axis, wrapping round the edges
            d.point([((x + k * 2) % w, (y + k) % h), ((x + k * 2 + 1) % w, (y + k) % h)], fill=A(col))
    for _ in range(14):
        x, y = r(w), r(h)
        for k in range(3):
            d.point([((x + k * 2) % w, (y - k) % h), ((x + k * 2 + 1) % w, (y - k) % h)], fill=A(shade(SEA, 1.22)))
    sea.save(os.path.join(out_dir, "sea.png"), optimize=True)

    gw, gh = 192, 96
    glint = Image.new("RGBA", (gw, gh), CLEAR)
    g = ImageDraw.Draw(glint)
    r = seeded("glint")
    for _ in range(26):
        x, y = r(gw), r(gh)
        n = 2 + r(3)
        for k in range(n):
            a = 200 if 0 < k < n - 1 else 110
            g.point([((x + k * 2) % gw, (y + k) % gh), ((x + k * 2 + 1) % gw, (y + k) % gh)], fill=(210, 236, 255, a))
    glint.save(os.path.join(out_dir, "seaGlint.png"), optimize=True)
