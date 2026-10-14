import { ApiGatewayV2Client } from '@aws-sdk/client-apigatewayv2';
import { CloudTrailClient } from '@aws-sdk/client-cloudtrail';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { CostExplorerClient } from '@aws-sdk/client-cost-explorer';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ResourceExplorer2Client } from '@aws-sdk/client-resource-explorer-2';
import { ResourceGroupsTaggingAPIClient } from '@aws-sdk/client-resource-groups-tagging-api';
import { S3ControlClient } from '@aws-sdk/client-s3-control';
import { EC2Client } from '@aws-sdk/client-ec2';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { RDSClient } from '@aws-sdk/client-rds';
import { S3Client } from '@aws-sdk/client-s3';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { fromIni, fromNodeProviderChain, fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { createHash } from 'node:crypto';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import type { Config } from './config.js';

/**
 * Re-reads the profile from ~/.aws/credentials every minute, so refreshed workshop keys
 * are picked up without restarting the server. (Static session keys carry no expiry, so
 * the SDK would otherwise cache the first ones forever.)
 */
export const refreshingProfile = (profile: string): AwsCredentialIdentityProvider => async () => {
  const creds = await fromIni({ profile, ignoreCache: true })();
  return { ...creds, expiration: new Date(Date.now() + 60_000) };
};

/**
 * A player's own account (hosted mode): short-lived credentials for AWSCityPlayerRole, assumed from our
 * task role with the player's ExternalId. The SDK caches them and refreshes before they expire.
 */
export const assumedRole = (opts: { roleArn: string; externalId: string; sub: string; region: string }): AwsCredentialIdentityProvider =>
  fromTemporaryCredentials({
    masterCredentials: fromNodeProviderChain(),
    clientConfig: { ...SDK_DEFAULTS, region: opts.region },
    params: {
      RoleArn: opts.roleArn,
      ExternalId: opts.externalId,
      RoleSessionName: `aws-city-${createHash('sha256').update(opts.sub).digest('hex').slice(0, 16)}`,
      DurationSeconds: 3600,
    },
  });

/** Credentials for our own infrastructure (Bedrock, the table, the bucket): the profile locally, the task role hosted. */
export const serviceCredentials = (config: Config): AwsCredentialIdentityProvider =>
  config.awsMode === 'profile' ? refreshingProfile(config.awsProfile) : fromNodeProviderChain();

/**
 * Every AWS SDK client gets bounded timeouts: the SDK's Node handler has none by default, and one hung
 * call would freeze a player's poller (it coalesces with the call in flight) or hold their write lock.
 * requestTimeout only warns unless throwOnRequestTimeout is set (@smithy/node-http-handler).
 */
export const SDK_DEFAULTS = {
  maxAttempts: 3,
  retryMode: 'adaptive',
  requestHandler: { connectionTimeout: 3_000, requestTimeout: 10_000, throwOnRequestTimeout: true },
} as const;

export const createAwsClients = (config: Config) => clientsFor({ region: config.region, credentials: refreshingProfile(config.awsProfile) });

/** Cost Explorer has one endpoint, in us-east-1, whatever the account's home Region. */
export const COST_EXPLORER_REGION = 'us-east-1';

export const clientsFor = (opts: { region: string; credentials: AwsCredentialIdentityProvider }) => {
  const base = { ...SDK_DEFAULTS, ...opts };
  const ec2 = new EC2Client(base);
  /** Read-only EC2 clients for other Regions (their AZ maps), same credentials, made on first use. */
  const ec2ByRegion = new Map<string, EC2Client>([[opts.region, ec2]]);
  let ce: CostExplorerClient | undefined;
  let cw: CloudWatchClient | undefined;
  return {
    ec2,
    ec2For(region: string): EC2Client {
      let c = ec2ByRegion.get(region);
      if (!c) ec2ByRegion.set(region, (c = new EC2Client({ ...base, region })));
      return c;
    },
    /** Cost Explorer (the bill, only while the player has it on): $0.01 per request. */
    costExplorer(): CostExplorerClient {
      return (ce ??= new CostExplorerClient({ ...base, region: COST_EXPLORER_REGION }));
    },
    /** CloudWatch in the home Region (live traffic, only while the player has it on): GetMetricData only. */
    cloudwatch(): CloudWatchClient {
      return (cw ??= new CloudWatchClient(base));
    },
    dynamodb: new DynamoDBClient(base),
    s3: new S3Client(base),
    lambda: new LambdaClient(base),
    rds: new RDSClient(base),
    apigw: new ApiGatewayV2Client(base),
    sts: new STSClient(base),
    // Read-only, for the city's mirror of the account and its Well-Architected checks.
    s3control: new S3ControlClient(base),
    cloudtrail: new CloudTrailClient(base),
    explorer: new ResourceExplorer2Client(base),
    tagging: new ResourceGroupsTaggingAPIClient(base),
    credentials: opts.credentials,
  };
};

export type AwsClients = ReturnType<typeof createAwsClients>;

export const getAccountId = async (clients: AwsClients): Promise<string> => {
  const id = await clients.sts.send(new GetCallerIdentityCommand({}));
  if (!id.Account) throw new Error('STS returned no account id');
  return id.Account;
};

const DENIED = new Set(['AccessDenied', 'AccessDeniedException', 'UnauthorizedOperation', 'AuthorizationError']);
const EXPIRED = new Set(['ExpiredToken', 'ExpiredTokenException', 'InvalidClientTokenId', 'UnrecognizedClientException', 'RequestExpired']);

export type AwsErrorKind = 'denied' | 'expired' | 'other';

export const classifyAwsError = (err: unknown): AwsErrorKind => {
  const name = (err as { name?: string })?.name ?? '';
  if (DENIED.has(name)) return 'denied';
  if (EXPIRED.has(name)) return 'expired';
  return 'other';
};
