"""
Imports the team's pixel city pack from the agentic-city prototype (agentic-city/index.html embeds every
asset + metadata as a `CITY` JSON object). Writes art/pack/<group>/<name>.png and art/pack/pack.json.

These sprites are used pixel-for-pixel; art/tiles/generate_tiles.py draws everything else in the same style.
Run: python3 art/pack/import_agentic.py
"""
import base64
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))


def main():
    with open(os.path.join(ROOT, "agentic-city", "index.html"), encoding="utf-8") as f:
        html = f.read()
    start = html.index("const CITY = ") + len("const CITY = ")
    city, _ = json.JSONDecoder().raw_decode(html[start:])
    meta = {"tile": city["tile"]}
    count = 0
    for group in ("floors", "walls", "objects", "buildings", "props"):
        meta[group] = {}
        os.makedirs(os.path.join(HERE, group), exist_ok=True)
        for name, item in city.get(group, {}).items():
            data = item.get("data")
            if not data:
                continue
            png = base64.b64decode(data.split(",", 1)[1])
            with open(os.path.join(HERE, group, f"{name}.png"), "wb") as out:
                out.write(png)
            meta[group][name] = {k: v for k, v in item.items() if k not in ("data", "file")}
            count += 1
    with open(os.path.join(HERE, "pack.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print(f"imported {count} sprites → art/pack/")


if __name__ == "__main__":
    main()
