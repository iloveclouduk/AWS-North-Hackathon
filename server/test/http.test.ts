import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { loadConfig } from '../src/config.js';
import type { Approvals } from '../src/contract/approvals.js';
import type { Orchestrator } from '../src/contract/orchestrator.js';
import { createProgressStore } from '../src/contract/progress.js';
import { createUploadStore } from '../src/contract/uploads.js';
import { createHttpServer } from '../src/http.js';
import type { Poller } from '../src/state/poller.js';
import type { ServerEvent } from '../src/world.js';
import { snapshot } from './fixtures.js';

const TOKEN = 'test-token';
let base: string;
let port: number;
let close: () => void;
const received: ServerEvent[] = [];

beforeAll(async () => {
  const snap = snapshot([]);
  const poller = { current: () => snap, refresh: async () => snap, start() {}, stop() {} } as Poller;
  const orchestrator = {
    submitTask: async (cmd: { taskId: string; prompt: string }, emit: (e: ServerEvent) => void, approvals?: Approvals) => {
      // 'approve-me' simulates an agent write that needs the player's OK (contract v2).
      const ok = cmd.prompt === 'approve-me' && approvals
        ? await approvals.request(cmd.taskId, { action: { type: 'create_table', name: 'city-x' } as never, summary: 'Create DynamoDB table "city-x"', destructive: false }, emit)
        : true;
      emit({ type: 'task.done', taskId: cmd.taskId, ok, result: 'ok', xp: [] });
    },
    ask: async () => {},
    classifyPage: async () => {},
  } as unknown as Orchestrator;

  // Port 0 → pick a free port, then rebuild with the real port so the Host allowlist matches.
  const probe = createHttpServer({ config: { ...loadConfig({}), port: 0, token: TOKEN }, poller, orchestrator, uploads: createUploadStore(''), progress: createProgressStore('nope'), welcome: () => [] });
  await new Promise<void>((r) => probe.server.listen(0, '127.0.0.1', r));
  port = (probe.server.address() as AddressInfo).port;
  probe.server.close();

  const { server } = createHttpServer({
    config: { ...loadConfig({}), port, token: TOKEN, extensionOrigins: ['chrome-extension://abc'] },
    poller,
    orchestrator,
    uploads: createUploadStore(`http://127.0.0.1:${port}`),
    progress: createProgressStore(`${process.env.TEMP ?? '/tmp'}/aws-city-test-${Date.now()}.json`),
    welcome: () => [{ type: 'agent.message', from: 'concierge', to: 'user', text: 'hi' }],
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  base = `http://127.0.0.1:${port}`;
  close = () => server.close();
});
afterAll(() => close());

const openWs = (query: string, origin?: string) =>
  new Promise<{ ws?: WebSocket; status?: number }>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`, origin ? { origin } : {});
    ws.on('open', () => resolve({ ws }));
    ws.on('unexpected-response', (_q, res) => resolve({ status: res.statusCode }));
    ws.on('message', (raw) => received.push(JSON.parse(raw.toString())));
  });

describe('HTTP/WebSocket guards', () => {
  it('REST needs the token (or the pinned extension origin)', async () => {
    expect((await fetch(`${base}/progress`)).status).toBe(401);
    expect((await fetch(`${base}/progress`, { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(404);
    expect((await fetch(`${base}/progress`, { headers: { origin: 'chrome-extension://abc' } })).status).toBe(404);
    expect((await fetch(`${base}/progress`, { headers: { origin: 'chrome-extension://other' } })).status).toBe(403);
  });

  it('rejects a foreign Host header (DNS rebinding)', async () => {
    const res = await new Promise<string>((resolve) => {
      const s = connect(port, '127.0.0.1', () => s.write('GET /health HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n'));
      let data = '';
      s.on('data', (d) => (data += d));
      s.on('end', () => resolve(data));
    });
    expect(res).toMatch(/^HTTP\/1.1 421/);
  });

  it('WebSocket: token or pinned origin required, then welcome + contract events', async () => {
    expect((await openWs('')).status).toBe(401);
    expect((await openWs('?token=x', 'https://evil.example')).status).toBe(403);
    const { ws } = await openWs(`?token=${TOKEN}`);
    ws!.send(JSON.stringify({ action: 'task.submit', taskId: 'k1', prompt: 'hi', context: {} }));
    ws!.send('not json');
    await new Promise((r) => setTimeout(r, 100));
    expect(received).toContainEqual(expect.objectContaining({ type: 'agent.message', text: 'hi' }));
    expect(received).toContainEqual(expect.objectContaining({ type: 'task.done', taskId: 'k1' }));
    expect(received).toContainEqual(expect.objectContaining({ type: 'error', message: 'Frames must be JSON' }));
    ws!.close();
  });

  it('survives clients that reset the connection around an upgrade (rejected or accepted)', async () => {
    const upgrade = (query: string, origin: string) =>
      `GET /ws${query} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${origin}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
      `Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`;
    for (const [query, origin] of [['?token=x', 'https://evil.example'], [`?token=${TOKEN}`, 'chrome-extension://abc']] as const) {
      await new Promise<void>((resolve) => {
        const s = connect(port, '127.0.0.1', () => s.write(upgrade(query, origin)));
        // Reset right after the server answered: this is what crashed the live server (ECONNRESET, no listener).
        s.once('data', () => {
          s.resetAndDestroy();
          resolve();
        });
      });
    }
    await new Promise((r) => setTimeout(r, 150));
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it('screenshot upload URLs are single-use and signed', async () => {
    const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
    const { uploadUrl } = (await (await fetch(`${base}/screenshots`, { method: 'POST', headers: auth, body: JSON.stringify({ contentType: 'image/jpeg' }) })).json()) as { uploadUrl: string };
    expect((await fetch(uploadUrl.replace(/sig=.*/, 'sig=forged'), { method: 'PUT', body: 'x' })).status).toBe(403);
    expect((await fetch(uploadUrl, { method: 'PUT', body: 'jpeg-bytes' })).status).toBe(200);
    expect((await fetch(uploadUrl, { method: 'PUT', body: 'again' })).status).toBe(403);
  });
});

describe('player approvals over the socket (contract v2)', () => {
  const next = (ws: WebSocket, type: string) =>
    new Promise<ServerEvent>((resolve) => {
      const onMsg = (raw: WebSocket.RawData) => {
        const e = JSON.parse(raw.toString()) as ServerEvent;
        if (e.type === type) {
          ws.off('message', onMsg);
          resolve(e);
        }
      };
      ws.on('message', onMsg);
    });

  it('a write waits for deploy.approve on the same socket, and stale answers are refused', async () => {
    const { ws } = await openWs(`?token=${TOKEN}`);
    const preview = next(ws!, 'deploy.preview');
    ws!.send(JSON.stringify({ action: 'task.submit', taskId: 'appr-1', prompt: 'approve-me', context: {} }));
    const p = await preview;
    if (p.type !== 'deploy.preview') throw new Error();
    expect(p.changes[0]).toMatchObject({ action: 'Add', resourceType: 'AWS::DynamoDB::Table' });
    const done = next(ws!, 'task.done');
    ws!.send(JSON.stringify({ action: 'deploy.approve', deployId: p.deployId }));
    expect(await done).toMatchObject({ taskId: 'appr-1', ok: true });
    const stale = next(ws!, 'deploy.status');
    ws!.send(JSON.stringify({ action: 'deploy.approve', deployId: p.deployId }));
    expect(await stale).toMatchObject({ status: 'failed' });
    ws!.close();
  });

  it('closing the socket rejects pending approvals', async () => {
    const { ws } = await openWs(`?token=${TOKEN}`);
    const preview = next(ws!, 'deploy.preview');
    ws!.send(JSON.stringify({ action: 'task.submit', taskId: 'appr-2', prompt: 'approve-me', context: {} }));
    await preview;
    ws!.close();
  });
});
