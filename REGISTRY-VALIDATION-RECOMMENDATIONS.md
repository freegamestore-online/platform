# Storefront registry-validation recommendations

**Status:** proposal — no code changed.
**Author:** generated during incident review, 2026-07-05.
**Trigger:** a published game (`flappyslaybird`) could not be found in store
search, despite being live, hosted, and present in `registry.json`.

---

## Symptom

`flappyslaybird` is fully published:

- `https://flappyslaybird.freegamestore.online/` → HTTP 200 (game runs).
- Present in `registry.json` on `origin/main` (79 games).

…yet it does **not** appear on the storefront and **cannot be found in search**
(`freegamestore.online/?q=flappy` returns nothing).

Search is client-side over cards **baked into `index.html` at build time**
(`search.js`: *"All filtering is local; nothing is fetched at runtime."*). If a
game has no card in the built HTML, it is unsearchable. `flappyslaybird` has no
card — so search can't see it.

## Root cause — the build silently drops the game

`build.js` → `validateRegistry()` drops any registry entry that fails validation
(by design: one bad entry must not break the whole store). The relevant rule:

```js
// build.js
if (g.description != null && !safeText(g.description, 500))
  errors.push(`description must be 1-500 chars without control chars`);
```

`safeText` requires a **non-empty** string:

```js
function safeText(s, max) {
  return typeof s === 'string' && s.length > 0 && s.length <= max && !/[\x00-\x1f\x7f]/.test(s);
}
```

`flappyslaybird`'s registry entry has `"description": ""`. An empty string is
`!= null`, so the guard runs; `safeText("", 500)` is `false` (length not `> 0`);
the entry is judged invalid and **the whole game is excluded from the build**.

The intent of the rule is clearly *"**if** a description is provided, it must be
1–500 valid chars."* But an empty string is a legitimate *"no description,"* not
a malformed one. The `!= null` guard doesn't exclude `""`, so a blank optional
field drops the entire game.

### This is systemic, not a one-off

Running the exact `validateRegistry` logic against the live registry (79 games)
drops **10 games**, all for empty/blank optional *display* fields:

| Field | Value | Games dropped |
|-------|-------|---------------|
| `description` | `""` | `flappyslaybird`, `frofrogjumping`, `angry-birds2`, `angrry`, `sliceit`, `ocean-save`, `ocean-save2`, `pixeljump` (8) |
| `icon` | `""` | `bladeblast` |
| `icon` | `"?"` | `decaying-tic-tac-toe` |

The publish flow writes `description: ""` by default, so **every game published
without a hand-written description is invisible on the store and in search.**
This is a platform bug, not a per-game bug — the games themselves are fine.

---

## Recommendations

### 1. Treat an empty optional field as *absent*, not *invalid* (root fix)

For optional **display-only** fields (`description`, `category`, `developer`,
`author`), a blank value means "not provided" and should pass. Guard on
truthiness so `""` skips the check instead of failing it:

```js
if (g.description && !safeText(g.description, 500)) errors.push(/* … */);
```

The same latent bug exists on `category`, `developer`, and `author` (all use the
`!= null` guard); fix them consistently.

### 2. Don't drop the whole game for a bad *cosmetic* field

Dropping an entire published game because its **icon** or **description** is
empty/odd is too aggressive — the game is live and hosted; only a decoration is
wrong. Split validation into two tiers:

- **Hard-fail (exclude the game):** only for fields where a bad value is a
  security or routing risk — `id`, `appUrl`, `repo`, `iconBg` (injected/used in
  markup or navigation).
- **Sanitize-and-keep:** for display-only fields (`description`, `icon`,
  `category`, `developer`, `author`), coerce an invalid/empty value to a safe
  default (empty description, default 🎮 icon) and **still include the game**.

This would have kept all 10 games in the store while preserving the "one bad
entry can't break the store" guarantee.

### 3. Fix the source: clean registry entries at publish time

The upstream publish/provision flow (admin/publisher worker) should:

- **Omit** `description` (or write `null`) instead of `""` when the creator gives
  none — so entries are clean at the source, not just tolerated downstream.
- Always write a **valid default `icon`** (e.g. 🎮) so entries never carry `""`
  or a char `ICON_RE` rejects (like `"?"`).

Downstream tolerance (#1, #2) and upstream cleanliness (#3) are complementary:
do both.

### 4. Make silent drops visible

`validateRegistry` already `console.warn`s skipped entries, but that log is
invisible in normal operation — 10 games have been silently missing from the
store with no signal. Surface it:

- Emit the skipped list as a **GitHub Actions annotation / build summary** on
  every deploy.
- Consider **failing the build** (or opening an alert) when the skipped count is
  non-zero, so "a published game vanished from the store" is caught at deploy
  time instead of by a user noticing search is empty.

---

## Priority

| # | Change | Effort | Fixes the missing games? |
|---|--------|--------|--------------------------|
| 1 | Empty optional field → valid (truthy guard) | Low | **Yes — directly** |
| 2 | Sanitize-and-keep for cosmetic fields, hard-fail only for security fields | Low–Med | Yes, and future-proofs it |
| 3 | Publish flow writes clean `description`/`icon` defaults | Low | Prevents recurrence at source |
| 4 | Surface skipped-game count in CI | Low | No, but kills the silent-drop blind spot |

Start with **#1** — a one-character-class change to the guard immediately
restores `flappyslaybird` and 6 other games to the store and to search on the
next storefront build.

## Verification

After #1, rebuild the store and confirm the dropped ids appear as cards in
`dist/index.html` (and therefore in client-side search):

```
node build.js
grep -c flappyslaybird dist/index.html   # expect ≥ 1
```

## Scope note

FAS/PAS use the same registry-baked-storefront + client-side-search shape. If
this validation lives in their storefront builds too, the same empty-optional
bug applies — port the fix (vendored copy, per platform convention).
