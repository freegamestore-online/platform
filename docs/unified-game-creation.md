# FGS — Unified Game Creation (as built)

How a FreeGameStore game gets created, edited, and shipped after the 2026-07
unification. This is the **as-built** record; the original planning doc lived in
`publisher/docs/` and is superseded by this one (cross-repo work — admin, agent,
publisher, template-game-canvas — so it belongs in the platform repo).

## One flow, one template, one provision path

There is now a single create → build → publish flow, and **VibeCode is the entry
point** for both new and existing games.

- **A game** = its registry entry `id` = repo `freegamestore-online/<id>`.
  Registry `creatorGithub` (case-insensitive) is the sole ownership signal.
- **The one canonical provision path** is admin's `handlePublish`
  (`POST /api/provision`): it generates the repo from **`template-game-canvas`**
  (with `APPNAME` substituted), writes the D1 host route + registry entry, and
  invites the creator — idempotently, in the order **repo → registry → route** so
  the worst partial failure is *listed-but-unserved* (a self-healing 404), never
  *served-but-invisible*.
- **The one template** is `template-game-canvas` — the SDK-based scaffold
  (`@freegamestore/games`: `GameShell`/`GameTopbar`/`GameAuth`, plus local
  `hooks/` + `lib/canvas.ts`, `tsc -b` build). The agent's old inline, SDK-less
  template is gone from the ship path (kept only as a fetch-failure fallback).

## Creating a game

`Dashboard → "Create Game"` → `POST /api/create` (publisher) → forwards to admin
`/api/provision` → repo + route + registry + collaborator. On success the
Dashboard refreshes and navigates to `/create?game=<id>`, dropping the user into
the studio **bound to the new game** (see "Opening").

`/api/create` authorizes + gates on the SAME registry-primary `owned` list that
`/api/me` uses, so the slot count on the Dashboard and the create gate can never
disagree.

## Remix lineage and immutable attribution

When creation includes `cloneFrom`, admin captures the source registry entry
*before* it creates the target repository. New registry entries store this
immutable snapshot:

```json
"forkedFrom": {
  "id": "space-shooter",
  "name": "Space Shooter",
  "creatorGithub": "someuser",
  "forkedAt": "2026-09-25T00:00:00.000Z"
}
```

The denormalised name and creator preserve a credit after the source is renamed
or removed. `forkedFrom` is excluded from the metadata PATCH allowlist, so a
creator cannot rewrite lineage later. Admin game detail and console game-list
APIs return the object. Existing pre-#44 string values remain readable for
backward compatibility; they are upgraded only when the registry contains every
required source fact and the fork's original `firstPublished` timestamp. Missing
facts remain a string rather than being guessed into attribution.

## Displaying Remix credit

The platform keeps the product term **Remix**. Studio's *My Games* rows show
`Remixed from <source name> by @<creator>` from the immutable snapshot. The
source-game link is offered only while that source still exists in the registry;
the creator link uses a validated GitHub login and opens with `noopener
noreferrer`. If the original has been deleted, or a legacy string cannot be
upgraded, Studio retains a readable, deliberately unlinked credit instead of
inventing facts or sending players to a dead destination.

Every newly provisioned Remix also receives a small attribution surface in its
generated `web/index.html`. This is injected after the source overlay, so it is
shared across all supported engine templates (including templates that do not
use the SDK `GameShell`). It renders snapshot text with DOM text nodes, validates
the id/login before forming URLs, and checks the public registry at runtime
before enabling the source-game link. A renamed source keeps its original
snapshot name; a deleted one remains credited without a broken source link.

Storefront detail-page rendering is owned by the separate
`freegamestore-online/platform` monorepo (`sites/freegamestore/registry.json`) and is tracked as a coordinated
follow-up rather than part of this platform change.

## Opening an existing game in VibeCode

`Dashboard → "Edit in VibeCode"` (or the studio project picker) →
`/create?game=<id>` → `useProjects.openGame(id)`:

1. If a local session is already bound to the game, switch to it.
2. Otherwise create a session and **import** the game's real repo files via the
   agent's `POST /session/:id/import { id }` (ownership-gated). The session's
   files become the actual repo contents, so a later edit + `push_update`
   **updates** the game instead of overwriting it with a blank scaffold — the bug
   the old "empty session linked to a repo" picker path caused.

Import reads the repo via the Git Data API (recursive tree + parallel blob
reads), text files only, skipping `node_modules`/`dist`/lockfiles/binaries, with
512KB/file, 2MB, 200-file caps. It refuses to re-point a session already bound to
a different game (409).

## Building + deploying (Path B)

A VibeCode session **seeds** its files from `template-game-canvas` (cached in the
DO; the stored seed is the delta baseline). When the agent deploys:

1. `registerViaAdmin` FIRST — admin generates the repo from the template
   (substituted) + route + registry + invite.
2. Wait for the generated `main` branch.
3. Push **only the agent-authored delta** (files changed vs. the seed) via a
   `base_tree` merge — so admin's generated scaffold, committed lockfile, icon
   binaries, and analytics-wired files all survive. An empty delta means the
   generate/substitution commit already triggered the deploy; the push is
   skipped.
4. Wait for the GitHub Actions deploy (compliance → build → R2 sync). Cancelled
   runs are expected (the generate → substitute → delta commits cancel each other
   via `concurrency: cancel-in-progress`) and are not treated as failures.

FGS games serve from R2 at `https://<id>.freegamestore.online` via the host
Worker (D1 `routes`, no fallback). No CF Pages project is ever created for a game.

## Ownership contract (registry-primary)

The same rule is enforced in three workers as **vendored copies** (workspace
"vendor, don't depend"), each with tests:

- publisher `functions/api/_games.ts` (`listUserGames`) — `/api/me`, create, publish.
- admin `publish.ts` — provision + update guards.
- agent `ownership.ts` (`ownsGame`) — the import gate.

A game is owned by `registry.creatorGithub === login` (case-insensitive). Org
members get an admin-all view. Legacy games with no recorded `creatorGithub` fall
back to an accepted-collaborator check (a shrinking set — backfill removes it).
Because the registry entry is written at provision time (before an outside
collaborator accepts their invite), a freshly created game is owned/visible
**immediately** — no pending-invite blind spot.

## Status / URLs

Every provisioned game registers immediately, so a listed game is always **Live**
(the old Draft state + inline Publish button were unreachable and were removed
from the Dashboard). In-progress, not-yet-deployed work is a VibeCode session in
the studio picker, which keeps its Live/Draft distinction. Game URLs are
standardized on `https://<id>.freegamestore.online`.

## Known follow-ups

- **Live LLM smoke:** the deploy mechanics are unit-tested and admin's
  generate+substitution was verified live, but a full LLM-driven create→deploy
  wants one human smoke test. The `template-game-canvas` floor guarantees a
  deployable game even if the agent underperforms.
- **Legacy in-progress sessions** seeded from the old inline template should
  `/reset` to re-seed from canvas (none in prod — pre-launch).
- Deferred polish: remove the `useProjects` phantom auto-create; surface the slot
  count in the studio toolbar.
- Registry `creatorGithub` backfill for any legacy games recorded only via
  `developer`.
