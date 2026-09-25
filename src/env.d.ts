interface ImportMetaEnv {
  readonly WXT_BACKEND?: 'mock' | 'agentcore';
  readonly WXT_AGENTCORE_REGION?: string;
  readonly WXT_AGENTCORE_RUNTIME_ARN?: string;
  readonly WXT_COGNITO_DOMAIN?: string;
  readonly WXT_COGNITO_CLIENT_ID?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
