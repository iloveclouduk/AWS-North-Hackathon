# AWS City — agent guide

A Chrome MV3 extension (WXT + React 19 + Phaser 4 + zustand): an isometric AWS learning city.
The frontend is complete against a mock backend; the AWS backend plugs in through one contract.

## Decisions (each with the command that proves it)

- **One seam to the backend.** Only `src/backend/` does network I/O. `contract.ts` is the source of
  truth; `docs/backend-contract.md` mirrors it. Proof: `npx vitest run tests/contract.test.ts`, and
  `grep -rn -e "fetch(" -e "WebSocket(" src | grep -v src/backend/` prints nothing.
- **Content is data.** Districts, services, metaphors and layout live in `src/world/`. Game and UI code
  never hard-code service ids (the exceptions are `bedrock`, the default router target, and the
  `s3` fishing game). Proof: `npx vitest run tests/taxonomy.test.ts` checks every service has a
  place, a landmark and a valid work spot.
- **State vs moments.** Persistent state goes in the zustand store (`src/state/store.ts`); one-off
  animations and camera moves go on the bus (`src/state/bus.ts`). Scenes subscribe to both and must
  unsubscribe on both SHUTDOWN and DESTROY, because React StrictMode destroys the first game.
- **Agent animation = real AWS activity.** `agent.state working/idle` from the backend drives the
  work animation. Browsing only moves focus: the camera pans, the agent waves, and first visits
  discover landmarks.
- **Surfaces.** The side panel (toolbar toggles it) and the full tab at `/city.html` run the same app.
  They sync progress through `chrome.storage.local`. The Lookout only works from the side panel.
- **Art.** Kenney CC0 tiles and furniture (`scripts/assets.txt` lists every file used), plus
  procedural pixel agents in `src/game/sprites.ts`. Kenney has no sit, type or fish frames.

## Commands

```
npm run check     # tsc --noEmit && vitest run
npm run smoke     # build + Playwright Chromium demo run; screenshots in .output/smoke; must print "no page errors"
npm run dev       # WXT dev with Chrome
npm run assets    # refetch Kenney packs into .cache/ and copy the listed files into public/assets/kenney
```

## Gotchas found the hard way

- `Element.scrollIntoView()` returns a Promise in current Chromium. Never write
  `useEffect(() => el.scrollIntoView())`; use a block body instead.
- Phaser 4: in-world text is counter-scaled by camera zoom (`setUiScale`) so it stays readable in
  the 400 px side panel.
- Upstream sources: `.claude/references/cached-sources.md` (opensrc). Check them before guessing
  about WXT or Phaser behaviour.
