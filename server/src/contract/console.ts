import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { isRisky } from '../../../src/console/risk.js';
import type { Llm } from '../agents/llm.js';
import { neutralise } from '../knowledge/mcp.js';
import { matchText, placeFor, type ServerEvent } from '../world.js';
import type { ConsoleObserve, ConsoleStart, PageSnapshot } from '../world.js';
import { publicError } from '../log.js';

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
  /** The page as of the last snapshot, to tell the model when a step navigated. */
  page: { url: string; title: string; heading?: string };
  /** A model call is in flight — further observes are ignored (no request amplification). */
  thinking: boolean;
}

/** One Copilot per socket, one console task at a time. */
export const MAX_CONSOLE_TASKS = 1;
/** Model calls per player per 10 minutes, across their tabs and reconnects (stop→start loops can't run up the bill). */
export const MODEL_CALL_BUDGET = 60;
const BUDGET_WINDOW_MS = 10 * 60_000;

type Item = PageSnapshot['items'][number];

/** Elements sent to the model per step (the page may send up to 200). */
export const MODEL_ITEM_LIMIT = 120;
const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'my', 'a', 'an', 'to', 'in', 'on', 'of', 'me', 'please', 'create', 'new', 'make', 'set', 'up']);
const wordsOf = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));

/**
 * Cut the snapshot down before it goes to the model (tokens are the Copilot's main cost): drop disabled
 * controls unless the history mentions them, then keep the `limit` most relevant — goal keywords in the
 * name/section, closeness to the main heading's section, form controls over navigation links —
 * in their original page order.
 */
export function trimSnapshot(s: PageSnapshot, goal: string, history: readonly string[] = [], limit = MODEL_ITEM_LIMIT): Item[] {
  const said = history.join('\n').toLowerCase();
  const tokens = new Set(said.split(/[^a-z0-9_-]+/));
  const referenced = (i: Item) => (i.name.length > 2 && said.includes(i.name.toLowerCase())) || tokens.has(i.id.toLowerCase());
  const goalWords = wordsOf(goal);
  const headWords = wordsOf(s.heading ?? '');
  const items = s.items.filter((i) => !i.disabled || referenced(i));
  if (items.length <= limit) return items;
  // Where the main content starts: the first control whose section shares a word with the main heading.
  const headAt = headWords.length ? items.findIndex((i) => wordsOf(i.context ?? '').some((w) => headWords.includes(w))) : -1;
  const score = (i: Item, idx: number) => {
    const text = `${i.name} ${i.context ?? ''}`.toLowerCase();
    let n = goalWords.reduce((acc, w) => acc + (text.includes(w) ? 10 : 0), 0);
    if (headWords.length && wordsOf(i.context ?? '').some((w) => headWords.includes(w))) n += 6;
    if (headAt >= 0) n += Math.max(0, 5 - Math.abs(idx - headAt) / 10);
    if (i.role !== 'link') n += 2; // form controls and buttons do things; links mostly navigate away
    if (referenced(i)) n += 20;
    return n;
  };
  const keep = new Set(
    items
      .map((i, idx) => ({ i, n: score(i, idx), idx }))
      .sort((a, b) => b.n - a.n || a.idx - b.idx)
      .slice(0, limit)
      .map((x) => x.i),
  );
  return items.filter((i) => keep.has(i));
}

/** Only the path and hash of a console URL (the query holds nothing the model needs). */
const shortUrl = (raw: string) => {
  try {
    const u = new URL(raw);
    return `${u.pathname}${u.hash}`.slice(0, 160);
  } catch {
    return raw.slice(0, 160);
  }
};

/** Console labels are page text (resource names, tags, notifications): untrusted, so no tag characters. */
const describe = (s: PageSnapshot, goal: string, history: readonly string[]) =>
  [
    `URL: ${neutralise(s.url)}`,
    `Title: ${neutralise(s.title)}${s.heading ? ` · Heading: ${neutralise(s.heading)}` : ''}`,
    'Elements:',
    ...trimSnapshot(s, goal, history).map((i: Item) => {
      const state = [i.disabled && 'disabled', i.checked !== undefined && (i.checked ? 'checked' : 'unchecked'), i.value && `value="${neutralise(i.value)}"`, i.sensitive && 'secret']
        .filter(Boolean)
        .join(', ');
      return `${i.id} | ${i.role} | ${neutralise(i.name)}${i.context ? ` | ${neutralise(i.context)}` : ''}${state ? ` | ${state}` : ''}`;
    }),
  ].join('\n');

/**
 * Console Copilot (contract v2.1): Claude on Bedrock plans the learner's console task one visible step at a
 * time; the extension performs it (its safety rules win) and reports back with console.observe.
 */
export const createConsoleCopilot = (deps: { llm: Llm; now?: () => number; /** Shared by a player's sockets. */ calls?: number[] }) => {
  const tasks = new Map<string, Task>();
  const now = deps.now ?? Date.now;
  let inFlight = 0;
  const calls = deps.calls ?? [];
  const overBudget = () => {
    const t = now();
    while (calls.length && t - calls[0]! > BUDGET_WINDOW_MS) calls.shift();
    return calls.length >= MODEL_CALL_BUDGET;
  };

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
    if (overBudget()) return finish(taskId, false, 'That’s a lot of console steps for now — take a short break and try again.', emit);
    emit({ type: 'agent.state', agentId: t.agentId, state: 'working', service: 'bedrock', detail: 'InvokeModel — next console step' });
    let step: z.infer<typeof Step> | undefined;
    t.thinking = true;
    inFlight++;
    calls.push(now());
    try {
      // Not a forced tool_choice: Bedrock rejects one while thinking is on, and nothing here pins thinking off for
      // whichever model is configured (default us.anthropic.claude-opus-5-5, config.ts).
      // The prompt asks for the tool and a missing call is handled below. max_tokens covers thinking + the call.
      const msg = await deps.llm.create({
        max_tokens: 8000,
        output_config: { effort: 'low' },
        system: SYSTEM,
        tools: [STEP_TOOL],
        tool_choice: { type: 'auto' },
        messages: [
          {
            role: 'user',
            content: `Goal: ${t.goal}\n\nSo far:\n${t.history.join('\n') || '(nothing yet)'}\n\n${describe(snapshot, t.goal, t.history)}\n\nCall next_console_step with your one next step.`,
          },
        ],
      });
      const block = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === STEP_TOOL.name);
      const parsed = block ? Step.safeParse(block.input) : undefined;
      step = parsed?.success ? parsed.data : undefined;
    } catch (err) {
      publicError('copilot step failed', err, { taskId });
    } finally {
      t.thinking = false;
      inFlight--;
    }
    if (!tasks.has(taskId)) return; // stopped while thinking
    if (!step) return finish(taskId, false, 'I couldn’t work out the next step on this page.', emit);
    // Server-side guard too: risky controls are always the learner's click.
    if ((step.action === 'click' || step.action === 'select') && step.target && isRisky(step.target.name)) step.risk = 'confirm';
    // …and so is picking a risky option or typing a risky value (e.g. a custom select's "Disable …").
    if ((step.action === 'select' || step.action === 'type') && isRisky(step.value ?? '')) step.risk = 'confirm';
    const index = t.index++;
    t.history.push(`${index + 1}. ${step.action} ${step.target?.name ?? ''}${step.target?.id ? ` [${step.target.id}]` : ''} — ${step.say}`);
    emit({ type: 'console.step', taskId, index, agentId: t.agentId, ...step });
    if (step.action === 'done') finish(taskId, true, step.say, emit);
  };

  return {
    start(cmd: Omit<ConsoleStart, 'action'>, emit: Emit) {
      // A stopped task's model call may still be running: no new task until it has returned.
      if (tasks.size >= MAX_CONSOLE_TASKS || tasks.has(cmd.taskId) || inFlight > 0) {
        emit({ type: 'error', message: 'A console task is already running — stop it first.', taskId: cmd.taskId });
        return;
      }
      const agentId = cmd.context.serviceId ?? matchText(cmd.goal) ?? 'bedrock';
      tasks.set(cmd.taskId, { goal: cmd.goal, agentId, index: 0, misses: 0, history: [], page: { url: cmd.snapshot.url, title: cmd.snapshot.title, heading: cmd.snapshot.heading }, thinking: false });
      const who = placeFor(agentId)?.agentName ?? agentId;
      emit({ type: 'agent.message', from: 'concierge', to: 'user', text: `${who} will do this in your console, step by step — watch the highlights.` });
      emit({ type: 'task.plan', taskId: cmd.taskId, agentId, targetServiceId: agentId, steps: ['Working in your AWS console'] });
      return next(cmd.taskId, cmd.snapshot, emit);
    },
    observe(cmd: Omit<ConsoleObserve, 'action'>, emit: Emit) {
      const t = tasks.get(cmd.taskId);
      // Only the answer to the step we just sent counts, and only once: stale, repeated or
      // out-of-order observes can't trigger extra model calls.
      if (!t || t.thinking || cmd.index !== t.index - 1 || t.history.at(-1)?.startsWith('   result')) return;
      // Say when the step changed the page (SPA route / title / heading), so the model knows where it is now.
      const s = cmd.snapshot;
      const moved = s.url !== t.page.url || s.title !== t.page.title || s.heading !== t.page.heading;
      const change = moved ? ` · page changed: now "${(s.heading ?? s.title).slice(0, 80)}" at ${shortUrl(s.url)}` : ' · same page';
      t.page = { url: s.url, title: s.title, heading: s.heading };
      t.history.push(`   result: ${cmd.ok ? 'ok' : 'failed'}${cmd.note ? ` (${cmd.note.slice(0, 120)})` : ''}${change}`);
      if (!cmd.ok && ++t.misses >= 3) return finish(cmd.taskId, false, 'I got stuck after a few tries, so I stopped.', emit);
      return next(cmd.taskId, cmd.snapshot, emit);
    },
    stop(taskId: string, emit: Emit) {
      finish(taskId, false, 'Stopped by the learner.', emit);
    },
    /** Socket closed: drop everything (no model calls continue for a gone client). */
    stopAll() {
      tasks.clear();
    },
    get active() {
      return tasks.size;
    },
    get inFlight() {
      return inFlight;
    },
  };
};

export type ConsoleCopilot = ReturnType<typeof createConsoleCopilot>;
