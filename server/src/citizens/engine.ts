import type Anthropic from '@anthropic-ai/sdk';
import { Agent, AfterModelCallEvent, BeforeModelCallEvent, BeforeToolCallEvent, SlidingWindowConversationManager } from '@strands-agents/sdk';
import type { Knowledge } from '../knowledge/mcp.js';
import { docsBlock } from '../knowledge/mcp.js';
import { type ActionName, AWS_API, actionsForAgent, READ_ONLY } from '../agents/actions.js';
import type { Llm } from '../agents/llm.js';
import { agentSystemPrompt } from '../agents/personas.js';
import { type AgentRunner, MAX_TOOL_CALLS_PER_TURN, snapshotForModel, type TurnHooks, type TurnResult } from '../agents/runner.js';
import type { ActionService } from '../agents/service.js';
import type { WorldSnapshot } from '../state/model.js';
import { serviceById } from '../world.js';
import { MeteredAnthropicModel } from './model.js';
import { citizenById, citizenSystemPrompt, isCitizen } from './roles.js';
import { actionTools, docsTool, type TurnContext } from './tools.js';

/** Model turns per invocation (a model call plus the tools it asked for): the tool budget, the call that's told the
 *  budget is used up, and one to summarise. */
export const MAX_TURNS = MAX_TOOL_CALLS_PER_TURN + 2;
export const OUT_OF_STEPS = "I ran out of steps for this one. Ask me again and I'll carry on.";
/**
 * Token budgets per invocation (input + output, summed over its model calls). Citizens explain one finding at a time
 * with no memory, so theirs is small; landmark agents keep a conversation.
 */
export const CITIZEN_TOKENS = { maxTokens: 2000, total: 40_000 };
export const AGENT_TOKENS = { maxTokens: 16000, total: 200_000 };
export const TOOL_BUDGET_MESSAGE = 'Tool budget for this turn is used up. Summarise for the player instead.';

/**
 * Landmark agents and citizens on Strands Agents (TypeScript). Same interface as the classic runner
 * (src/agents/runner.ts), so the orchestrator and transport don't change. Each agent id gets one long-lived Strands
 * Agent with its own conversation; turns for the same id queue (an Agent runs one invocation at a time).
 *
 * Guardrails, all ours: tools are the ActionService allowlist (citizens get read-only ones), a sequential executor so
 * approvals come one at a time, at most MAX_TOOL_CALLS_PER_TURN tool calls (cancelled in BeforeToolCallEvent), every
 * model call metered, no structured output (it would force tool_choice), and the vended HITL isn't used (its "trust"
 * remembers an approval for the session; every write here asks again).
 */
export const createStrandsRunner = (deps: {
  llm: Llm;
  actions: ActionService;
  snapshot: () => Promise<WorldSnapshot>;
  knowledge?: Knowledge;
  /** Defaults to the Bedrock client behind `llm`. Tests pass a stub. */
  client?: Anthropic;
}): AgentRunner => {
  const agents = new Map<string, Agent>();
  /** `started` counts every tool call the turn began, docs searches included (the budget covers them all). */
  const turns = new Map<string, TurnContext & { sources: { title: string; url: string }[]; started: number }>();
  const queues = new Map<string, Promise<unknown>>();
  /** The citizen Agent running right now (for cancel), by citizen id. */
  const live = new Map<string, Agent>();
  const client = deps.client ?? deps.llm.client;

  const toolNames = (agentId: string): ActionName[] => (isCitizen(agentId) ? [...READ_ONLY] : actionsForAgent(agentId));

  const agentFor = (agentId: string) => {
    // Citizens explain one finding at a time and need no memory: a fresh Agent per turn keeps old snapshots out of the
    // context (no growing input tokens). Landmark agents keep their conversation.
    const existing = isCitizen(agentId) ? undefined : agents.get(agentId);
    if (existing) return existing;
    if (!client) throw new Error('No model client for the Strands runner');
    const citizen = citizenById(agentId);
    const tools = [
      ...actionTools(toolNames(agentId), { actions: deps.actions, turn: () => turns.get(agentId) }),
      ...(deps.knowledge ? [docsTool(deps.knowledge, () => turns.get(agentId)?.sources)] : []),
    ];
    const agent = new Agent({
      id: agentId.replace(/[^a-zA-Z0-9_-]/g, '-'),
      name: citizen?.name ?? agentId,
      model: new MeteredAnthropicModel(
        citizen ? { client, modelId: deps.llm.model, maxTokens: CITIZEN_TOKENS.maxTokens, effort: 'low' } : { client, modelId: deps.llm.model, maxTokens: AGENT_TOKENS.maxTokens, effort: 'high' },
        deps.llm.gate,
      ),
      tools,
      systemPrompt: citizen ? citizenSystemPrompt(citizen) : agentSystemPrompt(agentId),
      printer: false,
      sandbox: false,
      toolExecutor: 'sequential',
      // The SDK client already retries throttling; a second retry layer would double-count quota.
      retryStrategy: null,
      conversationManager: new SlidingWindowConversationManager({ windowSize: 40 }),
    });
    agent.addHook(BeforeModelCallEvent, () => turns.get(agentId)?.hooks.onModelCall?.('start'));
    agent.addHook(AfterModelCallEvent, () => turns.get(agentId)?.hooks.onModelCall?.('end'));
    agent.addHook(BeforeToolCallEvent, (event) => {
      const ctx = turns.get(agentId);
      if (!ctx) return;
      if (ctx.started >= MAX_TOOL_CALLS_PER_TURN) {
        event.cancel = TOOL_BUDGET_MESSAGE;
        return;
      }
      ctx.started++;
      const name = event.toolUse.name;
      const api = name in AWS_API ? AWS_API[name as ActionName] : name === 'search_aws_docs' ? 'aws-knowledge:SearchDocumentation' : name;
      ctx.hooks.onToolStart?.({ name, api, summary: name === 'search_aws_docs' ? 'Reading the AWS docs' : deps.actions.describe(name, event.toolUse.input) });
    });
    if (!citizen) agents.set(agentId, agent);
    else live.set(agentId, agent);
    return agent;
  };

  const runTurn = async (agentId: string, playerText: string, hooks: TurnHooks): Promise<TurnResult> => {
    const agent = agentFor(agentId);
    const subject = citizenById(agentId)?.name ?? serviceById(agentId)?.name ?? agentId;
    const citizen = isCitizen(agentId);
    // Citizens explain one finding (it comes in the prompt); they don't need the whole account in their context.
    const [snapshot, docs] = await Promise.all([citizen ? undefined : deps.snapshot(), deps.knowledge?.search(`${subject} ${playerText}`, 3) ?? []]);
    const ctx = { hooks, toolCalls: [], sources: docs.map(({ title, url }) => ({ title, url })), started: 0 };
    turns.set(agentId, ctx);
    // The player's socket closed: stop this turn (only this one: turns for an agent run one at a time).
    const cancel = () => agent.cancel();
    hooks.signal?.addEventListener('abort', cancel, { once: true });
    try {
      if (hooks.signal?.aborted) return { agentId, reply: '', toolCalls: [], refused: false, sources: [] };
      const city = snapshot ? `<city_snapshot>${snapshotForModel(snapshot)}</city_snapshot>\n\n` : '';
      const result = await agent.invoke(`${docsBlock(docs)}${city}Player: ${playerText}`, {
        limits: { turns: MAX_TURNS, totalTokens: isCitizen(agentId) ? CITIZEN_TOKENS.total : AGENT_TOKENS.total },
      });
      if (result.stopReason === 'refusal') return { agentId, reply: "Sorry, I can't help with that one.", toolCalls: ctx.toolCalls, refused: true, sources: [] };
      const reply = result.lastMessage.content
        .filter((b): b is Extract<typeof b, { type: 'textBlock' }> => b.type === 'textBlock')
        .map((b) => b.text)
        .join('\n')
        .trim();
      const limited = String(result.stopReason).startsWith('limit');
      const text = reply || (limited ? OUT_OF_STEPS : '');
      if (text) hooks.onText?.(text);
      return { agentId, reply: text, toolCalls: ctx.toolCalls, refused: false, limited: limited && !reply, sources: ctx.sources };
    } finally {
      hooks.signal?.removeEventListener('abort', cancel);
      turns.delete(agentId);
      live.delete(agentId);
    }
  };

  return {
    turn(agentId, playerText, hooks = {}) {
      const previous = queues.get(agentId) ?? Promise.resolve();
      const next = previous.catch(() => undefined).then(() => runTurn(agentId, playerText, hooks));
      queues.set(agentId, next.catch(() => undefined));
      return next;
    },
    reset: (agentId) => {
      (agents.get(agentId) ?? live.get(agentId))?.cancel();
      return agents.delete(agentId);
    },
  };
};
