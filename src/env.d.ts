interface ImportMetaEnv {
  readonly WXT_BACKEND?: 'mock' | 'aws' | 'hosted';
  readonly WXT_AWS_WS_URL?: string;
  readonly WXT_AWS_API_URL?: string;
  /** Local server token, only for dev builds of browsers whose origin can't be pinned (Safari). */
  readonly WXT_AWS_TOKEN?: string;
  readonly WXT_COGNITO_DOMAIN?: string;
  readonly WXT_COGNITO_CLIENT_ID?: string;
  /** Safari sign-in relay page (no identity API there): the AuthRelayUrl stack output. */
  readonly WXT_COGNITO_REDIRECT_URL?: string;
  /** Set by release builds for the Chrome Web Store (wxt.config.ts). */
  readonly WXT_STORE_BUILD?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
