import type Anthropic from '@anthropic-ai/sdk';
import type { AddressInfo } from 'node:net';
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { createAccountLinker, playerRoleName } from '../src/accounts/link.js';
import { createMfaCheck } from '../src/accounts/mfa.js';
import { metered, ModelLimitError, QUOTA_MESSAGE, withErrorCodes } from '../src/agents/metered.js';
import { cognitoAuth, type JwtVerifier } from '../src/auth.js';
import { ConfigError, loadConfig } from '../src/config.js';
import { createUploadStore } from '../src/contract/uploads.js';
import { createHttpServer } from '../src/http.js';
import { dynamoStores } from '../src/store/dynamo.js';
import { localStores, memoryQuota } from '../src/store/local.js';
import { LockLostError, today } from '../src/store/types.js';
import { executeAction } from '../src/agents/executor.js';
import type { AwsClients } from '../src/aws.js';
import type { Approvals } from '../src/contract/approvals.js';
import { createTenants, type Tenant, UNLINKED_REASON } from '../src/tenants.js';
import type { ServerEvent } from '../src/world.js';
import { bearerSubprotocols, CLOSE_CODES } from '../../src/backend/contract.js';
import { fakeLlm, message, text } from './fakes.js';

const EXT = 'chrome-extension://storeid';
const SELF = '999999999999';

describe('config refuses unsafe setups', () => {
  it('token mode is loopback-only; hosted needs its settings', () => {
    expect(() => loadConfig({ HOST: '0.0.0.0' })).toThrow(ConfigError);
    expect(() => loadConfig({ AWS_CITY_MODE: 'hosted' })).toThrow(/COGNITO/);
    expect(loadConfig({}).authMode).toBe('token');
    const hosted = loadConfig({
      AWS_CITY_MODE: 'hosted', HOST: '0.0.0.0', PUBLIC_HOSTS: 'api.example.com', COGNITO_USER_POOL_ID: 'p', COGNITO_CLIENT_ID: 'c',
      EXTENSION_ORIGIN: EXT, TABLE_NAME: 't', SCREENSHOT_BUCKET: 'b', SELF_ACCOUNT_ID: SELF, PLAYER_ROLE_TEMPLATE_URL: 'https://x/t.yaml',
    });
    expect(hosted).toMatchObject({ authMode: 'cognito', awsMode: 'assume-role', store: 'dynamodb', uploads: 's3' });
  });

  it('signed-in players never share the operator’s profile account (cognito needs assume-role)', () => {
    const signedIn = { AUTH_MODE: 'cognito', COGNITO_USER_POOL_ID: 'p', COGNITO_CLIENT_ID: 'c', EXTENSION_ORIGIN: EXT };
    expect(() => loadConfig(signedIn)).toThrow(/AWS_MODE=assume-role/);
    expect(() => loadConfig({ ...signedIn, AWS_MODE: 'profile' })).toThrow(/AWS_MODE=assume-role/);
  });

  it('rejects typos and nonsense values instead of falling back to a looser mode', () => {
    expect(() => loadConfig({ AUTH_MODE: 'Cognito' })).toThrow(/AUTH_MODE=Cognito/);
    expect(() => loadConfig({ AWS_MODE: 'assume_role' })).toThrow(ConfigError);
    expect(() => loadConfig({ STORE: 'dynamo' })).toThrow(ConfigError);
    expect(() => loadConfig({ POLL_INTERVAL_MS: '0' })).toThrow(/POLL_INTERVAL_MS/);
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(/PORT/);
    expect(() => loadConfig({ AWS_CITY_TOKEN: 'short' })).toThrow(/AWS_CITY_TOKEN/);
    expect(loadConfig({ AWS_CITY_TOKEN: 'x'.repeat(32) }).token).toHaveLength(32);
  });
});

describe('metered model calls', () => {
  it('stops at the daily quota with a friendly, coded error', async () => {
    const { llm } = fakeLlm([message([text('a')], 'end_turn'), message([text('b')], 'end_turn')]);
    const m = metered(llm, { sub: 'u1', quota: memoryQuota(), daily: 1, globalDaily: 10, enabled: async () => true });
    await m.create({ max_tokens: 10, messages: [] });
    await expect(m.create({ max_tokens: 10, messages: [] })).rejects.toThrow(ModelLimitError);
    const seen: ServerEvent[] = [];
    withErrorCodes<ServerEvent>((e) => seen.push(e))({ type: 'error', message: `Chat failed: ${QUOTA_MESSAGE}` });
    expect(seen[0]).toMatchObject({ code: 'quota' });
  });

  it('a refusal is retried once on the fallback model, and the retry counts against the quota', async () => {
    const refused = { ...message([text('no')], 'end_turn'), stop_reason: 'refusal' } as Anthropic.Message;
    const { llm, calls } = fakeLlm([refused, message([text('ok')], 'end_turn')]);
    const quota = memoryQuota();
    const m = metered(llm, { sub: 'u1', quota, daily: 1, globalDaily: 10, enabled: async () => true });
    // Daily quota of 1: the fallback is a second call, so it's refused rather than run for free.
    await expect(m.create({ max_tokens: 10, messages: [] })).rejects.toThrow(QUOTA_MESSAGE);
    expect(calls).toHaveLength(1);
    const roomy = metered(fakeLlm([refused, message([text('ok')], 'end_turn')]).llm, { sub: 'u2', quota, daily: 5, globalDaily: 10, enabled: async () => true });
    expect((await roomy.create({ max_tokens: 10, messages: [] })).stop_reason).toBe('end_turn');
  });

  it('a global refusal doesn’t burn the player’s quota, and a player at their quota doesn’t burn the global one', async () => {
    const { llm } = fakeLlm([message([text('a')], 'end_turn'), message([text('b')], 'end_turn')]);
    const quota = memoryQuota();
    const full = metered(llm, { sub: 'u1', quota, daily: 1, globalDaily: 0, enabled: async () => true });
    await expect(full.create({ max_tokens: 10, messages: [] })).rejects.toMatchObject({ code: 'paused' });
    expect(await quota.used('u1', today())).toBe(0);
    const m = metered(llm, { sub: 'u1', quota, daily: 1, globalDaily: 10, enabled: async () => true });
    await m.create({ max_tokens: 10, messages: [] });
    await expect(m.create({ max_tokens: 10, messages: [] })).rejects.toMatchObject({ code: 'quota' });
    expect(await quota.used('GLOBAL', today())).toBe(1);
  });

  it('the kill switch blocks every call', async () => {
    const { llm } = fakeLlm([message([text('a')], 'end_turn')]);
    const m = metered(llm, { sub: 'u1', quota: memoryQuota(), daily: 100, globalDaily: 100, enabled: async () => false });
    await expect(m.create({ max_tokens: 10, messages: [] })).rejects.toMatchObject({ code: 'paused' });
    expect(llm.create).not.toHaveBeenCalled();
  });
});

describe('account linking', () => {
  const setup = (whoAmI: (roleArn: string) => { Account?: string; Arn?: string }) => {
    const stores = localStores('/tmp/aws-city-link-test.json');
    let lastArn = '';
    const linker = createAccountLinker({
      accounts: stores.accounts,
      templateUrl: 'https://templates.example/player-role/v1.yaml',
      selfAccountId: SELF,
      credentialsFor: (o) => {
        lastArn = o.roleArn;
        return async () => ({ accessKeyId: 'x', secretAccessKey: 'y' });
      },
      whoAmI: async () => whoAmI(lastArn),
    });
    return { linker, stores };
  };

  it('quick-create link carries a per-player ExternalId that survives re-linking', async () => {
    const { linker } = setup(() => ({}));
    const a = await linker.link('u1', 'eu-west-1');
    expect(a.url).toContain('https://eu-west-1.console.aws.amazon.com/cloudformation/home?region=eu-west-1#/stacks/quickcreate?');
    expect(a.url).toContain(`param_ExternalId=${a.externalId}`);
    expect(a.url).not.toContain('param_Trusted'); // trust is fixed in the published template
    expect((await linker.link('u1', 'eu-west-1')).externalId).toBe(a.externalId);
    expect((await linker.link('u2', 'eu-west-1')).externalId).not.toBe(a.externalId);
    await expect(linker.link('u1', 'not a region')).rejects.toThrow(/region/);
  });

  it('verify accepts an account id, checks who we really are, and refuses our own account', async () => {
    const { linker, stores } = setup((arn) => ({ Account: '111122223333', Arn: `arn:aws:sts::111122223333:assumed-role/${playerRoleName('us-west-2')}/aws-city-x` }));
    await linker.link('u1', 'us-west-2');
    const rec = await linker.verify('u1', '111122223333');
    expect(rec).toMatchObject({ status: 'linked', accountId: '111122223333', roleArn: `arn:aws:iam::111122223333:role/AWSCityPlayerRole-us-west-2` });
    expect((await stores.accounts.get('u1'))?.status).toBe('linked');
    await expect(linker.verify('u1', SELF)).rejects.toThrow(/own account/);
    await expect(linker.verify('u1', 'arn:aws:iam::111122223333:role/Admin')).rejects.toThrow(/account id/);
  });

  it('asking for a link in another Region keeps the linked account usable until verify succeeds', async () => {
    const { linker, stores } = setup((arn) => ({ Account: '111122223333', Arn: `arn:aws:sts::111122223333:assumed-role/${arn.split('/')[1]}/aws-city-x` }));
    await linker.link('u1', 'us-west-2');
    await linker.verify('u1', '111122223333');
    const before = await stores.accounts.get('u1');
    const again = await linker.link('u1', 'eu-west-1');
    expect(again.externalId).toBe(before!.externalId);
    // Still linked to us-west-2 (the role ARN and account id survive), with the new Region pending.
    expect(await stores.accounts.get('u1')).toEqual({ ...before, pendingRegion: 'eu-west-1' });
    const rec = await linker.verify('u1', '111122223333');
    expect(rec).toMatchObject({ status: 'linked', region: 'eu-west-1', roleArn: `arn:aws:iam::111122223333:role/${playerRoleName('eu-west-1')}` });
    expect(await stores.accounts.get('u1')).not.toHaveProperty('pendingRegion');
    // Asking for the linked Region again drops a pending one.
    await linker.link('u1', 'us-east-1');
    await linker.link('u1', 'eu-west-1');
    expect(await stores.accounts.get('u1')).not.toHaveProperty('pendingRegion');
  });

  it('a failed verify for the new Region leaves the old link in place', async () => {
    let fail = false;
    const { linker, stores } = setup((arn) => {
      if (fail) throw new Error('AccessDenied');
      return { Account: '111122223333', Arn: `arn:aws:sts::111122223333:assumed-role/${arn.split('/')[1]}/aws-city-x` };
    });
    await linker.link('u1', 'us-west-2');
    await linker.verify('u1', '111122223333');
    await linker.link('u1', 'eu-west-1');
    fail = true;
    await expect(linker.verify('u1', '111122223333')).rejects.toThrow(/eu-west-1/);
    expect(await stores.accounts.get('u1')).toMatchObject({ status: 'linked', region: 'us-west-2', accountId: '111122223333', roleArn: expect.stringContaining('us-west-2') });
  });

  it('verify refuses a role that turns out to be something else', async () => {
    const { linker } = setup(() => ({ Account: '444455556666', Arn: 'arn:aws:sts::444455556666:assumed-role/Other/x' }));
    await linker.link('u1', 'us-west-2');
    await expect(linker.verify('u1', '111122223333')).rejects.toThrow(/isn’t the AWSCity/);
  });
});

describe('DynamoDB store', () => {
  // Cast: aws-sdk-client-mock's types pin a slightly different @smithy version than lib-dynamodb.
  type Loose = {
    reset(): void;
    on(cmd: unknown): { resolves(v: unknown): Loose['on'] extends never ? never : ReturnType<Loose['on']>; rejects(e: unknown): ReturnType<Loose['on']>; resolvesOnce(v: unknown): ReturnType<Loose['on']>; rejectsOnce(e: unknown): ReturnType<Loose['on']> };
    commandCalls(cmd: unknown): { args: [{ input: Record<string, unknown> }] }[];
  };
  const ddb = mockClient(DynamoDBDocumentClient as never) as unknown as Loose;
  beforeEach(() => ddb.reset());
  const stores = () => dynamoStores({ client: new DynamoDBClient({ region: 'us-west-2' }), table: 'aws-city-test' });
  const conditional = () => new ConditionalCheckFailedException({ message: 'no', $metadata: {} });

  it('DELETE /me removes every page of items and retries throttled deletes', async () => {
    const item = (sk: string) => ({ pk: 'USER#u1', sk });
    ddb.on(QueryCommand).resolvesOnce({ Items: [item('A'), item('B')], LastEvaluatedKey: { pk: 'USER#u1', sk: 'B' } }).resolvesOnce({ Items: [item('C')] });
    ddb
      .on(BatchWriteCommand)
      .resolvesOnce({ UnprocessedItems: { 'aws-city-test': [{ DeleteRequest: { Key: item('B') } }] } })
      .resolves({});
    await stores().deleteUser('u1');
    expect(ddb.commandCalls(QueryCommand)).toHaveLength(2);
    const deleted = ddb.commandCalls(BatchWriteCommand).flatMap((c) => (c.args[0].input.RequestItems as Record<string, { DeleteRequest: { Key: { sk: string } } }[]>)['aws-city-test']!.map((r) => r.DeleteRequest.Key.sk));
    expect(deleted).toEqual(['A', 'B', 'B', 'C']);
  });

  it('progress: newest wins atomically, an older copy is accepted but not written', async () => {
    ddb.on(PutCommand).rejects(conditional());
    const out = await stores().progress.put('u1', { version: 1, landmarks: {}, updatedAt: '2026-01-01T00:00:00.000Z' });
    expect(out).toEqual({ ok: true });
    const put = ddb.commandCalls(PutCommand)[0]!.args[0].input;
    expect(put).toMatchObject({ Item: { pk: 'USER#u1', sk: 'PROGRESS' }, ConditionExpression: expect.stringContaining('updatedAt <= :u') });
    expect((await stores().progress.put('u1', { version: 1, landmarks: {}, updatedAt: 'nope' })).ok).toBe(false);
  });

  it('quota: a conditional ADD, false when the limit is reached', async () => {
    ddb.on(UpdateCommand).resolvesOnce({}).rejectsOnce(conditional());
    const s = stores();
    expect(await s.quota.consume('u1', '2026-09-25', 100)).toBe(true);
    expect(await s.quota.consume('u1', '2026-09-25', 100)).toBe(false);
    expect(ddb.commandCalls(UpdateCommand)[0]!.args[0].input).toMatchObject({ Key: { pk: 'USER#u1', sk: 'QUOTA#2026-09-25' }, ExpressionAttributeValues: { ':limit': 100 } });
  });

  it('account lock: a lease per AWS account, released by its owner', async () => {
    ddb.on(PutCommand).resolves({});
    ddb.on(DeleteCommand).resolves({});
    ddb.on(GetCommand).resolves({});
    const result = await stores().locks.withLock('111122223333', async () => 'done');
    expect(result).toBe('done');
    const lock = ddb.commandCalls(PutCommand)[0]!.args[0].input;
    expect(lock).toMatchObject({ Item: { pk: 'AWSACCT#111122223333', sk: 'LOCK' }, ConditionExpression: 'attribute_not_exists(pk) OR expiresAt < :now' });
    expect(ddb.commandCalls(DeleteCommand)[0]!.args[0].input).toMatchObject({ Key: { pk: 'AWSACCT#111122223333', sk: 'LOCK' }, ConditionExpression: '#o = :o' });
  });

  it('account lock: the lease is renewed by its owner while held, and no longer once released', async () => {
    ddb.on(PutCommand).resolves({});
    ddb.on(DeleteCommand).resolves({});
    ddb.on(UpdateCommand).resolves({});
    const s = dynamoStores({ client: new DynamoDBClient({ region: 'us-west-2' }), table: 'aws-city-test', renewMs: 20 });
    // Longer than a lease would last unrenewed at this pace (a fix waiting for the player's approval).
    await s.locks.withLock('111122223333', () => new Promise((r) => setTimeout(r, 110)));
    const owner = (ddb.commandCalls(PutCommand)[0]!.args[0].input.Item as { owner: string }).owner;
    const renewals = ddb.commandCalls(UpdateCommand);
    expect(renewals.length).toBeGreaterThanOrEqual(2);
    expect(renewals[0]!.args[0].input).toMatchObject({ Key: { pk: 'AWSACCT#111122223333', sk: 'LOCK' }, ConditionExpression: '#o = :o', ExpressionAttributeValues: { ':o': owner } });
    await new Promise((r) => setTimeout(r, 80));
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(renewals.length);
  });

  it('account lock: a lease taken by another task aborts, so the holder stops before its next AWS write', async () => {
    ddb.on(PutCommand).resolves({});
    ddb.on(DeleteCommand).resolves({});
    ddb.on(UpdateCommand).rejects(conditional()); // someone else owns the lock now
    const s = dynamoStores({ client: new DynamoDBClient({ region: 'us-west-2' }), table: 'aws-city-test', renewMs: 20 });
    const seen = await s.locks.withLock('111122223333', async (lease) => {
      expect(lease.aborted).toBe(false);
      await new Promise((r) => setTimeout(r, 80));
      return lease;
    });
    expect(seen.aborted).toBe(true);
    expect(() => seen.throwIfAborted()).toThrow(LockLostError);

    // executeAction checks the lease before writing: no RunInstances/StopInstances call goes out.
    const sent: string[] = [];
    const ec2 = { send: async (c: { constructor: { name: string } }) => (sent.push(c.constructor.name), { Images: [{ ImageId: 'ami-1', CreationDate: '2026' }] }), config: { region: async () => 'us-west-2' } };
    const clients = { ec2 } as unknown as AwsClients;
    const out = await executeAction({ type: 'stop_instance', instanceId: 'i-1' }, clients, { accountId: SELF, region: 'us-west-2', takenAt: '', resources: [] } as never, 'us-west-2', seen);
    expect(out).toEqual({ ok: false, message: expect.stringContaining('stopped before changing anything else') });
    await executeAction({ type: 'launch_instance', instanceType: 't4g.nano', name: 'web' }, clients, { accountId: SELF, resources: [] } as never, 'us-west-2', seen);
    expect(sent).toEqual(['DescribeImagesCommand']); // the AMI lookup is a read; the launch never went out
  });

  it('account lock: a lease that stops renewing aborts before it can expire', async () => {
    ddb.on(PutCommand).resolves({});
    ddb.on(DeleteCommand).resolves({});
    ddb.on(UpdateCommand).rejects(new Error('network'));
    let t = 0;
    const s = dynamoStores({ client: new DynamoDBClient({ region: 'us-west-2' }), table: 'aws-city-test', renewMs: 10, now: () => t });
    const seen = await s.locks.withLock('111122223333', async (lease) => {
      t = 15_000;
      await new Promise((r) => setTimeout(r, 40));
      expect(lease.aborted).toBe(false); // renewals failing, but the lease is still good for a while
      t = 30_000;
      await new Promise((r) => setTimeout(r, 40));
      return lease;
    });
    expect(seen.aborted).toBe(true);
  });

  it('DELETE /me: the tombstone is written before anything is deleted, and expires', async () => {
    ddb.on(PutCommand).resolves({});
    ddb.on(QueryCommand).resolves({ Items: [] });
    let t = 1_000;
    const s = dynamoStores({ client: new DynamoDBClient({ region: 'us-west-2' }), table: 'aws-city-test', now: () => t });
    await s.deleteUser('u1');
    const tomb = ddb.commandCalls(PutCommand)[0]!.args[0].input;
    expect(tomb).toMatchObject({ Item: { pk: 'DELETED#u1', sk: 'TOMBSTONE', until: 1_000 + 2 * 60 * 60_000 } });
    ddb.on(GetCommand).resolves({ Item: tomb.Item });
    expect(await s.deletedRecently('u1')).toBe(true);
    expect(ddb.commandCalls(GetCommand)[0]!.args[0].input).toMatchObject({ Key: { pk: 'DELETED#u1', sk: 'TOMBSTONE' }, ConsistentRead: true });
    t += 2 * 60 * 60_000 + 1; // TTL deletes lazily: `until` decides
    expect(await s.deletedRecently('u1')).toBe(false);
  });

  it('bill: the switch is set in place (the cached read is never rewritten), creating the record the first time', async () => {
    ddb.on(UpdateCommand).rejectsOnce(conditional()).resolves({});
    ddb.on(PutCommand).resolves({});
    const s = stores();
    await s.bills.setOn('u1', true);
    const update = ddb.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(update).toMatchObject({ Key: { pk: 'USER#u1', sk: 'BILL' }, UpdateExpression: 'SET #r.#on = :on', ConditionExpression: 'attribute_exists(#r)', ExpressionAttributeValues: { ':on': true } });
    expect(ddb.commandCalls(PutCommand)[0]!.args[0].input).toMatchObject({ Item: { pk: 'USER#u1', sk: 'BILL', record: { on: true } }, ConditionExpression: 'attribute_not_exists(pk)' });
    await s.bills.setOn('u1', false);
    expect(ddb.commandCalls(PutCommand)).toHaveLength(1); // exists now: an update only
  });

  it('bill: a read is saved only while the bill is on, and never writes `on`', async () => {
    ddb.on(UpdateCommand).resolvesOnce({}).rejectsOnce(conditional());
    const s = stores();
    const read = { bill: { type: 'city.bill' as const, unavailable: 'x', takenAt: '' }, fetchedAt: 1, retryMs: 2, accountId: undefined };
    expect(await s.bills.saveRead('u1', read)).toBe(true);
    expect(await s.bills.saveRead('u1', read)).toBe(false);
    const input = ddb.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input).toMatchObject({ Key: { pk: 'USER#u1', sk: 'BILL' }, ConditionExpression: '#r.#on = :on', ExpressionAttributeValues: { ':on': true } });
    expect(String(input.UpdateExpression)).not.toContain('#on');
    expect(Object.values(input.ExpressionAttributeNames as Record<string, string>)).not.toContain('accountId'); // undefined fields are left alone
  });
});

describe('screenshots are scoped to their owner', () => {
  it("one player can't read another's upload", async () => {
    const store = createUploadStore('http://127.0.0.1:1');
    const { screenshotKey, uploadUrl } = await store.create('image/jpeg', 'alice');
    const sig = new URL(uploadUrl).searchParams.get('sig')!;
    expect(store.accept(screenshotKey, sig, Buffer.from('img'))).toBe(true);
    expect(await store.get(screenshotKey, 'alice')).toBeDefined();
    expect(await store.get(screenshotKey, 'bob')).toBeUndefined();
  });
});

// ── End to end: signed-in players over the socket, each in their own city ──
describe('hosted server: Cognito players and tenants', () => {
  let port: number;
  let close: () => void;
  const verifier: JwtVerifier = {
    async verify(token) {
      if (token === 'jwt-alice') return { sub: 'alice' };
      if (token === 'jwt-bob') return { sub: 'bob' };
      if (token === 'jwt-carol') return { sub: 'carol' };
      if (token === 'jwt-frank') return { sub: 'frank' };
      // A token that expires the moment the socket opens.
      if (token === 'jwt-dave') return { sub: 'dave', exp: Math.floor(Date.now() / 1000) };
      throw new Error('bad');
    },
  };

  beforeAll(async () => {
    const base = loadConfig({});
    const config = { ...base, authMode: 'cognito' as const, extensionOrigins: [EXT], port: 0 };
    const stores = localStores(`/tmp/aws-city-hosted-${Date.now()}.json`);
    const { llm } = fakeLlm([]);
    const uploads = createUploadStore('http://127.0.0.1:1');
    const tenants = createTenants({ config, stores, uploads, llm, enabled: async () => true, awsFor: () => undefined, walkMs: 0 });
    // carol hasn't turned MFA on yet.
    const mfaReady = async (p: { sub: string }) => p.sub !== 'carol';
    const deleted = (sub: string) => stores.deletedRecently(sub);
    const probe = createHttpServer({ config, tenants, authenticate: cognitoAuth(config, verifier), uploads, mfaReady, deleted });
    await new Promise<void>((r) => probe.server.listen(0, '127.0.0.1', r));
    port = (probe.server.address() as AddressInfo).port;
    probe.server.close();
    const { server } = createHttpServer({ config: { ...config, port }, tenants, authenticate: cognitoAuth(config, verifier), uploads, mfaReady, deleted });
    await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
    close = () => server.close();
  });
  afterAll(() => close());

  const open = (jwt?: string, query = '') =>
    new Promise<{ ws?: WebSocket; status?: number; events: ServerEvent[] }>((resolve) => {
      const events: ServerEvent[] = [];
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`, jwt ? bearerSubprotocols(jwt) : [], { origin: EXT });
      ws.on('message', (raw) => events.push(JSON.parse(raw.toString())));
      ws.on('open', async () => {
        for (const end = Date.now() + 3000; events.length === 0 && Date.now() < end; ) await new Promise((r) => setTimeout(r, 10));
        resolve({ ws, events });
      });
      ws.on('unexpected-response', (_q, res) => resolve({ status: res.statusCode, events }));
    });

  it('needs a valid Cognito token in the subprotocol, never in the URL', async () => {
    expect((await open()).status).toBe(401);
    expect((await open('forged')).status).toBe(401);
    expect((await open(undefined, '?token=jwt-alice')).status).toBe(401);
    const { ws, events } = await open('jwt-alice');
    expect(ws!.protocol).toBe('base64UrlBearerAuthorization');
    expect(events[0]).toMatchObject({ type: 'account.status', linked: false });
    ws!.close();
  });

  it('per-player socket cap holds even when tabs connect at the same instant', async () => {
    const all = await Promise.all(Array.from({ length: 8 }, () => open('jwt-alice')));
    const opened = all.filter((r) => r.ws);
    expect(opened.length).toBe(4);
    expect(all.filter((r) => r.status === 429).length).toBe(4);
    for (const r of opened) r.ws!.close();
    await new Promise((r) => setTimeout(r, 100));
    // Slots are given back on close.
    const again = await open('jwt-alice');
    expect(again.ws).toBeDefined();
    again.ws!.close();
  });

  it('clients that drop mid-handshake give their slot back', async () => {
    const { connect } = await import('node:net');
    const b64 = Buffer.from('jwt-alice').toString('base64url');
    for (let i = 0; i < 6; i++) {
      await new Promise<void>((resolve) => {
        const s = connect(port, '127.0.0.1', () => {
          s.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${EXT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
            `Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Protocol: base64UrlBearerAuthorization.${b64}, base64UrlBearerAuthorization\r\n\r\n`);
          s.resetAndDestroy(); // gone before the server finishes the upgrade
          resolve();
        });
      });
    }
    await new Promise((r) => setTimeout(r, 200));
    const tabs = await Promise.all(Array.from({ length: 4 }, () => open('jwt-alice')));
    expect(tabs.every((t) => t.ws)).toBe(true);
    for (const t of tabs) t.ws!.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  it('REST progress is per player', async () => {
    const put = (jwt: string, xp: number) =>
      fetch(`http://127.0.0.1:${port}/progress`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json', origin: EXT },
        body: JSON.stringify({ version: 1, landmarks: { s3: { discovered: true, xp } }, updatedAt: new Date().toISOString() }),
      });
    expect((await put('jwt-alice', 42)).status).toBe(204);
    const get = (jwt: string) => fetch(`http://127.0.0.1:${port}/progress`, { headers: { authorization: `Bearer ${jwt}`, origin: EXT } });
    expect(((await (await get('jwt-alice')).json()) as { landmarks: { s3: { xp: number } } }).landmarks.s3.xp).toBe(42);
    expect((await get('jwt-bob')).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/me`, { method: 'DELETE', headers: { authorization: 'Bearer jwt-alice', origin: EXT } })).status).toBe(204);
    // Deleted: the still-valid token can neither read nor recreate the progress.
    expect((await get('jwt-alice')).status).toBe(410);
    expect((await put('jwt-alice', 7)).status).toBe(410);
    expect((await get('jwt-bob')).status).toBe(404);
  });

  it('an unlinked player can learn but agents refuse to build', async () => {
    expect(UNLINKED_REASON).toMatch(/Connect your AWS account/);
    const { ws, events } = await open('jwt-bob');
    ws!.send(JSON.stringify({ action: 'account.link', requestId: 'r1', region: 'us-west-2' }));
    for (const end = Date.now() + 3000; !events.some((e) => 'requestId' in e && e.requestId === 'r1') && Date.now() < end; ) await new Promise((r) => setTimeout(r, 10));
    // No linker configured in this test → the server just reports the (unlinked) status.
    expect(events).toContainEqual(expect.objectContaining({ type: 'account.status', requestId: 'r1', linked: false }));
    ws!.close();
  });

  it('a socket does not outlive its token: it closes for re-auth once idle', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, bearerSubprotocols('jwt-dave'), { origin: EXT });
    const code = await new Promise<number>((r) => ws.on('close', (c) => r(c)));
    expect(code).toBe(4401);
  });

  it('deleting the account closes that player’s open sockets for good: no reconnect, no data recreated', async () => {
    const { ws } = await open('jwt-frank');
    const closed = new Promise<number>((r) => ws!.on('close', (c) => r(c)));
    expect((await fetch(`http://127.0.0.1:${port}/me`, { method: 'DELETE', headers: { authorization: 'Bearer jwt-frank', origin: EXT } })).status).toBe(204);
    expect(await closed).toBe(CLOSE_CODES.deleted); // terminal: the client signs out instead of reconnecting
    // A client that reconnects anyway with its still-valid token is refused at the handshake.
    expect((await open('jwt-frank')).status).toBe(410);
    const put = await fetch(`http://127.0.0.1:${port}/progress`, {
      method: 'PUT',
      headers: { authorization: 'Bearer jwt-frank', 'content-type': 'application/json', origin: EXT },
      body: JSON.stringify({ version: 1, landmarks: {}, updatedAt: new Date().toISOString() }),
    });
    expect(put.status).toBe(410);
  });

  it('linking an AWS account needs MFA first', async () => {
    const { ws, events } = await open('jwt-carol');
    ws!.send(JSON.stringify({ action: 'account.link', requestId: 'm1', region: 'us-west-2' }));
    for (const end = Date.now() + 3000; !events.some((e) => 'requestId' in e && e.requestId === 'm1') && Date.now() < end; ) await new Promise((r) => setTimeout(r, 10));
    expect(events).toContainEqual(expect.objectContaining({ type: 'error', requestId: 'm1', code: 'mfa_required' }));
    // Spamming account commands is refused before any AWS call.
    ws!.send(JSON.stringify({ action: 'account.link', requestId: 'm2', region: 'us-west-2' }));
    for (const end = Date.now() + 3000; !events.some((e) => 'requestId' in e && e.requestId === 'm2') && Date.now() < end; ) await new Promise((r) => setTimeout(r, 10));
    expect(events).toContainEqual(expect.objectContaining({ type: 'error', requestId: 'm2', message: expect.stringMatching(/few seconds/) }));
    ws!.close();
  });
});

describe('MFA step-up check', () => {
  const cognito = (user: { UserStatus?: string; UserMFASettingList?: string[] }) => {
    const send = vi.fn(async (_cmd: unknown) => user);
    return { send } as unknown as { send: typeof send };
  };

  it('needs TOTP for email players, trusts Google for federated ones, and asks Cognito by username', async () => {
    const none = cognito({ UserStatus: 'CONFIRMED', UserMFASettingList: [] });
    expect(await createMfaCheck({ cognito: none as never, userPoolId: 'p' })({ sub: 's1' })).toBe(false);
    const totp = cognito({ UserStatus: 'CONFIRMED', UserMFASettingList: ['SOFTWARE_TOKEN_MFA'] });
    const check = createMfaCheck({ cognito: totp as never, userPoolId: 'p' });
    expect(await check({ sub: 's1' })).toBe(true);
    expect(await check({ sub: 's1' })).toBe(true);
    expect(totp.send).toHaveBeenCalledTimes(1); // a yes is cached
    const google = cognito({ UserStatus: 'EXTERNAL_PROVIDER' });
    expect(await createMfaCheck({ cognito: google as never, userPoolId: 'p' })({ sub: 's2', username: 'google_123' })).toBe(true);
    expect((google.send.mock.calls[0]![0] as { input: { Username: string } }).input.Username).toBe('google_123');
  });

  it('a cached yes expires, so turning MFA off is noticed', async () => {
    let t = 0;
    const user = { UserStatus: 'CONFIRMED', UserMFASettingList: ['SOFTWARE_TOKEN_MFA'] };
    const c = cognito(user);
    const check = createMfaCheck({ cognito: c as never, userPoolId: 'p', cacheMs: 1000, now: () => t });
    expect(await check({ sub: 's1' })).toBe(true);
    user.UserMFASettingList = [];
    t = 999;
    expect(await check({ sub: 's1' })).toBe(true);
    t = 61_000;
    expect(await check({ sub: 's1' })).toBe(false);
    expect(c.send).toHaveBeenCalledTimes(2);
  });

  it('by default a yes is trusted for 60 s at most', async () => {
    let t = 0;
    const user = { UserStatus: 'CONFIRMED', UserMFASettingList: ['SOFTWARE_TOKEN_MFA'] };
    const c = cognito(user);
    const check = createMfaCheck({ cognito: c as never, userPoolId: 'p', now: () => t });
    expect(await check({ sub: 's1' })).toBe(true);
    user.UserMFASettingList = [];
    t = 59_999;
    expect(await check({ sub: 's1' })).toBe(true); // still cached
    t = 60_000;
    expect(await check({ sub: 's1' })).toBe(false); // MFA turned off: writes stop within a minute
    expect(c.send).toHaveBeenCalledTimes(2);
  });
});

// Every AWS write is approved through deploy.approve (task writes) or started by finding.fix: both need MFA on.
describe('MFA step-up for writes', () => {
  it('deploy.approve and finding.fix are refused while MFA is off; the preview waits until it is on', async () => {
    let mfa = false;
    const fix = vi.fn(async (requestId: string, _f: string, emit: (e: ServerEvent) => void) => emit({ type: 'error', requestId, message: 'fixed' }));
    const tenant = {
      sub: 'erin',
      region: 'us-west-2',
      orchestrator: () => ({
        submitTask: async (cmd: { taskId: string }, emit: (e: ServerEvent) => void, approvals: Approvals) => {
          const ok = await approvals.request(cmd.taskId, { action: { type: 'create_table', name: 'city-x' } as never, summary: 'Create table', destructive: false }, emit);
          emit({ type: 'task.done', taskId: cmd.taskId, ok, result: '', xp: [] });
        },
      }),
      care: () => ({ fix, explain: async () => undefined, undo: () => undefined }),
      createCopilot: () => undefined,
      welcome: async () => [],
      subscribe: () => () => undefined,
      emitter: (emit: unknown) => emit,
    } as unknown as Tenant;
    const tenants = { acquire: async () => tenant, data: () => tenant, release: () => undefined, closeAll: () => undefined };
    const base = { ...loadConfig({}), authMode: 'cognito' as const, extensionOrigins: [EXT] };
    const deps = { tenants, authenticate: async () => ({ sub: 'erin' }), mfaReady: async () => mfa };
    const probe = createHttpServer({ config: { ...base, port: 0 }, ...deps });
    await new Promise<void>((r) => probe.server.listen(0, '127.0.0.1', r));
    const port = (probe.server.address() as AddressInfo).port;
    probe.server.close();
    const { server } = createHttpServer({ config: { ...base, port }, ...deps });
    await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
    const events: ServerEvent[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, bearerSubprotocols('x'), { origin: EXT });
    ws.on('message', (raw) => events.push(JSON.parse(raw.toString())));
    await new Promise((r) => ws.on('open', r));
    const until = async (ok: () => boolean) => {
      for (const end = Date.now() + 3000; !ok() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 10));
    };
    try {
      ws.send(JSON.stringify({ action: 'task.submit', taskId: 't1', prompt: 'make a table', context: {} }));
      await until(() => events.some((e) => e.type === 'deploy.preview'));
      const { deployId } = events.find((e) => e.type === 'deploy.preview') as { deployId: string };
      ws.send(JSON.stringify({ action: 'deploy.approve', deployId }));
      ws.send(JSON.stringify({ action: 'finding.fix', requestId: 'f1', findingId: 'x' }));
      await until(() => events.filter((e) => e.type === 'error').length >= 2);
      expect(events).toContainEqual(expect.objectContaining({ type: 'error', code: 'mfa_required' }));
      expect(events).toContainEqual(expect.objectContaining({ type: 'error', requestId: 'f1', code: 'mfa_required' }));
      expect(fix).not.toHaveBeenCalled();
      expect(events.some((e) => e.type === 'task.done' || e.type === 'deploy.status')).toBe(false);

      mfa = true;
      ws.send(JSON.stringify({ action: 'deploy.approve', deployId }));
      ws.send(JSON.stringify({ action: 'finding.fix', requestId: 'f2', findingId: 'x' }));
      await until(() => events.some((e) => e.type === 'task.done') && fix.mock.calls.length > 0);
      expect(events).toContainEqual(expect.objectContaining({ type: 'deploy.status', deployId, status: 'creating' }));
      expect(events).toContainEqual(expect.objectContaining({ type: 'task.done', taskId: 't1', ok: true }));
      expect(fix).toHaveBeenCalledWith('f2', 'x', expect.any(Function), expect.anything());
    } finally {
      ws.close();
      server.close();
    }
  });
});
