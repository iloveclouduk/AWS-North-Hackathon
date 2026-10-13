// The city's baseline hum (Packets.FlowTrickle, plan B3) with Phaser stubbed out: with two or more services of a flow
// discovered and no task running, dim packets travel between their work spots within ~10 s; while a task runs, none.
// The smoke run once saw 0 ambient packets all game: work spots stand in front of their landmarks, off the sidewalk
// ring the packets travel, so no path was ever found (Packets now steps across the open ground at either end).
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { BlendModes: { ADD: 1 } } }));
vi.mock('@/game/rng', async (orig) => {
  const m = await orig<typeof import('@/game/rng')>();
  return { ...m, rand: m.mulberry32(3) };
});

const { FlowTrickle, Packets } = await import('@/game/Packets');
const { FLOWS } = await import('@/world/culture');
const { GRID, isFootprint, isRoad, landmarkLayout, plotAt } = await import('@/world/layout');
const { SERVICES } = await import('@/world/taxonomy');

const image = () => {
  const o: Record<string, unknown> = { x: 0, y: 0, depth: 0 };
  for (const m of ['setPosition', 'setTint', 'setAlpha', 'setScale', 'setVisible', 'setDepth', 'setBlendMode']) o[m] = () => o;
  o.destroy = () => {};
  return o;
};
const scene = { textures: { exists: () => true }, add: { image } } as never;

/** What CityScene lets packets travel: core roads and the sidewalk ring (tiles beside a road), plus the square. */
const travel = (x: number, y: number) => {
  if (x < 0 || y < 0 || x >= GRID || y >= GRID) return false;
  if (isRoad({ x, y })) return true;
  if (isFootprint(x, y)) return false;
  return plotAt({ x, y }) === 'square' || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isRoad({ x: x + dx, y: y + dy }));
};

function run(discovered: string[], busy: boolean, ms = 10_000) {
  const packets = new Packets(scene, { halfW: 16, halfH: 8 }, GRID, travel);
  const trickle = new FlowTrickle(packets, {
    flows: () => FLOWS,
    spot: (id) => (discovered.includes(id) ? landmarkLayout(id)?.workSpot : undefined),
    busy: () => busy,
    color: () => 0xffffff,
  });
  let most = 0;
  for (let t = 0; t < ms; t += 50) {
    trickle.update(50);
    packets.update(50);
    most = Math.max(most, packets.ambientCount);
  }
  return most;
}

describe('FlowTrickle', () => {
  it('sends dim packets within 10 s once two services of a flow are discovered and no task runs', () => {
    const flow = FLOWS[0];
    expect(run(flow.serviceIds.slice(0, 2), false)).toBeGreaterThan(0);
  });

  it('every flow can play: each hop between work spots has a path', () => {
    for (const f of FLOWS) expect(run(f.serviceIds, false), f.serviceIds.join(' → ')).toBeGreaterThan(0);
  });

  it('every work spot of every service reaches the roads', () => {
    const packets = new Packets(scene, { halfW: 16, halfH: 8 }, GRID, travel);
    const from = landmarkLayout('plaza')!.workSpot;
    for (const s of SERVICES) {
      packets.clear();
      packets.sendAmbient(from, landmarkLayout(s.id)!.workSpot, 0xffffff);
      expect(packets.ambientCount, s.id).toBe(1);
    }
  });

  it('waits while a task of the player runs', () => {
    expect(run(SERVICES.map((s) => s.id), true)).toBe(0);
  });
});
