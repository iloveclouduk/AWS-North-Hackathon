import { useState } from 'react';
import { submitPrompt, type Layout } from '@/app/runtime';
import { LookoutButton } from './LookoutButton';

const SUGGESTIONS = [
  'Store my holiday photos cheaply',
  'Run code when a file is uploaded',
  'Who can access my bucket?',
  'Point my domain at my website',
  'Protect my site from DDoS',
];

export function PromptBar({ layout }: { layout: Layout }) {
  const [text, setText] = useState('');
  const send = (t = text) => {
    if (!t.trim()) return;
    submitPrompt(t);
    setText('');
  };
  return (
    <div className="prompt">
      <div className="chips">
        {SUGGESTIONS.map((s) => (
          <button key={s} className="chip" onClick={() => send(s)}>
            {s}
          </button>
        ))}
      </div>
      <form
        className="prompt-row"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask the city to do something…" aria-label="Prompt" />
        <button className="btn primary" type="submit" disabled={!text.trim()}>
          Send
        </button>
        <LookoutButton layout={layout} />
      </form>
    </div>
  );
}
