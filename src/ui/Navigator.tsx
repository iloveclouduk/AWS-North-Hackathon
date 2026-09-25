import { bus } from '@/state/bus';
import { tierOf, useCity } from '@/state/store';
import { placeFor, TIER_NAMES } from '@/world/places';
import { DISTRICTS, hexColor, servicesIn } from '@/world/taxonomy';

/** Hotel-navigator style list of every district and landmark. */
export function Navigator() {
  const progress = useCity((s) => s.progress);
  const select = useCity((s) => s.select);
  const go = (id: string) => {
    select(id);
    bus.emit('flyTo', { id });
  };
  return (
    <div className="nav">
      <button className="nav-row plaza" onClick={() => go('plaza')}>
        🏛️ Console Plaza <span className="muted">start here</span>
      </button>
      {DISTRICTS.map((d) => {
        const svcs = servicesIn(d.id);
        const open = svcs.some((s) => tierOf(progress, s.id) >= 0);
        return (
          <section key={d.id} className="nav-district" style={{ borderColor: hexColor(d.color) }}>
            <h4 style={{ color: hexColor(d.color) }}>
              {open ? '' : '🔒 '}
              {d.name}
            </h4>
            {svcs.map((s) => {
              const t = tierOf(progress, s.id);
              const p = placeFor(s.id)!;
              return (
                <button key={s.id} className={`nav-row ${t < 0 ? 'locked' : ''}`} onClick={() => (t >= 0 ? go(s.id) : select(s.id))}>
                  <span>{t < 0 ? '❔ ' + s.name : p.place}</span>
                  <span className="muted">{t < 0 ? 'undiscovered' : `${'★'.repeat(t)}${'☆'.repeat(4 - t)} ${TIER_NAMES[t]}`}</span>
                </button>
              );
            })}
            {open && (
              <button className="nav-row hq" onClick={() => go(`hq:${d.id}`)}>
                🏢 {d.hq}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
