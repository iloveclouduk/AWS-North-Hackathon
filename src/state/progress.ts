import type { Progress } from '@/backend/contract';

export type Streak = NonNullable<Progress['streak']>;

const pad = (n: number) => String(n).padStart(2, '0');

/** The player's local calendar day as YYYY-MM-DD (a learning day is the player's day, not UTC's). */
export const dayKey = (date: Date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/**
 * Whole calendar days from `a` to `b` (both YYYY-MM-DD). Counted on UTC midnights, so a 23- or 25-hour
 * local day around a clock change is still exactly one day apart.
 */
export const daysBetween = (a: string, b: string) => {
  const utc = (k: string) => {
    const [y, m, d] = k.split('-').map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.round((utc(b) - utc(a)) / 86_400_000);
};

/**
 * The streak after a learning day on `today`: the same day changes nothing, the next day adds one, and
 * a gap starts again at 1. A clock that went backwards keeps what was earned.
 */
export const nextStreak = (prev: Streak | undefined, today: string): Streak => {
  if (!prev) return { days: 1, last: today, best: 1 };
  const gap = daysBetween(prev.last, today);
  if (gap <= 0) return prev;
  const days = gap === 1 ? prev.days + 1 : 1;
  return { days, last: today, best: Math.max(prev.best, days) };
};

/** The streak as it stands on `today`: still alive if the last learning day was today or yesterday, else 0. */
export const currentStreak = (s: Streak | undefined, today: string) => {
  if (!s) return 0;
  const gap = daysBetween(s.last, today);
  return gap === 0 || gap === 1 ? s.days : 0;
};

/** Two copies of a streak: the later `last` wins (ties: more days), and `best` is the higher of both. */
export const mergeStreak = (a: Streak | undefined, b: Streak | undefined): Streak | undefined => {
  if (!a || !b) return a ?? b;
  const later = a.last > b.last ? a : b.last > a.last ? b : a.days >= b.days ? a : b;
  return { days: later.days, last: later.last, best: Math.max(a.best, b.best, later.days) };
};

/** What the player did on one day (device-local; the synced part is the streak). */
export interface DayLog {
  day: string;
  cards: number;
  puzzles: number;
  fixes: number;
  /** Mini-game rounds (absent in logs saved before games counted). */
  games?: number;
}
export type LearningKind = 'cards' | 'puzzles' | 'fixes' | 'games';

/** Adds one learning action to the day's log, starting a fresh log when the day has changed. */
export const bumpDay = (log: DayLog | undefined, kind: LearningKind, today: string): DayLog => {
  const base = log?.day === today ? log : { day: today, cards: 0, puzzles: 0, fixes: 0, games: 0 };
  return { ...base, [kind]: (base[kind] ?? 0) + 1 };
};

const pickBy = <T>(a: Record<string, T> | undefined, b: Record<string, T> | undefined, better: (x: T, y: T) => T) => {
  if (!a && !b) return undefined;
  const out: Record<string, T> = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) out[k] = k in out ? better(out[k]!, v) : v;
  return out;
};

/**
 * Two copies of a player's progress (this surface, the other surface, the server) combined so nothing
 * earned in either is lost: discoveries and finished quests stick, XP (landmarks and citizens) and bests take the higher value, fix times the newest.
 * Pure and order-independent, so every surface converges on the same result.
 */
export const mergeProgress = (a: Progress, b: Progress): Progress => {
  const landmarks = pickBy(a.landmarks, b.landmarks, (x, y) => ({ discovered: x.discovered || y.discovered, xp: Math.max(x.xp, y.xp) }))!;
  const merged: Progress = { version: a.version, landmarks, updatedAt: a.updatedAt > b.updatedAt ? a.updatedAt : b.updatedAt };
  // v2.7: each Region's city merges landmark by landmark, the same way.
  const cities = pickBy(a.cities, b.cities, (x, y) => ({ landmarks: pickBy(x.landmarks, y.landmarks, (l, m) => ({ discovered: l.discovered || m.discovered, xp: Math.max(l.xp, m.xp) }))! }));
  if (cities) merged.cities = cities;
  const cards = pickBy(a.cards, b.cards, (x, y) => (y.reps > x.reps || (y.reps === x.reps && y.due > x.due) ? y : x));
  const quests = pickBy(a.quests, b.quests, (x, y) => {
    if (x.status !== y.status) return x.status === 'done' ? x : y;
    return y.step > x.step || (y.step === x.step && (y.count ?? 0) > (x.count ?? 0)) ? y : x;
  });
  const puzzles = pickBy(a.puzzles, b.puzzles, (x, y) => ({ best: Math.max(x.best, y.best) }));
  const games = pickBy(a.games, b.games, (x, y) => ({ best: Math.max(x.best, y.best), plays: Math.max(x.plays, y.plays) }));
  // v2.3: what citizens learned (higher wins) and when findings were fixed (newest wins).
  const citizens = pickBy(a.citizens, b.citizens, (x, y) => ({ xp: Math.max(x.xp, y.xp) }));
  const fixes = pickBy(a.fixes, b.fixes, (x, y) => (y > x ? y : x));
  if (cards) merged.cards = cards;
  if (citizens) merged.citizens = citizens;
  if (fixes) merged.fixes = fixes;
  if (quests) merged.quests = quests;
  if (puzzles) merged.puzzles = puzzles;
  if (games) merged.games = games;
  // v2.9: a token found stays found; the earlier date is when it was found.
  const finds = pickBy(a.finds, b.finds, (x, y) => (x < y ? x : y));
  if (finds) merged.finds = finds;
  const streak = mergeStreak(a.streak, b.streak);
  if (streak) merged.streak = streak;
  // v2.5: the bill switch is a choice, not a score: the newer copy's choice wins, and a copy that never set it doesn't
  // count. On a tie, off wins (each server read costs the player money).
  const [newer, older] = b.updatedAt > a.updatedAt ? [b, a] : [a, b];
  const bill = a.updatedAt === b.updatedAt && a.bill !== undefined && b.bill !== undefined ? a.bill && b.bill : (newer.bill ?? older.bill);
  if (bill !== undefined) merged.bill = bill;
  return merged;
};

/** True when `b` adds nothing to `a` (so there's nothing to load or save). */
export const sameProgress = (a: Progress, b: Progress) => JSON.stringify(mergeProgress(a, b)) === JSON.stringify(mergeProgress(a, a));

/** Today's small goals on Home: a few cards, one puzzle, one mini-game, one fix. Each only once its area is open. */
export interface TodayGoal {
  id: LearningKind;
  label: string;
  have: number;
  goal: number;
}
export const TODAY_CARDS = 5;
export function todayGoals(log: DayLog | undefined, day: string, open: { learn: boolean; puzzles: boolean; care: boolean; games?: boolean }): TodayGoal[] {
  const today = log?.day === day ? log : undefined;
  const goals: TodayGoal[] = [];
  if (open.learn) goals.push({ id: 'cards', label: `Review ${TODAY_CARDS} cards`, have: Math.min(TODAY_CARDS, today?.cards ?? 0), goal: TODAY_CARDS });
  if (open.puzzles) goals.push({ id: 'puzzles', label: 'Pass a puzzle', have: Math.min(1, today?.puzzles ?? 0), goal: 1 });
  if (open.games) goals.push({ id: 'games', label: 'Play a mini-game', have: Math.min(1, today?.games ?? 0), goal: 1 });
  if (open.care) goals.push({ id: 'fixes', label: 'Fix something in the city', have: Math.min(1, today?.fixes ?? 0), goal: 1 });
  return goals;
}
