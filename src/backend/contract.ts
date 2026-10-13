// ─────────────────────────────────────────────────────────────────────────────
// AWS City ⇄ backend contract v2.8. SOURCE OF TRUTH — docs/backend-contract.md mirrors this, and the
// server (server/) imports it, so drift breaks its build.
//
// Transport: ONE WebSocket to the AWS City server (server/src/http.ts): ws://127.0.0.1:<port>/ws locally,
// wss://<api host>/ws hosted. REST beside it: /progress, /screenshots, /me.
// Auth (hosted): the Cognito access token in the Sec-WebSocket-Protocol header (never the URL, which ends
// up in logs):
//   protocols = ['base64UrlBearerAuthorization.<base64url(jwt)>', 'base64UrlBearerAuthorization']
// Client → server frames are ClientCommand JSON (`action`); server → client are ServerEvent JSON
// (`type`), one event or an array per frame, each frame ≤ 64 KB (the server's maxPayload).
//
// Rule for the backend: every time an agent is about to call a real AWS service, emit
// `agent.state {state:'working'}` first and `agent.state {state:'idle'}` after. That is what makes
// the pixel agents visibly work.
// ─────────────────────────────────────────────────────────────────────────────

export const CONTRACT_VERSION = 2.8;

// ── Console Copilot shapes (also used by the content script in src/console/) ──
export type ConsoleAction = 'click' | 'type' | 'select' | 'point' | 'done';

/** One interactive thing on the console page, as the agent sees it (labels only — never secrets). */
export interface SnapshotItem {
  id: string;
  role: string;
  name: string;
  /** Nearest heading/section label, to tell apart two "Create" buttons. */
  context?: string;
  /** Current value for non-sensitive inputs (truncated); omitted for secrets. */
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  sensitive?: boolean;
}

export interface PageSnapshot {
  url: string;
  title: string;
  heading?: string;
  items: SnapshotItem[];
}

export interface ConsoleTarget {
  id?: string;
  role?: string;
  name: string;
}

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
  /** The stack's RoleArn output, or just the 12-digit account id (the role name is fixed per region). */
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
  /** v2.3: the text the player typed when the preview asked for `confirmText` (a fix outside the city's own resources). */
  confirm?: string;
}

export interface DeployTeardown {
  action: 'deploy.teardown';
  deployId: string;
}

// ── Console Copilot (v2.1): agents act in the player's live AWS console, one visible step at a time ──

/** Start a Copilot task on the player's console tab. `snapshot` = what's clickable on the page (labels only). */
export interface ConsoleStart {
  action: 'console.start';
  taskId: string;
  goal: string;
  context: PageContext;
  snapshot: PageSnapshot;
}

/** Result of the last console.step, plus a fresh snapshot of the page after it. */
export interface ConsoleObserve {
  action: 'console.observe';
  taskId: string;
  index: number;
  ok: boolean;
  /** e.g. "player did it", "not found", "refused: risky". */
  note?: string;
  snapshot: PageSnapshot;
}

export interface ConsoleStop {
  action: 'console.stop';
  taskId: string;
}

// ── City care (v2.3): citizens find Well-Architected issues in the account and fix them with your OK ──

/** Ask the finding's citizen to explain it (answered with agent.message from that citizen). */
export interface FindingExplain {
  action: 'finding.explain';
  requestId: string;
  findingId: string;
}

/** Ask for the fix. Nothing changes yet: the server re-reads the resource and sends deploy.preview to approve. */
export interface FindingFixCommand {
  action: 'finding.fix';
  requestId: string;
  findingId: string;
}

/** Undoing a fix: fixes only tighten things, so the server answers with how to undo it in the AWS console (agent.message). */
export interface FindingUndo {
  action: 'finding.undo';
  requestId: string;
  findingId: string;
}

// ── The city's bill (v2.5): month-to-date cost from Cost Explorer, off until the player turns it on ──

/**
 * Turn the bill on or off. Cost Explorer charges $0.01 per request, so the server reads it only while it's on, at most
 * once a day per player (and once when it's turned on); it answers with city.bill. Also kept as Progress.bill.
 */
export interface BillEnable {
  action: 'bill.enable';
  on: boolean;
}

/**
 * v2.8: turn live traffic on or off. The server reads a few request counts from the account's CloudWatch (one
 * Metrics Insights query per GetMetricData call; CloudWatch charges per metric analyzed, about a cent a day for a
 * learner's account), at most every 5 minutes while the switch is on and the city is open; it answers with city.flow.
 * Also kept as Progress.flow.
 */
export interface FlowEnable {
  action: 'flow.enable';
  on: boolean;
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
  | DeployTeardown
  | ConsoleStart
  | ConsoleObserve
  | ConsoleStop
  | FindingExplain
  | FindingFixCommand
  | FindingUndo
  | BillEnable
  | FlowEnable;

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
  /** v2.2, optional: AWS documentation pages the agent used. */
  sources?: DocSource[];
}

/** An AWS documentation page an answer was grounded in (https, AWS domains only). */
export interface DocSource {
  title: string;
  url: string;
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
  /** v2.2, optional, on the final (done) chunk: AWS documentation pages used. */
  sources?: DocSource[];
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
  /** CloudFormation quick-create URL for infra/player-role/player-role.yaml with a per-player ExternalId. */
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
  /** v2.3: a fix for this finding (shown with its rollback; approve runs it). */
  findingId?: string;
  rollback?: string;
  /** v2.3: the player must type this exactly (a resource the city didn't build, or an account-wide change). */
  confirmText?: string;
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

/**
 * The agent's next move in the console. The extension shows it (highlight + bubble with say/why),
 * performs it — unless it's risky, then the player does it — and replies with console.observe.
 * `done` ends the task. The content script's safety rules win over `risk`.
 */
export interface ConsoleStepEvent {
  type: 'console.step';
  taskId: string;
  index: number;
  agentId: AgentId;
  action: ConsoleAction;
  target?: ConsoleTarget;
  value?: string;
  say: string;
  why?: string;
  risk: 'safe' | 'confirm';
}

/** Well-Architected pillar ids (same as the puzzles' PillarId). */
export type PillarKey = 'operational' | 'security' | 'reliability' | 'performance' | 'cost' | 'sustainability';

/** One thing in the account. `serviceId` null = a type the city has no landmark for (drawn as a "?" lot). */
export interface InventoryItem {
  arn: string;
  type: string;
  name: string;
  serviceId: string | null;
  districtId: string | null;
  managedByGame: boolean;
  /** v2.3: the item's Region (from its ARN; 'global' for global resources). Absent = the city's home Region. */
  region?: string;
  /** v2.3: Availability Zone, for zonal resources the server can place (instances, DB instances). */
  az?: string;
}

/** One end of a data link: a Region, optionally narrowed to an AZ. */
export interface LinkEnd {
  region: string;
  az?: string;
}

/**
 * v2.3: data that really moves between Regions or AZs in the account (drawn as arcs on the world map and as
 * packets over the AZ bridges): global table replication, a Multi-AZ standby, cross-Region S3 replication…
 */
export interface DataLink {
  id: string;
  serviceId: string;
  from: LinkEnd;
  to: LinkEnd;
  kind: 'replication' | 'standby' | 'traffic';
  /** Both directions (multi-active replicas). */
  twoWay?: boolean;
  /** Short label, e.g. "Global table city-orders". */
  label: string;
}

/** v2.5: one Availability Zone: its name in this account (names are mapped per account) and its AZ ID (the same everywhere). */
export interface AzInfo {
  name: string;
  id: string;
}

/** v2.3: what's in the account, so the city can mirror it. Sent on connect and when it changes. */
export interface CityInventoryEvent {
  type: 'city.inventory';
  takenAt: string;
  region: string;
  /** Where the list came from; anything but resource-explorer may miss resources, so `complete` is false. */
  source: 'resource-explorer' | 'tagging' | 'collectors' | 'mock';
  complete: boolean;
  /** Resources per serviceId ('other' = unmapped types). */
  counts: Record<string, number>;
  /** Up to ~300 items (frames stay under 64 KB); `truncated` when there were more. */
  items: InventoryItem[];
  truncated: boolean;
  /** v2.3: the city's home Region (fully mirrored; other Regions show what the listing could see). */
  homeRegion?: string;
  /** v2.3: every Region with resources, with how many. */
  regions?: Record<string, number>;
  /** v2.3: data moving between Regions or AZs. */
  links?: DataLink[];
  /**
   * v2.5: the account's Availability Zones per Region (zone type availability-zone only, sorted by name): the home
   * Region and every Region with resources. A Region the server couldn't read is left out.
   */
  zones?: Record<string, AzInfo[]>;
  /** v2.5: every Region the account knows about: enabled (opt-in not required, or opted in) or not-enabled (an opt-in Region it hasn't turned on). */
  regionStatus?: Record<string, 'enabled' | 'not-enabled'>;
}

/**
 * v2.5: the account's month-to-date bill (Cost Explorer UnblendedCost, as AWS reports it: an estimate until the month
 * closes). Sent on connect while the bill is on, and after each read (at most daily).
 */
export interface CityBillReadyEvent {
  type: 'city.bill';
  /** YYYY-MM (UTC, like Cost Explorer). */
  month: string;
  /** e.g. 'USD'. */
  currency: string;
  /** Rounded to cents. */
  total: number;
  /** Per serviceId ('other' = a service the city has no landmark for, tax, support…). */
  byService: Record<string, number>;
  /** Per Region code ('global' = charges with no Region). */
  byRegion: Record<string, number>;
  takenAt: string;
  estimated: true;
  unavailable?: never;
}

/** v2.5: the bill couldn't be read; `unavailable` is one plain sentence for the player. */
export interface CityBillUnavailableEvent {
  type: 'city.bill';
  unavailable: string;
  takenAt: string;
}

/** Narrow with `e.unavailable !== undefined`. */
export type CityBillEvent = CityBillReadyEvent | CityBillUnavailableEvent;

/** v2.8: one live rate from CloudWatch: how much of something happened per minute, over the last `windowMin`. */
export interface FlowRate {
  /** 'alb', 'lambda', 'apigateway', 'dynamodb' (one per allow-listed query). */
  id: string;
  /** The landmark it belongs to. */
  serviceId: string;
  kind: 'requests' | 'invocations' | 'writes';
  /** Average per minute, rounded. */
  perMin: number;
  /** Per Availability Zone name (the load balancer's requests), when the metric has one. */
  byAz?: Record<string, number>;
  /** Plain words, built by the server: "Load balancer requests". */
  label: string;
}

/** v2.8: live traffic from the account (CloudWatch). Sent on connect while it's on, and after each read. */
export interface CityFlowReadyEvent {
  type: 'city.flow';
  region: string;
  windowMin: number;
  rates: FlowRate[];
  takenAt: string;
  unavailable?: never;
}
export interface CityFlowUnavailableEvent {
  type: 'city.flow';
  unavailable: string;
  takenAt: string;
}
export type CityFlowEvent = CityFlowReadyEvent | CityFlowUnavailableEvent;

/**
 * v2.6: one event on the public AWS Health Dashboard (health.aws.amazon.com), the same for every player. It's AWS's
 * own words, trimmed: a fact about AWS, not about the player's account.
 */
export interface AwsIncident {
  /** Stable while the event lasts (its Health ARN, or the status feed's guid). */
  id: string;
  /** Region code, e.g. 'me-south-1'; 'global' for services with no Region. */
  region: string;
  /** AWS's name for it, e.g. 'Bahrain'. */
  regionName?: string;
  /** Availability Zone IDs named in the updates, e.g. ['mes1-az2'] (zone IDs, not your account's zone names). */
  azIds?: string[];
  severity: 'informational' | 'degradation' | 'disruption';
  /** resolved = gone from the dashboard; shown for a day after. */
  status: 'open' | 'resolved';
  title: string;
  /** Impacted services as AWS names them (the first few), and how many there are in all. */
  services: string[];
  serviceCount: number;
  /** The city's landmarks among them. */
  serviceIds: string[];
  started: string;
  updated: string;
  /** AWS's updates, newest first (a few, each trimmed). */
  log: { at: string; text: string }[];
  /** Demo city only: a practice event the game made up, never AWS's. */
  drill?: true;
}

/** v2.6: the public AWS Health Dashboard. Sent on connect and whenever it changes. */
export interface AwsHealthEvent {
  type: 'aws.health';
  asOf: string;
  incidents: AwsIncident[];
  /** Set when the dashboard couldn't be read just now (the last known incidents are kept). */
  stale?: boolean;
}

/** v2.6: one AWS What's New announcement. */
export interface AwsNewsItem {
  id: string;
  title: string;
  /** Always an https://aws.amazon.com/ page. */
  url: string;
  date: string;
  serviceIds: string[];
}

/** v2.6: the latest AWS What's New announcements. Sent on connect and whenever they change. */
export interface AwsNewsEvent {
  type: 'aws.news';
  asOf: string;
  items: AwsNewsItem[];
}

export interface FindingFix {
  fixId: string;
  title: string;
  preview: string;
  rollback: string;
  costNote?: string;
  /** game = a resource the city built; account = anything else, or an account-wide setting. */
  scope: 'game' | 'account';
}

export interface CityFinding {
  /** Stable for the same rule on the same resource. */
  id: string;
  ruleId: string;
  serviceId: string;
  districtId: string;
  /** The citizen who looks after this pillar, e.g. 'citizen:security'. */
  citizenId: string;
  pillar: PillarKey;
  severity: 'low' | 'medium' | 'high';
  status: 'open' | 'resolved';
  resource: { id: string; name: string; arn?: string; gameOwned: boolean };
  title: string;
  text: string;
  /** v2.3: why it matters, in plain words (with any jargon explained). */
  why?: string;
  /** docs.aws.amazon.com page behind the rule. */
  url: string;
  /** Present when the citizens can fix it (with your approval). */
  fix?: FindingFix;
  /** ISO time until which `finding.undo` works, after a fix. */
  undoUntil?: string;
}

/** v2.3: a finding opened, changed or resolved. Sent one per change, and all open ones on connect. */
export interface CityFindingEvent {
  type: 'city.finding';
  finding: CityFinding;
}

export interface ErrorEvent {
  type: 'error';
  message: string;
  taskId?: string;
  requestId?: string;
  /**
   * v2.2, optional: why, so the UI can explain it kindly. quota = the player's daily AI calls are used up;
   * paused = the city's AI is switched off (kill switch or global cap); auth = sign in again;
   * unlinked = connect an AWS account first; mfa_required = turn on an authenticator app before linking an
   * AWS account, approving a write (deploy.approve) or applying a fix (finding.fix) (hosted).
   */
  code?: 'quota' | 'paused' | 'auth' | 'unlinked' | 'mfa_required';
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
  | ConsoleStepEvent
  | CityInventoryEvent
  | CityFindingEvent
  | CityBillEvent
  | CityFlowEvent
  | AwsHealthEvent
  | AwsNewsEvent
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
  /** Global services' landmarks (IAM, Route 53, CloudFront), shared by every city. Before v2.7: every landmark. */
  landmarks: Record<string, LandmarkProgress>;
  /** v2.7: each Region is its own city, with its own landmarks (src/state/cities.ts). */
  cities?: Record<string, { landmarks: Record<string, LandmarkProgress> }>;
  cards?: Record<string, CardState>;
  quests?: Record<string, { status: 'active' | 'done'; step: number; count?: number }>;
  puzzles?: Record<string, { best: number }>;
  /** Games played per mini-game id. */
  games?: Record<string, { best: number; plays: number }>;
  /** v2.3: what each citizen has learned from you (see shared/citizens.json levels). */
  citizens?: Record<string, { xp: number }>;
  /** v2.3: findings fixed, by finding id → ISO time. */
  fixes?: Record<string, string>;
  /** v2.4: the learning streak. `last` is the player's local date (YYYY-MM-DD); `best` the longest run. */
  streak?: { days: number; last: string; best: number };
  /** v2.5: the player turned the bill on (Cost Explorer reads, at most daily). Absent = off. */
  bill?: boolean;
  /** v2.8: the player turned live traffic on (CloudWatch reads, at most every 5 minutes while open). Absent = off. */
  flow?: boolean;
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
  'console.step',
  'city.inventory',
  'city.finding',
  'city.bill',
  'city.flow',
  'aws.health',
  'aws.news',
  'error',
];

/** Minimal runtime guard for frames coming off the socket. */
export function isServerEvent(x: unknown): x is ServerEvent {
  return !!x && typeof x === 'object' && SERVER_EVENT_TYPES.includes((x as { type: ServerEvent['type'] }).type);
}

/**
 * WebSocket close codes the server uses. `reauth`: reconnect with a fresh token. `deleted`: the player deleted their
 * account (here or on another device): sign out, never reconnect (the server also refuses that player for a while).
 * `tooMany`: too many tabs. `restarting`: a deploy is rolling; reconnect with jitter.
 */
export const CLOSE_CODES = { reauth: 4401, deleted: 4403, tooMany: 4429, restarting: 1012 } as const;

/** WebSocket subprotocols that carry the bearer JWT (the token never goes in the URL). */
export function bearerSubprotocols(jwt: string): string[] {
  const b64url = btoa(jwt).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return [`base64UrlBearerAuthorization.${b64url}`, 'base64UrlBearerAuthorization'];
}
