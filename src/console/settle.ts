// Waiting for the console to finish reacting to a step before the next snapshot: the DOM goes quiet,
// SPA route changes (URL / main heading) have landed, and Cloudscape spinners are gone.
import { deepQuery, deepQueryAll } from './dom';

export const BUSY_SELECTOR = '[class*="awsui_spinner"], [aria-busy="true"]';

export interface SettleOptions {
  /** No DOM / route change for this long counts as settled. */
  quietMs?: number;
  /** Never wait longer than this, whatever the page does. */
  capMs?: number;
  /** jsdom has no layout: skip the size check for spinners. */
  requireLayout?: boolean;
}

export interface SettleResult {
  reason: 'quiet' | 'cap';
  ms: number;
}

function shown(el: Element, requireLayout: boolean): boolean {
  if ((el as HTMLElement).hidden || el.closest('[hidden], [aria-hidden=true], [data-awscity-overlay]')) return false;
  const st = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (st && (st.display === 'none' || st.visibility === 'hidden')) return false;
  if (!requireLayout) return true;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** A visible loading indicator (Cloudscape spinner or an aria-busy region) is on screen. */
export function isBusy(doc: Document, requireLayout = true): boolean {
  return deepQueryAll(doc, BUSY_SELECTOR).some((el) => shown(el, requireLayout));
}

const routeOf = (doc: Document) => `${doc.location?.href ?? ''}\n${deepQuery(doc, 'h1')?.textContent?.trim() ?? ''}`;

export function settle(doc: Document, opts: SettleOptions = {}): Promise<SettleResult> {
  const quietMs = opts.quietMs ?? 400;
  const capMs = opts.capMs ?? 8000;
  const requireLayout = opts.requireLayout ?? true;
  const start = Date.now();
  let last = start;
  let route = routeOf(doc);
  return new Promise((resolve) => {
    const obs = new MutationObserver(() => (last = Date.now()));
    obs.observe(doc.body ?? doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    const tick = setInterval(() => {
      const now = Date.now();
      const r = routeOf(doc);
      if (r !== route) {
        // pushState doesn't touch the DOM: a route change restarts the quiet period like a mutation
        route = r;
        last = now;
      }
      if (now - start >= capMs) return done('cap');
      if (now - last >= quietMs && !isBusy(doc, requireLayout)) done('quiet');
    }, Math.min(100, quietMs));
    function done(reason: SettleResult['reason']) {
      clearInterval(tick);
      obs.disconnect();
      resolve({ reason, ms: Date.now() - start });
    }
  });
}
