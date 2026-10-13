import { describe, expect, it, vi } from 'vitest';
import { installToolbar, surfaceFor, type ToolbarApi } from '@/app/surface';
import { matchUrl } from '@/world/taxonomy';

const fakeApi = (over: Partial<ToolbarApi> = {}) => {
  let click: (() => void) | undefined;
  const api = {
    action: { onClicked: { addListener: (fn: () => void) => void (click = fn) } },
    tabs: { query: vi.fn(async () => []), update: vi.fn(async () => ({})), create: vi.fn(async () => ({})) },
    windows: { update: vi.fn(async () => ({})) },
    runtime: { getURL: (p: string) => `ext://id${p}` },
    ...over,
  } as ToolbarApi;
  return { api, click: () => click?.() };
};

describe('opening the city from the toolbar, per browser', () => {
  it('maps browsers to surfaces', () => {
    expect(['chrome', 'edge', 'firefox', 'safari'].map(surfaceFor)).toEqual(['sidepanel', 'sidepanel', 'sidebar', 'tab']);
  });

  it('Chrome: the side panel opens on click', () => {
    const setPanelBehavior = vi.fn(async () => undefined);
    installToolbar(fakeApi({ sidePanel: { setPanelBehavior } }).api, 'sidepanel');
    expect(setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
  });

  it('a browser without the side panel API does not throw (the rest of the background still runs)', () => {
    expect(() => installToolbar(fakeApi().api, 'sidepanel')).not.toThrow();
  });

  it('Firefox: the click toggles the sidebar', () => {
    const toggle = vi.fn();
    const { api, click } = fakeApi({ sidebarAction: { toggle } });
    installToolbar(api, 'sidebar');
    click();
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('Safari: the click opens the full city, or focuses it if already open', async () => {
    const { api, click } = fakeApi();
    installToolbar(api, 'tab');
    click();
    await vi.waitFor(() => expect(api.tabs.create).toHaveBeenCalledWith({ url: 'ext://id/city.html' }));
    vi.mocked(api.tabs.query).mockResolvedValueOnce([{ id: 7, windowId: 2 }] as never);
    click();
    await vi.waitFor(() => expect(api.tabs.update).toHaveBeenCalledWith(7, { active: true }));
    expect(api.windows!.update).toHaveBeenCalledWith(2, { focused: true });
  });

  it('extension and browser-internal pages of every browser are never mistaken for AWS', () => {
    for (const url of ['moz-extension://abc/city.html', 'about:addons', 'safari-web-extension://x/city.html', 'edge://settings']) expect(matchUrl(url).kind).toBe('extension');
  });
});
