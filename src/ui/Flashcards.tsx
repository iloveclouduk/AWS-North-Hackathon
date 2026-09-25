import { useMemo, useState } from 'react';
import { isDue, type Grade } from '@/learning/srs';
import { isDiscovered, useCity } from '@/state/store';
import { cardsFor, type Flashcard } from '@/world/content';
import { placeFor, TIER_NAMES } from '@/world/places';
import { SERVICES, serviceById } from '@/world/taxonomy';

/** Spaced-repetition flashcards per landmark. Correct answers grow the landmark (XP) and its agent. */
export function Flashcards() {
  const progress = useCity((s) => s.progress);
  const selected = useCity((s) => s.selected);
  const reviewCard = useCity((s) => s.reviewCard);
  const discovered = SERVICES.filter((s) => isDiscovered(progress, s.id));
  const [deck, setDeck] = useState<string>(() => (selected && serviceById(selected) ? selected : (discovered[0]?.id ?? 's3')));
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(0);

  const queue = useMemo(() => {
    const cards: Flashcard[] = deck === 'due' ? discovered.flatMap((s) => cardsFor(s.id)) : cardsFor(deck);
    return cards.filter((c) => isDue(progress.cards?.[c.id])).sort((a, b) => a.tier - b.tier);
  }, [deck, progress.cards, discovered]);
  const card = queue[0];
  const serviceId = card?.id.replace(/-\d+$/, '');

  const grade = (g: Grade) => {
    if (!card) return;
    reviewCard(card.id, g);
    setFlipped(false);
    setDone((n) => n + 1);
  };

  const total = deck === 'due' ? discovered.reduce((n, s) => n + cardsFor(s.id).length, 0) : cardsFor(deck).length;
  return (
    <div className="cards">
      <div className="row">
        <select value={deck} onChange={(e) => (setDeck(e.target.value), setFlipped(false))} aria-label="Deck">
          <option value="due">⏰ All due cards (discovered)</option>
          {SERVICES.map((s) => (
            <option key={s.id} value={s.id}>
              {isDiscovered(progress, s.id) ? '' : '🔒 '}
              {placeFor(s.id)?.place} ({cardsFor(s.id).length})
            </option>
          ))}
        </select>
      </div>
      <div className="muted">
        {queue.length} due of {total} · reviewed {done} this session
      </div>
      {card ? (
        <button className={`flash ${flipped ? 'back' : ''}`} onClick={() => setFlipped((f) => !f)}>
          <span className="flash-meta">
            {placeFor(serviceId!)?.place} · {TIER_NAMES[card.tier]}
          </span>
          <span className="flash-text">{flipped ? card.a : card.q}</span>
          <span className="flash-hint">{flipped ? '' : 'tap to reveal'}</span>
        </button>
      ) : (
        <p className="empty">🎉 Nothing due in this deck. Come back later — spaced repetition brings cards back right before you’d forget them.</p>
      )}
      {card && flipped && (
        <>
          <div className="actions grades">
            <button className="btn warn" onClick={() => grade('again')}>
              ↺ Again
            </button>
            <button className="btn" onClick={() => grade('good')}>
              ✓ Good
            </button>
            <button className="btn primary" onClick={() => grade('easy')}>
              ★ Easy
            </button>
          </div>
          <a className="source" href={card.source} target="_blank" rel="noreferrer">
            📖 Source: AWS docs
          </a>
        </>
      )}
    </div>
  );
}
