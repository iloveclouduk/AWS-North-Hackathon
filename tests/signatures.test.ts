// Every Region's city has its own landmark (shared/region-flavour.json `signature`, art/tiles/signatures_art.py):
// drawn, placed once by the highway, and named in plain words that never borrow a famous building's name.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REGIONS } from '@/world/culture';
import { signatureFor, signatureSprite, zonesFor } from '@/world/regions';
import { MAX_PROPS, terrainFor } from '@/world/terrain';
import { skylineFor } from '@/game/worldmap';

const sprites = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../public/assets/city/sprites.json'), 'utf8')).sprites as Record<string, unknown>;
/** Names that belong to someone (a building's trademark or a protected silhouette): labels stay generic. */
const BANNED = /opera house|eiffel|petronas|burj|marina bay|merlion|taipei 101|sky tower|golden gate|harbour bridge|big ben|space needle|cn tower|brandenburg|torii of|sagrada|duomo|tower bridge|capitol|white house|pentagon/i;

describe('Region signatures', () => {
  it.each(REGIONS.regions.map((r) => r.code))('%s has a drawn signature placed once in its city', (code) => {
    const sig = signatureFor(code);
    expect(sig, code).toBeTruthy();
    expect(sprites[signatureSprite(sig!)], signatureSprite(sig!)).toBeTruthy();
    expect(sig!.label).not.toMatch(BANNED);
    const t = terrainFor(code, zonesFor(code));
    const placed = t.props.filter((p) => p.role === 'signature');
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ sprite: signatureSprite(sig!), w: 2, h: 2 });
    expect(t.props.length).toBeLessThanOrEqual(MAX_PROPS);
  });

  it('cities look different: many motifs, and neighbours that are easy to mix up are not the same', () => {
    const all = REGIONS.regions.map((r) => signatureSprite(signatureFor(r.code)!));
    expect(new Set(all).size).toBeGreaterThanOrEqual(25);
    for (const [a, b] of [['ap-southeast-2', 'ap-southeast-4'], ['ap-northeast-1', 'ap-northeast-3'], ['me-central-1', 'me-south-1']])
      expect(signatureSprite(signatureFor(a)!), `${a} vs ${b}`).not.toBe(signatureSprite(signatureFor(b)!));
  });

  it('the same Region always gets the same city', () => {
    const p = (code: string) => terrainFor(code, zonesFor(code)).props.find((x) => x.role === 'signature');
    expect(p('eu-west-1')).toEqual(p('eu-west-1'));
  });

  it('every motif has its own little skyline on the world map', () => {
    const motifs = new Set(REGIONS.regions.map((r) => signatureFor(r.code)!.motif));
    const shapes = new Set([...motifs].map((m) => JSON.stringify(skylineFor(m))));
    expect(shapes.size).toBe(motifs.size);
    expect(shapes.has(JSON.stringify(skylineFor(undefined)))).toBe(false);
  });
});

describe('world map night lights', () => {
  it('light a city between 19:00 and 06:00 solar time', async () => {
    const { isNightAt } = await import('@/game/worldmap');
    const noonUtc = new Date('2026-10-12T12:00:00Z');
    expect(isNightAt(0, noonUtc)).toBe(false); // London at noon
    expect(isNightAt(139.7, noonUtc)).toBe(true); // Tokyo ~21:19
    expect(isNightAt(-122.7, noonUtc)).toBe(true); // Oregon ~03:49
    expect(isNightAt(-77, noonUtc)).toBe(false); // N. Virginia ~06:52
  });
});
