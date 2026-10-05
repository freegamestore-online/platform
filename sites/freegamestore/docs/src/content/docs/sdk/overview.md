---
title: SDK overview
description: What @freegamestore/games exports, and which exports you actually need.
---

`@freegamestore/games` is one npm package. Add it to your game's `web/package.json`:

```json
{
  "dependencies": {
    "@freegamestore/games": "^0.13.0",
    "react": "^19",
    "react-dom": "^19"
  }
}
```

That's the only required dep beyond React + the storefront brand fonts
(loaded via Google Fonts in `index.html`).

## Exports at a glance

### Components

| Component | When to use |
|---|---|
| [`<GameShell>`](/docs/sdk/game-shell/) | Required wrapper. Provides layout lock + the SoundProvider that audio hooks read. |
| [`<GameTopbar>`](/docs/sdk/game-topbar/) | The brand-matched topbar. Mount inside `GameShell`'s `topbar` prop. |
| [`<GameButton>`](/docs/sdk/game-button/) | The brand-matched button. Use for in-game UI to match the topbar style. |
| [`<GameAuth>`](/docs/sdk/game-auth/) | Sign-in / sign-out button. Drop into the topbar's `actions` prop. |
| [`<Leaderboard>`](/docs/sdk/leaderboard/) | Pre-built top/recent scores list. |

### Hooks

| Hook | Returns |
|---|---|
| [`useAuth()`](/docs/sdk/use-auth/) | `{ user, signIn, signOut, loading }` |
| [`useLeaderboard(gameId)`](/docs/sdk/use-leaderboard/) | `{ topScores, recentScores, submitScore, loading, refresh }` |
| [`useSound()`](/docs/sdk/use-sound/) | `{ muted, toggle }` — the platform mute state |
| [`useGameSounds()`](/docs/sdk/use-game-sounds/) | 8 synthesized SFX functions, mute-aware |

### Types

`LeaderboardEntry`, `User`, `GameShellProps`, `GameTopbarProps`, `GameTopbarStat`,
`GameButtonProps`, `GameButtonVariant`, `GameButtonSize`, `LeaderboardProps`.

## The one rule

**`useSound()` and `useGameSounds()` only work when called from a component
rendered inside `<GameShell>`.** `GameShell` mounts the `SoundProvider`
internally. Hooks called above it get a disconnected default that's
permanently muted — and you'll spend an evening wondering why your audio
spy never fires.

The full pattern is documented in
[Custom audio that respects mute](/docs/how-to/custom-audio/).

## Versioning

The SDK is a single semver-pinned package. Breaking changes bump the minor
(we're still pre-1.0). Each scaffolded game pins `^0.13.0` so a minor bump
upgrades cleanly. Major bumps surface in [the changelog](https://github.com/freegamestore-online/public/releases).
