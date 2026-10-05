---
title: GameAuth
description: Drop-in sign-in / avatar widget for the topbar.
---

`<GameAuth>` is the all-in-one sign-in widget for FreeGameStore games.
Internally it calls [`useAuth()`](/docs/sdk/use-auth/) and renders one of:

- **Loading** — empty `<div/>` while the session lookup is in flight.
- **Signed out** — a small "Sign in" text button. Click → GitHub OAuth.
- **Signed in** — avatar + first name. Click → "Sign out" dropdown.

The widget has no props. Identity flows through the platform — every game in
the catalog sees the same signed-in user.

## Where it goes

In `<GameTopbar>`'s `actions` slot:

```tsx
import { GameShell, GameTopbar, GameAuth } from '@freegamestore/games';

export function App() {
  return (
    <GameShell topbar={<GameTopbar title="Snake" score={42} actions={<GameAuth />} />}>
      <Game />
    </GameShell>
  );
}
```

That's the whole integration.

## What it talks to

`auth.freegamestore.online` — the platform's GitHub OAuth proxy.
A successful sign-in sets a first-party cookie scoped to
`.freegamestore.online`, so the same user shows up signed-in across every
game subdomain.

You don't host any of this — the platform does. You don't need a client ID,
a callback URL, or a database. Sign-in just works.

## When you need the underlying user

If you need the actual `User` object (id, name, avatar) somewhere besides
the topbar — e.g. to gate features or pre-fill a form — call
[`useAuth()`](/docs/sdk/use-auth/) directly. `<GameAuth>` is the topbar
widget; `useAuth()` is the data hook.

## Constraints

- **No custom auth UIs.** Use this widget — same look, same behavior,
  everywhere. The compliance check fails any game that ships its own
  sign-in form.
- **No silent sign-in.** Showing the user's avatar without their explicit
  click is fine. Submitting scores under a signed-in user happens via
  [`useLeaderboard`](/docs/sdk/use-leaderboard/), which uses the cookie.
