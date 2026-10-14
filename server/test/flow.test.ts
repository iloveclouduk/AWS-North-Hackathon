// Live traffic (contract v2.8): off until the player turns it on, read at most every 5 minutes and only while a tab
// is open, the same fixed queries every time, numbers never trusted blindly, and plain sentences when it can't be read.
import { describe, expect, it, vi } from 'vitest';
import { GetMetricDataCommand, type CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { createFlow, FLOW_QUERIES, FLOW_TTL_MS, MAX_READS_PER_DAY, readFlow } from '../src/state/flow.js';
import type { ServerEvent } from '../src/world.js';

/** A CloudWatch stand-in: each query's expression → its results. */
const fakeCw = (results: Record<string, { Label?: string; Values?: number[] }[]> = {}, fail?: Error) => {
  const send = vi.fn(async (cmd: GetMetricDataCommand) => {
    if (fail) throw fail;
    const expr = cmd.input.MetricDataQueries![0]!.Expression!;
    const id = FLOW_QUERIES.find((q) => q.expression === expr)!.id;
    return { MetricDataResults: results[id] ?? [] };
  });
  return { client: { send } as unknown as CloudWatchClient, send };
};

const setup = (opts: { cw?: ReturnType<typeof fakeCw>; active?: boolean } = {}) => {
  let t = Date.parse('2026-10-12T12:00:00Z');
  const sent: ServerEvent[] = [];
  const cw = opts.cw ?? fakeCw({ lambda: [{ Values: [150, 150] }] });
  const flow = createFlow({ sub: 'p1', cw: () => cw.client, region: 'us-west-2', broadcast: (e) => sent.push(...e), active: () => opts.active ?? true, now: () => t });
  return { flow, sent, cw, advance: (ms: number) => (t += ms) };
};

describe('live traffic', () => {
  it('sends only the fixed queries, one Metrics Insights query per call (the API takes one)', async () => {
    const { client, send } = fakeCw();
    await readFlow(client, 'us-west-2', new Date('2026-10-12T12:00:30Z'));
    expect(send).toHaveBeenCalledTimes(FLOW_QUERIES.length);
    for (const [cmd] of send.mock.calls) {
      expect(cmd.input.MetricDataQueries).toHaveLength(1);
      expect(FLOW_QUERIES.map((q) => q.expression)).toContain(cmd.input.MetricDataQueries![0]!.Expression);
      // The last 15 whole minutes.
      expect(cmd.input.EndTime!.toISOString()).toBe('2026-10-12T12:00:00.000Z');
      expect(cmd.input.StartTime!.toISOString()).toBe('2026-10-12T11:45:00.000Z');
    }
  });

  it('turns sums into per-minute rates, by AZ for the load balancer, and drops junk numbers and labels', async () => {
    const { client } = fakeCw({
      alb: [{ Label: 'us-west-2a', Values: [1500, 600] }, { Label: 'us-west-2c', Values: [300] }, { Label: 'Other', Values: [NaN, -5] }],
      lambda: [{ Values: [Infinity, 450] }],
    });
    const e = await readFlow(client, 'us-west-2');
    expect(e.rates).toEqual([
      { id: 'alb', serviceId: 'ec2', kind: 'requests', label: 'Load balancer requests', perMin: 160, byAz: { 'us-west-2a': 140, 'us-west-2c': 20 } },
      { id: 'lambda', serviceId: 'lambda', kind: 'invocations', label: 'Lambda invocations', perMin: 30 },
    ]);
  });

  it('is off by default: no reads until flow.enable, none after it goes off', async () => {
    const { flow, cw, sent } = setup();
    await flow.tick();
    expect(cw.send).not.toHaveBeenCalled();
    expect(flow.welcome()).toEqual([]);
    await flow.enable(true, (e) => sent.push(e));
    expect(cw.send).toHaveBeenCalled();
    expect(sent.filter((e) => e.type === 'city.flow')).toHaveLength(1); // one copy, not one per path
    await flow.enable(false, () => undefined);
    cw.send.mockClear();
    await flow.tick();
    expect(cw.send).not.toHaveBeenCalled();
  });

  it('reads at most every 5 minutes, only while someone is looking, and within the daily cap', async () => {
    const active = { on: true };
    let t = 0;
    const cw = fakeCw();
    const flow = createFlow({ sub: 'p1', cw: () => cw.client, region: 'us-west-2', broadcast: () => undefined, active: () => active.on, now: () => t });
    await flow.enable(true, () => undefined);
    const calls = () => cw.send.mock.calls.length / FLOW_QUERIES.length;
    expect(calls()).toBe(1);
    t += FLOW_TTL_MS - 1;
    await flow.tick();
    expect(calls()).toBe(1);
    active.on = false;
    t += 2;
    await flow.tick();
    expect(calls()).toBe(1);
    active.on = true;
    for (let i = 0; i < MAX_READS_PER_DAY + 20; i++) {
      t += FLOW_TTL_MS;
      await flow.tick();
    }
    // Within one day: never more than the cap.
    expect(calls()).toBeLessThanOrEqual(MAX_READS_PER_DAY);
  });

  it('a denied read (an older AWS City role) says so in a sentence and waits a day', async () => {
    const denied = Object.assign(new Error('not allowed'), { name: 'AccessDeniedException' });
    const { flow, sent, cw, advance } = setup({ cw: fakeCw({}, denied) });
    await flow.enable(true, (e) => sent.push(e));
    const e = sent.find((x) => x.type === 'city.flow');
    expect(e).toMatchObject({ type: 'city.flow', unavailable: expect.stringMatching(/updated AWS City role/) });
    cw.send.mockClear();
    advance(FLOW_TTL_MS * 2);
    await flow.tick();
    expect(cw.send).not.toHaveBeenCalled();
  });

  it('without a linked account it asks to connect one, and reads nothing', async () => {
    const sent: ServerEvent[] = [];
    const flow = createFlow({ sub: 'p1', region: 'us-west-2', broadcast: () => undefined, active: () => true });
    await flow.enable(true, (e) => sent.push(e));
    expect(sent[0]).toMatchObject({ type: 'city.flow', unavailable: expect.stringMatching(/Connect your AWS account/) });
  });
});
