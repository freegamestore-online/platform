# FGS Worker API Contract

The `auth` and `leaderboard` workers serve **deployed game bundles we don't
control after they ship**. A game is built once, its SDK (and the worker URLs
baked into it) are frozen at build time, and the bundle sits in R2 until the
creator re-publishes — which may be never. Today most games are pinned to an
older `@freegamestore/games` release.

That means a breaking change to a worker response silently breaks every game
built before the change, with no rollback and no way to push a fix. To make the
workers safe to evolve, they follow an **additive-only contract**.

## The rule

Response shapes are **additive-only**. You may:

- **Add** new fields to a response object.
- **Add** new endpoints (under `/v1/…` going forward).
- **Add** new optional request fields (with a safe default when absent).

You may **not**, on an existing endpoint:

- Remove or rename a response field.
- Change a field's type or its meaning.
- Make a previously-optional request field required.
- Tighten validation so that requests old clients send start failing.

If you need a genuinely incompatible shape, introduce a **new version prefix**
(`/v2/…`) and keep the old one serving unchanged. Never repurpose `/v1`.

## Versioned aliases

Both workers strip a leading `/v1/` and route to the same handlers as the
unversioned paths:

| Worker | Unversioned (legacy bundles) | Versioned (SDK ≥ 0.15.0) |
|---|---|---|
| auth | `GET /me`, `POST /logout` | `GET /v1/me`, `POST /v1/logout` |
| leaderboard | `GET /api/leaderboard/:game`, `…/recent`, `…/overall`, `…/user/:uid`, `POST /api/scores` | same paths under `/v1/…` |

Both forms must keep working. The unversioned paths are the contract with games
already in the wild; do not remove them.

- auth alias: `auth/src/index.ts` (`path = … startsWith("/v1/") ? slice(3)`)
- leaderboard alias: `leaderboard/src/index.ts` (same)
- SDK adoption: `platform/packages/games-sdk/src/useAuth.ts`, `useLeaderboard.ts`

## Note on `/api/scores`

`POST /api/scores` now **requires authentication** (returns `401` for anonymous
submissions) and rejects scores above a per-game cap (`422`). This is a
deliberate tightening, but it does not break the additive contract for *reading*
boards: anonymous scores were already filtered out of every leaderboard query
(`user_id IS NOT NULL`), so no displayed data changes. Older bundles that let a
signed-out user "submit" simply get a `401` and show no rank — the same visible
outcome as before.
