import { randomBytes } from 'node:crypto';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { assumedRole, SDK_DEFAULTS } from '../aws.js';
import type { AccountRecord, AccountStore } from '../store/types.js';

/** The player role's fixed name (infra/player-role/player-role.yaml): players only need their account id. */
export const playerRoleName = (region: string, prefix = 'AWSCityPlayerRole') => `${prefix}-${region}`;
/** Commercial-partition Regions only: our account (the trusted principal) is arn:aws, so GovCloud/China roles can't trust it. */
const REGION = /^[a-z]{2}-[a-z]+-\d$/;
const ROLE_ARN = /^arn:aws:iam::(\d{12}):role\/(AWSCityPlayerRole-[a-z0-9-]+)$/;

export class LinkError extends Error {}

/**
 * Connecting a player's own AWS account:
 *  1. link: we mint a per-player ExternalId and hand back a CloudFormation quick-create URL for the
 *     player role (trusting only our task role, with that ExternalId).
 *  2. verify: we assume the role and check who we are before saving anything.
 * We never see or store the player's keys; only the role ARN and the ExternalId.
 */
export const createAccountLinker = (deps: {
  accounts: AccountStore;
  templateUrl: string;
  selfAccountId: string;
  /** AWSCityPlayerRole (prod) or AWSCityPlayerRole-<env>. */
  playerRolePrefix?: string;
  /** Test seam: credentials for a role. */
  credentialsFor?: (o: { roleArn: string; externalId: string; sub: string; region: string }) => AwsCredentialIdentityProvider;
  /** Test seam: GetCallerIdentity with those credentials. */
  whoAmI?: (region: string, credentials: AwsCredentialIdentityProvider) => Promise<{ Account?: string; Arn?: string }>;
}) => {
  const credentialsFor = deps.credentialsFor ?? assumedRole;
  const whoAmI = deps.whoAmI ?? ((region, credentials) => new STSClient({ ...SDK_DEFAULTS, region, credentials }).send(new GetCallerIdentityCommand({})));

  const quickCreateUrl = (region: string, externalId: string) => {
    const params = new URLSearchParams({
      templateURL: deps.templateUrl,
      stackName: 'AWSCity',
      param_ExternalId: externalId,
      // No trust parameters: the published template has our account fixed in it.
    });
    return `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/quickcreate?${params}`;
  };

  return {
    async link(sub: string, region: string) {
      if (!REGION.test(region)) throw new LinkError('That doesn’t look like an AWS region (e.g. us-west-2).');
      const existing = await deps.accounts.get(sub);
      // Re-linking keeps the same ExternalId, so a stack the player already installed keeps working. A linked account
      // stays linked (and usable) until verify succeeds for the new Region.
      let record: AccountRecord;
      if (existing?.status === 'linked') {
        const { pendingRegion: _, ...linked } = existing;
        record = existing.region === region ? linked : { ...linked, pendingRegion: region };
      } else record = { status: 'pending', externalId: existing?.externalId ?? randomBytes(24).toString('base64url'), region };
      if (JSON.stringify(record) !== JSON.stringify(existing)) await deps.accounts.put(sub, record);
      return { url: quickCreateUrl(region, record.externalId), externalId: record.externalId };
    },

    /** Accepts the stack's RoleArn output or just the 12-digit account id. */
    async verify(sub: string, input: string): Promise<AccountRecord & { status: 'linked' }> {
      const stored = await deps.accounts.get(sub);
      if (!stored) throw new LinkError('Start with “Get my setup link” first.');
      // The Region asked for last (a linked player's new Region, else the record's own).
      const { pendingRegion, ...rest } = stored;
      const record = { ...rest, region: pendingRegion ?? stored.region };
      const trimmed = input.trim();
      const prefix = deps.playerRolePrefix ?? 'AWSCityPlayerRole';
      const roleArn = /^\d{12}$/.test(trimmed) ? `arn:aws:iam::${trimmed}:role/${playerRoleName(record.region, prefix)}` : trimmed;
      const m = ROLE_ARN.exec(roleArn);
      if (!m || !m[2]!.startsWith(`${prefix}-`)) throw new LinkError('Paste your 12-digit AWS account id (or the RoleArn from the AWSCity stack).');
      if (m[1] === deps.selfAccountId) throw new LinkError('That’s the city’s own account — use your account.');
      let id: { Account?: string; Arn?: string };
      try {
        id = await whoAmI(record.region, credentialsFor({ roleArn, externalId: record.externalId, sub, region: record.region }));
      } catch {
        throw new LinkError(`I couldn’t use the AWSCity role in ${m[1]} (${record.region}). Is the stack finished, in that region, and made from your latest setup link?`);
      }
      if (id.Account !== m[1] || !id.Arn?.includes(`:assumed-role/${m[2]}/`)) throw new LinkError('That role isn’t the AWSCity player role.');
      const linked = { ...record, status: 'linked' as const, roleArn, accountId: m[1], linkedAt: new Date().toISOString() };
      await deps.accounts.put(sub, linked);
      return linked;
    },
  };
};

export type AccountLinker = ReturnType<typeof createAccountLinker>;
