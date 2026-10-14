import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { bus } from '@/state/bus';
import { useCity } from '@/state/store';
import type { Progress } from '@/backend/contract';
import { ambientStats, tweenCensus } from '@/game/Ambient';
import * as runtime from './runtime';
import { startRuntime, type Layout } from './runtime';
import './app.css';

export function mount(layout: Layout) {
  startRuntime(layout);
  // Handy in DevTools and used by the smoke tests: awsCity.simulateFocus('https://console.aws.amazon.com/s3/home').
  // Left out of Chrome Web Store builds.
  // releaseCare() shows held findings now; loadProgress(seed) replaces the player's progress (tests/fixtures/progress-all.json).
  // ambient.stats() counts the city's ambient life (vehicles, boats, packets, tweens, children) for the smoke's caps.
  if (import.meta.env.WXT_STORE_BUILD !== 'true')
    Object.assign(window, {
      awsCity: {
        ...runtime,
        useCity,
        bus,
        loadProgress: (p: Progress) => useCity.getState().loadProgress({ ...p, updatedAt: new Date().toISOString() }),
        ambient: { stats: ambientStats, tweens: tweenCensus },
      },
    });
  document.body.classList.add(`layout-${layout}`);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary what="AWS City">
        <App layout={layout} />
      </ErrorBoundary>
    </StrictMode>,
  );
}
