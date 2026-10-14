import { describe, expect, it } from 'vitest';
import type { Progress } from '@/backend/contract';
import { bumpDay, currentStreak, dayKey, daysBetween, mergeProgress, mergeStreak, nextStreak } from '@/state/progress';
import { cityHealth } from '@/state/store';

const p = (over: Partial<Progress>): Progress => ({ version: 2, landmarks: {}, updatedAt: '2026-01-01T00:00:00.000Z', ...over });

describe('the learning day', () => {
  it('is the local calendar date, zero-padded', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(dayKey(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31');
  });

  it('counts whole days across month and year ends and leap days', () => {
    expect(daysBetween('2026-01-31', '2026-02-01')).toBe(1);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2028-02-28', '2028-02-29')).toBe(1);
    expect(daysBetween('2028-02-29', '2028-03-01')).toBe(1);
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
    expect(daysBetween('2026-10-10', '2026-10-10')).toBe(0);
    expect(daysBetween('2026-10-12', '2026-10-10')).toBe(-2);
  });

  it('is one day apart across a clock change (DST-safe)', () => {
    // Europe and the US change clocks on these dates; local midnights there are 23 or 25 hours apart.
    for (const [a, b] of [['2026-03-28', '2026-03-29'], ['2026-10-24', '2026-10-25'], ['2026-03-07', '2026-03-08'], ['2026-10-31', '2026-11-01']])
      expect(daysBetween(a!, b!)).toBe(1);
    // And the local day key of two local noons a day apart never skips or repeats.
    const noon = new Date(2026, 2, 28, 12);
    const next = new Date(noon);
    next.setDate(next.getDate() + 1);
    expect(daysBetween(dayKey(noon), dayKey(next))).toBe(1);
  });
});

describe('the streak', () => {
  it('starts at 1 on the first learning day', () => {
    expect(nextStreak(undefined, '2026-10-10')).toEqual({ days: 1, last: '2026-10-10', best: 1 });
  });

  it('counts once per day, adds a day on consecutive days and keeps the best', () => {
    let s = nextStreak(undefined, '2026-12-30');
    expect(nextStreak(s, '2026-12-30')).toBe(s);
    s = nextStreak(s, '2026-12-31');
    s = nextStreak(s, '2027-01-01');
    expect(s).toEqual({ days: 3, last: '2027-01-01', best: 3 });
  });

  it('resets to 1 after a missed day, keeping the best', () => {
    const s = nextStreak({ days: 5, last: '2026-09-30', best: 5 }, '2026-10-02');
    expect(s).toEqual({ days: 1, last: '2026-10-02', best: 5 });
  });

  it('keeps what was earned if the clock goes backwards', () => {
    const s = { days: 4, last: '2026-10-10', best: 6 };
    expect(nextStreak(s, '2026-10-08')).toBe(s);
  });

  it('shows as alive today and yesterday, and as 0 once a day is missed', () => {
    const s = { days: 3, last: '2026-10-09', best: 5 };
    expect(currentStreak(s, '2026-10-09')).toBe(3);
    expect(currentStreak(s, '2026-10-10')).toBe(3);
    expect(currentStreak(s, '2026-10-11')).toBe(0);
    expect(currentStreak(undefined, '2026-10-11')).toBe(0);
  });

  it('counts today’s actions, starting fresh each day', () => {
    let log = bumpDay(undefined, 'cards', '2026-10-10');
    log = bumpDay(log, 'cards', '2026-10-10');
    log = bumpDay(log, 'puzzles', '2026-10-10');
    expect(log).toEqual({ day: '2026-10-10', cards: 2, puzzles: 1, fixes: 0, games: 0 });
    expect(bumpDay(log, 'fixes', '2026-10-11')).toEqual({ day: '2026-10-11', cards: 0, puzzles: 0, fixes: 1, games: 0 });
    // a log saved before games counted gains the field on the first round
    expect(bumpDay({ day: '2026-10-11', cards: 1, puzzles: 0, fixes: 0 }, 'games', '2026-10-11').games).toBe(1);
  });
});

describe('merging the streak between surfaces', () => {
  const old = { days: 7, last: '2026-10-01', best: 9 };
  const recent = { days: 2, last: '2026-10-10', best: 4 };

  it('takes the later `last`, with best the higher of both', () => {
    expect(mergeStreak(old, recent)).toEqual({ days: 2, last: '2026-10-10', best: 9 });
    expect(mergeStreak(recent, old)).toEqual(mergeStreak(old, recent));
  });

  it('on the same day keeps the longer run, and one side alone wins', () => {
    expect(mergeStreak({ days: 2, last: '2026-10-10', best: 2 }, { days: 3, last: '2026-10-10', best: 3 })).toEqual({ days: 3, last: '2026-10-10', best: 3 });
    expect(mergeStreak(undefined, recent)).toBe(recent);
    expect(mergeStreak(undefined, undefined)).toBeUndefined();
  });

  it('goes through mergeProgress, order-independently', () => {
    const a = p({ streak: old });
    const b = p({ streak: recent, updatedAt: '2026-10-10T00:00:00.000Z' });
    expect(mergeProgress(a, b).streak).toEqual({ days: 2, last: '2026-10-10', best: 9 });
    expect(mergeProgress(a, b)).toEqual(mergeProgress(b, a));
    expect(mergeProgress(p({}), p({})).streak).toBeUndefined();
  });
});

describe('city health', () => {
  const f = (severity: 'low' | 'medium' | 'high', status: 'open' | 'resolved' = 'open') => ({ severity, status });

  it('starts at 100 and is Healthy with nothing open', () => {
    expect(cityHealth([])).toEqual({ score: 100, label: 'Healthy' });
    expect(cityHealth([f('high', 'resolved')])).toEqual({ score: 100, label: 'Healthy' });
  });

  it('takes 15 per high, 8 per medium and 3 per low open finding', () => {
    expect(cityHealth([f('high'), f('medium'), f('low')]).score).toBe(74);
    expect(cityHealth([f('low')])).toEqual({ score: 97, label: 'Healthy' });
    expect(cityHealth([f('high'), f('medium')])).toEqual({ score: 77, label: 'Needs care' });
    expect(cityHealth([f('high'), f('high'), f('high'), f('medium')])).toEqual({ score: 47, label: 'At risk' });
  });

  it('never goes below 0', () => {
    expect(cityHealth(Array.from({ length: 10 }, () => f('high')))).toEqual({ score: 0, label: 'At risk' });
  });
});
