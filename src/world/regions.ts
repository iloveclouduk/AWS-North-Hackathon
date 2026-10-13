import factsJson from '../../shared/region-facts.json' with { type: 'json' };
import pricesJson from '../../shared/prices.json' with { type: 'json' };
import flavourJson from '../../shared/region-flavour.json' with { type: 'json' };
import { REGIONS, type Region } from './culture';

/** What AWS says about a service in a Region (AWS Knowledge MCP regional availability). */
export type ServiceStatus = 'available' | 'planned' | 'considering' | 'not-planned' | 'outside-partition';
export interface ServiceAvailability {
  status: ServiceStatus;
  /** e.g. "2026 Q4", for planned launches. */
  launch?: string;
  /** For a landmark that stands for several products (SQS & SNS, Amazon Q…): each one's own status. */
  extra?: { product: string; status: ServiceStatus; launch?: string }[];
  /** A caveat from the service's own Regions page ("Free tier only in opt-in Regions"). */
  note?: string;
  /** The service's own docs page, where it overrides the availability tool. */
  source?: string;
}
export interface RegionFacts {
  partition: 'aws' | 'aws-us-gov' | 'aws-eusc';
  optIn: boolean;
  geography?: string;
  /** Real AZ IDs (the same physical place in every account). Empty where AWS doesn't publish them. */
  azIds: string[];
  /** The Regions table's count when it disagrees with the AZ table. */
  regionsTableAzCount?: number;
  /** Newer accounts get fewer AZs here (US West (N. California)). */
  fewerForNewAccounts?: boolean;
  comingAzs?: { year: number; geography: string }[];
  /** One of the Regions where accounts created before November 2025 have their own AZ names (az-ids.html). */
  independentNames?: boolean;
  services: Record<string, ServiceAvailability>;
}
export interface Price {
  key: string;
  serviceId: string;
  usd: number;
  unit: string;
  label: string;
  sku: string;
  source: string;
  from: string;
  byDestination?: Record<string, number>;
}

export const FACTS = factsJson as unknown as { asOf: string; source: string; docs: Record<string, string>; global: string[]; regions: Record<string, RegionFacts> };
export const PRICES = pricesJson as unknown as { asOf: string; currency: string; note: string; skipped: { region: string; reason: string }[]; regions: Record<string, Price[]> };

/** Every Region has at least three AZs (docs); that's what the city draws where AWS doesn't list AZ IDs. */
export const MIN_AZS = 3;

export const regionFacts = (code: string): RegionFacts | undefined => FACTS.regions[code];
export const regionInfo = (code: string): Region | undefined => REGIONS.regions.find((r) => r.code === code);

/** A Region city's own landmark by the highway (shared/region-flavour.json, drawn by art/tiles/signatures_art.py). */
export interface Signature {
  motif: string;
  variant: string;
  /** Plain words for it, e.g. "Red suspension bridge": an impression of the place, never a famous building's name. */
  label: string;
}
const FLAVOUR = (flavourJson as unknown as { regions: Record<string, { signature?: Signature }> }).regions;
export const signatureFor = (code: string): Signature | undefined => FLAVOUR[code]?.signature;
export const signatureSprite = (s: Signature) => `sig:${s.motif}:${s.variant}`;
export const isGlobalService = (serviceId: string) => FACTS.global.includes(serviceId);

/** How a service stands in a Region. Unknown Regions or services count as available (never hide a landmark on missing data). */
export const availability = (serviceId: string, region: string): ServiceAvailability => FACTS.regions[region]?.services[serviceId] ?? { status: 'available' };
export const offered = (serviceId: string, region: string) => availability(serviceId, region).status === 'available';

const PARTITION_NAMES: Record<RegionFacts['partition'], string> = { aws: 'AWS', 'aws-us-gov': 'AWS GovCloud (US)', 'aws-eusc': 'AWS European Sovereign Cloud' };
export const partitionName = (code: string) => PARTITION_NAMES[FACTS.regions[code]?.partition ?? 'aws'];
/** GovCloud and the European Sovereign Cloud need their own accounts: a commercial account can't reach them. */
export const separatePartition = (code: string) => (FACTS.regions[code]?.partition ?? 'aws') !== 'aws';

/** Great-circle distance in km (for "nearest Region that offers it"). */
const km = (a: Region, b: Region) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};
/** The closest Regions (same partition first) that do offer a service. */
export const nearestOffering = (serviceId: string, region: string, n = 2): Region[] => {
  const here = regionInfo(region);
  if (!here) return [];
  const part = FACTS.regions[region]?.partition ?? 'aws';
  return REGIONS.regions
    .filter((r) => r.code !== region && offered(serviceId, r.code))
    .sort((a, b) => Number((FACTS.regions[a.code]?.partition ?? 'aws') !== part) - Number((FACTS.regions[b.code]?.partition ?? 'aws') !== part) || km(here, a) - km(here, b))
    .slice(0, n);
};

/** A Region's AZs, west → east in the city: the account's own names when known, else the AZ IDs in order. */
export interface Zone {
  id: string;
  /** The account's name for it (us-east-1a): only when the account told us (names map per account). */
  name?: string;
}
export const zonesFor = (region: string, account?: { name: string; id: string }[]): Zone[] => {
  const ids = FACTS.regions[region]?.azIds ?? [];
  if (account?.length) {
    // The account's view: its AZs by name; AZ IDs from the docs that the account can't see aren't drawn.
    return [...account].sort((a, b) => a.name.localeCompare(b.name)).map((z) => ({ id: z.id, name: z.name }));
  }
  if (ids.length) return ids.map((id) => ({ id }));
  return Array.from({ length: MIN_AZS }, (_, i) => ({ id: `AZ ${i + 1}` }));
};
/** Which zone an AZ name (us-east-1d) or AZ ID (use1-az4) falls in. Without the account's mapping, a name goes by its letter. */
export const zoneIndex = (zones: Zone[], az: string): number | undefined => {
  const byId = zones.findIndex((z) => z.id === az || z.name === az);
  if (byId >= 0) return byId;
  const letter = /[a-z]$/.exec(az)?.[0];
  if (!letter || /-az\d+$/.test(az)) return undefined;
  const i = letter.charCodeAt(0) - 97;
  return i < zones.length ? i : undefined;
};

// ── Prices ───────────────────────────────────────────────────────────────────────────────────────────────
export const HOURS_PER_MONTH = 730;
export const pricesFor = (serviceId: string, region: string): Price[] => (PRICES.regions[region] ?? []).filter((p) => p.serviceId === serviceId);
export const price = (key: string, region: string): Price | undefined => PRICES.regions[region]?.find((p) => p.key === key);
export const monthly = (usdPerHour: number) => usdPerHour * HOURS_PER_MONTH;
/** "(≈ $6.13 a month if always on, plus …)": what an hourly price adds up to (AWS's calculator assumes 730 hours). */
export const monthlyNote = (p: Price) => {
  if (p.unit !== 'hour') return '';
  const extra = p.serviceId === 'ec2' ? ', plus EBS storage and $0.005/hr per public IPv4 address' : p.serviceId === 'rds' ? ', plus storage' : '';
  return `≈ ${usd(monthly(p.usd))} a month if always on${extra}`;
};

/** $0.0104, $0.20, $12.41: enough digits to show the real rate, no float noise. */
export const usd = (n: number) => {
  if (n === 0) return '$0';
  if (n >= 1) return `$${n.toFixed(2)}`;
  // Up to 6 significant digits (Lambda's $0.0000166667 per GB-second), trailing zeros trimmed, at least cents.
  const s = Number(n.toPrecision(6)).toFixed(10).replace(/0+$/, '');
  return `$${s.split('.')[1].length < 2 ? Number(s).toFixed(2) : s}`;
};
const UNITS: Record<string, string> = { hour: 'hr', 'GB-month': 'GB-month', 'GB-second': 'GB-second', GB: 'GB', '1M requests': 'million requests', '1M request units': 'million request units', '1K requests': '1,000 requests' };
export const perUnit = (p: Price) => `${usd(p.usd)} per ${UNITS[p.unit] ?? p.unit}`;

/** How this Region's price compares with another's (for "12% above us-east-1"), or undefined when either is missing. */
export const compare = (key: string, region: string, base = 'us-east-1') => {
  const a = price(key, region);
  const b = price(key, base);
  if (!a || !b || region === base) return undefined;
  return Math.round(((a.usd - b.usd) / b.usd) * 100);
};

/** The account's AZ mapping for a Region from a city.inventory event (contract v2.5 `zones`), if the server sent it. */
export const accountZones = (inv: { zones?: Record<string, { name: string; id: string }[]> } | undefined, region: string) => inv?.zones?.[region];

const STATUS_TEXT: Record<ServiceStatus, string> = {
  available: 'Available',
  planned: 'Planned',
  considering: 'Being planned',
  'not-planned': 'Not planned',
  'outside-partition': 'Not in this partition: use it from a standard AWS account',
};
/** "Planned · 2026 Q4", "Not planned": for a service a Region doesn't offer yet. */
export const statusText = (a: ServiceAvailability) => `${STATUS_TEXT[a.status]}${a.launch ? ` · ${a.launch}` : ''}`;

/**
 * One friendly line about a Region for a new player on the world map: no AZs, opt-in or prices (those wait behind
 * "More ›"). `status` is the account's view of it, when known (city.inventory regionStatus).
 */
export function friendlyRegionLine(code: string, status?: 'enabled' | 'not-enabled'): string {
  const r = regionInfo(code);
  if (!r) return 'Pick a place to build your city!';
  if (separatePartition(code)) return `${r.city} is part of ${partitionName(code)}, a separate cloud that needs its own account.`;
  if (status === 'not-enabled') return `${r.city} is switched off in your account for now, but you can still look around.`;
  if (code === REGIONS.cityRegion) return `${r.city}: a great place to start your city.`;
  const missing = Object.values(FACTS.regions[code]?.services ?? {}).filter((a) => a.status !== 'available').length;
  return missing
    ? `${r.city}: most of the city is here, and ${missing} building${missing === 1 ? ' isn’t' : 's aren’t'} yet.`
    : `${r.city}: every building in the city is here.`;
}

/**
 * The n Regions nearest `code` by great-circle distance (same partition first: another partition is a separate
 * network), ties broken by code so it's deterministic. The city's highway signs and the world map's arcs use it.
 */
export const neighbours = (code: string, n = 2): Region[] => {
  const here = regionInfo(code);
  if (!here) return [];
  const part = FACTS.regions[code]?.partition ?? 'aws';
  const other = (r: Region) => Number((FACTS.regions[r.code]?.partition ?? 'aws') !== part);
  return REGIONS.regions
    .filter((r) => r.code !== code)
    .sort((a, b) => other(a) - other(b) || km(here, a) - km(here, b) || a.code.localeCompare(b.code))
    .slice(0, n);
};
