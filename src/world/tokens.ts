// Golden tokens: six hidden in every city, each one an AWS Certification's gold coin. They glint only when Kai walks
// near, so finding them means exploring the streets. Placement is pure and the same for a Region every time (a hash of
// the Region and the tile, never rng(): nothing else in the city moves), on tiles Kai can walk to.

import type { Progress } from '@/backend/contract';
import type { Tile } from './layout';
import { CERTS } from './culture';

export const TOKENS_PER_CITY = 6;
/** At least this many tiles apart (Manhattan), so one walk doesn't find them all. */
export const TOKEN_SPACING = 7;
/** Kai sees a token's glint within this many tiles. */
export const GLINT_TILES = 4;

export interface Token {
  /** `<regionCode>:<n>`, stable for the Region (Progress.finds key). */
  id: string;
  x: number;
  y: number;
  /** The certification on its face (shared/certifications.json). */
  certId: string;
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** The city's tokens among `candidates` (walkable street tiles): spread out, the same for the same Region and tiles. */
export function tokensFor(region: string, candidates: Tile[]): Token[] {
  const order = [...candidates].sort((a, b) => hash(`${region}|${a.x},${a.y}`) - hash(`${region}|${b.x},${b.y}`) || a.x - b.x || a.y - b.y);
  const picked: Tile[] = [];
  for (const t of order) {
    if (picked.length >= TOKENS_PER_CITY) break;
    if (picked.every((p) => Math.abs(p.x - t.x) + Math.abs(p.y - t.y) >= TOKEN_SPACING)) picked.push(t);
  }
  const certs = [...CERTS.certifications].sort((a, b) => hash(`${region}|${a.id}`) - hash(`${region}|${b.id}`));
  return picked.map((t, n) => ({ id: `${region}:${n}`, x: t.x, y: t.y, certId: certs[n % certs.length]!.id }));
}

/** How many of this city's tokens the player has found. */
export const foundIn = (p: Progress, region: string) => Object.keys(p.finds ?? {}).filter((id) => id.startsWith(`${region}:`)).length;

/** What a token says when it's found. */
export function tokenFact(certId: string) {
  const c = CERTS.certifications.find((x) => x.id === certId);
  if (!c) return 'A golden token!';
  const level = CERTS.levels.find((l) => l.id === c.level)?.name ?? c.level;
  return `${c.name}${c.code ? ` (${c.code})` : ''}: a ${level} certification.`;
}
