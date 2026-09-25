import { randomBytes } from 'node:crypto';

export interface Config {
  awsProfile: string;
  region: string;
  host: string;
  port: number;
  /**
   * Exact extension origins allowed by CORS (comma-separated EXTENSION_ORIGIN), e.g.
   * chrome-extension://<id>,moz-extension://<uuid>. Empty allows any chrome-extension:// or moz-extension:// origin.
   */
  extensionOrigins: string[];
  token: string;
  pollIntervalMs: number;
  model: string;
  fallbackModel: string;
}

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => ({
  awsProfile: env.AWS_CITY_PROFILE ?? 'workshop',
  region: env.AWS_CITY_REGION ?? 'us-west-2',
  // Loopback only: this process holds AWS credentials and must never be reachable from the network.
  host: '127.0.0.1',
  port: Number(env.PORT ?? 8787),
  extensionOrigins: (env.EXTENSION_ORIGIN ?? '').split(',').map((o) => o.trim()).filter(Boolean),
  token: env.AWS_CITY_TOKEN || randomBytes(24).toString('base64url'),
  pollIntervalMs: Number(env.POLL_INTERVAL_MS ?? 10_000),
  // Legacy bedrock-runtime (InvokeModel) inference profiles: the only route to Opus/Sonnet 5 in the workshop account.
  model: env.AWS_CITY_MODEL ?? 'us.anthropic.claude-opus-5',
  fallbackModel: env.AWS_CITY_FALLBACK_MODEL ?? 'us.anthropic.claude-sonnet-5',
});
