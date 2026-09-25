import { describe, expect, it, vi } from 'vitest';
import { createApprovals } from '../src/contract/approvals.js';
import type { ServerEvent } from '../src/world.js';

const req = { action: { type: 'create_table', name: 'city-quest' } as never, summary: 'Create DynamoDB table "city-quest"', destructive: false };

describe('per-socket approvals (contract v2 deploy.preview → deploy.approve)', () => {
  it('emits a deploy.preview and resolves true on approve, then reports the real result', async () => {
    const events: ServerEvent[] = [];
    const a = createApprovals({ region: 'us-west-2' });
    const p = a.request('t1', req, (e) => events.push(e));
    const preview = events[0];
    expect(preview).toMatchObject({ type: 'deploy.preview', taskId: 't1', templateId: 'create_table', region: 'us-west-2' });
    if (preview?.type !== 'deploy.preview') throw new Error();
    expect(preview.changes).toEqual([{ action: 'Add', logicalId: 'city-quest', resourceType: 'AWS::DynamoDB::Table' }]);
    expect(a.answer(preview.deployId, true)).toBe(true);
    expect(await p).toBe(true);
    a.reportResult('t1', { name: 'create_table', input: {}, outcome: 'done', message: 'Table created' }, (e) => events.push(e));
    expect(events.map((e) => (e.type === 'deploy.status' ? e.status : e.type))).toEqual(['deploy.preview', 'creating', 'complete']);
  });

  it('reject, unknown ids, timeouts and socket close all resolve false', async () => {
    vi.useFakeTimers();
    const events: ServerEvent[] = [];
    const a = createApprovals({ region: 'us-west-2', timeoutMs: 1000 });
    const rejected = a.request('t', req, (e) => events.push(e));
    a.answer((events[0] as { deployId: string }).deployId, false);
    expect(await rejected).toBe(false);
    expect(a.answer('nope', true)).toBe(false);
    const timedOut = a.request('t', req, (e) => events.push(e));
    vi.advanceTimersByTime(1001);
    expect(await timedOut).toBe(false);
    const closed = a.request('t', req, (e) => events.push(e));
    a.cancelAll();
    expect(await closed).toBe(false);
    expect(a.size).toBe(0);
    vi.useRealTimers();
  });
});
