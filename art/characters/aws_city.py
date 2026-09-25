"""
AWS City character build — extends the team's Habbo-style generator (generate_characters.py, unchanged)
with one look per AWS agent, citizen looks, and the work animations agents need (type, hammer, carry,
guard, cook, file, scan, think, check, lock).

Reads  shared/world.json (agents: id, district colour, activity)
Writes public/assets/characters/<id>/sheet.png + sheet.json   (same format as the generator)
       public/assets/characters/index.json                    (id → role, anims)
       .cache/art/lineup.png                                  (visual review)

Run: python3 art/characters/aws_city.py        (or: npm run art)
"""
import hashlib
import json
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import generate_characters as g  # noqa: E402

OUT = os.path.join(ROOT, "public", "assets", "characters")
CACHE = os.path.join(ROOT, ".cache", "art")
W, H = g.W, g.H

# ---------------------------------------------------------------- palettes

def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def tone(rgb):
    """(base, shadow, highlight) for a clothing colour."""
    return rgb, g.mix(rgb, (20, 14, 24), 0.28), g.mix(rgb, (255, 255, 255), 0.38)


HAIRS = [
    ((70, 44, 32), (46, 28, 22), (110, 74, 50)),     # brown
    ((34, 26, 24), (20, 14, 14), (70, 56, 50)),      # black
    ((250, 214, 110), (214, 168, 70), (255, 240, 170)),  # blonde
    ((200, 80, 40), (160, 54, 26), (236, 130, 70)),  # ginger
    ((150, 90, 220), (110, 60, 180), (200, 150, 255)),  # purple
    ((210, 210, 220), (160, 160, 176), (245, 245, 250)),  # silver
    ((40, 120, 200), (26, 80, 150), (110, 170, 240)),  # blue
    ((230, 90, 150), (190, 50, 110), (255, 150, 200)),  # pink
]
HAIR_STYLES = ["spiky", "long", "bob", "afro", "buzz", "mohawk", "ponytail", "slick"]
TOPS = ["jacket", "hoodie", "tee", "suit", "flannel", "leather", "overalls", "dress"]
SKINS = ["light", "fair", "tan", "brown", "dark"]
PANTS = [((56, 66, 116), (38, 44, 84)), ((40, 42, 50), (26, 28, 34)), ((120, 124, 134), (88, 92, 102)),
         ((206, 186, 140), (168, 148, 106)), ((90, 130, 200), (64, 98, 160))]

# Hats that fit each job (colour comes from the district).
ACTIVITY_HAT = {"hammer": "beanie", "fish": "cap", "carry": "cap", "check": "cap", "scan": "beanie"}


def rnd(key, n):
    return int(hashlib.sha256(key.encode()).hexdigest(), 16) % n


def make_look(key, color_hex, activity):
    top_rgb = hexrgb(color_hex)
    top = TOPS[rnd(key + "top", len(TOPS))]
    hair_style = HAIR_STYLES[rnd(key + "hair", len(HAIR_STYLES))]
    hair = HAIRS[rnd(key + "hc", len(HAIRS))]
    pants = PANTS[rnd(key + "p", len(PANTS))]
    t, ts, th = tone(top_rgb)
    colors = dict(hair=hair[0], hair_s=hair[1], hair_h=hair[2], top=t, top_s=ts, top_h=th,
                  pants=pants[0], pants_s=pants[1],
                  inner=g.mix(top_rgb, (250, 250, 250), 0.75), inner_s=g.mix(top_rgb, (200, 200, 200), 0.6),
                  accent=g.mix(top_rgb, (20, 20, 30), 0.45))
    look = dict(skin=SKINS[rnd(key + "s", len(SKINS))], hair=hair_style, top=top,
                legs="skin" if top == "dress" else ("shorts" if rnd(key + "l", 5) == 0 else "pants"),
                shoes=["sneaker", "boot", "flat"][rnd(key + "sh", 3)], colors=colors)
    if top == "dress":
        look["sleeve"] = 0.0
    hat = ACTIVITY_HAT.get(activity)
    if hat and hair_style not in ("mohawk", "afro"):
        hc = tone(g.mix(top_rgb, (20, 20, 30), 0.25))
        look["hat"] = hat
        colors.update(hat=hc[0], hat_s=hc[1], hat_h=hc[2])
    if rnd(key + "gl", 4) == 0:
        look["glasses"] = True
    if look["skin"] in ("brown", "dark", "tan") and rnd(key + "bd", 3) == 0 and top != "dress":
        look["beard"] = True
    return look


# ---------------------------------------------------------------- new props

GREY = (190, 196, 206, 255)
DARK = (54, 58, 70, 255)
WOOD = (150, 100, 60, 255)
WOOD_D = (112, 72, 42, 255)
PAPER = (248, 246, 236, 255)
GOLD = (250, 206, 60, 255)


_orig_prop = g.prop_part


def prop_part(kind, args):
    if kind == "laptop":  # screen facing the character, keyboard on the lap
        (x, y), on = args
        p = g.Part()
        p.d.polygon([(x - 4, y), (x + 5, y - 2), (x + 6, y - 1), (x - 3, y + 1)], fill=GREY)  # base
        p.d.polygon([(x + 1, y - 9), (x + 6, y - 11), (x + 6, y - 2), (x + 1, y)], fill=DARK)  # lid
        glow = (90, 220, 250, 255) if on else (60, 150, 190, 255)
        p.d.polygon([(x + 2, y - 8), (x + 5, y - 9), (x + 5, y - 3), (x + 2, y - 2)], fill=glow)
        return "top", p
    if kind == "hammer":
        hand, head = args
        p = g.Part()
        g.stamp(p.d, [hand, head], 1, lambda t: WOOD)
        hx, hy = head
        p.d.rectangle((hx - 2, hy - 1, hx + 2, hy + 1), fill=DARK)
        return "top", p
    if kind == "anvil":
        (x, y), = args
        p = g.Part()
        p.d.rectangle((x - 4, y - 3, x + 4, y), fill=(120, 124, 134, 255))
        p.d.rectangle((x - 2, y + 1, x + 2, y + 3), fill=(88, 92, 102, 255))
        return "behind", p
    if kind == "box":
        (x, y), = args
        p = g.Part()
        p.d.rectangle((x - 6, y - 5, x + 6, y + 4), fill=(206, 150, 86, 255))
        p.d.line((x - 6, y - 1, x + 6, y - 1), fill=(236, 206, 140, 255))
        p.d.line((x, y - 5, x, y + 4), fill=(170, 116, 60, 255))
        return "top", p
    if kind == "shield":
        (x, y), col = args
        p = g.Part()
        p.d.polygon([(x - 4, y - 6), (x + 4, y - 6), (x + 4, y + 2), (x, y + 6), (x - 4, y + 2)], fill=GREY)
        p.d.rectangle((x - 1, y - 5, x, y + 4), fill=col + (255,))
        p.d.rectangle((x - 3, y - 2, x + 3, y - 1), fill=col + (255,))
        return "top", p
    if kind == "pan":
        (x, y), patty_y = args
        p = g.Part()
        p.d.line((x - 4, y, x, y), fill=DARK)
        p.d.ellipse((x, y - 2, x + 7, y + 1), fill=(70, 74, 84, 255))
        p.d.ellipse((x + 2, patty_y - 1, x + 5, patty_y + 1), fill=(150, 90, 40, 255))
        return "top", p
    if kind == "cabinet":
        (x, y), = args
        p = g.Part()
        p.d.rectangle((x - 4, y - 12, x + 4, y), fill=WOOD)
        for yy in (y - 9, y - 5, y - 1):
            p.d.line((x - 3, yy, x + 3, yy), fill=WOOD_D)
            p.d.point((x, yy - 1), fill=GOLD)
        return "behind", p
    if kind == "card":
        (x, y), = args
        p = g.Part()
        p.d.rectangle((x - 2, y - 2, x + 2, y + 1), fill=PAPER)
        p.d.line((x - 1, y - 1, x + 1, y - 1), fill=(120, 140, 200, 255))
        return "top", p
    if kind == "camera":
        (x, y), = args
        p = g.Part()
        p.d.rectangle((x - 4, y - 3, x + 4, y + 2), fill=(40, 40, 48, 255))
        p.d.rectangle((x - 1, y - 2, x + 2, y + 1), fill=(90, 170, 230, 255))
        p.d.rectangle((x - 3, y - 4, x - 1, y - 3), fill=GREY)
        return "top", p
    if kind == "clipboard":
        (x, y), tick = args
        p = g.Part()
        p.d.rectangle((x - 3, y - 5, x + 3, y + 4), fill=WOOD)
        p.d.rectangle((x - 2, y - 4, x + 2, y + 3), fill=PAPER)
        p.d.rectangle((x - 1, y - 6, x + 1, y - 5), fill=GREY)
        for i in range(3):
            p.d.line((x - 1, y - 2 + i * 2, x + 1, y - 2 + i * 2), fill=(170, 170, 180, 255))
        if tick:
            p.d.point([(x - 1, y + 1), (x, y + 2), (x + 1, y + 1), (x + 2, y)], fill=(40, 170, 80, 255))
        return "top", p
    if kind == "key":
        (x, y), vertical = args
        p = g.Part()
        if vertical:
            p.d.ellipse((x - 2, y - 7, x + 2, y - 3), fill=GOLD)
            p.d.line((x, y - 3, x, y + 4), fill=GOLD)
            p.d.line((x, y + 2, x + 2, y + 2), fill=GOLD)
            p.d.line((x, y + 4, x + 2, y + 4), fill=GOLD)
        else:
            p.d.ellipse((x - 2, y - 2, x + 2, y + 2), fill=GOLD)
            p.d.line((x + 2, y, x + 9, y), fill=GOLD)
            p.d.line((x + 7, y, x + 7, y + 2), fill=GOLD)
            p.d.line((x + 9, y, x + 9, y + 2), fill=GOLD)
        return "top", p
    return _orig_prop(kind, args)


g.prop_part = prop_part

_orig_overlay = g.overlay_img


def overlay_img(kind, mirror):
    if kind in ("dots1", "dots2", "dots3"):
        n = int(kind[-1])
        img = Image.new("RGBA", (4 * n + 2, 6), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        for i in range(n):
            d.rectangle((1 + i * 4, 4 - i, 2 + i * 4, 5 - i), fill=(250, 250, 255, 255))
        return g.outline_img(img)
    if kind == "bulb":
        return g.glyph([".XX.", "XhXX", "XXXX", ".XX.", ".gg."], {"X": (255, 226, 80, 255), "h": (255, 250, 200, 255), "g": (170, 170, 180, 255)})
    if kind == "flash":
        return g.glyph(["..X..", ".XXX.", "XXXXX", ".XXX.", "..X.."], {"X": (255, 255, 255, 255)})
    if kind == "spark":
        return g.glyph(["X.X", ".X.", "X.X"], {"X": (255, 214, 60, 255)})
    if kind == "steam":
        return g.glyph([".X", "X.", ".X"], {"X": (230, 230, 240, 255)})
    return _orig_overlay(kind, mirror)


g.overlay_img = overlay_img

# ---------------------------------------------------------------- new animations

SHIELD_COL = (214, 69, 69)


def work_animations(view):
    back = view == "back"
    sit = {"sit": True, "bob": 5}

    def raise_(**hands):
        return {"raise": {k: v for k, v in hands.items()}}

    type_ = [
        dict(sit, **raise_(L=((24, 29), (18, 28)), R=((27, 28), (24, 27))), props=[("laptop", (27, 30), True)]),
        dict(sit, **raise_(L=((24, 28), (18, 28)), R=((27, 29), (24, 27))), props=[("laptop", (27, 30), False)]),
        dict(sit, **raise_(L=((24, 29), (18, 28)), R=((27, 28), (24, 27))), props=[("laptop", (27, 30), True)], head=1),
        dict(sit, **raise_(L=((24, 28), (18, 28)), R=((27, 29), (24, 27))), props=[("laptop", (27, 30), True)]),
    ]
    hammer = [
        dict(raise_(R=((27, 12), (26, 19))), props=[("hammer", (27, 12), (30, 6)), ("anvil", (31, 42))]),
        dict(raise_(R=((29, 20), (27, 21))), props=[("hammer", (29, 20), (33, 17)), ("anvil", (31, 42))]),
        dict(raise_(R=((30, 30), (26, 26))), props=[("hammer", (30, 30), (32, 36)), ("anvil", (31, 42))], ov=[("spark", (26, 11))], mouth="o"),
        dict(raise_(R=((29, 28), (26, 26))), props=[("hammer", (29, 28), (31, 34)), ("anvil", (31, 42))]),
    ]
    box = lambda by, legs: dict(raise_(L=((12, 28 + by), (10, 26)), R=((24, 28 + by), (25, 26))),
                                props=[("box", (18, 29 + by))], legs=legs, bob=-1 if by else 0)
    carry = [box(0, {"L": 1, "R": -1}), box(1, {"L": 0, "R": 0}), box(0, {"L": -1, "R": 1}), box(1, {"L": 0, "R": 0})]
    guard = [
        dict(raise_(R=((26, 26), (24, 26))), props=[("shield", (29, 24), SHIELD_COL)]),
        dict(raise_(R=((26, 25), (24, 26))), props=[("shield", (29, 23), SHIELD_COL)], bob=-1, ov=[("spark", (26, 8))]),
        dict(raise_(R=((26, 26), (24, 26))), props=[("shield", (29, 24), SHIELD_COL)]),
        dict(raise_(R=((26, 27), (24, 26))), props=[("shield", (29, 25), SHIELD_COL)], mouth="o"),
    ]
    cook = [
        dict(raise_(R=((26, 28), (24, 26))), props=[("pan", (27, 28), 26)]),
        dict(raise_(R=((26, 26), (24, 25))), props=[("pan", (27, 26), 18)], ov=[("steam", (22, 6))]),
        dict(raise_(R=((26, 26), (24, 25))), props=[("pan", (27, 26), 14)], eyes="wide"),
        dict(raise_(R=((26, 28), (24, 26))), props=[("pan", (27, 28), 26)], mouth="open", eyes="happy"),
    ]
    file_ = [
        dict(raise_(R=((27, 27), (24, 26))), props=[("cabinet", (33, 42)), ("card", (28, 27))]),
        dict(raise_(R=((29, 20), (26, 22))), props=[("cabinet", (33, 42)), ("card", (30, 19))]),
        dict(raise_(R=((31, 29), (27, 26))), props=[("cabinet", (33, 42)), ("card", (32, 29))], head=1),
        dict(raise_(R=((27, 27), (24, 26))), props=[("cabinet", (33, 42))], eyes="happy"),
    ]
    cam = dict(raise_(L=((14, 16), (10, 22)), R=((22, 16), (25, 22))), props=[("camera", (18, 14))])
    scan = [cam, dict(cam, head=-1), dict(cam, ov=[("flash", (20, -6))]), dict(cam, eyes="happy")]
    chin = raise_(R=((21, 20), (25, 25)))
    think = [dict(chin, ov=[("dots1", (20, -8))]), dict(chin, ov=[("dots2", (20, -10))], head=-1),
             dict(chin, ov=[("dots3", (20, -12))]), dict(chin, ov=[("bulb", (22, -14))], eyes="wide", mouth="open")]
    board = lambda tick, **k: dict(raise_(R=((26, 26), (24, 26)), L=((22, 25), (16, 27))), props=[("clipboard", (28, 22), tick)], **k)
    check = [board(False), board(False, head=1), board(True, eyes="happy"), board(True)]
    key = lambda vert, **k: dict(raise_(R=((28, 26), (24, 25))), props=[("key", (30, 26), vert)], **k)
    lock = [key(False), key(False, head=1), key(True, eyes="happy"), key(True)]
    return {
        "type": (type_, [160, 160, 160, 160]),
        "hammer": (hammer, [220, 90, 160, 260]),
        "carry": (carry, [150] * 4),
        "guard": (guard, [300, 200, 300, 240]),
        "cook": (cook, [260, 200, 220, 320]),
        "file": (file_, [260, 260, 260, 320]),
        "scan": (scan, [320, 220, 120, 400]),
        "think": (think, [360, 360, 360, 700]),
        "check": (check, [300, 260, 300, 400]),
        "lock": (lock, [300, 260, 300, 400]),
    }


_orig_anims = g.animations


def animations(view):
    a = dict(_orig_anims(view))
    a.update(work_animations(view))
    return a


g.animations = animations

# Which animations each role ships with (keeps sheets small).
BASE_ANIMS = ["idle", "walk", "wave", "hi", "talk", "laugh", "sit", "jump"]
CITIZEN_ANIMS = BASE_ANIMS + ["fish", "drink", "dance", "sleep", "blow_kiss", "hold_sign"]
PLAYER_ANIMS = CITIZEN_ANIMS + ["open_door", "type", "carry"]


def agent_anims(activity):
    work = {"fish": "fish", "dance": "dance"}.get(activity, activity)
    return list(dict.fromkeys(BASE_ANIMS + [work, "type"]))


# ---------------------------------------------------------------- export

def export(name, anims):
    g.set_look(name)
    all_anims = g.animations("front")
    frames, durations = {}, {}
    for dname, view, mirror in g.DIRS:
        view_anims = g.animations(view)
        for aname in anims:
            poses, durs = view_anims[aname]
            imgs = []
            for ps in poses:
                fr, ov = g.render(view, ps)
                if mirror:
                    fr = fr.transpose(Image.FLIP_LEFT_RIGHT)
                imgs.append(g.place_overlays(fr, ov, mirror))
            frames[(aname, dname)] = imgs
            durations[aname] = durs
    cols = max(len(v) for v in frames.values())
    rows = [(a, d) for a in anims for d, _, _ in g.DIRS]
    sheet = Image.new("RGBA", (cols * W, len(rows) * H), (0, 0, 0, 0))
    meta = {"character": name, "frameWidth": W, "frameHeight": H, "pivot": [g.OX + 16, g.OY + 45],
            "directions": [d for d, _, _ in g.DIRS], "animations": {}}
    for r, (a, d) in enumerate(rows):
        for i, im in enumerate(frames[(a, d)]):
            sheet.paste(im, (i * W, r * H))
        entry = meta["animations"].setdefault(a, {"durationsMs": durations[a], "loop": True, "rows": {}})
        entry["rows"][d] = {"row": r, "frames": [{"x": i * W, "y": r * H, "w": W, "h": H} for i in range(len(frames[(a, d)]))]}
    root = os.path.join(OUT, name)
    os.makedirs(root, exist_ok=True)
    sheet.save(os.path.join(root, "sheet.png"), optimize=True)
    with open(os.path.join(root, "sheet.json"), "w") as f:
        json.dump(meta, f, separators=(",", ":"))
    return frames


CITIZEN_EXTRA = 10


def main():
    with open(os.path.join(ROOT, "shared", "world.json")) as f:
        world = json.load(f)
    colors = {d["id"]: d["color"] for d in world["districts"]}

    roster = {}  # id -> (role, anims)
    # Player: Kai exactly as designed by the team.
    g.LOOKS["player"] = g.LOOKS["kai"]
    roster["player"] = ("player", PLAYER_ANIMS)
    # Service agents + specials, coloured by district.
    for s in world["services"]:
        g.LOOKS[s["id"]] = make_look(s["id"], colors[s["districtId"]], s["activity"])
        roster[s["id"]] = ("agent", agent_anims(s["activity"]))
    for sid, a in world["special"].items():
        g.LOOKS[sid] = make_look(sid, a["color"], a["activity"])
        roster[sid] = ("agent", agent_anims(a["activity"]))
    # Citizens: the team's other seven looks + generated extras.
    for name in ["mia", "dre", "noah", "zed", "victor", "sky", "luna"]:
        roster[name] = ("citizen", CITIZEN_ANIMS)
    palette = ["#ef4444", "#f59e0b", "#10b981", "#06b6d4", "#6366f1", "#ec4899", "#84cc16", "#f97316", "#0ea5e9", "#a855f7"]
    for i in range(CITIZEN_EXTRA):
        cid = f"citizen{i}"
        g.LOOKS[cid] = make_look(cid, palette[i % len(palette)], "none")
        roster[cid] = ("citizen", CITIZEN_ANIMS)

    os.makedirs(OUT, exist_ok=True)
    os.makedirs(CACHE, exist_ok=True)
    showcase = []
    for cid, (role, anims) in roster.items():
        frames = export(cid, anims)
        work = next((a for a in anims if a not in BASE_ANIMS and a != "type"), "type")
        showcase.append((cid, [frames[("idle", "SE")][0], frames[("walk", "SW")][0], frames[(work, "SE")][min(2, len(frames[(work, "SE")]) - 1)], frames[("type", "SE")][0] if ("type", "SE") in frames else frames[("sit", "SE")][0]]))
        print(f"{cid:14s} {role:8s} {len(anims)} anims")

    with open(os.path.join(OUT, "index.json"), "w") as f:
        json.dump({cid: {"role": role, "anims": anims} for cid, (role, anims) in roster.items()}, f, indent=1)

    # review lineup (not shipped)
    z, per_row = 2, 13
    rows_n = (len(showcase) + per_row - 1) // per_row
    lineup = Image.new("RGBA", (per_row * W * z, rows_n * 4 * H * z // 2), (196, 176, 138, 255))
    for i, (_, imgs) in enumerate(showcase):
        for j, im in enumerate(imgs):
            x = (i % per_row) * W * z
            y = (i // per_row) * 4 * H * z // 2 + (j // 2) * H * z
            if j % 2 == 1:
                continue
            lineup.alpha_composite(im.resize((W * z, H * z), Image.NEAREST), (x, y))
    lineup.save(os.path.join(CACHE, "lineup.png"))
    # work-animation contact sheet for review
    work_sheet = Image.new("RGBA", (len(showcase) * W * 2, H * 2), (196, 176, 138, 255))
    for i, (_, imgs) in enumerate(showcase):
        work_sheet.alpha_composite(imgs[2].resize((W * 2, H * 2), Image.NEAREST), (i * W * 2, 0))
    work_sheet.save(os.path.join(CACHE, "work.png"))
    print("done →", OUT)


if __name__ == "__main__":
    main()
