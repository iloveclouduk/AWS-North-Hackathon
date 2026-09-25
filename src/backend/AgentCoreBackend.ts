import { Listeners, uid, waitFor, type AgentBackend, type ConnectionStatus } from './AgentBackend';
import type { CognitoAuth } from './auth';
import { bearerSubprotocols, isServerEvent, type ClientCommand, type Progress, type ServerEvent } from './contract';

export interface AgentCoreConfig {
  region: string;
  /** arn:aws:bedrock-agentcore:<region>:<acct>:runtime/<id> */
  runtimeArn: string;
  auth: CognitoAuth;
  /** Stable per-player session id (≥33 chars) so the swarm keeps context between reconnects. */
  sessionId: () => Promise<string>;
}

/**
 * Talks to the Strands swarm hosted on Amazon Bedrock AgentCore Runtime over one WebSocket.
 * The Cognito access token rides in Sec-WebSocket-Protocol (AgentCore's browser OAuth format), so
 * it never appears in URLs or access logs.
 */
export class AgentCoreBackend implements AgentBackend {
  readonly kind = 'agentcore' as const;
  private ws?: WebSocket;
  private events = new Listeners<ServerEvent>();
  private statuses = new Listeners<ConnectionStatus>();
  private queue: ClientCommand[] = [];
  private retry = 0;
  private closedByUser = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  constructor(private cfg: AgentCoreConfig) {}

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

  async signIn() {
    await this.cfg.auth.signIn();
    this.connect();
  }

  private async open() {
    const token = await this.cfg.auth.token();
    if (!token) {
      this.statuses.emit('signed-out');
      return;
    }
    this.statuses.emit('connecting');
    const url = new URL(`wss://bedrock-agentcore.${this.cfg.region}.amazonaws.com/runtimes/${encodeURIComponent(this.cfg.runtimeArn)}/ws`);
    url.searchParams.set('X-Amzn-Bedrock-AgentCore-Runtime-Session-Id', await this.cfg.sessionId());
    const ws = new WebSocket(url, bearerSubprotocols(token));
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.statuses.emit('connected');
      for (const cmd of this.queue.splice(0)) ws.send(JSON.stringify(cmd));
    };
    ws.onmessage = (msg) => {
      try {
        const data: unknown = JSON.parse(String(msg.data));
        for (const e of Array.isArray(data) ? data : [data]) {
          if (isServerEvent(e)) this.events.emit(e);
          else console.warn('[agentcore] unknown frame', e);
        }
      } catch (err) {
        console.warn('[agentcore] bad frame', err);
      }
    };
    ws.onerror = () => this.statuses.emit('error');
    ws.onclose = (ev) => {
      this.statuses.emit('disconnected');
      if (this.closedByUser || ev.code === 1008) return; // 1008 = policy (auth/limits) — don't hammer
      const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
      this.reconnectTimer = setTimeout(() => void this.open(), delay);
    };
  }

  send(cmd: ClientCommand) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(cmd));
    else this.queue.push(cmd);
  }

  async uploadScreenshot(dataUrl: string) {
    const requestId = uid();
    const ready = waitFor(this, (e) => (e.type === 'screenshot.url' && e.requestId === requestId ? e : undefined));
    this.send({ action: 'screenshot.presign', requestId, contentType: 'image/jpeg' });
    const { uploadUrl, screenshotKey } = await ready;
    const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0));
    const put = await fetch(uploadUrl, { method: 'PUT', body: bytes, headers: { 'content-type': 'image/jpeg' } });
    if (!put.ok) throw new Error(`screenshot upload failed: ${put.status}`);
    return screenshotKey;
  }

  async getProgress(): Promise<Progress | null> {
    const requestId = uid();
    const got = waitFor(this, (e) => (e.type === 'progress.state' && e.requestId === requestId ? e : undefined));
    this.send({ action: 'progress.get', requestId });
    return (await got).progress;
  }

  putProgress(progress: Progress) {
    this.send({ action: 'progress.put', progress });
  }
}
