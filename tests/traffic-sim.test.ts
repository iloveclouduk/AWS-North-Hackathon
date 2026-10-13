// Drives the real Traffic for a few simulated minutes with Phaser stubbed out: vehicles keep their gap, share no
// junction box, stay under the cap, keep moving (no gridlock), and come and go at the highway end.
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { BlendModes: { ADD: 1 } } }));
// Seeded, so the run is the same every time.
vi.mock('@/game/rng', async (orig) => {
  const m = await orig<typeof import('@/game/rng')>();
  return { ...m, rand: m.mulberry32(7) };
});
vi.mock('@/game/assets', () => {
  const img = () => {
    const o: Record<string, unknown> = { visible: true, frame: { name: '' }, x: 0, y: 0, depth: 0 };
    const chain = (f: (...a: unknown[]) => void) => (...a: unknown[]) => (f(...a), o);
    Object.assign(o, {
      setFrame: chain((n) => ((o.frame as { name: string }).name = n as string)),
      setVisible: chain((v) => (o.visible = v)),
      setPosition: chain((x, y) => ((o.x = x), (o.y = y))),
      setDepth: chain((d) => (o.depth = d)),
      setOrigin: chain(() => {}),
      setAlpha: chain(() => {}),
      setBlendMode: chain(() => {}),
      setInteractive: chain(() => (o.interactive = true)),
      disableInteractive: chain(() => (o.interactive = false)),
      on: chain((ev, fn) => (o.handler = fn)),
      removeAllListeners: chain(() => (o.handler = undefined)),
      destroy: () => {},
    });
    return o;
  };
  return { addSprite: () => img(), hasSprite: () => true, spriteAnchor: () => ({ ax: 18, ay: 16, w: 36, h: 36 }) };
});

const { Traffic, GAP } = await import('@/game/Traffic');
const { RoadGraph, isZebra } = await import('@/game/RoadGraph');
const { terrainFor } = await import('@/world/terrain');
const { zonesFor } = await import('@/world/regions');

type V = { lane: { id: number; to: number }; s: number; box?: { node: number }; parked: boolean };

describe('traffic simulation', () => {
  it.each(['us-east-1', 'eu-west-2', 'ap-southeast-1'])('%s: gaps kept, boxes exclusive, no gridlock', (code) => {
    const t = terrainFor(code, zonesFor(code));
    const graph = new RoadGraph(t);
    // Two people on crossings for the first 20 s (then they've crossed), one who stays and chats on a crossing.
    const crossing = [{ x: 13, y: 1 }, { x: 26, y: 12 }];
    const chatting = { x: 1, y: 13 };
    let clock = 0;
    const peds = () => (clock < 20_000 ? [...crossing, chatting] : [chatting]);
    const traffic = new Traffic({} as never, graph, { pedestrians: peds, isBridge: (x, y) => t.kind(x, y) === 'bridge', isZebra });
    traffic.setTarget(14, 14);
    traffic.populate();
    const view = { contains: () => true } as never;
    const vehicles = (traffic as unknown as { vehicles: V[] }).vehicles;
    let moved = 0;
    let removedAtEnd = 0;
    const seen = new Set<unknown>();
    for (let f = 0; f < 60 * 180; f++) {
      const before = new Map(vehicles.map((v) => [v, `${v.lane.id}:${v.s.toFixed(3)}:${v.box ? 1 : 0}`]));
      clock += 16;
      traffic.update(16, view, 0);
      for (const v of vehicles) {
        seen.add(v);
        if (before.get(v) !== `${v.lane.id}:${v.s.toFixed(3)}:${v.box ? 1 : 0}`) moved++;
      }
      for (const v of before.keys()) if (!vehicles.includes(v)) removedAtEnd++;
      expect(vehicles.length).toBeLessThanOrEqual(14);
      const boxes = vehicles.filter((v) => v.box).map((v) => v.box!.node);
      expect(new Set(boxes).size).toBe(boxes.length);
      for (const a of vehicles)
        for (const b of vehicles) if (a !== b && !a.box && !b.box && a.lane === b.lane && b.s > a.s) expect(b.s - a.s).toBeGreaterThan(GAP - 0.25);
    }
    // Most vehicle-frames saw movement (stops at junctions and crossings are fine, gridlock isn't).
    expect(moved / (60 * 180 * vehicles.length)).toBeGreaterThan(0.7);
    // Vehicles came and went through the highway end.
    expect(removedAtEnd).toBeGreaterThan(0);
    expect(seen.size).toBeGreaterThan(14);
  }, 20_000); // 3 simulated minutes per Region: ~5 s alone, longer when every test file runs at once

  it('a delivery van drives in from the highway, unloads by the fulfilment centre and leaves', async () => {
    const { Vans } = await import('@/game/Ops');
    const { landmarkLayout } = await import('@/world/layout');
    const t = terrainFor('us-east-1', zonesFor('us-east-1'));
    const traffic = new Traffic({} as never, new RoadGraph(t), { pedestrians: () => [], isBridge: () => false, isZebra });
    traffic.setTarget(4, 14);
    const dock = landmarkLayout('fulfilment')!.workSpot;
    const vans = new Vans(traffic, dock);
    expect(vans.drive()).toBe(true);
    expect(vans.count).toBe(1);
    const vehicles = (traffic as unknown as { vehicles: (V & { kind: string; x: number; y: number; dwell: number })[] }).vehicles;
    let closest = Infinity;
    let unloaded = false;
    for (let f = 0; f < 60 * 240 && vans.count; f++) {
      traffic.update(16, { contains: () => true } as never, 0);
      const van = vehicles.find((v) => v.kind === 'van');
      if (van) closest = Math.min(closest, Math.hypot(van.x - dock.x, van.y - dock.y));
      if (van && van.dwell > 0) unloaded = true;
    }
    expect(unloaded).toBe(true);
    expect(closest).toBeLessThan(4);
    expect(vans.count).toBe(0);
  });

  it('a data carrier drives its route, an ambient car gives way at the cap, and it is gone when it delivers', async () => {
    const t = terrainFor('us-east-1', zonesFor('us-east-1'));
    const graph = new RoadGraph(t);
    const traffic = new Traffic({} as never, graph, { pedestrians: () => [], isBridge: () => false, isZebra });
    traffic.setTarget(6, 6);
    traffic.populate();
    type DV = V & { cargo?: unknown; img: { interactive?: boolean; handler?: (p: unknown) => void } };
    const vehicles = (traffic as unknown as { vehicles: DV[] }).vehicles;
    expect(vehicles.length).toBe(6);
    // From one AZ island's road end to another's, through downtown (RegionOverlay's cross-AZ link).
    const { azsFor } = await import('@/world/layout');
    const [a, b] = azsFor('us-east-1');
    const from = graph.node(a.bridge.end.x, a.bridge.end.y) ?? graph.nearestNode(a.bridge.end);
    const to = graph.node(b.bridge.end.x, b.bridge.end.y) ?? graph.nearestNode(b.bridge.end);
    const route = graph.route(from, to);
    const cargo = { kind: 'armoured' as const, label: 'orders-db', route: 'Zone A → Zone B' };
    let tapped: unknown;
    traffic.onTap = (c) => (tapped = c);
    expect(traffic.spawnData('car', 'veh:data:armoured', route, cargo)).toBe(true);
    // At the cap: an ambient car gave way, the total stays at the cap.
    expect(vehicles.length).toBe(6);
    expect(traffic.dataCount).toBe(1);
    const carrier = vehicles.find((v) => v.cargo)!;
    expect(carrier.img.interactive).toBe(true);
    carrier.img.handler?.({ getDistance: () => 2 });
    expect(tapped).toEqual(cargo);
    // It never stops a carrier for another one, and DATA_CAP holds.
    traffic.dataCap = 1;
    expect(traffic.spawnData('car', 'veh:data:armoured', route, cargo)).toBe(false);
    for (let f = 0; f < 60 * 240 && traffic.dataCount; f++) traffic.update(16, { contains: () => true } as never, 0);
    expect(traffic.dataCount).toBe(0);
    // Its Image went back to the pool without its tap target (an ambient car reusing it isn't tappable).
    expect(carrier.img.interactive).toBe(false);
    expect(carrier.img.handler).toBeUndefined();
  });

  it('parks under reduced motion: nothing moves', () => {
    const t = terrainFor('us-east-1', zonesFor('us-east-1'));
    const traffic = new Traffic({} as never, new RoadGraph(t), { pedestrians: () => [], isBridge: () => false, isZebra });
    traffic.setTarget(8, 8);
    traffic.setParked(true);
    const vehicles = (traffic as unknown as { vehicles: V[] }).vehicles;
    expect(vehicles.length).toBe(8);
    const snap = vehicles.map((v) => `${v.lane.id}:${v.s}`).join();
    for (let f = 0; f < 600; f++) traffic.update(16, { contains: () => true } as never, 1);
    expect(vehicles.map((v) => `${v.lane.id}:${v.s}`).join()).toBe(snap);
    expect(traffic.stats().lit).toBe(0);
    traffic.setTarget(8, 8);
    expect(vehicles.map((v) => `${v.lane.id}:${v.s}`).join()).toBe(snap);
  });
});
