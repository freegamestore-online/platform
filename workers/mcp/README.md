# freegamestore-mcp

Remote MCP server for **FreeGameStore** — build, publish, and improve PWA games
from your editor (Cursor, Claude, Claude Code, …).

```
claude mcp add freegamestore -- npx mcp-remote https://mcp.freegamestore.online/mcp
```

Two ways to build, both from the editor:

1. **Your model writes the code, the MCP ships it** — `create_game` scaffolds + provisions a live game, then `update_files` improves it (auto-deploys to `<id>.freegamestore.online`).
2. **The platform's VibeCode agent writes + deploys it, you just prompt** — `agent_build('make a tetris clone and deploy it as my-tetris')`, then `agent_status`.

Tools: `create_game`, `update_files`, `read_file`, `list_files`, `agent_build`,
`agent_status`, `list_games`, `deploy_status`, `game_info`, `game_logs`,
`platform_guide`, `sdk_reference`.

Authenticated tools take an FGS session token: `Authorization: Bearer <token>`.
`mcp-remote` handles the OAuth/token handoff.

Cloudflare Worker (`agents` McpAgent, Streamable HTTP). See `CLAUDE.md` for
architecture, secrets, and the gotchas. MIT.

## Canonical source

**This directory is the canonical FreeGameStore MCP server.** The standalone
`freegamestore-online/mcp` repo is private and archived (last pushed 2026-07-13)
and is not deployed from — `mcp.freegamestore.online` is built and released from
here by `.github/workflows/deploy-mcp.yml`. Send changes here; do not revive the
standalone repo.

## Auth

Sign-in is delegated to the platform auth worker (`auth.freegamestore.online`),
so this server holds no GitHub OAuth app of its own. It is the OAuth
Authorization Server for MCP clients, via `@cloudflare/workers-oauth-provider`.
Three application-level controls sit on top of the library, all in
`src/auth-handler.ts`:

- **PKCE (S256) is mandatory.** `/authorize` rejects a missing `code_challenge`,
  and any `code_challenge_method` other than `S256`, with a 400. The library only
  verifies PKCE when a challenge is present, so the check has to be ours.
- **The callback is bound to the browser that started it** by a `__Host-`
  prefixed nonce cookie matched against the stashed request — the library sets no
  cookies and the `state` it round-trips is the client's own.
- **`userId` is colon-sanitized** before it reaches the library, which packs
  tokens as `userId:grantId:secret`.

Not yet implemented: an explicit consent page. See issue #32.
