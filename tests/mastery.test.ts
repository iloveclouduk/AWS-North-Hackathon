import { describe, expect, it } from 'vitest';
import type { Progress } from '@/backend/contract';
import { buildingLevelName, CROWN_ROUNDS, crownsOf, crownSteps, LEGEND_NAMES, levelOf, MASTERED_DAYS } from '@/state/mastery';
import { cardsFor, PUZZLES, QUESTS } from '@/world/content';
import { TIER_NAMES } from '@/world/places';

const known = (id: string, n: number, days = MASTERED_DAYS) =>
  Object.fromEntries(cardsFor(id).slice(0, n).map((c) => [c.id, { interval: days, ease: 2.5, due: 0, reps: 4 }]));
const at = (id: string, xp: number, extra: Partial<Progress> = {}): Progress => ({ version: 1, landmarks: { [id]: { discovered: true, xp } }, updatedAt: '2026-10-13T00:00:00Z', ...extra });

describe('crowns past Master come from real knowledge (src/state/mastery.ts)', () => {
  it('names the crowns in shared/world.json', () => {
    expect(LEGEND_NAMES).toEqual(['Mentor', 'Architect', 'Legend']);
    expect(buildingLevelName(4, TIER_NAMES)).toBe('Master');
    expect(buildingLevelName(7, TIER_NAMES)).toBe('Legend');
  });

  it('a building below Master wears no crown, however much it knows', () => {
    const p = at('s3', 150, { cards: known('s3', 99) });
    expect(crownsOf(p, 's3')).toBe(0);
    expect(levelOf(p, 's3')).toBe(3);
  });

  it('stars alone stop at Master: a crown needs remembered cards', () => {
    expect(levelOf(at('s3', 5000), 's3')).toBe(4);
    const half = Math.ceil(cardsFor('s3').length / 2);
    expect(levelOf(at('s3', 200, { cards: known('s3', half - 1) }), 's3')).toBe(4);
    expect(levelOf(at('s3', 200, { cards: known('s3', half) }), 's3')).toBe(5);
    // a card reviewed yesterday isn't known yet
    expect(levelOf(at('s3', 200, { cards: known('s3', 99, 1) }), 's3')).toBe(4);
  });

  it('the second crown asks for the whole deck and a passed drawing that uses it', () => {
    const puzzle = PUZZLES.find((z) => z.required.includes('s3'))!;
    expect(puzzle).toBeDefined();
    const all = known('s3', 99);
    expect(crownsOf(at('s3', 200, { cards: all }), 's3')).toBe(1);
    expect(crownsOf(at('s3', 200, { cards: all, puzzles: { [puzzle.id]: { best: 80 } } }), 's3')).toBe(2);
  });

  it('the third asks for a finished quest and rounds of its game', () => {
    const puzzle = PUZZLES.find((z) => z.required.includes('s3'))!;
    const quest = QUESTS.find((q) => q.serviceIds.includes('s3'))!;
    const base = { cards: known('s3', 99), puzzles: { [puzzle.id]: { best: 80 } } };
    const done = { quests: { [quest.id]: { status: 'done' as const, step: 0 } } };
    expect(crownsOf(at('s3', 200, { ...base, ...done, games: { fishing: { best: 5, plays: CROWN_ROUNDS - 1 } } }), 's3')).toBe(2);
    expect(crownsOf(at('s3', 200, { ...base, ...done, games: { fishing: { best: 5, plays: CROWN_ROUNDS } } }), 's3')).toBe(3);
    expect(levelOf(at('s3', 200, { ...base, ...done, games: { fishing: { best: 5, plays: 9 } } }), 's3')).toBe(7);
  });

  it('every service has three crowns with something to do for each', () => {
    for (const id of ['s3', 'iam', 'bedrock', 'vpc', 'kms', 'q']) {
      const steps = crownSteps(at(id, 200), id);
      expect(steps).toHaveLength(3);
      for (const c of steps) expect(c.length).toBeGreaterThan(0);
    }
  });
});
