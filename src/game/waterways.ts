// Where the boats sail (pure, no Phaser; src/game/Boats.ts moves them): round the river that rings downtown, and along
// the longest straight run of open sea the coast has.
import { GRID } from '@/world/layout';
import { RING_MAX, RING_MIN, type Terrain } from '@/world/terrain';
import type { Pt } from './RoadGraph';

/** The river's centre line, all round (closed): a boat going round passes under every bridge. */
export function riverLoop(lane: number): Pt[] {
  const lo = -lane;
  const hi = GRID - 1 + lane;
  return [{ x: lo, y: lo }, { x: hi, y: lo }, { x: hi, y: hi }, { x: lo, y: hi }, { x: lo, y: lo }];
}

/**
 * The longest straight run of open sea (with sea on both sides, so a ferry fits) at least 6 tiles from the core, along
 * a row or a column of the map; undefined when the coast has none worth sailing (an inland Region).
 */
export function seaLane(t: Pick<Terrain, 'kind'>): Pt[] | undefined {
  let best: { a: Pt; b: Pt; n: number } | undefined;
  const open = (x: number, y: number, horizontal: boolean) =>
    t.kind(x, y) === 'sea' && (horizontal ? t.kind(x, y - 1) === 'sea' && t.kind(x, y + 1) === 'sea' : t.kind(x - 1, y) === 'sea' && t.kind(x + 1, y) === 'sea');
  const far = (x: number, y: number) => Math.max(-x, x - (GRID - 1), -y, y - (GRID - 1)) >= 6;
  for (const horizontal of [true, false])
    for (let j = RING_MIN + 1; j < RING_MAX; j++) {
      let start = -1;
      for (let i = RING_MIN; i <= RING_MAX + 1; i++) {
        const [x, y] = horizontal ? [i, j] : [j, i];
        const ok = i <= RING_MAX && far(x, y) && open(x, y, horizontal);
        if (ok && start < 0) start = i;
        if (!ok && start >= 0) {
          const n = i - start;
          if (!best || n > best.n) best = horizontal ? { a: { x: start + 1, y: j }, b: { x: i - 2, y: j }, n } : { a: { x: j, y: start + 1 }, b: { x: j, y: i - 2 }, n };
          start = -1;
        }
      }
    }
  return best && best.n >= 12 ? [best.a, best.b] : undefined;
}
