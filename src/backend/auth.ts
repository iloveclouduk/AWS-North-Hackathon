// Cognito Hosted UI sign-in for the extension (OAuth 2.0 authorization code + PKCE) via
// chrome.identity.launchWebAuthFlow. The access token is what the AgentCore Runtime JWT authorizer
// validates (allowedClients = the app client id). Tokens live in chrome.storage.session (cleared when
// the browser closes); the refresh token in chrome.storage.local so players stay signed in.

import { browser } from 'wxt/browser';

export interface CognitoConfig {
  /** e.g. https://aws-city.auth.us-west-2.amazoncognito.com */
  domain: string;
  clientId: string;
  scopes?: string[];
}

interface Tokens {
  accessToken: string;
  expiresAt: number;
}

const SESSION_KEY = 'auth.tokens';
const REFRESH_KEY = 'auth.refresh';

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

export class CognitoAuth {
  constructor(private cfg: CognitoConfig) {}

  private get redirectUri() {
    return browser.identity.getRedirectURL(); // https://<extension-id>.chromiumapp.org/
  }

  /** Returns a valid access token, refreshing silently if possible. undefined = needs interactive sign-in. */
  async token(): Promise<string | undefined> {
    const s = (await browser.storage.session.get(SESSION_KEY))[SESSION_KEY] as Tokens | undefined;
    if (s && s.expiresAt - Date.now() > 60_000) return s.accessToken;
    const refresh = (await browser.storage.local.get(REFRESH_KEY))[REFRESH_KEY] as string | undefined;
    if (!refresh) return undefined;
    try {
      return await this.exchange({ grant_type: 'refresh_token', refresh_token: refresh });
    } catch {
      await browser.storage.local.remove(REFRESH_KEY);
      return undefined;
    }
  }

  /** Must be triggered by a user gesture (button click). */
  async signIn(): Promise<string> {
    const { verifier, challenge } = await pkce();
    const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
    const url = new URL('/oauth2/authorize', this.cfg.domain);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.cfg.clientId,
      redirect_uri: this.redirectUri,
      scope: (this.cfg.scopes ?? ['openid', 'email', 'profile']).join(' '),
      code_challenge_method: 'S256',
      code_challenge: challenge,
      state,
    }).toString();
    const result = await browser.identity.launchWebAuthFlow({ url: url.toString(), interactive: true });
    if (!result) throw new Error('Sign-in was cancelled');
    const back = new URL(result);
    if (back.searchParams.get('state') !== state) throw new Error('Sign-in state mismatch');
    const code = back.searchParams.get('code');
    if (!code) throw new Error(back.searchParams.get('error_description') ?? 'No authorization code returned');
    return this.exchange({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: this.redirectUri });
  }

  async signOut() {
    await browser.storage.session.remove(SESSION_KEY);
    await browser.storage.local.remove(REFRESH_KEY);
  }

  private async exchange(params: Record<string, string>): Promise<string> {
    const res = await fetch(new URL('/oauth2/token', this.cfg.domain), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.cfg.clientId, ...params }),
    });
    if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string };
    const tokens: Tokens = { accessToken: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    await browser.storage.session.set({ [SESSION_KEY]: tokens });
    if (body.refresh_token) await browser.storage.local.set({ [REFRESH_KEY]: body.refresh_token });
    return tokens.accessToken;
  }
}
