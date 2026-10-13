import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createProgressStore } from '../contract/progress.js';
import { type Resource, resourceKey } from '../state/model.js';
import { type AccountLocks, type AccountRecord, type BillRecord, type BillStore, DELETED_TOMBSTONE_MS, type ProgressStore, type QuotaStore, type Stores } from './types.js';

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

/** The bill cache as JSON files beside progress: bill.json for the local player, bill-<hash>.json for anyone else. */
export const fileBills = (progressFile: string): BillStore & { fileFor(sub: string): string } => {
  const dir = dirname(progressFile);
  const fileFor = (sub: string) => join(dir, sub === 'local' ? 'bill.json' : `bill-${createHash('sha256').update(sub).digest('hex').slice(0, 24)}.json`);
  const get = async (sub: string) => {
    try {
      const r = JSON.parse(await readFile(fileFor(sub), 'utf8')) as BillRecord;
      return typeof r?.on === 'boolean' ? r : undefined;
    } catch {
      return undefined;
    }
  };
  const write = async (sub: string, record: BillRecord) => {
    const file = fileFor(sub);
    await mkdir(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(record));
    await rename(tmp, file);
  };
  // Writes run one at a time (one process), so saveRead's check and write can't interleave with a put.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  };
  return {
    fileFor,
    get,
    put: (sub, record) => serial(() => write(sub, record)),
    setOn: (sub, on) => serial(async () => write(sub, { ...(await get(sub)), on })),
    saveRead: (sub, read) =>
      serial(async () => {
        const r = await get(sub);
        if (!r?.on) return false;
        await write(sub, { ...r, ...read, on: true });
        return true;
      }),
  };
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
      // One process: the lock can't be lost, so the lease never aborts.
      const run = () => fn(new AbortController().signal);
      const next = (chains.get(key) ?? Promise.resolve()).then(run, run);
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
  const bills = fileBills(progressFile);
  const accounts = new Map<string, AccountRecord>();
  /** sub → until (epoch ms): players who deleted their account (DELETE /me). */
  const tombstones = new Map<string, number>();
  return {
    progress,
    bills,
    accounts: { get: async (sub) => accounts.get(sub), put: async (sub, r) => void accounts.set(sub, r) },
    quota: memoryQuota(),
    locks: memoryLocks(),
    async deleteUser(sub) {
      tombstones.set(sub, Date.now() + DELETED_TOMBSTONE_MS);
      accounts.delete(sub);
      await rm(progress.fileFor(sub), { force: true });
      await rm(bills.fileFor(sub), { force: true });
      progress.forget(sub);
    },
    // One process: tombstones live in memory (a restart forgets them, as it forgets sockets).
    async deletedRecently(sub) {
      const until = tombstones.get(sub);
      if (until !== undefined && until <= Date.now()) tombstones.delete(sub);
      return until !== undefined && until > Date.now();
    },
  };
};
