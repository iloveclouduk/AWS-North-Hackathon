"""
Contact sheets for reviewing landmark art (not shipped).

  generate_tiles.py writes .cache/art/landmarks-preview.png (every lm:<id>:<tier>) and
  .cache/art/culture-preview.png (every culture:* sprite) on each run.

Quick loop while drawing, without touching public/assets:
  python art/tiles/preview_landmarks.py --ids ec2,lambda --out /tmp/x.png     # tiers 1-4 of those services
  python art/tiles/preview_landmarks.py --culture --out /tmp/c.png            # the culture_art sprites
"""
import argparse
import json
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


def contact_sheet(sprites, names, out, per_row=8, scale=2, cell=(112, 176)):
    """Draw each named sprite on a 3x3 grass patch with its name underneath."""
    import generate_tiles as gt
    if not names:
        return
    cw, ch = cell
    rows = (len(names) + per_row - 1) // per_row
    sheet = Image.new("RGBA", (per_row * cw, rows * ch), (13, 8, 22, 255))
    d = ImageDraw.Draw(sheet)
    grass = sprites.get("grass0")
    for i, name in enumerate(names):
        img, (ax, ay) = sprites[name]
        cx, cy = (i % per_row) * cw + cw // 2, (i // per_row) * ch + ch - 70  # N corner of the footprint
        fw = max(1, round((img.width - 4) / (2 * gt.HW)))  # rough footprint for the ground patch
        if grass:
            gimg, (gax, gay) = grass
            n = min(fw, 4)
            for gy in range(n):
                for gx in range(n):
                    sheet.alpha_composite(gimg, (cx + (gx - gy) * gt.HW - gax, cy + (gx + gy) * gt.HH - gay))
        x, y = cx - ax, cy - ay
        if x < 0 or y < 0 or x + img.width > sheet.width or y + img.height > sheet.height:
            x, y = max(0, x), max(0, y)
        sheet.alpha_composite(img, (x, y))
        d.text(((i % per_row) * cw + 4, (i // per_row) * ch + ch - 14), name[:22], fill=(255, 230, 170, 255))
    sheet = sheet.resize((sheet.width * scale, sheet.height * scale), Image.NEAREST)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    sheet.save(out)
    print("preview →", out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", default="")
    ap.add_argument("--culture", action="store_true")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    import generate_tiles as gt
    gt.load_pack()
    gt.add_pack()
    gt.build_ground()
    with open(os.path.join(gt.ROOT, "shared", "world.json")) as f:
        world = json.load(f)
    colors = {d["id"]: gt.rgb(d["color"]) for d in world["districts"]}
    names = []
    if args.ids:
        for sid in args.ids.split(","):
            s = next(x for x in world["services"] if x["id"] == sid)
            draw = gt.drawer_for(s)
            for tier in (1, 2, 3, 4):
                n = f"lm:{sid}:{tier}"
                gt.add(n, draw(3, 3, tier, colors[s["districtId"]], f"{sid}{tier}"))
                names.append(n)
    if args.culture:
        import culture_art
        before = set(gt.SPRITES)
        culture_art.build(gt.add)
        names += [n for n in gt.SPRITES if n not in before and "@" not in n]
    contact_sheet(gt.SPRITES, names, args.out, per_row=4 if args.ids else 6)


if __name__ == "__main__":
    main()
