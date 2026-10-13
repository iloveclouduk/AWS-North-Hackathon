import { create } from 'zustand';
import flavourJson from '../../shared/region-flavour.json' with { type: 'json' };

/** How Connie says hello in each Region (flavour only). */
const FLAVOUR = flavourJson as { regions: Record<string, { hello: string; language: string }> };
import type { ConnectionStatus } from '@/backend/AgentBackend';
import type { AwsHealthEvent, AwsNewsEvent, CityBillEvent,
  CityFlowEvent, CityFinding, CityInventoryEvent, DeployChange, DeployStatusEvent, PillarKey, Progress, ServerEvent, StepStatus } from '@/backend/contract';
import { placeFor, TIER_NAMES, tierForXp, type GameId } from '@/world/places';
import { questById, serviceOfCard, type QuestStep } from '@/world/content';
import { review, xpFor, type Grade } from '@/learning/srs';
import { ACTION_BLUEPRINT, GUARDED_EQUIV } from '@/backend/ServerBackend';
import { serviceById } from '@/world/taxonomy';
import { REGIONS } from '@/world/culture';
import { citizenById, PILLAR_LABEL } from '@/world/citizens';
import { bus } from './bus';
import { newsOpen } from './ladder';
import { builtCities, landmarkOf, migrateCities, withLandmark } from './cities';
import { incidentLine } from '@/world/incidents';
import { bumpDay, dayKey, nextStreak, type DayLog, type LearningKind } from './progress';
import { awardCitizens as awardPure, cardReviewsFor, CITIZEN_XP, citizensForPuzzle, citizensForService, levelCan, levelName, type Award } from './citizens';
import type { PageFocus } from './types';
import { agentName, cityHealth, emptyProgress, HEALTH_COST, isDiscovered, knownAgents, openFindings, questTargets, severityRank, taskRunning, tierOf } from './selectors';

// Pure reads of the store's state (no zustand): kept in ./selectors, exported from here as before.
export { agentName, cityHealth, emptyProgress, HEALTH_COST, isDiscovered, knownAgents, openFindings, questTargets, severityRank, taskRunning, tierOf };

export interface FeedItem {
  id: number;
  at: number;
  kind: 'message' | 'step' | 'state' | 'system' | 'user';
  from?: string;
  to?: string;
  text: string;
  taskId?: string;
  /** Agents talking among themselves while none of the player's tasks runs (hidden unless prefs.chatter). */
  ambient?: boolean;
}

export interface TaskView {
  taskId: string;
  prompt: string;
  agentId?: string;
  steps: { text: string; status: StepStatus }[];
  status: 'routing' | 'running' | 'done' | 'failed';
  result?: string;
  /** The real AWS API calls its agent made (from agent.state working details), in order. */
  calls?: string[];
}

export interface ChatMsg {
  id: string;
  role: 'user' | 'agent' | 'error';
  agentId?: string;
  text: string;
  pending?: boolean;
}

/** The words every new-city welcome toast shares, so a stale one can be found and dropped. */
const WELCOME_MARK = 'Every AWS Region starts empty';

export interface Toast {
  id: number;
  icon: string;
  text: string;
  kind?: 'info' | 'error';
  /** How long it shows (the countdown bar runs this long). */
  ms: number;
  /** In its exit animation (removed a moment later). */
  leaving?: boolean;
  /** Toasts of one group merge ("3 new landmarks: …"); `items` are what was merged. */
  group?: 'discover';
  items?: string[];
}

/** Info toasts wait here so only one shows at a time (errors show at once). */
const toastQueue: Omit<Toast, 'id'>[] = [];
/** Toasts waiting their turn (the oldest give way). */
const TOAST_QUEUE_MAX = 6;
/** Messages kept per HQ chat (in memory only). */
const CHAT_MAX = 50;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();
const listOf = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0]);
const groupText = (items: string[]) =>
  items.length === 1 ? `New landmark discovered: ${items[0]}! Construction has started.` : `${items.length} new landmarks: ${listOf(items)}. Construction has started.`;

/** Known backend error codes (optional `code` on ErrorEvent) → friendly text. */
const ERROR_TEXT: Record<string, string> = {
  quota: 'You’ve used today’s AI helpers — back tomorrow!',
  auth: 'Please sign in again',
  unlinked: 'Connect your AWS account in the Build tab',
  paused: 'The city’s AI helpers are taking a break — try again later.',
};

/** What to show the player for a backend `error` event. */
export const errorText = (e: { message: string }) => {
  const code = (e as { code?: string }).code;
  return (code && ERROR_TEXT[code]) || e.message;
};

export type View = { name: 'world' } | { name: 'city' } | { name: 'interior'; districtId: string } | { name: 'game'; game: GameId };

export interface AgentStatus {
  state: 'idle' | 'working';
  service?: string;
  detail?: string;
}

export interface AccountState {
  linked: boolean;
  accountId?: string;
  region?: string;
  linkUrl?: string;
  externalId?: string;
  message?: string;
  /** The server wants an authenticator app on before linking (error code mfa_required). */
  mfaRequired?: boolean;
  /** Bumped on every account.status, so a repeated reply (same message) still settles a pending button. */
  seq?: number;
}

export interface DeployView {
  deployId: string;
  templateId: string;
  stackName: string;
  region: string;
  changes: DeployChange[];
  costNote?: string;
  status: 'preview' | DeployStatusEvent['status'];
  outputs?: Record<string, string>;
  message?: string;
  /** v2.3: this change fixes a finding; `rollback` says how to undo it in the console. */
  findingId?: string;
  rollback?: string;
  /** The player must type this exactly to approve. */
  confirmText?: string;
}

/** A finding as the city keeps it: `seenAt` orders the City care list (newest first). */
export interface FindingView extends CityFinding {
  seenAt: number;
}
export type Inventory = Omit<CityInventoryEvent, 'type'>;
/** A finding.* request in flight (its button spins until the answer lands). */
export interface CareRequest {
  kind: 'explain' | 'fix';
  requestId: string;
}

/** A Correction of Error entry, written from a real failed task (task.done ok=false). */
export interface CoeEntry {
  id: string;
  at: number;
  taskId: string;
  prompt: string;
  agentId?: string;
  failedStep?: string;
  result?: string;
}

/** Day 1 Quarter progress (badges, COE board). Device-local: kept in localStorage, not in the synced Progress. */
export interface CultureState {
  badges: string[];
  coe: CoeEntry[];
  expoBest?: number;
}
const CULTURE_KEY = 'aws-city-culture';
const COE_MAX = 30;
const loadCulture = (): CultureState => {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(CULTURE_KEY) ?? 'null');
    if (v && Array.isArray(v.badges) && Array.isArray(v.coe)) return v;
  } catch {
    /* fresh start */
  }
  return { badges: [], coe: [] };
};
const saveCulture = (c: CultureState) => {
  try {
    globalThis.localStorage?.setItem(CULTURE_KEY, JSON.stringify(c));
  } catch {
    /* storage unavailable (tests) */
  }
};

/** Display preferences (this device only). */
export interface Prefs {
  /** Show agents talking to each other when no task of yours is running. */
  chatter: boolean;
  /** How much of the side panel the city takes. */
  stage: 'compact' | 'tall';
  /** The Region whose city you last chose on the world map (none yet: the game opens on the world map). */
  region?: string;
  /** Show the map's technical labels (AZ IDs, network notes, distance signs). Off: the city stays calm. */
  mapDetails?: boolean;
  /** Accessibility: text size in percent (UI and the labels in the city); absent = 100. */
  textSize?: 125 | 150;
  /** Accessibility: stronger colours for muted text, lines and focus rings. */
  contrast?: boolean;
  /** Accessibility: a plain, wide sans-serif everywhere, the pixel headings included. */
  easyFont?: boolean;
  /** Accessibility: games without a clock (rounds end on Done; reaction windows and spawns slower). */
  relaxed?: boolean;
  /** Accessibility: a short caption for each sound effect. */
  captions?: boolean;
  /** "I already build on AWS": every area open from the start, and the deeper "For AWS learners" text shown first. */
  builder?: boolean;
  /** The certification the player is working towards (shared/certifications.json id): Home shows how close they are. */
  certGoal?: string;
}
const PREFS_KEY = 'aws-city-prefs';
const loadPrefs = (): Prefs => {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(PREFS_KEY) ?? 'null');
    if (v && typeof v === 'object')
      return {
        chatter: !!v.chatter,
        stage: v.stage === 'tall' ? 'tall' : 'compact',
        ...(v.mapDetails === true ? { mapDetails: true } : {}),
        ...(typeof v.region === 'string' && /^[a-z]{2}(-[a-z]+)+-\d$/.test(v.region) ? { region: v.region } : {}),
        ...(v.textSize === 125 || v.textSize === 150 ? { textSize: v.textSize } : {}),
        ...(v.contrast === true ? { contrast: true } : {}),
        ...(v.easyFont === true ? { easyFont: true } : {}),
        ...(v.relaxed === true ? { relaxed: true } : {}),
        ...(v.captions === true ? { captions: true } : {}),
        ...(v.builder === true ? { builder: true } : {}),
        ...(typeof v.certGoal === 'string' && /^[a-z0-9-]{3,60}$/.test(v.certGoal) ? { certGoal: v.certGoal } : {}),
      };
  } catch {
    /* defaults */
  }
  return { chatter: false, stage: 'compact' };
};

export type SnapState = 'idle' | 'snapping' | 'needs-permission' | 'failed' | 'unavailable';

export interface CityState {
  backendKind: 'mock' | 'server';
  deployMode: 'templates' | 'guarded';
  backendStatus: ConnectionStatus;
  focus?: PageFocus;
  progress: Progress;
  agents: Record<string, AgentStatus>;
  tasks: Record<string, TaskView>;
  taskOrder: string[];
  feed: FeedItem[];
  chats: Record<string, ChatMsg[]>;
  toasts: Toast[];
  view: View;
  /** The Region whose city you're in (each Region is its own city; the world map picks one). */
  cityRegion: string;
  selected?: string;
  autoSnap: boolean;
  lastClassified?: { serviceIds: string[]; summary: string };
  snap: SnapState;
  lastSnapshot?: string;
  account: AccountState;
  deploys: Record<string, DeployView>;
  agentLevels: Record<string, number>;
  /** v2.3 city care: what's in the account, the findings by id, and the one whose card is open. */
  inventory?: Inventory;
  /** v2.5: the month-to-date bill (or why it can't be read), while the bill is on. Narrow on `unavailable`. */
  bill?: CityBillEvent;
  /** v2.5: the player turned the bill on (Progress.bill; synced across surfaces). */
  billOn: boolean;
  /** Turn the bill on or off (persisted in Progress; app/runtime.ts relays it to the backend as bill.enable). */
  setBill(on: boolean): void;
  /** v2.8: live traffic from CloudWatch (or why it can't be read), while it's on. Narrow on `unavailable`. */
  flow?: CityFlowEvent;
  /** v2.8: the player turned live traffic on (Progress.flow; synced across surfaces). */
  flowOn: boolean;
  /** Turn live traffic on or off (persisted in Progress; app/runtime.ts relays it as flow.enable). */
  setFlow(on: boolean): void;
  findings: Record<string, FindingView>;
  findingOpen?: string;
  openFinding(id?: string): void;
  /** v2.6: the public AWS Health Dashboard and What's New (the same for everyone; kept on sign-out). */
  health?: AwsHealthEvent;
  news?: AwsNewsEvent;
  /** The incident whose card is open. */
  incidentOpen?: string;
  openIncident(id?: string): void;
  /** A quest's choose step (by id) whose card is open. */
  choiceOpen?: string;
  /** A quest just finished: its celebration card is showing (src/ui/Celebrate.tsx). */
  celebration?: string;
  openChoice(id?: string): void;
  /** Shows (or, with no id, closes) a finished quest's celebration card. */
  celebrate(questId?: string): void;
  /** The player picked the right answer: the step is done. */
  passChoice(id: string): void;
  /**
   * City care is unlocked (src/state/ladder.ts `care`): held findings start to show, one at a time.
   * Until then findings wait out of sight (a first session isn't a wall of problems).
   */
  careReleased: boolean;
  /** `all`: show every held finding now (a linked account does this itself; dev and smoke ask for it). */
  releaseCare(opts?: { all?: boolean }): void;
  careRequests: Record<string, CareRequest>;
  /** The citizen's last answer about a finding (Explain, or why a fix can't run yet), by finding id. */
  explanations: Record<string, string>;
  noteCare(findingId: string, req?: CareRequest): void;
  /** A city.finding: open → its citizen walks over; resolved after your fix → XP for the citizen and the landmark. */
  applyFinding(f: CityFinding): void;
  /** Teach citizens (XP in Progress.citizens); announces level-ups. */
  awardCitizens(awards: Award[]): void;
  /** Console Copilot task running in the player's console tab, if any. */
  copilotTaskId?: string;
  setCopilot(taskId?: string): void;
  culture: CultureState;
  prefs: Prefs;
  setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void;
  /** Award a badge once; returns true the first time. */
  awardBadge(id: string, label: string): boolean;
  recordExpo(score: number): void;

  // pure state transitions (no I/O — see app/runtime.ts for commands)
  setBackend(kind: 'mock' | 'server', status: ConnectionStatus, deployMode?: 'templates' | 'guarded'): void;
  setFocus(f: PageFocus): void;
  /** `quiet`: built because a finding or XP needed it — no toast, camera move or greeting. */
  discover(serviceId: string, opts?: { quiet?: boolean }): void;
  addXp(serviceId: string, amount: number): void;
  loadProgress(p: Progress): void;
  applyServerEvent(e: ServerEvent): void;
  addTask(taskId: string, prompt: string): void;
  addUserChat(districtId: string, requestId: string, text: string): void;
  log(item: Omit<FeedItem, 'id' | 'at'>): void;
  toast(icon: string, text: string, kind?: Toast['kind'], merge?: { group: 'discover'; item: string }): void;
  /** Drop every toast, shown or waiting. */
  clearToasts(): void;
  /** Internal: put one toast on screen now (toast() decides when). */
  showToast(t: Omit<Toast, 'id'>): void;
  setMfaRequired(on: boolean): void;
  /** A sign-in window is open (buttons disable until it settles). */
  signingIn: boolean;
  setSigningIn(on: boolean): void;
  /** Signed out (here or in another surface): forget everything that belonged to that player. */
  resetSession(): void;
  /** Coach-mark tour overlay (UI-only, not persisted here — the done flag lives in localStorage). */
  tourOpen: boolean;
  setTourOpen(open: boolean): void;
  dismissToast(id: number): void;
  setView(v: View): void;
  /** Zoom out to the world map. */
  openWorld(): void;
  /** Pick a Region on the world map and zoom into its city (remembered for next time). */
  enterRegion(code: string): void;
  select(id?: string): void;
  /** The puzzle a quest step wants open on the Build tab. */
  focusPuzzle?: string;
  setFocusPuzzle(id?: string): void;
  setAutoSnap(on: boolean): void;
  setSnap(s: SnapState, snapshot?: string): void;
  // learning
  reviewCard(cardId: string, grade: Grade): void;
  recordPuzzle(puzzleId: string, score: number, passed: boolean, pillars?: Partial<Record<PillarKey, number>>): void;
  recordGame(game: GameId, score: number): void;
  startQuest(questId: string): void;
  /** Advance any active quest whose current step matches. */
  questEvent(match: (step: QuestStep) => boolean, countable?: boolean): void;
  /** What the player learned today (device-local; the streak itself is in Progress). */
  today?: DayLog;
  /** A learning action (a card reviewed, a puzzle passed, a fix approved): counts toward today and the streak. */
  noteLearning(kind: LearningKind): void;
}

let nextId = 1;
const FEED_MAX = 120;
const VISIT_XP_COOLDOWN_MS = 60_000;
const lastVisitXp = new Map<string, number>();


const TODAY_KEY = 'awscity.today';
const loadToday = (): DayLog | undefined => {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(TODAY_KEY) ?? 'null') as DayLog | null;
    return v && typeof v.day === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
};

// ── Finding pacing: held until city care unlocks, then dripped in one at a time ──

/** Findings the player hasn't been shown yet, by id (insertion order = arrival order). Resolved events update them. */
const heldFindings = new Map<string, CityFinding>();
/** At most this many open findings on screen before the next one waits. */
export const MAX_OPEN_FINDINGS = 3;
/** The next held finding shows when the last one shown is opened, or after this long. */
export const DRIP_MS = 90_000;
let dripTimer: ReturnType<typeof setTimeout> | undefined;
/** The finding last dripped in: opening its card lets the next one in. */
let dripWaitingFor: string | undefined;
const stopDrip = () => {
  clearTimeout(dripTimer);
  dripTimer = undefined;
  dripWaitingFor = undefined;
};
/** Held findings still open, lowest severity first, then oldest (a gentle start). */
const heldOpen = () =>
  [...heldFindings.values()].filter((f) => f.status === 'open').sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
/** Held findings not shown yet (tests and the smoke check this). */
export const heldFindingIds = () => heldOpen().map((f) => f.id);


export const useCity = create<CityState>()((set, get) => ({
  backendKind: 'mock',
  deployMode: 'templates',
  backendStatus: 'disconnected',
  progress: emptyProgress(),
  agents: {},
  tasks: {},
  taskOrder: [],
  feed: [],
  chats: {},
  toasts: [],
  // First time: the world map, to pick a Region. After that: straight back into your last Region's city.
  view: loadPrefs().region ? { name: 'city' } : { name: 'world' },
  cityRegion: loadPrefs().region ?? REGIONS.cityRegion,
  autoSnap: false,
  snap: 'idle',
  account: { linked: false },
  deploys: {},
  agentLevels: {},
  findings: {},
  openIncident: (id) => set({ incidentOpen: id }),
  openChoice: (id) => set({ choiceOpen: id }),
  celebrate: (questId) => set({ celebration: questId }),
  passChoice: (id) => get().questEvent((st) => st.kind === 'choose' && st.id === id),
  flowOn: false,
  setFlow: (on) => {
    const p = get().progress;
    if (!!p.flow === on) return;
    set({ flowOn: on, progress: { ...p, flow: on, updatedAt: new Date().toISOString() }, ...(on ? {} : { flow: undefined }) });
  },
  billOn: false,
  setBill: (on) => {
    const p = get().progress;
    if (!!p.bill === on) return;
    set({ billOn: on, progress: { ...p, bill: on, updatedAt: new Date().toISOString() }, ...(on ? {} : { bill: undefined }) });
  },
  careRequests: {},
  explanations: {},
  tourOpen: false,
  signingIn: false,
  culture: loadCulture(),
  prefs: loadPrefs(),
  today: loadToday(),
  noteLearning: (kind) => {
    const day = dayKey();
    const today = bumpDay(get().today, kind, day);
    try {
      globalThis.localStorage?.setItem(TODAY_KEY, JSON.stringify(today));
    } catch {
      /* storage unavailable */
    }
    const p = get().progress;
    const streak = nextStreak(p.streak, day);
    set(streak === p.streak ? { today } : { today, progress: { ...p, streak, updatedAt: new Date().toISOString() } });
  },
  setPref: (key, value) => {
    const prefs = { ...get().prefs, [key]: value };
    set({ prefs });
    try {
      globalThis.localStorage?.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* storage unavailable */
    }
  },

  awardBadge: (id, label) => {
    const c = get().culture;
    if (c.badges.includes(id)) return false;
    const culture = { ...c, badges: [...c.badges, id] };
    set({ culture });
    saveCulture(culture);
    get().toast('🏅', `Badge earned: ${label}`);
    get().log({ kind: 'system', text: `🏅 Badge earned: ${label}` });
    return true;
  },
  recordExpo: (score) => {
    const c = get().culture;
    const culture = { ...c, expoBest: Math.max(score, c.expoBest ?? 0) };
    set({ culture });
    saveCulture(culture);
  },

  careReleased: false,
  openFinding: (findingOpen) => {
    set({ findingOpen });
    // The player looked at the last one shown: the next may come in.
    if (findingOpen && findingOpen === dripWaitingFor) {
      stopDrip();
      drip();
    }
  },
  releaseCare: (opts) => {
    if (!get().careReleased) set({ careReleased: true });
    // A real account's findings are real: all of them at once. The demo's (practice account too) come in gently.
    if (opts?.all || realAccount(get())) flushHeld();
    else drip();
  },
  noteCare: (findingId, req) => {
    const careRequests = { ...get().careRequests };
    if (req) careRequests[findingId] = req;
    else delete careRequests[findingId];
    set({ careRequests });
  },
  applyFinding: (f) => {
    const s = get();
    const prev = s.findings[f.id];
    const changed = prev?.status !== f.status;
    set({ findings: { ...s.findings, [f.id]: { ...f, seenAt: prev && !changed ? prev.seenAt : Date.now() } } });
    if (!changed) return;
    const c = citizenById(f.citizenId);
    if (f.status === 'open') {
      // The citizen needs a building to stand at: a finding on a place the city hasn't built yet builds it.
      if (serviceById(f.serviceId) && !isDiscovered(s.progress, f.serviceId, s.cityRegion)) get().discover(f.serviceId, { quiet: true });
      get().log({ kind: 'message', from: f.citizenId, to: 'user', text: `${prev ? 'It’s back' : 'I found a problem'} near ${placeFor(f.serviceId)?.place ?? 'town'}: ${f.title}.` });
      bus.emit('findingRaised', { finding: f });
      return;
    }
    if (!prev) return; // resolved before we ever saw it open: nothing to celebrate
    // Resolved after the player's approved fix (the fix's deploy is running or done), not on its own.
    const fixed = Object.values(get().deploys).some((d) => d.findingId === f.id && (d.status === 'creating' || d.status === 'complete'));
    if (fixed) {
      const p = get().progress;
      const first = !p.fixes?.[f.id];
      set({ progress: { ...p, fixes: { ...p.fixes, [f.id]: new Date().toISOString() }, updatedAt: new Date().toISOString() } });
      // XP once per finding, so a finding that comes back and is fixed again doesn't farm it.
      get().noteLearning('fixes');
      if (first) {
        get().awardCitizens([{ citizenId: f.citizenId, amount: CITIZEN_XP.fix, reason: 'you approved a fix' }]);
        get().addXp(f.serviceId, CITIZEN_XP.fix);
      }
      get().toast('✅', `Fixed by ${c?.name ?? 'the city'}: ${f.fix?.title ?? f.title}.`);
    }
    get().log({ kind: 'system', text: `✅ Fixed: ${f.title} (${f.resource.name}).` });
    bus.emit('findingResolved', { finding: f, fixed });
  },
  awardCitizens: (awards) => {
    const before = get().progress;
    const { progress, levelUps } = awardPure(before, awards);
    if (progress === before) return;
    set({ progress });
    for (const u of levelUps) {
      const c = citizenById(u.citizenId)!;
      // Say what earned it, then what they can do now.
      const text = `${c.name} is now a ${levelName(u.level)}${u.reason ? `: ${u.reason}` : ''}. ${levelCan(u.level)}.`;
      get().toast('🎓', text);
      get().log({ kind: 'system', text: `🎓 ${text}` });
      bus.emit('citizenLevelUp', u);
    }
  },

  setBackend: (backendKind, backendStatus, deployMode) => set(deployMode ? { backendKind, backendStatus, deployMode } : { backendKind, backendStatus }),

  setFocus: (focus) => {
    set({ focus });
    const id = focus.serviceId;
    if (!id) return;
    get().questEvent((st) => st.kind === 'visit' && st.serviceId === id);
    if (!isDiscovered(get().progress, id, get().cityRegion)) {
      get().discover(id);
      return;
    }
    const now = Date.now();
    if (now - (lastVisitXp.get(id) ?? 0) > VISIT_XP_COOLDOWN_MS) {
      lastVisitXp.set(id, now);
      get().addXp(id, 2);
    }
  },

  discover: (serviceId, opts) => {
    const { progress, cityRegion } = get();
    if (isDiscovered(progress, serviceId, cityRegion) || !serviceById(serviceId)) return;
    // Found in this Region's city (a global service: in every city), src/state/cities.ts.
    set({ progress: { ...withLandmark(progress, serviceId, cityRegion, { discovered: true, xp: landmarkOf(progress, serviceId, cityRegion)?.xp ?? 0 }), updatedAt: new Date().toISOString() } });
    const p = placeFor(serviceId);
    const quiet = !!opts?.quiet;
    if (!quiet) get().toast('🚧', `New landmark discovered: ${p?.place}! Construction has started.`, 'info', { group: 'discover', item: p?.place ?? serviceId });
    get().log({ kind: 'system', text: `You found ${p?.place}. ${p?.agentName} moved into town.` });
    bus.emit('discovered', { serviceId, quiet });
  },

  addXp: (serviceId, amount) => {
    if (!serviceById(serviceId) || amount <= 0) return;
    if (!isDiscovered(get().progress, serviceId, get().cityRegion)) get().discover(serviceId, { quiet: true });
    const { progress, cityRegion } = get();
    const before = landmarkOf(progress, serviceId, cityRegion);
    const xp = (before?.xp ?? 0) + amount;
    set({ progress: { ...withLandmark(progress, serviceId, cityRegion, { discovered: true, xp }), updatedAt: new Date().toISOString() } });
    bus.emit('xpGained', { serviceId, amount });
    const oldTier = tierForXp(before?.xp ?? 0);
    const newTier = tierForXp(xp);
    if (newTier > oldTier) {
      const p = placeFor(serviceId);
      // The city celebrates on the building itself (CityScene's tierUp); no toast on top of it.
      get().log({ kind: 'system', text: `${p?.place} is now ${TIER_NAMES[newTier]}: ${p?.tiers[newTier - 1]}.` });
      bus.emit('tierUp', { serviceId, tier: newTier });
    }
  },

  loadProgress: (loaded) => {
    // Saved before v2.7: its Region landmarks belong to the city the player was building.
    const p = migrateCities(loaded, get().cityRegion);
    set({
      progress: p,
      ...(!!p.bill === get().billOn ? {} : { billOn: !!p.bill, ...(p.bill ? {} : { bill: undefined }) }),
      ...(!!p.flow === get().flowOn ? {} : { flowOn: !!p.flow, ...(p.flow ? {} : { flow: undefined }) }),
    });
  },

  applyServerEvent: (e) => {
    const s = get();
    switch (e.type) {
      case 'task.plan': {
        const t = s.tasks[e.taskId];
        set({
          tasks: {
            ...s.tasks,
            [e.taskId]: {
              taskId: e.taskId,
              prompt: t?.prompt ?? '',
              agentId: e.agentId,
              steps: e.steps.map((text) => ({ text, status: 'pending' as StepStatus })),
              status: 'running',
            },
          },
        });
        // An agent can't work at a landmark the city hasn't built yet — discovering it is part of the story.
        if (serviceById(e.targetServiceId)) get().discover(e.targetServiceId);
        s.log({ kind: 'system', from: e.agentId, text: `${agentName(e.agentId)} took the job (${e.steps.length} steps).`, taskId: e.taskId });
        break;
      }
      case 'task.step': {
        const t = s.tasks[e.taskId];
        if (t) {
          const steps = [...t.steps];
          steps[e.index] = { text: e.text, status: e.status };
          set({ tasks: { ...s.tasks, [e.taskId]: { ...t, steps } } });
        }
        if (e.status === 'running') s.log({ kind: 'step', from: t?.agentId, text: e.text, taskId: e.taskId });
        break;
      }
      case 'agent.state': {
        set({ agents: { ...s.agents, [e.agentId]: { state: e.state, service: e.service, detail: e.detail } } });
        // An API name (service:Action) while one of the player's tasks runs on this agent: that task made the call.
        const own = e.state === 'working' && e.detail && /^[a-z0-9-]+:[A-Za-z]+$/.test(e.detail) ? Object.values(s.tasks).find((t) => t.status === 'running' && t.agentId === e.agentId) : undefined;
        if (own && !own.calls?.includes(e.detail!)) set({ tasks: { ...get().tasks, [own.taskId]: { ...own, calls: [...(own.calls ?? []), e.detail!] } } });
        if (e.state === 'working' && e.detail) s.log({ kind: 'state', from: e.agentId, text: e.detail, ambient: !taskRunning(s) });
        break;
      }
      case 'agent.message': {
        s.log({ kind: 'message', from: e.from, to: e.to, text: e.text, ambient: e.to !== 'user' && !taskRunning(s) });
        // A citizen answering an Explain: keep the answer on that finding's card.
        // A citizen answering a fix request without a preview (e.g. the server says they need teaching first) also ends it.
        const ex = e.to === 'user' ? Object.entries(s.careRequests).find(([id]) => s.findings[id]?.citizenId === e.from) : undefined;
        if (ex) {
          set({ explanations: { ...get().explanations, [ex[0]]: e.text } });
          get().noteCare(ex[0]);
        }
        break;
      }
      case 'task.done': {
        const t = s.tasks[e.taskId];
        if (t) set({ tasks: { ...s.tasks, [e.taskId]: { ...t, status: e.ok ? 'done' : 'failed', result: e.result } } });
        if (!e.ok) {
          // A real failure goes on the Correction of Error board in the Day 1 Quarter.
          const entry: CoeEntry = {
            id: `coe-${e.taskId}`,
            at: Date.now(),
            taskId: e.taskId,
            prompt: t?.prompt ?? '',
            agentId: t?.agentId,
            failedStep: t?.steps.find((x) => x.status === 'failed')?.text,
            result: e.result,
          };
          const c = get().culture;
          if (!c.coe.some((x) => x.id === entry.id)) {
            const culture = { ...c, coe: [entry, ...c.coe].slice(0, COE_MAX) };
            set({ culture });
            saveCulture(culture);
          }
        }
        for (const x of e.xp) get().addXp(x.serviceId, x.amount);
        // An answered request ticks an "ask" step; a deploy finishing (same event, its deployId) doesn't.
        if (e.ok && !s.deploys[e.taskId]) get().questEvent((st) => st.kind === 'ask');
        break;
      }
      case 'page.classified':
        set({ lastClassified: { serviceIds: e.serviceIds, summary: e.summary } });
        for (const id of e.serviceIds) get().addXp(id, 3);
        break;
      case 'chat.answer': {
        const list = [...(s.chats[e.districtId] ?? [])];
        const id = `a-${e.requestId}`;
        const i = list.findIndex((m) => m.id === id);
        if (i === -1) list.push({ id, role: 'agent', agentId: e.agentId, text: e.delta, pending: !e.done });
        else list[i] = { ...list[i], text: list[i].text + e.delta, pending: !e.done };
        set({ chats: { ...s.chats, [e.districtId]: list.slice(-CHAT_MAX) } });
        if (e.done) get().addXp(e.agentId, 5);
        break;
      }
      case 'agent.level':
        set({ agentLevels: { ...s.agentLevels, [e.agentId]: e.level } });
        s.toast('🧠', `${agentName(e.agentId)} reached level ${e.level}${e.skill ? `: ${e.skill}` : ''}`);
        break;
      case 'account.linkUrl':
        set({ account: { ...s.account, linkUrl: e.url, externalId: e.externalId } });
        break;
      case 'account.status':
        set({ account: { ...s.account, linked: e.linked, accountId: e.accountId, region: e.region, message: e.message, seq: (s.account.seq ?? 0) + 1 } });
        // A real account's findings show at once (src/state/ladder.ts: linking unlocks care); the practice account's still drip.
        if (e.linked && get().careReleased) {
          if (realAccount(get())) flushHeld();
          else drip();
        }
        if (e.linked && s.backendKind === 'mock') s.toast('🔗', 'The practice account is linked. Agents can build things there now, and you approve each one.');
        else if (e.linked) s.toast('🔗', `Your AWS account ${e.accountId} is linked. Agents can build things there now, and you approve each one.`);
        else if (e.message) s.toast('⚠️', e.message, 'error');
        break;
      case 'deploy.preview': {
        const care = e.findingId
          ? { findingId: e.findingId, rollback: e.rollback, confirmText: e.confirmText }
          : {};
        set({
          deploys: {
            ...s.deploys,
            [e.deployId]: { deployId: e.deployId, templateId: e.templateId, stackName: e.stackName, region: e.region, changes: e.changes, costNote: e.costNote, status: 'preview', ...care },
          },
        });
        if (e.findingId) get().noteCare(e.findingId);
        break;
      }
      case 'city.inventory': {
        const { type: _t, ...inventory } = e;
        set({ inventory });
        break;
      }
      case 'city.finding': {
        const f = e.finding;
        // Shown before, or a real account's: straight on. Anything new waits its turn (drip).
        if (s.findings[f.id] || realAccount(s)) get().applyFinding(f);
        else {
          heldFindings.set(f.id, f);
          drip();
        }
        break;
      }
      case 'city.bill':
        // A bill that arrives after the player turned it off (in flight) is dropped.
        if (s.billOn) set({ bill: e });
        break;
      case 'city.flow':
        if (s.flowOn) set({ flow: e });
        break;
      case 'aws.health': {
        const before = new Map((s.health?.incidents ?? []).map((i) => [i.id, i.status]));
        set({ health: e });
        // Moments for the city (a citizen notices, one soft sound); not on the first event after opening.
        if (s.health)
          for (const i of e.incidents) {
            if (i.status === 'open' && before.get(i.id) !== 'open') {
              bus.emit('incidentStarted', { incident: i });
              // Said once, for this city's Region or anything AWS calls a disruption; not before AWS news opens (src/state/ladder.ts).
              if (newsOpen(s.progress, s.account.linked) && (i.region === s.cityRegion || i.severity === 'disruption')) s.toast(i.drill ? '🧯' : '⛈️', `${i.drill ? 'Practice drill' : 'AWS Health'}: ${incidentLine(i)}`, 'error');
            }
            if (i.status === 'resolved' && before.get(i.id) === 'open') bus.emit('incidentResolved', { incident: i });
          }
        break;
      }
      case 'aws.news':
        set({ news: e });
        break;
      case 'deploy.status': {
        const d = s.deploys[e.deployId];
        if (d) set({ deploys: { ...s.deploys, [e.deployId]: { ...d, status: e.status, outputs: e.outputs ?? d.outputs, message: e.message } } });
        s.log({ kind: 'system', text: `🏗️ ${d?.stackName ?? e.deployId}: ${e.status}${e.message ? ` — ${e.message}` : ''}` });
        if (d?.findingId) {
          // A fix: the finding's own event says how it went; only a refusal needs saying here.
          if (e.status === 'failed') s.toast('⚠️', e.message ?? 'That change didn’t go through. Nothing changed.', 'error');
        } else if (e.status === 'complete') {
          const before = get().celebration;
          if (d) get().questEvent((st) => st.kind === 'deploy' && (st.templateId === d.templateId || GUARDED_EQUIV[st.templateId] === ACTION_BLUEPRINT[d.templateId]));
          // The deploy finished a quest: its celebration card is the moment (no toast on top); the feed has the line.
          if (get().celebration === before)
            s.toast('🚀', `${d?.stackName ?? 'Your stack'} is built in ${s.backendKind === 'mock' ? 'the practice account' : 'your AWS account'}!`);
        }
        break;
      }
      case 'console.step':
        s.log({ kind: 'step', from: e.agentId, text: `🖱️ ${e.say}${e.why ? ` — 💡 ${e.why}` : ''}`, taskId: e.taskId });
        break;
      case 'screenshot.url':
      case 'progress.state':
        break;
      case 'error': {
        // A finding request that failed: stop its spinner.
        const care = e.requestId ? Object.entries(s.careRequests).find(([, r]) => r.requestId === e.requestId) : undefined;
        if (care) get().noteCare(care[0]);
        if (e.code === 'mfa_required') set({ account: { ...s.account, mfaRequired: true } });
        const text = errorText(e);
        s.log({ kind: 'system', text: `⚠️ ${text}` });
        s.toast('⚠️', text, 'error');
        if (e.taskId && s.tasks[e.taskId]) set({ tasks: { ...s.tasks, [e.taskId]: { ...s.tasks[e.taskId], status: 'failed' } } });
        // Show it in the HQ chat it belongs to (by requestId), else in the HQ the player is standing in.
        const chats = get().chats;
        const byRequest = e.requestId ? Object.keys(chats).find((d) => chats[d].some((m) => m.id === `u-${e.requestId}`)) : undefined;
        const v = get().view;
        const districtId = byRequest ?? (v.name === 'interior' && v.districtId !== 'spheres' ? v.districtId : undefined);
        if (districtId) {
          const list = (chats[districtId] ?? []).map((m) => (m.pending && (!e.requestId || m.id === `a-${e.requestId}`) ? { ...m, pending: false } : m));
          list.push({ id: `e-${nextId++}`, role: 'error', text });
          set({ chats: { ...chats, [districtId]: list } });
        }
        break;
      }
    }
  },

  addTask: (taskId, prompt) => {
    const s = get();
    set({
      tasks: { ...s.tasks, [taskId]: { taskId, prompt, steps: [], status: 'routing' } },
      taskOrder: [taskId, ...s.taskOrder].slice(0, 20),
    });
    s.log({ kind: 'user', from: 'user', to: 'concierge', text: prompt, taskId });
  },

  addUserChat: (districtId, requestId, text) => {
    const s = get();
    set({ chats: { ...s.chats, [districtId]: [...(s.chats[districtId] ?? []), { id: `u-${requestId}`, role: 'user' as const, text }].slice(-CHAT_MAX) } });
  },

  log: (item) => set((s) => ({ feed: [...s.feed, { ...item, id: nextId++, at: Date.now() }].slice(-FEED_MAX) })),

  setMfaRequired: (on) => set((s) => ({ account: { ...s.account, mfaRequired: on } })),
  setSigningIn: (signingIn) => set({ signingIn }),
  resetSession: () => {
    // Findings held for this player must not reach the next one.
    heldFindings.clear();
    stopDrip();
    set({
      progress: emptyProgress(),
      agents: {},
      tasks: {},
      taskOrder: [],
      feed: [],
      chats: {},
      selected: undefined,
      lastClassified: undefined,
      lastSnapshot: undefined,
      account: { linked: false },
      deploys: {},
      agentLevels: {},
      inventory: undefined,
      bill: undefined,
      billOn: false,
      flow: undefined,
      flowOn: false,
      findings: {},
      findingOpen: undefined,
      careReleased: false,
      careRequests: {},
      explanations: {},
      copilotTaskId: undefined,
      view: { name: 'city' },
      today: undefined,
      // The COE board keeps the player's prompts and failure text: it leaves with them.
      culture: { badges: [], coe: [] },
    });
    try {
      globalThis.localStorage?.removeItem(TODAY_KEY);
      globalThis.localStorage?.removeItem(CULTURE_KEY);
    } catch {
      /* storage unavailable */
    }
    get().log({ kind: 'system', text: 'Signed out. Sign in to pick up where you left off.' });
  },
  toast: (icon, text, kind = 'info', merge) => {
    const show = get().showToast;
    const visible = () => get().toasts.filter((t) => !t.leaving);
    if (kind === 'error') {
      // An error can't wait: it replaces whatever info toast is showing.
      for (const t of visible()) if (t.kind !== 'error') get().dismissToast(t.id);
      return show({ icon, text, kind, ms: 8000 });
    }
    if (merge) {
      // Merge into a showing or waiting toast of the same group (a fresh copy restarts its timer).
      const live = visible().find((t) => t.group === merge.group);
      const waiting = toastQueue.find((t) => t.group === merge.group);
      const into = live ?? waiting;
      if (into) {
        const items = [...(into.items ?? []), merge.item];
        if (waiting) Object.assign(waiting, { items, text: groupText(items) });
        else {
          clearTimeout(toastTimers.get(live!.id));
          set((s) => ({ toasts: s.toasts.filter((t) => t.id !== live!.id) }));
          show({ ...live!, items, text: groupText(items), ms: 4500 });
        }
        return;
      }
    }
    toastQueue.push({ icon, text, kind, ms: 3500, ...(merge ? { group: merge.group, items: [merge.item] } : {}) });
    // A burst never trickles on for a minute: only the latest few wait their turn.
    if (toastQueue.length > TOAST_QUEUE_MAX) toastQueue.splice(0, toastQueue.length - TOAST_QUEUE_MAX);
    if (!visible().length) show(toastQueue.shift()!);
  },
  clearToasts: () => {
    toastQueue.length = 0;
    for (const t of toastTimers.values()) clearTimeout(t);
    toastTimers.clear();
    set({ toasts: [] });
  },
  showToast: (t) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { ...t, id }].slice(-4) }));
    toastTimers.set(id, setTimeout(() => get().dismissToast(id), t.ms));
  },
  setTourOpen: (tourOpen) => set({ tourOpen }),
  dismissToast: (id) => {
    // Slide out first, then remove.
    if (!get().toasts.some((t) => t.id === id && !t.leaving)) return;
    set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) }));
    clearTimeout(toastTimers.get(id));
    toastTimers.delete(id);
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      // The next waiting toast, once nothing else shows.
      if (toastQueue.length && !get().toasts.some((t) => !t.leaving)) {
        get().showToast(toastQueue.shift()!);
      }
    }, 180);
  },

  setView: (view) => set({ view }),
  openWorld: () => set({ view: { name: 'world' } }),
  enterRegion: (code) => {
    if (!REGIONS.regions.some((r) => r.code === code)) return;
    const first = !!get().prefs.region && code !== get().cityRegion && !builtCities(get().progress)[code];
    get().setPref('region', code);
    set({ cityRegion: code, view: { name: 'city' } });
    // Like real AWS, a new Region is empty: say so once, kindly, so an empty city doesn't look like lost progress.
    // Another city's welcome (still up, or waiting) goes: it would greet you in the wrong place.
    const isWelcome = (t: { text: string }) => t.text.includes(WELCOME_MARK);
    for (const t of get().toasts) if (isWelcome(t) && !t.leaving) get().dismissToast(t.id);
    for (let i = toastQueue.length - 1; i >= 0; i--) if (isWelcome(toastQueue[i])) toastQueue.splice(i, 1);
    const r = REGIONS.regions.find((x) => x.code === code);
    if (first) {
      const hi = FLAVOUR.regions[code]?.hello;
      get().toast('🏗️', `${hi ? `${hi}! ` : ''}Welcome to ${r?.city ?? code}! ${WELCOME_MARK}, so this city is brand new. What you've learned comes with you.`, 'info');
    }
  },
  select: (selected) => {
    set({ selected });
    if (!selected) return;
    // A quest pointing at a landmark the city hasn't built yet builds it, so "Go →" never lands on an empty plot
    // and the step's flashcard deck is open.
    if (!isDiscovered(get().progress, selected, get().cityRegion) && questTargets(get().progress).has(selected)) get().discover(selected);
    get().questEvent((st) => st.kind === 'visit' && st.serviceId === selected);
  },
  setFocusPuzzle: (focusPuzzle) => set({ focusPuzzle }),
  setAutoSnap: (autoSnap) => set({ autoSnap }),
  setCopilot: (copilotTaskId) => set({ copilotTaskId }),
  setSnap: (snap, lastSnapshot) => set(lastSnapshot ? { snap, lastSnapshot } : { snap }),

  reviewCard: (cardId, grade) => {
    const { progress } = get();
    const prev = progress.cards?.[cardId];
    set({ progress: { ...progress, cards: { ...progress.cards, [cardId]: review(prev, grade) }, updatedAt: new Date().toISOString() } });
    const serviceId = serviceOfCard(cardId);
    get().addXp(serviceId, xpFor(prev, grade));
    const p = get().progress;
    get().awardCitizens(
      citizensForService(serviceId).map((c) => ({
        citizenId: c.id,
        amount: CITIZEN_XP.card,
        reason: `you’ve reviewed ${cardReviewsFor(p, c)} ${PILLAR_LABEL[c.pillar].toLowerCase()} flashcards`,
      })),
    );
    get().noteLearning('cards');
    if (grade !== 'again') get().questEvent((st) => st.kind === 'cards' && st.serviceId === serviceId, true);
  },

  recordPuzzle: (puzzleId, score, passed, pillars) => {
    const { progress } = get();
    // `best` is the best PASSING score: a failed try (say 83 with a service missing) must never stand in the way of
    // the stars for a later pass, nor show as done (✓, featuredPuzzle, the ladder all read best ≥ the pass mark).
    const prevBest = progress.puzzles?.[puzzleId]?.best ?? 0;
    if (passed && score > prevBest) set({ progress: { ...progress, puzzles: { ...progress.puzzles, [puzzleId]: { best: score } }, updatedAt: new Date().toISOString() } });
    // A better passing design teaches the citizens whose pillars it got right (re-checking the same answer doesn't).
    if (passed && pillars && score > prevBest) get().awardCitizens(
        citizensForPuzzle(pillars).map((c) => ({ citizenId: c.id, amount: CITIZEN_XP.puzzle, reason: `your design scored ${pillars[c.pillar]} on ${PILLAR_LABEL[c.pillar].toLowerCase()}` })),
      );
    if (passed) get().noteLearning('puzzles');
    if (passed) get().questEvent((st) => st.kind === 'puzzle' && st.puzzleId === puzzleId);
  },

  recordGame: (game, score) => {
    const { progress } = get();
    const g = progress.games?.[game] ?? { best: 0, plays: 0 };
    set({ progress: { ...progress, games: { ...progress.games, [game]: { best: Math.max(g.best, score), plays: g.plays + 1 } }, updatedAt: new Date().toISOString() } });
  },

  startQuest: (questId) => {
    const q = questById(questId);
    const { progress } = get();
    if (!q || progress.quests?.[questId]?.status === 'active') return;
    set({ progress: { ...progress, quests: { ...progress.quests, [questId]: { status: 'active', step: 0, count: 0 } }, updatedAt: new Date().toISOString() } });
    get().log({ kind: 'system', text: `📜 ${q.title}: ${q.intro}` });
    // Already standing at the first step's landmark (console page or selected place): that visit counts now.
    const { focus, selected } = get();
    const here = new Set([focus?.serviceId, selected].filter(Boolean));
    get().questEvent((st) => st.kind === 'visit' && here.has(st.serviceId));
  },

  questEvent: (match, countable) => {
    const { progress } = get();
    const quests = { ...progress.quests };
    let changed = false;
    for (const [id, st] of Object.entries(quests)) {
      if (st.status !== 'active') continue;
      const q = questById(id);
      const step = q?.steps[st.step];
      if (!q || !step || !match(step)) continue;
      changed = true;
      if (countable && step.kind === 'cards' && (st.count ?? 0) + 1 < step.count) {
        quests[id] = { ...st, count: (st.count ?? 0) + 1 };
        continue;
      }
      const next = st.step + 1;
      if (next >= q.steps.length) {
        quests[id] = { status: 'done', step: next };
        // One big moment: the celebration card (no toast on top of it); the feed keeps a line.
        set({ celebration: id });
        get().log({ kind: 'system', text: `🏆 Quest complete: ${q.title}! +${q.rewardXp} ⭐` });
        bus.emit('questDone', { questId: id });
        const share = Math.ceil(q.rewardXp / q.serviceIds.length);
        setTimeout(() => q.serviceIds.forEach((sid) => get().addXp(sid, share)), 0);
      } else {
        quests[id] = { status: 'active', step: next, count: 0 };
        get().log({ kind: 'system', text: `📜 ${q.title} — next: ${q.steps[next].text}` });
      }
    }
    if (changed) set({ progress: { ...get().progress, quests, updatedAt: new Date().toISOString() } });
  },
}));

/** A linked account the server reads (the demo's practice account is pretend, so its findings still drip). */
const realAccount = (s: Pick<CityState, 'account' | 'backendKind'>) => s.account.linked && s.backendKind !== 'mock';

/** Shows the next held finding if care is unlocked, nothing is waiting to be looked at, and fewer than 3 are open. */
function drip() {
  const s = useCity.getState();
  if (!s.careReleased || dripTimer) return;
  const next = heldOpen()[0];
  // Resolved before it was ever shown: nothing to say about it.
  for (const f of heldFindings.values()) if (f.status !== 'open') heldFindings.delete(f.id);
  if (!next) return;
  if (openFindings(s.findings).length >= MAX_OPEN_FINDINGS) {
    // Full: try again later (a fixed or resolved finding makes room).
    dripTimer = setTimeout(() => {
      dripTimer = undefined;
      drip();
    }, DRIP_MS);
    return;
  }
  heldFindings.delete(next.id);
  dripWaitingFor = next.id;
  dripTimer = setTimeout(() => {
    stopDrip();
    drip();
  }, DRIP_MS);
  s.applyFinding(next);
}

/** Everything held, at once (a linked account's findings are real). */
function flushHeld() {
  stopDrip();
  const all = heldOpen();
  heldFindings.clear();
  for (const f of all) useCity.getState().applyFinding(f);
}
