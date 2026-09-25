// 2:1 isometric projection. City tiles (Kenney, 132px wide) use CITY_ISO; interiors use ROOM_ISO
// (Kenney miniatures at 0.5 scale → 128px wide).

export interface Iso {
  halfW: number;
  halfH: number;
}

export const CITY_ISO: Iso = { halfW: 66, halfH: 33 };
export const ROOM_ISO: Iso = { halfW: 64, halfH: 32 };

/** Screen position of the centre of tile (gx, gy). Fractional values give points inside tiles. */
export function toScreen(iso: Iso, gx: number, gy: number) {
  return { x: (gx - gy) * iso.halfW, y: (gx + gy) * iso.halfH };
}

/** Inverse of toScreen, rounded to the nearest tile. */
export function toTile(iso: Iso, sx: number, sy: number) {
  const a = sx / iso.halfW;
  const b = sy / iso.halfH;
  return { x: Math.round((a + b) / 2), y: Math.round((b - a) / 2) };
}

/** Depth for things standing on the ground: further down the screen draws on top. */
export const entityDepth = (screenY: number) => 10_000 + screenY;
