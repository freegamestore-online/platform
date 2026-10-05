---
title: Brand tokens
description: The CSS variables every game shares. Read these, don't override them.
---

The FreeGameStore brand surface is shared by every game in the catalog
through a small set of CSS custom properties. The SDK components
(`<GameShell>`, `<GameTopbar>`, `<GameButton>`) read these tokens; your
game can read them too.

## The tokens

| Token | Light mode | Dark mode | What it is |
|---|---|---|---|
| `--paper` | `#ffffff` | `#0f0f0f` | The page background. The "canvas" the game sits on. |
| `--ink`   | `#1a1a1a` | `#f5f5f5` | Primary text and high-contrast surfaces. |
| `--accent`| `#2563eb` | `#2563eb` | Score numbers, primary buttons, score highlights. Override per-game to set your signature color. |
| `--muted` | `#6b7280` | `#9ca3af` | Secondary text, icon defaults, stat labels. |
| `--line`  | `#e5e7eb` | `#2d2d2d` | Borders and dividers. |
| `--panel` | `#f9fafb` | `#1a1a1a` | The topbar background, dropdown menus, modals. |

The scaffolded `web/src/index.css` defines these inside a
`prefers-color-scheme` block. Don't delete it. The template also defines
`--line-strong` and `--accent-soft` — supporting tones the SDK doesn't
currently read but games are welcome to use.

## How the SDK uses them

The components don't accept color props. They read tokens directly:

```tsx
// inside GameButton.tsx
background: 'var(--accent, #10b981)',  // primary variant
color: '#fff',
```

That means swapping `--accent` in your CSS swaps the button color
everywhere — buttons, score numbers, leaderboard rank badges.

```css
/* web/src/index.css */
:root {
  --accent: #ff6b35;  /* orange instead of the default blue */
}
```

That's the *only* customization point the brand allows. Don't override
`--ink` to red, or `--paper` to blue — `no-brand-overrides` will fail.

## What you can override (per game)

- **`--accent`** — the game's signature color. Pick something that fits
  the game.

## What you can't override

- **`--paper` / `--ink`** — these are the global text/background.
  Overriding breaks dark-mode and the storefront's visual identity.
- **Fonts** — Manrope + Fraunces are loaded in `index.html` and used by
  the SDK. Don't add a third family or swap.
- **Topbar height, footer link, mute icon** — all enforced.

## Reading tokens in your code

CSS:

```css
.score-tile {
  background: var(--panel);
  color: var(--ink);
  border: 1px solid var(--line);
}
```

JSX inline styles:

```tsx
<div style={{ color: 'var(--accent)' }}>You scored!</div>
```

Computed (rare):

```ts
const accent = getComputedStyle(document.documentElement)
  .getPropertyValue('--accent');
```

## Where the tokens are defined

In your scaffolded game: `web/src/index.css`.

In the platform (canonical): the storefront's stylesheet sets the same
values, so when the storefront iframes or links to your game they're
visually adjacent without a flash of mismatched color.

## Related

- [Required dependencies](/docs/reference/dependencies/) — fonts come from Google Fonts.
- [All checks](/docs/compliance/checks/) — `brand-tokens`, `no-brand-overrides`, `brand-fonts`.
