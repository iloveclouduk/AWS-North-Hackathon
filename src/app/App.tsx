import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { bus } from '@/state/bus';
import { useCity } from '@/state/store';
import { ActivityFeed } from '@/ui/ActivityFeed';
import { ChatPanel } from '@/ui/ChatPanel';
import { Hud } from '@/ui/Hud';
import { LandmarkCard } from '@/ui/LandmarkCard';
import { Navigator } from '@/ui/Navigator';
import { PromptBar } from '@/ui/PromptBar';
import { Toasts } from '@/ui/Toasts';
import { ArchitectureBoard } from '@/ui/ArchitectureBoard';
import { DeployPanel } from '@/ui/DeployPanel';
import { Flashcards } from '@/ui/Flashcards';
import { QuestLog } from '@/ui/QuestLog';
import { Tour } from '@/ui/Tour';
import { isTourDone, nextTabIndex, readPref, TAB_KEY, writePref } from '@/ui/logic';
import { GameCanvas } from './GameCanvas';
import type { Layout } from './runtime';

type Tab = 'feed' | 'map' | 'info' | 'quests' | 'learn' | 'arch' | 'deploy';

const TABS: [Tab, string, string][] = [
  ['feed', '💬', 'Feed'],
  ['quests', '📜', 'Quests'],
  ['learn', '🃏', 'Cards'],
  ['arch', '🧩', 'Build'],
  ['deploy', '🚀', 'Deploy'],
  ['map', '🗺️', 'City'],
  ['info', '🏛️', 'Place'],
];

const savedTab = (): Tab => {
  const t = readPref(TAB_KEY);
  return TABS.some(([id]) => id === t) ? (t as Tab) : 'feed';
};

export function App({ layout }: { layout: Layout }) {
  const view = useCity((s) => s.view);
  const setTourOpen = useCity((s) => s.setTourOpen);
  const [tab, setTabState] = useState<Tab>(savedTab);
  const [deployBadge, setDeployBadge] = useState(false);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const tabNow = useRef(tab);
  tabNow.current = tab;

  const setTab = (t: Tab) => {
    setTabState(t);
    writePref(TAB_KEY, t);
    if (t === 'deploy') setDeployBadge(false);
  };

  useEffect(() => bus.on('select', () => setTab(tabNow.current === 'feed' || tabNow.current === 'map' ? 'info' : tabNow.current)), []);
  // A new deploy preview: jump there only from the Feed; otherwise flag the Deploy tab.
  useEffect(
    () =>
      useCity.subscribe((s, p) => {
        if (Object.keys(s.deploys).length <= Object.keys(p.deploys).length) return;
        if (tabNow.current === 'feed') setTab('deploy');
        else if (tabNow.current !== 'deploy') setDeployBadge(true);
      }),
    [],
  );
  // First run: show the coach-mark tour (not under automation, so scripted smoke runs aren't blocked).
  useEffect(() => {
    if (!isTourDone() && !navigator.webdriver) setTourOpen(true);
  }, [setTourOpen]);

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = nextTabIndex(e.key, i, TABS.length);
    if (next === undefined) return;
    e.preventDefault();
    const t = TABS[next][0];
    setTab(t);
    tabRefs.current[t]?.focus();
  };

  return (
    <div className={`app app-${layout}`}>
      <Hud layout={layout} />
      <div className="stage">
        <GameCanvas />
        <Toasts />
      </div>
      <aside className="side">
        {view.name === 'interior' && view.districtId !== 'spheres' ? (
          <ChatPanel districtId={view.districtId} />
        ) : (
          <>
            <nav className="tabs" role="tablist" aria-label="City panels">
              {TABS.map(([t, icon, label], i) => (
                <button
                  key={t}
                  ref={(el) => {
                    tabRefs.current[t] = el;
                  }}
                  id={`tab-${t}`}
                  role="tab"
                  aria-selected={tab === t}
                  aria-controls="city-tabpanel"
                  tabIndex={tab === t ? 0 : -1}
                  className={tab === t ? 'on' : ''}
                  onClick={() => setTab(t)}
                  onKeyDown={(e) => onTabKey(e, i)}
                  title={label}
                >
                  <span className="ti" aria-hidden="true">
                    {icon}
                  </span>
                  <span className="tl">{label}</span>
                  {t === 'deploy' && deployBadge && (
                    <>
                      <span className="badge" aria-hidden="true" />
                      <span className="sr-only">(new)</span>
                    </>
                  )}
                </button>
              ))}
            </nav>
            <div className="tab-body" role="tabpanel" id="city-tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={0}>
              {tab === 'feed' && <ActivityFeed />}
              {tab === 'quests' && <QuestLog openTab={setTab} />}
              {tab === 'learn' && <Flashcards />}
              {tab === 'arch' && <ArchitectureBoard />}
              {tab === 'deploy' && <DeployPanel />}
              {tab === 'map' && <Navigator />}
              {tab === 'info' && <LandmarkCard />}
            </div>
            <PromptBar layout={layout} />
          </>
        )}
      </aside>
      <Tour layout={layout} />
    </div>
  );
}
