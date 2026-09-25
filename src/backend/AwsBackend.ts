import { Listeners, type AgentBackend, type ConnectionStatus } from './AgentBackend';
import {
  isServerEvent,
  type ClientCommand,
  type Progress,
  type ScreenshotUploadRequest,
  type ScreenshotUploadResponse,
  type ServerEvent,
} from './contract';

export interface AwsBackendConfig {
  /** API Gateway WebSocket stage URL (wss://…/prod). */
  wsUrl: string;
  /** API Gateway HTTP API base URL (https://…). */
  apiUrl: string;
  /** Returns a bearer token (e.g. Cognito ID token) or undefined while auth isn't wired yet. */
  getAuthToken?: () => Promise<string | undefined>;
}

/**
 * Real backend over API Gateway. Browsers can't set headers on WebSocket upgrades, so the token
 * travels as `?token=` on connect (validate it in a $connect Lambda authorizer).
 */
export class AwsBackend implements AgentBackend {
  readonly kind = 'aws' as const;
  private ws?: WebSocket;
  private events = new Listeners<ServerEvent>();
  private statuses = new Listeners<ConnectionStatus>();
  private queue: ClientCommand[] = [];
  private retry = 0;
  private closedByUser = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  constructor(private cfg: AwsBackendConfig) {}

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
    this.ws?.close();
  }

  private async open() {
    this.statuses.emit('connecting');
    const token = await this.cfg.getAuthToken?.();
    const url = new URL(this.cfg.wsUrl);
    if (token) url.searchParams.set('token', token);
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.statuses.emit('connected');
      for (const cmd of this.queue.splice(0)) ws.send(JSON.stringify(cmd));
    };
    ws.onmessage = (msg) => {
      try {
        const data: unknown = JSON.parse(String(msg.data));
        // Allow the backend to batch: a frame may be one event or an array of events.
        for (const e of Array.isArray(data) ? data : [data]) {
          if (isServerEvent(e)) this.events.emit(e);
          else console.warn('[aws] unknown frame', e);
        }
      } catch (err) {
        console.warn('[aws] bad frame', err);
      }
    };
    ws.onerror = () => this.statuses.emit('error');
    ws.onclose = () => {
      this.statuses.emit('disconnected');
      if (this.closedByUser) return;
      const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
      this.reconnectTimer = setTimeout(() => void this.open(), delay);
    };
  }

  private send(cmd: ClientCommand) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(cmd));
    else this.queue.push(cmd);
  }

  submitTask(cmd: Parameters<AgentBackend['submitTask']>[0]) {
    this.send({ action: 'task.submit', ...cmd });
  }
  ask(cmd: Parameters<AgentBackend['ask']>[0]) {
    this.send({ action: 'chat.ask', ...cmd });
  }
  classifyPage(cmd: Parameters<AgentBackend['classifyPage']>[0]) {
    this.send({ action: 'page.classify', ...cmd });
  }

  private async rest(path: string, init: RequestInit = {}) {
    const token = await this.cfg.getAuthToken?.();
    const res = await fetch(new URL(path, this.cfg.apiUrl), {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
    if (!res.ok && res.status !== 404) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}`);
    return res;
  }

  async uploadScreenshot(dataUrl: string, meta: { url?: string; title?: string }) {
    const body: ScreenshotUploadRequest = { contentType: 'image/jpeg', ...meta };
    const res = await this.rest('/screenshots', { method: 'POST', body: JSON.stringify(body) });
    const { uploadUrl, screenshotKey } = (await res.json()) as ScreenshotUploadResponse;
    const blob = await (await fetch(dataUrl)).blob();
    const put = await fetch(uploadUrl, { method: 'PUT', body: blob, headers: { 'content-type': 'image/jpeg' } });
    if (!put.ok) throw new Error(`screenshot upload failed: ${put.status}`);
    return screenshotKey;
  }

  async getProgress() {
    const res = await this.rest('/progress');
    if (res.status === 404) return null;
    return (await res.json()) as Progress;
  }

  async putProgress(p: Progress) {
    await this.rest('/progress', { method: 'PUT', body: JSON.stringify(p) });
  }
}
