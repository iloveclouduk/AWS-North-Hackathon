// The unlock ladder: what a player sees grows with what they've done. Pure (no store, no I/O), so the side panel and
// the full tab agree (both read the same Progress through storage.local) and the server and contract never change.
// Everything stays reachable: `opened` holds the areas the player opened anyway (a quest's "Go →", a building tap).

import type { Progress } from '@/backend/contract';
import { questById, type QuestStep } from '@/world/content';
import { SERVICES } from '@/world/taxonomy';
import { landmarkOf } from './cities';

/** The panel's tab ids (App.tsx TABS). 'map' is shown as "Places". */
export type Tab = 'home' | 'quests' | 'learn' | 'map' | 'deploy';

/** Areas that unlock: the tabs plus the panels inside them. */
export type Area = Tab | 'learnBuild' | 'care' | 'day1' | 'worldList' | 'news';

export interface LadderInput {
  progress: Progress;
  /** An AWS account is linked (its findings are real, so city care opens at once). */
  linked: boolean;
  /** Any deploy (preview or stack) exists. */
  hasDeploys: boolean;
  /** Areas the player opened anyway (persisted by the UI as `awscity.opened`). */
  opened: ReadonlySet<string>;
}

export interface Ladder {
  tabs: Set<Tab>;
  /** Architecture puzzles in the Learn tab. */
  learnBuild: boolean;
  /** City care: findings show (they wait in the store until this is true). */
  care: boolean;
  /** The Day 1 Quarter panels. */
  day1: boolean;
  /** "Where AWS runs" (the Region list). */
  worldList: boolean;
  /** AWS's own news and status: the ticker and its toasts (storms still show; they're the real weather). */
  news: boolean;
}

/** A puzzle counts as passed at this score (src/learning/scoring.ts passes at 70 with nothing missing). */
export const PUZZLE_PASS = 70;
/** Landmarks that open Places and "Where AWS runs". */
export const PLACES_AT = 3;
/** Landmarks that open city care. */
export const CARE_AT = 4;

/** The current step of every active quest. */
export const activeSteps = (p: Progress): QuestStep[] =>
  Object.entries(p.quests ?? {}).flatMap(([id, st]) => {
    const step = st.status === 'active' ? questById(id)?.steps[st.step] : undefined;
    return step ? [step] : [];
  });

/** Quests finished. */
export const questsDone = (p: Progress) => Object.values(p.quests ?? {}).filter((q) => q.status === 'done').length;

/** AWS news opens after the first quest (or at once for a linked account), so nothing interrupts it. */
export const newsOpen = (p: Progress, linked: boolean) => linked || questsDone(p) >= 1;

const counts = (p: Progress) => ({
  questsDone: questsDone(p),
  // Anywhere: the ladder follows the player, not one city (src/state/cities.ts).
  discovered: SERVICES.filter((s) => landmarkOf(p, s.id)?.discovered).length,
  cardsReviewed: Object.keys(p.cards ?? {}).length,
  puzzlesPassed: Object.values(p.puzzles ?? {}).filter((x) => x.best >= PUZZLE_PASS).length,
});

/** Each area's rule (the plan's A3 table). Home and Quests are always open. */
const rules = (i: LadderInput) => {
  const c = counts(i.progress);
  const steps = activeSteps(i.progress);
  const stepIs = (kind: QuestStep['kind']) => steps.some((s) => s.kind === kind);
  const learnBuild = stepIs('puzzle') || c.puzzlesPassed > 0 || i.opened.has('learnBuild');
  return {
    learn: stepIs('cards') || c.cardsReviewed > 0 || c.questsDone > 0 || learnBuild,
    learnBuild,
    map: c.discovered >= PLACES_AT,
    worldList: c.discovered >= PLACES_AT,
    // The Day 1 Quarter (Amazon culture) is open from the start: it's part of the welcome, not a reward.
    day1: true,
    deploy: stepIs('deploy') || c.questsDone >= 1 || i.linked || i.hasDeploys,
    care: c.questsDone >= 1 || c.discovered >= CARE_AT || i.linked,
    news: newsOpen(i.progress, i.linked),
  } satisfies Record<Exclude<Area, 'home' | 'quests'>, boolean>;
};

export function ladder(i: LadderInput): Ladder {
  const r = rules(i);
  const open = (a: Area) => r[a as keyof typeof r] || i.opened.has(a);
  const tabs = new Set<Tab>(['home', 'quests']);
  for (const t of ['learn', 'map', 'deploy'] as const) if (open(t)) tabs.add(t);
  if (open('learnBuild')) tabs.add('learn');
  return { tabs, learnBuild: open('learnBuild'), care: open('care'), day1: open('day1'), worldList: open('worldList'), news: open('news') };
}

export interface Unlock {
  area: Exclude<Area, 'home' | 'quests'>;
  label: string;
  /** How it unlocks, in the player's words. */
  how: string;
}

/** Locked areas in the order a new player meets them (the "More to explore" list). */
const ORDER: Unlock[] = [
  { area: 'learn', label: 'Learn', how: 'Review a flashcard or finish a quest' },
  { area: 'map', label: 'Places', how: `Tap a building or discover ${PLACES_AT} landmarks` },
  { area: 'care', label: 'City care', how: `Finish a quest or discover ${CARE_AT} landmarks` },
  { area: 'learnBuild', label: 'Architecture', how: 'Reach a puzzle step or pass a puzzle' },
  { area: 'deploy', label: 'Build for real', how: 'Finish a quest or connect an AWS account' },
  { area: 'worldList', label: 'Where AWS runs', how: `Discover ${PLACES_AT} landmarks` },
  { area: 'news', label: 'AWS news', how: 'Finish your first quest' },
];

/** Every area, so "Peek at everything" can open them all at once. */
export const ALL_AREAS: Unlock['area'][] = ORDER.map((u) => u.area);

/** Everything still locked, next first. */
export function lockedAreas(i: LadderInput): Unlock[] {
  const l = ladder(i);
  const isOpen: Record<Unlock['area'], boolean> = {
    learn: l.tabs.has('learn'),
    map: l.tabs.has('map'),
    deploy: l.tabs.has('deploy'),
    learnBuild: l.learnBuild,
    care: l.care,
    day1: l.day1,
    worldList: l.worldList,
    news: l.news,
  };
  return ORDER.filter((u) => !isOpen[u.area]);
}

/** The next area to unlock, or undefined once everything is open. */
export const nextUnlock = (i: LadderInput): Unlock | undefined => lockedAreas(i)[0];
