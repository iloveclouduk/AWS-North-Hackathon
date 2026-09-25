import { useMemo, useState } from 'react';
import { scorePuzzle, type PuzzleScore } from '@/learning/scoring';
import { bus } from '@/state/bus';
import { useCity } from '@/state/store';
import { PILLARS, PUZZLES } from '@/world/content';
import { placeFor, TIER_NAMES } from '@/world/places';
import { districtById, hexColor, serviceById } from '@/world/taxonomy';

/** Architecture builder: pick services to meet the requirements; scored on the 6 Well-Architected pillars. */
export function ArchitectureBoard() {
  const puzzles = useCity((s) => s.progress.puzzles);
  const recordPuzzle = useCity((s) => s.recordPuzzle);
  const [id, setId] = useState(PUZZLES[0]?.id);
  const p = PUZZLES.find((x) => x.id === id) ?? PUZZLES[0];
  const [placed, setPlaced] = useState<string[]>([]);
  const [result, setResult] = useState<PuzzleScore>();
  const palette = useMemo(() => (p ? [...new Set([...p.required, ...p.optional, ...p.distractors])].sort(() => (p.id.length % 2 ? 1 : -1)) : []), [p]);
  if (!p) return <p className="empty">No puzzles yet.</p>;

  const toggle = (s: string) => {
    setResult(undefined);
    setPlaced((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  };
  const check = () => {
    const r = scorePuzzle(p, placed);
    setResult(r);
    recordPuzzle(p.id, r.score, r.passed);
    if (r.passed) for (const s of p.required) useCity.getState().addXp(s, 5);
  };
  const chip = (s: string, on: boolean) => {
    const svc = serviceById(s);
    const color = svc ? hexColor(districtById(svc.districtId)!.color) : '#888';
    return (
      <button key={s} className={`svc ${on ? 'on' : ''}`} style={{ borderColor: color }} onClick={() => toggle(s)} title={placeFor(s)?.blurb}>
        {svc?.name.replace(/^(Amazon|AWS) /, '') ?? s}
      </button>
    );
  };

  return (
    <div className="arch">
      <select
        value={p.id}
        onChange={(e) => {
          setId(e.target.value);
          setPlaced([]);
          setResult(undefined);
        }}
        aria-label="Puzzle"
      >
        {PUZZLES.map((x) => (
          <option key={x.id} value={x.id}>
            {puzzles?.[x.id]?.best !== undefined ? `✓ ${puzzles[x.id].best} · ` : ''}
            {x.title} ({TIER_NAMES[x.tier]})
          </option>
        ))}
      </select>
      <p className="story">{p.story}</p>
      <ul className="reqs">
        {p.requirements.map((r) => (
          <li key={r}>☐ {r}</li>
        ))}
      </ul>
      <div className="muted">Services (tap to place on the board):</div>
      <div className="palette">{palette.filter((s) => !placed.includes(s)).map((s) => chip(s, false))}</div>
      <div className="board">
        {placed.length === 0 ? <span className="muted">Your architecture is empty — add services above.</span> : placed.map((s, i) => [i > 0 && <span key={`a${i}`}>→</span>, chip(s, true)])}
      </div>
      <div className="actions">
        <button className="btn primary" disabled={!placed.length} onClick={check}>
          ✔ Check design
        </button>
        <button className="btn" onClick={() => bus.emit('showFlow', { serviceIds: result?.passed ? p.flow : placed })} disabled={!placed.length}>
          👀 Show in city
        </button>
      </div>
      {result && (
        <div className={`result ${result.passed ? 'pass' : 'fail'}`}>
          <b>
            {result.passed ? '✅ Well architected!' : '❌ Not yet'} — {result.score}/100
          </b>
          {result.missing.length > 0 && <div>Missing: {result.missing.map((s) => serviceById(s)?.name).join(', ')}</div>}
          {result.wrong.length > 0 && <div>Doesn’t fit: {result.wrong.map((s) => serviceById(s)?.name).join(', ')}</div>}
          <div className="pillars">
            {PILLARS.map((pl) => (
              <div key={pl.id} className="pillar" title={pl.summary}>
                <span>{pl.name}</span>
                <div className="bar">
                  <i style={{ width: `${Math.max(4, result.pillars[pl.id] ?? 0)}%` }} />
                </div>
              </div>
            ))}
          </div>
          {result.tips.slice(0, 3).map((t) => (
            <div key={t.pillar} className="muted">
              💡 {t.tip}
            </div>
          ))}
          {result.passed && <p>{p.why}</p>}
        </div>
      )}
    </div>
  );
}
