"""Bespoke landmarks: Compute Quarter + Data Lake Shores (ec2 lambda ecs fargate eks beanstalk s3 ebs efs glue athena lakeformation). See landmarks_aws.py."""
import math

from generate_tiles import (A, CLEAR, CON_D, CON_L, CON_M, GLASS, GLASS_D, GRASS, GRASS_D, HH, HW, NAVY, NAVY_D, ORANGE,  # noqa: F401
                            ORANGE_D, OUTLINE, PACKIMG, WATER, WHITE, WOOD, WOOD_D, Canvas, seeded, shade, stripe_block)

LIT = (255, 214, 120)
LED = (110, 240, 150)
RED = (226, 72, 64)
STONE = (176, 170, 160)
STONE_D = (132, 126, 118)
BRICK = (178, 96, 72)
LEAF = (86, 178, 74)
LEAF_D = (50, 128, 56)
BOX_COLS = [(226, 72, 64), (59, 130, 246), (34, 170, 94), ORANGE, (139, 92, 246), (20, 170, 160), CON_M]


# ── small helpers ─────────────────────────────────────────────────────────────

def cyl(c, u, v, z0, z1, r, col, top=None, lit=False):
    """Upright cylinder at (u, v) from z0 to z1 (screen-space ellipses)."""
    x, y0 = c.P(u, v, z0)
    y1 = y0 - (z1 - z0)
    rx, ry = max(1, round(r * HW * 1.3)), max(1, round(r * HH * 1.3))
    c.d.rectangle((x - rx, y1, x + rx, y0), fill=A(shade(col, 0.82)))
    c.d.ellipse((x - rx, y0 - ry, x + rx, y0 + ry), fill=A(shade(col, 0.82)))
    c.d.rectangle((x - rx, y1, x - rx // 3, y0), fill=A(shade(col, 0.95)))
    c.d.ellipse((x - rx, y1 - ry, x + rx, y1 + ry), fill=A(top or shade(col, 1.08)))
    if lit:
        c.ld.rectangle((x - 1, y1 + 3, x + 1, y0 - 2), fill=A(LIT))
    return x, y1


def dot(c, u, v, z, col, lit=False, r=0):
    x, y = c.P(u, v, z)
    c.d.rectangle((x - r, y - r, x + r, y + r), fill=A(col))
    if lit:
        c.ld.rectangle((x - r - 1, y - r - 1, x + r + 1, y + r + 1), fill=A(col, 200))
        c.ld.rectangle((x - r, y - r, x + r, y + r), fill=A(col))


def lwin(c, v, u, z, w=0.14, h=3, col=GLASS, lit=True):
    c.lface(v, u, u + w, z, z + h, col, light=lit)


def rwin(c, u, v, z, w=0.14, h=3, col=GLASS_D, lit=True):
    c.rface(u, v, v + w, z, z + h, col, light=lit)


def water_patch(c, u0, v0, u1, v1, z=0):
    c.poly([(u0, v0, z), (u1, v0, z), (u1, v1, z), (u0, v1, z)], WATER)
    r = seeded(f"wp{u0}{v0}")
    for _ in range(int((u1 - u0) * (v1 - v0) * 4) + 1):
        x, y = c.P(u0 + r(90) / 100 * (u1 - u0), v0 + r(90) / 100 * (v1 - v0), z)
        c.d.line([(x, y), (x + 2, y)], fill=A(shade(WATER, 1.3)))


def container(c, u, v, z, col, du=0.8, dv=0.42, h=8):
    c.box(u, v, u + du, v + dv, z, z + h, col)
    for k in range(3):
        a = u + 0.1 + k * du / 3
        c.lface(v + dv, a, a + 0.04, z + 1, z + h - 1, shade(col, 0.66))
    c.rface(u + du, v + 0.08, v + 0.12, z + 1, z + h - 1, shade(col, 0.55))


def flag(c, u, v, z, col, h=12):
    x, y = c.P(u, v, z)
    c.d.line([(x, y), (x, y - h)], fill=A(CON_L))
    c.d.polygon([(x + 1, y - h), (x + 8, y - h + 3), (x + 1, y - h + 6)], fill=A(col))


def bucket(c, u, v, z, col, s=1.0):
    """The S3 icon bucket: a tapered pail with a rim."""
    x, y = c.P(u, v, z)
    w0, w1, h = round(4 * s), round(6 * s), round(7 * s)
    c.d.polygon([(x - w0, y), (x + w0, y), (x + w1, y - h), (x - w1, y - h)], fill=A(col))
    c.d.polygon([(x - w0, y), (x - w0 + 2, y), (x - w1 + 2, y - h), (x - w1, y - h)], fill=A(shade(col, 1.18)))
    c.d.ellipse((x - w1, y - h - 2, x + w1, y - h + 2), fill=A(shade(col, 0.6)))
    c.d.line([(x - w1, y - h), (x + w1, y - h)], fill=A(shade(col, 1.3)))


# ── Compute Quarter ───────────────────────────────────────────────────────────

def lm_ec2(fw, fh, tier, col, key):
    """EC2 icon = a chip/server: a server tower with rows of instance windows; racks + cooling per tier."""
    h = 40 + 10 * tier
    c = Canvas(fw, fh, h + 26)
    r = seeded(key)
    if tier >= 2:  # rack annexe on the left
        c.box(0.25, 1.9, 1.05, 2.75, 0, 20, NAVY)
        for z in range(4, 18, 4):
            for k in range(3):
                on = r(3) > 0
                c.lface(2.75, 0.35 + k * 0.22, 0.47 + k * 0.22, z, z + 2, LED if on else shade(LED, 0.4), light=on)
    if tier >= 4:  # second rack annexe on the right
        c.box(1.9, 0.25, 2.75, 1.05, 0, 24, NAVY)
        for z in range(4, 22, 4):
            for k in range(3):
                c.rface(2.75, 0.35 + k * 0.22, 0.47 + k * 0.22, z, z + 2, LED, light=r(3) > 0)
    u0, v0, u1, v1 = 0.95, 0.95, 2.1, 2.1
    c.box(u0, v0, u1, v1, 0, h, CON_L)
    # chip "pins" down the edges, like the EC2 icon
    for z in range(6, h - 6, 4):
        c.lface(v1, u0, u0 + 0.05, z, z + 1, CON_D)
        c.rface(u1, v1 - 0.05, v1, z, z + 1, CON_D)
    # rows of instance windows
    for z in range(6, h - 8, 7):
        for k in range(4):
            lwin(c, v1, u0 + 0.12 + k * 0.25, z, w=0.14, h=4, lit=r(4) > 0)
            rwin(c, u1, v0 + 0.12 + k * 0.25, z, w=0.14, h=4, lit=r(4) > 0)
    c.lface(v1, u0, u1, h - 6, h - 3, col)
    c.rface(u1, v0, v1, h - 6, h - 3, shade(col, 0.8))
    c.door(u0, u1, v1, w=0.3, h=7)
    # roof cooling
    c.box(u0 - 0.04, v0 - 0.04, u1 + 0.04, v1 + 0.04, h, h + 2, CON_M)
    for k in range(min(tier, 3)):
        c.fan(u0 + 0.3 + (k % 2) * 0.55, v0 + 0.3 + (k // 2) * 0.55, h + 2, r=0.2, frame=k)
    if tier >= 3:  # chiller units on the ground
        for i, (u, v) in enumerate(((2.35, 2.35), (2.35, 1.6))):
            c.box(u, v, u + 0.5, v + 0.45, 0, 7, CON_M)
            c.fan(u + 0.25, v + 0.22, 7, r=0.16, frame=i)
    if tier >= 4:  # antenna + beacon
        x, y = c.P(u1 - 0.2, v0 + 0.2, h + 2)
        c.d.line([(x, y), (x, y - 12)], fill=A(CON_D))
        c.d.point([(x, y - 13)], fill=A(RED))
        c.ld.rectangle((x - 1, y - 14, x + 1, y - 12), fill=A(RED))
    return c


def lambda_glyph(c, x, y, s, col, width=3, lit=True):
    """A λ drawn in screen space; (x, y) is the bottom centre."""
    pts_long = [(x - 5 * s, y - 16 * s), (x - 2 * s, y - 16 * s), (x + 6 * s, y)]
    pts_short = [(x + 0.5 * s, y - 8 * s), (x - 5 * s, y)]
    for d, a in ((c.d, 255),) + (((c.ld, 255),) if lit else ()):
        d.line([tuple(map(round, p)) for p in pts_long], fill=A(col, a), width=width)
        d.line([tuple(map(round, p)) for p in pts_short], fill=A(col, a), width=width)


def lm_lambda(fw, fh, tier, col, key):
    """Lambda icon = λ: a food stall whose sign and frame are a big λ. Grill fires only on orders."""
    c = Canvas(fw, fh, 80)
    u0, v0, u1, v1 = 0.5, 1.2, 2.5, 2.3
    if tier >= 3:  # second counter (more concurrency)
        c.box(0.3, 0.3, 1.2, 1.0, 0, 9, WOOD)
        for k in range(4):
            a = 0.25 + k * 0.25
            c.poly([(a, 0.2, 16), (a + 0.25, 0.2, 16), (a + 0.25, 1.15, 13), (a, 1.15, 13)], col if k % 2 else WHITE)
        c.box(0.35, 1.0, 0.4, 1.05, 9, 13, WOOD_D)
        c.box(1.1, 1.0, 1.15, 1.05, 9, 13, WOOD_D)
    c.box(u0, v0, u1, v1, 0, 11, WOOD)
    c.box(u0, v1 - 0.1, u1, v1 + 0.08, 8, 11, WHITE)
    # the serving hatch glows
    c.lface(v1, u0 + 0.3, u1 - 0.3, 3, 7, shade(WOOD, 0.6), light=True)
    # grill on the counter
    c.box(u0 + 0.2, v0 + 0.25, u0 + 0.8, v0 + 0.75, 11, 13, NAVY_D)
    for k in range(3):
        dot(c, u0 + 0.35 + k * 0.17, v0 + 0.5, 13, ORANGE, lit=True)
    # awning
    for k in range(8):
        a = u0 - 0.1 + k * (u1 - u0 + 0.2) / 8
        b = a + (u1 - u0 + 0.2) / 8
        c.poly([(a, v0 - 0.1, 26), (b, v0 - 0.1, 26), (b, v1 + 0.3, 21), (a, v1 + 0.3, 21)], col if k % 2 else WHITE)
    for pu in (u0, u1 - 0.07):
        c.box(pu, v1 + 0.1, pu + 0.07, v1 + 0.17, 0, 21, WOOD_D)
    # the λ sign on top
    x, y = c.P((u0 + u1) / 2, v0 - 0.1, 26)
    s = 1.0 + 0.15 * min(tier, 3)
    c.d.rectangle((x - round(9 * s), y - round(19 * s), x + round(9 * s), y + 1), fill=A(NAVY))
    lambda_glyph(c, x, y - 2, s, ORANGE, width=3 if tier < 4 else 4)
    if tier >= 2:  # stools and a table
        for k in range(3):
            u = u0 + 0.35 + k * 0.6
            c.box(u, v1 + 0.35, u + 0.18, v1 + 0.53, 0, 5, col)
    if tier >= 3:  # steam
        x, y = c.P(u0 + 0.5, v0 + 0.5, 13)
        for k in range(3):
            c.d.point([(x - 1 + k, y - 4 - 3 * k)], fill=A(WHITE, 220))
    if tier >= 4:  # string lights
        for k in range(7):
            u = u0 + k * (u1 - u0) / 6
            dot(c, u, v1 + 0.3, 20 - (k % 2), [ORANGE, (255, 240, 120), (240, 110, 150)][k % 3], lit=True)
    return c


def lm_ecs(fw, fh, tier, col, key):
    """ECS icon = containers in a cluster: a container terminal with a gantry crane over the stacks."""
    c = Canvas(fw, fh, 80)
    # quay (front row of the footprint is water)
    c.box(0.0, 1.6, 3.0, 2.05, 0, 3, CON_M, top=CON_L)
    for k in range(6):
        c.box(k * 0.5 + 0.1, 1.95, k * 0.5 + 0.18, 2.05, 3, 5, NAVY_D)  # bollards
    n = 2 + tier * 2
    r = seeded(key)
    for i in range(n):
        u = 0.15 + (i % 3) * 0.9
        v = 0.15 + ((i // 3) % 2) * 0.6
        z = (i // 6) * 8
        container(c, u, v, z, [col, BOX_COLS[r(len(BOX_COLS))]][i % 2], dv=0.45)
    # gantry crane straddling the stacks
    gh = 40 + 6 * tier
    for u in (0.05, 2.85):
        c.box(u, 1.2, u + 0.1, 1.3, 0, gh, col)
        c.box(u, 0.05, u + 0.1, 0.15, 0, gh, col)
    c.box(0.05, 1.2, 2.95, 1.3, gh, gh + 3, col)
    c.box(0.05, 0.05, 2.95, 0.15, gh, gh + 3, col)
    # trolley + hanging container
    tu = 1.1 + 0.2 * (tier % 2)
    c.box(tu, 0.1, tu + 0.4, 1.25, gh + 3, gh + 6, NAVY)
    x0, y0 = c.P(tu + 0.2, 0.7, gh + 3)
    c.d.line([(x0, y0), (x0, y0 + 14)], fill=A(NAVY_D))
    if tier >= 2:
        container(c, tu - 0.2, 0.5, gh - 20, BOX_COLS[1], h=7)
    c.lface(1.3, 0.05, 2.95, gh - 2, gh, LIT, light=True)  # floodlight bar
    if tier >= 3:  # operator cab with lit window
        c.box(2.4, 1.0, 2.8, 1.3, gh - 10, gh, WHITE)
        lwin(c, 1.3, 2.47, gh - 7, w=0.26, h=4)
    if tier >= 4:
        for u in (0.1, 2.9):
            dot(c, u, 1.25, gh + 5, RED, lit=True)
    return c


def lm_fargate(fw, fh, tier, col, key):
    """Fargate icon = serverless containers: a ferry terminal; the ferry carries your containers for you."""
    c = Canvas(fw, fh, 72)
    # terminal building at the back
    th = 16 + 3 * tier
    c.box(0.2, 0.2, 1.6, 1.4, 0, th, WHITE)
    for k in range(3):
        lwin(c, 1.4, 0.35 + k * 0.4, 5, w=0.25, h=5)
    c.rface(1.6, 0.3, 1.3, th - 5, th - 2, col)
    c.lface(1.4, 0.2, 1.6, th - 5, th - 2, col)
    c.gable(0.15, 0.15, 1.65, 1.45, th, 7, NAVY)
    # jetty
    c.box(1.7, 0.5, 2.9, 1.5, 0, 3, WOOD, top=shade(WOOD, 1.08))
    c.box(1.2, 1.4, 2.2, 1.9, 0, 3, WOOD, top=shade(WOOD, 1.08))  # gangway to the ferry
    # the ferry on the water row
    fu0, fu1 = 0.3, 2.9 if tier >= 2 else 2.4
    v0, v1 = 1.95, 2.8
    c.poly([(fu0, v1, 0), (fu1, v1, 0), (fu1 + 0.15, v1 - 0.4, 0), (fu1, v0, 0), (fu0, v0, 0)], NAVY_D)
    c.box(fu0, v0, fu1, v1, 0, 6, WHITE)
    c.lface(v1, fu0, fu1, 1, 3, col)
    c.rface(fu1, v0, v1, 1, 3, shade(col, 0.8))
    # cabin with portholes
    c.box(fu0 + 0.1, v0 + 0.1, fu0 + 0.75, v1 - 0.1, 6, 15, WHITE)
    for k in range(2):
        lwin(c, v1 - 0.1, fu0 + 0.18 + k * 0.26, 9, w=0.14, h=3)
    # funnel
    c.box(fu0 + 0.3, v0 + 0.3, fu0 + 0.5, v0 + 0.5, 15, 22, ORANGE)
    c.box(fu0 + 0.28, v0 + 0.28, fu0 + 0.52, v0 + 0.52, 22, 24, NAVY)
    # containers on deck
    for i in range(min(tier + 1, 5)):
        u = fu0 + 0.85 + (i % 2) * 0.72
        z = 6 + (i // 2) * 7
        if u + 0.62 <= fu1:
            container(c, u, v0 + 0.15, z, [col, BOX_COLS[i % len(BOX_COLS)]][i % 2], du=0.62, dv=0.5, h=7)
    if tier >= 3:  # smoke puffs
        x, y = c.P(fu0 + 0.4, v0 + 0.4, 25)
        for k in range(3):
            c.d.ellipse((x + k * 3 - 2, y - 4 - k * 4, x + k * 3 + 2, y - k * 4), fill=A(CON_L, 230))
    if tier >= 4:  # mast light + deck lights
        x, y = c.P(fu1 - 0.2, (v0 + v1) / 2, 6)
        c.d.line([(x, y), (x, y - 16)], fill=A(CON_D))
        dot(c, fu1 - 0.2, (v0 + v1) / 2, 23, (255, 240, 120), lit=True)
        for k in range(5):
            dot(c, fu0 + 0.3 + k * 0.5, v1, 6, LIT, lit=True)
    return c


def helm(c, x, y, rad, col, spokes=7, lit=False):
    """A ship's helm with 7 spokes — the Kubernetes wheel."""
    c.d.ellipse((x - rad, y - rad, x + rad, y + rad), outline=A(col), width=2)
    for k in range(spokes):
        a = -math.pi / 2 + k * 2 * math.pi / spokes
        c.d.line([(x, y), (x + round(math.cos(a) * (rad + 2)), y + round(math.sin(a) * (rad + 2)))], fill=A(col), width=1)
        c.d.point([(x + round(math.cos(a) * (rad + 3)), y + round(math.sin(a) * (rad + 3)))], fill=A(col))
    c.d.ellipse((x - 2, y - 2, x + 2, y + 2), fill=A(col))
    if lit:
        c.ld.ellipse((x - rad, y - rad, x + rad, y + rad), outline=A(LIT), width=1)


def lm_eks(fw, fh, tier, col, key):
    """EKS Harbour Tower (icon = the Kubernetes helm): a harbour-master's tower on a stone podium with lit windows,
    the giant ship's wheel on its band, a glass lookout and, on the quay, stacked container pods that multiply each
    tier (pods scheduled onto the nodes), a berth office and a gantry crane."""
    h = 46 + 10 * tier
    c = Canvas(fw, fh, h + 36)
    r = seeded(key)
    c.box(0.1, 0.1, fw - 0.1, fh - 0.1, 0, 1, CON_M, top=(178, 184, 192))
    for k in range(1, 6):  # quay slabs
        c.line((k / 2, 0.15, 1), (k / 2, fh - 0.15, 1), (160, 166, 176))
    c.lface(fh - 0.1, 0.1, fw - 0.1, 0, 1, ORANGE)  # the quay edge
    if tier >= 2:  # berth-office annexe
        c.box(0.3, 1.95, 1.2, 2.75, 1, 16, WHITE)
        for k in range(3):
            lwin(c, 2.75, 0.38 + k * 0.27, 6, w=0.16, h=5, lit=r(3) > 0)
        c.gable(0.25, 1.9, 1.25, 2.8, 16, 6, col)
    u0, v0, u1, v1 = 1.0, 0.9, 2.0, 1.9
    c.box(u0 - 0.1, v0 - 0.1, u1 + 0.1, v1 + 0.1, 1, 9, (184, 178, 168))  # podium
    c.lface(v1 + 0.1, u0 + 0.2, u1 - 0.2, 2, 8, GLASS, light=True)
    c.box(u0, v0, u1, v1, 9, h, (226, 230, 236))
    for z in range(13, h - 18, 7):
        for k in range(2):
            lwin(c, v1, u0 + 0.18 + k * 0.42, z, w=0.22, h=4, lit=r(3) > 0)
            rwin(c, u1, v0 + 0.18 + k * 0.42, z, w=0.22, h=4, lit=r(3) > 0)
    c.lface(v1, u0, u0 + 0.06, 9, h, CON_L)
    c.lface(v1, u1 - 0.06, u1, 9, h, CON_L)
    c.door(u0, u1, v1 + 0.1, w=0.3, h=8)
    # the band with the helm
    c.lface(v1, u0, u1, h - 18, h - 3, col)
    c.rface(u1, v0, v1, h - 18, h - 3, shade(col, 0.78))
    x, y = c.P((u0 + u1) / 2, v1, h - 10)
    helm(c, x, y, 5, WHITE, lit=tier >= 3)
    x, y = c.P(u1, (v0 + v1) / 2, h - 10)
    c.d.ellipse((x - 3, y - 3, x + 3, y + 3), outline=A(shade(WHITE, 0.8)))
    # lookout gallery, glass lantern, roof
    c.box(u0 - 0.1, v0 - 0.1, u1 + 0.1, v1 + 0.1, h - 3, h, NAVY)
    c.box(u0 + 0.12, v0 + 0.12, u1 - 0.12, v1 - 0.12, h, h + 10, GLASS)
    c.lface(v1 - 0.12, u0 + 0.16, u1 - 0.16, h + 1, h + 9, GLASS, light=True)
    c.rface(u1 - 0.12, v0 + 0.16, v1 - 0.16, h + 1, h + 9, GLASS_D, light=True)
    for t in (0.37, 0.63):
        c.line((u0 + t, v1 - 0.12, h), (u0 + t, v1 - 0.12, h + 10), NAVY_D)
    c.pyramid(u0 - 0.05, v0 - 0.05, u1 + 0.05, v1 + 0.05, h + 10, 10, NAVY)
    if tier >= 4:
        flag(c, (u0 + u1) / 2, (v0 + v1) / 2, h + 20, col, h=10)
    # stacked container pods on the quay
    spots = [(2.2, 1.45, 0), (2.2, 0.95, 0), (2.2, 1.45, 8), (2.2, 0.45, 0), (2.2, 0.95, 8), (2.2, 1.45, 16), (2.2, 2.2, 0)]
    n = [1, 3, 5, 7][tier - 1]
    for i, (u, v, z) in sorted(enumerate(spots[:n]), key=lambda t: (t[1][1], t[1][2])):
        container(c, u, v, z + 1, [col, (59, 130, 246), (34, 170, 94), (226, 72, 64)][i % 4], du=0.7, dv=0.42)
    return c


def lm_beanstalk(fw, fh, tier, col, key):
    """Elastic Beanstalk icon = a stalk sprouting: plant your code and a giant beanstalk grows the stack."""
    c = Canvas(fw, fh, 130)
    hedge = (60, 140, 64)
    c.box(0, 0, fw, 0.2, 0, 6, hedge)
    c.box(0, 0, 0.2, fh, 0, 6, hedge)
    c.box(fw - 0.2, 0, fw, fh, 0, 6, hedge)
    c.box(0, fh - 0.2, 1.2, fh, 0, 6, hedge)
    c.box(1.8, fh - 0.2, fw, fh, 0, 6, hedge)
    # planted bed
    c.box(1.0, 1.0, 2.0, 2.0, 0, 3, (120, 84, 56), top=(96, 66, 44))
    # the stalk: a twisting vine climbing
    height = 30 + 20 * tier
    bx, by = c.P(1.5, 1.5, 3)
    pts = []
    for z in range(0, height, 2):
        pts.append((bx + round(math.sin(z / 7.0) * 4), by - z))
    for k in range(len(pts) - 1):
        c.d.line([pts[k], pts[k + 1]], fill=A(LEAF_D), width=4)
        c.d.line([(pts[k][0] - 1, pts[k][1]), (pts[k + 1][0] - 1, pts[k + 1][1])], fill=A(LEAF), width=2)
    # leaves
    for i, z in enumerate(range(10, height - 4, 9)):
        x, y = pts[z // 2]
        side = -1 if i % 2 else 1
        c.d.ellipse((x + side * 3 - 4 + side * 3, y - 3, x + side * 3 + 4 + side * 3, y + 2), fill=A(LEAF))
        c.d.point([(x + side * 7, y - 1)], fill=A(LEAF_D))
    tx, ty = pts[-1]
    if tier >= 2:  # beans hanging
        for z in range(14, height - 6, 16):
            x, y = pts[z // 2]
            c.d.ellipse((x - 7, y, x - 4, y + 5), fill=A(shade(LEAF, 1.2)))
    # a cloud at the top
    cw = 8 + 2 * tier
    for dx, dy, rr in ((-cw // 2, 2, 6), (cw // 2, 2, 6), (0, -2, 7)):
        c.d.ellipse((tx + dx - rr, ty + dy - rr, tx + dx + rr, ty + dy + rr), fill=A(WHITE))
    if tier >= 3:  # the stack grown in the cloud: a little castle (servers, LB)
        c.d.rectangle((tx - 6, ty - 12, tx + 6, ty - 3), fill=A(CON_L))
        c.d.rectangle((tx - 8, ty - 16, tx - 5, ty - 3), fill=A(CON_M))
        c.d.rectangle((tx + 5, ty - 16, tx + 8, ty - 3), fill=A(CON_M))
        c.d.rectangle((tx - 1, ty - 8, tx + 1, ty - 3), fill=A(NAVY_D))
        c.d.polygon([(tx - 9, ty - 16), (tx - 4, ty - 16), (tx - 6, ty - 21)], fill=A(col))
        c.d.polygon([(tx + 4, ty - 16), (tx + 9, ty - 16), (tx + 7, ty - 21)], fill=A(col))
        for x in (tx - 4, tx + 3):
            c.d.point([(x, ty - 10)], fill=A(LIT))
            c.ld.rectangle((x - 1, ty - 11, x + 1, ty - 9), fill=A(LIT))
    if tier >= 4:  # golden goose sparkle
        c.ld.ellipse((tx - 10, ty - 24, tx + 10, ty + 6), fill=(255, 240, 180, 60))
        for dx in (-11, 11):
            c.d.point([(tx + dx, ty - 18)], fill=A((255, 230, 100)))
    # watering can + gardener sign at the gate
    x, y = c.P(1.5, fh - 0.1)
    c.d.rectangle((x - 1, y - 12, x, y), fill=A(WOOD_D))
    c.d.rectangle((x - 6, y - 16, x + 6, y - 10), fill=A(col))
    c.ld.rectangle((x - 5, y - 15, x + 5, y - 11), fill=A(LIT, 140))
    return c


# ── Data Lake Shores ──────────────────────────────────────────────────────────

def bucket_silo(c, u, v, z, h, r0, r1, col, lit=False):
    """A silo shaped like the S3 bucket: tapered (wider at the top), hooped, open rim with a dark mouth."""
    x, y0 = c.P(u, v, z)
    y1 = y0 - h
    b, t = max(2, round(r0 * HW * 1.4)), max(3, round(r1 * HW * 1.4))
    rb, rt = max(1, b // 2), max(1, t // 2)
    c.d.ellipse((x - b, y0 - rb, x + b, y0 + rb), fill=A(shade(col, 0.7)))
    c.d.polygon([(x - b, y0), (x + b, y0), (x + t, y1), (x - t, y1)], fill=A(shade(col, 0.86)))
    c.d.polygon([(x - b, y0), (x - b + 3, y0), (x - t + 3, y1), (x - t, y1)], fill=A(shade(col, 1.05)))
    c.d.polygon([(x + b - 3, y0), (x + b, y0), (x + t, y1), (x + t - 3, y1)], fill=A(shade(col, 0.66)))
    for k in range(1, 4):
        f = k / 4
        w, yy = round(b + (t - b) * f), round(y0 - h * f)
        ry = max(1, w // 2)
        c.d.arc((x - w, yy - ry, x + w, yy + ry), 0, 180, fill=A(shade(col, 0.6)))
    c.d.ellipse((x - t, y1 - rt, x + t, y1 + rt), fill=A(shade(col, 1.15)))
    c.d.ellipse((x - t + 2, y1 - rt + 1, x + t - 2, y1 + rt - 1), fill=A(shade(col, 0.42)))
    if lit:
        c.d.rectangle((x - 1, y0 - h + 4, x, y0 - 3), fill=A(GLASS_D))
        c.ld.rectangle((x - 1, y0 - h + 4, x, y0 - 3), fill=A(LIT))
    return x, y1


def lm_s3(fw, fh, tier, col, key):
    """S3 Lake (icon = a bucket): a lakeside boathouse on stilts at the shore, bucket-shaped silos on the sand
    (buckets that hold any object), a pier into the lake and buckets bobbing on the water (objects). The lot's ground
    is water with a sandy front row (CityMap lake)."""
    c = Canvas(fw, fh, 64)
    r = seeded(key)
    # floating buckets (objects) out on the lake
    spots = [(2.3, 0.5), (0.6, 0.45), (2.6, 1.3), (1.0, 1.0), (2.0, 1.1), (0.4, 1.3)]
    for i in range(min(tier + 1, len(spots))):
        u, v = spots[i]
        x, y = c.P(u, v, 0)
        c.d.ellipse((x - 6, y - 2, x + 6, y + 2), fill=A(shade(WATER, 1.25)))
        bucket(c, u, v, 1, [col, (226, 72, 64), ORANGE, (59, 130, 246)][r(4)], s=0.8)
    # the pier into the lake
    if tier >= 2:
        c.box(1.35, 0.35, 1.7, 2.1, 1, 3, WOOD, top=shade(WOOD, 1.08))
        for v in (0.45, 1.05, 1.65):
            c.box(1.35, v, 1.42, v + 0.07, -3, 3, WOOD_D)
            c.box(1.63, v, 1.7, v + 0.07, -3, 3, WOOD_D)
        c.box(1.4, 0.4, 1.46, 0.46, 3, 14, WOOD_D)  # the pier lamp
        dot(c, 1.43, 0.43, 15, LIT, lit=True)
        c.box(0.75, 0.35, 1.3, 0.62, 0, 3, (230, 80, 70))  # a rowing boat
        c.lface(0.62, 0.8, 1.25, 2, 3, WHITE)
    # the boathouse: back half on stilts over the water, gable roof in the district green
    h = 12 + 3 * tier
    a0, b0, a1, b1 = 0.15, 1.5, 1.05 + 0.04 * tier, 2.75
    for u in (a0 + 0.05, a1 - 0.1):
        c.box(u, b0, u + 0.06, b0 + 0.06, -3, 2, WOOD_D)
    c.box(a0, b0, a1, b1, 0, h, WOOD)
    for zz in range(3, h, 3):  # clapboard
        c.lface(b1, a0, a1, zz, zz + 1, WOOD_D)
        c.rface(a1, b0, b1, zz, zz + 1, shade(WOOD_D, 0.85))
    for k in range(1 + (tier >= 2)):
        lwin(c, b1, a0 + 0.12 + k * 0.42, h - 8, w=0.2, h=4, lit=tier >= 2 or k == 0)
    c.rface(a1, b0 + 0.25, b0 + 0.85, 0, h - 5, NAVY_D)  # the boat door, open to the water
    c.rface(a1, b0 + 0.3, b0 + 0.8, 0, 3, shade(WATER, 0.8))
    c.gable(a0 - 0.06, b0 - 0.06, a1 + 0.06, b1 + 0.06, h, 7 + tier, col)
    if tier >= 3:  # a dormer with a lit window
        c.box(a0 + 0.3, b1 - 0.35, a0 + 0.62, b1 - 0.05, h + 1, h + 7, WOOD)
        lwin(c, b1 - 0.05, a0 + 0.36, h + 2, w=0.2, h=3)
        c.gable(a0 + 0.27, b1 - 0.38, a0 + 0.65, b1 - 0.02, h + 7, 3, col)
    # bucket silos on the sand
    silos = [(1.9, 2.55, 14), (2.6, 2.1, 17), (2.6, 2.8, 11)]
    if tier >= 3:  # a concrete pad for the silos at the water's edge
        c.box(2.3, 1.8, 2.95, 2.95, -1, 1, CON_L)
    for i in range(1 + (tier >= 3) + (tier >= 4)):
        u, v, sh = silos[i]
        bucket_silo(c, u, v, 0, sh - 3 + tier, 0.24, 0.34, [col, shade(col, 1.15), shade(col, 0.9)][i], lit=tier >= 2)
    if tier >= 4:  # buoy lights
        for u, v in ((0.2, 0.2), (2.85, 0.25)):
            dot(c, u, v, 3, RED, lit=True)
    return c


def lm_ebs(fw, fh, tier, col, key):
    """EBS Lockers (icon = block volumes): a locker hall whose street face is a wall of lockers (blocks you attach),
    a rack of volume drums along the side cabled to it, rooftop plant and, as it grows, a set-back glass storey,
    a snapshot kiosk and the io2 express lane."""
    c = Canvas(fw, fh, 70)
    r = seeded(key)
    h = 16 + 5 * tier
    u0, v0, u1, v1 = 0.3, 0.3, 2.05, 1.9
    c.box(u0 - 0.05, v0 - 0.05, fw - 0.1, fh - 0.1, 0, 1, CON_L)
    c.box(u0, v0, u1, v1, 1, h, CON_L)
    c.louvres(u0, v0, u1, v1, 1, h, CON_L)
    # the locker wall: rows of locker doors with status LEDs (lit at night)
    rows = (h - 6) // 5
    for row in range(rows):
        for k in range(6):
            u = u0 + 0.08 + k * 0.28
            z = 2 + row * 5
            c.lface(v1, u, u + 0.24, z, z + 4, shade(col, 0.78 if (k + row) % 2 else 0.95))
            c.lface(v1, u + 0.02, u + 0.04, z + 1, z + 3, shade(col, 0.55))
            dot(c, u + 0.19, v1, z + 2, LED, lit=r(3) > 0)
    c.rface(u1, v0 + 0.2, v1 - 0.2, h - 6, h - 3, GLASS_D, light=True)
    c.box(u0 - 0.04, v0 - 0.04, u1 + 0.04, v1 + 0.04, h, h + 3, col)
    roof = h + 3
    if tier >= 3:  # a set-back glass storey
        a0, b0, a1, b1 = u0 + 0.3, v0 + 0.2, u1 - 0.35, v1 - 0.4
        c.box(a0, b0, a1, b1, roof, roof + 9, NAVY)
        c.windows(a0, b0, a1, b1, roof - 2, roof + 8, key + "g", every=0.3, size=0.2, fh=9)
        c.box(a0 - 0.03, b0 - 0.03, a1 + 0.03, b1 + 0.03, roof + 9, roof + 11, shade(col, 0.85))
    if tier >= 2:
        c.box(u1 - 0.55, v0 + 0.1, u1 - 0.1, v0 + 0.45, roof, roof + 5, CON_M)
        c.fan(u1 - 0.32, v0 + 0.27, roof + 5, r=0.16)
    # the volume drums along the side, cabled to the hall: more each tier, stacked two high from tier 3
    nrow = 1 + (tier >= 3)
    ncol = min(5, 1 + tier)
    c.box(2.3, 0.35, 2.85, 2.75, 0, 1, CON_M)
    for k in range(ncol):
        v = 0.55 + k * (2.0 / max(1, ncol - 1) if ncol > 1 else 0)
        for row in range(nrow):
            z = 1 + row * 9
            x, y = cyl(c, 2.58, v, z, z + 8, 0.22, CON_L if (k + row) % 2 else (176, 186, 198))
            c.d.rectangle((x - 5, y + 3, x + 5, y + 4), fill=A(col))
            dot(c, 2.58, v, z + 2, LED, lit=r(2) == 0)
    if tier >= 2:
        for k in range(min(ncol, 3)):
            x0, y0 = c.P(2.36, 0.55 + k * 0.7, 3)
            x1, y1 = c.P(u1, 0.55 + k * 0.7, 3)
            c.d.line([(x0, y0), (x1, y1)], fill=A(NAVY_D))
    if tier >= 3:  # snapshot kiosk (camera)
        c.box(0.35, 2.25, 0.75, 2.65, 0, 9, NAVY)
        x, y = c.P(0.55, 2.65, 6)
        c.d.rectangle((x - 2, y - 2, x + 2, y + 1), fill=A(WHITE))
        c.ld.rectangle((x - 1, y - 1, x + 1, y), fill=A(LIT))
    if tier >= 4:  # io2 express lane stripes
        for k in range(3):
            c.poly([(0.95 + k * 0.42, 2.3, 1), (1.2 + k * 0.42, 2.3, 1), (1.2 + k * 0.42, 2.65, 1), (0.95 + k * 0.42, 2.65, 1)], ORANGE)
    return c


def lm_efs(fw, fh, tier, col, key):
    """EFS icon = a shared file system: a village well whose pipes feed many houses at once."""
    c = Canvas(fw, fh, 64)
    r = seeded(key)
    # pipes radiating out to taps (drawn first, on the ground)
    taps = [(0.3, 0.3), (2.7, 0.3), (0.3, 2.7), (2.7, 2.7), (1.5, 0.2), (0.2, 1.5), (2.8, 1.5), (1.5, 2.8)]
    n = min(2 + 2 * tier, len(taps))
    for i in range(n):
        u, v = taps[i]
        x0, y0 = c.P(1.5, 1.5, 2)
        x1, y1 = c.P(u, v, 2)
        c.d.line([(x0, y0), (x1, y1)], fill=A(shade(col, 0.7)), width=3)
        c.d.line([(x0, y0 - 1), (x1, y1 - 1)], fill=A(col), width=1)
    for i in range(n):
        u, v = taps[i]
        c.box(u - 0.12, v - 0.12, u + 0.12, v + 0.12, 0, 8, CON_M)
        dot(c, u, v, 10, LIT if r(3) else GLASS, lit=True, r=1)
    # the stone well
    x, y = c.P(1.5, 1.5, 0)
    c.d.ellipse((x - 17, y - 5, x + 17, y + 9), fill=A(STONE_D))
    c.d.rectangle((x - 17, y - 12, x + 17, y + 2), fill=A(STONE))
    for k in range(-15, 16, 6):
        c.d.line([(x + k, y - 12), (x + k, y + 1)], fill=A(STONE_D))
    c.d.ellipse((x - 17, y - 19, x + 17, y - 5), fill=A(shade(STONE, 1.1)))
    c.d.ellipse((x - 13, y - 17, x + 13, y - 7), fill=A(shade(WATER, 0.8)))
    c.ld.ellipse((x - 10, y - 16, x + 10, y - 8), fill=A((140, 220, 255), 150))
    # posts + roof
    ph = 20 + 3 * tier
    for dx in (-14, 13):
        c.d.rectangle((x + dx, y - 12 - ph, x + dx + 1, y - 12), fill=A(WOOD_D))
    c.d.line([(x - 14, y - 10 - ph), (x + 14, y - 10 - ph)], fill=A(WOOD_D), width=2)
    c.d.line([(x, y - 10 - ph), (x, y - 16)], fill=A(CON_D))
    c.d.rectangle((x - 2, y - 17, x + 2, y - 13), fill=A(WOOD))
    c.d.polygon([(x - 20, y - 10 - ph), (x, y - 22 - ph), (x + 20, y - 10 - ph)], fill=A(col))
    c.d.polygon([(x, y - 22 - ph), (x + 20, y - 10 - ph), (x + 6, y - 10 - ph)], fill=A(shade(col, 0.78)))
    if tier >= 3:  # pump house
        c.box(2.1, 0.8, 2.6, 1.2, 0, 10, WOOD)
        c.gable(2.05, 0.75, 2.65, 1.25, 10, 5, NAVY)
    if tier >= 4:  # water tower (burst throughput)
        c.box(0.55, 0.9, 0.6, 0.95, 0, 30, WOOD_D)
        c.box(0.95, 0.9, 1.0, 0.95, 0, 30, WOOD_D)
        cyl(c, 0.78, 0.92, 30, 40, 0.28, col, lit=True)
    return c


def lm_glue(fw, fh, tier, col, key):
    """Glue icon = ETL / a crawler: a workshop with bubbling glue pots joining data together."""
    c = Canvas(fw, fh, 70)
    h = 18 + 3 * tier
    c.box(0.3, 0.25, 2.7, 1.6, 0, h, BRICK)
    for z in range(3, h - 2, 4):
        c.line((0.3, 1.6, z), (2.7, 1.6, z), shade(BRICK, 0.8))
    for k in range(3):
        lwin(c, 1.6, 0.5 + k * 0.7, 6, w=0.3, h=6)
    rwin(c, 2.7, 0.5, 6, w=0.3, h=6)
    c.lface(1.6, 0.3, 2.7, h - 4, h - 1, col)
    c.gable(0.25, 0.2, 2.75, 1.65, h, 9, NAVY)
    # chimney
    c.box(0.6, 0.4, 0.9, 0.7, h, h + 16, BRICK)
    # conveyor carrying data boxes into the workshop
    c.box(0.2, 1.9, 2.8, 2.2, 0, 3, CON_D, top=CON_M)
    for i in range(min(tier + 1, 4)):
        u = 0.35 + i * 0.6
        c.box(u, 1.95, u + 0.25, 2.15, 3, 7, BOX_COLS[i % len(BOX_COLS)])
    # glue pots
    for i in range(min(tier, 3)):
        u = 1.0 + i * 0.6
        xx, yt = cyl(c, u, 2.55, 0, 8, 0.2, NAVY_D, top=col)
        c.d.point([(xx - 1, yt + 1), (xx + 2, yt)], fill=A(shade(col, 1.4)))
        c.d.rectangle((xx + 3, yt + 1, xx + 3, yt + 5), fill=A(col))  # drip
        c.ld.ellipse((xx - 3, yt - 1, xx + 3, yt + 1), fill=A(col, 180))
    if tier >= 2:  # glue brush sign
        x, y = c.P(1.5, 1.6, h + 2)
        c.d.rectangle((x - 9, y - 9, x + 9, y - 1), fill=A(WHITE))
        c.d.line([(x - 6, y - 5), (x + 6, y - 5)], fill=A(col), width=2)
        c.d.rectangle((x + 4, y - 7, x + 7, y - 3), fill=A(NAVY))
    if tier >= 3:  # crawler antenna
        x, y = c.P(2.3, 0.9, h + 5)
        c.d.line([(x, y), (x, y - 12)], fill=A(CON_D))
        c.d.ellipse((x - 3, y - 15, x + 3, y - 11), outline=A(col))
    if tier >= 4:  # smoke
        x, y = c.P(0.75, 0.55, h + 16)
        for k in range(3):
            c.d.ellipse((x + k * 3 - 2, y - 4 - k * 4, x + k * 3 + 2, y - k * 4), fill=A(CON_L, 230))
    return c


def lm_athena(fw, fh, tier, col, key):
    """Athena icon = a query magnifier: a lighthouse whose beam sweeps the data lake."""
    h = 40 + 10 * tier
    c = Canvas(fw, fh, h + 28)
    # rocky base
    x, y = c.P(1.5, 1.5, 0)
    c.d.ellipse((x - 24, y - 8, x + 24, y + 10), fill=A(STONE_D))
    c.d.ellipse((x - 20, y - 10, x + 20, y + 6), fill=A(STONE))
    if tier >= 2:  # keeper's cottage
        c.box(0.3, 1.9, 1.1, 2.6, 0, 11, WHITE)
        lwin(c, 2.6, 0.5, 3, w=0.2, h=4)
        c.gable(0.25, 1.85, 1.15, 2.65, 11, 6, col)
    # striped tapering tower drawn as stacked rings
    segs = 4 + tier
    sh = h / segs
    for i in range(segs):
        r0 = 0.46 - 0.2 * i / segs
        cyl(c, 1.5, 1.5, round(i * sh), round((i + 1) * sh), r0, [WHITE, col][i % 2])
    for i in range(1, segs - 1, 2):
        wx, wy = c.P(1.5, 1.5, round(i * sh + sh / 2))
        c.d.rectangle((wx - 1, wy - 2, wx + 1, wy + 1), fill=A(GLASS_D))
        c.ld.rectangle((wx - 1, wy - 2, wx + 1, wy + 1), fill=A(LIT))
    # gallery + lantern
    cyl(c, 1.5, 1.5, h, h + 2, 0.34, NAVY)
    lx, ly = cyl(c, 1.5, 1.5, h + 2, h + 10, 0.2, (255, 236, 150), lit=True)
    c.ld.ellipse((lx - 5, ly - 1, lx + 5, ly + 9), fill=A(LIT))
    c.d.polygon([(lx - 6, ly), (lx, ly - 7), (lx + 6, ly)], fill=A(NAVY))
    # the beam: pale in daylight, bright at night; longer each tier
    blen = 20 + 8 * tier
    by = ly + 5
    c.d.polygon([(lx + 3, by - 2), (lx + 3 + blen, by - 8), (lx + 3 + blen, by + 4), (lx + 3, by + 2)], fill=(255, 244, 190, 110))
    c.ld.polygon([(lx + 3, by - 2), (lx + 3 + blen, by - 8), (lx + 3 + blen, by + 4), (lx + 3, by + 2)], fill=(255, 230, 150, 170))
    if tier >= 3:  # magnifier sign (the Athena query icon)
        mx, my = c.P(2.5, 2.4, 0)
        c.d.line([(mx, my), (mx, my - 12)], fill=A(WOOD_D))
        c.d.ellipse((mx - 5, my - 22, mx + 5, my - 12), outline=A(col), width=2)
        c.d.line([(mx + 4, my - 13), (mx + 8, my - 9)], fill=A(col), width=2)
    if tier >= 4:  # second beam the other way
        c.ld.polygon([(lx - 3, by - 2), (lx - 3 - blen // 2, by - 6), (lx - 3 - blen // 2, by + 3), (lx - 3, by + 2)], fill=(255, 230, 150, 140))
    return c


def lm_lakeformation(fw, fh, tier, col, key):
    """Lake Formation icon = a governed lake: a gatehouse arch where the canal enters the data lake."""
    c = Canvas(fw, fh, 72)
    # canal running through the gate
    water_patch(c, 1.05, 0.0, 1.95, 3.0)
    c.box(0.9, 0.0, 1.05, 3.0, 0, 2, STONE, top=shade(STONE, 1.08))
    c.box(1.95, 0.0, 2.1, 3.0, 0, 2, STONE, top=shade(STONE, 1.08))
    h = 22 + 4 * tier
    # walls on both sides of the arch, running along v
    c.box(0.0, 1.2, 0.9, 1.8, 0, h - 6, STONE)
    c.box(2.1, 1.2, 3.0, 1.8, 0, h - 6, STONE)
    for k in range(6):
        if k % 2 == 0:
            c.box(k * 0.15, 1.2, k * 0.15 + 0.15, 1.8, h - 6, h - 3, STONE)
            c.box(2.1 + k * 0.15, 1.2, 2.25 + k * 0.15, 1.8, h - 6, h - 3, STONE)
    # gatehouse bridge over the canal
    c.box(0.9, 1.1, 2.1, 1.9, 12, h, shade(STONE, 1.05))
    c.lface(1.9, 0.95, 2.05, h - 7, h - 3, col)
    c.box(0.9, 1.1, 1.05, 1.9, 0, 12, STONE)
    c.box(1.95, 1.1, 2.1, 1.9, 0, 12, STONE)
    # portcullis (permissions) over the arch
    for k in range(5):
        u = 1.1 + k * 0.18
        c.lface(1.9, u, u + 0.04, 3 + (tier >= 2) * 4, 12, NAVY_D)
    c.lface(1.9, 1.05, 1.95, 10, 11, NAVY_D)
    # windows in the gatehouse
    lwin(c, 1.9, 1.2, h - 12, w=0.18, h=4)
    lwin(c, 1.9, 1.62, h - 12, w=0.18, h=4)
    # crest: the lake-formation shield (col) on the gatehouse
    x, y = c.P(1.5, 1.9, h + 1)
    c.d.polygon([(x - 5, y - 8), (x + 5, y - 8), (x + 5, y - 3), (x, y + 1), (x - 5, y - 3)], fill=A(col))
    c.d.line([(x - 3, y - 5), (x + 3, y - 5)], fill=A(WATER))
    if tier >= 3:  # corner turrets
        for u0 in (0.0, 2.4):
            c.box(u0, 1.15, u0 + 0.6, 1.85, 0, h + 6, shade(STONE, 0.95))
            lwin(c, 1.85, u0 + 0.2, h - 4, w=0.16, h=4)
            c.pyramid(u0 - 0.05, 1.1, u0 + 0.65, 1.9, h + 6, 8, col)
    if tier >= 4:
        flag(c, 1.5, 1.5, h, col, h=14)
        for u in (0.4, 2.6):
            dot(c, u, 1.9, 8, LIT, lit=True, r=1)
    if tier >= 2:  # permission ledger lectern at the gate
        c.box(2.3, 2.3, 2.6, 2.6, 0, 7, WOOD)
        dot(c, 2.45, 2.45, 8, WHITE, r=1)
    return c
