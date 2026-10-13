"""
Where the city's people live (src/game/decor.ts in the districts, src/world/terrain.ts in the suburbs): small houses,
corner shops, flats and terraces, so the city isn't only 3x3 landmarks. Sized against the walkers (48x72 frames, about
44 px tall), not the tile: a cottage is two storeys, about one and a half people tall, and flats about twice that.

Called from generate_tiles.main as houses_art.build(add). Same construction and palette as the rest of the city:
32x16 tiles, dark navy outlines, warm walls, AWS navy and orange accents, windows that light up at night.
"""
from generate_tiles import (CON_D, CON_L, CON_M, GLASS, GLASS_D, NAVY, NAVY_D, ORANGE, WHITE, WOOD, WOOD_D,  # noqa: F401
                            Canvas, seeded, shade)

# (walls, roof): warm, varied, never brighter than the landmarks they stand beside.
COTTAGES = [
    ((236, 222, 196), (176, 64, 52)),   # cream, red tiles
    ((206, 170, 132), (88, 74, 70)),    # sandstone, slate
    ((184, 206, 222), (58, 78, 112)),   # pale blue, navy
    ((226, 196, 150), (150, 98, 58)),   # ochre, brown
    ((214, 216, 204), (60, 110, 84)),   # stone, green
    ((240, 214, 214), (120, 70, 90)),   # rose, plum
]
SHOPS = [(ORANGE, (240, 236, 226)), ((60, 150, 120), (240, 236, 226)), ((200, 64, 70), (240, 236, 226)), ((80, 110, 190), (240, 236, 226))]
FLATS = [(218, 206, 186), (176, 184, 196), (196, 150, 120)]


def window(c, face, a, b, z0, z1, lit, at=0.86):
    """A window on the left (v = at) or right (u = at) face, with a pale frame."""
    if face == "l":
        c.lface(at, a - 0.03, b + 0.03, z0 - 1, z1 + 1, WHITE)
        c.lface(at, a, b, z0, z1, GLASS, light=lit)
    else:
        c.rface(at, a - 0.03, b + 0.03, z0 - 1, z1 + 1, WHITE)
        c.rface(at, a, b, z0, z1, GLASS_D, light=lit)


def cottage(k):
    wall, roof = COTTAGES[k]
    r = seeded(f"cottage{k}")
    c = Canvas(1, 1, 66)
    c.box(0.14, 0.14, 0.86, 0.86, 0, 34, wall)
    c.gable(0.1, 0.1, 0.9, 0.9, 34, 16, roof)
    # A chimney on the back slope; the door and two floors of windows on the street faces.
    c.box(0.62, 0.22, 0.72, 0.32, 40, 54, shade(CON_D, 1.1))
    c.lface(0.86, 0.42, 0.6, 0, 14, (90, 60, 44) if k % 2 else NAVY_D)
    window(c, "l", 0.2, 0.34, 7, 14, r(3) > 0)
    window(c, "l", 0.68, 0.8, 7, 14, r(3) > 0)
    window(c, "l", 0.26, 0.42, 21, 28, r(3) > 0)
    window(c, "l", 0.58, 0.74, 21, 28, r(3) > 0)
    window(c, "r", 0.3, 0.46, 7, 14, r(3) > 0)
    window(c, "r", 0.58, 0.74, 7, 14, r(3) > 0)
    window(c, "r", 0.3, 0.46, 21, 28, r(3) > 0)
    window(c, "r", 0.58, 0.74, 21, 28, r(3) > 0)
    return c


def shop(k):
    awning, wall = SHOPS[k]
    c = Canvas(1, 1, 46)
    c.box(0.12, 0.12, 0.88, 0.88, 0, 36, wall)
    c.box(0.1, 0.1, 0.9, 0.9, 36, 39, shade(CON_M, 1.05))  # parapet
    # A big shop window under a striped awning, on both street faces.
    c.lface(0.88, 0.18, 0.82, 3, 15, GLASS, light=True)
    c.rface(0.88, 0.18, 0.82, 3, 15, GLASS_D, light=True)
    for i in range(6):
        col = awning if i % 2 == 0 else WHITE
        a, b = 0.14 + i * 0.12, 0.14 + (i + 1) * 0.12
        c.lface(0.92, a, b, 16, 20, col)
        c.rface(0.92, a, b, 16, 20, shade(col, 0.85))
    # The sign band and the flat upstairs.
    c.lface(0.88, 0.2, 0.8, 22, 26, shade(awning, 0.8))
    window(c, "r", 0.3, 0.44, 25, 32, True, at=0.88)
    window(c, "r", 0.56, 0.7, 25, 32, False, at=0.88)
    window(c, "l", 0.3, 0.44, 28, 33, False, at=0.88)
    window(c, "l", 0.56, 0.7, 28, 33, True, at=0.88)
    return c


def flats(k):
    wall = FLATS[k]
    r = seeded(f"flats{k}")
    c = Canvas(1, 1, 86)
    c.box(0.1, 0.1, 0.9, 0.9, 0, 72, wall)
    c.box(0.08, 0.08, 0.92, 0.92, 72, 75, shade(wall, 0.8))
    c.box(0.55, 0.25, 0.75, 0.45, 75, 81, CON_M)  # the lift housing on the roof
    for z in (8, 24, 40, 56):
        for a in (0.18, 0.5):
            window(c, "l", a, a + 0.2, z, z + 9, r(3) > 0, at=0.9)
            window(c, "r", a, a + 0.2, z, z + 9, r(3) > 0, at=0.9)
    c.lface(0.9, 0.42, 0.58, 0, 12, NAVY_D)
    return c


def terrace(k):
    """Two terraced houses sharing a wall, 2x1 along the street."""
    (w1, roof), (w2, _) = COTTAGES[k], COTTAGES[(k + 3) % len(COTTAGES)]
    r = seeded(f"terrace{k}")
    c = Canvas(2, 1, 64)
    c.box(0.12, 0.14, 1.0, 0.86, 0, 34, w1)
    c.box(1.0, 0.14, 1.88, 0.86, 0, 34, w2)
    c.gable(0.08, 0.1, 1.92, 0.9, 34, 15, roof)
    for u0, col in ((0.12, w1), (1.0, w2)):
        c.lface(0.86, u0 + 0.32, u0 + 0.5, 0, 14, NAVY_D if col == w1 else (90, 60, 44))
        window(c, "l", u0 + 0.1, u0 + 0.24, 7, 14, r(3) > 0)
        window(c, "l", u0 + 0.6, u0 + 0.76, 7, 14, r(3) > 0)
        window(c, "l", u0 + 0.14, u0 + 0.3, 21, 28, r(3) > 0)
        window(c, "l", u0 + 0.52, u0 + 0.68, 21, 28, r(3) > 0)
    window(c, "r", 0.32, 0.5, 7, 14, r(3) > 0, at=1.88)
    window(c, "r", 0.32, 0.5, 21, 28, r(3) > 0, at=1.88)
    return c


def build(add):
    for k in range(len(COTTAGES)):
        add(f"house:cottage:{k}", cottage(k))
    for k in range(len(SHOPS)):
        add(f"house:shop:{k}", shop(k))
    for k in range(len(FLATS)):
        add(f"house:flats:{k}", flats(k))
    for k in range(3):
        add(f"house:terrace:{k}", terrace(k))
