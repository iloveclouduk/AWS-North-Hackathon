import world from '../../shared/world.json' with { type: 'json' };

// Every service is a themed place whose metaphor teaches what the service does.
// Agent `activity` picks the working animation (see game/sprites.ts); `kind` picks the landmark art.

export type ActivityKind =
  | 'type' // sat at a computer typing
  | 'fish' // rod + bobbing line
  | 'guard' // shield raised
  | 'dance' // arms up, bouncing
  | 'cook' // pan flipping
  | 'file' // stacking index cards / books
  | 'hammer' // building / assembling
  | 'scan' // camera / magnifier
  | 'think' // pondering, thought dots
  | 'carry' // carrying crates
  | 'check' // checking badges with clipboard
  | 'lock'; // turning a big key

export type LandmarkKind = 'building' | 'lake' | 'wall' | 'tower' | 'garden' | 'stall' | 'dome' | 'dock' | 'factory' | 'warehouse' | 'station';

export interface Place {
  serviceId: string;
  place: string;
  kind: LandmarkKind;
  agentName: string;
  activity: ActivityKind;
  /** One-line hook shown on the landmark card. */
  blurb: string;
  /** Concepts the landmark teaches, Foundation → Expert. */
  teaches: string[];
  /** What unlocking each tier means: [Foundation, Associate, Professional, Expert]. */
  tiers: string[];
  /** Mini-game id, if the place is playable. */
  game?: GameId;
}

export type GameId = 'fishing' | 'shield' | 'route53' | 'lambda';

export const PLACES: Place[] = world.services.map((s) => ({
  serviceId: s.id,
  place: s.place,
  kind: s.kind as LandmarkKind,
  agentName: s.agentName,
  activity: s.activity as ActivityKind,
  blurb: s.blurb,
  teaches: s.teaches,
  tiers: s.tiers,
  game: (s as { game?: string }).game as GameId | undefined,
}));

export const placeFor = (serviceId: string) => PLACES.find((p) => p.serviceId === serviceId);

export interface SpecialAgent {
  id: string;
  name: string;
  activity: ActivityKind;
  color: number;
  role: string;
}

/** Special agents that aren't tied to a service. */
export const SPECIAL_AGENTS: Record<'concierge' | 'lookout' | 'builder', SpecialAgent> = Object.fromEntries(
  Object.entries(world.special).map(([id, a]) => [id, { id, name: a.name, activity: a.activity as ActivityKind, role: a.role, color: parseInt(a.color.slice(1), 16) }]),
) as Record<'concierge' | 'lookout' | 'builder', SpecialAgent>;

export const TIER_NAMES = world.tiers.names;
/** XP needed to reach tier index i (tier 0 = discovered). */
export const TIER_XP = world.tiers.xp;
/** Certification each tier maps to. */
export const TIER_CERTS = world.tiers.certifications;

export function tierForXp(xp: number): number {
  let t = 0;
  for (let i = 0; i < TIER_XP.length; i++) if (xp >= TIER_XP[i]) t = i;
  return t;
}
