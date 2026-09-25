// Learning content (shared with the backend): flashcards, architecture puzzles, quests, deploy templates.
import cardsJson from '../../shared/flashcards.json';
import puzzlesJson from '../../shared/puzzles.json';
import questsJson from '../../shared/quests.json';
import templatesJson from '../../shared/templates.json';

export interface Flashcard {
  id: string;
  q: string;
  a: string;
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
  pillarBonus: Record<PillarId, { services: string[]; tip: string }>;
}

export type QuestStep =
  | { kind: 'visit'; serviceId: string; text: string }
  | { kind: 'cards'; serviceId: string; count: number; text: string }
  | { kind: 'puzzle'; puzzleId: string; text: string }
  | { kind: 'ask'; prompt: string; text: string }
  | { kind: 'deploy'; templateId: string; text: string };

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
