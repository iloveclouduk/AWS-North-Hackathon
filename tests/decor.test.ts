import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { clearBehind, decorPlan, drawnBehind, siteGround, tilesOf, TOWER_STEPS, towerCount, type DecorWorld, type TowerSize } from '@/game/decor';
import { CAMPUS_PLOT, DAY1_PLOT, DISTRICT_PLOTS, GRID, isRoad, LANDMARKS, PLOT, plotAt } from '@/world/layout';
import { findPath } from '@/game/pathfinding';

// Mirror CityMap: footprints block, the sidewalk is the ring next to a road.
const key = (x: number, y: number) => y * GRID + x;
const foot = new Set<number>();
for (const l of LANDMARKS) for (let y = l.footprint.y; y < l.footprint.y + l.footprint.h; y++) for (let x = l.footprint.x; x < l.footprint.x + l.footprint.w; x++) foot.add(key(x, y));
const sidewalk = (x: number, y: number) =>
  !isRoad({ x, y }) && !foot.has(key(x, y)) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isRoad({ x: x + dx, y: y + dy }));

const world = (open: boolean): DecorWorld => ({ landmarks: LANDMARKS, isSidewalk: sidewalk, districtOpen: () => open, tierOf: () => (open ? 1 : -1) });

describe.each([
  ['every district locked', false],
  ['every district open', true],
])('decor with %s', (_name, open) => {
  const plan = decorPlan(world(open));
  const blocked = new Set(foot);
  for (const d of plan) if (d.block) for (const t of tilesOf(d)) blocked.add(key(t.x, t.y));

  it('never stands on a road, a sidewalk or a work spot', () => {
    const spots = new Set(LANDMARKS.map((l) => key(l.workSpot.x, l.workSpot.y)));
    for (const d of plan)
      for (const t of tilesOf(d)) {
        expect(isRoad(t), `${d.sprite} on road`).toBe(false);
        expect(sidewalk(t.x, t.y), `${d.sprite} on sidewalk ${t.x},${t.y}`).toBe(false);
        expect(spots.has(key(t.x, t.y)), `${d.sprite} on a work spot ${t.x},${t.y}`).toBe(false);
      }
  });

  it('keeps every work spot reachable from the road', () => {
    const from = { x: 0, y: 0 };
    for (const l of LANDMARKS) {
      const path = findPath(from, l.workSpot, GRID, GRID, (x, y) => x >= 0 && y >= 0 && x < GRID && y < GRID && !blocked.has(key(x, y)));
      expect(path.length, `${l.id} at ${l.workSpot.x},${l.workSpot.y}`).toBeGreaterThan(0);
    }
  });

  it('is deterministic', () => {
    expect(decorPlan(world(open))).toEqual(plan);
  });
});

describe('plot decor', () => {
  it('locked districts get hoardings and a billboard; open ones lose them', () => {
    const locked = decorPlan(world(false));
    const open = decorPlan(world(true));
    for (const [id, p] of Object.entries(DISTRICT_PLOTS)) {
      const inPlot = (d: { x: number; y: number }) => plotAt(d) === id;
      expect(locked.filter(inPlot).some((d) => d.sprite.startsWith('hoarding')), id).toBe(true);
      expect(locked.filter(inPlot).filter((d) => d.sprite === 'billboard').length, id).toBe(1);
      expect(open.filter(inPlot).some((d) => d.sprite.startsWith('hoarding') || d.sprite === 'billboard'), id).toBe(false);
      void p;
    }
  });

  it('undiscovered lots in open districts get a lot sign', () => {
    const plan = decorPlan({ ...world(true), tierOf: () => -1 });
    expect(plan.filter((d) => d.sprite === 'lotSign').length).toBe(LANDMARKS.filter((l) => l.districtId && !l.id.startsWith('hq:')).length);
  });

  it('the Day 1 walk is paved and so is the Global Gate forecourt (data centres live on the AZ islands)', () => {
    expect(siteGround('day1', { x: DAY1_PLOT.rect.x + 4, y: DAY1_PLOT.rect.y + 7 })).toBe('paver');
    expect(siteGround('campus', { x: CAMPUS_PLOT.rect.x + 6, y: CAMPUS_PLOT.rect.y + 9 })).toBe('paver');
    for (let y = CAMPUS_PLOT.rect.y; y < CAMPUS_PLOT.rect.y + PLOT; y++)
      for (let x = CAMPUS_PLOT.rect.x; x < CAMPUS_PLOT.rect.x + PLOT; x++) expect(siteGround('campus', { x, y })).not.toBe('floorGrate');
  });

  it('a global landmark\'s undiscovered lot gets its sign even while its district is locked', () => {
    const plan = decorPlan({ ...world(false), tierOf: () => -1 });
    for (const l of LANDMARKS.filter((x) => x.global)) expect(plan.some((d) => d.sprite === 'lotSign' && d.x === l.footprint.x + 1 && d.y === l.footprint.y + l.footprint.h - 1), l.id).toBe(true);
  });
});

describe('homes', () => {
  const homes = (tier: number) => decorPlan({ ...world(true), tierOf: () => tier }).filter((d) => d.sprite.startsWith('house:'));

  it('open districts have homes on street-facing grass, and more of them (and flats) as the district grows', () => {
    const small = homes(1);
    const grown = homes(4);
    expect(small.length).toBeGreaterThan(3);
    expect(grown.length).toBeGreaterThan(small.length);
    expect(small.some((d) => d.sprite.startsWith('house:flats'))).toBe(false);
    expect(grown.some((d) => d.sprite.startsWith('house:flats'))).toBe(true);
    for (const d of grown) expect([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => sidewalk(d.x + dx, d.y + dy)), `${d.sprite} at ${d.x},${d.y} faces a street`).toBe(true);
  });

  it('locked districts have none', () => {
    expect(decorPlan(world(false)).some((d) => d.sprite.startsWith('house:'))).toBe(false);
  });

  it('every home sprite exists in the atlas', async () => {
    const { sprites } = (await import('../public/assets/city/sprites.json', { with: { type: 'json' } })).default as { sprites: Record<string, unknown> };
    for (const d of homes(4)) expect(sprites[d.sprite], d.sprite).toBeTruthy();
  });
});

describe('the skyline grows with what you learn', () => {
  const at = (tier: number): DecorWorld => ({ landmarks: LANDMARKS, isSidewalk: sidewalk, districtOpen: () => true, tierOf: () => tier });
  const towersIn = (plan: ReturnType<typeof decorPlan>) => plan.filter((d) => d.sprite.startsWith('tower:'));
  const sprites = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../public/assets/city/sprites.json'), 'utf8')).sprites as Record<string, { ay: number }>;

  it('no towers at level 0, more and taller ones as the landmarks level up', () => {
    expect(towersIn(decorPlan(at(0)))).toHaveLength(0);
    const counts = [1, 2, 3, 4].map((t) => towersIn(decorPlan(at(t))).length);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    expect(towersIn(decorPlan(at(1))).every((d) => d.sprite.endsWith(':mid'))).toBe(true);
    expect(towersIn(decorPlan(at(4))).some((d) => d.sprite.endsWith(':sky'))).toBe(true);
    expect(towerCount(4)).toBe(8);
  });

  it('every district grows its own towers, drawn in the atlas, never in front of a landmark', () => {
    const plan = decorPlan(at(4));
    const towers = towersIn(plan);
    for (const id of Object.keys(DISTRICT_PLOTS)) expect(towers.some((d) => d.sprite.startsWith(`tower:${id}:`)), id).toBe(true);
    for (const t of towers) {
      expect(sprites[t.sprite], t.sprite).toBeTruthy();
      const size = t.sprite.split(':')[2] as TowerSize;
      // The constant matches the drawing: its height above the base, in 8 px steps.
      expect(TOWER_STEPS[size], t.sprite).toBeGreaterThanOrEqual(Math.ceil(sprites[t.sprite].ay / 8));
      const owner = (x: number, y: number) => LANDMARKS.find((l) => x >= l.footprint.x && y >= l.footprint.y && x < l.footprint.x + l.footprint.w && y < l.footprint.y + l.footprint.h);
      expect(clearBehind(t.x, t.y, (x, y) => drawnBehind(owner(x, y), t.x + t.y)), `${t.sprite} at ${t.x},${t.y}`).toBeGreaterThanOrEqual(TOWER_STEPS[size]);
    }
  });

  it('a fully grown city still lets everyone reach every work spot', () => {
    const blocked = new Set(foot);
    for (const d of decorPlan(at(4))) if (d.block) for (const t of tilesOf(d)) blocked.add(key(t.x, t.y));
    for (const l of LANDMARKS) {
      const p = findPath({ x: 0, y: 0 }, l.workSpot, GRID, GRID, (x, y) => x >= 0 && y >= 0 && x < GRID && y < GRID && !blocked.has(key(x, y)));
      expect(p.length, l.id).toBeGreaterThan(0);
    }
  });
});
