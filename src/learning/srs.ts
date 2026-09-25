// SM-2 lite spaced repetition: cards you miss come back soon, cards you know drift out to weeks.
import type { CardState } from '@/backend/contract';

export type Grade = 'again' | 'good' | 'easy';
const DAY = 86_400_000;

export function review(prev: CardState | undefined, grade: Grade, now = Date.now()): CardState {
  const s = prev ?? { interval: 0, ease: 2.5, due: now, reps: 0 };
  if (grade === 'again') return { interval: 0, ease: Math.max(1.3, s.ease - 0.2), due: now + 60_000, reps: 0 };
  const ease = Math.min(3, Math.max(1.3, s.ease + (grade === 'easy' ? 0.15 : 0)));
  const interval = s.reps === 0 ? (grade === 'easy' ? 3 : 1) : s.reps === 1 ? (grade === 'easy' ? 7 : 3) : Math.round(s.interval * ease * (grade === 'easy' ? 1.3 : 1));
  return { interval, ease, due: now + interval * DAY, reps: s.reps + 1 };
}

export const isDue = (s: CardState | undefined, now = Date.now()) => !s || s.due <= now;

/** XP for a review: learning something new is worth more than re-confirming it. */
export const xpFor = (prev: CardState | undefined, grade: Grade) => (grade === 'again' ? 1 : prev?.reps ? 2 : 4);
