// "Explain it back": after a quest, the player says what they learned in their own words. The quick check here is
// rules only (the service's own keywords, shared/world.json); the kind, grounded feedback comes from that building's
// agent through the ordinary chat.ask route (the server's landmark agent, or the demo's canned reply).
import type { Quest } from '@/world/content';
import { serviceById } from '@/world/taxonomy';

/** Shorter than this and there's nothing to check yet. */
export const MIN_WORDS = 6;
/** The answer is capped so the framed question stays well inside chat.ask's 2,000 characters. */
export const MAX_CHARS = 600;
/** The framing's first words: the demo backend recognises an explain-back by them. */
export const EXPLAIN_MARK = 'Explain it back';

/** The service a quest is mostly about: its first one. */
export const explainService = (q: Quest) => q.serviceIds[0];

export function explainQuestion(q: Quest) {
  const s = serviceById(explainService(q));
  return `In your own words: what does ${s?.name ?? 'it'} do, and why did “${q.title}” use it?`;
}

export interface ExplainCheck {
  words: number;
  tooShort: boolean;
  /** The service's key ideas the answer mentions. */
  mentioned: string[];
  /** Up to three it doesn't, to nudge with. */
  missed: string[];
}

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
const has = (text: string, idea: string) => new RegExp(`(^|[^a-z0-9])${idea.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?($|[^a-z0-9])`, 'i').test(text);

/** The quick, rules-only look at an answer: which of the service's key ideas it uses (never the name itself). */
export function checkExplain(serviceId: string, text: string): ExplainCheck {
  const s = serviceById(serviceId);
  const own = new Set([serviceId, ...(s?.name.toLowerCase().split(/\s+/) ?? [])]);
  const ideas = [...new Set((s?.keywords ?? []).map((k) => k.toLowerCase()))].filter((k) => !own.has(k));
  const n = words(text);
  const mentioned = ideas.filter((k) => has(text, k));
  return { words: n, tooShort: n < MIN_WORDS, mentioned, missed: ideas.filter((k) => !mentioned.includes(k)).slice(0, 3) };
}

/** What the building's agent is asked: the question, the player's words, and how to answer (kind, short, plain). */
export function framedExplain(q: Quest, answer: string) {
  const text = answer.trim().slice(0, MAX_CHARS);
  return (
    `${EXPLAIN_MARK} for the quest “${q.title}”. The question: ${explainQuestion(q)} ` +
    `My answer, in my own words: “${text}” ` +
    'Please reply kindly in two or three short sentences of plain words: what I got right, then one thing to fix or add.'
  );
}
