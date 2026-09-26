import { useEffect, useRef, useState, type ReactNode } from 'react';
import { canDeleteAccount, decideDeploy, deleteAccount, linkAccount, openUrl, planDeploy, signIn, signOut, teardownDeploy, verifyAccount } from '@/app/runtime';
import { useCity, type DeployView } from '@/state/store';
import { GUARDED_BLUEPRINTS } from '@/backend/ServerBackend';
import { TEMPLATES } from '@/world/content';
import { offlineReason } from './logic';
import { usePending } from './usePending';

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

/**
 * Real deploys to the player's own AWS account: link via a CloudFormation quick-create role (ExternalId),
 * preview a change set, approve it, tear it down. Curated templates only.
 */
export function DeployPanel() {
  const account = useCity((s) => s.account);
  const deployMap = useCity((s) => s.deploys);
  const deploys = Object.values(deployMap);
  const status = useCity((s) => s.backendStatus);
  const kind = useCity((s) => s.backendKind);
  const offline = offlineReason(kind, status);
  const [role, setRole] = useState('');
  const mode = useCity((s) => s.deployMode);
  const blueprints = mode === 'guarded' ? GUARDED_BLUEPRINTS : TEMPLATES;
  const pending = usePending();
  const { clear } = pending;

  // Clear each pending button when the event it was waiting for lands.
  useEffect(() => clear('link'), [account.linkUrl, clear]);
  useEffect(() => clear('verify'), [account.linked, account.message, clear]);
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
    if (verifyAccount(role)) pending.start('verify');
  };

  return (
    <div className="deploy">
      {status === 'signed-out' && (
        <div className="card">
          <b>Sign in to your AWS City account</b>
          <p className="muted">Your progress and deploys are tied to your login.</p>
          <button className="btn primary" onClick={signIn}>
            Sign in
          </button>
        </div>
      )}
      <div className="card">
        <h3>🔗 Your AWS account</h3>
        {account.linked ? (
          <p>
            ✅ Linked <b>{account.accountId}</b> ({account.region}). {account.message}
          </p>
        ) : (
          <>
            <p className="muted">
              Agents deploy <b>only</b> with a role you create in your own account. It trusts AWS City with a secret ExternalId, is limited to the
              quest services and region, and everything is tagged <code>aws-city</code>. You approve every change.
              {kind === 'mock' && ' (Demo mode: nothing real is created.)'}
            </p>
            {!account.linkUrl ? (
              <PendingButton
                className="btn primary"
                pending={pending.is('link')}
                busyLabel="Getting your link…"
                disabled={!!offline}
                title={offline}
                onClick={() => {
                  linkAccount();
                  pending.start('link');
                }}
              >
                1. Get my setup link
              </PendingButton>
            ) : (
              <>
                <button className="btn primary" onClick={() => openUrl(account.linkUrl!)}>
                  1. Open CloudFormation (creates the AWS City role)
                </button>
                <div className="muted">
                  ExternalId: <code>{account.externalId}</code>
                </div>
                <label className="field-hint" htmlFor="account-id">
                  2. Paste your 12-digit AWS account ID (or the role ARN)
                </label>
                <form
                  className="prompt-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (role.trim()) verify();
                  }}
                >
                  <input id="account-id" placeholder="123456789012" value={role} onChange={(e) => setRole(e.target.value)} autoComplete="off" spellCheck={false} />
                  <PendingButton pending={pending.is('verify')} busyLabel="Checking…" disabled={!role.trim() || !!offline} title={offline} onClick={verify}>
                    Verify
                  </PendingButton>
                </form>
                {kind === 'mock' && (
                  <PendingButton
                    className="btn tiny"
                    pending={pending.is('verify')}
                    busyLabel="Linking…"
                    title="Link a pretend account (demo mode only)"
                    onClick={() => verifyAccount('arn:aws:iam::123456789012:role/aws-city-player') && pending.start('verify')}
                  >
                    Demo account
                  </PendingButton>
                )}
              </>
            )}
          </>
        )}
      </div>

      <h4>Blueprints</h4>
      {mode === 'guarded' && <p className="muted">The agents build these with guarded tools (only game-owned resources, small limits). You approve every change below.</p>}
      {blueprints.map((t) => (
        <div key={t.id} className="tpl">
          <div>
            <b>{t.title}</b> <span className="muted">· {t.costNote}</span>
            <div className="muted">{t.summary}</div>
          </div>
          <PendingButton
            pending={pending.is(`plan:${t.id}`)}
            busyLabel={mode === 'guarded' ? 'Asking…' : 'Planning…'}
            disabled={!account.linked || !!offline}
            onClick={() => {
              planDeploy(t.id);
              pending.start(`plan:${t.id}`);
            }}
            title={offline ?? (account.linked ? 'See exactly what would be created' : 'Link your account first')}
          >
            {mode === 'guarded' ? 'Ask agent' : 'Preview'}
          </PendingButton>
        </div>
      ))}

      {deploys.length > 0 && <h4>Stacks</h4>}
      {deploys.map((d) => {
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
                          {c.action === 'Add' ? '＋' : c.action === 'Remove' ? '－' : '~'}
                        </td>
                        <td>{c.logicalId}</td>
                        <td className="muted">{c.resourceType}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
            {d.outputs && (
              <ul className="outputs">
                {Object.entries(d.outputs).map(([k, v]) => (
                  <li key={k}>
                    {k}:{' '}
                    {v.startsWith('http') ? (
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
      {canDeleteAccount() && status !== 'signed-out' && (
        <div className="card">
          <h3>🧾 Your data</h3>
          <p className="muted">Progress, your account link and sign-in are stored for you. Screenshots expire after a day.</p>
          <div className="row">
            <button className="btn" onClick={signOut}>
              Sign out
            </button>
            <button
              className="btn warn"
              onClick={() => {
                if (confirm('Delete your AWS City account and saved progress? This can’t be undone.')) void deleteAccount();
              }}
            >
              Delete my account
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
