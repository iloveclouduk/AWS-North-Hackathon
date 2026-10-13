import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { ConnectionStatus } from '@/backend/AgentBackend';
import type { ClientCommand, Progress, ServerEvent } from '@/backend/contract';
import { landmarkOf } from '@/state/cities';

/** A backend the test drives: it reports statuses on demand and records what the runtime sends. */
class FakeBackend {
  readonly kind = 'server' as const;
  readonly deployMode = 'guarded' as const;
  private statuses = new Set<(s: ConnectionStatus) => void>();
  private events = new Set<(e: ServerEvent) => void>();
  sent: ClientCommand[] = [];
  puts: Progress[] = [];
  remote: Progress | null | Error = null;
  player?: string;
  connect() {}
  disconnect() {}
  onEvent(cb: (e: ServerEvent) => void) {
    this.events.add(cb);
    return () => void this.events.delete(cb);
  }
  onStatus(cb: (s: ConnectionStatus) => void) {
    this.statuses.add(cb);
    return () => void this.statuses.delete(cb);
  }
  status(s: ConnectionStatus) {
    for (const cb of this.statuses) cb(s);
  }
  send(cmd: ClientCommand) {
    this.sent.push(cmd);
  }
  async uploadScreenshot() {
    return 'shot-1';
  }
  async getProgress() {
    if (this.remote instanceof Error) throw this.remote;
    return this.remote;
  }
  putProgress(p: Progress) {
    this.puts.push(p);
  }
  playerId() {
    return this.player;
  }
  async signOut() {
    this.status('signed-out');
  }
}

let fake: FakeBackend;
vi.mock('@/backend', () => ({ createBackend: () => fake }));
vi.mock('@/capture/screenshot', () => ({
  captureVisibleTab: async () => ({ ok: true, dataUrl: 'data:image/jpeg;base64,AAAA' }),
  hasCapturePermission: async () => true,
  requestCapturePermission: async () => true,
}));

const progress = (landmarks: Progress['landmarks'], updatedAt = new Date().toISOString()): Progress => ({ version: 1, landmarks, updatedAt });
const settle = () => vi.advanceTimersByTimeAsync(2_000);

async function boot() {
  vi.resetModules();
  const rt = await import('@/app/runtime');
  const { useCity } = await import('@/state/store');
  rt.startRuntime('panel');
  await settle();
  return { rt, useCity };
}

describe('runtime sessions', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    fake = new FakeBackend();
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('never pushes progress before the account’s copy has been read, then pushes the merge', async () => {
    fake.remote = new Error('GET /progress → 503');
    const { useCity } = await boot();
    fake.status('connected');
    useCity.getState().loadProgress(progress({ lambda: { discovered: true, xp: 10 } }));
    await settle();
    expect(fake.puts).toEqual([]);
    // Saved locally all the same.
    expect(landmarkOf((await fakeBrowser.storage.local.get('progress')).progress as Progress, 'lambda')).toBeTruthy();

    fake.remote = progress({ s3: { discovered: true, xp: 40 } }, '2026-01-01T00:00:00Z');
    fake.status('disconnected');
    fake.status('connected');
    await settle();
    expect(fake.puts.length).toBeGreaterThan(0);
    expect(['lambda', 's3'].every((id) => landmarkOf(fake.puts[0]!, id))).toBe(true);
  });

  it('a session that died parks this device’s progress for the same player only', async () => {
    fake.player = 'player-a';
    const { useCity } = await boot();
    fake.status('connected');
    await settle();
    useCity.getState().loadProgress(progress({ lambda: { discovered: true, xp: 10 } }));
    await settle();
    fake.status('signed-out'); // the refresh token was rejected: not a sign-out the player asked for
    await settle();
    expect(useCity.getState().progress.landmarks).toEqual({});
    expect((await fakeBrowser.storage.local.get('progress')).progress).toBeUndefined();
    expect((await fakeBrowser.storage.local.get('progress.parked'))['progress.parked']).toMatchObject({ player: 'player-a' });

    // Someone else signs in on this device: they never see it, and it's gone.
    fake.player = 'player-b';
    fake.status('connected');
    await settle();
    expect(useCity.getState().progress.landmarks).toEqual({});
    expect((await fakeBrowser.storage.local.get('progress.parked'))['progress.parked']).toBeUndefined();
  });

  it('the same player signing back in gets the parked progress back', async () => {
    fake.player = 'player-a';
    const { useCity } = await boot();
    fake.status('connected');
    await settle();
    useCity.getState().loadProgress(progress({ lambda: { discovered: true, xp: 10 } }));
    await settle();
    fake.status('signed-out');
    await settle();
    fake.status('connected');
    await settle();
    expect(landmarkOf(useCity.getState().progress, 'lambda')).toBeTruthy();
    expect((await fakeBrowser.storage.local.get('progress.parked'))['progress.parked']).toBeUndefined();
  });

  it('a copy saved by player A with a dead token at startup never reaches player B', async () => {
    await fakeBrowser.storage.local.set({ progress: progress({ lambda: { discovered: true, xp: 10 } }), 'progress.owner': 'player-a' });
    fake.remote = new Error('GET /progress → 401 (not signed in yet)');
    const { useCity } = await boot();
    fake.status('signed-out'); // the refresh token died while the browser was closed
    await settle();
    expect(useCity.getState().progress.landmarks).toEqual({});

    fake.player = 'player-b';
    fake.remote = null; // B is new here
    fake.status('connected');
    await settle();
    useCity.getState().loadProgress({ ...useCity.getState().progress, landmarks: { s3: { discovered: true, xp: 5 } }, updatedAt: new Date().toISOString() });
    await settle();
    expect(landmarkOf(useCity.getState().progress, 'lambda')).toBeUndefined();
    expect(fake.puts.length).toBeGreaterThan(0);
    expect(fake.puts.some((p) => p.landmarks.lambda)).toBe(false);
    expect(JSON.stringify(await fakeBrowser.storage.local.get(null))).not.toMatch(/lambda/);
    expect((await fakeBrowser.storage.local.get('progress.owner'))['progress.owner']).toBe('player-b');
  });

  it('player A signing back in after a dead token gets their copy back', async () => {
    await fakeBrowser.storage.local.set({ progress: progress({ lambda: { discovered: true, xp: 10 } }), 'progress.owner': 'player-a' });
    fake.remote = new Error('GET /progress → 401 (not signed in yet)');
    const { useCity } = await boot();
    fake.status('signed-out');
    await settle();
    fake.player = 'player-a';
    fake.remote = progress({}, '2026-01-01T00:00:00Z');
    fake.status('connected');
    await settle();
    expect(landmarkOf(useCity.getState().progress, 'lambda')).toBeTruthy();
    expect(landmarkOf(fake.puts.at(-1)!, 'lambda')).toBeTruthy();
    expect((await fakeBrowser.storage.local.get('progress.parked'))['progress.parked']).toBeUndefined();
  });

  it('a copy earned before anyone signed in still merges into the first sign-in', async () => {
    await fakeBrowser.storage.local.set({ progress: progress({ lambda: { discovered: true, xp: 10 } }), 'progress.owner': '' });
    fake.remote = new Error('GET /progress → 401 (not signed in yet)');
    const { useCity } = await boot();
    expect(landmarkOf(useCity.getState().progress, 'lambda')).toBeTruthy();
  });

  it('an explicit sign-out keeps nothing on the device', async () => {
    fake.player = 'player-a';
    const { rt, useCity } = await boot();
    fake.status('connected');
    await settle();
    useCity.getState().loadProgress(progress({ lambda: { discovered: true, xp: 10 } }));
    await settle();
    rt.signOut();
    await settle();
    expect(useCity.getState().progress.landmarks).toEqual({});
    expect(await fakeBrowser.storage.local.get(['progress', 'progress.parked', 'progress.owner'])).toEqual({});
  });

  it('a surface that hasn’t read the account’s copy keeps the other surface’s owner tag when it absorbs its progress', async () => {
    fake.remote = new Error('GET /progress → 503'); // this surface never manages to pull
    const { useCity } = await boot();
    fake.status('connected');
    await settle();
    // The other surface (signed in as player-a, pulled) saves its copy.
    await fakeBrowser.storage.local.set({ progress: progress({ lambda: { discovered: true, xp: 10 } }), 'progress.owner': 'player-a' });
    await settle();
    expect(landmarkOf(useCity.getState().progress, 'lambda')).toBeTruthy();
    // This surface earns something too: its save must keep player-a's tag, not strip it to ''.
    useCity.getState().loadProgress({ ...useCity.getState().progress, landmarks: { ...useCity.getState().progress.landmarks, s3: { discovered: true, xp: 5 } } });
    await settle();
    const saved = await fakeBrowser.storage.local.get(['progress', 'progress.owner']);
    expect(landmarkOf(saved.progress as Progress, 's3')).toBeTruthy();
    expect(saved['progress.owner']).toBe('player-a');
  });

  it('the bill switch reaches a new connection only after the account’s copy is merged', async () => {
    // This device last saw the bill on; another device turned it off since (newer copy on the server).
    await fakeBrowser.storage.local.set({ progress: { ...progress({}, '2026-01-01T00:00:00Z'), bill: true }, 'progress.owner': '' });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    fake.remote = { ...progress({}, '2026-02-01T00:00:00Z'), bill: false };
    const get = fake.getProgress.bind(fake);
    fake.getProgress = async () => {
      await gate;
      return get();
    };
    const { useCity } = await boot();
    expect(useCity.getState().progress.bill).toBe(true);
    fake.status('connected');
    await settle();
    expect(fake.sent.filter((c) => c.action === 'bill.enable')).toEqual([]); // not before the pull
    release();
    await settle();
    expect(useCity.getState().progress.bill).toBe(false);
    expect(fake.sent.filter((c) => c.action === 'bill.enable')).toEqual([]); // the revoked 'on' is never replayed

    // A copy that says on (after the merge) is sent once the pull lands, and again after a reconnect's pull.
    fake.getProgress = get;
    fake.remote = { ...progress({}, new Date(Date.now() + 1000).toISOString()), bill: true };
    fake.status('disconnected');
    fake.status('connected');
    expect(fake.sent.filter((c) => c.action === 'bill.enable')).toEqual([]);
    await settle();
    expect(fake.sent.filter((c) => c.action === 'bill.enable')).toEqual([{ action: 'bill.enable', on: true }]);
  });

  it('after the authenticator is on, only a refused link or verify is resent', async () => {
    const { rt } = await boot();
    const vf = 'arn:aws:iam::123456789012:role/aws-city-player';
    expect(rt.afterMfa({ action: 'account.link', region: 'eu-west-1' }).resend).toEqual({ action: 'account.link', region: 'eu-west-1' });
    expect(rt.afterMfa({ action: 'account.verify', roleArn: vf }).resend).toEqual({ action: 'account.verify', roleArn: vf });
    expect(rt.afterMfa({ action: 'deploy.approve' })).toEqual({ message: expect.stringMatching(/Approve again/) });
    expect(rt.afterMfa({ action: 'finding.fix' })).toEqual({ message: expect.stringMatching(/Fix again/) });
    expect(rt.afterMfa(undefined).resend).toBeUndefined();
    const sent = new Map([['r1', { action: 'account.link', region: 'eu-west-1' } as const]]);
    expect(rt.refusedBy({ requestId: 'r1' }, sent)).toEqual({ action: 'account.link', region: 'eu-west-1' });
    expect(rt.refusedBy({}, sent)).toEqual({ action: 'deploy.approve' });
    expect(rt.refusedBy({ requestId: 'unknown' }, sent)).toBeUndefined();
  });

  it('confirming the authenticator resends a refused link in its own Region, and nothing after a refused approval', async () => {
    const { rt, useCity } = await boot();
    Object.assign(fake, { confirmTotp: async () => {} });
    fake.status('connected');
    await settle();
    const fire = (e: ServerEvent) => (fake as unknown as { events: Set<(e: ServerEvent) => void> }).events.forEach((cb) => cb(e));

    const requestId = rt.linkAccount('eu-west-1')!;
    fire({ type: 'error', requestId, code: 'mfa_required', message: 'MFA first' });
    expect(useCity.getState().account.mfaRequired).toBe(true);
    fake.sent = [];
    await rt.confirmMfaSetup('123456');
    expect(useCity.getState().account.mfaRequired).toBe(false);
    expect(fake.sent).toEqual([{ action: 'account.link', requestId: expect.any(String), region: 'eu-west-1' }]);

    rt.decideDeploy('d-1', true);
    fire({ type: 'error', code: 'mfa_required', message: 'MFA first' });
    fake.sent = [];
    await rt.confirmMfaSetup('123456');
    expect(fake.sent).toEqual([]);
    expect(useCity.getState().account.mfaRequired).toBe(false);
  });

  it('auto-snap fires on AWS pages only, and a snap of another site sends no URL or title', async () => {
    const { rt, useCity } = await boot();
    fake.status('connected');
    rt.setAutoSnap(true);
    rt.simulateFocus('https://mail.example.com/inbox/1', 'Re: my bank statement');
    await settle();
    expect(fake.sent.filter((c) => c.action === 'page.classify')).toEqual([]);

    rt.simulateFocus('https://us-west-2.console.aws.amazon.com/s3/home', 'S3');
    await settle();
    const auto = fake.sent.filter((c) => c.action === 'page.classify');
    expect(auto).toHaveLength(1);
    expect(auto[0]).toMatchObject({ context: { url: 'https://us-west-2.console.aws.amazon.com/s3/home', title: 'S3', screenshotKey: 'shot-1' } });

    rt.simulateFocus('https://mail.example.com/inbox/1', 'Re: my bank statement');
    useCity.getState().setSnap('idle');
    await rt.snap();
    const asked = fake.sent.filter((c) => c.action === 'page.classify').at(-1)!;
    expect(asked).toMatchObject({ context: { screenshotKey: 'shot-1' } });
    expect(JSON.stringify(asked)).not.toMatch(/mail\.example|bank/);
  });

  it('a screenshot is forgotten when the page changes and when the session ends', async () => {
    const { rt } = await boot();
    fake.status('connected');
    rt.simulateFocus('https://us-west-2.console.aws.amazon.com/s3/home', 'S3');
    await rt.snap();
    rt.submitPrompt('what is this?');
    expect(fake.sent.at(-1)).toMatchObject({ action: 'task.submit', context: { screenshotKey: 'shot-1' } });

    rt.simulateFocus('https://us-west-2.console.aws.amazon.com/lambda/home', 'Lambda');
    rt.submitPrompt('and this?');
    expect(fake.sent.at(-1)).toMatchObject({ action: 'task.submit', context: { screenshotKey: undefined } });

    await rt.snap();
    fake.status('signed-out');
    await settle();
    fake.status('connected');
    rt.submitPrompt('next player');
    expect(fake.sent.at(-1)).toMatchObject({ action: 'task.submit', context: { screenshotKey: undefined } });
  });

  describe('the demo in a build with sign-in (awscity.demo)', () => {
    /** The mock the demo plays on: no players, no sign-in. */
    const demoBackend = () => Object.assign(new FakeBackend(), { kind: 'mock', playerId: undefined }) as unknown as FakeBackend;
    async function bootDemo() {
      vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'awscity.demo' ? '1' : null), setItem() {}, removeItem() {} });
      fake = demoBackend();
      try {
        return await boot();
      } finally {
        vi.unstubAllGlobals();
      }
    }

    it('demo progress is saved as the demo’s, and never merges into a player who signs in later', async () => {
      const demo = await bootDemo();
      demo.useCity.getState().loadProgress(progress({ lambda: { discovered: true, xp: 10 } }));
      await settle();
      expect((await fakeBrowser.storage.local.get('progress.owner'))['progress.owner']).toBe('demo');

      // "Sign in to save your city": the page reloads on the hosted backend (the demo surface's listeners stay, like
      // the other surface still open), and player A signs in.
      fake = new FakeBackend();
      fake.player = 'player-a';
      fake.remote = progress({ s3: { discovered: true, xp: 40 } }, '2026-01-01T00:00:00Z');
      const { useCity } = await boot();
      fake.status('connected');
      await settle();
      expect(landmarkOf(useCity.getState().progress, 's3')).toBeTruthy();
      expect(landmarkOf(useCity.getState().progress, 'lambda')).toBeUndefined();
      expect(fake.puts.every((p) => !landmarkOf(p, 'lambda'))).toBe(true);
      expect((await fakeBrowser.storage.local.get('progress.parked'))['progress.parked']).toBeUndefined();

      // A demo surface still open earns more: the signed-in surface never takes it.
      demo.useCity.getState().loadProgress(progress({ lambda: { discovered: true, xp: 20 }, sqs: { discovered: true, xp: 5 } }));
      await settle();
      expect(landmarkOf(useCity.getState().progress, 'lambda')).toBeUndefined();
      expect(landmarkOf(useCity.getState().progress, 'sqs')).toBeUndefined();
      expect(fake.puts.every((p) => !p.landmarks.lambda && !p.landmarks.sqs)).toBe(true);
    });

    it('a player’s copy on this device is parked while the demo plays, not shown in it', async () => {
      await fakeBrowser.storage.local.set({ progress: progress({ lambda: { discovered: true, xp: 10 } }), 'progress.owner': 'player-a' });
      const { useCity } = await bootDemo();
      expect(useCity.getState().progress.landmarks).toEqual({});
      expect((await fakeBrowser.storage.local.get('progress.parked'))['progress.parked']).toMatchObject({ player: 'player-a' });
    });
  });
});
