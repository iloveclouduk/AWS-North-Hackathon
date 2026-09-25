import { randomUUID } from 'node:crypto';
import type { ActionName } from '../agents/actions.js';
import type { ToolCallReport } from '../agents/runner.js';
import type { ApprovalRequest } from '../agents/service.js';
import type { DeployChange, ServerEvent } from '../world.js';

type Emit = (e: ServerEvent) => void;

const RESOURCE_TYPE: Record<ActionName, string> = {
  launch_instance: 'AWS::EC2::Instance',
  stop_instance: 'AWS::EC2::Instance',
  start_instance: 'AWS::EC2::Instance',
  terminate_instance: 'AWS::EC2::Instance',
  create_table: 'AWS::DynamoDB::Table',
  delete_table: 'AWS::DynamoDB::Table',
  create_bucket: 'AWS::S3::Bucket',
  delete_bucket: 'AWS::S3::Bucket',
  describe_resource: 'N/A',
};

const COST: Partial<Record<ActionName, string>> = {
  launch_instance: 'Billed per second while running (t4g.nano/micro are the smallest Graviton sizes).',
  create_table: 'On-demand: pay per request, ~$0 when idle.',
  create_bucket: 'Pay per GB stored and per request; an empty bucket costs nothing.',
  terminate_instance: 'Stops all charges for this instance. Permanent.',
  delete_table: 'Deletes the table and every item in it. Permanent.',
  delete_bucket: 'Deletes the (empty) bucket. Permanent.',
};

const labelOf = (a: ApprovalRequest['action']): string =>
  'name' in a ? String(a.name) : 'instanceId' in a ? String(a.instanceId) : 'suffix' in a ? `aws-city-…-${String(a.suffix)}` : a.type;

/**
 * Per-socket player approvals (contract v2): a guarded write becomes deploy.preview; the player answers
 * with deploy.approve / deploy.reject. Unanswered requests expire; closing the socket rejects them all.
 */
export const createApprovals = (opts: { region: string; timeoutMs?: number }) => {
  const pending = new Map<string, { resolve: (ok: boolean) => void; emit: Emit; timer: NodeJS.Timeout }>();
  const awaitingResult = new Map<string, string>(); // taskId → deployId of the approved call in flight

  const settle = (deployId: string, ok: boolean, reason?: string) => {
    const p = pending.get(deployId);
    if (!p) return false;
    pending.delete(deployId);
    clearTimeout(p.timer);
    if (!ok) p.emit({ type: 'deploy.status', deployId, status: 'rejected', message: reason ?? 'Nothing was changed.' });
    p.resolve(ok);
    return true;
  };

  return {
    request(taskId: string, req: ApprovalRequest, emit: Emit): Promise<boolean> {
      const deployId = `a-${randomUUID().slice(0, 8)}`;
      const t = req.action.type;
      const change: DeployChange = {
        action: req.destructive ? 'Remove' : t === 'stop_instance' || t === 'start_instance' ? 'Modify' : 'Add',
        logicalId: labelOf(req.action),
        resourceType: RESOURCE_TYPE[t],
      };
      emit({ type: 'deploy.preview', deployId, taskId, templateId: t, stackName: req.summary, region: opts.region, changes: [change], costNote: COST[t] });
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => settle(deployId, false, 'No answer within 5 minutes, so nothing was changed.'), opts.timeoutMs ?? 300_000);
        timer.unref?.();
        pending.set(deployId, { resolve: (ok) => (ok && awaitingResult.set(taskId, deployId), resolve(ok)), emit, timer });
      });
    },
    /** From the client: returns false if the id is unknown/expired. */
    answer(deployId: string, ok: boolean): boolean {
      const p = pending.get(deployId);
      if (p && ok) p.emit({ type: 'deploy.status', deployId, status: 'creating' });
      return settle(deployId, ok);
    },
    /** After the approved tool call ran: report the real outcome on the same deployId. */
    reportResult(taskId: string, call: ToolCallReport, emit: Emit) {
      const deployId = awaitingResult.get(taskId);
      if (!deployId) return;
      awaitingResult.delete(taskId);
      const ok = call.outcome === 'done';
      emit({ type: 'deploy.status', deployId, status: ok ? 'complete' : 'failed', message: call.message, outputs: ok ? { Result: call.message } : undefined });
    },
    cancelAll() {
      for (const id of [...pending.keys()]) settle(id, false, 'Connection closed, so nothing was changed.');
    },
    get size() {
      return pending.size;
    },
  };
};

export type Approvals = ReturnType<typeof createApprovals>;
