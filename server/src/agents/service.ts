import type { AwsClients } from '../aws.js';
import { type Resource, resourceKey, type WorldSnapshot } from '../state/model.js';
import type { Poller } from '../state/poller.js';
import { type Action, parseAction, READ_ONLY } from './actions.js';
import { type ExecutionResult, executeAction } from './executor.js';
import { checkAction, describeAction } from './policy.js';

export type SubmitOutcome =
  | { status: 'done'; result: ExecutionResult }
  | { status: 'failed'; result: ExecutionResult }
  | { status: 'denied'; reason: string }
  | { status: 'invalid'; error: string };

/**
 * The frontend contract has no approval event, so actions that need the player's OK
 * (terminate/delete) are refused rather than run unattended.
 */
export const NEEDS_APPROVAL_REASON =
  "Demolishing needs the player's approval, and the city has no Approve button yet. Ask the player to do it in the AWS Console instead.";

/**
 * The one path from "an agent wants to do X" to AWS: parse → policy → execute → re-poll.
 * Writes are serialised, and resources just created are counted before the (eventually consistent)
 * AWS listings show them, so parallel requests can't all slip under the same limit.
 */
export const createActionService = (deps: { clients: AwsClients; poller: Poller; region: string }) => {
  let lock: Promise<unknown> = Promise.resolve();
  const serialised = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = lock.then(fn, fn);
    lock = next.catch(() => undefined);
    return next;
  };
  const justCreated = new Map<string, { resource: Resource; until: number }>();

  const withJustCreated = (snapshot: WorldSnapshot): WorldSnapshot => {
    const now = Date.now();
    const seen = new Set(snapshot.resources.map(resourceKey));
    for (const [key, entry] of justCreated) if (seen.has(key) || entry.until < now) justCreated.delete(key);
    return justCreated.size ? { ...snapshot, resources: [...snapshot.resources, ...[...justCreated.values()].map((e) => e.resource)] } : snapshot;
  };

  const remember = (action: Action, result: ExecutionResult) => {
    const kind = action.type === 'launch_instance' ? 'instance' : action.type === 'create_table' ? 'table' : action.type === 'create_bucket' ? 'bucket' : null;
    if (!kind || !result.ok || !result.resourceId) return;
    const service = kind === 'instance' ? 'ec2' : kind === 'table' ? 'dynamodb' : 's3';
    const resource: Resource = { id: result.resourceId, service, kind, name: result.resourceId, state: 'pending', managedByGame: true, meta: {} };
    justCreated.set(resourceKey(resource), { resource, until: Date.now() + 60_000 });
  };

  const run = (action: Action) =>
    serialised(async (): Promise<SubmitOutcome> => {
      const snapshot = withJustCreated(deps.poller.current() ?? (await deps.poller.refresh()));
      const decision = checkAction(action, snapshot, { confirmed: false });
      if (decision.verdict === 'deny') return { status: 'denied', reason: decision.reason };
      if (decision.verdict === 'confirm') return { status: 'denied', reason: NEEDS_APPROVAL_REASON };

      const result = await executeAction(action, deps.clients, snapshot, deps.region);
      remember(action, result);
      if (result.ok && !READ_ONLY.has(action.type)) {
        void deps.poller.refresh();
        // State transitions (pending → running, CREATING → ACTIVE) take a few seconds; look again soon.
        setTimeout(() => void deps.poller.refresh(), 4_000).unref();
      }
      return { status: result.ok ? 'done' : 'failed', result };
    });

  return {
    /** Validates untrusted input (a model's tool call) and runs it through policy. */
    submit(name: unknown, input: unknown): Promise<SubmitOutcome> {
      const parsed = parseAction(name, input);
      if (!parsed.ok) return Promise.resolve({ status: 'invalid', error: parsed.error });
      return run(parsed.action);
    },
    describe: (name: unknown, input: unknown) => {
      const parsed = parseAction(name, input);
      return parsed.ok ? describeAction(parsed.action) : `Invalid ${String(name)}`;
    },
  };
};

export type ActionService = ReturnType<typeof createActionService>;
