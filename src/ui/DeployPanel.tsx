import { useEffect, useRef, useState, type ReactNode } from 'react';
import { canDeleteAccount, canSetUpMfa, confirmMfaSetup, decideDeploy, deleteAccount, isSafeAwsUrl, linkAccount, openUrl, planDeploy, signIn, signOut, startMfaSetup, teardownDeploy, verifyAccount } from '@/app/runtime';
import { useCity, type DeployView } from '@/state/store';
import { GUARDED_BLUEPRINTS } from '@/backend/ServerBackend';
import { TEMPLATES } from '@/world/content';
import { offered, perUnit, pricesFor } from '@/world/regions';
import { useCopy } from './feedback';
import { offlineReason } from './logic';
import { usePending } from './usePending';
import { ForLearners } from './Term';
import { Plain } from './Term';

const STATUS_TEXT: Record<DeployView['status'], string> = {
  preview: 'waiting for your OK',
  creating: 'building…',
  complete: 'live',
  failed: 'failed',
  rejected: 'rejected',
  deleting: 'tearing down…',
  deleted: 'deleted',
};

/** A button that shows a spinner + busy label while its request is in flight. */
function PendingButton({ pending, busyLabel, children, className = 'btn', disabled, onClick, title }: {
  pending: boolean;
  busyLabel: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button className={className} disabled={disabled || pending} aria-busy={pending} onClick={onClick} title={title}>
      {pending ? (
        <>
          <span className="spinner" aria-hidden="true" /> {busyLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** A numbered step: done (✓), current (lit) or still to come. */
function Step({ n, state, title, children }: { n: number; state: 'done' | 'now' | 'todo'; title: string; children?: ReactNode }) {
  return (
    <li className={`link-step ${state}`}>
      <span className="step-n" aria-hidden="true">
        {state === 'done' ? '✓' : n}
      </span>
      <div className="step-body">
        <b>{title}</b>
        {state === 'now' && children}
      </div>
    </li>
  );
}

/** Step-up MFA: an authenticator app protects the AWS account agents can change (server/src/accounts/mfa.ts). */
function MfaSetup() {
  const [setup, setSetup] = useState<{ secret: string; uri: string }>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, copy] = useCopy();
  const confirm = () => confirmMfaSetup(code);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card mfa">
      <b>🔐 Protect your account first</b>
      <p className="muted">Agents can change your AWS account, so linking it needs an authenticator app (Google Authenticator, 1Password, Authy…).</p>
      {!setup ? (
        <PendingButton className="btn primary" pending={busy} busyLabel="Starting…" onClick={() => void run(async () => setSetup(await startMfaSetup()))}>
          Set up an authenticator
        </PendingButton>
      ) : (
        <>
          <label className="field-hint" htmlFor="mfa-key">
            1. In your app, add an account with this key (time-based)
          </label>
          <input id="mfa-key" readOnly value={setup.secret.replace(/(.{4})/g, '$1 ').trim()} onFocus={(e) => e.currentTarget.select()} spellCheck={false} />
          <button className="btn" onClick={() => copy(setup.secret)}>
            {copied ? 'Copied ✓' : 'Copy key'}
          </button>
          <label className="field-hint" htmlFor="mfa-code">
            2. Type the 6-digit code it shows
          </label>
          <div className="row">
            <input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && void run(confirm)}
            />
            <PendingButton className="btn primary" pending={busy} busyLabel="Checking…" disabled={code.length !== 6} onClick={() => void run(confirm)}>
              Turn on
            </PendingButton>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Real deploys to the player's own AWS account: link via a CloudFormation quick-create role (ExternalId),
 * preview a change set, approve it, tear it down. Curated templates only.
 */
export function DeployPanel() {
  const account = useCity((s) => s.account);
  const cityRegion = useCity((s) => s.cityRegion);
  const deployMap = useCity((s) => s.deploys);
  const deploys = Object.values(deployMap);
  const status = useCity((s) => s.backendStatus);
  const kind = useCity((s) => s.backendKind);
  const offline = offlineReason(kind, status);
  const [role, setRole] = useState('');
  const findings = useCity((s) => s.findings);
  // Fixes are approved in their finding's card; here they're only a history, never next to Tear down.
  const stacks = deploys.filter((d) => !d.findingId);
  const fixes = deploys.filter((d) => d.findingId && d.status !== 'preview' && d.status !== 'rejected');
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** The linking steps stay folded until the player asks for them (this whole tab is optional). */
  const [wantsLink, setWantsLink] = useState(false);
  const mode = useCity((s) => s.deployMode);
  const blueprints = mode === 'guarded' ? GUARDED_BLUEPRINTS : TEMPLATES;
  const signingIn = useCity((s) => s.signingIn);
  const pending = usePending();
  const { clear } = pending;

  // Clear each pending button when the event it was waiting for lands.
  useEffect(() => clear('link'), [account.linkUrl, clear]);
  useEffect(() => clear('verify'), [account.seq, clear]);
  useEffect(() => {
    clear('link');
    clear('verify');
  }, [account.mfaRequired, clear]);
  const deployCount = deploys.length;
  // Only a new stack (count change) resolves a plan request.
  const pendingKeys = useRef(pending.keys);
  pendingKeys.current = pending.keys;
  useEffect(() => {
    for (const k of pendingKeys.current) if (k.startsWith('plan:')) clear(k);
  }, [deployCount, clear]);
  useEffect(() => {
    for (const d of Object.values(deployMap)) {
      if (d.status !== 'preview') clear(`decide:${d.deployId}`);
      if (d.status !== 'complete') clear(`teardown:${d.deployId}`);
    }
  }, [deployMap, clear]);

  const verify = () => {
    const requestId = verifyAccount(role);
    if (requestId) pending.start('verify', requestId);
  };

  /** The three linking steps (folded until the player asks; inside "How real accounts connect" in the demo). */
  const linkSteps =
    !wantsLink && !account.linkUrl && !account.mfaRequired ? (
      <button className="btn" onClick={() => setWantsLink(true)}>
        Connect an AWS account
      </button>
    ) : (
      <ol className="link-steps">
        <Step n={1} state={account.linkUrl ? 'done' : 'now'} title="Get your setup link">
          <PendingButton
            className="btn primary"
            pending={pending.is('link')}
            busyLabel="Getting your link…"
            disabled={!!offline}
            title={offline}
            onClick={() => {
              pending.start('link', linkAccount());
            }}
          >
            Get my setup link
          </PendingButton>
        </Step>
        <Step n={2} state={account.linkUrl ? 'now' : 'todo'} title="Make a safe key for AWS City in your account">
          <p className="muted">
            <Plain text="One click sets up an IAM role with CloudFormation. It's a key that only opens what the quests need." />
          </p>
          <button className="btn primary" onClick={() => openUrl(account.linkUrl!)}>
            Open CloudFormation ↗
          </button>
          <details className="why">
            <summary>Details</summary>
            <div className="muted">
              ExternalId (a secret only AWS City knows): <code>{account.externalId}</code>
            </div>
          </details>
        </Step>
        <Step n={3} state={account.linkUrl ? 'now' : 'todo'} title="Tell us your account number (12 digits)">
          <form
            className="prompt-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (role.trim()) verify();
            }}
          >
            <input
              id="account-id"
              aria-label="AWS account ID or role ARN"
              placeholder="123456789012"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <PendingButton pending={pending.is('verify')} busyLabel="Checking…" disabled={!role.trim() || !!offline} title={offline} onClick={verify}>
              Verify
            </PendingButton>
          </form>
        </Step>
      </ol>
    );

  // Where the player is in building for real: connect, pick a blueprint, approve it.
  const at = !account.linked ? 0 : stacks.some((d) => d.status === 'preview') ? 2 : stacks.length ? 3 : 1;
  return (
    <div className="deploy">
      <ol className="build-path" aria-label="Build for real, step by step">
        {['Connect', 'Pick a blueprint', 'Approve it'].map((label, i) => (
          <li key={label} className={i < at ? 'done' : i === at ? 'now' : ''} aria-current={i === at ? 'step' : undefined}>
            <span aria-hidden="true">{i < at ? '✓' : i + 1}</span> {label}
          </li>
        ))}
      </ol>
      {offline && <p className="composer-note">{offline}</p>}
      {status === 'signed-out' && (
        <div className="card">
          <b>Sign in to your AWS City account</b>
          <p className="muted">Your progress and deploys are tied to your login.</p>
          <PendingButton className="btn primary" pending={signingIn} busyLabel="Waiting for sign-in…" onClick={signIn}>
            Sign in
          </PendingButton>
        </div>
      )}
      <div className="card">
        <h3>Your AWS account</h3>
        {account.linked ? (
          <p className="linked">
            <span className="linked-badge">✓ Linked</span> <b>{account.accountId}</b> · {account.region}
            {account.message ? <span className="muted"> · {account.message}</span> : null}
          </p>
        ) : (
          <>
            {account.mfaRequired && canSetUpMfa() && <MfaSetup />}
            {account.message && (
              <p className="field-error" role="alert">
                ⚠️ {account.message}
              </p>
            )}
            {kind === 'mock' && !account.mfaRequired ? (
              <>
                <p className="muted">Practise deploying with a pretend account. Nothing real is created and nothing costs money.</p>
                <PendingButton
                  className="btn primary"
                  pending={pending.is('verify')}
                  busyLabel="Linking…"
                  title="Link a pretend account (the demo creates nothing real)"
                  onClick={() => {
                    const requestId = verifyAccount('arn:aws:iam::123456789012:role/aws-city-player');
                    if (requestId) pending.start('verify', requestId);
                  }}
                >
                  Use the practice account (nothing real)
                </PendingButton>
                {/* How a real account links (ExternalId, CloudFormation, MFA), for when they sign in for real. */}
                <details className="why">
                  <summary>How real accounts connect</summary>
                  <p>
                    You create one IAM role in your account with a CloudFormation quick-create link. It trusts AWS City only with a secret ExternalId, can use
                    only the quest services in one Region, and tags everything it makes <code>aws-city</code>. Hosted players turn on an authenticator app (MFA)
                    before linking. Delete the AWSCity stack to remove it at any time.
                  </p>
                  {linkSteps}
                </details>
              </>
            ) : (
              <>
                <p className="muted">
                  Optional. Everything else in AWS City works without this. Link an account when you want the agents to build real things in it. They only use a
                  role you create, and you approve every change.
                  {kind === 'mock' && ' (Demo: nothing real is created.)'}
                </p>
                <details className="why">
                  <summary>Why is this safe?</summary>
                  The role trusts AWS City only with a secret ExternalId. It can use only the quest services, in one Region, and everything it makes is tagged{' '}
                  <code>aws-city</code>. Delete the AWSCity stack to remove it at any time.
                </details>
                {linkSteps}
              </>
            )}
          </>
        )}
      </div>

      <h4>Blueprints</h4>
      {!account.linked && <p className="muted">🔒 Connect an account above (the practice one is fine) to build these.</p>}
      {account.linked && mode === 'guarded' && <p className="muted">Built with guarded tools: only game-owned resources, small limits, your approval.</p>}
      {blueprints.map((t) => (
        <div key={t.id} className="tpl">
          <div>
            <b>{t.title}</b> <span className="muted">· {t.costNote}</span>
            <div className="muted">{t.summary}</div>
            <BlueprintPrice serviceIds={t.serviceIds} region={account.region ?? cityRegion} />
          </div>
          <PendingButton
            pending={pending.is(`plan:${t.id}`)}
            busyLabel={mode === 'guarded' ? 'Asking…' : 'Planning…'}
            disabled={!account.linked || !!offline}
            onClick={() => {
              pending.start(`plan:${t.id}`, planDeploy(t.id));
            }}
            title={offline ?? (account.linked ? 'See exactly what would be created' : 'Link your account first')}
          >
            {mode === 'guarded' ? 'Ask agent' : 'Preview'}
          </PendingButton>
        </div>
      ))}

      {stacks.length > 0 && <h4>My builds</h4>}
      {stacks.map((d) => {
        const deciding = pending.is(`decide:${d.deployId}`);
        return (
          <div key={d.deployId} className={`card stack ${d.status}`}>
            <b>{d.stackName}</b>{' '}
            <span className="muted">
              · {d.region} · {STATUS_TEXT[d.status] ?? d.status}
            </span>
            {d.status === 'preview' && (
              <>
                <table className="changes">
                  <tbody>
                    {d.changes.map((c) => (
                      <tr key={c.logicalId}>
                        <td className={`chg ${c.action}`} aria-label={c.action}>
                          {c.action === 'Add' ? '+' : c.action === 'Remove' ? '−' : '~'}
                        </td>
                        <td>{c.logicalId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {/* The CloudFormation resource types, for whoever wants them. */}
                <ForLearners>
                  <table className="changes">
                    <tbody>
                      {d.changes.map((c) => (
                        <tr key={c.logicalId}>
                          <td>{c.logicalId}</td>
                          <td className="muted">{c.resourceType}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ForLearners>
                {d.costNote && <div className="muted">💰 {d.costNote}</div>}
                <div className="actions">
                  <PendingButton
                    className="btn primary"
                    pending={deciding}
                    busyLabel="Starting…"
                    disabled={!!offline}
                    title={offline}
                    onClick={() => {
                      decideDeploy(d.deployId, true);
                      pending.start(`decide:${d.deployId}`);
                    }}
                  >
                    ✅ Approve & deploy
                  </PendingButton>
                  <button
                    className="btn"
                    disabled={deciding || !!offline}
                    title={offline}
                    onClick={() => {
                      decideDeploy(d.deployId, false);
                      pending.start(`decide:${d.deployId}`);
                    }}
                  >
                    Reject
                  </button>
                </div>
              </>
            )}
            {(d.status === 'creating' || d.status === 'deleting') && <div className="busy-bar" aria-hidden="true" />}
            {d.outputs && (
              <ul className="outputs">
                {Object.entries(d.outputs).map(([k, v]) => (
                  <li key={k}>
                    {k}: {/* Outputs come from the stack: only AWS Console pages become links (the same check as openUrl). */}
                    {isSafeAwsUrl(v) ? (
                      <a href={v} target="_blank" rel="noreferrer">
                        {v}
                      </a>
                    ) : (
                      <code>{v}</code>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {d.status === 'complete' && (
              <PendingButton
                className="btn warn"
                pending={pending.is(`teardown:${d.deployId}`)}
                busyLabel="Tearing down…"
                disabled={!!offline}
                title={offline}
                onClick={() => {
                  teardownDeploy(d.deployId);
                  pending.start(`teardown:${d.deployId}`);
                }}
              >
                🧹 Tear down (delete stack)
              </PendingButton>
            )}
            {d.message && <div className="muted stack-msg">{d.message}</div>}
          </div>
        );
      })}
      {fixes.length > 0 && (
        <>
          <h4>Fixes I approved</h4>
          <ul className="fix-history">
            {fixes.map((d) => {
              const f = findings[d.findingId!];
              return (
                <li key={d.deployId}>
                  <b>{f?.fix?.title ?? d.templateId}</b>{' '}
                  <span className="muted">
                    · {d.stackName} · {d.status === 'complete' ? 'done' : (STATUS_TEXT[d.status] ?? d.status)}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {canDeleteAccount() && status !== 'signed-out' && (
        <div className="card">
          <h3>Your data</h3>
          <p className="muted">Progress, your account link and sign-in are stored for you. Screenshots expire after a day.</p>
          <div className="row">
            <button className="btn" onClick={signOut}>
              Sign out
            </button>
            {!confirmDelete && (
              <button className="btn warn" onClick={() => setConfirmDelete(true)}>
                Delete my account
              </button>
            )}
          </div>
          {confirmDelete && (
            <div className="confirm" role="alertdialog" aria-label="Delete your account?">
              <b>Delete your account and saved progress?</b>
              <span className="muted">This can’t be undone.</span>
              <div className="row">
                <button className="btn" autoFocus onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
                <button
                  className="btn warn"
                  onClick={() => {
                    setConfirmDelete(false);
                    void deleteAccount();
                  }}
                >
                  Yes, delete
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The list price of a blueprint's main service in the Region it deploys to (or that the service isn't offered there). */
function BlueprintPrice({ serviceIds, region }: { serviceIds: readonly string[]; region: string }) {
  const missing = serviceIds.filter((id) => !offered(id, region));
  if (missing.length)
    return (
      <div className="muted small">
        ⛔ Not offered in {region}: {missing.join(', ')}
      </div>
    );
  const p = serviceIds.flatMap((id) => pricesFor(id, region))[0];
  return p ? (
    <div className="muted small">
      💲 In {region}: {p.label}, {perUnit(p)} (list price)
    </div>
  ) : null;
}
