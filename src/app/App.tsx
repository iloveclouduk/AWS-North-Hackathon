import { useEffect, useState } from 'react';
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

export function App({ layout }: { layout: Layout }) {
  const view = useCity((s) => s.view);
  const [tab, setTab] = useState<Tab>('feed');

  useEffect(() => bus.on('select', () => setTab((t) => (t === 'feed' || t === 'map' ? 'info' : t))), []);
  useEffect(() => useCity.subscribe((s, p) => Object.keys(s.deploys).length > Object.keys(p.deploys).length && setTab('deploy')), []);

  return (
    <div className={`app app-${layout}`}>
      <Hud layout={layout} />
      <div className="stage">
        <GameCanvas />
        <Toasts />
      </div>
      <aside className="side">
        {view.name === 'interior' ? (
          <ChatPanel districtId={view.districtId} />
        ) : (
          <>
            <nav className="tabs">
              {TABS.map(([t, icon, label]) => (
                <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} title={label}>
                  <span className="ti">{icon}</span>
                  <span className="tl">{label}</span>
                </button>
              ))}
            </nav>
            <div className="tab-body">
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
    </div>
  );
}
