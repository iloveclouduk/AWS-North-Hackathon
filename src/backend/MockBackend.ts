import { Listeners, type AgentBackend, type ConnectionStatus } from './AgentBackend';
import type { Progress, ServerEvent } from './contract';
import { SERVICES, matchText, serviceById, servicesIn, type DistrictId } from '@/world/taxonomy';
import { placeFor } from '@/world/places';

/**
 * In-browser fake of the AWS backend. Emits exactly the events the real one will, with realistic
 * timing, so the whole game can be built and demoed before any Lambda exists.
 */

interface ScriptStep {
  text: string;
  /** If set, the agent is "working" on this AWS API during the step. */
  aws?: string;
}
interface MockScript {
  steps: ScriptStep[];
  helper?: { agentId: string; ask: string; reply: string; aws: string };
  result: string;
}

const SCRIPTS: Record<string, MockScript> = {
  s3: {
    steps: [
      { text: 'Looking for a bucket that fits…', aws: 's3:ListBuckets' },
      { text: 'Casting the line: PutObject photos/holiday.jpg', aws: 's3:PutObject' },
      { text: 'Photos are rarely read → Standard-IA storage class' },
      { text: 'Adding a lifecycle rule: Glacier after 90 days', aws: 's3:PutBucketLifecycleConfiguration' },
    ],
    helper: { agentId: 'iam', ask: 'Ivy, can I get write access to this bucket?', reply: 'Badge checked — role allows s3:PutObject only. Least privilege!', aws: 'iam:SimulatePrincipalPolicy' },
    result: 'Stored in S3 Standard-IA with a lifecycle rule to Glacier — cheap and safe.',
  },
  lambda: {
    steps: [
      { text: 'An order came in — firing up the grill', aws: 'lambda:Invoke' },
      { text: 'Cooking with 512 MB memory, 10 s timeout' },
      { text: 'Hooking the stall to S3 uploads (event trigger)', aws: 'lambda:CreateEventSourceMapping' },
      { text: 'Grill off again — you only pay while it cooks' },
    ],
    helper: { agentId: 'iam', ask: 'Ivy, I need an execution role.', reply: 'Here is a role with logs + S3 read. Nothing more.', aws: 'iam:CreateRole' },
    result: 'Your function runs only when a file lands in S3. Zero cost while idle.',
  },
  iam: {
    steps: [
      { text: 'Checking who is at the gate', aws: 'sts:GetCallerIdentity' },
      { text: 'Reading the policy on their badge', aws: 'iam:GetPolicy' },
      { text: 'Removing "*" — least privilege only' },
      { text: 'Issuing a role instead of long-lived keys', aws: 'iam:CreateRole' },
    ],
    result: 'Replaced a wildcard policy with a scoped role. Much safer.',
  },
  route53: {
    steps: [
      { text: 'A dancer asks: who is example.com?', aws: 'route53:ListResourceRecordSets' },
      { text: 'Pairing them with an A record → 203.0.113.10' },
      { text: 'Latency routing: London dancers go to eu-west-2', aws: 'route53:ChangeResourceRecordSets' },
      { text: 'Health check on — failover partner ready', aws: 'route53:CreateHealthCheck' },
    ],
    helper: { agentId: 'cloudfront', ask: 'Cleo, can you front the site at the edge?', reply: 'Distribution ready — alias record points at me.', aws: 'cloudfront:GetDistribution' },
    result: 'DNS now routes by latency with automatic failover.',
  },
  dynamodb: {
    steps: [
      { text: 'Pulling out a fresh card drawer (table)', aws: 'dynamodb:CreateTable' },
      { text: 'Partition key = userId spreads the drawers evenly' },
      { text: 'Filing a card: PutItem user#42', aws: 'dynamodb:PutItem' },
      { text: 'Fetching it back in 4 ms', aws: 'dynamodb:GetItem' },
    ],
    helper: { agentId: 'kms', ask: 'Kit, lock these drawers please.', reply: 'Encrypted at rest with your KMS key.', aws: 'kms:DescribeKey' },
    result: 'Table ready — single-digit millisecond reads by key.',
  },
  shield: {
    steps: [
      { text: 'Arrows incoming! Traffic spike detected', aws: 'shield:DescribeAttack' },
      { text: 'Raising the Shield — Standard absorbs layer 3/4 floods' },
      { text: 'Asking WAF to block the bad archers', aws: 'wafv2:UpdateWebACL' },
      { text: 'Castle still standing. Site stayed up.' },
    ],
    result: 'DDoS absorbed at the edge; your app never noticed.',
  },
  bedrock: {
    steps: [
      { text: 'Consulting the oracle…', aws: 'bedrock:InvokeModel' },
      { text: 'Searching the knowledge base for context', aws: 'bedrock:Retrieve' },
      { text: 'Checking guardrails', aws: 'bedrock:ApplyGuardrail' },
      { text: 'Writing the answer down' },
    ],
    result: 'The oracle answered using Claude on Bedrock with retrieved context.',
  },
  ec2: {
    steps: [
      { text: 'Choosing a machine: t4g.small (Graviton)', aws: 'ec2:DescribeInstanceTypes' },
      { text: 'Booting from the Amazon Linux AMI', aws: 'ec2:RunInstances' },
      { text: 'Security group: only port 443 open', aws: 'ec2:AuthorizeSecurityGroupIngress' },
      { text: 'Factory running — billed per second' },
    ],
    helper: { agentId: 'vpc', ask: 'Vic, which garden bed (subnet) can I use?', reply: 'Private subnet in eu-west-2a — behind the NAT gate.', aws: 'ec2:DescribeSubnets' },
    result: 'Instance launched in a private subnet with a tight security group.',
  },
};

function genericScript(serviceId: string): MockScript {
  const p = placeFor(serviceId);
  const s = serviceById(serviceId);
  const api = `${serviceId}:Describe*`;
  return {
    steps: [
      { text: `Opening up ${p?.place ?? s?.name}`, aws: api },
      { text: p?.teaches[0] ?? 'Looking around' },
      { text: p?.teaches[1] ?? 'Checking settings', aws: api },
      { text: 'Writing a note for you' },
    ],
    result: p?.blurb ?? 'Done.',
  };
}

const AMBIENT: [string, string, string][] = [
  ['lambda', 's3', 'New file in your bucket? Ring my bell and I will cook it.'],
  ['s3', 'cloudfront', 'Cleo, can you cache these photos near the users?'],
  ['ec2', 'vpc', 'Which subnet should my new factory go in?'],
  ['iam', 'lambda', 'Your badge only lets you read S3. Nothing else!'],
  ['dynamodb', 'lambda', 'Card filed. You can fetch it by userId any time.'],
  ['shield', 'cloudfront', 'Storm on the horizon — keep the edge ready.'],
  ['route53', 'cloudfront', 'Dancers for www go to you now.'],
  ['bedrock', 'rekognition', 'Rex, what is in this picture?'],
  ['rekognition', 'bedrock', 'A cat wearing sunglasses. 98% confident.'],
  ['kms', 's3', 'Your objects are locked with key alias/city.'],
  ['sagemaker', 'bedrock', 'I trained my own model. Want to compare notes?'],
  ['rds', 'aurora', 'Aurora, how do you keep six copies so tidy?'],
  ['efs', 'ecs', 'Every container can drink from my well at once.'],
  ['ecs', 'ec2', 'Need more ships for these containers.'],
  ['concierge', 'lookout', 'Luke, anything new on the user’s screen?'],
];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface MockOptions {
  /** Agents currently visible in the city (ambient chatter only uses these). */
  knownAgents?: () => string[];
  /** Speed multiplier for tests. */
  speed?: number;
}

export class MockBackend implements AgentBackend {
  readonly kind = 'mock' as const;
  private events = new Listeners<ServerEvent>();
  private statuses = new Listeners<ConnectionStatus>();
  private ambientTimer?: ReturnType<typeof setTimeout>;
  private speed: number;

  constructor(private opts: MockOptions = {}) {
    this.speed = opts.speed ?? 1;
  }

  onEvent(cb: (e: ServerEvent) => void) {
    return this.events.add(cb);
  }
  onStatus(cb: (s: ConnectionStatus) => void) {
    return this.statuses.add(cb);
  }

  connect() {
    this.statuses.emit('connecting');
    setTimeout(() => this.statuses.emit('connected'), 300 / this.speed);
    this.scheduleAmbient();
  }

  disconnect() {
    clearTimeout(this.ambientTimer);
    this.statuses.emit('disconnected');
  }

  private emit(e: ServerEvent) {
    this.events.emit(e);
  }

  private sleep(ms: number) {
    return wait(ms / this.speed);
  }

  private async work(agentId: string, service: string, detail: string, ms: number) {
    this.emit({ type: 'agent.state', agentId, state: 'working', service, detail });
    await this.sleep(ms);
    this.emit({ type: 'agent.state', agentId, state: 'idle' });
  }

  submitTask({ taskId, prompt, context }: Parameters<AgentBackend['submitTask']>[0]) {
    void (async () => {
      const serviceId = matchText(prompt) ?? context.serviceId ?? 'bedrock';
      const place = placeFor(serviceId);
      const script = SCRIPTS[serviceId] ?? genericScript(serviceId);

      await this.work('concierge', 'bedrock', 'InvokeModel — routing your request', 900);
      this.emit({ type: 'agent.message', from: 'concierge', to: 'user', text: `Sounds like a job for ${place?.agentName ?? serviceId}!` });
      await this.sleep(500);
      this.emit({ type: 'agent.message', from: 'concierge', to: serviceId, text: `New request: “${prompt.slice(0, 60)}”` });
      this.emit({
        type: 'task.plan',
        taskId,
        agentId: serviceId,
        targetServiceId: serviceId,
        steps: [`Heading to ${place?.place ?? serviceId}`, ...script.steps.map((s) => s.text)],
      });
      this.emit({ type: 'task.step', taskId, index: 0, text: `Heading to ${place?.place ?? serviceId}`, status: 'running' });
      await this.sleep(4500); // give the agent time to walk over
      this.emit({ type: 'task.step', taskId, index: 0, text: `Arrived at ${place?.place ?? serviceId}`, status: 'done' });

      for (let i = 0; i < script.steps.length; i++) {
        const step = script.steps[i];
        const index = i + 1;
        this.emit({ type: 'task.step', taskId, index, text: step.text, status: 'running' });
        if (step.aws) await this.work(serviceId, step.aws.split(':')[0], step.aws, 2200);
        else await this.sleep(1600);
        this.emit({ type: 'task.step', taskId, index, text: step.text, status: 'done' });

        if (i === 1 && script.helper) {
          const h = script.helper;
          this.emit({ type: 'agent.message', from: serviceId, to: h.agentId, text: h.ask });
          await this.work(h.agentId, h.aws.split(':')[0], h.aws, 1500);
          this.emit({ type: 'agent.message', from: h.agentId, to: serviceId, text: h.reply });
          await this.sleep(600);
        }
      }

      const xp = [{ serviceId, amount: 15 }];
      if (script.helper && serviceById(script.helper.agentId)) xp.push({ serviceId: script.helper.agentId, amount: 5 });
      this.emit({ type: 'task.done', taskId, ok: true, result: script.result, xp });
      this.emit({ type: 'agent.message', from: serviceId, to: 'user', text: script.result });
    })();
  }

  ask({ requestId, districtId, question }: Parameters<AgentBackend['ask']>[0]) {
    void (async () => {
      const inDistrict = servicesIn(districtId as DistrictId);
      const matched = matchText(question);
      const svc = inDistrict.find((s) => s.id === matched) ?? inDistrict[0] ?? SERVICES[0];
      const p = placeFor(svc.id);
      const answer =
        `Great question! Here at ${p?.place}: ${p?.blurb} ` +
        `The key ideas, from Foundation to Expert: ${p?.teaches.map((t, i) => `(${i + 1}) ${t}`).join(' ')}. ` +
        `Try it in the console: ${svc.name} → start with "${p?.teaches[0]}".`;

      this.emit({ type: 'agent.state', agentId: 'bedrock', state: 'working', service: 'bedrock', detail: 'InvokeModelWithResponseStream' });
      this.emit({ type: 'agent.state', agentId: svc.id, state: 'working', service: 'bedrock', detail: 'Answering your question' });
      await this.sleep(700);
      const words = answer.split(' ');
      for (let i = 0; i < words.length; i++) {
        this.emit({ type: 'chat.answer', requestId, districtId, agentId: svc.id, delta: (i ? ' ' : '') + words[i], done: false });
        await this.sleep(35);
      }
      this.emit({ type: 'chat.answer', requestId, districtId, agentId: svc.id, delta: '', done: true });
      this.emit({ type: 'agent.state', agentId: 'bedrock', state: 'idle' });
      this.emit({ type: 'agent.state', agentId: svc.id, state: 'idle' });
    })();
  }

  classifyPage({ requestId, context }: Parameters<AgentBackend['classifyPage']>[0]) {
    void (async () => {
      await this.work('lookout', 'bedrock', 'InvokeModel (vision) on screenshot', 1800);
      const guess = context.serviceId ?? matchText(`${context.title ?? ''} ${context.url ?? ''}`);
      const serviceIds = guess ? [guess] : [];
      const summary = guess
        ? `This page is about ${serviceById(guess)?.name}. Sending it to ${placeFor(guess)?.place}.`
        : `I don't see AWS on this page — but ${placeFor('bedrock')?.agentName} can still answer questions about it.`;
      this.emit({ type: 'page.classified', requestId, url: context.url, serviceIds, summary });
      this.emit({ type: 'agent.message', from: 'lookout', to: guess ?? 'concierge', text: summary });
    })();
  }

  async uploadScreenshot(_dataUrl: string, _meta: { url?: string; title?: string }) {
    const key = `mock/screenshots/${Date.now()}.jpg`;
    void this.work('s3', 's3', `PutObject ${key}`, 1200);
    await this.sleep(400);
    return key;
  }

  async getProgress(): Promise<Progress | null> {
    return null; // mock has no server state; the local cache in chrome.storage is used
  }
  async putProgress(_p: Progress) {}

  private scheduleAmbient() {
    clearTimeout(this.ambientTimer);
    const delay = (12_000 + Math.random() * 14_000) / this.speed;
    this.ambientTimer = setTimeout(() => {
      const known = new Set(this.opts.knownAgents?.() ?? [...SERVICES.map((s) => s.id), 'concierge', 'lookout']);
      const options = AMBIENT.filter(([a, b]) => known.has(a) && known.has(b));
      const pick = options[Math.floor(Math.random() * options.length)];
      if (pick) {
        const [from, to, text] = pick;
        this.emit({ type: 'agent.message', from, to, text });
        void this.work(from, serviceById(from) ? from : 'bedrock', 'background chatter', 1800);
      }
      this.scheduleAmbient();
    }, delay);
  }
}
