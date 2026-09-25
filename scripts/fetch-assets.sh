#!/usr/bin/env bash
# Downloads Kenney CC0 packs (https://kenney.nl) into .cache/kenney/<slug>/ (gitignored), then copies
# only the files listed in scripts/assets.txt into public/assets/kenney/ (committed).
# City/interior art is NOT from Kenney — it is generated in our own pixel style: `npm run art`.
set -euo pipefail
cd "$(dirname "$0")/.."
CACHE=.cache/kenney
OUT=public/assets/kenney
mkdir -p "$CACHE" "$OUT"
for slug in $(grep -v '^#' scripts/assets.txt | cut -d/ -f1 | sort -u); do
  if [ -d "$CACHE/$slug" ]; then echo "✓ $slug (cached)"; continue; fi
  url=$(curl -fsSL "https://kenney.nl/assets/$slug" | grep -oE "https://kenney.nl/media/pages/assets/$slug/[^\"']+\.zip" | head -1)
  [ -z "$url" ] && { echo "✗ no zip link found for $slug"; exit 1; }
  echo "↓ $slug"
  curl -fsSL "$url" -o "$CACHE/$slug.zip"
  unzip -q -o "$CACHE/$slug.zip" -d "$CACHE/$slug" && rm "$CACHE/$slug.zip"
done
grep -v '^#' scripts/assets.txt | while IFS='|' read -r src dst; do
  src="$(echo "$src" | sed 's/[[:space:]]*$//')"; dst="$(echo "$dst" | sed 's/^[[:space:]]*//')"
  [ -z "$src" ] && continue
  mkdir -p "$OUT/$(dirname "$dst")"
  cp "$CACHE/$src" "$OUT/$dst"
done
cp "$CACHE/kenney-fonts/License.txt" "$OUT/LICENSE-kenney.txt"
echo "done → $OUT ($(find "$OUT" -type f | wc -l | tr -d ' ') files)"
