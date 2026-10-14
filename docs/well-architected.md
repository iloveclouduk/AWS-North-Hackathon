# AWS Well-Architected review

How AWS City maps to the six pillars of the [AWS Well-Architected Framework](https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html)
and the Generative AI, Serverless and SaaS lenses. Every claim points at the code and the command that proves
it; if a command disagrees with this page, the page is wrong — fix it. Open gaps are listed honestly at the end.

**Proof commands used below**

| Short name | Command |
|---|---|
| `server-tests` | `cd server && npx tsc --noEmit -p . && npm test` |
| `infra-tests` | `cd infra && npx tsc --noEmit -p . && npm test` |
| `nag` | `cd infra && npx cdk synth -q -c env=staging && npx cdk synth -q -c env=prod` (cdk-nag AwsSolutions; every acknowledgement carries a reason) |
| `ext-tests` | `npm run check` |
| `smoke` | `npm run smoke && npm run smoke:copilot` (must print "no page errors") |

## Architecture in one paragraph

A Chrome extension talks to one Node server (`server/`) over a WebSocket. Hosted, the server runs on **ECS
Fargate (Graviton)** behind **CloudFront + AWS WAF** and an internal ALB, signs players in with **Amazon
Cognito**, keeps state in **DynamoDB** (KMS, PITR, AWS Backup) and **S3**, calls **Claude on Amazon Bedrock**,
and grounds answers in the read-only **AWS Knowledge MCP server**. Each player's AWS changes happen in *their
own* account through a cross-account role (`AWSCityPlayerRole-<region>`; `AWSCityPlayerRole-staging-<region>` on staging; ExternalId) and only after the player
approves a preview. Everything is CDK (`infra/`).

Why containers, not Lambda + API Gateway WebSockets: sockets stay open for a whole session, and an agent turn
can wait minutes for the player's approval; a long-lived process holds that state simply
(`infra/lib/service-stack.ts`, header comment).

## Operational excellence

| Practice | Evidence | Proof |
|---|---|---|
| Infrastructure as code, tested | `infra/` CDK app; assertion tests in `infra/test/stacks.test.ts` | `infra-tests`, `nag` |
| CI gates every change | `.github/workflows/ci.yml`: type checks, tests, smoke runs, Docker build, `cdk synth` with cdk-nag, cfn-lint on the player role, `npm audit` | CI |
| Safe deploys | OIDC deploy role (no keys); staging deploys the exact commit CI tested (`workflow_run.head_sha`); the prod `cdk diff` is in the staging run summary; prod needs a reviewer (`.github/workflows/deploy.yml`) | — |
| Automatic rollback | ECS circuit breaker + deployment alarm on 5xx (`enableDeploymentAlarms`, `service-stack.ts`) | `infra-tests` ("a bad deploy rolls back") |
| Graceful shutdown | SIGTERM drain: fail `/health`, wait up to 100 s for agent turns, close with 1012 (`server/src/http.ts` `drain`) | `server-tests` |
| Structured logs and metrics | JSON logs with hashed player ids, EMF metrics in `AWSCity` (`server/src/log.ts`); a dashboard and alarms (`service-stack.ts`) | — |
| Runbook | `docs/runbook.md`: first deploy, kill switch, alarms, restores, support | — |

## Security

| Practice | Evidence | Proof |
|---|---|---|
| Identity: Cognito with PKCE, no client secret | `infra/lib/auth-stack.ts` | `infra-tests` ("public PKCE client") |
| **Step-up MFA before an AWS account can be linked** | Server refuses `account.link`/`verify` until TOTP is on (`server/src/accounts/mfa.ts`); the extension enrols it (`src/backend/auth.ts` `startTotp`/`confirmTotp`) | `server-tests` ("linking an AWS account needs MFA first"), `ext-tests` (`tests/auth.test.ts`) |
| Threat protection (prod) | Cognito Plus, enforced; high risk blocked, leaked passwords blocked (`auth-stack.ts`) | `infra-tests` |
| Tokens never in URLs; sockets don't outlive tokens | JWT in `Sec-WebSocket-Protocol`; socket closes after expiry once idle, and on `DELETE /me` (`server/src/http.ts`) | `server-tests` |
| Least-privilege task role | Only the actions the server calls, scoped to our resources (`service-stack.ts`) | `nag` |
| **Cross-account access without a confused deputy** | Trust = our account root + `aws:PrincipalArn` pinned to the task role + per-player `sts:ExternalId`; the trusted account is baked in at publish time, never a parameter (`infra/player-role/player-role.yaml`) | `server-tests` (`test/player-role.test.ts`) |
| The player role allows exactly what the server calls | Template vs SDK commands checked in CI; tiny instances, IMDSv2, encrypted volumes, tagged resources only | `server-tests` (`player-role.test.ts`) |
| **Every AWS write needs the player's approval** | `deploy.preview` → `deploy.approve`; without an approval channel every write is refused (`server/src/agents/service.ts`) | `server-tests` (`service.test.ts`, `approvals.test.ts`) |
| Edge protection | AWS WAF managed rules + per-IP rate limit at CloudFront; logs to `aws-waf-logs-*` with tokens redacted (`infra/lib/waf.ts`) | `infra-tests` |
| Network | Internal ALB reachable only from CloudFront's prefix list; tasks accept only the ALB | `nag` |
| Encryption | DynamoDB with a rotated customer-managed KMS key (it holds ExternalIds); S3 SSE + TLS-only; HTTPS everywhere | `infra-tests` |
| Config can't silently weaken | Unknown modes/typos fail startup; token mode is loopback-only (`server/src/config.ts`) | `server-tests` (`hosted.test.ts`) |
| Untrusted text stays data | AWS docs, resource names, page titles and console labels are stripped/escaped before prompts (`neutralise`, `escapeTags`); prompts say they're data | `server-tests` (`knowledge.test.ts`, `runner.test.ts`) |
| No internal details to players | Hosted errors show a reference, details go to logs (`server/src/log.ts` `publicError`) | `server-tests` (`log.test.ts`) |
| Supply chain | Dependabot (npm, actions, Docker), CodeQL, `npm audit` in CI, actions pinned by SHA, base image pinned by digest | `.github/` |
| Extension privacy | Only AWS console/docs page context is sent; links from the server open only if they're AWS console URLs (`src/app/runtime.ts`) | `ext-tests` (`tests/privacy.test.ts`) |

## Reliability

| Practice | Evidence | Proof |
|---|---|---|
| Multi-AZ | VPC across 2 AZs; prod runs ≥2 tasks with target-tracking autoscaling | `nag` |
| Timeouts and retries on every dependency | AWS SDK: 3 s connect / 10 s request, 3 attempts, adaptive retry (`server/src/aws.ts` `SDK_DEFAULTS`); Bedrock 90 s; MCP with timeout + circuit breaker | `server-tests` |
| No orphaned work | Account link/verify/delete serialised per player; replaced pollers are stopped (`server/src/tenants.ts`) | `server-tests` (`tenants.test.ts`) |
| Bounded fan-out | Poller pages listings (≤200 per service), ≤5 concurrent table calls, caches tags (`server/src/state/poller.ts`) | `server-tests` (`poller.test.ts`) |
| A stray error can't take every player down | Fire-and-forget promises are caught; `unhandledRejection` is logged and counted (`server/src/main.ts`) | — |
| Backups | PITR (35 days) + AWS Backup daily, monthly kept a year; deletion protection; RETAIN (`infra/lib/data-stack.ts`) | `infra-tests` |
| Alarms | 5xx, unhealthy hosts, tasks below minimum, Bedrock throttling, DynamoDB throttling, quota spikes | `infra-tests` |
| Reconnects | Extension backs off with jitter, honours reauth/restart close codes (`src/backend/ServerBackend.ts`) | `ext-tests` (`server-backend.test.ts`) |
| Progress never lost between surfaces | Side panel, full tab and server copies are merged, not overwritten (`src/state/progress.ts`) | `ext-tests` (`progress-merge.test.ts`) |

## Performance efficiency

| Practice | Evidence |
|---|---|
| Graviton (ARM64) Fargate tasks | `service-stack.ts` |
| HTTP/2 + HTTP/3 at CloudFront; WebSocket idle timeout above the 25 s ping | `service-stack.ts` |
| Right model and effort per route | Opus for agent turns; low effort for routing, chat, page classification and Copilot steps; the lighter model for classification (`server/src/contract/*.ts`) |
| Prompt caching | The agent system prompt is cached (`server/src/agents/runner.ts`); `CacheReadTokens` metric shows the hit rate |
| Gateway endpoints | S3 and DynamoDB traffic stays in the VPC |

## Cost optimization

| Practice | Evidence |
|---|---|
| Hard spend stop | AWS Budgets action denies Bedrock at 100% of the monthly budget — always created, even without an email (`infra/lib/budget-stack.ts`); alerts at 50%, 80% and forecast overrun |
| Kill switch | SSM parameter turns all model calls off in ~30 s |
| Per-player and global quotas | Atomic DynamoDB counters; the refusal fallback counts too (`server/src/agents/metered.ts`) |
| Token visibility | `InputTokens` / `OutputTokens` / `CacheReadTokens` metrics |
| No NAT gateways; on-demand DynamoDB; short retention | Screenshots 1 day, logs 1 month, access logs 90 days, old template versions 90 days |
| One WAF, not two | Behind CloudFront only the edge WAF runs (`service-stack.ts`) |

## Sustainability

Graviton, scale-to-load, short data retention, the lighter model and low effort where they're enough, and no
idle NAT. Next: scale staging to zero out of hours.

## Generative AI lens

| Practice | Evidence |
|---|---|
| Human in the loop for every action with side effects | Approval gate (Security above) |
| Tools are validated, never trusted | zod schemas per action + policy checks inside a per-account lock (`server/src/agents/actions.ts`, `policy.ts`) |
| Grounding | AWS Knowledge MCP, allow-listed read-only tools, official AWS hosts only; sources shown to the player |
| Prompt-injection hygiene | Retrieved and AWS-sourced text is data, stripped of tag characters |
| Cost and abuse controls | Quotas, kill switch, budget action, per-player Copilot budget |
| Model behaviour changes are handled | Refusals retried once on the fallback model; no forced `tool_choice` (rejected on Bedrock with thinking on, and always by Claude 5.5-generation models; the defaults are Opus 5 / Sonnet 5, and the rule holds for any configured model) |

## Serverless lens

Fully managed services throughout (Fargate, DynamoDB on-demand, S3, Cognito, Bedrock, CloudFront, WAF).
Fargate instead of Lambda is a deliberate choice (long-lived sockets and approval waits; see above).

## SaaS lens (multi-tenancy)

| Practice | Evidence |
|---|---|
| Tenant = Cognito `sub` | Keys `USER#<sub>`; screenshots under a hashed owner folder, checked on read (`server/src/contract/uploads.ts`) |
| Tenant resources live in the tenant's own account | Silo model for AWS resources via the player role |
| Per-tenant limits | Daily model calls, sockets per player, Copilot budget per player |
| Tenant offboarding | `DELETE /me` removes every item (paginated, retried), screenshots and the Cognito user | `server-tests` |

## Open gaps (next steps, in priority order)

1. **Bedrock Guardrails** (prompt-attack and content filters) and **model invocation logging**. Needs a
   guardrail resource plus headers on InvokeModel, validated against live Bedrock in staging (a guardrail can
   block tool-use turns in ways tests with a fake model won't show).
2. **Distributed tracing** (ADOT / CloudWatch Application Signals). Today: logs, EMF metrics, error refs.
3. **Scoped CDK bootstrap** in the account (`docs/runbook.md` step 3): until then the bootstrap execution
   role is AdministratorAccess.
4. **Per-environment budgets** need the `env` cost allocation tag activated; until then each budget counts the
   whole account (it trips early, never late).
5. **Cross-region backup copy** for disaster recovery (the backup vault is in-region).
6. **Tenant isolation in IAM** for the shared table (STS session policies with `dynamodb:LeadingKeys`); today
   it is enforced by the server's key scheme.
7. `SourceIdentity` on the player-role session: needs a template update by every linked player, so it's
   planned with the next role version.
