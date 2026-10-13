import { useRef } from 'react';
import { openAwsStatus } from '@/app/runtime';
import { bus } from '@/state/bus';
import { useCity } from '@/state/store';
import { ago, incidentWhere, lessonFor } from '@/world/incidents';
import { SERVICES, serviceById } from '@/world/taxonomy';
import { feel } from './feedback';
import { Plain } from './Term';
import { useDialog } from './useDialog';

type Go = (t: 'cards' | 'arch') => void;

const SEVERITY_LABEL = { informational: 'Notice', degradation: 'Degraded', disruption: 'Disrupted' } as const;
const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * One AWS Health Dashboard event, in AWS's own words: where, what's hit (the city's landmarks named), AWS's updates,
 * and what it teaches, with a flashcard deck and an architecture drill to practise on.
 */
export function IncidentCard({ openTab }: { openTab: Go }) {
  const id = useCity((s) => s.incidentOpen);
  const incident = useCity((s) => s.health?.incidents.find((i) => i.id === id));
  const stale = useCity((s) => s.health?.stale);
  const cityRegion = useCity((s) => s.cityRegion);
  const close = useCity((s) => s.openIncident);
  const box = useRef<HTMLElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  useDialog(!!incident, box, () => close(undefined), closeBtn);

  if (!incident) return null;
  const i = incident;
  const lesson = lessonFor(i, SERVICES.length);
  const landmarks = i.serviceIds.map((s) => serviceById(s)).filter((s) => !!s);
  const here = i.region === cityRegion;
  const others = i.serviceCount - Math.min(i.serviceCount, landmarks.length);

  const go = (fn: () => void) => () => {
    feel.tap();
    close(undefined);
    fn();
  };

  return (
    <div className="finding-scrim" role="presentation" onClick={(e) => e.target === e.currentTarget && close(undefined)}>
      <section ref={box} className={`finding-card incident-card ${i.status} ${i.severity}`} role="dialog" aria-modal="true" aria-labelledby="incident-title">
        <header className="finding-head">
          <span className="incident-icon" aria-hidden="true">
            {i.status === 'resolved' ? '✅' : i.severity === 'disruption' ? '⛈️' : i.severity === 'degradation' ? '🌧️' : 'ℹ️'}
          </span>
          <div className="finding-who">
            <b>{i.drill ? 'Practice drill (not a real AWS event)' : 'AWS Health Dashboard'}</b>
            <span className="muted">
              {incidentWhere(i)} · updated {ago(i.updated)}
            </span>
          </div>
          <button ref={closeBtn} className="btn icon ghost" aria-label="Close" onClick={() => close(undefined)}>
            ✕
          </button>
        </header>

        <h3 id="incident-title" className="finding-title">
          <span className={`sev-badge ${i.status === 'resolved' ? 'resolved' : i.severity}`}>{i.status === 'resolved' ? 'Recovered' : SEVERITY_LABEL[i.severity]}</span> {i.title}
        </h3>
        {stale && <p className="muted small">AWS’s status page couldn’t be read just now, so this is the last known status.</p>}

        <p className="incident-scope">
          {i.serviceCount > 1 ? `${i.serviceCount} services affected` : 'Affected'}
          {landmarks.length > 0 && ', including '}
          {landmarks.length > 0 && <Plain text={landmarks.map((s) => s.name).join(', ')} />}
          {others > 0 && landmarks.length > 0 ? ` and ${others} more` : ''}. Started {fmt(i.started)}.
        </p>
        {!!i.azIds?.length && (
          <p className="muted small">
            <Plain text={`${i.azIds.length > 1 ? 'Affected Availability Zone IDs' : 'Affected Availability Zone ID'}: ${i.azIds.join(', ')}. IDs are the same in every account; your console shows zone names, which can differ.`} />
          </p>
        )}

        <div className="incident-log" aria-label="AWS’s updates, newest first">
          {i.log.map((l, n) =>
            n === 0 ? (
              <article key={n} className="incident-update">
                <time dateTime={l.at}>{fmt(l.at)}</time>
                <p>{l.text}</p>
              </article>
            ) : null,
          )}
          {i.log.length > 1 && (
            <details>
              <summary>Earlier updates ({i.log.length - 1})</summary>
              {i.log.slice(1).map((l, n) => (
                <article key={n} className="incident-update">
                  <time dateTime={l.at}>{fmt(l.at)}</time>
                  <p>{l.text}</p>
                </article>
              ))}
            </details>
          )}
        </div>

        <aside className="incident-lesson" aria-label="What this teaches">
          <b>💡 {lesson.title}</b>
          <p>
            <Plain text={lesson.text} />
          </p>
          <div className="finding-actions">
            {lesson.puzzleId && (
              <button
                className="btn primary"
                onClick={go(() => {
                  useCity.getState().setFocusPuzzle(lesson.puzzleId);
                  openTab('arch');
                })}
              >
                Try the drill
              </button>
            )}
            <button
              className="btn"
              onClick={go(() => {
                useCity.getState().select(lesson.practise);
                openTab('cards');
              })}
            >
              Practise flashcards
            </button>
          </div>
        </aside>

        <footer className="finding-actions">
          {here && landmarks[0] ? (
            <button className="btn ghost" onClick={go(() => bus.emit('flyTo', { id: landmarks[0].id }))}>
              Show me in the city
            </button>
          ) : i.region !== 'global' ? (
            <button className="btn ghost" onClick={go(() => useCity.getState().enterRegion(i.region))}>
              Visit {i.regionName ?? i.region}’s city
            </button>
          ) : null}
          {!i.drill && (
            <button className="btn ghost" onClick={() => (feel.tap(), openAwsStatus())}>
              AWS Health Dashboard ↗
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
