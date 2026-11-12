---
title: MCP Server
description: Connect FreeGameStore to your AI assistant. Client setup, OAuth, game tools, privacy, revocation and support.
---

The FreeGameStore MCP server drives the **full game build loop from inside your editor**. Endpoint: `https://mcp.freegamestore.online/mcp` (Streamable HTTP).

## Connect your assistant

See [Use FreeGameStore in your AI assistant](/build-with-ai#ai-assistants) for client-specific steps for Claude (web, Desktop and mobile), ChatGPT, Gemini CLI / Antigravity, Grok, Claude Code, Cursor, Windsurf and VS Code. Custom connector access depends on your client, subscription and workspace permissions. A custom connection does not imply a live directory listing.

The endpoint is `https://mcp.freegamestore.online/mcp` using Streamable HTTP.

```bash
claude mcp add --transport http freegamestore https://mcp.freegamestore.online/mcp
```

Run `/mcp` in Claude Code to authenticate. For Gemini CLI:

```bash
gemini mcp add --transport http freegamestore https://mcp.freegamestore.online/mcp
```

For Cursor, add to `.cursor/mcp.json`:

```json
{"mcpServers":{"freegamestore":{"url":"https://mcp.freegamestore.online/mcp"}}}
```

VS Code uses `.vscode/mcp.json` with a `servers` object and `type: "http"` instead. Windsurf uses `mcpServers` and `serverUrl` in `mcp_config.json`. Follow the client cards for full instructions.

## Two ways to build

1. **Your editor's AI writes the code, the MCP ships it.** Claude or Cursor generates the game, then calls `create_game` (provision + scaffold a template + deploy) and `update_files` / `read_file` / `list_files` to iterate. Every push auto-redeploys to `<id>.freegamestore.online` in ~30–60s.
2. **You just prompt — the platform's VibeCode agent writes + deploys it.** `agent_build` hands the whole build to the server-side agent; `agent_status` polls progress. FGS's agent is bring-your-own-key — pass an `api_key` for your provider (anthropic/openai/google/github).

## Authentication and permissions

Connect using OAuth, sign into FreeGameStore and review the consent screen. The connector checks your account and game ownership for protected tools. Public reference tools can be used without signing in where the client supports it. Never paste a session token or API key into a public config or issue.

Start by requesting `platform_guide`. Review writes before approving them. Destructive tools require explicit confirmation; use dry-run previews where supported. MCP access tokens last 30 days, and an expired or revoked underlying session requires sign-in again.

## Troubleshooting, revocation and privacy

If sign-in expires, remove and reconnect the connector, then authenticate again. Remove it in your assistant to disconnect. [Sign out](/signout) to invalidate existing FreeGameStore sessions across clients. Removing a connector does not delete published games or VibeCode sessions.

Use `mcp_audit_log` to inspect your own write attempts (retained for 90 days). Manage games and sessions through the creator console. Read [MCP privacy](/privacy#mcp), [terms](/terms#mcp), and [support](/support) for data controls, recipients and contact information.

## Tools

| Tool | Auth | What it does |
|---|---|---|
| `create_game` | session | Provision repo + R2 hosting + listing, scaffold canvas/grid/cards/3d, deploy live. |
| `update_files` | owner | Overwrite files in a game you own → auto-redeploys. |
| `read_file` / `list_files` | none | Read / list a game's repo. |
| `agent_build` | session + BYO key | Hand a prompt to the VibeCode agent; it writes + deploys. |
| `agent_status` | session | Poll an agent build for game id, deploy phase, live URL. |
| `list_games` | session | Your published games. |
| `game_info` / `deploy_status` / `game_logs` | none | Inspect a game. |
| `platform_guide` / `sdk_reference` | none | This guide / the `@freegamestore/games` SDK. |

## Example

```
# Mode 1 — your AI writes it, MCP ships it
create_game(game_id="memory-match", category="puzzle",
            oneliner="Flip cards to find pairs", template="cards")
update_files(game_id="memory-match",
             files=[{path:"web/src/App.tsx", content:"…"}], message="Add a timer")

# Mode 2 — you prompt, the VibeCode agent writes + deploys it
agent_build(prompt="A neon snake game, deploy as neon-snake",
            api_key="sk-…", provider="anthropic")
agent_status(session_id="…")
```
