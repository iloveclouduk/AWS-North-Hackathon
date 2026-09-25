// The mock backend's Console Copilot brain: decides the next console step from the live page snapshot.
// Scripted for "create an S3 bucket" (reliable demo); for anything else it points at the most relevant
// control it can see and explains it. The server (server/) uses Claude on Bedrock for any page.
import type { ConsoleStepEvent, PageSnapshot, ServerEvent, SnapshotItem } from './contract';

type Step = Omit<ConsoleStepEvent, 'type' | 'taskId' | 'index' | 'agentId'>;
interface Task {
  goal: string;
  agentId: string;
  index: number;
  did: Set<string>;
  misses: number;
  bucket: string;
}

const MAX_STEPS = 25;
const find = (s: PageSnapshot, re: RegExp, role?: string) => s.items.find((i) => re.test(i.name) && (!role || i.role === role));

/** The S3 "Create bucket" walkthrough, as a function of what's on screen. */
function s3Step(t: Task, s: PageSnapshot): Step | undefined {
  const nameField = find(s, /^bucket name/i, 'textbox');
  const createBtn = find(s, /^create bucket$/i);
  const onForm = !!nameField;
  if (!onForm && createBtn && !t.did.has('open')) {
    t.did.add('open');
    return { action: 'click', target: { id: createBtn.id, name: createBtn.name }, say: 'Opening the “Create bucket” form for you.', why: 'A bucket is the top-level container for your S3 objects — like a lake that holds all your fish.', risk: 'safe' };
  }
  if (onForm && !t.did.has('name')) {
    t.did.add('name');
    return { action: 'type', target: { id: nameField!.id, name: nameField!.name }, value: t.bucket, say: `Naming it ${t.bucket}.`, why: 'Bucket names are global across all AWS accounts: 3–63 lowercase letters, numbers, dots or hyphens. They appear in the bucket’s URL.', risk: 'safe' };
  }
  const bpa = find(s, /block all public access/i);
  if (onForm && bpa && !t.did.has('bpa')) {
    t.did.add('bpa');
    return { action: 'point', target: { id: bpa.id, name: bpa.name }, say: 'Leaving “Block all public access” switched ON.', why: 'Public buckets are the #1 cause of S3 data leaks. Only turn this off for deliberately public content — and prefer CloudFront for websites.', risk: 'safe' };
  }
  const enc = find(s, /(server-side encryption|sse-s3|encryption type)/i);
  if (onForm && enc && !t.did.has('enc')) {
    t.did.add('enc');
    return { action: 'point', target: { id: enc.id, name: enc.name }, say: 'Default encryption stays on (SSE-S3).', why: 'S3 encrypts every new object at rest by default. Choose SSE-KMS when you need your own key and an audit trail in CloudTrail.', risk: 'safe' };
  }
  if (onForm && createBtn && !t.did.has('create')) {
    t.did.add('create');
    return { action: 'click', target: { id: createBtn.id, name: createBtn.name }, say: 'Creating the bucket now.', why: 'S3 creates it in the Region you picked. You pay only for what you store and request — an empty bucket costs nothing.', risk: 'safe' };
  }
  if (t.did.has('create')) {
    return { action: 'done', say: `Done! ${t.bucket} is ready. Try uploading a file to it.`, why: 'Next up: storage classes and lifecycle rules — ask Sally at S3 Lake!', risk: 'safe' };
  }
  return undefined;
}

/** Any other page: point at the most relevant visible control and explain it (the server does real planning). */
function genericStep(t: Task, s: PageSnapshot): Step {
  const words = t.goal.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const scored = s.items
    .filter((i: SnapshotItem) => !i.disabled && !t.did.has(i.id))
    .map((i) => ({ i, score: words.reduce((n, w) => n + (i.name.toLowerCase().includes(w) ? w.length : 0), 0) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0]?.score ? scored[0].i : undefined;
  if (!best || t.index >= 3) {
    return { action: 'done', say: 'That’s as far as the offline demo goes on this page.', why: 'Connect the AWS City server (WXT_BACKEND=aws) and Claude on Bedrock will plan every step for any console page.', risk: 'safe' };
  }
  t.did.add(best.id);
  return { action: 'point', target: { id: best.id, name: best.name }, say: `This is “${best.name}”${best.context ? ` in ${best.context}` : ''}.`, why: 'It’s the closest match to what you asked for — the full Copilot (server) would take it from here.', risk: 'safe' };
}

export class ConsoleMock {
  private tasks = new Map<string, Task>();
  constructor(private emit: (e: ServerEvent) => void) {}

  start(taskId: string, goal: string, snapshot: PageSnapshot, serviceId?: string) {
    const isS3 = /\b(s3|bucket)\b/i.test(goal) || serviceId === 's3';
    const agentId = isS3 ? 's3' : serviceId ?? 'concierge';
    const t: Task = { goal, agentId, index: 0, did: new Set(), misses: 0, bucket: `aws-city-demo-${Math.random().toString(36).slice(2, 8)}` };
    this.tasks.set(taskId, t);
    this.emit({ type: 'agent.message', from: 'concierge', to: 'user', text: `I’ll ask ${isS3 ? 'Sally' : 'the right agent'} to do it in your console, step by step.` });
    this.emit({ type: 'task.plan', taskId, agentId, targetServiceId: isS3 ? 's3' : (serviceId ?? 's3'), steps: ['Working in your AWS console'] });
    this.next(taskId, snapshot);
  }

  observe(taskId: string, ok: boolean, note: string | undefined, snapshot: PageSnapshot) {
    const t = this.tasks.get(taskId);
    if (!t) return;
    this.emit({ type: 'agent.state', agentId: t.agentId, state: 'idle' });
    if (!ok) {
      t.misses++;
      this.emit({ type: 'agent.message', from: t.agentId, to: 'user', text: note === 'player did not act' ? 'No rush — I’ll wait here.' : `Hmm: ${note ?? 'that didn’t work'}.` });
      if (t.misses >= 3) return this.finish(taskId, false, 'I got stuck after a few tries — I stopped so nothing unexpected happens.');
    }
    setTimeout(() => this.next(taskId, snapshot), 350);
  }

  stop(taskId: string) {
    const t = this.tasks.get(taskId);
    if (t) this.finish(taskId, false, 'Stopped.');
  }

  private next(taskId: string, s: PageSnapshot) {
    const t = this.tasks.get(taskId);
    if (!t) return;
    if (t.index >= MAX_STEPS) return this.finish(taskId, false, 'Step budget reached — stopping.');
    const step = (t.agentId === 's3' ? s3Step(t, s) : undefined) ?? genericStep(t, s);
    const index = t.index++;
    this.emit({ type: 'agent.state', agentId: t.agentId, state: 'working', service: 'console', detail: `${step.action} ${step.target?.name ?? ''}`.trim() });
    this.emit({ type: 'console.step', taskId, index, agentId: t.agentId, ...step });
    if (step.action === 'done') this.finish(taskId, true, step.say);
  }

  private finish(taskId: string, ok: boolean, text: string) {
    const t = this.tasks.get(taskId);
    if (!t) return;
    this.tasks.delete(taskId);
    this.emit({ type: 'agent.state', agentId: t.agentId, state: 'idle' });
    this.emit({ type: 'task.done', taskId, ok, result: text, xp: ok && t.agentId === 's3' ? [{ serviceId: 's3', amount: 20 }] : [] });
  }
}
