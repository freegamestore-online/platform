# FGS Worker API Contract

The `auth` worker serves **deployed game bundles we don't
control after they ship**. A game is built once, its SDK (and the worker URLs
baked into it) are frozen at build time, and the bundle sits in R2 until the
creator re-publishes — which may be never. Today most games are pinned to an
older `@freegamestore/games` release.

That means a breaking change to a worker response silently breaks every game
built before the change, with no rollback and no way to push a fix. To make the
worker safe to evolve, it follows an **additive-only contract**.

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

The worker strips a leading `/v1/` and routes to the same handlers as the
unversioned paths:

| Worker | Unversioned (legacy bundles) | Versioned (SDK ≥ 0.15.0) |
|---|---|---|
| auth | `GET /me`, `POST /logout` | `GET /v1/me`, `POST /v1/logout` |

Both forms must keep working. The unversioned paths are the contract with games
already in the wild; do not remove them.

The leaderboard worker was taken out of service (#424) and then deleted (#491).
Game bundles already handle a refused or failed request (empty boards,
`submitScore` resolves `{ ok: false }`), so the SDK's `useLeaderboard` export
stays and needs no server. The scores data stays in the `leaderboard` D1
database, which auth and agent still use.

- auth alias: `auth/src/index.ts` (`path = … startsWith("/v1/") ? slice(3)`)
- SDK adoption: `platform/packages/games-sdk/src/useAuth.ts`
