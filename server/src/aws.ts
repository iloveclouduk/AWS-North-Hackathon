import { ApiGatewayV2Client } from '@aws-sdk/client-apigatewayv2';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EC2Client } from '@aws-sdk/client-ec2';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { RDSClient } from '@aws-sdk/client-rds';
import { S3Client } from '@aws-sdk/client-s3';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { fromIni } from '@aws-sdk/credential-providers';
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

export const createAwsClients = (config: Config) => {
  const base = { region: config.region, credentials: refreshingProfile(config.awsProfile) };
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
