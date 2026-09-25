# Cached upstream sources (opensrc)

Check behaviour against these before guessing. Re-fetch whenever the installed version changes:
`npx opensrc fetch wxt phaser`. The versions must match `npm ls wxt phaser`.

| Package | Version | Path (`npx opensrc path <pkg>`) | Why it's cached |
|---|---|---|---|
| wxt | 0.21.4 | `~/.opensrc/repos/github.com/wxt-dev/wxt/0.21.4` | Entrypoint discovery (sidepanel → `side_panel` + auto `sidePanel` permission: `packages/wxt/src/core/utils/manifest.ts`), env prefix `WXT_`/`VITE_` (`core/builders/vite/index.ts`), `srcDir` / alias rules (`core/resolve-config.ts`) |
| phaser | 4.2.1 | `~/.opensrc/repos/phaserjs@github.com/phaserjs/phaser/4.2.1` | v4 breaking changes (`changelog/v4/4.0/MIGRATION-GUIDE.md`): no `setTintFill`, `roundPixels` is off by default, masks are now filters. `TextureManager.addSpriteSheet` accepts a canvas (used by `src/game/sprites.ts`). Pointer event `stopPropagation` semantics (`src/input/InputPlugin.js`). |
| @strands-agents/sdk (TS) | 1.19.0 | `~/.opensrc/repos/github.com/strands-agents/harness-sdk/1.19.0/strands-ts` (tag `typescript/v1.19.0`, 91a4478 — opensrc mis-resolves to the Python v1.19.0 tag; verify with `git -C <path> describe --tags`) | Evaluated, **not installed** (we keep our own loop in `server/src/agents/runner.ts`). Bedrock guardrails/cache `src/models/bedrock.ts:173-307`; McpClient + toolFilters `src/mcp/client.ts:78-150`; Swarm/Graph `src/multiagent/swarm.ts:133`, `graph.ts:139`; HITL `src/vended-interventions/hitl/hitl.ts:40` |
| strands-agents (Py) | 1.57.0 | `~/.opensrc/repos/github.com/strands-agents/harness-sdk/1.57.0` | Parked AgentCore backend (`parked/agentcore-backend`) |
| strands-agents/tools | main (v0.8.9) | `~/.opensrc/repos/github.com/strands-agents/tools/main` | Why NOT `use_aws`: substring "mutative" check `src/strands_tools/use_aws.py:417-447` is weaker than our `policy.ts` |
| aws/agent-toolkit-for-aws | main (2026-09-25) | `~/.opensrc/repos/github.com/aws/agent-toolkit-for-aws/main` | Source of `server/src/agents/guidance.ts` (Apache-2.0); WA procedure `skills/core-skills/aws-well-architected-review/`; T4g unlimited-credit warning `skills/core-skills/aws-compute/SKILL.md:20` |
| aws/mcp-proxy-for-aws | main | `~/.opensrc/repos/github.com/aws/mcp-proxy-for-aws/main` | The managed AWS MCP Server exposes `aws___run_script` (full API access) — agents must never connect to it |
| @modelcontextprotocol/sdk | 1.30.1 | `~/.opensrc/repos/github.com/modelcontextprotocol/typescript-sdk/1.30.1` | StreamableHTTP client for the AWS Knowledge MCP server `https://knowledge-mcp.global.api.aws` (no auth; read-only tools `aws___search_documentation` / `read_documentation` / `retrieve_skill`, verified live 2026-09-25) — `server/src/knowledge/mcp.ts` |

Not cached (plain web platform): `chrome.sidePanel`, `chrome.tabs.captureVisibleTab`. See
developer.chrome.com. Still unverified: whether opening the side panel from the toolbar grants
`activeTab`. The Lookout falls back to requesting the optional `<all_urls>` permission.
