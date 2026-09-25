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
import { GameCanvas } from './GameCanvas';
import type { Layout } from './runtime';

type Tab = 'feed' | 'map' | 'info';

export function App({ layout }: { layout: Layout }) {
  const view = useCity((s) => s.view);
  const [tab, setTab] = useState<Tab>('feed');

  useEffect(() => bus.on('select', () => setTab('info')), []);

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
              {(['feed', 'map', 'info'] as Tab[]).map((t) => (
                <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                  {t === 'feed' ? '💬 Activity' : t === 'map' ? '🗺️ City' : '🏛️ Landmark'}
                </button>
              ))}
            </nav>
            <div className="tab-body">
              {tab === 'feed' && <ActivityFeed />}
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
