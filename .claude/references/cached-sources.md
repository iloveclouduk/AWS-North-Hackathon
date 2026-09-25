# Cached upstream sources (opensrc)

Check behaviour against these before guessing. Re-fetch whenever the installed version changes:
`npx opensrc fetch wxt phaser`. The versions must match `npm ls wxt phaser`.

| Package | Version | Path (`npx opensrc path <pkg>`) | Why it's cached |
|---|---|---|---|
| wxt | 0.21.4 | `~/.opensrc/repos/github.com/wxt-dev/wxt/0.21.4` | Entrypoint discovery (sidepanel → `side_panel` + auto `sidePanel` permission: `packages/wxt/src/core/utils/manifest.ts`), env prefix `WXT_`/`VITE_` (`core/builders/vite/index.ts`), `srcDir` / alias rules (`core/resolve-config.ts`) |
| phaser | 4.2.1 | `~/.opensrc/repos/phaserjs@github.com/phaserjs/phaser/4.2.1` | v4 breaking changes (`changelog/v4/4.0/MIGRATION-GUIDE.md`): no `setTintFill`, `roundPixels` is off by default, masks are now filters. `TextureManager.addSpriteSheet` accepts a canvas (used by `src/game/sprites.ts`). Pointer event `stopPropagation` semantics (`src/input/InputPlugin.js`). |

Not cached (plain web platform): `chrome.sidePanel`, `chrome.tabs.captureVisibleTab`. See
developer.chrome.com. Still unverified: whether opening the side panel from the toolbar grants
`activeTab`. The Lookout falls back to requesting the optional `<all_urls>` permission.
