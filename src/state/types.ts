import type { PageKind } from '@/world/taxonomy';

/** What the user is looking at in the browser, as reported by the background script. */
export interface PageFocus {
  url: string;
  title: string;
  kind: PageKind;
  serviceId?: string;
  tabId?: number;
  windowId?: number;
}

/** Messages between background ⇄ extension pages (chrome.runtime messaging). */
export type RuntimeMessage = { type: 'page.focus'; focus: PageFocus } | { type: 'focus.get' };

export const FOCUS_STORAGE_KEY = 'focus';
export const PROGRESS_STORAGE_KEY = 'progress';
export const SETTINGS_STORAGE_KEY = 'settings';
