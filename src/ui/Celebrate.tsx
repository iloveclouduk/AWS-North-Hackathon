import { useRef } from 'react';
import { startQuest as notifyQuest } from '@/app/runtime';
import { nextUnlock } from '@/state/ladder';
import { useCity } from '@/state/store';
import { questById, QUESTS } from '@/world/content';
import { placeFor } from '@/world/places';
import { ExplainBack } from './ExplainBack';
import { feel } from './feedback';
import { Portrait } from './Portrait';
import { Plain } from './Term';
import { useLadderInput } from './useLadder';
import { useDialog } from './useDialog';

/**
 * The one big moment a quest gets: Connie cheers, says which buildings grew and how many stars you earned, what opens
 * next, and offers the next quest. It replaces the toast, so finishing a quest makes one celebration, not five.
 */
export function Celebrate() {
  const id = useCity((s) => s.celebration);
  const close = useCity((s) => s.celebrate);
  const quests = useCity((s) => s.progress.quests);
  const start = useCity((s) => s.startQuest);
  const input = useLadderInput();
  const box = useRef<HTMLElement>(null);
  const q = id ? questById(id) : undefined;
  useDialog(!!q, box, () => close(undefined));
  if (!q) return null;

  const grew = q.serviceIds.map((sid) => placeFor(sid)?.place).filter((p): p is string => !!p);
  const next = QUESTS.find((x) => !quests?.[x.id]);
  const opens = nextUnlock(input);
  const go = () => {
    close(undefined);
    if (!next) return;
    feel.questStart();
    start(next.id);
    notifyQuest(next.id);
  };

  return (
    <div className="finding-scrim app-modal celebrate-scrim" role="presentation" onClick={(e) => e.target === e.currentTarget && close(undefined)}>
      <section ref={box} className="finding-card celebrate" role="dialog" aria-modal="true" aria-labelledby="celebrate-title">
        <div className="celebrate-burst" aria-hidden="true">
          🏆
        </div>
        <h3 id="celebrate-title">Quest complete!</h3>
        <p className="celebrate-name">{q.title}</p>
        <p className="celebrate-stars" aria-label={`You earned ${q.rewardXp} stars`}>
          +{q.rewardXp} ⭐
        </p>
        <div className="celebrate-say">
          <Portrait id="concierge" size={32} />
          <p>
            <b>Connie:</b> <Plain text={grew.length ? `Brilliant! ${grew.join(' and ')} grew because of you.` : 'Brilliant work!'} />
            {opens ? ` And something new is opening soon: ${opens.label}.` : ''}
          </p>
        </div>
        <ExplainBack key={q.id} quest={q} />
        <div className="celebrate-actions">
          {next ? (
            <button className="btn primary wide" onClick={go}>
              Next adventure: {next.title} →
            </button>
          ) : null}
          <button className={`btn ${next ? 'ghost' : 'primary'} wide`} onClick={() => close(undefined)}>
            Keep exploring
          </button>
        </div>
      </section>
    </div>
  );
}
