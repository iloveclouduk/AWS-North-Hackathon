// "The city is AWS": Amazon culture (Day 1 Quarter), AWS certifications, Regions and request flows — all data in shared/, each entry with its source URL and asOf date (tests/culture.test.ts).
import cultureJson from '../../shared/culture.json' with { type: 'json' };
import certsJson from '../../shared/certifications.json' with { type: 'json' };
import regionsJson from '../../shared/regions.json' with { type: 'json' };
import worldMapJson from '../../shared/world-map.json' with { type: 'json' };
import flowsJson from '../../shared/flows.json' with { type: 'json' };
import type { Progress } from '@/backend/contract';
import { tierForXp } from './places';
import { SERVICES, type DistrictId } from './taxonomy';
import { landmarkOf } from '@/state/cities';

export interface Sourced {
  source: string;
  asOf: string;
}

export interface Letter extends Sourced {
  year: number;
  author: string;
  title: string;
  lessons: string[];
  takeaway: string;
  quote: string | null;
  url: string;
}
export interface Principle extends Sourced {
  id: string;
  name: string;
  explain: string;
  awsExample: string;
}
export interface Mechanism extends Sourced {
  id: string;
  name: string;
  explain: string;
  steps: string[];
  awsExample: string;
}
export interface Launch extends Sourced {
  year: number;
  service: string;
  serviceId: string | null;
  event: string;
  note: string;
}
export interface ExpoQuestion {
  q: string;
  options: string[];
  answer: number;
  launchIndex?: number;
}
export interface Fact extends Sourced {
  label: string;
  value: string;
}
export interface AmazonianRole extends Sourced {
  id: string;
  sheet: string;
  title: string;
  short: string;
  names: string[];
  lines: string[];
}
export interface Culture {
  asOf: string;
  founder: Sourced & { name: string; title: string; lines: string[] };
  letters: Letter[];
  leadershipPrinciples: Sourced & { items: Principle[] };
  mechanisms: Mechanism[];
  reinvent: Sourced & { launches: Launch[]; quest: { id: string; title: string; intro: string; questions: ExpoQuestion[]; badge: string } };
  aboutAmazon: { facts: Fact[] };
  amazonians: Sourced & { roles: AmazonianRole[] };
}

export type CertLevelId = 'foundational' | 'business' | 'associate' | 'professional' | 'specialty';
export interface Certification extends Sourced {
  id: string;
  name: string;
  code: string | null;
  /** A new exam version: its code applies from `from` (YYYY-MM-DD) on. */
  next?: { code: string; from: string };
  level: CertLevelId;
  districts: DistrictId[];
  url: string;
}
export interface Region extends Sourced {
  code: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
}
export interface Flow extends Sourced {
  id: string;
  name: string;
  serviceIds: string[];
  explain: string;
}

/** The exam code a player would book today: the new version once its date has come. */
export const certCode = (c: Pick<Certification, 'code' | 'next'>, now = new Date()): string | null =>
  c.next && now.toISOString().slice(0, 10) >= c.next.from ? c.next.code : c.code;

export const CULTURE = cultureJson as unknown as Culture;
export const LETTERS: Letter[] = [...CULTURE.letters].sort((a, b) => b.year - a.year);
export const PRINCIPLES = CULTURE.leadershipPrinciples.items;
export const MECHANISMS = CULTURE.mechanisms;
export const LAUNCHES: Launch[] = [...CULTURE.reinvent.launches].sort((a, b) => a.year - b.year);
export const EXPO_QUEST = CULTURE.reinvent.quest;
export const ABOUT_FACTS = CULTURE.aboutAmazon.facts;
export const ROLES = CULTURE.amazonians.roles;
export const roleForSheet = (sheet: string) => ROLES.find((r) => r.sheet === sheet);

export const CERTS = certsJson as unknown as Sourced & { levels: { id: CertLevelId; name: string; tier: number }[]; certifications: Certification[] };
export const REGIONS = regionsJson as unknown as Sourced & { cityRegion: string; docs?: string; regions: Region[] };
export const CITY_REGION = REGIONS.regions.find((r) => r.code === REGIONS.cityRegion);
export const WORLD_MAP = worldMapJson as unknown as { source: string; cols: number; rows: number; lonMin: number; lonMax: number; latMin: number; latMax: number; mask: string[] };
export const FLOWS: Flow[] = (flowsJson as unknown as { flows: Flow[] }).flows.filter((f) => f.serviceIds.every((id) => SERVICES.some((s) => s.id === id)));

/** The request flow to animate for a task at `serviceId` (the first real flow through it). */
export const flowThrough = (serviceId: string) => FLOWS.find((f) => f.serviceIds.includes(serviceId));

// ── Golden Jacket Hall: certifications ⇄ city tiers ──────────────────────────────────────────────────────
export const levelTier = (level: CertLevelId) => CERTS.levels.find((l) => l.id === level)?.tier ?? 1;

/** Highest tier any landmark of the district has reached (-1 if none discovered). */
export function districtTier(p: Progress, d: DistrictId) {
  let best = -1;
  for (const s of SERVICES) {
    if (s.districtId !== d) continue;
    // The best anywhere: a certification is what the player knows, in whichever city they learned it.
    const l = landmarkOf(p, s.id);
    if (l?.discovered) best = Math.max(best, tierForXp(l.xp));
  }
  return best;
}

/** A certification's trophy lights up when every district it covers has a landmark at its level's tier. */
export const certEarned = (p: Progress, c: Certification) => c.districts.every((d) => districtTier(p, d) >= levelTier(c.level));
export const certsEarned = (p: Progress) => CERTS.certifications.filter((c) => certEarned(p, c));
/** How close the city is to a certification's trophy: each district it needs, and whether it's at the level yet. */
export const certProgress = (p: Progress, c: Certification) =>
  c.districts.map((d) => ({ districtId: d, tier: Math.max(0, districtTier(p, d)), need: levelTier(c.level), done: districtTier(p, d) >= levelTier(c.level) }));
/** Kai always wears the team's gold jacket (the `player-gold` sheet): in the city, inside buildings, fishing and portraits. */
export const KAI_SHEET = 'player-gold';
/** Every certification trophy in Golden Jacket Hall is lit (the real Golden Jacket's bar: every current AWS Certification). */
export const hasGoldenJacket = (p: Progress) => CERTS.certifications.length > 0 && certsEarned(p).length === CERTS.certifications.length;
