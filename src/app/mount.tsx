import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { bus } from '@/state/bus';
import { useCity } from '@/state/store';
import * as runtime from './runtime';
import { startRuntime, type Layout } from './runtime';
import './app.css';

export function mount(layout: Layout) {
  startRuntime(layout);
  // Handy in DevTools: awsCity.simulateFocus('https://console.aws.amazon.com/s3/home'), awsCity.useCity.getState()
  Object.assign(window, { awsCity: { ...runtime, useCity, bus } });
  document.body.classList.add(`layout-${layout}`);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App layout={layout} />
    </StrictMode>,
  );
}
