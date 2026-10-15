# Design tokens

`@freegamestore/games` defines the brand, typography, shape and motion tokens
that every FreeGameStore game uses. They are lifted from the Mosaic Rush pilot,
which is the first game built on them. The source is `src/tokens.ts`. This file
is the reference.

## Where the values live

| Layer | Where | What it does |
|---|---|---|
| Definitions | `src/tokens.ts` | Exports the values as TypeScript constants and builds `GAME_TOKENS_CSS`. |
| Consumption | SDK components | Read `var(--paper)` and the other tokens inline, with a fallback for each. |
| Injection | Each game | Adds `GAME_TOKENS_CSS` to its stylesheet. Nothing is injected on import, because the package is `sideEffects: false`. |

Before this package defined them, the brand colours (`--paper`, `--ink`,
`--accent`, `--panel`, `--line`, `--muted`) were defined only in each game's own
`index.css`. Components in the SDK used them with fallbacks, so a game that
did not define them still rendered. Defining them here gives every game the
same values.

## Using the tokens

Add the stylesheet once, at the top of the game:

```tsx
import { GAME_TOKENS_CSS } from '@freegamestore/games';

// In the root component:
<style>{GAME_TOKENS_CSS}</style>
```

Or copy `GAME_TOKENS_CSS` into `index.css`, which is what Mosaic Rush does.
Then use the tokens in your own CSS:

```css
.card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  font-family: var(--font-display);
  transition: transform var(--motion-fast) var(--motion-ease-out);
}
```

The dark theme applies under `data-theme="dark"` on `<html>`.
`GameThemeToggle` sets that attribute. The theme follows the system preference
until the player picks one.

## Colours

Light values are the defaults on `:root`. The dark values override only the
tokens that differ, under `:root[data-theme="dark"]`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#ffffff` | `#0f0f0f` | Page and board background. |
| `--ink` | `#1a1a1a` | `#f5f5f5` | Primary text. |
| `--muted` | `#6b7280` | `#9ca3af` | Secondary text and captions. |
| `--line` | `#e5e7eb` | `#2d2d2d` | Hairline borders on empty surfaces. |
| `--line-strong` | `#d1d5db` | `#404040` | Borders on buttons and toggles. |
| `--panel` | `#f9fafb` | `#1a1a1a` | Raised cards and overlays. |
| `--glass` | `rgba(255, 255, 255, 0.8)` | `rgba(15, 15, 15, 0.8)` | Frosted overlay surfaces. |
| `--dock` | `#ffffff` | `#1a1a1a` | Bottom dock. |
| `--success` | `#16a34a` | `#22c55e` | Success status. |
| `--warning` | `#d97706` | `#fbbf24` | Warning status. |
| `--error` | `#dc2626` | `#ef4444` | Error status. |
| `--accent` | `#2563eb` | `#2563eb` | Primary actions and highlights. The same in both themes. |
| `--accent-soft` | `#eff6ff` | `#1a2e26` | Quiet fill behind accent text, such as badges. |
| `--accent-ink` | `#2563eb` | `#60a5fa` | Accent used as text. Lighter in dark mode so it passes AA. |

Ink, muted and accent-ink each meet WCAG AA (4.5:1) on `--paper` in both themes.
`src/tokens.test.ts` checks this.

Use `--accent` for fills, such as buttons, and `--accent-ink` for accent text.
`--accent` on a dark surface does not pass AA as text.

## Typography

Only display headings and score values use the display face. Body text keeps the
platform's default sizes.

| Token | Value | Use |
|---|---|---|
| `--font-display` | `"Fraunces", Georgia, serif` | Titles and score values. |
| `--font-body` | `"Manrope", system-ui, sans-serif` | Everything else. |
| `--text-stat` | `1.25rem` | Score and stat values. |
| `--text-title` | `clamp(2rem, 9vw, 2.6rem)` | Overlay titles. |
| `--text-display` | `clamp(2.25rem, 11vw, 3.25rem)` | The start-screen title. |

The brand fonts (Manrope and Fraunces) are the only ones allowed. The compliance
suite checks for them.

## Shape

| Token | Value | Use |
|---|---|---|
| `--radius` | `1.25rem` | Corner radius for cards and overlays. |

## Motion

Every animation reads its duration and easing from these tokens, so one change
affects the whole game.

| Token | Value | Use |
|---|---|---|
| `--motion-fast` | `120ms` | Presses and pops. |
| `--motion-base` | `240ms` | Standard transitions. |
| `--motion-slow` | `420ms` | Larger entrances and overlays. |
| `--motion-ease-out` | `cubic-bezier(0.2, 0.9, 0.3, 1)` | Default ease-out. |
| `--motion-ease-spring` | `cubic-bezier(0.2, 0.9, 0.3, 1.3)` | Overshooting pops. |
| `--motion-duration` | `var(--motion-fast)`, so `120ms` | Default duration for a control transition, such as a press. Reduced motion sets it to `0ms`. |
| `--motion-easing` | `var(--motion-ease-out)` | Default easing for a control transition. |

### Reduced motion

Under `prefers-reduced-motion: reduce`, the three durations are set to `0ms`.
Animations finish at once and only the final state shows. The easings do not
change.

Animations that depend on a duration then finish instantly. Any animation that
is pure decoration should also be disabled explicitly, as Mosaic Rush does for
its confetti and float effects.

## Compatibility

- Adding these tokens changes no existing export. The SDK components keep their
  fallbacks.
- Games that already define `--paper` and the others in their own `index.css`
  keep working as long as their own stylesheet loads after the tokens, so its declarations win.
- The store-site aliases from Mosaic Rush (`--bg`, `--surface`, `--border`) are
  not part of this package.
