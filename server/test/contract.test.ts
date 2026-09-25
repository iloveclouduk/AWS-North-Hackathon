import { describe, expect, it } from 'vitest';
import { createAgentRunner } from '../src/agents/runner.js';
import { feedEvents, welcomeEvents } from '../src/contract/aws-feed.js';
import { createOrchestrator } from '../src/contract/orchestrator.js';
import { createUploadStore } from '../src/contract/uploads.js';
import { isServerEvent, type ServerEvent, SERVICES } from '../src/world.js';
import { emptySnapshot, fakeActions, fakeLlm, message, text, toolUse } from './fakes.js';
import { instance, snapshot, table } from './fixtures.js';

/** Same assertions as the frontend's tests/contract.test.ts, run against the real server logic. */
const setup = (responses: Parameters<typeof fakeLlm>[0], outcome?: Parameters<typeof fakeActions>[0]) => {
  const { llm, calls } = fakeLlm(responses);
  const actions = fakeActions(outcome);
  const runner = createAgentRunner({ llm, actions, snapshot: emptySnapshot });
  const orchestrator = createOrchestrator({ llm, runner, snapshot: emptySnapshot, uploads: createUploadStore('http://127.0.0.1:8787'), walkMs: 0, paceMs: 0 });
  const events: ServerEvent[] = [];
  return { orchestrator, events, emit: (e: ServerEvent) => events.push(e), calls, actions };
};

const plan = (agentId: string, steps: string[]) => message([toolUse('p1', 'plan_task', { agentId, steps, reply: `A job for ${agentId}!` })], 'tool_use');

describe('server speaks the frontend contract', () => {
  it('task.submit → plan, steps, working/idle states, done', async () => {
    const { orchestrator, events, emit } = setup([
      plan('ec2', ['Launch a small instance']),
      message([text('Building now.'), toolUse('t1', 'launch_instance', { name: 'my house' })], 'tool_use'),
      message([text('Your factory is up!')], 'end_turn'),
    ]);
    await orchestrator.submitTask({ taskId: 't1', prompt: 'Build me a small server', context: {} }, emit);

    expect(events.every(isServerEvent)).toBe(true);
    const planEvent = events.find((e) => e.type === 'task.plan');
    expect(planEvent).toMatchObject({ type: 'task.plan', taskId: 't1', agentId: 'ec2', targetServiceId: 'ec2' });
    expect(events.filter((e) => e.type === 'task.step').length).toBeGreaterThan(2);
    const states = events.filter((e) => e.type === 'agent.state' && e.agentId === 'ec2');
    expect(states).toContainEqual(expect.objectContaining({ state: 'working', service: 'ec2' }));
    expect(states.at(-1)).toMatchObject({ state: 'idle' });
    const done = events.find((e) => e.type === 'task.done');
    expect(done).toMatchObject({ taskId: 't1', ok: true, xp: [{ serviceId: 'ec2', amount: 20 }] });
    expect(events.indexOf(done!)).toBeGreaterThan(events.indexOf(planEvent!));
  });

  it('every working state is followed by idle for the same agent (the "feels alive" rule)', async () => {
    const { orchestrator, events, emit } = setup([plan('s3', ['Make a bucket']), message([toolUse('t1', 'create_bucket', { suffix: 'photos' })], 'tool_use'), message([text('Done')], 'end_turn')]);
    await orchestrator.submitTask({ taskId: 't2', prompt: 'store photos', context: {} }, emit);
    const open = new Map<string, number>();
    for (const e of events) if (e.type === 'agent.state') open.set(e.agentId, (open.get(e.agentId) ?? 0) + (e.state === 'working' ? 1 : -1));
    expect([...open.values()].every((n) => n === 0)).toBe(true);
  });

  it('a denied action ends the task with ok=false and a failed step', async () => {
    const { orchestrator, events, emit } = setup(
      [plan('ec2', ['Demolish the house']), message([toolUse('t1', 'terminate_instance', { instanceId: 'i-0123456789abcdef0' })], 'tool_use'), message([text('I cannot demolish yet.')], 'end_turn')],
      { status: 'denied', reason: 'Needs approval' },
    );
    await orchestrator.submitTask({ taskId: 't3', prompt: 'delete my server', context: {} }, emit);
    expect(events).toContainEqual(expect.objectContaining({ type: 'task.step', status: 'failed' }));
    expect(events.find((e) => e.type === 'task.done')).toMatchObject({ ok: false });
  });

  it('routes with the frontend keyword matcher when the model skips the plan tool', async () => {
    const { orchestrator, events, emit } = setup([message([text('hmm')], 'end_turn'), message([text('Here is how DNS works.')], 'end_turn')]);
    await orchestrator.submitTask({ taskId: 't4', prompt: 'point my domain with route 53', context: {} }, emit);
    expect(events.find((e) => e.type === 'task.plan')).toMatchObject({ agentId: 'route53' });
  });

  it('turns an LLM failure into an error event for the task', async () => {
    const { orchestrator, events, emit } = setup([]);
    await orchestrator.submitTask({ taskId: 't5', prompt: 'anything', context: {} }, emit);
    expect(events.at(-1)).toMatchObject({ type: 'error', taskId: 't5' });
    expect(events.filter((e) => e.type === 'agent.state').at(-1)).toMatchObject({ agentId: 'concierge', state: 'idle' });
  });

  it('chat.ask streams chat.answer chunks ending with done=true', async () => {
    const { orchestrator, events, emit } = setup([]);
    await orchestrator.ask({ requestId: 'r1', districtId: 'storage', question: 'When should I use EFS?', context: {} }, emit);
    const chunks = events.filter((e) => e.type === 'chat.answer');
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.at(-1)).toMatchObject({ done: true, districtId: 'storage', agentId: 'efs' });
    expect(events.every(isServerEvent)).toBe(true);
  });

  it('page.classify returns only valid service ids', async () => {
    const { orchestrator, events, emit } = setup([message([toolUse('r', 'report_page', { serviceIds: ['ec2', 'made-up'], summary: 'EC2 instances list.' })], 'tool_use')]);
    await orchestrator.classifyPage({ requestId: 'c1', context: { url: 'https://us-west-2.console.aws.amazon.com/ec2/home', title: 'Instances' } }, emit);
    expect(events.find((e) => e.type === 'page.classified')).toMatchObject({ requestId: 'c1', serviceIds: ['ec2'] });
    expect(events.filter((e) => e.type === 'agent.state' && e.agentId === 'lookout').map((e) => (e as { state: string }).state)).toEqual(['working', 'idle']);
  });

  it('AWS console changes become messages from valid city agents', () => {
    const ids = new Set([...SERVICES.map((s) => s.id), 'concierge', 'lookout']);
    const feed = [
      ...feedEvents({ type: 'created', resource: instance('i-1', 'pending') }),
      ...feedEvents({ type: 'stateChanged', resource: table('city-books'), from: 'CREATING', to: 'ACTIVE' }),
      ...feedEvents({ type: 'serviceLocked', service: 'rds' }),
      ...feedEvents({ type: 'credentialsExpired' }),
      ...welcomeEvents(snapshot([instance('i-1', 'running')])),
    ];
    expect(feed.every(isServerEvent)).toBe(true);
    for (const e of feed) if (e.type === 'agent.message') expect(ids.has(e.from)).toBe(true);
    expect(feed.at(-1)).toMatchObject({ type: 'agent.message', from: 'concierge', text: expect.stringContaining('1 EC2 instance') });
  });
});
