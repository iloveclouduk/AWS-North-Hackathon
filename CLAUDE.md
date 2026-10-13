# AWS City — agent guide

An MV3 browser extension for Chrome/Edge, Firefox and Safari (WXT + React 19 + Phaser 4 + zustand): an isometric AWS learning city.
The frontend is complete against a mock backend; the AWS backend plugs in through one contract.

## Decisions (each with the command that proves it)

- **Backend: `server/`** (Node + TS, Claude on Bedrock). It runs locally against the workshop
  account, which denies CloudFormation and `iam:CreateRole`, or hosted in our own account via `infra/`.
  The AgentCore/Strands backend is parked on `parked/agentcore-backend`. Proof: `cd server && npm test`
  (the server imports `src/backend/contract.ts`, so contract drift breaks its build: `npx tsc --noEmit -p server`).
- **Two deployments of one server:** local (`AUTH_MODE=token`, workshop profile, files; loopback
  only) and hosted (`AWS_CITY_MODE=hosted`: Cognito JWT in the WebSocket subprotocol, one tenant
  per player, DynamoDB/S3, each player's own account via `AWSCityPlayerRole-<region>` + ExternalId).
  `server/src/config.ts` refuses unsafe mixes. Proof: `cd server && npx vitest run test/hosted.test.ts`.
- **The player role allows exactly what the server calls, and trusts only our account.** The trust is
  fixed at publish time, not a parameter. Proof: `cd server && npx vitest run test/player-role.test.ts`.
- **Infra is CDK with cdk-nag AwsSolutions clean.** Every acknowledgement carries a reason. Deploys need no
  Docker: the server image is built in CodeBuild (`@cdklabs/deploy-time-build`).
  Proof: `cd infra && npm test && npx cdk synth -q`.
- **Agents are grounded, never unrestricted:** docs come from the read-only AWS Knowledge MCP server
  (allow-listed tools, `<aws_docs>` treated as data, official AWS hosts only). There's no AWS CLI tool
  and no managed AWS MCP Server (`aws___run_script`), and nothing from the Strands tools package.
  Proof: `cd server && npx vitest run test/knowledge.test.ts`.
- **Every agent runs on Strands Agents (TypeScript)**, pinned `@strands-agents/sdk` (npm `overrides` shares our
  `@anthropic-ai/sdk`). `AnthropicModel` gets our `AnthropicBedrock` client (the InvokeModel route) behind the quota
  gate; tools are the ActionService allowlist (citizens: read-only), a sequential executor, a 5-tool cap, no structured
  output (it forces `tool_choice`), no vended HITL (approval stays in ActionService: a write gets the player's approval
  channel or is refused). Citizens always; landmark agents too by default (`AWS_CITY_AGENT_ENGINE=classic` keeps the
  hand-written loop as a fallback). Landmark agents run at `effort: 'high'`, citizens `low`. Source: `.claude/references/cached-sources.md`.
  Proof: `cd server && npx vitest run test/citizens.test.ts`.
- **AWS's public status and news reach every player, read once by the server** (`server/src/news/`, contract v2.6 `aws.health`/`aws.news`).
  The sources are the public Health Dashboard JSON (UTF-16 with a BOM), with the status RSS as fallback, and What's New. Hosts are
  allow-listed, there are no redirects, a size cap and a timeout, and a failure backs off. Feed text is untrusted data (neutralised,
  trimmed, never given to a model). Services map only through verified codes in `shared/aws-health-services.json`. There's no IAM and
  no Health API (it needs a Business support plan). The demo plays the real Bahrain/UAE events plus a `drill: true` practice event.
  Proof: `cd server && npx vitest run test/news.test.ts test/tenants.test.ts`, `npx vitest run tests/incidents.test.ts tests/contract.test.ts`.
- **Findings are rules; the model only explains.** `server/src/agents/findings.ts` checks each poll (no model calls);
  players read `shared/wa-rules.json`; an unreadable setting never raises a finding.
  Proof: `cd server && npx vitest run test/care.test.ts`.
- **Fixes only tighten, are opt-in, and each one is approved.** A fixed allowlist (`server/src/agents/fixes.ts`) re-reads
  the resource before the preview and again inside the account lock after approval, one fix per finding at a time. The
  player role grants the fix actions only with `AllowFixes=true`. IAM holds an IMDS change's `HttpTokens` to `required` (not its
  other options) and EBS to enable-only; for S3 Block Public Access, DynamoDB PITR and security-group revokes it can't, so the code does (and the
  template says so). Undo is the player's, in the console. Outside the city's own resources the player types the
  resource id, and the citizen must be level 3 (a teaching gate, not a security control). Local mode needs
  `AWS_CITY_ALLOW_FIXES=true`.
  Proof: `cd server && npx vitest run test/fixes.test.ts test/player-role.test.ts test/care.test.ts`.
- **AWS plugins for Claude Code** (`.claude/settings.json`): `aws-core` and `aws-agents` from
  `claude-plugins-official` (Agent Toolkit for AWS). Use their skills (aws-cdk, aws-iam, aws-containers,
  aws-networking, aws-security, aws-well-architected-review…) when changing infra or the server. The
  aws-core MCP server's `aws___run_script` acts with the *developer's* credentials: it's for the dev
  session only, every call asks first (`permissions.ask` in `.claude/settings.json`), and it's never wired
  into the game's agents (they get only allow-listed read-only docs tools). Proof: `cd server && npx vitest run test/knowledge.test.ts`.
- **Every AWS write needs the player's approval** (contract v2 `deploy.preview` → `deploy.approve`).
  With no approval channel, writes are refused (only reads run). Proof: `server/test/approvals.test.ts`,
  `server/test/service.test.ts` ("refuses every write without an approval channel").
- **Linking an AWS account, approving a write and applying a fix need MFA (step-up).** Hosted players must have TOTP
  on for `account.link`/`account.verify`, `deploy.approve` and `finding.fix` (Google sign-ins are exempt); prod Cognito runs Plus with threat protection.
  A "TOTP is on" answer is cached 60 s at most. Proof: `cd server && npx vitest run test/hosted.test.ts -t "MFA"`
  (includes "MFA step-up for writes"), `cd infra && npm test`.
- **Hosted deploys only run in Regions with a Claude geo inference profile** (`infra/lib/models.ts`: `us`, `eu`, `au`,
  `in`; there is no `apac` profile, so e.g. Tokyo is refused). Each geo gets the newest pair with a profile there for
  both models (`GEO_MODELS`, from the Bedrock model cards): Claude Opus 5.5 / Sonnet 5.5 in `us`/`eu`/`au`; India has no
  5.5 profile and keeps Opus 5 / Sonnet 5. Model ids and their IAM ARNs derive from the Region; synth and the setup
  wizard refuse other Regions. Local mode keeps the `us.` defaults in `server/src/config.ts` (Opus 5.5 / Sonnet 5.5).
  Proof: `cd infra && npm test`.
- **Bedrock calls never force `tool_choice`** (Bedrock rejects it while thinking is on, and always for
  Claude 5.5-generation models; the defaults are Opus 5.5 / Sonnet 5.5, `server/src/config.ts`, but any model can be
  configured). Ask for the tool in the prompt and handle a missing call. Short routes use `effort: 'low'`. On 5.5
  thinking can't be turned off (never send `thinking: {type: 'disabled'}`), Opus 5.5 defaults to `medium` effort (set it
  where depth matters), and agent histories stay append-only (edited turns are refused).
  Proof: `cd server && npx vitest run test/console.test.ts`.
- **Players see no internal errors.** Hosted errors are a sentence plus a `ref` that finds the log line
  (`publicError` in `server/src/log.ts`). Proof: `cd server && npx vitest run test/log.test.ts`.
- **One seam to the backend.** Only `src/backend/` does network I/O. `contract.ts` is the source of
  truth; `docs/backend-contract.md` mirrors it. Proof: `npx vitest run tests/contract.test.ts`, and
  `grep -rn -e "fetch(" -e "WebSocket(" src | grep -v src/backend/` prints nothing.
- **Content is data in `shared/`** (world, flashcards, puzzles, quests, templates). JSON imports need
  `with { type: 'json' }` because the server runs as NodeNext ESM.
- **Art is generated, not hand-placed:** `npm run art` imports the team pack from
  `agentic-city/index.html`, then runs the character generator and the tile generator. The grid is
  **32×16**, the pack's exact scale. Sprite names must be unique, and the generator fails on duplicates.
- **Text is crisp in a pixelArt world:** use `crisp()` from `src/game/SpeechBubble.ts` (LINEAR filter
  plus DPR resolution) and counter-scale by `1/zoom`. Camera zoom stays on integers.
- **Sound:** SFX only, no music; on by default and soft. One mixing path (synth voices play through Phaser's audio
  context), nothing scheduled before the first gesture (dropped, never queued), nothing while the page is hidden, a
  priority mixer so one action makes one sound (a big clip holds lower sounds for its own length), and mute synced across
  the panel and the tab (storage event), faded so it never clicks. Levels live in one table in `src/game/audio.ts`.
  Sounds answer the player: the city is silent while it sleeps (world map, HQs, games: `CityScene.play`), agents talking
  among themselves never blip (`silent`), one blip at a time in each speaker's fixed note, the work sound only for the
  player's own task, AWS status chimes follow the news rung, and the demo's chatter is talk only (no `agent.state`).
  Mini-game rounds start from a synced clock (`syncClock`), keep their end card on resize, and build combos (`combo.ts`).
  Proof: `npx vitest run tests/audio.test.ts tests/game-clock.test.ts tests/contract.test.ts`.
- **Each AWS Region is its own city, built from real facts.** A first run opens on the world map (`WorldScene`); picking a
  Region dives into its city (remembered in prefs). Each of the Region's real AZs is an island across the river that rings
  downtown (`zonesFor` → `azsFor`, slots in `AZ_SLOTS`; `shared/region-facts.json`: six in us-east-1, four in us-west-2; the
  linked account's own AZ names when known), with one bridge each onto a core road, so cross-AZ packets cross both bridges
  through downtown; a fenced lot for each service AWS doesn't offer there (with when, or whether, it's coming), and list prices per Region
  (`shared/prices.json`). Both files are generated with their sources: `npm run region-facts` (AWS Knowledge MCP; a service's own
  Regions page overrides the availability tool, see `OVERRIDES`) and `npm run prices` (Price List Bulk API + the pricing pages'
  data; never the 440 MB EC2 file). The server mirrors every Region only with a Resource Explorer aggregator index in the home
  Region; findings are checked in the home Region. Proof: `npx vitest run tests/regions.test.ts tests/terrain.test.ts tests/roadgraph.test.ts tests/region-facts.test.ts tests/prices.test.ts`,
  `cd server && npx vitest run test/care.test.ts`.
- **Live traffic is opt-in, and real.** `flow.enable` (contract v2.8, `Progress.flow`) turns on a read of a few request
  counts from the player's CloudWatch (`server/src/state/flow.ts`: four fixed Metrics Insights queries, one per
  `GetMetricData` call, at most every 5 minutes while a tab is open, 96 a day, kept in memory only). The player role
  grants `cloudwatch:GetMetricData` alone, held to its Region (v4). The city drives request cars for the rates
  (`carsPerMinute`): load balancer requests to the AZ islands that served them, the rest to their buildings.
  Proof: `cd server && npx vitest run test/flow.test.ts test/player-role.test.ts`, `npx vitest run tests/contract.test.ts tests/carriers.test.ts`.
- **The city mirrors the account's map; the bill is opt-in.** `city.inventory.zones`/`regionStatus` come from
  `ec2:DescribeAvailabilityZones`/`DescribeRegions`, cached a day; a Region that can't be read is left out. `city.bill`
  (`ce:GetCostAndUsage`, $0.01 a request) is read only after `bill.enable {on:true}`, then at most once a day per player;
  `shared/ce-services.json` maps only verified Cost Explorer service names (the rest show as "other").
  Proof: `cd server && npx vitest run test/bill.test.ts test/care.test.ts test/player-role.test.ts`, `npx vitest run tests/contract.test.ts`.
- **The city stands in a landscape.** `src/world/terrain.ts` (pure, the same per Region every time) rings the 40×40 core:
  a river round downtown, the Region's AZs as islands with bridges, the highway out through the gate, and a coast and biome
  sampled from the world map at the Region's real position (an impression, not a survey). `src/game/Landscape.ts` bakes
  the ground into RenderTextures (Phaser 4 needs `.render()`, re-baked on `restorewebgl`) and draws at most `MAX_PROPS`
  props; there's one sea colour, `src/game/palette.ts`, and it matches the sea texture. Proof: `npx vitest run tests/terrain.test.ts`.
- **City life is ambience, never AWS activity, with two exceptions: AWS's own status, and data carriers.** Traffic, boats, the sky
  and the dim baseline packets (`src/game/Ambient.ts`) only say how much of the account lives here. Ambient cars are data-themed
  for looks only (server, packet, fibre and cloud vans, `CAR_SKINS` in `src/game/Traffic.ts`): no beacon, never a carrier's colour,
  not tappable. The demo's links to other Regions arrive only once the practice account is linked (`demoInventory`
  `crossRegion`), so nothing the player didn't connect crosses the world map. Only agents' work animations
  and data carriers mean work: a replication tanker, a standby van and a request car drive only for a real `DataLink` of the
  account (`RegionOverlay` → `Ambient.dispatchData` → `Traffic.spawnData`), wear the `veh:data:*` sprites with a roof beacon,
  can be tapped (`CarrierCard`, text in `shared/carriers.json`), share the vehicle cap (an ambient car gives way; at most
  `DATA_CAP` 6/3) and fall back to the packet convoy when they can't drive. Storms
  (`src/game/Weather.ts`) and red/amber outage fences come only from the public AWS Health Dashboard (contract v2.6 `aws.health`). They're
  pooled and run without tweens; they pause while the page is hidden and park under reduced motion. Each surface has caps
  (applied by `Ambient.setSurface`, tab/panel; defined in `src/world/traffic.ts`, `Boats.ts`, `Sky.ts`, `Packets.ts`): citizens 20/12, vehicles 14/8, boats 3/2, clouds 3/2, packets 24/16. A* gives up after
  2,000 expansions, routes are cached per grid version, and `CityMap.sync` skips the ground pass unless a district or tier changed.
  Proof: `npx vitest run tests/traffic.test.ts tests/traffic-sim.test.ts tests/carriers.test.ts tests/roadgraph.test.ts tests/flow-trickle.test.ts tests/pathfinding.test.ts`;
  `npm run smoke` asserts the caps from `awsCity.ambient.stats()` and logs FPS (it only warns, and headless caps it at 30).
- **New players climb an unlock ladder.** `src/state/ladder.ts` (pure) opens tabs and panels as progress grows, and
  anything opened anyway stays open. Findings are held until city care unlocks (a linked account sees them at once),
  then drip in least severe first, at most `MAX_OPEN_FINDINGS` open. AWS news (the ticker and incident toasts) is a rung too:
  it opens after the first quest, and the demo's practice drill waits for it (`MockBackend.putProgress`); storms still show.
  There's no "Open anyway" list: Quests names the next unlock, and ⋯ → Peek at everything opens all of it.
  Proof: `npx vitest run tests/ladder.test.ts tests/finding-pacing.test.ts tests/contract.test.ts`.
- **Learning has a daily rhythm and a goal.** Home shows Today (a few cards, a puzzle, a fix: only areas that are open;
  `todayGoals` in `src/state/progress.ts`) and the certification the player chose in Golden Jacket Hall
  (`prefs.certGoal`, `certProgress`). Each building's sign counts its reviewed cards due again (🃏, `dueFor` in
  `src/state/srs.ts`, re-read each minute; shown with the name under the label budget). Each building's card offers "Which one should I pick?" comparisons
  (`shared/comparisons.json`, AWS decision guides as sources, `CompareCard`). ⋯ → Save a postcard downloads the city as a
  PNG with its caption (`src/game/postcard.ts`, nothing uploaded). Proof: `npx vitest run tests/comparisons.test.ts
  tests/ui-logic.test.ts tests/culture.test.ts tests/content.test.ts`.
- **Partners are linked, never copied.** Each building's card has a Learn more shelf (`src/ui/ReadingShelf.tsx`,
  `shared/further-reading.json`): a Tutorials Dojo cheat sheet for every service, AWS Fundamentals articles where they
  have them, then books credited with their authors. Links open only on the partners' hosts (`isReadingUrl`, separate
  from `openDocs`, which stays AWS-only); the extension never fetches them. Check each link opens before adding it.
  Proof: `npx vitest run tests/reading.test.ts`.
- **Quests end with "Explain it back".** The celebration card asks one question about the quest's first service; the
  player answers in their own words (≥ 6 words, ≤ 600 characters). A rules-only check shows the service's keywords they
  used and missed (`src/state/explain.ts`), and the building's agent gives kind feedback through the ordinary `chat.ask`
  route (no contract change; the demo's reply starts from `EXPLAIN_MARK`). Proof: `npx vitest run tests/explain.test.ts tests/ui.test.tsx`.
- **Each mini-game has an Expert round from building level 3** (`EXPERT_TIER`, `src/game/pace.ts`): quicker (`EXPERT_PACE`),
  quiz games deal only the two harder tiers (`dealRound`), stars × 1.5; it ends when the player leaves the game and never
  mixes with Games without a clock. Proof: `npx vitest run tests/a11y-prefs.test.ts`.
- **One goal, one celebration.** Home has one primary button (Connie's next step; nothing competes on a first run's world
  map). A big moment gets one channel: a tier-up celebrates on the building (no toast), a finished quest opens the
  celebration card (`src/ui/Celebrate.tsx`, no toast). Players see one progress word, stars (⭐), not "XP".
  Proof: `npx vitest run tests/moments.test.ts`.
- **Each Region is its own city** (contract v2.7, `src/state/cities.ts`). Landmarks live in `Progress.cities[region]`;
  global services (`shared/region-facts.json` `global`) stay in `Progress.landmarks` and stand in every city. Knowledge
  (cards, quests, puzzles, citizens, streak) follows the player. Old saves migrate into the city being built. Selectors
  take the Region (`isDiscovered(p, id, region)`); without one they mean "anywhere". Your real resources stand where they
  live (`src/world/resources.ts`, `shared/resource-props.json`): servers on their AZ's island, buckets on the lake.
  Proof: `npx vitest run tests/cities.test.ts tests/resources.test.ts`, `cd server && npx vitest run test/progress.test.ts`.
- **Plain language.** Player-facing text goes through `<Plain>` (`src/ui/Term.tsx`): every glossary term and service
  name can be tapped for its definition. Every acronym a player reads is a glossary term, a service name or on the allow-list.
  Simple words first: every flashcard has `simple` (≤ 110 chars), every puzzle `simpleWhy`, every service `simple` (≤ 90);
  the full text sits behind "Tell me more" / "For AWS learners". Proof: `npx vitest run tests/content.test.ts`.
- **The map stays calm.** Labels follow one budget (`src/game/labels.ts`, colours in `src/game/theme.ts`): names on hover or
  zoom ≥ 2, technical labels (AZ IDs, network notes, distance signs) only with ⋯ → Show the map details (`prefs.mapDetails`).
  Every issue cone shows, but only the most urgent one's "!" tag (and it alone bounces); the rest show from zoom 2 or on the
  building the player is looking at (`IssueMarkers.setTagsShown`). The ticker leads with this city's Region; a weeks-old
  outage elsewhere waits behind fresh news (`tickerItems`). Proof: `npx vitest run tests/incidents.test.ts tests/ui.test.tsx`,
  `npm run smoke` (screenshots in `.output/smoke`).
- **The skyline grows with what you learn.** Each open district raises towers in its AWS category colour
  (`art/tiles/towers_art.py`: compute rack bands and fans, storage water tank, database disk stack, networking mast,
  security battlements and crest, AI glass pyramid), two per level of its average landmark tier, mid-rise from level 1,
  towers from 2, skyscrapers from 3 (`decorPlan` in `src/game/decor.ts`). A tower is only as tall as the ground behind
  it is clear of landmarks drawn behind it (`clearBehind`, `TOWER_STEPS` = sprite height / 8 px), so it never hides one.
  Proof: `npx vitest run tests/decor.test.ts`.
- **Every Region's city has its own landmark.** `shared/region-flavour.json` gives each Region a `signature` (13 motifs ×
  variants, `art/tiles/signatures_art.py`: lattice tower, needle, bridge, spire, dome, gate, pavilion, rowhouses, wind
  towers, data-centre campus, shell roofs, harbour towers, modernist gallery), placed once by the highway outside the gate
  (`terrainFor`, no `rng()` calls so nothing else moves). Generic impressions only: no trademarked or protected buildings,
  flags, religious, political or military sites. The world map draws each city's signature as a tiny skyline, lit while
  it's night there (`isNightAt`, solar time from the longitude, redrawn each minute). Proof: `npx vitest run tests/signatures.test.ts`.
- **Learning visibly grows the city.** Every activity names the building it grew and how far (`growthOf`/`growthLine`,
  `src/state/growth.ts`): under each flashcard, on every game's end card, in the puzzle result. Between levels a building
  shows scaffolding (1/3 of the way) then a crane (2/3) (`constructionStage`, `TierProps.syncWorks`); a tier-up flies the
  camera there, and one earned while the city slept (game, HQ, world map) is celebrated on return. Drawings pay most
  (`src/learning/puzzleRewards.ts`: first pass 12/service + 10, better pass 4, a failed try 2 per right piece once a day);
  a puzzle's `best` is its best *pass* only, and the panel states the rule (70+, nothing missing). Games pay full stars
  for 3 rounds a day per game or a new best (`gameStars.ts`); a seen card never pays new-card stars again. District
  skylines average the buildings put up (at least 2). Proof: `npx vitest run tests/puzzle-rewards.test.ts tests/park.test.ts
  tests/game-clock.test.ts tests/learning.test.ts tests/decor.test.ts`.
- **re:Play Park.** An AWS theme park on a 6×5 site the terrain reserves outside the gate in every Region (`terrain.park`,
  no `rng()`); `src/world/park.ts` lays out six rides (EventBridge wheel, Lambda coaster, CloudFront drop tower, Route 53
  carousel, S3 flume, SQS teacups), each open when its building reaches Practitioner in this city, else under wraps
  with a hint (`src/game/Park.ts`; tap opens the building). Pocket parks stand on the lots global services leave open
  (`openLots`). Sprites: `art/tiles/park_art.py` (+ `crane1x1`, `scaffold1x1`). Proof: `npx vitest run tests/park.test.ts`.
- **The terminal city grows with the run.** `npm start`'s dashboard skyline fills in as steps finish (`stepsGrowth`,
  `growthCaption`, `frame({ growth })`); one crane per unfinished step. A window already holding the browser profile is
  named, not a silent failure (`lockPid`, `ALREADY_OPEN`, `k` closes it). Proof: `npx vitest run tests/launcher.test.ts
  tests/launcher-skyline.test.ts`.
- **Each service has workers on the street.** Every discovered service in the city sends a worker dressed as its agent
  (crowd copy) on errands between its building and the services it works with in `shared/flows.json`; tapping one opens
  the building and shares a tip from that service's deck (`src/game/Workers.ts`, no model calls from walking). They
  take pedestrians' places, so the crowd cap holds (`WORKER_CAP` 8/4). Proof: `npm run smoke` (caps).
- **People stand to scale.** Pedestrians and the Well-Architected citizens use 3/4-size crowd sheets (`<id>-crowd`, 36×54,
  made by `art/characters/crowd_small.py` in `npm run art`, never shrunk at runtime: that would drop pixels at zoom 1). Kai
  and the landmark agents stay full size so they can be found. Proof: `npx vitest run tests/art.test.ts`.
- **Accessibility is a setting, not a fork.** ⋯ → Accessibility sets text size (125/150 %), high contrast and an easy-read
  font on `<html>` (`data-text`, `data-contrast`, `data-font`); `styles/22-access.css` only overrides tokens, and the city's
  labels scale with the text size. Games without a clock (`prefs.relaxed`, `src/game/pace.ts`) end rounds on Done and stretch
  reaction windows and spawns (Rush Hour's day, which is the game, runs at half speed instead); Sound captions
  (`prefs.captions`) show a word pill for each meaningful sound (`CAPTIONS` in `src/game/audio.ts`, not steps or blips).
  Keyboard: arrows walk, E talks, `]` / `[` step through buildings (announced to screen readers), `+` / `−` zoom.
  Arriving in a city announces its summary (`citySummary`: buildings, issues, AWS status, live traffic). The smoke runs
  axe-core (WCAG 2.2 AA) on the world map, a building's card, the tab and the panel; serious or critical violations fail it. Proof: `npx vitest run tests/a11y-prefs.test.ts`, `npm run smoke`.
- **Kai wears the team's gold jacket.** Always, everywhere (`KAI_SHEET` = the `player-gold` sheet, `src/world/culture.ts`).
  Golden Jacket Hall tracks the certification trophies (`hasGoldenJacket`: every one lit, a moment the first time). The real
  Golden Jacket recognises holders of every current AWS Certification; `shared/certifications.json` is that list.
  The Day 1 Quarter is open from the start (`ladder.ts` `day1: true`). Proof: `npx vitest run tests/ladder.test.ts tests/art.test.ts`.
- **Content is data.** Districts, services, metaphors and layout live in `src/world/`. Game and UI code
  never hard-code service ids (the exceptions are `bedrock`, the default router target, and the
  mini-games, each built for one landmark: `s3` fishing, `lambda` food stall, `route53` dance, `shield` wall, `ec2` rush hour, `dynamodb` sorting office). Proof: `npx vitest run tests/taxonomy.test.ts` checks every service has a
  place, a landmark and a valid work spot.
- **State vs moments.** Persistent state goes in the zustand store (`src/state/store.ts`); one-off
  animations and camera moves go on the bus (`src/state/bus.ts`). Scenes subscribe to both and must
  unsubscribe on both SHUTDOWN and DESTROY, because React StrictMode destroys the first game.
- **Agent animation = real AWS activity.** `agent.state working/idle` from the backend drives the
  work animation. Browsing only moves focus: the camera pans, the agent waves, and first visits
  discover landmarks.
- **Surfaces.** The side panel (Chrome/Edge), the Firefox sidebar (same entrypoint) and the full tab at
  `/city.html` run the same app and merge progress through `storage.local`. The toolbar opens the panel, the
  sidebar, or (Safari, which has neither) the tab: `src/app/surface.ts`. The Lookout and Console Copilot need
  the panel/sidebar. Proof: `npx vitest run tests/surface.test.ts`.
- **Three browsers, one codebase.** WXT `-b firefox|safari` with `manifestVersion: 3` (WXT defaults those to MV2).
  Firefox has a fixed add-on id (its sign-in redirect is derived from it); Safari signs in through a relay page
  (no identity API). Firefox/Safari origins are random per install, so the server allows them by scheme, and a
  wildcard never authenticates by Origin alone. Proof: `npm run lint:firefox && npm run build:safari`,
  `cd server && npx vitest run test/http.test.ts -t "origins"`, `npx vitest run tests/auth.test.ts`.

## Commands

```
npm start         # the guided launcher: demo / real AWS / deploy, pick a browser (scripts/start.mjs)
npm start -- --demo --browser cft   # the same, no prompts (on stage); --help lists the flags
npm run check     # tsc --noEmit && vitest run (tests/**/*.test.{ts,tsx}; React components render under jsdom)
npm run lint      # ESLint: rules of hooks + jsx-a11y (CI allows at most 10 warnings)
npm run smoke     # build + Playwright Chromium demo run; screenshots in .output/smoke; must print "no page errors"
npm run dev       # WXT dev with Chrome
npm run live      # local server with real AWS (workshop profile) + the extension wired to it
npm run dev:firefox / npm run live -- --browser firefox|safari   # other browsers
npm run lint:firefox && npm run build:safari   # Firefox (Mozilla linter, 0 errors) and Safari builds
npm run safari:xcode   # Xcode project for Safari (.cache/safari)
npm run smoke:copilot  # the 4 Console Copilot flows against fixtures; must print "no page errors"
cd infra && npx cdk synth -q   # hosting (must pass cdk-nag)
npm run assets    # refetch Kenney packs into .cache/ and copy the listed files into public/assets/kenney
```

## Gotchas found the hard way

- `Element.scrollIntoView()` returns a Promise in current Chromium. Never write
  `useEffect(() => el.scrollIntoView())`; use a block body instead.
- Phaser 4: in-world text is counter-scaled by camera zoom (`setUiScale`) so it stays readable in
  the 400 px side panel.
- Upstream sources: `.claude/references/cached-sources.md` (opensrc). Check them before guessing
  about WXT or Phaser behaviour.
