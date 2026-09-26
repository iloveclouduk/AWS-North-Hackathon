import { existsSync, readFileSync } from 'node:fs';
import type { App } from 'aws-cdk-lib';

/** Written by `npm run setup` (infra/setup/setup.mjs) at the repo root; gitignored, no secrets in it. */
export const SETUP_FILE = new URL('../../aws-city.config.json', import.meta.url);
export const readSetupFile = (): Record<string, unknown> => (existsSync(SETUP_FILE) ? JSON.parse(readFileSync(SETUP_FILE, 'utf8')) : {});

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
  // Precedence: `-c prod='{...}'` on the command line > aws-city.config.json (the setup wizard) > cdk.json defaults.
  const ctx = app.node.tryGetContext(name) as unknown;
  const fromCli = typeof ctx === 'string' ? (JSON.parse(ctx) as Record<string, unknown>) : undefined;
  const defaults = (typeof ctx === 'object' && ctx) || {};
  const fromSetup = (readSetupFile()[name] as Record<string, unknown> | undefined) ?? {};
  const raw = { ...defaults, ...fromSetup, ...fromCli } as Omit<EnvConfig, 'name' | 'models'>;
  if (!Object.keys(raw).length) throw new Error(`No "${name}" settings (cdk.json, aws-city.config.json or -c ${name}=...)`);
  // Cognito rejects prefix domains containing reserved words: fail at synth, not 10 minutes into a deploy.
  if (/aws|amazon|cognito/.test(raw.cognitoDomainPrefix ?? '')) throw new Error(`cognitoDomainPrefix "${raw.cognitoDomainPrefix}" can't contain aws, amazon or cognito`);
  return {
    ...raw,
    name,
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: raw.region ?? process.env.CDK_DEFAULT_REGION ?? 'us-west-2',
    models: { main: 'us.anthropic.claude-opus-5', light: 'us.anthropic.claude-sonnet-5' },
  };
};

/**
 * Role names, one set per environment, so staging and prod can share an account. Players' role
 * trusts exactly this environment's task role (baked into the published template).
 */
export const taskRoleName = (env: Pick<EnvConfig, 'name'>) => `AWSCityTaskRole-${env.name}`;
export const playerRolePrefix = (env: Pick<EnvConfig, 'name'>) => (env.name === 'prod' ? 'AWSCityPlayerRole' : `AWSCityPlayerRole-${env.name}`);
