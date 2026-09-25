import { Listeners, uid, type AgentBackend, type ConnectionStatus } from './AgentBackend';
import { isServerEvent, type ClientCommand, type Progress, type ServerEvent } from './contract';

/**
 * The team's local Node server (server/): a real AWS account + Claude on Bedrock, running on loopback
 * because the workshop account blocks CloudFormation and IAM roles. Transport: WebSocket /ws + REST
 * (/progress, /screenshots). The server allowlists the extension by Origin (EXTENSION_ORIGIN).
 *
 * Deploys here are the server's guarded actions (EC2 t4g, DynamoDB, S3). Every write the agents want
 * to make arrives as deploy.preview and needs deploy.approve — see server/src/contract/approvals.ts.
 */
export interface ServerConfig {
  wsUrl: string;
  apiUrl: string;
}

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
    this.open();
  }

  disconnect() {
    this.closedByUser = true;
    clearTimeout(this.reconnectTimer);
    this.ws?.close(1000);
  }

  private open() {
    this.statuses.emit('connecting');
    const ws = new WebSocket(this.cfg.wsUrl);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.statuses.emit('connected');
      for (const cmd of this.queue.splice(0)) ws.send(JSON.stringify(cmd));
      // The server holds the workshop credentials: the account is "linked" as soon as we're connected.
      this.events.emit({ type: 'account.status', linked: true, message: 'Workshop AWS account (local server). Every change needs your approval.' });
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
    ws.onclose = () => {
      this.statuses.emit('disconnected');
      if (this.closedByUser) return;
      this.reconnectTimer = setTimeout(() => this.open(), Math.min(30_000, 1000 * 2 ** this.retry++));
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
        return this.events.emit({ type: 'account.status', requestId: cmd.requestId, linked: this.ws?.readyState === WebSocket.OPEN, message: 'The local server uses the workshop AWS profile.' });
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
    const res = await fetch(this.url('/screenshots'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contentType: 'image/jpeg' }) });
    if (!res.ok) throw new Error(`POST /screenshots → ${res.status}`);
    const { uploadUrl, screenshotKey } = (await res.json()) as { uploadUrl: string; screenshotKey: string };
    const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0));
    const put = await fetch(new URL(uploadUrl, this.cfg.apiUrl), { method: 'PUT', body: bytes, headers: { 'content-type': 'image/jpeg' } });
    if (!put.ok) throw new Error(`screenshot upload failed: ${put.status}`);
    return screenshotKey;
  }

  async getProgress(): Promise<Progress | null> {
    const res = await fetch(this.url('/progress'));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET /progress → ${res.status}`);
    return (await res.json()) as Progress;
  }

  putProgress(p: Progress) {
    void fetch(this.url('/progress'), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) }).catch((e) => console.warn('[server] putProgress', e));
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
