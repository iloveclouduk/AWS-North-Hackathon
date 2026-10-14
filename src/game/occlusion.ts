// Tall buildings (a Master's knowledge tower is ~4 storeys of sprite) can stand between the camera and what the
// player is following: Kai, the building they picked. Those buildings fade so the player never loses sight of it.
// Pure: the scene passes screen boxes and depths, and an optional pixel test for the building's real outline.

export interface Occluder {
  id: string;
  /** Draw order: larger is drawn later, i.e. in front. */
  depth: number;
  /** World-px bounds of the sprite. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Focus {
  x: number;
  y: number;
  depth: number;
  /** The building being looked at never fades itself. */
  id?: string;
}

/** Alpha for a building drawn in front of something the player follows. */
export const FADED = 0.35;

/**
 * Ids of buildings drawn in front of any focus point whose box covers it. `solid(id, x, y)` (when given) confirms the
 * building really has a pixel there, so a point beside a slim tower doesn't fade it.
 */
export function fadeFor(buildings: Occluder[], focus: Focus[], solid?: (id: string, x: number, y: number) => boolean) {
  const out = new Set<string>();
  for (const b of buildings) {
    for (const f of focus) {
      if (f.id === b.id || b.depth <= f.depth) continue;
      if (f.x < b.x || f.x >= b.x + b.w || f.y < b.y || f.y >= b.y + b.h) continue;
      if (solid && !solid(b.id, f.x, f.y)) continue;
      out.add(b.id);
      break;
    }
  }
  return out;
}
