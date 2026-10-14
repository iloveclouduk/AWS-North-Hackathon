// Pure UI helpers (no React, no I/O beyond localStorage) — unit-tested in tests/ui-logic.test.ts.

import type { CSSProperties } from 'react';
import type { ConnectionStatus } from '@/backend/AgentBackend';
import type { Progress } from '@/backend/contract';
import { PUZZLE_PASS } from '@/state/ladder';
import { PUZZLES, QUESTS } from '@/world/content';
import { landmarkOf } from '@/state/cities';
import { isDiscovered } from '@/state/selectors';
import { TIER_XP, tierForXp } from '@/world/places';
import { offered } from '@/world/regions';
import { hexColor, SERVICES } from '@/world/taxonomy';

export type BackendKind = 'mock' | 'server';

/** Roving-tabindex keyboard nav for a tablist: the index to move to, or undefined to ignore the key. */
export function nextTabIndex(key: string, current: number, count: number): number | undefined {
  if (count <= 0) return undefined;
  switch (key) {
    case 'ArrowRight':
      return (current + 1) % count;
    case 'ArrowLeft':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}

/** Human text for the HUD connection pill. `wasConnected` turns "Connecting…" into "Reconnecting…". */
export function connectionLabel(kind: BackendKind, status: ConnectionStatus, wasConnected = false): string {
  if (kind === 'mock') return 'Demo mode';
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return wasConnected ? 'Reconnecting…' : 'Connecting…';
    case 'signed-out':
      return 'Signed out';
    case 'disconnected':
    case 'error':
      return 'Offline';
  }
}

/** Can the player send commands right now? The mock backend is always usable. */
export const isOnline = (kind: BackendKind, status: ConnectionStatus) => kind === 'mock' || status === 'connected';

/** Why an action is disabled while offline (for `title`), or undefined when online. */
export function offlineReason(kind: BackendKind, status: ConnectionStatus): string | undefined {
  if (isOnline(kind, status)) return undefined;
  if (status === 'signed-out') return 'Sign in first, with the Sign in button at the top';
  if (status === 'connecting') return 'Connecting to the AWS City server…';
  return 'Not connected to the AWS City server. Press Retry at the top.';
}

/** Inline style that sets the `--district` CSS custom property (used by .edge, .svc, .meter.district, .nav-district h4). */
export const districtStyle = (color?: number): CSSProperties | undefined =>
  color === undefined ? undefined : ({ '--district': hexColor(color) } as CSSProperties);

/** Fisher–Yates shuffle (copy). `rand` is injectable for tests. */
export function shuffle<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Account step: a 12-digit account id or an IAM role ARN (the server accepts either). */
export const isAccountIdOrRoleArn = (v: string) => /^\d{12}$/.test(v.trim()) || /^arn:aws:iam::\d{12}:role\/.+/.test(v.trim());

// ── Small localStorage prefs (per surface is fine; failures are ignored) ──

export const TAB_KEY = 'awscity.tab';
export const TOUR_KEY = 'awscity.tourDone';

export function readPref(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* storage disabled */
  }
}

export const isTourDone = () => readPref(TOUR_KEY) === '1';
export const markTourDone = () => writePref(TOUR_KEY, '1');

// ── The unlock ladder's UI state (src/state/ladder.ts decides what's open) ──

/** Areas the player opened anyway (a quest's "Go →", a building tap): JSON array of area ids. */
export const OPENED_KEY = 'awscity.opened';
/** Tabs whose "unlocked" toast has shown (once per player per browser): JSON array of tab ids. */
export const UNLOCK_TOASTS_KEY = 'awscity.unlockToasts';
/** One-time coach tips. */
export const TIP_ASK_KEY = 'awscity.tip.ask';
export const TIP_COPILOT_KEY = 'awscity.tip.copilot';
/** New flashcards started today: `{ day, n }` (the Due deck adds at most NEW_CARDS_PER_DAY a day). */
export const NEW_CARDS_KEY = 'awscity.newCards';

/** A JSON string-array pref as a Set (anything unreadable is empty). */
export function readSet(key: string): Set<string> {
  try {
    const v: unknown = JSON.parse(readPref(key) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}
export const writeSet = (key: string, set: Iterable<string>) => writePref(key, JSON.stringify([...set]));

/** Tabs that just appeared (in `next`, not in `prev`) and haven't had their toast yet, in tab order. */
export const newlyUnlocked = <T extends string>(prev: ReadonlySet<T>, next: ReadonlySet<T>, shown: ReadonlySet<string>): T[] =>
  [...next].filter((t) => !prev.has(t) && !shown.has(t));

/** "Learn is open" / "Learn and Places are open": the unlock toast. */
export const unlockText = (labels: string[]) =>
  `New: ${labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)} are` : `${labels[0]} is`} open. Look for the dot on the tab.`;

// ── The demo in a hosted build: the offline city, for anyone who'd rather not sign in (yet) ──

/** Set: this browser plays the offline demo even though the build has sign-in (read by createBackend). */
export const DEMO_KEY = 'awscity.demo';
/** The owner tag on the demo's saved copy: it's no player's, so it's never absorbed into one (src/app/runtime.ts). */
export const DEMO_OWNER = 'demo';
export const isDemo = () => readPref(DEMO_KEY) === '1';
/** Turns the demo on or off; the caller reloads, since the backend is chosen once at startup. */
export function setDemo(on: boolean) {
  try {
    if (on) globalThis.localStorage?.setItem(DEMO_KEY, '1');
    else globalThis.localStorage?.removeItem(DEMO_KEY);
  } catch {
    /* storage disabled */
  }
}

// ── Architecture: one puzzle first ──

/**
 * The puzzle to offer first: the one a quest step asked for, else the active quest's puzzle, else the next quest's
 * unpassed puzzle, else the first unpassed one.
 */
export function featuredPuzzle(p: Progress, focus?: string): string | undefined {
  if (focus) return focus;
  const passed = (id: string) => (p.puzzles?.[id]?.best ?? 0) >= PUZZLE_PASS;
  const puzzleOf = (questId: string, from = 0) =>
    QUESTS.find((q) => q.id === questId)
      ?.steps.slice(from)
      .flatMap((s) => (s.kind === 'puzzle' && !passed(s.puzzleId) ? [s.puzzleId] : []))[0];
  const quests = p.quests ?? {};
  const active = Object.entries(quests).flatMap(([id, st]) => (st.status === 'active' ? [puzzleOf(id, st.step)] : []));
  const next = QUESTS.filter((q) => !quests[q.id]).map((q) => puzzleOf(q.id));
  const pick = [...active, ...next].find(Boolean);
  if (pick) return pick;
  return PUZZLES.find((x) => !passed(x.id))?.id ?? PUZZLES[0]?.id;
}

/** What the Places tab offers when nothing is picked: the top building, the one nearest a level-up, one not built yet. */
export interface PlaceSuggestion {
  kind: 'top' | 'close' | 'new';
  serviceId: string;
  /** Stars to the next level ('close' only). */
  toGo?: number;
}
export function placeSuggestions(p: Progress, region: string): PlaceSuggestion[] {
  const here = SERVICES.filter((s) => offered(s.id, region));
  const built = here.map((s) => ({ id: s.id, xp: landmarkOf(p, s.id, region)?.xp ?? 0 })).filter((b) => isDiscovered(p, b.id, region));
  const out: PlaceSuggestion[] = [];
  const top = [...built].sort((a, b) => b.xp - a.xp)[0];
  if (top && top.xp > 0) out.push({ kind: 'top', serviceId: top.id });
  const close = built
    .filter((b) => b.id !== top?.id && tierForXp(b.xp) < TIER_XP.length - 1)
    .map((b) => ({ id: b.id, toGo: TIER_XP[tierForXp(b.xp) + 1] - b.xp }))
    .sort((a, b) => a.toGo - b.toGo)[0];
  if (close) out.push({ kind: 'close', serviceId: close.id, toGo: close.toGo });
  const fresh = here.find((s) => !isDiscovered(p, s.id, region));
  if (fresh) out.push({ kind: 'new', serviceId: fresh.id });
  return out;
}

/**
 * What a screen reader hears on arriving in a city: the Region, how many buildings stand there, open issues, AWS status
 * and live traffic, in one sentence. The canvas has no text of its own, so this is the city's summary.
 */
export function citySummary(s: {
  cityRegion: string;
  regionName?: string;
  progress: Progress;
  openIssues: number;
  outage?: boolean;
  flowOn?: boolean;
}): string {
  const built = SERVICES.filter((x) => isDiscovered(s.progress, x.id, s.cityRegion)).length;
  const parts = [
    `${s.regionName ?? s.cityRegion}: ${built} of ${SERVICES.length} buildings`,
    s.openIssues ? `${s.openIssues} ${s.openIssues === 1 ? 'issue' : 'issues'} to fix` : 'no issues',
  ];
  if (s.outage) parts.push('AWS reports a problem in this Region');
  if (s.flowOn) parts.push('live traffic on');
  return `${parts.join(', ')}. Press ] for the next building.`;
}
