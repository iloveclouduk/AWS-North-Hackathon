// How the citizens grow: "they need your help to grow". Pure functions over Progress.citizens, used by the store.
import type { CityFinding, PillarKey, Progress } from '@/backend/contract';
import { CITIZEN_LEVELS, CITIZENS, citizenById, type CitizenDef } from '@/world/citizens';
import { PILLARS } from '@/world/content';
import { serviceById, servicesIn } from '@/world/taxonomy';

/** XP needed to reach each level, from shared/citizens.json `levels` (index 0 = level 1: Spotter, Fixer, Caretaker). */
export const LEVEL_XP = [...CITIZEN_LEVELS].sort((a, b) => a.level - b.level).map((l) => l.xp);

/** What teaching a citizen is worth. */
export const CITIZEN_XP = {
  /** Each flashcard reviewed for a service in one of the citizen's districts. */
  card: 1,
  /** Each citizen whose pillar scored at least PUZZLE_PILLAR_MIN when an architecture puzzle passes. */
  puzzle: 5,
  /** The finding's citizen, when it resolves after your fix. */
  fix: 10,
  /** Asking the citizen to explain a finding. */
  explain: 2,
};
export const PUZZLE_PILLAR_MIN = 70;

/** Level needed to offer each kind of fix. */
export const FIX_LEVEL = { game: 2, account: 3 } as const;

export const levelForXp = (xp: number) => {
  let level = 1;
  LEVEL_XP.forEach((need, i) => {
    if (xp >= need) level = i + 1;
  });
  return level;
};

export const citizenXp = (p: Progress, id: string) => p.citizens?.[id]?.xp ?? 0;
export const citizenLevel = (p: Progress, id: string) => levelForXp(citizenXp(p, id));
export const levelName = (level: number) => CITIZEN_LEVELS.find((l) => l.level === level)?.name ?? `Level ${level}`;
export const levelCan = (level: number) => CITIZEN_LEVELS.find((l) => l.level === level)?.can ?? '';
/** XP still needed for the next level (undefined at the top). */
export const xpToNext = (xp: number) => {
  const next = LEVEL_XP[levelForXp(xp)];
  return next === undefined ? undefined : next - xp;
};

/** Citizens who learn from a flashcard about this service (the service's district is one of theirs). */
export const citizensForService = (serviceId: string): CitizenDef[] => {
  const d = serviceById(serviceId)?.districtId;
  return d ? CITIZENS.filter((c) => c.districts.includes(d)) : [];
};

/** Citizens whose pillar a passed puzzle scored well on. */
export const citizensForPuzzle = (pillars: Partial<Record<PillarKey, number>>): CitizenDef[] =>
  CITIZENS.filter((c) => (pillars[c.pillar] ?? 0) >= PUZZLE_PILLAR_MIN);

export interface Award {
  citizenId: string;
  amount: number;
  /** What earned it, for the level-up toast: "you reviewed 20 security flashcards". */
  reason?: string;
}

/** Adds XP; returns the new progress (same object if nothing changed) and any level-ups. */
export function awardCitizens(p: Progress, awards: Award[], now = new Date()): { progress: Progress; levelUps: { citizenId: string; level: number; reason?: string }[] } {
  const valid = awards.filter((a) => a.amount > 0 && citizenById(a.citizenId));
  if (!valid.length) return { progress: p, levelUps: [] };
  const citizens = { ...p.citizens };
  const levelUps: { citizenId: string; level: number; reason?: string }[] = [];
  for (const a of valid) {
    const before = citizens[a.citizenId]?.xp ?? 0;
    const after = before + a.amount;
    citizens[a.citizenId] = { xp: after };
    const lv = levelForXp(after);
    if (lv > levelForXp(before)) levelUps.push({ citizenId: a.citizenId, level: lv, ...(a.reason ? { reason: a.reason } : {}) });
  }
  return { progress: { ...p, citizens, updatedAt: now.toISOString() }, levelUps };
}

/** Flashcard reviews so far on services in the citizen's districts (each review of a card counts). */
export const cardReviewsFor = (p: Progress, c: CitizenDef) =>
  Object.entries(p.cards ?? {}).reduce((n, [id, st]) => {
    const d = serviceById(id.replace(/-\d+$/, ''))?.districtId;
    return d && c.districts.includes(d) ? n + st.reps : n;
  }, 0);

/** How a citizen learns, in a few words, for the "Teach <name> first" line. */
export function howToTeach(c: CitizenDef) {
  const services = c.districts.flatMap((d) => servicesIn(d).slice(0, 1).map((s) => s.name.replace(/^(Amazon|AWS) /, '')));
  const list = services.length > 1 ? `${services.slice(0, -1).join(', ')} or ${services.at(-1)}` : services[0];
  return `review flashcards for ${list}, pass an architecture puzzle scoring ${PUZZLE_PILLAR_MIN} or more on ${PILLARS.find((p) => p.id === c.pillar)?.name ?? c.pillar}, or ask ${c.name} to explain a finding`;
}

/** Whether the finding's citizen may offer its fix yet, and if not, what the player can do about it. */
export function fixGate(p: Progress, f: Pick<CityFinding, 'citizenId' | 'fix'>): { ok: true } | { ok: false; reason: string } {
  if (!f.fix) return { ok: false, reason: 'There’s no automatic fix for this one. Explain shows what to change.' };
  const c = citizenById(f.citizenId);
  if (!c) return { ok: false, reason: 'Nobody looks after this yet.' };
  const need = FIX_LEVEL[f.fix.scope];
  const xp = citizenXp(p, c.id);
  if (levelForXp(xp) >= need) return { ok: true };
  const what = f.fix.scope === 'game' ? 'things the city built' : 'things outside the city';
  const how = howToTeach(c);
  return {
    ok: false,
    reason: `Teach ${c.name} first. To fix ${what}, ${c.name} must be a ${levelName(need)} (${LEVEL_XP[need - 1]} ⭐, now ${xp}). ${how[0].toUpperCase()}${how.slice(1)}.`,
  };
}
