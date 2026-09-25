#!/usr/bin/env bash
# Downloads Kenney CC0 packs (https://kenney.nl) into .cache/kenney/<slug>/ (gitignored),
# then copies only the files listed in scripts/assets.txt into public/assets/kenney/ (committed).
# Zip URLs contain a per-pack hash, so we scrape each asset page for its current link.
set -euo pipefail
cd "$(dirname "$0")/.."
CACHE=.cache/kenney
OUT=public/assets/kenney
mkdir -p "$CACHE" "$OUT"
for slug in $(cut -d/ -f1 scripts/assets.txt | grep -v '^#' | sort -u); do
  if [ -d "$CACHE/$slug" ]; then echo "✓ $slug (cached)"; continue; fi
  url=$(curl -fsSL "https://kenney.nl/assets/$slug" | grep -oE "https://kenney.nl/media/pages/assets/$slug/[^\"']+\.zip" | head -1)
  [ -z "$url" ] && { echo "✗ no zip link found for $slug"; exit 1; }
  echo "↓ $slug  $url"
  curl -fsSL "$url" -o "$CACHE/$slug.zip"
  unzip -q -o "$CACHE/$slug.zip" -d "$CACHE/$slug" && rm "$CACHE/$slug.zip"
done
# assets.txt line: <slug>/<path inside pack> <output-key>
grep -v '^#' scripts/assets.txt | while read -r src key; do
  [ -z "$src" ] && continue
  cp "$CACHE/$src" "$OUT/$key.png"
done
cp "$CACHE/isometric-tiles-city/License.txt" "$OUT/LICENSE-kenney.txt"
echo "done → $OUT ($(ls "$OUT" | wc -l | tr -d ' ') files)"
