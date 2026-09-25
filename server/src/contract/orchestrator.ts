import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Llm } from '../agents/llm.js';
import { agentSystemPrompt, CONCIERGE_PROMPT, lookoutPrompt } from '../agents/personas.js';
import { type AgentRunner, snapshotForModel } from '../agents/runner.js';
import type { Approvals } from './approvals.js';
import type { WorldSnapshot } from '../state/model.js';
import {
  type ChatAsk,
  type DistrictId,
  districtById,
  matchText,
  type PageClassify,
  type PageContext,
  placeFor,
  type ServerEvent,
  SERVICES,
  serviceById,
  servicesIn,
  type TaskSubmit,
} from '../world.js';
import type { UploadStore } from './uploads.js';

export type Emit = (event: ServerEvent) => void;

const SERVICE_IDS = SERVICES.map((s) => s.id) as [string, ...string[]];
const XP = { task: 15, perWrite: 5, attempted: 3, classify: 3 } as const;

const PLAN_TOOL = {
  name: 'plan_task',
  description: 'Pick the landmark agent for this request and write the plan it will follow.',
  input_schema: {
    type: 'object' as const,
    properties: {
      agentId: { type: 'string', enum: SERVICE_IDS, description: 'Service id of the agent that handles the request.' },
      steps: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5, description: 'Short, friendly steps in order.' },
      reply: { type: 'string', description: 'One sentence to the player, e.g. "Sounds like a job for Eddie at the EC2 Factory!"' },
    },
    required: ['agentId', 'steps', 'reply'],
    additionalProperties: false,
  },
};
const Plan = z.object({ agentId: z.enum(SERVICE_IDS), steps: z.array(z.string().min(1).max(160)).min(1).max(5), reply: z.string().max(300) });

const REPORT_TOOL = {
  name: 'report_page',
  description: 'Report which AWS services the page is about.',
  input_schema: {
    type: 'object' as const,
    properties: {
      serviceIds: { type: 'array', items: { type: 'string', enum: SERVICE_IDS }, maxItems: 4 },
      summary: { type: 'string', description: 'One or two beginner-friendly sentences.' },
    },
    required: ['serviceIds', 'summary'],
    additionalProperties: false,
  },
};
const Report = z.object({ serviceIds: z.array(z.string()).max(4), summary: z.string().max(600) });

const describeContext = (c: PageContext) =>
  [c.url && `url: ${c.url}`, c.title && `title: ${c.title}`, c.serviceId && `serviceId matched by the frontend: ${c.serviceId}`].filter(Boolean).join('\n');

const toolInput = <T>(msg: Anthropic.Message, name: string, schema: z.ZodType<T>): T | undefined => {
  const block = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === name);
  const parsed = block ? schema.safeParse(block.input) : undefined;
  return parsed?.success ? parsed.data : undefined;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Implements the frontend contract (docs/backend-contract.md) on top of the agent runner.
 * Rule from the contract: every real AWS call made for an agent is wrapped in agent.state working → idle.
 */
export const createOrchestrator = (deps: {
  llm: Llm;
  runner: AgentRunner;
  snapshot: () => Promise<WorldSnapshot>;
  uploads: UploadStore;
  /** Time the agent gets to walk to its landmark before work starts (mock uses ~4.5 s). */
  walkMs?: number;
  paceMs?: number;
}) => {
  const walkMs = deps.walkMs ?? 4000;
  const paceMs = deps.paceMs ?? 600;

  /** agent.state working → fn → idle, even when fn throws. */
  const working = async <T>(emit: Emit, agentId: string, service: string, detail: string, fn: () => Promise<T>): Promise<T> => {
    emit({ type: 'agent.state', agentId, state: 'working', service, detail });
    try {
      return await fn();
    } finally {
      emit({ type: 'agent.state', agentId, state: 'idle' });
    }
  };

  const plan = async (cmd: Omit<TaskSubmit, 'action'>) => {
    const snapshot = await deps.snapshot();
    const msg = await deps.llm.create({
      max_tokens: 16000,
      system: CONCIERGE_PROMPT,
      tools: [PLAN_TOOL],
      messages: [
        {
          role: 'user',
          content: `<city_snapshot>${snapshotForModel(snapshot)}</city_snapshot>\n${describeContext(cmd.context)}\n\nPlayer request: ${cmd.prompt}`,
        },
      ],
    });
    const parsed = toolInput(msg, PLAN_TOOL.name, Plan);
    if (parsed) return parsed;
    // The model answered without the tool: fall back to the frontend's own keyword routing.
    const agentId = matchText(cmd.prompt) ?? cmd.context.serviceId ?? 'bedrock';
    return { agentId, steps: ['Taking a look at your request'], reply: `Sounds like a job for ${placeFor(agentId)?.agentName ?? agentId}!` };
  };

  const submitTask = async (cmd: Omit<TaskSubmit, 'action'>, emit: Emit, approvals?: Approvals) => {
    const { taskId } = cmd;
    try {
      const p = await working(emit, 'concierge', 'bedrock', 'InvokeModel — routing your request', () => plan(cmd));
      const agentId = serviceById(p.agentId) ? p.agentId : 'bedrock';
      const place = placeFor(agentId)?.place ?? serviceById(agentId)?.name ?? agentId;

      emit({ type: 'agent.message', from: 'concierge', to: 'user', text: p.reply });
      emit({ type: 'agent.message', from: 'concierge', to: agentId, text: `New request: “${cmd.prompt.slice(0, 60)}”` });
      const steps = [`Heading to ${place}`, ...p.steps];
      emit({ type: 'task.plan', taskId, agentId, targetServiceId: agentId, steps });
      emit({ type: 'task.step', taskId, index: 0, text: steps[0]!, status: 'running' });
      await sleep(walkMs);
      emit({ type: 'task.step', taskId, index: 0, text: `Arrived at ${place}`, status: 'done' });

      let index = 1;
      const last = steps.length - 1;
      const result = await deps.runner.turn(agentId, cmd.prompt, {
        onModelCall: (phase) =>
          emit(phase === 'start' ? { type: 'agent.state', agentId, state: 'working', service: 'bedrock', detail: 'InvokeModel — thinking' } : { type: 'agent.state', agentId, state: 'idle' }),
        onToolStart: ({ api, summary }) => {
          emit({ type: 'task.step', taskId, index: Math.min(index, last), text: steps[Math.min(index, last)]!, status: 'running' });
          emit({ type: 'agent.state', agentId, state: 'working', service: api.split(':')[0], detail: `${api.split(':')[1] ?? api} — ${summary}` });
        },
        approve: approvals ? (req) => approvals.request(taskId, req, emit) : undefined,
        onToolEnd: (call) => {
          approvals?.reportResult(taskId, call, emit);
          emit({ type: 'agent.state', agentId, state: 'idle' });
          const i = Math.min(index, last);
          const ok = call.outcome === 'done';
          emit({ type: 'task.step', taskId, index: i, text: ok ? steps[i]! : `${steps[i]} — ${call.message}`, status: ok ? 'done' : 'failed' });
          index++;
        },
        onText: (text) => emit({ type: 'agent.message', from: agentId, to: 'user', text }),
      });

      const ok = !result.refused && result.toolCalls.every((c) => c.outcome === 'done');
      if (ok) {
        // Explanation-only plans (no tool calls) still walk through their remaining steps.
        for (; index <= last; index++) {
          emit({ type: 'task.step', taskId, index, text: steps[index]!, status: 'running' });
          await sleep(paceMs);
          emit({ type: 'task.step', taskId, index, text: steps[index]!, status: 'done' });
        }
      }
      if (result.refused) emit({ type: 'agent.message', from: agentId, to: 'user', text: result.reply });

      const writes = result.toolCalls.filter((c) => c.outcome === 'done' && c.name !== 'describe_resource').length;
      emit({
        type: 'task.done',
        taskId,
        ok,
        result: (result.reply || (ok ? 'Done.' : 'That did not work out.')).slice(0, 400),
        xp: [{ serviceId: agentId, amount: ok ? XP.task + XP.perWrite * writes : XP.attempted }],
      });
    } catch (err) {
      console.error('[task]', err);
      emit({ type: 'error', message: `Task failed: ${(err as Error).message}`, taskId });
    }
  };

  const ask = async (cmd: Omit<ChatAsk, 'action'>, emit: Emit) => {
    const { requestId, districtId } = cmd;
    const district = districtById(districtId);
    if (!district) return emit({ type: 'error', message: `Unknown district "${districtId}"`, requestId });
    const inDistrict = servicesIn(districtId as DistrictId);
    const matched = matchText(cmd.question);
    const svc = inDistrict.find((s) => s.id === matched) ?? inDistrict[0] ?? SERVICES[0]!;
    const agentId = svc.id;

    emit({ type: 'agent.state', agentId: 'bedrock', state: 'working', service: 'bedrock', detail: 'InvokeModelWithResponseStream' });
    emit({ type: 'agent.state', agentId, state: 'working', service: 'bedrock', detail: 'Answering your question' });
    let sent = false;
    try {
      const snapshot = await deps.snapshot();
      const msg = await deps.llm.stream(
        {
          max_tokens: 16000,
          system: `${agentSystemPrompt(agentId)}\n\nYou are answering a question at ${district.hq}. Reply in plain text (no markdown headings), under 120 words.`,
          messages: [
            {
              role: 'user',
              content: `<city_snapshot>${snapshotForModel(snapshot)}</city_snapshot>\n${describeContext(cmd.context)}\n\nQuestion: ${cmd.question}`,
            },
          ],
        },
        (delta) => {
          sent = true;
          emit({ type: 'chat.answer', requestId, districtId, agentId, delta, done: false });
        },
      );
      if (!sent) {
        const text = msg.stop_reason === 'refusal' ? "Sorry, I can't answer that one." : 'Hmm, I have nothing to add.';
        emit({ type: 'chat.answer', requestId, districtId, agentId, delta: text, done: false });
      }
      emit({ type: 'chat.answer', requestId, districtId, agentId, delta: '', done: true });
    } catch (err) {
      console.error('[chat]', err);
      emit({ type: 'chat.answer', requestId, districtId, agentId, delta: '', done: true });
      emit({ type: 'error', message: `Chat failed: ${(err as Error).message}`, requestId });
    } finally {
      emit({ type: 'agent.state', agentId: 'bedrock', state: 'idle' });
      emit({ type: 'agent.state', agentId, state: 'idle' });
    }
  };

  const classifyPage = async (cmd: Omit<PageClassify, 'action'>, emit: Emit) => {
    const { requestId, context } = cmd;
    const image = context.screenshotKey ? deps.uploads.get(context.screenshotKey) : undefined;
    if (!image && !context.url && !context.title) {
      return emit({ type: 'error', message: 'page.classify needs a screenshotKey (uploaded) or a url/title', requestId });
    }
    try {
      const report = await working(emit, 'lookout', 'bedrock', image ? 'InvokeModel (vision) on screenshot' : 'InvokeModel on page title', async () => {
        const content: Anthropic.ContentBlockParam[] = [];
        if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.contentType, data: image.bytes.toString('base64') } });
        content.push({ type: 'text', text: `${describeContext(context) || 'No URL or title.'}\n\nWhat is this page about?` });
        const msg = await deps.llm.create({ max_tokens: 16000, system: lookoutPrompt, tools: [REPORT_TOOL], messages: [{ role: 'user', content }] });
        return toolInput(msg, REPORT_TOOL.name, Report);
      });

      const fallback = context.serviceId ?? matchText(`${context.title ?? ''} ${context.url ?? ''}`);
      const serviceIds = (report?.serviceIds ?? (fallback ? [fallback] : [])).filter((id) => serviceById(id));
      const summary =
        report?.summary ??
        (serviceIds[0] ? `This page is about ${serviceById(serviceIds[0])?.name}.` : "I don't see AWS on this page, but the Oracle can still answer questions about it.");
      emit({ type: 'page.classified', requestId, url: context.url, serviceIds, summary });
      emit({ type: 'agent.message', from: 'lookout', to: serviceIds[0] ?? 'concierge', text: summary });
    } catch (err) {
      console.error('[lookout]', err);
      emit({ type: 'error', message: `Lookout failed: ${(err as Error).message}`, requestId });
    }
  };

  return { submitTask, ask, classifyPage, xp: XP };
};

export type Orchestrator = ReturnType<typeof createOrchestrator>;
