import type { Resource } from '../state/model.js';
import type { CityBillEvent, Progress } from '../world.js';

export type PutResult = { ok: true } | { ok: false; error: string };

/** A player's saved city. "Newest wins" by updatedAt (the side panel and the full tab both write). */
export interface ProgressStore {
  get(sub: string): Promise<Progress | null>;
  put(sub: string, input: unknown): Promise<PutResult>;
}

/** The link between a player and their own AWS account (hosted mode). */
export interface AccountRecord {
  status: 'pending' | 'linked';
  /** Per-player secret the player role's trust policy requires (sts:ExternalId). Never logged. */
  externalId: string;
  region: string;
  roleArn?: string;
  accountId?: string;
  linkedAt?: string;
  /** A linked player asked for a setup link in another Region: verify checks that Region; until then the link stays as is. */
  pendingRegion?: string;
}

export interface AccountStore {
  get(sub: string): Promise<AccountRecord | undefined>;
  put(sub: string, record: AccountRecord): Promise<void>;
}

/** Daily counters. consume() is atomic: false once `limit` is reached for that key and day. */
export interface QuotaStore {
  consume(key: string, day: string, limit: number): Promise<boolean>;
  used(key: string, day: string): Promise<number>;
}

/** A deleted player is refused this long: longer than a Cognito access token lives (60 min), so no token outlives it. */
export const DELETED_TOMBSTONE_MS = 2 * 60 * 60_000;

/** The account lock was lost mid-change: whatever hadn't been written yet wasn't. */
export class LockLostError extends Error {
  constructor() {
    super('The city lost its hold on this AWS account mid-change (another change may have started), so it stopped before changing anything else. Try again in a moment.');
    this.name = 'LockLostError';
  }
}

/**
 * Writes to one AWS account are serialised, and resources just created are remembered for a minute,
 * so parallel requests (even from two players who linked the same account) can't all slip under the
 * same limit before the eventually consistent AWS listings catch up.
 */
export interface AccountLocks {
  /**
   * Runs fn holding the account's lock. `lease` aborts if the lock is lost while fn runs (a lease that couldn't be
   * renewed may be taken by another task): fn checks it (`lease.throwIfAborted()`) before each AWS write.
   */
  withLock<T>(accountKey: string, fn: (lease: AbortSignal) => Promise<T>): Promise<T>;
  pending(accountKey: string): Promise<Resource[]>;
  remember(accountKey: string, resource: Resource, ttlMs: number): Promise<void>;
}

/** v2.5: the player's bill switch and the last Cost Explorer read (each read costs $0.01, so it's cached a day). */
export interface BillRecord {
  on: boolean;
  bill?: CityBillEvent;
  /** Epoch ms of the last read, and how long it counts as fresh (a day; an hour after a passing failure). */
  fetchedAt?: number;
  retryMs?: number;
  /** The AWS account the cached bill is for (a different linked account reads again). */
  accountId?: string;
}

export interface BillStore {
  get(sub: string): Promise<BillRecord | undefined>;
  put(sub: string, record: BillRecord): Promise<void>;
  /** bill.enable: sets only `on`, keeping the cached read (a failed or stale read of the record can't wipe it). */
  setOn(sub: string, on: boolean): Promise<void>;
  /**
   * Saves a Cost Explorer read only while the bill is still on, without touching `on` (atomically: a read that was in
   * flight when the player turned it off never turns it back on). False when it was off.
   */
  saveRead(sub: string, read: Omit<BillRecord, 'on'>): Promise<boolean>;
}

export interface Stores {
  progress: ProgressStore;
  accounts: AccountStore;
  bills: BillStore;
  quota: QuotaStore;
  locks: AccountLocks;
  /**
   * Removes everything stored for a player (DELETE /me), leaving a tombstone for DELETED_TOMBSTONE_MS (written first,
   * so a write racing the delete is refused too).
   */
  deleteUser(sub: string): Promise<void>;
  /** True while a deleted player's tombstone lasts (one read; hosted checks it where data would be recreated). */
  deletedRecently(sub: string): Promise<boolean>;
}

export const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
