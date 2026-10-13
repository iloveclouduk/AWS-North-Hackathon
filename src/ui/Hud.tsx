import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { canReconnect, canSignIn, openFullCity, reconnect, setAutoSnap, signIn, type Layout } from '@/app/runtime';
import { chime, isMuted, onMuteChange, setMuted } from '@/game/audio';
import { bus } from '@/state/bus';
import { isDiscovered, useCity } from '@/state/store';
import { districtById, SERVICES } from '@/world/taxonomy';
import { useBump } from './feedback';
import { connectionLabel, DEMO_KEY, isDemo, setDemo } from './logic';
import { Icon } from './icons';
import { openEverything, useLocked } from './useLadder';


/** Switches between the offline demo and signing in. The backend is picked once at startup, so the page reloads. */
function switchDemo(on: boolean) {
  setDemo(on);
  location.reload();
}

function ConnectionPill() {
  const status = useCity((s) => s.backendStatus);
  const kind = useCity((s) => s.backendKind);
  const signingIn = useCity((s) => s.signingIn);
  // Derived during render (React's "previous renders" pattern), so the label never lags a render behind.
  const [wasConnected, setWasConnected] = useState(false);
  if (status === 'connected' && !wasConnected) setWasConnected(true);
  const label = connectionLabel(kind, status, wasConnected);
  const cls = kind === 'mock' ? 'mock' : status;
  const where = kind === 'mock' ? 'an offline demo that creates nothing real' : 'the AWS City server';
  // The side panel and the full tab follow each other into (or out of) the demo, so neither keeps the other mode.
  useEffect(() => {
    const follow = (e: StorageEvent) => {
      if (e.key === DEMO_KEY) location.reload();
    };
    addEventListener('storage', follow);
    return () => removeEventListener('storage', follow);
  }, []);

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
        <button className="btn tiny primary" onClick={signIn} disabled={signingIn} aria-busy={signingIn}>
          {signingIn ? 'Signing in…' : 'Sign in'}
        </button>
      )}
      {kind !== 'mock' && status === 'signed-out' && canSignIn() && !signingIn && (
        <button className="btn tiny" onClick={() => switchDemo(true)} title="Play offline: nothing real is created, and nothing is saved to an account">
          Play the demo
        </button>
      )}
    </span>
  );
}

/** Everything that isn't needed every minute, in one flat list: sound, chatter, peek, tour, full city, the Lookout. */
function MoreMenu({ layout }: { layout: Layout }) {
  const [open, setOpen] = useState(false);
  // Follows the toggle on another surface too (the side panel and the full tab share it).
  const muted = useSyncExternalStore(onMuteChange, isMuted);
  const autoSnap = useCity((s) => s.autoSnap);
  const chatter = useCity((s) => s.prefs.chatter);
  const mapDetails = useCity((s) => !!s.prefs.mapDetails);
  // A postcard is of the city: not offered on the world map (the caption names the city).
  const inCity = useCity((s) => s.view.name !== 'world');
  const textSize = useCity((s) => s.prefs.textSize ?? 100);
  const contrast = useCity((s) => !!s.prefs.contrast);
  const easyFont = useCity((s) => !!s.prefs.easyFont);
  const relaxed = useCity((s) => !!s.prefs.relaxed);
  const captions = useCity((s) => !!s.prefs.captions);
  const builder = useCity((s) => !!s.prefs.builder);
  const setPref = useCity((s) => s.setPref);
  const setTourOpen = useCity((s) => s.setTourOpen);
  const inDemo = useCity((s) => s.backendKind) === 'mock' && isDemo();
  const locked = useLocked();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const run = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };
  return (
    <div className="more" ref={box}>
      <button className="btn icon ghost" aria-haspopup="menu" aria-expanded={open} aria-label="More" title="More" onClick={() => setOpen((o) => !o)}>
        <Icon name="more" />
      </button>
      {open && (
        <div className="menu" role="menu">
          <button
            role="menuitemcheckbox"
            aria-checked={!muted}
            onClick={() => {
              setMuted(!muted);
              if (muted) chime();
            }}
          >
            <span>Sound effects</span>
            <span className={`switch ${muted ? '' : 'on'}`} aria-hidden="true" />
          </button>
          <button role="menuitemcheckbox" aria-checked={chatter} onClick={() => setPref('chatter', !chatter)}>
            <span>Agents chat in the city</span>
            <span className={`switch ${chatter ? 'on' : ''}`} aria-hidden="true" />
          </button>
          <button role="menuitemcheckbox" aria-checked={mapDetails} onClick={() => setPref('mapDetails', !mapDetails)}>
            <span>Show the map details</span>
            <span className={`switch ${mapDetails ? 'on' : ''}`} aria-hidden="true" />
          </button>
          <hr />
          <div className="menu-label" role="presentation">
            Accessibility
          </div>
          <button
            role="menuitem"
            aria-label={`Text size: ${textSize}%. Choose to make it bigger.`}
            onClick={() => setPref('textSize', textSize === 100 ? 125 : textSize === 125 ? 150 : undefined)}
          >
            <span>Text size</span>
            <span className="menu-value">{textSize}%</span>
          </button>
          <button role="menuitemcheckbox" aria-checked={contrast} onClick={() => setPref('contrast', contrast ? undefined : true)}>
            <span>High contrast</span>
            <span className={`switch ${contrast ? 'on' : ''}`} aria-hidden="true" />
          </button>
          <button role="menuitemcheckbox" aria-checked={easyFont} onClick={() => setPref('easyFont', easyFont ? undefined : true)}>
            <span>Easy-read font</span>
            <span className={`switch ${easyFont ? 'on' : ''}`} aria-hidden="true" />
          </button>
          <button
            role="menuitemcheckbox"
            aria-checked={relaxed}
            title="Rounds end when you press Done, and everything moves slower"
            onClick={() => setPref('relaxed', relaxed ? undefined : true)}
          >
            <span>Games without a clock</span>
            <span className={`switch ${relaxed ? 'on' : ''}`} aria-hidden="true" />
          </button>
          <button role="menuitemcheckbox" aria-checked={captions} title="A short caption for each sound" onClick={() => setPref('captions', captions ? undefined : true)}>
            <span>Sound captions</span>
            <span className={`switch ${captions ? 'on' : ''}`} aria-hidden="true" />
          </button>
          <button
            role="menuitemcheckbox"
            aria-checked={builder}
            title="Every area open, and the deeper “For AWS learners” text shown first"
            onClick={() => {
              setPref('builder', builder ? undefined : true);
              if (!builder) openEverything();
            }}
          >
            <span>I already build on AWS</span>
            <span className={`switch ${builder ? 'on' : ''}`} aria-hidden="true" />
          </button>
          {locked.length > 0 && (
            <button role="menuitem" title="Open every tab and panel now, instead of one at a time as you play" onClick={run(openEverything)}>
              Peek at everything
            </button>
          )}
          <hr />
          {inCity && (
            <button role="menuitem" title="Download a picture of your city as it is now (nothing is uploaded)" onClick={run(() => bus.emit('postcard'))}>
              📸 Save a postcard of my city
            </button>
          )}
          <button role="menuitem" onClick={run(() => setTourOpen(true))}>
            Replay the tour
          </button>
          {layout === 'panel' && (
            <button role="menuitem" onClick={run(openFullCity)}>
              Open the full city in a tab ↗
            </button>
          )}
          {layout === 'panel' && (
            <button role="menuitemcheckbox" aria-checked={autoSnap} onClick={() => setAutoSnap(!autoSnap)}>
              <span>Lookout watches my AWS pages</span>
              <span className={`switch ${autoSnap ? 'on' : ''}`} aria-hidden="true" />
            </button>
          )}
          {inDemo && (
            <button role="menuitem" onClick={() => switchDemo(false)}>
              Sign in to save your city
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function Hud({ layout }: { layout: Layout }) {
  const progress = useCity((s) => s.progress);
  const view = useCity((s) => s.view);
  const setView = useCity((s) => s.setView);
  const hasCity = useCity((s) => !!s.prefs.region);

  const cityRegion = useCity((s) => s.cityRegion);
  // Buildings: this Region's city. Stars: everything you've earned, in every city.
  const discovered = SERVICES.filter((s) => isDiscovered(progress, s.id, cityRegion)).length;
  const xp = [progress.landmarks, ...Object.values(progress.cities ?? {}).map((c) => c.landmarks)].reduce((n, ls) => n + Object.values(ls).reduce((m, l) => m + l.xp, 0), 0);
  const xpBump = useBump(xp);
  const foundBump = useBump(discovered);

  return (
    <header className="hud">
      {/* No city yet on a first run's world map: nothing to go back to. */}
      {view.name !== 'city' && hasCity ? (
        <button className="btn ghost tiny back" onClick={() => setView({ name: 'city' })}>
          <Icon name="back" size={10} /> City
        </button>
      ) : (
        <span className="logo">
          <b>AWS City</b>
        </span>
      )}
      {view.name === 'interior' && <span className="where">{view.districtId === 'spheres' ? 'The Spheres' : districtById(view.districtId)?.hq}</span>}
      {view.name === 'game' && <span className="where">Mini-game</span>}
      <span className="progress-readout" title={`${xp} stars earned · ${discovered} of ${SERVICES.length} buildings in this city`}>
        <span className={xpBump ? 'bump' : undefined}>
          ⭐ <b>{xp}</b>
        </span>
        <span className="sep" aria-hidden="true">
          ·
        </span>
        <span className={foundBump ? 'bump' : undefined}>
          🏙️ <b>{discovered}</b>/{SERVICES.length}
        </span>
      </span>
      <ConnectionPill />
      <MoreMenu layout={layout} />
    </header>
  );
}
