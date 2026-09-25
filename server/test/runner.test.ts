import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { createAgentRunner } from '../src/agents/runner.js';
import type { SubmitOutcome } from '../src/agents/service.js';
import { emptySnapshot, fakeActions, fakeLlm, message, text, toolUse } from './fakes.js';

const setup = (responses: Anthropic.Message[], outcome?: SubmitOutcome) => {
  const { llm, calls } = fakeLlm(responses);
  const actions = fakeActions(outcome);
  return { runner: createAgentRunner({ llm, actions, snapshot: emptySnapshot }), calls, actions, responses };
};

describe('agent runner (tool loop)', () => {
  it('executes a tool call through the action service and returns the result to the model', async () => {
    const { runner, calls, actions } = setup([
      message([text('On it!'), toolUse('t1', 'launch_instance', { name: 'eddie house' })], 'tool_use'),
      message([text('Your factory is going up.')], 'end_turn'),
    ]);
    const started: string[] = [];
    const result = await runner.turn('ec2', 'build me a small server', { onToolStart: (c) => started.push(c.api) });

    expect(actions.submit).toHaveBeenCalledWith('launch_instance', { name: 'eddie house' });
    expect(started).toEqual(['ec2:RunInstances']);
    expect(result.toolCalls).toEqual([{ name: 'launch_instance', input: { name: 'eddie house' }, outcome: 'done', message: 'Launching.' }]);
    expect(result.reply).toContain('Your factory is going up.');
    const last = calls[1]!.messages.at(-1)!;
    expect(last.content).toEqual([expect.objectContaining({ type: 'tool_result', tool_use_id: 't1', is_error: false })]);
  });

  it("only offers an agent its own service's tools and rejects others", async () => {
    const { runner, calls, actions } = setup([message([toolUse('t1', 'launch_instance', { name: 'x' })], 'tool_use'), message([text('ok')], 'end_turn')]);
    await runner.turn('s3', 'build a server');
    const names = calls[0]!.tools!.map((t) => (t as Anthropic.Tool).name);
    expect(names).toContain('create_bucket');
    expect(names).not.toContain('launch_instance');
    expect(actions.submit).not.toHaveBeenCalled();
    expect(JSON.stringify(calls[1]!.messages.at(-1)!.content)).toContain("isn't one of this agent's tools");
  });

  it('feeds policy denials back to the model as data', async () => {
    const { runner, calls } = setup(
      [message([toolUse('t1', 'launch_instance', { name: 'x' })], 'tool_use'), message([text('Limit reached.')], 'end_turn')],
      { status: 'denied', reason: 'Limit reached.' },
    );
    await runner.turn('ec2', 'build a server');
    expect(JSON.stringify(calls[1]!.messages.at(-1)!.content)).toContain('denied_by_game_policy');
  });

  it('stops using tools after the per-turn budget', async () => {
    const loop = Array.from({ length: 6 }, (_, n) => message([toolUse(`t${n}`, 'describe_resource', { id: 'x' })], 'tool_use'));
    const { runner, calls, actions } = setup([...loop, message([text('Done looking.')], 'end_turn')]);
    await runner.turn('vpc', 'look at everything');
    expect(actions.submit).toHaveBeenCalledTimes(5);
    expect(calls.at(-1)!.tool_choice).toEqual({ type: 'none' });
  });

  it('keeps history valid when a reply is cut off mid tool call', async () => {
    const { runner, calls, actions } = setup([message([toolUse('t1', 'launch_instance', { name: 'half' })], 'max_tokens'), message([text('ok')], 'end_turn')]);
    await runner.turn('ec2', 'build');
    expect(actions.submit).not.toHaveBeenCalled();
    await runner.turn('ec2', 'again');
    const history = calls[1]!.messages;
    const idx = history.findIndex((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_use'));
    expect(history[idx + 1]!.content).toEqual([expect.objectContaining({ type: 'tool_result', tool_use_id: 't1', is_error: true })]);
  });

  it('keeps completed actions in history when the model call fails mid-turn', async () => {
    const { runner, calls, actions, responses } = setup([message([toolUse('t1', 'launch_instance', { name: 'x' })], 'tool_use')]);
    await expect(runner.turn('ec2', 'build')).rejects.toThrow(/no more fake responses/);
    expect(actions.submit).toHaveBeenCalledTimes(1);
    responses.push(message([text('ok')], 'end_turn'));
    await runner.turn('ec2', 'did it work?');
    const results = calls.at(-1)!.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === 'tool_result');
    expect(results).toEqual([expect.objectContaining({ tool_use_id: 't1', is_error: false })]);
  });

  it('queues concurrent turns for the same agent instead of failing them', async () => {
    const { runner } = setup([message([text('first')], 'end_turn'), message([text('second')], 'end_turn')]);
    const [a, b] = await Promise.all([runner.turn('ec2', 'one'), runner.turn('ec2', 'two')]);
    expect([a.reply, b.reply]).toEqual(['first', 'second']);
  });

  it('reports a refusal without keeping the refused reply', async () => {
    const { runner } = setup([message([], 'refusal'), message([text('hi')], 'end_turn')]);
    expect(await runner.turn('dynamodb', 'something odd')).toMatchObject({ refused: true });
    expect((await runner.turn('dynamodb', 'hello')).reply).toBe('hi');
  });
});
