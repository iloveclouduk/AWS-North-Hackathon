// ─────────────────────────────────────────────────────────────────────────────
// AWS City ⇄ backend contract v2. SOURCE OF TRUTH — docs/backend-contract.md mirrors this,
// backend/agent/contract.py mirrors the shapes in Python.
//
// Transport: ONE WebSocket to an Amazon Bedrock AgentCore Runtime
//   wss://bedrock-agentcore.<region>.amazonaws.com/runtimes/<url-encoded-arn>/ws
// Auth: Cognito JWT sent in the Sec-WebSocket-Protocol header (never the URL, which ends up in logs):
//   protocols = ['base64UrlBearerAuthorization.<base64url(jwt)>', 'base64UrlBearerAuthorization']
// Client → server frames are ClientCommand JSON (`action`); server → client are ServerEvent JSON
// (`type`), one event or an array per frame, each frame < 32 KB.
//
// Rule for the backend: every time an agent is about to call a real AWS service, emit
// `agent.state {state:'working'}` first and `agent.state {state:'idle'}` after. That is what makes
// the pixel agents visibly work.
// ─────────────────────────────────────────────────────────────────────────────

export const CONTRACT_VERSION = 2;

export type AgentId = string; // service id (e.g. 's3', 'lambda') or 'concierge' | 'lookout'
export type DistrictId = string;

export interface PageContext {
  url?: string;
  title?: string;
  /** Service the frontend matched from the URL, if any. */
  serviceId?: string;
  /** S3 key returned by screenshot.presign, if the Lookout snapped this page. */
  screenshotKey?: string;
}

// ── Client → server ──────────────────────────────────────────────────────────

export interface TaskSubmit {
  action: 'task.submit';
  taskId: string;
  prompt: string;
  context: PageContext;
  /** Quest this task belongs to, if any. */
  questId?: string;
}

export interface ChatAsk {
  action: 'chat.ask';
  requestId: string;
  districtId: DistrictId;
  question: string;
  context: PageContext;
}

export interface PageClassify {
  action: 'page.classify';
  requestId: string;
  context: PageContext; // must include screenshotKey or url+title
}

export interface ScreenshotPresign {
  action: 'screenshot.presign';
  requestId: string;
  contentType: 'image/jpeg';
}

export interface ProgressGet {
  action: 'progress.get';
  requestId: string;
}

export interface ProgressPut {
  action: 'progress.put';
  progress: Progress;
}

/** Ask for the CloudFormation quick-create link that connects the player's AWS account. */
export interface AccountLink {
  action: 'account.link';
  requestId: string;
  region: string;
}

/** Player finished the quick-create stack; backend verifies it can assume the role. */
export interface AccountVerify {
  action: 'account.verify';
  requestId: string;
  roleArn: string;
}

export interface QuestStart {
  action: 'quest.start';
  questId: string;
  taskId: string;
}

/** Ask the Builder to create a change set for a curated template in the linked account (nothing is created yet). */
export interface DeployPlan {
  action: 'deploy.plan';
  requestId: string;
  templateId: string;
  taskId?: string;
  params?: Record<string, string>;
}

/** Player approved/rejected a change set shown via deploy.preview. Nothing is created without approve. */
export interface DeployDecision {
  action: 'deploy.approve' | 'deploy.reject';
  deployId: string;
}

export interface DeployTeardown {
  action: 'deploy.teardown';
  deployId: string;
}

export type ClientCommand =
  | TaskSubmit
  | ChatAsk
  | PageClassify
  | ScreenshotPresign
  | ProgressGet
  | ProgressPut
  | AccountLink
  | AccountVerify
  | QuestStart
  | DeployPlan
  | DeployDecision
  | DeployTeardown;

// ── Server → client ──────────────────────────────────────────────────────────

export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

/** The orchestrator decided which agent handles a task and what it will do. */
export interface TaskPlanEvent {
  type: 'task.plan';
  taskId: string;
  agentId: AgentId;
  /** Landmark the agent walks to (usually = agentId). */
  targetServiceId: string;
  steps: string[];
}

/** Progress on one step. Drives the speech bubble + activity feed. `skipped` = agent remembered you know this. */
export interface TaskStepEvent {
  type: 'task.step';
  taskId: string;
  index: number;
  text: string;
  status: StepStatus;
}

/** A real AWS call is (or stopped) running for this agent. Drives idle vs working animation. */
export interface AgentStateEvent {
  type: 'agent.state';
  agentId: AgentId;
  state: 'idle' | 'working';
  /** AWS service actually being called, e.g. 's3', 'bedrock'. */
  service?: string;
  /** Human-readable detail, e.g. "PutObject screenshots/abc.jpg". */
  detail?: string;
}

/** Agents talking to each other (or to the user when `to` is 'user'). */
export interface AgentMessageEvent {
  type: 'agent.message';
  from: AgentId;
  to: AgentId | 'user';
  text: string;
}

export interface TaskDoneEvent {
  type: 'task.done';
  taskId: string;
  ok: boolean;
  result: string;
  /** XP awarded to the landmark(s). */
  xp: { serviceId: string; amount: number }[];
}

export interface PageClassifiedEvent {
  type: 'page.classified';
  requestId: string;
  url?: string;
  serviceIds: string[];
  summary: string;
}

/** Streamed answer from a district HQ. Send chunks with done=false, finish with done=true. */
export interface ChatAnswerEvent {
  type: 'chat.answer';
  requestId: string;
  districtId: DistrictId;
  agentId: AgentId;
  delta: string;
  done: boolean;
}

export interface ScreenshotUrlEvent {
  type: 'screenshot.url';
  requestId: string;
  /** Presigned S3 PUT URL, valid ~60 s. Client PUTs the JPEG bytes directly. */
  uploadUrl: string;
  screenshotKey: string;
}

export interface ProgressStateEvent {
  type: 'progress.state';
  requestId?: string;
  /** null = new player, nothing stored yet. */
  progress: Progress | null;
}

export interface AccountLinkUrlEvent {
  type: 'account.linkUrl';
  requestId: string;
  /** CloudFormation quick-create URL for backend/player-role.yaml with a per-player ExternalId. */
  url: string;
  externalId: string;
}

export interface AccountStatusEvent {
  type: 'account.status';
  requestId?: string;
  linked: boolean;
  accountId?: string;
  region?: string;
  message?: string;
}

export interface DeployChange {
  action: 'Add' | 'Modify' | 'Remove';
  logicalId: string;
  resourceType: string; // e.g. AWS::S3::Bucket
  replacement?: boolean;
}

/** A change set is ready. The client shows it and sends deploy.approve / deploy.reject. */
export interface DeployPreviewEvent {
  type: 'deploy.preview';
  requestId?: string;
  deployId: string;
  taskId?: string;
  templateId: string;
  stackName: string;
  region: string;
  changes: DeployChange[];
  /** Rough monthly cost note for the player, e.g. "Free tier: ~$0". */
  costNote?: string;
}

export interface DeployStatusEvent {
  type: 'deploy.status';
  deployId: string;
  status: 'creating' | 'complete' | 'failed' | 'rejected' | 'deleting' | 'deleted';
  message?: string;
  /** Stack outputs, e.g. { WebsiteURL: 'https://…' }. */
  outputs?: Record<string, string>;
}

/** An agent got better at its job (from repeated work / memory). */
export interface AgentLevelEvent {
  type: 'agent.level';
  agentId: AgentId;
  level: number;
  skill?: string;
}

export interface ErrorEvent {
  type: 'error';
  message: string;
  taskId?: string;
  requestId?: string;
}

export type ServerEvent =
  | TaskPlanEvent
  | TaskStepEvent
  | AgentStateEvent
  | AgentMessageEvent
  | TaskDoneEvent
  | PageClassifiedEvent
  | ChatAnswerEvent
  | ScreenshotUrlEvent
  | ProgressStateEvent
  | AccountLinkUrlEvent
  | AccountStatusEvent
  | DeployPreviewEvent
  | DeployStatusEvent
  | AgentLevelEvent
  | ErrorEvent;

// ── Progress (stored by the backend per Cognito user) ─────────────────────────

export interface LandmarkProgress {
  discovered: boolean;
  xp: number;
}

/** Spaced-repetition state for one flashcard (SM-2 lite). */
export interface CardState {
  /** Days until next review. */
  interval: number;
  ease: number;
  /** Epoch ms of next review. */
  due: number;
  reps: number;
}

export interface Progress {
  version: 1 | 2;
  landmarks: Record<string, LandmarkProgress>;
  cards?: Record<string, CardState>;
  quests?: Record<string, { status: 'active' | 'done'; step: number; count?: number }>;
  puzzles?: Record<string, { best: number }>;
  /** Games played per mini-game id. */
  games?: Record<string, { best: number; plays: number }>;
  updatedAt: string; // ISO; newest wins between server and chrome.storage
}

export const SERVER_EVENT_TYPES: ServerEvent['type'][] = [
  'task.plan',
  'task.step',
  'agent.state',
  'agent.message',
  'task.done',
  'page.classified',
  'chat.answer',
  'screenshot.url',
  'progress.state',
  'account.linkUrl',
  'account.status',
  'deploy.preview',
  'deploy.status',
  'agent.level',
  'error',
];

/** Minimal runtime guard for frames coming off the socket. */
export function isServerEvent(x: unknown): x is ServerEvent {
  return !!x && typeof x === 'object' && SERVER_EVENT_TYPES.includes((x as { type: ServerEvent['type'] }).type);
}

/** Subprotocols for the AgentCore Runtime WebSocket (JWT inbound auth). */
export function bearerSubprotocols(jwt: string): string[] {
  const b64url = btoa(jwt).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return [`base64UrlBearerAuthorization.${b64url}`, 'base64UrlBearerAuthorization'];
}
