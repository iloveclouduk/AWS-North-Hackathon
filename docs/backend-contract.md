# Backend contract (for the AWS team)

The frontend is finished against this contract and runs today on an in-browser mock
(`src/backend/MockBackend.ts`). Build the AWS side to emit the same events, set
`WXT_BACKEND=aws` plus the two URLs in `.env.local`, and the city comes alive with no frontend changes.

**Source of truth:** `src/backend/contract.ts`. If this doc and that file disagree, the file wins —
fix this doc. `npm test` (see `tests/contract.test.ts`) proves the mock obeys the contract; copy those
assertions for your Lambda tests.

## Transport

| What | AWS service | Notes |
|---|---|---|
| Live events + commands | **API Gateway WebSocket API** | Route selection expression: `$request.body.action`. Routes: `task.submit`, `chat.ask`, `page.classify`, plus `$connect` / `$disconnect`. |
| Auth | `$connect` Lambda authorizer | Browsers can't set headers on WebSocket upgrades, so the client sends `?token=<jwt>` (e.g. Cognito ID token). The token hook is `AwsBackendConfig.getAuthToken` in `src/backend/AwsBackend.ts`; it's unset for now. |
| Progress + screenshots | **API Gateway HTTP API** | `GET/PUT /progress`, `POST /screenshots`. The client sends `Authorization: Bearer <jwt>` when a token exists. |
| Screenshot storage | **S3** | `POST /screenshots` returns a presigned PUT URL; the client uploads the JPEG itself. |
| Brains | **Bedrock** (Claude) | Routing the prompt → agent, step planning, Q&A answers, and screenshot vision (Lookout). |
| State | **DynamoDB** | Connections table (connectionId ↔ user) and progress table (userId → Progress). |

A server frame may be one event or an array of events.

## Client → server (WebSocket)

```jsonc
{ "action": "task.submit", "taskId": "uuid", "prompt": "Store my holiday photos cheaply",
  "context": { "url": "https://…", "title": "…", "serviceId": "s3", "screenshotKey": "…" } }

{ "action": "chat.ask", "requestId": "uuid", "districtId": "storage",
  "question": "When should I use EFS?", "context": { … } }

{ "action": "page.classify", "requestId": "uuid",
  "context": { "url": "…", "title": "…", "screenshotKey": "screenshots/abc.jpg" } }
```

## Server → client (WebSocket)

| Event | What the city does |
|---|---|
| `task.plan {taskId, agentId, targetServiceId, steps[]}` | The Concierge dispatches the agent, which walks to its landmark while the camera follows. If the landmark is undiscovered, it gets discovered. |
| `task.step {taskId, index, text, status}` | Speech bubble "Step i/n" plus a line in the activity feed. `status`: `pending`, `running`, `done` or `failed`. |
| `agent.state {agentId, state, service?, detail?}` | **`working` = a real AWS call is running.** The agent plays its work animation (fishing, typing at a computer in the HQ…) and its name tag shows `detail`. Send `idle` when the call finishes. |
| `agent.message {from, to, text}` | Speech bubble plus a ✉️ that flies from one agent to the other. `to` can be `"user"`. |
| `task.done {taskId, ok, result, xp[]}` | Celebration. XP goes to landmarks, which can upgrade their tier. XP to an undiscovered service discovers it. |
| `page.classified {requestId, url?, serviceIds[], summary}` | Lookout result; +3 XP to each service. |
| `chat.answer {requestId, districtId, agentId, delta, done}` | Streams into the HQ chat. Send deltas with `done:false`, then one frame with `done:true`. |
| `error {message, taskId?, requestId?}` | Shown in the feed; marks the task failed. |

### The one rule that makes it feel alive

Wrap every AWS SDK call a Lambda makes on an agent's behalf:

```ts
await emit({ type: 'agent.state', agentId: 's3', state: 'working', service: 's3', detail: 'PutObject photos/1.jpg' });
await s3.send(new PutObjectCommand(...));
await emit({ type: 'agent.state', agentId: 's3', state: 'idle' });
```

`emit` = `ApiGatewayManagementApi.postToConnection({ ConnectionId, Data: JSON.stringify(event) })`.

Agent ids are service ids from `src/world/taxonomy.ts` (`s3`, `lambda`, `iam`, `dynamodb`, `route53`,
`shield`, `bedrock`, …) plus `concierge` (router) and `lookout` (screenshot/vision). District ids:
`storage`, `compute`, `database`, `networking`, `security`, `aiml`.

## REST

```
GET  /progress            → 200 Progress | 404 (new user)
PUT  /progress  Progress  → 204
POST /screenshots {contentType:"image/jpeg", url?, title?} → { uploadUrl, screenshotKey }
```

```ts
interface Progress {
  version: 1;
  landmarks: Record<string /* serviceId */, { discovered: boolean; xp: number }>;
  updatedAt: string; // ISO; the newest copy wins between server and chrome.storage
}
```

Tier thresholds (frontend-side, `src/world/places.ts`): 0 XP = construction site, 10 = Foundation,
40 = Associate, 100 = Professional, 200 = Expert.

## Suggested orchestration (one Lambda per route)

1. `task.submit`: the Concierge Lambda calls Bedrock to pick `agentId` and write `steps[]`, emits
   `agent.message` (concierge → user and concierge → agent), then `task.plan`.
2. It gives the agent about 4 s to walk over, then runs the steps. For each step, emit `task.step running`,
   do the real call wrapped in `agent.state`, and emit `task.step done`.
3. Optionally hand off to another agent (e.g. S3 asks IAM for a role) with `agent.message` both ways.
4. Emit `task.done` with XP.

Mock timings to copy: `src/backend/MockBackend.ts` (`submitTask`, `ask`, `classifyPage`).
