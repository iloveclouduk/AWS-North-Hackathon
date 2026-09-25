import { describe, expect, it } from 'vitest';
import { isDue, review, xpFor } from '@/learning/srs';
import { scorePuzzle } from '@/learning/scoring';
import type { Puzzle } from '@/world/content';

describe('SM-2 lite', () => {
  const now = 1_000_000;
  it('again brings a card back within minutes and resets reps', () => {
    const s = review({ interval: 10, ease: 2.5, due: now, reps: 4 }, 'again', now);
    expect(s.reps).toBe(0);
    expect(s.due - now).toBe(60_000);
  });
  it('good grows intervals 1 → 3 → ×ease', () => {
    const a = review(undefined, 'good', now);
    const b = review(a, 'good', now);
    const c = review(b, 'good', now);
    expect([a.interval, b.interval, c.interval]).toEqual([1, 3, Math.round(3 * 2.5)]);
    expect(isDue(c, now)).toBe(false);
  });
  it('new cards are worth more XP than reviews', () => {
    expect(xpFor(undefined, 'good')).toBeGreaterThan(xpFor({ interval: 1, ease: 2.5, due: 0, reps: 1 }, 'good'));
  });
});

describe('puzzle scoring', () => {
  const p: Puzzle = {
    id: 't', title: 't', districtId: 'compute', tier: 1, story: '', requirements: [], why: '',
    required: ['s3', 'lambda'], optional: ['sqs'], distractors: ['ec2'], flow: ['s3', 'lambda'],
    pillarBonus: {
      operational: { services: [], tip: 'a' }, security: { services: ['iam'], tip: 'b' }, reliability: { services: ['sqs'], tip: 'c' },
      performance: { services: [], tip: 'd' }, cost: { services: ['lambda'], tip: 'e' }, sustainability: { services: ['lambda'], tip: 'f' },
    },
  };
  it('passes a complete design and rewards pillar services', () => {
    const base = scorePuzzle(p, ['s3', 'lambda']);
    const better = scorePuzzle(p, ['s3', 'lambda', 'sqs', 'iam']);
    expect(base.passed).toBe(true);
    expect(better.score).toBeGreaterThan(base.score);
    expect(better.pillars.reliability).toBe(100);
  });
  it('fails when a required service is missing and penalises distractors', () => {
    expect(scorePuzzle(p, ['s3']).passed).toBe(false);
    expect(scorePuzzle(p, ['s3', 'lambda', 'ec2']).score).toBeLessThan(scorePuzzle(p, ['s3', 'lambda']).score);
  });
});
