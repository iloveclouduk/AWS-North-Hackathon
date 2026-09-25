import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { type WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import type { Config } from './config.js';
import type { Orchestrator } from './contract/orchestrator.js';
import type { ProgressStore } from './contract/progress.js';
import { MAX_UPLOAD_BYTES, type UploadStore } from './contract/uploads.js';
import type { Poller } from './state/poller.js';
import type { ServerEvent } from './world.js';

const JSON_LIMIT = 64 * 1024;
const MAX_SOCKETS = 10;
const MAX_TASKS_PER_SOCKET = 2;
const MAX_REQUESTS_PER_SOCKET = 3;

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface Deps {
  config: Config;
  poller: Poller;
  orchestrator: Orchestrator;
  uploads: UploadStore;
  progress: ProgressStore;
  /** Events every newly connected socket should get first (e.g. the concierge's welcome). */
  welcome: () => ServerEvent[];
}

// ── Client → server command validation (mirrors ClientCommand in src/backend/contract.ts) ──
const Context = z
  .object({ url: z.string().max(2048).optional(), title: z.string().max(512).optional(), serviceId: z.string().max(64).optional(), screenshotKey: z.string().max(200).optional() })
  .strip();
const Id = z.string().min(1).max(100);
const Command = z.discriminatedUnion('action', [
  z.object({ action: z.literal('task.submit'), taskId: Id, prompt: z.string().min(1).max(2000), context: Context.default({}) }),
  z.object({ action: z.literal('chat.ask'), requestId: Id, districtId: z.string().max(64), question: z.string().min(1).max(2000), context: Context.default({}) }),
  z.object({ action: z.literal('page.classify'), requestId: Id, context: Context }),
]);

const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

const readBody = async (req: IncomingMessage, limit: number): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

const readJson = async (req: IncomingMessage): Promise<unknown> => {
  try {
    return JSON.parse((await readBody(req, JSON_LIMIT)).toString() || '{}');
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, 'Body must be JSON');
  }
};

const send = (res: ServerResponse, status: number, body?: unknown): void => {
  if (body === undefined) res.writeHead(status).end();
  else res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
};

export const createHttpServer = (deps: Deps) => {
  const { config } = deps;
  const allowedHosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`]);
  const pinned = config.extensionOrigins.length > 0;

  const originAllowed = (origin: string | undefined) =>
    origin !== undefined &&
    (pinned ? config.extensionOrigins.includes(origin) : origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://'));

  /**
   * Who may use the API: a caller with the token, or (only when EXTENSION_ORIGIN is pinned) the pinned
   * extension itself. The frontend's AwsBackend sends no token yet (getAuthToken is unset); browsers
   * don't let web pages forge Origin, and the server only listens on loopback.
   */
  const authorised = (req: IncomingMessage, url: URL) => {
    const bearer = req.headers.authorization?.replace(/^Bearer /, '') ?? url.searchParams.get('token') ?? undefined;
    if (bearer) return safeEqual(bearer, config.token);
    return pinned && originAllowed(req.headers.origin);
  };

  // Common guards for HTTP and WebSocket upgrades.
  const guard = (req: IncomingMessage) => {
    // DNS-rebinding guard: a web page can't reach us through a hostname it controls.
    if (!allowedHosts.has(req.headers.host ?? '')) throw new HttpError(421, 'Unexpected Host header');
    const origin = req.headers.origin;
    if (origin !== undefined && !originAllowed(origin)) throw new HttpError(403, 'Origin not allowed');
    return new URL(req.url ?? '/', `http://${req.headers.host}`);
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = guard(req);
    if (req.headers.origin) {
      res.setHeader('access-control-allow-origin', req.headers.origin);
      res.setHeader('vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-methods': 'GET, PUT, POST, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-max-age': '600',
      });
      return res.end();
    }

    const route = `${req.method} ${url.pathname}`;
    if (route === 'GET /health') return send(res, 200, { status: 'ok' });

    // Screenshot upload: authorised by the one-time signature in the URL, like a presigned S3 URL.
    const upload = /^\/uploads\/(screenshots\/[0-9a-f-]{36}\.(?:jpg|png))$/.exec(url.pathname);
    if (req.method === 'PUT' && upload) {
      const sig = url.searchParams.get('sig') ?? '';
      if (!deps.uploads.check(upload[1]!, sig)) throw new HttpError(403, 'Invalid or used upload URL');
      const bytes = await readBody(req, MAX_UPLOAD_BYTES);
      if (!deps.uploads.accept(upload[1]!, sig, bytes)) throw new HttpError(403, 'Invalid or used upload URL');
      return send(res, 200);
    }

    if (!authorised(req, url)) throw new HttpError(401, 'Missing or wrong token');

    if (route === 'GET /progress') {
      const p = await deps.progress.get();
      return p ? send(res, 200, p) : send(res, 404, { error: 'No progress yet' });
    }
    if (route === 'PUT /progress') {
      const out = await deps.progress.put(await readJson(req));
      if (!out.ok) throw new HttpError(400, out.error);
      return send(res, 204);
    }
    if (route === 'POST /screenshots') {
      const body = z
        .object({ contentType: z.enum(['image/jpeg', 'image/png']), url: z.string().max(2048).optional(), title: z.string().max(512).optional() })
        .safeParse(await readJson(req));
      if (!body.success) throw new HttpError(400, 'contentType must be image/jpeg or image/png');
      return send(res, 200, deps.uploads.create(body.data.contentType));
    }
    // Debug view of what the state layer sees.
    if (route === 'GET /snapshot') return send(res, 200, deps.poller.current() ?? (await deps.poller.refresh()));

    throw new HttpError(404, 'Not found');
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (res.headersSent) return res.end();
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error('[http]', err);
      send(res, 500, { error: 'Internal server error' });
    });
  });

  // ── WebSocket: the contract's live channel ──
  const wss = new WebSocketServer({ noServer: true, maxPayload: JSON_LIMIT });
  const sockets = new Set<WebSocket>();

  const sendTo = (ws: WebSocket, event: ServerEvent) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
  };

  // A client that vanishes mid-request or mid-upgrade must never crash the process.
  server.on('clientError', (_err, socket) => socket.destroy());

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    try {
      const url = guard(req);
      if (url.pathname !== '/ws') throw new HttpError(404, 'WebSocket endpoint is /ws');
      if (!authorised(req, url)) throw new HttpError(401, 'Missing or wrong token');
      if (sockets.size >= MAX_SOCKETS) throw new HttpError(429, 'Too many connections');
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 400;
      socket.end(`HTTP/1.1 ${status} ${err instanceof Error ? err.message : 'Bad request'}\r\nConnection: close\r\n\r\n`);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      let tasks = 0;
      let requests = 0;
      // Events for a task still running when its socket closes are dropped (accepted limitation).
      ws.on('close', () => sockets.delete(ws));
      ws.on('error', () => ws.terminate());
      for (const e of deps.welcome()) sendTo(ws, e);

      ws.on('message', (raw) => {
        const emit = (e: ServerEvent) => sendTo(ws, e);
        let json: unknown;
        try {
          json = JSON.parse(raw.toString());
        } catch {
          emit({ type: 'error', message: 'Frames must be JSON' });
          return;
        }
        const parsed = Command.safeParse(json);
        if (!parsed.success) {
          emit({ type: 'error', message: `Bad command: ${parsed.error.issues[0]?.message ?? 'invalid'}` });
          return;
        }
        const cmd = parsed.data;
        if (cmd.action === 'task.submit') {
          if (tasks >= MAX_TASKS_PER_SOCKET) {
            emit({ type: 'error', message: 'Two tasks are already running. Wait for one to finish.', taskId: cmd.taskId });
            return;
          }
          tasks++;
          void deps.orchestrator.submitTask(cmd, emit).finally(() => tasks--);
        } else {
          // Each chat/classify is a Bedrock call billed to the account: cap them per socket.
          const requestId = cmd.requestId;
          if (requests >= MAX_REQUESTS_PER_SOCKET) {
            emit({ type: 'error', message: 'Still answering your last questions. Try again in a moment.', requestId });
            return;
          }
          requests++;
          const job = cmd.action === 'chat.ask' ? deps.orchestrator.ask(cmd, emit) : deps.orchestrator.classifyPage(cmd, emit);
          void job.finally(() => requests--);
        }
      });
    });
  });

  return {
    server,
    broadcast(events: ServerEvent[]) {
      for (const ws of sockets) for (const e of events) sendTo(ws, e);
    },
  };
};
