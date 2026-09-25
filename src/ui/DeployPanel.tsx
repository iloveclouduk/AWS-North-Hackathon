import { useState } from 'react';
import { decideDeploy, linkAccount, openUrl, planDeploy, signIn, teardownDeploy, verifyAccount } from '@/app/runtime';
import { useCity } from '@/state/store';
import { GUARDED_BLUEPRINTS } from '@/backend/ServerBackend';
import { TEMPLATES } from '@/world/content';

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
  const [role, setRole] = useState('');
  const mode = useCity((s) => s.deployMode);
  const blueprints = mode === 'guarded' ? GUARDED_BLUEPRINTS : TEMPLATES;

  return (
    <div className="deploy">
      {status === 'signed-out' && (
        <div className="card">
          <b>Sign in to your AWS City account</b>
          <p className="muted">Your progress and deploys are tied to your login (Amazon Cognito).</p>
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
              quest services and region, and everything is tagged <code>aws-city</code>. You approve every change set.
              {kind === 'mock' && ' (Mock mode: nothing real is created.)'}
            </p>
            {!account.linkUrl ? (
              <button className="btn primary" onClick={() => linkAccount()}>
                1. Get my setup link
              </button>
            ) : (
              <>
                <button className="btn primary" onClick={() => openUrl(account.linkUrl!)}>
                  1. Open CloudFormation (creates the AWS City role)
                </button>
                <div className="muted">ExternalId: <code>{account.externalId}</code></div>
                <div className="prompt-row">
                  <input placeholder="2. Paste the RoleArn output" value={role} onChange={(e) => setRole(e.target.value)} />
                  <button className="btn" onClick={() => verifyAccount(role)} disabled={!role}>
                    Verify
                  </button>
                </div>
                {kind === 'mock' && (
                  <button className="btn tiny" onClick={() => verifyAccount('arn:aws:iam::123456789012:role/aws-city-player')}>
                    use demo role
                  </button>
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
          <button className="btn" disabled={!account.linked} onClick={() => planDeploy(t.id)} title={account.linked ? 'Preview the change set' : 'Link your account first'}>
            {mode === 'guarded' ? 'Ask agent' : 'Preview'}
          </button>
        </div>
      ))}

      {deploys.length > 0 && <h4>Stacks</h4>}
      {deploys.map((d) => (
        <div key={d.deployId} className={`card stack ${d.status}`}>
          <b>{d.stackName}</b> <span className="muted">· {d.region} · {d.status}</span>
          {d.status === 'preview' && (
            <>
              <table className="changes">
                <tbody>
                  {d.changes.map((c) => (
                    <tr key={c.logicalId}>
                      <td className={`chg ${c.action}`}>{c.action === 'Add' ? '＋' : c.action === 'Remove' ? '－' : '~'}</td>
                      <td>{c.logicalId}</td>
                      <td className="muted">{c.resourceType}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {d.costNote && <div className="muted">💰 {d.costNote}</div>}
              <div className="actions">
                <button className="btn primary" onClick={() => decideDeploy(d.deployId, true)}>
                  ✅ Approve & deploy
                </button>
                <button className="btn" onClick={() => decideDeploy(d.deployId, false)}>
                  Reject
                </button>
              </div>
            </>
          )}
          {d.outputs && (
            <ul className="outputs">
              {Object.entries(d.outputs).map(([k, v]) => (
                <li key={k}>
                  {k}: {v.startsWith('http') ? <a href={v} target="_blank" rel="noreferrer">{v}</a> : <code>{v}</code>}
                </li>
              ))}
            </ul>
          )}
          {d.status === 'complete' && (
            <button className="btn warn" onClick={() => teardownDeploy(d.deployId)}>
              🧹 Tear down (delete stack)
            </button>
          )}
          {d.message && <div className="muted">{d.message}</div>}
        </div>
      ))}
    </div>
  );
}
