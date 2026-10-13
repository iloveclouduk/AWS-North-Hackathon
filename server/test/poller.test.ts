import { describe, expect, it } from 'vitest';
import type { AwsClients } from '../src/aws.js';
import { createPoller, mapLimit } from '../src/state/poller.js';

describe('poller helpers', () => {
  it('mapLimit keeps order and never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3, 6, 7], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n));
      running--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 60, 70]);
    expect(peak).toBe(3);
    expect(await mapLimit([], 3, async () => 1)).toEqual([]);
  });
});

describe('poller caps', () => {
  /** Every client answers by command name; anything unhandled is an empty page. */
  const fakeClients = (handle: (cmd: string, input: Record<string, unknown>) => unknown) => {
    const calls: string[] = [];
    const client = { send: async (c: { constructor: { name: string }; input: Record<string, unknown> }) => (calls.push(c.constructor.name), handle(c.constructor.name, c.input) ?? {}) };
    const clients = new Proxy({}, { get: (_t, k) => (k === 's3' ? { ...client, config: { region: async () => 'us-east-1' } } : client) }) as unknown as AwsClients;
    return { clients, calls };
  };

  it('stops paging EC2 and describing DynamoDB tables at 200, game tables first', async () => {
    const tables = [...Array.from({ length: 300 }, (_, i) => `app-${String(i).padStart(3, '0')}`), 'city-orders', 'city-users'];
    const { clients, calls } = fakeClients((cmd, input) => {
      if (cmd === 'DescribeInstancesCommand') {
        const page = Number(input.NextToken ?? 0);
        const Instances = Array.from({ length: 100 }, (_, i) => ({ InstanceId: `i-${page}-${i}` }));
        return { Reservations: [{ Instances }], NextToken: String(page + 1) }; // never ends
      }
      if (cmd === 'ListTablesCommand') {
        const start = input.ExclusiveStartTableName ? tables.indexOf(input.ExclusiveStartTableName as string) + 1 : 0;
        const TableNames = tables.slice(start, start + (input.Limit as number));
        return { TableNames, LastEvaluatedTableName: start + TableNames.length < tables.length ? TableNames.at(-1) : undefined };
      }
      if (cmd === 'DescribeTableCommand') return { Table: { TableName: input.TableName, TableStatus: 'ACTIVE' } };
      return undefined;
    });
    const poller = createPoller({ clients, accountId: '123456789012', region: 'us-east-1', intervalMs: 60_000, onSnapshot: () => {} });
    const snap = await poller.refresh();
    expect(snap.resources.filter((r) => r.kind === 'instance')).toHaveLength(200);
    expect(calls.filter((c) => c === 'DescribeInstancesCommand')).toHaveLength(2);
    const described = snap.resources.filter((r) => r.kind === 'table').map((r) => r.id);
    expect(described).toHaveLength(200);
    expect(described.slice(0, 2)).toEqual(['city-orders', 'city-users']);
    expect(calls.filter((c) => c === 'DescribeTableCommand')).toHaveLength(200);
  });

  it('caches a denied setting read as unknown instead of re-reading it every poll', async () => {
    const denied = () => Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
    const { clients, calls } = fakeClients((cmd, input) => {
      if (cmd === 'ListTablesCommand') return { TableNames: ['app-a', 'app-b'] };
      if (cmd === 'DescribeTableCommand') return { Table: { TableName: input.TableName, TableStatus: 'ACTIVE' } };
      if (cmd === 'DescribeContinuousBackupsCommand' || cmd === 'GetEbsEncryptionByDefaultCommand') throw denied();
      return undefined;
    });
    const poller = createPoller({ clients, accountId: '123456789012', region: 'us-east-1', intervalMs: 60_000, onSnapshot: () => {} });
    await poller.refresh();
    const snap = await poller.refresh();
    expect(calls.filter((c) => c === 'DescribeContinuousBackupsCommand')).toHaveLength(2); // once per table, not once per poll
    expect(calls.filter((c) => c === 'GetEbsEncryptionByDefaultCommand')).toHaveLength(1);
    // Unreadable stays unknown (null), never "off": no finding is raised from it.
    expect(snap.resources.filter((r) => r.kind === 'table').map((r) => r.meta.pitr)).toEqual([null, null]);
    expect(snap.account?.ebsEncryptionByDefault).toBeUndefined();
  });
});
