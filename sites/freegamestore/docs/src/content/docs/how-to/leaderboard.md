---
title: Add a leaderboard
description: Submit scores and show top/recent runs. No backend to host.
---

A leaderboard takes two lines in your game code plus one component on
your game-over screen.

## 1. The setup is already done

`<GameAuth>` is already in your topbar (from `npx fgs init`). The platform
handles GitHub sign-in. Anonymous players can play but can't submit.

## 2. Submit a score when the game ends

```tsx
import { useLeaderboard } from '@freegamestore/games';

export function Game() {
  const { submitScore } = useLeaderboard('my-game'); // ← your registry.json id

  async function endGame(finalScore: number) {
    const result = await submitScore(finalScore);
    if (!result.ok) {
      // user wasn't signed in, or network failed — score is lost
      return;
    }
    if (result.rank) {
      // tell them where they landed
    }
  }
}
```

The `gameId` (here `'my-game'`) **must match** your entry's `id` in
`registry.json` — otherwise the storefront's detail page won't show your
scores.

## 3. Render the list

The pre-built component:

```tsx
import { Leaderboard, useLeaderboard } from '@freegamestore/games';

function HighScoresPanel() {
  const lb = useLeaderboard('my-game');
  return <Leaderboard {...lb} />;
}
```

Two tabs: Top, Recent. Numbered list. Brand-styled. Done.

## 4. Where to show it

- **Pre-game splash** — gives a target to beat.
- **Game-over screen** — by the time it renders, `submitScore` has already
  resolved and the hook has refreshed itself, so the player's new entry
  is in the list.

## Score conventions

- **Higher = better.** If your game scores low-is-good (golf strokes, sudoku
  time-to-solve), invert before submitting:
  `submitScore(BIG_NUMBER - timeSeconds)`.
- **Integer scores only.** The API accepts a `number`; fractional values
  get stored but the display rounds.

## Anonymous play

A player who isn't signed in can still play your game — but `submitScore`
returns `{ ok: false }` for them, and no row is created. Standard UX is:

1. Game over.
2. Show their final score.
3. Show the leaderboard.
4. If their score would have made the top 10, show "Sign in to save your
   score" with the same `<GameAuth>` widget pattern.

You can read the auth state with [`useAuth()`](/docs/sdk/use-auth/) to
make that conditional explicit.

## When you need a custom view

If a two-tab list doesn't fit (podium UI, country flags, daily-only,
personal-best ribbon), skip `<Leaderboard>` and read `topScores` /
`recentScores` directly from the hook — render whatever you want.

## Related

- [`useLeaderboard`](/docs/sdk/use-leaderboard/) — full API.
- [`<Leaderboard>`](/docs/sdk/leaderboard/) — the pre-built list.
- [`useAuth`](/docs/sdk/use-auth/) — gates writes.
