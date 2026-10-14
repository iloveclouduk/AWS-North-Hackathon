// Data carriers: the city's vehicles that stand for real data (src/game/RegionOverlay.ts drives them via Ambient.dispatchData). Pure, so the
// tests and the card share one model. Everything else on the roads is ambience (CLAUDE.md "City life is ambience").
import type { DataLink } from '@/backend/contract';
import carriersJson from '../../shared/carriers.json' with { type: 'json' };
import type { Surface } from './traffic';

export type CarrierKind = 'tanker' | 'armoured' | 'request' | 'courier';
export const CARRIER_KINDS: CarrierKind[] = ['tanker', 'armoured', 'request', 'courier'];

/** Which vehicle carries each kind of data link. */
export const CARRIER_FOR: Record<DataLink['kind'], CarrierKind> = { replication: 'tanker', standby: 'armoured', traffic: 'request' };

/** The sprite prefix (four facings: `${skin}:SE`…), drawn by art/tiles/vehicles_art.py. */
export const carrierSkin = (k: CarrierKind) => `veh:data:${k}`;

/** Data carriers on the roads at once, at most: well inside the vehicle cap, so ambient traffic never vanishes. */
export const DATA_CAP: Record<Surface, number> = { panel: 3, tab: 6 };

/** What a tapped carrier is carrying: shown on its card. */
export interface Cargo {
  kind: CarrierKind;
  /** What it is, e.g. "sessions table". */
  label: string;
  /** Where it's going, in words: "Zone A → Zone C", "→ eu-west-1". */
  route: string;
  /** The list price of this data's trip, when it has one ("$0.01 per GB out, and again in"). */
  cost?: string;
}

export interface CarrierText {
  name: string;
  simple: string;
  more: string;
  source: string;
}
export const CARRIERS = (carriersJson as unknown as { carriers: Record<CarrierKind, CarrierText> }).carriers;

/**
 * Request cars a minute for a live rate (city.flow): log-scaled so 1 a minute and 10,000 a minute both read, and
 * capped so a busy account never floods the roads. 0 → 0, 1 → 1, 10 → 2, 100 → 4, 1,000 → 5, 10,000+ → 6.
 */
export const MAX_CARS_PER_MIN = 6;
export const carsPerMinute = (perMin: number) =>
  Number.isFinite(perMin) && perMin > 0 ? Math.min(MAX_CARS_PER_MIN, Math.ceil(1.5 * Math.log10(1 + perMin))) : 0;
