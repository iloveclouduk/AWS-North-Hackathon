import { describe, expect, it } from 'vitest';
import { createConsoleCopilot } from '../src/contract/console.js';
import type { ServerEvent } from '../src/world.js';
import { fakeLlm, message, toolUse } from './fakes.js';

const snapshot = {
  url: 'https://us-west-2.console.aws.amazon.com/s3/buckets',
  title: 'S3 buckets',
  items: [
    { id: 'e1', role: 'button', name: 'Create bucket' },
    { id: 'e2', role: 'button', name: 'Delete' },
  ],
};
const step = (input: object) => message([toolUse('t', 'next_console_step', input)], 'tool_use');

describe('Console Copilot (contract v2.1)', () => {
  it('plans one step at a time from the page snapshot and ends with task.done', async () => {
    const { llm, calls } = fakeLlm([
      step({ action: 'click', target: { id: 'e1', name: 'Create bucket' }, say: 'Opening the form', why: 'Buckets hold objects' }),
      step({ action: 'done', say: 'All set!' }),
    ]);
    const cp = createConsoleCopilot({ llm });
    const events: ServerEvent[] = [];
    await cp.start({ taskId: 'c1', goal: 'Create an S3 bucket', context: {}, snapshot }, (e) => events.push(e));
    const first = events.find((e) => e.type === 'console.step');
    expect(first).toMatchObject({ taskId: 'c1', index: 0, agentId: 's3', action: 'click', target: { id: 'e1' }, risk: 'safe', why: 'Buckets hold objects' });
    expect(JSON.stringify(calls[0].messages)).toContain('e1 | button | Create bucket');
    await cp.observe({ taskId: 'c1', index: 0, ok: true, snapshot }, (e) => events.push(e));
    expect(events.filter((e) => e.type === 'console.step').at(-1)).toMatchObject({ action: 'done' });
    expect(events.at(-1)).toMatchObject({ type: 'task.done', taskId: 'c1', ok: true });
    expect(JSON.stringify(calls[1].messages)).toContain('result: ok');
  });

  it('forces risky clicks back to the learner (risk: confirm) even if the model says safe', async () => {
    const { llm } = fakeLlm([step({ action: 'click', target: { id: 'e2', name: 'Delete' }, say: 'Deleting it', risk: 'safe' })]);
    const cp = createConsoleCopilot({ llm });
    const events: ServerEvent[] = [];
    await cp.start({ taskId: 'c2', goal: 'Remove my bucket', context: { serviceId: 's3' }, snapshot }, (e) => events.push(e));
    expect(events.find((e) => e.type === 'console.step')).toMatchObject({ action: 'click', risk: 'confirm' });
  });

  it('ends safely on invalid model output and after repeated failures', async () => {
    const { llm } = fakeLlm([step({ action: 'rm -rf', say: 'x' })]);
    const cp = createConsoleCopilot({ llm });
    const events: ServerEvent[] = [];
    await cp.start({ taskId: 'c3', goal: 'anything', context: {}, snapshot }, (e) => events.push(e));
    expect(events.some((e) => e.type === 'console.step')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'task.done', ok: false });
    expect(cp.active).toBe(0);
  });

  it('ignores stale, repeated and concurrent observes (no extra model calls) and allows one task per socket', async () => {
    const { llm, calls } = fakeLlm([
      step({ action: 'click', target: { id: 'e1', name: 'Create bucket' }, say: 'Open' }),
      step({ action: 'done', say: 'Done' }),
    ]);
    const cp = createConsoleCopilot({ llm });
    const events: ServerEvent[] = [];
    const emit = (e: ServerEvent) => events.push(e);
    await cp.start({ taskId: 'c4', goal: 'Create an S3 bucket', context: {}, snapshot }, emit);
    cp.start({ taskId: 'c5', goal: 'another', context: {}, snapshot }, emit);
    expect(events.at(-1)).toMatchObject({ type: 'error', taskId: 'c5' });
    await Promise.all([cp.observe({ taskId: 'c4', index: 0, ok: true, snapshot }, emit), cp.observe({ taskId: 'c4', index: 0, ok: true, snapshot }, emit), cp.observe({ taskId: 'c4', index: 7, ok: true, snapshot }, emit)]);
    expect(calls).toHaveLength(2); // start + exactly one observe
  });

  it('stop→start loops cannot overlap model calls, and a per-socket budget caps them', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const llm = {
      model: 'test',
      create: async () => {
        await gate;
        return step({ action: 'point', target: { id: 'e1', name: 'Create bucket' }, say: 'Look' });
      },
    } as never;
    const cp = createConsoleCopilot({ llm });
    const events: ServerEvent[] = [];
    const emit = (e: ServerEvent) => events.push(e);
    const first = cp.start({ taskId: 'a', goal: 'Create an S3 bucket', context: {}, snapshot }, emit);
    cp.stop('a', emit);
    cp.start({ taskId: 'b', goal: 'Create an S3 bucket', context: {}, snapshot }, emit);
    expect(events.at(-1)).toMatchObject({ type: 'error', taskId: 'b' }); // refused while 'a' is still thinking
    expect(cp.inFlight).toBe(1);
    release();
    await first;
    expect(cp.inFlight).toBe(0);
  });
});
