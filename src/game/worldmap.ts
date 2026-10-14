// The world map's pure parts (no Phaser, so tests can import them): the highways between Regions, and the direction
// of the dive from the map into a city, handed from WorldScene to CityScene.arrive through module state (a moment, not
// state worth a store field).
import { REGIONS, WORLD_MAP as M, type Region } from '@/world/culture';
import { neighbours, regionInfo } from '@/world/regions';

/**
 * The highways out of a Region: its nearest Regions, and the Regions that count it among theirs (so a Region at the
 * edge of a crowded continent, like Stockholm, still has its roads drawn both ways).
 */
const ROADS = new Map<string, Region[]>();
export function roads(code: string): Region[] {
  let out = ROADS.get(code);
  if (!out) {
    const by = new Map(neighbours(code).map((r) => [r.code, r]));
    for (const r of REGIONS.regions) if (r.code !== code && neighbours(r.code).some((n) => n.code === code)) by.set(r.code, r);
    ROADS.set(code, (out = [...by.values()]));
  }
  return out;
}

let fromWorld = false;
/** WorldScene.create: the next city arrival comes from the world map. */
export function markFromWorld() {
  fromWorld = true;
}
/**
 * The side of the screen the player came from when diving into `code`: the camera travelled from the map's centre
 * towards the Region, so the city starts offset back that way and keeps moving the same way. A unit vector in screen
 * axes, or undefined for a Region not on the map.
 */
export function diveFrom(code: string): { x: number; y: number } | undefined {
  const r = regionInfo(code);
  if (!r) return undefined;
  const dx = ((r.lon - (M.lonMin + M.lonMax) / 2) / (M.lonMax - M.lonMin)) * M.cols;
  const dy = (((M.latMin + M.latMax) / 2 - r.lat) / (M.latMax - M.latMin)) * M.rows;
  const len = Math.hypot(dx, dy);
  return len < 1 ? { x: -1, y: 0 } : { x: -dx / len, y: -dy / len };
}
/** Once per visit to the world map: where the city should arrive from, or undefined when it wasn't entered from the map. */
export function takeDiveFrom(code: string) {
  if (!fromWorld) return undefined;
  fromWorld = false;
  return diveFrom(code);
}

/**
 * A city's skyline on the world map: a tiny pixel silhouette of its signature (shared/region-flavour.json), as rects
 * [dx, dy, w, h] from the Region's point, standing on y = +2. So Tokyo shows its lattice tower and Sydney its shells.
 */
export type Rect4 = [number, number, number, number];
const SKYLINES: Record<string, Rect4[]> = {
  lattice: [[-3, 1, 7, 1], [-2, -2, 5, 3], [-1, -6, 3, 4], [0, -10, 1, 4]],
  needle: [[0, -8, 1, 10], [-2, -7, 5, 2]],
  bridge: [[-5, -6, 1, 8], [4, -6, 1, 8], [-6, -2, 12, 1]],
  spire: [[-2, -4, 5, 6], [-1, -8, 3, 4], [0, -11, 1, 3]],
  dome: [[-4, -1, 9, 3], [-3, -3, 7, 2], [-2, -5, 5, 2]],
  gate: [[-4, -4, 1, 6], [4, -4, 1, 6], [-5, -5, 11, 1], [-4, -3, 9, 1]],
  pavilion: [[-3, -1, 7, 3], [-2, -4, 5, 3], [-1, -7, 3, 3], [0, -9, 1, 2]],
  rowhouses: [[-5, -2, 3, 4], [-1, -3, 3, 5], [3, -2, 3, 4]],
  windtower: [[-5, -1, 11, 3], [-4, -5, 2, 4], [2, -5, 2, 4]],
  campus: [[-6, -1, 5, 3], [1, -1, 5, 3], [-1, -3, 2, 2]],
  shells: [[-5, 0, 11, 2], [-4, -3, 2, 3], [-1, -5, 2, 5], [2, -3, 2, 3]],
  harbour: [[-4, -5, 2, 7], [-1, -9, 3, 11], [3, -6, 2, 8]],
  modernist: [[-5, -4, 1, 6], [4, -4, 1, 6], [-5, -4, 10, 3]],
};
const DEFAULT_SKYLINE: Rect4[] = [[-4, -1, 2, 3], [-1, -4, 3, 6], [3, 0, 2, 2]];
/**
 * Is it night in a city right now? Solar time from its longitude (an impression: no time zones or daylight saving),
 * night from 19:00 to 06:00. The world map lights those skylines up.
 */
export function isNightAt(lon: number, at: Date = new Date()) {
  const utc = at.getUTCHours() + at.getUTCMinutes() / 60;
  const local = (((utc + lon / 15) % 24) + 24) % 24;
  return local >= 19 || local < 6;
}

export const skylineFor = (motif: string | undefined): Rect4[] => (motif && SKYLINES[motif]) || DEFAULT_SKYLINE;
