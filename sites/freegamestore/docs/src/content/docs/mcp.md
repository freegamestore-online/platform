---
title: MCP Server
description: Connect your editor's AI to FreeGameStore via MCP. Build, publish, and improve real games from Cursor or Claude — your AI writes the code, or the platform's VibeCode agent does.
---

The FreeGameStore MCP server drives the **full game build loop from inside your editor**. Endpoint: `https://mcp.freegamestore.online/mcp` (Streamable HTTP).

## Connect

**Claude Code:**

```bash
claude mcp add freegamestore -- npx mcp-remote https://mcp.freegamestore.online/mcp
```

**Cursor / any MCP client** (config form):

```json
{
  "mcpServers": {
    "freegamestore": {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp.freegamestore.online/mcp"]
    }
  }
}
```

## Two ways to build

1. **Your editor's AI writes the code, the MCP ships it.** Claude or Cursor generates the game, then calls `create_game` (provision + scaffold a template + deploy) and `update_files` / `read_file` / `list_files` to iterate. Every push auto-redeploys to `<id>.freegamestore.online` in ~30–60s.
2. **You just prompt — the platform's VibeCode agent writes + deploys it.** `agent_build` hands the whole build to the server-side agent; `agent_status` polls progress. FGS's agent is bring-your-own-key — pass an `api_key` for your provider (anthropic/openai/google/github).

## Authentication

Read-only tools (`platform_guide`, `sdk_reference`, `deploy_status`, `game_info`, `game_logs`, `read_file`, `list_files`) work unauthenticated. Tools that build, mutate, or list your games need an FGS session token — the one `fgs login` caches. Pass it through `mcp-remote`:

```bash
claude mcp add freegamestore -- \
  npx mcp-remote https://mcp.freegamestore.online/mcp \
  --header "Authorization: Bearer <token>"
```

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
