interface ImportMetaEnv {
  readonly WXT_BACKEND?: 'mock' | 'aws' | 'agentcore';
  readonly WXT_AWS_WS_URL?: string;
  readonly WXT_AWS_API_URL?: string;
  readonly WXT_AGENTCORE_REGION?: string;
  readonly WXT_AGENTCORE_RUNTIME_ARN?: string;
  readonly WXT_COGNITO_DOMAIN?: string;
  readonly WXT_COGNITO_CLIENT_ID?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
