import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { startQuest as notifyQuest, type Layout } from '@/app/runtime';
import { useCity } from '@/state/store';
import { QUESTS } from '@/world/content';
import { markTourDone } from './logic';

interface Step {
  title: string;
  body: string;
  /** CSS selectors tried in order; the first visible match is highlighted. None = centred card. */
  targets: string[];
}

const steps = (layout: Layout): Step[] => [
  {
    title: '👋 Meet Kai',
    body: 'This is AWS City. Kai walks around town (arrow keys work too) — click any building or agent to see what it teaches.',
    targets: ['.stage'],
  },
  {
    title: '🧭 Open an AWS console page',
    body: 'Browse the AWS console as usual. Each service you open becomes a new landmark here, and its agent moves into town.',
    targets: ['.tabs', '.hud'],
  },
  {
    title: '💬 Ask an agent',
    body: 'Type what you want in plain words — “Store my holiday photos cheaply” — and watch the right agent walk over and do it.',
    targets: ['.prompt-row'],
  },
  {
    title: '🖥️ Try the Console Copilot',
    body:
      layout === 'panel'
        ? 'Tick “Do it in my console” and the agent clicks through your open AWS console tab for you, explaining every step. You can stop it any time.'
        : 'Open the side panel (toolbar icon) and tick “Do it in my console” — the agent clicks through your open AWS console tab, explaining every step.',
    targets: ['.console-toggle', '.chip.copilot', '.prompt'],
  },
];

type Rect = { top: number; left: number; width: number; height: number };

function findTarget(selectors: string[]): Rect | undefined {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    const r = el?.getBoundingClientRect();
    if (r && r.width > 0 && r.height > 0) return { top: r.top - 4, left: r.left - 4, width: r.width + 8, height: r.height + 8 };
  }
  return undefined;
}

/** Four-step coach-mark tour. Esc skips, Enter goes next, Tab stays inside the card. */
export function Tour({ layout }: { layout: Layout }) {
  const open = useCity((s) => s.tourOpen);
  const setOpen = useCity((s) => s.setTourOpen);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect>();
  const card = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const list = steps(layout);
  const step = list[Math.min(i, list.length - 1)];
  const last = i === list.length - 1;

  const close = useCallback(
    (finished: boolean) => {
      markTourDone();
      setOpen(false);
      setI(0);
      if (finished) {
        const first = QUESTS[0];
        const quests = useCity.getState().progress.quests;
        if (first && !quests?.[first.id]) {
          useCity.getState().startQuest(first.id);
          notifyQuest(first.id);
        }
      }
      if (opener.current instanceof HTMLElement) opener.current.focus();
    },
    [setOpen],
  );

  useEffect(() => {
    if (open) opener.current = document.activeElement;
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const targets = steps(layout)[i]?.targets ?? [];
    const place = () =>
      setRect((prev) => {
        const r = findTarget(targets);
        return prev && r && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height ? prev : r;
      });
    place();
    window.addEventListener('resize', place);
    const t = setTimeout(place, 250); // layout settles after fonts / the game canvas
    return () => {
      window.removeEventListener('resize', place);
      clearTimeout(t);
    };
  }, [open, i, layout]);

  // Focus the primary button on each step so Enter advances.
  useEffect(() => {
    if (open) card.current?.querySelector<HTMLButtonElement>('[data-primary]')?.focus();
  }, [open, i]);

  if (!open) return null;

  const next = () => (last ? close(true) : setI(i + 1));
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close(false);
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      next();
    } else if (e.key === 'ArrowRight' && !last) {
      setI(i + 1);
    } else if (e.key === 'ArrowLeft' && i > 0) {
      setI(i - 1);
    } else if (e.key === 'Tab') {
      const f = [...(card.current?.querySelectorAll<HTMLElement>('button') ?? [])];
      if (!f.length) return;
      const at = f.indexOf(document.activeElement as HTMLElement);
      const to = e.shiftKey ? (at <= 0 ? f.length - 1 : at - 1) : at === f.length - 1 ? 0 : at + 1;
      e.preventDefault();
      f[to].focus();
    }
  };

  // Put the card below the highlight if there's room, else above; centred when there's no target.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardW = Math.min(320, vw - 24);
  let pos: { top: number; left: number };
  if (!rect) pos = { top: vh / 2 - 90, left: (vw - cardW) / 2 };
  else {
    const below = rect.top + rect.height + 10;
    const top = below + 190 < vh ? below : Math.max(12, rect.top - 200);
    const inside = rect.height > vh * 0.5 ? rect.top + rect.height / 2 - 90 : top; // tall targets: overlay the middle
    pos = { top: Math.max(12, Math.min(inside, vh - 200)), left: Math.max(12, Math.min(rect.left + rect.width / 2 - cardW / 2, vw - cardW - 12)) };
  }

  return (
    <div className="tour" onKeyDown={onKey}>
      <div className={`tour-ring ${rect ? '' : 'none'}`} style={rect} aria-hidden="true" />
      <div ref={card} className="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body" style={pos}>
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-body">{step.body}</p>
        <div className="tour-foot">
          <span className="muted step-count">
            {i + 1} of {list.length}
          </span>
          <button className="btn" onClick={() => close(false)}>
            Skip
          </button>
          {i > 0 && (
            <button className="btn" onClick={() => setI(i - 1)}>
              Back
            </button>
          )}
          <button className="btn primary" data-primary onClick={next}>
            {last ? 'Start playing' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
