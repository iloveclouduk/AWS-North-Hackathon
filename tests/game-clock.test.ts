import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { syncClock } from '@/game/scenes/games/clock';

// A mini-game's clock must start from now, not from when the scene last stopped (Phaser syncs it only at boot).
describe('mini-game clock', () => {
  it('syncClock sets the scene clock to the game loop time', () => {
    const scene = { time: { now: 1_000 }, game: { loop: { time: 987_654 } } };
    syncClock(scene);
    expect(scene.time.now).toBe(987_654);
  });

  it('every mini-game round starts by syncing its clock', () => {
    for (const f of ['src/game/scenes/games/MiniGame.ts', 'src/game/scenes/FishingScene.ts']) {
      const src = fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
      expect(src, f).toMatch(/create\(\) \{\s*\n\s*syncClock\(this\);/);
    }
  });
});

describe('mini-game combo', async () => {
  const { comboMultiplier, comboStepUp } = await import('@/game/scenes/games/combo');

  it('multiplies right answers in a row: ×1, then ×2 from 3, ×3 from 6', () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(comboMultiplier)).toEqual([1, 1, 2, 2, 2, 3, 3]);
  });

  it('announces only the answers that raise the multiplier', () => {
    expect([1, 2, 3, 4, 5, 6, 7].filter(comboStepUp)).toEqual([3, 6]);
  });
});

describe('mini-game stars', async () => {
  const { countRound, roundStars, FULL_ROUNDS_A_DAY } = await import('@/learning/gameStars');
  it('full stars for the first rounds of the day and any new best, half after that', () => {
    const seen = new Map();
    const rounds = Array.from({ length: 5 }, () => countRound('shield', '2026-10-13', seen));
    expect(rounds).toEqual([0, 1, 2, 3, 4]);
    expect(rounds.map((n) => roundStars(20, n, false))).toEqual([20, 20, 20, 10, 10]);
    expect(roundStars(20, FULL_ROUNDS_A_DAY + 5, true)).toBe(20);
    expect(countRound('shield', '2026-10-14', seen)).toBe(0);
  });
});
