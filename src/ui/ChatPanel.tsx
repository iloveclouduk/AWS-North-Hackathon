import { useEffect, useRef, useState } from 'react';
import { askDistrict } from '@/app/runtime';
import { agentName, useCity } from '@/state/store';
import { districtById, servicesIn, type DistrictId } from '@/world/taxonomy';
import { ChipRow } from './ChipRow';
import { feel } from './feedback';
import { districtStyle, offlineReason } from './logic';
import { Portrait } from './Portrait';

const EMPTY: never[] = [];

/** Q&A with a district's agents inside their HQ. */
export function ChatPanel({ districtId }: { districtId: string }) {
  const msgs = useCity((s) => s.chats[districtId] ?? EMPTY);
  const focus = useCity((s) => s.focus);
  const offline = useCity((s) => offlineReason(s.backendKind, s.backendStatus));
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [msgs]);
  const d = districtById(districtId)!;
  const team = servicesIn(districtId as DistrictId);
  const names = team.map((s) => s.name.replace(/^(Amazon|AWS) /, ''));
  // Three different questions, never "S3 vs S3?".
  const [a, b = a, c = b] = names;
  const suggestions = [...new Set([`What is ${a} for?`, `When should I use ${b}?`, a !== c ? `${a} vs ${c}?` : `How do I start with ${a}?`])];

  const send = (q = text) => {
    if (offline) return;
    feel.send();
    askDistrict(districtId, q);
    setText('');
  };

  return (
    <div className="chat" style={districtStyle(d.color)}>
      <header className="chat-head">
        <span className="chat-team" aria-hidden="true">
          {team.slice(0, 5).map((t) => (
            <Portrait key={t.id} id={t.id} size={24} />
          ))}
        </span>
        <span className="px">{d.hq}</span>
      </header>
      <div className="chat-log" role="log" aria-live="polite">
        {msgs.length === 0 && (
          <p className="empty">
            Ask the {d.name} team anything about {names.slice(0, 4).join(', ')}
            {names.length > 4 ? '…' : '.'}
            {focus?.title ? ` They can see you’re on “${focus.title.slice(0, 50)}”.` : ''}
          </p>
        )}
        {msgs.map((m) =>
          m.role === 'agent' ? (
            <div key={m.id} className="chat-row">
              <Portrait id={m.agentId ?? 'concierge'} size={28} />
              <div className="bubble agent">
                <b className="bubble-who">{agentName(m.agentId ?? '')}</b>
                {m.text}
                {m.pending && (
                  <span className="typing-dots" aria-label="typing">
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div key={m.id} className={`bubble ${m.role}`} role={m.role === 'error' ? 'alert' : undefined}>
              {m.role === 'error' && <span aria-hidden="true">⚠️ </span>}
              {m.text}
            </div>
          ),
        )}
        <div ref={end} />
      </div>
      {offline && <p className="muted offline-note">{offline}</p>}
      <ChipRow label="Suggested questions">
        {suggestions.map((q) => (
          <button key={q} className="chip" onClick={() => send(q)} disabled={!!offline} title={offline}>
            {q}
          </button>
        ))}
      </ChipRow>
      <form
        className="prompt-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) send();
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Ask ${d.hq}…`} aria-label="Question" disabled={!!offline} title={offline} />
        <button className="btn primary" type="submit" disabled={!text.trim() || !!offline} title={offline}>
          Ask ➤
        </button>
      </form>
    </div>
  );
}
