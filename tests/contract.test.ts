import { describe, expect, it } from 'vitest';
import { MockBackend } from '@/backend/MockBackend';
import { isServerEvent, type ServerEvent } from '@/backend/contract';

/** The mock is the executable spec for the backend team: every event it emits must satisfy the contract. */
describe('MockBackend speaks the contract', () => {
  it('task.submit → plan, steps, working/idle states, done', async () => {
    const mock = new MockBackend({ speed: 200 });
    const events: ServerEvent[] = [];
    mock.onEvent((e) => events.push(e));
    mock.submitTask({ taskId: 't1', prompt: 'Store my holiday photos cheaply', context: {} });
    await new Promise((r) => setTimeout(r, 600));

    expect(events.every(isServerEvent)).toBe(true);
    const plan = events.find((e) => e.type === 'task.plan');
    expect(plan).toMatchObject({ type: 'task.plan', taskId: 't1', agentId: 's3', targetServiceId: 's3' });
    const steps = events.filter((e) => e.type === 'task.step');
    expect(steps.length).toBeGreaterThan(2);
    const states = events.filter((e) => e.type === 'agent.state' && e.agentId === 's3');
    expect(states.some((e) => e.type === 'agent.state' && e.state === 'working')).toBe(true);
    expect(states.at(-1)).toMatchObject({ state: 'idle' });
    const done = events.find((e) => e.type === 'task.done');
    expect(done).toMatchObject({ taskId: 't1', ok: true });
    // done comes after the plan
    expect(events.indexOf(done!)).toBeGreaterThan(events.indexOf(plan!));
  });

  it('chat.ask streams chat.answer chunks ending with done=true', async () => {
    const mock = new MockBackend({ speed: 200 });
    const events: ServerEvent[] = [];
    mock.onEvent((e) => events.push(e));
    mock.ask({ requestId: 'r1', districtId: 'storage', question: 'When should I use EFS?', context: {} });
    await new Promise((r) => setTimeout(r, 400));
    const chunks = events.filter((e) => e.type === 'chat.answer');
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.at(-1)).toMatchObject({ done: true, districtId: 'storage', agentId: 'efs' });
  });

  it('rejects frames with unknown types', () => {
    expect(isServerEvent({ type: 'nope' })).toBe(false);
    expect(isServerEvent(null)).toBe(false);
  });
});
