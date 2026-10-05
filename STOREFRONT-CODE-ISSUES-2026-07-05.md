# Storefront code issues — 2026-07-05

**Status:** report — no code changed.
**Scope:** bugs in the storefront build/runtime code (`build.js`, templates,
`quality.js`, `search.js`, `storefront.js`). Companion to
`REGISTRY-VALIDATION-RECOMMENDATIONS.md` (registry-validation drop bug) and
`admin/PLATFORM-ISSUES-2026-07-05.md` (publish-flow root causes).
All findings verified against current `main`.

---

## 1. HIGH-MED — every game detail page ships literal `{{…}}` in its JSON-LD (CONFIRMED)

`templates/game-detail.html:46-48` declares structured data:
```json
"softwareVersion": "{{VERSION}}",
"datePublished": "{{FIRST_PUBLISHED}}",
"dateModified": "{{LAST_UPDATED}}",
```
The detail-page render in `build.js` substitutes `NAME`/`ID`/`ICON`/`DESCRIPTION`/etc.
but **never replaces `{{VERSION}}`, `{{FIRST_PUBLISHED}}`, or `{{LAST_UPDATED}}`** —
grep for those tokens in `build.js` finds nothing (only the unrelated
`{{STYLE_VERSION}}` / `{{CARD_STYLES_VERSION}}` at `build.js:339-340`).

**Wrong behavior:** all 79 detail pages emit invalid `SoftwareApplication` JSON-LD —
`datePublished`/`dateModified` are the literal token strings, not ISO dates. Search
engines reject/ignore the date fields; the structured data is malformed site-wide.
The data exists in the registry (`firstPublished`, and version/updated fields), so
this is a pure wiring omission.

**Fix:** in the detail-page render block, add
`.replaceAll('{{VERSION}}', …).replaceAll('{{FIRST_PUBLISHED}}', escapeHtml(game.firstPublished||'')).replaceAll('{{LAST_UPDATED}}', …)` —
or drop the fields if unused. **Severity:** Medium (SEO / structured-data correctness).

## 2. MED — `quality.js` leaks a `message` listener on every mode-tab switch (CONFIRMED)

`quality.js:258` does `window.addEventListener('message', handler)` **inside**
`renderDetail()`, which is re-invoked on every viewport mode-tab click (and once at
init). There is **no `removeEventListener` anywhere** in the file.

**Wrong behavior:** switching All → Phone → Tablet stacks multiple live `message`
handlers, each closing over its own `passing` set but all writing the same
`#q-detail-index` element and calling `setCachedScore(id, …)`. Stale handlers keep
recomputing from divergent state, so the displayed quality index and the
localStorage-cached score flip-flop / settle on the wrong value. Prior renders'
`setTimeout` also still fires and stamps "No quality reporter" onto freshly-pending
cells.

**Fix:** attach the `message` listener once (module scope), or keep a handle and
`removeEventListener` at the top of `renderDetail()`. **Severity:** Medium.

## 3. MED (latent today) — `search.js categoryLabel()` is unguarded and can throw

`search.js:54-59`: `cat.split('-').map((w) => w[0].toUpperCase() + w.slice(1))` — no
empty/edge guard, unlike `build.js:99-102` which does `if (!cat) return 'Uncategorized'`.
For a cross-store item whose `category` is `""`, missing, or has an edge/double dash,
`w[0]` is `undefined` → `undefined.toUpperCase()` throws. It's called from
`buildCrossCard` inside the un-try/caught `applyQuery` loop, so it would abort
cross-store search rendering for that keystroke.

Also `search.js:47` builds the haystack as
`${item.id} ${item.name} ${item.description} ${item.category}` — a missing field
injects the literal `"undefined"`, so typing `undefined` spuriously matches.

**Currently latent:** none of the 106 embedded cross-store (FAS) items trigger it
today, but it breaks the moment FAS ships an empty/edge-case category.
**Fix:** guard `categoryLabel` like `build.js`; coerce fields with `|| ''` when
building the haystack. **Severity:** Medium (latent).

## 4. LOW (latent) — detail hero renders literal "undefined" for an icon-less game

`build.js` detail render does `.replace(/\{\{ICON\}\}/g, game.icon)` with no fallback;
`String.replace` coerces `undefined` → the string `"undefined"`, which would render in
`templates/game-detail.html:76` `<div class="app-hero-icon">{{ICON}}</div>`.
`renderGameCard` DOES fall back to the name's first letter, so index cards are fine —
only the detail page is unguarded. All 79 current games have an `icon`, so latent.
**Fix:** mirror the card fallback on the detail render. **Severity:** Low.

## 5. LOW — category casing produces a split sort key (confirms the data-hygiene issue)

`storefront.js:32-38` sorts cards by `a.dataset.category` with a **case-sensitive
raw-string** compare (`ac !== bc ? ac.localeCompare(bc) : …`). The registry's
`"Casual"` vs `"casual"`, `"Cards"` vs `"cards"`, `"Strategy"` vs `"strategy"`,
`"Brain Training"` vs `"brain-training"` are distinct sort keys, so a genre sorts as
two groups. **Low impact:** `localeCompare` keeps variants adjacent, `categoryLabel`
normalizes the visible label, and search lowercases — nothing hard-breaks, and there
is no case-sensitive category *filter*. Best fixed at the source (normalize category
at publish — see `admin/PLATFORM-ISSUES-2026-07-05.md` §C).

---

## Checked and clean

- **XSS/escaping:** `icon` is genuinely the only registry field injected unescaped
  (`build.js:367` card, detail render), constrained by `ICON_RE`. All other fields go
  through `escapeHtml` or regex validation. `search.js buildCrossCard` uses `esc()` +
  `encodeURIComponent`. No injection leak.
- **sw.js:** SWR cache strategy sound; bare-path `CORE` precache is effectively dead
  (pages request `?v=<hash>`) but harmless.
- **functions/v1/csp-report.js:** POST routing, size caps, and 204/405 correct.

## Priority

| # | Issue | Sev | Latent? | Fix |
|---|-------|-----|---------|-----|
| 1 | JSON-LD `{{…}}` never substituted | Med | No — all 79 pages | Add 3 `replaceAll`s in detail render |
| 2 | `quality.js` message-listener leak | Med | No | Attach once / removeEventListener |
| 3 | `search.js categoryLabel` unguarded throw | Med | Yes | Guard + coerce fields |
| 4 | detail hero "undefined" icon | Low | Yes | Fallback like card render |
| 5 | category casing split sort key | Low | No | Normalize at publish (admin §C) |
