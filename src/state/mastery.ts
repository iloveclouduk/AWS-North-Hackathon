// Past Master, a building keeps growing, but only with what the player really knows: gold crowns (Lv 5–7) on its
// knowledge tower, earned from remembered cards, passed drawings, finished quests and games played, never from raw
// stars (stars can be farmed; a card remembered for a week can't). Pure; the city and the building card read it.

import type { Progress } from '@/backend/contract';
import { cardsFor, PUZZLES, QUESTS } from '@/world/content';
import { placeFor } from '@/world/places';
import world from '../../shared/world.json' with { type: 'json' };
import { PUZZLE_PASS } from './ladder';
import { tierOf } from './selectors';

/** A card counts as known once its next review is a week or more away (several good reviews over days). */
export const MASTERED_DAYS = 7;
/** Rounds of the building's game for the last crown (if it has one). */
export const CROWN_ROUNDS = 5;
/** The crowns' names, Lv 5–7 (shared/world.json `tiers.legend`). */
export const LEGEND_NAMES: string[] = (world.tiers as { legend?: string[] }).legend ?? ['Mentor', 'Architect', 'Legend'];
export const MAX_CROWNS = 3;
const MASTER = 4;

export interface CrownStep {
  label: string;
  done: boolean;
}

/** Cards of this service the player knows (interval ≥ MASTERED_DAYS) out of its deck. */
export function knownCards(p: Progress, serviceId: string) {
  const deck = cardsFor(serviceId);
  return { known: deck.filter((c) => (p.cards?.[c.id]?.interval ?? 0) >= MASTERED_DAYS).length, of: deck.length };
}

/** What each crown asks of this service (only the parts that exist for it: not every service has a drawing or a game). */
export function crownSteps(p: Progress, serviceId: string): CrownStep[][] {
  const { known, of } = knownCards(p, serviceId);
  const half = Math.ceil(of / 2);
  const puzzles = PUZZLES.filter((z) => z.required.includes(serviceId));
  const quests = QUESTS.filter((q) => q.serviceIds.includes(serviceId));
  const game = placeFor(serviceId)?.game;
  const one: CrownStep[] = [{ label: `Remember ${half} of its ${of} cards for a week (${Math.min(known, half)}/${half})`, done: known >= half }];
  const two: CrownStep[] = [{ label: `Remember all ${of} cards for a week (${known}/${of})`, done: of > 0 && known >= of }];
  if (puzzles.length) two.push({ label: 'Pass a drawing that uses it', done: puzzles.some((z) => (p.puzzles?.[z.id]?.best ?? 0) >= PUZZLE_PASS) });
  const three: CrownStep[] = [];
  if (quests.length) three.push({ label: 'Finish a quest about it', done: quests.some((q) => p.quests?.[q.id]?.status === 'done') });
  if (game) {
    const plays = p.games?.[game]?.plays ?? 0;
    three.push({ label: `Play its game ${CROWN_ROUNDS} times (${Math.min(plays, CROWN_ROUNDS)}/${CROWN_ROUNDS})`, done: plays >= CROWN_ROUNDS });
  }
  if (!three.length) three.push({ label: 'Remember every card for a month', done: of > 0 && cardsFor(serviceId).every((c) => (p.cards?.[c.id]?.interval ?? 0) >= 30) });
  return [one, two, three];
}

/** Crowns earned at this building (0–3): each needs the ones before it, and only a Master building wears them. */
export function crownsOf(p: Progress, serviceId: string, region?: string) {
  if (tierOf(p, serviceId, region) < MASTER) return 0;
  let n = 0;
  for (const steps of crownSteps(p, serviceId)) {
    if (!steps.every((s) => s.done)) break;
    n++;
  }
  return n;
}

/** The level a sign shows: 1–4 for the tiers, 5–7 with crowns. */
export const levelOf = (p: Progress, serviceId: string, region?: string) => {
  const t = tierOf(p, serviceId, region);
  return t < MASTER ? t : MASTER + crownsOf(p, serviceId, region);
};

/** A level's name: the tier names, then the crowns'. */
export const buildingLevelName = (level: number, tierNames: string[]) => (level <= MASTER ? tierNames[level] : LEGEND_NAMES[level - MASTER - 1]);
