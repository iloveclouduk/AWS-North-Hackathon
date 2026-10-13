import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type SyntheticEvent } from 'react';
import { isSafeDocsUrl } from '@/app/runtime';
import { ALL_TERMS, GLOSSARY, splitTerms, termsWithout, type GlossaryEntry } from '@/world/glossary';
import { useCity } from '@/state/store';
import { feel } from './feedback';

/** Clicks and keys inside a term never reach the card or row around it (a flashcard must not flip). */
const stop = (e: SyntheticEvent) => e.stopPropagation();

function TermButton({ text, entry }: { text: string; entry: GlossaryEntry }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ dx: number; up: boolean }>({ dx: 0, up: false });
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLSpanElement>(null);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };

  // Close on a tap anywhere else (another term included).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !pop.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Keep the popover inside the viewport (the side panel is 400 px wide): nudge sideways, flip above near the bottom.
  useLayoutEffect(() => {
    if (!open || !pop.current) return;
    const r = pop.current.getBoundingClientRect();
    const gutter = 8;
    const dx = r.left < gutter ? gutter - r.left : r.right > window.innerWidth - gutter ? window.innerWidth - gutter - r.right : 0;
    setPlace({ dx, up: r.bottom > window.innerHeight - gutter && r.top - r.height > gutter });
  }, [open]);

  // Escape closes only the popover, not the dialog or card around it.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !open) return;
    e.stopPropagation();
    e.preventDefault();
    close(true);
  };

  return (
    <span className="term-wrap" role="presentation" onClick={stop} onKeyDown={onKey}>
      <button
        ref={btn}
        type="button"
        className="term"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`${text}: show definition`}
        onClick={() => {
          feel.tap();
          setPlace({ dx: 0, up: false });
          setOpen((o) => !o);
        }}
      >
        {text}
      </button>
      {open && (
        <span
          ref={pop}
          id={id}
          role="dialog"
          aria-label={entry.term}
          className={`term-pop ${place.up ? 'up' : ''}`}
          style={{ transform: place.dx ? `translateX(${Math.round(place.dx)}px)` : undefined }}
        >
          <b className="term-name">{entry.term}</b>
          <span className="term-short">{entry.short}</span>
          {isSafeDocsUrl(entry.url) && (
            <a className="term-more" href={entry.url} target="_blank" rel="noreferrer" onClick={() => close(false)}>
              More in the AWS docs ↗
            </a>
          )}
        </span>
      )}
    </span>
  );
}

/**
 * Plain text with known AWS terms as tap-to-define buttons (first mention of each per block only).
 * `still` is for text inside another button (a toast, a list row): terms are marked and titled, not buttons.
 */
export function Term({ text, entries = GLOSSARY, still = false }: { text: string; entries?: GlossaryEntry[]; still?: boolean }) {
  const parts = useMemo(() => glue(splitTerms(text, entries)), [text, entries]);
  return (
    <>
      {parts.map((p, i) => {
        if (typeof p === 'string') return <Fragment key={i}>{p}</Fragment>;
        const term = still ? (
          <span className="term still" title={`${p.entry.term}: ${p.entry.short}`}>
            {p.text}
          </span>
        ) : (
          <TermButton text={p.text} entry={p.entry} />
        );
        return p.before || p.after ? (
          <span key={`${i}:${p.entry.term}`} className="term-glue">
            {p.before}
            {term}
            {p.after}
          </span>
        ) : (
          <Fragment key={`${i}:${p.entry.term}`}>{term}</Fragment>
        );
      })}
    </>
  );
}

type Glued = string | { text: string; entry: GlossaryEntry; before: string; after: string };

/**
 * A term is a button, which Chromium lays out as one box, so a line could break between "(" and the term.
 * The punctuation touching a term travels with it: "(point-in-time recovery)" never wraps after "(".
 */
function glue(parts: ReturnType<typeof splitTerms>): Glued[] {
  const out: Glued[] = parts.map((p) => (typeof p === 'string' ? p : { ...p, before: '', after: '' }));
  out.forEach((p, i) => {
    if (typeof p === 'string') return;
    const prev = out[i - 1];
    const lead = typeof prev === 'string' ? /[([{"'‘“]+$/.exec(prev) : null;
    if (lead) (out[i - 1] = (prev as string).slice(0, lead.index)), (p.before = lead[0]);
    const next = out[i + 1];
    const tail = typeof next === 'string' ? /^[)\]}"'’”.,;:!?]+/.exec(next) : null;
    if (tail) (out[i + 1] = (next as string).slice(tail[0].length)), (p.after = tail[0]);
  });
  return out;
}

/**
 * Player-facing text with every glossary term and AWS service name tappable (the first mention of each).
 * `except` leaves one service's name plain (a flashcard question about it).
 */
export const Plain = ({ text, still, except }: { text: string; still?: boolean; except?: string }) => (
  <Term text={text} entries={except ? termsWithout(except) : ALL_TERMS} still={still} />
);

/** Technical extras (prices, role cards, CloudFormation types) folded away for whoever wants them. */
export function ForLearners({ children, className = '' }: { children: ReactNode; className?: string }) {
  // Builders (⋯ → I already build on AWS) see the deeper text first; it still folds away.
  const builder = useCity((s) => !!s.prefs.builder);
  return (
    <details className={`for-learners ${className}`} open={builder || undefined}>
      <summary>For AWS learners</summary>
      {children}
    </details>
  );
}
