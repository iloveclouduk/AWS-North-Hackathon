import { useEffect, useRef, useState } from 'react';
import { decideDeploy, explainFinding, fixFinding, openDocs, wasExplained } from '@/app/runtime';
import { bus } from '@/state/bus';
import { CITIZEN_XP, citizenLevel, citizenXp, FIX_LEVEL, fixGate, LEVEL_XP, levelName } from '@/state/citizens';
import { isDiscovered, openFindings, severityRank, useCity, type DeployView, type FindingView } from '@/state/store';
import { citizenById, citizenRole, PILLAR_LABEL, type CitizenDef } from '@/world/citizens';
import { placeFor } from '@/world/places';
import { cardsFor, PUZZLES } from '@/world/content';
import { serviceById, SERVICES, type DistrictId } from '@/world/taxonomy';
import type { Progress } from '@/backend/contract';
import { feel } from './feedback';
import { offlineReason } from './logic';
import { Portrait } from './Portrait';
import { ForLearners, Plain } from './Term';
import { useDialog } from './useDialog';

/** Severity in the player's words: how soon to look, not a risk score. */
export const SEVERITY_TEXT: Record<FindingView['severity'], string> = { high: 'Urgent', medium: 'Soon', low: 'Later' };

function Severity({ s }: { s: FindingView['severity'] }) {
  return (
    <span className={`sev sev-${s}`} title={`${s} severity`}>
      {SEVERITY_TEXT[s]}
    </span>
  );
}

/** Cards a citizen learns from: the finding's own service if it's one of theirs, else one the player has found. */
function cardsToReview(p: Progress, c: CitizenDef, serviceId: string) {
  const mine = (id: string) => {
    const d = serviceById(id)?.districtId;
    return !!d && c.districts.includes(d as DistrictId) && cardsFor(id).length > 0;
  };
  if (mine(serviceId)) return serviceId;
  return SERVICES.find((s) => mine(s.id) && isDiscovered(p, s.id))?.id ?? SERVICES.find((s) => mine(s.id))?.id;
}

/** A puzzle that rewards the citizen's pillar, preferring one not passed yet. */
const puzzleFor = (p: Progress, c: CitizenDef) => {
  const fits = PUZZLES.filter((z) => z.pillarBonus?.[c.pillar]);
  return fits.find((z) => (p.puzzles?.[z.id]?.best ?? 0) < 70) ?? fits[0];
};

type Go = (t: 'cards' | 'arch') => void;

/** Below the level a fix needs: how far along the citizen is, and one-tap ways to teach them. */
function Teach({ f, c, need, openTab, close }: { f: FindingView; c: CitizenDef; need: number; openTab: Go; close: () => void }) {
  const progress = useCity((s) => s.progress);
  const xp = citizenXp(progress, c.id);
  const target = LEVEL_XP[need - 1];
  const svc = cardsToReview(progress, c, f.serviceId);
  const puzzle = puzzleFor(progress, c);
  const pct = Math.min(100, Math.round((xp / target) * 100));
  return (
    <div className="teach">
      <div className="teach-head">
        <b>Teach {c.name} first</b>
        <span className="muted">
          {xp}/{target} ⭐ to {levelName(need)}
        </span>
      </div>
      <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={xp} aria-label={`${c.name}: ${xp} of ${target} stars to ${levelName(need)}`}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="teach-actions">
        {svc && (
          <button
            className="btn tiny"
            onClick={() => {
              feel.tap();
              close();
              useCity.getState().select(svc);
              openTab('cards');
            }}
          >
            Review 5 {serviceById(svc)!.name.replace(/^(Amazon|AWS) /, '')} cards (+{5 * CITIZEN_XP.card} ⭐)
          </button>
        )}
        {puzzle && (
          <button
            className="btn tiny"
            onClick={() => {
              feel.tap();
              close();
              useCity.getState().setFocusPuzzle(puzzle.id);
              openTab('arch');
            }}
          >
            Try a {PILLAR_LABEL[c.pillar].toLowerCase()} puzzle (+{CITIZEN_XP.puzzle} ⭐)
          </button>
        )}
        {!wasExplained(f.id) && (
          <button
            className="btn tiny"
            onClick={() => {
              feel.send();
              explainFinding(f.id);
            }}
          >
            Ask {c.name} to explain (+{CITIZEN_XP.explain} ⭐)
          </button>
        )}
      </div>
    </div>
  );
}

/** The fix's preview, approved right here: what changes, what it costs, how to undo it, and a typed name when needed. */
function Approve({ d, offline, preview }: { d: DeployView; offline?: string; preview?: string }) {
  const [typed, setTyped] = useState('');
  const [sent, setSent] = useState(false);
  // An approval refused for MFA stays pending on the server: once the step-up card shows, let them press it again.
  const mfaRequired = useCity((s) => s.account.mfaRequired);
  useEffect(() => {
    if (mfaRequired) setSent(false);
  }, [mfaRequired]);
  const ok = !d.confirmText || typed === d.confirmText;
  const details = d.changes.filter((c) => c.resourceType === 'detail');
  const resources = d.changes.filter((c) => c.resourceType !== 'detail');
  return (
    <div className="finding-preview">
      <b>Check this change</b>
      {preview && (
        <p>
          <Plain text={preview} />
        </p>
      )}
      {/* 'detail' lines spell out the exact change in words (e.g. which security-group rule ids are removed). */}
      {details.length > 0 && (
        <ul className="preview-changes">
          {details.map((c) => (
            <li key={c.logicalId} className="muted">
              {c.logicalId}
            </li>
          ))}
        </ul>
      )}
      {/* The CloudFormation-style rows (AWS::… types) are for learners. */}
      {resources.length > 0 && (
        <ForLearners>
          <ul className="preview-changes">
            {resources.map((c) => (
              <li key={c.logicalId}>
                <span className={`chg ${c.action}`} aria-label={c.action}>
                  {c.action === 'Add' ? '+' : c.action === 'Remove' ? '−' : '~'}
                </span>{' '}
                <code>{c.logicalId}</code> <span className="muted">{c.resourceType}</span>
              </li>
            ))}
          </ul>
        </ForLearners>
      )}
      {d.costNote && <p className="muted">💰 {d.costNote}</p>}
      {d.rollback && <p className="muted">↩ {d.rollback}</p>}
      {d.confirmText && (
        <div className="confirm-type">
          <label className="field-hint" htmlFor={`confirm-${d.deployId}`}>
            The city didn’t build this, so type <code>{d.confirmText}</code> to approve
          </label>
          <input id={`confirm-${d.deployId}`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} placeholder={d.confirmText} />
        </div>
      )}
      <div className="finding-actions">
        <button
          className="btn"
          disabled={sent || !!offline}
          onClick={() => {
            feel.tap();
            setSent(true);
            decideDeploy(d.deployId, false);
          }}
        >
          Not now
        </button>
        <button
          className="btn primary"
          disabled={!ok || sent || !!offline}
          aria-busy={sent}
          title={offline ?? (ok ? 'Make this change now' : `Type ${d.confirmText} first`)}
          onClick={() => {
            feel.tap();
            setSent(true);
            decideDeploy(d.deployId, true, d.confirmText ? typed : undefined);
          }}
        >
          {sent ? (
            <>
              <span className="spinner" aria-hidden="true" /> Starting…
            </>
          ) : (
            'Approve the fix'
          )}
        </button>
      </div>
    </div>
  );
}

/** A finding, told by the citizen who found it: what's wrong, why it matters, and Explain / Fix / Learn. */
export function FindingCard({ openTab }: { openTab: Go }) {
  const id = useCity((s) => s.findingOpen);
  const f = useCity((s) => (id ? s.findings[id] : undefined));
  const progress = useCity((s) => s.progress);
  const care = useCity((s) => (id ? s.careRequests[id] : undefined));
  const answer = useCity((s) => (id ? s.explanations[id] : undefined));
  // The newest change for this finding (a preview to approve, one running, or one that failed).
  const deploy = useCity((s) => (id ? Object.values(s.deploys).findLast((d) => d.findingId === id) : undefined));
  const close = useCity((s) => s.openFinding);
  const offline = useCity((s) => offlineReason(s.backendKind, s.backendStatus));
  const closeBtn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLElement>(null);
  useDialog(!!f, box, () => close(undefined), closeBtn);

  useEffect(() => {
    if (f) bus.emit('showFinding', { findingId: f.id });
  }, [f?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!f) return null;
  const c = citizenById(f.citizenId);
  const name = c?.name ?? 'A citizen';
  const level = citizenLevel(progress, f.citizenId);
  const gate = fixGate(progress, f);
  const need = f.fix ? FIX_LEVEL[f.fix.scope] : 0;
  const place = placeFor(f.serviceId)?.place ?? serviceById(f.serviceId)?.name ?? f.serviceId;
  const svc = serviceById(f.serviceId);
  const preview = f.status === 'open' && deploy?.status === 'preview' ? deploy : undefined;
  const running = deploy?.status === 'creating';
  const failed = f.status === 'open' && deploy?.status === 'failed' ? deploy : undefined;
  const role = c && citizenRole(c);

  const learn = (how: 'cards' | 'chat' | 'docs') => {
    feel.tap();
    if (how === 'docs') return openDocs(f.url);
    close(undefined);
    if (how === 'chat' && svc) return useCity.getState().setView({ name: 'interior', districtId: svc.districtId as DistrictId });
    useCity.getState().select(f.serviceId);
    openTab('cards');
  };

  return (
    <div className="finding-scrim" role="presentation" onClick={(e) => e.target === e.currentTarget && close(undefined)}>
      <section ref={box} className={`finding-card ${f.status}`} role="dialog" aria-modal="true" aria-labelledby="finding-title">
        <header className="finding-head">
          <Portrait id={f.citizenId} size={40} />
          <div className="finding-who">
            <b>
              {name} · {c ? PILLAR_LABEL[c.pillar] : f.pillar}
            </b>
            <span className="muted">
              {levelName(level)}
              {role ? ` · ${role.title}` : ''}
            </span>
          </div>
          <button ref={closeBtn} className="btn ghost tiny" onClick={() => close(undefined)} aria-label="Close">
            ✕
          </button>
        </header>
        {c?.greeting && <p className="finding-greeting">“{c.greeting}”</p>}
        <div className="finding-title-row">
          <Severity s={f.severity} />
          <h3 id="finding-title">
            <Plain text={f.title} />
          </h3>
        </div>
        <p className="muted finding-where">
          <code>{f.resource.name}</code> at {place}
          {f.resource.gameOwned ? ' · built by the city' : ''}
        </p>
        {f.status === 'resolved' ? (
          <div className="finding-fixed" role="status">
            <b>✓ Fixed</b>
            {f.fix?.rollback && <p>{f.fix.rollback}</p>}
          </div>
        ) : (
          <>
            <p className="finding-text">
              <Plain text={f.text} />
            </p>
            {f.why && (
              <p className="finding-why">
                <b>Why it matters: </b>
                <Plain text={f.why} />
              </p>
            )}
          </>
        )}
        {answer && (
          <p className="say finding-answer">
            <b>{name}</b>
            {answer}
          </p>
        )}
        {preview ? (
          <Approve key={preview.deployId} d={preview} offline={offline} preview={f.fix?.preview} />
        ) : running ? (
          <div className="finding-preview" role="status">
            <b>Fixing…</b>
            <div className="busy-bar" aria-hidden="true" />
          </div>
        ) : (
          f.status === 'open' && (
            <>
              {f.fix && (
                <div className="finding-fix">
                  <b>
                    <Plain text={f.fix.title} />
                  </b>
                  <p>
                    <Plain text={f.fix.preview} />
                  </p>
                  {f.fix.costNote && <p className="muted">💰 {f.fix.costNote}</p>}
                </div>
              )}
              {failed?.message && (
                <p className="field-error" role="alert">
                  {failed.message}
                </p>
              )}
              {f.fix && !gate.ok && c && <Teach f={f} c={c} need={need} openTab={openTab} close={() => close(undefined)} />}
              <div className="finding-actions">
                <button
                  className="btn"
                  disabled={!!care || !!offline}
                  aria-busy={care?.kind === 'explain'}
                  title={offline}
                  onClick={() => {
                    feel.send();
                    explainFinding(f.id);
                  }}
                >
                  {care?.kind === 'explain' ? (
                    <>
                      <span className="spinner" aria-hidden="true" /> Asking…
                    </>
                  ) : (
                    'Explain'
                  )}
                </button>
                {f.fix && (
                  <button
                    className={`btn ${gate.ok ? 'primary' : 'locked'}`}
                    disabled={!gate.ok || !!care || !!offline}
                    aria-busy={care?.kind === 'fix'}
                    title={offline ?? (gate.ok ? 'See exactly what changes, then approve it' : gate.reason)}
                    onClick={() => {
                      feel.tap();
                      fixFinding(f.id);
                    }}
                  >
                    {care?.kind === 'fix' ? (
                      <>
                        <span className="spinner" aria-hidden="true" /> Preparing…
                      </>
                    ) : gate.ok ? (
                      'Fix…'
                    ) : (
                      `Fix (needs ${levelName(need)})`
                    )}
                  </button>
                )}
              </div>
            </>
          )
        )}
        <div className="finding-learn" role="group" aria-label="Learn about this">
          <span className="muted">Learn:</span>
          {cardsFor(f.serviceId).length > 0 && (
            <button className="btn ghost tiny" onClick={() => learn('cards')}>
              Flashcards
            </button>
          )}
          {svc && (
            <button className="btn ghost tiny" onClick={() => learn('chat')}>
              Ask in chat
            </button>
          )}
          <button className="chip-link" onClick={() => learn('docs')} title={f.url}>
            AWS docs ↗
          </button>
        </div>
      </section>
    </div>
  );
}

const CARE_SHOWN = 3;

/** Home: the open findings, most serious first (then newest), each with its citizen. */
export function CityCare() {
  const findings = useCity((s) => s.findings);
  const open = useCity((s) => s.openFinding);
  const [all, setAll] = useState(false);
  // The checks run in the home Region: say so when you're visiting another Region's city.
  const home = useCity((s) => s.inventory?.homeRegion ?? s.account.region);
  const here = useCity((s) => s.cityRegion);
  const list = openFindings(findings).sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.seenAt - a.seenAt);
  const fixed = Object.values(findings).filter((f) => f.status === 'resolved').length;
  if (!list.length && !fixed) return null;
  const shown = all ? list : list.slice(0, CARE_SHOWN);
  return (
    <section className="care" aria-label="City care">
      <h4 className="label">City care{home && home !== here ? <span className="muted"> · checked in {home}</span> : null}</h4>
      {!list.length && <p className="muted">All clear. {fixed === 1 ? 'One issue is' : `${fixed} issues are`} fixed.</p>}
      {shown.map((f) => (
        <button
          key={f.id}
          className="care-row"
          onClick={() => {
            feel.tap();
            open(f.id);
          }}
        >
          <Portrait id={f.citizenId} size={30} />
          <span className="care-text">
            <b>
              <Plain text={f.title} still />
            </b>
            <span className="muted">
              {citizenById(f.citizenId)?.name} · near {placeFor(f.serviceId)?.place ?? serviceById(f.serviceId)?.name ?? 'town'}
            </span>
          </span>
          <Severity s={f.severity} />
        </button>
      ))}
      {list.length > CARE_SHOWN && (
        <button className="btn ghost tiny care-more" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? 'Show fewer' : `+${list.length - CARE_SHOWN} more`}
        </button>
      )}
    </section>
  );
}
