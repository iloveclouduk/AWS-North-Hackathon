// How busy the city's roads are (pure; plan B3). Ambient traffic is never a stand-in for an agent (the data carriers in
// src/world/carriers.ts are the vehicles that mean something, and they share this cap): it only says, at
// a glance, how much of the account lives in this Region. A base of 4 cars, plus 2·log2(1 + resources here), plus up
// to 3 more from this Region's month-to-date bill when the player turned the bill on; capped per surface so the side
// panel stays light (src/game/Traffic.ts draws it).
import type { CityBillEvent, CityInventoryEvent } from '@/backend/contract';

export type Surface = 'panel' | 'tab';

/** Most vehicles on the roads at once (plan B6 budget). */
export const VEHICLE_CAP: Record<Surface, number> = { panel: 8, tab: 14 };
/** Most strolling citizens (the crowd, not the six Well-Architected citizens) at once (plan B6 budget). */
export const CITIZEN_CAP: Record<Surface, number> = { panel: 12, tab: 20 };
/** Narrower than this and the city is in the side panel (CityScene uses the same break). */
export const PANEL_MAX_WIDTH = 560;
export const surfaceFor = (width: number): Surface => (width < PANEL_MAX_WIDTH ? 'panel' : 'tab');

type Inv = Pick<CityInventoryEvent, 'items' | 'region'> & Partial<Pick<CityInventoryEvent, 'regions' | 'homeRegion'>>;

/** Resources the account has in a Region: the per-Region count when the server sent one, else the listed items there. */
export function resourcesIn(inv: Inv | undefined, region: string): number {
  if (!inv) return 0;
  if (inv.regions && region in inv.regions) return Math.max(0, inv.regions[region] ?? 0);
  const home = inv.homeRegion ?? inv.region;
  return inv.items.filter((i) => (i.region ?? home) === region).length;
}

/** Extra vehicles for this Region's spend: +1 from $10, +2 from $100, +3 from $1,000 (log10, capped at 3). */
export function billBoost(bill: CityBillEvent | undefined, region: string): number {
  if (!bill || bill.unavailable !== undefined) return 0;
  const dollars = Math.max(0, bill.byRegion[region] ?? 0);
  return Math.min(3, Math.floor(Math.log10(1 + dollars)));
}

/** How many vehicles drive round this Region's city. */
export function trafficLevel(inv: Inv | undefined, bill: CityBillEvent | undefined, region: string, surface: Surface): number {
  const level = 4 + Math.round(2 * Math.log2(1 + resourcesIn(inv, region))) + billBoost(bill, region);
  return Math.min(VEHICLE_CAP[surface], level);
}
