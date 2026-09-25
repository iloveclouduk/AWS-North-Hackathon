import { useEffect, useRef, useState } from 'react';
import { askDistrict } from '@/app/runtime';
import { agentName, useCity } from '@/state/store';
import { districtById, servicesIn, type DistrictId } from '@/world/taxonomy';

const EMPTY: never[] = [];

/** Q&A with a district's agents inside their HQ. */
export function ChatPanel({ districtId }: { districtId: string }) {
  const msgs = useCity((s) => s.chats[districtId] ?? EMPTY);
  const focus = useCity((s) => s.focus);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [msgs]);
  const d = districtById(districtId)!;
  const names = servicesIn(districtId as DistrictId).map((s) => s.name.replace(/^(Amazon|AWS) /, ''));

  const send = (q = text) => {
    askDistrict(districtId, q);
    setText('');
  };

  return (
    <div className="chat">
      <div className="chat-log">
        {msgs.length === 0 && (
          <p className="empty">
            Ask the {d.name} team about {names.join(', ')}.
            {focus?.title ? ` They can see you're on “${focus.title.slice(0, 50)}”.` : ''}
          </p>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={`bubble ${m.role}`}>
            {m.role === 'agent' && <b>{agentName(m.agentId ?? '')}: </b>}
            {m.text}
            {m.pending && <span className="typing">▍</span>}
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="chips">
        {[`What is ${names[0]} for?`, `When should I use ${names[1] ?? names[0]}?`, `${names[0]} vs ${names[2] ?? names[1] ?? names[0]}?`].map((q) => (
          <button key={q} className="chip" onClick={() => send(q)}>
            {q}
          </button>
        ))}
      </div>
      <form
        className="prompt-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) send();
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Ask ${d.hq}…`} aria-label="Question" />
        <button className="btn primary" type="submit" disabled={!text.trim()}>
          Ask
        </button>
      </form>
    </div>
  );
}
