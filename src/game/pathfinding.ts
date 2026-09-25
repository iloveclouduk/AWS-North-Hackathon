import type { Tile } from '@/world/layout';

/** A* on a 4-connected grid. Returns tiles from start (exclusive) to goal (inclusive), or [] if unreachable. */
export function findPath(start: Tile, goal: Tile, w: number, h: number, walkable: (x: number, y: number) => boolean): Tile[] {
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

  while (open.size) {
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
