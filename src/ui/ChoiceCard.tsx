import { useRef, useState } from 'react';
import { useCity } from '@/state/store';
import { choiceById, choiceOrder } from '@/world/content';
import { feel } from './feedback';
import { Portrait } from './Portrait';
import { Plain } from './Term';
import { useDialog } from './useDialog';

/**
 * A quest's scenario question, asked by the quest's character: pick an answer, read why it's right or wrong, and try
 * again until it's right. The step is done on the right answer. Nothing is lost for a wrong one: it's how you learn.
 */
export function ChoiceCard() {
  const id = useCity((s) => s.choiceOpen);
  const found = id ? choiceById(id) : undefined;
  const close = useCity((s) => s.openChoice);
  const pass = useCity((s) => s.passChoice);
  const [picked, setPicked] = useState<number[]>([]);
  const [solved, setSolved] = useState(false);
  const box = useRef<HTMLElement>(null);
  const shut = () => {
    setPicked([]);
    setSolved(false);
    close(undefined);
  };
  useDialog(!!found, box, shut);

  if (!found) return null;
  const { quest, step } = found;
  const giver = quest.steps.find((x) => x.kind === 'visit')?.serviceId ?? quest.serviceIds[0];
  const last = picked.at(-1);

  return (
    <div className="finding-scrim app-modal" role="presentation" onClick={(e) => e.target === e.currentTarget && shut()}>
      <section ref={box} className="finding-card choice-card" role="dialog" aria-modal="true" aria-labelledby="choice-q">
        <header className="finding-head">
          <Portrait id={giver} size={40} />
          <div className="finding-who">
            <b>{quest.title}</b>
            <span className="muted">Pick the best answer</span>
          </div>
          <button className="btn icon ghost" aria-label="Close" onClick={shut}>
            ✕
          </button>
        </header>
        <p id="choice-q" className="choice-q">
          <Plain text={step.question} />
        </p>
        <div className="choice-options" role="group" aria-label="Answers">
          {choiceOrder(step.id, step.options.length).map((i, shown) => {
            const o = step.options[i];
            const tried = picked.includes(i);
            const state = tried ? (o.correct ? 'right' : 'wrong') : '';
            return (
              <button
                key={i}
                className={`choice-option ${state}`}
                aria-pressed={tried}
                disabled={solved || (tried && !o.correct)}
                onClick={() => {
                  setPicked((p) => [...p, i]);
                  if (o.correct) {
                    feel.good();
                    setSolved(true);
                    pass(step.id);
                  } else feel.bad();
                }}
              >
                <span className="choice-mark" aria-hidden="true">
                  {state === 'right' ? '✓' : state === 'wrong' ? '✗' : String.fromCharCode(65 + shown)}
                </span>
                <Plain text={o.text} />
              </button>
            );
          })}
        </div>
        {last !== undefined && (
          <p className={`choice-why ${step.options[last].correct ? 'right' : 'wrong'}`} aria-live="polite">
            <b>{step.options[last].correct ? 'Right! ' : 'Not quite. '}</b>
            <Plain text={step.options[last].why} />
          </p>
        )}
        <footer className="finding-actions">
          <button className={`btn ${solved ? 'primary' : 'ghost'}`} onClick={shut}>
            {solved ? 'Continue' : 'Later'}
          </button>
        </footer>
      </section>
    </div>
  );
}
