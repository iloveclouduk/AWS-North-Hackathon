// ─────────────────────────────────────────────────────────────────────────────
// AWS City ⇄ backend contract. SOURCE OF TRUTH — docs/backend-contract.md mirrors this.
//
// Transport (AwsBackend):
//   • WebSocket (API Gateway WebSocket API). Client → server frames are ClientCommand JSON with an
//     `action` field (use route selection expression `$request.body.action`).
//     Server → client frames are ServerEvent JSON with a `type` field.
//   • REST (API Gateway HTTP API) for request/response things: progress + screenshot upload URLs.
//
// Rule for the backend team: every time a Lambda is about to call a real AWS service on behalf of
// an agent, emit `agent.state {state:'working'}` first and `agent.state {state:'idle'}` after.
// That is what makes the pixel agents visibly work.
// ─────────────────────────────────────────────────────────────────────────────

export type AgentId = string; // service id (e.g. 's3', 'lambda') or 'concierge' | 'lookout'
export type DistrictId = string;

export interface PageContext {
  url?: string;
  title?: string;
  /** Service the frontend matched from the URL, if any. */
  serviceId?: string;
  /** S3 key returned by POST /screenshots, if the Lookout snapped this page. */
  screenshotKey?: string;
}

// ── Client → server (WebSocket) ──────────────────────────────────────────────

export interface TaskSubmit {
  action: 'task.submit';
  taskId: string;
  prompt: string;
  context: PageContext;
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

export type ClientCommand = TaskSubmit | ChatAsk | PageClassify;

// ── Server → client (WebSocket) ──────────────────────────────────────────────

export type StepStatus = 'pending' | 'running' | 'done' | 'failed';

/** The orchestrator decided which agent handles a task and what it will do. */
export interface TaskPlanEvent {
  type: 'task.plan';
  taskId: string;
  agentId: AgentId;
  /** Landmark the agent walks to (usually = agentId). */
  targetServiceId: string;
  steps: string[];
}

/** Progress on one step. Drives the speech bubble + activity feed. */
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
  | ErrorEvent;

// ── REST ─────────────────────────────────────────────────────────────────────

/** GET /progress → Progress ; PUT /progress (body Progress) → 204 */
export interface LandmarkProgress {
  discovered: boolean;
  xp: number;
}
export interface Progress {
  version: 1;
  landmarks: Record<string, LandmarkProgress>;
  updatedAt: string; // ISO
}

/** POST /screenshots {contentType} → presigned S3 PUT URL; client then PUTs the JPEG bytes to uploadUrl. */
export interface ScreenshotUploadRequest {
  contentType: 'image/jpeg' | 'image/png';
  url?: string;
  title?: string;
}
export interface ScreenshotUploadResponse {
  uploadUrl: string;
  screenshotKey: string;
}

export const SERVER_EVENT_TYPES: ServerEvent['type'][] = [
  'task.plan',
  'task.step',
  'agent.state',
  'agent.message',
  'task.done',
  'page.classified',
  'chat.answer',
  'error',
];

/** Minimal runtime guard for frames coming off the socket. */
export function isServerEvent(x: unknown): x is ServerEvent {
  return !!x && typeof x === 'object' && SERVER_EVENT_TYPES.includes((x as { type: ServerEvent['type'] }).type);
}
