// Learning content (shared with the backend): flashcards, architecture puzzles, quests, deploy templates.
import cardsJson from '../../shared/flashcards.json' with { type: 'json' };
import puzzlesJson from '../../shared/puzzles.json' with { type: 'json' };
import questsJson from '../../shared/quests.json' with { type: 'json' };
import templatesJson from '../../shared/templates.json' with { type: 'json' };

export interface Flashcard {
  id: string;
  q: string;
  a: string;
  /** The answer in a sentence a kid can read (≤ 110 chars); `a` stays the full answer, one tap away. */
  simple?: string;
  tier: number;
  source: string;
}

export type PillarId = 'operational' | 'security' | 'reliability' | 'performance' | 'cost' | 'sustainability';
export interface Pillar {
  id: PillarId;
  name: string;
  summary: string;
}

export interface Puzzle {
  id: string;
  title: string;
  districtId: string;
  tier: number;
  story: string;
  requirements: string[];
  required: string[];
  optional: string[];
  distractors: string[];
  flow: string[];
  why: string;
  /** Why the design works in a sentence a kid can read; `why` stays the full explanation, one tap away. */
  simpleWhy?: string;
  pillarBonus: Record<PillarId, { services: string[]; tip: string }>;
  /** Bonus services the brief doesn't ask for: placing one costs points (over-building isn't free). */
  unneeded?: string[];
  /** The architecture drawn as an AWS diagram: slots to drop services on, arrows the data flows along. */
  diagram?: Diagram;
}

export type ActorKind = 'users' | 'client' | 'mobile' | 'internet' | 'admin' | 'sources';
export type GroupKind = 'cloud' | 'region' | 'vpc' | 'az' | 'public' | 'private' | 'edge' | 'generic';
/** A diagram box: a slot (`service`), a fixed actor, a self-filling copy (`mirrorOf`) or a corner badge (`attachTo`). */
export interface DiagramNode {
  id: string;
  /** The correct service: this node is a slot. Required or optional comes from the puzzle's lists. */
  service?: string;
  actor?: ActorKind;
  /** A copy of another node (a second Region or AZ), drawn once that node is filled. */
  mirrorOf?: string;
  /** A pre-built box that isn't a slot (a load balancer, a knowledge base): a product id from the icon manifest. */
  fixed?: string;
  /** On a combined landmark's slot, the product this box really is (CloudTrail on "CloudWatch & CloudTrail"). */
  shows?: string;
  /** Drawn as a badge on that node's corner (Shield on CloudFront). */
  attachTo?: string;
  /** Cross-cutting service on the rail along the bottom (IAM, KMS, CloudWatch). */
  side?: boolean;
  /** Grid cell (column, row); halves allowed. Ignored for `attachTo` badges. */
  x: number;
  y: number;
  /** What the slot is for, shown while it's empty. */
  role: string;
  /** Other services that are also right here (rare). */
  accepts?: string[];
}
export interface DiagramEdge {
  from: string;
  to: string;
  label: string;
  /** One line shown while the packet travels this edge. */
  caption?: string;
  /** Animation order; equal steps run together (a branch). No step: a dashed control link, never animated. */
  step?: number;
  dashed?: boolean;
  /** Data moves both ways (global table replicas): arrowheads at both ends. */
  twoWay?: boolean;
  /** Elbow direction when the ends aren't aligned: across then down (default) or down then across. */
  bend?: 'h' | 'v';
}
export interface DiagramGroup {
  id: string;
  kind: GroupKind;
  /** `{cityRegion}` is replaced with the city's Region. */
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The group's label tab is itself a slot (the VPC in container-app). */
  service?: string;
}
export interface Diagram {
  cols: number;
  rows: number;
  groups: DiagramGroup[];
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  /** Why each distractor doesn't belong (shown when one is dropped). */
  rejects: Record<string, string>;
}

export type QuestStep =
  | { kind: 'visit'; serviceId: string; text: string }
  | { kind: 'cards'; serviceId: string; count: number; text: string }
  | { kind: 'puzzle'; puzzleId: string; text: string }
  | { kind: 'ask'; prompt: string; text: string }
  | { kind: 'deploy'; templateId: string; text: string }
  /** A scenario question: which service fits, which is cheaper, what's wrong here. One option is right; each says why. */
  | { kind: 'choose'; id: string; text: string; question: string; options: ChoiceOption[] };

export interface ChoiceOption {
  text: string;
  correct?: true;
  why: string;
}

export interface Quest {
  id: string;
  title: string;
  districtId: string;
  serviceIds: string[];
  intro: string;
  rewardXp: number;
  steps: QuestStep[];
}

export interface DeployTemplate {
  id: string;
  title: string;
  serviceIds: string[];
  summary: string;
  resources: { logicalId: string; type: string }[];
  outputs: string[];
  costNote: string;
}

export const CARDS: Record<string, Flashcard[]> = (cardsJson as { cards: Record<string, Flashcard[]> }).cards;
export const PILLARS: Pillar[] = (puzzlesJson as { pillars: Pillar[] }).pillars;
export const PUZZLES: Puzzle[] = (puzzlesJson as unknown as { puzzles: Puzzle[] }).puzzles;
export const QUESTS: Quest[] = (questsJson as unknown as { quests: Quest[] }).quests;
export const TEMPLATES: DeployTemplate[] = templatesJson.templates;

export const cardsFor = (serviceId: string) => CARDS[serviceId] ?? [];
export const allCards = () => Object.entries(CARDS).flatMap(([serviceId, cs]) => cs.map((c) => ({ ...c, serviceId })));
export const puzzleById = (id: string) => PUZZLES.find((p) => p.id === id);
export const questById = (id: string) => QUESTS.find((q) => q.id === id);
export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id);
export const serviceOfCard = (cardId: string) => cardId.replace(/-\d+$/, '');

/** A quest's choose step by its id (ids are unique across quests). */
export const choiceById = (id: string) => {
  for (const q of QUESTS) for (const st of q.steps) if (st.kind === 'choose' && st.id === id) return { quest: q, step: st };
  return undefined;
};

/** The order a choose step's options are shown in: shuffled, but the same for that question every time. */
export function choiceOrder(id: string, n: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/**
 * A short tip from a service's flashcards for its agent to share: cards up to the landmark's tier (deeper tips as it
 * levels up), one sentence or two, taking turns through the deck.
 */
export function tipFor(serviceId: string, tier: number, turn: number): string | undefined {
  const deck = (CARDS[serviceId] ?? []).filter((c) => c.tier <= tier);
  if (!deck.length) return undefined;
  const card = deck[turn % deck.length];
  // Split only where a sentence really ends (a stop, then a capital), so "99.999999999%" stays whole.
  const sentences = card.a.split(/(?<=[.!?])\s+(?=[A-Z])/);
  let out = '';
  for (const s of sentences) {
    if (out && `${out} ${s}`.length > 160) break;
    out = out ? `${out} ${s}` : s;
  }
  return out.trim();
}
