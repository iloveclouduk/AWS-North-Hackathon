# Backend contract v2.2

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
| `agentcore` | Strands swarm on Bedrock AgentCore Runtime (branch `parked/agentcore-backend`) | A single WebSocket. The Cognito JWT goes in `Sec-WebSocket-Protocol` and is never put in the URL. | Curated CloudFormation templates into the player's own account |

The workshop account denies CloudFormation and `iam:CreateRole`, so `aws` is the backend in use.

## Client → server

| Command | Fields | Notes |
|---|---|---|
| `task.submit` | `taskId, prompt, context{url,title,serviceId,screenshotKey}, questId?` | The server rejects unknown fields; the adapter strips `questId`. |
| `chat.ask` | `requestId, districtId, question, context` | |
| `page.classify` | `requestId, context` (with `screenshotKey` or url/title) | |
| `deploy.approve` / `deploy.reject` | `deployId` | The player's answer to a `deploy.preview`. Nothing changes in AWS without `deploy.approve`. |
| `deploy.plan` | `requestId, templateId` | On `aws`, `ServerBackend` sends it to the matching agent as a prompt (`GUARDED_BLUEPRINTS`). |
| `deploy.teardown` | `deployId` | On `aws`, it asks the agent to demolish what was built (that also needs approval). |
| `account.link` | `requestId, region` | Hosted: returns `account.linkUrl` (CloudFormation quick-create for `infra/player-role/player-role.yaml`, with the player's ExternalId). |
| `account.verify` | `requestId, roleArn` | `roleArn` may be just the 12-digit account id. The server assumes the role and checks the caller identity before linking. |
| `progress.get/put`, `screenshot.presign`, `quest.start` | | On `aws`/`hosted`, handled over REST (`/progress`, `/screenshots`) or locally by `ServerBackend`. `DELETE /me` removes everything stored for the player. |

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
- `error.code`: `quota` (the player's daily AI calls are used up), `paused` (the city's AI is switched off), `auth` (sign in again) or `unlinked` (connect an AWS account first). The UI shows friendly text for each.
- `sources: [{title, url}]` on `task.done` and on the final `chat.answer`: the AWS documentation pages (docs.aws.amazon.com / aws.amazon.com only) the answer was grounded in, from the AWS Knowledge MCP server.
- WebSocket close codes: `4401` = reconnect with a fresh token, `1012` = server restarting (reconnect with jitter), `4429` = too many tabs.

### The one rule that makes it feel alive

Send `agent.state working` right before every real AWS call made for an agent, and `idle` right after.
Both backends follow it. The server never sends it for background polling.

### Approvals on `aws` (server)

1. An agent's write tool call is parsed, then checked by policy: it must be a game-owned resource and within the limits.
2. `approvals.request` sends a `deploy.preview` (`server/src/contract/approvals.ts`).
3. The player sends `deploy.approve`. The server sends `deploy.status creating`, re-checks policy inside the write lock, executes, then sends `deploy.status complete` or `failed`.
4. Requests with no answer expire after 5 minutes, and closing the socket rejects all pending requests. Clients without v2 keep the old behaviour: creates run, and destructive actions are refused.

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
