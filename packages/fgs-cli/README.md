# @freegamestore/cli

The `gas` CLI for [FreeGameStore](https://freegamestore.online) creators. Same surface as [`fas`](https://www.npmjs.com/package/@freeappstore/cli) but games-first: every command targets the games store with no extra flags.

Identity is shared with `fas` — `gas login` uses the same `~/.fas/config.json`. If you already have `fas` installed and signed in, `gas` works immediately.

## Install

```bash
npm i -g @freegamestore/cli
```

Requires Node 22+.

## Quick start

```bash
gas login              # GitHub device-flow auth (shared with fas)
gas init asteroids     # scaffold from template-game-canvas
cd asteroids
pnpm install && pnpm dev
gas check              # compliance checks
gas publish            # provisions repo + hosting + DNS at <id>.freegamestore.online
git push upstream main # auto-deploys via CI
```

Live in 30 seconds at `https://asteroids.freegamestore.online`.

## Commands

| Command | What it does |
|---|---|
| `gas login` | Sign in with GitHub via the device-authorization flow. Token cached at `~/.fas/config.json` (`0600`). |
| `gas logout` | Clear the cached session. |
| `gas whoami` | Print the currently signed-in GitHub login. |
| `gas doctor` | Health check — Node, git, pnpm, config, signed-in state, API reachability. |
| `gas init <game-id> [--template canvas\|grid\|3d]` | Scaffold a new game. Default is `canvas` (2D arcade). `grid` for puzzles (Sudoku, Minesweeper). `3d` for Three.js / Babylon. |
| `gas check [--dir <path>]` | Run compliance checks. Exits non-zero on hard failures. |
| `gas publish` | Provisions repo + Cloudflare Pages project + DNS + storefront entry under the games store. Auto-runs `gas check` first. |
| `gas list` (alias `gas ls`) | List all apps and games you've published (across both stores — fas and gas share the same backend). |
| `gas logs <id>` | Tail the live deployment logs for a game's Cloudflare Pages project. |

## `gas publish` flags

Same as `fas publish` minus `--store` (always `games`):

| Flag | Purpose |
|---|---|
| `--name <id>` | Game id (lowercase, used as subdomain). |
| `--category <name>` | Storefront category. Case-insensitive. |
| `--type standalone\|connected` | Standalone (localStorage only) or Connected. |
| `--oneliner <text>` | One-line description shown on the storefront. |
| `--demo <url>` | Optional demo URL. |
| `--yes` | Non-interactive: missing required fields abort. |
| `--issue` | Skip auto-provision; open the GitHub Issue submission form instead. |
| `--skip-checks` | Skip `gas check` before publish (not recommended). |

## Brand and UI rules (enforced)

Every game on the platform shares the same visual language. `gas check` enforces:

- No template placeholders (every `APPNAME` substituted)
- No tracking SDKs
- Brand fonts present (Manrope + Fraunces) — DOM/HTML text only; pixel fonts inside a game canvas are fine
- No brand overrides (no redefining `--accent`, `--paper`, `--ink`, etc. outside the canonical theme file)
- PWA manifest valid
- Main bundle under 300 KB gzipped

Full rules: <https://freegamestore.online/contribute>

## Relationship to `fas`

| | fas | gas |
|---|---|---|
| Targets | FreeAppStore (`*.freeappstore.online`) | FreeGameStore (`*.freegamestore.online`) |
| Org | freeappstore-online | freegamestore-online |
| Templates | standalone, connected | canvas, grid, 3d |
| Identity | `~/.fas/config.json` | same file |

You can install both side-by-side. `fas list` and `gas list` show the same combined list (filterable by store badge).

## License

MIT.
