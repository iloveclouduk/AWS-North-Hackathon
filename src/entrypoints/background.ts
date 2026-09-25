import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { matchUrl } from '@/world/taxonomy';
import { FOCUS_STORAGE_KEY, type PageFocus, type RuntimeMessage } from '@/state/types';

export default defineBackground(() => {
  // Toolbar icon toggles the side panel.
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

  async function report(tabId: number) {
    const tab = await browser.tabs.get(tabId).catch(() => undefined);
    if (!tab?.url || !tab.active) return;
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
    if (tab?.id !== undefined) void report(tab.id);
  });
});
