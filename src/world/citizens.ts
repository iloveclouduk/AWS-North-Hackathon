// The citizens who look after the city: one per Well-Architected pillar (shared/citizens.json), and the player
// text of the rules they check (shared/wa-rules.json). Both files are shared with the server.
import citizensJson from '../../shared/citizens.json' with { type: 'json' };
import rulesJson from '../../shared/wa-rules.json' with { type: 'json' };
import type { PillarKey } from '@/backend/contract';
import { ROLES } from './culture';
import type { DistrictId } from './taxonomy';

export interface CitizenDef {
  id: string;
  name: string;
  roleId: string;
  pillar: PillarKey;
  districts: DistrictId[];
  greeting: string;
}

export interface CitizenLevelDef {
  level: number;
  name: string;
  can: string;
  /** XP needed to reach this level (the server checks it too). */
  xp: number;
}

export interface WaRule {
  id: string;
  pillar: PillarKey;
  severity: 'low' | 'medium' | 'high';
  serviceId: string;
  title: string;
  text: string;
  /** Why it matters, in plain words. */
  why?: string;
  url: string;
  fix?: { fixId: string; title: string; preview: string; rollback: string; costNote?: string };
}

export const CITIZENS = citizensJson.citizens as CitizenDef[];
export const CITIZEN_LEVELS = citizensJson.levels as CitizenLevelDef[];
export const WA_RULES = rulesJson.rules as WaRule[];

export const citizenById = (id: string) => CITIZENS.find((c) => c.id === id);
export const citizenForPillar = (pillar: PillarKey) => CITIZENS.find((c) => c.pillar === pillar);
export const ruleById = (id: string) => WA_RULES.find((r) => r.id === id);
export const isCitizenId = (id: string) => id.startsWith('citizen:') && !!citizenById(id);

/** The Amazonian role a citizen wears (culture.json → amazonians.roles), for the name tag and sprite sheet. */
export const citizenRole = (c: CitizenDef) => ROLES.find((r) => r.id === c.roleId);

/**
 * Which character sheet draws a citizen: its role's own sheet (e.g. amz_sre) once the art has it, else one of
 * the generic citizen sheets, picked by the citizen's position so the same person always looks the same.
 * `has` says whether a sheet exists; `generic` lists the generic citizen sheets (both from the art index).
 */
export function citizenSheet(c: CitizenDef, has: (sheet: string) => boolean, generic: string[]): string | undefined {
  const own = citizenRole(c)?.sheet;
  if (own && has(own)) return own;
  if (!generic.length) return undefined;
  // From the end of the list, so the six don't share the first sheets the pedestrians use.
  const i = CITIZENS.indexOf(c);
  return generic[(generic.length - 1 - (i % generic.length) + generic.length) % generic.length];
}

/** A pillar in a word or two, for name tags and buttons (the full names are in puzzles.json `pillars`). */
export const PILLAR_LABEL: Record<PillarKey, string> = {
  operational: 'Operations',
  security: 'Security',
  reliability: 'Reliability',
  performance: 'Performance',
  cost: 'Cost',
  sustainability: 'Sustainability',
};

/** "Priya · Security": the citizen's name tag says what they look after (their Amazonian role is on the card). */
export const citizenTag = (c: CitizenDef) => `${c.name} · ${PILLAR_LABEL[c.pillar]}`;
