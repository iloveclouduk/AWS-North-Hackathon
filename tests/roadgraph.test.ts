import { describe, expect, it } from 'vitest';
import facts from '../shared/region-facts.json' with { type: 'json' };
import { isZebra, LANE_OFFSET, measure, pointAt, RoadGraph } from '@/game/RoadGraph';
import { riverLoop, seaLane } from '@/game/waterways';
import { azsFor, GRID, isRoad } from '@/world/layout';
import { zonesFor } from '@/world/regions';
import { GATE, outside, RIVER, terrainFor, type Terrain } from '@/world/terrain';

const REGION_CODES = Object.keys((facts as { regions: Record<string, unknown> }).regions);
const graphFor = (code: string) => {
  const t = terrainFor(code, zonesFor(code));
  return { t, g: new RoadGraph(t) };
};

/** A tile a vehicle may be on: a core road, the highway, a bridge, or a road out past a bridge. */
const drivable = (t: Terrain, x: number, y: number) => {
  if (outside(x, y) === 0) return isRoad({ x, y });
  const k = t.kind(x, y);
  return k === 'highway' || k === 'bridge' || t.roads.some((r) => r.x === x && r.y === y);
};

describe('road graph (plan B3)', () => {
  it.each(REGION_CODES)('%s: one connected network with the junctions, the gate and the highway end', (code) => {
    const { g } = graphFor(code);
    expect(g.connected()).toBe(true);
    const junctions = g.nodes.filter((n) => n.x % 13 === 0 && n.y % 13 === 0 && outside(n.x, n.y) === 0);
    expect(junctions).toHaveLength(16);
    expect(g.nodes[g.gate]).toMatchObject({ x: GATE.x, y: GATE.y });
    expect(g.nodes[g.highwayEnd].x).toBeGreaterThan(GRID + RIVER.to);
    expect(g.nodes[g.highwayEnd].y).toBe(GATE.y);
  });

  it.each(REGION_CODES)('%s: every lane and junction connector stays on the road', (code) => {
    const { t, g } = graphFor(code);
    const check = (pts: { x: number; y: number }[], what: string) => {
      const m = measure(pts);
      for (let s = 0; s <= m.len + 1e-9; s += 0.1) {
        const p = pointAt(pts, m.cum, s);
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        expect(drivable(t, x, y), `${what} at ${p.x.toFixed(2)},${p.y.toFixed(2)}`).toBe(true);
      }
    };
    for (const l of g.lanes) {
      check(l.pts, `lane ${l.from}→${l.to}`);
      for (const out of g.lanesFrom(l.to)) check(g.connector(l, out), `turn ${l.from}→${l.to}→${out.to}`);
    }
  });

  it('lanes keep to the right of travel, 0.22 tiles off the centre line', () => {
    const { g } = graphFor('us-east-1');
    // Along the top road (y = 0) heading +x (screen SE) the right is +y; heading −x it's −y.
    const a = g.node(0, 0)!;
    const b = g.node(13, 0)!;
    const east = g.laneBetween(a, b)!;
    const west = g.laneBetween(b, a)!;
    for (const p of east.pts) expect(p.y).toBeCloseTo(LANE_OFFSET);
    for (const p of west.pts) expect(p.y).toBeCloseTo(-LANE_OFFSET);
  });

  it('a route joins every pair of junctions, the gate and the highway end (and is cached)', () => {
    for (const code of ['us-east-1', 'eu-north-1', 'ap-southeast-1', 'me-central-1']) {
      const { g } = graphFor(code);
      const ends = [...g.nodes.filter((n) => n.kind === 'junction').map((n) => n.id), g.gate, g.highwayEnd];
      for (const a of ends)
        for (const b of ends) {
          const r = g.route(a, b);
          expect(r[0], `${code} ${a}→${b}`).toBe(a);
          expect(r[r.length - 1]).toBe(b);
          for (let i = 1; i < r.length; i++) expect(g.laneBetween(r[i - 1], r[i])).toBeDefined();
        }
      expect(g.route(g.highwayEnd, ends[0])).toBe(g.route(g.highwayEnd, ends[0]));
    }
  });

  it('the highway lanes are the fast ones, and only they reach the highway end', () => {
    const { g } = graphFor('us-west-2');
    const into = g.lanes.filter((l) => l.to === g.highwayEnd);
    expect(into).toHaveLength(1);
    expect(into[0].highway).toBe(true);
    expect(g.lanes.filter((l) => !l.highway).every((l) => l.to !== g.highwayEnd && l.from !== g.highwayEnd)).toBe(true);
  });

  it('zebra crossings sit either side of each junction, as CityMap draws them', () => {
    expect(isZebra(13, 1)).toBe(true);
    expect(isZebra(13, 12)).toBe(true);
    expect(isZebra(1, 26)).toBe(true);
    expect(isZebra(13, 13)).toBe(false);
    expect(isZebra(13, 5)).toBe(false);
    expect(isZebra(5, 5)).toBe(false);
    expect(isZebra(-1, 1)).toBe(false);
  });
});

describe('AZ islands on the road network (plan B4)', () => {
  it.each(['us-east-1', 'us-west-2', 'eu-west-1'])('%s: each island road is a dead end, and island to island crosses both bridges', (code) => {
    const { t, g } = graphFor(code);
    const islands = azsFor(code);
    expect(t.islands.map((i) => i.slot)).toEqual(islands.map((i) => i.slot));
    const ends = islands.map((az) => g.node(az.bridge.end.x, az.bridge.end.y));
    for (const [i, n] of ends.entries()) expect(n, islands[i].slot).toBeDefined();
    for (const n of ends) expect(g.nodes[n!].kind).toBe('deadEnd');
    for (const az of islands) for (const tt of az.bridge.tiles) expect(g.isRoad(tt.x, tt.y), `${az.slot} ${tt.x},${tt.y}`).toBe(true);
    const path = g.routeTiles(ends[0]!, ends[1]!);
    const crosses = (az: (typeof islands)[number]) => az.bridge.tiles.every((b) => path.some((p) => p.x === b.x && p.y === b.y));
    expect(crosses(islands[0]) && crosses(islands[1])).toBe(true);
    // Through downtown: the route touches the core.
    expect(path.some((p) => outside(p.x, p.y) === 0)).toBe(true);
    for (let i = 1; i < path.length; i++) expect(Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y)).toBe(1);
  });
});

describe('boat lanes', () => {
  it('the river loop runs down the middle of the river all round', () => {
    const t = terrainFor('us-east-1', zonesFor('us-east-1'));
    const pts = riverLoop((RIVER.from + RIVER.to) / 2);
    const m = measure(pts);
    for (let s = 0; s <= m.len; s += 0.5) {
      const p = pointAt(pts, m.cum, s);
      expect(['river', 'bridge']).toContain(t.kind(Math.round(p.x), Math.round(p.y)));
    }
  });

  it.each(REGION_CODES)('%s: a sea lane, when there is one, is open sea', (code) => {
    const t = terrainFor(code, zonesFor(code));
    const lane = seaLane(t);
    if (!lane) return;
    const m = measure(lane);
    for (let s = 0; s <= m.len; s += 0.5) {
      const p = pointAt(lane, m.cum, s);
      expect(t.kind(Math.round(p.x), Math.round(p.y))).toBe('sea');
    }
  });
});
