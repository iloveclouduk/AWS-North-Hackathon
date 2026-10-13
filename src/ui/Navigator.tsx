import { bus } from '@/state/bus';
import { tierOf, useCity } from '@/state/store';
import { placeFor, TIER_NAMES } from '@/world/places';
import { DISTRICTS, servicesIn } from '@/world/taxonomy';
import { isPlaced } from '@/game/assets';
import { SITES } from '@/world/layout';
import { AwsIcon } from './AwsIcon';
import { Icon } from './icons';
import { Portrait } from './Portrait';
import { districtStyle } from './logic';
import { useLadder } from './useLadder';

/** Hotel-navigator style list of every district and landmark. */
export function Navigator({ onOpen }: { onOpen?: () => void }) {
  const progress = useCity((s) => s.progress);
  const cityRegion = useCity((s) => s.cityRegion);
  const select = useCity((s) => s.select);
  const openWorld = useCity((s) => s.openWorld);
  const go = (id: string) => {
    select(id);
    bus.emit('flyTo', { id });
    onOpen?.();
  };
  // Not built yet: open its Place card, which says how to discover it.
  const peek = (id: string) => {
    select(id);
    bus.emit('select', { id });
  };
  const sites = SITES.filter(isPlaced);
  // "Where AWS runs" opens at 3 landmarks; the Day 1 Quarter is open from the start (src/state/ladder.ts).
  const l = useLadder();
  return (
    <nav className="nav" aria-label="Places in the city">
      {/* One map of the world (WorldScene): Places only offers the way there. */}
      {l.worldList && (
        <button className="nav-row" onClick={openWorld}>
          <span>🌍 Visit another Region</span>
          <span className="muted">each one is its own city</span>
        </button>
      )}
      <button className="nav-row plaza" onClick={() => go('plaza')}>
        <span className="with-icon">
          <Portrait id="concierge" size={20} /> Console Plaza
        </span>
        <span className="muted">start here</span>
      </button>
      {l.day1 && sites.length > 0 && (
        <section className="nav-district edge day1">
          <div className="nav-head">
            <h4>Day 1 Quarter</h4>
            <span className="segs-count">Amazon culture</span>
          </div>
          {sites.filter((l) => l.site?.sign && !l.id.startsWith('dc:')).map((l) => (
            <button key={l.id} className="nav-row" onClick={() => go(l.id)}>
              <span>{l.site!.label}</span>
            </button>
          ))}
          <button className="nav-row" onClick={() => go(sites.find((l) => l.id.startsWith('lp:'))?.id ?? 'day1office')}>
            <span>Leadership Principles Walk</span>
          </button>
          <button className="nav-row" onClick={() => go('founder')}>
            <span>Find the founder</span>
            <span className="muted">Letters to Shareholders</span>
          </button>
        </section>
      )}
      {DISTRICTS.map((d) => {
        const svcs = servicesIn(d.id);
        const found = svcs.filter((s) => tierOf(progress, s.id, cityRegion) >= 0).length;
        const open = found > 0;
        return (
          <section key={d.id} className={`nav-district edge ${open ? '' : 'closed'}`} style={districtStyle(d.color)}>
            <div className="nav-head">
              <h4>
                {open ? null : (
                  <span className="lock">
                    <Icon name="lock" size={10} />
                  </span>
                )}
                {d.name}
              </h4>
              <span className="segs-count">
                {found}/{svcs.length}
              </span>
            </div>
            {svcs
              .filter((s) => tierOf(progress, s.id, cityRegion) >= 0)
              .map((s) => {
                const t = tierOf(progress, s.id, cityRegion);
                return (
                  <button key={s.id} className="nav-row" onClick={() => go(s.id)}>
                    <span className="with-icon">
                      <AwsIcon serviceId={s.id} size={20} />
                      <span className="nav-name">
                        {placeFor(s.id)!.place}
                        <small>{s.name.replace(/^(Amazon|AWS) /, '')}</small>
                      </span>
                    </span>
                    <span className="lv" title={TIER_NAMES[t]}>
                      Lv {t}
                    </span>
                  </button>
                );
              })}
            {/* What's left to find: one quiet line, not a wall of empty rows. */}
            {found < svcs.length && (
              <button className="nav-row todo" onClick={() => peek(svcs.find((s) => tierOf(progress, s.id, cityRegion) < 0)!.id)}>
                <span className="todo-icons" aria-hidden="true">
                  {svcs
                    .filter((s) => tierOf(progress, s.id, cityRegion) < 0)
                    .slice(0, 5)
                    .map((s) => (
                      <AwsIcon key={s.id} serviceId={s.id} size={16} className="dim" />
                    ))}
                </span>
                <span className="muted">
                  {svcs.length - found} {found ? 'more ' : ''}to discover
                </span>
              </button>
            )}
            {open && (
              <button className="nav-row hq" onClick={() => go(`hq:${d.id}`)}>
                Visit {d.hq} →
              </button>
            )}
          </section>
        );
      })}
    </nav>
  );
}
