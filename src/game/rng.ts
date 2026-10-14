// Seeded randomness for the city's ambient choices (citizens, decor timing, traffic). `?seed=N` in the page URL
// makes a run repeatable (the smoke test opens city.html?seed=1); without it each load gets a fresh seed.

/** mulberry32: a tiny, fast 32-bit PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The `seed` query parameter as a 32-bit integer, or undefined when absent or not a number. */
export function seedFromQuery(search: string | undefined = globalThis.location?.search): number | undefined {
  if (!search) return undefined;
  const raw = new URLSearchParams(search).get('seed');
  if (raw === null || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) >>> 0 : undefined;
}

/** A generator seeded from `?seed=`, or randomly. */
export const seededRandom = (search?: string) => mulberry32(seedFromQuery(search) ?? Math.floor(Math.random() * 2 ** 32));

/** The page's shared generator. Use instead of Math.random for anything a smoke run should be able to repeat. */
export const rand = seededRandom();
