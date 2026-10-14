// Architecture puzzle scoring against the requirements and the six Well-Architected pillars.
import type { PillarId, Puzzle } from '@/world/content';
import { serviceById } from '@/world/taxonomy';
import { slotsOf, type Placements } from './diagram';

export interface PuzzleScore {
  score: number; // 0–100
  passed: boolean;
  missing: string[];
  wrong: string[];
  pillars: Record<PillarId, number>; // 0–100 each
  tips: { pillar: PillarId; tip: string }[];
}

export function scorePuzzle(p: Puzzle, placed: string[]): PuzzleScore {
  const set = new Set(placed);
  const missing = p.required.filter((s) => !set.has(s));
  const wrong = placed.filter((s) => p.distractors.includes(s));
  const coverage = p.required.length ? (p.required.length - missing.length) / p.required.length : 1;
  const pillars = {} as Record<PillarId, number>;
  const tips: PuzzleScore['tips'] = [];
  let pillarSum = 0;
  const ids = Object.keys(p.pillarBonus) as PillarId[];
  for (const id of ids) {
    const want = p.pillarBonus[id].services;
    const have = want.filter((s) => set.has(s)).length;
    // A pillar with no specific services is satisfied by a complete core design.
    const v = want.length ? have / want.length : coverage;
    pillars[id] = Math.round(Math.max(0, v - wrong.length * 0.15) * 100);
    pillarSum += pillars[id];
    if (pillars[id] < 100) tips.push({ pillar: id, tip: p.pillarBonus[id].tip });
  }
  const pillarAvg = ids.length ? pillarSum / ids.length / 100 : 1;
  const score = Math.max(0, Math.round((coverage * 0.65 + pillarAvg * 0.35) * 100 - wrong.length * 10));
  return { score, passed: missing.length === 0 && score >= 70, missing, wrong, pillars, tips };
}

export interface DiagramAttempt {
  placements: Placements;
  /** Distractors the player tried to drop (each counts once). */
  distractorDrops: string[];
  /** Real services dropped on the wrong spot. */
  misdrops: number;
  /** Hints that showed the card itself. */
  reveals?: number;
}

/**
 * Score a drawn diagram with the same weights as `scorePuzzle`. A service counts once all of its required
 * spots are filled (or, if optional, once any of its spots is). Then the trade-offs:
 * - each bonus service the brief doesn't need (`unneeded`) costs 6 points: more parts to pay for and run;
 * - each wrong-spot drop costs 3 points; each card a hint showed costs 3, at most 12.
 */
export function scoreDiagram(p: Puzzle, a: DiagramAttempt): PuzzleScore {
  const slots = slotsOf(p);
  const services = [...new Set(slots.map((s) => s.service))];
  const complete = services.filter((svc) => {
    const mine = slots.filter((s) => s.service === svc);
    const req = mine.filter((s) => s.required);
    return req.length ? req.every((s) => a.placements[s.id]) : mine.some((s) => a.placements[s.id]);
  });
  const base = scorePuzzle(p, [...complete, ...new Set(a.distractorDrops)]);
  const extra = complete.filter((s) => p.unneeded?.includes(s));
  const tips = [...base.tips];
  if (extra.length) tips.unshift({ pillar: 'cost', tip: `The brief didn’t need ${extra.map((s) => serviceById(s)?.name ?? s).join(' or ')}. Every extra service is more to pay for and run.` });
  const score = Math.max(0, Math.round(base.score - extra.length * 6 - a.misdrops * 3 - Math.min(12, (a.reveals ?? 0) * 3)));
  return { ...base, tips, score, passed: base.missing.length === 0 && score >= 70 };
}
