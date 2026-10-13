// The road network as a graph (pure, no Phaser), for the ambient traffic (src/game/Traffic.ts, plan B3) and the AZ link
// packets (RegionOverlay: island to island over both bridges). Nodes are the
// core's junctions (x % 13 == 0 && y % 13 == 0), the Region gate where the highway meets the core, the highway's far
// end (where traffic comes and goes) and the dead ends past the bridges (each AZ island's road ends in one); edges are the straight runs of road between
// them. Each edge has two lanes, offset to the right of travel, and a junction joins an incoming lane to an outgoing one
// with a short connector through the junction's box.
import { GRID, isRoad as isCoreRoad, PLOT, ROAD, type Tile } from '@/world/layout';
import type { Terrain } from '@/world/terrain';

/** A point in grid space (fractional: lanes run beside the tile centres). */
export interface Pt {
  x: number;
  y: number;
}

export type NodeKind = 'junction' | 'gate' | 'highwayEnd' | 'deadEnd';

export interface RoadNode {
  id: number;
  x: number;
  y: number;
  kind: NodeKind;
  /** Edge ids that meet here. */
  edges: number[];
}

export interface RoadEdge {
  id: number;
  a: number;
  b: number;
  /** Road tiles from node a to node b, both ends included. */
  tiles: Tile[];
}

/** One direction of an edge: a polyline beside the road, from the edge of `from`'s box to the edge of `to`'s box. */
export interface Lane {
  id: number;
  edge: number;
  from: number;
  to: number;
  pts: Pt[];
  /** Cumulative length at each point (cum[0] = 0), tiles. */
  cum: number[];
  len: number;
  /** On the highway (faster). */
  highway: boolean;
}

/** How far a lane sits to the right of the road's centre line, in tiles. */
export const LANE_OFFSET = 0.22;

/** The terrain bits the graph needs (so tests can build one from terrainFor directly). */
export type RoadTerrain = Pick<Terrain, 'roads' | 'bridges' | 'highway' | 'gate'>;

const k = (x: number, y: number) => `${x},${y}`;
const N4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** Right of travel (dx, dy) in grid space: the iso projection keeps orientation, so it's (-dy, dx) on screen too. */
const right = (dx: number, dy: number): Pt => ({ x: -dy * LANE_OFFSET, y: dx * LANE_OFFSET });

/** Points and lengths for a polyline. */
export function measure(pts: Pt[]) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { cum, len: cum[cum.length - 1] ?? 0 };
}

/** Position and heading at distance s along a measured polyline (clamped to its ends). */
export function pointAt(pts: Pt[], cum: number[], s: number): { x: number; y: number; dx: number; dy: number } {
  if (pts.length === 1) return { ...pts[0], dx: 1, dy: 0 };
  let i = 1;
  while (i < pts.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1];
  const b = pts[i];
  const seg = cum[i] - cum[i - 1] || 1;
  const t = Math.max(0, Math.min(1, (s - cum[i - 1]) / seg));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: b.x - a.x, dy: b.y - a.y };
}

export class RoadGraph {
  readonly nodes: RoadNode[] = [];
  readonly edges: RoadEdge[] = [];
  readonly lanes: Lane[] = [];
  /** The highway's far end (traffic spawns and leaves here), and the gate node. */
  readonly highwayEnd: number;
  readonly gate: number;
  private road = new Set<string>();
  private nodeAt = new Map<string, number>();
  private routes = new Map<string, number[]>();

  constructor(t: RoadTerrain) {
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) if (isCoreRoad({ x, y })) this.road.add(k(x, y));
    for (const r of t.roads) this.road.add(k(r.x, r.y));
    for (const b of t.bridges) for (const tt of b.tiles) this.road.add(k(tt.x, tt.y));
    for (const h of t.highway) this.road.add(k(h.x, h.y));
    this.road.add(k(t.gate.x, t.gate.y));

    const far = t.highway.reduce((m, h) => (h.x > m.x ? h : m), t.highway[0] ?? t.gate);
    const degree = (x: number, y: number) => N4.filter(([dx, dy]) => this.isRoad(x + dx, y + dy)).length;
    const addNode = (x: number, y: number, kind: NodeKind) => {
      const id = this.nodes.length;
      this.nodes.push({ id, x, y, kind, edges: [] });
      this.nodeAt.set(k(x, y), id);
      return id;
    };
    // Nodes: junctions, the gate, the highway end, then any other tile where the road doesn't just carry on.
    for (let y = 0; y < GRID; y += PLOT + ROAD) for (let x = 0; x < GRID; x += PLOT + ROAD) addNode(x, y, 'junction');
    this.gate = this.nodeAt.get(k(t.gate.x, t.gate.y)) ?? addNode(t.gate.x, t.gate.y, 'gate');
    this.highwayEnd = this.nodeAt.get(k(far.x, far.y)) ?? addNode(far.x, far.y, 'highwayEnd');
    for (const key of [...this.road].sort()) {
      const [x, y] = key.split(',').map(Number);
      if (this.nodeAt.has(key)) continue;
      const d = degree(x, y);
      if (d !== 2) addNode(x, y, d <= 1 ? 'deadEnd' : 'junction');
    }

    // Edges: walk from each node along each road neighbour until the next node.
    const seen = new Set<string>();
    for (const n of this.nodes)
      for (const [dx, dy] of N4) {
        if (!this.isRoad(n.x + dx, n.y + dy)) continue;
        const tiles: Tile[] = [{ x: n.x, y: n.y }];
        let px = n.x;
        let py = n.y;
        let cx = n.x + dx;
        let cy = n.y + dy;
        while (!this.nodeAt.has(k(cx, cy))) {
          tiles.push({ x: cx, y: cy });
          const nxt = N4.map(([ax, ay]) => ({ x: cx + ax, y: cy + ay })).find((p) => this.isRoad(p.x, p.y) && !(p.x === px && p.y === py));
          if (!nxt) break;
          px = cx;
          py = cy;
          cx = nxt.x;
          cy = nxt.y;
        }
        const end = this.nodeAt.get(k(cx, cy));
        if (end === undefined) continue;
        tiles.push({ x: cx, y: cy });
        // One edge per pair and starting step, seen from either end.
        const a = `${n.id}:${tiles[1].x},${tiles[1].y}`;
        const b = `${end}:${tiles[tiles.length - 2].x},${tiles[tiles.length - 2].y}`;
        if (seen.has(a) || seen.has(b)) continue;
        seen.add(a).add(b);
        const id = this.edges.length;
        this.edges.push({ id, a: n.id, b: end, tiles });
        n.edges.push(id);
        if (end !== n.id) this.nodes[end].edges.push(id);
      }

    for (const e of this.edges) {
      const highway = e.tiles.some((tt) => tt.y === t.gate.y && tt.x > t.gate.x);
      for (const [from, to, tiles] of [[e.a, e.b, e.tiles], [e.b, e.a, [...e.tiles].reverse()]] as const) {
        const pts = lanePoints(tiles);
        this.lanes.push({ id: this.lanes.length, edge: e.id, from, to, pts, ...measure(pts), highway });
      }
    }
  }

  isRoad = (x: number, y: number) => this.road.has(k(x, y));
  node = (x: number, y: number) => this.nodeAt.get(k(x, y));

  /** The lane along `edge` that leaves `from`. */
  lane(edge: number, from: number): Lane {
    const l = this.lanes[edge * 2];
    return l.from === from ? l : this.lanes[edge * 2 + 1];
  }

  /** Lanes leaving a node. */
  lanesFrom(node: number): Lane[] {
    return this.nodes[node].edges.map((e) => this.lane(e, node));
  }

  /** The lane from node a to its neighbour b, if they share an edge. */
  laneBetween(a: number, b: number): Lane | undefined {
    const e = this.nodes[a].edges.find((id) => {
      const ed = this.edges[id];
      return (ed.a === a && ed.b === b) || (ed.b === a && ed.a === b);
    });
    return e === undefined ? undefined : this.lane(e, a);
  }

  /**
   * The path through a node's box from an incoming lane to an outgoing one: straight on, an L for a turn, round the
   * centre for a U-turn (dead ends).
   */
  connector(inLane: Lane, outLane: Lane): Pt[] {
    const p = inLane.pts[inLane.pts.length - 1];
    const q = outLane.pts[0];
    const n = this.nodes[inLane.to];
    const din = dir(inLane.pts[inLane.pts.length - 2] ?? p, p);
    const dout = dir(q, outLane.pts[1] ?? q);
    const ri = right(din.x, din.y);
    const ro = right(dout.x, dout.y);
    if (din.x === dout.x && din.y === dout.y) return [p, q];
    if (din.x === -dout.x && din.y === -dout.y) return [p, { x: n.x + ri.x, y: n.y + ri.y }, { x: n.x - ri.x, y: n.y - ri.y }, q];
    return [p, { x: n.x + ri.x + ro.x, y: n.y + ri.y + ro.y }, q];
  }

  /** Shortest node path from a to b (both included), by road length; cached. [] when unreachable. */
  route(a: number, b: number): number[] {
    const key = `${a}>${b}`;
    const hit = this.routes.get(key);
    if (hit) return hit;
    const dist = new Array<number>(this.nodes.length).fill(Infinity);
    const prev = new Array<number>(this.nodes.length).fill(-1);
    const done = new Set<number>();
    dist[a] = 0;
    while (done.size < this.nodes.length) {
      let u = -1;
      for (let i = 0; i < dist.length; i++) if (!done.has(i) && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || u === b) break;
      done.add(u);
      for (const e of this.nodes[u].edges) {
        const ed = this.edges[e];
        const v = ed.a === u ? ed.b : ed.a;
        const nd = dist[u] + ed.tiles.length - 1;
        if (nd < dist[v]) (dist[v] = nd), (prev[v] = u);
      }
    }
    const out: number[] = [];
    if (dist[b] < Infinity) for (let v = b; v >= 0; v = prev[v]) out.unshift(v);
    this.routes.set(key, out);
    return out;
  }

  /** The road tiles of the shortest route from node a to node b, both ends included ([] when unreachable). */
  routeTiles(a: number, b: number): Tile[] {
    const nodes = this.route(a, b);
    const out: Tile[] = nodes.length ? [{ x: this.nodes[a].x, y: this.nodes[a].y }] : [];
    for (let i = 1; i < nodes.length; i++) {
      const [u, v] = [nodes[i - 1], nodes[i]];
      const e = this.nodes[u].edges.map((id) => this.edges[id]).find((ed) => (ed.a === u && ed.b === v) || (ed.a === v && ed.b === u));
      if (!e) return [];
      const tiles = e.a === u ? e.tiles : [...e.tiles].reverse();
      out.push(...tiles.slice(1));
    }
    return out;
  }

  /** The node nearest a tile (by straight-line distance). */
  nearestNode(t: Pt): number {
    let best = 0;
    for (const n of this.nodes) if (Math.hypot(n.x - t.x, n.y - t.y) < Math.hypot(this.nodes[best].x - t.x, this.nodes[best].y - t.y)) best = n.id;
    return best;
  }

  /** The lane point nearest a tile (for a van's dock or a bus stop). */
  nearest(t: Pt, accept: (l: Lane) => boolean = () => true): { lane: Lane; s: number; d: number } | undefined {
    let best: { lane: Lane; s: number; d: number } | undefined;
    for (const l of this.lanes) {
      if (!accept(l)) continue;
      for (let s = 0; s <= l.len; s += 0.25) {
        const p = pointAt(l.pts, l.cum, s);
        const d = Math.hypot(p.x - t.x, p.y - t.y);
        if (!best || d < best.d) best = { lane: l, s, d };
      }
    }
    return best;
  }

  /** Every node reachable from the first one (the graph is one network). */
  connected() {
    const seen = new Set<number>([0]);
    const stack = [0];
    while (stack.length) {
      const u = stack.pop()!;
      for (const e of this.nodes[u].edges) {
        const ed = this.edges[e];
        for (const v of [ed.a, ed.b]) if (!seen.has(v)) seen.add(v), stack.push(v);
      }
    }
    return seen.size === this.nodes.length;
  }
}

const dir = (a: Pt, b: Pt): Pt => ({ x: Math.sign(Math.round((b.x - a.x) * 1000)), y: Math.sign(Math.round((b.y - a.y) * 1000)) });

/** A lane beside a run of tiles: from the edge of the first tile's box to the edge of the last one's, kept to the right. */
function lanePoints(tiles: readonly Tile[]): Pt[] {
  const pts: Pt[] = [];
  const step = (i: number) => ({ x: tiles[i + 1].x - tiles[i].x, y: tiles[i + 1].y - tiles[i].y });
  const first = step(0);
  const r0 = right(first.x, first.y);
  pts.push({ x: tiles[0].x + first.x / 2 + r0.x, y: tiles[0].y + first.y / 2 + r0.y });
  for (let i = 1; i < tiles.length - 1; i++) {
    const a = step(i - 1);
    const b = step(i);
    const ra = right(a.x, a.y);
    const rb = right(b.x, b.y);
    if (a.x === b.x && a.y === b.y) continue; // straight on: the end points carry the line
    pts.push({ x: tiles[i].x + ra.x + rb.x, y: tiles[i].y + ra.y + rb.y });
  }
  const last = step(tiles.length - 2);
  const rl = right(last.x, last.y);
  const end = tiles[tiles.length - 1];
  pts.push({ x: end.x - last.x / 2 + rl.x, y: end.y - last.y / 2 + rl.y });
  return pts;
}

/** A zebra crossing in the core: the road tile either side of a junction (src/game/CityMap.ts groundKey draws them). */
export function isZebra(x: number, y: number) {
  if (x < 0 || y < 0 || x >= GRID || y >= GRID) return false;
  const m = PLOT + ROAD;
  const rx = x % m === 0;
  const ry = y % m === 0;
  if (rx === ry) return false;
  const along = rx ? y % m : x % m;
  return along === 1 || along === m - 1;
}
