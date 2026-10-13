// Day 1 Quarter readers (Place tab): Letters to Shareholders, Leadership Principles Walk, Golden Jacket Hall,
// re:Invent Expo Hall, Correction of Error board, About Amazon, and the Region campus card.
// All text comes from shared/ (culture.json, certifications.json, regions.json) with its source link.
import { useEffect, useMemo, useRef, useState } from 'react';
import { bus } from '@/state/bus';
import { agentName, useCity } from '@/state/store';
import {
  ABOUT_FACTS, CERTS, CULTURE, EXPO_QUEST, LAUNCHES, LETTERS, MECHANISMS, PRINCIPLES,
  certCode, certEarned, certsEarned, districtTier, hasGoldenJacket, levelTier,
} from '@/world/culture';
import { TIER_NAMES } from '@/world/places';
import { DISTRICTS, districtById } from '@/world/taxonomy';
import { AwsIcon } from './AwsIcon';
import { feel } from './feedback';
import { districtStyle } from './logic';
import { Portrait } from './Portrait';
import { RegionFactsCard } from './RegionFactsCard';
import { EmptyState } from './EmptyState';

const Src = ({ href, children = 'Source' }: { href: string; children?: React.ReactNode }) => (
  <a className="src" href={href} target="_blank" rel="noreferrer">
    {children} ↗
  </a>
);
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

/** Which reader a selected id opens, if it's a culture/ops site. */
export const isCultureId = (id: string) =>
  ['founder', 'day1office', 'goldenhall', 'expohall', 'coe', 'aboutamazon', 'fulfilment', 'regionsign'].includes(id) ||
  id.startsWith('lp:') ||
  id.startsWith('mech:') ||
  id.startsWith('dc:');

export function CultureCard({ id }: { id: string }) {
  if (id === 'founder' || id === 'day1office') return <LettersReader />;
  if (id === 'goldenhall') return <GoldenJacketHall />;
  if (id === 'expohall') return <ExpoHall />;
  if (id === 'coe') return <CoeBoard />;
  if (id === 'aboutamazon') return <AboutAmazon />;
  if (id.startsWith('lp:') || id.startsWith('mech:')) return <LeadershipWalk focus={id} />;
  return <CampusCard id={id} />;
}

// ── Letters to Shareholders ──────────────────────────────────────────────────────────────────────────────

export function LettersReader() {
  const [author, setAuthor] = useState<'all' | string>('all');
  const [open, setOpen] = useState<number | undefined>(LETTERS[LETTERS.length - 1]?.year);
  const authors = [...new Set(LETTERS.map((l) => l.author))];
  const list = LETTERS.filter((l) => author === 'all' || l.author === author);
  const oldestFirst = [...list].sort((a, b) => a.year - b.year);
  return (
    <div className="card culture letters" aria-label="Letters to Shareholders">
      <h3>📜 Letters to Shareholders</h3>
      <p className="muted">
        Amazon’s CEO has written to shareholders every year since 1997. Short summaries in our own words; each card links the original.
      </p>
      <div className="chips" role="group" aria-label="Author">
        {['all', ...authors].map((a) => (
          <button key={a} className={`chip ${author === a ? 'on' : ''}`} aria-pressed={author === a} onClick={() => setAuthor(a)}>
            {a === 'all' ? 'All years' : a}
          </button>
        ))}
      </div>
      <div className="year-strip" role="group" aria-label="Year">
        {oldestFirst.map((l) => (
          <button key={l.year} className={`yr ${open === l.year ? 'on' : ''}`} aria-pressed={open === l.year} onClick={() => setOpen(l.year)}>
            {String(l.year).slice(2)}
          </button>
        ))}
      </div>
      {oldestFirst.map((l) => (
        <LetterCard key={l.year} letter={l} open={open === l.year} onToggle={() => setOpen(open === l.year ? undefined : l.year)} />
      ))}
    </div>
  );
}

function LetterCard({ letter: l, open, onToggle }: { letter: (typeof LETTERS)[number]; open: boolean; onToggle: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (open) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [open]);
  return (
    <article ref={ref} className={`letter ${open ? 'open' : ''}`} data-year={l.year}>
      <button className="letter-head" aria-expanded={open} onClick={onToggle}>
        <span className="yr-big">{l.year}</span>
        <span>
          <b>{l.title}</b>
          <span className="muted"> · {l.author}</span>
        </span>
      </button>
      {open && (
        <div className="letter-body">
          <ul className="lessons">
            {l.lessons.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <p className="takeaway">
            <b>☁️ AWS takeaway:</b> {l.takeaway}
          </p>
          {l.quote && <blockquote>“{l.quote}”</blockquote>}
          <div className="links">
            <Src href={l.url}>Read the original ({host(l.url)})</Src>
            {l.source !== l.url && <Src href={l.source}>Checked at {host(l.source)}</Src>}
          </div>
        </div>
      )}
    </article>
  );
}

// ── Leadership Principles Walk ───────────────────────────────────────────────────────────────────────────

export function LeadershipWalk({ focus }: { focus?: string }) {
  const lp = CULTURE.leadershipPrinciples;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus) return;
    ref.current?.querySelector(`[data-id="${CSS.escape(focus)}"]`)?.scrollIntoView?.({ block: 'center' });
  }, [focus]);
  return (
    <div className="card culture walk" ref={ref}>
      <h3>🪧 Leadership Principles Walk</h3>
      <p className="muted">
        Amazon's {PRINCIPLES.length} Leadership Principles, one plaque each, in our own words with an AWS example. <Src href={lp.source}>amazon.jobs</Src>
      </p>
      <ol className="plaques">
        {PRINCIPLES.map((p) => (
          <li key={p.id} data-id={`lp:${p.id}`} className={focus === `lp:${p.id}` ? 'focus' : ''}>
            <b>{p.name}</b>
            <div>{p.explain}</div>
            <div className="muted">☁️ {p.awsExample}</div>
          </li>
        ))}
      </ol>
      <h4>⚙️ Mechanisms</h4>
      <p className="muted">“Good intentions don’t work, mechanisms do” — how Amazon turns the principles into habits.</p>
      {MECHANISMS.map((m) => (
        <section key={m.id} data-id={`mech:${m.id}`} className={`mech ${focus === `mech:${m.id}` ? 'focus' : ''}`}>
          <b>{m.name}</b>
          <div>{m.explain}</div>
          <ol className="steps">
            {m.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <div className="muted">
            ☁️ {m.awsExample} <Src href={m.source} />
          </div>
        </section>
      ))}
    </div>
  );
}

// ── Golden Jacket Hall ───────────────────────────────────────────────────────────────────────────────────

export function GoldenJacketHall() {
  const progress = useCity((s) => s.progress);
  const earned = certsEarned(progress);
  const total = CERTS.certifications.length;
  const gold = hasGoldenJacket(progress);
  const pct = total ? Math.round((earned.length / total) * 100) : 0;
  const goal = useCity((s) => s.prefs.certGoal);
  const setPref = useCity((s) => s.setPref);
  return (
    <div className="card culture hall">
      <h3>🏆 Golden Jacket Hall</h3>
      <p className="muted">
        AWS recognises people who hold every current AWS Certification with the Golden Jacket, presented at AWS events such as Summits. In the
        city, Kai already wears the team's gold jacket; each trophy lights up when its districts reach the matching tier. Light all {total} to match it.
      </p>
      <div className={`jacket ${gold ? 'gold' : ''}`}>
        <Portrait id="player" size={36} />
        <div>
          <b>{gold ? 'Every trophy lit ✨' : `${earned.length} / ${total} trophies`}</b>
          <div className="meter district" style={districtStyle(0xffc233)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Golden jacket progress">
            <i style={{ width: `${Math.max(4, pct)}%` }} />
          </div>
        </div>
      </div>
      <div className="dist-tiers">
        {DISTRICTS.map((d) => {
          const t = districtTier(progress, d.id);
          return (
            <span key={d.id} className="chip edge" style={districtStyle(d.color)} title={d.name}>
              {d.name.split(' ')[0]} {t < 0 ? '—' : TIER_NAMES[t]}
            </span>
          );
        })}
      </div>
      {CERTS.levels.map((lv) => {
        const certs = CERTS.certifications.filter((c) => c.level === lv.id);
        if (!certs.length) return null;
        return (
          <section key={lv.id} className="ladder">
            <h4>
              {lv.name} <span className="muted">· city tier {levelTier(lv.id)} ({TIER_NAMES[levelTier(lv.id)]})</span>
            </h4>
            <ul className="trophies">
              {certs.map((c) => {
                const on = certEarned(progress, c);
                return (
                  <li key={c.id} className={on ? 'on' : ''}>
                    <span aria-hidden="true">{on ? '🏆' : '🔒'}</span>
                    <span>
                      <a href={c.url} target="_blank" rel="noreferrer">
                        {c.name}
                      </a>
                      {certCode(c) && <span className="muted"> · {certCode(c)}</span>}
                      <div className="muted">
                        Needs {c.districts.map((d) => districtById(d)?.name).join(' + ')} at {TIER_NAMES[levelTier(c.level)]}
                      </div>
                      {!on && (
                        <button
                          className={`btn tiny ${goal === c.id ? 'primary' : 'ghost'}`}
                          aria-pressed={goal === c.id}
                          onClick={() => setPref('certGoal', goal === c.id ? undefined : c.id)}
                        >
                          {goal === c.id ? '🎯 My goal' : 'Make this my goal'}
                        </button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <p className="muted">
        List of current certifications as of {CERTS.asOf}. <Src href={CERTS.source}>aws.amazon.com/certification</Src>
      </p>
    </div>
  );
}

// ── re:Invent Expo Hall ──────────────────────────────────────────────────────────────────────────────────

export function ExpoHall() {
  const best = useCity((s) => s.culture.expoBest);
  const [qi, setQi] = useState<number | undefined>();
  const [score, setScore] = useState(0);
  const [picked, setPicked] = useState<number | undefined>();
  /** The score of the round just finished, shown until the next one starts. */
  const [last, setLast] = useState<number>();
  const byYear = useMemo(() => {
    const m = new Map<number, typeof LAUNCHES>();
    for (const l of LAUNCHES) m.set(l.year, [...(m.get(l.year) ?? []), l]);
    return [...m.entries()];
  }, []);
  const qs = EXPO_QUEST.questions;
  const q = qi !== undefined ? qs[qi] : undefined;
  const answer = (i: number) => {
    if (!q || picked !== undefined) return;
    setPicked(i);
    if (i === q.answer) {
      feel.good();
      setScore((s) => s + 1);
    } else feel.bad();
  };
  const next = () => {
    if (qi === undefined) return;
    const done = qi + 1 >= qs.length;
    if (done) {
      const final = score;
      useCity.getState().recordExpo(final);
      if (final >= Math.ceil(qs.length * 0.6)) {
        feel.win();
        useCity.getState().awardBadge(EXPO_QUEST.badge, 're:Invent Explorer');
      }
      setLast(final);
      setQi(undefined);
    } else setQi(qi + 1);
    setPicked(undefined);
  };
  return (
    <div className="card culture expo">
      <h3>🎤 re:Invent Expo Hall</h3>
      <p className="muted">
        Notable AWS launches by year — many announced on the re:Invent keynote stage in Las Vegas. <Src href={CULTURE.reinvent.source} />
      </p>
      <div className="quest-box">
        <b>🧭 {EXPO_QUEST.title}</b>
        {q ? (
          <div>
            <p>
              {qi! + 1}/{qs.length}: {q.q}
            </p>
            <div className="chips">
              {q.options.map((o, i) => (
                <button
                  key={o}
                  className={`chip ${picked === undefined ? '' : i === q.answer ? 'right' : i === picked ? 'wrong' : ''}`}
                  onClick={() => answer(i)}
                  disabled={picked !== undefined}
                >
                  {o}
                </button>
              ))}
            </div>
            {picked !== undefined && (
              <p>
                {picked === q.answer ? '✓ Right!' : `✗ It was ${q.options[q.answer]}.`}{' '}
                {q.launchIndex !== undefined && CULTURE.reinvent.launches[q.launchIndex] ? CULTURE.reinvent.launches[q.launchIndex].note : ''}{' '}
                <button className="btn tiny" onClick={next}>
                  {qi! + 1 >= qs.length ? 'Finish' : 'Next'}
                </button>
              </p>
            )}
          </div>
        ) : (
          <>
            {last !== undefined && (
              <div className={`expo-result ${last >= Math.ceil(qs.length * 0.6) ? 'won' : ''}`} role="status">
                <span className="big-emoji" aria-hidden="true">
                  {last >= Math.ceil(qs.length * 0.6) ? '🏅' : '🎟️'}
                </span>
                <div>
                  <b className="px">
                    {last}/{qs.length}
                  </b>
                  <div>{last >= Math.ceil(qs.length * 0.6) ? 'Badge earned: re:Invent Explorer' : 'So close! 60% earns the badge.'}</div>
                </div>
              </div>
            )}
            <p>
              {EXPO_QUEST.intro} {best !== undefined && <span className="muted">Best: {best}/{qs.length}. </span>}
              <button
                className="btn primary tiny"
                onClick={() => {
                  setScore(0);
                  setPicked(undefined);
                  setLast(undefined);
                  setQi(0);
                }}
              >
                {last !== undefined ? 'Play again' : 'Start'}
              </button>
            </p>
          </>
        )}
      </div>
      <ol className="timeline">
        {byYear.map(([year, ls]) => (
          <li key={year}>
            <span className="yr-big">{year}</span>
            <ul>
              {ls.map((l) => (
                <li key={l.service}>
                  {l.serviceId && <AwsIcon serviceId={l.serviceId} size={16} />} <b>{l.service}</b> <span className="muted">· {l.event}</span>
                  <div className="muted">
                    {l.note} <Src href={l.source} />
                  </div>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── Correction of Error board ────────────────────────────────────────────────────────────────────────────

export function CoeBoard() {
  const coe = useCity((s) => s.culture.coe);
  const mech = MECHANISMS.find((m) => m.id === 'correction-of-error');
  return (
    <div className="card culture coe">
      <h3>🧯 Correction of Error board</h3>
      <p className="muted">
        A blameless write-up of what went wrong and the mechanism that fixes it. Every task that really failed here is pinned up to practise on.
        {mech && (
          <>
            {' '}
            <Src href={mech.source} />
          </>
        )}
      </p>
      {coe.length > 0 && (
        <details className="why">
          <summary>How to write one</summary>
          <b>Five whys:</b> ask why it failed, then why that happened, until you reach a mechanism you can fix. <b>Action items:</b> one owner and one date per fix
          (a guardrail, an alarm, a runbook step).
        </details>
      )}
      {coe.length === 0 ? (
        <EmptyState title="Nothing to fix" emoji="🎉">No task has failed yet, so there's nothing to learn from here.</EmptyState>
      ) : (
        coe.map((c) => (
          <article key={c.id} className="coe-entry">
            <div className="muted">
              {new Date(c.at).toLocaleString()} · {c.agentId ? agentName(c.agentId) : 'unassigned'}
            </div>
            <dl>
              <dt>What happened</dt>
              <dd>
                “{c.prompt || c.taskId}” failed{c.failedStep ? ` at “${c.failedStep}”` : ''}.
              </dd>
              {c.result && (
                <>
                  <dt>Result</dt>
                  <dd>{c.result}</dd>
                </>
              )}
            </dl>
          </article>
        ))
      )}
    </div>
  );
}

// ── About Amazon ─────────────────────────────────────────────────────────────────────────────────────────

export function AboutAmazon() {
  return (
    <div className="card culture about">
      <h3>ℹ️ About Amazon</h3>
      <dl className="facts">
        {ABOUT_FACTS.map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>
              <b>{f.value}</b>{' '}
              <span className="muted">
                as of {f.asOf} · <Src href={f.source}>{host(f.source)}</Src>
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <h4>👷 Amazonians in town</h4>
      <ul className="roles">
        {CULTURE.amazonians.roles.map((r) => (
          <li key={r.id}>
            <b>{r.short}</b> — {r.title}
          </li>
        ))}
      </ul>
      <Src href={CULTURE.amazonians.source}>amazon.jobs</Src>
    </div>
  );
}

// ── Region campus / fulfilment ───────────────────────────────────────────────────────────────────────────

function CampusCard({ id }: { id: string }) {
  if (id !== 'fulfilment') return <RegionFactsCard />;
  return (
    <div className="card culture campus">
      <h3>📦 Amazon.com Fulfilment Centre</h3>
      <p>Amazon.com runs on AWS too: the delivery vans here shuttle between the Region and this fulfilment centre.</p>
      <div className="actions">
        <button className="btn" onClick={() => bus.emit('flyTo', { id: 'regionsign' })}>
          📍 Show the Region sign
        </button>
      </div>
    </div>
  );
}
