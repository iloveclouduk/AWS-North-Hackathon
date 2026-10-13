import { CostExplorerClient, DataUnavailableException, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { mockClient } from 'aws-sdk-client-mock';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import ceServices from '../../shared/ce-services.json' with { type: 'json' };
import { BILL_TTL_MS, billPeriod, createBill, readBill, regionForCe, serviceForCe } from '../src/state/bill.js';
import { fileBills } from '../src/store/local.js';
import type { BillRecord, BillStore } from '../src/store/types.js';
import { SERVICES, type ServerEvent } from '../src/world.js';

const ce = mockClient(CostExplorerClient);
const client = new CostExplorerClient({ region: 'us-east-1' });

const group = (service: string, region: string, amount: string) => ({ Keys: [service, region], Metrics: { UnblendedCost: { Amount: amount, Unit: 'USD' } } });
const page = (...groups: ReturnType<typeof group>[]) => ({ ResultsByTime: [{ TimePeriod: { Start: '2026-10-01', End: '2026-10-11' }, Groups: groups }] });

const memoryBills = (): BillStore & { data: Map<string, BillRecord> } => {
  const data = new Map<string, BillRecord>();
  return {
    data,
    get: async (sub) => data.get(sub),
    put: async (sub, r) => void data.set(sub, structuredClone(r)),
    setOn: async (sub, on) => void data.set(sub, structuredClone({ ...data.get(sub), on })),
    saveRead: async (sub, read) => {
      const r = data.get(sub);
      if (!r?.on) return false;
      data.set(sub, structuredClone({ ...r, ...read, on: true }));
      return true;
    },
  };
};

beforeEach(() => ce.reset());

describe('the bill: Cost Explorer month to date', () => {
  it('asks for this month so far, the 1st up to tomorrow (End is exclusive), also on the 1st and at year end', () => {
    expect(billPeriod(new Date('2026-10-10T15:00:00Z'))).toEqual({ Start: '2026-10-01', End: '2026-10-11', month: '2026-10' });
    expect(billPeriod(new Date('2026-10-01T00:05:00Z'))).toEqual({ Start: '2026-10-01', End: '2026-10-02', month: '2026-10' });
    expect(billPeriod(new Date('2026-12-31T23:00:00Z'))).toEqual({ Start: '2026-12-01', End: '2027-01-01', month: '2026-12' });
  });

  it('maps every service in the map to a real landmark, and the rest to other; global Regions to global', () => {
    const ids = new Set(SERVICES.map((s) => s.id));
    for (const [name, id] of Object.entries(ceServices.map as Record<string, string>)) expect(ids.has(id), `${name} → ${id}`).toBe(true);
    expect(serviceForCe('Amazon Elastic Compute Cloud - Compute')).toBe('ec2');
    expect(serviceForCe('Tax')).toBe('other');
    // Only verified strings are mapped; a guess never decides where money goes.
    for (const name of Object.keys(ceServices.unverified)) expect(serviceForCe(name), name).toBe('other');
    expect(serviceForCe('Something New')).toBe('other');
    expect(['global', 'NoRegion', '', undefined].map(regionForCe)).toEqual(['global', 'global', 'global', 'global']);
    expect(regionForCe('eu-west-1')).toBe('eu-west-1');
  });

  it('groups by service and Region, rounds to cents, and sends exactly the request it should', async () => {
    ce.on(GetCostAndUsageCommand).resolves(
      page(
        group('Amazon Elastic Compute Cloud - Compute', 'us-west-2', '3.10456'),
        group('EC2 - Other', 'us-west-2', '0.8001'),
        group('Amazon Simple Storage Service', 'global', '0.0149'),
        group('Amazon Simple Storage Service', 'us-west-2', '0.2'),
        group('Tax', 'NoRegion', '0.5'),
        group('AWS Lambda', 'eu-west-1', '0'),
      ),
    );
    const bill = await readBill(client, new Date('2026-10-10T12:00:00Z'));
    expect(bill).toEqual({
      type: 'city.bill',
      month: '2026-10',
      currency: 'USD',
      total: 4.62,
      byService: { ec2: 3.9, s3: 0.21, other: 0.5 },
      byRegion: { 'us-west-2': 4.1, global: 0.51 },
      takenAt: '2026-10-10T12:00:00.000Z',
      estimated: true,
    });
    const input = ce.commandCalls(GetCostAndUsageCommand)[0]!.args[0].input;
    expect(input).toEqual({
      TimePeriod: { Start: '2026-10-01', End: '2026-10-11' },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      GroupBy: [
        { Type: 'DIMENSION', Key: 'SERVICE' },
        { Type: 'DIMENSION', Key: 'REGION' },
      ],
      NextPageToken: undefined,
    });
  });

  it('follows pages (each is a $0.01 request, so only a few)', async () => {
    ce.on(GetCostAndUsageCommand)
      .resolvesOnce({ ...page(group('AWS Lambda', 'us-west-2', '1')), NextPageToken: 'p2' })
      .resolves({ ...page(group('AWS Lambda', 'us-west-2', '1')), NextPageToken: 'more' });
    const bill = await readBill(client, new Date('2026-10-10T12:00:00Z'));
    expect(ce.commandCalls(GetCostAndUsageCommand)).toHaveLength(3);
    expect(bill.total).toBe(3);
  });
});

describe('the bill: off by default, at most one read a day', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const setup = (opts: { linked?: boolean } = {}) => {
    const store = memoryBills();
    const broadcast: ServerEvent[] = [];
    let t = now;
    const bill = createBill({ sub: 'u1', store, ce: opts.linked === false ? undefined : () => client, accountId: '123456789012', broadcast: (e) => broadcast.push(...e), now: () => t });
    return { store, broadcast, bill, advance: (ms: number) => (t += ms) };
  };

  it('OFF: no Cost Explorer calls on connect, on refresh or when turned off', async () => {
    ce.on(GetCostAndUsageCommand).resolves(page(group('AWS Lambda', 'us-west-2', '1')));
    const { bill, store } = setup();
    expect(await bill.welcome()).toEqual([]);
    await bill.tick();
    await bill.enable(false, () => undefined);
    expect(ce.commandCalls(GetCostAndUsageCommand)).toHaveLength(0);
    expect(store.data.get('u1')).toEqual({ on: false });
  });

  it('turning it on reads once; reconnects, refreshes and toggles reuse it for 24 h, then it reads again', async () => {
    ce.on(GetCostAndUsageCommand).resolves(page(group('AWS Lambda', 'us-west-2', '1.234')));
    const { bill, broadcast, advance } = setup();
    const emitted: ServerEvent[] = [];
    await bill.enable(true, (e) => emitted.push(e));
    expect(ce.commandCalls(GetCostAndUsageCommand)).toHaveLength(1);
    expect(broadcast).toEqual([expect.objectContaining({ type: 'city.bill', total: 1.23, byService: { lambda: 1.23 } })]);

    expect(await bill.welcome()).toEqual([expect.objectContaining({ type: 'city.bill', total: 1.23 })]);
    await bill.tick();
    await bill.enable(false, () => undefined);
    await bill.enable(true, (e) => emitted.push(e));
    expect(emitted).toEqual([expect.objectContaining({ total: 1.23 })]); // the cached one
    advance(BILL_TTL_MS - 1000);
    await bill.tick();
    expect(ce.commandCalls(GetCostAndUsageCommand)).toHaveLength(1);

    advance(2000);
    await bill.tick();
    expect(ce.commandCalls(GetCostAndUsageCommand)).toHaveLength(2);
  });

  it('two tabs connecting at once share one read', async () => {
    ce.on(GetCostAndUsageCommand).resolves(page(group('AWS Lambda', 'us-west-2', '1')));
    const { bill, store } = setup();
    store.data.set('u1', { on: true });
    await Promise.all([bill.welcome(), bill.welcome(), bill.tick()]);
    await bill.tick();
    expect(ce.commandCalls(GetCostAndUsageCommand)).toHaveLength(1);
  });

  it('a cached bill for another AWS account is never shown', async () => {
    ce.on(GetCostAndUsageCommand).resolves(page(group('AWS Lambda', 'us-west-2', '2')));
    const { bill, store } = setup();
    store.data.set('u1', { on: true, bill: { type: 'city.bill', month: '2026-10', currency: 'USD', total: 99, byService: {}, byRegion: {}, takenAt: '', estimated: true }, fetchedAt: now, accountId: '999999999999' });
    expect(await bill.welcome()).toEqual([]);
    await bill.tick();
    expect(store.data.get('u1')?.bill).toMatchObject({ total: 2 });
  });

  it('AccessDenied and DataUnavailable become one plain sentence (and are cached, not retried every refresh)', async () => {
    ce.on(GetCostAndUsageCommand).rejects(Object.assign(new Error('User: arn:aws:sts::1:assumed-role/x is not authorized'), { name: 'AccessDeniedException' }));
    const a = setup();
    await a.bill.enable(true, () => undefined);
    expect(a.broadcast).toEqual([{ type: 'city.bill', unavailable: "Your bill isn't available: this account can't read Cost Explorer.", takenAt: expect.any(String) }]);
    expect(JSON.stringify(a.broadcast)).not.toContain('arn:aws');
    await a.bill.tick();
    expect(ce.commandCalls(GetCostAndUsageCommand)).toHaveLength(1);

    ce.reset();
    ce.on(GetCostAndUsageCommand).rejects(new DataUnavailableException({ message: 'Data is not available', $metadata: {} }));
    const b = setup();
    await b.bill.enable(true, () => undefined);
    expect(b.broadcast).toEqual([expect.objectContaining({ unavailable: 'Cost Explorer is turning on for this account; bills show up within 24 hours.' })]);
  });

  it('turning it on only sets the switch: a failed store read never wipes the cached bill or spends a new read', async () => {
    ce.on(GetCostAndUsageCommand).resolves(page(group('AWS Lambda', 'us-west-2', '1')));
    const { bill, store } = setup();
    const cachedBill = { type: 'city.bill' as const, month: '2026-10', currency: 'USD', total: 7, byService: {}, byRegion: {}, takenAt: '', estimated: true as const };
    store.data.set('u1', { on: false, bill: cachedBill, fetchedAt: now, retryMs: BILL_TTL_MS, accountId: '123456789012' });
    const get = store.get;
    store.get = async () => Promise.reject(Object.assign(new Error('throttled'), { name: 'ProvisionedThroughputExceededException' }));
    const emitted: ServerEvent[] = [];
    await bill.enable(true, (e) => emitted.push(e));
    expect(store.data.get('u1')).toEqual({ on: true, bill: cachedBill, fetchedAt: now, retryMs: BILL_TTL_MS, accountId: '123456789012' });
    expect(ce.commandCalls(GetCostAndUsageCommand)).toHaveLength(0);
    expect(emitted).toEqual([expect.objectContaining({ unavailable: expect.any(String) })]);
    store.get = get;
    await bill.enable(true, (e) => emitted.push(e));
    expect(emitted.at(-1)).toMatchObject({ total: 7 });
    expect(ce.commandCalls(GetCostAndUsageCommand)).toHaveLength(0);
  });

  it('a read in flight when the player turns it off never turns it back on', async () => {
    let answer!: () => void;
    ce.on(GetCostAndUsageCommand).callsFake(() => new Promise((r) => (answer = () => r(page(group('AWS Lambda', 'us-west-2', '1'))))));
    const { bill, store } = setup();
    // Each store read is slow, so the read's last look at `on` comes before the turn-off lands.
    const get = store.get;
    store.get = async (sub) => {
      const r = await get(sub);
      await new Promise((res) => setTimeout(res, 20));
      return r;
    };
    const turningOn = bill.enable(true, () => undefined);
    await new Promise((r) => setTimeout(r, 40));
    answer();
    await new Promise((r) => setTimeout(r, 5));
    // The turn-off from another tab or task: lands while the read is checking whether it's still on.
    store.data.set('u1', { on: false });
    await turningOn;
    expect(store.data.get('u1')).toEqual({ on: false });
  });

  it('local file store: saveRead keeps `on` as the player left it', async () => {
    const bills = fileBills(join(mkdtempSync(join(tmpdir(), 'awscity-bill-')), 'progress.json'));
    const read = { bill: { type: 'city.bill' as const, unavailable: 'x', takenAt: '' }, fetchedAt: 5 };
    expect(await bills.saveRead('local', read)).toBe(false);
    await bills.put('local', { on: true });
    const [saved] = await Promise.all([bills.saveRead('local', read), bills.put('local', { on: false })]);
    expect(saved).toBe(true);
    expect((await bills.get('local'))?.on).toBe(false);
    expect(await bills.saveRead('local', read)).toBe(false);
  });

  it('no linked account: a sentence, and no Cost Explorer call', async () => {
    const { bill } = setup({ linked: false });
    const emitted: ServerEvent[] = [];
    await bill.enable(true, (e) => emitted.push(e));
    expect(emitted).toEqual([expect.objectContaining({ unavailable: expect.stringContaining('Connect your AWS account') })]);
    expect(ce.commandCalls(GetCostAndUsageCommand)).toHaveLength(0);
  });

  it('local mode keeps it in a file beside progress', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'awscity-bill-'));
    const bills = fileBills(join(dir, 'progress.json'));
    expect(await bills.get('local')).toBeUndefined();
    await bills.put('local', { on: true, fetchedAt: 1 });
    expect(await bills.get('local')).toEqual({ on: true, fetchedAt: 1 });
    await bills.setOn('local', false);
    expect(await bills.get('local')).toEqual({ on: false, fetchedAt: 1 });
    await bills.setOn('someone', true);
    expect(await bills.get('someone')).toEqual({ on: true });
    expect(bills.fileFor('local')).toBe(join(dir, 'bill.json'));
    expect(bills.fileFor('someone')).not.toContain('someone');
  });
});
