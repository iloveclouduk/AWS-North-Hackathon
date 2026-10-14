import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { startQuest as notifyQuest, type Layout } from '@/app/runtime';
import { SURFACE, SURFACE_NAME } from '@/app/surface';
import { bus } from '@/state/bus';
import { useCity } from '@/state/store';
import { QUESTS } from '@/world/content';
import { feel } from './feedback';
import { activeSteps } from '@/state/ladder';
import { isTourDone, markTourDone, readPref, TIP_ASK_KEY, TIP_COPILOT_KEY, writePref } from './logic';
import { Portrait } from './Portrait';
import { walkTo } from '@/state/walk';

interface Step {
  title: string;
  body: string;
  /** CSS selectors tried in order (`@kai`: Kai on the map); the first visible match is highlighted. None = centred card. */
  targets: string[];
}

/** Three steps, then the first job: the city, where the next job always is, and what a building does. */
const STEPS: Step[] = [
  {
    title: 'Welcome! This is you, Kai',
    body: 'AWS is a giant set of computers anyone can rent over the internet. This city is made of its tools. Walk with the arrow keys or a click.',
    targets: ['@kai', '.stage'],
  },
  {
    title: 'Connie’s next job is always here',
    body: 'Your next step waits on Home. Press Go and Connie shows you the way.',
    targets: ['.next'],
  },
  {
    title: 'Tap any building',
    body: 'Each building is one AWS tool with a helper inside. Tap one to say hi and see what it does.',
    targets: ['.stage'],
  },
];

/** Where the first job starts: the first quest's current step, when it points at a landmark. */
function firstJobTarget(): string | undefined {
  const first = QUESTS[0];
  const st = first && useCity.getState().progress.quests?.[first.id];
  const step = first && st?.status === 'active' ? first.steps[st.step] : undefined;
  return step && (step.kind === 'visit' || step.kind === 'cards') ? step.serviceId : undefined;
}

type Rect = { top: number; left: number; width: number; height: number };

/** Kai's box on the page, asked of the city (synchronous: the scene replies inside emit). */
function kaiRect(): Rect | undefined {
  let found: Rect | undefined;
  bus.emit('locateKai', { reply: (r) => (found = r) });
  // The ring takes in Kai's "Kai (you)" tag under the feet too, so the card below never covers it.
  return found && { top: found.top - 6, left: found.left - 14, width: found.width + 28, height: found.height + 26 };
}

function findTarget(selectors: string[]): Rect | undefined {
  for (const sel of selectors) {
    if (sel === '@kai') {
      const r = kaiRect();
      if (r) return r;
      continue;
    }
    const el = document.querySelector(sel);
    const r = el?.getBoundingClientRect();
    if (r && r.width > 0 && r.height > 0) return { top: r.top - 4, left: r.left - 4, width: r.width + 8, height: r.height + 8 };
  }
  return undefined;
}

/** Three-step coach-mark tour. Esc skips, Enter goes next, Tab stays inside the card. */
export function Tour({ layout }: { layout: Layout }) {
  const open = useCity((s) => s.tourOpen);
  const setOpen = useCity((s) => s.setTourOpen);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect>();
  const card = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const list = STEPS;
  const step = list[Math.min(i, list.length - 1)];
  const last = i === list.length - 1;

  const close = useCallback(
    (finished: boolean) => {
      markTourDone();
      setOpen(false);
      setI(0);
      if (finished) {
        feel.questStart();
        const first = QUESTS[0];
        const quests = useCity.getState().progress.quests;
        if (first && !quests?.[first.id]) {
          useCity.getState().startQuest(first.id);
          notifyQuest(first.id);
        }
        // Straight to the first job's landmark: one place built, one toast, no tour of the whole city.
        const target = firstJobTarget();
        bus.emit('flyTo', { id: target ?? 'plaza' });
        // Kai walks there: the first visit step counts when he arrives (src/ui/QuestLog.tsx walkTo)
        if (target) walkTo(target);
      }
      if (opener.current instanceof HTMLElement) opener.current.focus();
    },
    [setOpen],
  );

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    // Step 1 is Kai: centre the camera on Kai, so the ring and the card can point at Kai.
    bus.emit('flyTo', { id: 'player' });
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const targets = STEPS[i]?.targets ?? [];
    const place = () =>
      setRect((prev) => {
        const r = findTarget(targets);
        return prev && r && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height ? prev : r;
      });
    place();
    window.addEventListener('resize', place);
    const t = setTimeout(place, 250); // layout settles after fonts / the game canvas
    const t2 = setTimeout(place, 800); // and the camera's 700 ms pan onto Kai
    return () => {
      window.removeEventListener('resize', place);
      clearTimeout(t);
      clearTimeout(t2);
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
    <div className="tour" role="presentation" onKeyDown={onKey}>
      <div className={`tour-ring ${rect ? '' : 'none'}`} style={rect} aria-hidden="true" />
      <div ref={card} className="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body" style={pos}>
        <div className="tour-head">
          <Portrait id={i === 0 ? 'user' : 'concierge'} size={32} />
          <h2 id="tour-title">{step.title}</h2>
        </div>
        <p id="tour-body">{step.body}</p>
        <div className="tour-foot">
          <span className="step-count pips" aria-label={`Step ${i + 1} of ${list.length}`}>
            {list.map((_, k) => (
              <i key={k} className={k === i ? 'on' : k < i ? 'done' : ''} />
            ))}
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
            {last ? 'Start my first job' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Coach tips: one card, once each, when the thing it explains first shows up (instead of more tour steps) ──

type TipId = 'ask' | 'copilot';
const TIPS: Record<TipId, { key: string; title: string; body: (layout: Layout) => string; target: string }> = {
  ask: {
    key: TIP_ASK_KEY,
    title: 'Ask for anything',
    body: () => 'Say it in plain words, like “Store my holiday photos cheaply”, and the right agent walks over and does it.',
    target: '.composer',
  },
  copilot: {
    key: TIP_COPILOT_KEY,
    title: 'Console Copilot: let it drive your console',
    body: (layout) =>
      layout === 'panel'
        ? 'Press the screen button beside the box and an agent clicks through your AWS console tab, explaining each step. Stop it any time.'
        : `Open the ${SURFACE_NAME[SURFACE]} and press the screen button beside the box.`,
    target: '.console-btn',
  },
};

/** "Ask" on the first ask step (or the first time the box is used); "Copilot" when its button first shows (panel only). */
export function CoachTips({ layout }: { layout: Layout }) {
  const tourOpen = useCity((s) => s.tourOpen);
  const askStep = useCity((s) => activeSteps(s.progress).some((x) => x.kind === 'ask'));
  const [tip, setTip] = useState<TipId>();
  const [rect, setRect] = useState<Rect>();
  const showing = useRef<TipId | undefined>(undefined);
  showing.current = tip;

  const offer = useCallback(
    (id: TipId) => {
      // Never over the tour, never before it (the tour comes first), never twice, never under automation.
      if (showing.current || tourOpen || !isTourDone() || navigator.webdriver || readPref(TIPS[id].key) === '1') return;
      if (!findTarget([TIPS[id].target])) return;
      writePref(TIPS[id].key, '1');
      setTip(id);
    },
    [tourOpen],
  );

  useEffect(() => {
    if (askStep) offer('ask');
  }, [askStep, offer]);
  useEffect(() => {
    const onFocus = (e: FocusEvent) => e.target instanceof Element && e.target.closest('.composer') && offer('ask');
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, [offer]);
  useEffect(() => {
    if (layout !== 'panel' || readPref(TIP_COPILOT_KEY) === '1') return;
    const check = () => {
      if (document.querySelector('.console-btn')) offer('copilot');
      if (readPref(TIP_COPILOT_KEY) === '1') mo.disconnect();
    };
    const mo = new MutationObserver(check);
    check();
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [layout, offer]);

  useLayoutEffect(() => {
    if (!tip) return;
    const place = () => setRect(findTarget([TIPS[tip].target]));
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [tip]);

  if (!tip) return null;
  const t = TIPS[tip];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(280, vw - 24);
  const left = rect ? Math.max(12, Math.min(rect.left + rect.width / 2 - w / 2, vw - w - 12)) : (vw - w) / 2;
  const top = rect ? (rect.top > 170 ? rect.top - 160 : Math.min(rect.top + rect.height + 10, vh - 170)) : vh / 2 - 80;
  return (
    <div className="coach-tip" role="dialog" aria-labelledby="coach-title" style={{ top, left }}>
      <b id="coach-title">{t.title}</b>
      <p>{t.body(layout)}</p>
      <button className="btn primary tiny" onClick={() => setTip(undefined)}>
        Got it
      </button>
    </div>
  );
}
