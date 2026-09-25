import type Anthropic from '@anthropic-ai/sdk';
import type { WorldSnapshot } from '../state/model.js';
import { type ActionName, AWS_API, actionsForAgent, toolDefinitions } from './actions.js';
import type { Llm } from './llm.js';
import { agentSystemPrompt } from './personas.js';
import type { ActionService, SubmitOutcome } from './service.js';

const MAX_TOOL_CALLS_PER_TURN = 5;
const MAX_HISTORY_MESSAGES = 40;

export interface ToolCallReport {
  name: string;
  input: unknown;
  outcome: SubmitOutcome['status'];
  message: string;
}

export interface TurnResult {
  agentId: string;
  reply: string;
  toolCalls: ToolCallReport[];
  refused: boolean;
}

/** Callbacks that let the transport layer animate the turn as it happens. */
export interface TurnHooks {
  onModelCall?(phase: 'start' | 'end'): void;
  onText?(text: string): void;
  onToolStart?(call: { name: string; api: string; summary: string }): void;
  onToolEnd?(call: ToolCallReport): void;
}

/** A compact, model-friendly view of the city (full meta is available through describe_resource). */
export const snapshotForModel = (s: WorldSnapshot) =>
  JSON.stringify({
    region: s.region,
    credentials: s.credentials,
    services: s.services,
    resources: s.resources.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      state: r.state,
      builtByGame: r.managedByGame,
      ...(r.kind === 'instance' ? { type: r.meta.instanceType } : {}),
    })),
  });

const outcomeText = (o: SubmitOutcome): string => {
  switch (o.status) {
    case 'done':
      return JSON.stringify({ status: 'done', message: o.result.message, ...(o.result.data ? { data: o.result.data } : {}) });
    case 'failed':
      return JSON.stringify({ status: 'failed', message: o.result.message });
    case 'denied':
      return JSON.stringify({ status: 'denied_by_game_policy', reason: o.reason });
    case 'invalid':
      return JSON.stringify({ status: 'invalid_input', error: o.error });
  }
};

const outcomeMessage = (o: SubmitOutcome) =>
  o.status === 'done' || o.status === 'failed' ? o.result.message : o.status === 'denied' ? o.reason : o.error;

/** Answers any tool_use in a trailing assistant message that never got results (e.g. cut off at max_tokens). */
export const closeDangling = (messages: Anthropic.MessageParam[]) => {
  const last = messages.at(-1);
  if (last?.role !== 'assistant' || typeof last.content === 'string') return;
  const orphans = last.content.filter((b): b is Anthropic.ToolUseBlockParam => b.type === 'tool_use');
  if (!orphans.length) return;
  messages.push({
    role: 'user',
    content: orphans.map((b) => ({ type: 'tool_result' as const, tool_use_id: b.id, is_error: true, content: 'Not executed: the turn ended before this tool call could run.' })),
  });
};

/** Agent layer: Claude decides, the ActionService parses/polices/executes, the result goes back to Claude. */
export const createAgentRunner = (deps: { llm: Llm; actions: ActionService; snapshot: () => Promise<WorldSnapshot> }) => {
  const histories = new Map<string, Anthropic.MessageParam[]>();
  // One turn at a time per agent (they share a conversation); later requests wait their turn.
  const queues = new Map<string, Promise<unknown>>();

  const turn = (agentId: string, playerText: string, hooks: TurnHooks = {}): Promise<TurnResult> => {
    const previous = queues.get(agentId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => runTurn(agentId, playerText, hooks));
    queues.set(agentId, next.catch(() => undefined));
    return next;
  };

  const runTurn = async (agentId: string, playerText: string, hooks: TurnHooks): Promise<TurnResult> => {
    const allowed = new Set<string>(actionsForAgent(agentId));
    const tools = toolDefinitions([...allowed] as ActionName[]);
    let history = histories.get(agentId) ?? [];
    // Start a fresh conversation rather than editing old turns (keeps history append-only).
    if (history.length > MAX_HISTORY_MESSAGES) history = [];
    const snapshot = await deps.snapshot();
    const messages: Anthropic.MessageParam[] = [
      ...history,
      { role: 'user', content: `<city_snapshot>${snapshotForModel(snapshot)}</city_snapshot>\n\nPlayer: ${playerText}` },
    ];
    const toolCalls: ToolCallReport[] = [];
    const replyParts: string[] = [];

    try {
      for (let step = 0; step <= MAX_TOOL_CALLS_PER_TURN; step++) {
        const outOfBudget = toolCalls.length >= MAX_TOOL_CALLS_PER_TURN;
        hooks.onModelCall?.('start');
        let response: Anthropic.Message;
        try {
          response = await deps.llm.create({
            max_tokens: 16000,
            system: agentSystemPrompt(agentId),
            tools,
            ...(outOfBudget ? { tool_choice: { type: 'none' as const } } : {}),
            messages,
          });
        } finally {
          hooks.onModelCall?.('end');
        }

        if (response.stop_reason === 'refusal') {
          // Drop the refused reply but keep what already happened this turn (actions that ran stay known).
          return { agentId, reply: "Sorry, I can't help with that one.", toolCalls, refused: true };
        }

        messages.push({ role: 'assistant', content: response.content });
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        if (text) {
          replyParts.push(text);
          hooks.onText?.(text);
        }

        const uses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
        if (response.stop_reason !== 'tool_use' || uses.length === 0) break;

        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const use of uses) {
          if (toolCalls.length >= MAX_TOOL_CALLS_PER_TURN) {
            results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: 'Tool budget for this turn is used up. Summarise for the player instead.' });
            continue;
          }
          // Tools outside this agent's allowlist are rejected even if the model invents them.
          const known = allowed.has(use.name);
          hooks.onToolStart?.({ name: use.name, api: known ? AWS_API[use.name as ActionName] : use.name, summary: deps.actions.describe(use.name, use.input) });
          const outcome: SubmitOutcome = known
            ? await deps.actions.submit(use.name, use.input)
            : { status: 'invalid', error: `"${use.name}" isn't one of this agent's tools.` };
          const report = { name: use.name, input: use.input, outcome: outcome.status, message: outcomeMessage(outcome) };
          toolCalls.push(report);
          hooks.onToolEnd?.(report);
          results.push({
            type: 'tool_result',
            tool_use_id: use.id,
            is_error: outcome.status === 'invalid' || outcome.status === 'failed',
            content: outcomeText(outcome),
          });
        }
        // All results for one assistant turn go back in a single user message.
        messages.push({ role: 'user', content: results });
      }
      return { agentId, reply: replyParts.join('\n\n'), toolCalls, refused: false };
    } finally {
      // Whatever happened (normal end, max_tokens mid tool call, refusal, an exception), leave a valid history:
      // every tool_use must be answered, or every later request for this agent would be rejected.
      closeDangling(messages);
      histories.set(agentId, messages);
    }
  };

  return { turn, reset: (agentId: string) => histories.delete(agentId) };
};

export type AgentRunner = ReturnType<typeof createAgentRunner>;
