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

## Tech stack

New games should follow the platform stack unless a specific game engine needs a
small variation.

| Layer | Choice |
| --- | --- |
| Language | TypeScript |
| Framework | React |
| Bundler | Vite |
| Styling | Tailwind CSS and platform CSS variables |
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
