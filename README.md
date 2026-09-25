# 🏙️ AWS City

Habbo Hotel for learning AWS: a Chrome extension with an isometric pixel city. Every AWS service is
a themed place, run by an agent who does the job the service does:

- **S3 Lake**: Sally fishes objects out of buckets.
- **Shield Wall**: Sir Shieldon blocks the arrows (a DDoS).
- **Route 53 Dance Hall**: Ruby pairs dancers with partners, the way DNS pairs names with IPs.
- **Lambda Food Stall**: only cooks when an order arrives.

- **Browse AWS and the city grows.** Opening a service's console or docs page discovers its
  landmark as a construction site, and learning upgrades it from Foundation to Expert.
- **You can see agents working.** They wander around idle. When a real AWS call runs for them, they
  do their activity: fishing, guarding, or sitting at their computer typing in the district HQ.
- **Ask the city to do something.** The Concierge dispatches an agent, who walks to their landmark
  with a speech bubble showing each step, and agents talk to each other along the way.
- **The Lookout** snaps a screenshot of any page so the city can see what you're looking at.
- **Play.** S3 Lake is a fishing mini-game: hook an object, then pick its storage class.

## Run it

```bash
npm install
npm run dev          # opens Chrome with the extension loaded (WXT)
```

Click the toolbar icon to open the **side panel**. Use ⤢ to open the **full city** in a tab.

```bash
npm run check        # tsc + unit tests (taxonomy routing, pathfinding, backend contract)
npm run build        # production build → .output/chrome-mv3 (load unpacked in chrome://extensions)
npm run smoke        # builds, loads it in Playwright Chromium, drives a full demo, screenshots → .output/smoke
npm run assets       # re-fetch Kenney CC0 art (scripts/assets.txt lists what's used)
```

In DevTools on the panel you can drive the city by hand:
`awsCity.simulateFocus('https://console.aws.amazon.com/s3/home')`, `awsCity.submitPrompt('…')`,
`awsCity.useCity.getState()`.

## Backend

The frontend runs fully on `MockBackend` by default. To connect the real AWS backend:

```bash
cp .env.example .env.local   # set WXT_BACKEND=aws, WXT_AWS_WS_URL, WXT_AWS_API_URL
```

The contract is in **[docs/backend-contract.md](docs/backend-contract.md)**
(source: `src/backend/contract.ts`).

**Local AWS backend (`server/`).** It implements this contract against a real AWS account and Claude on
Amazon Bedrock. It runs on your machine, because the workshop account blocks CloudFormation and IAM
roles, so API Gateway + Lambda can't be deployed there. Setup, guardrails and details are in
[`server/README.md`](server/README.md).

```bash
cd server && npm install && npm start      # prints the .env.local values to use
```

## Where things live

```
src/world/        pure data: districts, services, places/metaphors, city layout   ← add content here
src/backend/      contract.ts (the seam), MockBackend, AwsBackend                   ← only I/O lives here
src/state/        zustand store (state) + bus (moments: animations, camera moves)
src/app/          runtime.ts wires backend ⇄ store ⇄ chrome APIs; React shell
src/game/         Phaser 4: CityScene, InteriorScene (HQ rooms), FishingScene, agents, landmarks
src/ui/           React panels: activity feed, navigator, landmark card, chat, prompt, Lookout
src/entrypoints/  WXT: background (tab watcher, side panel), sidepanel/, city/ (full tab)
```

To add a service: add an entry in `taxonomy.ts` and a place in `places.ts`. It then gets a landmark
slot, an agent and a URL match automatically; each district has three slots.

## Credits

Tiles and furniture by [Kenney](https://kenney.nl), CC0. The agents are procedural pixel art
(`src/game/sprites.ts`).
