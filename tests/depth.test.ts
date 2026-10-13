import { describe, expect, it } from 'vitest';
import { CITY_ISO, entityDepth, footprintDepth, toScreen } from '@/game/iso';
import { SITES } from '@/world/layout';
import { terrainFor } from '@/world/terrain';
import { zonesFor } from '@/world/regions';

type Rect = { x: number; y: number; w: number; h: number };
const walker = (x: number, y: number) => entityDepth(toScreen(CITY_ISO, x, y).y);

/** Every tile touching the block, and whether something standing there is in front of it (east or south). */
function around(f: Rect) {
  const out: { x: number; y: number; front: boolean }[] = [];
  for (let x = f.x - 1; x <= f.x + f.w; x++)
    for (let y = f.y - 1; y <= f.y + f.h; y++) {
      const inside = x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h;
      if (inside) continue;
      const front = x >= f.x + f.w || y >= f.y + f.h;
      const behind = x < f.x || y < f.y;
      // The two side corners (NE and SW diagonals) are both: beside the block, overlapping neither face.
      if (front && behind) continue;
      out.push({ x, y, front });
    }
  return out;
}

describe('depth: walkers and cars beside buildings', () => {
  it('a walker anywhere along the east or south side of a 3×3 draws in front; north and west, behind', () => {
    const f = { x: 10, y: 10, w: 3, h: 3 };
    for (const t of around(f)) expect(walker(t.x, t.y) > footprintDepth(CITY_ISO, f), `${t.x},${t.y}`).toBe(t.front);
  });

  it('holds for every landmark and site in the city, and every near-square terrain prop', () => {
    const rects: Rect[] = [...SITES.map((s) => s.footprint), ...terrainFor('us-east-1', zonesFor('us-east-1')).props.filter((p) => Math.abs(p.w - p.h) <= 1)];
    expect(rects.length).toBeGreaterThan(20);
    for (const f of rects) for (const t of around(f)) expect(walker(t.x, t.y) > footprintDepth(CITY_ISO, f), `${JSON.stringify(f)} ${t.x},${t.y}`).toBe(t.front);
  });

  it('long thin props keep the front-tile rule', () => {
    const arch = { x: 40, y: 18, w: 1, h: 3 };
    expect(footprintDepth(CITY_ISO, arch)).toBe(entityDepth(toScreen(CITY_ISO, 40, 20).y));
  });
});
