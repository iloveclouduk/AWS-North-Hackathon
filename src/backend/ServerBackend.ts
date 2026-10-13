import { Listeners, uid, type AgentBackend, type ConnectionStatus } from './AgentBackend';
import type { CognitoAuth } from './auth';
import { bearerSubprotocols, CLOSE_CODES, isServerEvent, type ClientCommand, type Progress, type ServerEvent } from './contract';

/**
 * The AWS City server (server/): Claude on Bedrock + real AWS. Two deployments, same protocol:
 *  - local: on loopback with the workshop profile; the extension is allowlisted by Origin.
 *  - hosted: api.<domain> on ECS; players sign in with Cognito and the access token rides in the
 *    WebSocket subprotocol (REST: Authorization: Bearer). Each player acts in their own linked account.
 * Transport: WebSocket /ws + REST (/progress, /screenshots, /me).
 *
 * Deploys here are the server's guarded actions (EC2 t4g, DynamoDB, S3). Every write the agents want
 * to make arrives as deploy.preview and needs deploy.approve — see server/src/contract/approvals.ts.
 */
export interface ServerConfig {
  wsUrl: string;
  apiUrl: string;
  /** Hosted: Cognito sign-in. Absent for the local server. */
  auth?: CognitoAuth;
  /**
   * Local server only: its token (WXT_AWS_TOKEN), for browsers whose extension origin can't be pinned
   * (Safari's is random per install). Chrome and Firefox dev builds are allowed by their exact origin instead.
   */
  token?: string;
}

const { reauth: CLOSE_REAUTH, deleted: CLOSE_DELETED, tooMany: CLOSE_TOO_MANY, restarting: CLOSE_RESTARTING } = CLOSE_CODES;

/** What the Deploy tab offers on this backend: prompts that ask the right agent to build it. */
export const GUARDED_BLUEPRINTS = [
  { id: 'library', title: 'Build a library (DynamoDB table)', serviceIds: ['dynamodb'], summary: 'An on-demand table named city-…, built by Dyna.', costNote: 'Pay per request; ~$0 idle.', prompt: 'Create an on-demand DynamoDB table named city-quest-library for my quest.' },
  { id: 'warehouse', title: 'Build a warehouse (S3 bucket)', serviceIds: ['s3'], summary: 'An S3 bucket aws-city-<account>-quest, built by Sally.', costNote: 'Empty bucket: $0.', prompt: 'Create an S3 bucket with the suffix quest for my quest.' },
  { id: 'house', title: 'Build a house (EC2 t4g.micro)', serviceIds: ['ec2'], summary: 'A tiny Graviton instance, built by Eddie. Terminate it when done!', costNote: 'Billed per second (1-minute minimum) while running, plus a small hourly charge for its public IPv4 address; its disk still bills when stopped. Terminate it to stop all charges.', prompt: 'Launch a t4g.micro EC2 instance named quest-house.' },
] as const;

/** Commands kept while offline; older ones are dropped first. */
const MAX_QUEUED = 50;

export class ServerBackend implements AgentBackend {
  readonly kind = 'server' as const;
  readonly deployMode = 'guarded' as const;
  private ws?: WebSocket;
  private events = new Listeners<ServerEvent>();
  private statuses = new Listeners<ConnectionStatus>();
  private queue: ClientCommand[] = [];
  private retry = 0;
  private closedByUser = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  /** An open() is between start and creating its socket (awaiting a token): don't start a second. */
  private opening = false;
  /** Sockets that closed before ever opening, since the last successful open. */
  private failedOpens = 0;
  /** Why the server refused us, once diagnosed; cleared by the next successful open. */
  private diagnosed = false;
  /** The last progress the server didn't accept (offline, 5xx); re-sent on the next open. */
  private unsaved?: Progress;
  /** Set while the player is signed out (no token); cleared when a connection attempt starts with one. */
  private signedOut = false;
  /** Hosted (Cognito sign-in) rather than the local server. */
  readonly hosted: boolean;
  /** The `sub` of the last token a connection was opened with (hosted only); kept after the session ends. */
  private player?: string;
  /** deployId → what was built, so teardown can ask the agent to demolish it. */
  private built = new Map<string, string>();

  /**
   * The signed-in player (hosted only). The local server has no players, so it has no playerId at all: the runtime
   * then keeps this device's progress unowned, as on the mock.
   */
  readonly playerId?: () => string | undefined;

  constructor(private cfg: ServerConfig) {
    this.hosted = !!cfg.auth;
    if (cfg.auth) this.playerId = () => this.player;
    this.onEvent((e) => {
      if (e.type === 'deploy.preview') this.built.set(e.deployId, e.changes.map((c) => `${c.resourceType} ${c.logicalId}`).join(', '));
    });
    // The side panel and the full-city tab each run a backend: follow sign-in/out made in the other one.
    cfg.auth?.onChange((change) => {
      if (change === 'signed-in' && this.signedOut) this.reconnect();
      else if (change === 'signed-out' && !this.signedOut) this.endSession();
    });
  }

  onEvent(cb: (e: ServerEvent) => void) {
    return this.events.add(cb);
  }
  onStatus(cb: (s: ConnectionStatus) => void) {
    return this.statuses.add(cb);
  }

  connect() {
    this.closedByUser = false;
    void this.open();
  }

  disconnect() {
    this.closedByUser = true;
    clearTimeout(this.reconnectTimer);
    this.ws?.close(1000);
  }

  reconnect() {
    clearTimeout(this.reconnectTimer);
    this.retry = 0;
    this.failedOpens = 0;
    this.diagnosed = false;
    this.closedByUser = false;
    if (this.opening || (this.ws && this.ws.readyState <= WebSocket.OPEN)) return;
    void this.open();
  }

  async signIn() {
    if (!this.cfg.auth) return;
    await this.cfg.auth.signIn();
    this.reconnect();
  }

  async signOut() {
    if (!this.cfg.auth) return;
    await this.cfg.auth.signOut();
    this.endSession();
  }

  /** Signed out here or in another surface: drop the socket and everything queued for this player. */
  private endSession() {
    this.closedByUser = true;
    this.signedOut = true;
    this.dropPlayerState();
    clearTimeout(this.reconnectTimer);
    // Detach first: the socket's async onclose would otherwise report 'disconnected' over 'signed-out'.
    const ws = this.ws;
    this.ws = undefined;
    ws?.close(1000);
    this.statuses.emit('signed-out');
  }

  /**
   * The player's account was deleted (in this tab or on another device). Its token still verifies for a while, so
   * reconnecting with it would only be refused: sign out instead, and never reconnect.
   */
  private deleted() {
    void this.cfg.auth?.signOut().catch((err) => console.warn('[server] sign-out after delete', err));
    this.endSession();
  }

  /** Commands and unsaved progress queued for this player must never replay for whoever signs in next. */
  private dropPlayerState() {
    this.queue = [];
    this.unsaved = undefined;
  }

  async startTotp() {
    if (!this.cfg.auth) throw new Error('This server has no sign-in.');
    return this.cfg.auth.startTotp();
  }

  async confirmTotp(code: string) {
    if (!this.cfg.auth) throw new Error('This server has no sign-in.');
    await this.cfg.auth.confirmTotp(code);
  }

  private async token(): Promise<string | undefined> {
    return this.cfg.auth ? this.cfg.auth.token() : this.cfg.token;
  }

  private async headers(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    const t = await this.token();
    // A REST call (GET /progress at startup) can beat the socket to the token: tag the player here too.
    if (t && this.cfg.auth) this.player = subOf(t) ?? this.player;
    return t ? { ...extra, authorization: `Bearer ${t}` } : extra;
  }

  private schedule(ms: number) {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => void this.open(), ms);
  }

  private backoff() {
    this.schedule(Math.min(30_000, 1000 * 2 ** this.retry++) + Math.random() * 500);
  }

  private async open() {
    if (this.opening) return;
    this.opening = true;
    this.statuses.emit('connecting');
    let ws: WebSocket;
    try {
      let protocols: string[] = [];
      if (this.cfg.auth) {
        const token = await this.token();
        // Signed out (or disconnected) while the token was being fetched: say so, or the pill stays on "Connecting…".
        if (this.closedByUser) return this.statuses.emit(this.signedOut ? 'signed-out' : 'disconnected');
        // Signing in needs a click (launchWebAuthFlow), so we wait for the player instead of popping a window.
        if (!token) {
          // The session is gone (expired, revoked, or signed out elsewhere): whoever signs in next starts clean.
          this.signedOut = true;
          this.dropPlayerState();
          return this.statuses.emit('signed-out');
        }
        this.signedOut = false;
        this.player = subOf(token) ?? this.player;
        protocols = bearerSubprotocols(token);
      } else if (this.cfg.token) protocols = bearerSubprotocols(this.cfg.token);
      if (this.closedByUser) return this.statuses.emit(this.signedOut ? 'signed-out' : 'disconnected');
      ws = new WebSocket(this.cfg.wsUrl, protocols);
    } catch (err) {
      // A token refresh that failed or a bad URL: report it and retry like a dropped connection.
      console.warn('[server] connect failed', err);
      this.statuses.emit('error');
      if (!this.closedByUser) this.backoff();
      return;
    } finally {
      this.opening = false;
    }
    const old = this.ws;
    this.ws = ws;
    // A stray socket from an earlier attempt must not hold one of the player's tab slots.
    if (old && old.readyState <= WebSocket.OPEN) old.close(1000);
    let opened = false;
    ws.onopen = () => {
      if (this.ws !== ws) return ws.close(1000);
      opened = true;
      this.retry = 0;
      this.failedOpens = 0;
      this.diagnosed = false;
      this.statuses.emit('connected');
      for (const cmd of this.queue.splice(0)) ws.send(JSON.stringify(cmd));
      if (this.unsaved) this.putProgress(this.unsaved);
    };
    ws.onmessage = (msg) => {
      if (this.ws !== ws) return;
      try {
        const data: unknown = JSON.parse(String(msg.data));
        for (const e of Array.isArray(data) ? data : [data]) if (isServerEvent(e)) this.events.emit(e);
      } catch (err) {
        console.warn('[server] bad frame', err);
      }
    };
    ws.onerror = () => this.ws === ws && this.statuses.emit('error');
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.statuses.emit('disconnected');
      if (this.closedByUser) return;
      if (ev.code === CLOSE_TOO_MANY) {
        this.events.emit({ type: 'error', message: 'AWS City is open in too many tabs. Close one and press Retry.' });
        return;
      }
      // The account was deleted (in this tab or on another device). Its token still verifies for a while, so reconnecting
      // with it would only be refused: sign out here instead.
      if (ev.code === CLOSE_DELETED) return this.deleted();
      // The server asks for a fresh token every few hours; the auth layer refreshes it silently.
      if (ev.code === CLOSE_REAUTH) return this.schedule(200);
      // A deploy is rolling: spread reconnects out so the new tasks aren't stampeded.
      if (ev.code === CLOSE_RESTARTING) return this.schedule(1000 + Math.random() * 4000);
      // A refused handshake reaches the browser only as 1006: after two in a row, ask the REST API why.
      if (!opened && ++this.failedOpens >= 2 && !this.diagnosed) return void this.diagnose();
      this.backoff();
    };
  }

  /**
   * The WebSocket was refused before it opened. The same checks guard GET /progress, so its status says
   * why: 401 = token rejected, 403/421 = this build isn't allowed, 410 = this account was deleted, 2xx = per-player tab
   * limit (429 on /ws only).
   */
  private async diagnose() {
    this.diagnosed = true;
    let status: number | undefined;
    try {
      status = (await fetch(this.url('/progress'), { headers: await this.headers(), signal: AbortSignal.timeout(10_000) })).status;
    } catch {
      // Unreachable: a plain outage. Keep retrying quietly.
    }
    if (this.closedByUser) return;
    if (status === 410) return this.deleted();
    if (status === 401) {
      if (this.cfg.auth) {
        // A revoked or stale access token: refresh it once; if the refresh token is dead too, token() asks for sign-in.
        await this.cfg.auth.forgetAccessToken();
        this.failedOpens = 0;
        this.diagnosed = false;
        return this.schedule(200);
      }
      this.statuses.emit('error');
      this.events.emit({ type: 'error', message: 'The local server rejected this build’s token (WXT_AWS_TOKEN). Restart it with npm run live.' });
      return;
    }
    if (status === 403 || status === 421) {
      this.statuses.emit('error');
      this.events.emit({
        type: 'error',
        message: this.hosted
          ? 'This version of AWS City isn’t allowed by its server. Update the extension, then press Retry.'
          : 'The local server doesn’t allow this extension (EXTENSION_ORIGIN / PUBLIC_HOSTS). Restart it with npm run live.',
      });
      return;
    }
    if (status !== undefined && status < 300) {
      this.events.emit({ type: 'error', message: 'AWS City may be open in too many tabs. Close one and press Retry.' });
    }
    this.backoff();
  }

  private raw(cmd: ClientCommand) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(cmd));
    else if (this.queue.push(cmd) > MAX_QUEUED) this.queue.shift();
  }

  private task(prompt: string, taskId = uid()) {
    this.raw({ action: 'task.submit', taskId, prompt, context: {} });
  }

  send(cmd: ClientCommand) {
    switch (cmd.action) {
      case 'task.submit': {
        const { questId: _q, ...rest } = cmd; // the server's schema rejects unknown fields
        return this.raw(rest);
      }
      case 'chat.ask':
      case 'page.classify':
      case 'deploy.approve':
      case 'deploy.reject':
      case 'console.start':
      case 'console.observe':
      case 'console.stop':
      // v2.3 city care: forwarded unchanged (the server re-reads the resource and answers with deploy.preview).
      case 'finding.explain':
      case 'finding.fix':
      case 'finding.undo':
      // v2.5: the bill switch (the server reads Cost Explorer at most once a day while it's on).
      case 'bill.enable':
        return this.raw(cmd);
      case 'deploy.plan': {
        const bp = GUARDED_BLUEPRINTS.find((b) => b.id === cmd.templateId) ?? GUARDED_BLUEPRINTS.find((b) => b.id === GUARDED_EQUIV[cmd.templateId]);
        if (!bp) return this.events.emit({ type: 'error', requestId: cmd.requestId, message: `This backend can't build ${cmd.templateId}.` });
        // The plan's requestId doubles as the task's id, so an error for the task settles the button that asked.
        return this.task(bp.prompt, cmd.requestId);
      }
      case 'deploy.teardown': {
        const what = this.built.get(cmd.deployId);
        if (!what) return this.events.emit({ type: 'deploy.status', deployId: cmd.deployId, status: 'failed', message: 'I don’t know what that was any more.' });
        return this.task(`Please demolish what you built for me: ${what}. (Stop/terminate or delete it.)`);
      }
      case 'account.link':
      case 'account.verify':
        return this.raw(cmd);
      case 'progress.get':
      case 'progress.put':
      case 'screenshot.presign':
      case 'quest.start':
        return; // handled via REST below / not needed
    }
  }

  private url(path: string) {
    return new URL(path, this.cfg.apiUrl);
  }

  async uploadScreenshot(dataUrl: string) {
    const res = await fetch(this.url('/screenshots'), { method: 'POST', headers: await this.headers({ 'content-type': 'application/json' }), body: JSON.stringify({ contentType: 'image/jpeg' }) });
    if (!res.ok) throw new Error(`POST /screenshots → ${res.status}`);
    const target = (await res.json()) as { uploadUrl: string; screenshotKey: string; method?: 'PUT' | 'POST'; fields?: Record<string, string> };
    const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    let up: Response;
    if (target.method === 'POST') {
      // S3 presigned POST: the policy fields first, the file last.
      const form = new FormData();
      for (const [k, v] of Object.entries(target.fields ?? {})) form.append(k, v);
      form.append('file', blob);
      up = await fetch(target.uploadUrl, { method: 'POST', body: form });
    } else {
      up = await fetch(new URL(target.uploadUrl, this.cfg.apiUrl), { method: 'PUT', body: blob, headers: { 'content-type': 'image/jpeg' } });
    }
    if (!up.ok) throw new Error(`screenshot upload failed: ${up.status}`);
    return target.screenshotKey;
  }

  async getProgress(): Promise<Progress | null> {
    const res = await fetch(this.url('/progress'), { headers: await this.headers(), signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) return null;
    // 401 is "unknown", not "none": treating it as empty would let local progress overwrite the server's.
    if (res.status === 401) throw new Error('GET /progress → 401 (not signed in yet)');
    if (!res.ok) throw new Error(`GET /progress → ${res.status}`);
    return (await res.json()) as Progress;
  }

  putProgress(p: Progress) {
    this.unsaved = p;
    void this.headers({ 'content-type': 'application/json' })
      .then((headers) => fetch(this.url('/progress'), { method: 'PUT', headers, body: JSON.stringify(p) }))
      .then((res) => {
        if (!res.ok) throw new Error(`PUT /progress → ${res.status}`);
        if (this.unsaved === p) this.unsaved = undefined;
      })
      .catch((e) => console.warn('[server] putProgress (will retry on reconnect)', e));
  }

  /** Deletes the player's data on the server (progress, account link, screenshots, sign-in). */
  async deleteAccount() {
    const res = await fetch(this.url('/me'), { method: 'DELETE', headers: await this.headers() });
    if (!res.ok) throw new Error(`DELETE /me → ${res.status}`);
    await this.signOut();
  }
}

/**
 * The `sub` claim of a Cognito access token, read without verifying it: the server verifies every token, and this is
 * only a local tag (which player a parked copy of progress belongs to), not a security check.
 */
export function subOf(token: string): string | undefined {
  try {
    const payload = token.split('.')[1];
    if (!payload) return undefined;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '='));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === 'string' && sub ? sub : undefined;
  } catch {
    return undefined;
  }
}

/** Quest deploy steps name curated templates; on this backend the closest guarded build counts. */
export const GUARDED_EQUIV: Record<string, string> = {
  'static-site': 'warehouse',
  'dynamo-table': 'library',
  'hello-api': 'house',
  'queue-worker': 'library',
};
/** Server action type (deploy.preview templateId) → blueprint id. */
export const ACTION_BLUEPRINT: Record<string, string> = { create_table: 'library', create_bucket: 'warehouse', launch_instance: 'house' };
