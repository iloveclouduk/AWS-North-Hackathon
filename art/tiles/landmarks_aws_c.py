"""Bespoke landmarks: Security Keep + AI Heights (iam cognito kms shield guardduty cloudwatch bedrock agentcore sagemaker q rekognition textract). See landmarks_aws.py."""
import math

from generate_tiles import (A, CLEAR, CON_D, CON_L, CON_M, GLASS, GLASS_D, GRASS, GRASS_D, HH, HW, NAVY, NAVY_D, ORANGE,  # noqa: F401
                            ORANGE_D, OUTLINE, PACKIMG, WATER, WHITE, WOOD, WOOD_D, Canvas, seeded, shade, stripe_block)

GOLD = (250, 206, 60)
WARM = (255, 214, 120)
STONE = (168, 158, 146)
STONE_D = (128, 118, 108)
BRICK = (178, 96, 76)
CREAM = (232, 222, 196)
PAPER = (246, 240, 222)
INK = (40, 36, 56)
TEAL_GLOW = (120, 255, 220)
GREEN_LED = (80, 230, 140)


# ── small helpers ─────────────────────────────────────────────────────────────

def glyph(c, x, y, rows, col, light=None, s=1):
    """Screen-aligned pixel glyph; `light` also paints it into the night layer."""
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch == ".":
                continue
            box = (x + i * s, y + j * s, x + i * s + s - 1, y + j * s + s - 1)
            c.d.rectangle(box, fill=A(col))
            if light:
                c.ld.rectangle(box, fill=A(light))


def plate(c, x, y, w, h, bg, rim=NAVY_D):
    c.d.rectangle((x - 1, y - 1, x + w, y + h), fill=A(rim))
    c.d.rectangle((x, y, x + w - 1, y + h - 1), fill=A(bg))


def flag(c, u, v, z, h, col):
    x, y = c.P(u, v, z)
    c.d.line([(x, y), (x, y - h)], fill=A(CON_L))
    c.d.polygon([(x + 1, y - h), (x + 9, y - h + 3), (x + 1, y - h + 6)], fill=A(col))


def lamp(c, u, v, h=14):
    x, y = c.P(u, v)
    c.d.line([(x, y), (x, y - h)], fill=A(NAVY))
    c.d.rectangle((x - 1, y - h - 3, x + 1, y - h), fill=A(WARM))
    c.ld.ellipse((x - 4, y - h - 6, x + 4, y - h + 3), fill=(255, 214, 120, 150))


def tree(c, u, v):
    img, anchor, _, _ = PACKIMG["tree"]
    c.stamp(img, u, v, anchor)


def ellipse_at(c, u, v, z, rx, ry, fill, lit=None, outline=None):
    x, y = c.P(u, v, z)
    c.d.ellipse((x - rx, y - ry, x + rx, y + ry), fill=A(fill), outline=A(outline) if outline else None)
    if lit:
        c.ld.ellipse((x - rx, y - ry, x + rx, y + ry), fill=A(lit, 190))
    return x, y


KEY = [".XX.......", "X..XXXXXXX", "X..X...X.X", ".XX........"]
Q_BIG = [".XXXX..", "XX..XX.", "XX..XX.", "XX..XX.", "XX.XXX.", ".XXXX..", "....XX."]


# ── Security Keep ─────────────────────────────────────────────────────────────

def lm_iam(fw, fh, tier, col, key):
    """IAM Gatehouse: a keep behind a gate wall; key-card turnstiles in the gateway, more each tier."""
    h = 20 + 4 * tier
    c = Canvas(fw, fh, h + 44)
    c.box(0.4, 0.3, 2.6, 1.4, 0, h, CON_L)
    c.windows(0.4, 0.3, 2.6, 1.4, 3, h - 5, key, every=0.45, size=0.24, fh=8)
    c.lface(1.4, 0.4, 2.6, h - 5, h - 2, col)
    c.rface(2.6, 0.3, 1.4, h - 5, h - 2, shade(col, 0.8))
    c.box(0.35, 0.25, 2.65, 1.45, h, h + 3, col)
    for k in range(6):  # crenellations
        u = 0.4 + k * 0.4
        c.box(u, 1.25, u + 0.2, 1.45, h + 3, h + 6, CON_M)
    if tier >= 4:
        flag(c, 1.5, 0.8, h + 3, 16, col)
    if tier >= 3:
        for u0 in (0.15, 2.3):
            c.box(u0, 1.9, u0 + 0.55, 2.7, 0, 30, CON_M)
            c.windows(u0, 1.9, u0 + 0.55, 2.7, 14, 26, key + str(u0), every=0.55, size=0.2)
            c.pyramid(u0 - 0.05, 1.85, u0 + 0.6, 2.75, 30, 10, col)
    wall = 13 + tier
    c.box(0.25 if tier < 3 else 0.7, 2.2, 0.95, 2.6, 0, wall, CON_M)
    c.box(2.05, 2.2, 2.75 if tier < 3 else 2.3, 2.6, 0, wall, CON_M)
    c.louvres(0.25, 2.2, 0.95, 2.6, 0, wall, CON_M, step=4)
    # key-card turnstiles in the gateway
    n = [1, 2, 2, 3][tier - 1]
    for i in range(n):
        u = 1.05 + i * (0.8 / max(1, n)) + 0.08
        c.box(u, 2.3, u + 0.1, 2.5, 0, 8, NAVY)
        x, y = c.P(u + 0.05, 2.5, 8)
        c.d.rectangle((x - 1, y - 2, x + 1, y), fill=A(GREEN_LED))
        c.ld.rectangle((x - 1, y - 2, x + 1, y), fill=A(GREEN_LED))
        x0, y0 = c.P(u + 0.1, 2.45, 5)
        c.d.line([(x0, y0), (x0 + 5, y0 + 2)], fill=A(CON_L))
    c.box(0.95, 2.2, 2.05, 2.6, wall - 3, wall + 1, CON_M)  # lintel
    x, y = c.P(1.5, 2.6, wall - 1)
    plate(c, x - 7, y - 2, 12, 5, NAVY)
    glyph(c, x - 6, y - 2, KEY, GOLD, light=GOLD if tier >= 2 else None)
    if tier >= 2:  # badge sign on a post
        x, y = c.P(2.85, 2.85)
        c.d.line([(x, y), (x, y - 14)], fill=A(NAVY))
        plate(c, x - 4, y - 22, 8, 9, WHITE)
        c.d.rectangle((x - 3, y - 21, x + 2, y - 19), fill=A(col))
        c.d.rectangle((x - 2, y - 17, x - 1, y - 16), fill=A(NAVY))
        c.d.line([(x, y - 17), (x + 2, y - 17)], fill=A(CON_D))
    return c


def lm_cognito(fw, fh, tier, col, key):
    """Cognito Passport Office: a civic hall with a passport sign and an ID stamp; queues and wings grow."""
    h = 18 + 4 * tier
    c = Canvas(fw, fh, h + 44)
    if tier >= 3:  # side wing
        c.box(1.9, 0.3, 2.8, 1.5, 0, h - 6, CREAM)
        c.windows(1.9, 0.3, 2.8, 1.5, 3, h - 9, key + "w", every=0.4, size=0.22, fh=8)
        c.box(1.85, 0.25, 2.85, 1.55, h - 6, h - 4, col)
    c.box(0.3, 0.4, 2.2, 2.0, 0, h, CREAM)
    c.windows(0.3, 0.4, 2.2, 2.0, 3, h - 4, key, every=0.45, size=0.25, fh=8)
    c.lface(2.0, 0.3, 2.2, h - 4, h - 1, col)
    c.gable(0.25, 0.35, 2.25, 2.05, h, 10, col)
    if tier >= 4:
        c.box(1.1, 1.1, 1.4, 1.4, h + 4, h + 14, CREAM)
        c.pyramid(1.05, 1.05, 1.45, 1.45, h + 14, 6, col)
        x, y = c.P(1.4, 1.25, h + 10)
        c.d.ellipse((x - 2, y - 2, x + 2, y + 2), fill=A(WHITE), outline=A(NAVY))
    # counter window + door
    c.lface(2.0, 0.55, 1.05, 4, 12, GLASS, light=True)
    c.lface(2.0, 0.55, 1.05, 4, 5, WOOD)
    c.door(1.1, 1.9, 2.0, col=NAVY_D, w=0.34, h=11)
    # passport sign on the gable end
    x, y = c.P(1.25, 2.0, h + 1)
    plate(c, x - 5, y - 9, 10, 12, NAVY)
    c.d.ellipse((x - 3, y - 7, x + 2, y - 2), outline=A(GOLD))
    c.d.line([(x - 3, y - 5), (x + 2, y - 5)], fill=A(GOLD))
    c.d.line([(x - 1, y - 7), (x - 1, y - 2)], fill=A(GOLD))
    c.d.rectangle((x - 3, y + 0, x + 2, y + 1), fill=A(GOLD))
    c.ld.rectangle((x - 3, y + 0, x + 2, y + 1), fill=A(GOLD))
    if tier >= 3:  # red ID stamp on the wing
        x, y = c.P(2.8, 1.0, h - 12)
        c.d.ellipse((x - 5, y - 4, x + 3, y + 4), outline=A((214, 60, 60)))
        glyph(c, x - 3, y - 2, ["X.XX", "X.X.X", "X.XX"], (214, 60, 60))
    if tier >= 2:  # queue rope posts
        for i in range(3 if tier < 4 else 4):
            u = 0.4 + i * 0.35
            c.box(u, 2.5, u + 0.07, 2.57, 0, 7, GOLD)
            if i:
                a, b = c.P(u - 0.3, 2.53, 5), c.P(u, 2.53, 5)
                c.d.line([a, (a[0] + (b[0] - a[0]) // 2, a[1] + (b[1] - a[1]) // 2 + 2), b], fill=A((200, 50, 60)))
    if tier >= 4:
        lamp(c, 2.7, 2.7)
    return c


def lm_kms(fw, fh, tier, col, key):
    """KMS Vault: a heavy strongroom with a round vault door and a gold key; bullion and a roof key grow."""
    h = 22 + 4 * tier
    c = Canvas(fw, fh, h + 46)
    wall = (118, 124, 136)
    c.box(0.35, 0.35, 2.65, 2.4, 0, h, wall)
    c.louvres(0.35, 0.35, 2.65, 2.4, 0, h, wall, step=5)
    c.lface(2.4, 0.35, 2.65, h - 6, h - 3, col)
    c.rface(2.65, 0.35, 2.4, h - 6, h - 3, shade(col, 0.8))
    c.box(0.3, 0.3, 2.7, 2.45, h, h + 4, shade(wall, 0.85))
    # round vault door on the front
    x, y = c.P(1.5, 2.4, 12)
    r = 8 + (1 if tier >= 2 else 0)
    c.d.ellipse((x - r - 2, y - r - 1, x + r + 2, y + r + 1), fill=A(NAVY_D))
    c.d.ellipse((x - r, y - r, x + r, y + r), fill=A((200, 204, 214)))
    c.d.ellipse((x - r + 3, y - r + 3, x + r - 3, y + r - 3), fill=A((170, 176, 188)))
    for k in range(6):
        a = k * math.pi / 3
        c.d.line([(x, y), (x + round(math.cos(a) * (r - 3)), y + round(math.sin(a) * (r - 3)))], fill=A(NAVY))
    c.d.ellipse((x - 2, y - 2, x + 2, y + 2), fill=A(GOLD))
    if tier >= 2:
        for k in range(8):  # bolts
            a = k * math.pi / 4
            bx, by = x + round(math.cos(a) * (r + 1)), y + round(math.sin(a) * (r + 1))
            c.d.point([(bx, by)], fill=A(GOLD))
    # key sign above the door
    kx, ky = c.P(1.5, 2.4, h - 7)
    glyph(c, kx - 5, ky - 3, KEY, GOLD, light=GOLD)
    if tier >= 3:  # side window with gold bars
        c.rface(2.65, 0.8, 1.8, 6, 16, NAVY_D)
        for i in range(3):
            c.rface(2.65, 0.95 + i * 0.28, 1.15 + i * 0.28, 7, 10, GOLD, light=True)
        c.rface(2.65, 1.05, 1.6, 11, 14, GOLD, light=True)
        for u in (0.45, 2.3):
            c.box(u, 2.5, u + 0.22, 2.72, 0, 18, CON_L)
            c.box(u - 0.03, 2.47, u + 0.25, 2.75, 18, 21, col)
    if tier >= 4:  # giant key on the roof
        x, y = c.P(1.4, 1.3, h + 4)
        c.d.ellipse((x - 6, y - 26, x + 4, y - 16), outline=A(GOLD), width=2)
        c.d.rectangle((x - 2, y - 16, x, y - 2), fill=A(GOLD))
        c.d.rectangle((x, y - 8, x + 4, y - 7), fill=A(GOLD))
        c.d.rectangle((x, y - 4, x + 3, y - 3), fill=A(GOLD))
        c.ld.ellipse((x - 6, y - 26, x + 4, y - 16), outline=(255, 220, 120, 200), width=2)
    return c


def lm_shield(fw, fh, tier, col, key):
    """Shield Wall: a battlement with a big shield; towers, a WAF filter gate and banners at higher tiers."""
    h = 20 + 4 * tier
    c = Canvas(fw, fh, h + 40)
    v0, v1 = 1.2, 1.75
    if tier >= 4:  # keep behind the wall
        c.box(1.0, 0.25, 2.0, 1.1, 0, h + 20, CON_M)
        c.windows(1.0, 0.25, 2.0, 1.1, h, h + 16, key + "k", every=0.5, size=0.2)
        c.pyramid(0.95, 0.2, 2.05, 1.15, h + 20, 12, col)
    gate = tier >= 3
    segs = [(0, 1.15), (1.85, 3)] if gate else [(0, 3)]
    for a, b in segs:
        c.box(a, v0, b, v1, 0, h, CON_M)
        c.louvres(a, v0, b, v1, 0, h, CON_M, step=4)
        k = a
        while k < b - 0.05:
            c.box(k, v0, min(b, k + 0.18), v1, h, h + 4, CON_M)
            k += 0.36
    if gate:  # WAF filter: a portcullis grid packets have to pass
        c.box(1.15, v0, 1.85, v1, h - 6, h, CON_D)
        for i in range(5):
            u = 1.2 + i * 0.14
            c.lface(v1, u, u + 0.04, 0, h - 6, NAVY)
        for z in (5, 11):
            c.lface(v1, 1.15, 1.85, z, z + 1, NAVY)
        c.box(1.25, 2.3, 1.4, 2.45, 2, 5, (90, 220, 120))  # allowed packet
        x, y = c.P(1.7, 2.45, 3)
        c.d.line([(x - 3, y - 3), (x + 3, y + 3)], fill=A((230, 50, 50)))  # blocked packet
        c.d.line([(x - 3, y + 3), (x + 3, y - 3)], fill=A((230, 50, 50)))
    if tier >= 2:
        for u in (0, 2.3):
            c.box(u, v0 - 0.12, u + 0.7, v1 + 0.12, 0, h + 12, CON_D)
            c.box(u - 0.03, v0 - 0.15, u + 0.73, v1 + 0.15, h + 12, h + 15, CON_M)
            c.lface(v1 + 0.12, u + 0.25, u + 0.45, h, h + 6, NAVY_D, light=True)
            if tier >= 4:
                flag(c, u + 0.35, (v0 + v1) / 2, h + 15, 14, col)
    # the big shield
    su = 1.5 if not gate else 0.6
    x, y = c.P(su, v1, h / 2 + 4 if not gate else h / 2 + 2)
    s = 1 if tier < 2 else 1.25
    pts = [(-8, -9), (8, -9), (8, 2), (0, 10), (-8, 2)]
    c.d.polygon([(x + round(px * s), y + round(py * s)) for px, py in pts], fill=A(NAVY_D))
    pts2 = [(-7, -8), (7, -8), (7, 2), (0, 9), (-7, 2)]
    c.d.polygon([(x + round(px * s), y + round(py * s)) for px, py in pts2], fill=A(col))
    c.d.polygon([(x - round(4 * s), y - round(3 * s)), (x, y + round(1 * s)), (x + round(4 * s), y - round(3 * s)), (x + round(4 * s), y), (x, y + round(4 * s)), (x - round(4 * s), y)], fill=A(WHITE))
    c.ld.polygon([(x + round(px * s), y + round(py * s)) for px, py in pts2], fill=(255, 120, 130, 110))
    if tier >= 3:
        if gate:
            gx, gy = c.P(2.4, v1, h / 2 + 2)
            plate(c, gx - 7, gy - 4, 14, 7, NAVY)
            glyph(c, gx - 6, gy - 3, ["X.X.X.X..XX", "X.X.XXX.XX.", ".X.X..X.X.."], GREEN_LED, light=GREEN_LED)
    return c


def lm_guardduty(fw, fh, tier, col, key):
    """GuardDuty Watchtower: a stone tower whose cabin is a great watchful eye; searchlight and radar later."""
    h = 40 + 8 * tier
    c = Canvas(fw, fh, h + 40)
    cu, cv = 1.5, 1.5
    s = 0.45
    c.box(cu - s - 0.1, cv - s - 0.1, cu + s + 0.1, cv + s + 0.1, 0, 10, STONE_D)
    c.box(cu - s, cv - s, cu + s, cv + s, 10, h - 16, STONE)
    c.louvres(cu - s, cv - s, cu + s, cv + s, 10, h - 16, STONE, step=6)
    c.door(cu - s, cu + s, cv + s + 0.1, h=9)
    c.lface(cv + s, cu - 0.1, cu + 0.1, 22, 28, NAVY_D, light=True)
    # cabin
    cs = s + 0.2
    c.box(cu - cs, cv - cs, cu + cs, cv + cs, h - 16, h, CON_L)
    c.box(cu - cs - 0.05, cv - cs - 0.05, cu + cs + 0.05, cv + cs + 0.05, h - 17, h - 15, col)
    c.pyramid(cu - cs - 0.08, cv - cs - 0.08, cu + cs + 0.08, cv + cs + 0.08, h, 12, col)
    # the eye (front-left face)
    x, y = c.P(cu, cv + cs, h - 8)
    c.d.polygon([(x - 9, y), (x - 4, y - 4), (x + 4, y - 4), (x + 9, y), (x + 4, y + 4), (x - 4, y + 4)], fill=A(WHITE))
    c.d.polygon([(x - 9, y), (x - 4, y - 4), (x + 4, y - 4), (x + 9, y), (x + 4, y + 4), (x - 4, y + 4)], outline=A(NAVY_D))
    c.d.ellipse((x - 3, y - 3, x + 3, y + 3), fill=A(col))
    c.d.ellipse((x - 1, y - 1, x + 1, y + 1), fill=A(NAVY_D))
    c.d.point([(x + 1, y - 2)], fill=A(WHITE))
    c.ld.polygon([(x - 9, y), (x - 4, y - 4), (x + 4, y - 4), (x + 9, y), (x + 4, y + 4), (x - 4, y + 4)], fill=(255, 240, 200, 160))
    # right-face window
    c.rface(cu + cs, cv - 0.25, cv + 0.25, h - 12, h - 4, GLASS_D, light=True)
    if tier >= 3:  # searchlight beam (night only) + a lamp on the roof edge
        bx, by = c.P(cu + cs, cv - cs, h - 4)
        c.d.rectangle((bx - 1, by - 3, bx + 2, by), fill=A(GOLD))
        c.ld.polygon([(bx, by - 2), (bx + 44, by - 20), (bx + 44, by + 6)], fill=(255, 240, 180, 70))
    if tier >= 4:
        x, y = c.P(cu, cv, h + 12)
        c.d.line([(x, y), (x, y - 8)], fill=A(CON_L))
        c.d.point([(x, y - 9)], fill=(255, 80, 80, 255))
        c.ld.point([(x, y - 9)], fill=(255, 80, 80, 255))
        # radar dish on a mast, front-left
        c.box(0.35, 2.2, 0.5, 2.35, 0, 22, CON_D)
        x, y = c.P(0.42, 2.28, 22)
        c.d.chord((x - 8, y - 9, x + 6, y + 3), 160, 340, fill=A(CON_L), outline=A(NAVY))
        c.d.line([(x - 1, y - 3), (x + 4, y - 9)], fill=A(NAVY))
        c.d.point([(x + 4, y - 10)], fill=A((255, 80, 80)))
    if tier >= 2:  # a picket fence along the front, gap at the door
        for k in range(11):
            u = 0.2 + k * 0.26
            if 1.05 < u < 1.95:
                continue
            c.box(u, 2.7, u + 0.06, 2.76, 0, 8, WOOD)
        for a, b in ((0.2, 1.05), (1.95, 2.85)):
            c.box(a, 2.71, b, 2.75, 5, 6, WOOD_D)
    return c


def lm_cloudwatch(fw, fh, tier, col, key):
    """Clocktower Observatory: a clocktower over a hall of graph screens; CloudTrail footprints + log scroll later."""
    h = 44 + 8 * tier
    c = Canvas(fw, fh, h + 36)
    base = 16 + 2 * tier
    c.box(0.3, 0.8, 2.7, 2.5, 0, base, CON_L)
    c.box(0.25, 0.75, 2.75, 2.55, base, base + 3, col)
    # graph screens on the hall's front and right faces
    screens = [0.5, 1.3] + ([2.0] if tier >= 2 else [])
    r = seeded(key)
    for u in screens:
        c.lface(2.5, u, u + 0.55, 4, 13, NAVY_D, light=True)
        pts = []
        for k in range(6):
            pts.append(c.P(u + 0.05 + k * 0.09, 2.5, 6 + r(6)))
        c.d.line(pts, fill=A(GREEN_LED if u != 1.3 else ORANGE))
        c.ld.line(pts, fill=A(GREEN_LED))
    if tier >= 2:
        c.rface(2.7, 1.0, 1.6, 4, 13, NAVY_D, light=True)
        for k in range(4):  # bar chart
            v = 1.05 + k * 0.13
            c.rface(2.7, v, v + 0.07, 5, 6 + (k * 2 + 1) % 7, col)
    # tower
    tu0, tv0, tu1, tv1 = 1.0, 0.3, 1.8, 1.1
    c.box(tu0, tv0, tu1, tv1, 0, h, CREAM)
    c.windows(tu0, tv0, tu1, tv1, base + 4, h - 20, key + "t", every=0.4, size=0.18, fh=8)
    c.box(tu0 - 0.05, tv0 - 0.05, tu1 + 0.05, tv1 + 0.05, h, h + 3, col)
    c.pyramid(tu0 - 0.05, tv0 - 0.05, tu1 + 0.05, tv1 + 0.05, h + 3, 12 + tier, NAVY)
    # clock face on the left face
    x, y = c.P((tu0 + tu1) / 2, tv1, h - 10)
    c.d.ellipse((x - 6, y - 6, x + 6, y + 6), fill=A(WHITE), outline=A(NAVY_D))
    c.d.line([(x, y), (x, y - 4)], fill=A(NAVY_D))
    c.d.line([(x, y), (x + 3, y + 1)], fill=A(NAVY_D))
    c.ld.ellipse((x - 6, y - 6, x + 6, y + 6), fill=(255, 240, 200, 170))
    if tier >= 3:  # CloudTrail: footprints across the lawn + a log scroll on a post
        fr = seeded(key + "f")
        for k in range(6):
            u, v = 0.3 + k * 0.4, 2.75 + (0.08 if k % 2 else -0.05)
            fx, fy = c.P(u, v)
            c.d.rectangle((fx, fy - 1, fx + 1, fy), fill=A(NAVY))
        x, y = c.P(2.85, 2.75)
        c.d.line([(x, y), (x, y - 16)], fill=A(WOOD_D))
        c.d.rectangle((x - 5, y - 26, x + 5, y - 15), fill=A(PAPER))
        c.d.rectangle((x - 6, y - 27, x + 6, y - 26), fill=A(WOOD))
        c.d.rectangle((x - 6, y - 15, x + 6, y - 14), fill=A(WOOD))
        for k in range(4):
            c.d.line([(x - 4, y - 24 + k * 2), (x + 2 - fr(3), y - 24 + k * 2)], fill=A(INK))
    if tier >= 4:  # bell + beacon
        x, y = c.P((tu0 + tu1) / 2, (tv0 + tv1) / 2, h + 16 + tier)
        c.d.line([(x, y), (x, y - 6)], fill=A(CON_L))
        c.d.ellipse((x - 2, y - 9, x + 2, y - 5), fill=A(GOLD))
        c.ld.ellipse((x - 3, y - 10, x + 3, y - 4), fill=(255, 220, 120, 200))
    return c


# ── AI Heights ────────────────────────────────────────────────────────────────

def lm_bedrock(fw, fh, tier, col, key):
    """Bedrock Mesa: a mesa of rock strata with glowing seams (one layer per tier) crowned by a lantern shrine."""
    c = Canvas(fw, fh, 130)
    strata = [(150, 120, 96), (120, 110, 104), (170, 140, 108), (104, 96, 110)]
    z = 0
    u0, v0, u1, v1 = 0.2, 0.2, 2.8, 2.8
    for i in range(tier + 1):
        lh = 9
        colr = strata[i % len(strata)]
        c.box(u0, v0, u1, v1, z, z + lh, colr)
        if i < tier:  # glowing seam between layers
            c.lface(v1, u0, u1, z + lh - 1, z + lh, col, light=True)
            c.rface(u1, v0, v1, z + lh - 1, z + lh, shade(col, 0.8), light=True)
        z += lh
        ins = 0.18
        u0, v0, u1, v1 = u0 + ins, v0 + ins, u1 - ins, v1 - ins
    # fossils/crystals in the rock
    r = seeded(key)
    for _ in range(3 + tier):
        u = 0.4 + r(200) / 100
        zz = 2 + r(max(3, z - 6))
        x, y = c.P(u, 2.8 - (zz // 9) * 0.18, zz)
        c.d.point([(x, y)], fill=A(TEAL_GLOW))
        c.ld.point([(x, y)], fill=A(TEAL_GLOW))
    # steps up the front
    for k in range(3):
        c.box(1.3, 2.6 - k * 0.2, 1.7, 2.8 - k * 0.2, 0, 3 + k * 3, CON_L)
    # shrine on top
    cu, cv = 1.5, 1.5
    s = 0.45
    c.box(cu - s, cv - s, cu + s, cv + s, z, z + 2, CON_L)
    ncol = 2 if tier < 3 else 3
    for i in range(ncol):
        u = cu - s + 0.08 + i * (2 * s - 0.2) / (ncol - 1)
        c.box(u, cv + s - 0.14, u + 0.1, cv + s - 0.04, z + 2, z + 16, WHITE)
        c.box(cu + s - 0.14, cv - s + 0.08 + i * (2 * s - 0.2) / (ncol - 1), cu + s - 0.04, cv - s + 0.18 + i * (2 * s - 0.2) / (ncol - 1), z + 2, z + 16, WHITE)
    # glowing orb
    ox, oy = c.P(cu, cv, z + 10)
    c.d.ellipse((ox - 4, oy - 4, ox + 4, oy + 4), fill=A(TEAL_GLOW), outline=A(shade(col, 0.7)))
    c.d.point([(ox - 1, oy - 2)], fill=A(WHITE))
    c.ld.ellipse((ox - 7, oy - 7, ox + 7, oy + 7), fill=(120, 255, 220, 150))
    c.box(cu - s - 0.05, cv - s - 0.05, cu + s + 0.05, cv + s + 0.05, z + 16, z + 19, col)
    c.pyramid(cu - s - 0.05, cv - s - 0.05, cu + s + 0.05, cv + s + 0.05, z + 19, 8, shade(col, 0.8))
    if tier >= 4:  # floating runes
        for k, (dx, dy) in enumerate([(-30, -6), (24, -12), (-20, -30), (16, -38)]):
            rx, ry = ox + dx, oy + dy - 10
            glyph(c, rx, ry, [["X.X", ".X.", "X.X"], ["XXX", "X..", "XXX"], [".X.", "XXX", ".X."], ["X..", "XXX", "..X"]][k], TEAL_GLOW, light=TEAL_GLOW, s=2)
    return c


def lm_agentcore(fw, fh, tier, col, key):
    """AgentCore Academy: a school with a robot-head crest; bell cupola, flag, wing and courtyard grow."""
    h = 20 + 3 * tier
    c = Canvas(fw, fh, h + 56)
    if tier >= 3:  # wing
        c.box(0.25, 0.25, 1.1, 1.9, 0, h - 4, BRICK)
        c.windows(0.25, 0.25, 1.1, 1.9, 3, h - 7, key + "w", every=0.4, size=0.2, fh=8)
        c.gable(0.2, 0.2, 1.15, 1.95, h - 4, 7, NAVY)
    c.box(0.9, 0.6, 2.7, 2.1, 0, h, BRICK)
    c.windows(0.9, 0.6, 2.7, 2.1, 3, h - 4, key, every=0.45, size=0.24, fh=8)
    c.lface(2.1, 0.9, 2.7, h - 3, h - 1, col)
    c.rface(2.7, 0.6, 2.1, h - 3, h - 1, shade(col, 0.8))
    c.gable(0.85, 0.55, 2.75, 2.15, h, 10, NAVY)
    c.door(0.9, 2.7, 2.1, col=NAVY_D, w=0.4, h=11)
    # robot-head crest over the door
    x, y = c.P(1.8, 2.1, h - 7)
    plate(c, x - 5, y - 5, 10, 8, col)
    c.d.rectangle((x - 3, y - 3, x - 2, y - 2), fill=A(WHITE))
    c.d.rectangle((x + 1, y - 3, x + 2, y - 2), fill=A(WHITE))
    c.d.line([(x - 2, y + 1), (x + 1, y + 1)], fill=A(WHITE))
    c.d.line([(x, y - 5), (x, y - 8)], fill=A(CON_L))
    c.d.point([(x, y - 9)], fill=A((255, 80, 80)))
    c.ld.rectangle((x - 3, y - 3, x + 2, y - 2), fill=A(TEAL_GLOW))
    if tier >= 2:  # bell cupola on the ridge
        cu, cv = 1.8, 1.35
        c.box(cu - 0.2, cv - 0.2, cu + 0.2, cv + 0.2, h + 8, h + 18, WHITE)
        c.lface(cv + 0.2, cu - 0.12, cu + 0.12, h + 10, h + 16, NAVY_D)
        bx, by = c.P(cu, cv + 0.2, h + 13)
        c.d.ellipse((bx - 2, by - 2, bx + 1, by + 2), fill=A(GOLD))
        c.pyramid(cu - 0.25, cv - 0.25, cu + 0.25, cv + 0.25, h + 18, 8, col)
    if tier >= 3:
        flag(c, 0.4, 0.5, h + 3, 16, col)
    if tier >= 4:  # courtyard tree + lamp + mortarboard sign
        tree(c, 0.5, 2.6)
        lamp(c, 2.85, 2.6)
        x, y = c.P(1.2, 2.8)
        c.d.line([(x, y), (x, y - 10)], fill=A(WOOD_D))
        c.d.polygon([(x - 6, y - 13), (x, y - 16), (x + 6, y - 13), (x, y - 10)], fill=A(NAVY_D))
        c.d.line([(x + 5, y - 13), (x + 5, y - 9)], fill=A(GOLD))
    return c


def lm_sagemaker(fw, fh, tier, col, key):
    """SageMaker Workshop: a sawtooth-roof workshop with a big brain dial; gears, model conveyor and antenna grow."""
    h = 18 + 3 * tier
    c = Canvas(fw, fh, h + 52)
    if tier >= 2:  # chimney with a gear
        c.box(0.4, 0.3, 0.7, 0.6, 0, h + 22, CON_D)
        c.box(0.37, 0.27, 0.73, 0.63, h + 22, h + 24, col)
    c.box(0.3, 0.6, 2.7, 2.3, 0, h, (196, 186, 170))
    c.louvres(0.3, 0.6, 2.7, 2.3, 0, h, (196, 186, 170), step=4)
    c.windows(0.3, 0.6, 2.7, 2.3, 3, h - 4, key, every=0.5, size=0.26, fh=9)
    # sawtooth roof
    for k in range(3):
        v = 0.6 + k * (1.7 / 3)
        vb = v + 1.7 / 3
        c.poly([(0.3, vb, h), (2.7, vb, h), (2.7, v, h + 8), (0.3, v, h + 8)], shade(col, 0.95))
        c.poly([(2.7, vb, h), (2.7, v, h), (2.7, v, h + 8)], shade(col, 0.72))
        c.poly([(0.3, v, h), (2.7, v, h), (2.7, v, h + 8), (0.3, v, h + 8)], GLASS_D)
    c.door(0.3, 1.4, 2.3, h=11, w=0.35)
    # the brain dial
    x, y = c.P(1.95, 2.3, 10)
    c.d.ellipse((x - 9, y - 9, x + 9, y + 9), fill=A(NAVY_D))
    c.d.ellipse((x - 8, y - 8, x + 8, y + 8), fill=A(WHITE))
    for k in range(7):
        a = math.pi + k * math.pi / 6
        c.d.point([(x + round(math.cos(a) * 6), y + round(math.sin(a) * 6))], fill=A(NAVY))
    pink = (240, 140, 170)
    c.d.ellipse((x - 5, y - 1, x - 1, y + 5), fill=A(pink))
    c.d.ellipse((x - 1, y - 1, x + 5, y + 5), fill=A(pink))
    c.d.line([(x, y), (x, y + 5)], fill=A(shade(pink, 0.7)))
    ang = math.pi + [0.6, 1.2, 1.9, 2.6][tier - 1]
    c.d.line([(x, y), (x + round(math.cos(ang) * 7), y + round(math.sin(ang) * 7))], fill=A((220, 50, 50)))
    c.ld.ellipse((x - 8, y - 8, x + 8, y + 8), fill=(255, 250, 220, 140))
    if tier >= 2:  # gear on the right face
        gx, gy = c.P(2.7, 1.2, 12)
        for k in range(8):
            a = k * math.pi / 4
            c.d.rectangle((gx + round(math.cos(a) * 5) - 1, gy + round(math.sin(a) * 5) - 1, gx + round(math.cos(a) * 5) + 1, gy + round(math.sin(a) * 5) + 1), fill=A(ORANGE))
        c.d.ellipse((gx - 4, gy - 4, gx + 4, gy + 4), fill=A(ORANGE))
        c.d.ellipse((gx - 1, gy - 1, gx + 1, gy + 1), fill=A(NAVY))
    if tier >= 3:  # conveyor carrying trained model boxes
        c.box(0.2, 2.55, 2.8, 2.8, 0, 3, CON_D)
        for i in range(3 if tier < 4 else 4):
            u = 0.35 + i * 0.6
            c.box(u, 2.58, u + 0.3, 2.78, 3, 8, [col, ORANGE, (120, 150, 240), GOLD][i])
    if tier >= 4:  # antenna
        x, y = c.P(2.4, 0.9, h + 8)
        c.d.line([(x, y), (x, y - 14)], fill=A(CON_L))
        for k in (5, 9):
            c.d.line([(x - k // 2, y - 14 + k), (x + k // 2, y - 14 + k)], fill=A(CON_L))
        c.d.point([(x, y - 15)], fill=(255, 80, 80, 255))
        c.ld.point([(x, y - 15)], fill=(255, 80, 80, 255))
    return c


def lm_q(fw, fh, tier, col, key):
    """Q Help Desk: a kiosk under an awning with a big lit "Q" sign; seating, second booth and lanterns grow."""
    c = Canvas(fw, fh, 80)
    if tier >= 3:  # second booth
        c.box(0.3, 0.3, 1.2, 1.0, 0, 16, WOOD)
        c.lface(1.0, 0.4, 1.1, 5, 12, GLASS, light=True)
        c.gable(0.25, 0.25, 1.25, 1.05, 16, 6, shade(col, 0.8))
    u0, v0, u1, v1 = 1.2, 0.9, 2.7, 2.0
    c.box(u0, v0, u1, v1, 0, 20, CREAM)
    c.lface(v1, u0 + 0.15, u1 - 0.15, 8, 17, GLASS, light=True)
    c.box(u0 - 0.05, v1, u1 + 0.05, v1 + 0.25, 0, 9, WOOD)  # counter
    c.box(u0 - 0.08, v1 - 0.02, u1 + 0.08, v1 + 0.27, 9, 10, WHITE)
    for k in range(6):  # striped awning
        a = u0 - 0.1 + k * (u1 - u0 + 0.2) / 6
        b = a + (u1 - u0 + 0.2) / 6
        c.poly([(a, v0 - 0.1, 24), (b, v0 - 0.1, 24), (b, v1 + 0.35, 20), (a, v1 + 0.35, 20)], col if k % 2 else WHITE)
    # a laptop on the counter
    x, y = c.P(1.7, v1 + 0.12, 10)
    c.d.rectangle((x - 2, y - 4, x + 2, y - 1), fill=A(NAVY_D))
    c.d.rectangle((x - 1, y - 3, x + 1, y - 2), fill=A(TEAL_GLOW))
    # the Q sign on a pole
    pu, pv = 2.5, 1.2
    ph = 30 + 4 * tier
    x, y = c.P(pu, pv, 20)
    c.d.line([(x, y), (x, y - (ph - 20))], fill=A(NAVY))
    s = 2
    gw, gh = 7 * s, 7 * s
    sx, sy = x - gw // 2, y - (ph - 20) - gh - 2
    plate(c, sx - 2, sy - 2, gw + 4, gh + 4, NAVY)
    glyph(c, sx, sy, Q_BIG, WHITE if tier >= 3 else col, light=TEAL_GLOW if tier >= 2 else None, s=s)
    if tier >= 2:  # stools
        for u in (1.4, 2.1):
            c.box(u, 2.45, u + 0.16, 2.61, 0, 6, CON_D)
            c.box(u - 0.03, 2.42, u + 0.19, 2.64, 6, 7, col)
    if tier >= 3:  # speech bubble
        x, y = c.P(0.75, 0.65, 26)
        plate(c, x - 5, y - 5, 10, 7, WHITE)
        c.d.polygon([(x - 2, y + 2), (x, y + 2), (x - 3, y + 5)], fill=A(WHITE))
        glyph(c, x - 3, y - 3, ["X.X.X"], NAVY)
    if tier >= 4:
        lamp(c, 0.3, 2.7)
        lamp(c, 2.85, 2.8)
    return c


def lm_rekognition(fw, fh, tier, col, key):
    """Rekognition Gallery: a white gallery with a camera-lens eye; paintings, sculpture and skylight grow."""
    h = 22 + 3 * tier
    c = Canvas(fw, fh, h + 44)
    c.box(0.3, 0.4, 2.7, 2.3, 0, 4, CON_L)  # plinth
    c.box(0.45, 0.55, 2.55, 2.15, 4, h, WHITE)
    c.lface(2.15, 0.45, 2.55, h - 5, h - 2, col)
    c.rface(2.55, 0.55, 2.15, h - 5, h - 2, shade(col, 0.8))
    c.box(0.4, 0.5, 2.6, 2.2, h, h + 3, CON_M)
    # columns across the front
    for i in range(4):
        u = 0.55 + i * 0.55
        c.box(u, 2.2, u + 0.12, 2.32, 4, h, CON_L)
    c.box(0.45, 2.15, 2.55, 2.35, h - 1, h + 3, CON_M)
    c.lface(2.15, 1.3, 1.7, 4, 14, NAVY_D, light=True)  # door
    # paintings on the right face (one more per tier)
    pc = [(240, 170, 60), (100, 170, 240), (240, 100, 120), (120, 210, 140)]
    for i in range(tier):
        v = 0.7 + i * 0.35
        c.rface(2.55, v, v + 0.26, 8, 16, WOOD_D)
        c.rface(2.55, v + 0.04, v + 0.22, 9, 15, pc[i], light=i % 2 == 0)
    # the lens eye on the roof
    x, y = c.P(1.5, 1.35, h + 3)
    y -= 8
    c.d.ellipse((x - 11, y - 11, x + 11, y + 11), fill=A(NAVY_D))
    c.d.ellipse((x - 9, y - 9, x + 9, y + 9), fill=A(CON_L))
    c.d.ellipse((x - 7, y - 7, x + 7, y + 7), fill=A(col))
    c.d.ellipse((x - 4, y - 4, x + 4, y + 4), fill=A(NAVY_D))
    c.d.ellipse((x - 2, y - 3, x, y - 1), fill=A(WHITE))
    c.ld.ellipse((x - 7, y - 7, x + 7, y + 7), fill=(140, 255, 230, 140))
    c.d.rectangle((x - 2, y + 11, x + 1, y + 14), fill=A(CON_D))
    if tier >= 3:  # sculpture on a pedestal
        c.box(2.7, 2.6, 2.9, 2.8, 0, 7, CON_L)
        sx, sy = c.P(2.8, 2.7, 7)
        c.d.ellipse((sx - 3, sy - 10, sx + 3, sy - 4), fill=A(GOLD))
        c.d.rectangle((sx - 1, sy - 4, sx + 1, sy), fill=A(GOLD))
        c.box(0.1, 2.6, 0.3, 2.8, 0, 7, CON_L)
        sx, sy = c.P(0.2, 2.7, 7)
        c.d.polygon([(sx - 3, sy), (sx, sy - 10), (sx + 3, sy)], fill=A(CON_M))
    if tier >= 4:  # banner + skylight glow
        x, y = c.P(0.5, 2.25, h + 3)
        c.d.line([(x, y), (x, y - 14)], fill=A(CON_L))
        c.d.rectangle((x + 1, y - 14, x + 6, y - 4), fill=A(col))
        c.d.rectangle((x + 2, y - 11, x + 5, y - 9), fill=A(WHITE))
        c.poly([(1.9, 0.7, h + 3), (2.4, 0.7, h + 3), (2.4, 1.1, h + 3), (1.9, 1.1, h + 3)], GLASS)
        c.poly([(1.9, 0.7, h + 3), (2.4, 0.7, h + 3), (2.4, 1.1, h + 3), (1.9, 1.1, h + 3)], WARM, c.ld)
    return c


def lm_textract(fw, fh, tier, col, key):
    """Textract Scriptorium: a stone hall with arched lit windows and a quill-in-inkpot sign; scrolls, lamp, tower grow."""
    h = 20 + 3 * tier
    c = Canvas(fw, fh, h + 56)
    if tier >= 4:  # library tower with an open book
        c.box(0.3, 0.3, 1.0, 1.0, 0, h + 20, STONE)
        c.windows(0.3, 0.3, 1.0, 1.0, h, h + 16, key + "t", every=0.35, size=0.16, fh=7)
        c.pyramid(0.25, 0.25, 1.05, 1.05, h + 20, 12, col)
    c.box(0.5, 0.7, 2.7, 2.2, 0, h, STONE)
    c.louvres(0.5, 0.7, 2.7, 2.2, 0, h, STONE, step=6)
    # arched windows (warm light)
    for i in range(3):
        u = 0.7 + i * 0.65
        c.lface(2.2, u, u + 0.28, 5, 14, (80, 60, 50), light=True)
        x, y = c.P(u + 0.14, 2.2, 14)
        c.d.ellipse((x - 3, y - 3, x + 2, y + 2), fill=A((80, 60, 50)))
        c.ld.ellipse((x - 3, y - 3, x + 2, y + 2), fill=A(WARM))
    for i in range(2):
        v = 1.0 + i * 0.6
        c.rface(2.7, v, v + 0.25, 5, 13, (80, 60, 50), light=True)
    c.gable(0.45, 0.65, 2.75, 2.25, h, 12, col)
    c.door(0.5, 1.2, 2.2, col=WOOD_D, h=11, w=0.3)
    # quill in an inkpot, on the gable end
    x, y = c.P(2.7, 1.45, h + 5)
    c.d.rectangle((x - 4, y + 1, x + 2, y + 6), fill=A(INK))
    c.d.rectangle((x - 5, y, x + 3, y + 1), fill=A(NAVY))
    c.d.polygon([(x - 1, y + 1), (x + 7, y - 13), (x + 9, y - 12), (x + 2, y + 1)], fill=A(WHITE))
    c.d.line([(x, y), (x + 7, y - 12)], fill=A(CON_M))
    if tier >= 2:  # reading lamp by the door
        lamp(c, 1.45, 2.6, 13)
    if tier >= 3:  # stacks of scrolls
        for i in range(3):
            sx, sy = c.P(2.1 + i * 0.22, 2.65, 0)
            for k in range(3 - i % 2):
                c.d.ellipse((sx - 4, sy - 4 - k * 3, sx + 4, sy - 1 - k * 3), fill=A(PAPER), outline=A(WOOD_D))
                c.d.point([(sx + 3, sy - 3 - k * 3)], fill=A((200, 60, 60)))
        # a page with text lines that's been "extracted" into a table
        x, y = c.P(0.35, 2.6)
        c.d.line([(x, y), (x, y - 10)], fill=A(WOOD_D))
        plate(c, x - 6, y - 21, 12, 11, PAPER)
        for k in range(3):
            c.d.line([(x - 5, y - 19 + k * 3), (x + 4, y - 19 + k * 3)], fill=A(col))
        c.d.line([(x - 1, y - 20), (x - 1, y - 12)], fill=A(col))
    if tier >= 4:
        x, y = c.P(0.65, 1.0, h + 8)
        plate(c, x - 6, y - 4, 12, 6, PAPER, rim=WOOD_D)
        c.d.line([(x, y - 4), (x, y + 1)], fill=A(WOOD_D))
        c.ld.rectangle((x - 6, y - 4, x + 5, y + 1), fill=(255, 240, 200, 150))
    return c
