// 2:1 isometric projection on the Habbo 64×32 tile (matches art/tiles/generate_tiles.py).

export interface Iso {
  halfW: number;
  halfH: number;
}

export const CITY_ISO: Iso = { halfW: 32, halfH: 16 };
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

/** Facing for a grid step: +x = SE, +y = SW, −x = NW, −y = NE. */
export function dirFor(dx: number, dy: number): 'SE' | 'SW' | 'NE' | 'NW' {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'SE' : 'NW';
  return dy >= 0 ? 'SW' : 'NE';
}
