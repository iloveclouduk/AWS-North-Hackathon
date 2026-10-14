"""
Region signatures (shared/region-flavour.json `signature`, placed by src/world/terrain.ts): one landmark per Region's
city, beside the highway as you leave the core, so Tokyo doesn't look like Ohio. Each is a generic motif drawn in the
city's style and varied by colour: an impression of a place, never a copy of a famous building.

Content rules (tests/signatures.test.ts checks the labels): no trademarked or exact protected silhouettes, no flags or
state emblems, no religious, political or military buildings, no sacred cultural carving.

Motifs: lattice tower, needle tower, bridge, spire, dome, gate, pavilion, rowhouses, wind towers, data-centre campus,
shell roofs, harbour towers, modernist gallery. 2x2 footprint each (sig:<motif>:<variant>), lit windows at night.
Called from generate_tiles.main as signatures_art.build(add).
"""
import json
import os

from generate_tiles import (CON_D, CON_L, CON_M, GLASS, GLASS_D, NAVY, NAVY_D, ORANGE, WHITE, WOOD, WOOD_D,  # noqa: F401
                            A, Canvas, seeded, shade)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

RED = (206, 52, 44)
CREAM = (238, 228, 206)
STONE = (196, 184, 160)
BRICK = (178, 96, 66)
GOLD = (226, 178, 64)
STEEL = (150, 162, 176)


def plinth(c, col=CON_L):
    c.box(0.15, 0.15, 1.85, 1.85, 0, 3, col)


def lattice(v):
    # A tapering lattice tower with an observation deck: red and white, or bronze.
    main, alt = {"red": (RED, WHITE), "bronze": ((150, 112, 72), (186, 150, 104))}[v]
    c = Canvas(2, 2, 150)
    plinth(c)
    segs = [(0.45, 0, 40), (0.6, 40, 80), (0.75, 80, 116), (0.86, 116, 140)]
    for k, (inset, z0, z1) in enumerate(segs):
        col = main if k % 2 == 0 else alt
        a, b = inset, 2 - inset
        for u in (a, b - 0.08):
            c.box(u, a, u + 0.08, a + 0.08, z0, z1, col)
            c.box(u, b - 0.08, u + 0.08, b, z0, z1, col)
        for z in range(z0 + 6, z1, 10):
            c.line((a, b, z), (b, b, z + 5), shade(col, 0.85))
            c.line((b, a, z), (b, b, z + 5), shade(col, 0.7))
    c.box(0.6, 0.6, 1.4, 1.4, 78, 86, alt)  # the deck
    c.windows(0.6, 0.6, 1.4, 1.4, 78, 86, "lattice" + v, every=0.2, size=0.12, fh=6)
    c.box(0.97, 0.97, 1.03, 1.03, 140, 150, CON_L)
    return c


def needle(v):
    # A slender needle tower with a flying-saucer pod.
    col = {"white": (232, 232, 236), "red": (214, 70, 60)}[v]
    c = Canvas(2, 2, 150)
    plinth(c)
    c.box(0.9, 0.9, 1.1, 1.1, 3, 118, col)
    x, y = c.P(1, 1, 120)
    c.d.ellipse((x - 20, y - 4, x + 20, y + 8), fill=A(shade(col, 0.7)))
    c.d.ellipse((x - 18, y - 8, x + 18, y + 4), fill=A(col))
    c.ld.ellipse((x - 14, y - 2, x + 14, y + 4), fill=A((255, 214, 120)))
    c.box(0.97, 0.97, 1.03, 1.03, 124, 146, CON_L)
    return c


def bridge(v):
    # Two bridge towers and their cables over a stretch of deck: red suspension, white cable-stayed, blue truss,
    # or stone aqueduct arches.
    c = Canvas(2, 2, 110)
    if v == "arches":
        for u in (0.15, 0.6, 1.05, 1.5):
            c.box(u, 0.8, u + 0.12, 1.2, 0, 50, STONE)
        c.box(0.1, 0.8, 1.9, 1.2, 50, 58, shade(STONE, 0.95))
        return c
    col = {"red": (196, 72, 40), "white": (236, 236, 240), "blue": (70, 110, 170)}[v]
    c.box(0.1, 0.85, 1.9, 1.15, 14, 18, CON_D)  # deck
    for u in (0.4, 1.5):
        c.box(u, 0.82, u + 0.12, 0.92, 0, 90, col)
        c.box(u, 1.08, u + 0.12, 1.18, 0, 90, col)
        c.box(u, 0.82, u + 0.12, 1.18, 80, 84, col)
    # Cables fan from each tower's top down to the deck either side.
    for uc in (0.46, 1.56):
        for end in (uc - 0.4, uc + 0.4):
            c.line((uc, 1.15, 88), (max(0.1, min(1.9, end)), 1.15, 18), shade(col, 0.8))
    return c


def spire(v):
    # A tall tower with a spire: a clock tower, gothic pinnacles, an alpine clock, or a brick tower.
    wall = {"clock": (206, 180, 128), "gothic": (226, 222, 214), "alpine": CREAM, "brick": BRICK}[v]
    c = Canvas(2, 2, 150)
    plinth(c)
    c.box(0.55, 0.55, 1.45, 1.45, 3, 26, shade(wall, 0.92))
    c.windows(0.55, 0.55, 1.45, 1.45, 3, 26, "spire" + v, every=0.3, size=0.14, fh=10)
    c.box(0.72, 0.72, 1.28, 1.28, 26, 100, wall)
    c.windows(0.72, 0.72, 1.28, 1.28, 30, 70, "spire2" + v, every=0.28, size=0.12, fh=12)
    if v in ("clock", "alpine"):
        for face, at in (("l", 1.28), ("r", 1.28)):
            x, y = c.P(1.0, at, 86) if face == "l" else c.P(at, 1.0, 86)
            c.d.ellipse((x - 5, y - 5, x + 5, y + 5), fill=A(WHITE), outline=A(NAVY_D))
            c.d.line([(x, y), (x, y - 3)], fill=A(NAVY_D))
    c.pyramid(0.68, 0.68, 1.32, 1.32, 100, 40 if v == "gothic" else 28, NAVY if v != "brick" else (120, 60, 44))
    if v == "gothic":
        for u in (0.58, 1.38):
            c.box(u, u, u + 0.06, u + 0.06, 26, 70, wall)
            c.pyramid(u - 0.02, u - 0.02, u + 0.08, u + 0.08, 70, 14, wall)
    return c


def dome(v):
    # A round hall under a dome: a geodesic sphere, a glass dome, or a stone dome.
    body = {"geodesic": (210, 216, 224), "glass": GLASS, "stone": STONE}[v]
    c = Canvas(2, 2, 90)
    plinth(c)
    c.box(0.3, 0.3, 1.7, 1.7, 3, 20, CREAM if v != "glass" else CON_L)
    c.windows(0.3, 0.3, 1.7, 1.7, 3, 20, "dome" + v, every=0.3, size=0.16, fh=9)
    x, y = c.P(1, 1, 44)
    r = 26
    fill = body if v != "geodesic" else (220, 226, 234)
    c.d.ellipse((x - r, y - r + 4, x + r, y + r - 4), fill=A(shade(fill, 0.8)))
    c.d.ellipse((x - r + 3, y - r + 2, x + r - 3, y + r - 8), fill=A(fill))
    if v == "geodesic":
        for k in range(-r + 6, r - 4, 7):
            c.d.line([(x + k, y - r + 6), (x + k + 6, y + r - 10)], fill=A((160, 170, 184)))
            c.d.line([(x + k + 6, y - r + 6), (x + k, y + r - 10)], fill=A((160, 170, 184)))
    if v == "glass":
        c.ld.ellipse((x - r + 8, y - r + 8, x + r - 8, y + r - 14), fill=A((255, 214, 120)))
    return c


def gate(v):
    # A ceremonial gate: a red torii-style gate, a columned gate, a stone arch, or a tiled hanok gate.
    c = Canvas(2, 2, 90)
    if v == "torii":
        for u in (0.4, 1.5):
            c.box(u, 0.92, u + 0.1, 1.08, 0, 60, RED)
        c.box(0.25, 0.9, 1.75, 1.1, 56, 62, RED)
        c.box(0.15, 0.88, 1.85, 1.12, 66, 72, NAVY_D)
        c.box(0.45, 0.94, 1.55, 1.06, 46, 50, RED)
        return c
    if v == "columns":
        c.box(0.1, 0.7, 1.9, 1.3, 0, 4, STONE)
        for u in (0.2, 0.55, 0.9, 1.25, 1.6):
            c.box(u, 0.85, u + 0.12, 1.15, 4, 54, CREAM)
        c.box(0.12, 0.75, 1.88, 1.25, 54, 64, STONE)
        c.box(0.7, 0.85, 1.3, 1.15, 64, 74, shade(STONE, 0.9))
        return c
    if v == "arch":
        c.box(0.2, 0.7, 0.75, 1.3, 0, 64, (200, 170, 120))
        c.box(1.25, 0.7, 1.8, 1.3, 0, 64, (200, 170, 120))
        c.box(0.2, 0.7, 1.8, 1.3, 46, 70, (200, 170, 120))
        x, y = c.P(1.0, 1.3, 46)
        c.d.ellipse((x - 9, y - 8, x + 9, y + 8), fill=A((180, 150, 104)))
        for u in (0.3, 0.9, 1.5):
            c.pyramid(u, 0.8, u + 0.2, 1.0, 70, 10, (180, 150, 104))
        return c
    # hanok: a gate house with a curved tiled roof
    c.box(0.3, 0.7, 1.7, 1.3, 0, 30, WOOD)
    c.lface(1.3, 0.75, 1.25, 0, 22, NAVY_D)
    c.gable(0.15, 0.55, 1.85, 1.45, 30, 16, (70, 80, 96))
    return c


def pavilion(v):
    # A tiered pavilion with upturned eaves: red, gold, teak or green.
    roof, wall = {"red": ((176, 50, 40), (236, 214, 170)), "gold": (GOLD, (200, 70, 60)), "teak": ((110, 74, 46), (196, 150, 100)), "green": ((60, 130, 90), (236, 214, 170))}[v]
    c = Canvas(2, 2, 110)
    plinth(c, STONE)
    z = 3
    for k, inset in enumerate((0.35, 0.5, 0.65)):
        h = 18 - k * 3
        c.box(inset, inset, 2 - inset, 2 - inset, z, z + h, wall)
        c.windows(inset, inset, 2 - inset, 2 - inset, z, z + h, f"pav{v}{k}", every=0.3, size=0.14, fh=9)
        c.pyramid(inset - 0.18, inset - 0.18, 2 - inset + 0.18, 2 - inset + 0.18, z + h, 9, roof)
        z += h + 6
    c.box(0.97, 0.97, 1.03, 1.03, z, z + 12, GOLD)
    return c


def rowhouses(v):
    # A row of narrow town houses: bright colours, falu red, half-timbered, white modernist, or shophouses.
    palettes = {
        "bright": [(232, 84, 112), (250, 196, 60), (96, 180, 210), (140, 196, 90)],
        "falu": [(150, 44, 36), (160, 52, 40), (236, 220, 180), (150, 44, 36)],
        "timber": [CREAM, (230, 214, 186), CREAM, (226, 210, 180)],
        "white": [(240, 240, 236), (232, 232, 228), (240, 240, 236), (226, 226, 222)],
        "shop": [(240, 200, 150), (150, 200, 190), (236, 170, 150), (200, 210, 160)],
    }[v]
    c = Canvas(2, 2, 80)
    for k, col in enumerate(palettes):
        u0 = 0.1 + k * 0.45
        h = 40 + (k % 2) * 8
        c.box(u0, 0.6, u0 + 0.43, 1.4, 0, h, col)
        c.windows(u0, 0.6, u0 + 0.43, 1.4, 0, h, f"row{v}{k}", every=0.21, size=0.12, fh=10)
        if v == "timber":
            for z in (14, 28):
                c.lface(1.4, u0, u0 + 0.43, z, z + 1, WOOD_D)
        if v == "white":
            c.box(u0, 0.6, u0 + 0.43, 1.4, h, h + 2, (210, 210, 206))
        else:
            c.gable(u0, 0.6, u0 + 0.43, 1.4, h, 10, shade(col, 0.6) if v != "falu" else (60, 50, 50))
        c.lface(1.4, u0 + 0.15, u0 + 0.28, 0, 10, NAVY_D)
    return c


def windtower(v):
    # Courtyard houses with square wind towers.
    wall = {"sand": (226, 202, 156), "coral": (236, 214, 186)}[v]
    c = Canvas(2, 2, 80)
    c.box(0.2, 0.5, 1.8, 1.5, 0, 26, wall)
    c.windows(0.2, 0.5, 1.8, 1.5, 0, 26, "wind" + v, every=0.4, size=0.12, fh=12)
    for u in (0.35, 1.25):
        c.box(u, 0.6, u + 0.3, 0.9, 26, 58, shade(wall, 0.95))
        for z in (44, 50):
            c.lface(0.9, u + 0.04, u + 0.26, z, z + 3, (110, 80, 50))
            c.rface(u + 0.3, 0.64, 0.86, z, z + 3, (90, 66, 40))
    return c


def campus(v):
    # A data-centre campus: two long halls, rooftop chillers and a substation; the secure one adds a guard house.
    hall = {"aws": (200, 206, 214), "secure": (120, 128, 146), "green": (190, 206, 190)}[v]
    c = Canvas(2, 2, 60)
    c.box(0.1, 0.1, 1.9, 0.85, 0, 22, hall)
    c.box(0.1, 1.05, 1.9, 1.9, 0, 22, hall)
    c.louvres(0.1, 0.1, 1.9, 0.85, 0, 22, hall)
    c.louvres(0.1, 1.05, 1.9, 1.9, 0, 22, hall)
    for u in (0.3, 0.8, 1.3):
        c.fan(u + 0.15, 0.48, 22)
        c.fan(u + 0.15, 1.48, 22)
    c.lface(1.9, 0.2, 1.8, 18, 20, ORANGE if v == "aws" else NAVY)
    if v == "secure":
        c.box(1.55, 1.55, 1.9, 1.9, 22, 34, NAVY_D)
    return c


def shells(v):
    # A concert hall under white shell roofs on a podium: abstract shells, not anyone's building.
    c = Canvas(2, 2, 90)
    c.box(0.1, 0.3, 1.9, 1.7, 0, 12, (196, 150, 120))
    for u0, h in ((0.25, 48), (0.75, 64), (1.25, 42)):
        apex = (u0 + 0.2, 1.0, 12 + h)
        c.poly([(u0, 1.6, 12), (u0 + 0.5, 1.6, 12), apex], (246, 246, 240))
        c.poly([(u0 + 0.5, 1.6, 12), (u0 + 0.5, 0.4, 12), apex], (214, 214, 206))
    return c


def harbour(v):
    # A tight cluster of glass towers on the waterfront.
    c = Canvas(2, 2, 150)
    for (u, vv, h, col) in ((0.15, 0.15, 120, GLASS_D), (1.0, 0.2, 90, (150, 170, 190)), (0.2, 1.05, 70, (176, 188, 196)), (1.05, 1.05, 136, GLASS)):
        c.box(u, vv, u + 0.75, vv + 0.75, 0, h, col)
        c.windows(u, vv, u + 0.75, vv + 0.75, 0, h, f"harb{u}{vv}", every=0.25, size=0.14, fh=8)
    return c


def modernist(v):
    # A gallery raised on a red frame over an open plaza.
    c = Canvas(2, 2, 70)
    c.box(0.1, 0.1, 1.9, 1.9, 0, 2, CON_L)
    for u in (0.3, 1.6):
        c.box(u, 0.5, u + 0.1, 1.5, 0, 40, RED)
    c.box(0.2, 0.5, 1.8, 1.5, 22, 38, GLASS_D)
    c.windows(0.2, 0.5, 1.8, 1.5, 22, 38, "modern", every=0.3, size=0.2, fh=8)
    c.box(0.2, 0.5, 1.8, 1.5, 38, 42, RED)
    return c


MOTIFS = {
    "lattice": lattice, "needle": needle, "bridge": bridge, "spire": spire, "dome": dome, "gate": gate,
    "pavilion": pavilion, "rowhouses": rowhouses, "windtower": windtower, "campus": campus, "shells": shells,
    "harbour": harbour, "modernist": modernist,
}


def build(add):
    """Exactly the signatures shared/region-flavour.json asks for (one sprite per motif and variant)."""
    with open(os.path.join(ROOT, "shared", "region-flavour.json")) as f:
        regions = json.load(f)["regions"]
    done = set()
    for code, r in sorted(regions.items()):
        sig = r.get("signature")
        if not sig:
            continue
        key = (sig["motif"], sig["variant"])
        if key in done:
            continue
        done.add(key)
        add(f"sig:{sig['motif']}:{sig['variant']}", MOTIFS[sig["motif"]](sig["variant"]))
