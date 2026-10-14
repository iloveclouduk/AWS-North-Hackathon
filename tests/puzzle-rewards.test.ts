import { beforeEach, describe, expect, it } from 'vitest';
import { FIRST_PASS_BONUS, firstTryToday, IMPROVE_XP, passHint, PASS_XP, puzzleReward, TRY_XP } from '@/learning/puzzleRewards';
import { useCity } from '@/state/store';

// Drawing an architecture grows the buildings it uses, and a 50 says why it isn't a pass yet.
const p = { required: ['s3', 'lambda', 'cloudfront'] };

describe('puzzle rewards', () => {
  it('a first pass pays every building, most to the first', () => {
    const r = puzzleReward(p, { passed: true, score: 82, missing: [] }, 0, false);
    expect(r.kind).toBe('first');
    expect(r.xp).toEqual({ s3: PASS_XP + FIRST_PASS_BONUS, lambda: PASS_XP, cloudfront: PASS_XP });
  });

  it('a better pass pays a little; the same answer again pays nothing', () => {
    expect(puzzleReward(p, { passed: true, score: 90, missing: [] }, 82, false).xp).toEqual({ s3: IMPROVE_XP, lambda: IMPROVE_XP, cloudfront: IMPROVE_XP });
    expect(puzzleReward(p, { passed: true, score: 82, missing: [] }, 82, false).kind).toBe('none');
  });

  it('a 50 still grows the pieces already right, once a day', () => {
    const r = puzzleReward(p, { passed: false, score: 50, missing: ['cloudfront'] }, 0, false);
    expect(r).toEqual({ kind: 'try', xp: { s3: TRY_XP, lambda: TRY_XP } });
    expect(puzzleReward(p, { passed: false, score: 50, missing: ['cloudfront'] }, 0, true).kind).toBe('none');
    const seen = new Map<string, string>();
    expect(firstTryToday('x', '2026-10-13', seen)).toBe(true);
    expect(firstTryToday('x', '2026-10-13', seen)).toBe(false);
    expect(firstTryToday('x', '2026-10-14', seen)).toBe(true);
  });

  it('says the pass rule and what is in the way', () => {
    expect(passHint({ passed: false, score: 50, missing: ['cloudfront'] }, (id) => id)).toBe('To pass: 70 or more with nothing missing. You’re at 50: add cloudfront and score 20 more.'.replace('’', "'"));
    expect(passHint({ passed: true, score: 80, missing: [] }, (id) => id)).toBeUndefined();
  });
});

describe('puzzle best is the best pass', () => {
  beforeEach(() => useCity.getState().resetSession());

  it('a failed try is not recorded, so it can never block the stars for a later pass', () => {
    const s = () => useCity.getState();
    s().recordPuzzle('thumbnails', 83, false);
    expect(s().progress.puzzles?.thumbnails).toBeUndefined();
    s().recordPuzzle('thumbnails', 80, true);
    expect(s().progress.puzzles?.thumbnails?.best).toBe(80);
    s().recordPuzzle('thumbnails', 75, true);
    expect(s().progress.puzzles?.thumbnails?.best).toBe(80);
  });
});
