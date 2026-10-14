// How far a building has grown, for the line each activity shows when it pays stars ("S3 Lake · 52/100 to Expert").
// Pure: it reads the player's progress for one city (src/state/cities.ts landmarkOf) and the tier table.
import type { Progress } from '@/backend/contract';
import { placeFor, TIER_NAMES, TIER_XP, tierForXp } from '@/world/places';
import { landmarkOf } from './cities';

export interface Growth {
  place: string;
  xp: number;
  tier: number;
  /** Stars needed for the next level (undefined at the top). */
  next?: number;
  nextName?: string;
  /** 0..1 of the way from this level to the next (1 at the top). */
  pct: number;
}

export function growthOf(p: Progress, serviceId: string, region?: string): Growth {
  const xp = landmarkOf(p, serviceId, region)?.xp ?? 0;
  const tier = tierForXp(xp);
  const place = placeFor(serviceId)?.place ?? serviceId;
  const next = TIER_XP[tier + 1];
  if (next === undefined) return { place, xp, tier, pct: 1 };
  const from = TIER_XP[tier];
  return { place, xp, tier, next, nextName: TIER_NAMES[tier + 1], pct: Math.max(0, Math.min(1, (xp - from) / (next - from))) };
}

/** "S3 Lake · 52/100 to Expert", or "S3 Lake · fully grown". */
export const growthLine = (g: Growth) => (g.next === undefined ? `${g.place} · fully grown` : `${g.place} · ${g.xp}/${g.next} to ${g.nextName}`);

/**
 * Growing between levels (src/game/TierProps.ts draws it): a third of the way to the next level, scaffolding goes up
 * on the building's front corner; two-thirds of the way, a tower crane rises behind it. The level-up clears both.
 */
export const STAGE_SCAFFOLD = 1 / 3;
export const STAGE_CRANE = 2 / 3;
/** 0 = nothing yet, 1 = scaffolding, 2 = scaffolding and a crane. A fully grown building builds no more. */
export const constructionStage = (pct: number, top: boolean) => (top ? 0 : pct >= STAGE_CRANE ? 2 : pct >= STAGE_SCAFFOLD ? 1 : 0);
