// Kenney CC0 textures copied by scripts/fetch-assets.sh (keys = scripts/assets.txt second column).
import type Phaser from 'phaser';

export const CITY_TILES = ['grass', 'grassDark', 'water', 'sand', 'dirt', 'paving', 'fountain', 'pavingTree', 'asphalt'] as const;
export const ROOM_SPRITES = [
  'floorPlanks', 'carpet', 'bookcase', 'bookcaseSide', 'longTable', 'bookStand', 'candle',
  'displayCase', 'roundTable', 'desk', 'chair', 'chest', 'barrels', 'crates',
] as const;

export type CityTile = (typeof CITY_TILES)[number];
export type RoomSprite = (typeof ROOM_SPRITES)[number];

/** Kenney city/landscape tiles are 132px wide; the flat top diamond starts at y=0 for 99px-tall tiles. */
export const TILE_BASE_H = 99;

/** Kenney miniature sprites are 256×512 with the tile diamond centred at (128, 448). */
export const MINI_ORIGIN_Y = 448 / 512;
export const MINI_SCALE = 0.5;

export function preloadKenney(scene: Phaser.Scene) {
  const base = '/assets/kenney/';
  for (const k of [...CITY_TILES, ...ROOM_SPRITES]) scene.load.image(`k:${k}`, `${base}${k}.png`);
}
