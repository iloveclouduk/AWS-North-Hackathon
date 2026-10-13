import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProgressStore } from '../src/contract/progress.js';

describe('progress the client actually sends (contract v2 / v2.3)', () => {
  const file = () => join(mkdtempSync(join(tmpdir(), 'awscity-progress-')), 'progress.json');
  const v2 = {
    version: 2,
    landmarks: { s3: { discovered: true, xp: 12 } },
    cards: { 's3-01': { interval: 3, ease: 2.5, due: 1_760_000_000_000, reps: 2 } },
    quests: { 'storage-static-site': { status: 'active', step: 1 } },
    puzzles: { thumbnails: { best: 83 } },
    games: { fishing: { best: 4, plays: 2 } },
    citizens: { 'citizen:security': { xp: 25 } },
    fixes: { 'f-0123456789abcdef': '2026-10-10T10:00:00.000Z' },
    updatedAt: '2026-10-10T10:00:00.000Z',
  };

  it('stores and returns v2 with citizens, so the level gate sees real XP', async () => {
    const store = createProgressStore(file());
    expect(await store.put(v2)).toEqual({ ok: true });
    expect((await store.get())?.citizens?.['citizen:security']?.xp).toBe(25);
  });

  it('stores and returns v2 with the learning streak, and rejects a bad streak', async () => {
    const store = createProgressStore(file());
    const withStreak = { ...v2, streak: { days: 3, last: '2026-10-10', best: 5 } };
    expect(await store.put(withStreak)).toEqual({ ok: true });
    expect(await store.get()).toEqual(withStreak);
    expect((await store.put({ ...v2, streak: { days: 3, last: '10/10/2026', best: 5 } })).ok).toBe(false);
    expect((await store.put({ ...v2, streak: { days: 0, last: '2026-10-10', best: 5 } })).ok).toBe(false);
    expect((await store.put({ ...v2, streak: { days: 1.5, last: '2026-10-10', best: 5 } })).ok).toBe(false);
    expect((await store.put({ ...v2, streak: { days: 3, last: '2026-10-10', best: 5, extra: 1 } })).ok).toBe(false);
  });

  it('stores each Region\'s own city (v2.7), and rejects a bad Region code', async () => {
    const store = createProgressStore(file());
    const withCities = { ...v2, landmarks: { iam: { discovered: true, xp: 3 } }, cities: { 'us-west-2': { landmarks: { s3: { discovered: true, xp: 12 } } }, 'eu-central-1': { landmarks: {} } } };
    expect(await store.put(withCities)).toEqual({ ok: true });
    expect(await store.get()).toEqual(withCities);
    expect((await store.put({ ...v2, cities: { Oregon: { landmarks: {} } } })).ok).toBe(false);
    expect((await store.put({ ...v2, cities: { 'us-west-2': { landmarks: {}, extra: 1 } } })).ok).toBe(false);
  });

  it('stores the bill switch (v2.5), and only as a boolean', async () => {
    const store = createProgressStore(file());
    expect(await store.put({ ...v2, bill: true })).toEqual({ ok: true });
    expect((await store.get())?.bill).toBe(true);
    expect((await store.put({ ...v2, bill: 'on' })).ok).toBe(false);
    expect((await store.put({ ...v2, bill: { on: true } })).ok).toBe(false);
  });

  it('still accepts v1, and rejects unknown fields or out-of-range values', async () => {
    const store = createProgressStore(file());
    expect(await store.put({ version: 1, landmarks: {}, updatedAt: '2026-01-01T00:00:00.000Z' })).toEqual({ ok: true });
    expect((await store.put({ ...v2, admin: true })).ok).toBe(false);
    expect((await store.put({ ...v2, citizens: { 'citizen:security': { xp: -1 } } })).ok).toBe(false);
  });
});
