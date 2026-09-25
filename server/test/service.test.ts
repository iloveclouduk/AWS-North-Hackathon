import { describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../src/agents/policy.js';
import type { AwsClients } from '../src/aws.js';
import type { Poller } from '../src/state/poller.js';
import { instance, snapshot } from './fixtures.js';

const { executeAction } = vi.hoisted(() => {
  let launched = 0;
  return {
    executeAction: vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      launched++;
      return { ok: true, message: 'Launching.', resourceId: `i-00000000000000${String(launched).padStart(3, '0')}` };
    }),
  };
});
vi.mock('../src/agents/executor.js', () => ({ executeAction }));

const { createActionService, NEEDS_APPROVAL_REASON, REJECTED_REASON } = await import('../src/agents/service.js');

const pollerFor = (resources = snapshot([])) => ({ current: () => resources, refresh: async () => resources, start() {}, stop() {} }) as Poller;

describe('action service', () => {
  it('does not let parallel launches exceed the instance limit before AWS listings catch up', async () => {
    // The snapshot never shows the new instances (eventually consistent listing).
    const service = createActionService({ clients: {} as AwsClients, poller: pollerFor(), region: 'us-west-2' });
    const outcomes = await Promise.all(Array.from({ length: LIMITS.instances + 3 }, (_, n) => service.submit('launch_instance', { name: `house ${n}` })));
    expect(outcomes.filter((o) => o.status === 'done')).toHaveLength(LIMITS.instances);
    expect(outcomes.filter((o) => o.status === 'denied')).toHaveLength(3);
  });

  it('refuses destructive actions, since the contract has no approval step', async () => {
    executeAction.mockClear();
    const mine = instance('i-0000000000000001a', 'running');
    const service = createActionService({ clients: {} as AwsClients, poller: pollerFor(snapshot([mine])), region: 'us-west-2' });
    expect(await service.submit('terminate_instance', { instanceId: mine.id })).toEqual({ status: 'denied', reason: NEEDS_APPROVAL_REASON });
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('rejects invalid input before policy or AWS', async () => {
    const service = createActionService({ clients: {} as AwsClients, poller: pollerFor(), region: 'us-west-2' });
    expect(await service.submit('launch_instance', { name: 'x', instanceType: 'm5.large' })).toMatchObject({ status: 'invalid' });
  });

  it('with an approval channel, asks the player before any write and only runs on approve', async () => {
    executeAction.mockClear();
    const service = createActionService({ clients: {} as AwsClients, poller: pollerFor(), region: 'us-west-2' });
    const approve = vi.fn(async () => false);
    expect(await service.submit('create_table', { name: 'city-quest' }, { approve })).toEqual({ status: 'denied', reason: REJECTED_REASON });
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ destructive: false, summary: expect.stringContaining('city-quest') }));
    expect(executeAction).not.toHaveBeenCalled();
    approve.mockResolvedValueOnce(true);
    expect(await service.submit('create_table', { name: 'city-quest' }, { approve })).toMatchObject({ status: 'done' });
    expect(executeAction).toHaveBeenCalledTimes(1);
  });

  it('lets destructive actions run only after explicit approval, and never asks about denied ones', async () => {
    executeAction.mockClear();
    const mine = instance('i-0000000000000001a', 'running');
    const service = createActionService({ clients: {} as AwsClients, poller: pollerFor(snapshot([mine])), region: 'us-west-2' });
    const approve = vi.fn(async () => true);
    expect(await service.submit('terminate_instance', { instanceId: mine.id }, { approve })).toMatchObject({ status: 'done' });
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
    approve.mockClear();
    // not built by the game → policy denies before the player is even asked
    expect(await service.submit('terminate_instance', { instanceId: 'i-0000000000000009f' }, { approve })).toMatchObject({ status: 'denied' });
    expect(approve).not.toHaveBeenCalled();
  });

  it('reads never need approval', async () => {
    const service = createActionService({ clients: {} as AwsClients, poller: pollerFor(), region: 'us-west-2' });
    const approve = vi.fn(async () => false);
    await service.submit('describe_resource', { id: 'anything' }, { approve });
    expect(approve).not.toHaveBeenCalled();
  });
});
