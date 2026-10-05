---
title: useLeaderboard(gameId)
description: Submit scores and read top/recent leaderboards. One hook, no backend to run.
---

`useLeaderboard(gameId)` is the data hook for the platform leaderboard
service. It fetches the top + recent scores for your game, gives you a
`submitScore(n)` function, and auto-refreshes after a submission.

## Signature

```ts
function useLeaderboard(gameId: string): {
  topScores: LeaderboardEntry[];
  recentScores: LeaderboardEntry[];
  submitScore: (score: number) => Promise<{ ok: boolean; rank?: number }>;
  loading: boolean;
  refresh: () => void;
}

interface LeaderboardEntry {
  player_name: string;
  score: number;
  user_id?: string;
  avatar_url?: string;
  created_at: string;
}
```

## gameId

The string you use to scope scores. **Must match your `registry.json` entry's
`id` field** (otherwise the storefront won't show your scores on your detail
page). Stick to lowercase kebab-case: `tetris`, `space-invaders`,
`pac-man`.

## Submitting a score

```tsx
import { useLeaderboard } from '@freegamestore/games';

function Game() {
  const { submitScore } = useLeaderboard('my-game');

  async function onGameOver(finalScore: number) {
    const result = await submitScore(finalScore);
    if (result.ok && result.rank) {
      console.log(`You ranked #${result.rank}`);
    }
  }
  // ...
}
```

`submitScore` is mute on the auth — it uses the same session cookie
[`useAuth`](/docs/sdk/use-auth/) reads:

- **Signed in** → score is recorded under the user's GitHub identity, with
  avatar.
- **Signed out** → the API rejects the submit. `ok: false`.

Higher score = better, by convention. If your game scores low-is-good (golf,
sudoku-time), invert before submitting: `submitScore(MAX - timeInSeconds)`.

## Showing scores

```tsx
const { topScores, recentScores, loading } = useLeaderboard('my-game');
```

Or use [`<Leaderboard>`](/docs/sdk/leaderboard/) — the pre-built two-tab list:

```tsx
import { Leaderboard, useLeaderboard } from '@freegamestore/games';

function HighScores() {
  const lb = useLeaderboard('my-game');
  return <Leaderboard {...lb} />;
}
```

## Auto-refresh after submit

After a successful `submitScore`, the hook refetches `topScores` and
`recentScores` automatically — your `<Leaderboard>` instantly shows the new
entry without extra wiring.

## Manual refresh

`refresh()` re-fetches without submitting. Useful if you suspect another
player just submitted (e.g. multiplayer) and want to update the list.

## Rate limits

The platform rate-limits anonymous read traffic per IP and write traffic per
user. Don't `submitScore` more than once per game session. The hook does no
client-side deduplication — that's your job.

## Related

- [`<Leaderboard>`](/docs/sdk/leaderboard/) — the pre-built list component.
- [`useAuth`](/docs/sdk/use-auth/) — gates writes via the session cookie.
- [Add a leaderboard](/docs/how-to/leaderboard/) — full walkthrough.
