import { useEffect, useRef } from 'react';
import { canReconnect, canSignIn, openFullCity, reconnect, signIn, type Layout } from '@/app/runtime';
import { useCity } from '@/state/store';
import { districtById, SERVICES } from '@/world/taxonomy';
import { connectionLabel } from './logic';
import { SoundToggle } from './SoundToggle';

function ConnectionPill() {
  const status = useCity((s) => s.backendStatus);
  const kind = useCity((s) => s.backendKind);
  const wasConnected = useRef(false);
  useEffect(() => {
    if (status === 'connected') wasConnected.current = true;
  }, [status]);
  const label = connectionLabel(kind, status, wasConnected.current);
  const cls = kind === 'mock' ? 'mock' : status;
  const where = kind === 'mock' ? 'offline demo backend — nothing real is created' : kind === 'server' ? 'the AWS City server' : 'Bedrock AgentCore';

  return (
    <span className="conn">
      <span className={`dot ${cls}`} role="status" title={`Backend: ${where} · ${label}`}>
        {label}
      </span>
      {kind !== 'mock' && (status === 'disconnected' || status === 'error') && canReconnect() && (
        <button className="btn tiny" onClick={reconnect}>
          Retry
        </button>
      )}
      {kind !== 'mock' && status === 'signed-out' && canSignIn() && (
        <button className="btn tiny primary" onClick={signIn}>
          Sign in
        </button>
      )}
    </span>
  );
}

export function Hud({ layout }: { layout: Layout }) {
  const progress = useCity((s) => s.progress);
  const view = useCity((s) => s.view);
  const setView = useCity((s) => s.setView);
  const setTourOpen = useCity((s) => s.setTourOpen);

  const discovered = SERVICES.filter((s) => progress.landmarks[s.id]?.discovered).length;
  const xp = Object.values(progress.landmarks).reduce((n, l) => n + l.xp, 0);

  return (
    <header className="hud">
      {view.name !== 'city' ? (
        <button className="btn back" onClick={() => setView({ name: 'city' })}>
          ← City
        </button>
      ) : (
        <span className="logo">
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <b>AWS City</b>
        </span>
      )}
      {view.name === 'interior' && <span className="where">{view.districtId === 'spheres' ? 'The Spheres' : districtById(view.districtId)?.hq}</span>}
      {view.name === 'game' && <span className="where">Mini-game</span>}
      <span className="stat" title="Landmarks discovered">
        <span aria-hidden="true">🏛️</span> {discovered}/{SERVICES.length}
        <span className="sr-only"> landmarks</span>
      </span>
      <span className="stat" title="Total XP">
        <span aria-hidden="true">⭐</span> {xp}
        <span className="sr-only"> XP</span>
      </span>
      <ConnectionPill />
      <SoundToggle />
      <button className="btn icon" onClick={() => setTourOpen(true)} title="Show the tour again" aria-label="Show the tour again">
        ?
      </button>
      {layout === 'panel' && (
        <button className="btn icon" onClick={openFullCity} title="Open the full city in a tab" aria-label="Open the full city in a tab">
          ⤢
        </button>
      )}
    </header>
  );
}
