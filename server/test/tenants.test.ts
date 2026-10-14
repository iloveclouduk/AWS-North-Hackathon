import { describe, expect, it, vi } from 'vitest';
import type { AccountLinker } from '../src/accounts/link.js';
import type { AwsClients } from '../src/aws.js';
import { loadConfig } from '../src/config.js';
import { createUploadStore } from '../src/contract/uploads.js';
import { emptyWorld } from '../src/tenants.js';
import { localStores } from '../src/store/local.js';
import { fakeLlm } from './fakes.js';

// Every poller the tenant builds is recorded, so a test can see which ones are still running.
const pollers = vi.hoisted(() => [] as { running: boolean }[]);
vi.mock('../src/state/poller.js', () => ({
  createPoller: () => {
    const p = { running: false };
    pollers.push(p);
    return {
      current: () => null,
      refresh: async () => emptyWorld('us-west-2'),
      start: () => void (p.running = true),
      stop: () => void (p.running = false),
    };
  },
}));

const { createTenants } = await import('../src/tenants.js');

const linked = (accountId: string) => ({ status: 'linked' as const, externalId: 'x', region: 'us-west-2', roleArn: `arn:aws:iam::${accountId}:role/r`, accountId });

const setup = (verify: AccountLinker['verify']) => {
  pollers.length = 0;
  const linker = { link: async () => ({ url: '', externalId: '' }), verify } as unknown as AccountLinker;
  const tenants = createTenants({
    config: loadConfig({}),
    stores: localStores(`/tmp/aws-city-tenants-${Date.now()}.json`),
    uploads: createUploadStore('http://127.0.0.1:1'),
    llm: fakeLlm([]).llm,
    enabled: async () => true,
    awsFor: (_sub, record) => (record?.accountId ? { clients: {} as AwsClients, accountId: record.accountId, region: record.region } : undefined),
    linker,
    walkMs: 0,
  });
  return tenants;
};

const running = () => pollers.filter((p) => p.running).length;

describe('tenant account changes', () => {
  it('two verifies at once leave exactly one poller running', async () => {
    let n = 0;
    const tenants = setup(async () => linked(String(111122223333 + n++)));
    const tenant = await tenants.acquire({ sub: 'u1' });
    await Promise.all([tenant.verify('a', 'x', () => {}), tenant.verify('b', 'x', () => {})]);
    expect(pollers).toHaveLength(2);
    expect(running()).toBe(1);
    tenants.closeAll();
    expect(running()).toBe(0);
  });

  it('a verify that finishes after the tenant was stopped does not leave a poller behind', async () => {
    let release!: () => void;
    const tenants = setup(() => new Promise((r) => (release = () => r(linked('111122223333')))));
    const tenant = await tenants.acquire({ sub: 'u1' });
    const verifying = tenant.verify('a', 'x', () => {});
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    tenants.closeAll();
    release();
    await verifying;
    expect(running()).toBe(0);
  });

  it('delete after link stops the linked poller', async () => {
    const tenants = setup(async () => linked('111122223333'));
    const tenant = await tenants.acquire({ sub: 'u1' });
    await tenant.verify('a', 'x', () => {});
    expect(running()).toBe(1);
    await tenant.deleteMe();
    expect(running()).toBe(0);
  });

  it('REST data for a player with no open city never assumes their role or polls AWS', async () => {
    const tenants = setup(async () => linked('111122223333'));
    expect(await tenants.data({ sub: 'u9' }).progress.get()).toBeNull();
    await tenants.data({ sub: 'u9' }).deleteMe();
    expect(pollers).toHaveLength(0);
  });
});

describe('AWS public status for every player (v2.6)', () => {
  it('an unlinked player gets the shared feed on connect and on change, and stops listening when evicted', async () => {
    const listeners = new Set<(e: import('../src/world.js').ServerEvent[]) => void>();
    const health = { type: 'aws.health' as const, asOf: '2026-10-11T00:00:00.000Z', incidents: [] };
    const news = { welcome: () => [health], subscribe: (fn: (e: import('../src/world.js').ServerEvent[]) => void) => (listeners.add(fn), () => listeners.delete(fn)), tick: async () => {}, stop: () => {} };
    const tenants = createTenants({
      config: loadConfig({}),
      stores: localStores(`/tmp/aws-city-tenants-news-${Date.now()}.json`),
      uploads: createUploadStore('http://127.0.0.1:1'),
      llm: fakeLlm([]).llm,
      enabled: async () => true,
      awsFor: () => undefined,
      news,
      walkMs: 0,
    });
    const tenant = await tenants.acquire({ sub: 'u1' });
    expect((await tenant.welcome()).map((e) => e.type)).toContain('aws.health');
    const got: string[] = [];
    tenant.subscribe((e) => got.push(e.type));
    for (const fn of listeners) fn([{ ...health, asOf: '2026-10-11T00:03:00.000Z' }]);
    expect(got).toEqual(['aws.health']);
    tenants.closeAll();
    expect(listeners.size).toBe(0);
  });
});
