import { tierOf } from '@/state/selectors';
import { useCity } from '@/state/store';
import { deal } from '@/world/minigames';

/** ⋯ → Accessibility → Games without a clock (WCAG 2.2.1): rounds end when the player says, and play runs slower. */
export const relaxed = () => !!useCity.getState().prefs.relaxed;

/** The building's level that opens its game's Expert round. */
export const EXPERT_TIER = 3;
/** Expert play is this much quicker (shorter reaction windows and spawn gaps)… */
export const EXPERT_PACE = 0.7;
/** …and earns this much more. */
export const EXPERT_STARS = 1.5;

let expertRound = false;
/** The next round (and the one after "Play again") is an Expert round. Leaving the game turns it off. */
export const setExpert = (on: boolean) => void (expertRound = on);
// Leaving the game, however the player leaves (← City, a tab, the map), ends Expert play.
useCity.subscribe((s) => {
  if (expertRound && s.view.name !== 'game') expertRound = false;
});
/** Is this round an Expert one? Never in relaxed play: the two don't mix. */
export const expert = () => expertRound && !relaxed();

/** A game's Expert round opens when its building reaches level 3 in this city. */
export function expertOpen(serviceId: string) {
  const s = useCity.getState();
  return !relaxed() && tierOf(s.progress, serviceId, s.cityRegion) >= EXPERT_TIER;
}

/** A reaction window or spawn gap: `by` times longer in relaxed play, shorter in an Expert round. */
export const pace = (ms: number, by = 2) => (relaxed() ? ms * by : expert() ? Math.round(ms * EXPERT_PACE) : ms);

/** A quiz round's cards: in an Expert round only the two harder tiers, hardest first in the mix. */
export function dealRound<T extends { tier: number }>(pool: T[], plays: number, n: number) {
  if (!expert()) return deal(pool, plays, n);
  const hard = pool.filter((x) => x.tier >= 2);
  return deal(hard.length >= n ? hard : pool, 99, n);
}
