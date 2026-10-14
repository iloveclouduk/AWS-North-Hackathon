"""
Legend crowns (src/state/mastery.ts): past Master a building's knowledge tower (growth_art) keeps growing in gold, earned
from what the player really knows. One sprite per level, each holding the ones below it, stood on the tower's tip:

  legend:1  Mentor     a gold ring round the spire and a pennant
  legend:2  Architect  + a gold spire
  legend:3  Legend     + a crown with three gems; at night a soft beam of light above it (@lights only, so the map
                       stays calm by day)

Anchored at the bottom centre (the tower's tip). Called from generate_tiles.main as legend_art.build(add).
"""
from PIL import Image, ImageDraw

GOLD = (255, 196, 51, 255)
GOLD_HI = (255, 236, 160, 255)
GOLD_D = (190, 128, 20, 255)
INK = (22, 30, 40, 255)
FLAG = (255, 153, 0, 255)
GEMS = [(229, 72, 77, 255), (59, 130, 246, 255), (52, 211, 153, 255)]
GLOW = (255, 214, 120, 255)

W = 30
SPIRE = 22
CROWN = 12
BEAM = 60


def _ring(d, cx, y):
    d.ellipse((cx - 10, y - 4, cx + 10, y + 4), outline=INK, fill=GOLD_D)
    d.ellipse((cx - 9, y - 3, cx + 9, y + 2), fill=GOLD)
    d.line((cx - 6, y - 3, cx + 3, y - 3), fill=GOLD_HI)


def _pennant(d, cx, y):
    d.line((cx + 7, y - 1, cx + 7, y - 15), fill=INK)
    d.polygon([(cx + 8, y - 15), (cx + 14, y - 12), (cx + 8, y - 9)], fill=FLAG, outline=INK)


def _spire(d, cx, y):
    d.polygon([(cx - 3, y), (cx + 3, y), (cx, y - SPIRE)], fill=GOLD, outline=INK)
    d.line((cx - 1, y - 1, cx, y - SPIRE + 4), fill=GOLD_HI)


def _crown(d, cx, y):
    top = y - CROWN
    d.polygon([(cx - 8, y), (cx + 8, y), (cx + 8, top + 3), (cx + 4, top + 8), (cx, top), (cx - 4, top + 8), (cx - 8, top + 3)], fill=GOLD, outline=INK)
    d.line((cx - 7, y - 2, cx + 7, y - 2), fill=GOLD_D)
    for x in (cx - 8, cx, cx + 8):  # a pearl on each point
        top_y = top if x == cx else top + 3
        d.rectangle((x - 1, top_y - 2, x, top_y - 1), fill=GOLD_HI)
    for k, g in enumerate(GEMS):
        x = cx - 6 + k * 5
        d.rectangle((x, y - 6, x + 2, y - 4), fill=g)


def crown_sprite(level):
    """The image, its night lights, and its anchor (bottom centre)."""
    extra = {1: 16, 2: 16 + SPIRE, 3: 16 + SPIRE + CROWN + 3}[level]
    beam = BEAM if level >= 3 else 0
    h = extra + 6 + beam
    img = Image.new("RGBA", (W, h), (0, 0, 0, 0))
    lit = Image.new("RGBA", (W, h), (0, 0, 0, 0))
    d, ld = ImageDraw.Draw(img), ImageDraw.Draw(lit)
    cx, base = W // 2, h - 5
    _ring(d, cx, base)
    _pennant(d, cx, base)
    ld.ellipse((cx - 9, base - 3, cx + 9, base + 2), fill=GLOW)
    y = base - 3
    if level >= 2:
        _spire(d, cx, y)
        y -= SPIRE - (9 if level >= 3 else 2)  # the crown sits on the spire's upper half
    if level >= 3:
        _crown(d, cx, y)
        ld.ellipse((cx - 7, y - CROWN, cx + 7, y), fill=GLOW)
        # the beam: a narrow cone of light rising from the crown, fading out
        for k in range(beam):
            a = int(150 * (1 - k / beam))
            half = 1 + k // 14
            ld.line((cx - half, y - CROWN - k, cx + half, y - CROWN - k), fill=(255, 226, 150, a))
    return img, lit, (cx, base + 4)


def token_frame(k):
    """A golden token spinning (src/game/Tokens.ts): 4 frames, full face → edge, anchored at its foot on the ground."""
    w, h = 16, 22
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx, cy = w // 2, 8
    half = [6, 4, 1, 4][k]
    d.ellipse((cx - 4, h - 3, cx + 4, h - 1), fill=(0, 0, 0, 70))  # its shadow on the street
    d.ellipse((cx - half, cy - 6, cx + half, cy + 6), fill=GOLD_D, outline=INK)
    if half > 2:
        d.ellipse((cx - half + 1, cy - 5, cx + half - 1, cy + 4), fill=GOLD)
        d.line((cx, cy - 3, cx, cy + 2), fill=GOLD_D)  # a star stroke on the face
        d.line((cx - 2, cy - 1, cx + 2, cy - 1), fill=GOLD_D)
        d.point((cx - half + 2, cy - 3), fill=GOLD_HI)
    return img, (cx, h - 2)


def build(add):
    from growth_art import crop
    for level in (1, 2, 3):
        img, lit, anchor = crown_sprite(level)
        # the crown's top is its tip (the beam's empty sky trimmed), so the sign can stand just above it
        add(f"legend:{level}", *crop(img, anchor))
        add(f"legend:{level}@lights", lit, anchor)
    for k in range(4):
        img, anchor = token_frame(k)
        add(f"token:{k}", img, anchor)
