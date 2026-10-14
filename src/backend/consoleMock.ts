// The mock backend's Console Copilot brain: decides the next console step from the live page snapshot.
// Scripted, snapshot-driven demo flows (reliable offline demos) for S3 "Create bucket", EC2 "Launch
// instance", DynamoDB "Create table" and Lambda "Create function"; for anything else it points at the
// most relevant control it can see and explains it. The server (server/) uses Claude on Bedrock for any page.
import type { ConsoleStepEvent, PageSnapshot, ServerEvent, SnapshotItem } from './contract';
import { placeFor } from '@/world/places';

type Step = Omit<ConsoleStepEvent, 'type' | 'taskId' | 'index' | 'agentId'>;
type FlowId = 's3' | 'ec2' | 'dynamodb' | 'lambda';
interface Task {
  goal: string;
  agentId: string;
  flow?: FlowId;
  index: number;
  did: Set<string>;
  misses: number;
  /** The resource name this run creates (random suffix so repeated demos don't collide). */
  name: string;
}

const MAX_STEPS = 25;
const find = (s: PageSnapshot, re: RegExp, role?: string) => s.items.find((i) => re.test(i.name) && (!role || i.role === role));
const target = (i: SnapshotItem) => ({ id: i.id, name: i.name });
const suffix = () => Math.random().toString(36).slice(2, 6);

/**
 * One scripted step: fires once (key), when its control is on screen. Rules run in order; `onForm`
 * tells the flow whether the create form is showing (the list page's "Create" button opens it).
 */
interface Rule {
  key: string;
  find: (s: PageSnapshot) => SnapshotItem | undefined;
  step: (i: SnapshotItem, t: Task) => Step;
  /** Only when the form is open (default) or only when it isn't. */
  page?: 'form' | 'list';
}
interface Flow {
  onForm: (s: PageSnapshot) => boolean;
  rules: Rule[];
  /** The rule whose success means the resource was created. */
  finalKey: string;
  done: (t: Task) => Step;
}

const S3: Flow = {
  onForm: (s) => !!find(s, /^bucket name/i, 'textbox'),
  finalKey: 'create',
  rules: [
    { key: 'open', page: 'list', find: (s) => find(s, /^create bucket$/i), step: (i) => ({ action: 'click', target: target(i), say: 'Opening the “Create bucket” form for you.', why: 'A bucket is the top-level container for your S3 objects, like a lake that holds all your fish.', risk: 'safe' }) },
    { key: 'name', find: (s) => find(s, /^bucket name/i, 'textbox'), step: (i, t) => ({ action: 'type', target: target(i), value: t.name, say: `Naming it ${t.name}.`, why: 'Bucket names are 3–63 lowercase letters, numbers, dots or hyphens, starting and ending with a letter or number. They appear in URLs and must be unique across the whole AWS partition. Names ending in your account ID, Region and -an are reserved for your account.', risk: 'safe' }) },
    { key: 'bpa', find: (s) => find(s, /block all public access/i), step: (i) => ({ action: 'point', target: target(i), say: 'Leaving “Block all public access” switched ON.', why: 'Public buckets are a leading cause of S3 data leaks. Only turn this off for content you mean to make public, and use CloudFront for websites.', risk: 'safe' }) },
    { key: 'enc', find: (s) => find(s, /(server-side encryption|sse-s3|encryption type)/i), step: (i) => ({ action: 'point', target: target(i), say: 'Default encryption stays on (SSE-S3).', why: 'S3 encrypts every new object at rest by default. Choose SSE-KMS when you need your own key and an audit trail in CloudTrail.', risk: 'safe' }) },
    { key: 'create', find: (s) => find(s, /^create bucket$/i), step: () => ({ action: 'click', target: { name: 'Create bucket' }, say: 'Creating the bucket now.', why: 'S3 creates it in the Region you picked. You pay only for what you store and request, so an empty bucket costs nothing.', risk: 'safe' }) },
  ],
  done: (t) => ({ action: 'done', say: `Done! ${t.name} is ready. Try uploading a file to it.`, why: 'Next up: storage classes and lifecycle rules. Ask Sally at S3 Lake.', risk: 'safe' }),
};

const EC2: Flow = {
  onForm: (s) => !!find(s, /^instance type/i) || /launch an instance/i.test(s.heading ?? ''),
  finalKey: 'launch',
  rules: [
    { key: 'open', page: 'list', find: (s) => find(s, /^launch instances?$/i), step: (i) => ({ action: 'click', target: target(i), say: 'Opening the “Launch an instance” wizard.', why: 'An EC2 instance is a virtual server you rent by the second: you pick its OS image, size, login and firewall.', risk: 'safe' }) },
    { key: 'name', find: (s) => find(s, /^name$/i, 'textbox'), step: (i, t) => ({ action: 'type', target: target(i), value: t.name, say: `Naming it ${t.name}.`, why: 'The name is just a “Name” tag. Tags help you find, group and track the cost of resources, so tag everything from day one.', risk: 'safe' }) },
    { key: 'ami', find: (s) => find(s, /^amazon linux/i, 'radio'), step: (i) => ({ action: 'point', target: target(i), say: 'Keeping Amazon Linux as the operating system.', why: 'An AMI (Amazon Machine Image) is the disk image the server boots from. Amazon Linux 2023 has no license fee, gets AWS security updates and is tuned for EC2.', risk: 'safe' }) },
    { key: 'type', find: (s) => find(s, /^instance type/i, 'combobox'), step: (i) => ({ action: 'select', target: target(i), value: 't3.micro', say: 'Choosing the t3.micro instance type.', why: 't3.micro is Free Tier eligible on both the old plan and the July 2025 plan, and it runs the default x86 AMI. The “t” means burstable CPU, good for light workloads.', risk: 'safe' }) },
    { key: 'key', find: (s) => find(s, /^key pair/i, 'combobox'), step: (i) => ({ action: 'point', target: target(i), say: 'We can proceed without a key pair.', why: 'Key pairs are for SSH logins. EC2 Instance Connect lets you log in from the console without long-lived keys to lose, which is safer for a demo.', risk: 'safe' }) },
    { key: 'sg', find: (s) => find(s, /^create security group/i, 'radio'), step: (i) => ({ action: 'point', target: target(i), say: 'Keeping the default: a new security group.', why: 'A security group is the instance’s firewall. This new one allows SSH from anywhere. Fine for a brief test, but for real projects allow SSH only from your own IP address. If you connect from the console, allow the EC2 Instance Connect prefix list instead.', risk: 'safe' }) },
    { key: 'launch', find: (s) => find(s, /^launch instance$/i), step: () => ({ action: 'click', target: { name: 'Launch instance' }, say: 'Launching the instance now.', why: 'You pay per second while it runs. Stop or terminate it when you’re done. A stopped instance still bills for its EBS disk and any Elastic IP.', risk: 'confirm' }) },
  ],
  done: (t) => ({ action: 'done', say: `Done! ${t.name} is launching on a t3.micro.`, why: 'Next: connect with EC2 Instance Connect, then stop it when you’re finished so it doesn’t keep costing money.', risk: 'safe' }),
};

const DYNAMODB: Flow = {
  onForm: (s) => !!find(s, /^table name/i, 'textbox'),
  finalKey: 'create',
  rules: [
    { key: 'open', page: 'list', find: (s) => find(s, /^create table$/i), step: (i) => ({ action: 'click', target: target(i), say: 'Opening the “Create table” form.', why: 'DynamoDB is a serverless key-value database: no servers to size, single-digit-millisecond reads at any scale.', risk: 'safe' }) },
    { key: 'name', find: (s) => find(s, /^table name/i, 'textbox'), step: (i, t) => ({ action: 'type', target: target(i), value: t.name, say: `Naming the table ${t.name}.`, why: 'Table names are unique per account and Region. AWS advises few tables: design keys around the queries you’ll run.', risk: 'safe' }) },
    { key: 'pk', find: (s) => find(s, /^partition key/i, 'textbox'), step: (i) => ({ action: 'type', target: target(i), value: 'id', say: 'Using “id” as the partition key.', why: 'The partition key decides which storage partition holds each item. Pick something with many distinct values, like an id, so load spreads evenly.', risk: 'safe' }) },
    { key: 'defaults', find: (s) => find(s, /^default settings/i, 'radio'), step: (i) => ({ action: 'point', target: target(i), say: 'Keeping the default settings (on-demand capacity).', why: 'On-demand capacity bills per request and scales automatically, so it suits traffic you can’t predict yet. Switch to provisioned later for steady loads.', risk: 'safe' }) },
    { key: 'create', find: (s) => find(s, /^create table$/i), step: () => ({ action: 'click', target: { name: 'Create table' }, say: 'Creating the table now.', why: 'An empty on-demand table costs nothing; you pay for reads, writes and storage as you use them.', risk: 'safe' }) },
  ],
  done: (t) => ({ action: 'done', say: `Done! ${t.name} is ready. Try “Explore table items” to add one.`, why: 'Next: add a sort key or a global secondary index when you need new query patterns.', risk: 'safe' }),
};

const LAMBDA: Flow = {
  onForm: (s) => !!find(s, /^function name/i, 'textbox'),
  finalKey: 'create',
  rules: [
    { key: 'open', page: 'list', find: (s) => find(s, /^create function$/i), step: (i) => ({ action: 'click', target: target(i), say: 'Opening the “Create function” form.', why: 'Lambda runs your code without servers: you upload a function, AWS runs it on each event and bills per millisecond.', risk: 'safe' }) },
    {
      key: 'scratch',
      find: (s) => find(s, /^author from scratch/i, 'radio'),
      step: (i) =>
        i.checked
          ? { action: 'point', target: target(i), say: '“Author from scratch” is already selected.', why: 'Starting from scratch gives you a tiny Hello World handler — the clearest way to see how a function works.', risk: 'safe' }
          : { action: 'click', target: target(i), say: 'Picking “Author from scratch”.', why: 'Starting from scratch gives you a tiny Hello World handler — the clearest way to see how a function works.', risk: 'safe' },
    },
    { key: 'name', find: (s) => find(s, /^function name/i, 'textbox'), step: (i) => ({ action: 'type', target: target(i), value: 'city-hello', say: 'Naming it city-hello.', why: 'The name becomes part of the function’s ARN, which other services use to invoke it.', risk: 'safe' }) },
    { key: 'runtime', find: (s) => find(s, /^runtime/i, 'combobox'), step: (i) => ({ action: 'select', target: target(i), value: 'Node.js 24.x', say: 'Choosing the Node.js 24.x runtime.', why: 'The runtime is the language environment Lambda starts for your code. Use the newest non-preview version for security patches and speed.', risk: 'safe' }) },
    { key: 'create', find: (s) => find(s, /^create function$/i), step: () => ({ action: 'click', target: { name: 'Create function' }, say: 'Creating the function now.', why: 'Lambda also creates a basic execution role that only lets the function write its logs to CloudWatch.', risk: 'safe' }) },
  ],
  done: () => ({ action: 'done', say: 'Done! city-hello is live. Press “Test” to run it once.', why: 'Next: add a trigger (API Gateway, S3, EventBridge) so something calls your function.', risk: 'safe' }),
};

const FLOWS: Record<FlowId, Flow> = { s3: S3, ec2: EC2, dynamodb: DYNAMODB, lambda: LAMBDA };

/** Goal keywords first, then the service in the console URL's path, then the page the player was on. */
export function flowFor(goal: string, url = '', serviceId?: string): FlowId | undefined {
  const g = goal.toLowerCase();
  if (/\b(s3|buckets?)\b/.test(g)) return 's3';
  if (/\b(ec2|instances?|virtual (machine|server)|vm|server)\b/.test(g)) return 'ec2';
  if (/\b(dynamo(db)?|tables?|nosql)\b/.test(g)) return 'dynamodb';
  if (/\b(lambda|functions?|serverless)\b/.test(g)) return 'lambda';
  let path = '';
  try {
    path = new URL(url).pathname.split('/')[1]?.toLowerCase() ?? '';
  } catch {
    /* no url */
  }
  const byPath: Record<string, FlowId> = { s3: 's3', ec2: 'ec2', dynamodbv2: 'dynamodb', dynamodb: 'dynamodb', lambda: 'lambda' };
  if (byPath[path]) return byPath[path];
  return serviceId && serviceId in FLOWS ? (serviceId as FlowId) : undefined;
}

/** A scripted flow, as a function of what's on screen. */
function flowStep(flow: Flow, t: Task, s: PageSnapshot): Step | undefined {
  if (t.did.has(flow.finalKey)) return flow.done(t);
  const onForm = flow.onForm(s);
  for (const r of flow.rules) {
    if (t.did.has(r.key)) continue;
    if ((r.page ?? 'form') === 'list' ? onForm : !onForm) continue;
    const item = r.find(s);
    if (!item) continue;
    t.did.add(r.key);
    const step = r.step(item, t);
    // Acting steps always carry the exact snapshot id (the page acts on nothing else).
    if (step.target && !step.target.id) step.target = target(item);
    return step;
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
    return { action: 'done', say: 'That’s as far as the offline demo goes on this page.', why: 'Connect to the AWS City server and Claude on Bedrock will plan every step for any console page.', risk: 'safe' };
  }
  t.did.add(best.id);
  return { action: 'point', target: { id: best.id, name: best.name }, say: `This is “${best.name}”${best.context ? ` in ${best.context}` : ''}.`, why: 'It’s the closest match to what you asked for. The full Copilot would take it from here.', risk: 'safe' };
}

const NAMES: Record<FlowId, () => string> = {
  s3: () => `city-demo-${suffix()}${suffix()}`,
  ec2: () => `city-web-${suffix()}`,
  dynamodb: () => `city-demo-${suffix()}`,
  lambda: () => 'city-hello',
};

export class ConsoleMock {
  private tasks = new Map<string, Task>();
  constructor(private emit: (e: ServerEvent) => void) {}

  start(taskId: string, goal: string, snapshot: PageSnapshot, serviceId?: string) {
    const flow = flowFor(goal, snapshot.url, serviceId);
    const agentId = flow ?? serviceId ?? 'concierge';
    const t: Task = { goal, agentId, flow, index: 0, did: new Set(), misses: 0, name: flow ? NAMES[flow]() : '' };
    this.tasks.set(taskId, t);
    const who = flow ? (placeFor(flow)?.agentName ?? 'the right agent') : 'the right agent';
    this.emit({ type: 'agent.message', from: 'concierge', to: 'user', text: `I’ll ask ${who} to do it in your console, step by step.` });
    this.emit({ type: 'task.plan', taskId, agentId, targetServiceId: flow ?? serviceId ?? 's3', steps: ['Working in your AWS console'] });
    this.next(taskId, snapshot);
  }

  observe(taskId: string, ok: boolean, note: string | undefined, snapshot: PageSnapshot) {
    const t = this.tasks.get(taskId);
    if (!t) return;
    this.emit({ type: 'agent.state', agentId: t.agentId, state: 'idle' });
    if (!ok) {
      t.misses++;
      this.emit({ type: 'agent.message', from: t.agentId, to: 'user', text: note === 'player did not act' ? 'No rush — I’ll wait here.' : `Hmm: ${note ?? 'that didn’t work'}.` });
      if (t.misses >= 3) return this.finish(taskId, false, 'I got stuck after a few tries, so I stopped before anything unexpected happened.');
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
    const step = (t.flow ? flowStep(FLOWS[t.flow], t, s) : undefined) ?? genericStep(t, s);
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
    this.emit({ type: 'task.done', taskId, ok, result: text, xp: ok && t.flow ? [{ serviceId: t.flow, amount: 20 }] : [] });
  }
}
