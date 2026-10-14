// Camera framing for the city (pure, no Phaser): the largest whole-number zoom that shows the whole core, or the
// Town Square at zoom 1 when even that doesn't fit (the 400 px side panel). Zoom stays on integers so pixel art
// stays crisp (CLAUDE.md).
import { GRID, TOWN_SQUARE } from '@/world/layout';
import { CITY_ISO, cornerScreen, toScreen } from './iso';

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
/** Side margin round the core diamond, world px. */
const MARGIN_X = 8;
/** Room above the north corner for the tallest buildings there, world px. */
const HEADROOM = 48;

/** The core (GRID×GRID tiles) in world pixels: the diamond plus margins and building headroom. */
export const CORE = (() => {
  const top = cornerScreen(CITY_ISO, 0, 0).y - HEADROOM;
  const bottom = cornerScreen(CITY_ISO, GRID, GRID).y;
  const w = 2 * GRID * CITY_ISO.halfW + 2 * MARGIN_X;
  return { w, h: bottom - top, x: 0, y: (top + bottom) / 2 };
})();

/** Largest integer zoom in [1, 4] at which the whole core fits a viewW×viewH view, or 0 when it doesn't fit at 1. */
export function fitZoom(viewW: number, viewH: number): number {
  for (let z = MAX_ZOOM; z >= MIN_ZOOM; z--) if (CORE.w * z <= viewW && CORE.h * z <= viewH) return z;
  return 0;
}

export interface Frame {
  zoom: number;
  /** World point to centre on. */
  x: number;
  y: number;
  target: 'core' | 'square';
}

/** Where the camera should start: the whole core at the best zoom, else the Town Square at zoom 1. */
export function frameTarget(viewW: number, viewH: number): Frame {
  const z = fitZoom(viewW, viewH);
  if (z) return { zoom: z, x: CORE.x, y: CORE.y, target: 'core' };
  const r = TOWN_SQUARE.rect;
  const c = toScreen(CITY_ISO, r.x + (r.w - 1) / 2, r.y + (r.h - 1) / 2);
  return { zoom: MIN_ZOOM, x: c.x, y: c.y, target: 'square' };
}

/**
 * The world y to centre on when the camera goes to a building whose ground is at `groundY` and whose top (its roof, or
 * the crown on its knowledge tower) is at `topY`: a short building is framed as before (just above its ground), a tall
 * one by its middle so the tower shows, but never so high that its ground (where its agent works) leaves the view.
 */
export function buildingFocusY(groundY: number, topY: number, viewH: number, zoom: number, margin = 40) {
  const visible = viewH / zoom;
  const mid = (groundY + topY) / 2;
  return Math.max(Math.min(mid, groundY - 30), groundY - visible / 2 + margin);
}
