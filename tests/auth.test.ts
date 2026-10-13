import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { CognitoAuth } from '@/backend/auth';

const DOMAIN = 'https://cloud-city.auth.us-west-2.amazoncognito.com';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('CognitoAuth', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    fakeBrowser.reset();
    await fakeBrowser.storage.local.set({ 'auth.refresh': 'r1' });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the refresh token through a network blip, drops it only on invalid_grant', async () => {
    const auth = new CognitoAuth({ domain: DOMAIN, clientId: 'c' });
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(auth.token()).rejects.toThrow();
    expect((await fakeBrowser.storage.local.get('auth.refresh'))['auth.refresh']).toBe('r1');
    fetchMock.mockResolvedValueOnce(json(400, { error: 'invalid_grant' }));
    expect(await auth.token()).toBeUndefined();
    expect((await fakeBrowser.storage.local.get('auth.refresh'))['auth.refresh']).toBeUndefined();
  });

  it('concurrent callers share one refresh', async () => {
    const auth = new CognitoAuth({ domain: DOMAIN, clientId: 'c' });
    fetchMock.mockResolvedValue(json(200, { access_token: 'a1', expires_in: 3600 }));
    expect(await Promise.all([auth.token(), auth.token(), auth.token()])).toEqual(['a1', 'a1', 'a1']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('enrols an authenticator against the pool API in the domain’s region', async () => {
    const auth = new CognitoAuth({ domain: DOMAIN, clientId: 'c' });
    fetchMock.mockResolvedValueOnce(json(200, { access_token: 'a1', expires_in: 3600 }));
    fetchMock.mockResolvedValueOnce(json(200, { SecretCode: 'ABCD' }));
    const { secret, uri } = await auth.startTotp();
    expect(secret).toBe('ABCD');
    expect(uri).toContain('secret=ABCD');
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe('https://cognito-idp.us-west-2.amazonaws.com/');
    expect((init as RequestInit).headers).toMatchObject({ 'x-amz-target': 'AWSCognitoIdentityProviderService.AssociateSoftwareToken' });

    fetchMock.mockResolvedValueOnce(json(200, { Status: 'SUCCESS' }));
    fetchMock.mockResolvedValueOnce(json(200, {}));
    await auth.confirmTotp(' 123456 ');
    expect(JSON.parse((fetchMock.mock.calls[2]![1] as RequestInit).body as string)).toMatchObject({ UserCode: '123456' });
    expect(JSON.parse((fetchMock.mock.calls[3]![1] as RequestInit).body as string)).toMatchObject({ SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true } });
  });

  it('tokens from before the authenticator scope get a clear next step', async () => {
    const auth = new CognitoAuth({ domain: DOMAIN, clientId: 'c' });
    fetchMock.mockResolvedValueOnce(json(200, { access_token: 'a1', expires_in: 3600 }));
    fetchMock.mockResolvedValueOnce(json(400, { __type: 'NotAuthorizedException', message: 'Access Token does not have required scopes' }));
    await expect(auth.startTotp()).rejects.toThrow(/Sign out and back in/);
  });

  it('Safari (no identity API): signs in through a tab that lands on the relay page', async () => {
    const relay = 'https://templates.example/auth/callback.html';
    const auth = new CognitoAuth({ domain: DOMAIN, clientId: 'c', redirectUrl: relay });
    const identity = fakeBrowser.identity;
    // @ts-expect-error simulate a browser without the identity API
    fakeBrowser.identity = undefined;
    try {
      fetchMock.mockResolvedValueOnce(json(200, { access_token: 'a2', expires_in: 3600 }));
      const signingIn = auth.signIn();
      // The sign-in tab opens on Cognito with our relay page as the redirect.
      const [tab] = await vi.waitFor(async () => {
        const tabs = await fakeBrowser.tabs.query({});
        const t = tabs.filter((x) => x.url?.startsWith(DOMAIN));
        expect(t).toHaveLength(1);
        return t;
      });
      const authorize = new URL(tab!.url!);
      expect(authorize.searchParams.get('redirect_uri')).toBe(relay);
      // Cognito redirects the tab to the relay page with the code.
      const back = `${relay}?code=abc&state=${authorize.searchParams.get('state')}`;
      await fakeBrowser.tabs.onUpdated.trigger(tab!.id!, { url: back }, { ...tab!, url: back });
      expect(await signingIn).toBe('a2');
      const body = String((fetchMock.mock.calls.at(-1)![1] as RequestInit).body);
      expect(body).toContain('code=abc');
      expect(body).toContain(`redirect_uri=${encodeURIComponent(relay)}`);
    } finally {
      fakeBrowser.identity = identity;
    }
  });

  it('Safari: closing the sign-in tab cancels', async () => {
    const auth = new CognitoAuth({ domain: DOMAIN, clientId: 'c', redirectUrl: 'https://templates.example/auth/callback.html' });
    const identity = fakeBrowser.identity;
    // @ts-expect-error simulate a browser without the identity API
    fakeBrowser.identity = undefined;
    try {
      const signingIn = auth.signIn();
      const tab = await vi.waitFor(async () => {
        const t = (await fakeBrowser.tabs.query({})).find((x) => x.url?.startsWith(DOMAIN));
        expect(t).toBeDefined();
        return t!;
      });
      await fakeBrowser.tabs.onRemoved.trigger(tab.id!, { windowId: tab.windowId!, isWindowClosing: false });
      await expect(signingIn).rejects.toThrow(/cancelled/);
    } finally {
      fakeBrowser.identity = identity;
    }
  });
});
