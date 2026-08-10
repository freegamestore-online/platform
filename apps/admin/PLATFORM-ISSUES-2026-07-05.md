# FGS platform issues — 2026-07-05

**Status:** A1, A2, B, C, D FIXED 2026-07-05; E deferred (needs reconcile job).
**Author:** generated during a storefront/publish audit, 2026-07-05.

## Resolution

- **A1** (admin `??` lets `description:""` into registry) — FIXED `admin/src/publish.ts`:
  `||` (not `??`) for `description`/`icon`/`iconBg`, so a blank field is never persisted.
- **A2** (build drops empty-optional-field games) — FIXED `freegamestore/build.js`
  (commit 0a05839): sanitize-and-keep for display-only fields; 79/79 build.
- **B** (test fixture live in prod store) — FIXED `freegamestore/build.js`: the store
  build excludes any id ending `-test`/`-fixture` (or `test:true`) with a log. Removed
  `mcp-hybrid-test` AND `mcp-snake-test` from the public store + search.
- **C** (category not normalized) — FIXED: `normalizeCategory()` at publish (lowercase,
  spaces→hyphens).
- **D** (raw-id display names) — FIXED: `displayName()` title-cases a slug-shaped name
  at publish.
- **E** (name drift after rebuild, e.g. pixeljump) — DEFERRED: belongs in the
  `reconcile.ts` drift job (reconcile registry `name` from the game manifest).
**Scope:** platform-owned bugs (provisioning, registry, storefront build). Excludes
per-game content bugs. All findings verified against the live registry (79 games)
and the current `main` of each repo.

Owning repos referenced: `admin` (provisioning + registry writes), `freegamestore`
(static storefront build), `agent` (VibeCode builder).

---

## A. HIGH — empty-string optional fields make a published game invisible

**Two components, same root-cause class: empty string treated as a present value.**

### A1. Source — `admin/src/publish.ts:253`
```js
const description = req.description ?? req.oneliner ?? req.name;
```
`??` (nullish coalescing) only falls back on `null`/`undefined`, **not** on `""`.
The VibeCode/CLI caller sends `description: ""` when the creator gives no blurb, so
the empty string passes through and is written to the registry as `description: ""`.

**Fix:** fall back on empty too, e.g.
`const description = req.description || req.oneliner || req.name;`
(or trim-and-check). Then `description` is never persisted as `""`.

### A2. Downstream — `freegamestore/build.js:51`
```js
if (g.description != null && !safeText(g.description, 500)) errors.push(/* … */);
```
`!= null` doesn't exclude `""`; `safeText("")` is `false` (requires length > 0), so
the entry is judged invalid and **`validateRegistry()` drops the whole game** from
the built `index.html`. Search is client-side over baked cards, so the game becomes
**unsearchable and unbrowsable** even though it is live and hosted.

**Fix:** treat an empty optional field as absent —
`if (g.description && !safeText(g.description, 500))`. Same latent bug on
`category`, `developer`, `author`, and `icon` (all use the `!= null` guard).
Detailed write-up already filed: `freegamestore/REGISTRY-VALIDATION-RECOMMENDATIONS.md`.

### Impact (measured against the live registry)
**10 live games are silently excluded** from the store + search right now:
- empty `description` (8): `flappyslaybird`, `frofrogjumping`, `angry-birds2`,
  `angrry`, `sliceit`, `ocean-save`, `ocean-save2`, `pixeljump`
- empty `icon` (1): `bladeblast`
- non-emoji `icon` `"?"` (1): `decaying-tic-tac-toe`

Either fix (A1 or A2) prevents the empty-description case; do **both** (defense in
depth). A1 also fixes it at the source so the registry data is clean.

---

## B. MED — a test fixture is published to the production store

`mcp-hybrid-test` (`developer: serge-ivo`, `description: "hybrid test"`) is a fully
provisioned, hosted, **publicly-listed** game in the production registry. It renders
as a real card on `freegamestore.online`.

**Fix:** unpublish/remove it, and add a guard so test publishes never land in the
prod registry (e.g. a reserved `*-test` id prefix skip, or a `test: true` flag that
excludes from the storefront build).

---

## C. LOW-MED — publish flow doesn't normalize `category`

`admin/src/publish.ts:252` only sets a default (`req.category ?? "casual"`); a
caller-supplied category is written verbatim. VibeCode emits Title-Case values, so
the registry now mixes canonical `casual`/`cards`/`strategy`/`brain-training` with
non-canonical `Casual` (`snake-2`), `Cards` (`uno`), `Strategy`
(`fireboyandwatergirl`), `Brain Training` (`wordguess`).

Impact today is limited — `categoryLabel()` and search both normalize — but it's a
latent trap the moment any case-sensitive category filter/grouping is added.

**Fix:** normalize category at publish time — lowercase, map spaces→hyphens, and
validate against the canonical set; reject or coerce unknown values.

---

## D. LOW — display name is written verbatim, so many games show their raw id

`admin/src/publish.ts:221` commits `Set game name to "${name}"` with whatever `name`
the caller sends. When the caller passes the id as the name, the store shows the raw
slug as the title. **20 games** currently have `name === id`, e.g. `tictactoe`,
`climberadventure`, `bouncingball` → "bouncing ball", `blackjack`, `uno`, `war`,
`spaceinvaders`, `fireboyandwatergirl`, `wordguess`, `snake-2`, `mcp-hybrid-test`.

**Fix (soft):** when `name` is slug-shaped (all-lowercase / matches the id), derive a
title-cased display name as a fallback; or have VibeCode/CLI require a real title.

---

## E. LOW — registry `name` drifts from the actual game after a rebuild

`pixeljump` is titled **"PixelJump"** in the registry, but the deployed game was
rebuilt twice (→ "Lazer Ball" → "RED ESCAPE") and the display name was never updated.
The store lists a name that no longer matches the game.

**Fix:** on republish/update, reconcile the registry `name` from the game's own
manifest/title, or expose a rename step in the update flow. (Candidate for the new
`admin/src/reconcile.ts` drift job.)

---

## Verified clean (no action needed)

- No duplicate ids; no `appUrl`/`repo` mismatches.
- **No provisioning drift** — all 79 registry subdomains respond 200/206 (no CF 1014
  orphans).

## Pending

A separate deep review of the storefront **code** (`build.js`, `search.js`,
`detail-page.js`, escaping/XSS, search edge cases) is in progress; any additional
storefront-code findings will be appended to
`freegamestore/REGISTRY-VALIDATION-RECOMMENDATIONS.md`.

## Priority

| # | Issue | Owner | Sev | Fix effort |
|---|-------|-------|-----|-----------|
| A1 | `??` lets `description:""` into registry | `admin/publish.ts` | High | Low |
| A2 | build drops empty-optional-field games | `freegamestore/build.js` | High | Low |
| B | test fixture live in prod store | `admin` + registry | Med | Low |
| C | category not normalized at publish | `admin/publish.ts` | Low-Med | Low |
| D | raw-id display names | `admin/publish.ts` + caller | Low | Low |
| E | name drift after rebuild | `admin/reconcile.ts` | Low | Med |
