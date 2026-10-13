import type { AwsClients } from '../aws.js';
import { type Resource, resourceKey, type WorldSnapshot } from '../state/model.js';
import type { Poller } from '../state/poller.js';
import { type Action, DESTRUCTIVE, parseAction, READ_ONLY } from './actions.js';
import { type ExecutionResult, executeAction } from './executor.js';
import { checkAction, describeAction } from './policy.js';
import { memoryLocks } from '../store/local.js';
import type { AccountLocks } from '../store/types.js';
import { log } from '../log.js';

export type SubmitOutcome =
  | { status: 'done'; result: ExecutionResult }
  | { status: 'failed'; result: ExecutionResult }
  | { status: 'denied'; reason: string }
  | { status: 'invalid'; error: string };

/**
 * Every AWS write needs the player's OK (contract v2 deploy.preview → deploy.approve). Without an approval
 * channel, writes are refused rather than run unattended; only reads run.
 */
export const NEEDS_APPROVAL_REASON =
  "Changing AWS needs the player's approval, and there's no Approve button on this connection. Ask the player to do it in the AWS Console instead.";
export const REJECTED_REASON = 'The player said no, so nothing was changed.';

export interface ApprovalRequest {
  action: Action;
  summary: string;
  destructive: boolean;
}
/** Asks the player (contract v2 deploy.preview); resolves true only on an explicit deploy.approve. */
export type Approve = (req: ApprovalRequest) => Promise<boolean>;

/**
 * The one path from "an agent wants to do X" to AWS: parse → policy → execute → re-poll.
 * Writes are serialised, and resources just created are counted before the (eventually consistent)
 * AWS listings show them, so parallel requests can't all slip under the same limit.
 */
export const createActionService = (deps: {
  clients: AwsClients;
  poller: Poller;
  region: string;
  /** Per-AWS-account lock + just-created list; in-process by default, DynamoDB when hosted. */
  locks?: AccountLocks;
  /** Which AWS account these writes go to (the lock key). */
  accountKey?: () => string;
}) => {
  const locks = deps.locks ?? memoryLocks();
  const accountKey = deps.accountKey ?? (() => deps.poller.current()?.accountId ?? 'local');
  const serialised = <T>(fn: (lease: AbortSignal) => Promise<T>): Promise<T> => locks.withLock(accountKey(), fn);

  const withJustCreated = async (snapshot: WorldSnapshot): Promise<WorldSnapshot> => {
    const seen = new Set(snapshot.resources.map(resourceKey));
    const extra = (await locks.pending(accountKey())).filter((r) => !seen.has(resourceKey(r)));
    return extra.length ? { ...snapshot, resources: [...snapshot.resources, ...extra] } : snapshot;
  };

  const remember = async (action: Action, result: ExecutionResult) => {
    const kind = action.type === 'launch_instance' ? 'instance' : action.type === 'create_table' ? 'table' : action.type === 'create_bucket' ? 'bucket' : null;
    if (!kind || !result.ok || !result.resourceId) return;
    const service = kind === 'instance' ? 'ec2' : kind === 'table' ? 'dynamodb' : 's3';
    const resource: Resource = { id: result.resourceId, service, kind, name: result.resourceId, state: 'pending', managedByGame: true, meta: {} };
    await locks.remember(accountKey(), resource, 60_000);
  };

  const run = (action: Action, confirmed: boolean) =>
    serialised(async (lease): Promise<SubmitOutcome> => {
      const snapshot = await withJustCreated(deps.poller.current() ?? (await deps.poller.refresh()));
      const decision = checkAction(action, snapshot, { confirmed });
      if (decision.verdict === 'deny') return { status: 'denied', reason: decision.reason };
      if (decision.verdict === 'confirm') return { status: 'denied', reason: NEEDS_APPROVAL_REASON };

      const result = await executeAction(action, deps.clients, snapshot, deps.region, lease);
      await remember(action, result);
      if (result.ok && !READ_ONLY.has(action.type)) {
        const refresh = () => void deps.poller.refresh().catch((err) => log.warn('refresh after write failed', { err: (err as Error).name })); // the next scheduled poll retries
        refresh();
        // State transitions (pending → running, CREATING → ACTIVE) take a few seconds; look again soon.
        setTimeout(refresh, 4_000).unref();
      }
      return { status: result.ok ? 'done' : 'failed', result };
    });

  return {
    /**
     * Validates untrusted input (a model's tool call) and runs it through policy.
     * Every write is shown to the player first (no `approve` means no writes); policy is checked before asking
     * (don't ask about things that would be denied) and again inside the write lock after approval.
     */
    async submit(name: unknown, input: unknown, opts: { approve?: Approve } = {}): Promise<SubmitOutcome> {
      const parsed = parseAction(name, input);
      if (!parsed.ok) return { status: 'invalid', error: parsed.error };
      const action = parsed.action;
      if (READ_ONLY.has(action.type)) return run(action, false);
      if (!opts.approve) return { status: 'denied', reason: NEEDS_APPROVAL_REASON };
      const snapshot = await withJustCreated(deps.poller.current() ?? (await deps.poller.refresh()));
      const pre = checkAction(action, snapshot, { confirmed: true });
      if (pre.verdict === 'deny') return { status: 'denied', reason: pre.reason };
      const ok = await opts.approve({ action, summary: describeAction(action), destructive: DESTRUCTIVE.has(action.type) });
      if (!ok) return { status: 'denied', reason: REJECTED_REASON };
      return run(action, true);
    },
    describe: (name: unknown, input: unknown) => {
      const parsed = parseAction(name, input);
      return parsed.ok ? describeAction(parsed.action) : `Invalid ${String(name)}`;
    },
  };
};

export type ActionService = ReturnType<typeof createActionService>;
