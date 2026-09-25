import { ApiGatewayV2Client } from '@aws-sdk/client-apigatewayv2';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
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
    clientConfig: { region: opts.region },
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

export const createAwsClients = (config: Config) => clientsFor({ region: config.region, credentials: refreshingProfile(config.awsProfile) });

export const clientsFor = (base: { region: string; credentials: AwsCredentialIdentityProvider }) => {
  return {
    ec2: new EC2Client(base),
    dynamodb: new DynamoDBClient(base),
    s3: new S3Client(base),
    lambda: new LambdaClient(base),
    rds: new RDSClient(base),
    apigw: new ApiGatewayV2Client(base),
    sts: new STSClient(base),
    credentials: base.credentials,
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
