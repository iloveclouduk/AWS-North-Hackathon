// Citizen requests: now and then a passer-by has a quick AWS question. Kai walks over and answers it, and the answer
// is an ordinary flashcard review (src/learning/srs.ts) for a building the city already has, so it grows that building
// like any card would, plus a small thank-you. Pure: the scene picks the citizen, the card shows the question.

import type { Progress } from '@/backend/contract';
import { cardsFor, type Flashcard } from '@/world/content';
import { serviceById } from '@/world/taxonomy';
import { isDiscovered } from './selectors';
import { dueDeck } from './srs';

export interface CitizenRequest {
  cardId: string;
  serviceId: string;
  question: string;
  /** Three answers in simple words, one of them right (`right` is its index). */
  options: string[];
  right: number;
  /** The full answer, shown after. */
  answer: string;
}

/** At most this many a day: a treat in the street, not a quiz wall. */
export const REQUESTS_A_DAY = 5;
/** Stars a thank-you adds on top of the card's own (src/learning/srs.ts xpFor). */
export const THANKS_STARS = 2;
/** How long the city waits between one request and the next (ms). */
export const REQUEST_GAP_MS = 90_000;

export interface RequestLog {
  day: string;
  n: number;
}
export const requestsLeft = (log: RequestLog | undefined, today: string) => Math.max(0, REQUESTS_A_DAY - (log?.day === today ? log.n : 0));
export const countRequest = (log: RequestLog | undefined, today: string): RequestLog => ({ day: today, n: (log?.day === today ? log.n : 0) + 1 });

const short = (c: Flashcard) => c.simple ?? c.a;

/**
 * A request for the city in `region`: a card that's due (or new) from a building that stands there, with two wrong
 * answers from other buildings' cards. `seed` picks which (the same seed, the same request). Undefined when the
 * city has nothing to ask about yet.
 */
export function pickRequest(p: Progress, region: string | undefined, seed: number, now = Date.now()): CitizenRequest | undefined {
  const here = Object.keys(p.cities?.[region ?? '']?.landmarks ?? {})
    .concat(Object.keys(p.landmarks))
    .filter((id, i, all) => all.indexOf(id) === i && serviceById(id) && isDiscovered(p, id, region) && cardsFor(id).length > 0)
    .sort();
  if (!here.length) return undefined;
  const deck = dueDeck(p, here, 3, now);
  if (!deck.length) return undefined;
  const card = deck[Math.abs(seed) % deck.length]!;
  const serviceId = here.find((id) => cardsFor(id).some((c) => c.id === card.id))!;
  // Wrong answers from other services, so the right one isn't a near-duplicate of a sibling card.
  const others = here.filter((id) => id !== serviceId).flatMap(cardsFor);
  const pool = [...new Set((others.length >= 2 ? others : cardsFor(serviceId).filter((c) => c.id !== card.id)).map(short))].filter((t) => t !== short(card));
  if (pool.length < 2) return undefined;
  const a = pool[Math.abs(seed * 7 + 3) % pool.length]!;
  const b = pool.filter((t) => t !== a)[Math.abs(seed * 13 + 5) % (pool.length - 1)]!;
  const right = Math.abs(seed) % 3;
  const options = [a, b];
  options.splice(right, 0, short(card));
  return { cardId: card.id, serviceId, question: card.q, options, right, answer: card.a };
}
