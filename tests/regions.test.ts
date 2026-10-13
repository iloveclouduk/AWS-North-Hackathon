import { describe, expect, it } from 'vitest';
import flavour from '../shared/region-flavour.json' with { type: 'json' };
import { demoInventory } from '@/backend/mockAccount';
import { useCity } from '@/state/store';
import { REGIONS } from '@/world/culture';
import { azCounts, azIndex, azsFor, inRect, isRoad, RIVER } from '@/world/layout';
import { outside } from '@/world/terrain';
import { friendlyRegionLine, nearestOffering, offered, zonesFor } from '@/world/regions';

describe('each Region is its own city', () => {
  it('the world map picks a Region, which is remembered, and the city zooms in', () => {
    const s = useCity.getState();
    s.openWorld();
    expect(useCity.getState().view).toEqual({ name: 'world' });
    s.enterRegion('eu-west-1');
    expect(useCity.getState()).toMatchObject({ cityRegion: 'eu-west-1', view: { name: 'city' } });
    expect(useCity.getState().prefs.region).toBe('eu-west-1');
    s.enterRegion('not-a-region');
    expect(useCity.getState().cityRegion).toBe('eu-west-1');
    s.enterRegion(REGIONS.cityRegion);
  });

  it("draws each Region's real AZs as islands across the river, each with a bridge to a core road", () => {
    for (const [code, n] of [['us-east-1', 6], ['us-west-2', 4], ['eu-west-1', 3], ['ca-central-1', 3]] as const) {
      const islands = azsFor(code);
      expect(islands.length, code).toBe(n);
      expect(new Set(islands.map((i) => i.slot)).size, code).toBe(n);
      for (const [i, az] of islands.entries()) {
        const r = az.rect;
        // Clear of the core and the river (and the promenade between them).
        for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) expect(outside(x, y), `${code} ${az.id} ${x},${y}`).toBeGreaterThan(RIVER.to);
        // No two islands overlap (nor touch: each has water round it).
        for (const other of islands.slice(i + 1)) {
          const o = other.rect;
          const apart = r.x + r.w < o.x || o.x + o.w < r.x || r.y + r.h < o.y || o.y + o.h < r.y;
          expect(apart, `${code}: ${az.slot} / ${other.slot}`).toBe(true);
        }
        // The bridge starts on a core road tile, crosses the river on that road's line and ends on the island.
        const { core, tiles, end } = az.bridge;
        expect(outside(core.x, core.y), `${code} ${az.slot}`).toBe(0);
        expect(isRoad(core), `${code} ${az.slot}`).toBe(true);
        for (const t of tiles) expect(az.side === 'N' ? t.x : t.y).toBe(az.line);
        for (let d = RIVER.from; d <= RIVER.to; d++) expect(tiles.some((t) => outside(t.x, t.y) === d), `${code} ${az.slot} river ${d}`).toBe(true);
        expect(inRect(end, r), `${code} ${az.slot}`).toBe(true);
      }
    }
    expect(azsFor('us-east-1').map((a) => a.id)).toEqual(['use1-az1', 'use1-az2', 'use1-az3', 'use1-az4', 'use1-az5', 'use1-az6']);
    // ca-central-1 has no az3: AZ IDs aren't always consecutive.
    expect(azsFor('ca-central-1').map((a) => a.id)).toEqual(['cac1-az1', 'cac1-az2', 'cac1-az4']);
    // No published AZ IDs (GovCloud): the documented minimum of three.
    expect(azsFor('us-gov-west-1')).toHaveLength(3);
  });

  it("places an AZ by the account's own name → AZ ID mapping, else by its letter", () => {
    const account = [
      { name: 'us-west-2a', id: 'usw2-az2' },
      { name: 'us-west-2b', id: 'usw2-az1' },
      { name: 'us-west-2c', id: 'usw2-az3' },
    ];
    const islands = azsFor('us-west-2', account);
    expect(islands.map((b) => `${b.name}=${b.id}`)).toEqual(['us-west-2a=usw2-az2', 'us-west-2b=usw2-az1', 'us-west-2c=usw2-az3']);
    expect([azIndex(islands, 'us-west-2b'), azIndex(islands, 'usw2-az3'), azIndex(islands, 'usw2-az4')]).toEqual([1, 2, undefined]);
    const plain = azsFor('us-west-2');
    expect([azIndex(plain, 'us-west-2a'), azIndex(plain, 'us-west-2d'), azIndex(plain, 'us-west-2e')]).toEqual([0, 3, undefined]);
    expect(zonesFor('us-west-2', account)).toHaveLength(3);
  });

  it("counts the player's resources on each island: items with an AZ in this Region only", () => {
    const islands = azsFor('us-west-2');
    const inv = {
      homeRegion: 'us-west-2',
      items: [
        { az: 'us-west-2a' },
        { az: 'usw2-az2', region: 'us-west-2' },
        { az: 'us-west-2a', region: 'us-west-2' },
        { az: 'us-east-1a', region: 'us-east-1' },
        { region: 'us-west-2' },
      ],
    };
    expect(azCounts(islands, inv, 'us-west-2')).toEqual([2, 1, 0, 0]);
    expect(azCounts(islands, undefined, 'us-west-2')).toEqual([undefined, undefined, undefined, undefined]);
    // The demo account's instances stand on the home city's islands.
    const demo = demoInventory();
    const home = demo.homeRegion!;
    expect(azCounts(azsFor(home), demo, home).reduce((a, b) => a! + b!, 0)).toBeGreaterThan(0);
  });

  it('each Region offers its own services, and points to the nearest Region that has a missing one', () => {
    expect(offered('ec2', 'af-south-1')).toBe(true);
    const missing = ['af-south-1', 'ap-east-2', 'mx-central-1'].flatMap((r) => ['agentcore', 'neptune', 'textract', 'beanstalk'].filter((s) => !offered(s, r)).map((s) => [s, r]));
    expect(missing.length).toBeGreaterThan(0);
    for (const [s, r] of missing) {
      const near = nearestOffering(s, r);
      expect(near.length, `${s} near ${r}`).toBeGreaterThan(0);
      for (const n of near) expect(offered(s, n.code)).toBe(true);
    }
    // Same partition first: from GovCloud West, the nearest commercial Region isn't picked over GovCloud East.
    const gov = nearestOffering('lambda', 'us-gov-west-1', 1)[0];
    expect(gov.code).toBe('us-gov-east-1');
  });

  it('the demo account has cities in several Regions, with data links between Regions and between AZs', () => {
    const inv = demoInventory();
    expect(Object.keys(inv.regions ?? {}).length).toBeGreaterThanOrEqual(3);
    expect(inv.homeRegion).toBe(REGIONS.cityRegion);
    expect(inv.links?.some((l) => l.from.region !== l.to.region)).toBe(true);
    expect(inv.links?.some((l) => l.from.region === l.to.region && l.from.az && l.to.az && l.from.az !== l.to.az)).toBe(true);
    // The home city's counts are its own Region (and global resources) only.
    const outside = inv.items.filter((i) => i.region && i.region !== inv.homeRegion && i.region !== 'global').length;
    const counted = Object.values(inv.counts).reduce((a, b) => a + b, 0);
    expect(counted).toBe(inv.items.length - outside);
    for (const l of inv.links ?? []) for (const end of [l.from, l.to]) expect(REGIONS.regions.some((r) => r.code === end.region), end.region).toBe(true);
  });
});

describe('the world map speaks plainly', () => {
  it('one friendly line per Region: no AZs, opt-in or prices', () => {
    for (const r of REGIONS.regions) {
      for (const status of [undefined, 'not-enabled'] as const) {
        const line = friendlyRegionLine(r.code, status);
        expect(line, r.code).toContain(r.city);
        expect(line, r.code).not.toMatch(/\bAZs?\b|opt-in|\$/i);
      }
    }
  });

  it('says when a Region is the suggested start, switched off, or in another partition', () => {
    expect(friendlyRegionLine(REGIONS.cityRegion)).toMatch(/great place to start/);
    expect(friendlyRegionLine('ap-east-1', 'not-enabled')).toMatch(/switched off in your account/);
    expect(friendlyRegionLine('us-gov-west-1')).toMatch(/GovCloud.*its own account/);
    expect(friendlyRegionLine('eusc-de-east-1')).toMatch(/own account/);
    expect(friendlyRegionLine('not-a-region')).toBe('Pick a place to build your city!');
  });
});

// Appended (not in the header) so this block stays independent of edits above; ESM hoists imports.
import { neighbours, regionFacts } from '@/world/regions';
import { roads } from '@/game/worldmap';

describe('neighbouring Regions (city highway signs, the world map highways)', () => {
  const partition = (code: string) => regionFacts(code)?.partition ?? 'aws';

  it('never lists the Region itself, and lists distinct Regions, its own partition first', () => {
    for (const r of REGIONS.regions) {
      const ns = neighbours(r.code).map((n) => n.code);
      expect(ns, r.code).not.toContain(r.code);
      expect(new Set(ns).size, r.code).toBe(ns.length);
      expect(ns.length, r.code).toBe(2);
      const alone = REGIONS.regions.filter((x) => partition(x.code) === partition(r.code)).length === 1;
      if (!alone) expect(partition(ns[0]), r.code).toBe(partition(r.code));
    }
  });

  it('every Region is somebody\'s neighbour, except edge Regions of a crowded continent and a one-Region partition', () => {
    // Nearest-two isn't symmetric: Stockholm and Spain are nobody's nearest two in dense Europe, and the European
    // Sovereign Cloud is alone in its partition (everyone else lists their own partition first). The world map draws
    // highways both ways (roads()), so each of these still has roads drawn from the Regions it lists.
    const listed = new Set(REGIONS.regions.flatMap((r) => neighbours(r.code).map((n) => n.code)));
    const unlisted = REGIONS.regions.filter((r) => !listed.has(r.code)).map((r) => r.code);
    expect(unlisted.length).toBeLessThanOrEqual(3);
    for (const code of unlisted) {
      const alone = REGIONS.regions.filter((x) => partition(x.code) === partition(code)).length === 1;
      const ns = neighbours(code);
      // Its own nearest are next door: in its partition, or (alone in it) the nearest commercial Regions.
      if (!alone) expect(partition(ns[0].code), code).toBe(partition(code));
      for (const n of ns) expect(roads(n.code).map((x) => x.code), `${n.code} → ${code}`).toContain(code);
    }
  });

  it('the world map highways run both ways and never loop back to the same Region', () => {
    // Not one connected network: nearest-two keeps Europe and Australia/New Zealand as their own clusters, which is
    // what the map should show (highways to neighbours, not a route planner).
    for (const r of REGIONS.regions) {
      const out = roads(r.code).map((x) => x.code);
      expect(out, r.code).not.toContain(r.code);
      expect(out.length, r.code).toBeGreaterThanOrEqual(2);
      for (const n of out) expect(roads(n).map((x) => x.code), `${n} → ${r.code}`).toContain(r.code);
    }
  });
});

describe('Region flavour', () => {
  it('every Region has a hello', () => {
    for (const r of REGIONS.regions) expect((flavour as { regions: Record<string, { hello: string }> }).regions[r.code]?.hello, r.code).toBeTruthy();
  });
});
