"""
Knowledge towers: every landmark grows a tower in its district's style on the back tile of its lot, so a building
visibly rises with what the player has learned there (src/state/growth.ts tiers). The bespoke landmark stays in front
and keeps its metaphor (a lake stays a lake); the tower behind it is the player's knowledge made tall:

  tier 1  Novice        no tower yet: the landmark alone
  tier 2  Practitioner  a mid-rise with a lobby
  tier 3  Expert        a tower with a setback storey
  tier 4  Master        a skyscraper with the district's crown and a beacon

The shapes reuse towers_art (the district skyline: body colours, window grid, accent bands, crowns) and vary per
service (a seeded inset and band spacing) so six towers in one district don't look stamped. `with_tower` composes
the finished landmark over its tower on one canvas, both anchored at the lot's N corner (= the back tile's N corner),
then `crop` trims the empty sky so the atlas holds only pixels.
"""
from PIL import Image

from generate_tiles import GLASS_D, Canvas, seeded, shade
import towers_art

# (shaft top, setback storey) per tier, in px above the ground. A walker is about 44 px tall.
TIER_HEIGHTS = {2: (46, 0), 3: (86, 14), 4: (132, 24)}
# The tower stands on the back of the lot, SPAN tiles wide: towers_art draws on a unit tile, scaled up here.
SPAN, AT = 1.6, 0.06


class Scaled(Canvas):
    """A Canvas whose unit tile maps onto [AT, AT + SPAN] of a bigger footprint, so towers_art's shapes grow broad."""

    def P(self, u, v, z=0):
        return super().P(AT + u * SPAN, AT + v * SPAN, z)


def knowledge_tower(district, tier, key):
    """The tower for one landmark at one tier (None at tier 1), on the back of the lot (a 2x2 canvas)."""
    if tier not in TIER_HEIGHTS:
        return None
    body, accent = towers_art.BODY[district], towers_art.DISTRICT[district]
    shaft_h, setback = TIER_HEIGHTS[tier]
    r = seeded(key)
    inset = r(4) * 0.025  # a slightly slimmer or broader shaft per service
    c = Scaled(2, 2, shaft_h + setback + towers_art.CROWN + 12)
    # The podium: dark glass lobby with the district colour over the door.
    c.box(0.04, 0.04, 0.96, 0.96, 0, 12, shade(body, 0.85))
    c.lface(0.96, 0.2, 0.8, 1, 10, GLASS_D)
    c.lface(0.96, 0.2, 0.8, 10, 12, accent)
    z = towers_art.shaft(c, key, body, accent, 12, shaft_h, inset)
    if setback:
        z = towers_art.shaft(c, key + ":top", body, accent, z, z + setback, inset + 0.1)
    if tier >= 3:
        towers_art.crown(c, district, accent, z, key)
    if tier >= 4:  # a beacon over the crown: the Master's light, seen across the city at night
        top = z + {"networking": 30, "storage": 24, "aiml": 21, "database": 20}.get(district, 9)
        x, y = c.P(0.5, 0.5, top)
        c.d.rectangle((x - 1, y - 2, x + 1, y), fill=(255, 214, 120, 255))
        c.ld.ellipse((x - 4, y - 5, x + 4, y + 3), fill=(255, 214, 120, 255))
    return c


def _place(dst, img, at):
    if img is not None:
        dst.alpha_composite(img, at)


def with_tower(landmark, tower):
    """Composes a finished landmark (img, anchor, lights) over its tower's; both anchors are the lot's N corner."""
    img, (ax, ay), lit = landmark
    if tower is None:
        return landmark
    timg, (tx, ty), tlit = tower
    # The canvas that holds both, with the shared anchor at (nx, ny).
    nx, ny = max(ax, tx), max(ay, ty)
    w = nx + max(img.width - ax, timg.width - tx)
    h = ny + max(img.height - ay, timg.height - ty)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    _place(out, timg, (nx - tx, ny - ty))
    _place(out, img, (nx - ax, ny - ay))
    lights = None
    if lit is not None or tlit is not None:
        lights = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        # the landmark hides what it stands in front of: its own pixels mask the tower's lights
        if tlit is not None:
            tl = Image.new("RGBA", (w, h), (0, 0, 0, 0))
            tl.alpha_composite(tlit, (nx - tx, ny - ty))
            mask = Image.new("L", (w, h), 0)
            mask.paste(img.getchannel("A"), (nx - ax, ny - ay))
            tl.putalpha(Image.composite(Image.new("L", (w, h), 0), tl.getchannel("A"), mask.point(lambda a: 255 if a > 0 else 0)))
            lights.alpha_composite(tl)
        _place(lights, lit, (nx - ax, ny - ay))
    return out, (nx, ny), lights


def crop(img, anchor):
    """Trims the empty sky above the drawing (keeping 1 px) and moves the anchor down with it. Only the top: the
    anchor (the lot's N corner) stays inside the image, and the sign still sits on the roof (Landmark.getTopCenter)."""
    box = img.getbbox()
    if box is None:
        return img, anchor
    y0 = max(0, box[1] - 1)
    return img.crop((0, y0, img.width, img.height)), (anchor[0], anchor[1] - y0)
