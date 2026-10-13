"""
The city's moving life (plan B3; src/game/Traffic.ts, Boats.ts, Sky.ts): data-themed cars (a server van, a packet car,
a fibre van, a cloud van: looks only, no beacon), a bus, a server truck,
four data carriers (tanker, armoured van, request car, courier: real data only, src/game/RegionOverlay.ts and Ambient.ts),
a ferry, a sailing boat and a barge (each in four facings on one canvas, so the game swaps frames in place), a plane
and its shadow, two bird frames, three clouds and a cloud shadow (unoutlined: soft shapes high above the city), a
headlight glow (drawn ADD) and a bus stop.

Called from generate_tiles.main as vehicles_art.build(add). Same construction and palette as the rest of the city:
32x16 tiles, dark navy outlines, AWS navy + orange. Facings: SE = +x, SW = +y, NE = -y, NW = -x (src/game/iso.ts dirFor).
"""
from PIL import Image, ImageDraw

from generate_tiles import (A, CLEAR, CON_D, CON_L, CON_M, GLASS, GLASS_D, NAVY, NAVY_D, ORANGE, ORANGE_D, OUTLINE,  # noqa: F401
                            WHITE, WOOD, WOOD_D, Canvas, seeded, shade)

DIRS = ("SE", "SW", "NE", "NW")
TEAL = (40, 170, 176)
HEAD = (255, 236, 150)
TAIL = (214, 58, 58)
TYRE = OUTLINE
CAR_COLOURS = {"navy": NAVY, "orange": ORANGE, "white": WHITE, "teal": TEAL}


def body(d, size, length, width, segs, zmax, wheels=(), glass=GLASS, end_lights=True):
    """
    A vehicle (or hull) on a size x size canvas, centred, pointing d. segs: (t0, t1, z0, z1, colour, side_windows) with t
    along the length from the rear (0) to the front (1). The visible faces are v = v1 (left) and u = u1 (right), so the
    front shows its windscreen when heading SE or SW and the tail lights otherwise.
    """
    c = Canvas(size, size, zmax)
    m = size / 2
    along_u = d in ("SE", "NW")
    fwd = d in ("SE", "SW")
    a0, a1 = m - length / 2, m + length / 2
    w0, w1 = m - width / 2, m + width / 2

    def at(t):
        return a0 + t * (a1 - a0) if fwd else a1 - t * (a1 - a0)

    def span(t0, t1):
        p, q = at(t0), at(t1)
        return min(p, q), max(p, q)

    def side(lo, hi, z0, z1, col):
        if along_u:
            c.lface(w1, lo, hi, z0, z1, col)
        else:
            c.rface(w1, lo, hi, z0, z1, col)

    def end(face_at, z0, z1, col, f0=0.0, f1=1.0):
        a, b = w0 + f0 * (w1 - w0), w0 + f1 * (w1 - w0)
        if along_u:
            c.rface(face_at, a, b, z0, z1, col)
        else:
            c.lface(face_at, a, b, z0, z1, col)

    # Painter's order: back to front along the axis.
    order = sorted(segs, key=lambda s: span(s[0], s[1])[0])
    for t0, t1, z0, z1, col, win in order:
        lo, hi = span(t0, t1)
        if along_u:
            c.box(lo, w0, hi, w1, z0, z1, col)
        else:
            c.box(w0, lo, w1, hi, z0, z1, col)
        if win:
            zw0, zw1 = win
            n = max(1, round((hi - lo) / 0.16))
            step = (hi - lo) / n
            for k in range(n):
                side(lo + k * step + 0.025, lo + (k + 1) * step - 0.025, zw0, zw1, glass)
    # The visible end (u1 or v1 of the frontmost-drawn segment).
    last = order[-1]
    lo, hi = span(last[0], last[1])
    z0, z1 = last[2], last[3]
    if end_lights:
        if fwd:
            end(hi, max(z0 + 3, z1 - 5), z1 - 1, GLASS, 0.12, 0.88)
            end(hi, z0 + 1, z0 + 2, HEAD, 0.06, 0.24)
            end(hi, z0 + 1, z0 + 2, HEAD, 0.76, 0.94)
        else:
            end(hi, z0 + 1, z0 + 3, TAIL, 0.06, 0.24)
            end(hi, z0 + 1, z0 + 3, TAIL, 0.76, 0.94)
    for t in wheels:
        x, y = c.P(at(t), w1, 1) if along_u else c.P(w1, at(t), 1)
        c.d.ellipse((x - 1, y - 1, x + 2, y + 2), fill=A(TYRE))
    return c


# Sizes are set against the people (48x72 frames, about 44 px tall) more than against the tile: a car is most of a
# tile long and comes up to a walker's chest, and a bus or truck stands a little taller than a walker. They used to be
# toy-sized (0.62 tile long, 10 px roof), so the crowds dwarfed the traffic.
def car(colour, d):
    roof = shade(colour, 1.08) if colour != WHITE else CON_L
    return body(d, 1, 0.86, 0.46, [
        (0.0, 1.0, 2, 9, colour, None),
        (0.18, 0.74, 9, 16, roof, (10, 14)),
    ], 22, wheels=(0.16, 0.82))


def bus(d):
    return body(d, 1, 0.98, 0.52, [
        (0.0, 1.0, 2, 24, ORANGE, (12, 19)),
        (0.02, 0.98, 24, 26, WHITE, None),
    ], 30, wheels=(0.14, 0.84))


def truck(d):
    # A server truck: a navy box with an orange roof strip and rows of rack lights down its side.
    c = body(d, 1, 0.98, 0.52, [
        (0.0, 0.68, 2, 24, NAVY, None),
        (0.0, 0.68, 21, 24, ORANGE, None),
        (0.72, 1.0, 2, 17, NAVY_D, (10, 15)),
    ], 30, wheels=(0.1, 0.48, 0.88))
    return leds(c, d, 0.98, 0.52, 0.06, 0.62, (8, 12, 16))


# Ambient cars look like data on the move, but mean nothing (src/game/Traffic.ts CAR_SKINS): AWS navy, orange, white
# and teal only, never the carriers' colours, and no roof beacon, so the beaconed carriers stay the only vehicles that
# stand for real data.
LED_ON = (255, 184, 77)
LED_TEAL = (94, 234, 212)
SKY = (125, 180, 235)


def along(d, length, t):
    """The axis coordinate t of the way from the rear (0) to the front (1) of a vehicle `length` long."""
    m = 0.5
    return m - length / 2 + t * length if d in ("SE", "SW") else m + length / 2 - t * length


def side_px(c, d, length, width, t, z, col):
    """One pixel on the vehicle's visible long side."""
    a, w1 = along(d, length, t), 0.5 + width / 2
    x, y = c.P(a, w1, z) if d in ("SE", "NW") else c.P(w1, a, z)
    c.d.point((x, y), fill=A(col))


def leds(c, d, length, width, t0, t1, rows):
    """Rows of blinking-rack lights (orange and teal) along the side, like a server rack seen through the panel."""
    n = max(2, round((t1 - t0) * 14))
    for r, z in enumerate(rows):
        for k in range(n):
            if (k + r) % 3 != 2:
                side_px(c, d, length, width, t0 + (t1 - t0) * k / (n - 1), z, LED_ON if (k + r) % 2 else LED_TEAL)
    return c


def roof_box(c, d, length, t, half, z0, z1, col):
    """A small box on the roof centred at t along the vehicle (a parcel, a cable drum)."""
    a = along(d, length, t)
    if d in ("SE", "NW"):
        c.box(a - half, 0.5 - half, a + half, 0.5 + half, z0, z1, col)
    else:
        c.box(0.5 - half, a - half, 0.5 + half, a + half, z0, z1, col)
    return c


def server_van(d):
    # A navy van with a rack of lights down its side: a server on the move.
    c = body(d, 1, 0.9, 0.48, [
        (0.0, 0.72, 2, 17, NAVY, None),
        (0.0, 0.72, 17, 19, NAVY_D, None),
        (0.72, 1.0, 2, 14, NAVY_D, (8, 12)),
    ], 26, wheels=(0.14, 0.84))
    return leds(c, d, 0.9, 0.48, 0.08, 0.64, (7, 11, 15))


def packet_car(d):
    # A small orange car with a cardboard parcel on the roof, taped in navy: a data packet on its way. (Brown, never
    # white: a small white thing on a roof is the carriers' beacon.)
    c = car(ORANGE, d)
    roof_box(c, d, 0.86, 0.46, 0.14, 16, 22, WOOD)
    return roof_box(c, d, 0.86, 0.46, 0.145, 18, 19, NAVY)


def fibre_van(d):
    # A teal van with an orange cable drum on its back: laying fibre between data centres.
    c = body(d, 1, 0.9, 0.48, [
        (0.0, 0.72, 2, 15, TEAL, None),
        (0.72, 1.0, 2, 14, shade(TEAL, 0.86), (8, 12)),
    ], 24, wheels=(0.14, 0.84))
    roof_box(c, d, 0.9, 0.32, 0.16, 15, 20, ORANGE)
    return roof_box(c, d, 0.9, 0.32, 0.06, 20, 21, NAVY)


def cloud_van(d):
    # A white van with a sky-blue cloud on its side: the cloud, delivered.
    c = body(d, 1, 0.9, 0.48, [
        (0.0, 0.72, 2, 17, WHITE, None),
        (0.72, 1.0, 2, 14, CON_L, (8, 12)),
    ], 26, wheels=(0.14, 0.84))
    for t, z in ((0.2, 9), (0.26, 9), (0.32, 9), (0.38, 9), (0.44, 9), (0.26, 10), (0.32, 10), (0.38, 10), (0.32, 11), (0.38, 11), (0.2, 8), (0.26, 8), (0.32, 8), (0.38, 8), (0.44, 8)):
        side_px(c, d, 0.9, 0.48, t, z, SKY)
    return c


DATA_CARS = {"server": server_van, "packet": packet_car, "fibre": fibre_van, "cloud": cloud_van}


# Data carriers (src/game/RegionOverlay.ts → Ambient.dispatchData): they drive only for real data, so each wears the link's colour
# (RegionOverlay COLORS) and a white roof beacon no ambient car has. Tanker = replication (a copy of the data in a
# tank), armoured van = the Multi-AZ standby (a protected spare), request car = requests, courier = an agent's call.
DATA_MAGENTA = (201, 37, 209)   # replication, AWS database colour
DATA_BLUE = (125, 211, 252)     # standby
DATA_AMBER = (255, 184, 77)     # requests
BEACON = (250, 250, 255)


def beacon(c, d, t, z):
    """A 2x2 white light on the roof, a little forward of t along the vehicle."""
    m = 0.5
    along_u = d in ("SE", "NW")
    fwd = d in ("SE", "SW")
    a = m - 0.43 + t * 0.86 if fwd else m + 0.43 - t * 0.86
    x, y = c.P(a, m, z) if along_u else c.P(m, a, z)
    c.d.rectangle((x - 1, y - 2, x + 1, y), fill=A(BEACON), outline=A(OUTLINE))
    return c


def tanker(d):
    # A cab and a long round tank, magenta with a white band: the data, copied to another Region.
    # Boxes stack, never overlap (body() draws whole boxes): chassis, tank, a white top, and the cab.
    c = body(d, 1, 0.98, 0.5, [
        (0.0, 0.7, 2, 6, CON_D, None),
        (0.02, 0.68, 6, 17, DATA_MAGENTA, None),
        (0.02, 0.68, 17, 20, WHITE, None),
        (0.72, 1.0, 2, 17, NAVY, (10, 15)),
    ], 30, wheels=(0.1, 0.42, 0.86))
    return beacon(c, d, 0.86, 18)


def armoured(d):
    # A short, square van with slit windows: the standby copy, kept safe in another AZ.
    c = body(d, 1, 0.9, 0.5, [
        (0.0, 1.0, 2, 16, DATA_BLUE, (11, 13)),
        (0.0, 1.0, 16, 19, NAVY, None),
    ], 26, wheels=(0.16, 0.84))
    return beacon(c, d, 0.5, 20)


def request_car(d):
    # A small amber hatchback: one request on its way in.
    c = body(d, 1, 0.8, 0.44, [
        (0.0, 1.0, 2, 9, DATA_AMBER, None),
        (0.16, 0.72, 9, 15, shade(DATA_AMBER, 1.08), (10, 13)),
    ], 22, wheels=(0.16, 0.82))
    return beacon(c, d, 0.44, 16)


def courier(d):
    # A navy delivery van with an orange stripe: an agent's call, carried from one service to another.
    c = body(d, 1, 0.9, 0.48, [
        (0.0, 0.74, 2, 17, NAVY, None),
        (0.0, 0.74, 17, 19, ORANGE, None),
        (0.74, 1.0, 2, 14, NAVY_D, (8, 12)),
    ], 26, wheels=(0.14, 0.84))
    return beacon(c, d, 0.36, 20)


def ferry(d):
    # A white car ferry with a navy hull and an orange funnel (2x2 canvas: it's a big boat on the sea lane).
    c = body(d, 2, 1.5, 0.56, [
        (0.0, 1.0, -2, 4, NAVY, None),
        (0.04, 0.96, 4, 7, WHITE, None),
        (0.25, 0.8, 7, 13, WHITE, (9, 11)),
        (0.45, 0.58, 13, 18, ORANGE, None),
    ], 26, glass=GLASS_D, end_lights=False)
    return c


def sail(d):
    # A small yacht: white hull, a mast and an orange-and-white sail.
    c = body(d, 1, 0.6, 0.26, [
        (0.0, 1.0, -1, 3, WHITE, None),
        (0.3, 0.7, 3, 5, WOOD, None),
    ], 36, end_lights=False)
    x, y = c.P(0.5, 0.5, 4)
    c.d.line([(x, y), (x, y - 26)], fill=A(WOOD_D))
    c.d.polygon([(x + 1, y - 25), (x + 1, y - 3), (x + 11, y - 4)], fill=A(WHITE))
    c.d.polygon([(x + 1, y - 13), (x + 1, y - 3), (x + 11, y - 4)], fill=A(ORANGE))
    c.d.polygon([(x - 1, y - 20), (x - 1, y - 4), (x - 7, y - 4)], fill=A(CON_L))
    return c


def barge(d):
    # A low river barge carrying containers in AWS colours (2x2 canvas, long and flat).
    return body(d, 2, 1.4, 0.5, [
        (0.0, 1.0, -2, 3, WOOD_D, None),
        (0.08, 0.34, 3, 8, ORANGE, None),
        (0.36, 0.62, 3, 8, NAVY, None),
        (0.64, 0.84, 3, 8, CON_M, None),
        (0.86, 1.0, 3, 10, WHITE, (6, 8)),
    ], 16, glass=GLASS_D, end_lights=False)


def plane(d):
    """A small jet seen from above at the iso angle, heading +x (planeE, out over the gate) or -x (planeW)."""
    c = Canvas(2, 2, 6)
    fwd = d == "E"
    u0, u1 = 0.35, 1.65
    nose = u1 if fwd else u0
    tail = u0 if fwd else u1
    s = 1 if fwd else -1
    # wings, then the fuselage over them, then the tail fin
    c.poly([(1.05, 0.25, 2), (1.05 + 0.18 * s, 0.25, 2), (1.0 + 0.32 * s, 1.0, 2), (0.9, 1.0, 2)], CON_L)
    c.poly([(1.05, 1.75, 2), (1.05 + 0.18 * s, 1.75, 2), (1.0 + 0.32 * s, 1.0, 2), (0.9, 1.0, 2)], shade(CON_L, 0.9))
    c.box(min(nose, tail), 0.92, max(nose, tail), 1.08, 1, 4, WHITE)
    c.poly([(tail, 0.7, 3), (tail + 0.16 * s, 0.7, 3), (tail + 0.2 * s, 1.3, 3), (tail, 1.3, 3)], NAVY)
    c.box(min(tail, tail + 0.12 * s), 0.96, max(tail, tail + 0.12 * s), 1.04, 4, 6, ORANGE)
    x, y = c.P(nose - 0.1 * s, 1.0, 4)
    c.d.point([(x, y)], fill=A(GLASS_D))
    return c


def plane_shadow():
    c = Canvas(2, 2, 0)
    col = (10, 20, 40)
    c.poly([(1.05, 0.25, 0), (1.25, 0.25, 0), (1.3, 1.75, 0), (1.05, 1.75, 0)], col)
    c.poly([(0.35, 0.92, 0), (1.65, 0.92, 0), (1.65, 1.08, 0), (0.35, 1.08, 0)], col)
    c.poly([(0.35, 0.7, 0), (0.5, 0.7, 0), (0.55, 1.3, 0), (0.35, 1.3, 0)], col)
    img = c.img.copy()
    img.putalpha(img.getchannel("A").point(lambda v: 70 if v else 0))
    return img, (c.ox, c.oy)


def bird(frame):
    img = Image.new("RGBA", (9, 6), CLEAR)
    d = ImageDraw.Draw(img)
    col = A((30, 36, 52))
    if frame == 0:  # wings up
        d.point([(0, 1), (1, 2), (2, 3), (3, 4), (4, 4), (5, 4), (6, 3), (7, 2), (8, 1)], fill=col)
    else:  # wings down
        d.point([(0, 4), (1, 3), (2, 3), (3, 3), (4, 4), (5, 3), (6, 3), (7, 3), (8, 4)], fill=col)
    return img, (4, 3)


def cloud(k):
    """Soft pixel clouds: a few overlapping puffs, a light top and a cooler underside. No outline."""
    r = seeded(f"cloud{k}")
    w, h = (96, 40) if k != 1 else (72, 32)
    img = Image.new("RGBA", (w, h), CLEAR)
    d = ImageDraw.Draw(img)
    base = (226, 236, 248, 255)
    top = (255, 255, 255, 255)
    under = (186, 202, 224, 255)
    puffs = []
    for i in range(5 + k):
        cx = 12 + r(w - 24)
        cy = h // 2 + r(6) - 2
        rr = 8 + r(9)
        puffs.append((cx, cy, rr))
    for cx, cy, rr in puffs:
        d.ellipse((cx - rr, cy - rr // 2 + 2, cx + rr, cy + rr // 2 + 6), fill=under)
    for cx, cy, rr in puffs:
        d.ellipse((cx - rr, cy - rr // 2, cx + rr, cy + rr // 2 + 3), fill=base)
    for cx, cy, rr in puffs:
        d.ellipse((cx - rr + 3, cy - rr // 2, cx + rr - 5, cy), fill=top)
    return img, (w // 2, h // 2)


def cloud_shadow():
    img = Image.new("RGBA", (96, 32), CLEAR)
    d = ImageDraw.Draw(img)
    d.ellipse((4, 4, 92, 28), fill=(10, 24, 40, 46))
    d.ellipse((20, 8, 76, 24), fill=(10, 24, 40, 60))
    return img, (48, 16)


def headlight():
    """A warm glow ahead of a car at night (drawn with ADD blending)."""
    img = Image.new("RGBA", (24, 14), CLEAR)
    d = ImageDraw.Draw(img)
    for i in range(6, 0, -1):
        d.ellipse((12 - i * 2, 7 - i, 12 + i * 2, 7 + i), fill=(255, 226, 150, 18 + (6 - i) * 16))
    return img, (12, 7)


def bus_stop():
    c = Canvas(1, 1, 30)
    c.box(0.2, 0.3, 0.8, 0.36, 0, 18, GLASS_D)  # the back panel
    for u in (0.22, 0.78):
        c.box(u - 0.03, 0.62, u + 0.03, 0.68, 0, 18, CON_D)
    c.box(0.18, 0.28, 0.82, 0.72, 18, 20, NAVY)  # roof
    c.box(0.3, 0.42, 0.7, 0.52, 0, 5, WOOD)  # bench
    c.box(0.86, 0.6, 0.9, 0.64, 0, 24, CON_M)  # sign pole
    c.box(0.82, 0.56, 0.94, 0.68, 20, 27, ORANGE)
    return c


def build(add):
    for name, col in CAR_COLOURS.items():
        for d in DIRS:
            add(f"veh:car:{name}:{d}", car(col, d), lights=False)
    for name, make in DATA_CARS.items():
        for d in DIRS:
            add(f"veh:car:{name}:{d}", make(d), lights=False)
    for d in DIRS:
        add(f"veh:bus:{d}", bus(d), lights=False)
        add(f"veh:truck:{d}", truck(d), lights=False)
        add(f"veh:ferry:{d}", ferry(d), lights=False)
        add(f"veh:sail:{d}", sail(d), lights=False)
        add(f"veh:barge:{d}", barge(d), lights=False)
        add(f"veh:data:tanker:{d}", tanker(d), lights=False)
        add(f"veh:data:armoured:{d}", armoured(d), lights=False)
        add(f"veh:data:request:{d}", request_car(d), lights=False)
        add(f"veh:data:courier:{d}", courier(d), lights=False)
    for d in ("E", "W"):
        add(f"plane{d}", plane(d), lights=False)
    img, anchor = plane_shadow()
    add("planeShadow", img, anchor)
    for f in (0, 1):
        img, anchor = bird(f)
        add(f"bird{f}", img, anchor)
    for k in range(3):
        img, anchor = cloud(k)
        add(f"cloud{k}", img, anchor)
    img, anchor = cloud_shadow()
    add("cloudShadow", img, anchor)
    img, anchor = headlight()
    add("headlight", img, anchor)
    add("busStop", bus_stop(), lights=False)
