---
title: What is FreeGameStore?
description: A curated, free-forever PWA games marketplace and the SDK that powers it.
---

FreeGameStore.online is a marketplace for free, open-source PWA games. Every
listed game lives in its own public GitHub repo (you keep ownership), ships
under the MIT license, has no tracking, and is audited weekly against a
shared compliance suite. The storefront aggregates them, drives traffic,
and provides the shared backend (auth, leaderboards, brand assets).

## What you ship

A static PWA. No server. No subscription. No vendor lock-in. Your repo +
Cloudflare R2 (GitHub Actions deploy).

The standard surface is:

```
my-game/
  web/
    src/             # React + Vite app
    public/          # static assets
    package.json     # @freegamestore/games is the only required dep
    vite.config.ts   # vite-plugin-pwa for offline + installable
  .github/workflows/ # CI: lockfile, build, compliance gate
  LICENSE            # MIT, mandatory
  README.md
```

## What FreeGameStore provides

- **Hosting at `<your-game>.freegamestore.online`** via a Cloudflare R2
  project we provision when we add you to the registry.
- **Brand-matched UI shell** ([`<GameShell>`](/docs/sdk/game-shell/),
  [`<GameTopbar>`](/docs/sdk/game-topbar/)). The storefront's look-and-feel
  for free.
- **Auth across the catalog.** Sign in once with GitHub → recognized on
  every game. [`useAuth`](/docs/sdk/use-auth/).
- **A leaderboard backend.** Submit scores, render top/recent. No infra to
  run. [`useLeaderboard`](/docs/sdk/use-leaderboard/).
- **Synthesized SFX with mute integration.** Zero audio assets to ship.
  [`useGameSounds`](/docs/sdk/use-game-sounds/).
- **A compliance gate.** CI fails the build if your game drifts from the
  brand or breaks an offline expectation. [Why we audit](/docs/compliance/why/).

## What FreeGameStore *doesn't* provide

- A backend you can write to (apart from leaderboards + auth). Stateful
  games keep state in localStorage or run their own backend.
- Paid features. Free apps/games go on the free side. Paid features ship
  to ProAppStore / ProGameStore (separate brands).
- A CMS for your game. The repo is the source of truth.

## Next

[Build your first game](/docs/start/first-game/).
