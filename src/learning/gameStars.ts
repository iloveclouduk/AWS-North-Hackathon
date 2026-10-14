// Stars a mini-game round pays its building: full for the first few rounds of a game each day and for any new best,
// half after that, so the city grows from learning across the board (cards, drawings, games), not one game on repeat.
export const FULL_ROUNDS_A_DAY = 3;

export const roundStars = (base: number, roundsToday: number, newBest: boolean) => (newBest || roundsToday < FULL_ROUNDS_A_DAY ? base : Math.ceil(base / 2));

/** S3 fishing: 3 stars a right bucket and 5 for a perfect round, paid once at the end under the same daily rule. */
export const fishingStars = (correct: number, perfect: boolean, roundsToday: number, newBest: boolean) =>
  roundStars(correct * 3 + (perfect ? 5 : 0), roundsToday, newBest);

/** Rounds played per game today (in memory: a reload starts the count again, which is fine). */
const played = new Map<string, { day: string; n: number }>();
/** How many rounds of `game` were played before this one today; counts this one. */
export function countRound(game: string, day = new Date().toISOString().slice(0, 10), seen = played) {
  const cur = seen.get(game);
  const n = cur?.day === day ? cur.n : 0;
  seen.set(game, { day, n: n + 1 });
  return n;
}
