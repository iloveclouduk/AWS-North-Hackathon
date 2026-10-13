import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { REGIONS } from '@/world/culture';
import { bus } from '@/state/bus';
import { openFindings, useCity } from '@/state/store';
import { ChatPanel } from '@/ui/ChatPanel';
import { Hud } from '@/ui/Hud';
import { Celebrate } from '@/ui/Celebrate';
import { CarrierCard } from '@/ui/CarrierCard';
import { ChoiceCard } from '@/ui/ChoiceCard';
import { IncidentCard } from '@/ui/IncidentCard';
import { NewsTicker } from '@/ui/NewsTicker';
import { LandmarkCard } from '@/ui/LandmarkCard';
import { Navigator } from '@/ui/Navigator';
import { PromptBar } from '@/ui/PromptBar';
import { Toasts } from '@/ui/Toasts';
import { ArchitectureBoard } from '@/ui/ArchitectureBoard';
import { DeployPanel } from '@/ui/DeployPanel';
import { Flashcards } from '@/ui/Flashcards';
import { badgeCount } from '@/state/srs';
import type { Tab } from '@/state/ladder';
import { QuestLog } from '@/ui/QuestLog';
import { Home } from '@/ui/Home';
import { Icon, type IconName } from '@/ui/icons';
import { CoachTips, Tour } from '@/ui/Tour';
import { WorldIntro } from '@/ui/WorldIntro';
import { addOpened, useLadder } from '@/ui/useLadder';
import { FindingCard } from '@/ui/FindingCard';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { SoundCaptions } from '@/ui/SoundCaptions';
import { citySummary, isTourDone, newlyUnlocked, nextTabIndex, readPref, readSet, TAB_KEY, UNLOCK_TOASTS_KEY, unlockText, writePref, writeSet } from '@/ui/logic';
import { GameCanvas } from './GameCanvas';
import type { Layout } from './runtime';

/** Older names (quest steps, saved prefs) still land in the right place. */
export type OpenTab = Tab | 'feed' | 'cards' | 'arch' | 'info';

const TABS: [Tab, IconName, string][] = [
  ['home', 'home', 'Home'],
  ['quests', 'quests', 'Quests'],
  ['learn', 'learn', 'Learn'],
  ['map', 'map', 'Places'],
  ['deploy', 'deploy', 'Build'],
];

const labelOf = (t: Tab) => TABS.find(([id]) => id === t)![2];

/** After the city has arrived, the first-run tour waits this long at most for the `arrived` moment. */
const TOUR_FALLBACK_MS = 900;

const savedTab = (): Tab => {
  const t = readPref(TAB_KEY);
  return TABS.some(([id]) => id === t) ? (t as Tab) : 'home';
};

export function App({ layout }: { layout: Layout }) {
  const view = useCity((s) => s.view);
  const setTourOpen = useCity((s) => s.setTourOpen);
  const stage = useCity((s) => s.prefs.stage);
  const setPref = useCity((s) => s.setPref);
  const cityRegion = useCity((s) => s.cityRegion);
  const regionCity = REGIONS.regions.find((r) => r.code === cityRegion)?.city ?? cityRegion;
  const openWorld = useCity((s) => s.openWorld);
  const textSize = useCity((s) => s.prefs.textSize);
  const contrast = useCity((s) => !!s.prefs.contrast);
  const easyFont = useCity((s) => !!s.prefs.easyFont);
  // Accessibility prefs (⋯ menu) live on <html>, so every stylesheet can follow them (styles/22-access.css).
  useEffect(() => {
    const d = document.documentElement.dataset;
    if (textSize) d.text = String(textSize);
    else delete d.text;
    if (contrast) d.contrast = 'high';
    else delete d.contrast;
    if (easyFont) d.font = 'easy';
    else delete d.font;
  }, [textSize, contrast, easyFont]);
  const [tab, setTabState] = useState<Tab>(savedTab);
  const [learn, setLearn] = useState<'cards' | 'build'>('cards');
  const [place, setPlace] = useState(false);
  const [deployBadge, setDeployBadge] = useState(false);
  const [homeBadge, setHomeBadge] = useState(false);
  const due = useCity((s) => badgeCount(s.progress));
  // The unlock ladder: which tabs (and panels) this player sees yet. Everything stays reachable: setTab opens it.
  const l = useLadder();
  const tabs = TABS.filter(([t]) => l.tabs.has(t));
  /** Tabs that just unlocked: a dot until they're opened. */
  const [fresh, setFresh] = useState<ReadonlySet<Tab>>(new Set());
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const body = useRef<HTMLDivElement>(null);
  const tabNow = useRef(tab);
  tabNow.current = tab;

  const setTab = (to: OpenTab) => {
    const t: Tab = to === 'feed' ? 'home' : to === 'cards' || to === 'arch' ? 'learn' : to === 'info' ? 'map' : to;
    if (to === 'cards' || to === 'learn') setLearn('cards');
    if (to === 'arch') setLearn('build');
    if (to === 'info') setPlace(true);
    // Opening a tab (a quest's Go →, a building tap, a deploy preview) keeps it open from now on.
    addOpened(t);
    if (to === 'arch') addOpened('learnBuild');
    const shown = readSet(UNLOCK_TOASTS_KEY);
    if (!shown.has(t)) writeSet(UNLOCK_TOASTS_KEY, [...shown, t]);
    setFresh((f) => (f.has(t) ? new Set([...f].filter((x) => x !== t)) : f));
    setTabState(t);
    writePref(TAB_KEY, t);
    if (t === 'deploy') setDeployBadge(false);
    if (t === 'home') setHomeBadge(false);
    // Every tab starts at its top, never half-scrolled.
    body.current?.scrollTo({ top: 0 });
  };

  useEffect(() => bus.on('select', () => setTab('info')), []);
  // A new deploy preview: jump there only from Home; otherwise flag the Build tab.
  useEffect(
    () =>
      useCity.subscribe((s, p) => {
        if (Object.keys(s.deploys).length <= Object.keys(p.deploys).length) return;
        // A fix's preview is approved in its finding's card, never in the Deploy tab.
        const added = Object.values(s.deploys).filter((d) => !p.deploys[d.deployId]);
        const fix = added.find((d) => d.findingId);
        if (fix) {
          if (s.findingOpen !== fix.findingId) s.openFinding(fix.findingId);
          if (added.every((d) => d.findingId)) return;
        }
        if (tabNow.current === 'home') setTab('deploy');
        else if (tabNow.current !== 'deploy') setDeployBadge(true);
      }),
    [],
  );
  // A prompt sent (or a reply to the player) while another tab is open: flag Home, where the answer shows.
  useEffect(
    () =>
      useCity.subscribe((s, p) => {
        if (tabNow.current === 'home' || s.feed === p.feed) return;
        const last = s.feed.at(-1);
        if (last && last !== p.feed.at(-1) && (last.kind === 'user' || (last.kind === 'message' && last.to === 'user'))) setHomeBadge(true);
      }),
    [],
  );
  // First run: the coach-mark tour, once the city has arrived (not on the world map, and not under automation, so
  // scripted smoke runs aren't blocked; they open it with awsCity.useCity.getState().setTourOpen(true)).
  useEffect(() => {
    if (view.name !== 'city' || isTourDone() || navigator.webdriver) return;
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    const open = () => {
      clearTimeout(timer);
      off();
      if (!isTourDone() && useCity.getState().view.name === 'city') setTourOpen(true);
    };
    const off = bus.on('arrived', open);
    timer = setTimeout(open, TOUR_FALLBACK_MS);
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [view.name, setTourOpen]);

  // A tab that newly appears: one toast (once per browser) and a dot until it's opened.
  const prevTabs = useRef<ReadonlySet<Tab> | undefined>(undefined);
  useEffect(() => {
    const prev = prevTabs.current;
    prevTabs.current = l.tabs;
    const shown = readSet(UNLOCK_TOASTS_KEY);
    if (!prev) {
      // What's open when the app starts was earned before: no toast for it.
      if ([...l.tabs].some((t) => !shown.has(t))) writeSet(UNLOCK_TOASTS_KEY, [...shown, ...l.tabs]);
      return;
    }
    const added = newlyUnlocked(prev, l.tabs, shown);
    if (!added.length) return;
    writeSet(UNLOCK_TOASTS_KEY, [...shown, ...added]);
    setFresh((f) => new Set([...f, ...added]));
    useCity.getState().toast('🔓', unlockText(added.map(labelOf)));
  }, [l.tabs]);

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = nextTabIndex(e.key, i, tabs.length);
    if (next === undefined) return;
    e.preventDefault();
    const t = tabs[next][0];
    setTab(t);
    tabRefs.current[t]?.focus();
  };

  const badge = (t: Tab) => (t === 'deploy' && deployBadge) || (t === 'home' && homeBadge) || fresh.has(t);
  // A saved tab that isn't open (another player's, or before the ladder) shows Home.
  const shownTab: Tab = l.tabs.has(tab) ? tab : 'home';
  return (
    <div className={`app app-${layout} stage-${stage}`}>
      <Hud layout={layout} />
      <div className="stage">
        <GameCanvas />
        {l.news && (view.name === 'city' || view.name === 'world') && <NewsTicker />}
        <Toasts />
        <CityAnnouncer />
        <SoundCaptions />
        <CarrierCard />
        <WorldIntro />
        {view.name === 'city' && (
          <button className="world-btn" onClick={() => openWorld()} title={`You're in ${regionCity} (${cityRegion}). Zoom out to the world map to visit another Region.`} aria-label={`World map. You're in ${regionCity}.`}>
            🌍 <span>{regionCity}</span>
          </button>
        )}

        {layout === 'panel' && (
          <button
            className="stage-size"
            onClick={() => setPref('stage', stage === 'tall' ? 'compact' : 'tall')}
            title={stage === 'tall' ? 'Make the city smaller' : 'Make the city bigger'}
            aria-label={stage === 'tall' ? 'Make the city smaller' : 'Make the city bigger'}
          >
            <Icon name={stage === 'tall' ? 'chevronUp' : 'chevronDown'} />
          </button>
        )}
      </div>
      <aside className="side">
        {view.name === 'interior' && view.districtId !== 'spheres' ? (
          <ChatPanel districtId={view.districtId} />
        ) : (
          <>
            <div className="tabs" role="tablist" aria-label="City panels">
              {tabs.map(([t, icon, label], i) => (
                <button
                  key={t}
                  ref={(el) => {
                    tabRefs.current[t] = el;
                  }}
                  id={`tab-${t}`}
                  role="tab"
                  aria-selected={shownTab === t}
                  aria-controls="city-tabpanel"
                  tabIndex={shownTab === t ? 0 : -1}
                  className={shownTab === t ? 'on' : ''}
                  onClick={() => setTab(t)}
                  onKeyDown={(e) => onTabKey(e, i)}
                  title={label}
                >
                  <Icon name={icon} />
                  <span className="tl">{label}</span>
                  {badge(t) && (
                    <>
                      <span className="badge" aria-hidden="true" />
                      <span className="sr-only">(new)</span>
                    </>
                  )}
                  {t === 'learn' && due > 0 && (
                    <span className="badge-count" aria-label={`${due} cards due`}>
                      {due > 99 ? '99+' : due}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div ref={body} className="tab-body" role="tabpanel" id="city-tabpanel" aria-labelledby={`tab-${shownTab}`} tabIndex={0}>
              <ErrorBoundary what="This tab" resetKey={shownTab}>
              {shownTab === 'home' && <Home openTab={setTab} />}
              {shownTab === 'quests' && <QuestLog openTab={setTab} />}
              {shownTab === 'learn' && (
                <>
                  {/* Architecture joins Flashcards once a puzzle step comes up (or the player opens it anyway). */}
                  {l.learnBuild && (
                    <div className="seg" role="group" aria-label="Learn">
                      <button data-sub="cards" aria-pressed={learn === 'cards'} onClick={() => setLearn('cards')}>
                        Flashcards {due > 0 && <span className="seg-count">{due > 99 ? '99+' : due}</span>}
                      </button>
                      <button data-sub="build" aria-pressed={learn === 'build'} onClick={() => setLearn('build')}>
                        Architecture
                      </button>
                    </div>
                  )}
                  {learn === 'build' && l.learnBuild ? <ArchitectureBoard /> : <Flashcards />}
                </>
              )}
              {shownTab === 'deploy' && <DeployPanel />}
              {shownTab === 'map' &&
                (place ? (
                  <>
                    <button className="btn ghost tiny back-link" onClick={() => setPlace(false)}>
                      <Icon name="back" size={10} /> All places
                    </button>
                    <LandmarkCard openTab={setTab} layout={layout} />
                  </>
                ) : (
                  <Navigator onOpen={() => setPlace(true)} />
                ))}
              </ErrorBoundary>
            </div>
            <PromptBar layout={layout} />
            <ErrorBoundary what="This card">
              <FindingCard openTab={setTab} />
            </ErrorBoundary>
          </>
        )}
      </aside>
      <ErrorBoundary what="This card">
        <IncidentCard openTab={setTab} />
        <ChoiceCard />
        <Celebrate />
      </ErrorBoundary>
      <Tour layout={layout} />
      <CoachTips layout={layout} />
    </div>
  );
}

/** Screen readers hear what the keyboard just did in the city (] / [ through the buildings): one polite line. */
function CityAnnouncer() {
  const [text, setText] = useState('');
  useEffect(() => bus.on('announce', ({ text }) => setText(text)), []);
  // Arriving in a city: one line that says what's there (the canvas itself has no text).
  useEffect(
    () =>
      bus.on('arrived', () => {
        const st = useCity.getState();
        setText(
          citySummary({
            cityRegion: st.cityRegion,
            regionName: REGIONS.regions.find((r) => r.code === st.cityRegion)?.name,
            progress: st.progress,
            openIssues: openFindings(st.findings).length,
            outage: !!st.health?.incidents.some((i) => i.region === st.cityRegion && i.status === 'open' && i.severity !== 'informational'),
            flowOn: st.flowOn,
          }),
        );
      }),
    [],
  );
  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true">
      {text}
    </div>
  );
}
