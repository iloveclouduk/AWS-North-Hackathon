import type { Resource } from '../state/model.js';
import type { Progress } from '../world.js';

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

/**
 * Writes to one AWS account are serialised, and resources just created are remembered for a minute,
 * so parallel requests (even from two players who linked the same account) can't all slip under the
 * same limit before the eventually consistent AWS listings catch up.
 */
export interface AccountLocks {
  withLock<T>(accountKey: string, fn: () => Promise<T>): Promise<T>;
  pending(accountKey: string): Promise<Resource[]>;
  remember(accountKey: string, resource: Resource, ttlMs: number): Promise<void>;
}

export interface Stores {
  progress: ProgressStore;
  accounts: AccountStore;
  quota: QuotaStore;
  locks: AccountLocks;
  /** Removes everything stored for a player (DELETE /me). */
  deleteUser(sub: string): Promise<void>;
}

export const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
