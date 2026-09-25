// Where things sit on the isometric grid. The city is a 3×3 grid of 12×12 plots separated by roads.
// The centre plot is the Town Square; each district claims one plot and fills its six landmark
// slots in the order services are listed in shared/world.json. Two plots are reserved for the future.

import { DISTRICTS, SERVICES, type DistrictId } from './taxonomy';

export const PLOT = 12;
export const ROAD = 1;
export const GRID = 3 * PLOT + 4 * ROAD; // 40

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Tile {
  x: number;
  y: number;
}

const plotOrigin = (cx: number, cy: number): Tile => ({ x: ROAD + cx * (PLOT + ROAD), y: ROAD + cy * (PLOT + ROAD) });

/** Plot cell for each district; Town Square is (1,1). */
const DISTRICT_CELLS: Record<DistrictId, [number, number]> = {
  storage: [0, 0],
  compute: [1, 0],
  database: [2, 0],
  security: [0, 1],
  networking: [2, 1],
  aiml: [0, 2],
};
export const FUTURE_CELLS: [number, number][] = [
  [1, 2],
  [2, 2],
];
export const FUTURE_LABELS = ['Migration Meadow (coming soon)', 'IoT Island (coming soon)'];

/** Landmark footprints inside a plot, in plot-local coordinates. */
const SLOTS: Rect[] = [
  { x: 1, y: 1, w: 3, h: 3 },
  { x: 5, y: 1, w: 3, h: 3 },
  { x: 9, y: 1, w: 3, h: 3 },
  { x: 1, y: 6, w: 3, h: 3 },
  { x: 5, y: 6, w: 3, h: 3 },
  { x: 9, y: 6, w: 3, h: 3 },
];
const HQ_SLOT: Rect = { x: 5, y: 10, w: 2, h: 2 };

export interface PlotLayout {
  id: string;
  rect: Rect;
}

export interface LandmarkLayout {
  id: string; // service id, 'hq:<district>', 'plaza', 'lookout', 'workshop'
  districtId?: DistrictId;
  footprint: Rect;
  /** Walkable tile where the agent stands to work. */
  workSpot: Tile;
}

const offset = (o: Tile, r: Rect): Rect => ({ x: o.x + r.x, y: o.y + r.y, w: r.w, h: r.h });
const frontOf = (r: Rect): Tile => ({ x: r.x + Math.floor(r.w / 2), y: r.y + r.h });

export const TOWN_SQUARE: PlotLayout = { id: 'square', rect: { ...plotOrigin(1, 1), w: PLOT, h: PLOT } };

export const DISTRICT_PLOTS: Record<DistrictId, PlotLayout> = Object.fromEntries(
  DISTRICTS.map((d) => {
    const [cx, cy] = DISTRICT_CELLS[d.id];
    return [d.id, { id: d.id, rect: { ...plotOrigin(cx, cy), w: PLOT, h: PLOT } }];
  }),
) as Record<DistrictId, PlotLayout>;

export const FUTURE_PLOTS: PlotLayout[] = FUTURE_CELLS.map(([cx, cy], i) => ({
  id: `future-${i}`,
  rect: { ...plotOrigin(cx, cy), w: PLOT, h: PLOT },
}));

function buildLandmarks(): LandmarkLayout[] {
  const out: LandmarkLayout[] = [];
  const sq = TOWN_SQUARE.rect;
  // The Spheres (Console HQ) in the middle of the square; the Concierge works at its front door.
  const plaza = offset(sq, { x: 4, y: 2, w: 4, h: 4 });
  out.push({ id: 'plaza', footprint: plaza, workSpot: frontOf(plaza) });
  const lookout = offset(sq, { x: 10, y: 1, w: 1, h: 1 });
  out.push({ id: 'lookout', footprint: lookout, workSpot: { x: lookout.x, y: lookout.y + 1 } });
  const workshop = offset(sq, { x: 1, y: 7, w: 3, h: 3 });
  out.push({ id: 'workshop', footprint: workshop, workSpot: frontOf(workshop) });

  for (const d of DISTRICTS) {
    const o = DISTRICT_PLOTS[d.id].rect;
    SERVICES.filter((s) => s.districtId === d.id).forEach((s, i) => {
      const slot = SLOTS[i];
      if (!slot) throw new Error(`District ${d.id} has more services than landmark slots`);
      const fp = offset(o, slot);
      out.push({ id: s.id, districtId: d.id, footprint: fp, workSpot: frontOf(fp) });
    });
    const hq = offset(o, HQ_SLOT);
    out.push({ id: `hq:${d.id}`, districtId: d.id, footprint: hq, workSpot: frontOf(hq) });
  }
  return out;
}

export const LANDMARKS: LandmarkLayout[] = buildLandmarks();
export const landmarkLayout = (id: string) => LANDMARKS.find((l) => l.id === id);

export const FOUNTAIN: Tile = { x: TOWN_SQUARE.rect.x + 8, y: TOWN_SQUARE.rect.y + 8 };
export const PLAYER_SPAWN: Tile = { x: TOWN_SQUARE.rect.x + 6, y: TOWN_SQUARE.rect.y + 9 };
/** Benches in the square (citizens sit here). */
export const BENCHES: Tile[] = [
  { x: TOWN_SQUARE.rect.x + 9, y: TOWN_SQUARE.rect.y + 7 },
  { x: TOWN_SQUARE.rect.x + 9, y: TOWN_SQUARE.rect.y + 9 },
  { x: TOWN_SQUARE.rect.x + 4, y: TOWN_SQUARE.rect.y + 9 },
];

export const inRect = (t: Tile, r: Rect) => t.x >= r.x && t.x < r.x + r.w && t.y >= r.y && t.y < r.y + r.h;
export const isRoad = (t: Tile) => t.x % (PLOT + ROAD) === 0 || t.y % (PLOT + ROAD) === 0;

/** Which plot a tile belongs to: a district id, 'square', 'future-N', or undefined for roads. */
export function plotAt(t: Tile): string | undefined {
  if (isRoad(t)) return undefined;
  if (inRect(t, TOWN_SQUARE.rect)) return 'square';
  for (const d of DISTRICTS) if (inRect(t, DISTRICT_PLOTS[d.id].rect)) return d.id;
  for (const f of FUTURE_PLOTS) if (inRect(t, f.rect)) return f.id;
  return undefined;
}

export const randomTileIn = (r: Rect, rand = Math.random): Tile => ({
  x: r.x + Math.floor(rand() * r.w),
  y: r.y + Math.floor(rand() * r.h),
});
