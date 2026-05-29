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
| `fgs login` | Sign in with GitHub via the device-authorization flow. Token cached at `~/.fas/config.json` (`0600`). |
| `fgs logout` | Clear the cached session. |
| `fgs whoami` | Print the currently signed-in GitHub login. |
| `fgs doctor` | Health check — Node, git, pnpm, config, signed-in state, API reachability. |
| `fgs init <game-id> [--template canvas\|grid\|3d\|cards\|phaser\|kaplay\|pixi\|babylon]` | Scaffold a new game. Default is `canvas` (2D arcade). |
| `fgs check [--dir <path>]` | Run compliance checks. Exits non-zero on hard failures. |
| `fgs publish` | Provisions repo + hosting route + storefront entry. Auto-runs `fgs check` first. |
| `fgs list` (alias `fgs ls`) | List your published games. |
| `fgs logs <id>` | Tail the live deployment logs. |

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
