import { DescribeContinuousBackupsCommand, UpdateContinuousBackupsCommand } from '@aws-sdk/client-dynamodb';
import {
  DescribeInstancesCommand,
  DescribeSecurityGroupRulesCommand,
  EnableEbsEncryptionByDefaultCommand,
  GetEbsEncryptionByDefaultCommand,
  ModifyInstanceMetadataOptionsCommand,
  RevokeSecurityGroupIngressCommand,
  type SecurityGroupRule,
} from '@aws-sdk/client-ec2';
import { GetPublicAccessBlockCommand, PutPublicAccessBlockCommand } from '@aws-sdk/client-s3';
import type { AwsClients } from '../aws.js';
import type { CityFinding } from '../world.js';

/**
 * The citizens' fixes: a fixed allowlist, and every one only tightens a setting (nothing here deletes, terminates or
 * loosens anything; test/fixes.test.ts greps for it). Each fix first re-reads the resource: if the issue is already
 * gone, nothing is sent. The player role grants these actions only with AllowFixes=true (player-role.yaml).
 */
/** Who the calls are for: the account id (S3 calls carry it as ExpectedBucketOwner, since bucket names are global). */
export interface FixContext {
  accountId: string;
  /** apply(): the account lock's lease; checked right before the AWS write (a lost lock stops the fix). */
  lease?: AbortSignal;
}

/** What exactly a fix will change, worked out from a fresh read before the player is asked. */
export type FixPlan = { ok: true; detail: string[]; /** What the player approved (e.g. rule ids): apply changes only these. */ ids?: string[] } | { ok: false; reason: string };

export interface FixDef {
  /** IAM action the change needs (asserted against the player role's aws-city-fix policy). */
  iamAction: string;
  /** Is the issue still there? Read fresh from AWS, never from the last poll. */
  stillOpen(clients: AwsClients, f: CityFinding, ctx: FixContext): Promise<boolean>;
  /** Optional: the exact change (shown on the approval card), or why there's nothing safe to change. */
  plan?(clients: AwsClients, f: CityFinding, ctx: FixContext): Promise<FixPlan>;
  apply(clients: AwsClients, f: CityFinding, ctx: FixContext, approved?: string[]): Promise<string>;
}

const WORLD = new Set(['0.0.0.0/0', '::/0']);
const ADMIN_PORTS = [22, 3389];
/**
 * Ingress rules of the group that open SSH or RDP to anyone (rule ids are what Revoke takes). `exact` rules open just
 * 22 or 3389 and are safe to remove; `broad` ones (all traffic, a wide port range) would close other ports too, such
 * as a web server's 443, so the fix leaves them to the player.
 */
export const worldAdminRules = async (clients: AwsClients, groupId: string): Promise<{ exact: SecurityGroupRule[]; broad: SecurityGroupRule[] }> => {
  const { SecurityGroupRules = [] } = await clients.ec2.send(new DescribeSecurityGroupRulesCommand({ Filters: [{ Name: 'group-id', Values: [groupId] }], MaxResults: 1000 }));
  const open = SecurityGroupRules.filter(
    (r) =>
      !r.IsEgress &&
      WORLD.has(r.CidrIpv4 ?? r.CidrIpv6 ?? '') &&
      (r.IpProtocol === '-1' || (r.IpProtocol === 'tcp' && ADMIN_PORTS.some((p) => (r.FromPort ?? 0) <= p && p <= (r.ToPort ?? 65535)))),
  );
  const isExact = (r: SecurityGroupRule) => r.IpProtocol === 'tcp' && r.FromPort === r.ToPort && ADMIN_PORTS.includes(r.FromPort ?? -1);
  return { exact: open.filter(isExact), broad: open.filter((r) => !isExact(r)) };
};

/** The fix ran but deliberately left something for the player (shown as the result, the finding stays open). */
export class PartialFix extends Error {}

export const FIXES: Record<string, FixDef> = {
  s3_block_public_access: {
    iamAction: 's3:PutBucketPublicAccessBlock',
    async stillOpen({ s3 }, f, ctx) {
      try {
        const c = (await s3.send(new GetPublicAccessBlockCommand({ Bucket: f.resource.id, ExpectedBucketOwner: ctx.accountId }))).PublicAccessBlockConfiguration;
        return !(c?.BlockPublicAcls && c.IgnorePublicAcls && c.BlockPublicPolicy && c.RestrictPublicBuckets);
      } catch (err) {
        if ((err as Error).name === 'NoSuchPublicAccessBlockConfiguration') return true;
        throw err;
      }
    },
    async apply({ s3 }, f, ctx) {
      await s3.send(
        new PutPublicAccessBlockCommand({
          Bucket: f.resource.id,
          ExpectedBucketOwner: ctx.accountId,
          PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true },
        }),
      );
      return `Block Public Access is on for ${f.resource.name}.`;
    },
  },
  sg_revoke_world_admin: {
    iamAction: 'ec2:RevokeSecurityGroupIngress',
    stillOpen: async (clients, f) => {
      const { exact, broad } = await worldAdminRules(clients, f.resource.id);
      return exact.length + broad.length > 0;
    },
    async plan(clients, f) {
      const { exact, broad } = await worldAdminRules(clients, f.resource.id);
      if (!exact.length)
        return {
          ok: false,
          reason: `${f.resource.name}'s open rule also opens other ports (all traffic or a wide range), so removing it could take something else offline. Narrow it yourself in the EC2 console: Security Groups → ${f.resource.id} → Edit inbound rules.`,
        };
      const port = (r: SecurityGroupRule) => (r.FromPort === 3389 ? 'RDP 3389' : 'SSH 22');
      return {
        ok: true,
        ids: exact.map((r) => r.SecurityGroupRuleId!),
        detail: [
          ...exact.map((r) => `Remove ${r.SecurityGroupRuleId}: ${port(r)} from ${r.CidrIpv4 ?? r.CidrIpv6}`),
          ...(broad.length ? [`Leaves ${broad.map((r) => r.SecurityGroupRuleId).join(', ')} alone (opens more than SSH/RDP)`] : []),
        ],
      };
    },
    async apply(clients, f, ctx, approved) {
      const fresh = await worldAdminRules(clients, f.resource.id);
      // Only the rules the player saw and approved (a rule added while the card was open waits for its own approval).
      const exact = approved ? fresh.exact.filter((r) => approved.includes(r.SecurityGroupRuleId!)) : fresh.exact;
      const broad = fresh.broad;
      ctx.lease?.throwIfAborted();
      if (exact.length) await clients.ec2.send(new RevokeSecurityGroupIngressCommand({ GroupId: f.resource.id, SecurityGroupRuleIds: exact.map((r) => r.SecurityGroupRuleId!) }));
      const closed = exact.length ? `Closed ${exact.length} rule${exact.length === 1 ? '' : 's'} in ${f.resource.name} that let anyone try SSH or RDP.` : '';
      if (broad.length) throw new PartialFix(`${closed} ${f.resource.name} still has ${broad.length === 1 ? 'a rule' : `${broad.length} rules`} opening all traffic or a wide port range to anyone. I left ${broad.length === 1 ? 'it' : 'them'} alone because removing ${broad.length === 1 ? 'it' : 'them'} would close other ports too: narrow ${broad.length === 1 ? 'it' : 'them'} in the EC2 console.`.trim());
      return closed;
    },
  },
  ec2_require_imdsv2: {
    iamAction: 'ec2:ModifyInstanceMetadataOptions',
    async stillOpen({ ec2 }, f) {
      const page = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [f.resource.id] }));
      return page.Reservations?.[0]?.Instances?.[0]?.MetadataOptions?.HttpTokens === 'optional';
    },
    async apply({ ec2 }, f) {
      await ec2.send(new ModifyInstanceMetadataOptionsCommand({ InstanceId: f.resource.id, HttpTokens: 'required' }));
      return `${f.resource.name} now accepts only IMDSv2.`;
    },
  },
  ebs_default_encryption: {
    iamAction: 'ec2:EnableEbsEncryptionByDefault',
    stillOpen: async ({ ec2 }) => !(await ec2.send(new GetEbsEncryptionByDefaultCommand({}))).EbsEncryptionByDefault,
    async apply({ ec2 }) {
      await ec2.send(new EnableEbsEncryptionByDefaultCommand({}));
      return 'New EBS volumes in this Region are now encrypted by default.';
    },
  },
  dynamodb_enable_pitr: {
    iamAction: 'dynamodb:UpdateContinuousBackups',
    async stillOpen({ dynamodb }, f) {
      const d = (await dynamodb.send(new DescribeContinuousBackupsCommand({ TableName: f.resource.id }))).ContinuousBackupsDescription;
      return d?.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus !== 'ENABLED';
    },
    async apply({ dynamodb }, f) {
      await dynamodb.send(new UpdateContinuousBackupsCommand({ TableName: f.resource.id, PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } }));
      return `Point-in-time recovery is on for ${f.resource.name}.`;
    },
  },
};
