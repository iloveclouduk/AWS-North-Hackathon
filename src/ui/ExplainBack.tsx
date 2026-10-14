import { useId, useState } from 'react';
import { askDistrict } from '@/app/runtime';
import { checkExplain, explainQuestion, explainService, framedExplain, MAX_CHARS, MIN_WORDS } from '@/state/explain';
import { agentName, useCity } from '@/state/store';
import type { Quest } from '@/world/content';
import { feel } from './feedback';
import { Plain } from './Term';

/**
 * "Explain it back": one question after a quest, answered in the player's own words. A quick rules-only check shows at
 * once (the key ideas used); the building's agent then replies with kind feedback through the ordinary chat route.
 */
export function ExplainBack({ quest }: { quest: Quest }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [sent, setSent] = useState<{ requestId?: string; text: string }>();
  const fieldId = useId();
  const serviceId = explainService(quest);
  const reply = useCity((s) => (sent?.requestId ? s.chats[quest.districtId]?.find((m) => m.id === `a-${sent.requestId}`) : undefined));
  const check = checkExplain(serviceId, sent?.text ?? text);

  if (!open)
    return (
      <button className="btn ghost wide" onClick={() => (feel.tap(), setOpen(true))}>
        ✍️ Explain it back in your own words
      </button>
    );

  if (!sent)
    return (
      <form
        className="explain-back"
        onSubmit={(e) => {
          e.preventDefault();
          if (check.tooShort) return;
          feel.tap();
          setSent({ text, requestId: askDistrict(quest.districtId, framedExplain(quest, text), text) });
        }}
      >
        <label htmlFor={fieldId}>
          <Plain text={explainQuestion(quest)} />
        </label>
        <textarea id={fieldId} rows={3} maxLength={MAX_CHARS} value={text} onChange={(e) => setText(e.target.value)} placeholder="A sentence or two is plenty." />
        <button className="btn primary wide" type="submit" disabled={check.tooShort}>
          {check.tooShort ? `A few more words (${MIN_WORDS - check.words} to go)` : 'Check my answer'}
        </button>
      </form>
    );

  return (
    <div className="explain-back" aria-live="polite">
      {check.mentioned.length > 0 && (
        <p className="explain-got">
          ✅ You used: {check.mentioned.slice(0, 5).join(', ')}
        </p>
      )}
      {check.missed.length > 0 && <p className="muted explain-missed">💡 Ideas to add: {check.missed.join(', ')}</p>}
      {reply ? (
        <p className="explain-reply">
          <b>{agentName(reply.agentId ?? serviceId)}:</b> {reply.text}
          {reply.pending ? ' …' : ''}
        </p>
      ) : (
        sent.requestId && <p className="muted">{agentName(serviceId)} is reading your answer…</p>
      )}
    </div>
  );
}
