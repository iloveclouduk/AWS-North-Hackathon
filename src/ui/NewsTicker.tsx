import { useEffect, useState } from 'react';
import { openDocs } from '@/app/runtime';
import type { AwsIncident, AwsNewsItem } from '@/backend/contract';
import { useCity } from '@/state/store';
import { ago, incidentLine, severityRank } from '@/world/incidents';
import { feel } from './feedback';

type Item = { kind: 'incident'; incident: AwsIncident } | { kind: 'news'; item: AwsNewsItem };

const ROTATE_MS = 8000;
/** Resolved incidents and news this recent are worth a line. */
const RECENT_MS = 3 * 24 * 60 * 60_000;

/** An open incident elsewhere with no update this long is still listed, but after the fresh news. */
const LONG_RUNNING_MS = 7 * 24 * 60 * 60_000;

/**
 * What the ticker says, most important first: open incidents here (this city's Region, or global; worst first),
 * open ones elsewhere that AWS updated this week, recent recoveries, fresh launches, then long-running ones
 * elsewhere (a weeks-old outage in another Region shouldn't lead every city's ticker).
 */
export function tickerItems(incidents: AwsIncident[], news: AwsNewsItem[], now = Date.now(), region?: string): Item[] {
  const worstFirst = (a: AwsIncident, b: AwsIncident) => severityRank(b.severity) - severityRank(a.severity) || b.updated.localeCompare(a.updated);
  const open = incidents.filter((i) => i.status === 'open');
  const here = open.filter((i) => i.region === region || i.region === 'global').sort(worstFirst);
  const elsewhere = open.filter((i) => !here.includes(i));
  const active = elsewhere.filter((i) => now - Date.parse(i.updated) < LONG_RUNNING_MS).sort(worstFirst);
  const longRunning = elsewhere.filter((i) => !active.includes(i)).sort(worstFirst);
  const resolved = incidents.filter((i) => i.status === 'resolved' && now - Date.parse(i.updated) < RECENT_MS);
  // A quiet week (or the demo's captured feed): the newest few launches with their real age, never an empty line.
  const recent = news.filter((n) => now - Date.parse(n.date) < RECENT_MS);
  const fresh = (recent.length ? recent : [...news].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3)).slice(0, 5);
  const incident = (list: AwsIncident[]) => list.map((i) => ({ kind: 'incident' as const, incident: i }));
  return [...incident(here), ...incident(active), ...incident(resolved), ...fresh.map((item) => ({ kind: 'news' as const, item })), ...incident(longRunning)];
}

/**
 * One slim line over the city: AWS's own status (Health Dashboard) and launches (What's New). Tapping an incident
 * opens its card; tapping a launch opens the announcement on aws.amazon.com. It pauses while hovered or focused.
 */
export function NewsTicker() {
  const health = useCity((s) => s.health);
  const news = useCity((s) => s.news);
  const open = useCity((s) => s.openIncident);
  const [at, setAt] = useState(0);
  const [paused, setPaused] = useState(false);
  const region = useCity((s) => s.cityRegion);
  const items = tickerItems(health?.incidents ?? [], news?.items ?? [], Date.now(), region);
  const n = items.length;

  useEffect(() => {
    if (n < 2 || paused) return;
    const t = setInterval(() => !document.hidden && setAt((a) => a + 1), ROTATE_MS);
    return () => clearInterval(t);
  }, [n, paused]);

  if (!n) return null;
  const item = items[at % n];
  const tone = item.kind === 'news' ? 'news' : item.incident.status === 'resolved' ? 'resolved' : item.incident.severity;
  const icon = item.kind === 'news' ? '🚀' : item.incident.status === 'resolved' ? '✅' : item.incident.severity === 'disruption' ? '⛈️' : item.incident.severity === 'degradation' ? '🌧️' : 'ℹ️';
  const text = item.kind === 'news' ? item.item.title : incidentLine(item.incident);
  const when = item.kind === 'news' ? ago(item.item.date) : ago(item.incident.updated);

  return (
    <div className={`ticker ${tone}`} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      {/* The button's name is its visible text plus a few hidden words (WCAG 2.5.3: say what you see to press it). */}
      <button
        className="ticker-line"
        title={health?.stale && item.kind === 'incident' ? 'AWS’s status page couldn’t be read just now; this is the last known status.' : undefined}
        onClick={() => {
          feel.tap();
          if (item.kind === 'news') openDocs(item.item.url);
          else open(item.incident.id);
        }}
      >
        <span className="ticker-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="sr-only">{item.kind === 'news' ? 'AWS news:' : item.incident.drill ? 'Practice' : 'AWS Health:'}</span>{' '}
        {item.kind === 'incident' && item.incident.drill && <span className="ticker-tag">Drill</span>}{' '}
        <span className="ticker-text">{text}</span>{' '}
        <span className="ticker-when">{when}</span>
        <span className="sr-only">{item.kind === 'news' ? '. Opens on aws.amazon.com.' : '. Show details.'}</span>
      </button>
      {n > 1 && (
        <button className="ticker-next" onClick={() => setAt((a) => a + 1)}>
          <span className="sr-only">Next AWS update,</span> {(at % n) + 1}/{n}
        </button>
      )}
    </div>
  );
}
