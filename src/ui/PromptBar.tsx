import { useState } from 'react';
import { startConsoleCopilot, stopConsoleCopilot, submitPrompt, type Layout } from '@/app/runtime';
import { useCity } from '@/state/store';
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
  const [inConsole, setInConsole] = useState(false);
  const onConsole = useCity((s) => s.focus?.kind === 'console' || s.focus?.kind === 'console-home');
  const copilotOn = useCity((s) => !!s.copilotTaskId);
  const send = (t = text, consoleMode = inConsole) => {
    if (!t.trim()) return;
    if (consoleMode) void startConsoleCopilot(t);
    else submitPrompt(t);
    setText('');
  };
  return (
    <div className="prompt">
      <div className="chips">
        {layout === 'panel' && (
          <button className="chip copilot" onClick={() => send('Create an S3 bucket', true)} title="Sally does it in your open AWS console, explaining each step">
            🖥️ Create an S3 bucket in my console
          </button>
        )}
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
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={inConsole ? 'What should the agent do in your console?' : 'Ask the city to do something…'}
          aria-label="Prompt"
        />
        {layout === 'panel' && (
          <label className={`console-toggle ${inConsole ? 'on' : ''}`} title={onConsole ? 'Agents act in your open AWS console tab' : 'Open an AWS console tab to use this'}>
            <input type="checkbox" checked={inConsole} onChange={(e) => setInConsole(e.target.checked)} /> 🖥️
          </label>
        )}
        {copilotOn && (
          <button type="button" className="btn warn" onClick={() => stopConsoleCopilot('You stopped the Copilot.')}>
            Stop
          </button>
        )}
        <button className="btn primary" type="submit" disabled={!text.trim()}>
          Send
        </button>
        <LookoutButton layout={layout} />
      </form>
    </div>
  );
}
