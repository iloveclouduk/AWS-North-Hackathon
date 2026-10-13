// What an architecture drawing pays the buildings it uses. Drawing is the hardest learning in the city, so it pays the
// most (it used to pay 5 per service on a better pass and nothing below the pass mark, so a 50 grew nothing):
// - a first pass: PASS_XP to every required service, plus FIRST_PASS_BONUS to the puzzle's first one;
// - a better pass later: IMPROVE_XP each (re-checking the same answer pays nothing);
// - a try below the pass mark: TRY_XP for each required service already in place, once per puzzle per day.
// `best` only ever records a passing score (src/state/store.ts recordPuzzle), so a failed try can't block a later pass.
import { PUZZLE_PASS } from '@/state/ladder';

export const PASS_XP = 12;
export const FIRST_PASS_BONUS = 10;
export const IMPROVE_XP = 4;
export const TRY_XP = 2;

export type RewardKind = 'first' | 'better' | 'try' | 'none';

export interface PuzzleReward {
  kind: RewardKind;
  /** Stars per service id. */
  xp: Record<string, number>;
}

export function puzzleReward(
  puzzle: { required: string[] },
  result: { passed: boolean; score: number; missing: string[] },
  prevBest: number,
  triedToday: boolean,
): PuzzleReward {
  const xp: Record<string, number> = {};
  if (result.passed && prevBest < PUZZLE_PASS) {
    for (const s of puzzle.required) xp[s] = PASS_XP;
    if (puzzle.required[0]) xp[puzzle.required[0]] += FIRST_PASS_BONUS;
    return { kind: 'first', xp };
  }
  if (result.passed) {
    if (result.score <= prevBest) return { kind: 'none', xp };
    for (const s of puzzle.required) xp[s] = IMPROVE_XP;
    return { kind: 'better', xp };
  }
  if (triedToday) return { kind: 'none', xp };
  for (const s of puzzle.required) if (!result.missing.includes(s)) xp[s] = TRY_XP;
  return { kind: Object.keys(xp).length ? 'try' : 'none', xp };
}

/** Puzzles that already paid a try today (in memory: a reload is a fresh day's try, which is fine). */
const tried = new Map<string, string>();
/** True once per puzzle per day; marks it. */
export function firstTryToday(puzzleId: string, day = new Date().toISOString().slice(0, 10), seen = tried) {
  if (seen.get(puzzleId) === day) return false;
  seen.set(puzzleId, day);
  return true;
}

/** The pass rule in a sentence, with what's in the way. */
export function passHint(result: { passed: boolean; score: number; missing: string[] }, names: (id: string) => string) {
  if (result.passed) return undefined;
  const needs: string[] = [];
  if (result.missing.length) needs.push(`add ${result.missing.map(names).join(', ')}`);
  if (result.score < PUZZLE_PASS) needs.push(`score ${PUZZLE_PASS - result.score} more`);
  return `To pass: ${PUZZLE_PASS} or more with nothing missing. You're at ${result.score}${needs.length ? `: ${needs.join(' and ')}` : ''}.`;
}
