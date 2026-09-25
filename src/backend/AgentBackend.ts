import type { ChatAsk, PageClassify, Progress, ServerEvent, TaskSubmit } from './contract';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

/**
 * Everything the frontend needs from a backend. MockBackend fakes it in-browser;
 * AwsBackend talks to API Gateway. Nothing outside src/backend/ may do network I/O.
 */
export interface AgentBackend {
  readonly kind: 'mock' | 'aws';
  connect(): void;
  disconnect(): void;
  onEvent(cb: (e: ServerEvent) => void): () => void;
  onStatus(cb: (s: ConnectionStatus) => void): () => void;

  submitTask(cmd: Omit<TaskSubmit, 'action'>): void;
  ask(cmd: Omit<ChatAsk, 'action'>): void;
  classifyPage(cmd: Omit<PageClassify, 'action'>): void;

  /** Upload a JPEG data URL; returns the S3 key to reference in later commands. */
  uploadScreenshot(dataUrl: string, meta: { url?: string; title?: string }): Promise<string>;

  /** null = backend has no progress for this user yet. */
  getProgress(): Promise<Progress | null>;
  putProgress(p: Progress): Promise<void>;
}

/** Tiny listener set used by both implementations. */
export class Listeners<T> {
  private set = new Set<(v: T) => void>();
  add(cb: (v: T) => void) {
    this.set.add(cb);
    return () => this.set.delete(cb);
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
