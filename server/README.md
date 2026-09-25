# AWS City backend (`server/`)

A local Node 24 + TypeScript server that implements the frontend contract
([`docs/backend-contract.md`](../docs/backend-contract.md), source of truth `src/backend/contract.ts`)
against a **real AWS account** and **Claude on Amazon Bedrock**.

It imports `src/backend/contract.ts`, `src/world/taxonomy.ts` and `src/world/places.ts` directly. Event
types, service ids, agent names and places therefore come from the frontend, and a contract change breaks
this build instead of drifting.

**Why local, not API Gateway + Lambda:** the AWS Workshop Studio account denies CloudFormation and
`iam:CreateRole`, so Lambdas (which need an execution role) can't be deployed. The server runs next to the
browser on `127.0.0.1:8787`, uses the `workshop` AWS CLI profile, and the extension never sees AWS keys.
The contract is transport-shaped (WebSocket + REST), so a Lambda version can replace it later without
frontend changes.

## Connect the frontend

```bash
cd server && npm install && npm start
```

`npm start` prints the values for the repo root's `.env.local`:

```
WXT_BACKEND=aws
WXT_AWS_WS_URL=ws://127.0.0.1:8787/ws
WXT_AWS_API_URL=http://127.0.0.1:8787
```

`AwsBackend` doesn't send a token yet (`getAuthToken` is unset), so allow the extension by origin:
copy its ID from `chrome://extensions` (or `about:debugging` in Firefox), then restart the server with

```bash
EXTENSION_ORIGIN=chrome-extension://<id> npm start     # comma-separate several origins
```

Anything else (curl, tests) must send the printed token: `Authorization: Bearer <token>`, or `?token=` on the WebSocket.

## How the contract is implemented

| Contract | Implementation |
| --- | --- |
| `task.submit` | Concierge (Bedrock) picks the agent and plan → `agent.message` ×2 → `task.plan` → ~4 s walk → the agent's tool loop. Each real AWS call is wrapped in `agent.state working/idle` and advances a `task.step` → `task.done` with XP (15, +5 per AWS write, 3 if it failed). |
| `chat.ask` | The district's agent (keyword-matched, as in the mock) streams a Bedrock answer as `chat.answer` deltas, then `done:true`. |
| `deploy.approve` / `deploy.reject` | The player's answer to a `deploy.preview` raised by an agent's write (v2). |
| `page.classify` | Lookout (Bedrock vision on the uploaded screenshot, or URL/title) → `page.classified` with valid service ids only. |
| `POST /screenshots` | Returns a **single-use, signed upload URL** on this server (a local stand-in for a presigned S3 PUT). Images are kept in memory for 10 minutes. |
| `GET/PUT /progress` | `server/.data/progress.json`; the newest `updatedAt` wins. |
| Live console changes | The poller reads EC2, security groups, DynamoDB, S3, Lambda, RDS and API Gateway every 10 s. Changes become `agent.message` from that landmark's agent, with a short lesson. IAM-denied services are reported by `iam`, and expired credentials as `error`. |

"Agent animation = real AWS activity": `agent.state working` is only sent around real calls (the AWS SDK
or Bedrock) made for that agent, never for background polling.

## What agents can do (guardrails)

Tools are per agent: **ec2** can launch (`t4g.nano`/`t4g.micro` only), stop and start instances;
**dynamodb** can create `city-*` tables; **s3** can create `aws-city-<account>-*` buckets. Every agent can
`describe_resource`, and the others explain.

- Writes only touch resources the game created: tag `managed-by=aws-city` (tables need the tag, not just the name).
- Limits: 3 live instances, 5 tables, 3 buckets. Writes are serialised, and just-created resources count before AWS lists them.
- **Every write asks the player first** (contract v2): the agent's tool call becomes a `deploy.preview` in the city's Deploy tab, and runs only after `deploy.approve` (`src/contract/approvals.ts`). Policy is checked before asking and again after approval. Terminate/delete are therefore possible, but only with an explicit approval. Requests time out after 5 minutes, and closing the socket rejects them. Clients without v2 (no approval channel) keep the old behaviour: creates run, destructive actions are refused.
- zod validation on every tool call and WebSocket frame. Extra fields are rejected; region and instance types are fixed.
- The server listens on loopback only, checks the Host header (DNS-rebinding guard), and checks the Origin allowlist. It also enforces body and upload size limits, caps connections, tasks (2) and chat/classify requests (3) per socket, and never crashes on client resets.
- Known limitation: if a socket closes mid-task, that task's remaining events are dropped (the frontend shows it as still running).

## Commands

```bash
npm start        # run (tsx)
npm test         # 45 unit tests, no AWS calls (they include the frontend contract assertions)
npm run build    # type-check
```

| Env var | Default | |
| --- | --- | --- |
| `AWS_CITY_PROFILE` | `workshop` | AWS CLI profile |
| `AWS_CITY_REGION` | `us-west-2` | |
| `PORT` | `8787` | |
| `EXTENSION_ORIGIN` | unset | extension origin(s) allowed without a token |
| `AWS_CITY_TOKEN` | random per start | fix it to keep the same token across restarts |
| `AWS_CITY_MODEL` | `us.anthropic.claude-opus-5` | Bedrock inference profile |
| `AWS_CITY_FALLBACK_MODEL` | `us.anthropic.claude-sonnet-5` | retried once if the main model refuses |

### Workshop credentials

Workshop Studio keys expire after a few hours. The city then gets an `error` event, and writes are blocked
until you paste fresh keys. The server re-reads the profile every minute, so no restart is needed:

```bash
aws configure set aws_access_key_id     <KEY>    --profile workshop
aws configure set aws_secret_access_key <SECRET> --profile workshop
aws configure set aws_session_token     <TOKEN>  --profile workshop
```

### Bedrock route

In this account, Bedrock's Messages-API endpoint (`bedrock-mantle`) only serves Haiku 4.5. Opus 5 and
Sonnet 5 are reachable through `bedrock-runtime` inference profiles, so `src/agents/llm.ts` uses
`AnthropicBedrock` from `@anthropic-ai/bedrock-sdk`.

## Layout

```
src/world.ts              re-exports the frontend's contract, taxonomy and places
src/contract/             orchestrator (task/chat/lookout), aws-feed (console → messages), uploads, progress
src/agents/               actions (allowlist → tools), policy, service (serialised writes), executor (AWS SDK),
                          runner (tool loop), llm (Bedrock), personas (built from places.ts)
src/state/                poller (AWS reads), diff, model
src/translate/lessons.ts  short lessons per resource kind and state
src/http.ts               REST + WebSocket, auth, guards
```
