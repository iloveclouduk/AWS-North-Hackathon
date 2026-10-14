import { useCity } from '@/state/store';
import { CITY_REGION, REGIONS } from '@/world/culture';
import { Portrait } from './Portrait';
import { openEverything } from './useLadder';

/**
 * A first run opens on the world map: Connie says one line and offers the suggested Region (it pulses on the map),
 * so a new player never has to understand Regions before they can play. Gone once any Region is picked.
 */
export function WorldIntro() {
  const onWorld = useCity((s) => s.view.name === 'world');
  const picked = useCity((s) => !!s.prefs.region);
  const enterRegion = useCity((s) => s.enterRegion);
  const setPref = useCity((s) => s.setPref);
  if (!onWorld || picked || !CITY_REGION) return null;
  return (
    <div className="world-intro" role="region" aria-label="Where to start">
      <Portrait id="concierge" size={32} />
      <p>
        <b>Connie:</b> Every glowing dot is a place AWS runs. Pick one to build your city there!
      </p>
      <button className="btn primary" onClick={() => enterRegion(REGIONS.cityRegion)}>
        Start in {CITY_REGION.city}
      </button>
      <button
        className="btn ghost tiny"
        title="Every area open from the start, and the deeper text shown first. Change it any time in ⋯."
        onClick={() => {
          setPref('builder', true);
          openEverything();
          enterRegion(REGIONS.cityRegion);
        }}
      >
        I already build on AWS
      </button>
    </div>
  );
}
