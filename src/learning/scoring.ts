// Architecture puzzle scoring against the requirements and the six Well-Architected pillars.
import type { PillarId, Puzzle } from '@/world/content';

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
