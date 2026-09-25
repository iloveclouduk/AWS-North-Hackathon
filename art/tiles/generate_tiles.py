"""
AWS City — pixel-art city generator. Same outline + palette language as the team's character
generator (art/characters/generate_characters.py) on the Habbo 64×32 isometric grid.

Every sprite is drawn at 1× in *footprint space*: grid corners (u, v) with height z in pixels.
The sprite's anchor is the footprint's N (top) corner, so the game places it with
  origin = anchor / size   at   toScreen(corner x0 - 0.5, y0 - 0.5).

Reads  shared/world.json (services: kind, district colour)
Writes public/assets/city/atlas-<n>.png + atlas.json (Phaser multiatlas) + sprites.json (anchors)
       .cache/art/city-preview.png (review)

Run: python3 art/tiles/generate_tiles.py   (or: npm run art)
"""
import hashlib
import json
import math
import os
import sys

from PIL import Image, ImageChops, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "public", "assets", "city")
CACHE = os.path.join(ROOT, ".cache", "art")

HW, HH = 32, 16  # half tile width / height
OUTLINE = (28, 18, 30, 255)
CLEAR = (0, 0, 0, 0)


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a[:3], b[:3]))


def shade(c, f):
    return tuple(max(0, min(255, round(v * f))) for v in c[:3])


def A(c, a=255):
    return tuple(c[:3]) + (a,)


def seeded(key):
    h = int(hashlib.sha256(key.encode()).hexdigest(), 16)

    def r(n):
        nonlocal h
        h = (h * 6364136223846793005 + 1442695040888963407) % (1 << 64)
        return (h >> 33) % n

    return r


def outline(img, col=OUTLINE):
    w, h = img.size
    a = img.getchannel("A").point(lambda v: 255 if v else 0)
    dil = a
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        m = Image.new("L", (w, h), 0)
        m.paste(a, (dx, dy))
        dil = ImageChops.lighter(dil, m)
    out = Image.new("RGBA", (w, h), CLEAR)
    out.paste(Image.new("RGBA", (w, h), col), (0, 0), ImageChops.subtract(dil, a))
    out.alpha_composite(img)
    return out


class Canvas:
    """Footprint-space drawing: P(u, v, z) → pixel. u runs down-right (grid x), v down-left (grid y)."""

    def __init__(self, fw, fh, zmax, pad=2):
        self.fw, self.fh, self.zmax, self.pad = fw, fh, zmax, pad
        self.w = HW * (fw + fh) + pad * 2
        self.h = HH * (fw + fh) + zmax + pad * 2
        self.ox = HW * fh + pad  # N corner x
        self.oy = zmax + pad  # N corner y
        self.img = Image.new("RGBA", (self.w, self.h), CLEAR)
        self.d = ImageDraw.Draw(self.img)
        self.lights = Image.new("RGBA", (self.w, self.h), CLEAR)
        self.ld = ImageDraw.Draw(self.lights)

    def P(self, u, v, z=0):
        return (round(self.ox + (u - v) * HW), round(self.oy + (u + v) * HH - z))

    def poly(self, pts, fill, d=None):
        (d or self.d).polygon([self.P(*p) for p in pts], fill=A(fill))

    def box(self, u0, v0, u1, v1, z0, z1, col, top=None, left=None, right=None):
        """Iso box; returns face colours. Visible faces: left (v = v1), right (u = u1), top."""
        lc = left or shade(col, 0.86)
        rc = right or shade(col, 0.70)
        tc = top or shade(col, 1.06)
        self.poly([(u0, v1, z0), (u1, v1, z0), (u1, v1, z1), (u0, v1, z1)], lc)
        self.poly([(u1, v1, z0), (u1, v0, z0), (u1, v0, z1), (u1, v1, z1)], rc)
        self.poly([(u0, v0, z1), (u1, v0, z1), (u1, v1, z1), (u0, v1, z1)], tc)
        return lc, rc, tc

    def left_rect(self, v, ua, ub, za, zb, col, light=False):
        pts = [(ua, v, za), (ub, v, za), (ub, v, zb), (ua, v, zb)]
        self.poly(pts, col)
        if light:
            self.poly(pts, (255, 214, 110), self.ld)

    def right_rect(self, u, va, vb, za, zb, col, light=False):
        pts = [(u, va, za), (u, vb, za), (u, vb, zb), (u, va, zb)]
        self.poly(pts, col)
        if light:
            self.poly(pts, (255, 214, 110), self.ld)

    def windows(self, u0, v0, u1, v1, z0, z1, glass=(126, 196, 236), every=0.5, size=0.22, floor_h=18, lit_seed=None):
        r = seeded(lit_seed or f"{u0}{v0}{z1}")
        z = z0 + 7
        while z + 9 <= z1 - 4:
            u = u0 + every / 2
            while u + size <= u1 - 0.05:
                lit = r(3) > 0
                self.left_rect(v1, u, u + size, z, z + 9, glass, light=lit)
                u += every
            v = v0 + every / 2
            while v + size <= v1 - 0.05:
                lit = r(3) > 0
                self.right_rect(u1, v, v + size, z, z + 9, shade(glass, 0.85), light=lit)
                v += every
            z += floor_h

    def door(self, u0, u1, v1, col=(92, 60, 36), w=0.3, h=16):
        m = (u0 + u1) / 2
        self.left_rect(v1, m - w / 2, m + w / 2, 0, h, col)
        self.left_rect(v1, m + w / 4, m + w / 4 + 0.03, 7, 9, (250, 206, 60))

    def pyramid(self, u0, v0, u1, v1, z, h, col):
        apex = ((u0 + u1) / 2, (v0 + v1) / 2, z + h)
        self.poly([(u0, v1, z), (u1, v1, z), apex], shade(col, 0.9))
        self.poly([(u1, v1, z), (u1, v0, z), apex], shade(col, 0.72))

    def gable(self, u0, v0, u1, v1, z, h, col):
        """Ridge runs along u (grid x)."""
        vm = (v0 + v1) / 2
        self.poly([(u0, v1, z), (u1, v1, z), (u1, vm, z + h), (u0, vm, z + h)], shade(col, 0.92))
        self.poly([(u1, v1, z), (u1, v0, z), (u1, vm, z + h)], shade(col, 0.7))

    def finish(self, do_outline=True):
        img = outline(self.img) if do_outline else self.img
        return img, (self.ox, self.oy), (self.lights if self.lights.getbbox() else None)


SPRITES = {}  # name -> (img, anchor)


def add(name, canvas_or_img, anchor=None, do_outline=True, lights=True):
    if isinstance(canvas_or_img, Canvas):
        img, anchor, lit = canvas_or_img.finish(do_outline)
        SPRITES[name] = (img, anchor)
        if lights and lit is not None:
            SPRITES[name + "@lights"] = (lit, anchor)
    else:
        SPRITES[name] = (canvas_or_img, anchor)


# ---------------------------------------------------------------- ground

GRASS = (116, 196, 82)
GRASS_D = (88, 160, 70)
PAVE = (216, 208, 194)
PLAZA = (232, 200, 156)
ROAD = (84, 88, 104)
SAND = (238, 216, 162)
DIRT = (176, 126, 84)
WATER = (78, 164, 224)
WOOD = (176, 120, 72)


def ground(name, base, deco=None, key=None):
    c = Canvas(1, 1, 0, pad=0)
    c.poly([(0, 0), (1, 0), (1, 1), (0, 1)], base)
    if deco:
        deco(c, seeded(key or name))
    add(name, c, do_outline=False)


def speckle(col, n, size=1):
    def f(c, r):
        for _ in range(n):
            u, v = (r(90) + 5) / 100, (r(90) + 5) / 100
            x, y = c.P(u, v)
            c.d.rectangle((x, y, x + size - 1, y), fill=A(col))
    return f


def grass_tufts(flowers=False):
    def f(c, r):
        for _ in range(7):
            u, v = (r(80) + 10) / 100, (r(80) + 10) / 100
            x, y = c.P(u, v)
            c.d.point([(x, y), (x + 1, y - 1), (x + 2, y)], fill=A(shade(GRASS, 1.18)))
        for _ in range(4):
            u, v = (r(80) + 10) / 100, (r(80) + 10) / 100
            x, y = c.P(u, v)
            c.d.point([(x, y)], fill=A(shade(GRASS, 0.82)))
        if flowers:
            for col in [(250, 250, 250), (250, 214, 80), (240, 110, 150)]:
                u, v = (r(70) + 15) / 100, (r(70) + 15) / 100
                x, y = c.P(u, v)
                c.d.rectangle((x, y, x + 1, y + 1), fill=A(col))
    return f


def pave_joints(col, sub=2):
    def f(c, r):
        for i in range(1, sub):
            t = i / sub
            c.d.line([c.P(t, 0), c.P(t, 1)], fill=A(col))
            c.d.line([c.P(0, t), c.P(1, t)], fill=A(col))
    return f


def plaza_check(c, r):
    for i in range(2):
        for j in range(2):
            if (i + j) % 2:
                c.poly([(i / 2, j / 2), ((i + 1) / 2, j / 2), ((i + 1) / 2, (j + 1) / 2), (i / 2, (j + 1) / 2)], shade(PLAZA, 0.93))


def road_line(axis, dashed=True):
    def f(c, r):
        speckle(shade(ROAD, 1.12), 6)(c, r)
        for k in range(4 if dashed else 1):
            a, b = (k * 0.25 + 0.04, k * 0.25 + 0.16) if dashed else (0, 1)
            p0 = c.P(a, 0.5) if axis == "x" else c.P(0.5, a)
            p1 = c.P(b, 0.5) if axis == "x" else c.P(0.5, b)
            c.d.line([p0, p1], fill=(246, 214, 90, 255))
    return f


def zebra(axis):
    def f(c, r):
        for k in range(4):
            a = 0.12 + k * 0.2
            if axis == "x":
                c.poly([(a, 0.1), (a + 0.1, 0.1), (a + 0.1, 0.9), (a, 0.9)], (236, 236, 240))
            else:
                c.poly([(0.1, a), (0.9, a), (0.9, a + 0.1), (0.1, a + 0.1)], (236, 236, 240))
    return f


def water(frame):
    def f(c, r):
        rr = seeded("water")
        for i in range(8):
            u, v = (rr(80) + 10) / 100, (rr(80) + 10) / 100
            u = (u + frame * 0.08) % 0.9 + 0.05
            x, y = c.P(u, v)
            c.d.line([(x, y), (x + 3, y)], fill=A(shade(WATER, 1.25)))
        x, y = c.P(0.5 + 0.1 * math.sin(frame), 0.3)
        c.d.point([(x, y)], fill=(255, 255, 255, 255))
    return f


def build_ground():
    for i in range(3):
        ground(f"grass{i}", GRASS, grass_tufts(flowers=(i == 2)), key=f"g{i}")
    ground("grassDark", GRASS_D, speckle(shade(GRASS_D, 1.15), 8))
    ground("paving", PAVE, pave_joints(shade(PAVE, 0.88)))
    ground("sidewalk", (200, 196, 190), pave_joints(shade((200, 196, 190), 0.86), sub=3))
    ground("plaza", PLAZA, plaza_check)
    ground("road", ROAD, speckle(shade(ROAD, 1.12), 6))
    ground("roadX", ROAD, road_line("x"))
    ground("roadY", ROAD, road_line("y"))
    ground("zebraX", ROAD, zebra("x"))
    ground("zebraY", ROAD, zebra("y"))
    ground("sand", SAND, speckle(shade(SAND, 0.9), 10))
    ground("dirt", DIRT, speckle(shade(DIRT, 0.8), 14))
    ground("floorWood", WOOD, pave_joints(shade(WOOD, 0.82), sub=4))
    ground("floorTile", (226, 226, 232), pave_joints((196, 196, 206)))
    ground("carpet", (190, 70, 70), speckle((210, 100, 100), 10))
    for f in range(4):
        ground(f"water{f}", WATER, water(f))
    # map-edge cliff sides (drawn under border tiles)
    for side in ("L", "R"):
        c = Canvas(1, 1, 0, pad=0)
        c.h += 14
        c.img = Image.new("RGBA", (c.w, c.h), CLEAR)
        c.d = ImageDraw.Draw(c.img)
        if side == "L":
            c.poly([(0, 1, 0), (1, 1, 0), (1, 1, -12), (0, 1, -12)], (150, 104, 64))
            c.poly([(0, 1, 0), (1, 1, 0), (1, 1, -3), (0, 1, -3)], shade(GRASS, 0.8))
        else:
            c.poly([(1, 1, 0), (1, 0, 0), (1, 0, -12), (1, 1, -12)], (122, 84, 52))
            c.poly([(1, 1, 0), (1, 0, 0), (1, 0, -3), (1, 1, -3)], shade(GRASS, 0.7))
        add(f"edge{side}", c, do_outline=False)


# ---------------------------------------------------------------- props (1×1 footprint)

LEAF = (74, 170, 80)
TRUNK = (132, 88, 52)


def build_props():
    for i, (lc, h) in enumerate([(LEAF, 0), ((96, 184, 70), 6), ((58, 146, 90), -4)]):
        c = Canvas(1, 1, 70)
        x, y = c.P(0.5, 0.5)
        c.d.rectangle((x - 2, y - 20 - h, x + 1, y - 2), fill=A(TRUNK))
        for dx, dy, rr in [(0, -34, 13), (-9, -28, 9), (9, -28, 9), (-4, -44, 9), (5, -42, 8)]:
            c.d.ellipse((x + dx - rr, y + dy - h - rr, x + dx + rr, y + dy - h + rr), fill=A(lc))
        for dx, dy in [(-5, -40), (4, -36), (-8, -30)]:
            c.d.rectangle((x + dx, y + dy - h, x + dx + 2, y + dy - h + 1), fill=A(shade(lc, 1.25)))
        add(f"tree{i}", c)
    c = Canvas(1, 1, 76)
    x, y = c.P(0.5, 0.5)
    c.d.rectangle((x - 2, y - 12, x + 1, y - 2), fill=A(TRUNK))
    for k, (w, yy) in enumerate([(16, -22), (13, -36), (9, -50), (5, -62)]):
        c.d.polygon([(x - w, y + yy + 8), (x + w, y + yy + 8), (x, y + yy - 10)], fill=A(shade((52, 132, 80), 1 + k * 0.06)))
    add("pine", c)
    c = Canvas(1, 1, 24)
    x, y = c.P(0.5, 0.5)
    for dx, rr in [(-7, 8), (6, 8), (0, 10)]:
        c.d.ellipse((x + dx - rr, y - 12 - rr, x + dx + rr, y - 12 + rr), fill=A((84, 176, 76)))
    add("bush", c)
    c = Canvas(1, 1, 16)
    c.box(0.15, 0.15, 0.85, 0.85, 0, 8, (150, 104, 64))
    r = seeded("flowers")
    for _ in range(12):
        x, y = c.P(0.2 + r(60) / 100, 0.2 + r(60) / 100, 9)
        c.d.rectangle((x, y - 2, x + 1, y - 1), fill=A([(250, 90, 120), (250, 214, 80), (250, 250, 250), (160, 110, 240)][r(4)]))
        c.d.point([(x, y)], fill=A(LEAF))
    add("flowers", c)
    # bench along u (x axis) and along v
    for name, horiz in (("benchX", True), ("benchY", False)):
        c = Canvas(1, 1, 24)
        if horiz:
            c.box(0.15, 0.4, 0.85, 0.6, 8, 10, (190, 128, 72))
            c.box(0.15, 0.35, 0.85, 0.42, 10, 20, (176, 116, 64))
            for u in (0.2, 0.75):
                c.box(u, 0.45, u + 0.06, 0.55, 0, 8, (70, 70, 80))
        else:
            c.box(0.4, 0.15, 0.6, 0.85, 8, 10, (190, 128, 72))
            c.box(0.35, 0.15, 0.42, 0.85, 10, 20, (176, 116, 64))
            for v in (0.2, 0.75):
                c.box(0.45, v, 0.55, v + 0.06, 0, 8, (70, 70, 80))
        add(name, c)
    # lamp post + glow
    c = Canvas(1, 1, 64)
    c.box(0.44, 0.44, 0.56, 0.56, 0, 52, (60, 64, 78))
    c.box(0.36, 0.36, 0.64, 0.64, 52, 60, (70, 74, 90))
    x, y = c.P(0.5, 0.5, 50)
    c.d.rectangle((x - 3, y - 2, x + 2, y + 1), fill=(255, 236, 160, 255))
    c.ld.ellipse((x - 5, y - 4, x + 4, y + 3), fill=(255, 226, 130, 255))
    add("lamp", c)
    glow = Image.new("RGBA", (96, 64), CLEAR)
    gd = ImageDraw.Draw(glow)
    for i in range(12, 0, -1):
        gd.ellipse((48 - i * 4, 32 - i * 2.4, 48 + i * 4, 32 + i * 2.4), fill=(255, 220, 140, int(10 + (12 - i) * 5)))
    add("glow", glow, (48, 32))
    # bin, hydrant, mailbox, signpost
    c = Canvas(1, 1, 20)
    c.box(0.38, 0.38, 0.62, 0.62, 0, 14, (90, 150, 100))
    c.box(0.36, 0.36, 0.64, 0.64, 14, 16, (70, 120, 80))
    add("bin", c)
    c = Canvas(1, 1, 20)
    c.box(0.42, 0.42, 0.58, 0.58, 0, 12, (214, 60, 60))
    c.box(0.38, 0.45, 0.62, 0.55, 6, 9, (190, 50, 50))
    add("hydrant", c)
    c = Canvas(1, 1, 40)
    c.box(0.46, 0.46, 0.54, 0.54, 0, 26, (120, 90, 60))
    c.box(0.3, 0.44, 0.7, 0.54, 22, 36, (240, 230, 200))
    add("signpost", c)
    # fountain (animated)
    for f in range(3):
        c = Canvas(1, 1, 40)
        c.box(0.08, 0.08, 0.92, 0.92, 0, 8, (196, 196, 206))
        c.poly([(0.16, 0.16, 8), (0.84, 0.16, 8), (0.84, 0.84, 8), (0.16, 0.84, 8)], WATER)
        c.box(0.42, 0.42, 0.58, 0.58, 8, 20, (206, 206, 216))
        x, y = c.P(0.5, 0.5, 20)
        for k in range(5):
            ang = (k / 5) * math.pi * 2 + f * 0.6
            ex, ey = x + round(math.cos(ang) * 9), y + 10 + round(math.sin(ang) * 4)
            c.d.line([(x, y - 6 - f), (ex, ey)], fill=(200, 236, 255, 255))
        c.d.rectangle((x - 1, y - 10 - f, x, y - 2), fill=(230, 246, 255, 255))
        add(f"fountain{f}", c)
    # flag pole (tinted in game)
    c = Canvas(1, 1, 90)
    c.box(0.47, 0.47, 0.53, 0.53, 0, 80, (220, 220, 230))
    x, y = c.P(0.5, 0.5, 78)
    c.d.polygon([(x + 1, y), (x + 20, y + 4), (x + 1, y + 10)], fill=(255, 255, 255, 255))
    add("flag", c)


# ---------------------------------------------------------------- landmarks

WALL = (240, 234, 222)
STONE = (214, 208, 198)
ROOF = (96, 84, 110)


def construction(fw, fh):
    c = Canvas(fw, fh, 90)
    # scaffold
    for u in (0.4, fw - 0.4):
        for v in (0.4, fh - 0.4):
            c.box(u - 0.04, v - 0.04, u + 0.04, v + 0.04, 0, 56, (150, 150, 160))
    for z in (28, 56):
        c.box(0.36, 0.36, fw - 0.36, 0.44, z, z + 3, (150, 150, 160))
        c.box(fw - 0.44, 0.36, fw - 0.36, fh - 0.36, z, z + 3, (150, 150, 160))
        c.box(0.36, fh - 0.44, fw - 0.36, fh - 0.36, z, z + 3, (150, 150, 160))
    c.box(0.6, 0.6, fw - 0.6, fh - 0.6, 0, 22, (200, 190, 170))  # first floor going up
    # crane
    c.box(0.15, 0.15, 0.3, 0.3, 0, 84, (250, 196, 40))
    x0, y0 = c.P(0.22, 0.22, 84)
    x1, y1 = c.P(fw * 0.8, 0.22, 84)
    c.d.line([(x0, y0), (x1, y1)], fill=(250, 196, 40, 255), width=2)
    c.d.line([(x1, y1), (x1, y1 + 30)], fill=(60, 60, 70, 255))
    c.d.rectangle((x1 - 3, y1 + 30, x1 + 3, y1 + 34), fill=(176, 120, 72, 255))
    # fence
    for k in range(fw * 2 + 1):
        u = k / 2
        c.box(u - 0.03 if u else 0, fh - 0.06, min(fw, u + 0.03), fh, 0, 10, (250, 196, 40))
    for k in range(fh * 2 + 1):
        v = k / 2
        c.box(fw - 0.06, v - 0.03 if v else 0, fw, min(fh, v + 0.03), 0, 10, (250, 196, 40))
    c.box(0.05, fh - 0.06, fw - 0.05, fh, 6, 8, (40, 40, 48))
    c.box(fw - 0.06, 0.05, fw, fh - 0.05, 6, 8, (40, 40, 48))
    # cones
    x, y = c.P(fw - 0.5, fh + 0.2)
    c.d.polygon([(x - 4, y), (x + 4, y), (x, y - 10)], fill=(250, 120, 40, 255))
    return c


def building(fw, fh, tier, col, r):
    floors = 1 + tier
    ins = 0.35 - 0.05 * tier
    z1 = 16 + floors * 16
    c = Canvas(fw, fh, z1 + 40)
    u0, v0, u1, v1 = ins, ins, fw - ins, fh - ins
    wall = [WALL, (232, 222, 206), (224, 230, 236)][r(3)]
    c.box(u0, v0, u1, v1, 0, z1, wall)
    c.left_rect(v1, u0, u1, 0, 5, shade(col, 0.8))
    c.right_rect(u1, v0, v1, 0, 5, shade(col, 0.66))
    c.windows(u0, v0, u1, v1, 6, z1, every=0.55 if tier < 3 else 0.45, floor_h=16)
    c.door(u0, u1, v1)
    c.box(u0 - 0.04, v0 - 0.04, u1 + 0.04, v1 + 0.04, z1, z1 + 5, col)  # parapet
    if tier >= 2:
        c.box(u0 + 0.3, v0 + 0.3, u0 + 0.8, v0 + 0.7, z1 + 5, z1 + 14, (180, 184, 196))
    if tier >= 3:
        c.box(u1 - 0.9, v0 + 0.2, u1 - 0.3, v1 - 0.5, z1 + 5, z1 + 20, shade(col, 1.15))
    if tier >= 4:
        x, y = c.P(u1 - 0.6, v0 + 0.5, z1 + 20)
        c.d.line([(x, y), (x, y - 16)], fill=(250, 206, 60, 255))
        c.d.rectangle((x - 1, y - 18, x + 1, y - 16), fill=(250, 90, 90, 255))
    # awning over door
    m = (u0 + u1) / 2
    c.poly([(m - 0.3, v1, 18), (m + 0.3, v1, 18), (m + 0.3, v1 + 0.15, 14), (m - 0.3, v1 + 0.15, 14)], col)
    return c


def tower(fw, fh, tier, col, r):
    h = 56 + 20 * tier
    c = Canvas(fw, fh, h + 46)
    cu, cv = fw / 2, fh / 2
    s = 0.55 + 0.05 * tier
    if tier >= 2:
        c.box(0.4, cv - 0.2, fw - 0.4, fh - 0.4, 0, 22, STONE)
        c.windows(0.4, cv - 0.2, fw - 0.4, fh - 0.4, 0, 22, every=0.6)
    c.box(cu - s, cv - s, cu + s, cv + s, 0, h, (226, 220, 210))
    c.windows(cu - s, cv - s, cu + s, cv + s, 10, h, every=0.5, floor_h=18)
    c.door(cu - s, cu + s, cv + s)
    c.box(cu - s - 0.08, cv - s - 0.08, cu + s + 0.08, cv + s + 0.08, h, h + 4, col)
    c.pyramid(cu - s - 0.08, cv - s - 0.08, cu + s + 0.08, cv + s + 0.08, h + 4, 30 + 4 * tier, shade(col, 0.95))
    if tier >= 4:
        x, y = c.P(cu, cv, h + 34 + 16)
        c.d.ellipse((x - 4, y - 4, x + 3, y + 3), fill=(250, 206, 60, 255))
    return c


def dome(fw, fh, tier, col, r):
    base = 22 + 6 * tier
    c = Canvas(fw, fh, base + 60)
    ins = 0.4 - 0.04 * tier
    c.box(ins, ins, fw - ins, fh - ins, 0, base, STONE)
    c.windows(ins, ins, fw - ins, fh - ins, 2, base, every=0.6)
    c.door(ins, fw - ins, fh - ins)
    x, y = c.P(fw / 2, fh / 2, base)
    rad = round((fw / 2 - ins) * HW * 0.9)
    c.d.pieslice((x - rad, y - rad, x + rad, y + rad // 2), 180, 360, fill=A(shade(col, 1.05)))
    c.d.chord((x - rad, y - rad // 4, x + rad, y + rad // 4), 0, 180, fill=A(shade(col, 0.85)))
    c.d.ellipse((x - rad // 2, y - rad + 6, x - rad // 5, y - rad + 12), fill=A(shade(col, 1.35)))
    if tier >= 3:
        c.d.line([(x + 2, y - rad + 4), (x + rad - 2, y - rad - 12)], fill=(70, 74, 90, 255), width=4)
    return c


def lake(fw, fh, tier, col, r):
    c = Canvas(fw, fh, 60)
    # pier on the front row
    c.box(0.3, fh - 0.75, fw - 0.2, fh - 0.35, 2, 5, WOOD, top=shade(WOOD, 1.1))
    for u in (0.5, 1.5, 2.5):
        if u < fw:
            c.box(u, fh - 0.4, u + 0.08, fh - 0.32, -4, 5, shade(WOOD, 0.7))
    for i in range(tier):
        u = 0.5 + i * 0.6
        c.box(u, fh - 0.7, u + 0.3, fh - 0.4, 5, 14, [(63, 155, 79), (58, 111, 216), (148, 163, 184), (250, 204, 21)][i])
    if tier >= 3:
        c.box(fw - 1.0, 0.2, fw - 0.2, 1.0, 0, 26, (190, 136, 84))
        c.gable(fw - 1.05, 0.15, fw - 0.15, 1.05, 26, 14, col)
    if tier >= 2:  # little boat
        c.box(1.1, 0.8, 1.9, 1.2, 0, 5, (230, 80, 70))
    return c


def wall(fw, fh, tier, col, r):
    h = 30 + 8 * tier
    c = Canvas(fw, fh, h + 30)
    v0, v1 = fh / 2 - 0.3, fh / 2 + 0.3
    c.box(0, v0, fw, v1, 0, h, (170, 172, 180))
    for k in range(fw * 3):
        u = k / 3
        if k % 2 == 0:
            c.box(u, v0, u + 1 / 3, v1, h, h + 7, (170, 172, 180))
    x, y = c.P(fw / 2, v1, h / 2 + 4)
    c.d.polygon([(x - 9, y - 10), (x + 9, y - 1), (x + 9, y + 6), (x, y + 10), (x - 9, y + 2)], fill=A(col))
    c.d.rectangle((x - 1, y - 4, x + 1, y + 6), fill=(255, 255, 255, 255))
    if tier >= 3:
        for u in (0, fw - 0.8):
            c.box(u, v0 - 0.1, u + 0.8, v1 + 0.1, 0, h + 16, (160, 162, 172))
            c.pyramid(u, v0 - 0.1, u + 0.8, v1 + 0.1, h + 16, 14, col)
    return c


def garden(fw, fh, tier, col, r):
    c = Canvas(fw, fh, 70)
    hedge = (60, 140, 64)
    c.box(0, 0, fw, 0.25, 0, 12, hedge)
    c.box(0, 0, 0.25, fh, 0, 12, hedge)
    c.box(fw - 0.25, 0, fw, fh, 0, 12, hedge)
    c.box(0, fh - 0.25, fw * 0.4, fh, 0, 12, hedge)
    c.box(fw * 0.6, fh - 0.25, fw, fh, 0, 12, hedge)
    for i in range(tier + 1):
        u, v = 0.8 + (i % 2) * 1.3, 0.8 + (i // 2) * 0.9
        x, y = c.P(u, v)
        c.d.rectangle((x - 1, y - 16, x + 1, y), fill=A(TRUNK))
        c.d.ellipse((x - 9, y - 30, x + 9, y - 12), fill=A((84, 176, 76)))
    x, y = c.P(fw / 2, fh - 0.1, 0)
    c.d.rectangle((x - 1, y - 22, x + 1, y), fill=A(col))
    c.d.rectangle((x - 8, y - 26, x + 8, y - 20), fill=A(col))
    return c


def stall(fw, fh, tier, col, r):
    c = Canvas(fw, fh, 64)
    u0, v0, u1, v1 = 0.4, fh / 2 - 0.2, fw - 0.4, fh - 0.4
    c.box(u0, v0, u1, v1, 0, 20, (190, 136, 84))
    c.box(u0, v1 - 0.1, u1, v1 + 0.1, 14, 18, (230, 214, 190))
    for pu in (u0, u1 - 0.08):
        c.box(pu, v1 - 0.08, pu + 0.08, v1, 20, 42, (110, 74, 44))
    n = 8
    for k in range(n):
        a = u0 - 0.1 + k * (u1 - u0 + 0.2) / n
        b = a + (u1 - u0 + 0.2) / n
        c.poly([(a, v0 - 0.2, 46), (b, v0 - 0.2, 46), (b, v1 + 0.35, 38), (a, v1 + 0.35, 38)], col if k % 2 else (250, 250, 250))
    if tier >= 2:
        for u in (0.6, fw - 0.9):
            c.box(u, 0.3, u + 0.4, 0.7, 0, 10, (230, 230, 236))
            x, y = c.P(u + 0.2, 0.5, 10)
            c.d.line([(x, y), (x, y - 16)], fill=(90, 90, 100, 255))
            c.d.polygon([(x - 10, y - 14), (x + 10, y - 14), (x, y - 22)], fill=A(col if tier >= 3 else (240, 120, 90)))
    return c


def dock(fw, fh, tier, col, r):
    c = Canvas(fw, fh, 70)
    c.box(0, fh - 1, fw, fh - 0.2, 0, 5, WOOD, top=shade(WOOD, 1.1))
    cols = [(239, 68, 68), (59, 130, 246), (34, 197, 94), (245, 158, 11), (139, 92, 246), (20, 184, 166), (236, 72, 153), (100, 116, 139)]
    for i in range(tier * 2):
        u = 0.2 + (i % 3) * 0.95
        v = 0.3 + (i // 3 % 2) * 0.8
        z = (i // 6) * 16
        c.box(u, v, u + 0.85, v + 0.55, z, z + 16, cols[i % len(cols)])
        for k in range(3):
            c.left_rect(v + 0.55, u + 0.1 + k * 0.25, u + 0.14 + k * 0.25, z + 2, z + 14, shade(cols[i % len(cols)], 0.7))
    # crane
    c.box(fw - 0.5, 0.1, fw - 0.3, 0.3, 0, 60, (250, 196, 40))
    x0, y0 = c.P(fw - 0.4, 0.2, 60)
    x1, y1 = c.P(fw - 0.4, fh - 0.6, 60)
    c.d.line([(x0, y0), (x1, y1)], fill=(250, 196, 40, 255), width=2)
    return c


def factory(fw, fh, tier, col, r):
    z1 = 30 + 6 * tier
    c = Canvas(fw, fh, z1 + 70)
    u0, v0, u1, v1 = 0.25, 0.4, fw - 0.25, fh - 0.25
    c.box(u0, v0, u1, v1, 0, z1, (206, 156, 124))
    c.windows(u0, v0, u1, v1, 2, z1, glass=(150, 200, 230), every=0.5, floor_h=20)
    c.door(u0, u1, v1, col=shade(col, 0.7), w=0.6, h=20)
    teeth = 3
    for k in range(teeth):
        a = u0 + k * (u1 - u0) / teeth
        b = a + (u1 - u0) / teeth
        c.poly([(a, v1, z1), (b, v1, z1), (b, v1, z1 + 12), (a, v1, z1)], shade(col, 0.9))
        c.poly([(b, v0, z1), (b, v1, z1), (b, v1, z1 + 12), (b, v0, z1 + 12)], (170, 210, 236))
    for k in range(min(tier, 3)):
        u = 0.35 + k * 0.5
        c.box(u, 0.1, u + 0.3, 0.4, 0, z1 + 30 + k * 6, (170, 90, 70))
        c.box(u - 0.03, 0.07, u + 0.33, 0.43, z1 + 30 + k * 6, z1 + 34 + k * 6, (130, 70, 56))
    return c


def warehouse(fw, fh, tier, col, r):
    z1 = 26 + 5 * tier
    c = Canvas(fw, fh, z1 + 40)
    u0, v0, u1, v1 = 0.2, 0.3, fw - 0.2, fh - 0.3
    c.box(u0, v0, u1, v1, 0, z1, (200, 200, 208))
    for k in range(min(tier + 1, 3)):
        a = u0 + 0.3 + k * 0.9
        c.left_rect(v1, a, a + 0.6, 0, 18, shade(col, 0.85))
        for z in range(2, 18, 3):
            c.left_rect(v1, a, a + 0.6, z, z + 1, shade(col, 0.6))
    c.windows(u0, v0, u1, v1, 16, z1, every=0.6)
    c.gable(u0 - 0.05, v0 - 0.05, u1 + 0.05, v1 + 0.05, z1, 16, col)
    return c


def station(fw, fh, tier, col, r):
    c = Canvas(fw, fh, 70)
    c.box(0.1, 0.8, fw - 0.1, fh - 0.3, 0, 6, (200, 196, 190))
    for u in (0.3, fw / 2, fw - 0.4):
        c.box(u, fh - 0.5, u + 0.1, fh - 0.4, 6, 38, (80, 84, 100))
    c.poly([(0, 0.7, 40), (fw, 0.7, 40), (fw, fh - 0.2, 34), (0, fh - 0.2, 34)], col)
    c.box(0.3, 0.2, fw - 0.3, 0.9, 0, 30 + 6 * tier, (236, 228, 214))
    c.windows(0.3, 0.2, fw - 0.3, 0.9, 4, 30 + 6 * tier, every=0.45)
    x, y = c.P(fw / 2, 0.9, 30 + 6 * tier + 10)
    c.d.ellipse((x - 6, y - 6, x + 6, y + 6), fill=(250, 250, 250, 255))
    c.d.line([(x, y), (x, y - 4)], fill=OUTLINE)
    c.d.line([(x, y), (x + 3, y)], fill=OUTLINE)
    return c


KINDS = dict(building=building, tower=tower, dome=dome, lake=lake, wall=wall, garden=garden, stall=stall,
             dock=dock, factory=factory, warehouse=warehouse, station=station)


def hq(col):
    c = Canvas(2, 2, 110)
    c.box(0.15, 0.15, 1.85, 1.85, 0, 64, (246, 244, 238))
    c.windows(0.15, 0.15, 1.85, 1.85, 8, 64, glass=(150, 206, 240), every=0.4, floor_h=14)
    c.left_rect(1.85, 0.15, 1.85, 0, 8, col)
    c.right_rect(1.85, 0.15, 1.85, 0, 8, shade(col, 0.8))
    c.door(0.15, 1.85, 1.85, col=(60, 44, 34), w=0.45, h=20)
    c.poly([(0.6, 1.85, 24), (1.4, 1.85, 24), (1.4, 2.05, 18), (0.6, 2.05, 18)], col)
    c.box(0.1, 0.1, 1.9, 1.9, 64, 70, col)
    c.box(0.5, 0.5, 1.2, 1.2, 70, 80, (190, 194, 206))
    return c


def plaza_building():
    c = Canvas(4, 2, 110)
    navy, orange = (35, 47, 62), (255, 153, 0)
    c.box(0.1, 0.2, 3.9, 1.8, 0, 58, navy)
    c.windows(0.1, 0.2, 3.9, 1.8, 6, 58, glass=(255, 210, 120), every=0.45, floor_h=16)
    c.door(0.1, 3.9, 1.8, col=orange, w=0.6, h=22)
    c.box(0.05, 0.15, 3.95, 1.85, 58, 66, orange)
    c.box(1.4, 0.6, 2.6, 1.4, 66, 86, navy)
    c.box(1.35, 0.55, 2.65, 1.45, 86, 90, orange)
    x, y = c.P(2.0, 1.45, 76)
    # smile arrow
    c.d.arc((x - 12, y - 8, x + 12, y + 4), 20, 160, fill=A(orange), width=2)
    return c


def lookout_tower():
    c = Canvas(1, 1, 140)
    for u, v in ((0.15, 0.15), (0.8, 0.15), (0.8, 0.8), (0.15, 0.8)):
        c.box(u, v, u + 0.07, v + 0.07, 0, 96, (132, 88, 52))
    c.box(0.05, 0.05, 0.95, 0.95, 96, 102, (176, 120, 72))
    c.box(0.2, 0.2, 0.8, 0.8, 102, 120, (148, 163, 184))
    c.pyramid(0.05, 0.05, 0.95, 0.95, 120, 18, (71, 85, 105))
    x, y = c.P(0.8, 0.8, 110)
    c.d.rectangle((x - 3, y - 3, x + 3, y + 2), fill=(30, 30, 40, 255))
    c.d.rectangle((x - 1, y - 2, x + 1, y), fill=(120, 190, 240, 255))
    x0, y0 = c.P(0.2, 0.8, 0)
    x1, y1 = c.P(0.2, 0.8, 96)
    for k in range(0, 96, 12):
        xa, ya = c.P(0.12, 0.85, k)
        c.d.line([(xa, ya), (xa + 8, ya - 2)], fill=(120, 80, 48, 255))
    return c


def workshop():
    c = Canvas(3, 3, 110)
    brick = (184, 92, 72)
    c.box(0.25, 0.25, 2.75, 2.75, 0, 44, brick)
    for z in range(4, 44, 6):
        c.left_rect(2.75, 0.25, 2.75, z, z + 1, shade(brick, 0.85))
    c.windows(0.25, 0.25, 2.75, 2.75, 6, 44, every=0.55, floor_h=20)
    c.door(0.25, 2.75, 2.75, col=(255, 153, 0), w=0.8, h=26)
    c.gable(0.2, 0.2, 2.8, 2.8, 44, 24, (70, 74, 90))
    x, y = c.P(1.5, 2.75, 60)
    for k in range(8):
        a = k * math.pi / 4
        c.d.rectangle((x + round(math.cos(a) * 10) - 2, y + round(math.sin(a) * 10) - 2, x + round(math.cos(a) * 10) + 2, y + round(math.sin(a) * 10) + 2), fill=(255, 153, 0, 255))
    c.d.ellipse((x - 9, y - 9, x + 9, y + 9), fill=(255, 153, 0, 255))
    c.d.ellipse((x - 4, y - 4, x + 4, y + 4), fill=(70, 74, 90, 255))
    return c


def build_landmarks(world):
    colors = {d["id"]: rgb(d["color"]) for d in world["districts"]}
    for fw, fh in ((3, 3), (2, 2), (1, 1), (4, 2)):
        add(f"construction{fw}x{fh}", construction(fw, fh), lights=False)
    for s in world["services"]:
        kind = s["kind"]
        for tier in (1, 2, 3, 4):
            r = seeded(f"{s['id']}{tier}")
            add(f"lm:{s['id']}:{tier}", KINDS[kind](3, 3, tier, colors[s["districtId"]], r))
    for d in world["districts"]:
        add(f"hq:{d['id']}", hq(colors[d["id"]]))
    add("plaza", plaza_building())
    add("lookout", lookout_tower())
    add("workshop", workshop())


# ---------------------------------------------------------------- interiors

def build_interior():
    for name, col in (("wallL", (236, 232, 222)), ("wallR", (224, 220, 210))):
        for win in (False, True):
            c = Canvas(1, 1, 116, pad=0)
            c.h += 4
            if name == "wallL":  # along v at u = 0, facing +u (the left/back wall)
                c.poly([(0, 0, 0), (0, 1, 0), (0, 1, 110), (0, 0, 110)], col)
                c.poly([(0, 0, 0), (0, 1, 0), (0, 1, 8), (0, 0, 8)], shade(col, 0.8))
                if win:
                    c.poly([(0, 0.2, 50), (0, 0.8, 50), (0, 0.8, 92), (0, 0.2, 92)], (150, 210, 240))
                    c.poly([(0, 0.49, 50), (0, 0.51, 50), (0, 0.51, 92), (0, 0.49, 92)], (250, 250, 250))
            else:  # along u at v = 0 (the right/back wall)
                c.poly([(0, 0, 0), (1, 0, 0), (1, 0, 110), (0, 0, 110)], col)
                c.poly([(0, 0, 0), (1, 0, 0), (1, 0, 8), (0, 0, 8)], shade(col, 0.75))
                if win:
                    c.poly([(0.2, 0, 50), (0.8, 0, 50), (0.8, 0, 92), (0.2, 0, 92)], (140, 200, 236))
                    c.poly([(0.49, 0, 50), (0.51, 0, 50), (0.51, 0, 92), (0.49, 0, 92)], (250, 250, 250))
            add(f"{name}{'Win' if win else ''}", c, do_outline=False, lights=False)
    c = Canvas(1, 1, 40)
    c.box(0.1, 0.15, 0.9, 0.85, 22, 26, (176, 120, 72))
    for u, v in ((0.15, 0.2), (0.8, 0.2), (0.8, 0.78), (0.15, 0.78)):
        c.box(u, v, u + 0.05, v + 0.05, 0, 22, (120, 80, 48))
    add("desk", c)
    c = Canvas(1, 1, 90)
    c.box(0.15, 0.1, 0.85, 0.45, 0, 80, (150, 100, 60))
    books = [(214, 69, 69), (58, 111, 216), (63, 155, 79), (250, 204, 21), (139, 92, 246)]
    r = seeded("books")
    for z in (8, 28, 48, 68):
        c.box(0.16, 0.11, 0.84, 0.44, z - 2, z, (120, 80, 48))
        u = 0.18
        while u < 0.8:
            w = 0.06 + r(4) / 100
            c.left_rect(0.45, u, min(u + w, 0.82), z, z + 12 + r(4), books[r(5)])
            u += w + 0.01
    add("bookshelf", c)
    c = Canvas(1, 1, 60)
    c.box(0.3, 0.3, 0.7, 0.7, 0, 14, (196, 110, 70))
    x, y = c.P(0.5, 0.5, 14)
    for dx, dy, rr in [(0, -14, 9), (-8, -8, 7), (8, -8, 7), (0, -24, 6)]:
        c.d.ellipse((x + dx - rr, y + dy - rr, x + dx + rr, y + dy + rr), fill=A((70, 160, 80)))
    add("plant", c)
    for f in range(2):
        c = Canvas(1, 1, 90)
        c.box(0.15, 0.15, 0.85, 0.85, 0, 80, (48, 52, 64))
        r = seeded(f"rack{f}")
        for z in range(10, 76, 10):
            c.left_rect(0.85, 0.2, 0.8, z, z + 6, (70, 76, 92))
            for k in range(3):
                on = r(2) == 0
                c.left_rect(0.85, 0.25 + k * 0.08, 0.3 + k * 0.08, z + 2, z + 4, (60, 230, 120) if on else (40, 90, 60), light=on)
        add(f"rack{f}", c)
    c = Canvas(2, 1, 40)
    c.box(0.1, 0.2, 1.9, 0.9, 0, 12, (70, 110, 180))
    c.box(0.1, 0.1, 1.9, 0.35, 12, 26, (60, 96, 164))
    c.box(0.05, 0.2, 0.25, 0.9, 12, 18, (60, 96, 164))
    c.box(1.75, 0.2, 1.95, 0.9, 12, 18, (60, 96, 164))
    add("sofa", c)
    c = Canvas(1, 1, 60)
    c.box(0.3, 0.3, 0.7, 0.7, 0, 30, (220, 224, 232))
    c.box(0.34, 0.34, 0.66, 0.66, 30, 50, (170, 214, 250))
    add("cooler", c)
    c = Canvas(1, 1, 30)
    c.box(0.3, 0.3, 0.7, 0.7, 12, 16, (60, 60, 70))
    c.box(0.46, 0.46, 0.54, 0.54, 0, 12, (40, 40, 48))
    c.box(0.3, 0.6, 0.7, 0.7, 16, 28, (60, 60, 70))
    add("chair", c)
    c = Canvas(1, 1, 90)
    c.poly([(0.1, 0.02, 30), (0.9, 0.02, 30), (0.9, 0.02, 80), (0.1, 0.02, 80)], (250, 250, 250))
    c.poly([(0.2, 0.02, 60), (0.5, 0.02, 60), (0.5, 0.02, 62), (0.2, 0.02, 62)], (58, 111, 216))
    c.poly([(0.2, 0.02, 50), (0.7, 0.02, 50), (0.7, 0.02, 52), (0.2, 0.02, 52)], (214, 69, 69))
    add("whiteboard", c)


# ---------------------------------------------------------------- packing

def pack(sprites, max_w=2048, max_h=2048):
    items = sorted(sprites.items(), key=lambda kv: -kv[1][0].height)
    pages, cur, x, y, row_h = [], {}, 0, 0, 0
    for name, (img, anchor) in items:
        w, h = img.width + 2, img.height + 2
        if x + w > max_w:
            x, y, row_h = 0, y + row_h, 0
        if y + h > max_h:
            pages.append(cur)
            cur, x, y, row_h = {}, 0, 0, 0
        cur[name] = (img, anchor, x + 1, y + 1)
        x += w
        row_h = max(row_h, h)
    if cur:
        pages.append(cur)
    return pages


def main():
    with open(os.path.join(ROOT, "shared", "world.json")) as f:
        world = json.load(f)
    build_ground()
    build_props()
    build_landmarks(world)
    build_interior()

    os.makedirs(OUT, exist_ok=True)
    for old in os.listdir(OUT):
        os.remove(os.path.join(OUT, old))
    pages = pack(SPRITES)
    textures, anchors = [], {}
    for i, page in enumerate(pages):
        pw = max(x + img.width for img, _, x, _ in page.values()) + 1
        ph = max(y + img.height for img, _, _, y in page.values()) + 1
        sheet = Image.new("RGBA", (pw, ph), CLEAR)
        frames = []
        for name, (img, anchor, x, y) in page.items():
            sheet.paste(img, (x, y))
            frames.append({"filename": name, "frame": {"x": x, "y": y, "w": img.width, "h": img.height}, "rotated": False, "trimmed": False,
                           "spriteSourceSize": {"x": 0, "y": 0, "w": img.width, "h": img.height}, "sourceSize": {"w": img.width, "h": img.height}})
            anchors[name] = {"ax": anchor[0], "ay": anchor[1], "w": img.width, "h": img.height}
        fn = f"atlas-{i}.png"
        sheet.save(os.path.join(OUT, fn), optimize=True)
        textures.append({"image": fn, "format": "RGBA8888", "size": {"w": pw, "h": ph}, "scale": 1, "frames": frames})
    with open(os.path.join(OUT, "atlas.json"), "w") as f:
        json.dump({"textures": textures, "meta": {"app": "aws-city generate_tiles.py", "version": "1"}}, f, separators=(",", ":"))
    with open(os.path.join(OUT, "sprites.json"), "w") as f:
        json.dump({"tile": {"halfW": HW, "halfH": HH}, "sprites": anchors}, f, separators=(",", ":"))
    # The team's animated door (4 frames, 40×64) from the character generator.
    import shutil
    shutil.copy(os.path.join(ROOT, "art", "characters", "door_left.png"), os.path.join(OUT, "door_left.png"))
    print(f"{len(SPRITES)} sprites on {len(pages)} page(s) → {OUT}")
    preview()
    kinds_sheet(world)


def kinds_sheet(world):
    names = [f"lm:{s['id']}:{t}" for s in world["services"][:: 1] for t in (1, 4)]
    names = ["construction3x3", "plaza", "lookout", "workshop", "hq:compute"] + [n for n in names]
    cols = 12
    cell_w, cell_h = 200, 230
    rows = (len(names) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * cell_w, rows * cell_h), (15, 26, 43, 255))
    for i, n in enumerate(names):
        img, _ = SPRITES[n]
        x = (i % cols) * cell_w + (cell_w - img.width) // 2
        y = (i // cols) * cell_h + cell_h - img.height - 4
        sheet.alpha_composite(img, (x, max(0, y)))
    sheet.save(os.path.join(CACHE, "kinds.png"))


def preview():
    """Tiny sample town for review."""
    os.makedirs(CACHE, exist_ok=True)
    canvas = Image.new("RGBA", (1600, 900), (15, 26, 43, 255))
    ox, oy = 800, 120

    def put(name, gx, gy):
        img, (ax, ay) = SPRITES[name]
        x = ox + round((gx - gy) * HW) - ax
        y = oy + round((gx + gy) * HH) - ay
        canvas.alpha_composite(img, (x, y))

    for gy in range(14):
        for gx in range(14):
            t = "roadX" if gy == 7 else ("roadY" if gx == 7 else ("paving" if gx in (6, 8) or gy in (6, 8) else f"grass{(gx * 7 + gy) % 3}"))
            if 9 <= gx <= 11 and 1 <= gy <= 3:
                t = "water0" if gy < 3 else "sand"
            put(t, gx, gy)
    order = [("lm:ec2:4", 1, 1), ("lm:lambda:3", 1, 9), ("lm:s3:3", 9, 1), ("lm:iam:2", 9, 9), ("construction3x3", 4, 1), ("lm:dynamodb:4", 4, 9),
             ("plaza", 10, 4), ("tree0", 5, 5), ("lamp", 6, 5), ("benchX", 5, 6), ("fountain0", 8, 5), ("lm:shield:4", 1, 4), ("lm:agentcore:4", 12, 9)]
    for name, gx, gy in sorted(order, key=lambda t: t[1] + t[2]):
        put(name, gx, gy)
    canvas.save(os.path.join(CACHE, "city-preview.png"))


if __name__ == "__main__":
    main()
