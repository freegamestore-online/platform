# @freegamestore/cli

The `fgs` CLI for [FreeGameStore](https://freegamestore.online) creators. Games-first: every command targets the games store with no extra flags.

## Install

```bash
npm i -g @freegamestore/cli
```

Requires Node 22+.

## Quick start

```bash
fgs login              # GitHub device-flow auth
fgs init asteroids     # scaffold from template-game-canvas
cd asteroids
pnpm install && pnpm dev
fgs check              # compliance checks
fgs publish            # provisions repo + hosting + DNS at <id>.freegamestore.online
git push upstream main # auto-deploys via CI
```

Live in 30 seconds at `https://asteroids.freegamestore.online`.

## Commands

| Command | What it does |
|---|---|
| `fgs login` | Sign in with GitHub via the device-authorization flow. Platform session cached at `~/.fgs/config.json` (`0600`); the GitHub token is discarded after exchange. |
| `fgs logout` | Clear the cached session. |
| `fgs whoami` | Print the currently signed-in GitHub login. |
| `fgs doctor` | Health check — Node, git, pnpm, config, signed-in state, API reachability. |
| `fgs init <game-id> [--template canvas\|grid\|3d\|cards\|phaser\|kaplay\|pixi\|babylon\|excalibur\|littlejs]` | Scaffold a new game. Default is `canvas` (2D arcade). |
| `fgs check [--dir <path>]` | Run compliance checks. Exits non-zero on hard failures. |
| `fgs publish` | Provisions repo + hosting route + storefront entry. Auto-runs `fgs check` first. |
| `fgs list` (alias `fgs ls`) | List your published games. |
| `fgs logs <id>` | Tail the live deployment logs. |
| `fgs admin transfer-owner <id> --from <login> --to <login> --reason <text>` | Admin only. Moves a game to a new owner, refused unless `--from` is the current owner. Also grants `--to` push on the game repo and revokes `--from`'s access and pending invite; `--keep-from-access` leaves `--from`'s access in place. Undo by swapping `--from` and `--to`. Needs `FGS_ADMIN_TOKEN` (an admin Google session's `fgs_token`), not `fgs login`. |
| `fgs admin transfers <id>` | Admin only. Lists a game's ownership transfers (audit records). |

## Login troubleshooting

If `fgs login` reports `device_flow_disabled`, the owner of FreeGameStore’s GitHub OAuth app must enable **Device Flow** under the owning personal account or organization’s **Settings → Developer settings → OAuth apps → FreeGameStore**, then save and retry login. FGS uses its own OAuth app; its client ID must match the one used by the FGS auth worker. Switching to FAS’s app will fail the platform’s token exchange.

Device authorization errors retain their HTTP status. Recognized GitHub error identifiers include safe troubleshooting guidance; arbitrary response descriptions, bodies and codes are omitted to avoid exposing credentials or terminal control characters.

## API endpoint overrides

The default API is `https://admin.freegamestore.online`. `FGS_API_BASE` overrides it for the current invocation only and is never saved in the config file. Overrides must be absolute HTTPS URLs. HTTP is allowed only for development on `localhost` or `127.0.0.1`, with an optional port. Empty or whitespace-only values use the default; surrounding whitespace and trailing slashes are removed. Invalid or insecure overrides are rejected before login starts OAuth or sends credentials.

```bash
FGS_API_BASE=http://localhost:8787 fgs doctor
```

## `fgs publish` flags

| Flag | Purpose |
|---|---|
| `--name <id>` | Game id (lowercase, used as subdomain). |
| `--category <name>` | Storefront category. Case-insensitive. |
| `--type standalone\|connected` | Standalone (localStorage only) or Connected. |
| `--oneliner <text>` | One-line description shown on the storefront. |
| `--demo <url>` | Optional demo URL. |
| `--yes` | Non-interactive: missing required fields abort. |
| `--issue` | Skip auto-provision; open the GitHub Issue submission form instead. |
| `--skip-checks` | Skip `fgs check` before publish (not recommended). |

## License

MIT.
