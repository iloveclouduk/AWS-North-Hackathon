"""
Habbo-inspired isometric pixel character generator (v2).

Every character is a LOOK (skin, hair, hat, top, legs, shoes, accessories)
rendered from layered, individually outlined parts. Each look gets the full
animation set in 4 isometric directions (SE, SW, NE, NW).

Output (next to this script):
  characters/<name>/sheet.png    sprite sheet, rows = anim x dir, cols = frames
  characters/<name>/sheet.json   frame rects, durations, pivot
  characters/<name>/preview.png  labelled 2x contact sheet
  characters/<name>/gifs/        4x animated GIF per anim + direction
  props/door_left|right.png      4-frame opening door (+ gifs)
  lineup.png                     every look side by side
  shadow.png                     optional floor shadow (frame sized)
  viewer.html                    browse everything in a browser

Run: python generate_characters.py
Add or edit entries in LOOKS to make new characters.
"""
import json
import math
import os
import shutil
from PIL import Image, ImageChops, ImageDraw, ImageFont

W, H = 48, 72          # frame size
OX, OY = 8, 22         # where the character's local (0, 0) sits in the frame
SCALE = 4
HERE = os.path.dirname(os.path.abspath(__file__))
LO, HI = -40, 120      # "whole part" bounds for shading rectangles

OUT = (28, 18, 30, 255)
CLEAR = (0, 0, 0, 0)

SKIN = {
    "light": ((248, 212, 182), (222, 172, 140)),
    "fair": ((242, 194, 152), (212, 152, 116)),
    "tan": ((216, 162, 114), (182, 126, 86)),
    "brown": ((166, 110, 72), (128, 80, 50)),
    "dark": ((112, 72, 48), (84, 52, 34)),
}

BASE = {
    "eye": (28, 18, 30), "mouth": (160, 64, 64), "mouth_in": (90, 30, 40), "tooth": (250, 250, 250),
    "inner": (246, 244, 236), "inner_s": (204, 200, 194), "accent": (255, 255, 255),
    "pants": (56, 66, 116), "pants_s": (38, 44, 84),
    "shoe": (250, 250, 250), "shoe_s": (196, 196, 206), "sole": (200, 70, 60),
    "rod": (120, 80, 48), "metal": (190, 196, 206), "frame": (30, 30, 40), "gold": (250, 206, 60),
}

LOOKS = {
    "kai": dict(skin="fair", hair="spiky", top="jacket", legs="pants", shoes="sneaker", colors=dict(
        hair=(70, 44, 32), hair_s=(46, 28, 22), hair_h=(110, 74, 50),
        top=(244, 196, 48), top_s=(204, 146, 28), top_h=(255, 232, 120))),
    "mia": dict(skin="light", hair="long", top="dress", legs="skin", shoes="flat", sleeve=0.0, lashes=True, colors=dict(
        hair=(250, 214, 110), hair_s=(214, 168, 70), hair_h=(255, 240, 170),
        top=(240, 120, 170), top_s=(204, 84, 136), top_h=(255, 170, 206), accent=(255, 255, 255),
        shoe=(220, 70, 120), shoe_s=(170, 40, 90), sole=(120, 30, 60))),
    "dre": dict(skin="dark", hair="afro", top="hoodie", legs="pants", shoes="sneaker", colors=dict(
        hair=(34, 26, 24), hair_s=(20, 14, 14), hair_h=(70, 56, 50),
        top=(70, 170, 90), top_s=(44, 124, 64), top_h=(130, 210, 140), inner=(250, 250, 250),
        pants=(120, 124, 134), pants_s=(88, 92, 102), sole=(60, 160, 80))),
    "noah": dict(skin="light", hair="buzz", hat="beanie", top="flannel", legs="pants", shoes="boot", glasses=True, colors=dict(
        hair=(150, 96, 56), hair_s=(116, 70, 40), hair_h=(180, 126, 80),
        hat=(240, 130, 40), hat_s=(196, 96, 26), hat_h=(255, 176, 96),
        top=(200, 56, 56), top_s=(140, 34, 40), top_h=(236, 104, 96), inner=(240, 236, 220),
        pants=(206, 186, 140), pants_s=(168, 148, 106),
        shoe=(120, 80, 50), shoe_s=(90, 58, 36), sole=(60, 40, 28))),
    "zed": dict(skin="light", hair="mohawk", top="leather", legs="pants", shoes="boot", earring=True, colors=dict(
        hair=(250, 80, 170), hair_s=(200, 40, 130), hair_h=(255, 150, 210),
        top=(48, 48, 58), top_s=(28, 28, 36), top_h=(100, 100, 118), inner=(200, 40, 50),
        pants=(60, 64, 80), pants_s=(40, 42, 56),
        shoe=(36, 36, 42), shoe_s=(24, 24, 28), sole=(20, 20, 24))),
    "victor": dict(skin="brown", hair="slick", top="suit", legs="pants", shoes="flat", beard=True, colors=dict(
        hair=(40, 36, 40), hair_s=(24, 22, 26), hair_h=(96, 96, 104),
        top=(44, 56, 96), top_s=(30, 38, 68), top_h=(78, 94, 144), inner=(246, 246, 246), accent=(200, 40, 50),
        pants=(40, 50, 86), pants_s=(28, 34, 62),
        shoe=(30, 26, 26), shoe_s=(20, 18, 18), sole=(20, 18, 18))),
    "sky": dict(skin="tan", hair="ponytail", hat="cap", top="tee", legs="shorts", shoes="sneaker", sleeve=0.4, colors=dict(
        hair=(200, 80, 40), hair_s=(160, 54, 26), hair_h=(236, 130, 70),
        hat=(50, 110, 220), hat_s=(30, 74, 170), hat_h=(110, 160, 250),
        top=(250, 250, 250), top_s=(206, 206, 214), top_h=(255, 255, 255), accent=(50, 110, 220),
        pants=(50, 110, 220), pants_s=(30, 74, 170))),
    "luna": dict(skin="fair", hair="bob", top="overalls", legs="pants", shoes="sneaker", sleeve=0.4, colors=dict(
        hair=(150, 90, 220), hair_s=(110, 60, 180), hair_h=(200, 150, 255),
        top=(250, 220, 80), top_s=(220, 180, 40), top_h=(255, 240, 150),
        inner=(90, 130, 200), inner_s=(64, 98, 160), accent=(250, 200, 60),
        pants=(90, 130, 200), pants_s=(64, 98, 160),
        shoe=(230, 60, 60), shoe_s=(180, 40, 40), sole=(250, 250, 250))),
}

P = {}   # active palette
L = {}   # active look


def mix(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def set_look(name):
    global P, L
    L = LOOKS[name]
    skin, skin_s = SKIN[L["skin"]]
    P = dict(BASE, skin=skin, skin_s=skin_s, blush=mix(skin, (240, 110, 110), 0.35))
    if L["skin"] in ("brown", "dark"):
        P.update(mouth=(96, 36, 36), mouth_in=(60, 20, 24))
    P.update(L["colors"])


def c(name):
    return P[name] + (255,)


# ---------------------------------------------------------------- drawing core
class ODraw:
    """ImageDraw that works in character-local coordinates."""

    def __init__(self, img, dx, dy):
        self.d = ImageDraw.Draw(img)
        self.dx, self.dy = dx, dy

    def _xy(self, xy):
        if isinstance(xy[0], (tuple, list)):
            return [(x + self.dx, y + self.dy) for x, y in xy]
        return [v + (self.dx if i % 2 == 0 else self.dy) for i, v in enumerate(xy)]

    def rectangle(self, xy, **k): self.d.rectangle(self._xy(xy), **k)
    def rounded_rectangle(self, xy, **k): self.d.rounded_rectangle(self._xy(xy), **k)
    def ellipse(self, xy, **k): self.d.ellipse(self._xy(xy), **k)
    def polygon(self, xy, **k): self.d.polygon(self._xy(xy), **k)
    def line(self, xy, **k): self.d.line(self._xy(xy), **k)
    def point(self, xy, **k): self.d.point(self._xy(xy), **k)


def outline_img(img, col=OUT):
    w, h = img.size
    a = img.getchannel("A").point(lambda v: 255 if v else 0)
    dil = a
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):  # 4-neighbour = rounded corners
        moved = Image.new("L", (w, h), 0)
        moved.paste(a, (dx, dy))  # paste clips instead of wrapping
        dil = ImageChops.lighter(dil, moved)
    out = Image.new("RGBA", (w, h), CLEAR)
    out.paste(Image.new("RGBA", (w, h), col), (0, 0), ImageChops.subtract(dil, a))
    out.alpha_composite(img)
    return out


class Part:
    """One body part / prop on its own layer; gets its own 1px outline."""

    def __init__(self, dx=0, outline=True):
        self.img = Image.new("RGBA", (W, H), CLEAR)
        self.off = (OX + dx, OY)
        self.d = ODraw(self.img, *self.off)
        self.outline = outline

    def shade(self, fn):
        """Draw with fn, but only where this part already has pixels."""
        tmp = Image.new("RGBA", (W, H), CLEAR)
        fn(ODraw(tmp, *self.off))
        mask = ImageChops.multiply(self.img.getchannel("A"), tmp.getchannel("A"))
        self.img.paste(tmp, (0, 0), mask)

    def outlined(self):
        return outline_img(self.img) if self.outline else self.img


def stamp(d, pts, w, colfn):
    """Pixel-clean thick polyline built from stamped squares; colfn(t) picks colour along it (None = skip)."""
    segs = list(zip(pts, pts[1:]))
    lens = [max(abs(b[0] - a[0]), abs(b[1] - a[1]), 1) for a, b in segs]
    total, acc = sum(lens), 0
    for (a, b), n in zip(segs, lens):
        for i in range(n + 1):
            x = round(a[0] + (b[0] - a[0]) * i / n)
            y = round(a[1] + (b[1] - a[1]) * i / n)
            col = colfn((acc + i) / total)
            if col is None:  # None = leave this stretch undrawn
                continue
            o = w // 2
            d.rectangle((x - o, y - o, x - o + w - 1, y - o + w - 1), fill=col)
        acc += n


def add(p, q):
    return (p[0] + q[0], p[1] + q[1])


def pts_b(pts, b):
    return [(x, y + b) for x, y in pts]


# ---------------------------------------------------------------- body parts
def shoe(p, ankle):
    ax, ay = ankle
    style = L.get("shoes", "sneaker")
    if style == "boot":
        p.d.rectangle((ax - 2, ay - 2, ax + 3, ay + 2), fill=c("shoe"))
        p.d.point((ax + 3, ay - 2), fill=CLEAR)
        p.d.line((ax - 2, ay + 2, ax + 3, ay + 2), fill=c("sole"))
        p.d.line((ax - 1, ay - 2, ax - 1, ay), fill=c("shoe_s"))
    elif style == "flat":
        p.d.rectangle((ax - 2, ay + 1, ax + 3, ay + 2), fill=c("shoe"))
        p.d.point((ax + 3, ay + 1), fill=CLEAR)
        p.d.line((ax - 2, ay + 2, ax + 3, ay + 2), fill=c("sole"))
    else:
        p.d.rectangle((ax - 2, ay, ax + 3, ay + 2), fill=c("shoe"))
        p.d.point([(ax - 2, ay), (ax + 3, ay)], fill=CLEAR)
        p.d.line((ax - 2, ay + 2, ax + 3, ay + 2), fill=c("sole"))
        p.d.point((ax - 1, ay), fill=c("shoe_s"))


def leg(hip, ankle, knee=None):
    p = Part()
    pts = [hip, knee, ankle] if knee else [hip, ankle]
    cut = {"pants": 2, "shorts": 0.45, "skin": -1}[L.get("legs", "pants")]
    stamp(p.d, pts, 4, lambda t: c("pants") if t <= cut else c("skin"))
    p.shade(lambda d: stamp(d, [add(q, (-1, 0)) for q in pts], 2,
                            lambda t: c("pants_s") if t <= cut else c("skin_s")))
    shoe(p, ankle)
    return p


def arm(shoulder, hand, elbow=None):
    p = Part()
    sleeve = L.get("sleeve", 1.0)
    (sx, sy), (hx, hy) = elbow or shoulder, hand
    n = max(abs(hx - sx), abs(hy - sy), 1)
    end = (round(sx + (hx - sx) * (n - 2) / n), round(sy + (hy - sy) * (n - 2) / n))  # stop before the hand
    pts = [shoulder, elbow, end] if elbow else [shoulder, end]
    if sleeve >= 1:
        stamp(p.d, pts, 3, lambda t: c("top"))
        p.shade(lambda d: stamp(d, [add(q, (-1, 0)) for q in pts], 1, lambda t: c("top_s")))
    else:
        stamp(p.d, pts, 3, lambda t: c("skin"))
        p.shade(lambda d: stamp(d, [add(q, (-1, 0)) for q in pts], 1, lambda t: c("skin_s")))
        if sleeve > 0:  # short sleeve is 1px wider than the bare arm
            stamp(p.d, pts, 4, lambda t: c("top") if t <= sleeve else None)
            p.shade(lambda d: stamp(d, [add(q, (-1, 0)) for q in pts], 1,
                                    lambda t: c("top_s") if t <= sleeve else None))
    p.d.rectangle((hx - 1, hy - 1, hx + 1, hy + 1), fill=c("skin"))
    p.d.point((hx - 1, hy + 1), fill=c("skin_s"))
    return p


def torso(b, back, dx):
    p = Part(dx)
    style = L["top"]
    if back:
        poly = [(11, 21 + b), (21, 22 + b), (21, 35 + b), (11, 34 + b)]
    else:
        poly = [(11, 22 + b), (21, 21 + b), (21, 34 + b), (11, 35 + b)]
    p.d.polygon(poly, fill=c("top"))
    if style == "hoodie" and back:
        p.d.rounded_rectangle((12, 18 + b, 20, 24 + b), radius=2, fill=c("top"))
    if style == "overalls":  # denim bib / back panel
        if back:
            p.shade(lambda d: d.rectangle((LO, 28 + b, HI, HI), fill=c("inner")))
            p.shade(lambda d: d.line((13, 22 + b, 19, 28 + b), fill=c("inner"), width=1))
            p.shade(lambda d: d.line((19, 22 + b, 13, 28 + b), fill=c("inner"), width=1))
        else:
            p.shade(lambda d: d.rectangle((13, 26 + b, 20, HI), fill=c("inner")))
            p.shade(lambda d: d.rectangle((LO, 32 + b, HI, HI), fill=c("inner")))
            p.shade(lambda d: d.line((14, 21 + b, 14, 26 + b), fill=c("inner")))
            p.shade(lambda d: d.line((19, 21 + b, 19, 26 + b), fill=c("inner")))
            p.shade(lambda d: d.point([(14, 26 + b), (19, 26 + b)], fill=c("accent")))
        p.shade(lambda d: d.rectangle((LO, LO, 13, HI), fill=c("top_s")))
        p.shade(lambda d: d.rectangle((LO, 28 + b if back else 32 + b, 12, HI), fill=c("inner_s")))
        return p
    p.shade(lambda d: d.rectangle((LO, LO, 13, HI), fill=c("top_s")))
    p.shade(lambda d: d.rectangle((LO, 33 + b, HI, HI), fill=c("top_s")))  # hem

    if style == "jacket":
        if back:
            p.shade(lambda d: d.rectangle((13, 21 + b, 19, 22 + b), fill=c("top_h")))
            p.shade(lambda d: d.line((16, 24 + b, 16, 32 + b), fill=c("top_s")))
        else:
            p.shade(lambda d: d.rectangle((16, 21 + b, 18, 34 + b), fill=c("inner")))
            p.shade(lambda d: d.line((16, 21 + b, 16, 34 + b), fill=c("inner_s")))
            p.shade(lambda d: d.point([(15, 22 + b), (19, 22 + b)], fill=c("top_h")))
            p.shade(lambda d: d.line((20, 23 + b, 20, 30 + b), fill=c("top_h")))
    elif style == "hoodie":
        if back:
            p.shade(lambda d: d.line((13, 24 + b, 19, 24 + b), fill=c("top_s")))
            p.shade(lambda d: d.line((14, 19 + b, 18, 19 + b), fill=c("top_h")))
        else:
            p.shade(lambda d: d.rectangle((13, 29 + b, 19, 32 + b), fill=c("top_s")))
            p.shade(lambda d: d.line((13, 29 + b, 19, 29 + b), fill=c("top_h")))
            p.shade(lambda d: d.line((13, 22 + b, 19, 22 + b), fill=c("top_h")))
            p.shade(lambda d: d.point([(15, 23 + b), (15, 24 + b), (18, 23 + b), (18, 25 + b)], fill=c("inner")))
    elif style == "tee":
        if not back:
            p.shade(lambda d: d.line((14, 22 + b, 19, 22 + b), fill=c("top_s")))
            p.shade(lambda d: d.point([(18, 26 + b), (17, 27 + b), (18, 27 + b), (19, 27 + b), (18, 28 + b)],
                                      fill=c("accent")))  # star logo
    elif style == "dress":
        if back:
            p.shade(lambda d: d.line((16, 22 + b, 16, 30 + b), fill=c("top_s")))
        else:
            p.shade(lambda d: d.line((15, 22 + b, 18, 22 + b), fill=c("skin")))
            p.shade(lambda d: d.line((17, 24 + b, 20, 24 + b), fill=c("top_h")))
        p.shade(lambda d: d.line((LO, 30 + b, HI, 30 + b), fill=c("accent")))  # belt
    elif style == "suit":
        if back:
            p.shade(lambda d: d.line((16, 30 + b, 16, 35 + b), fill=c("top_s")))
            p.shade(lambda d: d.line((13, 21 + b, 19, 21 + b), fill=c("top_h")))
        else:
            p.shade(lambda d: d.polygon([(14, 21 + b), (20, 21 + b), (17, 30 + b)], fill=c("inner")))
            p.shade(lambda d: d.line((17, 22 + b, 17, 29 + b), fill=c("accent")))
            p.shade(lambda d: d.point([(16, 27 + b), (18, 27 + b), (16, 28 + b), (18, 28 + b)], fill=c("accent")))
            p.shade(lambda d: d.line((14, 22 + b, 16, 28 + b), fill=c("top_h")))
            p.shade(lambda d: d.line((20, 22 + b, 18, 28 + b), fill=c("top_h")))
            p.shade(lambda d: d.point([(17, 31 + b), (17, 33 + b)], fill=c("top_s")))
    elif style == "flannel":
        dark = mix(P["top_s"], (0, 0, 0), 0.35) + (255,)
        for x in (12, 15, 18, 21):
            p.shade(lambda d, x=x: d.line((x, LO, x, HI), fill=c("top_s")))
        for y in (24, 27, 30, 33):
            p.shade(lambda d, y=y: d.line((LO, y + b, HI, y + b), fill=c("top_s")))
            p.shade(lambda d, y=y: d.point([(x, y + b) for x in (12, 15, 18, 21)], fill=dark))
        if not back:
            p.shade(lambda d: d.point([(17, 23 + b), (17, 26 + b), (17, 29 + b), (17, 32 + b)], fill=c("inner")))
            p.shade(lambda d: d.line((15, 22 + b, 18, 22 + b), fill=c("inner")))
    elif style == "leather":
        if back:
            p.shade(lambda d: d.line((13, 23 + b, 13, 31 + b), fill=c("top_h")))
            p.shade(lambda d: d.point([(12, 22 + b), (20, 23 + b)], fill=c("metal")))
        else:
            p.shade(lambda d: d.line((15, 22 + b, 18, 34 + b), fill=c("metal")))
            p.shade(lambda d: d.line((13, 21 + b, 15, 25 + b), fill=c("top_h")))
            p.shade(lambda d: d.line((20, 21 + b, 19, 25 + b), fill=c("top_h")))
            p.shade(lambda d: d.point([(16, 22 + b), (17, 22 + b)], fill=c("inner")))  # red tee peeking
            p.shade(lambda d: d.point([(12, 29 + b), (13, 29 + b)], fill=c("metal")))
    return p


def skirt(b, dx):
    p = Part(dx)
    p.d.polygon(pts_b([(11, 30), (21, 30), (24, 39), (8, 39)], b), fill=c("top"))
    p.shade(lambda d: d.rectangle((LO, LO, 11, HI), fill=c("top_s")))
    p.shade(lambda d: d.line((LO, 39 + b, HI, 39 + b), fill=c("top_s")))
    p.shade(lambda d: d.line((14, 33 + b, 13, 38 + b), fill=c("top_s")))
    p.shade(lambda d: d.line((19, 33 + b, 20, 38 + b), fill=c("top_h")))
    p.shade(lambda d: d.line((LO, 30 + b, HI, 30 + b), fill=c("accent")))
    return p


def neck(b, dx):
    p = Part(dx)
    p.d.rectangle((14, 19 + b, 18, 22 + b), fill=c("skin_s"))
    return p


def head(b, back, eyes, mouth, dx):
    p = Part(dx)
    p.d.rounded_rectangle((8, 6 + b, 24, 21 + b), radius=5, fill=c("skin"))
    p.shade(lambda d: d.rectangle((LO, LO, 9, HI), fill=c("skin_s")))
    p.shade(lambda d: d.rectangle((LO, 21 + b, 13, HI), fill=c("skin_s")))
    stubble = mix(P["skin_s"], P["hair_s"], 0.45) + (255,)
    if back:
        if L["hair"] == "mohawk":
            p.shade(lambda d: d.point([(x, y + b) for x in range(8, 25) for y in range(6, 19)
                                       if (x + y) % 2 == 0 and not 13 <= x <= 18], fill=stubble))
        p.d.point([(21, 14 + b), (21, 15 + b), (22, 15 + b)], fill=c("skin_s"))  # ear
        if L.get("beard"):
            p.shade(lambda d: d.rectangle((21, 16 + b, HI, HI), fill=c("hair")))
        if L.get("glasses"):
            p.d.line((22, 13 + b, 24, 13 + b), fill=c("frame"))
        if L.get("earring"):
            p.d.point((22, 17 + b), fill=c("gold"))
        return p

    if L["hair"] == "mohawk":
        p.shade(lambda d: d.point([(x, y + b) for x in range(8, 14) for y in range(6, 15) if (x + y) % 2 == 0],
                                  fill=stubble))
    p.d.point([(12, 14 + b), (12, 15 + b), (13, 15 + b)], fill=c("skin_s"))  # ear
    if L.get("earring"):
        p.d.point((12, 17 + b), fill=c("gold"))
    if L.get("beard"):
        p.shade(lambda d: d.polygon(pts_b([(12, 15), (13, 19), (16, 21), (22, 21), (24, 18), (24, 15),
                                            (22, 17), (21, 19), (17, 19), (14, 17)], b), fill=c("hair")))
        p.d.line((17, 17 + b, 21, 17 + b), fill=c("hair"))  # moustache
    else:
        p.d.point([(15, 17 + b), (23, 17 + b)], fill=c("blush"))

    e = {True: "open", False: "closed"}.get(eyes, eyes)
    if e in ("open", "wink"):
        p.d.rectangle((17, 14 + b, 17, 15 + b), fill=c("eye"))
    if e == "open":
        p.d.rectangle((21, 14 + b, 21, 15 + b), fill=c("eye"))
    if e == "wide":
        p.d.rectangle((17, 13 + b, 17, 15 + b), fill=c("eye"))
        p.d.rectangle((21, 13 + b, 21, 15 + b), fill=c("eye"))
    if e == "closed":
        p.d.line((16, 15 + b, 17, 15 + b), fill=c("eye"))
        p.d.line((21, 15 + b, 22, 15 + b), fill=c("eye"))
    if e == "happy":
        p.d.point([(16, 15 + b), (17, 14 + b), (18, 15 + b)], fill=c("eye"))
    if e in ("happy", "wink"):
        p.d.point([(20, 15 + b), (21, 14 + b), (22, 15 + b)], fill=c("eye"))
    if L.get("lashes") and e in ("open", "wide", "wink"):
        p.d.point([(18, 13 + b)] + ([(22, 13 + b)] if e != "wink" else []), fill=c("eye"))

    m = {True: "open", False: "smile"}.get(mouth, mouth)
    if m == "smile":
        p.d.line((18, 18 + b, 20, 18 + b), fill=c("mouth"))
        p.d.point((21, 17 + b), fill=c("mouth"))
    elif m == "open":
        p.d.rectangle((18, 17 + b, 20, 18 + b), fill=c("mouth_in"))
        p.d.line((18, 17 + b, 20, 17 + b), fill=c("mouth"))
    elif m == "laugh":
        p.d.rectangle((17, 17 + b, 21, 19 + b), fill=c("mouth_in"))
        p.d.line((18, 17 + b, 20, 17 + b), fill=c("tooth"))
    elif m == "kiss":
        p.d.rectangle((19, 17 + b, 20, 18 + b), fill=c("mouth"))
    elif m == "o":
        p.d.rectangle((19, 17 + b, 20, 18 + b), fill=c("mouth_in"))

    if L.get("glasses"):
        p.d.rectangle((15, 13 + b, 18, 16 + b), outline=c("frame"))
        p.d.rectangle((20, 13 + b, 23, 16 + b), outline=c("frame"))
        p.d.point((19, 14 + b), fill=c("frame"))
        p.d.line((13, 14 + b, 14, 14 + b), fill=c("frame"))
    return p


# ---------------------------------------------------------------- hair & hats
def hair(b, back, dx):
    """Returns (behind, main). behind is drawn behind the body (front views only)."""
    style = L["hair"]
    p, behind = Part(dx), None
    hair_c, hs, hh = c("hair"), c("hair_s"), c("hair_h")
    poly = lambda pts, col=hair_c, part=p: part.d.polygon(pts_b(pts, b), fill=col)
    rrect = lambda x0, y0, x1, y1, r, part=p: part.d.rounded_rectangle((x0, y0 + b, x1, y1 + b), radius=r, fill=hair_c)
    rect = lambda x0, y0, x1, y1, part=p: part.d.rectangle((x0, y0 + b, x1, y1 + b), fill=hair_c)
    back_cut = lambda: (rrect(7, 4, 21, 19, 4), rect(20, 4, 25, 11), poly([(20, 11), (25, 11), (20, 16)]))

    if style == "spiky":
        poly([(7, 9), (9, 2), (12, 6), (15, 0), (18, 5), (21, 1), (23, 6), (26, 5), (25, 10)])
        if back:
            back_cut()
            p.shade(lambda d: d.rectangle((LO, 15 + b, HI, HI), fill=hs))
        else:
            rrect(7, 4, 25, 10, 4)
            rrect(7, 5, 13, 16, 3)
            for tri in ([(13, 10), (17, 10), (14, 12)], [(17, 10), (21, 10), (18, 11)], [(21, 10), (25, 10), (24, 12)]):
                poly(tri)
            p.shade(lambda d: d.rectangle((7, 12 + b, 10, HI), fill=hs))
        p.shade(lambda d: d.line((16, 3 + b, 21, 3 + b), fill=hh))
        p.shade(lambda d: d.line((17, 5 + b, 22, 5 + b), fill=hh))

    elif style == "long":
        if back:
            back_cut()
            rrect(8, 14, 23, 31, 3)
            p.shade(lambda d: d.rectangle((LO, 27 + b, HI, HI), fill=hs))
            p.shade(lambda d: d.line((12, 8 + b, 12, 26 + b), fill=hh))
            p.shade(lambda d: d.line((19, 16 + b, 19, 28 + b), fill=hs))
        else:
            behind = Part(dx)
            rrect(6, 6, 14, 31, 3, part=behind)
            rrect(20, 10, 26, 28, 3, part=behind)
            behind.shade(lambda d: d.rectangle((LO, 26 + b, HI, HI), fill=hs))
            behind.shade(lambda d: d.rectangle((LO, LO, 8, HI), fill=hs))
            rrect(7, 4, 25, 11, 4)
            rrect(7, 5, 13, 19, 3)
            poly([(13, 9), (25, 8), (25, 12), (22, 11), (18, 12), (15, 11)])
            rect(23, 9, 25, 18)
            p.shade(lambda d: d.line((14, 5 + b, 21, 5 + b), fill=hh))
            p.shade(lambda d: d.line((9, 9 + b, 9, 17 + b), fill=hh))
        p.shade(lambda d: d.rectangle((LO, LO, 8, HI), fill=hs))

    elif style == "bob":
        if back:
            rrect(7, 4, 25, 19, 4)
            p.shade(lambda d: d.rectangle((LO, 17 + b, HI, HI), fill=hs))
            p.shade(lambda d: d.line((11, 7 + b, 19, 6 + b), fill=hh))
        else:
            rrect(7, 4, 25, 11, 4)
            rrect(7, 5, 13, 19, 3)
            rect(13, 8, 25, 12)
            rect(23, 10, 25, 19)
            p.shade(lambda d: d.rectangle((LO, 18 + b, HI, HI), fill=hs))
            p.shade(lambda d: d.line((12, 5 + b, 20, 5 + b), fill=hh))
            p.shade(lambda d: d.line((15, 11 + b, 23, 11 + b), fill=hs))
        p.shade(lambda d: d.rectangle((LO, LO, 8, HI), fill=hs))

    elif style == "afro":
        p.d.ellipse((4, -3 + b, 28, 17 + b), fill=hair_c)
        if back:
            rrect(9, 10, 22, 19, 3)
        else:  # cut the face out of the puff
            p.d.polygon(pts_b([(14, 11), (18, 10), (22, 11), (26, 10), (30, 10), (30, 24), (14, 24)], b), fill=CLEAR)
        p.shade(lambda d: d.point([(x, y + b) for x in range(5, 28, 3) for y in range(-2, 17, 3)
                                   if (x // 3 + y // 3) % 2 == 0], fill=hh))
        p.shade(lambda d: d.rectangle((LO, LO, 8, HI), fill=hs))
        p.shade(lambda d: d.rectangle((LO, 14 + b, HI, HI), fill=hs))

    elif style == "buzz":
        if back:
            rrect(8, 5, 22, 18, 5)
            rect(20, 5, 24, 11)
            p.shade(lambda d: d.rectangle((LO, 14 + b, HI, HI), fill=hs))
        else:
            rrect(8, 5, 24, 10, 4)
            rrect(8, 6, 12, 15, 2)
            p.shade(lambda d: d.rectangle((LO, 10 + b, 12, HI), fill=hs))
        p.shade(lambda d: d.line((13, 6 + b, 20, 6 + b), fill=hh))

    elif style == "mohawk":
        poly([(11, 9), (11, 4), (13, -2), (14, 3), (16, -4), (18, 2), (20, -3), (21, 3), (23, 1), (24, 7), (22, 9)])
        if back:
            rect(13, 5, 18, 18)
            p.shade(lambda d: d.rectangle((LO, 14 + b, HI, HI), fill=hs))
        p.shade(lambda d: d.rectangle((LO, LO, 13, HI), fill=hs))
        p.shade(lambda d: d.line((16, 0 + b, 17, 6 + b), fill=hh))
        p.shade(lambda d: d.line((20, 0 + b, 21, 5 + b), fill=hh))

    elif style == "ponytail":
        if back:
            back_cut()
            rrect(13, 14, 19, 30, 2)
            p.shade(lambda d: d.rectangle((LO, 24 + b, HI, HI), fill=hs))
            p.d.rectangle((13, 14 + b, 19, 16 + b), fill=c("accent"))
        else:
            behind = Part(dx)
            poly([(7, 7), (10, 8), (9, 14), (7, 22), (5, 26), (3, 25), (4, 17), (5, 10)], part=behind)
            behind.shade(lambda d: d.rectangle((LO, 18 + b, HI, HI), fill=hs))
            rrect(7, 4, 25, 11, 4)
            rrect(7, 5, 13, 16, 3)
            poly([(18, 9), (25, 8), (25, 12), (22, 11)])
            p.d.rectangle((6, 7 + b, 8, 9 + b), fill=c("accent"))
            p.shade(lambda d: d.line((12, 5 + b, 20, 5 + b), fill=hh))
        p.shade(lambda d: d.rectangle((LO, LO, 8, HI), fill=hs))

    elif style == "slick":
        if back:
            back_cut()
            p.shade(lambda d: d.line((10, 8 + b, 20, 7 + b), fill=hh))
            p.shade(lambda d: d.line((10, 12 + b, 20, 11 + b), fill=hh))
            p.shade(lambda d: d.rectangle((LO, 16 + b, HI, HI), fill=hs))
        else:
            rrect(7, 4, 25, 10, 4)
            rrect(7, 5, 12, 15, 3)
            poly([(13, 9), (16, 4), (22, 2), (26, 5), (26, 9)])
            p.shade(lambda d: d.line((15, 6 + b, 21, 4 + b), fill=hh))
            p.shade(lambda d: d.line((16, 8 + b, 23, 6 + b), fill=hh))
        p.shade(lambda d: d.rectangle((LO, LO, 8, HI), fill=hs))
    return behind, p


def hat(b, back, dx):
    style = L.get("hat")
    if not style:
        return None
    p = Part(dx)
    col, cs, ch = c("hat"), c("hat_s"), c("hat_h")
    if style == "cap":
        p.d.rounded_rectangle((7, 3 + b, 24 if not back else 25, 10 + b), radius=4, fill=col)
        if back:
            p.d.polygon(pts_b([(22, 7), (28, 6), (28, 8), (22, 9)], b), fill=cs)
            p.d.rectangle((13, 9 + b, 17, 10 + b), fill=c("hair"))  # strap gap
        else:
            p.d.polygon(pts_b([(19, 8), (29, 8), (29, 10), (19, 11)], b), fill=cs)
            p.shade(lambda d: d.point((20, 6 + b), fill=ch))
        p.shade(lambda d: d.rectangle((LO, LO, 9, HI), fill=cs))
        p.shade(lambda d: d.line((12, 4 + b, 18, 4 + b), fill=ch))
        p.d.point((15, 2 + b), fill=cs)
    elif style == "beanie":
        p.d.rounded_rectangle((7, 1 + b, 25, 11 + b), radius=5, fill=col)
        p.d.rectangle((7, 8 + b, 25, 11 + b), fill=cs)
        p.d.point([(x, 9 + b) for x in range(8, 25, 2)], fill=col)
        p.d.ellipse((13, -3 + b, 18, 2 + b), fill=ch)
        p.shade(lambda d: d.rectangle((LO, LO, 9, 7 + b), fill=cs))
        p.shade(lambda d: d.line((12, 3 + b, 19, 3 + b), fill=ch))
    return p


# ---------------------------------------------------------------- props
def prop_part(kind, args):
    """Returns (z, Part). z: behind | pre | top."""
    if kind == "rod":
        hand, tip, z = args
        p = Part()
        stamp(p.d, [hand, tip], 1, lambda t: c("rod"))
        p.d.rectangle((hand[0], hand[1] + 1, hand[0] + 1, hand[1] + 2), fill=c("metal"))  # reel
        return z, p
    if kind == "line":
        a, b2, z = args
        p = Part(outline=False)
        stamp(p.d, [a, b2], 1, lambda t: (240, 240, 240, 255))
        return z, p
    if kind == "bobber":
        (x, y), = args
        p = Part()
        p.d.rectangle((x, y, x + 1, y), fill=(220, 50, 50, 255))
        p.d.rectangle((x, y + 1, x + 1, y + 1), fill=(250, 250, 250, 255))
        return "top", p
    if kind == "fish":
        (x, y), flap = args
        p = Part()
        p.d.ellipse((x - 1, y + 1, x + 2, y + 7), fill=(110, 160, 210, 255))
        p.d.line((x + 1, y + 2, x + 1, y + 6), fill=(200, 226, 242, 255))
        p.d.polygon([(x, y + 7), (x - 2 + flap, y + 10), (x + 3 + flap, y + 10), (x + 1, y + 7)], fill=(80, 124, 180, 255))
        p.d.point((x, y + 3), fill=OUT)
        return "top", p
    if kind == "cup":
        (x, y), = args
        p = Part()
        p.d.rectangle((x - 1, y - 5, x + 2, y - 1), fill=(220, 60, 60, 255))
        p.d.line((x - 1, y - 3, x + 2, y - 3), fill=(250, 250, 250, 255))
        p.d.line((x - 1, y - 5, x + 2, y - 5), fill=(250, 130, 120, 255))
        return "top", p
    if kind == "sign":
        (x, y), = args
        p = Part()
        p.d.line((x, y, x, y - 15), fill=c("rod"))
        p.d.rectangle((x - 6, y - 24, x + 6, y - 15), fill=(250, 240, 210, 255))
        p.d.line((x - 6, y - 15, x + 6, y - 15), fill=(220, 200, 160, 255))
        heart = [".X.X.", "XXXXX", ".XXX.", "..X.."]
        p.d.point([(x - 2 + i, y - 22 + j) for j, row in enumerate(heart) for i, ch_ in enumerate(row) if ch_ == "X"],
                  fill=(230, 50, 70, 255))
        return "pre", p
    raise ValueError(kind)


# ---------------------------------------------------------------- overlays (never mirrored)
FONT = {
    "H": ["X.X", "X.X", "XXX", "X.X", "X.X"],
    "A": [".X.", "X.X", "XXX", "X.X", "X.X"],
    "i": ["X", ".", "X", "X", "X"],
    "!": ["X", "X", "X", ".", "X"],
}


def text_img(s, col):
    w = sum(len(FONT[ch][0]) for ch in s) + len(s) - 1
    img = Image.new("RGBA", (w, 5), CLEAR)
    x = 0
    for ch in s:
        for y, row in enumerate(FONT[ch]):
            for i, v in enumerate(row):
                if v == "X":
                    img.putpixel((x + i, y), col)
        x += len(FONT[ch][0]) + 1
    return img


def glyph(rows, cols):
    img = Image.new("RGBA", (len(rows[0]) + 2, len(rows) + 2), CLEAR)
    for y, row in enumerate(rows):
        for x, v in enumerate(row):
            if v in cols:
                img.putpixel((x + 1, y + 1), cols[v])
    return outline_img(img)


def overlay_img(kind, mirror):
    if kind == "bubble":
        t = text_img("Hi!", OUT)
        w, h = t.width + 8, 11
        img = Image.new("RGBA", (w + 2, h + 5), CLEAR)
        d = ImageDraw.Draw(img)
        d.rounded_rectangle((1, 1, w, h - 1), radius=3, fill=(255, 255, 255, 255))
        d.polygon([(5, h - 1), (9, h - 1), (5, h + 2)], fill=(255, 255, 255, 255))
        img = outline_img(img)
        if mirror:  # tail flips to point back at the head, text stays readable
            img = img.transpose(Image.FLIP_LEFT_RIGHT)
        img.alpha_composite(t, ((img.width - t.width) // 2, 3))
        return img
    if kind == "excl":
        return glyph(["hh", "XX", "XX", "XX", "..", "XX"], {"X": (255, 214, 60, 255), "h": (255, 245, 170, 255)})
    if kind == "heart":
        return glyph([".XX.XX.", "XhXXXXX", "XXXXXXX", ".XXXXX.", "..XXX..", "...X..."],
                     {"X": (236, 60, 90, 255), "h": (255, 170, 190, 255)})
    if kind == "z":
        return glyph(["XXX", ".X.", "XXX"], {"X": (220, 235, 255, 255)})
    if kind == "Z":
        return glyph(["XXXX", "..X.", ".X..", "X...", "XXXX"], {"X": (220, 235, 255, 255)})
    if kind == "ha":
        return outline_img(text_img("HA", (255, 255, 255, 255)).crop((-1, -1, 8, 6)))
    raise ValueError(kind)


# ---------------------------------------------------------------- posing
def shift_args(args, dx, dy):
    return [add(a, (dx, dy)) if isinstance(a, tuple) and len(a) == 2 and all(isinstance(v, (int, float)) for v in a)
            else a for a in args]


def render(view, pose):
    """view: 'front' (SE) or 'back' (NE). Returns (frame, overlays)."""
    back = view == "back"
    b = pose.get("bob", 0)
    hb = b + pose.get("head", 0)
    ux = pose.get("ux", 0)
    fwd = (2, -1) if back else (2, 1)
    step = (1, -2) if back else (1, 2)  # exaggerated vertically so feet never stack
    hips = {"L": (13, 33 if not back else 32), "R": (18, 32 if not back else 33)}
    feet = {"L": 43 if not back else 42, "R": 42 if not back else 43}
    near, far = ("R", "L") if back else ("L", "R")

    legs = {}
    for s in "LR":
        hx, hy = hips[s]
        hip = (hx, hy + b)
        if pose.get("sit"):
            knee = (hx + (4 if s == "L" else 5), hy + b + fwd[1] * 2)
            legs[s] = leg(hip, (knee[0], knee[1] + 4), knee)
        else:
            ph = pose.get("legs", {}).get(s, 0)
            lift = 1 if pose.get("lift") == s else 0
            legs[s] = leg(hip, (hx + round(step[0] * ph), feet[s] + round(step[1] * ph) - lift))

    shoulders = {"L": (11 + ux, 23 + b), "R": (21 + ux, 23 + b)}
    arms_down, arms_up = {}, []
    for s in "LR":
        spec = pose.get("raise", {}).get(s)
        if spec is not None:
            if isinstance(spec[0], tuple):  # (hand, elbow) given explicitly
                hand, elbow = add(spec[0], (ux, b)), add(spec[1], (ux, b))
            else:  # elbow out to the side so the forearm clears the head
                hand, elbow = add(spec, (ux, b)), (5 + ux if s == "L" else 27 + ux, shoulders[s][1] - 2)
            arms_up.append(arm(shoulders[s], hand, elbow))
        else:
            sw = pose.get("arms", {}).get(s, 0)
            hand = add(shoulders[s], ((-1 if s == "L" else 1) + round(2 * sw), 8 - abs(round(sw))))
            arms_down[s] = arm(shoulders[s], hand)

    props = {"behind": [], "pre": [], "top": [], "line": []}
    for kind, *args in pose.get("props", []):
        z, part = prop_part(kind, shift_args(args, ux, b))
        props["line" if kind == "line" and z == "top" else z].append(part)

    hair_behind, hair_main = hair(hb, back, ux)
    order = list(props["behind"])
    if hair_behind:
        order.append(hair_behind)
    order += [legs[far], legs[near]]
    if far in arms_down:
        order.append(arms_down[far])
    order.append(torso(b, back, ux))
    if L["top"] == "dress":
        order.append(skirt(b, ux))
    if near in arms_down:
        order.append(arms_down[near])
    order += [neck(b, ux), head(hb, back, pose.get("eyes", "open"), pose.get("mouth", "smile"), ux), hair_main]
    h = hat(hb, back, ux)
    if h:
        order.append(h)
    order += props["pre"] + arms_up + props["top"] + props["line"]

    frame = Image.new("RGBA", (W, H), CLEAR)
    for part in order:
        frame.alpha_composite(part.outlined())
    if pose.get("shift"):
        moved = Image.new("RGBA", (W, H), CLEAR)
        moved.paste(frame, (0, pose["shift"]))
        frame = moved
    return frame, pose.get("ov", [])


def place_overlays(frame, overlays, mirror):
    for kind, (x, y) in overlays:
        g = overlay_img(kind, mirror)
        cx = OX + x
        if mirror:
            cx = W - cx - g.width
        frame.alpha_composite(g, (cx, OY + y))
    return frame


# ---------------------------------------------------------------- animations
def rod_pose(hand, elbow, tip, end, z="top", **extra):
    ps = {"raise": {"R": (hand, elbow)}, "props": [("rod", hand, tip, z), ("line", tip, end, z)]}
    ps.update(extra)
    return ps


def fishing(back):
    if back:  # water is ahead = up-right on screen
        ready, windup, cast = ((24, 26), (23, 25), (33, 8), (33, 15)), ((24, 20), (25, 25), (27, -8), (28, -2)), \
            ((27, 22), (25, 24), (36, 6), (36, -6))
        wait, bob_x, bob_ys = ((25, 24), (24, 25), (34, 8)), 35, [34, 35, 34, 37]
        pull, catch = ((24, 20), (25, 25), (32, 0), (36, 26)), ((24, 19), (25, 25), (30, -2))
        windup_z = "top"
    else:
        ready, windup, cast = ((24, 28), (23, 26), (33, 12), (33, 19)), ((24, 21), (25, 26), (14, -3), (12, 3)), \
            ((28, 25), (25, 25), (36, 16), (36, 6))
        wait, bob_x, bob_ys = ((26, 27), (24, 26), (34, 15)), 35, [40, 41, 40, 43]
        pull, catch = ((25, 23), (25, 26), (33, 3), (36, 30)), ((25, 22), (25, 26), (31, 0))
        windup_z = "behind"  # rod swings back behind the head
    frames = [rod_pose(*ready), rod_pose(*windup, z=windup_z), rod_pose(*cast)]
    for i, by in enumerate(bob_ys):
        ps = rod_pose(*wait, (bob_x, by))
        ps["props"].append(("bobber", (bob_x, by)))
        if i == 3:  # bite!
            ps.update(eyes="wide", mouth="o", ov=[("excl", (15, -14))])
        frames.append(ps)
    frames.append(rod_pose(*pull, ux=-1, eyes="closed", mouth="o"))
    h, e, t = catch
    end = (t[0], t[1] + 7)
    got = rod_pose(h, e, t, end, mouth="open")
    got["props"].append(("fish", end, 0))
    proud = rod_pose(h, e, t, end, mouth="laugh", eyes="happy", bob=-1)
    proud["props"].append(("fish", end, 1))
    frames += [got, proud]
    return frames, [300, 200, 150, 300, 400, 400, 300, 200, 300, 500]


def animations(view):
    back = view == "back"
    walk = [
        {"legs": {"L": 1, "R": -1}, "arms": {"L": -1, "R": 1}},
        {"legs": {"L": 0, "R": 0}, "bob": -1, "lift": "R"},
        {"legs": {"L": -1, "R": 1}, "arms": {"L": 1, "R": -1}},
        {"legs": {"L": 0, "R": 0}, "bob": -1, "lift": "L"},
    ]
    wv = [(27, 12), (28, 14), (28, 11), (28, 14)]
    bub = [("bubble", (14, -19))]
    if back:
        reach = [((27, 21), (24, 23)), ((27, 22), (24, 23)), ((29, 20), (25, 22)), ((30, 19), (26, 21))]
        drink = [((24, 26), (22, 25)), ((24, 22), (25, 25)), ((22, 20), (25, 25))]
        kiss = [((22, 17), (25, 25)), ((28, 15), (25, 23)), ((26, 21), (25, 25))]
    else:
        reach = [((27, 25), (24, 25)), ((27, 26), (24, 25)), ((29, 25), (25, 24)), ((30, 24), (26, 24))]
        drink = [((24, 28), (22, 27)), ((23, 24), (25, 27)), ((20, 21), (25, 26))]
        kiss = [((21, 18), (25, 26)), ((27, 17), (25, 24)), ((26, 22), (25, 26))]
    cup = lambda i, **k: dict({"raise": {"R": drink[i]}, "props": [("cup", drink[i][0])]}, **k)
    belly = {"L": 1.5}
    sign = lambda hnd, **k: dict({"raise": {"R": hnd}, "props": [("sign", hnd)]}, **k)
    return {
        "idle": ([{}] * 5 + [{"eyes": "closed"}], [300] * 5 + [120]),
        "walk": (walk, [120] * 4),
        "wave": ([{"raise": {"R": h}} for h in wv], [150] * 4),
        "hi": ([{}, {"raise": {"R": wv[0]}, "mouth": "open", "ov": bub}, {"raise": {"R": wv[1]}, "ov": bub},
                {"raise": {"R": wv[2]}, "mouth": "open", "ov": bub}, {"raise": {"R": wv[3]}, "ov": bub},
                {"ov": bub}], [200, 160, 160, 160, 160, 600]),
        "talk": ([{"mouth": "open"}, {"head": -1}, {"mouth": "open", "head": -1}, {}], [140] * 4),
        "laugh": ([{"mouth": "laugh", "eyes": "happy", "head": -1, "arms": belly, "ov": [("ha", (22, -8))]},
                   {"mouth": "open", "eyes": "happy", "arms": belly},
                   {"mouth": "laugh", "eyes": "happy", "head": -1, "arms": belly, "ov": [("ha", (24, -10))]},
                   {"mouth": "open", "eyes": "happy", "arms": belly}], [140] * 4),
        "blow_kiss": ([{}, {"raise": {"R": kiss[0]}, "mouth": "kiss", "eyes": "wink"},
                       {"raise": {"R": kiss[1]}, "mouth": "kiss", "eyes": "wink", "ov": [("heart", (25, 8))]},
                       {"raise": {"R": kiss[2]}, "eyes": "happy", "ov": [("heart", (26, 2))]},
                       {"eyes": "happy", "ov": [("heart", (27, -4))]},
                       {"ov": [("heart", (28, -10))]}], [200, 300, 200, 200, 200, 200]),
        "sit": ([{"sit": True, "bob": 5}] * 3 + [{"sit": True, "bob": 5, "eyes": "closed"}], [400, 400, 400, 120]),
        "dance": ([{"raise": {"L": (5, 13), "R": (27, 13)}, "bob": -1, "legs": {"L": 0.5, "R": -0.5}},
                   {"arms": {"L": 1, "R": -1}, "head": 1},
                   {"raise": {"L": (5, 13)}, "bob": -1, "legs": {"L": -0.5, "R": 0.5}},
                   {"raise": {"R": (27, 13)}, "head": 1}], [180] * 4),
        "jump": ([{"bob": 1, "arms": {"L": -1, "R": -1}},
                  {"shift": -5, "raise": {"L": (5, 15), "R": (27, 15)}},
                  {"shift": -3, "arms": {"L": 1, "R": 1}},
                  {"bob": 1}], [100, 200, 120, 120]),
        "drink": ([cup(0), cup(1), cup(2, head=-1, eyes="closed"), cup(2, head=-1, eyes="closed"), cup(1),
                   cup(0, mouth="open", eyes="happy")], [300, 150, 300, 300, 150, 400]),
        "fish": fishing(back),
        "open_door": ([{}, {"raise": {"R": reach[0]}}, {"raise": {"R": reach[1]}},
                       {"raise": {"R": reach[2]}, "ux": 1, "legs": {"L": 0.5, "R": -0.5}},
                       dict(walk[0], **{"raise": {"R": reach[3]}, "ux": 1}), walk[1], walk[2]],
                      [250, 200, 250, 200, 150, 120, 120]),
        "hold_sign": ([sign((27, 14)), sign((28, 13), head=-1), sign((27, 14)), sign((27, 15), head=1)], [300] * 4),
        "sleep": ([{"eyes": "closed", "head": 1, "mouth": "o", "ov": [("z", (22, -2))]},
                   {"eyes": "closed", "head": 1, "bob": 1, "ov": [("z", (22, -2)), ("Z", (25, -9))]},
                   {"eyes": "closed", "head": 1, "bob": 1, "mouth": "o", "ov": [("Z", (25, -9)), ("Z", (28, -16))]},
                   {"eyes": "closed", "head": 1, "ov": [("Z", (28, -16))]}], [450] * 4),
    }


DIRS = [("SE", "front", False), ("SW", "front", True), ("NE", "back", False), ("NW", "back", True)]


# ---------------------------------------------------------------- door prop
def door_frames():
    """Iso door in a left-hand wall, swinging open toward the viewer. 40x64 frames."""
    frames = []
    hb, hgt, u = (8, 52), 32, (16, -8)
    n = (14, 7)  # direction pointing out of the wall toward the room
    for ang in (0, 30, 60, 90):
        img = Image.new("RGBA", (40, 64), CLEAR)
        d = ImageDraw.Draw(img)
        ht = (hb[0], hb[1] - hgt)
        trim = [(hb[0] - 2, hb[1] + 1), (hb[0] + u[0] + 2, hb[1] + u[1] - 1),
                (ht[0] + u[0] + 2, ht[1] + u[1] - 3), (ht[0] - 2, ht[1] - 1)]
        d.polygon(trim, fill=(150, 100, 60, 255))
        d.polygon([hb, add(hb, u), add(ht, u), ht], fill=(40, 30, 34, 255))
        img = outline_img(img)
        a = math.radians(ang)
        e = (round(u[0] * math.cos(a) + n[0] * math.sin(a)), round(u[1] * math.cos(a) + n[1] * math.sin(a)))
        panel = Image.new("RGBA", (40, 64), CLEAR)
        pd = ImageDraw.Draw(panel)
        wood = mix((196, 136, 80), (140, 92, 52), ang / 90)
        pd.polygon([hb, add(hb, e), add(ht, e), ht], fill=wood + (255,))
        inset = lambda f, y: (round(hb[0] + e[0] * f), round(hb[1] + e[1] * f) - y)
        pd.line([inset(0.25, 6), inset(0.75, 6)], fill=mix(wood, (0, 0, 0), 0.2) + (255,))
        pd.line([inset(0.25, 26), inset(0.75, 26)], fill=mix(wood, (0, 0, 0), 0.2) + (255,))
        if ang < 90:
            k = inset(0.82, 15)
            pd.rectangle((k[0], k[1], k[0] + 1, k[1] + 1), fill=(250, 206, 60, 255))
        img.alpha_composite(outline_img(panel))
        frames.append(img)
    return frames


# ---------------------------------------------------------------- export
def save_gif(path, imgs, durations):
    big = [im.resize((im.width * SCALE, im.height * SCALE), Image.NEAREST) for im in imgs]
    big[0].save(path, save_all=True, append_images=big[1:], duration=durations, loop=0, disposal=2)


def build_look(name, shadow):
    set_look(name)
    root = os.path.join(HERE, "characters", name)
    shutil.rmtree(root, ignore_errors=True)
    os.makedirs(os.path.join(root, "gifs"))
    frames, durations = {}, {}
    anim_names = list(animations("front").keys())
    for dname, view, mirror in DIRS:
        for aname, (poses, durs) in animations(view).items():
            imgs = []
            for ps in poses:
                fr, ov = render(view, ps)
                if mirror:
                    fr = fr.transpose(Image.FLIP_LEFT_RIGHT)
                imgs.append(place_overlays(fr, ov, mirror))
            frames[(aname, dname)] = imgs
            durations[aname] = durs

    cols = max(len(v) for v in frames.values())
    rows = [(a, d) for a in anim_names for d, _, _ in DIRS]
    sheet = Image.new("RGBA", (cols * W, len(rows) * H), CLEAR)
    meta = {"character": name, "frameWidth": W, "frameHeight": H, "pivot": [OX + 16, OY + 45],
            "directions": [d for d, _, _ in DIRS], "animations": {}}
    for r, (a, d) in enumerate(rows):
        for i, im in enumerate(frames[(a, d)]):
            sheet.paste(im, (i * W, r * H))
        entry = meta["animations"].setdefault(a, {"durationsMs": durations[a], "loop": True, "rows": {}})
        entry["rows"][d] = {"row": r, "frames": [{"x": i * W, "y": r * H, "w": W, "h": H}
                                                 for i in range(len(frames[(a, d)]))]}
        save_gif(os.path.join(root, "gifs", f"{a}_{d}.gif"), frames[(a, d)], durations[a])
    sheet.save(os.path.join(root, "sheet.png"))
    with open(os.path.join(root, "sheet.json"), "w") as f:
        json.dump(meta, f, indent=2)

    z, lab_w, pad = 2, 90, 2
    prev = Image.new("RGBA", (lab_w + cols * (W * z + pad), len(rows) * (H * z + pad) + pad), (196, 176, 138, 255))
    dr = ImageDraw.Draw(prev)
    for r, (a, d) in enumerate(rows):
        y = pad + r * (H * z + pad)
        dr.text((6, y + H * z // 2 - 6), f"{a} {d}", fill=(40, 30, 20), font=ImageFont.load_default())
        for i, im in enumerate(frames[(a, d)]):
            cell = shadow.copy()
            cell.alpha_composite(im)
            prev.alpha_composite(cell.resize((W * z, H * z), Image.NEAREST), (lab_w + i * (W * z + pad), y))
    prev.save(os.path.join(root, "preview.png"))
    return frames, anim_names, sum(len(v) for v in frames.values())


def main():
    shadow = Image.new("RGBA", (W, H), CLEAR)
    ImageDraw.Draw(shadow).ellipse((OX + 8, OY + 42, OX + 26, OY + 47), fill=(0, 0, 0, 70))
    shadow.save(os.path.join(HERE, "shadow.png"))

    showcase = {}
    anim_names = []
    for name in LOOKS:
        frames, anim_names, count = build_look(name, shadow)
        showcase[name] = [frames[("idle", "SE")][0], frames[("hi", "SW")][2], frames[("fish", "SE")][9],
                          frames[("blow_kiss", "NE")][2]]
        print(f"{name:8s} {count} frames")

    # lineup: each look in 4 poses
    z = 3
    lineup = Image.new("RGBA", (len(LOOKS) * W * z, 4 * H * z), (196, 176, 138, 255))
    for i, (name, imgs) in enumerate(showcase.items()):
        for j, im in enumerate(imgs):
            cell = shadow.copy()
            cell.alpha_composite(im)
            lineup.alpha_composite(cell.resize((W * z, H * z), Image.NEAREST), (i * W * z, j * H * z))
    lineup.save(os.path.join(HERE, "lineup.png"))

    props = os.path.join(HERE, "props")
    os.makedirs(props, exist_ok=True)
    doors = door_frames()
    for side, imgs in (("left", doors), ("right", [im.transpose(Image.FLIP_LEFT_RIGHT) for im in doors])):
        strip = Image.new("RGBA", (40 * len(imgs), 64), CLEAR)
        for i, im in enumerate(imgs):
            strip.paste(im, (i * 40, 0))
        strip.save(os.path.join(props, f"door_{side}.png"))
        seq = imgs + imgs[::-1]
        save_gif(os.path.join(props, f"door_{side}.gif"), seq, [200, 120, 120, 900, 120, 120, 120, 600])

    looks = json.dumps(list(LOOKS))
    anims = json.dumps(anim_names)
    html = f"""<!doctype html><meta charset=utf-8><title>Pixel characters</title>
<style>body{{background:#c4b08a;font:14px sans-serif;color:#2a1e14;margin:20px}}
table{{border-collapse:collapse}}td,th{{padding:2px 8px;text-align:center}}
img{{image-rendering:pixelated}} .g{{width:120px}} button{{margin:2px;padding:6px 12px;font:inherit;cursor:pointer}}
button.on{{background:#2a1e14;color:#fff}} .lineup{{width:100%;max-width:1152px}}</style>
<h2>Habbo-style pixel characters</h2>
<img class=lineup src="lineup.png"><p>
<div id=btns></div><table id=t></table>
<h3>Props</h3><img src="props/door_left.gif" width=160> <img src="props/door_right.gif" width=160>
<script>
const looks={looks}, anims={anims}, dirs=["SE","SW","NE","NW"];
function show(c){{
  document.querySelectorAll('#btns button').forEach(b=>b.classList.toggle('on',b.textContent==c));
  let h='<tr><th></th>'+dirs.map(d=>'<th>'+d+'</th>').join('')+'</tr>';
  for(const a of anims) h+='<tr><th>'+a+'</th>'+dirs.map(d=>`<td><img class=g src="characters/${{c}}/gifs/${{a}}_${{d}}.gif"></td>`).join('')+'</tr>';
  document.getElementById('t').innerHTML=h;
}}
document.getElementById('btns').innerHTML=looks.map(c=>`<button onclick="show('${{c}}')">${{c}}</button>`).join('');
show(looks[0]);
</script>"""
    with open(os.path.join(HERE, "viewer.html"), "w", encoding="utf-8") as f:
        f.write(html)
    print("done ->", HERE)


if __name__ == "__main__":
    main()
