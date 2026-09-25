import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { isRisky } from '../../../src/console/risk.js';
import type { Llm } from '../agents/llm.js';
import { matchText, placeFor, type ServerEvent } from '../world.js';
import type { ConsoleObserve, ConsoleStart, PageSnapshot } from '../world.js';

type Emit = (e: ServerEvent) => void;

/** Contract v2.1 console snapshot, as validated at the socket (labels only; the page never sends secrets). */
export const Snapshot = z
  .object({
    url: z.string().max(2048),
    title: z.string().max(200),
    heading: z.string().max(120).optional(),
    items: z
      .array(
        z.object({
          id: z.string().max(24),
          role: z.string().max(32),
          name: z.string().max(160),
          context: z.string().max(100).optional(),
          value: z.string().max(100).optional(),
          checked: z.boolean().optional(),
          disabled: z.boolean().optional(),
          sensitive: z.boolean().optional(),
        }),
      )
      .max(200),
  })
  .strict();

const Step = z
  .object({
    action: z.enum(['click', 'type', 'select', 'point', 'done']),
    target: z.object({ id: z.string().max(24).optional(), name: z.string().max(160) }).optional(),
    value: z.string().max(200).optional(),
    say: z.string().min(1).max(200),
    why: z.string().max(300).optional(),
    risk: z.enum(['safe', 'confirm']).default('safe'),
  })
  .strict();

const STEP_TOOL = {
  name: 'next_console_step',
  description: 'The single next action to take in the AWS console page, with a short teaching explanation.',
  input_schema: z.toJSONSchema(Step, { io: 'input' }) as Anthropic.Tool.InputSchema,
};

const SYSTEM = `You are an AWS City agent operating the learner's real AWS Management Console, one step at a time.
Each turn you get the goal, the visible interactive elements (id | role | name | section | state) and what happened so far.
Choose exactly ONE next step with next_console_step:
- click/type/select an element by its id (copy the name too), or "point" to explain something without changing it, or "done" when finished.
- "say" = what you are doing, in plain words (<= 20 words). "why" = the AWS lesson behind it (<= 35 words): teach the concept.
- Prefer secure, cheap defaults: keep Block Public Access on, keep default encryption, smallest/free-tier options, least privilege.
- Never touch delete/terminate/remove, IAM admin or access keys, billing, account or sign-out controls. If the goal needs one,
  set risk "confirm" and explain — the learner will click it themselves.
- Never type secrets. Invent safe example values (e.g. names starting with "aws-city-").
- If the page doesn't match the goal, point the learner to where to go, then "done".`;

const MAX_STEPS = 25;

interface Task {
  goal: string;
  agentId: string;
  index: number;
  misses: number;
  history: string[];
}

const describe = (s: PageSnapshot) =>
  [
    `URL: ${s.url}`,
    `Title: ${s.title}${s.heading ? ` · Heading: ${s.heading}` : ''}`,
    'Elements:',
    ...s.items.slice(0, 140).map((i: PageSnapshot['items'][number]) => {
      const state = [i.disabled && 'disabled', i.checked !== undefined && (i.checked ? 'checked' : 'unchecked'), i.value && `value="${i.value}"`, i.sensitive && 'secret']
        .filter(Boolean)
        .join(', ');
      return `${i.id} | ${i.role} | ${i.name}${i.context ? ` | ${i.context}` : ''}${state ? ` | ${state}` : ''}`;
    }),
  ].join('\n');

/**
 * Console Copilot (contract v2.1): Claude on Bedrock plans the learner's console task one visible step at a
 * time; the extension performs it (its safety rules win) and reports back with console.observe.
 */
export const createConsoleCopilot = (deps: { llm: Llm }) => {
  const tasks = new Map<string, Task>();

  const finish = (taskId: string, ok: boolean, result: string, emit: Emit) => {
    const t = tasks.get(taskId);
    if (!t) return;
    tasks.delete(taskId);
    emit({ type: 'agent.state', agentId: t.agentId, state: 'idle' });
    emit({ type: 'task.done', taskId, ok, result: result.slice(0, 400), xp: ok ? [{ serviceId: t.agentId, amount: 20 }] : [] });
  };

  const next = async (taskId: string, snapshot: PageSnapshot, emit: Emit) => {
    const t = tasks.get(taskId);
    if (!t) return;
    if (t.index >= MAX_STEPS) return finish(taskId, false, 'Step budget reached — stopping so nothing unexpected happens.', emit);
    emit({ type: 'agent.state', agentId: t.agentId, state: 'working', service: 'bedrock', detail: 'InvokeModel — next console step' });
    let step: z.infer<typeof Step> | undefined;
    try {
      const msg = await deps.llm.create({
        max_tokens: 1024,
        system: SYSTEM,
        tools: [STEP_TOOL],
        tool_choice: { type: 'tool', name: STEP_TOOL.name },
        messages: [{ role: 'user', content: `Goal: ${t.goal}\n\nSo far:\n${t.history.join('\n') || '(nothing yet)'}\n\n${describe(snapshot)}` }],
      });
      const block = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === STEP_TOOL.name);
      const parsed = block ? Step.safeParse(block.input) : undefined;
      step = parsed?.success ? parsed.data : undefined;
    } catch (err) {
      console.error('[console]', err);
    }
    if (!tasks.has(taskId)) return; // stopped while thinking
    if (!step) return finish(taskId, false, 'I couldn’t work out the next step on this page.', emit);
    // Server-side guard too: risky controls are always the learner's click.
    if ((step.action === 'click' || step.action === 'select') && step.target && isRisky(step.target.name)) step.risk = 'confirm';
    const index = t.index++;
    t.history.push(`${index + 1}. ${step.action} ${step.target?.name ?? ''} — ${step.say}`);
    emit({ type: 'console.step', taskId, index, agentId: t.agentId, ...step });
    if (step.action === 'done') finish(taskId, true, step.say, emit);
  };

  return {
    start(cmd: Omit<ConsoleStart, 'action'>, emit: Emit) {
      const agentId = cmd.context.serviceId ?? matchText(cmd.goal) ?? 'bedrock';
      tasks.set(cmd.taskId, { goal: cmd.goal, agentId, index: 0, misses: 0, history: [] });
      const who = placeFor(agentId)?.agentName ?? agentId;
      emit({ type: 'agent.message', from: 'concierge', to: 'user', text: `${who} will do this in your console, step by step — watch the highlights.` });
      emit({ type: 'task.plan', taskId: cmd.taskId, agentId, targetServiceId: agentId, steps: ['Working in your AWS console'] });
      return next(cmd.taskId, cmd.snapshot, emit);
    },
    observe(cmd: Omit<ConsoleObserve, 'action'>, emit: Emit) {
      const t = tasks.get(cmd.taskId);
      if (!t) return;
      t.history.push(`   result: ${cmd.ok ? 'ok' : 'failed'}${cmd.note ? ` (${cmd.note})` : ''}`);
      if (!cmd.ok && ++t.misses >= 3) return finish(cmd.taskId, false, 'I got stuck after a few tries, so I stopped.', emit);
      return next(cmd.taskId, cmd.snapshot, emit);
    },
    stop(taskId: string, emit: Emit) {
      finish(taskId, false, 'Stopped by the learner.', emit);
    },
    get active() {
      return tasks.size;
    },
  };
};

export type ConsoleCopilot = ReturnType<typeof createConsoleCopilot>;
