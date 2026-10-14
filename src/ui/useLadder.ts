// The unlock ladder (src/state/ladder.ts) as React sees it: the store's progress plus the areas this player opened
// anyway, kept in localStorage (`awscity.opened`) so the side panel and the full tab agree.

import { useMemo, useSyncExternalStore } from 'react';
import { releaseCare } from '@/app/runtime';
import { ALL_AREAS, ladder, lockedAreas, type Area, type Ladder, type LadderInput } from '@/state/ladder';
import { useCity } from '@/state/store';
import { OPENED_KEY, readPref, writePref } from './logic';

const listeners = new Set<() => void>();
let cache: { raw: string | null; set: ReadonlySet<string> } = { raw: null, set: new Set() };

/** The opened areas (a stable Set until they change). */
export function openedAreas(): ReadonlySet<string> {
  const raw = readPref(OPENED_KEY);
  if (raw !== cache.raw) {
    let list: unknown = [];
    try {
      list = JSON.parse(raw ?? '[]');
    } catch {
      /* a bad value counts as nothing opened */
    }
    cache = { raw, set: new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []) };
  }
  return cache.set;
}

/** Records that the player opened an area (a tab, Architecture, Day 1…), so it stays open from now on. */
export function addOpened(area: Area) {
  const now = openedAreas();
  if (now.has(area)) return;
  writePref(OPENED_KEY, JSON.stringify([...now, area]));
  for (const fn of listeners) fn();
}

/** Opens every area of the unlock ladder at once (it stays open, like any area opened early). */
export function openEverything() {
  for (const a of ALL_AREAS) addOpened(a);
  releaseCare();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  // The other surface (side panel ↔ full tab) opened something.
  const onStorage = (e: StorageEvent) => e.key === OPENED_KEY && fn();
  globalThis.addEventListener?.('storage', onStorage);
  return () => {
    listeners.delete(fn);
    globalThis.removeEventListener?.('storage', onStorage);
  };
}

export const useOpened = () => useSyncExternalStore(subscribe, openedAreas, openedAreas);

/** The ladder's input from the store and the opened set. */
export function useLadderInput(): LadderInput {
  const progress = useCity((s) => s.progress);
  const linked = useCity((s) => s.account.linked);
  const hasDeploys = useCity((s) => Object.keys(s.deploys).length > 0);
  const opened = useOpened();
  return useMemo(() => ({ progress, linked, hasDeploys, opened }), [progress, linked, hasDeploys, opened]);
}

export function useLadder(): Ladder {
  const input = useLadderInput();
  return useMemo(() => ladder(input), [input]);
}

export const useLocked = () => {
  const input = useLadderInput();
  return useMemo(() => lockedAreas(input), [input]);
};
