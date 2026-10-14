import { describe, expect, it } from 'vitest';
import { isDue, review, xpFor } from '@/learning/srs';
import { scoreDiagram, scorePuzzle } from '@/learning/scoring';
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
  it('Again then Good on a seen card pays a review, not the new-card stars again', () => {
    const again = review(undefined, 'again', 0);
    expect(xpFor(again, 'good')).toBe(xpFor({ interval: 1, ease: 2.5, due: 0, reps: 1 }, 'good'));
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

describe('diagram scoring', () => {
  const p: Puzzle = {
    id: 'd', title: 'd', districtId: 'compute', tier: 1, story: '', requirements: [], why: '',
    required: ['s3', 'lambda'], optional: ['sqs'], distractors: ['ec2'], flow: ['s3', 'lambda'],
    pillarBonus: {
      operational: { services: [], tip: 'a' }, security: { services: [], tip: 'b' }, reliability: { services: ['sqs'], tip: 'c' },
      performance: { services: [], tip: 'd' }, cost: { services: ['lambda'], tip: 'e' }, sustainability: { services: [], tip: 'f' },
    },
    diagram: {
      cols: 4, rows: 2, groups: [], rejects: { ec2: 'no' },
      nodes: [
        { id: 'u', actor: 'users', x: 0, y: 0, role: 'Users' },
        { id: 'in', service: 's3', x: 1, y: 0, role: 'In' },
        { id: 'q', service: 'sqs', x: 2, y: 1, role: 'Buffer' },
        { id: 'fn', service: 'lambda', x: 2, y: 0, role: 'Fn' },
        { id: 'out', service: 's3', x: 3, y: 0, role: 'Out' },
      ],
      edges: [],
    },
  };
  const all = { in: 's3', fn: 'lambda', out: 's3' };
  it('an all-correct diagram scores exactly like the same services picked by hand', () => {
    expect(scoreDiagram(p, { placements: all, distractorDrops: [], misdrops: 0 })).toEqual(scorePuzzle(p, ['s3', 'lambda']));
  });
  it('a service with two spots counts only once both are filled', () => {
    const r = scoreDiagram(p, { placements: { in: 's3', fn: 'lambda' }, distractorDrops: [], misdrops: 0 });
    expect(r.missing).toEqual(['s3']);
    expect(r.passed).toBe(false);
  });
  it('a bonus spot raises its pillar; a distractor counts once; wrong drops and shown cards cost points', () => {
    const base = scoreDiagram(p, { placements: all, distractorDrops: [], misdrops: 0 });
    expect(scoreDiagram(p, { placements: { ...all, q: 'sqs' }, distractorDrops: [], misdrops: 0 }).pillars.reliability).toBe(100);
    expect(scoreDiagram(p, { placements: all, distractorDrops: ['ec2', 'ec2'], misdrops: 0 })).toEqual(scoreDiagram(p, { placements: all, distractorDrops: ['ec2'], misdrops: 0 }));
    expect(scoreDiagram(p, { placements: all, distractorDrops: [], misdrops: 2 }).score).toBe(base.score - 6);
    expect(scoreDiagram(p, { placements: all, distractorDrops: [], misdrops: 0, reveals: 10 }).score).toBe(base.score - 12);
  });
  it('a bonus service the brief does not need costs points', () => {
    const lean = scoreDiagram(p, { placements: { ...all, q: 'sqs' }, distractorDrops: [], misdrops: 0 });
    const over = scoreDiagram({ ...p, unneeded: ['sqs'] }, { placements: { ...all, q: 'sqs' }, distractorDrops: [], misdrops: 0 });
    expect(over.score).toBe(lean.score - 6);
    expect(over.tips[0].tip).toContain('didn’t need');
  });
});

