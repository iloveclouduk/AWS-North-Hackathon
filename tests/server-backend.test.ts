import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CognitoAuth } from '@/backend/auth';
import { CLOSE_CODES } from '@/backend/contract';
import { ServerBackend, subOf } from '@/backend/ServerBackend';

/** A WebSocket stand-in: the test opens and closes it; close() fires onclose asynchronously like the real one. */
class FakeSocket {
  static OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen?: () => void;
  onclose?: (ev: { code: number }) => void;
  onmessage?: (ev: { data: string }) => void;
  onerror?: () => void;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  close(code = 1000) {
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.({ code }));
  }
}

const auth = (token: () => Promise<string | undefined>, extra: Partial<Record<keyof CognitoAuth, unknown>> = {}) =>
  ({ token, signOut: async () => {}, signIn: async () => {}, forgetAccessToken: async () => {}, onChange: () => () => {}, ...extra }) as unknown as CognitoAuth;

describe('ServerBackend connection status', () => {
  beforeEach(() => {
    FakeSocket.all = [];
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('signing out ends on signed-out, not disconnected', async () => {
    const backend = new ServerBackend({ wsUrl: 'wss://x/ws', apiUrl: 'https://x', auth: auth(async () => 't') });
    const statuses: string[] = [];
    backend.onStatus((s) => statuses.push(s));
    backend.connect();
    await vi.waitFor(() => expect(FakeSocket.all).toHaveLength(1));
    FakeSocket.all[0]!.open();
    await backend.signOut();
    await new Promise((r) => setTimeout(r, 0));
    expect(statuses.at(-1)).toBe('signed-out');
  });

  it('commands queued while offline are dropped on sign-out', async () => {
    const backend = new ServerBackend({ wsUrl: 'wss://x/ws', apiUrl: 'https://x', auth: auth(async () => 't') });
    backend.send({ action: 'chat.ask', requestId: 'r1', question: 'hi' } as never);
    await backend.signOut();
    backend.connect();
    await vi.waitFor(() => expect(FakeSocket.all).toHaveLength(1));
    FakeSocket.all[0]!.open();
    expect(FakeSocket.all[0]!.sent).toEqual([]);
  });

  it('a session that dies (no token) drops queued commands and unsaved progress before the next player signs in', async () => {
    const puts: string[] = [];
    vi.stubGlobal('fetch', async (_u: URL, init?: RequestInit) => {
      if (init?.method === 'PUT') puts.push(String(init.headers && (init.headers as Record<string, string>).authorization));
      return new Response('', { status: 503 });
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let token: string | undefined = 'player-a';
    const backend = new ServerBackend({ wsUrl: 'wss://x/ws', apiUrl: 'https://x', auth: auth(async () => token) });
    const statuses: string[] = [];
    backend.onStatus((s) => statuses.push(s));
    backend.send({ action: 'chat.ask', requestId: 'r1', question: 'hi' } as never);
    backend.putProgress({ version: 1, landmarks: {}, updatedAt: '2026-01-01T00:00:00Z' });
    await vi.waitFor(() => expect(puts).toHaveLength(1));
    token = undefined; // the refresh token died
    backend.connect();
    await vi.waitFor(() => expect(statuses.at(-1)).toBe('signed-out'));
    token = 'player-b';
    backend.reconnect();
    await vi.waitFor(() => expect(FakeSocket.all).toHaveLength(1));
    FakeSocket.all[0]!.open();
    await new Promise((r) => setTimeout(r, 0));
    expect(FakeSocket.all[0]!.sent).toEqual([]);
    expect(puts).toHaveLength(1);
  });

  it('a failing token refresh reports an error and retries instead of hanging on connecting', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const backend = new ServerBackend({
      wsUrl: 'wss://x/ws',
      apiUrl: 'https://x',
      auth: auth(async () => {
        if (calls++ === 0) throw new Error('network');
        return 't';
      }),
    });
    const statuses: string[] = [];
    backend.onStatus((s) => statuses.push(s));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    backend.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses).toEqual(['connecting', 'error']);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('a double Retry while the token is loading opens one socket, not two', async () => {
    let release!: (t: string) => void;
    const backend = new ServerBackend({ wsUrl: 'wss://x/ws', apiUrl: 'https://x', auth: auth(() => new Promise((r) => (release = r))) });
    backend.reconnect();
    backend.reconnect();
    release('t');
    await new Promise((r) => setTimeout(r, 0));
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('signing out while the token loads never opens a socket', async () => {
    let release!: (t: string) => void;
    const backend = new ServerBackend({ wsUrl: 'wss://x/ws', apiUrl: 'https://x', auth: auth(() => new Promise((r) => (release = r))) });
    backend.connect();
    await backend.signOut();
    release('t');
    await new Promise((r) => setTimeout(r, 0));
    expect(FakeSocket.all).toHaveLength(0);
  });

  it('signing out or disconnecting while the token loads never leaves the status on connecting', async () => {
    for (const [stop, final] of [
      [(b: ServerBackend) => void b.signOut(), 'signed-out'],
      [(b: ServerBackend) => b.disconnect(), 'disconnected'],
    ] as const) {
      let release!: (t: string) => void;
      const backend = new ServerBackend({ wsUrl: 'wss://x/ws', apiUrl: 'https://x', auth: auth(() => new Promise((r) => (release = r))) });
      const statuses: string[] = [];
      backend.onStatus((s) => statuses.push(s));
      backend.connect();
      stop(backend);
      await new Promise((r) => setTimeout(r, 0));
      release('t');
      await new Promise((r) => setTimeout(r, 0));
      expect(statuses.at(-1)).toBe(final);
    }
    expect(FakeSocket.all).toHaveLength(0);
  });

  it('signing out in the other surface signs this one out too', async () => {
    let fire!: (c: 'signed-in' | 'signed-out') => void;
    const backend = new ServerBackend({ wsUrl: 'wss://x/ws', apiUrl: 'https://x', auth: auth(async () => 't', { onChange: (cb: typeof fire) => ((fire = cb), () => {}) }) });
    const statuses: string[] = [];
    backend.onStatus((s) => statuses.push(s));
    backend.connect();
    await vi.waitFor(() => expect(FakeSocket.all).toHaveLength(1));
    FakeSocket.all[0]!.open();
    fire('signed-out');
    expect(statuses.at(-1)).toBe('signed-out');
  });

  it('a 401 from GET /progress is "unknown", never "no progress"', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 401 }));
    const backend = new ServerBackend({ wsUrl: 'wss://x/ws', apiUrl: 'https://x', auth: auth(async () => undefined) });
    await expect(backend.getProgress()).rejects.toThrow(/401/);
  });

  it('two refused handshakes ask the REST API why, and explain a 403 instead of retrying forever', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 403 }));
    const backend = new ServerBackend({ wsUrl: 'wss://x/ws', apiUrl: 'https://x', token: 'local' });
    const errors: string[] = [];
    backend.onEvent((e) => e.type === 'error' && errors.push(e.message));
    vi.useFakeTimers();
    backend.connect();
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.all[0]!.close(1006);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.all[1]!.close(1006);
    await vi.advanceTimersByTimeAsync(0);
    expect(errors[0]).toMatch(/EXTENSION_ORIGIN/);
  });

  it('an account deleted elsewhere (close 4403) signs out and never reconnects; 4401 reconnects', async () => {
    vi.useFakeTimers();
    const signOut = vi.fn(async () => {});
    const backend = new ServerBackend({ wsUrl: 'wss://x/ws', apiUrl: 'https://x', auth: auth(async () => 't', { signOut }) });
    const statuses: string[] = [];
    backend.onStatus((s) => statuses.push(s));
    backend.connect();
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.all[0]!.open();
    FakeSocket.all[0]!.close(CLOSE_CODES.reauth);
    await vi.advanceTimersByTimeAsync(300);
    expect(FakeSocket.all).toHaveLength(2); // a fresh token, a new socket
    FakeSocket.all[1]!.open();
    FakeSocket.all[1]!.close(CLOSE_CODES.deleted);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.all).toHaveLength(2);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe('signed-out');
  });

  it('a handshake refused with 410 (account deleted) signs out instead of retrying', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 410 }));
    const signOut = vi.fn(async () => {});
    const backend = new ServerBackend({ wsUrl: 'wss://x/ws', apiUrl: 'https://x', auth: auth(async () => 't', { signOut }) });
    const statuses: string[] = [];
    backend.onStatus((s) => statuses.push(s));
    vi.useFakeTimers();
    backend.connect();
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.all[0]!.close(1006);
    await vi.advanceTimersByTimeAsync(2_000);
    FakeSocket.all[1]!.close(1006);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.all).toHaveLength(2);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe('signed-out');
  });

  it('progress the server refused is re-sent on the next open', async () => {
    const puts: number[] = [];
    let ok = false;
    vi.stubGlobal('fetch', async (_u: URL, init?: RequestInit) => {
      if (init?.method === 'PUT') puts.push(ok ? 200 : 503);
      return new Response('', { status: ok ? 200 : 503 });
    });
    const backend = new ServerBackend({ wsUrl: 'wss://x/ws', apiUrl: 'https://x', token: 'local' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    backend.putProgress({ version: 1, landmarks: {}, updatedAt: '2026-01-01T00:00:00Z' });
    await vi.waitFor(() => expect(puts).toEqual([503]));
    ok = true;
    backend.connect();
    await vi.waitFor(() => expect(FakeSocket.all).toHaveLength(1));
    FakeSocket.all[0]!.open();
    await vi.waitFor(() => expect(puts).toEqual([503, 200]));
  });
});

describe('ServerBackend forwards city care unchanged', () => {
  beforeEach(() => {
    FakeSocket.all = [];
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends finding.explain / finding.fix / finding.undo and deploy.approve with confirm as-is', async () => {
    const backend = new ServerBackend({ wsUrl: 'ws://127.0.0.1:1/ws', apiUrl: 'http://127.0.0.1:1' });
    backend.connect();
    await vi.waitFor(() => expect(FakeSocket.all).toHaveLength(1));
    FakeSocket.all[0]!.open();
    const cmds = [
      { action: 'finding.explain', requestId: 'r1', findingId: 'f' },
      { action: 'finding.fix', requestId: 'r2', findingId: 'f' },
      { action: 'finding.undo', requestId: 'r3', findingId: 'f' },
      { action: 'deploy.approve', deployId: 'd', confirm: 'build-runner' },
    ] as const;
    for (const c of cmds) backend.send(c);
    expect(FakeSocket.all[0]!.sent.map((s) => JSON.parse(s))).toEqual(cmds);
  });
});

describe('the player tag on this device', () => {
  const jwt = (claims: object) => `h.${btoa(JSON.stringify(claims)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.s`;
  it('reads the sub of an access token, and nothing from junk', () => {
    expect(subOf(jwt({ sub: 'abc-123', token_use: 'access' }))).toBe('abc-123');
    expect(subOf('not-a-jwt')).toBeUndefined();
    expect(subOf(jwt({ token_use: 'access' }))).toBeUndefined();
  });

  it('only a hosted backend has players, and a REST call tags the player even before the socket', async () => {
    expect(new ServerBackend({ wsUrl: 'wss://x/ws', apiUrl: 'https://x', token: 'local' }).playerId).toBeUndefined();
    vi.stubGlobal('fetch', async () => new Response('null', { status: 404 }));
    const hosted = new ServerBackend({ wsUrl: 'wss://x/ws', apiUrl: 'https://x', auth: auth(async () => jwt({ sub: 'player-a' })) });
    expect(hosted.playerId?.()).toBeUndefined();
    await hosted.getProgress();
    expect(hosted.playerId?.()).toBe('player-a');
    vi.unstubAllGlobals();
  });
});
