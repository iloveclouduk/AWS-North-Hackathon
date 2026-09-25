import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createProgressStore } from '../contract/progress.js';
import { type Resource, resourceKey } from '../state/model.js';
import type { AccountLocks, AccountRecord, ProgressStore, QuotaStore, Stores } from './types.js';

/** Progress as JSON files: progress.json for the local player, progress-<hash>.json for anyone else. */
export const fileProgress = (file: string): ProgressStore & { fileFor(sub: string): string; forget(sub: string): void } => {
  const stores = new Map<string, ReturnType<typeof createProgressStore>>();
  const fileFor = (sub: string) => (sub === 'local' ? file : join(dirname(file), `progress-${createHash('sha256').update(sub).digest('hex').slice(0, 24)}.json`));
  const forSub = (sub: string) => {
    let s = stores.get(sub);
    if (!s) stores.set(sub, (s = createProgressStore(fileFor(sub))));
    return s;
  };
  return { get: (sub) => forSub(sub).get(), put: (sub, input) => forSub(sub).put(input), fileFor, forget: (sub) => void stores.delete(sub) };
};

export const memoryQuota = (): QuotaStore => {
  const counts = new Map<string, number>();
  return {
    async consume(key, day, limit) {
      const k = `${key}|${day}`;
      const n = counts.get(k) ?? 0;
      if (n >= limit) return false;
      counts.set(k, n + 1);
      return true;
    },
    async used(key, day) {
      return counts.get(`${key}|${day}`) ?? 0;
    },
  };
};

/** In-process lock chain + just-created list (one server process). */
export const memoryLocks = (): AccountLocks => {
  const chains = new Map<string, Promise<unknown>>();
  const recent = new Map<string, Map<string, { resource: Resource; until: number }>>();
  return {
    withLock(key, fn) {
      const next = (chains.get(key) ?? Promise.resolve()).then(fn, fn);
      chains.set(key, next.catch(() => undefined));
      return next;
    },
    async pending(key) {
      const m = recent.get(key);
      if (!m) return [];
      const now = Date.now();
      for (const [k, e] of m) if (e.until < now) m.delete(k);
      return [...m.values()].map((e) => e.resource);
    },
    async remember(key, resource, ttlMs) {
      let m = recent.get(key);
      if (!m) recent.set(key, (m = new Map()));
      m.set(resourceKey(resource), { resource, until: Date.now() + ttlMs });
    },
  };
};

export const localStores = (progressFile: string): Stores => {
  const progress = fileProgress(progressFile);
  const accounts = new Map<string, AccountRecord>();
  return {
    progress,
    accounts: { get: async (sub) => accounts.get(sub), put: async (sub, r) => void accounts.set(sub, r) },
    quota: memoryQuota(),
    locks: memoryLocks(),
    async deleteUser(sub) {
      accounts.delete(sub);
      await rm(progress.fileFor(sub), { force: true });
      progress.forget(sub);
    },
  };
};
