"""
The skyline (src/game/decor.ts): each district grows towers in its AWS category's colour as the player levels up its
landmarks, so the city's skyline rises with what they've learned. Three heights per district (mid-rise, tower,
skyscraper), each a real building type (podium, shaft with a window grid, setback, crown), with a crown that says
which part of AWS lives there:

  compute     orange, server-rack window bands and rooftop cooling fans
  storage     green, ribbed like a bucket, a water tank on the roof
  database    magenta, a stack of database disks on the roof
  networking  purple, a radio mast with a red aircraft light and a dish
  security    red, battlements and a shield crest
  aiml        teal glass, a glowing pyramid crown

1x1 footprint like the flats, so a tower fits any street-facing lot. Windows light up at night (@lights).
Called from generate_tiles.main as towers_art.build(add).
"""
from generate_tiles import (CON_D, CON_L, CON_M, GLASS, GLASS_D, NAVY, NAVY_D, ORANGE, WHITE,  # noqa: F401
                            A, Canvas, seeded, shade)

# The official AWS Architecture Icon category colours (shared/world.json districts), toned for walls.
DISTRICT = {
    "compute": (237, 113, 0),
    "storage": (122, 161, 22),
    "database": (201, 37, 209),
    "networking": (140, 79, 255),
    "security": (221, 52, 76),
    "aiml": (1, 168, 141),
}
# Wall bodies: a quiet concrete or glass so the accent (bands, crown) carries the colour, as real towers do.
BODY = {
    "compute": (206, 200, 192),
    "storage": (196, 204, 186),
    "database": (210, 198, 214),
    "networking": (188, 186, 214),
    "security": (150, 140, 148),
    "aiml": (120, 186, 196),
}
# (shaft height, setback height) for mid-rise, tower and skyscraper. A walker is about 44 px tall (36 in a crowd).
HEIGHTS = {"mid": (52, 0), "tall": (110, 16), "sky": (150, 28)}
CROWN = 30  # room above the shaft for the crown


def shaft(c, key, body, accent, z0, z1, inset):
    """The tower's body with a window grid; returns the roof height."""
    u0, u1 = 0.12 + inset, 0.88 - inset
    c.box(u0, u0, u1, u1, z0, z1, body)
    c.windows(u0, u0, u1, u1, z0, z1 - 2, key, every=0.25, size=0.15, fh=8)
    # An accent band every few floors, and the cap.
    for z in range(z0 + 24, z1 - 6, 32):
        c.lface(u1, u0, u1, z, z + 2, accent)
        c.rface(u1, u0, u1, z, z + 2, shade(accent, 0.8))
    c.box(u0 - 0.02, u0 - 0.02, u1 + 0.02, u1 + 0.02, z1, z1 + 3, shade(accent, 0.9))
    return z1 + 3


def crown(c, d, accent, z, key):
    r = seeded(key)
    m = 0.5
    if d == "compute":
        # Rooftop cooling: two fans and a rack of status lights.
        c.box(0.3, 0.3, 0.7, 0.7, z, z + 6, CON_M)
        c.fan(0.4, 0.5, z + 6)
        c.fan(0.6, 0.5, z + 6)
        for k in range(4):
            c.lface(0.7, 0.32 + k * 0.09, 0.37 + k * 0.09, z + 2, z + 4, (120, 230, 120) if r(2) else accent, light=True)
    elif d == "storage":
        # A water tank on legs: the city's bucket.
        for u, v in ((0.38, 0.38), (0.62, 0.38), (0.38, 0.62), (0.62, 0.62)):
            c.box(u - 0.02, v - 0.02, u + 0.02, v + 0.02, z, z + 6, NAVY_D)
        c.box(0.32, 0.32, 0.68, 0.68, z + 6, z + 18, accent)
        c.pyramid(0.32, 0.32, 0.68, 0.68, z + 18, 5, shade(accent, 0.8))
    elif d == "database":
        # The database icon: a stack of three disks.
        for k in range(3):
            x, y = c.P(m, m, z + 3 + k * 6)
            col = accent if k % 2 == 0 else shade(accent, 1.25)
            c.d.ellipse((x - 9, y - 3, x + 9, y + 6), fill=A(shade(col, 0.7)))
            c.d.ellipse((x - 9, y - 6, x + 9, y + 3), fill=A(col))
    elif d == "networking":
        # A radio mast with a dish and a red aircraft light.
        c.box(0.46, 0.46, 0.54, 0.54, z, z + 26, CON_L)
        c.box(0.3, 0.42, 0.42, 0.58, z + 8, z + 14, WHITE)
        x, y = c.P(m, m, z + 28)
        c.d.rectangle((x - 1, y - 1, x + 1, y + 1), fill=A((230, 40, 40)))
        c.ld.rectangle((x - 1, y - 1, x + 1, y + 1), fill=A((255, 80, 60)))
        c.box(0.4, 0.4, 0.6, 0.6, z, z + 4, accent)
    elif d == "security":
        # Battlements and a shield crest on the street face.
        for k in range(4):
            u = 0.14 + k * 0.2
            c.box(u, 0.12, u + 0.1, 0.22, z, z + 7, shade(BODY[d], 0.9))
            c.box(0.78, u, 0.88, u + 0.1, z, z + 7, shade(BODY[d], 0.82))
        x, y = c.P(0.5, 0.88, z - 14)
        c.d.polygon([(x - 5, y - 6), (x + 5, y - 6), (x + 5, y), (x, y + 5), (x - 5, y)], fill=A(accent))
        c.d.line([(x, y - 5), (x, y + 3)], fill=A(WHITE))
    else:  # aiml
        # A glowing glass pyramid.
        c.pyramid(0.2, 0.2, 0.8, 0.8, z, 20, shade(accent, 1.2))
        x, y = c.P(m, m, z + 20)
        c.d.rectangle((x - 1, y - 1, x + 1, y + 1), fill=A(WHITE))
        c.ld.polygon([c.P(0.2, 0.8, z), c.P(0.8, 0.8, z), c.P(m, m, z + 20)], fill=A((120, 255, 220)))


def tower(d, size):
    body, accent = BODY[d], DISTRICT[d]
    shaft_h, setback = HEIGHTS[size]
    key = f"tower:{d}:{size}"
    c = Canvas(1, 1, shaft_h + setback + CROWN + 8)
    # Podium: a lobby with a dark glass front and the district's colour over the door.
    c.box(0.06, 0.06, 0.94, 0.94, 0, 12, shade(body, 0.85))
    c.lface(0.94, 0.2, 0.8, 1, 10, GLASS_D)
    c.lface(0.94, 0.2, 0.8, 10, 12, accent)
    z = shaft(c, key, body, accent, 12, shaft_h, 0.0)
    if setback:
        z = shaft(c, key + ":top", body, accent, z, z + setback, 0.1)
    crown(c, d, accent, z, key)
    return c


SIZES = ("mid", "tall", "sky")


def build(add):
    for d in DISTRICT:
        for size in SIZES:
            add(f"tower:{d}:{size}", tower(d, size))
