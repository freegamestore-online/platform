# ADR-001: One styling model: React + Tailwind 4 on FGS tokens

- **Status:** Accepted (2026-10-31)
- **Epic:** [#390](https://github.com/freegamestore-online/platform/issues/390)
- **Ports:** PAS ADR-011 (`proappstore-online/platform`, `docs/adr/011-tailwind-on-pas-tokens.md`, PAS #491). FAS has the same decision (freeappstore-online/platform#320).
- **Shared spec:** `DESIGN-SYSTEM.md` (freeappstore-online/platform#327) owns the token names and the opaque-surface rule.

## Context

FGS documents its stack as React + Vite + Tailwind (`sites/freegamestore/SKILLS.md`), but nothing states the styling model or applies it to the platform's own UI. The result, counted on 2026-10-31:

| Surface | inline `style={{}}` blocks | files |
|---|---|---|
| `packages/games-sdk` | 40 | 12, plus CSS strings injected at runtime |
| `apps/console` | 239 | 23 |
| `apps/admin` | 320 | 14 |

The `no-excessive-inline-styles` compliance check covers games only. The same gap produced FAS's transparent mobile menu (freeappstore-online/platform#319): a floating surface styled by hand with a translucent token.

## Decision

Every React surface is styled one way: games' DOM UI, the `template-game-*` templates, `packages/games-sdk`, `apps/console` and `apps/admin`. The model has three layers.

1. **Components** for UI that repeats (buttons, dialogs, menus, cards). Variants live in the component, not in a CSS class.
2. **Tailwind 4 utilities on token colours** for everything else. Tokens are exposed to Tailwind with `@theme inline`, so `bg-surface`, `text-ink`, `border-border` and `text-accent` resolve to the CSS variables and follow light/dark automatically.
3. **`index.css` holds only** `@import "tailwindcss"`, `@source`, the token blocks (`:root` and the dark scheme), `@theme inline`, and `@layer base`/`@layer components` for true base rules. No feature classes (`.game-menu`, `.score-badge`), no component CSS.

```css
@import "tailwindcss";
@source "../node_modules/@freegamestore/games/dist";

:root { --bg: #fafaf9; --surface: #ffffff; --popover: #ffffff; --ink: #1a1a1a; /* … */ }
@media (prefers-color-scheme: dark) { :root { --bg: #0f0f0f; --surface: #1a1a1a; --popover: #1a1a1a; /* … */ } }

@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-popover: var(--popover);
  --color-ink: var(--ink);
  --color-muted: var(--muted);
  --color-border: var(--border);
  --color-accent: var(--accent);
  --color-accent-soft: var(--accent-soft);
}
```

Token names are those in the developer guidelines' visual-system table plus `--popover`; `DESIGN-SYSTEM.md` (#327) is authoritative if they diverge.

### Rules

- **No static inline `style`.** Inline `style` is allowed only for values that are computed at runtime: sprite or canvas-overlay positioning, transforms, animation progress, and CSS custom properties fed from state.
- **No runtime-injected CSS.** No `<style>` elements or CSS strings created from JS (this includes games-sdk, which today injects CSS from 5 files).
- **No raw colours.** Use token utilities. A hard-coded hex or `rgb()` in UI code needs a comment explaining why a token cannot do it.
- **Opaque floating surfaces.** Modals, menus, popovers and result screens use an opaque token (`bg-popover` or `bg-surface`), never a translucent one, so text stays readable over the game or page behind them. Translucent scrims behind a dialog are fine; the dialog itself is opaque.
- **Don't invent another convention.** No CSS-in-JS, CSS modules, or per-game utility-class systems for UI.

### Scope

- **In scope:** HUD, menus, overlays, dialogs, results screens, settings, shell chrome and every DOM element a player or creator touches.
- **Out of scope:** canvas and WebGL rendering. What a game draws inside its canvas is the game's own art direction.

## Consequences

- Dark mode, theming and the opaque-surface rule are fixed once in the tokens instead of in hundreds of style blocks.
- games-sdk ships Tailwind class names, so games and templates must add `@source` for it (#392) and the SDK must stop injecting CSS (#393).
- Console and admin are rewritten to the model (#394, #395). That is mechanical but large, and both have real users, so each ships with tests and review.
- Enforcement follows the standard: compliance checks `css-discipline` and `opaque-surface` start as warnings (#396), a codemod `fgs migrate tailwind-tokens` helps migrate (#397), and the checks flip to `fail` only after the fleet audit is all zeros (#398).

## Alternatives considered

- **Keep inline styles for the platform UI.** Rejected: it is the source of the drift and of the transparent-menu bug, and it cannot follow the dark scheme.
- **A shared stylesheet of feature classes.** Rejected: it recreates the problem in CSS, and games cannot tell which classes are safe to use.
- **CSS modules or CSS-in-JS.** Rejected: a third convention beside Tailwind, and CSS-in-JS injects styles at runtime, which this ADR forbids.

## Status of the rollout

This ADR is the first step (#391). The children #392 to #398 apply it, in the order set in #390.
