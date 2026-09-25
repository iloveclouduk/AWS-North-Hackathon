import { Listeners, uid, type AgentBackend, type ConnectionStatus } from './AgentBackend';
import type { CognitoAuth } from './auth';
import { bearerSubprotocols, isServerEvent, type ClientCommand, type Progress, type ServerEvent } from './contract';

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
}

/** Close codes from server/src/http.ts (CLOSE). */
const CLOSE_REAUTH = 4401;
const CLOSE_TOO_MANY = 4429;
const CLOSE_RESTARTING = 1012;

/** What the Deploy tab offers on this backend: prompts that ask the right agent to build it. */
export const GUARDED_BLUEPRINTS = [
  { id: 'library', title: 'Build a library (DynamoDB table)', serviceIds: ['dynamodb'], summary: 'An on-demand table named city-…, built by Dyna.', costNote: 'Pay per request; ~$0 idle.', prompt: 'Create an on-demand DynamoDB table named city-quest-library for my quest.' },
  { id: 'warehouse', title: 'Build a warehouse (S3 bucket)', serviceIds: ['s3'], summary: 'An S3 bucket aws-city-<account>-quest, built by Sally.', costNote: 'Empty bucket: $0.', prompt: 'Create an S3 bucket with the suffix quest for my quest.' },
  { id: 'house', title: 'Build a house (EC2 t4g.micro)', serviceIds: ['ec2'], summary: 'A tiny Graviton instance, built by Eddie. Stop it when done!', costNote: 'Billed per second while running.', prompt: 'Launch a t4g.micro EC2 instance named quest-house.' },
] as const;

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
  /** deployId → what was built, so teardown can ask the agent to demolish it. */
  private built = new Map<string, string>();

  constructor(private cfg: ServerConfig) {
    this.onEvent((e) => {
      if (e.type === 'deploy.preview') this.built.set(e.deployId, e.changes.map((c) => `${c.resourceType} ${c.logicalId}`).join(', '));
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
    this.closedByUser = false;
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
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
    this.closedByUser = true;
    this.ws?.close(1000);
    this.statuses.emit('signed-out');
  }

  private async token(): Promise<string | undefined> {
    return this.cfg.auth?.token();
  }

  private async headers(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    const t = await this.token();
    return t ? { ...extra, authorization: `Bearer ${t}` } : extra;
  }

  private schedule(ms: number) {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => void this.open(), ms);
  }

  private async open() {
    this.statuses.emit('connecting');
    let protocols: string[] = [];
    if (this.cfg.auth) {
      const token = await this.token();
      // Signing in needs a click (launchWebAuthFlow), so we wait for the player instead of popping a window.
      if (!token) return this.statuses.emit('signed-out');
      protocols = bearerSubprotocols(token);
    }
    const ws = new WebSocket(this.cfg.wsUrl, protocols);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.statuses.emit('connected');
      for (const cmd of this.queue.splice(0)) ws.send(JSON.stringify(cmd));
    };
    ws.onmessage = (msg) => {
      try {
        const data: unknown = JSON.parse(String(msg.data));
        for (const e of Array.isArray(data) ? data : [data]) if (isServerEvent(e)) this.events.emit(e);
      } catch (err) {
        console.warn('[server] bad frame', err);
      }
    };
    ws.onerror = () => this.statuses.emit('error');
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.statuses.emit('disconnected');
      if (this.closedByUser) return;
      if (ev.code === CLOSE_TOO_MANY) {
        this.events.emit({ type: 'error', message: 'AWS City is open in too many tabs. Close one and press Retry.' });
        return;
      }
      // The server asks for a fresh token every few hours; the auth layer refreshes it silently.
      if (ev.code === CLOSE_REAUTH) return this.schedule(200);
      // A deploy is rolling: spread reconnects out so the new tasks aren't stampeded.
      if (ev.code === CLOSE_RESTARTING) return this.schedule(1000 + Math.random() * 4000);
      this.schedule(Math.min(30_000, 1000 * 2 ** this.retry++) + Math.random() * 500);
    };
  }

  private raw(cmd: ClientCommand) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(cmd));
    else this.queue.push(cmd);
  }

  private task(prompt: string) {
    this.raw({ action: 'task.submit', taskId: uid(), prompt, context: {} });
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
        return this.raw(cmd);
      case 'deploy.plan': {
        const bp = GUARDED_BLUEPRINTS.find((b) => b.id === cmd.templateId) ?? GUARDED_BLUEPRINTS.find((b) => b.id === GUARDED_EQUIV[cmd.templateId]);
        if (!bp) return this.events.emit({ type: 'error', requestId: cmd.requestId, message: `This backend can't build ${cmd.templateId}.` });
        return this.task(bp.prompt);
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
    const res = await fetch(this.url('/progress'), { headers: await this.headers() });
    if (res.status === 404 || res.status === 401) return null;
    if (!res.ok) throw new Error(`GET /progress → ${res.status}`);
    return (await res.json()) as Progress;
  }

  putProgress(p: Progress) {
    void this.headers({ 'content-type': 'application/json' })
      .then((headers) => fetch(this.url('/progress'), { method: 'PUT', headers, body: JSON.stringify(p) }))
      .catch((e) => console.warn('[server] putProgress', e));
  }

  /** Deletes the player's data on the server (progress, account link, screenshots, sign-in). */
  async deleteAccount() {
    const res = await fetch(this.url('/me'), { method: 'DELETE', headers: await this.headers() });
    if (!res.ok) throw new Error(`DELETE /me → ${res.status}`);
    await this.signOut();
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
