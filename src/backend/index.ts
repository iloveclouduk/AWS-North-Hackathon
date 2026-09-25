import { browser } from 'wxt/browser';
import type { AgentBackend } from './AgentBackend';
import { uid } from './AgentBackend';
import { AgentCoreBackend } from './AgentCoreBackend';
import { CognitoAuth } from './auth';
import { MockBackend, type MockOptions } from './MockBackend';
import { ServerBackend } from './ServerBackend';

const SESSION_KEY = 'agentcore.sessionId';

/** Stable per-install runtime session id (AgentCore requires ≥33 chars). */
async function sessionId() {
  const saved = (await browser.storage.local.get(SESSION_KEY))[SESSION_KEY] as string | undefined;
  if (saved) return saved;
  const id = `aws-city-${uid()}`;
  await browser.storage.local.set({ [SESSION_KEY]: id });
  return id;
}

/**
 * Picks the backend from env:
 *   WXT_BACKEND=aws        the team's local server (server/) — WXT_AWS_WS_URL + WXT_AWS_API_URL
 *   WXT_BACKEND=agentcore  Strands swarm on AgentCore Runtime (branch parked/agentcore-backend)
 *   anything else          the in-browser mock
 */
export function createBackend(mock: MockOptions = {}): AgentBackend {
  const env = import.meta.env;
  if (env.WXT_BACKEND === 'aws') {
    if (env.WXT_AWS_WS_URL && env.WXT_AWS_API_URL) return new ServerBackend({ wsUrl: env.WXT_AWS_WS_URL, apiUrl: env.WXT_AWS_API_URL });
    console.warn('[backend] WXT_BACKEND=aws but WXT_AWS_WS_URL / WXT_AWS_API_URL are missing — using mock');
    return new MockBackend(mock);
  }
  if (env.WXT_BACKEND === 'agentcore') {
    const missing = ['WXT_AGENTCORE_REGION', 'WXT_AGENTCORE_RUNTIME_ARN', 'WXT_COGNITO_DOMAIN', 'WXT_COGNITO_CLIENT_ID'].filter(
      (k) => !env[k as keyof ImportMetaEnv],
    );
    if (missing.length) {
      console.warn(`[backend] WXT_BACKEND=agentcore but ${missing.join(', ')} missing — using mock`);
      return new MockBackend(mock);
    }
    return new AgentCoreBackend({
      region: env.WXT_AGENTCORE_REGION!,
      runtimeArn: env.WXT_AGENTCORE_RUNTIME_ARN!,
      auth: new CognitoAuth({ domain: env.WXT_COGNITO_DOMAIN!, clientId: env.WXT_COGNITO_CLIENT_ID! }),
      sessionId,
    });
  }
  return new MockBackend(mock);
}

export type { AgentBackend, ConnectionStatus } from './AgentBackend';
