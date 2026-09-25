interface ImportMetaEnv {
  readonly WXT_BACKEND?: 'mock' | 'aws';
  readonly WXT_AWS_WS_URL?: string;
  readonly WXT_AWS_API_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
