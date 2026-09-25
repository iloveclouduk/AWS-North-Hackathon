import { bucketPrefix, type Resource, type WorldSnapshot } from '../state/model.js';
import { type Action, DESTRUCTIVE } from './actions.js';

export const LIMITS = { instances: 3, tables: 5, buckets: 3 } as const;

export type PolicyDecision =
  | { verdict: 'allow' }
  | { verdict: 'deny'; reason: string }
  | { verdict: 'confirm'; summary: string };

const LIVE_INSTANCE_STATES = new Set(['pending', 'running', 'stopping', 'stopped']);

const find = (snapshot: WorldSnapshot, kind: Resource['kind'], id: string) =>
  snapshot.resources.find((r) => r.kind === kind && r.id === id);

const requireGameOwned = (r: Resource | undefined, label: string, id: string): PolicyDecision | null => {
  if (!r) return { verdict: 'deny', reason: `There is no ${label} "${id}" in the city right now.` };
  if (!r.managedByGame) {
    return { verdict: 'deny', reason: `"${r.name}" wasn't built by the game, so players and agents can look at it but not change it.` };
  }
  return null;
};

/**
 * Guardrails for every write. Rules:
 *  - only resources the game created (tagged / name-prefixed) can be changed
 *  - count limits keep the workshop account small and cheap
 *  - destructive actions need explicit player approval (`confirmed`)
 */
export const checkAction = (action: Action, snapshot: WorldSnapshot, opts: { confirmed: boolean }): PolicyDecision => {
  const count = (pred: (r: Resource) => boolean) => snapshot.resources.filter(pred).length;

  if (snapshot.credentials === 'expired') {
    return { verdict: 'deny', reason: 'AWS credentials have expired. Refresh the workshop keys first.' };
  }

  switch (action.type) {
    case 'describe_resource':
      return { verdict: 'allow' };

    case 'launch_instance': {
      const live = count((r) => r.kind === 'instance' && r.managedByGame && LIVE_INSTANCE_STATES.has(r.state));
      if (live >= LIMITS.instances) {
        return { verdict: 'deny', reason: `The city already has ${live} game-built houses (limit ${LIMITS.instances}). Stop or demolish one first.` };
      }
      break;
    }

    case 'stop_instance':
    case 'start_instance':
    case 'terminate_instance': {
      const r = find(snapshot, 'instance', action.instanceId);
      const denied = requireGameOwned(r, 'house (EC2 instance)', action.instanceId);
      if (denied) return denied;
      if (r!.state === 'terminated' || r!.state === 'shutting-down') return { verdict: 'deny', reason: `"${r!.name}" is already being demolished.` };
      break;
    }

    case 'create_table': {
      if (find(snapshot, 'table', action.name)) return { verdict: 'deny', reason: `A library called "${action.name}" already exists.` };
      const tables = count((r) => r.kind === 'table' && r.managedByGame);
      if (tables >= LIMITS.tables) return { verdict: 'deny', reason: `Library limit reached (${LIMITS.tables}).` };
      break;
    }

    case 'delete_table': {
      const denied = requireGameOwned(find(snapshot, 'table', action.name), 'library (DynamoDB table)', action.name);
      if (denied) return denied;
      break;
    }

    case 'create_bucket': {
      const buckets = count((r) => r.kind === 'bucket' && r.managedByGame);
      if (buckets >= LIMITS.buckets) return { verdict: 'deny', reason: `Warehouse limit reached (${LIMITS.buckets}).` };
      if (find(snapshot, 'bucket', bucketPrefix(snapshot.accountId) + action.suffix)) {
        return { verdict: 'deny', reason: 'That warehouse already exists.' };
      }
      break;
    }

    case 'delete_bucket': {
      if (!action.name.startsWith(bucketPrefix(snapshot.accountId))) {
        return { verdict: 'deny', reason: `"${action.name}" isn't one of this city's warehouses.` };
      }
      const denied = requireGameOwned(find(snapshot, 'bucket', action.name), 'warehouse (S3 bucket)', action.name);
      if (denied) return denied;
      break;
    }
  }

  if (DESTRUCTIVE.has(action.type) && !opts.confirmed) return { verdict: 'confirm', summary: describeAction(action) };
  return { verdict: 'allow' };
};

export const describeAction = (action: Action): string => {
  switch (action.type) {
    case 'launch_instance':
      return `Launch a ${action.instanceType} EC2 instance named "${action.name}"`;
    case 'stop_instance':
      return `Stop EC2 instance ${action.instanceId}`;
    case 'start_instance':
      return `Start EC2 instance ${action.instanceId}`;
    case 'terminate_instance':
      return `Permanently terminate EC2 instance ${action.instanceId}`;
    case 'create_table':
      return `Create DynamoDB table "${action.name}"`;
    case 'delete_table':
      return `Delete DynamoDB table "${action.name}" and all its items`;
    case 'create_bucket':
      return `Create S3 bucket with suffix "${action.suffix}"`;
    case 'delete_bucket':
      return `Delete S3 bucket "${action.name}"`;
    case 'describe_resource':
      return `Describe ${action.id}`;
  }
};
