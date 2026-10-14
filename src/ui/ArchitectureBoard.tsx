import { useEffect, useMemo, useRef, useState } from 'react';
import { effectiveEdges, flowSteps, nextEmptyRequired, pickUp, remainingCards, shortName, slotName, slotsOf, tryPlace, type Placements } from '@/learning/diagram';
import { scoreDiagram, type PuzzleScore } from '@/learning/scoring';
import { reducedMotion } from '@/game/motion';
import { bus } from '@/state/bus';
import { useCity } from '@/state/store';
import { PUZZLES, type Puzzle } from '@/world/content';
import { placeFor, TIER_NAMES } from '@/world/places';
import { districtById, serviceById } from '@/world/taxonomy';
import { AwsIcon } from './AwsIcon';
import { DiagramBoard, type FlowPlay } from './diagram/DiagramBoard';
import { ResultPanel } from './diagram/ResultPanel';
import { useDragPlace } from './diagram/useDragPlace';
import { feel } from './feedback';
import { Portrait } from './Portrait';
import { districtStyle, featuredPuzzle, shuffle } from './logic';
import { Plain, Term } from './Term';
import { EmptyState } from './EmptyState';
import { firstTryToday, puzzleReward, type PuzzleReward } from '@/learning/puzzleRewards';
import { PUZZLE_PASS } from '@/state/ladder';

/** Architecture builder: drag services onto an AWS diagram, then watch the data flow through it. */
export function ArchitectureBoard() {
  const puzzles = useCity((s) => s.progress.puzzles);
  const focusPuzzle = useCity((s) => s.focusPuzzle);
  const [featured] = useState(() => featuredPuzzle(useCity.getState().progress, focusPuzzle) ?? PUZZLES[0]?.id);
  const [id, setId] = useState(featured);
  /** The other puzzles wait behind "More puzzles" (one puzzle at a time for a new player). */
  const [showAll, setShowAll] = useState(false);
  // A quest's "Go →" names the puzzle to open.
  useEffect(() => {
    if (focusPuzzle) setId(focusPuzzle);
  }, [focusPuzzle]);
  const p = PUZZLES.find((x) => x.id === id) ?? PUZZLES[0];
  if (!p) return <EmptyState title="No puzzles yet">They open as your quests reach them.</EmptyState>;
  // The featured puzzle first, then the rest in order; folded to the one being played until "More puzzles".
  const order = [...PUZZLES].sort((a, b) => Number(b.id === featured) - Number(a.id === featured));
  const list = showAll ? order : order.filter((x) => x.id === p.id);

  return (
    <div className="arch">
      <select value={p.id} onChange={(e) => setId(e.target.value)} aria-label="Puzzle">
        {list.map((x) => (
          <option key={x.id} value={x.id}>
            {(puzzles?.[x.id]?.best ?? 0) >= PUZZLE_PASS ? '✓ ' : ''}
            {x.title} · {TIER_NAMES[x.tier]}
            {(puzzles?.[x.id]?.best ?? 0) >= PUZZLE_PASS ? ` (best ${puzzles![x.id].best})` : ''}
          </option>
        ))}
      </select>
      {!showAll && PUZZLES.length > 1 && (
        <button className="btn ghost tiny arch-more" onClick={() => setShowAll(true)}>
          More puzzles ({PUZZLES.length - 1})
        </button>
      )}
      <p className="story">
        <Plain text={p.story} />
      </p>
      <h4 className="arch-label">The brief</h4>
      <ul className="reqs">
        {p.requirements.map((r) => (
          <li key={r}>
            <Plain text={r} />
          </li>
        ))}
      </ul>
      {p.diagram ? <Builder key={p.id} p={p} /> : <EmptyState title="Still being drawn">This puzzle has no diagram yet.</EmptyState>}
    </div>
  );
}

type Phase = 'build' | 'flow';

/** One attempt at one puzzle (remounted when the puzzle changes, so nothing leaks between them). */
function Builder({ p }: { p: Puzzle }) {
  const best = useCity((s) => s.progress.puzzles?.[p.id]?.best ?? 0);
  const recordPuzzle = useCity((s) => s.recordPuzzle);
  const d = p.diagram!;
  const slots = useMemo(() => slotsOf(p), [p]);
  const required = slots.filter((s) => s.required);
  const [placements, setPlacements] = useState<Placements>({});
  const [armed, setArmed] = useState<string>();
  const [hint, setHint] = useState<string>();
  /** The hint went on to show which card fits (costs points; the first nudge is free). */
  const [hintShown, setHintShown] = useState(false);
  /** Spots whose card a hint has shown (each costs once, however often you ask). */
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [rejected, setRejected] = useState<string>();
  const [say, setSay] = useState('Drag a service onto the diagram, or tap a card and then a spot.');
  const [drops, setDrops] = useState<string[]>([]);
  const [misdrops, setMisdrops] = useState(0);
  const [result, setResult] = useState<PuzzleScore>();
  const [phase, setPhase] = useState<Phase>('build');
  const [step, setStep] = useState(0);
  const [manual, setManual] = useState(reducedMotion());
  const slotEls = useRef(new Map<string, HTMLElement>());
  const rejectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Stars earned by a pass, paid once the flow has played (so "upgraded" toasts don't cover the payoff). */
  const pendingXp = useRef<Record<string, number>>({});
  const payXp = () => {
    for (const [s, n] of Object.entries(pendingXp.current)) useCity.getState().addXp(s, n);
    pendingXp.current = {};
  };
  /** What this check earned, for the result panel. */
  const [earned, setEarned] = useState<PuzzleReward>();
  useEffect(
    () => () => {
      clearTimeout(rejectTimer.current);
      payXp();
    },
    [],
  );

  // A fresh random order each time a puzzle is opened, stable while you play it.
  const deck = useMemo(() => shuffle([...new Set([...p.required, ...p.optional, ...p.distractors])]), [p]);
  const left = remainingCards(p, placements);
  const filledReq = required.filter((s) => placements[s.id]).length;
  const hintSlot = hint ? slots.find((s) => s.id === hint) : undefined;

  const edges = useMemo(() => (phase === 'flow' ? effectiveEdges(d, placements) : d.edges), [d, placements, phase]);
  const steps = useMemo(() => flowSteps(edges).map((group) => group.map((e) => edges.indexOf(e))), [edges]);
  // While the flow plays, badges count the steps of the design you built (1, 2, 3…), matching the "2/3" counter.
  const stepLabel = useMemo(() => {
    if (phase !== 'flow') return undefined;
    const order = [...new Set(steps.map((g) => edges[g[0]].step!))];
    return (s: number) => order.indexOf(s) + 1;
  }, [phase, steps, edges]);

  const changed = () => {
    setResult(undefined);
    setPhase('build');
  };
  const place = (slotId: string, svc: string) => {
    const r = tryPlace(p, placements, slotId, svc);
    if (r.ok) {
      feel.pop();
      setPlacements(r.placements);
      setArmed(undefined);
      if (hint === slotId) setHint(undefined);
      const n = required.filter((s) => r.placements[s.id]).length;
      setSay(`Placed ${slotName(p, slotId, svc)}: ${slots.find((s) => s.id === slotId)?.role}. ${n} of ${required.length} required spots filled.`);
      changed();
      return;
    }
    feel.bad();
    if (r.reason === 'distractor') setDrops((cur) => (cur.includes(svc) ? cur : [...cur, svc]));
    if (r.reason === 'wrong-slot') setMisdrops((n) => n + 1);
    setSay(r.message);
    setRejected(slotId);
    clearTimeout(rejectTimer.current);
    rejectTimer.current = setTimeout(() => setRejected(undefined), 600);
  };
  const onSlot = (slotId: string) => {
    if (armed) return place(slotId, armed);
    if (placements[slotId]) {
      const r = pickUp(placements, slotId);
      setPlacements(r.placements);
      setArmed(r.service);
      setSay(`Picked up ${slotName(p, slotId, r.service!)}. Choose a spot for it.`);
      changed();
    } else setSay('Pick a service card first, then choose a spot.');
  };
  const onRemove = (slotId: string) => {
    const r = pickUp(placements, slotId);
    setPlacements(r.placements);
    setSay(`Took ${slotName(p, slotId, r.service!)} back to the tray.`);
    changed();
  };
  const { ghost, over, cardProps } = useDragPlace({
    slots: slotEls,
    onDrop: place,
    onTap: (svc, viaKeyboard) => {
      feel.tap();
      const next = armed === svc ? undefined : svc;
      setArmed(next);
      if (next) setSay(`Picked up ${shortName(svc)}. Choose a spot for it.`);
      // Keyboard players go straight to the diagram; arrow keys move between spots.
      if (next && viaKeyboard) slotEls.current.get(nextEmptyRequired(p, placements)?.id ?? slots.find((s) => !placements[s.id])?.id ?? '')?.focus();
    },
  });

  const check = () => {
    const r = scoreDiagram(p, { placements, distractorDrops: drops, misdrops, reveals: revealed.size });
    setResult(r);
    // src/learning/puzzleRewards.ts: a first pass pays most, a better pass a little, a try below the mark pays for the
    // pieces already right (once a day); re-checking the same answer pays nothing.
    const reward = puzzleReward(p, r, best, !r.passed && !firstTryToday(p.id));
    setEarned(reward);
    recordPuzzle(p.id, r.score, r.passed, r.pillars);
    if (r.passed) pendingXp.current = reward.xp;
    else for (const [s, n] of Object.entries(reward.xp)) useCity.getState().addXp(s, n);
    if (!r.passed) return feel.bad();
    feel.win();
    setStep(0);
    setPhase('flow');
    // The reward: watch the request flow through the design here and in the city.
    bus.emit('showFlow', { serviceIds: p.flow });
  };

  const done = step >= steps.length;
  useEffect(() => {
    if (phase === 'flow' && done) payXp();
  }, [phase, done]);
  const play: FlowPlay | undefined =
    phase === 'flow'
      ? {
          active: done ? [] : steps[step],
          lit: new Set(steps.slice(0, step).flat()),
          animate: !manual,
          onDone: () => setStep((s) => s + 1),
        }
      : undefined;
  const current = !done && phase === 'flow' ? steps[step].map((i) => edges[i]) : [];
  /** The one-line takeaway once the flow has played: the simple why, else the first sentence of the full one. */
  const recap = p.simpleWhy ?? `${p.why.split(/(?<=\.)\s/)[0]}`;

  return (
    <>
      <h4 className="arch-label">Services · drag one onto a spot, or tap a card, then a spot</h4>
      <div className="tray" role="group" aria-label="Service cards">
        {deck
          .filter((s) => left[s] > 0)
          .map((s) => {
            const svc = serviceById(s);
            return (
              <button
                key={s}
                className={`svc card ${armed === s ? 'armed' : ''} ${hintShown && hintSlot?.service === s ? 'hinted' : ''}`}
                style={districtStyle(svc ? districtById(svc.districtId)?.color : undefined)}
                title={placeFor(s)?.blurb}
                aria-pressed={armed === s}
                {...cardProps(s)}
              >
                <AwsIcon serviceId={s} size={18} />
                {shortName(s)}
                {left[s] > 1 && <span className="count">×{left[s]}</span>}
              </button>
            );
          })}
      </div>
      <div className="arch-row">
        <h4 className="arch-label">
          Your design <span className="muted">· {filledReq}/{required.length} required</span>
        </h4>
        <button
          className="btn tiny"
          disabled={filledReq === required.length}
          onClick={() => {
            feel.tap();
            // First a free nudge (which spot, what job); asking again shows the card, for a few points.
            if (hintSlot && !placements[hintSlot.id] && !hintShown) {
              setHintShown(true);
              setRevealed((cur) => new Set(cur).add(hintSlot.id));
              setSay(`Hint: ${slotName(p, hintSlot.id, hintSlot.service)} goes in “${hintSlot.role}”.`);
              return;
            }
            const s = nextEmptyRequired(p, placements);
            setHint(s?.id);
            // A card you've already been shown stays shown.
            setHintShown(!!s && revealed.has(s.id));
            if (s) setSay(`Look at the glowing spot, “${s.role}”. Which service does that job?`);
          }}
        >
          {hintSlot && !placements[hintSlot.id] && !hintShown ? 'Show the card (−3 points)' : 'Need a hint?'}
        </button>
      </div>
      <p className="legend">
        <b>?</b> needed · <b>+</b> bonus · <b>1 2 3</b> data’s path (same number = same time)
      </p>
      {hintSlot && hintShown && (
        <div className="hint-say">
          <Portrait id={hintSlot.service} size={24} />
          <p className="say">
            <b>{placeFor(hintSlot.service)?.agentName.split(' the ')[0]}</b>
            I’m {slotName(p, hintSlot.id, hintSlot.service)}. Put me in “{hintSlot.role}”. {placeFor(hintSlot.service)?.blurb}
          </p>
        </div>
      )}
      <div className="diagram-scroll">
      <DiagramBoard
        puzzle={p}
        placements={placements}
        edges={edges}
        armed={armed}
        hinted={hint}
        rejected={rejected}
        dragOver={over}
        play={play}
        stepLabel={stepLabel}
        onSlot={onSlot}
        onRemove={onRemove}
        slotRef={(sid, el) => {
          if (el) slotEls.current.set(sid, el);
          else slotEls.current.delete(sid);
        }}
      />
      </div>
      {/* Sticky footer: the latest message (or the flow captions) and Check stay in view while you build. */}
      <div className="arch-foot">
        {phase === 'flow' ? (
          <div className="flow-bar" aria-live="polite">
            <span className="px">{done ? 'Flow complete' : `${step + 1}/${steps.length}`}</span>
            <span className="flow-cap">
              {done ? <Plain text={recap} /> : <Term text={[...new Set(current.map((e) => e.caption ?? e.label))].join(' ')} />}
            </span>
            <div className="flow-ctl">
              <button className="btn tiny" onClick={() => setStep(0)}>
                ↺ Replay
              </button>
              {!done && (
                <button
                  className="btn tiny"
                  onClick={() => {
                    setManual(true);
                    setStep((s) => s + 1);
                  }}
                >
                  Next ▸
                </button>
              )}
              {!done && (
                <button className="btn tiny" onClick={() => setStep(steps.length)}>
                  Skip
                </button>
              )}
              <button className="btn tiny" onClick={() => bus.emit('showFlow', { serviceIds: p.flow })}>
                Show in city
              </button>
            </div>
          </div>
        ) : (
          <div className="foot-row">
            <p className="diagram-say" aria-live="polite">
              {say}
            </p>
            <button className="btn primary" disabled={!Object.keys(placements).length} onClick={check}>
              ✓ Check design
            </button>
          </div>
        )}
      </div>
      {result && <ResultPanel puzzle={p} result={result} earned={earned} />}
      {ghost && (
        <div className="drag-ghost" style={{ transform: `translate(${ghost.x}px, ${ghost.y}px)` }} aria-hidden="true">
          <AwsIcon serviceId={ghost.svc} size={24} />
          {shortName(ghost.svc)}
        </div>
      )}
    </>
  );
}
