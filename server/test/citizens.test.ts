import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { createStrandsRunner, TOOL_BUDGET_MESSAGE } from '../src/citizens/engine.js';
import { CITIZENS } from '../src/citizens/roles.js';
import type { SubmitOutcome } from '../src/agents/service.js';
import { emptySnapshot, fakeActions, fakeLlm } from './fakes.js';

type Block = { text: string } | { tool: string; id: string; input: unknown };
type Request = Record<string, unknown> & { tools?: { name: string }[]; tool_choice?: unknown; messages: { role: string; content: unknown }[] };

/** Anthropic stream events for one assistant message, the shape Strands' AnthropicModel reads. */
function* events(blocks: Block[], stop: 'end_turn' | 'tool_use' | 'refusal') {
  yield { type: 'message_start', message: { role: 'assistant', usage: { input_tokens: 10, output_tokens: 0 } } };
  for (const [index, b] of blocks.entries()) {
    if ('text' in b) {
      yield { type: 'content_block_start', index, content_block: { type: 'text', text: '' } };
      yield { type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text } };
    } else {
      yield { type: 'content_block_start', index, content_block: { type: 'tool_use', id: b.id, name: b.tool, input: {} } };
      yield { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } };
    }
    yield { type: 'content_block_stop', index };
  }
  yield { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 5 } };
  yield { type: 'message_stop' };
}

/** A stand-in for the Bedrock client: answers each request with the next scripted message and records it. */
const stubClient = (script: { blocks: Block[]; stop: 'end_turn' | 'tool_use' | 'refusal' }[]) => {
  const requests: Request[] = [];
  const client = {
    messages: {
      stream(request: Request) {
        requests.push(structuredClone(request));
        const next = script[Math.min(requests.length - 1, script.length - 1)]!;
        return (async function* () {
          yield* events(next.blocks, next.stop);
        })();
      },
    },
  } as unknown as Anthropic;
  return { client, requests };
};

const setup = (script: Parameters<typeof stubClient>[0], outcome?: SubmitOutcome) => {
  const { client, requests } = stubClient(script);
  const { llm } = fakeLlm([]);
  const gate = vi.fn(async () => undefined);
  const actions = fakeActions(outcome);
  const runner = createStrandsRunner({ llm: { ...llm, gate }, actions, snapshot: emptySnapshot, client });
  return { runner, requests, gate, actions };
};

describe('Strands runner (citizens and landmark agents)', () => {
  it('runs a tool through the ActionService and answers in plain text', async () => {
    const { runner, requests, actions } = setup([
      { blocks: [{ text: 'On it.' }, { tool: 'launch_instance', id: 't1', input: { name: 'eddie house' } }], stop: 'tool_use' },
      { blocks: [{ text: 'Your factory is going up.' }], stop: 'end_turn' },
    ]);
    const started: string[] = [];
    const approve = vi.fn(async () => true);
    const result = await runner.turn('ec2', 'build me a small server', { approve, onToolStart: (c) => started.push(c.api) });
    // Strands applies the schema defaults first; the ActionService validates the input again either way.
    const input = { name: 'eddie house', instanceType: 't4g.micro' };
    expect(actions.submit).toHaveBeenCalledWith('launch_instance', input, { approve });
    expect(started).toEqual(['ec2:RunInstances']);
    expect(result.toolCalls).toEqual([{ name: 'launch_instance', input, outcome: 'done', message: 'Launching.' }]);
    expect(result.reply).toContain('Your factory is going up.');
    expect(requests).toHaveLength(2);
  });

  it('never forces tool_choice and passes no structured-output tool (Bedrock rejects forced tools with thinking)', async () => {
    const { runner, requests } = setup([{ blocks: [{ text: 'Hi' }], stop: 'end_turn' }]);
    await runner.turn('ec2', 'hello');
    for (const r of requests) expect(r.tool_choice === undefined || (r.tool_choice as { type: string }).type === 'auto').toBe(true);
  });

  it("offers exactly the agent's allowlist: no AWS, shell or sandbox tools", async () => {
    const { runner, requests } = setup([{ blocks: [{ text: 'ok' }], stop: 'end_turn' }]);
    await runner.turn('s3', 'hello');
    expect(requests[0]!.tools!.map((t) => t.name).sort()).toEqual(['create_bucket', 'delete_bucket', 'describe_resource', 'review_architecture']);
  });

  it('citizens get read-only tools and their own persona', async () => {
    const { runner, requests } = setup([{ blocks: [{ text: 'Here is why.' }], stop: 'end_turn' }]);
    await runner.turn('citizen:security', 'explain this finding');
    expect(requests[0]!.tools!.map((t) => t.name).sort()).toEqual(['describe_resource', 'review_architecture']);
    expect(JSON.stringify(requests[0]!.system)).toContain(CITIZENS.find((c) => c.id === 'citizen:security')!.name);
  });

  it('citizens are stateless, low-effort and token-capped; landmark agents keep their conversation', async () => {
    const { runner, requests } = setup([{ blocks: [{ text: 'ok' }], stop: 'end_turn' }]);
    await runner.turn('citizen:cost', 'first');
    await runner.turn('citizen:cost', 'second');
    expect(requests[1]!.messages).toHaveLength(1); // no history from the first explain
    expect(JSON.stringify(requests[1]!.messages)).not.toContain('<city_snapshot>'); // the finding is all they need
    expect(requests[1]).toMatchObject({ max_tokens: 2000, output_config: { effort: 'low' } });
    await runner.turn('ec2', 'one');
    await runner.turn('ec2', 'two');
    expect(requests[3]!.messages.length).toBeGreaterThan(1);
  });

  it('goes through the quota gate before every model call', async () => {
    const { runner, gate } = setup([
      { blocks: [{ tool: 'describe_resource', id: 't1', input: { id: 'i-1' } }], stop: 'tool_use' },
      { blocks: [{ text: 'done' }], stop: 'end_turn' },
    ]);
    await runner.turn('ec2', 'look at i-1');
    expect(gate).toHaveBeenCalledTimes(2);
  });

  it('stops after the tool budget and tells the model why', async () => {
    const calls = Array.from({ length: 8 }, (_, i) => ({ blocks: [{ tool: 'describe_resource', id: `t${i}`, input: { id: `i-${i}` } }], stop: 'tool_use' as const }));
    const { runner, actions, requests } = setup([...calls, { blocks: [{ text: 'summary' }], stop: 'end_turn' }]);
    const result = await runner.turn('ec2', 'look at everything');
    expect(actions.submit.mock.calls.length).toBeLessThanOrEqual(5);
    expect(result.toolCalls.length).toBeLessThanOrEqual(5);
    expect(JSON.stringify(requests.at(-1)!.messages)).toContain(TOOL_BUDGET_MESSAGE);
  });

  it('docs searches count toward the tool budget', async () => {
    const calls = Array.from({ length: 8 }, (_, i) => ({ blocks: [{ tool: 'search_aws_docs', id: `d${i}`, input: { query: `s3 thing ${i}` } }], stop: 'tool_use' as const }));
    const { client, requests } = stubClient([...calls, { blocks: [{ text: 'summary' }], stop: 'end_turn' }]);
    const { llm } = fakeLlm([]);
    const knowledge = { search: vi.fn(async () => []) };
    const runner = createStrandsRunner({ llm: { ...llm, gate: vi.fn(async () => undefined) }, actions: fakeActions(), snapshot: emptySnapshot, client, knowledge });
    await runner.turn('s3', 'tell me everything');
    // One search grounds the turn up front; the model's own searches stop at the budget.
    expect(knowledge.search.mock.calls.length - 1).toBeLessThanOrEqual(5);
    expect(JSON.stringify(requests.at(-1)!.messages)).toContain(TOOL_BUDGET_MESSAGE);
  });

  it('a closed socket cancels its turn', async () => {
    const calls = Array.from({ length: 4 }, (_, i) => ({ blocks: [{ tool: 'describe_resource', id: `t${i}`, input: { id: `i-${i}` } }], stop: 'tool_use' as const }));
    const { runner, actions, requests } = setup([...calls, { blocks: [{ text: 'summary' }], stop: 'end_turn' }]);
    const gone = new AbortController();
    const result = await runner.turn('ec2', 'look', { signal: gone.signal, onToolEnd: () => gone.abort() });
    expect(actions.submit).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1);
    expect(result.refused).toBe(false);
    // Already gone before it started: no model call at all.
    const before = requests.length;
    const aborted = new AbortController();
    aborted.abort();
    await runner.turn('ec2', 'again', { signal: aborted.signal });
    expect(requests).toHaveLength(before);
  });

  it('a write without an approval channel is refused by the ActionService path, not run', async () => {
    const { runner, actions } = setup(
      [
        { blocks: [{ tool: 'create_bucket', id: 't1', input: { suffix: 'abc' } }], stop: 'tool_use' },
        { blocks: [{ text: 'ok' }], stop: 'end_turn' },
      ],
      { status: 'denied', reason: 'needs approval' },
    );
    const result = await runner.turn('s3', 'make a bucket');
    expect(actions.submit).toHaveBeenCalledWith('create_bucket', { suffix: 'abc' });
    expect(result.toolCalls[0]).toMatchObject({ outcome: 'denied' });
  });

  it("a landmark agent's write goes to the ActionService with the player's approval channel (Strands is the default engine)", async () => {
    const { runner, actions } = setup(
      [
        { blocks: [{ tool: 'create_bucket', id: 't1', input: { suffix: 'abc' } }], stop: 'tool_use' },
        { blocks: [{ text: 'done' }], stop: 'end_turn' },
      ],
      { status: 'denied', reason: 'player said no' },
    );
    const approve = vi.fn(async () => false);
    await runner.turn('s3', 'make a bucket', { approve } as never);
    // The approval itself happens inside the ActionService (deploy.preview → deploy.approve), never in Strands.
    expect(actions.submit).toHaveBeenCalledWith('create_bucket', { suffix: 'abc' }, { approve });
  });

  it('a refusal becomes a short apology', async () => {
    const { runner } = setup([{ blocks: [], stop: 'refusal' }]);
    expect(await runner.turn('ec2', '…')).toMatchObject({ refused: true });
  });
});
