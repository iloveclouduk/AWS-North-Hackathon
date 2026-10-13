import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import world from '../shared/world.json' with { type: 'json' };

const TILES = path.resolve(__dirname, '../art/tiles');
const src = fs
  .readdirSync(TILES)
  .filter((f) => f.endsWith('.py'))
  .map((f) => fs.readFileSync(path.join(TILES, f), 'utf8'))
  .join('\n');

describe('bespoke landmark art', () => {
  it.each(world.services.map((s) => s.id))('%s has its own drawer lm_<id>', (id) => {
    expect(src).toMatch(new RegExp(`^def lm_${id}\\(fw, fh, tier, col, key\\):`, 'm'));
  });

  it('every drawer is defined exactly once', () => {
    for (const s of world.services) expect(src.match(new RegExp(`^def lm_${s.id}\\(`, 'gm'))?.length, s.id).toBe(1);
  });

  it('districts use the official AWS Architecture Icon category colours', () => {
    const want = { compute: '#ED7100', storage: '#7AA116', database: '#C925D1', networking: '#8C4FFF', security: '#DD344C', aiml: '#01A88D' };
    expect(Object.fromEntries(world.districts.map((d) => [d.id, d.color.toUpperCase()]))).toEqual(want);
  });
});

describe('generated atlas (npm run art)', () => {
  const atlas = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../public/assets/city/sprites.json'), 'utf8')) as { sprites: Record<string, unknown> };
  const has = (n: string) => n in atlas.sprites;

  it('every culture / campus site has its sprite, so no plot is left blank', async () => {
    const { SITES } = await import('@/world/layout');
    for (const s of SITES) expect(has(s.site!.sprite), `${s.id} → ${s.site!.sprite}`).toBe(true);
  });

  it('has the delivery van in all four facings, the data-centre blink frames and the plot decor', () => {
    const want = [
      ...['SE', 'SW', 'NE', 'NW'].map((d) => `culture:van:${d}`),
      'culture:dc:0@lights',
      'culture:dc:blink0',
      'culture:dc:blink1',
      ...['paver', 'lotPad', 'hoardingX', 'hoardingY', 'billboard', 'cone', 'lotSign', 'construction2x2', 'grassDark'],
      ...[0, 1, 2, 3].map((i) => `pack:data_center:${i}`),
      'pack:lamp_post',
      'pack:bench_SE',
      'pack:bench_SW',
    ];
    for (const n of want) expect(has(n), n).toBe(true);
  });

  it('the four van frames share one canvas so Ops can swap them in place', () => {
    const vans = ['SE', 'SW', 'NE', 'NW'].map((d) => JSON.stringify(atlas.sprites[`culture:van:${d}`]));
    expect(new Set(vans).size).toBe(1);
  });

  it('has the landscape art (plan B2), and every sprite the terrain asks for', async () => {
    const biomes = ['temperate', 'boreal', 'arid', 'tropical'];
    const want = [
      ...['shore', 'cliff', 'quay'].flatMap((s) => [`${s}L`, `${s}R`]),
      'field0', 'field1', 'shingle', 'highwayX', 'highwayY',
      'bridgeX', 'bridgeY', 'bridgeHighway', 'gateArch', 'highwaySign', 'lighthouse', 'pierX', 'pierY', 'farmhouse',
      'windTurbine0', 'windTurbine1', 'windTurbine2', 'rock', 'palm', 'pineSnow', 'cactus',
      'azPad', 'substation2x2', 'coolingTower', 'fenceX', 'fenceY', 'azSign',
      ...biomes.flatMap((b) => [`meadow:${b}:0`, `meadow:${b}:1`, `forest2x2:${b}`, `forest3x3:${b}`, `hill3x3:${b}`]),
    ];
    for (const n of want) expect(has(n), n).toBe(true);
    const { terrainFor, RING_MIN, RING_MAX } = await import('@/world/terrain');
    for (const code of ['us-east-1', 'eu-north-1', 'me-central-1', 'ap-southeast-1']) {
      const t = terrainFor(code);
      for (const p of t.props) expect(has(p.sprite), `${code}: ${p.sprite}`).toBe(true);
      for (const f of t.islands.flatMap((i) => i.fences)) expect(has(f.sprite), `${code}: ${f.sprite}`).toBe(true);
      for (let y = RING_MIN; y <= RING_MAX; y++)
        for (let x = RING_MIN; x <= RING_MAX; x++) {
          const g = t.ground(x, y);
          if (g) expect(has(g), `${code}: ${g}`).toBe(true);
        }
    }
  });

  it('the turbine frames share one canvas, and the sea textures exist', () => {
    expect(new Set([0, 1, 2].map((f) => JSON.stringify(atlas.sprites[`windTurbine${f}`]))).size).toBe(1);
    for (const f of ['sea.png', 'seaGlint.png']) expect(fs.existsSync(path.resolve(__dirname, `../public/assets/city/${f}`)), f).toBe(true);
  });

  const DIRS = ['SE', 'SW', 'NE', 'NW'];
  const VEHICLES = [...['navy', 'orange', 'white', 'teal', 'server', 'packet', 'fibre', 'cloud'].map((c) => `veh:car:${c}`), 'veh:bus', 'veh:truck', 'veh:ferry', 'veh:sail', 'veh:barge'];

  it('has the city life art (plan B3): vehicles in four facings, boats, the sky, headlights and a bus stop', () => {
    const want = [
      ...VEHICLES.flatMap((v) => DIRS.map((d) => `${v}:${d}`)),
      'planeE', 'planeW', 'planeShadow', 'bird0', 'bird1', 'cloud0', 'cloud1', 'cloud2', 'cloudShadow', 'headlight', 'busStop',
    ];
    for (const n of want) expect(has(n), n).toBe(true);
  });

  it('each vehicle’s four facings share one canvas, so Traffic and Boats swap frames in place', () => {
    for (const v of VEHICLES) expect(new Set(DIRS.map((d) => JSON.stringify(atlas.sprites[`${v}:${d}`]))).size, v).toBe(1);
    expect(new Set([0, 1].map((f) => JSON.stringify(atlas.sprites[`bird${f}`]))).size).toBe(1);
    expect(new Set(['E', 'W'].map((d) => JSON.stringify(atlas.sprites[`plane${d}`]))).size).toBe(1);
  });

  it('road vehicles are drawn to the 32×16 tile: a one-tile footprint, anchored at its N corner', () => {
    for (const v of VEHICLES.filter((n) => !['veh:ferry', 'veh:barge'].includes(n))) {
      const a = atlas.sprites[`${v}:SE`] as { ax: number; ay: number; w: number; h: number };
      expect(a.w, v).toBe(36); // 32 px across one tile plus the canvas pad
      expect(a.ax, v).toBe(18);
    }
  });
});

describe('crowd-size characters (art/characters/crowd_small.py)', () => {
  const CHARS = path.resolve(__dirname, '../public/assets/characters');
  const index = JSON.parse(fs.readFileSync(path.join(CHARS, 'index.json'), 'utf8')) as Record<string, { role: string; anims: string[]; frame?: number[]; of?: string }>;
  // Width and height from a PNG's IHDR chunk.
  const pngSize = (file: string) => {
    const b = fs.readFileSync(file);
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  };

  it('every citizen has a 3/4-size crowd copy with the same animations, in whole 36×54 frames', () => {
    const citizens = Object.entries(index).filter(([, c]) => c.role === 'citizen' || c.role === 'agent');
    expect(citizens.length).toBeGreaterThan(0);
    for (const [id, c] of citizens) {
      const crowd = index[`${id}-crowd`];
      expect(crowd, id).toMatchObject({ role: 'crowd', of: id, frame: [36, 54], anims: c.anims });
      const [w, h] = pngSize(path.join(CHARS, `${id}-crowd`, 'sheet.png'));
      const [fw, fh] = pngSize(path.join(CHARS, id, 'sheet.png'));
      expect([w, h], id).toEqual([(fw / 48) * 36, (fh / 72) * 54]);
    }
  });

  it('crowd copies never outlive their citizen', () => {
    for (const [id, c] of Object.entries(index)) if (c.role === 'crowd') expect(['citizen', 'agent'], id).toContain(index[c.of ?? '']?.role);
  });
});
