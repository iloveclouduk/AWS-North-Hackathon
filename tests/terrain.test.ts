import { describe, expect, it } from 'vitest';
import facts from '../shared/region-facts.json' with { type: 'json' };
import { GRID } from '@/world/layout';
import { neighbours, zonesFor } from '@/world/regions';
import { GATE, MAX_PROPS, outside, RING_MAX, RING_MIN, RIVER, ROAD_LINES, terrainFor } from '@/world/terrain';

const REGION_CODES = Object.keys((facts as { regions: Record<string, unknown> }).regions);

const snapshot = (code: string) => {
  const t = terrainFor(code, zonesFor(code));
  const kinds: string[] = [];
  for (let y = RING_MIN; y <= RING_MAX; y++) for (let x = RING_MIN; x <= RING_MAX; x++) kinds.push(t.kind(x, y));
  return { kinds: kinds.join(','), props: JSON.stringify(t.props), bridges: JSON.stringify(t.bridges) };
};

describe('terrain round the city', () => {
  it('is deterministic per Region, and differs between Regions', () => {
    expect(snapshot('us-east-1')).toEqual(snapshot('us-east-1'));
    expect(snapshot('eu-west-1').kinds).not.toEqual(snapshot('ap-southeast-2').kinds);
  });

  it.each(REGION_CODES)('%s builds: no terrain inside the core, a river all round, props within budget', (code) => {
    const t = terrainFor(code, zonesFor(code));
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) expect(t.kind(x, y)).toBe('core');
    for (const p of t.props) {
      for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) expect(outside(x, y), `${p.sprite} at ${x},${y}`).toBeGreaterThan(0);
    }
    for (let y = RING_MIN; y <= RING_MAX; y++)
      for (let x = RING_MIN; x <= RING_MAX; x++) {
        const d = outside(x, y);
        if (d >= RIVER.from && d <= RIVER.to) expect(['river', 'bridge']).toContain(t.kind(x, y));
        if (d === 0) expect(t.ground(x, y)).toBeUndefined();
      }
    expect(t.props.length).toBeLessThanOrEqual(MAX_PROPS);
    expect(t.bounds.w).toBeGreaterThan(0);
    expect(t.bounds.h).toBeGreaterThan(0);
  });

  it.each(REGION_CODES)('%s: the highway runs unbroken from the gate to the edge of the map', (code) => {
    const t = terrainFor(code, zonesFor(code));
    expect(t.gate).toEqual(GATE);
    for (let x = GATE.x + 1; x <= RING_MAX; x++) expect(['highway', 'bridge'], `${x},${GATE.y}`).toContain(t.kind(x, GATE.y));
    expect(t.highway.at(-1)).toEqual({ x: RING_MAX, y: GATE.y });
    expect(t.props.some((p) => p.sprite === 'gateArch')).toBe(true);
  });

  it('bridges only where a core road line meets the river, each one ending on land', () => {
    for (const code of REGION_CODES) {
      const t = terrainFor(code, zonesFor(code));
      for (const b of t.bridges) {
        if (!b.highway) expect(ROAD_LINES).toContain(b.line as (typeof ROAD_LINES)[number]);
        expect(b.tiles.length).toBe(RIVER.to - RIVER.from + 1);
        for (const tile of b.tiles) expect(t.kind(tile.x, tile.y)).toBe('bridge');
      }
    }
  });

  it.each(REGION_CODES)('%s: one fenced island per AZ, with its data halls, water round it and a bridge in', (code) => {
    const zones = zonesFor(code);
    const t = terrainFor(code, zones);
    expect(t.islands).toHaveLength(Math.min(6, zones.length));
    for (const isl of t.islands) {
      const r = isl.rect;
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) expect(t.kind(x, y)).toBe('island');
      // Water on the landward sides (the river is on the fourth).
      for (let x = r.x; x < r.x + r.w; x++) expect(['sea', 'river']).toContain(t.kind(x, r.y - 1));
      for (let y = r.y; y < r.y + r.h; y++) expect(['sea', 'river']).toContain(t.kind(r.x - 1, y));
      const inside = (p: { x: number; y: number }) => p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;
      const kit = t.props.filter(inside).map((p) => p.sprite);
      expect(kit.filter((s) => s.startsWith('pack:data_center')).length, isl.slot).toBeGreaterThanOrEqual(2);
      for (const s of ['substation2x2', 'coolingTower', 'azSign']) expect(kit, `${isl.slot} ${s}`).toContain(s);
      expect(isl.road.length).toBeGreaterThan(0);
      expect(t.bridges.some((b) => !b.highway && b.side === isl.side && b.line === Number(isl.slot.slice(1)))).toBe(true);
      expect(isl.fences.length).toBeGreaterThan(20);
    }
  });

  it('signs point at real neighbouring Regions', () => {
    const t = terrainFor('us-east-1', zonesFor('us-east-1'));
    expect(t.destinations.map((d) => d.code)).toEqual(neighbours('us-east-1').map((r) => r.code));
    expect(t.props.filter((p) => p.role === 'sign').map((p) => p.to)).toEqual(t.destinations.map((d) => d.code));
  });
});

describe('neighbours', () => {
  it.each(REGION_CODES)('%s has 2 distinct other Regions, nearest first', (code) => {
    const n = neighbours(code);
    expect(n).toHaveLength(2);
    expect(new Set(n.map((r) => r.code)).size).toBe(2);
    expect(n.map((r) => r.code)).not.toContain(code);
    expect(neighbours(code)).toEqual(n);
  });

  it('knows the obvious pairs', () => {
    expect(neighbours('us-east-1')[0].code).toBe('us-east-2');
    expect(neighbours('ap-southeast-2')[0].code).toBe('ap-southeast-4');
    // GovCloud's neighbours are GovCloud (another partition is a separate network).
    expect(neighbours('us-gov-west-1')[0].code).toBe('us-gov-east-1');
  });
});

describe('suburbs', () => {
  it.each(['us-east-1', 'eu-west-1', 'me-south-1', 'ap-southeast-2'])('%s has homes beyond the river, each beside a road or the highway', (code) => {
    const t = terrainFor(code, zonesFor(code));
    const homes = t.props.filter((p) => p.role === 'home');
    expect(homes.length).toBeGreaterThan(4);
    const road = new Set([...t.roads, ...t.highway].map((r) => `${r.x},${r.y}`));
    for (const h of homes) {
      expect(outside(h.x, h.y)).toBeGreaterThan(RIVER.to + 1);
      const tiles = Array.from({ length: h.w }, (_, i) => ({ x: h.x + i, y: h.y }));
      expect(tiles.some((p) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => road.has(`${p.x + a},${p.y + b}`))), `${h.sprite} at ${h.x},${h.y}`).toBe(true);
    }
  });
});
