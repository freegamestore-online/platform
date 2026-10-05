---
title: Leaderboard
description: Pre-built top/recent scores list. Pair with useLeaderboard.
---

`<Leaderboard>` renders a two-tab list (Top / Recent) of player scores. It's
the pre-styled view layer over [`useLeaderboard()`](/docs/sdk/use-leaderboard/).
No state of its own — pass data in, render.

## Signature

```ts
interface LeaderboardProps {
  topScores: LeaderboardEntry[];
  recentScores: LeaderboardEntry[];
  loading: boolean;
}

interface LeaderboardEntry {
  player_name: string;
  score: number;
  user_id?: string;
  avatar_url?: string;
  created_at: string;
}
```

## Usage

```tsx
import { Leaderboard, useLeaderboard } from '@freegamestore/games';

function HighScores() {
  const { topScores, recentScores, loading } = useLeaderboard('my-game');
  return (
    <Leaderboard
      topScores={topScores}
      recentScores={recentScores}
      loading={loading}
    />
  );
}
```

That's the whole thing.

## Where to mount it

Anywhere inside `<GameShell>`. Common patterns:

- **Pre-game splash:** show the top scores so a new player knows what they're
  aiming at.
- **Game-over screen:** show the leaderboard after submitting the run's score
  so the player sees their rank instantly (`useLeaderboard.submitScore` already
  refreshes the list).

## What it looks like

- **Two tabs:** "Top" (top scores) and "Recent" (latest submissions).
- **Rank badge** — positions 1-3 use the accent color; rest are muted.
- **Player name** — truncated past ~8rem.
- **Score** — right-aligned, Fraunces serif, tabular numerals.

Brand colors come from CSS variables (`--accent`, `--muted`, `--line`) — no
extra config needed.

## Empty / loading

- `loading: true` → "Loading scores..." centered.
- Both lists empty → "No scores yet. Be the first!"

## When to skip this

If your game wants a custom layout — a podium, an animated 1st-place spotlight,
a country flag column — read `topScores` / `recentScores` from
`useLeaderboard` directly and render your own component. The data is the same;
this component is just convenient.

## Related

- [`useLeaderboard`](/docs/sdk/use-leaderboard/) — the data hook.
- [Add a leaderboard](/docs/how-to/leaderboard/) — full walkthrough.
