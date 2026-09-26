import type { App } from 'aws-cdk-lib';

/** Per-environment settings from cdk.json context ("staging" / "prod"). Empty strings = not set up yet. */
export interface EnvConfig {
  name: 'staging' | 'prod';
  account?: string;
  region: string;
  /** api.<domain>; with hostedZoneId + zoneName the ALB gets HTTPS + a DNS record. */
  domainName: string;
  hostedZoneId: string;
  zoneName: string;
  cognitoDomainPrefix: string;
  /** Chrome extension ids (store + dev): Cognito callbacks and the server's EXTENSION_ORIGIN. */
  extensionIds: string[];
  /** Google OAuth client id; its secret lives in Secrets Manager "aws-city/google-oauth" (clientSecret). */
  googleClientId: string;
  /** Verified SES identity for Cognito emails (the default sender is limited to ~50/day). */
  sesFromEmail: string;
  alarmEmail: string;
  monthlyBudgetUsd: number;
  dailyModelCalls: number;
  globalDailyModelCalls: number;
  minTasks: number;
  maxTasks: number;
  models: { main: string; light: string };
}

export const loadEnv = (app: App): EnvConfig => {
  const name = (app.node.tryGetContext('env') ?? 'staging') as EnvConfig['name'];
  if (name !== 'staging' && name !== 'prod') throw new Error(`-c env=${name}: use staging or prod`);
  // From cdk.json it's an object; from `-c prod='{...}'` on the command line it's a JSON string.
  const ctx = app.node.tryGetContext(name) as unknown;
  const raw = (typeof ctx === 'string' ? JSON.parse(ctx) : ctx) as Omit<EnvConfig, 'name' | 'models'>;
  if (!raw) throw new Error(`No "${name}" settings in cdk.json context`);
  return {
    ...raw,
    name,
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: raw.region ?? process.env.CDK_DEFAULT_REGION ?? 'us-west-2',
    models: { main: 'us.anthropic.claude-opus-5', light: 'us.anthropic.claude-sonnet-5' },
  };
};

/** The task role players' AWSCityPlayerRole trusts (fixed name: see infra/player-role/player-role.yaml). */
export const TASK_ROLE_NAME = 'AWSCityTaskRole';
