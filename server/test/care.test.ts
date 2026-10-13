import { DescribeContinuousBackupsCommand, DynamoDBClient, UpdateContinuousBackupsCommand } from '@aws-sdk/client-dynamodb';
import { DescribeAvailabilityZonesCommand, DescribeRegionsCommand, EC2Client, GetEbsEncryptionByDefaultCommand } from '@aws-sdk/client-ec2';
import { ListIndexesCommand, ResourceExplorer2Client, SearchCommand } from '@aws-sdk/client-resource-explorer-2';
import { GetResourcesCommand, ResourceGroupsTaggingAPIClient } from '@aws-sdk/client-resource-groups-tagging-api';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { citizenLevel, createCityCare } from '../src/agents/care.js';
import { diffFindings, findingId, findingsFor } from '../src/agents/findings.js';
import type { AgentRunner } from '../src/agents/runner.js';
import type { AwsClients } from '../src/aws.js';
import { createApprovals } from '../src/contract/approvals.js';
import { enrich, GEO_RETRY_MS, inventoryEvent, readGeo, readInventory, serviceForArn } from '../src/state/inventory.js';
import type { Resource } from '../src/state/model.js';
import { LockLostError } from '../src/store/types.js';
import type { CityFinding, Progress, ServerEvent } from '../src/world.js';
import { ACCOUNT, bucket, instance, snapshot, table } from './fixtures.js';

const sg = (id: string, adminOpenToWorld: boolean): Resource => ({ id, service: 'ec2', kind: 'security-group', name: id, state: '1 inbound rule', managedByGame: false, meta: { adminOpenToWorld } });

describe('findings: rules over what the city read', () => {
  const world = snapshot(
    [
      { ...bucket(`aws-city-${ACCOUNT}-open`), meta: { bpa: '0000' } },
      { ...bucket('someone-elses'), meta: { bpa: null } }, // unknown: never a finding
      { ...bucket('split'), meta: { bpa: '1100' } }, // the account covers the other two: fully blocked
      { ...instance('i-off', 'running'), meta: { httpTokens: 'optional', httpEndpoint: 'disabled', availabilityZone: 'us-west-2b' } }, // no metadata at all
      sg('sg-1', true),
      sg('sg-2', false),
      { ...instance('i-1', 'running'), meta: { httpTokens: 'optional', availabilityZone: 'us-west-2a' } },
      { ...table('city-orders'), meta: { pitr: false } },
      { ...table('other'), meta: { pitr: true } },
    ],
    { account: { s3AccountBpa: '0011', ebsEncryptionByDefault: false, trails: 2 } },
  );

  it('raises one finding per rule hit, with the citizen, district and fix scope', () => {
    const f = findingsFor(world);
    expect(f.map((x) => x.ruleId).sort()).toEqual(['dynamodb-no-pitr', 'ebs-default-encryption', 'ec2-imdsv1', 's3-public-access', 'sg-world-admin']);
    const bpa = f.find((x) => x.ruleId === 's3-public-access')!;
    expect(bpa).toMatchObject({ citizenId: 'citizen:security', pillar: 'security', severity: 'high', districtId: 'storage', fix: { fixId: 's3_block_public_access', scope: 'game' } });
    expect(bpa.text).toContain(`aws-city-${ACCOUNT}-open`);
    expect(f.find((x) => x.ruleId === 'ebs-default-encryption')!.fix!.scope).toBe('account');
    expect(f.find((x) => x.ruleId === 'sg-world-admin')!.fix!.scope).toBe('account'); // not built by the city
  });

  it('cost, performance and sustainability citizens have work too', () => {
    const s = snapshot(
      [
        { ...instance('i-old', 'running'), meta: { instanceType: 'm4.large', availabilityZone: 'us-west-2a' } },
        { ...instance('i-x86', 'running'), meta: { instanceType: 't3.micro', availabilityZone: 'us-west-2b' } },
        { ...instance('i-arm', 'running'), meta: { instanceType: 't4g.micro', availabilityZone: 'us-west-2c' } },
      ],
      { account: { unattachedVolumes: [{ id: 'vol-1', name: 'old-disk', sizeGiB: 8 }] } },
    );
    const f = findingsFor(s);
    expect(f.map((x) => `${x.ruleId}:${x.resource.id}`).sort()).toEqual(['ebs-unattached:vol-1', 'ec2-graviton-candidate:i-x86', 'ec2-previous-generation:i-old']);
    expect(new Set(f.map((x) => x.citizenId))).toEqual(new Set(['citizen:cost', 'citizen:performance', 'citizen:sustainability']));
    expect(f.every((x) => x.why)).toBe(true);
  });

  it("doesn't call a bucket exposed when the account blocks public access, or when a setting is unknown", () => {
    expect(findingsFor({ ...world, account: { ...world.account, s3AccountBpa: '1111' } }).some((x) => x.ruleId === 's3-public-access')).toBe(false);
    expect(findingsFor({ ...world, account: {} }).map((x) => x.ruleId)).not.toContain('ebs-default-encryption');
  });

  it('keeps ids stable and reports what opened and resolved', () => {
    expect(findingId('r', 'x')).toBe(findingId('r', 'x'));
    const first = findingsFor(world);
    const prev = new Map(first.map((x) => [x.id, x]));
    const fixedTable = findingsFor({ ...world, resources: world.resources.map((r) => (r.id === 'city-orders' ? { ...r, meta: { pitr: true } } : r)) });
    const changes = diffFindings(prev, fixedTable);
    expect(changes).toEqual([expect.objectContaining({ ruleId: 'dynamodb-no-pitr', status: 'resolved' })]);
  });
});

describe('inventory: the account mirrored as city buildings', () => {
  const explorer = mockClient(ResourceExplorer2Client);
  const tagging = mockClient(ResourceGroupsTaggingAPIClient);
  const clients = { explorer: new ResourceExplorer2Client({}), tagging: new ResourceGroupsTaggingAPIClient({}) } as unknown as AwsClients;
  beforeEach(() => {
    explorer.reset();
    tagging.reset();
  });

  it('maps ARNs to landmarks, and unknown types to a "?" lot', () => {
    expect(serviceForArn('arn:aws:ec2:us-west-2:1:volume/vol-1')).toMatchObject({ serviceId: 'ebs', type: 'ec2:volume' });
    expect(serviceForArn('arn:aws:rds:us-west-2:1:cluster:shop')).toMatchObject({ serviceId: 'aurora', name: 'shop' });
    expect(serviceForArn('arn:aws:sns:us-west-2:1:alerts')).toMatchObject({ serviceId: 'sqs' });
    expect(serviceForArn('arn:aws:states:us-west-2:1:stateMachine:flow')).toMatchObject({ serviceId: null });
  });

  it('uses Resource Explorer when there is an index (complete), else the tagging API (partial)', async () => {
    explorer.on(ListIndexesCommand).resolves({ Indexes: [{ Region: 'us-west-2', Type: 'LOCAL' }] });
    explorer.on(SearchCommand).resolves({ Resources: [{ Arn: 'arn:aws:s3:::b1' }, { Arn: 'arn:aws:lambda:us-west-2:1:function:f' }] });
    expect(await readInventory(clients, 'us-west-2')).toMatchObject({ source: 'resource-explorer', complete: true, items: [{ serviceId: 's3' }, { serviceId: 'lambda' }] });

    explorer.on(ListIndexesCommand).resolves({ Indexes: [] });
    tagging.on(GetResourcesCommand).resolves({ ResourceTagMappingList: [{ ResourceARN: 'arn:aws:dynamodb:us-west-2:1:table/city-x', Tags: [{ Key: 'managed-by', Value: 'aws-city' }] }] });
    expect(await readInventory(clients, 'us-west-2')).toMatchObject({ source: 'tagging', complete: false, items: [{ serviceId: 'dynamodb', managedByGame: true }] });
  });

  it('an aggregator index lists every Region; links come from global tables and Multi-AZ standbys', async () => {
    explorer.on(ListIndexesCommand).resolves({ Indexes: [{ Region: 'us-west-2', Type: 'AGGREGATOR' }] });
    explorer.on(SearchCommand).resolves({
      Resources: [
        { Arn: 'arn:aws:ec2:us-west-2:1:instance/i-1', Region: 'us-west-2' },
        { Arn: 'arn:aws:dynamodb:eu-west-1:1:table/city-orders', Region: 'eu-west-1' },
      ],
    });
    const inv = (await readInventory(clients, 'us-west-2'))!;
    expect(inv.allRegions).toBe(true);
    expect(explorer.commandCalls(SearchCommand)[0]!.args[0].input.QueryString).toBe('');
    const world = snapshot([
      { ...instance('i-1', 'running'), meta: { availabilityZone: 'us-west-2a' } },
      { ...table('city-orders'), meta: { replicas: 'eu-west-1' } },
      { id: 'shop', service: 'rds', kind: 'db-instance', name: 'shop', state: 'available', managedByGame: false, meta: { multiAz: true, availabilityZone: 'us-west-2a', secondaryAz: 'us-west-2b' } },
    ]);
    const { items, links } = enrich(inv, world, 'us-west-2');
    expect(items[0]).toMatchObject({ region: 'us-west-2', az: 'us-west-2a' });
    expect(links.map((l) => [l.kind, l.from, l.to])).toEqual([
      ['replication', { region: 'us-west-2' }, { region: 'eu-west-1' }],
      ['standby', { region: 'us-west-2', az: 'us-west-2a' }, { region: 'us-west-2', az: 'us-west-2b' }],
    ]);
    const e = inventoryEvent({ ...inv, items }, 'us-west-2', undefined, links);
    expect(e.regions).toEqual({ 'us-west-2': 1, 'eu-west-1': 1 });
    expect(e.counts).toEqual({ ec2: 1 }); // the home city counts only its own Region
  });
});

describe('inventory: the real AZ map and Region opt-ins (v2.5)', () => {
  type Handler = (cmd: unknown) => Promise<unknown>;
  /** A stand-in SDK client (the prototypes are already mocked by the other blocks here). */
  const fake = (handler: Handler) => ({ send: vi.fn(handler) });
  const calls = (c: ReturnType<typeof fake>, Cmd: abstract new (...a: never[]) => unknown) => c.send.mock.calls.filter(([cmd]) => cmd instanceof Cmd).map(([cmd]) => (cmd as { input: unknown }).input);
  const denied = (name = 'UnauthorizedOperation') => Promise.reject(Object.assign(new Error('You are not authorized to perform this operation.'), { name }));
  const az = (ZoneName: string, ZoneId: string, ZoneType = 'availability-zone') => ({ ZoneName, ZoneId, ZoneType });
  const regions = { Regions: [{ RegionName: 'us-west-2', OptInStatus: 'opt-in-not-required' }, { RegionName: 'af-south-1', OptInStatus: 'not-opted-in' }, { RegionName: 'eu-south-1', OptInStatus: 'opted-in' }] };
  const setup = (opts: { homeFails?: boolean } = {}) => {
    // Names are mapped per account: us-west-2a isn't usw2-az1 here. Unsorted, with a Local Zone that's dropped.
    const home = fake(async (cmd) => {
      if (opts.homeFails) return cmd instanceof DescribeRegionsCommand ? Promise.reject(Object.assign(new Error('boom'), { name: 'InternalError' })) : denied();
      if (cmd instanceof DescribeRegionsCommand) return regions;
      return { AvailabilityZones: [az('us-west-2b', 'usw2-az1'), az('us-west-2a', 'usw2-az2'), az('us-west-2-lax-1a', 'usw2-lax1-az1', 'local-zone')] };
    });
    const eu = fake(async () => ({ AvailabilityZones: [az('eu-west-1a', 'euw1-az3')] }));
    // A Region the player role can't read (or that isn't turned on): left out, quietly.
    const ap = fake(() => denied());
    const byRegion: Record<string, unknown> = { 'us-west-2': home, 'eu-west-1': eu, 'ap-northeast-1': ap };
    const explorer = fake(async (cmd) => (cmd instanceof ListIndexesCommand ? { Indexes: [{ Region: 'us-west-2', Type: 'LOCAL' }] } : { Resources: [{ Arn: 'arn:aws:lambda:us-west-2:1:function:f', Region: 'us-west-2' }] }));
    const clients = { ec2: home, ec2For: (r: string) => byRegion[r], explorer } as unknown as AwsClients;
    return { clients, home, eu, ap };
  };
  const careFor = (clients: AwsClients) =>
    createCityCare({ clients, region: 'us-west-2', accountId: ACCOUNT, runner: { turn: vi.fn(), reset: () => undefined } as unknown as AgentRunner, withLock: (fn) => fn(), refresh: async () => undefined, progress: async () => null, fixesEnabled: false });

  it('reads the home Region and every Region with items, and what is turned on', async () => {
    const { clients, home, ap } = setup();
    const items = [
      { arn: 'arn:aws:dynamodb:eu-west-1:1:table/a', type: 'dynamodb:table', name: 'a', serviceId: 'dynamodb', districtId: 'database', managedByGame: false, region: 'eu-west-1' },
      { arn: 'arn:aws:lambda:ap-northeast-1:1:function:f', type: 'lambda:function', name: 'f', serviceId: 'lambda', districtId: 'compute', managedByGame: false, region: 'ap-northeast-1' },
      { arn: 'arn:aws:iam::1:role/r', type: 'iam:role', name: 'r', serviceId: 'iam', districtId: 'security', managedByGame: false, region: 'global' },
    ];
    const geo = await readGeo(clients, 'us-west-2', items);
    expect(geo.zones).toEqual({
      'us-west-2': [
        { name: 'us-west-2a', id: 'usw2-az2' },
        { name: 'us-west-2b', id: 'usw2-az1' },
      ],
      'eu-west-1': [{ name: 'eu-west-1a', id: 'euw1-az3' }],
    });
    expect(geo.regionStatus).toEqual({ 'us-west-2': 'enabled', 'af-south-1': 'not-enabled', 'eu-south-1': 'enabled' });
    expect(calls(home, DescribeAvailabilityZonesCommand)).toEqual([{ Filters: [{ Name: 'zone-type', Values: ['availability-zone'] }] }]);
    expect(calls(home, DescribeRegionsCommand)).toEqual([{ AllRegions: true }]);

    // Cached for a day: a second refresh makes no calls, and the failed Region waits an hour before it's tried again.
    await readGeo(clients, 'us-west-2', items);
    expect(home.send).toHaveBeenCalledTimes(2);
    expect(ap.send).toHaveBeenCalledTimes(1);
    await readGeo(clients, 'us-west-2', items, Date.now() + GEO_RETRY_MS + 1);
    expect(ap.send).toHaveBeenCalledTimes(2);
    expect(home.send).toHaveBeenCalledTimes(2);
  });

  it('the inventory carries them, and a failing read never breaks it', async () => {
    const e = (await careFor(setup().clients).refreshInventory())!;
    expect(e.zones?.['us-west-2']?.map((z) => z.id)).toEqual(['usw2-az2', 'usw2-az1']);
    expect(e.regionStatus?.['af-south-1']).toBe('not-enabled');

    const plain = (await careFor(setup({ homeFails: true }).clients).refreshInventory())!;
    expect(plain).toMatchObject({ type: 'city.inventory', counts: { lambda: 1 } });
    expect(plain.zones).toBeUndefined();
    expect(plain.regionStatus).toBeUndefined();
  });
});

describe('city care: fixes with the player in charge', () => {
  const dynamodb = mockClient(DynamoDBClient);
  const ec2 = mockClient(EC2Client);
  const clients = { dynamodb: new DynamoDBClient({}), ec2: new EC2Client({}) } as unknown as AwsClients;
  const world = snapshot([{ ...table('city-orders'), meta: { pitr: false } }], { account: { ebsEncryptionByDefault: false } });
  const runner: AgentRunner = { turn: vi.fn(async (agentId: string) => ({ agentId, reply: 'Backups let you rewind.', toolCalls: [], refused: false })), reset: () => undefined };

  const setup = (opts: { xp?: number; fixesEnabled?: boolean; lease?: AbortSignal } = {}) => {
    const events: ServerEvent[] = [];
    const emit = (e: ServerEvent) => events.push(e);
    const progress: Progress = { version: 2, landmarks: {}, updatedAt: '', citizens: { 'citizen:reliability': { xp: opts.xp ?? 25 }, 'citizen:security': { xp: opts.xp ?? 25 } } };
    const care = createCityCare({
      clients,
      region: 'us-west-2',
      accountId: ACCOUNT,
      runner,
      withLock: (fn) => fn(opts.lease),
      refresh: async () => undefined,
      progress: async () => progress,
      fixesEnabled: opts.fixesEnabled ?? true,
    });
    care.update(world);
    const approvals = createApprovals({ region: 'us-west-2' });
    const pitr = care.open().find((f) => f.ruleId === 'dynamodb-no-pitr')!;
    const ebs = care.open().find((f) => f.ruleId === 'ebs-default-encryption')!;
    return { care, events, emit, approvals, pitr, ebs };
  };
  const preview = (events: ServerEvent[]) => events.find((e) => e.type === 'deploy.preview') as Extract<ServerEvent, { type: 'deploy.preview' }> | undefined;
  const resolved = (events: ServerEvent[], f: CityFinding) => events.some((e) => e.type === 'city.finding' && e.finding.id === f.id && e.finding.status === 'resolved');

  beforeEach(() => {
    dynamodb.reset();
    ec2.reset();
    dynamodb.on(DescribeContinuousBackupsCommand).resolves({ ContinuousBackupsDescription: { ContinuousBackupsStatus: 'ENABLED', PointInTimeRecoveryDescription: { PointInTimeRecoveryStatus: 'DISABLED' } } });
    ec2.on(GetEbsEncryptionByDefaultCommand).resolves({ EbsEncryptionByDefault: false });
  });

  it('the deprecated-runtime check knows the current list (Lambda runtimes page, Oct 2026)', async () => {
    const { OLD_RUNTIME } = await import('../src/agents/wellarchitected.js');
    for (const old of ['nodejs20.x', 'nodejs18.x', 'python3.9', 'ruby3.2', 'provided.al2', 'provided', 'dotnet7', 'java8', 'go1.x']) expect(OLD_RUNTIME.test(old), old).toBe(true);
    for (const ok of ['nodejs22.x', 'nodejs24.x', 'python3.12', 'python3.13', 'ruby3.4', 'provided.al2023', 'java21', 'dotnet8']) expect(OLD_RUNTIME.test(ok), ok).toBe(false);
    const { deprecatedRuntime } = await import('../src/agents/wellarchitected.js');
    expect(deprecatedRuntime('python3.10', new Date('2026-10-30'))).toBe(false);
    expect(deprecatedRuntime('python3.10', new Date('2026-10-31'))).toBe(true);
    expect(deprecatedRuntime('dotnet8', new Date('2026-11-10'))).toBe(true);
  });

  it('levels: 0 xp is a Spotter, 20 a Fixer, 60 a Caretaker', () => {
    expect([citizenLevel(0), citizenLevel(19), citizenLevel(20), citizenLevel(60)]).toEqual([1, 1, 2, 3]);
  });

  it('nothing changes until the player approves; then it fixes and resolves the finding', async () => {
    const { care, events, emit, approvals, pitr } = setup();
    const job = care.fix('r1', pitr.id, emit, approvals);
    await vi.waitFor(() => expect(preview(events)).toBeDefined());
    const p = preview(events)!;
    expect(p).toMatchObject({ findingId: pitr.id, rollback: expect.stringContaining('undo'), costNote: expect.stringContaining('size of the table') });
    expect(p.confirmText).toBeUndefined(); // the city built this table
    expect(dynamodb.commandCalls(UpdateContinuousBackupsCommand)).toHaveLength(0);
    approvals.answer(p.deployId, true);
    await job;
    expect(dynamodb.commandCalls(UpdateContinuousBackupsCommand)).toHaveLength(1);
    expect(resolved(events, pitr)).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({ type: 'deploy.status', status: 'complete' }));
  });

  it('re-checks after the approval, inside the lock, and never runs the same fix twice at once', async () => {
    const { care, events, emit, approvals, pitr } = setup();
    const job = care.fix('r1', pitr.id, emit, approvals);
    await vi.waitFor(() => expect(preview(events)).toBeDefined());
    await care.fix('r2', pitr.id, emit, approvals); // a second tab asks too
    expect(events.filter((e) => e.type === 'deploy.preview')).toHaveLength(1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'agent.message', text: expect.stringContaining('already on this one') }));
    // Someone turned PITR on in the console while the card was open.
    dynamodb.on(DescribeContinuousBackupsCommand).resolves({ ContinuousBackupsDescription: { ContinuousBackupsStatus: 'ENABLED', PointInTimeRecoveryDescription: { PointInTimeRecoveryStatus: 'ENABLED' } } });
    approvals.answer(preview(events)!.deployId, true);
    await job;
    expect(dynamodb.commandCalls(UpdateContinuousBackupsCommand)).toHaveLength(0);
    expect(events).toContainEqual(expect.objectContaining({ type: 'deploy.status', status: 'complete', message: expect.stringContaining('already fixed') }));
  });

  it('a lost account lock stops the fix before its AWS write, with a plain sentence', async () => {
    const lost = new AbortController();
    lost.abort(new LockLostError());
    const { care, events, emit, approvals, pitr } = setup({ lease: lost.signal });
    const job = care.fix('r1', pitr.id, emit, approvals);
    await vi.waitFor(() => expect(preview(events)).toBeDefined());
    approvals.answer(preview(events)!.deployId, true);
    await job;
    expect(dynamodb.commandCalls(UpdateContinuousBackupsCommand)).toHaveLength(0);
    expect(events).toContainEqual(expect.objectContaining({ type: 'deploy.status', status: 'failed', message: expect.stringContaining('stopped before changing anything else') }));
    expect(resolved(events, pitr)).toBe(false);
  });

  it('explanations are reused per finding (one model turn each)', async () => {
    const { care, emit, pitr } = setup();
    (runner.turn as ReturnType<typeof vi.fn>).mockClear();
    await care.explain(pitr.id, emit);
    await care.explain(pitr.id, emit);
    expect(runner.turn).toHaveBeenCalledTimes(1);
  });

  it('a rejection changes nothing', async () => {
    const { care, events, emit, approvals, pitr } = setup();
    const job = care.fix('r1', pitr.id, emit, approvals);
    await vi.waitFor(() => expect(preview(events)).toBeDefined());
    approvals.answer(preview(events)!.deployId, false);
    await job;
    expect(dynamodb.commandCalls(UpdateContinuousBackupsCommand)).toHaveLength(0);
    expect(resolved(events, pitr)).toBe(false);
  });

  it('an account-wide fix needs the exact typed name, and a Caretaker', async () => {
    const low = setup({ xp: 25 });
    await low.care.fix('r1', low.ebs.id, low.emit, low.approvals);
    expect(preview(low.events)).toBeUndefined();
    expect(low.events).toContainEqual(expect.objectContaining({ type: 'agent.message', text: expect.stringContaining('Caretaker') }));

    const { care, events, emit, approvals, ebs } = setup({ xp: 80 });
    const job = care.fix('r2', ebs.id, emit, approvals);
    await vi.waitFor(() => expect(preview(events)).toBeDefined());
    expect(preview(events)!.confirmText).toBe(ebs.resource.name);
    approvals.answer(preview(events)!.deployId, true, 'wrong name');
    await job;
    expect(events).toContainEqual(expect.objectContaining({ type: 'deploy.status', status: 'rejected', message: expect.stringContaining('didn’t match') }));
    expect(resolved(events, ebs)).toBe(false);
  });

  it('a Spotter only explains, fixes stay off unless enabled, and an already-fixed issue is left alone', async () => {
    const spotter = setup({ xp: 0 });
    await spotter.care.fix('r1', spotter.pitr.id, spotter.emit, spotter.approvals);
    expect(preview(spotter.events)).toBeUndefined();

    const off = setup({ fixesEnabled: false });
    await off.care.fix('r1', off.pitr.id, off.emit, off.approvals);
    expect(off.events).toContainEqual(expect.objectContaining({ type: 'agent.message', text: expect.stringContaining('AllowFixes') }));

    const done = setup();
    dynamodb.on(DescribeContinuousBackupsCommand).resolves({ ContinuousBackupsDescription: { ContinuousBackupsStatus: 'ENABLED', PointInTimeRecoveryDescription: { PointInTimeRecoveryStatus: 'ENABLED' } } });
    await done.care.fix('r1', done.pitr.id, done.emit, done.approvals);
    expect(preview(done.events)).toBeUndefined();
    expect(resolved(done.events, done.pitr)).toBe(true);
  });

  it('explain is a citizen turn with the finding as data', async () => {
    const { care, events, emit, pitr } = setup();
    await care.explain(pitr.id, emit);
    expect(runner.turn).toHaveBeenCalledWith('citizen:reliability', expect.stringContaining('<finding>'));
    expect(events).toContainEqual({ type: 'agent.message', from: 'citizen:reliability', to: 'user', text: 'Backups let you rewind.' });
  });
});
