import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { type WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { type Authenticate, BEARER_PROTOCOL, type Principal, tokenAuth } from './auth.js';
import { type Config, originMatches } from './config.js';
import type { Orchestrator } from './contract/orchestrator.js';
import { createApprovals } from './contract/approvals.js';
import { type ConsoleCopilot, Snapshot } from './contract/console.js';
import type { ProgressStore } from './contract/progress.js';
import { MAX_UPLOAD_BYTES, type MemoryUploadStore, UPLOAD_PATH } from './contract/uploads.js';
import { MFA_REQUIRED_MESSAGE } from './accounts/mfa.js';
import { log, publicError, who } from './log.js';
import type { Poller } from './state/poller.js';
import type { Tenant, TenantHub } from './tenants.js';
import { CLOSE_CODES, type ServerEvent } from './world.js';

const JSON_LIMIT = 64 * 1024;
const MAX_TASKS_PER_SOCKET = 2;
const MAX_REQUESTS_PER_SOCKET = 3;
const HEARTBEAT_MS = 25_000;
/** Frames per socket: a burst of 30, refilled at 10 a second. */
const FRAME_BURST = 30;
const FRAMES_PER_SECOND = 10;
/** account.link / account.verify each assume a role and rebuild the player's city: one per this window. */
const ACCOUNT_COOLDOWN_MS = 5_000;
/** Tokens are checked at connect; long-lived sockets are closed so the client reconnects with a fresh one. */
const MAX_CONNECTION_MS = 8 * 60 * 60_000;
/**
 * Once the token has expired the socket closes as soon as it's idle (so a player mid-approval isn't cut
 * off), and at the latest this long after expiry.
 */
const EXPIRED_GRACE_MS = 10 * 60_000;
/** How long this task remembers a deleted player without asking the store again (the tombstone itself lasts longer). */
const DELETED_CACHE_MS = 10 * 60_000;
const IDLE_CHECK_MS = 15_000;

/** WebSocket close codes the extension understands (CLOSE_CODES in src/backend/contract.ts; see ServerBackend). */
export const CLOSE = CLOSE_CODES;

/** A token bucket: true while the caller is within its rate. */
export const rateLimiter = (burst: number, perSecond: number, now = () => Date.now()) => {
  let tokens = burst;
  let last = now();
  return () => {
    const t = now();
    tokens = Math.min(burst, tokens + ((t - last) / 1000) * perSecond);
    last = t;
    if (tokens < 1) return false;
    tokens--;
    return true;
  };
};

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** The local single-player server (and the tests) pass their pieces directly. */
export interface SingleTenantDeps {
  poller: Poller;
  orchestrator: Orchestrator;
  uploads: MemoryUploadStore;
  progress: ProgressStore;
  /** Events every newly connected socket should get first (e.g. the concierge's welcome). */
  welcome: () => ServerEvent[];
  /** Console Copilot (v2.1): one instance per socket; optional so older setups/tests keep working. */
  createCopilot?: () => ConsoleCopilot;
}

export interface HubDeps {
  tenants: TenantHub;
  authenticate: Authenticate;
  /** The local upload store (PUT /uploads/…); hosted uploads go straight to S3. */
  uploads?: MemoryUploadStore;
  /**
   * Step-up (hosted): true once the player has TOTP MFA on. Checked before account.link/verify and before every AWS
   * write (deploy.approve, finding.fix), so turning MFA off after linking stops writes too. Absent = no check.
   */
  mfaReady?: (p: Principal) => Promise<boolean>;
  /**
   * Hosted: true for a player who deleted their account recently (Stores.deletedRecently). Their access token still
   * verifies until it expires, so the routes that would recreate their data refuse them. Absent = no check.
   */
  deleted?: (sub: string) => Promise<boolean>;
}

export type Deps = { config: Config } & (SingleTenantDeps | HubDeps);

/** Adapts the local pieces to the multi-player hub: one player, "local". */
export const singleTenant = (d: SingleTenantDeps & { config: Config }): TenantHub => {
  const tenant: Tenant = {
    sub: 'local',
    region: d.config.region,
    orchestrator: () => d.orchestrator,
    care: () => undefined,
    createCopilot: () => d.createCopilot?.(),
    bill: async (on, emit) => void (on && emit({ type: 'city.bill', unavailable: "This server doesn't read bills.", takenAt: new Date().toISOString() })),
    flow: async (on, emit) => void (on && emit({ type: 'city.flow', unavailable: "This server doesn't read live traffic.", takenAt: new Date().toISOString() })),
    welcome: async () => d.welcome(),
    subscribe: () => () => undefined,
    emitter: (emit) => emit,
    snapshot: async () => d.poller.current() ?? (await d.poller.refresh()),
    progress: { get: () => d.progress.get(), put: (input) => d.progress.put(input) },
    uploads: { create: (contentType) => d.uploads.create(contentType, 'local') },
    link: async (requestId, _region, emit) => emit({ type: 'account.status', requestId, linked: true, message: 'The local server uses the workshop AWS profile.' }),
    verify: async (requestId, _arn, emit) => emit({ type: 'account.status', requestId, linked: true, message: 'The local server uses the workshop AWS profile.' }),
    deleteMe: async () => undefined,
  };
  return { acquire: async () => tenant, data: () => tenant, release: () => undefined, closeAll: () => undefined };
};

// ── Client → server command validation (mirrors ClientCommand in src/backend/contract.ts) ──
const Context = z
  .object({ url: z.string().max(2048).optional(), title: z.string().max(512).optional(), serviceId: z.string().max(64).optional(), screenshotKey: z.string().max(200).optional() })
  .strip();
const Id = z.string().min(1).max(100);
const Command = z.discriminatedUnion('action', [
  z.object({ action: z.literal('task.submit'), taskId: Id, prompt: z.string().min(1).max(2000), context: Context.default({}) }),
  z.object({ action: z.literal('chat.ask'), requestId: Id, districtId: z.string().max(64), question: z.string().min(1).max(2000), context: Context.default({}) }),
  z.object({ action: z.literal('page.classify'), requestId: Id, context: Context }),
  // contract v2: the player's answer to a deploy.preview (approval of a guarded write)
  z.object({ action: z.literal('deploy.approve'), deployId: Id, confirm: z.string().max(300).optional() }),
  z.object({ action: z.literal('deploy.reject'), deployId: Id }),
  // contract v2.1: Console Copilot
  z.object({ action: z.literal('console.start'), taskId: Id, goal: z.string().min(1).max(500), context: Context.default({}), snapshot: Snapshot }),
  z.object({ action: z.literal('console.observe'), taskId: Id, index: z.number().int().min(0).max(100), ok: z.boolean(), note: z.string().max(200).optional(), snapshot: Snapshot }),
  z.object({ action: z.literal('console.stop'), taskId: Id }),
  // Connecting the player's own AWS account (hosted)
  z.object({ action: z.literal('account.link'), requestId: Id, region: z.string().min(1).max(32) }),
  z.object({ action: z.literal('account.verify'), requestId: Id, roleArn: z.string().min(1).max(200) }),
  // contract v2.3: city care (the citizens' findings)
  z.object({ action: z.literal('finding.explain'), requestId: Id, findingId: Id }),
  z.object({ action: z.literal('finding.fix'), requestId: Id, findingId: Id }),
  z.object({ action: z.literal('finding.undo'), requestId: Id, findingId: Id }),
  // contract v2.5: the month-to-date bill on or off
  z.object({ action: z.literal('bill.enable'), on: z.boolean() }).strict(),
  // contract v2.8: live traffic on or off
  z.object({ action: z.literal('flow.enable'), on: z.boolean() }).strict(),
]);

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
  const hub = 'tenants' in deps ? deps.tenants : singleTenant(deps);
  const authenticate = 'authenticate' in deps ? deps.authenticate : tokenAuth(config);
  const memoryUploads = deps.uploads;
  const mfaReady = 'mfaReady' in deps ? deps.mfaReady : undefined;
  const deleted = 'deleted' in deps ? deps.deleted : undefined;
  /** Players known to be deleted (sub → until): one store read finds out, then it's remembered here. */
  const gone = new Map<string, number>();
  /** Refuses a player who deleted their account (410), before anything is stored for them again. */
  const refuseDeleted = async (sub: string) => {
    if (!deleted) return;
    const until = gone.get(sub);
    if (until !== undefined && until > Date.now()) throw new HttpError(410, 'This account was deleted');
    gone.delete(sub);
    if (await deleted(sub)) {
      gone.set(sub, Date.now() + DELETED_CACHE_MS);
      throw new HttpError(410, 'This account was deleted');
    }
  };
  const allowedHosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`, `[::1]:${config.port}`, ...config.publicHosts]);
  let draining = false;
  /** Agent turns and answers in flight across all sockets (drain waits for these). */
  let busy = 0;
  const track = <T>(p: Promise<T>) => {
    busy++;
    return p.finally(() => busy--);
  };

  const originAllowed = (origin: string | undefined) => origin !== undefined && originMatches(origin, config.extensionOrigins);

  // Common guards for HTTP and WebSocket upgrades.
  const guard = (req: IncomingMessage) => {
    // DNS-rebinding guard: a web page can't reach us through a hostname it controls.
    if (!allowedHosts.has(req.headers.host ?? '')) throw new HttpError(421, 'Unexpected Host header');
    const origin = req.headers.origin;
    if (origin !== undefined && !originAllowed(origin)) throw new HttpError(403, 'Origin not allowed');
    return new URL(req.url ?? '/', `http://${req.headers.host}`);
  };

  const principalFor = async (req: IncomingMessage, url: URL): Promise<Principal> => {
    const p = await authenticate(req, url);
    if (!p) throw new HttpError(401, config.authMode === 'cognito' ? 'Please sign in again' : 'Missing or wrong token');
    return p;
  };

  /** REST calls borrow the player's tenant for the length of the request. */
  const withTenant = async <T>(p: Principal, fn: (t: Tenant) => Promise<T>): Promise<T> => {
    const t = await hub.acquire(p);
    try {
      return await fn(t);
    } finally {
      hub.release(p);
    }
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    // Load balancer health checks come from the private network with the task IP as Host.
    if (req.method === 'GET' && req.url === '/health') return send(res, draining ? 503 : 200, { status: draining ? 'draining' : 'ok' });
    const url = guard(req);
    if (req.headers.origin) {
      res.setHeader('access-control-allow-origin', req.headers.origin);
      res.setHeader('vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-methods': 'GET, PUT, POST, DELETE, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-max-age': '600',
      });
      return res.end();
    }

    const route = `${req.method} ${url.pathname}`;

    // Local screenshot upload: authorised by the one-time signature in the URL, like a presigned S3 URL.
    const upload = UPLOAD_PATH.exec(url.pathname);
    if (req.method === 'PUT' && upload && memoryUploads) {
      const sig = url.searchParams.get('sig') ?? '';
      if (!memoryUploads.check(upload[1]!, sig)) throw new HttpError(403, 'Invalid or used upload URL');
      const bytes = await readBody(req, MAX_UPLOAD_BYTES);
      if (!memoryUploads.accept(upload[1]!, sig, bytes)) throw new HttpError(403, 'Invalid or used upload URL');
      return send(res, 200);
    }

    const principal = await principalFor(req, url);

    if (route === 'GET /progress' || route === 'PUT /progress' || route === 'POST /screenshots') await refuseDeleted(principal.sub);
    if (route === 'GET /progress') {
      const p = await hub.data(principal).progress.get();
      return p ? send(res, 200, p) : send(res, 404, { error: 'No progress yet' });
    }
    if (route === 'PUT /progress') {
      const body = await readJson(req);
      const out = await hub.data(principal).progress.put(body);
      if (!out.ok) throw new HttpError(400, out.error);
      return send(res, 204);
    }
    if (route === 'POST /screenshots') {
      const body = z
        .object({ contentType: z.enum(['image/jpeg', 'image/png']), url: z.string().max(2048).optional(), title: z.string().max(512).optional() })
        .safeParse(await readJson(req));
      if (!body.success) throw new HttpError(400, 'contentType must be image/jpeg or image/png');
      return send(res, 200, await hub.data(principal).uploads.create(body.data.contentType));
    }
    // Deletes everything we store about the player (Chrome Web Store / privacy requirement).
    if (route === 'DELETE /me') {
      await hub.data(principal).deleteMe();
      if (deleted) gone.set(principal.sub, Date.now() + DELETED_CACHE_MS);
      // Their open tabs must not keep acting as a player who no longer exists, nor reconnect (their token still verifies).
      for (const [ws, sub] of owners) if (sub === principal.sub) ws.close(CLOSE.deleted, 'Account deleted');
      return send(res, 204);
    }
    // Debug view of what the state layer sees (local server only).
    if (route === 'GET /snapshot' && config.authMode === 'token') return send(res, 200, (await withTenant(principal, (t) => t.snapshot())) ?? null);

    throw new HttpError(404, 'Not found');
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (res.headersSent) return res.end();
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      log.error('http', { err: (err as Error).message });
      send(res, 500, { error: 'Internal server error' });
    });
  });

  // ── WebSocket: the contract's live channel ──
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: JSON_LIMIT,
    // Browsers fail the handshake unless the server echoes one of the offered subprotocols.
    handleProtocols: (protocols) => (protocols.has(BEARER_PROTOCOL) ? BEARER_PROTOCOL : false),
  });
  const sockets = new Set<WebSocket>();
  const owners = new Map<WebSocket, string>();
  const perUser = new Map<string, number>();

  const sendTo = (ws: WebSocket, event: ServerEvent) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
  };

  // A client that vanishes mid-request or mid-upgrade must never crash the process.
  server.on('clientError', (_err, socket) => socket.destroy());

  /** Our own HttpError reasons are fixed strings; anything else is logged with a ref and answered generically. */
  const reject = (socket: import('node:stream').Duplex, err: unknown) => {
    if (err instanceof HttpError) {
      socket.end(`HTTP/1.1 ${err.status} ${err.message.replace(/[\r\n]+/g, ' ')}\r\nConnection: close\r\n\r\n`);
      return;
    }
    const ref = randomBytes(3).toString('hex');
    log.error('upgrade rejected', { ref, err: (err as Error)?.name ?? 'Error', detail: (err as Error)?.message?.slice(0, 300) });
    socket.end(`HTTP/1.1 500 Internal error (ref ${ref})\r\nConnection: close\r\n\r\n`);
  };

  /** Slots taken by sockets that are open or still being set up (reserved before any await: no race past the caps). */
  let slots = 0;
  const release = (sub: string) => {
    slots--;
    const n = (perUser.get(sub) ?? 1) - 1;
    if (n > 0) perUser.set(sub, n);
    else perUser.delete(sub);
  };

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    let url: URL;
    try {
      if (draining) throw new HttpError(503, 'Server restarting');
      url = guard(req);
      if (url.pathname !== '/ws') throw new HttpError(404, 'WebSocket endpoint is /ws');
      if (slots >= config.maxSockets) throw new HttpError(429, 'Too many connections');
    } catch (err) {
      return reject(socket, err);
    }
    slots++;
    void (async () => {
      let principal: Principal | undefined;
      let tenant: Tenant;
      try {
        principal = await principalFor(req, url)
          .then(async (p) => (await refuseDeleted(p.sub), p))
          .catch((err) => {
            slots--;
            throw err;
          });
        // Check and reserve in the same tick.
        if ((perUser.get(principal.sub) ?? 0) >= config.maxSocketsPerUser) {
          slots--;
          principal = undefined;
          throw new HttpError(429, 'Too many open tabs');
        }
        perUser.set(principal.sub, (perUser.get(principal.sub) ?? 0) + 1);
        tenant = await hub.acquire(principal);
      } catch (err) {
        if (principal) release(principal.sub);
        return reject(socket, err);
      }
      const p = principal;
      // Until the WebSocket owns the connection, a client that drops mid-handshake must give its
      // slot and tenant reference back (ws never calls back for a socket that died).
      let owned = false;
      const giveBack = () => {
        if (owned) return;
        owned = true;
        release(p.sub);
        hub.release(p);
      };
      if (socket.destroyed) return giveBack();
      socket.once('close', giveBack);
      wss.handleUpgrade(req, socket, head, (ws) => {
        if (owned) return ws.terminate();
        owned = true;
        socket.off('close', giveBack);
        onSocket(ws, p, tenant);
      });
    })();
  });

  const onSocket = (ws: WebSocket, principal: Principal, tenant: Tenant) => {
    sockets.add(ws);
    owners.set(ws, principal.sub);
    // Ties one connection's log lines together (players are only ever a hash).
    const connId = randomBytes(4).toString('hex');
    const opened = Date.now();
    log.info('socket open', { who: who(principal.sub), connId });
    let tasks = 0;
    let requests = 0;
    let alive = true;
    const withinRate = rateLimiter(FRAME_BURST, FRAMES_PER_SECOND);
    let lastAccountCommand = 0;
    const raw = (e: ServerEvent) => sendTo(ws, e);
    const emit = tenant.emitter(raw);
    // Events for a task still running when its socket closes are dropped (accepted limitation).
    const approvals = createApprovals({ region: tenant.region });
    /** Aborted on close: this socket's agent turns stop (other tabs' turns run on). */
    const turns = new AbortController();
    /** MFA step-up (hosted); a failed check counts as "not ready". */
    const stepUp = async () => !mfaReady || (await mfaReady(principal).catch(() => false));
    const copilot = tenant.createCopilot();
    const unsubscribe = tenant.subscribe(emit);
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, HEARTBEAT_MS);
    const maxAge = setTimeout(() => ws.close(CLOSE.reauth, 'Session refresh'), MAX_CONNECTION_MS);
    // After the token expires: close when idle, or at the end of the grace period regardless.
    const untilExpiry = principal.expiresAt === undefined ? undefined : principal.expiresAt - Date.now();
    let expiryCheck: NodeJS.Timeout | undefined;
    const expiry =
      untilExpiry === undefined
        ? undefined
        : setTimeout(() => {
            const hardStop = Date.now() + EXPIRED_GRACE_MS;
            const check = () => {
              if ((tasks === 0 && requests === 0 && approvals.size === 0) || Date.now() >= hardStop) return ws.close(CLOSE.reauth, 'Session refresh');
              expiryCheck = setTimeout(check, IDLE_CHECK_MS);
              expiryCheck.unref?.();
            };
            check();
          }, Math.max(0, untilExpiry));
    heartbeat.unref?.();
    maxAge.unref?.();
    expiry?.unref?.();
    ws.on('pong', () => (alive = true));
    ws.on('close', (code) => {
      log.info('socket closed', { who: who(principal.sub), connId, code, minutes: Math.round((Date.now() - opened) / 60_000) });
      sockets.delete(ws);
      owners.delete(ws);
      release(principal.sub);
      clearInterval(heartbeat);
      clearTimeout(maxAge);
      clearTimeout(expiry);
      clearTimeout(expiryCheck);
      unsubscribe();
      approvals.cancelAll();
      turns.abort();
      copilot?.stopAll();
      hub.release(principal);
    });
    ws.on('error', () => ws.terminate());
    void tenant.welcome().then((events) => events.forEach(emit), (err) => log.warn('welcome failed', { who: who(principal.sub), err: (err as Error).name }));

    ws.on('message', (data) => {
      if (!withinRate()) {
        emit({ type: 'error', message: 'Too many messages. Slow down a little.' });
        return;
      }
      let json: unknown;
      try {
        json = JSON.parse(data.toString());
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
      if (cmd.action === 'console.start' || cmd.action === 'console.observe' || cmd.action === 'console.stop') {
        const cp = copilot;
        if (!cp) return emit({ type: 'error', message: 'Console Copilot is not enabled on this server.', taskId: cmd.taskId });
        const taskId = cmd.taskId;
        const failed = (err: unknown) => emit({ type: 'error', message: publicError('copilot failed', err), taskId });
        if (cmd.action === 'console.start') Promise.resolve(cp.start(cmd, emit)).catch(failed);
        else if (cmd.action === 'console.observe') Promise.resolve(cp.observe(cmd, emit)).catch(failed);
        else cp.stop(cmd.taskId, emit);
        return;
      }
      if (cmd.action === 'deploy.approve' || cmd.action === 'deploy.reject') {
        const answer = () => {
          if (!approvals.answer(cmd.deployId, cmd.action === 'deploy.approve', cmd.action === 'deploy.approve' ? cmd.confirm : undefined))
            emit({ type: 'deploy.status', deployId: cmd.deployId, status: 'failed', message: 'That request expired or was already answered.' });
        };
        // Every AWS write is approved here: a player who turned MFA off can't approve one. The preview stays
        // pending, so it can still be approved once MFA is back on (or rejected, which needs no step-up).
        if (cmd.action === 'deploy.reject' || !mfaReady) return answer();
        void stepUp().then((ok) => (ok ? answer() : emit({ type: 'error', code: 'mfa_required', message: MFA_REQUIRED_MESSAGE })));
        return;
      }
      if (cmd.action === 'account.link' || cmd.action === 'account.verify') {
        if (Date.now() - lastAccountCommand < ACCOUNT_COOLDOWN_MS) {
          emit({ type: 'error', message: 'Give it a few seconds before trying that again.', requestId: cmd.requestId });
          return;
        }
        lastAccountCommand = Date.now();
        void (async () => {
          if (!(await stepUp())) return emit({ type: 'error', requestId: cmd.requestId, code: 'mfa_required', message: MFA_REQUIRED_MESSAGE });
          if (cmd.action === 'account.link') return tenant.link(cmd.requestId, cmd.region, emit);
          return tenant.verify(cmd.requestId, cmd.roleArn, emit);
        })();
        return;
      }
      if (cmd.action === 'finding.explain' || cmd.action === 'finding.fix' || cmd.action === 'finding.undo') {
        const care = tenant.care();
        if (!care) return emit({ type: 'error', requestId: cmd.requestId, code: 'unlinked', message: 'Connect your AWS account first, so the citizens can look after it.' });
        if (cmd.action === 'finding.undo') return care.undo(cmd.findingId, emit);
        // An explanation is a Bedrock call and a fix may wait minutes for approval: both count as requests on this socket.
        if (requests >= MAX_REQUESTS_PER_SOCKET) return emit({ type: 'error', message: 'Still working on your last request. Try again in a moment.', requestId: cmd.requestId });
        requests++;
        const failed = (err: unknown) => emit({ type: 'error', requestId: cmd.requestId, message: publicError('city care failed', err) });
        const job =
          cmd.action === 'finding.explain'
            ? care.explain(cmd.findingId, emit)
            : stepUp().then((ok) => (ok ? care.fix(cmd.requestId, cmd.findingId, emit, approvals) : emit({ type: 'error', requestId: cmd.requestId, code: 'mfa_required', message: MFA_REQUIRED_MESSAGE })));
        void track(Promise.resolve(job).catch(failed)).finally(() => requests--);
        return;
      }
      if (cmd.action === 'flow.enable') {
        // At most one CloudWatch read every 5 minutes per player (flow.ts), however often this is sent.
        void tenant.flow(cmd.on, emit).catch((err) => emit({ type: 'error', message: publicError('flow failed', err) }));
        return;
      }
      if (cmd.action === 'bill.enable') {
        // At most one Cost Explorer read a day per player (bill.ts), however often this is sent.
        void tenant.bill(cmd.on, emit).catch((err) => emit({ type: 'error', message: publicError('bill failed', err) }));
        return;
      }
      if (cmd.action === 'task.submit') {
        if (tasks >= MAX_TASKS_PER_SOCKET) {
          emit({ type: 'error', message: 'Two tasks are already running. Wait for one to finish.', taskId: cmd.taskId });
          return;
        }
        tasks++;
        void track(tenant.orchestrator().submitTask(cmd, emit, approvals, turns.signal)).finally(() => tasks--);
      } else {
        // Each chat/classify is a Bedrock call: cap them per socket (the daily quota is per player).
        const requestId = cmd.requestId;
        if (requests >= MAX_REQUESTS_PER_SOCKET) {
          emit({ type: 'error', message: 'Still answering your last questions. Try again in a moment.', requestId });
          return;
        }
        requests++;
        const o = tenant.orchestrator();
        const job = cmd.action === 'chat.ask' ? o.ask(cmd, emit) : o.classifyPage(cmd, emit);
        void track(job).finally(() => requests--);
      }
    });
  };

  return {
    server,
    get connections() {
      return sockets.size;
    },
    /** Local single-tenant broadcast (the local poller's feed events). */
    broadcast(events: ServerEvent[]) {
      for (const ws of sockets) for (const e of events) sendTo(ws, e);
    },
    /**
     * Graceful shutdown (SIGTERM on deploy): fail health checks so the load balancer stops sending new
     * connections, tell players, give running turns time to finish, then close so clients reconnect
     * to a healthy task.
     */
    async drain(graceMs = 100_000) {
      draining = true;
      for (const ws of sockets) sendTo(ws, { type: 'agent.message', from: 'concierge', to: 'user', text: 'The city is updating — I’ll reconnect you in a moment.' });
      const until = Date.now() + graceMs;
      // Let running agent turns finish (they may be waiting on the player's approval), up to the grace period.
      while (busy > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 500));
      for (const ws of sockets) ws.close(CLOSE.restarting, 'Server restarting');
      hub.closeAll();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
};
