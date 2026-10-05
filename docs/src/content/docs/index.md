---
title: FreeGameStore SDK
description: Build, ship, and maintain a free PWA game that fits in. Everything you need is in this site.
template: splash
hero:
  tagline: A free games store for the open web. Build your game with our SDK, push to GitHub, and we publish it.
  actions:
    - text: Build your first game
      link: /docs/start/first-game/
      icon: right-arrow
      variant: primary
    - text: SDK reference
      link: /docs/sdk/overview/
      icon: open-book
---

## What this is

FreeGameStore.online is a curated, free-forever marketplace for PWA games.
Every listed game is open-source under MIT, tracking-free, brand-consistent,
and audited weekly.

The SDK (`@freegamestore/games`) gives you the brand-matched shell, an auth
hook, a leaderboard, and a synthesized sound system — so your game looks
and behaves like the rest of the catalog without you having to think about
it.

## Three things to know

- **Build once, deploy free.** Static PWA on Cloudflare R2. We don't host
  your code; you push to your own GitHub repo and CF Pages picks it up.
- **The shell is required, the rest is opt-in.** Wrap your game in
  [`<GameShell>`](/docs/sdk/game-shell/) and you've satisfied the layout and
  brand checks. Everything else is a hook.
- **The platform mute toggle is the law.** If your game makes any sound, it
  has to respect [`useSound().muted`](/docs/sdk/use-sound/). The compliance
  check refuses to publish silent-button games. The easiest path is
  [`useGameSounds()`](/docs/sdk/use-game-sounds/) — it's mute-aware by
  default.

## Next

Start with [Build your first game](/docs/start/first-game/) — a 10-minute
walkthrough from `npx fgs init` to a deployed game on a `*.freegamestore.online`
subdomain. From there: [SDK reference](/docs/sdk/overview/) for what to
import, [How-to guides](/docs/how-to/audio/) for common patterns,
[Developer guidelines](/docs/guidelines/) for platform rules, and
[Compliance](/docs/compliance/why/) for what we audit and why.
