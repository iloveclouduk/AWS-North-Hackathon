import { randomUUID } from 'node:crypto';
import type { ActionName } from '../agents/actions.js';
import type { ToolCallReport } from '../agents/runner.js';
import type { ApprovalRequest } from '../agents/service.js';
import type { CityFinding, DeployChange, ServerEvent } from '../world.js';

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
  review_architecture: 'N/A',
};

const COST: Partial<Record<ActionName, string>> = {
  launch_instance: 'Billed per second while running (t4g.nano/micro are the smallest Graviton sizes).',
  create_table: 'On-demand: pay per request, ~$0 when idle.',
  create_bucket: 'Pay per GB stored and per request; an empty bucket costs nothing.',
  terminate_instance: 'Stops all charges for this instance. Permanent.',
  delete_table: 'Deletes the table and every item in it. Permanent.',
  delete_bucket: 'Deletes the (empty) bucket. Permanent.',
};

/** What a fix changes, by the finding's service. */
const FIX_RESOURCE_TYPE: Record<string, string> = {
  s3: 'AWS::S3::Bucket',
  vpc: 'AWS::EC2::SecurityGroup',
  ec2: 'AWS::EC2::Instance',
  ebs: 'EBS encryption by default',
  dynamodb: 'AWS::DynamoDB::Table',
};

const labelOf = (a: ApprovalRequest['action']): string =>
  'name' in a ? String(a.name) : 'instanceId' in a ? String(a.instanceId) : 'suffix' in a ? `aws-city-…-${String(a.suffix)}` : a.type;

/**
 * Per-socket player approvals (contract v2): a guarded write becomes deploy.preview; the player answers
 * with deploy.approve / deploy.reject. Unanswered requests expire; closing the socket rejects them all.
 */
export const createApprovals = (opts: { region: string; timeoutMs?: number }) => {
  const pending = new Map<string, { resolve: (ok: boolean) => void; emit: Emit; timer: NodeJS.Timeout; confirmText?: string }>();
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
    /**
     * A citizen's fix (contract v2.3): the preview carries the finding, its rollback text and, for a resource the city
     * didn't build or an account-wide setting, the text the player must type. Resolves true only on approve + match.
     */
    requestFix(requestId: string, f: CityFinding & { fix: NonNullable<CityFinding['fix']> }, emit: Emit, confirmText?: string, detail: string[] = []) {
      const deployId = `f-${randomUUID().slice(0, 8)}`;
      emit({
        type: 'deploy.preview',
        requestId,
        deployId,
        templateId: f.fix.fixId,
        stackName: f.fix.title,
        region: opts.region,
        // Names aren't unique (every VPC has a "default" group): the id says exactly which resource changes.
        changes: [
          { action: 'Modify', logicalId: f.resource.id === f.resource.name || f.resource.id.includes(':') ? f.resource.name : `${f.resource.name} (${f.resource.id})`, resourceType: FIX_RESOURCE_TYPE[f.serviceId] ?? 'AWS account setting' },
          ...detail.map((d) => ({ action: 'Modify' as const, logicalId: d, resourceType: 'detail' })),
        ],
        costNote: f.fix.costNote,
        findingId: f.id,
        rollback: f.fix.rollback,
        ...(confirmText ? { confirmText } : {}),
      });
      const approved = new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => settle(deployId, false, 'No answer within 5 minutes, so nothing was changed.'), opts.timeoutMs ?? 300_000);
        timer.unref?.();
        pending.set(deployId, { resolve, emit, timer, confirmText });
      });
      return { deployId, approved };
    },
    /** From the client: returns false if the id is unknown/expired. `confirm` must match a fix's confirmText. */
    answer(deployId: string, ok: boolean, confirm?: string): boolean {
      const p = pending.get(deployId);
      if (p && ok && p.confirmText && confirm?.trim() !== p.confirmText) return settle(deployId, false, 'The name you typed didn’t match, so nothing was changed.');
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
