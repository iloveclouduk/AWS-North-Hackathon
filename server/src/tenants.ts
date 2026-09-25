import type { AwsCredentialIdentityProvider } from '@smithy/types';
import type { AccountLinker } from './accounts/link.js';
import { LinkError } from './accounts/link.js';
import type { Llm } from './agents/llm.js';
import { metered, withErrorCodes } from './agents/metered.js';
import { createAgentRunner } from './agents/runner.js';
import { type ActionService, createActionService } from './agents/service.js';
import type { Principal } from './auth.js';
import { type AwsClients, clientsFor } from './aws.js';
import type { Config } from './config.js';
import { feedEvents, welcomeEvents } from './contract/aws-feed.js';
import { createConsoleCopilot, type ConsoleCopilot } from './contract/console.js';
import { createOrchestrator, type Orchestrator } from './contract/orchestrator.js';
import type { UploadStore, UploadTarget, ImageType } from './contract/uploads.js';
import { log, who } from './log.js';
import { diffSnapshots } from './state/diff.js';
import { SERVICES, type WorldSnapshot } from './state/model.js';
import { createPoller, type Poller } from './state/poller.js';
import type { AccountRecord, PutResult, Stores } from './store/types.js';
import type { Progress, ServerEvent } from './world.js';

type Emit = (e: ServerEvent) => void;

/**
 * Everything one player's sockets share: their AWS world (poller, agents, orchestrator), their progress
 * and screenshots, and their account link. Per-socket state (approvals, Copilot tasks) stays on the socket.
 */
export interface Tenant {
  readonly sub: string;
  readonly region: string;
  orchestrator(): Orchestrator;
  createCopilot(): ConsoleCopilot | undefined;
  welcome(): Promise<ServerEvent[]>;
  subscribe(emit: Emit): () => void;
  /** Wraps a socket's emit: adds error codes for limit errors. */
  emitter(emit: Emit): Emit;
  snapshot(): Promise<WorldSnapshot | undefined>;
  progress: { get(): Promise<Progress | null>; put(input: unknown): Promise<PutResult> };
  uploads: { create(contentType: ImageType): Promise<UploadTarget> };
  link(requestId: string, region: string, emit: Emit): Promise<void>;
  verify(requestId: string, roleArn: string, emit: Emit): Promise<void>;
  deleteMe(): Promise<void>;
}

export interface TenantHub {
  acquire(p: Principal): Promise<Tenant>;
  release(p: Principal): void;
  /** Stops every poller (graceful shutdown). */
  closeAll(): void;
}

/** A city with no AWS account yet: nothing to see, nothing can be built. */
export const emptyWorld = (region: string): WorldSnapshot => ({
  takenAt: new Date().toISOString(),
  region,
  accountId: 'not-linked',
  credentials: 'ok',
  services: Object.fromEntries(SERVICES.map((s) => [s, 'ok'])) as WorldSnapshot['services'],
  resources: [],
});

export const UNLINKED_REASON = 'Connect your AWS account first (Deploy tab → Connect your AWS), then I can build this for real.';

const unlinkedActions = (): ActionService =>
  ({
    submit: async () => ({ status: 'denied', reason: UNLINKED_REASON }),
    describe: (name: unknown) => `Run ${String(name)}`,
  }) as unknown as ActionService;

interface World {
  poller?: Poller;
  orchestrator: Orchestrator;
  snapshot: () => Promise<WorldSnapshot>;
  linked: boolean;
  region: string;
  accountId?: string;
}

export interface TenantDeps {
  config: Config;
  stores: Stores;
  uploads: UploadStore;
  llm: Llm;
  enabled: () => Promise<boolean>;
  /**
   * The player's AWS access, or undefined if they haven't linked an account. Local mode: always the
   * workshop profile. Hosted: the assumed player role from their account record.
   */
  awsFor: (sub: string, record: AccountRecord | undefined) => { clients: AwsClients; accountId: string; region: string } | undefined;
  linker?: AccountLinker;
  /** Extra per-player cleanup on DELETE /me (e.g. the Cognito user). */
  onDelete?: (sub: string) => Promise<void>;
  evictAfterMs?: number;
  walkMs?: number;
}

export const createTenants = (deps: TenantDeps): TenantHub => {
  const tenants = new Map<string, { tenant: Tenant; refs: number; evict?: NodeJS.Timeout; stop: () => void }>();

  const build = async (p: Principal) => {
    const sub = p.sub;
    const subscribers = new Set<Emit>();
    const broadcast = (events: ServerEvent[]) => {
      for (const emit of subscribers) for (const e of events) emit(e);
    };
    const llm = metered(deps.llm, { sub, quota: deps.stores.quota, daily: deps.config.dailyModelCalls, globalDaily: deps.config.globalDailyModelCalls, enabled: deps.enabled });

    const makeWorld = async (record: AccountRecord | undefined): Promise<World> => {
      const aws = deps.awsFor(sub, record);
      if (!aws) {
        const region = record?.region ?? deps.config.region;
        const snapshot = async () => emptyWorld(region);
        const runner = createAgentRunner({ llm, actions: unlinkedActions(), snapshot });
        return { orchestrator: createOrchestrator({ llm, runner, snapshot, uploads: deps.uploads, owner: sub, walkMs: deps.walkMs }), snapshot, linked: false, region };
      }
      const poller = createPoller({
        clients: aws.clients,
        accountId: aws.accountId,
        region: aws.region,
        intervalMs: deps.config.pollIntervalMs,
        onSnapshot(prev, next) {
          for (const event of diffSnapshots(prev, next)) broadcast(feedEvents(event));
        },
      });
      const snapshot = async () => poller.current() ?? poller.refresh();
      const actions = createActionService({ clients: aws.clients, poller, region: aws.region, locks: deps.stores.locks, accountKey: () => aws.accountId });
      const runner = createAgentRunner({ llm, actions, snapshot });
      await poller.refresh().catch((err) => log.warn('first poll failed', { who: who(sub), err: (err as Error).name }));
      poller.start();
      return { poller, orchestrator: createOrchestrator({ llm, runner, snapshot, uploads: deps.uploads, owner: sub, walkMs: deps.walkMs }), snapshot, linked: true, region: aws.region, accountId: aws.accountId };
    };

    let world = await makeWorld(await deps.stores.accounts.get(sub));

    const accountStatus = (requestId?: string): ServerEvent =>
      world.linked
        ? {
            type: 'account.status',
            requestId,
            linked: true,
            accountId: world.accountId,
            region: world.region,
            message: deps.config.awsMode === 'profile' ? 'Workshop AWS account (local server). Every change needs your approval.' : 'Your AWS account is connected. Every change needs your approval.',
          }
        : { type: 'account.status', requestId, linked: false, region: world.region, message: 'Connect your AWS account to let agents build for real.' };

    const tenant: Tenant = {
      sub,
      get region() {
        return world.region;
      },
      orchestrator: () => world.orchestrator,
      createCopilot: () => createConsoleCopilot({ llm }),
      async welcome() {
        const events: ServerEvent[] = [accountStatus()];
        if (world.linked) events.push(...welcomeEvents(await world.snapshot()));
        return events;
      },
      subscribe(emit) {
        subscribers.add(emit);
        return () => subscribers.delete(emit);
      },
      emitter: (emit) => withErrorCodes(emit),
      snapshot: async () => (world.linked ? world.snapshot() : undefined),
      progress: { get: () => deps.stores.progress.get(sub), put: (input) => deps.stores.progress.put(sub, input) },
      uploads: { create: (contentType) => deps.uploads.create(contentType, sub) },
      async link(requestId, region, emit) {
        if (!deps.linker) return emit(accountStatus(requestId));
        try {
          const { url, externalId } = await deps.linker.link(sub, region);
          emit({ type: 'account.linkUrl', requestId, url, externalId });
        } catch (err) {
          emit({ type: 'error', requestId, message: err instanceof LinkError ? err.message : 'Couldn’t make a setup link. Try again.' });
        }
      },
      async verify(requestId, roleArn, emit) {
        if (!deps.linker) return emit(accountStatus(requestId));
        try {
          const record = await deps.linker.verify(sub, roleArn);
          world.poller?.stop();
          world = await makeWorld(record);
          log.info('account linked', { who: who(sub), region: record.region });
          // Every open tab of this player sees the account arrive (the asking socket is a subscriber too).
          broadcast([accountStatus(requestId), ...welcomeEvents(await world.snapshot())]);
          if (subscribers.size === 0) emit(accountStatus(requestId));
        } catch (err) {
          log.warn('account verify failed', { who: who(sub) });
          emit({ type: 'account.status', requestId, linked: false, message: err instanceof LinkError ? err.message : 'Couldn’t check that account. Try again.' });
        }
      },
      async deleteMe() {
        world.poller?.stop();
        await deps.stores.deleteUser(sub);
        await deps.onDelete?.(sub);
        world = await makeWorld(undefined);
        log.info('player deleted', { who: who(sub) });
      },
    };
    return { tenant, stop: () => world.poller?.stop() };
  };

  const pending = new Map<string, Promise<void>>();

  return {
    async acquire(p) {
      // Two sockets of the same player connecting at once share one tenant.
      while (pending.has(p.sub)) await pending.get(p.sub);
      let entry = tenants.get(p.sub);
      if (!entry) {
        const creating = build(p).then((built) => {
          tenants.set(p.sub, { ...built, refs: 0 });
        });
        pending.set(p.sub, creating.catch(() => undefined));
        try {
          await creating;
        } finally {
          pending.delete(p.sub);
        }
        entry = tenants.get(p.sub)!;
      }
      clearTimeout(entry.evict);
      entry.refs++;
      return entry.tenant;
    },
    release(p) {
      const entry = tenants.get(p.sub);
      if (!entry) return;
      entry.refs = Math.max(0, entry.refs - 1);
      if (entry.refs > 0) return;
      // Keep a recently used city warm for a while (reconnects, tab switches), then stop its poller.
      entry.evict = setTimeout(() => {
        entry.stop();
        tenants.delete(p.sub);
      }, deps.evictAfterMs ?? 10 * 60_000);
      entry.evict.unref?.();
    },
    closeAll() {
      for (const e of tenants.values()) {
        clearTimeout(e.evict);
        e.stop();
      }
      tenants.clear();
    },
  };
};

/** Credentials helper for hosted mode, kept here so main.ts stays a composition root. */
export const playerAws = (
  record: AccountRecord | undefined,
  sub: string,
  credentialsFor: (o: { roleArn: string; externalId: string; sub: string; region: string }) => AwsCredentialIdentityProvider,
) => {
  if (record?.status !== 'linked' || !record.roleArn || !record.accountId) return undefined;
  const credentials = credentialsFor({ roleArn: record.roleArn, externalId: record.externalId, sub, region: record.region });
  return { clients: clientsFor({ region: record.region, credentials }), accountId: record.accountId, region: record.region };
};
