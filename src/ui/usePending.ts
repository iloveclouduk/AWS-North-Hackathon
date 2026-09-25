import { useCallback, useEffect, useRef, useState } from 'react';
import { bus } from '@/state/bus';

export const PENDING_TIMEOUT_MS = 15_000;

/**
 * Tracks buttons that are waiting on the backend: `start(key)` marks one pending until `clear(key)`
 * (the matching event arrived), any backend `error` event, or the 15 s timeout — whichever comes first.
 */
export function usePending() {
  const [keys, setKeys] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const clear = useCallback((key: string) => {
    clearTimeout(timers.current.get(key));
    timers.current.delete(key);
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
    setKeys((s) => (s.size ? new Set() : s));
  }, []);

  const start = useCallback(
    (key: string) => {
      clearTimeout(timers.current.get(key));
      timers.current.set(
        key,
        setTimeout(() => clear(key), PENDING_TIMEOUT_MS),
      );
      setKeys((s) => new Set(s).add(key));
    },
    [clear],
  );

  useEffect(() => bus.on('server', (e) => e.type === 'error' && clearAll()), [clearAll]);
  useEffect(() => clearAll, [clearAll]);

  const is = useCallback((key: string) => keys.has(key), [keys]);
  const any = useCallback((prefix: string) => [...keys].some((k) => k.startsWith(prefix)), [keys]);
  return { is, any, start, clear, keys };
}
