"""
AWS City — city art generator in the team pack's exact style (art/pack, imported from the agentic-city
prototype): Habbo 32×16 tiles, dark navy outlines, AWS navy + orange, cool concrete greys, lush greens.

Pack sprites are copied pixel-for-pixel. Everything the pack doesn't have (36 landmarks × tiers, The Spheres,
roads, water, parks, interior pieces) is drawn here with the same palette and construction.

Anchor convention in sprites.json: (ax, ay) is the footprint's N (top) corner at ground level, so the game
places a sprite with origin = anchor/size at the screen position of that corner.

Run: python3 art/tiles/generate_tiles.py   (or: npm run art)
"""
import hashlib
import json
import math
import os
import shutil

from PIL import Image, ImageChops, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
PACK = os.path.join(ROOT, "art", "pack")
OUT = os.path.join(ROOT, "public", "assets", "city")
CACHE = os.path.join(ROOT, ".cache", "art")

HW, HH = 16, 8
CLEAR = (0, 0, 0, 0)

# ── palette sampled from the pack ─────────────────────────────────────────────
OUTLINE = (22, 30, 40)
NAVY = (35, 47, 62)
NAVY_D = (23, 31, 40)
ORANGE = (255, 153, 0)
ORANGE_D = (222, 110, 10)
CON_L = (206, 212, 220)
CON_M = (150, 160, 172)
CON_D = (104, 114, 128)
WHITE = (240, 242, 246)
GRASS = (70, 170, 80)
GRASS_D = (38, 116, 58)
WOOD = (190, 140, 90)
WOOD_D = (148, 102, 62)
GLASS = (150, 206, 236)
GLASS_D = (96, 150, 190)
ASPHALT = (58, 64, 78)
WATER = (64, 150, 214)


def shade(c, f):
    return tuple(max(0, min(255, round(v * f))) for v in c[:3])


def A(c, a=255):
    return tuple(c[:3]) + (a,)


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


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
    out.paste(Image.new("RGBA", (w, h), A(col)), (0, 0), ImageChops.subtract(dil, a))
    out.alpha_composite(img)
    return out


class Canvas:
    """Footprint-space drawing: P(u, v, z) → pixel. u = grid x (down-right), v = grid y (down-left)."""

    def __init__(self, fw, fh, zmax, pad=2):
        self.fw, self.fh = fw, fh
        self.w = HW * (fw + fh) + pad * 2
        self.h = HH * (fw + fh) + zmax + pad * 2
        self.ox, self.oy = HW * fh + pad, zmax + pad
        self.img = Image.new("RGBA", (self.w, self.h), CLEAR)
        self.d = ImageDraw.Draw(self.img)
        self.lights = Image.new("RGBA", (self.w, self.h), CLEAR)
        self.ld = ImageDraw.Draw(self.lights)

    def P(self, u, v, z=0):
        return (round(self.ox + (u - v) * HW), round(self.oy + (u + v) * HH - z))

    def poly(self, pts, fill, d=None):
        (d or self.d).polygon([self.P(*p) for p in pts], fill=A(fill))

    def line(self, a, b, col, w=1):
        self.d.line([self.P(*a), self.P(*b)], fill=A(col), width=w)

    def box(self, u0, v0, u1, v1, z0, z1, col, top=None, left=None, right=None):
        lc, rc, tc = left or shade(col, 0.88), right or shade(col, 0.72), top or shade(col, 1.04)
        self.poly([(u0, v1, z0), (u1, v1, z0), (u1, v1, z1), (u0, v1, z1)], lc)
        self.poly([(u1, v1, z0), (u1, v0, z0), (u1, v0, z1), (u1, v1, z1)], rc)
        self.poly([(u0, v0, z1), (u1, v0, z1), (u1, v1, z1), (u0, v1, z1)], tc)

    def lface(self, v, ua, ub, za, zb, col, light=False):
        pts = [(ua, v, za), (ub, v, za), (ub, v, zb), (ua, v, zb)]
        self.poly(pts, col)
        if light:
            self.poly(pts, (255, 214, 120), self.ld)

    def rface(self, u, va, vb, za, zb, col, light=False):
        pts = [(u, va, za), (u, vb, za), (u, vb, zb), (u, va, zb)]
        self.poly(pts, col)
        if light:
            self.poly(pts, (255, 214, 120), self.ld)

    def louvres(self, u0, v0, u1, v1, z0, z1, col, step=3):
        """The data-centre's horizontal grille lines."""
        for z in range(z0 + 2, z1 - 1, step):
            self.line((u0 + 0.05, v1, z), (u1 - 0.05, v1, z), shade(col, 0.8))
            self.line((u1, v1 - 0.05, z), (u1, v0 + 0.05, z), shade(col, 0.62))

    def windows(self, u0, v0, u1, v1, z0, z1, key, every=0.5, size=0.28, fh=9):
        r = seeded(key)
        z = z0 + 3
        while z + 5 <= z1 - 2:
            u = u0 + (every - size) / 2 + 0.05
            while u + size <= u1 - 0.05:
                self.lface(v1, u, u + size, z, z + 5, GLASS, light=r(3) > 0)
                u += every
            v = v0 + (every - size) / 2 + 0.05
            while v + size <= v1 - 0.05:
                self.rface(u1, v, v + size, z, z + 5, GLASS_D, light=r(3) > 0)
                v += every
            z += fh

    def door(self, u0, u1, v1, col=NAVY_D, w=0.35, h=10):
        m = (u0 + u1) / 2
        self.lface(v1, m - w / 2, m + w / 2, 0, h, col)

    def fan(self, u, v, z, r=0.28, frame=0):
        cx, cy = self.P(u, v, z)
        rx, ry = round(r * HW * 1.4), round(r * HH * 1.4)
        self.d.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=A(NAVY_D))
        for k in range(3):
            ang = frame * math.pi / 6 + k * 2 * math.pi / 3
            self.d.line([(cx, cy), (cx + round(math.cos(ang) * rx * 0.8), cy + round(math.sin(ang) * ry * 0.8))], fill=A(CON_L))

    def pyramid(self, u0, v0, u1, v1, z, h, col):
        apex = ((u0 + u1) / 2, (v0 + v1) / 2, z + h)
        self.poly([(u0, v1, z), (u1, v1, z), apex], shade(col, 0.92))
        self.poly([(u1, v1, z), (u1, v0, z), apex], shade(col, 0.74))

    def gable(self, u0, v0, u1, v1, z, h, col):
        vm = (v0 + v1) / 2
        self.poly([(u0, v1, z), (u1, v1, z), (u1, vm, z + h), (u0, vm, z + h)], shade(col, 0.95))
        self.poly([(u1, v1, z), (u1, v0, z), (u1, vm, z + h)], shade(col, 0.74))

    def stamp(self, img, u, v, anchor):
        """Paste a pack object (anchored at its tile centre) at grid point (u, v)."""
        x, y = self.P(u, v)
        self.img.alpha_composite(img, (x - anchor[0], y - anchor[1]))

    def finish(self, do_outline=True):
        img = outline(self.img) if do_outline else self.img
        return img, (self.ox, self.oy), (self.lights if self.lights.getbbox() else None)


SPRITES = {}


def add(name, c, anchor=None, do_outline=True, lights=True):
    if name in SPRITES:
        raise ValueError(f"duplicate sprite name: {name}")
    if isinstance(c, Canvas):
        img, anchor, lit = c.finish(do_outline)
        SPRITES[name] = (img, anchor)
        if lights and lit is not None:
            SPRITES[name + "@lights"] = (lit, anchor)
    else:
        SPRITES[name] = (c, anchor)


# ── the pack ──────────────────────────────────────────────────────────────────
PACKMETA = {}
PACKIMG = {}


def load_pack():
    with open(os.path.join(PACK, "pack.json")) as f:
        meta = json.load(f)
    PACKMETA.update(meta)
    for group in ("floors", "walls", "objects", "buildings"):
        for name, m in meta[group].items():
            img = Image.open(os.path.join(PACK, group, f"{name}.png")).convert("RGBA")
            PACKIMG[name] = (img, m.get("anchor", [16, 0]), m, group)


def add_pack():
    """Pack sprites, pixel-for-pixel, anchors converted to the N-corner convention."""
    for name, (img, (ax, ay), m, group) in PACKIMG.items():
        if name == "data_center_strip":
            fw = m["size"][0] // m["frames"]
            for i in range(m["frames"]):
                add(f"pack:data_center:{i}", img.crop((i * fw, 0, (i + 1) * fw, img.height)), (ax, ay))
        elif group == "objects":  # tile-centre anchor → N corner
            add(f"pack:{name}", img, (ax, ay - HH))
        else:
            add(f"pack:{name}", img, (ax, ay))


# ── ground ────────────────────────────────────────────────────────────────────

def ground(name, base, deco=None, key=None):
    c = Canvas(1, 1, 0, pad=0)
    c.poly([(0, 0), (1, 0), (1, 1), (0, 1)], base)
    if deco:
        deco(c, seeded(key or name))
    c.d.line([c.P(0, 1), c.P(1, 1), c.P(1, 0)], fill=A(shade(base, 0.86)))  # the pack's faint rim
    add(name, c, do_outline=False)


def specks(col, n):
    def f(c, r):
        for _ in range(n):
            x, y = c.P((r(80) + 10) / 100, (r(80) + 10) / 100)
            c.d.point([(x, y)], fill=A(col))
    return f


def road_line(axis):
    def f(c, r):
        specks(shade(ASPHALT, 1.18), 4)(c, r)
        for k in range(2):
            a, b = k * 0.5 + 0.12, k * 0.5 + 0.34
            p0, p1 = (c.P(a, 0.5), c.P(b, 0.5)) if axis == "x" else (c.P(0.5, a), c.P(0.5, b))
            c.d.line([p0, p1], fill=A(ORANGE))
    return f


def zebra(axis):
    def f(c, r):
        for k in range(3):
            a = 0.18 + k * 0.26
            if axis == "x":
                c.poly([(a, 0.12), (a + 0.12, 0.12), (a + 0.12, 0.88), (a, 0.88)], WHITE)
            else:
                c.poly([(0.12, a), (0.88, a), (0.88, a + 0.12), (0.12, a + 0.12)], WHITE)
    return f


def water(frame):
    def f(c, r):
        rr = seeded("water")
        for _ in range(4):
            u, v = (rr(70) + 15) / 100, (rr(70) + 15) / 100
            x, y = c.P((u + frame * 0.1) % 0.8 + 0.1, v)
            c.d.line([(x, y), (x + 2, y)], fill=A(shade(WATER, 1.28)))
    return f


def flowers_deco(c, r):
    for _ in range(6):
        x, y = c.P((r(70) + 15) / 100, (r(70) + 15) / 100)
        c.d.point([(x, y)], fill=A([(250, 250, 250), (255, 204, 60), (240, 110, 150)][r(3)]))


def build_ground():
    g = PACKIMG
    add("grass0", g["grass"][0], (16, 0))
    ground("grass1", GRASS, specks(shade(GRASS, 1.2), 5))
    ground("grass2", shade(GRASS, 0.96), flowers_deco)
    ground("grassDark", GRASS_D, specks(shade(GRASS_D, 1.25), 6))
    add("sidewalk", g["sidewalk"][0], (16, 0))
    add("plazaStone", g["concrete"][0], (16, 0))
    add("floorGrate", g["server_grate"][0], (16, 0))
    add("floorTile", g["tile_white"][0], (16, 0))
    add("carpet", g["carpet_navy"][0], (16, 0))
    ground("road", ASPHALT, specks(shade(ASPHALT, 1.18), 4))
    ground("roadX", ASPHALT, road_line("x"))
    ground("roadY", ASPHALT, road_line("y"))
    ground("zebraX", ASPHALT, zebra("x"))
    ground("zebraY", ASPHALT, zebra("y"))
    ground("sand", (230, 212, 164), specks((210, 190, 140), 6))
    ground("dirt", (160, 118, 82), specks((130, 92, 62), 8))
    ground("floorWood", WOOD, lambda c, r: [c.d.line([c.P(t, 0), c.P(t, 1)], fill=A(WOOD_D)) for t in (0.25, 0.5, 0.75)])
    for f in range(4):
        ground(f"water{f}", WATER, water(f))
    for side in ("L", "R"):
        c = Canvas(1, 1, 0, pad=0)
        c.h += 10
        c.img = Image.new("RGBA", (c.w, c.h), CLEAR)
        c.d = ImageDraw.Draw(c.img)
        if side == "L":
            c.poly([(0, 1, 0), (1, 1, 0), (1, 1, -7), (0, 1, -7)], (130, 94, 64))
            c.poly([(0, 1, 0), (1, 1, 0), (1, 1, -2), (0, 1, -2)], GRASS_D)
        else:
            c.poly([(1, 1, 0), (1, 0, 0), (1, 0, -7), (1, 1, -7)], (106, 76, 52))
            c.poly([(1, 1, 0), (1, 0, 0), (1, 0, -2), (1, 1, -2)], shade(GRASS_D, 0.85))
        add(f"edge{side}", c, do_outline=False)


# ── props ─────────────────────────────────────────────────────────────────────

def build_props():
    for short, name in (("tree0", "tree"), ("plant", "plant"), ("lamp", "lamp_post"), ("benchX", "bench_SE"), ("benchY", "bench_SW"), ("awsSign", "lambda_sign_SE"), ("dataBox", "data_box_SE")):
        img, (ax, ay), _, _ = PACKIMG[name]
        add(short, img, (ax, ay - HH))
    for name, kind in (("tree1", "round"), ("pine", "pine")):
        c = Canvas(1, 1, 60)
        c.box(0.2, 0.2, 0.8, 0.8, 0, 4, WHITE)
        c.poly([(0.26, 0.26, 4), (0.74, 0.26, 4), (0.74, 0.74, 4), (0.26, 0.74, 4)], GRASS)
        x, y = c.P(0.5, 0.5, 4)
        c.d.rectangle((x - 1, y - 16, x + 1, y), fill=A((120, 84, 50)))
        if kind == "round":
            for dx, dy, rr in [(0, -22, 9), (-6, -17, 6), (6, -17, 6), (0, -29, 6)]:
                c.d.ellipse((x + dx - rr, y + dy - rr, x + dx + rr, y + dy + rr), fill=A((80, 180, 88)))
            c.d.ellipse((x - 5, y - 30, x - 1, y - 26), fill=A((130, 214, 120)))
        else:
            for k, (w, yy) in enumerate([(10, -12), (8, -21), (5, -30)]):
                c.d.polygon([(x - w, y + yy + 4), (x + w, y + yy + 4), (x, y + yy - 8)], fill=A(shade(GRASS_D, 1 + k * 0.12)))
        add(name, c)
    c = Canvas(1, 1, 20)
    x, y = c.P(0.5, 0.5)
    for dx, rr in [(-4, 5), (4, 5), (0, 6)]:
        c.d.ellipse((x + dx - rr, y - 8 - rr, x + dx + rr, y - 8 + rr), fill=A((74, 168, 80)))
    add("bush", c)
    c = Canvas(1, 1, 12)
    c.box(0.12, 0.12, 0.88, 0.88, 0, 4, WHITE)
    c.poly([(0.18, 0.18, 4), (0.82, 0.18, 4), (0.82, 0.82, 4), (0.18, 0.82, 4)], GRASS_D)
    r = seeded("fl")
    for _ in range(9):
        x, y = c.P(0.22 + r(56) / 100, 0.22 + r(56) / 100, 4)
        c.d.rectangle((x, y - 2, x, y - 1), fill=A([(255, 110, 150), (255, 204, 60), (250, 250, 250), (170, 120, 250)][r(4)]))
    add("flowers", c)
    c = Canvas(1, 1, 16)
    c.box(0.36, 0.36, 0.64, 0.64, 0, 10, NAVY)
    c.box(0.34, 0.34, 0.66, 0.66, 10, 12, ORANGE)
    add("bin", c)
    for f in range(3):
        c = Canvas(1, 1, 30)
        c.box(0.05, 0.05, 0.95, 0.95, 0, 4, CON_L)
        c.poly([(0.15, 0.15, 4), (0.85, 0.15, 4), (0.85, 0.85, 4), (0.15, 0.85, 4)], WATER)
        c.box(0.42, 0.42, 0.58, 0.58, 4, 11, WHITE)
        x, y = c.P(0.5, 0.5, 11)
        for k in range(5):
            ang = k * 2 * math.pi / 5 + f * 0.5
            c.d.line([(x, y - 3 - f), (x + round(math.cos(ang) * 7), y + 5 + round(math.sin(ang) * 3))], fill=(210, 240, 255, 255))
        c.d.rectangle((x, y - 6 - f, x, y - 1), fill=(236, 248, 255, 255))
        add(f"fountain{f}", c)
    glow = Image.new("RGBA", (64, 40), CLEAR)
    gd = ImageDraw.Draw(glow)
    for i in range(10, 0, -1):
        gd.ellipse((32 - i * 3, 20 - i * 1.8, 32 + i * 3, 20 + i * 1.8), fill=(255, 220, 140, int(8 + (10 - i) * 5)))
    add("glow", glow, (32, 20))


# ── landmarks (data-centre style) ─────────────────────────────────────────────

def stripe_block(c, u0, v0, u1, v1, z1, col, key, fans=0, frame=0, wall=CON_L, lit=True):
    c.box(u0, v0, u1, v1, 0, z1, wall)
    c.louvres(u0, v0, u1, v1, 0, z1 - 6, wall)
    band = z1 - 7
    c.lface(v1, u0, u1, band, band + 3, col)
    c.rface(u1, v0, v1, band, band + 3, shade(col, 0.8))
    if lit:
        c.windows(u0, v0, u1, v1, 3, band - 1, key)
    c.door(u0, u1, v1)
    for k in range(fans):
        c.fan(u0 + 0.4 + k * 0.55, (v0 + v1) / 2, z1, frame=frame)


def construction(fw, fh):
    c = Canvas(fw, fh, 60)
    for u in (0.3, fw - 0.3):
        for v in (0.3, fh - 0.3):
            c.box(u - 0.04, v - 0.04, u + 0.04, v + 0.04, 0, 30, CON_M)
    for z in (15, 30):
        c.box(0.26, fh - 0.34, fw - 0.26, fh - 0.26, z, z + 2, CON_M)
        c.box(fw - 0.34, 0.26, fw - 0.26, fh - 0.26, z, z + 2, CON_M)
    c.box(0.5, 0.5, fw - 0.5, fh - 0.5, 0, 12, CON_L)
    c.box(0.1, 0.1, 0.22, 0.22, 0, 52, ORANGE)
    x0, y0 = c.P(0.16, 0.16, 52)
    x1, y1 = c.P(fw * 0.8, 0.16, 52)
    c.d.line([(x0, y0), (x1, y1)], fill=A(ORANGE))
    c.d.line([(x1, y1), (x1, y1 + 18)], fill=A(NAVY_D))
    c.d.rectangle((x1 - 2, y1 + 18, x1 + 2, y1 + 21), fill=A(WOOD))
    for k in range(fw * 2 + 1):
        u = k / 2
        c.box(max(0, u - 0.03), fh - 0.05, min(fw, u + 0.03), fh, 0, 6, ORANGE)
    c.box(0.05, fh - 0.05, fw - 0.05, fh, 3, 5, NAVY_D)
    return c


def k_building(fw, fh, tier, col, key):
    ins = 0.3 - 0.05 * tier
    z1 = 18 + 8 * tier
    c = Canvas(fw, fh, z1 + 30)
    stripe_block(c, ins, ins, fw - ins, fh - ins, z1, col, key, fans=min(3, tier))
    if tier >= 3:
        c.box(fw - ins - 0.9, ins + 0.2, fw - ins - 0.3, ins + 0.8, z1, z1 + 6, CON_M)
    if tier >= 4:
        c.poly([(ins + 0.2, fh - ins - 0.9, z1), (ins + 1.0, fh - ins - 0.9, z1), (ins + 1.0, fh - ins - 0.2, z1), (ins + 0.2, fh - ins - 0.2, z1)], GRASS)
    return c


def k_factory(fw, fh, tier, col, key):
    z1 = 16 + 5 * tier
    c = Canvas(fw, fh, z1 + 50)
    stripe_block(c, 0.25, 0.4, fw - 0.25, fh - 0.25, z1, col, key, wall=(196, 170, 150))
    for k in range(min(tier, 3)):
        u = 0.4 + k * 0.45
        c.box(u, 0.1, u + 0.25, 0.35, 0, z1 + 18 + k * 4, CON_D)
        c.box(u - 0.02, 0.08, u + 0.27, 0.37, z1 + 18 + k * 4, z1 + 20 + k * 4, col)
    return c


def k_warehouse(fw, fh, tier, col, key):
    z1 = 14 + 4 * tier
    c = Canvas(fw, fh, z1 + 26)
    c.box(0.2, 0.3, fw - 0.2, fh - 0.3, 0, z1, CON_L)
    c.louvres(0.2, 0.3, fw - 0.2, fh - 0.3, 0, z1, CON_L)
    for k in range(min(tier + 1, 3)):
        a = 0.45 + k * 0.8
        c.lface(fh - 0.3, a, a + 0.5, 0, 10, shade(col, 0.9))
        for z in range(2, 10, 2):
            c.lface(fh - 0.3, a, a + 0.5, z, z + 1, shade(col, 0.65))
    c.gable(0.15, 0.25, fw - 0.15, fh - 0.25, z1, 9, col)
    return c


def k_tower(fw, fh, tier, col, key):
    h = 34 + 12 * tier
    c = Canvas(fw, fh, h + 30)
    cu, cv, s = fw / 2, fh / 2, 0.5 + 0.06 * tier
    if tier >= 2:
        stripe_block(c, 0.35, cv, fw - 0.35, fh - 0.35, 14, col, key + "b")
    c.box(cu - s, cv - s, cu + s, cv + s, 0, h, CON_L)
    c.windows(cu - s, cv - s, cu + s, cv + s, 6, h - 4, key, every=0.4, size=0.2, fh=7)
    c.lface(cv + s, cu - s, cu + s, h - 5, h - 2, col)
    c.rface(cu + s, cv - s, cv + s, h - 5, h - 2, shade(col, 0.8))
    c.door(cu - s, cu + s, cv + s)
    c.pyramid(cu - s - 0.05, cv - s - 0.05, cu + s + 0.05, cv + s + 0.05, h, 14 + 2 * tier, col)
    if tier >= 4:
        x, y = c.P(cu, cv, h + 24)
        c.d.line([(x, y), (x, y - 8)], fill=A(CON_L))
        c.d.point([(x, y - 9)], fill=(255, 80, 80, 255))
    return c


def k_dome(fw, fh, tier, col, key):
    base = 10 + 3 * tier
    c = Canvas(fw, fh, base + 40)
    ins = 0.35 - 0.04 * tier
    stripe_block(c, ins, ins, fw - ins, fh - ins, base, col, key, lit=False)
    x, y = c.P(fw / 2, fh / 2, base)
    rad = round((fw / 2 - ins) * HW * 0.85)
    c.d.pieslice((x - rad, y - rad, x + rad, y + rad // 2), 180, 360, fill=A(shade(col, 1.05)))
    c.d.chord((x - rad, y - rad // 4, x + rad, y + rad // 4), 0, 180, fill=A(shade(col, 0.85)))
    c.d.ellipse((x - rad // 2, y - rad + 3, x - rad // 5, y - rad + 7), fill=A(shade(col, 1.4)))
    if tier >= 3:
        c.d.line([(x + 1, y - rad + 2), (x + rad - 1, y - rad - 7)], fill=A(NAVY), width=2)
    return c


def k_lake(fw, fh, tier, col, key):
    c = Canvas(fw, fh, 40)
    c.box(0.3, fh - 0.7, fw - 0.2, fh - 0.35, 1, 3, WOOD, top=shade(WOOD, 1.08))
    for u in (0.5, 1.5, 2.5):
        if u < fw:
            c.box(u, fh - 0.4, u + 0.08, fh - 0.32, -3, 3, WOOD_D)
    for i in range(tier):
        u = 0.5 + i * 0.6
        c.box(u, fh - 0.66, u + 0.28, fh - 0.4, 3, 9, [GRASS, (58, 111, 216), CON_M, ORANGE][i])
    if tier >= 3:
        c.box(fw - 1.0, 0.2, fw - 0.2, 1.0, 0, 16, WOOD)
        c.gable(fw - 1.05, 0.15, fw - 0.15, 1.05, 16, 8, col)
    if tier >= 2:
        c.box(1.1, 0.8, 1.8, 1.15, 0, 3, (230, 80, 70))
    return c


def k_wall(fw, fh, tier, col, key):
    h = 18 + 5 * tier
    c = Canvas(fw, fh, h + 20)
    v0, v1 = fh / 2 - 0.25, fh / 2 + 0.25
    c.box(0, v0, fw, v1, 0, h, CON_M)
    c.louvres(0, v0, fw, v1, 0, h, CON_M, step=4)
    for k in range(fw * 3):
        if k % 2 == 0:
            c.box(k / 3, v0, k / 3 + 1 / 3, v1, h, h + 4, CON_M)
    x, y = c.P(fw / 2, v1, h / 2 + 2)
    c.d.polygon([(x - 6, y - 6), (x + 6, y - 1), (x + 6, y + 4), (x, y + 7), (x - 6, y + 2)], fill=A(col))
    c.d.rectangle((x, y - 2, x, y + 4), fill=A(WHITE))
    if tier >= 3:
        for u in (0, fw - 0.7):
            c.box(u, v0 - 0.1, u + 0.7, v1 + 0.1, 0, h + 10, CON_D)
            c.pyramid(u, v0 - 0.1, u + 0.7, v1 + 0.1, h + 10, 8, col)
    return c


def k_garden(fw, fh, tier, col, key):
    c = Canvas(fw, fh, 70)
    hedge = (60, 140, 64)
    c.box(0, 0, fw, 0.22, 0, 7, hedge)
    c.box(0, 0, 0.22, fh, 0, 7, hedge)
    c.box(fw - 0.22, 0, fw, fh, 0, 7, hedge)
    c.box(0, fh - 0.22, fw * 0.4, fh, 0, 7, hedge)
    c.box(fw * 0.6, fh - 0.22, fw, fh, 0, 7, hedge)
    tree, anchor, _, _ = PACKIMG["tree"]
    for i in range(tier + 1):
        c.stamp(tree, 0.9 + (i % 2) * 1.2, 0.9 + (i // 2) * 0.9, anchor)
    x, y = c.P(fw / 2, fh - 0.1)
    c.d.rectangle((x - 1, y - 14, x, y), fill=A(col))
    c.d.rectangle((x - 5, y - 17, x + 5, y - 13), fill=A(col))
    return c


def k_stall(fw, fh, tier, col, key):
    c = Canvas(fw, fh, 40)
    u0, v0, u1, v1 = 0.4, fh / 2 - 0.2, fw - 0.4, fh - 0.4
    c.box(u0, v0, u1, v1, 0, 10, WOOD)
    c.box(u0, v1 - 0.08, u1, v1 + 0.08, 7, 9, WHITE)
    for pu in (u0, u1 - 0.06):
        c.box(pu, v1 - 0.06, pu + 0.06, v1, 10, 22, WOOD_D)
    for k in range(8):
        a = u0 - 0.1 + k * (u1 - u0 + 0.2) / 8
        b = a + (u1 - u0 + 0.2) / 8
        c.poly([(a, v0 - 0.2, 24), (b, v0 - 0.2, 24), (b, v1 + 0.3, 20), (a, v1 + 0.3, 20)], col if k % 2 else WHITE)
    if tier >= 2:
        for u in (0.6, fw - 0.9):
            c.box(u, 0.3, u + 0.35, 0.65, 0, 5, WHITE)
            x, y = c.P(u + 0.18, 0.48, 5)
            c.d.line([(x, y), (x, y - 9)], fill=A(CON_D))
            c.d.polygon([(x - 6, y - 8), (x + 6, y - 8), (x, y - 13)], fill=A(col if tier >= 3 else ORANGE))
    return c


def k_dock(fw, fh, tier, col, key):
    c = Canvas(fw, fh, 44)
    c.box(0, fh - 1, fw, fh - 0.2, 0, 3, WOOD, top=shade(WOOD, 1.08))
    cols = [(239, 68, 68), (59, 130, 246), (34, 197, 94), ORANGE, (139, 92, 246), (20, 184, 166), (236, 72, 153), CON_M]
    for i in range(tier * 2):
        u = 0.2 + (i % 3) * 0.95
        v = 0.3 + (i // 3 % 2) * 0.75
        z = (i // 6) * 9
        c.box(u, v, u + 0.85, v + 0.5, z, z + 9, cols[i % len(cols)])
        for k in range(3):
            c.lface(v + 0.5, u + 0.12 + k * 0.25, u + 0.15 + k * 0.25, z + 1, z + 8, shade(cols[i % len(cols)], 0.72))
    c.box(fw - 0.45, 0.1, fw - 0.3, 0.25, 0, 36, ORANGE)
    c.line((fw - 0.38, 0.18, 36), (fw - 0.38, fh - 0.6, 36), ORANGE)
    return c


def k_station(fw, fh, tier, col, key):
    c = Canvas(fw, fh, 44)
    c.box(0.1, 0.8, fw - 0.1, fh - 0.3, 0, 3, CON_L)
    for u in (0.3, fw / 2, fw - 0.4):
        c.box(u, fh - 0.5, u + 0.08, fh - 0.42, 3, 20, NAVY)
    c.poly([(0, 0.7, 22), (fw, 0.7, 22), (fw, fh - 0.2, 19), (0, fh - 0.2, 19)], col)
    stripe_block(c, 0.3, 0.2, fw - 0.3, 0.9, 16 + 3 * tier, col, key)
    return c


KINDS = dict(building=k_building, tower=k_tower, dome=k_dome, lake=k_lake, wall=k_wall, garden=k_garden, stall=k_stall,
             dock=k_dock, factory=k_factory, warehouse=k_warehouse, station=k_station)


def spheres():
    """Amazon's The Spheres: three glass domes (lattice) full of plants, on a green plaza with trees."""
    c = Canvas(4, 4, 90)
    c.box(0.05, 0.05, 3.95, 3.95, 0, 3, CON_L, top=GRASS_D)
    tree, anchor, _, _ = PACKIMG["tree"]
    for u, v in ((0.4, 3.5), (3.5, 0.4)):
        c.stamp(tree, u, v, anchor)

    def sphere(u, v, r, lift=3):
        cx, cy = c.P(u, v, lift)
        rx, ry = round(r * HW * 1.25), round(r * HW * 1.15)
        top = cy - ry * 2 + 4
        box = (cx - rx, top, cx + rx, cy + 4)
        c.d.ellipse(box, fill=A((64, 150, 96)))
        r2 = seeded(f"sph{u}{v}")
        for _ in range(int(r * 18)):
            px = cx + r2(2 * rx - 6) - rx + 3
            py = top + 6 + r2(max(1, ry * 2 - 8))
            c.d.ellipse((px - 3, py - 3, px + 3, py + 3), fill=A([(80, 180, 88), (46, 130, 70), (120, 200, 110)][r2(3)]))
        glass = Image.new("RGBA", c.img.size, CLEAR)
        gd = ImageDraw.Draw(glass)
        gd.ellipse(box, fill=(170, 224, 240, 120))
        gd.ellipse((cx - rx // 2, top + 4, cx - rx // 6, top + ry // 2), fill=(255, 255, 255, 110))
        c.img.alpha_composite(glass)
        mask = Image.new("L", c.img.size, 0)
        ImageDraw.Draw(mask).ellipse(box, fill=255)
        net = Image.new("RGBA", c.img.size, CLEAR)
        nd = ImageDraw.Draw(net)
        step = 7
        for i in range(-rx * 2, rx * 2, step):
            nd.line([(cx + i, top), (cx + i + ry, cy + 4)], fill=A((210, 226, 236)))
            nd.line([(cx + i, top), (cx + i - ry, cy + 4)], fill=A((210, 226, 236)))
        for yy in range(top + step, cy + 4, step + 2):
            nd.line([(cx - rx, yy), (cx + rx, yy)], fill=A((190, 210, 224)))
        c.img.paste(net, (0, 0), ImageChops.multiply(mask, net.getchannel("A")))
        c.d.ellipse(box, outline=A(NAVY))
        c.d.line([(cx - rx + 2, cy + 3), (cx + rx - 2, cy + 3)], fill=A(CON_D))
        c.ld.ellipse((cx - rx // 2, cy - ry, cx + rx // 2, cy), fill=(200, 255, 220, 120))  # warm glow at night

    sphere(1.3, 3.0, 0.8)
    sphere(1.5, 1.7, 1.25)  # middle, largest
    sphere(3.0, 1.3, 0.85)
    c.stamp(tree, 3.5, 3.5, anchor)
    return c


def hq(col, key):
    c = Canvas(2, 2, 60)
    c.box(0.12, 0.12, 1.88, 1.88, 0, 30, NAVY)
    c.windows(0.12, 0.12, 1.88, 1.88, 3, 26, key, every=0.34, size=0.22, fh=7)
    c.lface(1.88, 0.12, 1.88, 25, 28, col)
    c.rface(1.88, 0.12, 1.88, 25, 28, shade(col, 0.8))
    c.door(0.12, 1.88, 1.88, col=ORANGE, w=0.4, h=10)
    c.box(0.08, 0.08, 1.92, 1.92, 30, 33, col)
    c.box(1.3, 0.3, 1.6, 0.6, 33, 37, CON_M)
    x, y = c.P(0.3, 0.3, 33)
    c.d.line([(x, y), (x, y - 14)], fill=A(CON_L))
    c.d.polygon([(x + 1, y - 14), (x + 10, y - 11), (x + 1, y - 8)], fill=A(col))
    return c


def lookout_tower():
    c = Canvas(1, 1, 90)
    for u, v in ((0.15, 0.15), (0.8, 0.15), (0.8, 0.8), (0.15, 0.8)):
        c.box(u, v, u + 0.06, v + 0.06, 0, 56, WOOD_D)
    c.box(0.05, 0.05, 0.95, 0.95, 56, 60, WOOD)
    c.box(0.2, 0.2, 0.8, 0.8, 60, 70, CON_M)
    c.pyramid(0.05, 0.05, 0.95, 0.95, 70, 10, NAVY)
    x, y = c.P(0.8, 0.8, 64)
    c.d.rectangle((x - 2, y - 2, x + 2, y + 1), fill=A(NAVY_D))
    c.d.point([(x, y - 1)], fill=(120, 190, 240, 255))
    return c


def workshop():
    c = Canvas(3, 3, 60)
    stripe_block(c, 0.25, 0.25, 2.75, 2.75, 24, ORANGE, "workshop", wall=(186, 102, 82))
    c.gable(0.2, 0.2, 2.8, 2.8, 24, 12, NAVY)
    x, y = c.P(1.5, 2.75, 16)
    for k in range(8):
        a = k * math.pi / 4
        c.d.rectangle((x + round(math.cos(a) * 5) - 1, y + round(math.sin(a) * 5) - 1, x + round(math.cos(a) * 5) + 1, y + round(math.sin(a) * 5) + 1), fill=A(ORANGE))
    c.d.ellipse((x - 4, y - 4, x + 4, y + 4), fill=A(ORANGE))
    c.d.ellipse((x - 2, y - 2, x + 2, y + 2), fill=A(NAVY))
    return c


def build_landmarks(world):
    colors = {d["id"]: rgb(d["color"]) for d in world["districts"]}
    for fw, fh in ((3, 3), (2, 2), (1, 1)):
        add(f"construction{fw}x{fh}", construction(fw, fh), lights=False)
    for s in world["services"]:
        for tier in (1, 2, 3, 4):
            add(f"lm:{s['id']}:{tier}", KINDS[s["kind"]](3, 3, tier, colors[s["districtId"]], f"{s['id']}{tier}"))
    for d in world["districts"]:
        add(f"hq:{d['id']}", hq(colors[d["id"]], d["id"]))
    add("spheres", spheres())
    add("lookout", lookout_tower())
    add("workshop", workshop())


# ── interior bits the pack doesn't have ───────────────────────────────────────

def build_interior():
    for name, left in (("wallL", True), ("wallR", False)):
        c = Canvas(1, 1, 70, pad=0)
        c.h += 2
        if left:
            c.poly([(0, 0, 0), (0, 1, 0), (0, 1, 66), (0, 0, 66)], NAVY)
            c.poly([(0, 0, 0), (0, 1, 0), (0, 1, 3), (0, 0, 3)], ORANGE)
        else:
            c.poly([(0, 0, 0), (1, 0, 0), (1, 0, 66), (0, 0, 66)], shade(NAVY, 0.85))
            c.poly([(0, 0, 0), (1, 0, 0), (1, 0, 3), (0, 0, 3)], ORANGE_D)
        add(name, c, do_outline=False, lights=False)
    c = Canvas(2, 1, 30)
    c.box(0.1, 0.2, 1.9, 0.9, 0, 6, (58, 90, 150))
    c.box(0.1, 0.1, 1.9, 0.32, 6, 13, (48, 76, 130))
    add("sofa", c)
    for f in range(2):
        c = Canvas(1, 1, 70)
        c.box(0.2, 0.2, 0.8, 0.8, 0, 50, NAVY_D)
        r = seeded(f"rack{f}")
        for z in range(6, 46, 5):
            for k in range(3):
                on = r(2) == 0
                c.lface(0.8, 0.28 + k * 0.1, 0.33 + k * 0.1, z, z + 1, (80, 230, 140) if on else (40, 90, 60), light=on)
        add(f"rack{f}", c)


# ── packing ───────────────────────────────────────────────────────────────────

def pack(sprites, max_w=2048, max_h=2048):
    items = sorted(sprites.items(), key=lambda kv: -kv[1][0].height)
    pages, cur, x, y, row = [], {}, 0, 0, 0
    for name, (img, anchor) in items:
        w, h = img.width + 2, img.height + 2
        if x + w > max_w:
            x, y, row = 0, y + row, 0
        if y + h > max_h:
            pages.append(cur)
            cur, x, y, row = {}, 0, 0, 0
        cur[name] = (img, anchor, x + 1, y + 1)
        x += w
        row = max(row, h)
    if cur:
        pages.append(cur)
    return pages


def main():
    with open(os.path.join(ROOT, "shared", "world.json")) as f:
        world = json.load(f)
    load_pack()
    add_pack()
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
        json.dump({"textures": textures, "meta": {"app": "aws-city generate_tiles.py", "version": "3"}}, f, separators=(",", ":"))
    with open(os.path.join(OUT, "sprites.json"), "w") as f:
        json.dump({"tile": {"halfW": HW, "halfH": HH}, "sprites": anchors}, f, separators=(",", ":"))
    shutil.copy(os.path.join(PACK, "props", "door_left.png"), os.path.join(OUT, "door_left.png"))
    print(f"{len(SPRITES)} sprites on {len(pages)} page(s) → {OUT}")
    preview()


def preview():
    os.makedirs(CACHE, exist_ok=True)
    canvas = Image.new("RGBA", (1100, 560), (13, 8, 22, 255))
    ox, oy = 550, 60

    def put(name, gx, gy):
        img, (ax, ay) = SPRITES[name]
        canvas.alpha_composite(img, (ox + round((gx - gy) * HW) - ax, oy + round((gx + gy) * HH) - ay))

    for gy in range(22):
        for gx in range(22):
            t = ("roadX" if gy == 10 else "roadY") if gy == 10 or gx == 10 else ("sidewalk" if gx in (9, 11) or gy in (9, 11) else "grass0")
            if 12 <= gx <= 14 and 1 <= gy <= 3:
                t = "water0" if gy < 3 else "sand"
            if 1 <= gx <= 7 and 12 <= gy <= 19:
                t = "plazaStone"
            put(t, gx, gy)
    items = [("spheres", 2, 13), ("lm:ec2:4", 1, 1), ("lm:lambda:3", 5, 1), ("lm:s3:3", 12, 1), ("lm:iam:3", 16, 1), ("lm:dynamodb:4", 12, 13),
             ("construction3x3", 17, 13), ("pack:data_center:0", 12, 5), ("tree0", 2, 6), ("tree1", 6, 6), ("pine", 7, 7), ("lamp", 9, 3), ("benchX", 7, 19),
             ("flowers", 1, 19), ("lm:shield:4", 1, 5), ("lookout", 7, 12), ("hq:compute", 16, 6)]
    for name, gx, gy in sorted(items, key=lambda t: t[1] + t[2]):
        put(name, gx, gy)
    canvas.resize((canvas.width * 3 // 2, canvas.height * 3 // 2), Image.NEAREST).save(os.path.join(CACHE, "city-preview.png"))


if __name__ == "__main__":
    main()
