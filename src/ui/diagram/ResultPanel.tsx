import type { CSSProperties } from 'react';
import type { PuzzleScore } from '@/learning/scoring';
import { PILLARS, type Puzzle } from '@/world/content';
import { serviceById } from '@/world/taxonomy';
import { placeFor } from '@/world/places';
import { passHint, type PuzzleReward } from '@/learning/puzzleRewards';
import { Plain } from '../Term';

const name = (id: string) => serviceById(id)?.name.replace(/^(Amazon|AWS) /, '') ?? id;

/** The score, the six Well-Architected pillar meters, tips and (on a pass) why the design works. */
export function ResultPanel({ puzzle, result, earned }: { puzzle: Puzzle; result: PuzzleScore; earned?: PuzzleReward }) {
  const hint = passHint(result, name);
  const grew = Object.entries(earned?.xp ?? {});
  const total = grew.reduce((n, [, x]) => n + x, 0);
  return (
    <div className={`result ${result.passed ? 'pass' : 'fail'}`} role="status">
      <div className="result-head">
        <span className="px">{result.passed ? 'Well-Architected!' : 'Not yet'}</span>
        <span className="score">{result.score}</span>
      </div>
      {/* The rule, said out loud: a 50 isn't a broken board, it's a design that's missing a piece. */}
      {hint && <div className="result-rule">{hint}</div>}
      {grew.length > 0 && (
        <div className="result-grew">
          +{total} ⭐ {earned?.kind === 'try' ? 'for the pieces already right' : earned?.kind === 'first' ? 'first pass!' : 'a better design'} ·{' '}
          {grew.map(([id, x]) => `${placeFor(id)?.place ?? name(id)} +${x}`).join(' · ')}
        </div>
      )}
      {result.missing.length > 0 && <div>Missing: {result.missing.map((s) => serviceById(s)?.name).join(', ')}</div>}
      {result.wrong.length > 0 && <div>Doesn’t fit: {result.wrong.map((s) => serviceById(s)?.name).join(', ')}</div>}
      <div className="pillars">
        {PILLARS.map((pl, i) => (
          <div key={pl.id} className="pillar" title={pl.summary} style={{ '--i': i } as CSSProperties}>
            <span>{pl.name}</span>
            <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={result.pillars[pl.id] ?? 0} aria-label={pl.name}>
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
      {result.passed && (
        // Simple words first; the full explanation is one tap away.
        <>
          <p>
            <Plain text={puzzle.simpleWhy ?? puzzle.why} />
          </p>
          {puzzle.simpleWhy && (
            <details className="tell-more">
              <summary>Tell me more</summary>
              <p className="tell-more-text">
                <Plain text={puzzle.why} />
              </p>
            </details>
          )}
        </>
      )}
    </div>
  );
}
