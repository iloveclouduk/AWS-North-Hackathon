import { browser } from 'wxt/browser';
import type { AgentBackend } from './AgentBackend';
import { uid } from './AgentBackend';
import { AgentCoreBackend } from './AgentCoreBackend';
import { CognitoAuth } from './auth';
import { MockBackend, type MockOptions } from './MockBackend';

const SESSION_KEY = 'agentcore.sessionId';

/** Stable per-install runtime session id (AgentCore requires ≥33 chars). */
async function sessionId() {
  const saved = (await browser.storage.local.get(SESSION_KEY))[SESSION_KEY] as string | undefined;
  if (saved) return saved;
  const id = `aws-city-${uid()}`;
  await browser.storage.local.set({ [SESSION_KEY]: id });
  return id;
}

/** Picks the backend from env: WXT_BACKEND=agentcore uses the Strands swarm on AgentCore, else the mock. */
export function createBackend(mock: MockOptions = {}): AgentBackend {
  const env = import.meta.env;
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
