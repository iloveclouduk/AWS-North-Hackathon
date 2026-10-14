// The mini-games' question pools (shared/minigames.json): content is data, like quests and flashcards. Each item has a
// tier; a game deals from the tiers a player has reached, so regulars get the harder questions.
import json from '../../shared/minigames.json' with { type: 'json' };

export type StorageClass = 'standard' | 'ia' | 'glacier';
export interface Fish {
  name: string;
  hint: string;
  answer: StorageClass;
  why: string;
  tier: number;
}
export interface DnsQuestion {
  q: string;
  options: string[];
  answer: string;
  why: string;
  tier: number;
}
export type WafRule = 'sqli' | 'xss' | 'badinput' | 'bot' | 'rate';
export interface Attack {
  label: string;
  rule: WafRule;
  tier: number;
}

const DATA = json as unknown as {
  fishing: Fish[];
  route53: DnsQuestion[];
  shield: { attacks: Attack[]; good: string[]; rules: Record<WafRule, { name: string; group: string }> };
};
export const FISH = DATA.fishing;
export const DNS_QUESTIONS = DATA.route53;
export const SHIELD = DATA.shield;

/** The hardest tier a player has reached: 1 at first, 2 after two plays, 3 after five. */
export const tierFor = (plays: number) => (plays >= 5 ? 3 : plays >= 2 ? 2 : 1);

/**
 * `n` items for a round: shuffled from the tiers reached, with at least half from the top tier reached (so a regular
 * isn't dealt only easy ones), never repeating within the round.
 */
export function deal<T extends { tier: number }>(pool: T[], plays: number, n: number, rand: () => number = Math.random): T[] {
  const top = tierFor(plays);
  const shuffle = (xs: T[]) => xs.map((x) => ({ x, r: rand() })).sort((a, b) => a.r - b.r).map((o) => o.x);
  const hard = shuffle(pool.filter((x) => x.tier === top));
  const rest = shuffle(pool.filter((x) => x.tier < top));
  const want = top === 1 ? n : Math.ceil(n / 2);
  const picked = [...hard.slice(0, want), ...rest.slice(0, n - Math.min(want, hard.length))];
  return shuffle(picked.length < n ? [...picked, ...hard.slice(want)].slice(0, n) : picked);
}
