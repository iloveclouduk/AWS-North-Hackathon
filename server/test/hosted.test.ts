import type { AddressInfo } from 'node:net';
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createAccountLinker, playerRoleName } from '../src/accounts/link.js';
import { metered, ModelLimitError, QUOTA_MESSAGE, withErrorCodes } from '../src/agents/metered.js';
import { cognitoAuth, type JwtVerifier } from '../src/auth.js';
import { ConfigError, loadConfig } from '../src/config.js';
import { createUploadStore } from '../src/contract/uploads.js';
import { createHttpServer } from '../src/http.js';
import { dynamoStores } from '../src/store/dynamo.js';
import { localStores, memoryQuota } from '../src/store/local.js';
import { createTenants, UNLINKED_REASON } from '../src/tenants.js';
import type { ServerEvent } from '../src/world.js';
import { bearerSubprotocols } from '../../src/backend/contract.js';
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
      taskRoleName: 'AWSCityTaskRole',
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
    expect(a.url).toContain(`param_TrustedAccountId=${SELF}`);
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
    const probe = createHttpServer({ config, tenants, authenticate: cognitoAuth(config, verifier), uploads });
    await new Promise<void>((r) => probe.server.listen(0, '127.0.0.1', r));
    port = (probe.server.address() as AddressInfo).port;
    probe.server.close();
    const { server } = createHttpServer({ config: { ...config, port }, tenants, authenticate: cognitoAuth(config, verifier), uploads });
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
    expect((await get('jwt-alice')).status).toBe(404);
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
});
