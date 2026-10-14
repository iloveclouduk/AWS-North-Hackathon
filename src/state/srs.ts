// What the Learn tab asks of the player (pure, tested in tests/ui-logic.test.ts): the badge counts only cards the
// player has met and is due to see again, plus what the active quest's cards step still wants. New cards never
// nag; the Due deck takes at most NEW_CARDS_PER_DAY of them a day.

import type { Progress } from '@/backend/contract';
import { isDue } from '@/learning/srs';
import { cardsFor, questById, type Flashcard } from '@/world/content';

/** New cards the Due deck adds in a day. */
export const NEW_CARDS_PER_DAY = 10;

/** Reviewed cards due again now, plus the cards the active quests' cards steps still need. */
export function badgeCount(p: Progress, now = Date.now()): number {
  const due = Object.values(p.cards ?? {}).filter((c) => isDue(c, now)).length;
  const quest = Object.entries(p.quests ?? {}).reduce((n, [id, st]) => {
    const step = st.status === 'active' ? questById(id)?.steps[st.step] : undefined;
    return step?.kind === 'cards' ? n + Math.max(0, step.count - (st.count ?? 0)) : n;
  }, 0);
  return due + quest;
}

/** One service's reviewed cards that are due again now: the number its building's sign shows (🃏). */
export function dueFor(p: Progress, serviceId: string, now = Date.now()): number {
  return cardsFor(serviceId).filter((c) => p.cards?.[c.id] && isDue(p.cards[c.id], now)).length;
}

/** `{ day, n }` new cards started on `day` (the local date, YYYY-MM-DD). */
export interface NewCardLog {
  day: string;
  n: number;
}

/** New cards the Due deck may still add today. */
export const newCardsLeft = (log: NewCardLog | undefined, today: string) => Math.max(0, NEW_CARDS_PER_DAY - (log?.day === today ? log.n : 0));

/**
 * The Due deck ("All my decks") over these services: every reviewed card that's due, then new cards up to
 * today's allowance. Easier tiers first within each group.
 */
export function dueDeck(p: Progress, serviceIds: string[], newLeft: number, now = Date.now()): Flashcard[] {
  const cards = serviceIds.flatMap((id) => cardsFor(id));
  const byTier = (a: Flashcard, b: Flashcard) => a.tier - b.tier;
  const seen = cards.filter((c) => p.cards?.[c.id] && isDue(p.cards[c.id], now)).sort(byTier);
  const fresh = cards.filter((c) => !p.cards?.[c.id]).sort(byTier);
  return [...seen, ...fresh.slice(0, newLeft)];
}
