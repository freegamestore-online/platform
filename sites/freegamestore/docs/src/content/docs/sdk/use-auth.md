---
title: useAuth()
description: Read the signed-in user. Used internally by GameAuth — exposed for custom UIs.
---

`useAuth()` is the data hook behind [`<GameAuth>`](/docs/sdk/game-auth/).
Most games don't need it directly — they just mount `<GameAuth>` in the
topbar and call it done. Reach for `useAuth()` when you need the user
object somewhere else (gating a feature, pre-filling, showing a personalized
message).

## Signature

```ts
function useAuth(): {
  user: User | null;
  loading: boolean;
  signIn: () => void;
  signOut: () => void;
}

interface User {
  id: string;     // platform user id
  name: string;
  avatar: string; // avatar URL
}
```

## Behavior

- On mount, fetches the current session from `auth.freegamestore.online/me`.
- `loading: true` while in flight.
- `user` becomes either `User` (signed in) or `null` (signed out / failed).
- `signIn()` redirects to GitHub OAuth and back.
- `signOut()` clears the session cookie and reloads.

## Example: personalized greeting

```tsx
import { useAuth } from '@freegamestore/games';

function Splash() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user
    ? <h1>Welcome back, {user.name.split(' ')[0]}.</h1>
    : <h1>Welcome.</h1>;
}
```

## Example: gating a feature

```tsx
function DailyChallengeButton() {
  const { user, signIn } = useAuth();
  if (!user) {
    return <button onClick={signIn}>Sign in to play the daily</button>;
  }
  return <button onClick={startDaily}>Start daily challenge</button>;
}
```

## What doesn't work

- **Email / password.** Sign-in is GitHub OAuth. No password flow on the
  free side.
- **Reading the user before GameShell mounts.** Like all SDK hooks, call it
  from a component rendered inside `<GameShell>`.
- **Persisting state across sign-out.** When the user signs out, the page
  reloads — any in-memory game state is gone. If you need persistence,
  write to `localStorage`.

## Related

- [`<GameAuth>`](/docs/sdk/game-auth/) — the topbar widget that uses this.
- [`useLeaderboard`](/docs/sdk/use-leaderboard/) — depends on the cookie this hook reads.
