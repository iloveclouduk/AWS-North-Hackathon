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
