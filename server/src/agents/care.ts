import citizensJson from '../../../shared/citizens.json' with { type: 'json' };
import { classifyAwsError, type AwsClients } from '../aws.js';
import type { Approvals } from '../contract/approvals.js';
import { log } from '../log.js';
import { enrich, inventoryEvent, readGeo, readInventory } from '../state/inventory.js';
import { forgetSetting } from '../state/poller.js';
import type { WorldSnapshot } from '../state/model.js';
import { LockLostError } from '../store/types.js';
import type { CityFinding, CityInventoryEvent, Progress, ServerEvent } from '../world.js';
import { diffFindings, findingsFor } from './findings.js';
import { FIXES, PartialFix, type FixContext } from './fixes.js';
import { escapeTags, type AgentRunner } from './runner.js';

type Emit = (e: ServerEvent) => void;

/** XP a citizen needs for each level (shared/citizens.json): 2 fixes the city's own resources, 3 anything. */
const LEVEL_XP = citizensJson.levels.map((l) => l.xp);
export const citizenLevel = (xp: number) => LEVEL_XP.filter((need) => xp >= need).length;
export const LEVEL_FOR_SCOPE = { game: 2, account: 3 } as const;

/** Which cached setting a fix changes, so the next poll reads it fresh. */
const SETTING_KEY: Record<string, (f: CityFinding) => string | undefined> = {
  s3_block_public_access: (f) => `bpa:${f.resource.id}`,
  dynamodb_enable_pitr: (f) => `pitr:${f.resource.id}`,
  ebs_default_encryption: () => 'ebs-default',
};

const say = (emit: Emit, from: string, text: string) => emit({ type: 'agent.message', from, to: 'user', text });

/**
 * City care (contract v2.3): the citizens' findings, the account mirror and the approved fixes for one linked world.
 * Findings come from deterministic rules on every poll (no model calls); the model only explains, on request.
 */
export const createCityCare = (deps: {
  clients: AwsClients;
  region: string;
  accountId: string;
  runner: AgentRunner;
  /** Writes to this account are serialised with the other agents' writes. */
  withLock: <T>(fn: (lease?: AbortSignal) => Promise<T>) => Promise<T>;
  refresh: () => Promise<unknown>;
  progress: () => Promise<Progress | null>;
  /** The poller's latest snapshot (for AZs and data links on the inventory). */
  snapshot?: () => WorldSnapshot | null;
  /** The player role was installed with AllowFixes=true (hosted), or fixes are allowed locally. */
  fixesEnabled: boolean;
}) => {
  let open = new Map<string, CityFinding>();
  let inventory: CityInventoryEvent | undefined;
  const ctx: FixContext = { accountId: deps.accountId };
  /** One fix per finding at a time, across every socket of this player (no duplicate approval cards). */
  const fixing = new Set<string>();
  /** Explanations are per finding and its inputs don't change: one model turn each, then reused. */
  const explained = new Map<string, string>();

  const resolve = (f: CityFinding): CityFinding => {
    open.delete(f.id);
    explained.delete(f.id);
    return { ...f, status: 'resolved' };
  };

  /** A resource the city didn't build, or an account-wide setting: the player types this to approve (ids are unique; names aren't). */
  const confirmFor = (f: CityFinding) => (f.fix?.scope !== 'account' ? undefined : f.resource.arn ?? (f.resource.id.includes(':') ? f.resource.name : f.resource.id));

  const fixOne = async (requestId: string, f: CityFinding, fix: NonNullable<CityFinding['fix']> & { def: (typeof FIXES)[string] }, emit: Emit, approvals: Approvals) => {
    const { def } = fix;
    const fresh = async (): Promise<'open' | 'fixed' | 'error'> => {
      try {
        return (await def.stillOpen(deps.clients, f, ctx)) ? 'open' : 'fixed';
      } catch (err) {
        log.warn('fix check failed', { fix: fix.fixId, err: (err as Error).name });
        say(emit, f.citizenId, classifyAwsError(err) === 'denied' ? "I'm not allowed to check that resource, so I won't change it." : "I couldn't check it just now, so nothing was changed. Try again in a minute.");
        return 'error';
      }
    };
    emit({ type: 'agent.state', agentId: f.citizenId, state: 'working', service: f.serviceId, detail: `Checking ${f.resource.name}` });
    let state: Awaited<ReturnType<typeof fresh>>;
    let detail: string[] = [];
    let approvedIds: string[] | undefined;
    try {
      state = await fresh();
      if (state === 'open' && def.plan) {
        const plan = await def.plan(deps.clients, f, ctx);
        if (!plan.ok) return say(emit, f.citizenId, plan.reason);
        detail = plan.detail;
        approvedIds = plan.ids;
      }
    } catch (err) {
      log.warn('fix plan failed', { fix: fix.fixId, err: (err as Error).name });
      return say(emit, f.citizenId, "I couldn't check it just now, so nothing was changed. Try again in a minute.");
    } finally {
      emit({ type: 'agent.state', agentId: f.citizenId, state: 'idle' });
    }
    if (state === 'error') return;
    if (state === 'fixed') {
      emit({ type: 'city.finding', finding: resolve(f) });
      return say(emit, f.citizenId, `${f.resource.name} is already fixed. Nothing to change.`);
    }

    const { deployId, approved } = approvals.requestFix(requestId, { ...f, fix }, emit, confirmFor(f), detail);
    if (!(await approved)) return;
    try {
      // The approval may have waited minutes: check again inside the account lock, right before the change.
      const message = await deps.withLock(async (lease) => {
        if (!open.has(f.id)) return undefined;
        if ((await def.stillOpen(deps.clients, f, ctx)) === false) return null;
        // The lock may have been lost while that was read (another task could be changing the account now).
        lease?.throwIfAborted();
        emit({ type: 'agent.state', agentId: f.citizenId, state: 'working', service: f.serviceId, detail: def.iamAction });
        try {
          return await def.apply(deps.clients, f, { ...ctx, lease }, approvedIds);
        } finally {
          emit({ type: 'agent.state', agentId: f.citizenId, state: 'idle' });
        }
      });
      if (message === undefined) return emit({ type: 'deploy.status', deployId, status: 'complete', message: 'Already sorted, so nothing was changed.' });
      if (message === null) {
        emit({ type: 'deploy.status', deployId, status: 'complete', message: `${f.resource.name} was already fixed, so nothing was changed.` });
        emit({ type: 'city.finding', finding: resolve(f) });
        return;
      }
      const key = SETTING_KEY[fix.fixId]?.(f);
      if (key) forgetSetting(deps.clients, key);
      emit({ type: 'deploy.status', deployId, status: 'complete', message });
      emit({ type: 'city.finding', finding: resolve(f) });
      say(emit, f.citizenId, `${message} Thanks for the help! ${fix.rollback}`);
      void deps.refresh().catch((err) => log.warn('refresh after fix failed', { err: (err as Error).name })); // the next poll retries
    } catch (err) {
      if (err instanceof PartialFix) {
        emit({ type: 'deploy.status', deployId, status: 'complete', message: err.message });
        say(emit, f.citizenId, err.message);
        void deps.refresh().catch((err) => log.warn('refresh after fix failed', { err: (err as Error).name })); // the next poll retries
        return;
      }
      if (err instanceof LockLostError) return emit({ type: 'deploy.status', deployId, status: 'failed', message: err.message });
      log.warn('fix failed', { fix: fix.fixId, err: (err as Error).name });
      const denied = classifyAwsError(err) === 'denied';
      emit({ type: 'deploy.status', deployId, status: 'failed', message: denied ? 'AWS said no. To let the citizens make fixes, update your AWSCity stack in CloudFormation and set AllowFixes to true.' : 'The change didn’t go through. Nothing else was touched.' });
    }
  };

  return {
    /** Re-check after a poll: the findings that opened or resolved. */
    update(snapshot: WorldSnapshot): ServerEvent[] {
      const next = findingsFor(snapshot);
      // A finding being fixed right now stays as it is: a poll that started before the fix mustn't re-raise it.
      const nextMap = new Map(next.map((f) => [f.id, f]));
      for (const id of fixing) if (open.has(id) && !nextMap.has(id)) nextMap.set(id, open.get(id)!);
      const changes = diffFindings(open, [...nextMap.values()]);
      open = nextMap;
      for (const id of explained.keys()) if (!open.has(id)) explained.delete(id);
      return changes.map((finding) => ({ type: 'city.finding', finding }));
    },
    /** Sent to a socket on connect: the mirror and every open finding. */
    welcome(): ServerEvent[] {
      return [...(inventory ? [inventory] : []), ...[...open.values()].map((finding) => ({ type: 'city.finding' as const, finding }))];
    },
    /** Read the account's resource list; returns the event when the counts changed. */
    async refreshInventory(): Promise<CityInventoryEvent | undefined> {
      const inv = await readInventory(deps.clients, deps.region);
      if (!inv) return undefined;
      const { items, links } = enrich(inv, deps.snapshot?.() ?? undefined, deps.region);
      // v2.5: the real AZ map and Region opt-ins (cached a day; a Region that can't be read is left out).
      const geo = await readGeo(deps.clients, deps.region, items);
      const event = inventoryEvent({ ...inv, items }, deps.region, undefined, links, geo);
      const sig = (e?: CityInventoryEvent) => JSON.stringify([e?.counts, e?.regions, e?.links?.map((l) => l.id), e?.source, e?.zones, e?.regionStatus]);
      const changed = sig(event) !== sig(inventory);
      inventory = event;
      return changed ? event : undefined;
    },

    /** The finding's citizen explains it (one metered model turn, read-only tools). */
    async explain(findingId: string, emit: Emit) {
      const f = open.get(findingId);
      if (!f) return say(emit, 'concierge', 'That one is already sorted.');
      const cached = explained.get(f.id);
      if (cached) return say(emit, f.citizenId, cached);
      emit({ type: 'agent.state', agentId: f.citizenId, state: 'working', service: 'bedrock', detail: 'Explaining a finding' });
      try {
        const finding = escapeTags(JSON.stringify({ title: f.title, text: f.text, why: f.why, resource: f.resource.name, service: f.serviceId, pillar: f.pillar, severity: f.severity, fix: f.fix?.preview, docs: f.url }));
        const result = await deps.runner.turn(f.citizenId, `<finding>${finding}</finding>\nExplain this finding to the player. Add something the card doesn't already say: what happens if they leave it, and what to do.`);
        const reply = result.reply || f.why || f.text;
        // Cache only a real answer (not a refusal or a turn cut short by its step or token budget).
        if (result.reply && !result.refused && !result.limited) explained.set(f.id, reply);
        say(emit, f.citizenId, reply);
      } finally {
        emit({ type: 'agent.state', agentId: f.citizenId, state: 'idle' });
      }
    },

    /** Fix a finding: re-read it, show the change, wait for the player's OK (and typed name), then change AWS. */
    async fix(requestId: string, findingId: string, emit: Emit, approvals: Approvals) {
      const f = open.get(findingId);
      if (!f) return say(emit, 'concierge', 'That one is already sorted.');
      const def = f.fix && FIXES[f.fix.fixId];
      if (!f.fix || !def) return say(emit, f.citizenId, `There's no automatic fix for this one. ${f.text} The docs page shows how to fix it yourself.`);
      if (!deps.fixesEnabled) {
        return say(emit, f.citizenId, 'Fixes are switched off for this account. To let the citizens fix things, update your AWSCity stack and set AllowFixes to true. You still approve every fix.');
      }
      const xp = (await deps.progress())?.citizens?.[f.citizenId]?.xp ?? 0;
      const need = LEVEL_FOR_SCOPE[f.fix.scope];
      if (citizenLevel(xp) < need) {
        return say(
          emit,
          f.citizenId,
          need === 2
            ? `Teach me a bit more first: review flashcards in my districts or pass a puzzle, and I can fix things the city built.`
            : `This is outside what the city built, so I need to be a Caretaker first (level 3). Keep teaching me with flashcards and puzzles.`,
        );
      }
      if (fixing.has(f.id)) return say(emit, f.citizenId, 'I’m already on this one. Check the open approval card.');
      fixing.add(f.id);
      try {
        await fixOne(requestId, f, { ...f.fix, def }, emit, approvals);
      } finally {
        fixing.delete(f.id);
      }
    },

    /** Fixes only tighten things, so undoing one is the player's call, in the console. */
    undo(findingId: string, emit: Emit) {
      const rule = [...open.values()].find((f) => f.id === findingId);
      say(emit, rule?.citizenId ?? 'concierge', rule?.fix?.rollback ?? 'Fixes only tighten settings, so you undo one yourself in the AWS console. The finding card says where.');
    },
    open: () => [...open.values()],
  };
};

export type CityCare = ReturnType<typeof createCityCare>;
