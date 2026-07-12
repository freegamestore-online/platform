# freegamestore-console

The creator console for [FreeGameStore](https://freegamestore.online) — where you
build, publish, and manage your web games.

> **History:** this repo was named `publisher` until 2026-07 (it began as the
> self-service publish worker and grew into the full console). Renamed to
> `console` to match its role and the FAS `console/` repo; an abandoned parallel
> `console` rebuild was archived as `console-deprecated` at the same time. The CF
> Pages project is still `freegamestore-publisher` (internal; it owns the
> `console.freegamestore.online` domain — don't rename it without rebinding).

- **Live:** https://console.freegamestore.online (also `publish.freegamestore.online`)
- **Stack:** React 19 + Vite + Tailwind v4, Cloudflare Pages (SPA) + Pages Functions,
  KV for legacy creator sessions. Auth is the shared `fgs_token` (auth worker).

## What's in it

Three surfaces, one mental model — **My Games is everything you've made**; the studio
is where you build:

- **My Games** (`/`) — your games in one place:
  - **Your Games** — Live games, sourced from the store **registry** (a game you own
    by `creatorGithub`). Play / Code / Edit / Settings.
  - **Drafts** — in-progress VibeCode sessions that haven't deployed yet, sourced from
    the agent's per-user **session index**. Open (resume the session) or Discard.
- **VibeCode** (`/create`) — the studio. Chat with an AI agent (bring your own key)
  that writes the game, runs compliance, and deploys it. The toolbar switches
  sessions, starts new games, and — for the open game — offers **Play + Settings**
  (deployed) or **Discard** (draft).
- **Game Settings** (`/game/:id`) — rename, edit artwork/category, **delete** a Live
  game (delists from the store, drops its route, archives the repo, frees a slot).

### Two data sources (by design)

| Surface | Source | Keyed by | Shows |
|---|---|---|---|
| My Games → Your Games | store registry (`/api/me`) | `creatorGithub` | Live games |
| My Games → Drafts / studio picker | agent `/sessions` (D1) | auth `user.id` | undeployed sessions |

A session becomes a Live game — and moves from Drafts to Your Games — the moment it
deploys. Opening a Live game in the studio **imports** its real repo files into a new
session, so edits `push_update` the existing game instead of overwriting it.

## Layout

```
functions/api/   Pages Functions — auth, /api/me (ownership), create, publish, games/:id
web/             React SPA
  src/pages/     Dashboard, Create (studio), GameSettings, Profile
  src/components/ Nav, StudioToolbar, ProjectPicker, CreateGameForm, ui/ (primitives)
  src/hooks/     useAuth, useAgent, useProjects, useDraftSessions
  src/lib/       ai-keys, models, sessions, format  (pure, unit-tested)
```

Ownership is a **shared contract, not a shared module** (workspace "vendor, don't
depend"): `functions/api/_games.ts` here, mirrored in admin and the agent, each
covered by its own tests.

## Development

```bash
pnpm install
pnpm dev            # Wrangler Pages dev + Vite
pnpm --dir web test # vitest (jsdom) — pure lib logic
pnpm build          # tsc -b + Vite build → web/dist
```

> Tests use an in-memory `localStorage` polyfill (`web/src/test/setup.ts`) — Node's
> experimental global `localStorage` shadows jsdom's and throws otherwise.

## Deploy

Push to `main` → GitHub Actions deploys via Cloudflare Pages. The worker uses the
`CREATORS` + `SESSIONS` KV namespaces (`wrangler.toml`).
