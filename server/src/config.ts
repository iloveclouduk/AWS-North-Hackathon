import { randomBytes } from 'node:crypto';

/**
 * Two ways to run:
 *  - local (default): one player on their own machine, the workshop profile, a token, files and memory.
 *  - hosted: public players signed in with Cognito, each acting in their own linked AWS account
 *    through AWSCityPlayerRole, state in DynamoDB and S3 (infra/).
 */
export interface Config {
  awsProfile: string;
  region: string;
  host: string;
  port: number;
  /**
   * Exact extension origins allowed by CORS (comma-separated EXTENSION_ORIGIN), e.g.
   * chrome-extension://<id>,moz-extension://<uuid>. Empty allows any chrome-extension:// or moz-extension:// origin
   * (local mode only; hosted mode requires it).
   */
  extensionOrigins: string[];
  token: string;
  pollIntervalMs: number;
  model: string;
  fallbackModel: string;
  /** Cheaper model for chat answers and page classification. */
  lightModel: string;

  authMode: 'token' | 'cognito';
  awsMode: 'profile' | 'assume-role';
  store: 'file' | 'dynamodb';
  uploads: 'memory' | 's3';
  /** Host headers accepted (DNS-rebinding guard). Local: loopback. Hosted: the public API hostname(s). */
  publicHosts: string[];
  /** Public base URL (hosted) used in links; local: http://127.0.0.1:<port>. */
  publicUrl: string;

  cognito?: { userPoolId: string; clientId: string };
  tableName?: string;
  screenshotBucket?: string;
  /** https URL of infra/player-role/player-role.yaml in the templates bucket. */
  playerRoleTemplateUrl?: string;
  /** Our hosting account and the task role name players trust (hosted). */
  selfAccountId?: string;
  taskRoleName: string;
  /** Players' role name before -<region> (AWSCityPlayerRole in prod, AWSCityPlayerRole-staging in staging). */
  playerRolePrefix: string;
  /** SSM parameter: "false" turns every model call off (manual kill switch). */
  killSwitchParam?: string;
  dailyModelCalls: number;
  globalDailyModelCalls: number;
  maxSocketsPerUser: number;
  maxSockets: number;
}

const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export class ConfigError extends Error {}

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const port = Number(env.PORT ?? 8787);
  const hosted = env.AWS_CITY_MODE === 'hosted';
  const host = env.HOST ?? '127.0.0.1';
  const cfg: Config = {
    awsProfile: env.AWS_CITY_PROFILE ?? 'workshop',
    region: env.AWS_CITY_REGION ?? env.AWS_REGION ?? 'us-west-2',
    host,
    port,
    extensionOrigins: list(env.EXTENSION_ORIGIN),
    token: env.AWS_CITY_TOKEN || randomBytes(24).toString('base64url'),
    pollIntervalMs: Number(env.POLL_INTERVAL_MS ?? 10_000),
    // Legacy bedrock-runtime (InvokeModel) inference profiles: the only route to Opus/Sonnet 5 in the workshop account.
    model: env.AWS_CITY_MODEL ?? 'us.anthropic.claude-opus-5',
    fallbackModel: env.AWS_CITY_FALLBACK_MODEL ?? 'us.anthropic.claude-sonnet-5',
    lightModel: env.AWS_CITY_LIGHT_MODEL ?? env.AWS_CITY_FALLBACK_MODEL ?? 'us.anthropic.claude-sonnet-5',

    authMode: (env.AUTH_MODE as Config['authMode']) ?? (hosted ? 'cognito' : 'token'),
    awsMode: (env.AWS_MODE as Config['awsMode']) ?? (hosted ? 'assume-role' : 'profile'),
    store: (env.STORE as Config['store']) ?? (hosted ? 'dynamodb' : 'file'),
    uploads: (env.UPLOADS as Config['uploads']) ?? (hosted ? 's3' : 'memory'),
    publicHosts: list(env.PUBLIC_HOSTS),
    publicUrl: env.PUBLIC_URL ?? `http://127.0.0.1:${port}`,

    cognito: env.COGNITO_USER_POOL_ID && env.COGNITO_CLIENT_ID ? { userPoolId: env.COGNITO_USER_POOL_ID, clientId: env.COGNITO_CLIENT_ID } : undefined,
    tableName: env.TABLE_NAME,
    screenshotBucket: env.SCREENSHOT_BUCKET,
    playerRoleTemplateUrl: env.PLAYER_ROLE_TEMPLATE_URL,
    selfAccountId: env.SELF_ACCOUNT_ID,
    taskRoleName: env.TASK_ROLE_NAME ?? 'AWSCityTaskRole-prod',
    playerRolePrefix: env.PLAYER_ROLE_PREFIX ?? 'AWSCityPlayerRole',
    killSwitchParam: env.KILL_SWITCH_PARAM,
    dailyModelCalls: Number(env.DAILY_MODEL_CALLS ?? 100),
    globalDailyModelCalls: Number(env.GLOBAL_DAILY_MODEL_CALLS ?? 20_000),
    maxSocketsPerUser: Number(env.MAX_SOCKETS_PER_USER ?? 4),
    maxSockets: Number(env.MAX_SOCKETS ?? (hosted ? 1000 : 10)),
  };
  validate(cfg);
  return cfg;
};

/** Refuse unsafe combinations at startup rather than discovering them in production. */
export const validate = (c: Config) => {
  const need = (ok: unknown, what: string) => {
    if (!ok) throw new ConfigError(what);
  };
  // The token/profile setup holds real credentials: it must never listen beyond loopback.
  if (c.authMode === 'token') need(LOOPBACK.has(c.host), `HOST=${c.host} needs AUTH_MODE=cognito (token mode is loopback-only)`);
  if (c.authMode === 'cognito') {
    need(c.cognito, 'AUTH_MODE=cognito needs COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID');
    need(c.extensionOrigins.length, 'AUTH_MODE=cognito needs EXTENSION_ORIGIN (the store extension id)');
  }
  if (c.store === 'dynamodb') need(c.tableName, 'STORE=dynamodb needs TABLE_NAME');
  if (c.uploads === 's3') need(c.screenshotBucket, 'UPLOADS=s3 needs SCREENSHOT_BUCKET');
  if (c.awsMode === 'assume-role') {
    need(c.authMode === 'cognito', 'AWS_MODE=assume-role needs signed-in players (AUTH_MODE=cognito)');
    need(c.selfAccountId && c.playerRoleTemplateUrl, 'AWS_MODE=assume-role needs SELF_ACCOUNT_ID and PLAYER_ROLE_TEMPLATE_URL');
  }
  if (!LOOPBACK.has(c.host)) need(c.publicHosts.length, `HOST=${c.host} needs PUBLIC_HOSTS (accepted Host headers)`);
};
