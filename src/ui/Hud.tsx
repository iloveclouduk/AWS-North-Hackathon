import { openFullCity, type Layout } from '@/app/runtime';
import { useCity } from '@/state/store';
import { SERVICES } from '@/world/taxonomy';
import { districtById } from '@/world/taxonomy';
import { SoundToggle } from './SoundToggle';

export function Hud({ layout }: { layout: Layout }) {
  const progress = useCity((s) => s.progress);
  const status = useCity((s) => s.backendStatus);
  const kind = useCity((s) => s.backendKind);
  const view = useCity((s) => s.view);
  const setView = useCity((s) => s.setView);

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
          🏙️ <b>AWS City</b>
        </span>
      )}
      {view.name === 'interior' && <span className="where">{districtById(view.districtId)?.hq}</span>}
      {view.name === 'game' && <span className="where">Mini-game</span>}
      <span className="stat" title="Landmarks discovered">
        🏛️ {discovered}/{SERVICES.length}
      </span>
      <span className="stat" title="Total XP">
        ⭐ {xp}
      </span>
      <span className={`dot ${status}`} title={`Backend: ${kind} · ${status}`}>
        {kind === 'mock' ? 'mock' : 'aws'}
      </span>
      <SoundToggle />
      {layout === 'panel' && (
        <button className="btn" onClick={openFullCity} title="Open the full city in a tab">
          ⤢
        </button>
      )}
    </header>
  );
}
