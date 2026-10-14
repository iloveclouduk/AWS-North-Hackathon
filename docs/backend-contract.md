# Backend contract v2.9

**Source of truth:** `src/backend/contract.ts`. If this doc and that file disagree, the file wins,
so fix this doc. Both backends import or mirror that file:
- `server/src/world.ts` re-exports it, so a contract change breaks the server build.
- The parked AgentCore backend has a Python mirror.

`npm test` checks the mock against the contract, and `cd server && npm test` checks the server.

## Backends

| `WXT_BACKEND` | Backend | Transport | Deploys |
|---|---|---|---|
| `mock` (default) | `src/backend/MockBackend.ts`, runs in the browser | none | Simulated curated templates |
| `aws` | **`server/`**, the team's local Node server with a real account and Claude on Bedrock | WebSocket `/ws` + REST `/progress`, `/screenshots`; the Origin allowlist is `EXTENSION_ORIGIN` | **Guarded actions** (EC2 t4g, DynamoDB, S3); every write needs the player's approval |
| `hosted` | **`server/`** deployed by `infra/` (ECS Fargate): players sign in with Cognito (JWT in `Sec-WebSocket-Protocol`, `Authorization: Bearer` on REST) and link their own AWS account | Same as `aws` | Guarded actions in the **player's own account** through `AWSCityPlayerRole-<region>` (ExternalId), each needing approval |

The workshop account denies CloudFormation and `iam:CreateRole`, so `aws` is the backend in use.

## Client → server

| Command | Fields | Notes |
|---|---|---|
| `task.submit` | `taskId, prompt, context{url,title,serviceId,screenshotKey}, questId?` | The server rejects unknown fields; the adapter strips `questId`. |
| `chat.ask` | `requestId, districtId, question, context` | |
| `page.classify` | `requestId, context` (with `screenshotKey` or url/title) | |
| `deploy.approve` / `deploy.reject` | `deployId, confirm?` | The player's answer to a `deploy.preview`. Nothing changes in AWS without `deploy.approve`. |
| `deploy.plan` | `requestId, templateId` | On `aws`, `ServerBackend` sends it to the matching agent as a prompt (`GUARDED_BLUEPRINTS`). |
| `deploy.teardown` | `deployId` | On `aws`, it asks the agent to demolish what was built (that also needs approval). |
| `account.link` | `requestId, region` | Hosted: returns `account.linkUrl` (CloudFormation quick-create for `infra/player-role/player-role.yaml`, with the player's ExternalId). |
| `account.verify` | `requestId, roleArn` | `roleArn` may be just the 12-digit account id. The server assumes the role and checks the caller identity before linking. |
| `bill.enable` | `on` | v2.5: the month-to-date bill on or off (off by default; each Cost Explorer read costs $0.01, so at most one a day). |
| `flow.enable` | `on` | v2.8: live traffic on or off (off by default; CloudWatch reads at most every 5 minutes while the city is open). |
| `progress.get/put`, `screenshot.presign`, `quest.start` | | On `aws`/`hosted`, handled over REST (`/progress`, `/screenshots`) or locally by `ServerBackend`. `DELETE /me` removes everything stored for the player. |

Client-internal, not on the wire: `storage.local` keeps `progress.parked` (a signed-out player's unsynced progress, tagged with the player's id, their Cognito `sub`, and only ever restored to that same player), and the optional `AgentBackend.playerId()` (hosted only; absent on local/mock) exists just to tag it. It is not a security check: the server authorizes every request by the JWT.

## Server → client

| Event | What the city does |
|---|---|
| `task.plan {taskId, agentId, targetServiceId, steps[]}` | The Concierge dispatches the agent, which walks to its landmark. |
| `task.step {taskId, index, text, status}` | A bubble shows "Step i/n" and the feed updates. `skipped` means the agent remembers you know this step. |
| `agent.state {agentId, state, service?, detail?}` | **`working` means a real AWS call is running.** The agent plays its work animation. |
| `agent.message {from, to, text}` | A speech bubble appears and a data packet travels the roads between the two agents. |
| `task.done {taskId, ok, result, xp[]}` | XP goes to landmarks: tiers go up, the city grows, and quests advance. |
| `deploy.preview {deployId, taskId?, templateId, stackName, region, changes[], costNote?}` | The Deploy tab shows the change list with **Approve / Reject**. |
| `deploy.status {deployId, status, message?, outputs?}` | `status` is one of `creating`, `complete`, `failed`, `rejected`, `deleting` or `deleted`. |
| `agent.level {agentId, level, skill?}` | The agent gets faster and announces its new skill. |
| `account.status`, `account.linkUrl` | These drive the Deploy tab's account section. |
| `page.classified`, `chat.answer` (streamed), `screenshot.url`, `progress.state`, `error` | The same as in v1. |

**v2.2 additions (all optional):**
- `error.code`: `quota` (the player's daily AI calls are used up), `paused` (the city's AI is switched off), `auth` (sign in again), `unlinked` (connect an AWS account first) or `mfa_required` (hosted: `account.link`/`account.verify`, `deploy.approve` and `finding.fix` need an authenticator app on first; the Deploy tab enrols one). The UI shows friendly text for each.
- `sources: [{title, url}]` on `task.done` and on the final `chat.answer`: the AWS documentation pages (docs.aws.amazon.com / aws.amazon.com only) the answer was grounded in, from the AWS Knowledge MCP server.
- WebSocket close codes (`CLOSE_CODES` in `contract.ts`): `4401` = reconnect with a fresh token, `4403` = the account was deleted
  (`DELETE /me`, from this tab or another): sign out and don't reconnect, `1012` = server restarting (reconnect with jitter),
  `4429` = too many tabs. Hosted, a deleted player is refused for two hours (longer than an access token lives): the WebSocket
  upgrade, `GET`/`PUT /progress` and `POST /screenshots` answer `410`, so a still-valid token can't recreate their data.

**v2.3 additions, city care (all additive):** citizens look after a city that mirrors the account.
- `city.inventory {takenAt, region, source, complete, counts, items[], truncated}`: what's in the account. `source` is
  `resource-explorer` (complete), `tagging` or `collectors` (both may miss resources, so `complete: false`) or `mock`. Items
  carry `arn, type, name, serviceId|null, districtId|null, managedByGame`; at most ~300 per frame.
- `city.inventory` also carries `homeRegion`, `regions {code: count}` and `links[]` (`{id, serviceId, from{region,az?},
  to{region,az?}, kind: replication|standby|traffic, twoWay?, label}`); items carry `region?` and `az?`. With a Resource
  Explorer aggregator index in the home Region the list spans every Region; otherwise only the home Region.
  Each link drives through the city of either Region it touches as a data carrier (replication → tanker, standby →
  standby van, traffic → request car), tappable to see what it carries and its list price per GB.
- `city.finding {finding}`: a Well-Architected finding opened or resolved, `{id, ruleId, serviceId, districtId, citizenId,
  pillar, severity, status, resource{id,name,arn?,gameOwned}, title, text, url, fix?, undoUntil?}`. Rules are code
  (`server/src/agents/wellarchitected.ts`) and their text is data (`shared/wa-rules.json`). All open findings are sent on connect.
- `finding.explain {requestId, findingId}`: the finding's citizen explains it, as an `agent.message` to `user`.
- `finding.undo {requestId, findingId}`: answered with how to undo the fix in the AWS console (fixes only tighten things).
- `finding.fix {requestId, findingId}`: nothing changes yet. The server
  re-reads the resource, then sends a `deploy.preview` with `findingId`, `rollback`, `costNote?` and, for a resource the
  city didn't build or an account-wide setting, `confirmText` (the resource id or ARN, which is unique). Approve with `deploy.approve {deployId, confirm}`; the
  server compares `confirm` to `confirmText`. Fixes are a fixed allowlist of reversible changes (`server/src/agents/fixes.ts`).
- `Progress.citizens` (`{id: {xp}}`) and `Progress.fixes` (`{findingId: iso}`).
- v2.4: `Progress.streak` (`{days, last: 'YYYY-MM-DD' local date, best}`), merged by the later `last` with `best` = max.

**v2.5 additions, the real map and the bill (all optional):**
- `city.inventory.zones {region: [{name, id}]}`: the account's Availability Zones (zone type `availability-zone`, sorted
  by name) for the home Region and every Region with resources, from `ec2:DescribeAvailabilityZones` (cached a day). AZ
  names are mapped per account (`us-west-2a` here can be `usw2-az2`); the AZ ID is the same in every account. A Region
  the server can't read is left out.
- `city.inventory.regionStatus {region: 'enabled'|'not-enabled'}`: from `ec2:DescribeRegions {AllRegions: true}`
  (`opt-in-not-required`/`opted-in` = enabled, `not-opted-in` = not-enabled).
- `bill.enable {on}`: turns the city's bill on or off (also kept as `Progress.bill`). Off by default: Cost Explorer
  charges $0.01 per request, so the server calls `ce:GetCostAndUsage` only while it's on, when it's turned on and then at
  most once a day per player (cached in the player's store).
- `city.bill {month: 'YYYY-MM', currency, total, byService {serviceId|'other': n}, byRegion {region|'global': n}, takenAt,
  estimated: true}`: month-to-date UnblendedCost (as Cost Explorer reports it, credits and refunds included), rounded to
  cents. Cost Explorer's service names map to landmarks through `shared/ce-services.json`; anything else is `other`. Sent
  on connect while the bill is on, and after each read. If it can't be read: `city.bill {unavailable, takenAt}`, one plain
  sentence (no permission, Cost Explorer still turning on…). Narrow on `unavailable`.

**v2.6 additions, AWS's public status (all optional, the same for every player):**
- `aws.health {asOf, incidents[], stale?}`: the public AWS Health Dashboard (`health.aws.amazon.com/public/currentevents`,
  with `status.aws.amazon.com/rss/all.rss` as the fallback). No account, credentials or IAM are involved, and no player
  data is sent. The server reads it once for everyone (`server/src/news/`): every 3 minutes, waiting 15 minutes after a
  failure, with a 5 s timeout, a 4 MB cap and no redirects, from allow-listed hosts only. Each incident is
  `{id, region|'global', regionName?, azIds?, severity: informational|degradation|disruption, status: open|resolved,
  title, services[], serviceCount, serviceIds[], started, updated, log[{at, text}]}`. AWS's text is untrusted data: tags
  and control characters are removed, it's trimmed, and it's never given to a model. `serviceIds` map through
  `shared/aws-health-services.json` (verified codes only), and `azIds` keep only the Region's own zone IDs. An incident
  that leaves the dashboard becomes `resolved` and stays for a day. `stale: true` means the dashboard couldn't be read and
  these are the last known incidents. Sent on connect and when the incidents change; the frame stays under 64 KB.
  `drill: true` exists only in the demo (a practice event the game made up).
- `aws.news {asOf, items[{id, title, url, date, serviceIds[]}]}`: the latest AWS What's New announcements, read hourly.
  `url` is always an `https://aws.amazon.com/` page.
- The city shows these as a ticker over the map and an incident card. An affected Region pulses on the world map. In
  its city, the affected landmarks are fenced and dark, a Region-wide event brings rain, and the islands of the AZs
  named in the updates are marked. This is one of two exceptions to "ambience never means AWS activity": it's AWS's own
  status, not the player's account. (The other: each of the account's `links[]` drives through its city as a data
  carrier, see `city.inventory`.)

**v2.7 addition, each Region is its own city (optional, client-side only):**
- `Progress.cities?: {[regionCode]: {landmarks: {[serviceId]: {discovered, xp}}}}`. Like real AWS, what's built in one
  Region isn't in another, and a new Region's city starts empty. Global services (`shared/region-facts.json` `global`:
  IAM, Route 53, CloudFront) stay in `Progress.landmarks` and stand in every city. Cards, quests, puzzles, games, citizens
  and the streak are the player's own and follow them everywhere. A save from before v2.7 keeps every landmark in
  `landmarks`; the client moves its Region landmarks into the city the player was building (`migrateCities` in
  `src/state/cities.ts`). The server stores the field as-is (`server/src/contract/progress.ts` validates the Region code
  and caps the count), and copies merge city by city.

### The one rule that makes it feel alive

Send `agent.state working` right before every real AWS call made for an agent, and `idle` right after.
Both backends follow it. The server never sends it for background polling.

### Approvals on `aws` (server)

1. An agent's write tool call is parsed, then checked by policy: it must be a game-owned resource and within the limits.
2. `approvals.request` sends a `deploy.preview` (`server/src/contract/approvals.ts`).
3. The player sends `deploy.approve`. The server sends `deploy.status creating`, re-checks policy inside the write lock, executes, then sends `deploy.status complete` or `failed`.
4. Requests with no answer expire after 5 minutes, and closing the socket rejects all pending requests. With no approval channel, every write is refused and only reads run (`server/src/agents/service.ts`; proof: `server/test/service.test.ts`).

## Console Copilot (v2.1)

Agents act in the player's live, logged-in AWS console, one visible step at a time, and teach the *why* for each step.

**Flow:**
1. **The content script** (`src/entrypoints/console.content.ts`) sends a snapshot of the page's interactive elements. It includes id, role, accessible name, section and state. It sends labels only; it never reads secret fields.
2. The runtime sends `console.start {taskId, goal, context, snapshot}`.
3. The backend answers with `console.step {taskId, index, agentId, action, target{id,name}, value?, say, why, risk}`. The `action` is one of `click`, `type`, `select`, `point` or `done`.
4. The page shows the step: an orange highlight plus the agent's bubble with what and why. It then performs the step and replies with `console.observe {taskId, index, ok, note?, snapshot}`.
5. Steps repeat until `done`. The game shows each step in the agent's bubble and the feed.
6. `console.stop {taskId}` stops the task. The player can also stop it from the Stop chip on the page, the Stop button in the city, or Esc.

**Safety** (`src/console/safety.ts`, which runs in the page no matter what the backend says):
- Risky controls are never clicked by the agent. The page turns them into a green "your turn" highlight that waits for the player's click. The server also sets `risk:'confirm'` on them.
  - Risky means: delete, terminate, remove, empty, public access, IAM admin or access keys, billing, account settings, sign-out.
- Nothing is typed into secret fields.
- It runs only on `https://*.console.aws.amazon.com`, never on sign-in pages, and only during a Copilot task the player started.
- There's a limit of 25 steps, and it stops after 3 failures.

**Backends:**
- The mock (`src/backend/consoleMock.ts`) has scripted walkthroughs driven by the live snapshot: S3 create bucket, EC2 launch instance, DynamoDB create table and Lambda create function (`npm run smoke:copilot` runs all four against fixtures).
- The server (`server/src/contract/console.ts`) uses Claude on Bedrock with the `next_console_step` tool, validated with zod, so it works on any console page.

**v2.8 additions, live traffic (optional):**

- `flow.enable {on}`: turns live traffic on or off (also kept as `Progress.flow`; the client sends it on every connect
  once it has pulled the account's progress). Off by default.
- `city.flow {region, windowMin, rates: [{id, serviceId, kind: requests|invocations|writes, perMin, byAz?, label}], takenAt}`:
  the account's request counts over the last `windowMin` (15) minutes, per minute, from CloudWatch Metrics Insights:
  load balancer `RequestCount` by Availability Zone, Lambda `Invocations`, API Gateway `Count` and DynamoDB
  `ConsumedWriteCapacityUnits` (`server/src/state/flow.ts` `FLOW_QUERIES`, fixed text; one query per `GetMetricData`
  call, which is all the API takes). Read only while it's on and a tab is open, at most every 5 minutes and 96 times a
  day; CloudWatch charges per metric analyzed (about a cent a day for a learner). If it can't be read:
  `city.flow {unavailable, takenAt}`, one plain sentence (a denied read asks for the updated player role, v4).
- The city drives request cars for these rates (`carsPerMinute`, log-scaled, at most 6 a minute per source, inside
  the data-carrier cap): from the highway to the AZ islands that served the load balancer's requests, and to each
  other service's building.

**v2.9 additions, golden tokens (optional):**

- `Progress.finds?: {[tokenId]: 'YYYY-MM-DD'}`: the golden tokens the player found walking round their cities
  (`src/world/tokens.ts`, six per city, ids `<regionCode>:<n>`), with the local date each was found. Merged as a union;
  the earlier date wins. The server stores it like the rest of `Progress` (at most 1,000 entries).

