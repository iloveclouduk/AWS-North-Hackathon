import { describe, expect, it } from 'vitest';
import type { Progress } from '@/backend/contract';
import { mergeProgress, sameProgress } from '@/state/progress';

const p = (over: Partial<Progress>): Progress => ({ version: 1, landmarks: {}, updatedAt: '2026-01-01T00:00:00.000Z', ...over });

describe('merging progress between the side panel, the full tab and the server', () => {
  const panel = p({
    landmarks: { s3: { discovered: true, xp: 40 }, ec2: { discovered: false, xp: 0 } },
    quests: { first: { status: 'done', step: 3 } },
    games: { fishing: { best: 9, plays: 4 } },
    updatedAt: '2026-01-02T00:00:00.000Z',
  });
  const server = p({
    landmarks: { s3: { discovered: true, xp: 25 }, ec2: { discovered: true, xp: 10 }, rds: { discovered: true, xp: 5 } },
    quests: { first: { status: 'active', step: 5 } },
    games: { fishing: { best: 12, plays: 2 } },
    updatedAt: '2026-01-03T00:00:00.000Z',
  });

  it('keeps everything earned on either side', () => {
    const m = mergeProgress(panel, server);
    expect(m.landmarks).toEqual({ s3: { discovered: true, xp: 40 }, ec2: { discovered: true, xp: 10 }, rds: { discovered: true, xp: 5 } });
    expect(m.quests).toEqual({ first: { status: 'done', step: 3 } });
    expect(m.games).toEqual({ fishing: { best: 12, plays: 4 } });
    expect(m.updatedAt).toBe(server.updatedAt);
  });

  it('is order-independent, so every surface converges', () => {
    expect(mergeProgress(panel, server)).toEqual(mergeProgress(server, panel));
  });

  it('the bill switch (v2.5): the newer choice wins, an unset copy keeps it, and off wins a tie', () => {
    expect(mergeProgress(p({ bill: true, updatedAt: '2026-01-02T00:00:00.000Z' }), p({ bill: false, updatedAt: '2026-01-03T00:00:00.000Z' })).bill).toBe(false);
    expect(mergeProgress(p({ bill: true, updatedAt: '2026-01-04T00:00:00.000Z' }), p({ bill: false, updatedAt: '2026-01-03T00:00:00.000Z' })).bill).toBe(true);
    expect(mergeProgress(p({ bill: true }), p({ updatedAt: '2026-01-09T00:00:00.000Z' })).bill).toBe(true);
    expect(mergeProgress(p({}), p({})).bill).toBeUndefined();
    expect(mergeProgress(p({ bill: true }), p({ bill: false })).bill).toBe(false);
    expect(mergeProgress(p({ bill: false }), p({ bill: true })).bill).toBe(false);
    expect(sameProgress(p({ bill: false }), p({ bill: true, updatedAt: '2026-01-09T00:00:00.000Z' }))).toBe(false);
  });

  it('knows when the other copy adds nothing', () => {
    expect(sameProgress(server, p({ landmarks: { rds: { discovered: true, xp: 1 } } }))).toBe(true);
    expect(sameProgress(server, panel)).toBe(false);
  });
});
