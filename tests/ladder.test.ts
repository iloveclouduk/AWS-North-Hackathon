import { describe, expect, it } from 'vitest';
import type { Progress } from '@/backend/contract';
import { ALL_AREAS, CARE_AT, ladder, lockedAreas, newsOpen, nextUnlock, PLACES_AT, PUZZLE_PASS, type LadderInput } from '@/state/ladder';
import { QUESTS } from '@/world/content';
import { SERVICES } from '@/world/taxonomy';
import all from './fixtures/progress-all.json' with { type: 'json' };

const p = (over: Partial<Progress> = {}): Progress => ({ version: 1, landmarks: {}, updatedAt: '2026-01-01T00:00:00.000Z', ...over });
const input = (over: Partial<LadderInput> = {}): LadderInput => ({ progress: p(), linked: false, hasDeploys: false, opened: new Set(), ...over });
const landmarks = (n: number) => Object.fromEntries(SERVICES.slice(0, n).map((s) => [s.id, { discovered: true, xp: 0 }]));
/** A quest whose step `i` is of `kind`, active on that step. */
const activeOn = (kind: string) => {
  for (const q of QUESTS) {
    const i = q.steps.findIndex((s) => s.kind === kind);
    if (i >= 0) return { [q.id]: { status: 'active' as const, step: i, count: 0 } };
  }
  throw new Error(`no ${kind} step`);
};
const doneQuest = { [QUESTS[0].id]: { status: 'done' as const, step: QUESTS[0].steps.length } };

describe('the unlock ladder', () => {
  it('starts with Home and Quests only, and everything else locked', () => {
    const l = ladder(input());
    expect([...l.tabs]).toEqual(['home', 'quests']);
    expect(l).toMatchObject({ learnBuild: false, care: false, day1: true, worldList: false, news: false });
    expect(nextUnlock(input())?.area).toBe('learn');
    expect(lockedAreas(input())).toHaveLength(7);
  });

  it('keeps AWS news (the ticker and its toasts) quiet until the first quest is done, or an account is linked', () => {
    expect(newsOpen(input().progress, false)).toBe(false);
    expect(newsOpen(input().progress, true)).toBe(true);
    const done = { ...input().progress, quests: { 'first-bucket': { status: 'done' as const, step: 5 } } };
    expect(ladder(input({ progress: done })).news).toBe(true);
    expect(ALL_AREAS).toContain('news');
  });

  it('opens Learn on an active cards step, a reviewed card, or a finished quest', () => {
    expect(ladder(input({ progress: p({ quests: activeOn('cards') }) })).tabs.has('learn')).toBe(true);
    expect(ladder(input({ progress: p({ cards: { 's3-01': { interval: 1, ease: 2.5, due: 0, reps: 1 } } }) })).tabs.has('learn')).toBe(true);
    expect(ladder(input({ progress: p({ quests: doneQuest }) })).tabs.has('learn')).toBe(true);
    // A visit step isn't enough.
    expect(ladder(input({ progress: p({ quests: activeOn('visit') }) })).tabs.has('learn')).toBe(false);
  });

  it('opens Architecture (in Learn) on a puzzle step or a passed puzzle', () => {
    const step = ladder(input({ progress: p({ quests: activeOn('puzzle') }) }));
    expect(step.learnBuild).toBe(true);
    expect(step.tabs.has('learn')).toBe(true);
    expect(ladder(input({ progress: p({ puzzles: { x: { best: PUZZLE_PASS } } }) })).learnBuild).toBe(true);
    expect(ladder(input({ progress: p({ puzzles: { x: { best: PUZZLE_PASS - 1 } } }) })).learnBuild).toBe(false);
  });

  it('opens Places and "Where AWS runs" at 3 landmarks', () => {
    expect(ladder(input({ progress: p({ landmarks: landmarks(PLACES_AT - 1) }) })).tabs.has('map')).toBe(false);
    const l = ladder(input({ progress: p({ landmarks: landmarks(PLACES_AT) }) }));
    expect(l.tabs.has('map')).toBe(true);
    expect(l.worldList).toBe(true);
  });

  it('opens care at 1 quest done, 4 landmarks, or a linked account', () => {
    expect(ladder(input({ progress: p({ landmarks: landmarks(CARE_AT - 1) }) })).care).toBe(false);
    expect(ladder(input({ progress: p({ landmarks: landmarks(CARE_AT) }) })).care).toBe(true);
    expect(ladder(input({ progress: p({ quests: doneQuest }) })).care).toBe(true);
    expect(ladder(input({ linked: true })).care).toBe(true);
    // Undiscovered entries don't count.
    expect(ladder(input({ progress: p({ landmarks: Object.fromEntries(SERVICES.slice(0, 6).map((s) => [s.id, { discovered: false, xp: 0 }])) }) })).care).toBe(false);
  });

  it('has the Day 1 Quarter open from the start', () => {
    expect(ladder(input()).day1).toBe(true);
    expect(ladder(input({ progress: p({ quests: activeOn('visit') }) })).day1).toBe(true);
  });

  it('opens Deploy on a deploy step, a quest done, a linked account, or any deploy', () => {
    expect(ladder(input()).tabs.has('deploy')).toBe(false);
    expect(ladder(input({ progress: p({ quests: activeOn('deploy') }) })).tabs.has('deploy')).toBe(true);
    expect(ladder(input({ progress: p({ quests: doneQuest }) })).tabs.has('deploy')).toBe(true);
    expect(ladder(input({ linked: true })).tabs.has('deploy')).toBe(true);
    expect(ladder(input({ hasDeploys: true })).tabs.has('deploy')).toBe(true);
  });

  it('keeps everything reachable: anything opened anyway stays open', () => {
    const l = ladder(input({ opened: new Set(['map', 'deploy', 'learnBuild', 'day1']) }));
    expect([...l.tabs].sort()).toEqual(['deploy', 'home', 'learn', 'map', 'quests']);
    expect(l.learnBuild && l.day1).toBe(true);
    expect(lockedAreas(input({ opened: new Set(['learn']) }))[0].area).toBe('map');
  });

  it('unlocks everything for a seasoned player (tests/fixtures/progress-all.json)', () => {
    const i = input({ progress: all as Progress });
    expect([...ladder(i).tabs].sort()).toEqual(['deploy', 'home', 'learn', 'map', 'quests']);
    expect(ladder(i)).toMatchObject({ learnBuild: true, care: true, day1: true, worldList: true, news: true });
    expect(nextUnlock(i)).toBeUndefined();
  });
});

describe('Architecture offers one puzzle first', () => {
  it("the quest's puzzle, else the next quest's unpassed one, else the first unpassed", async () => {
    const { featuredPuzzle } = await import('@/ui/logic');
    expect(featuredPuzzle(p(), 'global-db')).toBe('global-db');
    const active = activeOn('puzzle');
    const [qid, st] = Object.entries(active)[0];
    const step = QUESTS.find((q) => q.id === qid)!.steps[st.step] as { puzzleId: string };
    expect(featuredPuzzle(p({ quests: active }))).toBe(step.puzzleId);
    // Everything passed: the first puzzle (the smoke run's diagram).
    expect(featuredPuzzle(all as Progress)).toBe('thumbnails');
  });
});
