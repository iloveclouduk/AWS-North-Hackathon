// The mini-games' combo: right answers in a row multiply the points (×2 from 3, ×3 from 6); a mistake ends the streak.
// Pure, so it's tested without Phaser (tests/game-clock.test.ts). Stars still come from the score, capped as before.
export const COMBO_STEPS = [
  { from: 6, mult: 3 },
  { from: 3, mult: 2 },
] as const;

/** The points multiplier for a streak of `streak` right answers in a row (including this one). */
export const comboMultiplier = (streak: number) => COMBO_STEPS.find((s) => streak >= s.from)?.mult ?? 1;

/** True when this answer just raised the multiplier (time to say "×2!"). */
export const comboStepUp = (streak: number) => comboMultiplier(streak) > comboMultiplier(streak - 1);
