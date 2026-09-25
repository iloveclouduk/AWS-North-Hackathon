import { create } from 'zustand';
import type { ConnectionStatus } from '@/backend/AgentBackend';
import type { DeployChange, DeployStatusEvent, Progress, ServerEvent, StepStatus } from '@/backend/contract';
import { placeFor, SPECIAL_AGENTS, TIER_NAMES, tierForXp, type GameId } from '@/world/places';
import { questById, serviceOfCard, type QuestStep } from '@/world/content';
import { review, xpFor, type Grade } from '@/learning/srs';
import { SERVICES, serviceById } from '@/world/taxonomy';
import { bus } from './bus';
import type { PageFocus } from './types';

export interface FeedItem {
  id: number;
  at: number;
  kind: 'message' | 'step' | 'state' | 'system' | 'user';
  from?: string;
  to?: string;
  text: string;
  taskId?: string;
}

export interface TaskView {
  taskId: string;
  prompt: string;
  agentId?: string;
  steps: { text: string; status: StepStatus }[];
  status: 'routing' | 'running' | 'done' | 'failed';
  result?: string;
}

export interface ChatMsg {
  id: string;
  role: 'user' | 'agent';
  agentId?: string;
  text: string;
  pending?: boolean;
}

export interface Toast {
  id: number;
  icon: string;
  text: string;
}

export type View = { name: 'city' } | { name: 'interior'; districtId: string } | { name: 'game'; game: GameId };

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
}

export type SnapState = 'idle' | 'snapping' | 'needs-permission' | 'failed' | 'unavailable';

export interface CityState {
  backendKind: 'mock' | 'agentcore';
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
  selected?: string;
  autoSnap: boolean;
  lastClassified?: { serviceIds: string[]; summary: string };
  snap: SnapState;
  lastSnapshot?: string;
  account: AccountState;
  deploys: Record<string, DeployView>;
  agentLevels: Record<string, number>;

  // pure state transitions (no I/O — see app/runtime.ts for commands)
  setBackend(kind: 'mock' | 'agentcore', status: ConnectionStatus): void;
  setFocus(f: PageFocus): void;
  discover(serviceId: string): void;
  addXp(serviceId: string, amount: number): void;
  loadProgress(p: Progress): void;
  applyServerEvent(e: ServerEvent): void;
  addTask(taskId: string, prompt: string): void;
  addUserChat(districtId: string, requestId: string, text: string): void;
  log(item: Omit<FeedItem, 'id' | 'at'>): void;
  toast(icon: string, text: string): void;
  dismissToast(id: number): void;
  setView(v: View): void;
  select(id?: string): void;
  setAutoSnap(on: boolean): void;
  setSnap(s: SnapState, snapshot?: string): void;
  // learning
  reviewCard(cardId: string, grade: Grade): void;
  recordPuzzle(puzzleId: string, score: number, passed: boolean): void;
  recordGame(game: GameId, score: number): void;
  startQuest(questId: string): void;
  /** Advance any active quest whose current step matches. */
  questEvent(match: (step: QuestStep) => boolean, countable?: boolean): void;
}

let nextId = 1;
const FEED_MAX = 120;
const VISIT_XP_COOLDOWN_MS = 60_000;
const lastVisitXp = new Map<string, number>();

export const emptyProgress = (): Progress => ({ version: 1, landmarks: {}, updatedAt: new Date(0).toISOString() });

export const agentName = (id: string) =>
  id === 'user' ? 'You' : (placeFor(id)?.agentName ?? (SPECIAL_AGENTS as Record<string, { name: string }>)[id]?.name ?? id);

export const isDiscovered = (p: Progress, serviceId: string) => !!p.landmarks[serviceId]?.discovered;
export const tierOf = (p: Progress, serviceId: string) => {
  const l = p.landmarks[serviceId];
  return l?.discovered ? tierForXp(l.xp) : -1;
};
/** Agents present in the city: specials + agents of discovered landmarks. */
export const knownAgents = (p: Progress) => ['concierge', 'lookout', ...SERVICES.filter((s) => isDiscovered(p, s.id)).map((s) => s.id)];

export const useCity = create<CityState>()((set, get) => ({
  backendKind: 'mock',
  backendStatus: 'disconnected',
  progress: emptyProgress(),
  agents: {},
  tasks: {},
  taskOrder: [],
  feed: [],
  chats: {},
  toasts: [],
  view: { name: 'city' },
  autoSnap: false,
  snap: 'idle',
  account: { linked: false },
  deploys: {},
  agentLevels: {},

  setBackend: (backendKind, backendStatus) => set({ backendKind, backendStatus }),

  setFocus: (focus) => {
    set({ focus });
    const id = focus.serviceId;
    if (!id) return;
    get().questEvent((st) => st.kind === 'visit' && st.serviceId === id);
    if (!isDiscovered(get().progress, id)) {
      get().discover(id);
      return;
    }
    const now = Date.now();
    if (now - (lastVisitXp.get(id) ?? 0) > VISIT_XP_COOLDOWN_MS) {
      lastVisitXp.set(id, now);
      get().addXp(id, 2);
    }
  },

  discover: (serviceId) => {
    const { progress } = get();
    if (isDiscovered(progress, serviceId) || !serviceById(serviceId)) return;
    set({
      progress: {
        ...progress,
        landmarks: { ...progress.landmarks, [serviceId]: { discovered: true, xp: progress.landmarks[serviceId]?.xp ?? 0 } },
        updatedAt: new Date().toISOString(),
      },
    });
    const p = placeFor(serviceId);
    get().toast('🚧', `New landmark discovered: ${p?.place}! Construction has started.`);
    get().log({ kind: 'system', text: `${p?.place} discovered — ${p?.agentName} moved into town.` });
    bus.emit('discovered', { serviceId });
  },

  addXp: (serviceId, amount) => {
    if (!serviceById(serviceId) || amount <= 0) return;
    if (!isDiscovered(get().progress, serviceId)) get().discover(serviceId);
    const { progress } = get();
    const before = progress.landmarks[serviceId];
    const xp = (before?.xp ?? 0) + amount;
    set({
      progress: {
        ...progress,
        landmarks: { ...progress.landmarks, [serviceId]: { discovered: true, xp } },
        updatedAt: new Date().toISOString(),
      },
    });
    bus.emit('xpGained', { serviceId, amount });
    const oldTier = tierForXp(before?.xp ?? 0);
    const newTier = tierForXp(xp);
    if (newTier > oldTier) {
      const p = placeFor(serviceId);
      get().toast('⭐', `${p?.place} upgraded to ${TIER_NAMES[newTier]}!`);
      get().log({ kind: 'system', text: `${p?.place} is now ${TIER_NAMES[newTier]}: ${p?.tiers[newTier - 1]}.` });
      bus.emit('tierUp', { serviceId, tier: newTier });
    }
  },

  loadProgress: (p) => set({ progress: p }),

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
      case 'agent.state':
        set({ agents: { ...s.agents, [e.agentId]: { state: e.state, service: e.service, detail: e.detail } } });
        if (e.state === 'working' && e.detail) s.log({ kind: 'state', from: e.agentId, text: e.detail });
        break;
      case 'agent.message':
        s.log({ kind: 'message', from: e.from, to: e.to, text: e.text });
        break;
      case 'task.done': {
        const t = s.tasks[e.taskId];
        if (t) set({ tasks: { ...s.tasks, [e.taskId]: { ...t, status: e.ok ? 'done' : 'failed', result: e.result } } });
        for (const x of e.xp) get().addXp(x.serviceId, x.amount);
        if (e.ok) get().questEvent((st) => st.kind === 'ask');
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
        set({ chats: { ...s.chats, [e.districtId]: list } });
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
        set({ account: { ...s.account, linked: e.linked, accountId: e.accountId, region: e.region, message: e.message } });
        if (e.linked) s.toast('🔗', `AWS account ${e.accountId} linked — agents can now deploy for you (with your approval).`);
        break;
      case 'deploy.preview':
        set({
          deploys: {
            ...s.deploys,
            [e.deployId]: { deployId: e.deployId, templateId: e.templateId, stackName: e.stackName, region: e.region, changes: e.changes, costNote: e.costNote, status: 'preview' },
          },
        });
        break;
      case 'deploy.status': {
        const d = s.deploys[e.deployId];
        if (d) set({ deploys: { ...s.deploys, [e.deployId]: { ...d, status: e.status, outputs: e.outputs ?? d.outputs, message: e.message } } });
        s.log({ kind: 'system', text: `🏗️ ${d?.stackName ?? e.deployId}: ${e.status}${e.message ? ` — ${e.message}` : ''}` });
        if (e.status === 'complete') {
          s.toast('🚀', `${d?.stackName ?? 'Stack'} deployed to your AWS account!`);
          if (d) get().questEvent((st) => st.kind === 'deploy' && st.templateId === d.templateId);
        }
        break;
      }
      case 'screenshot.url':
      case 'progress.state':
        break;
      case 'error':
        s.log({ kind: 'system', text: `⚠️ ${e.message}` });
        if (e.taskId && s.tasks[e.taskId]) set({ tasks: { ...s.tasks, [e.taskId]: { ...s.tasks[e.taskId], status: 'failed' } } });
        break;
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
    set({ chats: { ...s.chats, [districtId]: [...(s.chats[districtId] ?? []), { id: `u-${requestId}`, role: 'user', text }] } });
  },

  log: (item) => set((s) => ({ feed: [...s.feed, { ...item, id: nextId++, at: Date.now() }].slice(-FEED_MAX) })),

  toast: (icon, text) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, icon, text }].slice(-4) }));
    setTimeout(() => get().dismissToast(id), 5000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setView: (view) => set({ view }),
  select: (selected) => {
    set({ selected });
    if (selected) get().questEvent((st) => st.kind === 'visit' && st.serviceId === selected);
  },
  setAutoSnap: (autoSnap) => set({ autoSnap }),
  setSnap: (snap, lastSnapshot) => set(lastSnapshot ? { snap, lastSnapshot } : { snap }),

  reviewCard: (cardId, grade) => {
    const { progress } = get();
    const prev = progress.cards?.[cardId];
    set({ progress: { ...progress, cards: { ...progress.cards, [cardId]: review(prev, grade) }, updatedAt: new Date().toISOString() } });
    const serviceId = serviceOfCard(cardId);
    get().addXp(serviceId, xpFor(prev, grade));
    if (grade !== 'again') get().questEvent((st) => st.kind === 'cards' && st.serviceId === serviceId, true);
  },

  recordPuzzle: (puzzleId, score, passed) => {
    const { progress } = get();
    const best = Math.max(score, progress.puzzles?.[puzzleId]?.best ?? 0);
    set({ progress: { ...progress, puzzles: { ...progress.puzzles, [puzzleId]: { best } }, updatedAt: new Date().toISOString() } });
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
    get().toast('📜', `Quest started: ${q.title}`);
    get().log({ kind: 'system', text: `📜 ${q.title}: ${q.intro}` });
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
        get().toast('🏆', `Quest complete: ${q.title}! +${q.rewardXp} XP`);
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
