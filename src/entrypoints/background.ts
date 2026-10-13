import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { installToolbar, SURFACE, type ToolbarApi } from '@/app/surface';
import { matchUrl } from '@/world/taxonomy';
import { FOCUS_STORAGE_KEY, type PageFocus, type RuntimeMessage } from '@/state/types';

export default defineBackground(() => {
  // Toolbar icon: side panel (Chrome/Edge), sidebar (Firefox) or the full city in a tab (Safari).
  installToolbar(browser as unknown as ToolbarApi, SURFACE);

  // A first install opens the city in a tab (every browser has tabs; not every one has a side panel). Updates don't.
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') void browser.tabs.create({ url: browser.runtime.getURL('/city.html') }).catch(() => {});
  });

  /** The window the player is in; a tab in any other window (a title change in a background one) never takes focus. */
  async function focusedWindowId() {
    const win = await browser.windows.getLastFocused().catch(() => undefined);
    return win?.id;
  }

  /** `windowId`: the window that just gained focus (already known, no need to ask). */
  async function report(tabId: number, windowId?: number) {
    const tab = await browser.tabs.get(tabId).catch(() => undefined);
    if (!tab?.url || !tab.active) return;
    const focused = windowId ?? (await focusedWindowId());
    if (focused !== undefined && tab.windowId !== focused) return;
    const m = matchUrl(tab.url);
    const focus: PageFocus = { url: tab.url, title: tab.title ?? '', kind: m.kind, serviceId: m.serviceId, tabId, windowId: tab.windowId };
    // session storage lets a freshly opened panel read the current page immediately.
    await browser.storage.session.set({ [FOCUS_STORAGE_KEY]: focus });
    const msg: RuntimeMessage = { type: 'page.focus', focus };
    // No listener (panel closed) rejects — that's fine.
    browser.runtime.sendMessage(msg).catch(() => {});
  }

  browser.tabs.onActivated.addListener(({ tabId }) => void report(tabId));
  browser.tabs.onUpdated.addListener((tabId, info) => {
    if (info.url || info.status === 'complete' || info.title) void report(tabId);
  });
  browser.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === browser.windows.WINDOW_ID_NONE) return;
    const [tab] = await browser.tabs.query({ active: true, windowId });
    if (tab?.id !== undefined) void report(tab.id, windowId);
  });
});
