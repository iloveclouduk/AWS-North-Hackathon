import type { ClientCommand, Progress, ServerEvent } from './contract';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error' | 'signed-out';

/**
 * Everything the frontend needs from a backend. MockBackend fakes it in-browser; ServerBackend
 * talks to the AWS City server (server/). Nothing outside src/backend/ may do network I/O.
 */
export interface AgentBackend {
  readonly kind: 'mock' | 'server';
  /** 'templates' = curated CloudFormation into a linked account; 'guarded' = the local server's approved actions. */
  readonly deployMode?: 'templates' | 'guarded';
  connect(): void;
  disconnect(): void;
  onEvent(cb: (e: ServerEvent) => void): () => void;
  onStatus(cb: (s: ConnectionStatus) => void): () => void;

  /** Send any contract command. Queued until connected. */
  send(cmd: ClientCommand): void;

  /** Upload a JPEG data URL via a presigned URL; returns the S3 key to reference in later commands. */
  uploadScreenshot(dataUrl: string): Promise<string>;

  /** null = backend has no progress for this user yet. */
  getProgress(): Promise<Progress | null>;
  putProgress(p: Progress): void;

  /** Interactive sign-in (hosted server). Must be called from a user gesture. */
  signIn?(): Promise<void>;
  signOut?(): Promise<void>;
  /** Hosted: enrol an authenticator app (step-up MFA before linking an AWS account). */
  startTotp?(): Promise<{ secret: string; uri: string }>;
  confirmTotp?(code: string): Promise<void>;
  /** Try connecting again now (after going offline). */
  reconnect?(): void;
  /**
   * Hosted: who the last sign-in on this device was (the token's `sub`), or undefined. A local tag only, so a
   * session that died can hand its unsynced progress back to the same player, never to the next one.
   */
  playerId?(): string | undefined;
}

/** Tiny listener set used by all implementations. */
export class Listeners<T> {
  private set = new Set<(v: T) => void>();
  add(cb: (v: T) => void) {
    this.set.add(cb);
    return () => {
      this.set.delete(cb);
    };
  }
  emit(v: T) {
    for (const cb of this.set) {
      try {
        cb(v);
      } catch (err) {
        console.error('[backend] listener failed', err);
      }
    }
  }
}

/** Await the first event matching `pick`, or reject after `ms`. */
export function waitFor<T>(backend: AgentBackend, pick: (e: ServerEvent) => T | undefined, ms = 15_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error('backend timed out'));
    }, ms);
    const off = backend.onEvent((e) => {
      const v = pick(e);
      if (v === undefined) return;
      clearTimeout(timer);
      off();
      resolve(v);
    });
  });
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`);
