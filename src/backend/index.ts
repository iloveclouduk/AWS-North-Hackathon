import type { AgentBackend } from './AgentBackend';
import { AwsBackend } from './AwsBackend';
import { MockBackend, type MockOptions } from './MockBackend';

/** Picks the backend from env: WXT_BACKEND=aws uses API Gateway, anything else uses the mock. */
export function createBackend(mock: MockOptions = {}): AgentBackend {
  const env = import.meta.env;
  if (env.WXT_BACKEND === 'aws') {
    if (!env.WXT_AWS_WS_URL || !env.WXT_AWS_API_URL) {
      console.warn('[backend] WXT_BACKEND=aws but WXT_AWS_WS_URL / WXT_AWS_API_URL are missing — using mock');
      return new MockBackend(mock);
    }
    return new AwsBackend({ wsUrl: env.WXT_AWS_WS_URL, apiUrl: env.WXT_AWS_API_URL });
  }
  return new MockBackend(mock);
}

export type { AgentBackend, ConnectionStatus } from './AgentBackend';
