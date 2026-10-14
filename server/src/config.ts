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
   * Extension origins allowed (comma-separated EXTENSION_ORIGIN): exact Chrome origins (chrome-extension://<id>,
   * stable per store listing) and, for Firefox and Safari, whose origins are random per install, the scheme
   * wildcards moz-extension://* and safari-web-extension://*. Empty allows any extension origin (local mode only;
   * hosted mode requires it). Only exact origins may authenticate by Origin alone (tokenAuth).
   */
  extensionOrigins: string[];
  token: string;
  pollIntervalMs: number;
  model: string;
  fallbackModel: string;
  /** Cheaper model for chat answers and page classification. */
  lightModel: string;
  /** Landmark agents' engine (citizens always run on Strands): classic = the tool loop in agents/runner.ts. */
  agentEngine: 'classic' | 'strands';
  /**
   * Let the citizens apply their approved fixes. Hosted: on (the player's role only allows them with AllowFixes=true,
   * else AWS refuses). Local: off unless AWS_CITY_ALLOW_FIXES=true, because the workshop profile isn't scoped by a role.
   */
  allowFixes: boolean;

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
  /** Hosted: players must turn on MFA before linking an AWS account (REQUIRE_MFA_FOR_LINK, default on). */
  requireMfaForLink: boolean;
  dailyModelCalls: number;
  globalDailyModelCalls: number;
  maxSocketsPerUser: number;
  maxSockets: number;
}

const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** The only wildcards allowed: a whole scheme, for browsers whose extension origins are random per install. */
export const ORIGIN_WILDCARDS = ['moz-extension://*', 'safari-web-extension://*'] as const;
const EXTENSION_SCHEMES = ['chrome-extension://', 'moz-extension://', 'safari-web-extension://'];

/** Does `origin` match one allowed entry (exact, or a scheme wildcard)? Empty `allowed` = any extension origin. */
export const originMatches = (origin: string, allowed: readonly string[]) => {
  if (!allowed.length) return EXTENSION_SCHEMES.some((s) => origin.startsWith(s));
  return allowed.some((a) => (a.endsWith('://*') ? origin.startsWith(a.slice(0, -1)) && /^[\w-]+:\/\/[^/]+$/.test(origin) : a === origin));
};
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export class ConfigError extends Error {}

/** A typo like AUTH_MODE=Cognito must fail startup, never fall back to a looser mode. */
const oneOf = <T extends string>(name: string, value: string | undefined, allowed: readonly T[], fallback: T): T => {
  if (value === undefined || value === '') return fallback;
  if (!(allowed as readonly string[]).includes(value)) throw new ConfigError(`${name}=${value} must be one of ${allowed.join(', ')}`);
  return value as T;
};

const positiveInt = (name: string, value: string | undefined, fallback: number, min = 1): number => {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new ConfigError(`${name}=${value} must be an integer ≥ ${min}`);
  return n;
};

const MIN_TOKEN_LENGTH = 32;

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const port = positiveInt('PORT', env.PORT, 8787, 0);
  const hosted = env.AWS_CITY_MODE === 'hosted';
  const host = env.HOST ?? '127.0.0.1';
  const cfg: Config = {
    awsProfile: env.AWS_CITY_PROFILE ?? 'workshop',
    region: env.AWS_CITY_REGION ?? env.AWS_REGION ?? 'us-west-2',
    host,
    port,
    extensionOrigins: list(env.EXTENSION_ORIGIN),
    token: env.AWS_CITY_TOKEN || randomBytes(24).toString('base64url'),
    pollIntervalMs: positiveInt('POLL_INTERVAL_MS', env.POLL_INTERVAL_MS, 10_000, 1_000),
    // Legacy bedrock-runtime (InvokeModel) inference profiles: the route to Claude in the workshop account. Claude
    // Opus 5.5 / Sonnet 5.5 (thinking always on, no forced tool_choice: both already true here). An account without
    // them sets AWS_CITY_MODEL=us.anthropic.claude-opus-5 and AWS_CITY_FALLBACK_MODEL=us.anthropic.claude-sonnet-5.
    model: env.AWS_CITY_MODEL ?? 'us.anthropic.claude-opus-5-5',
    fallbackModel: env.AWS_CITY_FALLBACK_MODEL ?? 'us.anthropic.claude-sonnet-5-5',
    lightModel: env.AWS_CITY_LIGHT_MODEL ?? env.AWS_CITY_FALLBACK_MODEL ?? 'us.anthropic.claude-sonnet-5-5',
    // Strands Agents for every agent turn (landmark agents too); 'classic' keeps the hand-written loop as a fallback.
    agentEngine: oneOf('AWS_CITY_AGENT_ENGINE', env.AWS_CITY_AGENT_ENGINE, ['classic', 'strands'], 'strands'),
    allowFixes: oneOf('AWS_CITY_ALLOW_FIXES', env.AWS_CITY_ALLOW_FIXES, ['true', 'false'], hosted ? 'true' : 'false') === 'true',

    authMode: oneOf('AUTH_MODE', env.AUTH_MODE, ['token', 'cognito'], hosted ? 'cognito' : 'token'),
    awsMode: oneOf('AWS_MODE', env.AWS_MODE, ['profile', 'assume-role'], hosted ? 'assume-role' : 'profile'),
    store: oneOf('STORE', env.STORE, ['file', 'dynamodb'], hosted ? 'dynamodb' : 'file'),
    uploads: oneOf('UPLOADS', env.UPLOADS, ['memory', 's3'], hosted ? 's3' : 'memory'),
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
    requireMfaForLink: oneOf('REQUIRE_MFA_FOR_LINK', env.REQUIRE_MFA_FOR_LINK, ['true', 'false'], 'true') === 'true',
    dailyModelCalls: positiveInt('DAILY_MODEL_CALLS', env.DAILY_MODEL_CALLS, 100, 0),
    globalDailyModelCalls: positiveInt('GLOBAL_DAILY_MODEL_CALLS', env.GLOBAL_DAILY_MODEL_CALLS, 20_000, 0),
    maxSocketsPerUser: positiveInt('MAX_SOCKETS_PER_USER', env.MAX_SOCKETS_PER_USER, 4),
    maxSockets: positiveInt('MAX_SOCKETS', env.MAX_SOCKETS, hosted ? 1000 : 10),
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
  if (c.authMode === 'token') {
    need(LOOPBACK.has(c.host), `HOST=${c.host} needs AUTH_MODE=cognito (token mode is loopback-only)`);
    need(c.token.length >= MIN_TOKEN_LENGTH, `AWS_CITY_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
  }
  if (c.authMode === 'cognito') {
    need(c.cognito, 'AUTH_MODE=cognito needs COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID');
    need(c.extensionOrigins.length, 'AUTH_MODE=cognito needs EXTENSION_ORIGIN (the store extension id)');
    // Every signed-in player would act in the operator's profile account.
    need(c.awsMode === 'assume-role', 'AUTH_MODE=cognito needs AWS_MODE=assume-role (players must never share the operator’s profile account)');
  }
  if (c.store === 'dynamodb') need(c.tableName, 'STORE=dynamodb needs TABLE_NAME');
  if (c.uploads === 's3') need(c.screenshotBucket, 'UPLOADS=s3 needs SCREENSHOT_BUCKET');
  if (c.awsMode === 'assume-role') {
    need(c.authMode === 'cognito', 'AWS_MODE=assume-role needs signed-in players (AUTH_MODE=cognito)');
    need(c.selfAccountId && c.playerRoleTemplateUrl, 'AWS_MODE=assume-role needs SELF_ACCOUNT_ID and PLAYER_ROLE_TEMPLATE_URL');
  }
  if (!LOOPBACK.has(c.host)) need(c.publicHosts.length, `HOST=${c.host} needs PUBLIC_HOSTS (accepted Host headers)`);
  for (const o of c.extensionOrigins)
    need(!o.includes('*') || (ORIGIN_WILDCARDS as readonly string[]).includes(o), `EXTENSION_ORIGIN ${o}: wildcards only as ${ORIGIN_WILDCARDS.join(' or ')}`);
};
