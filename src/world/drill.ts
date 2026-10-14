// "Lights out": a practice drill the player starts by tapping a Zone island. One Availability Zone goes dark for a
// moment, and the city says whether "your app" would have kept running. Pure (the scene darkens the island and shows
// the bubble). It's a lesson about spreading across AZs, never AWS's status: real outages come only from AWS Health.
import type { Group, Placement } from './resources';

/** How long the island stays dark, ms. */
export const DRILL_MS = 20_000;

export interface KindSpread {
  /** What a player calls one ("server"). */
  noun: string;
  /** The zones (island indexes) that hold at least one. */
  zones: number[];
}
export interface DrillResult {
  /** The player has no zonal resources (servers, databases, caches, disks) in this city's zones. */
  empty: boolean;
  /** Every zonal kind spans two or more zones, so a live zone still has each: the app keeps running. */
  ok: boolean;
  /** It kept running only because the dark zone wasn't the one holding everything (each failing kind sits in one live zone). */
  lucky: boolean;
  /** Kinds that would have stopped (every one of them was in the dark zone). */
  down: string[];
  /** Kinds in one zone only (not resilient, even if that zone stayed up). */
  single: string[];
  spread: KindSpread[];
  /** The one line the concierge says. */
  line: string;
}

/** "Zone A": the island's letter as the map labels it (pass the scene's letters, else A, B, C… by order). */
const letterOf = (i: number, letters?: string[]) => letters?.[i] ?? String.fromCharCode(65 + i);
const plural = (noun: string) => (noun.endsWith('s') ? noun : `${noun}s`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const words = ['', 'one', 'two', 'three', 'four', 'five', 'six'];

/**
 * Which zonal kinds sit in which zones. A capped island ("+N") counts what it shows: the overflow is the same island,
 * so it adds no zone.
 */
export function spreadOf(zones: Pick<Group, 'shown'>[]): KindSpread[] {
  const by = new Map<string, Set<number>>();
  zones.forEach((g, i) => {
    for (const p of g.shown) if (p.info.zonal) (by.get(p.info.noun) ?? by.set(p.info.noun, new Set()).get(p.info.noun)!).add(i);
  });
  return [...by].map(([noun, z]) => ({ noun, zones: [...z].sort((a, b) => a - b) }));
}

/** What happens to "your app" when zone `dark` goes dark. */
export function drillOutcome(placement: Pick<Placement, 'zones'>, dark: number, letters?: string[]): DrillResult {
  const spread = spreadOf(placement.zones);
  const zone = `Zone ${letterOf(dark, letters)}`;
  if (!spread.length) {
    return {
      empty: true,
      ok: false,
      lucky: false,
      down: [],
      single: [],
      spread,
      line: `Nothing of yours stands in ${zone} yet, so nothing went dark. Start servers in two zones and try again!`,
    };
  }
  const single = spread.filter((k) => k.zones.length < 2).map((k) => k.noun);
  const down = spread.filter((k) => k.zones.every((z) => z === dark)).map((k) => k.noun);
  const ok = single.length === 0;
  const lucky = !ok && down.length === 0;
  let line: string;
  if (ok) {
    const fewest = Math.min(...spread.map((k) => k.zones.length));
    const nouns = spread.map((k) => plural(k.noun));
    line = `Your app kept running! 🎉 ${cap(list(nouns.slice(0, 2)))} in ${words[fewest] ?? fewest} zones.`;
  } else if (lucky) {
    const first = spread.find((k) => k.zones.length === 1)!;
    line = `Phew, it kept running, but only because your ${plural(first.noun)} were all in Zone ${letterOf(first.zones[0], letters)}, not ${zone}. Put ${plural(first.noun)} in two zones next time.`;
  } else if (down.length === spread.length) {
    line = `Uh oh, everything was in ${zone}. Put ${plural(down.includes('server') ? 'server' : down[0])} in two zones next time.`;
  } else {
    line = `Uh oh, your ${list(down.map(plural))} were all in ${zone}. Put ${plural(down[0])} in two zones next time.`;
  }
  return { empty: false, ok, lucky, down, single, spread, line };
}
