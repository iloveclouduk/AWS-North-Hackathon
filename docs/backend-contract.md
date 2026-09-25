# Backend contract v2

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
| `progress.get/put`, `screenshot.presign`, `account.link/verify`, `quest.start` | | On `aws`, handled over REST or locally by `ServerBackend`. |

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

### The one rule that makes it feel alive

Send `agent.state working` right before every real AWS call made for an agent, and `idle` right after.
Both backends follow it. The server never sends it for background polling.

### Approvals on `aws` (server)

1. An agent's write tool call is parsed, then checked by policy: it must be a game-owned resource and within the limits.
2. `approvals.request` sends a `deploy.preview` (`server/src/contract/approvals.ts`).
3. The player sends `deploy.approve`. The server sends `deploy.status creating`, re-checks policy inside the write lock, executes, then sends `deploy.status complete` or `failed`.
4. Requests with no answer expire after 5 minutes, and closing the socket rejects all pending requests. Clients without v2 keep the old behaviour: creates run, and destructive actions are refused.
