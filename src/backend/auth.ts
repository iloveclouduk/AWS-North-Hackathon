// Cognito managed-login sign-in for the extension (OAuth 2.0 authorization code + PKCE).
//  - Chrome/Edge and Firefox: identity.launchWebAuthFlow, redirecting to the browser's own extension URL
//    (https://<id>.chromiumapp.org/ or https://<sha1>.extensions.allizom.org/).
//  - Safari (no identity API): the sign-in page opens in a tab that redirects to a static relay page
//    (infra: templates bucket auth/callback.html); the extension reads the code from that tab's URL and
//    closes it. The code is useless without the PKCE verifier, which never leaves the extension.
// The access token is what the hosted server verifies (server/src/auth.ts: this app client only). Tokens
// live in storage.session (cleared when the browser closes); the refresh token in storage.local.

const SIGN_IN_TIMEOUT_MS = 10 * 60_000;

import { browser } from 'wxt/browser';

export interface CognitoConfig {
  /** e.g. https://aws-city.auth.us-west-2.amazoncognito.com */
  domain: string;
  clientId: string;
  scopes?: string[];
  /** Safari: the relay page Cognito redirects to (WXT_COGNITO_REDIRECT_URL). Unused where identity exists. */
  redirectUrl?: string;
}

interface Tokens {
  accessToken: string;
  expiresAt: number;
}

/** A token endpoint error: only invalid_grant means the refresh token itself is dead. */
class TokenError extends Error {
  constructor(readonly status: number, readonly code?: string) {
    super(`Token exchange failed: ${status}${code ? ` ${code}` : ''}`);
  }
}

/** The extension's own scope set; aws.cognito.signin.user.admin lets the player enrol an authenticator app. */
const SCOPES = ['openid', 'email', 'profile', 'aws.cognito.signin.user.admin'];

const SESSION_KEY = 'auth.tokens';
const REFRESH_KEY = 'auth.refresh';

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

/**
 * Safari's stand-in for launchWebAuthFlow: opens the sign-in page in a tab and resolves with the URL it
 * redirects to (the relay page), then closes that tab. Rejects if the player closes the tab or gives up.
 */
export function signInTab(authorizeUrl: string, redirectPrefix: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let tabId: number | undefined;
    const done = (fn: () => void) => {
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.tabs.onRemoved.removeListener(onRemoved);
      clearTimeout(timer);
      fn();
    };
    const onUpdated = (id: number, info: { url?: string }, tab: { url?: string }) => {
      const url = info.url ?? tab.url;
      if (id !== tabId || !url?.startsWith(redirectPrefix)) return;
      done(() => resolve(url));
      void browser.tabs.remove(id).catch(() => {});
    };
    const onRemoved = (id: number) => id === tabId && done(() => reject(new Error('Sign-in was cancelled')));
    const timer = setTimeout(() => done(() => reject(new Error('Sign-in timed out'))), SIGN_IN_TIMEOUT_MS);
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onRemoved.addListener(onRemoved);
    browser.tabs.create({ url: authorizeUrl }).then(
      (tab) => (tabId = tab.id),
      (err) => done(() => reject(err)),
    );
  });
}

export class CognitoAuth {
  /** One refresh at a time: concurrent callers share it (Cognito may rotate refresh tokens). */
  private refreshing?: Promise<string | undefined>;

  constructor(private cfg: CognitoConfig) {}

  /** Chrome/Edge/Firefox have identity.launchWebAuthFlow; Safari doesn't. */
  private get viaIdentity() {
    return typeof browser.identity?.launchWebAuthFlow === 'function';
  }

  private get redirectUri() {
    if (this.viaIdentity) return browser.identity.getRedirectURL();
    if (!this.cfg.redirectUrl) throw new Error('Sign-in isn’t set up for this browser yet (WXT_COGNITO_REDIRECT_URL).');
    return this.cfg.redirectUrl;
  }

  /** Returns a valid access token, refreshing silently if possible. undefined = needs interactive sign-in. */
  async token(): Promise<string | undefined> {
    const s = (await browser.storage.session.get(SESSION_KEY))[SESSION_KEY] as Tokens | undefined;
    if (s && s.expiresAt - Date.now() > 60_000) return s.accessToken;
    this.refreshing ??= this.refresh().finally(() => (this.refreshing = undefined));
    return this.refreshing;
  }

  private async refresh(): Promise<string | undefined> {
    const refresh = (await browser.storage.local.get(REFRESH_KEY))[REFRESH_KEY] as string | undefined;
    if (!refresh) return undefined;
    try {
      return await this.exchange({ grant_type: 'refresh_token', refresh_token: refresh });
    } catch (err) {
      // Only a rejected refresh token signs the player out; a network blip or 5xx is retried later.
      if (err instanceof TokenError && err.code === 'invalid_grant') {
        await browser.storage.local.remove(REFRESH_KEY);
        return undefined;
      }
      throw err;
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
      scope: (this.cfg.scopes ?? SCOPES).join(' '),
      code_challenge_method: 'S256',
      code_challenge: challenge,
      state,
    }).toString();
    const result = this.viaIdentity ? await browser.identity.launchWebAuthFlow({ url: url.toString(), interactive: true }) : await signInTab(url.toString(), this.redirectUri);
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

  /** The server rejected the access token: drop it so the next token() refreshes (or asks for sign-in). */
  async forgetAccessToken() {
    await browser.storage.session.remove(SESSION_KEY);
  }

  /**
   * The side panel and the full-city tab share these keys. Calls back with 'signed-in' when another
   * surface stores a fresh sign-in and 'signed-out' when the refresh token is removed.
   */
  onChange(cb: (change: 'signed-in' | 'signed-out') => void): () => void {
    const listener = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => {
      const c = changes[REFRESH_KEY];
      if (area !== 'local' || !c) return;
      if (c.newValue && !c.oldValue) cb('signed-in');
      else if (!c.newValue && c.oldValue) cb('signed-out');
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }

  private async exchange(params: Record<string, string>): Promise<string> {
    const res = await fetch(new URL('/oauth2/token', this.cfg.domain), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.cfg.clientId, ...params }),
    });
    if (!res.ok) throw new TokenError(res.status, ((await res.json().catch(() => ({}))) as { error?: string }).error);
    const body = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string };
    const tokens: Tokens = { accessToken: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    await browser.storage.session.set({ [SESSION_KEY]: tokens });
    if (body.refresh_token) await browser.storage.local.set({ [REFRESH_KEY]: body.refresh_token });
    return tokens.accessToken;
  }

  /** The user pool's API region, from the managed-login domain (https://<prefix>.auth.<region>.amazoncognito.com). */
  private get idpUrl() {
    const region = /\.auth\.([a-z0-9-]+)\.amazoncognito\.com$/.exec(new URL(this.cfg.domain).hostname)?.[1];
    if (!region) throw new Error('Authenticator setup needs the Cognito prefix domain (…auth.<region>.amazoncognito.com).');
    return `https://cognito-idp.${region}.amazonaws.com/`;
  }

  /** Calls the user pool API as the signed-in player (their access token authorises it). */
  private async idp<T>(op: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(this.idpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `AWSCognitoIdentityProviderService.${op}` },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as T & { __type?: string; message?: string };
    if (!res.ok) {
      // Tokens issued before the authenticator scope existed can't do this: signing in again fixes it.
      if (json.__type?.includes('NotAuthorized')) throw new Error('Sign out and back in once, then set up your authenticator.');
      throw new Error(json.message ?? `${op} failed (${res.status})`);
    }
    return json;
  }

  /** Step 1 of authenticator setup: a new secret for the player's app (shown as a key and an otpauth link). */
  async startTotp(): Promise<{ secret: string; uri: string }> {
    const token = await this.token();
    if (!token) throw new Error('Sign in first.');
    const { SecretCode } = await this.idp<{ SecretCode: string }>('AssociateSoftwareToken', { AccessToken: token });
    return { secret: SecretCode, uri: `otpauth://totp/AWS%20City?secret=${SecretCode}&issuer=AWS%20City` };
  }

  /** Step 2: the 6-digit code from the app proves it works; then TOTP becomes the player's MFA. */
  async confirmTotp(code: string): Promise<void> {
    const token = await this.token();
    if (!token) throw new Error('Sign in first.');
    const { Status } = await this.idp<{ Status: string }>('VerifySoftwareToken', { AccessToken: token, UserCode: code.trim(), FriendlyDeviceName: 'AWS City' });
    if (Status !== 'SUCCESS') throw new Error('That code didn’t match. Check your phone’s clock and try the next code.');
    await this.idp('SetUserMFAPreference', { AccessToken: token, SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true } });
  }
}
