import { useCallback, useEffect, useRef, useState } from 'react';
import type { ErrorEvent } from '@/backend/contract';
import { bus } from '@/state/bus';

export const PENDING_TIMEOUT_MS = 15_000;

/** How long after a click an error with no id may still be its answer (the server's id-less refusals are immediate). */
export const RECENT_MS = 5_000;

/** Which pending key an error settles: the one started with the error's requestId or taskId (none without an id). */
export function keyForError(e: Pick<ErrorEvent, 'requestId' | 'taskId'>, ids: ReadonlyMap<string, string>) {
  return (e.requestId && ids.get(e.requestId)) || (e.taskId && ids.get(e.taskId)) || undefined;
}

/**
 * Every pending key an error settles. With an id: that request's key (keyForError). Without one:
 * - mfa_required can only be deploy.approve's (link, verify and fix carry their requestId), so it settles the `decide:*` keys;
 * - any other id-less error (rate limit, bad frame) answers whatever was just sent, which may have had an id the server
 *   never read, so it settles every key started in the last RECENT_MS. Older spinners keep waiting for their own answer.
 */
export function keysForError(
  e: Pick<ErrorEvent, 'requestId' | 'taskId' | 'code'>,
  ids: ReadonlyMap<string, string>,
  startedAt: ReadonlyMap<string, number>,
  now = Date.now(),
): string[] {
  if (e.requestId || e.taskId) {
    const key = keyForError(e, ids);
    return key ? [key] : [];
  }
  const keys = [...startedAt.keys()];
  if (e.code === 'mfa_required') return keys.filter((k) => k.startsWith('decide:'));
  return keys.filter((k) => now - startedAt.get(k)! <= RECENT_MS);
}

/**
 * Tracks buttons that are waiting on the backend: `start(key, id?)` marks one pending until `clear(key)`
 * (the matching event arrived), a backend `error` carrying that request's id, or the 15 s timeout — whichever
 * comes first. An error for another request leaves the other spinners alone; one with no id settles what keysForError says.
 */
export function usePending() {
  const [keys, setKeys] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** requestId/taskId → the key it was started for. */
  const ids = useRef(new Map<string, string>());
  /** key → when it started (for id-less errors). */
  const startedAt = useRef(new Map<string, number>());

  const forget = (key: string) => {
    for (const [id, k] of ids.current) if (k === key) ids.current.delete(id);
  };

  const clear = useCallback((key: string) => {
    clearTimeout(timers.current.get(key));
    timers.current.delete(key);
    startedAt.current.delete(key);
    forget(key);
    setKeys((s) => {
      if (!s.has(key)) return s;
      const n = new Set(s);
      n.delete(key);
      return n;
    });
  }, []);

  const clearAll = useCallback(() => {
    for (const t of timers.current.values()) clearTimeout(t);
    timers.current.clear();
    ids.current.clear();
    startedAt.current.clear();
    setKeys((s) => (s.size ? new Set() : s));
  }, []);

  const start = useCallback(
    (key: string, id?: string) => {
      clearTimeout(timers.current.get(key));
      forget(key);
      if (id) ids.current.set(id, key);
      startedAt.current.set(key, Date.now());
      timers.current.set(
        key,
        setTimeout(() => clear(key), PENDING_TIMEOUT_MS),
      );
      setKeys((s) => new Set(s).add(key));
    },
    [clear],
  );

  useEffect(
    () =>
      bus.on('server', (e) => {
        if (e.type !== 'error') return;
        for (const key of keysForError(e, ids.current, startedAt.current)) clear(key);
      }),
    [clear],
  );
  useEffect(() => clearAll, [clearAll]);

  const is = useCallback((key: string) => keys.has(key), [keys]);
  const any = useCallback((prefix: string) => [...keys].some((k) => k.startsWith(prefix)), [keys]);
  return { is, any, start, clear, keys };
}
