// Pure reads of the city's state: no zustand, no side effects, so the scenes, the UI and the tests share them.
// src/state/store.ts re-exports every one, so callers import them from the store as before.
import type { CityFinding, Progress } from '@/backend/contract';
import { citizenById } from '@/world/citizens';
import { questById } from '@/world/content';
import { SPECIAL_AGENTS, placeFor, tierForXp } from '@/world/places';
import { SERVICES } from '@/world/taxonomy';
import type { FindingView, TaskView } from './store';
import { landmarkOf } from './cities';

export const taskRunning = (s: { tasks: Record<string, TaskView> }) => Object.values(s.tasks).some((t) => t.status === 'routing' || t.status === 'running');

export const emptyProgress = (): Progress => ({ version: 1, landmarks: {}, updatedAt: new Date(0).toISOString() });

export const agentName = (id: string) =>
  id === 'user' ? 'You' : (placeFor(id)?.agentName ?? (SPECIAL_AGENTS as Record<string, { name: string }>)[id]?.name ?? citizenById(id)?.name ?? id);

/** Open findings, newest first (the City care list). */
export const openFindings = (findings: Record<string, FindingView>) =>
  Object.values(findings)
    .filter((f) => f.status === 'open')
    .sort((a, b) => b.seenAt - a.seenAt);

const SEVERITY_RANK = { low: 0, medium: 1, high: 2 } as const;
export const severityRank = (s: CityFinding['severity']) => SEVERITY_RANK[s];

/** Points an open finding takes off the city's health. */
export const HEALTH_COST = { high: 15, medium: 8, low: 3 } as const;
/**
 * The city's health from its open findings: 100 less each open finding's cost, never below 0.
 * Healthy at 80 and up, Needs care from 50, else At risk.
 */
export const cityHealth = (findings: Pick<CityFinding, 'severity' | 'status'>[]) => {
  const score = Math.max(0, 100 - findings.filter((f) => f.status === 'open').reduce((n, f) => n + HEALTH_COST[f.severity], 0));
  const label = score >= 80 ? 'Healthy' : score >= 50 ? 'Needs care' : 'At risk';
  return { score, label } as const;
};

/** Discovered in this Region's city (or, with no Region, anywhere: see src/state/cities.ts). */
export const isDiscovered = (p: Progress, serviceId: string, region?: string) => !!landmarkOf(p, serviceId, region)?.discovered;

/** Services the current step of an active quest points at (visit / cards). */
export const questTargets = (p: Progress) => {
  const out = new Set<string>();
  for (const [id, st] of Object.entries(p.quests ?? {})) {
    const step = st.status === 'active' ? questById(id)?.steps[st.step] : undefined;
    if (step && (step.kind === 'visit' || step.kind === 'cards')) out.add(step.serviceId);
  }
  return out;
};
export const tierOf = (p: Progress, serviceId: string, region?: string) => {
  const l = landmarkOf(p, serviceId, region);
  return l?.discovered ? tierForXp(l.xp) : -1;
};
/** Agents present in the city: specials + agents of discovered landmarks. */
export const knownAgents = (p: Progress) => ['concierge', 'lookout', ...SERVICES.filter((s) => isDiscovered(p, s.id)).map((s) => s.id)];
