import { openConsole, submitPrompt } from '@/app/runtime';
import { tierOf, useCity } from '@/state/store';
import { placeFor, SPECIAL_AGENTS, TIER_NAMES, TIER_XP } from '@/world/places';
import { districtById, hexColor, serviceById, servicesIn, type DistrictId } from '@/world/taxonomy';

export function LandmarkCard() {
  const id = useCity((s) => s.selected);
  const progress = useCity((s) => s.progress);
  const setView = useCity((s) => s.setView);

  if (!id) return <p className="empty">Click a building or an agent in the city to see what it teaches.</p>;

  if (id === 'plaza' || id === 'lookout') {
    const a = id === 'plaza' ? SPECIAL_AGENTS.concierge : SPECIAL_AGENTS.lookout;
    return (
      <div className="card">
        <h3>{id === 'plaza' ? '🏛️ Console Plaza' : '📷 Lookout Tower'}</h3>
        <p>
          <b>{a.name}</b> — {a.role}
        </p>
        <button className="btn" onClick={() => openConsole('plaza')}>
          Open AWS Console
        </button>
      </div>
    );
  }

  if (id.startsWith('hq:')) {
    const d = districtById(id.slice(3))!;
    return (
      <div className="card" style={{ borderColor: hexColor(d.color) }}>
        <h3>🏢 {d.hq}</h3>
        <p>
          The {d.name} team works here. Go inside to watch them sit at their computers while real AWS calls run — and ask them anything.
        </p>
        <button className="btn primary" onClick={() => setView({ name: 'interior', districtId: d.id as DistrictId })}>
          Enter HQ
        </button>
      </div>
    );
  }

  const svc = serviceById(id);
  const place = placeFor(id);
  if (!svc || !place) return null;
  const d = districtById(svc.districtId)!;
  const tier = tierOf(progress, id);
  const xp = progress.landmarks[id]?.xp ?? 0;
  const next = TIER_XP[Math.min(tier + 1, 4)];
  const prev = TIER_XP[Math.max(tier, 0)];
  const pct = tier >= 4 ? 100 : Math.round(((xp - prev) / Math.max(1, next - prev)) * 100);

  return (
    <div className="card" style={{ borderColor: hexColor(d.color) }}>
      <h3>
        {tier < 0 ? '❔ ' : ''}
        {place.place}
      </h3>
      <div className="muted">
        {svc.name} · {d.name}
      </div>
      <p className="blurb">{place.blurb}</p>
      {tier < 0 ? (
        <p>
          🔒 Undiscovered. Open <b>{svc.name}</b> in the AWS console to start building it.
        </p>
      ) : (
        <>
          <div className="tier">
            <b>{TIER_NAMES[tier]}</b> · {xp} XP
            <div className="bar">
              <i style={{ width: `${Math.max(4, pct)}%`, background: hexColor(d.color) }} />
            </div>
            {tier < 4 && <span className="muted">{next - xp} XP to {TIER_NAMES[tier + 1]}</span>}
          </div>
          <ol className="teaches">
            {place.teaches.map((t, i) => (
              <li key={t} className={i < Math.max(tier, 1) ? 'got' : ''}>
                <span className="lvl">{TIER_NAMES[i + 1]}</span> {t}
              </li>
            ))}
          </ol>
          <p className="muted">Agent: {place.agentName}</p>
        </>
      )}
      <div className="actions">
        {place.game === 'fishing' && tier >= 0 && (
          <button className="btn primary" onClick={() => setView({ name: 'fishing' })}>
            🎣 Go fishing
          </button>
        )}
        {tier >= 0 && (
          <button className="btn" onClick={() => submitPrompt(`Teach me about ${svc.name}: ${place.teaches[Math.min(Math.max(tier, 0), 3)]}`)}>
            💡 Learn next
          </button>
        )}
        <button className="btn" onClick={() => openConsole(id)}>
          Open console
        </button>
        {tier >= 0 && servicesIn(svc.districtId).length > 0 && (
          <button className="btn" onClick={() => setView({ name: 'interior', districtId: svc.districtId })}>
            🏢 {d.hq}
          </button>
        )}
      </div>
    </div>
  );
}
