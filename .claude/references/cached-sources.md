# Cached upstream sources (opensrc)

Check behaviour against these before guessing. Re-fetch whenever the installed version changes:
`npx opensrc fetch wxt phaser`. The versions must match `npm ls wxt phaser`.

| Package | Version | Path (`npx opensrc path <pkg>`) | Why it's cached |
|---|---|---|---|
| wxt | 0.21.4 | `~/.opensrc/repos/github.com/wxt-dev/wxt/0.21.4` | Entrypoint discovery (sidepanel → `side_panel` + auto `sidePanel` permission: `packages/wxt/src/core/utils/manifest.ts`), env prefix `WXT_`/`VITE_` (`core/builders/vite/index.ts`), `srcDir` / alias rules (`core/resolve-config.ts`) |
| phaser | 4.2.1 | `~/.opensrc/repos/phaserjs@github.com/phaserjs/phaser/4.2.1` | v4 breaking changes (`changelog/v4/4.0/MIGRATION-GUIDE.md`): no `setTintFill`, `roundPixels` is off by default, masks are now filters. `TextureManager.addSpriteSheet` accepts a canvas (used by `src/game/sprites.ts`). Pointer event `stopPropagation` semantics (`src/input/InputPlugin.js`). |
| @strands-agents/sdk (TS) | 1.20.0 | `~/.opensrc/repos/github.com/strands-agents/harness-sdk/typescript/v1.20.0/strands-ts` (`npx opensrc fetch github:strands-agents/harness-sdk@typescript/v1.20.0`; the plain package name mis-resolves to the Python tag) | **Installed** in `server/` for the citizens (`server/src/citizens/`). `AnthropicModel` takes an injected client (`src/models/anthropic.ts:138-168`) and calls `client.messages.stream` (`:250`); the only forced `toolChoice` is structured output (`src/agent/agent.ts` structuredOutputChoice); `limits.turns` (`src/types/agent.ts:155`); `BeforeToolCallEvent.cancel` (`src/hooks/events.ts:258`); `toolExecutor: 'sequential'` (`agent.ts:153`); `retryStrategy: null` disables the default model retry; vended HITL `trust` remembers approvals (`src/vended-interventions/hitl/hitl.ts:75`), so it isn't used. 1.20.0 vs 1.19.0: `totalTokens` now includes cache tokens; `agent.shutdown()` added. Peer `@anthropic-ai/sdk ^0.109.1` vs ours 0.128: npm `overrides` in `server/package.json`. |
| strands-agents (Py) | 1.57.0 | `~/.opensrc/repos/github.com/strands-agents/harness-sdk/1.57.0` | Parked AgentCore backend (`parked/agentcore-backend`) |
| strands-agents/tools | main (v0.8.9) | `~/.opensrc/repos/github.com/strands-agents/tools/main` | Why NOT `use_aws`: substring "mutative" check `src/strands_tools/use_aws.py:417-447` is weaker than our `policy.ts` |
| aws/agent-toolkit-for-aws | main (2026-09-25) | `~/.opensrc/repos/github.com/aws/agent-toolkit-for-aws/main` | Source of `server/src/agents/guidance.ts` (Apache-2.0); WA procedure `skills/core-skills/aws-well-architected-review/`; T4g unlimited-credit warning `skills/core-skills/aws-compute/SKILL.md:20` |
| aws/mcp-proxy-for-aws | main | `~/.opensrc/repos/github.com/aws/mcp-proxy-for-aws/main` | The managed AWS MCP Server exposes `aws___run_script` (full API access) — agents must never connect to it |
| @modelcontextprotocol/sdk | 1.32.1 | `~/.opensrc/repos/github.com/modelcontextprotocol/typescript-sdk/1.32.1` | StreamableHTTP client for the AWS Knowledge MCP server `https://knowledge-mcp.global.api.aws` (no auth; read-only tools `aws___search_documentation` / `read_documentation` / `retrieve_skill`, verified live 2026-09-25) — `server/src/knowledge/mcp.ts` |
| @cdklabs/deploy-time-build | 0.1.11 | `~/.opensrc/repos/github.com/cdklabs/deploy-time-build/0.1.11` | Deploys need no local Docker: `ContainerImageBuild` (`src/container-image-build.ts`) zips the build context as a CDK Asset (honours `exclude`/`ignoreMode`, else `.dockerignore`), builds in a singleton CodeBuild project (`aws/codebuild/amazonlinux2-aarch64-standard:3.0` for ARM64), pushes to a scan-on-push ECR repo. Used by `infra/lib/service-stack.ts`. |
| web-ext | 10.7.0 | — (npm) | Firefox runner/linter for `npm run dev:firefox`, `lint:firefox`, `live -- --browser firefox`; WXT 0.21.4 peer-depends on `>=9.2.0`. |

Not cached (plain web platform): `chrome.sidePanel`, `chrome.tabs.captureVisibleTab`. See
developer.chrome.com. Still unverified: whether opening the side panel from the toolbar grants
`activeTab`. The Lookout falls back to requesting the optional `<all_urls>` permission.
