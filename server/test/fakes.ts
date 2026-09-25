import type Anthropic from '@anthropic-ai/sdk';
import { vi } from 'vitest';
import type { Llm } from '../src/agents/llm.js';
import type { ActionService, SubmitOutcome } from '../src/agents/service.js';
import { snapshot } from './fixtures.js';

export const message = (content: Anthropic.ContentBlock[], stop_reason: Anthropic.StopReason): Anthropic.Message =>
  ({ id: 'msg', type: 'message', role: 'assistant', model: 'test', content, stop_reason, stop_sequence: null, usage: {} }) as unknown as Anthropic.Message;
export const text = (t: string) => ({ type: 'text', text: t, citations: null }) as Anthropic.TextBlock;
export const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input }) as Anthropic.ToolUseBlock;

type Params = Omit<Anthropic.MessageCreateParamsNonStreaming, 'model'>;

/** Scripted Claude: returns queued responses in order and records every request. */
export const fakeLlm = (responses: Anthropic.Message[], streamText = 'Use EFS when many servers share files.') => {
  const calls: Params[] = [];
  const llm = {
    model: 'test',
    create: vi.fn(async (p: Params) => {
      // Snapshot the request, since the runner keeps appending to the same array.
      calls.push(structuredClone(p));
      const next = responses.shift();
      if (!next) throw new Error('no more fake responses');
      return next;
    }),
    stream: vi.fn(async (p: Params, onText: (d: string) => void) => {
      calls.push(structuredClone(p));
      for (const word of streamText.split(' ')) onText(`${word} `);
      return message([text(streamText)], 'end_turn');
    }),
  } as unknown as Llm;
  return { llm, calls, responses };
};

export const fakeActions = (outcome: SubmitOutcome = { status: 'done', result: { ok: true, message: 'Launching.' } }) =>
  ({ submit: vi.fn(async () => outcome), describe: vi.fn((name: unknown) => `Run ${String(name)}`) }) as unknown as ActionService & {
    submit: ReturnType<typeof vi.fn>;
  };

export const emptySnapshot = async () => snapshot([]);
