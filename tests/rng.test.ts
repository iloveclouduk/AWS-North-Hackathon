import { describe, expect, it } from 'vitest';
import { mulberry32, seededRandom, seedFromQuery } from '@/game/rng';

describe('seeded rng', () => {
  it('mulberry32 is repeatable and in [0, 1)', () => {
    const a = mulberry32(1);
    const b = mulberry32(1);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(new Set(xs).size).toBeGreaterThan(990);
    expect(mulberry32(2)()).not.toBe(mulberry32(1)());
  });

  it('reads ?seed= from the query string', () => {
    expect(seedFromQuery('?seed=1')).toBe(1);
    expect(seedFromQuery('?x=2&seed=42')).toBe(42);
    expect(seedFromQuery('?seed=abc')).toBeUndefined();
    expect(seedFromQuery('?seed=')).toBeUndefined();
    expect(seedFromQuery('')).toBeUndefined();
  });

  it('?seed=1 gives the same sequence every load', () => {
    const a = seededRandom('?seed=1');
    const b = seededRandom('?seed=1');
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
