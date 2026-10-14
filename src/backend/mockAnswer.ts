// The offline demo's answer to a question in a building (MockBackend.ask): no model, just the service's own
// flashcards. The question's words are matched against each card (the question counts double), and the best one or
// two are answered in plain words with their AWS docs source. Nothing matches: the building's blurb and what it teaches.
import { cardsFor, type Flashcard } from '@/world/content';

/** Words too common to tell two cards apart. */
const STOP = new Set(
  'the and for are but not you your yours with what when where which who why how does did can could should would will this that these those there their they them have has had from into about over than then just also its it’s is was were been being any all some more most much many very use using used get make like want need know tell explain show give'.split(
    ' ',
  ),
);

/** The words in `text` worth matching on: lower case, 3+ letters, no stop words, simple plurals folded. */
export const keywords = (text: string) =>
  (text.toLowerCase().match(/[a-z0-9][a-z0-9-]*/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));

/**
 * How well a card answers the question: words in its question count double, words in its answer once. A card that
 * covers fewer than half of the question's words scores 0 (one shared word, like "instance", isn't an answer).
 */
export function score(card: Flashcard, question: string) {
  const want = new Set(keywords(question));
  if (!want.size) return 0;
  const q = new Set(keywords(card.q));
  const a = new Set(keywords(`${card.simple ?? ''} ${card.a}`));
  let n = 0;
  let covered = 0;
  for (const w of want) {
    const hit = (q.has(w) ? 2 : 0) + (a.has(w) ? 1 : 0);
    n += hit;
    if (hit) covered++;
  }
  return covered * 2 >= want.size ? n : 0;
}

/** The cards that best answer `question` for this service, best first (at most `max`, only ones that match). */
export function bestCards(serviceId: string, question: string, max = 2) {
  return cardsFor(serviceId)
    .map((card) => ({ card, n: score(card, question) }))
    .filter((x) => x.n > 0)
    .sort((x, y) => y.n - x.n)
    .slice(0, max)
    .map((x) => x.card);
}

export const OFFLINE_NOTE = '(Offline demo: connect AWS for answers from the docs, written for your question.)';

/** The whole answer, in plain words. */
export function offlineAnswer(svc: { id: string; name: string }, place: { place: string; blurb: string; teaches: string[] } | undefined, question: string) {
  const [best, next] = bestCards(svc.id, question);
  if (!best) {
    const where = place ? `Here at ${place.place}: ${place.blurb}` : `${svc.name}.`;
    const ideas = place?.teaches.length ? ` The key ideas: ${place.teaches.map((t, i) => `(${i + 1}) ${t}`).join(' ')}.` : '';
    return `${where}${ideas} Ask me about one of those and I'll go deeper. ${OFFLINE_NOTE}`;
  }
  const say = (c: Flashcard) => c.simple ?? c.a;
  const more = next ? ` Also worth knowing: ${say(next)}` : '';
  return `${say(best)}${best.simple && best.a !== best.simple ? ` In more detail: ${best.a}` : ''}${more} Source: ${best.source} ${OFFLINE_NOTE}`;
}
