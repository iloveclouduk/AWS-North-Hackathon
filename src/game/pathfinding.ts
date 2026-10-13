import type { Tile } from '@/world/layout';

/** Most tiles A* expands before it gives up (plan B6): the 40x40 city core is 1,600 tiles, so this only stops runaway searches on a bigger grid. */
export const MAX_EXPANDED = 2000;

/**
 * A* on a 4-connected grid. Returns tiles from start (exclusive) to goal (inclusive), or [] if unreachable or the
 * search expands more than `maxExpanded` tiles (callers already treat [] as "can't get there").
 */
export function findPath(
  start: Tile,
  goal: Tile,
  w: number,
  h: number,
  walkable: (x: number, y: number) => boolean,
  maxExpanded = MAX_EXPANDED,
): Tile[] {
  if (start.x === goal.x && start.y === goal.y) return [];
  const key = (x: number, y: number) => y * w + x;
  const open = new Map<number, { x: number; y: number; f: number }>();
  const g = new Map<number, number>();
  const came = new Map<number, number>();
  const hdist = (x: number, y: number) => Math.abs(x - goal.x) + Math.abs(y - goal.y);
  const s = key(start.x, start.y);
  g.set(s, 0);
  open.set(s, { x: start.x, y: start.y, f: hdist(start.x, start.y) });
  const goalKey = key(goal.x, goal.y);

  let expanded = 0;
  while (open.size) {
    if (++expanded > maxExpanded) return [];
    let bestK = -1;
    let best: { x: number; y: number; f: number } | undefined;
    for (const [k, n] of open) if (!best || n.f < best.f) (best = n), (bestK = k);
    if (!best) break;
    open.delete(bestK);
    if (bestK === goalKey) {
      const out: Tile[] = [];
      let k = goalKey;
      while (k !== s) {
        out.push({ x: k % w, y: Math.floor(k / w) });
        k = came.get(k)!;
      }
      return out.reverse();
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = best.x + dx;
      const ny = best.y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nk = key(nx, ny);
      if (nk !== goalKey && !walkable(nx, ny)) continue;
      const ng = g.get(bestK)! + 1;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        came.set(nk, bestK);
        open.set(nk, { x: nx, y: ny, f: ng + hdist(nx, ny) });
      }
    }
  }
  return [];
}

/**
 * Routes reused between the same two tiles (plan B6): the baseline packets run the same flows over and over, and
 * citizens walk to the same benches and work spots. `version` names what the grid looked like; when it changes
 * (decor that blocks tiles came or went) every cached route is dropped. Small and least-recently-used.
 */
export class RouteCache {
  private routes = new Map<string, Tile[]>();
  private at: number;

  constructor(
    private version: () => number = () => 0,
    private max = 64,
  ) {
    this.at = version();
  }

  /** A copy of the route from `from` to `goal` (callers walk it by shifting), computed once per grid version. */
  get(from: Tile, goal: Tile, compute: () => Tile[]): Tile[] {
    const v = this.version();
    if (v !== this.at) {
      this.routes.clear();
      this.at = v;
    }
    const k = `${from.x},${from.y}>${goal.x},${goal.y}`;
    let r = this.routes.get(k);
    if (r) this.routes.delete(k);
    else r = compute();
    this.routes.set(k, r);
    if (this.routes.size > this.max) this.routes.delete(this.routes.keys().next().value!);
    return r.slice();
  }

  get size() {
    return this.routes.size;
  }
}
