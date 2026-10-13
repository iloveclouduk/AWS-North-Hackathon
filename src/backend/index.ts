import type { AgentBackend } from './AgentBackend';
import { CognitoAuth } from './auth';
import { MockBackend, type MockOptions } from './MockBackend';
import { ServerBackend } from './ServerBackend';
import { isDemo } from '@/ui/logic';

/**
 * Picks the backend from env:
 *   WXT_BACKEND=aws        the team's local server (server/) — WXT_AWS_WS_URL + WXT_AWS_API_URL
 *   WXT_BACKEND=hosted     the hosted server (infra/) — WXT_AWS_WS_URL + WXT_AWS_API_URL + Cognito sign-in
 *   anything else          the in-browser mock
 * A hosted build plays the mock too while the player has chosen "Play the demo" (the `awscity.demo` pref).
 */
export function createBackend(mock: MockOptions = {}): AgentBackend {
  const env = import.meta.env;
  if (env.WXT_BACKEND === 'aws') {
    if (env.WXT_AWS_WS_URL && env.WXT_AWS_API_URL) return new ServerBackend({ wsUrl: env.WXT_AWS_WS_URL, apiUrl: env.WXT_AWS_API_URL, token: env.WXT_AWS_TOKEN });
    console.warn('[backend] WXT_BACKEND=aws but WXT_AWS_WS_URL / WXT_AWS_API_URL are missing — using mock');
    return new MockBackend(mock);
  }
  if (env.WXT_BACKEND === 'hosted') {
    if (isDemo()) return new MockBackend(mock);
    const missing = ['WXT_AWS_WS_URL', 'WXT_AWS_API_URL', 'WXT_COGNITO_DOMAIN', 'WXT_COGNITO_CLIENT_ID'].filter((k) => !env[k as keyof ImportMetaEnv]);
    if (missing.length) {
      console.warn(`[backend] WXT_BACKEND=hosted but ${missing.join(', ')} missing — using mock`);
      return new MockBackend(mock);
    }
    return new ServerBackend({
      wsUrl: env.WXT_AWS_WS_URL!,
      apiUrl: env.WXT_AWS_API_URL!,
      auth: new CognitoAuth({ domain: env.WXT_COGNITO_DOMAIN!, clientId: env.WXT_COGNITO_CLIENT_ID!, redirectUrl: env.WXT_COGNITO_REDIRECT_URL }),
    });
  }
  return new MockBackend(mock);
}

export type { AgentBackend, ConnectionStatus } from './AgentBackend';
