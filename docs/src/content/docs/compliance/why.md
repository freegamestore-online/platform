---
title: Why we audit
description: A curated storefront only works if the catalog stays curated.
---

FreeGameStore is **curated**. That means every listed game looks like it
belongs, behaves like it belongs, and doesn't degrade the experience for
players who tap on the next game over.

Two ways to enforce that:

1. **Editorial review on every change** — slow, doesn't scale, blocks you.
2. **An automated compliance suite** — runs in CI, runs on a schedule,
   runs on your machine before you push.

We picked (2).

## What the audit guards against

- **Visual inconsistency.** Every game uses Manrope + Fraunces, the same
  accent color, the same topbar. Without enforcement, the catalog would
  drift into a salad of fonts and color palettes inside a year.
- **Tracking and surveillance.** No Google Analytics, no Plausible, no
  Sentry, no `<img src="https://pixel.example.com/...">`. Listed games are
  tracking-free, period. The audit greps your bundle for known scripts and
  endpoints.
- **Performance regressions.** Free games run on the platform's free tier —
  bundle bloat hurts everyone. There's a hard size cap (300 KB, 600 KB for
  3D games).
- **Broken PWAs.** Every listed game must be installable, offline-capable,
  and viewport-stable. Without checks, "PWA" becomes a checkbox lie.
- **Silent audio violations.** Games must respect the platform mute toggle.
  The check fails any game that ships a raw `AudioContext` without a
  `useSound()` gate.
- **License drift.** Listed games are MIT. The audit confirms the LICENSE
  file matches.
- **Brand surface removal.** The storefront link in the footer, the home
  icon in the topbar, the mute toggle — all enforced. You can't ship a
  white-labeled fork.

## Where the audit runs

- **Locally** when you run `npx fgs check` — same checks CI runs.
- **In CI** on every push to your repo — fails the build, blocks the
  GitHub Actions → R2 deploy.
- **On a 6-hour schedule** — the storefront re-audits every listed game.
  If yours drifts after merge (a dependency added tracking, a fork added a
  new font), the storefront flags your detail page until you fix it.

## What happens when an audit fails

- **Pre-merge to the registry:** You can't list. Fix and re-PR.
- **Post-merge:** Your game stays live — the detail page works, the
  domain stays up. But the badge on your card goes from green to yellow,
  and the listing shows the failed checks publicly. Most games fix within
  a day; persistent failures get unlisted.

## What we don't audit

- **Gameplay.** We don't grade your fun. A bad game and a great game pass
  the same audit.
- **Code style.** No linting against our preferences. Use TypeScript or
  not; use Vue or React or vanilla. The bundle is what we care about.
- **Performance beyond bundle size.** We don't measure FPS or input
  latency. Players will tell you if your game runs at 12 FPS.

## Read on

- [All checks](/docs/compliance/checks/) — every rule, what it does, how to
  pass.
- [CLI: fgs check](/docs/compliance/cli/) — running the audit locally.
