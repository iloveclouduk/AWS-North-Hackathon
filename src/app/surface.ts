/**
 * Where AWS City opens from the toolbar, per browser: Chrome/Edge have a side panel, Firefox a sidebar,
 * Safari neither (the full city opens in a tab). The Lookout needs the side panel or sidebar.
 */
export type Surface = 'sidepanel' | 'sidebar' | 'tab';

export const surfaceFor = (browser: string): Surface => (browser === 'firefox' ? 'sidebar' : browser === 'safari' ? 'tab' : 'sidepanel');

/** This build's surface (WXT sets import.meta.env.BROWSER at build time). */
export const SURFACE: Surface = surfaceFor(import.meta.env.BROWSER);

/** How the UI refers to it ("open the side panel"). */
export const SURFACE_NAME: Record<Surface, string> = { sidepanel: 'side panel', sidebar: 'sidebar', tab: 'full view' };

/** The slice of the extension API the toolbar wiring needs (keeps it testable without a browser). */
export interface ToolbarApi {
  sidePanel?: { setPanelBehavior(o: { openPanelOnActionClick: boolean }): Promise<void> };
  sidebarAction?: { toggle(): Promise<void> | void };
  action: { onClicked: { addListener(fn: () => void): void } };
  tabs: { query(q: { url: string }): Promise<{ id?: number; windowId?: number }[]>; update(id: number, p: { active: boolean }): Promise<unknown>; create(p: { url: string }): Promise<unknown> };
  windows?: { update(id: number, p: { focused: boolean }): Promise<unknown> };
  runtime: { getURL(path: string): string };
}

/** Makes the toolbar icon open the city. Never throws: a missing API must not stop the rest of the background. */
export function installToolbar(api: ToolbarApi, surface: Surface) {
  if (surface === 'sidepanel') {
    void api.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
    return;
  }
  api.action.onClicked.addListener(() => {
    // Firefox only opens the sidebar from the click itself, so no await before toggle().
    if (surface === 'sidebar' && api.sidebarAction) return void Promise.resolve(api.sidebarAction.toggle()).catch(console.error);
    void openCityTab(api).catch(console.error);
  });
}

/** Focuses the city tab if one is open, else opens it. */
async function openCityTab(api: ToolbarApi) {
  const url = api.runtime.getURL('/city.html');
  const [existing] = await api.tabs.query({ url });
  if (existing?.id === undefined) return void (await api.tabs.create({ url }));
  await api.tabs.update(existing.id, { active: true });
  if (existing.windowId !== undefined) await api.windows?.update(existing.windowId, { focused: true });
}
