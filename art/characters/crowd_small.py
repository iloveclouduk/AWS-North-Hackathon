"""
Crowd-size characters: a 3/4-scale copy of every citizen and agent sheet, so people stand at a believable size next
to the buildings (a full 48x72 character is as tall as a house). Kai and the landmark agents keep the full size; the
agent copies dress each service's workers on the street (src/game/Workers.ts).

Reads  public/assets/characters/<id>/sheet.png + sheet.json   (role "citizen" or "agent" in index.json)
Writes public/assets/characters/<id>-crowd/sheet.png + sheet.json (36x54 frames, same rows and animations)
       public/assets/characters/index.json                    (adds "<id>-crowd": role "crowd", frame [36, 54], of: <id>)

Each frame is resampled on its own (never across frame edges) and its alpha snapped to on/off, so the result
is still crisp pixel art under pixelArt rendering. Run after aws_city.py (npm run art does).
"""
import json
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "public", "assets", "characters")

W, H = 48, 72
SW, SH = 36, 54  # 3/4: small enough to look to scale beside the buildings, big enough that faces still read at zoom 1
ALPHA_CUT = 110


def shrink_frame(frame):
    small = frame.resize((SW, SH), Image.LANCZOS)
    px = small.load()
    for y in range(SH):
        for x in range(SW):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255 if a >= ALPHA_CUT else 0)
    return small


def shrink_sheet(src):
    cols, rows = src.width // W, src.height // H
    out = Image.new("RGBA", (cols * SW, rows * SH), (0, 0, 0, 0))
    for r in range(rows):
        for c in range(cols):
            frame = src.crop((c * W, r * H, (c + 1) * W, (r + 1) * H))
            if frame.getbbox():
                out.alpha_composite(shrink_frame(frame), (c * SW, r * SH))
    return out


def main():
    index_path = os.path.join(OUT, "index.json")
    with open(index_path) as f:
        index = json.load(f)
    # Drop the last run's copies so a removed citizen doesn't leave its crowd sheet behind.
    index = {k: v for k, v in index.items() if v.get("role") != "crowd"}
    made = 0
    for cid, entry in list(index.items()):
        if entry.get("role") not in ("citizen", "agent"):
            continue
        src_dir = os.path.join(OUT, cid)
        dst_dir = os.path.join(OUT, f"{cid}-crowd")
        os.makedirs(dst_dir, exist_ok=True)
        sheet = Image.open(os.path.join(src_dir, "sheet.png")).convert("RGBA")
        shrink_sheet(sheet).save(os.path.join(dst_dir, "sheet.png"), optimize=True)
        with open(os.path.join(src_dir, "sheet.json")) as f:
            meta = json.load(f)
        meta["frameWidth"] = SW
        meta["frameHeight"] = SH
        meta["pivot"] = [round(meta["pivot"][0] * SW / W), round(meta["pivot"][1] * SH / H)]
        with open(os.path.join(dst_dir, "sheet.json"), "w") as f:
            json.dump(meta, f, separators=(",", ":"))
        index[f"{cid}-crowd"] = {"role": "crowd", "anims": entry["anims"], "frame": [SW, SH], "of": cid}
        made += 1
    with open(index_path, "w") as f:
        json.dump(index, f, indent=1)  # the layout aws_city.py writes
    print(f"crowd: {made} sheets at {SW}x{SH}")


if __name__ == "__main__":
    main()
