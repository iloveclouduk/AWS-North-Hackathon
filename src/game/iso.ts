// 2:1 isometric projection on the team pack's 32×16 tile (matches art/tiles/generate_tiles.py).

export interface Iso {
  halfW: number;
  halfH: number;
}

export const CITY_ISO: Iso = { halfW: 16, halfH: 8 };
export const ROOM_ISO: Iso = CITY_ISO;

/** Screen position of the centre of tile (gx, gy). Fractional values give points inside tiles. */
export function toScreen(iso: Iso, gx: number, gy: number) {
  return { x: (gx - gy) * iso.halfW, y: (gx + gy) * iso.halfH };
}

/** Screen position of the N (top) corner of tile (gx, gy) — where generated sprites are anchored. */
export function cornerScreen(iso: Iso, gx: number, gy: number) {
  return toScreen(iso, gx - 0.5, gy - 0.5);
}

/** Inverse of toScreen, rounded to the nearest tile. */
export function toTile(iso: Iso, sx: number, sy: number) {
  const a = sx / iso.halfW;
  const b = sy / iso.halfH;
  return { x: Math.round((a + b) / 2), y: Math.round((b - a) / 2) };
}

/** Depth for things standing on the ground: further down the screen draws on top. */
export const entityDepth = (screenY: number) => 10_000 + screenY;

/**
 * Depth for something covering a w×h block of tiles, against walkers and cars on single tiles. Anything on a tile east
 * (x ≥ x+w) or south (y ≥ y+h) of the block is in front of it and must draw on top, however far along that side it
 * stands. Anything north or west is behind. One number puts both sets on the right side when |w − h| ≤ 1, which covers
 * every building in the city. The old rule used the block's front tile, so a walker beside a 3×3 drew behind its wall.
 */
export const footprintDepth = (iso: Iso, f: { x: number; y: number; w: number; h: number }) =>
  // Long, thin things (the 1×3 gate arch over the highway) keep the front-tile rule: no one number orders them.
  entityDepth((Math.abs(f.w - f.h) > 1 ? f.x + f.y + f.w + f.h - 2 : f.x + f.y + Math.min(f.w, f.h) - 0.5) * iso.halfH);

/** Facing for a grid step: +x = SE, +y = SW, −x = NW, −y = NE. */
export function dirFor(dx: number, dy: number): 'SE' | 'SW' | 'NE' | 'NW' {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'SE' : 'NW';
  return dy >= 0 ? 'SW' : 'NE';
}
