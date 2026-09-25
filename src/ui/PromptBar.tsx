import { useState } from 'react';
import { startConsoleCopilot, stopConsoleCopilot, submitPrompt, type Layout } from '@/app/runtime';
import { useCity } from '@/state/store';
import { ChipRow } from './ChipRow';
import { offlineReason } from './logic';
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
  const offline = useCity((s) => offlineReason(s.backendKind, s.backendStatus));
  const send = (t = text, consoleMode = inConsole) => {
    if (!t.trim() || offline) return;
    if (consoleMode) void startConsoleCopilot(t);
    else submitPrompt(t);
    setText('');
  };
  return (
    <div className="prompt">
      <ChipRow label="Suggestions">
        {layout === 'panel' && (
          <button
            className="chip copilot"
            onClick={() => send('Create an S3 bucket', true)}
            disabled={!!offline}
            title={offline ?? 'Sally does it in your open AWS console, explaining each step'}
          >
            🖥️ Create an S3 bucket in my console
          </button>
        )}
        {SUGGESTIONS.map((s) => (
          <button key={s} className="chip" onClick={() => send(s)} disabled={!!offline} title={offline}>
            {s}
          </button>
        ))}
      </ChipRow>
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
          aria-label={inConsole ? 'What should the agent do in your console?' : 'Ask the city'}
        />
        {copilotOn && (
          <button type="button" className="btn warn" onClick={() => stopConsoleCopilot('You stopped the Copilot.')}>
            Stop
          </button>
        )}
        <button className="btn primary" type="submit" disabled={!text.trim() || !!offline} title={offline}>
          Send
        </button>
      </form>
      {layout === 'panel' && (
        <div className="prompt-opts">
          <label
            className={`console-toggle ${inConsole ? 'on' : ''}`}
            title={onConsole ? 'The agent clicks through your open AWS console tab, explaining each step' : 'Open an AWS console tab to use this'}
          >
            <input type="checkbox" checked={inConsole} onChange={(e) => setInConsole(e.target.checked)} />
            <span aria-hidden="true">🖥️</span> Do it in my console
          </label>
          <LookoutButton layout={layout} />
        </div>
      )}
    </div>
  );
}
