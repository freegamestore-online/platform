---
title: Developer guidelines
description: Platform rules, brand, tech stack, templates, publishing, and compliance expectations for FreeGameStore games.
---

Every game listed on FreeGameStore must feel native to the platform: free,
private, open-source, installable, and playable on phones, tablets, and
desktops. This page folds the old standalone Guidelines page into the docs.

## Platform rules

These rules are not optional:

- **Free means free.** No freemium mechanics, ads, paid plans, paywalls, or
  "upgrade to unlock" flows.
- **No payments.** A FreeGameStore game takes no money in any form: no
  in-game purchases, tips, checkout or payment sheet. This is enforced, not
  just a rule ([#376](https://github.com/freegamestore-online/platform/issues/376)):
  - every game response carries `Permissions-Policy: payment=()`, so the
    browser refuses the Payment Request API;
  - `fgs check` fails a game that uses payment APIs (Payment Request, payment
    handlers, Apple Pay, Google Pay), delegates `payment` to an iframe, puts
    `payment*` or `serviceworker` members in its web app manifest, declares a
    `payment` permission, or loads a payment-provider SDK.

  A link to your own donation or sponsor page (Ko-fi, GitHub Sponsors) is fine:
  that isn't the game taking a payment. Paid games belong on ProGameStore.
- **No tracking.** No analytics SDKs, tracking cookies, fingerprinting, or
  unnecessary data collection.
- **Open source.** Games should be public, MIT-licensed, and inspectable on
  GitHub.
- **Real games, not demos.** A listing must be playable and complete enough for
  players to understand the core loop.
- **Works everywhere.** Games must work on mobile, tablet, and desktop viewports
  and should be installable as PWAs.

## Brand and naming

Use `FreeGameStore` as one PascalCase word. Do not write it as "Free Game
Store" or all caps.

| Context | Format | Example |
| --- | --- | --- |
| GitHub repo | lowercase, no platform prefix | `chess` |
| Package name | lowercase + game | `chessgame` |
| Display name | readable title case | `Chess` |
| Subdomain | lowercase `.freegamestore.online` | `chess.freegamestore.online` |

Use the shared platform tokens and SDK components for chrome and common game UI.
Start with [Brand tokens](/docs/reference/brand-tokens/) and
[`<GameShell>`](/docs/sdk/game-shell/).

## Visual system

The storefront and SDK use a neutral UI with an emerald accent. Games can have
their own art direction inside the play area, but shared controls, menus, shell
chrome, auth, leaderboard, and settings should use platform tokens.

| Token | Light | Dark | Usage |
| --- | --- | --- | --- |
| `--bg` | `#fafaf9` | `#0f0f0f` | Page background |
| `--surface` | `#ffffff` | `#1a1a1a` | Card or panel background |
| `--ink` | `#1a1a1a` | `#f0f0f0` | Primary text |
| `--muted` | `#6b6b6b` | `#999999` | Secondary text |
| `--border` | `#e5e5e5` | `#2a2a2a` | Borders |
| `--accent` | `#10b981` | `#34d399` | Primary accent |
| `--accent-soft` | `#ecfdf5` | `#1a2e26` | Accent backgrounds |

Fonts are managed by the platform. Do not replace the shell font stack or ship
custom UI fonts unless the game canvas itself needs an asset font.

## Styling: Tailwind on tokens

Tailwind 4 is **required** for all DOM UI: HUD, menus, overlays, dialogs,
results screens and settings. Canvas and WebGL rendering is out of scope. The
decision is [ADR-001](https://github.com/freegamestore-online/platform/blob/main/docs/adr/001-tailwind-on-fgs-tokens.md)
([#390](https://github.com/freegamestore-online/platform/issues/390)).

1. **Components** for UI that repeats.
2. **Tailwind utilities on token colours**, exposed with `@theme inline`.
3. **`index.css` holds only** `@import`, `@source`, the token blocks, `@theme`
   and `@layer`.

| Instead of | Use |
| --- | --- |
| `style={{ background: '#1a1a1a' }}` | `bg-surface` |
| `style={{ color: 'var(--ink)' }}` | `text-ink` |
| `style={{ color: '#666' }}` | `text-muted` |
| `style={{ border: '1px solid #e5e5e5' }}` | `border border-border` |
| `style={{ color: '#10b981' }}` | `text-accent` (`bg-accent-soft` for backgrounds) |
| `style={{ padding: 16, display: 'flex', gap: 8 }}` | `p-4 flex gap-2` |
| a `.score-badge` class in `index.css` | a `<ScoreBadge>` component |

- **No feature classes** in `index.css`.
- **No static inline styles.** Inline `style` is for runtime values only:
  sprite or overlay positioning, transforms, animation progress.
- **No injected CSS.** Never create `<style>` elements or CSS strings from JS.
- **Floating UI is opaque.** Modals, menus, popovers and result screens use
  `bg-popover` or `bg-surface`, never a translucent token. A translucent scrim
  behind the dialog is fine.

The checks for this start as warnings and become failures once existing games
are migrated.

## Tech stack

New games should follow the platform stack unless a specific game engine needs a
small variation.

| Layer | Choice |
| --- | --- |
| Language | TypeScript |
| Framework | React |
| Bundler | Vite |
| Styling | Tailwind CSS 4 on platform tokens (required, see [Styling](#styling-tailwind-on-tokens)) |
| Hosting | Cloudflare R2 (GitHub Actions) |
| Package manager | pnpm |
| Runtime | Node 20.19 or newer |

## Game engines

Pick the smallest proven engine that fits the game:

All engines track their latest major (a monthly build-gated refresh keeps them there).

| Engine | Version | Pick it when | Example games |
| --- | --- | --- | --- |
| HTML5 Canvas | — | Full control: no engine, you own loop/rendering/physics | Snake, Flappy, custom physics |
| KAPLAY | 3001 | Fastest playable game — beginner verb API | Jam arcade, endless runners |
| Phaser | 4.2 | Production 2D: scenes, physics, tilemaps, tweens | Platformers, shooters, tile RPGs |
| PixiJS | 8.19 | Max WebGL rendering perf; you write the logic | Bullet-hell, sprite-heavy scenes |
| Excalibur.js | 0.32 | TypeScript-native typed Actor classes, physics built in | Top-down action, structured mid-size games |
| LittleJS | 1.18 | Built-in particles + procedural ZzFX sound — juice, zero assets | Brick breakers, explosive arcade |
| Three.js / R3F | 0.185 / 9 | 3D as React components (JSX scene graph) | Racing, bowling, 3D puzzles |
| Babylon.js | 9.16 | Full 3D engine — WebGPU, physics-ready meshes | 3D arenas, ambitious worlds |

## Templates

Use `fgs init my-game --template <name>` to start from a platform template.

| Template | Flag | Best for |
| --- | --- | --- |
| Canvas | `canvas` | Platformers, shooters, Snake, Pac-Man, Frogger |
| Grid | `grid` | Minesweeper, Sudoku, 2048, Match-3, Word Search |
| Cards | `cards` | Solitaire, Memory, card games |
| 3D | `3d` | Racing, bowling, 3D puzzles |
| Phaser | `phaser` | 2D arcade games with physics |
| Kaplay | `kaplay` | Simple 2D games |
| PixiJS | `pixi` | Sprite-heavy games |
| Babylon.js | `babylon` | Advanced 3D games |
| Excalibur | `excalibur` | Typed actor-based 2D |
| LittleJS | `littlejs` | Juicy arcade, zero assets |

## Project structure

A typical game repo uses a root workspace and a `web` app:

```txt
game-name/
  package.json
  pnpm-workspace.yaml
  web/
    index.html
    package.json
    vite.config.ts
    public/
      manifest.json
    src/
      main.tsx
      index.css
      App.tsx
      components/
      hooks/
      game/
```

## Publishing

The normal flow is:

1. Open a submission or use the Console to provision the game.
2. Build from a template and run the game locally.
3. Run `fgs check`.
4. Push to `main`.
5. GitHub Actions builds and deploys the game to Cloudflare R2 at its subdomain.
6. The storefront lists the game after metadata and compliance checks pass.

For the full walkthrough, see [Publish to the storefront](/docs/start/publishing/).

## Compliance checklist

Before listing, every game should satisfy:

- Playable core loop with no placeholder title-screen-only release.
- Mobile support at 320px and desktop support at 1024px and wider.
- Touch controls where needed, plus keyboard or mouse controls where expected.
- No production console errors.
- PWA manifest and offline behavior.
- No tracking, analytics, remote ads, or paid upgrade flows.
- Shared platform shell and brand tokens for common UI.
- Platform mute respected by every sound source. See
  [Custom audio that respects mute](/docs/how-to/custom-audio/).
- Source repo and license available.

The automated suite is documented in [All checks](/docs/compliance/checks/).
