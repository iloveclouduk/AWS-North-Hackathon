import { describe, expect, it } from 'vitest';
import { MODEL_ITEM_LIMIT, createConsoleCopilot, trimSnapshot } from '../src/contract/console.js';
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

describe('Console Copilot — snapshot trimming and page changes', () => {
  const big = {
    url: 'https://us-west-2.console.aws.amazon.com/ec2/home?region=us-west-2#LaunchInstances:',
    title: 'Launch an instance | EC2',
    heading: 'Launch an instance',
    items: [
      ...Array.from({ length: 150 }, (_, n) => ({ id: `n${n}`, role: 'link', name: `Nav link ${n}`, context: 'Navigation' })),
      { id: 'd1', role: 'button', name: 'Disabled thing', disabled: true },
      { id: 'd2', role: 'button', name: 'Launch instance', context: 'Summary', disabled: true },
      { id: 'f1', role: 'textbox', name: 'Name', context: 'Launch an instance' },
      { id: 'f2', role: 'combobox', name: 'Instance type t2.micro', context: 'Instance type' },
      ...Array.from({ length: 40 }, (_, n) => ({ id: `x${n}`, role: 'link', name: `Footer ${n}`, context: 'Footer' })),
    ],
  };

  it('trimSnapshot keeps at most 120 items, drops unreferenced disabled ones, keeps goal matches, in page order', () => {
    const kept = trimSnapshot(big, 'Launch an EC2 instance with a t2 instance type', ['1. click Launch instance [d2] — Launching']);
    expect(kept.length).toBe(MODEL_ITEM_LIMIT);
    const ids = kept.map((i) => i.id);
    expect(ids).not.toContain('d1'); // disabled and never mentioned
    expect(ids).toContain('d2'); // disabled but referenced by the history
    expect(ids).toEqual(expect.arrayContaining(['f1', 'f2']));
    const pos = (id: string) => big.items.findIndex((i) => i.id === id);
    expect(ids.map(pos)).toEqual([...ids.map(pos)].sort((a, b) => a - b)); // original order
    // small pages go through untouched
    expect(trimSnapshot(snapshot, 'x')).toHaveLength(2);
  });

  it('sends the trimmed list to the model and records page changes in the history', async () => {
    const { llm, calls } = fakeLlm([
      step({ action: 'click', target: { id: 'e1', name: 'Create bucket' }, say: 'Open' }),
      step({ action: 'point', target: { id: 'f1', name: 'Name' }, say: 'Look' }),
      step({ action: 'done', say: 'Done' }),
    ]);
    const cp = createConsoleCopilot({ llm });
    const emit = () => {};
    await cp.start({ taskId: 't1', goal: 'Launch an EC2 instance', context: {}, snapshot }, emit);
    await cp.observe({ taskId: 't1', index: 0, ok: true, snapshot: big }, emit);
    const second = JSON.stringify(calls[1].messages);
    expect(second).toContain('page changed: now \\"Launch an instance\\" at /ec2/home#LaunchInstances:');
    expect(second).not.toContain('Disabled thing');
    expect((second.match(/ \| link \| /g) ?? []).length).toBeLessThan(120);
    await cp.observe({ taskId: 't1', index: 1, ok: true, snapshot: big }, emit);
    expect(JSON.stringify(calls[2].messages)).toContain('same page');
  });

  it('a select or type whose value is risky goes back to the learner', async () => {
    const { llm } = fakeLlm([step({ action: 'select', target: { id: 'e1', name: 'Setting' }, value: 'Disable Block Public Access', say: 'Picking it' })]);
    const cp = createConsoleCopilot({ llm });
    const events: ServerEvent[] = [];
    await cp.start({ taskId: 't2', goal: 'x', context: {}, snapshot }, (e) => events.push(e));
    expect(events.find((e) => e.type === 'console.step')).toMatchObject({ risk: 'confirm' });
  });
});
