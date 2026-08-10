# FreeGameStore MCP — Agent Guide

AI-agent tools to build, publish, and improve games on FreeGameStore straight from
your editor. Use FreeGameStore **through this MCP server** — don't scrape the web
console or call the admin/agent workers directly.

Endpoint: `https://mcp.freegamestore.online/mcp` (streamable-http)
Auth: OAuth 2.1 — sign-in is delegated to `auth.freegamestore.online` (GitHub). Your
FGS session token rides along as the caller identity; ownership is enforced server-side.

Connect: `claude mcp add freegamestore -- npx mcp-remote https://mcp.freegamestore.online/mcp`

## Rules

1. **Inspect first.** `whoami`, `list_games`, `list_files`/`read_file` before you change anything.
2. **Prefer read tools.** Only reach for a write tool when the task actually requires a change.
3. **Preview mutations.** `create_game`, `update_files`, `agent_build`, `delete_game`, and
   `discard_session` accept `dry_run: true` — validate before committing.
4. **Confirm destructive actions.** `delete_game` needs `confirm=<game_id>`; `discard_session`
   needs `confirm=<session_id>`. Neither can be undone from here.
5. **You can only change what you own.** Ownership is the `creatorGithub` field in the store
   registry; the admin/agent workers reject writes to games you don't own.
6. **Two ways to build the same game.** Your model authors directly (`create_game` →
   `update_files`), or the platform's VibeCode agent authors from a prompt (`agent_build` /
   `edit_game`). Don't mix both in the same turn on the same game.
7. **Check `isError`.** A failed tool call returns `isError: true` — detect it there rather
   than parsing the message text.

## Capabilities

| Level | Tools | Requires |
|---|---|---|
| Read (open) | `deploy_status`, `game_info`, `game_quality`, `leaderboard`, `platform_guide`, `sdk_reference` | nothing |
| Read (account) | `whoami`, `list_games`, `list_files`, `read_file`, `list_sessions`, `session_history`, `agent_status`, `mcp_audit_log` | FGS session |
| Write (owner) | `create_game`, `update_files`, `agent_build`, `edit_game` | FGS session + ownership |
| Destructive (owner) | `delete_game` (confirm=game_id), `discard_session` (confirm=session_id) | FGS session + ownership |
| Admin (org members) | `admin_list_sessions`, `admin_session_history`, `admin_send_prompt` | platform admin |

`dry_run: true` is available on `create_game`, `update_files`, `agent_build`, `delete_game`,
`discard_session`.

## Workflow recipes

**Build it yourself:** `create_game` (`dry_run: true` first) → `list_files`/`read_file` →
`update_files` (`dry_run: true` to preview the file list) → `deploy_status` to watch it go live.

**Let the agent build it:** `agent_build("make a <X> game … and deploy it")` → `agent_status`
with the returned `session_id` until the deploy phase is `live`.

**Edit an existing game:** `edit_game(game_id, prompt)` re-syncs the repo into a VibeCode
session and runs one agent turn → `agent_status`. Or edit directly with `update_files`.

**Retire a game:** `delete_game(game_id, dry_run: true)` to see what would happen →
`delete_game(game_id, confirm=game_id)`.

**Audit your actions:** `mcp_audit_log` — every write, dry-run, and denial for your account,
newest first.

## Safety

- **Read-only mode:** when the server is deployed with `MCP_READ_ONLY=1`, every write and
  destructive tool returns `isError: true` and the attempt is audited. `whoami` reports the state.
- **Audit trail:** each write / dry-run / denied action is logged to KV for 90 days, keyed to
  your GitHub login, with tokens/keys/secrets redacted (by field name and value shape). Read it
  back with `mcp_audit_log`.
- **Confirmation & ownership:** destructive tools require an exact `confirm` token; you may only
  mutate games registered to your login (admin tools require org membership).

## Not supported via MCP

Manual infra (creating CF Pages projects, DNS, or GitHub repos by hand — provisioning goes
through `create_game`), billing, and account deletion. Games are public and MIT-licensed.
