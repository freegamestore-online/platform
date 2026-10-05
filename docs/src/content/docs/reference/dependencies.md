---
title: Required dependencies
description: What's in a scaffolded game's package.json, and what it's all for.
---

A FreeGameStore game has one required runtime dependency. Everything else
is up to you — pick the engine, the language tooling, the testing stack.

## Required

```json
{
  "dependencies": {
    "@freegamestore/games": "^0.13.0",
    "react": "^19",
    "react-dom": "^19"
  }
}
```

That's it. Three lines.

- `@freegamestore/games` — the SDK. Components, hooks, types. See [Overview](/docs/sdk/overview/).
- `react` + `react-dom` — peers of the SDK. The SDK is React-only; if your
  game uses a different framework, you'd still need to mount a React tree
  for `<GameShell>` and the topbar.

## Required (build-time)

In `devDependencies` from the scaffold:

```json
{
  "devDependencies": {
    "vite": "^8",
    "@vitejs/plugin-react": "^4.3",
    "vite-plugin-pwa": "^1.3",
    "typescript": "^7",
    "@types/react": "^19",
    "@types/react-dom": "^19"
  }
}
```

- **Vite** — the build tool. Outputs `web/dist/`.
- **vite-plugin-pwa** — generates `manifest.webmanifest` and `sw.js`. The
  manifest is declared inline in `vite.config.ts`, not as a static file.
- **TypeScript** — the scaffold is TS by default. You can rip it out and
  use JS if you really want; the compliance suite doesn't require TS.

## Required (HTML, not npm)

In `web/index.html`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Fraunces:opsz,wght@9..144,700;9..144,800&display=swap"
  rel="stylesheet"
/>
```

The brand fonts — Manrope (UI text) + Fraunces (display numbers). Loaded
via Google Fonts. The compliance check `brand-fonts` greps for these URLs.

## Optional but common

| Package | Use |
|---|---|
| `kaplay` | Game engine — 2D physics, sprites, scenes. |
| `@babylonjs/core` | 3D engine. Triggers the 600 KB bundle budget. |
| `three` | 3D engine. Also 600 KB. |
| `@react-three/fiber` | React bindings for three. 600 KB. |
| `phaser` | 2D engine. |
| `pixi.js` | 2D WebGL renderer. |
| `excalibur` | TypeScript-native actor-based 2D engine. |
| `littlejsengine` | Tiny all-in-one arcade engine — particles + ZzFX sound built in. |

The bundle size check (`bundle-size`) is the only thing that cares — if
you ship a 3D engine, you get 600 KB; otherwise you get 300 KB.

## Forbidden

The compliance check `no-tracking` greps for these by name in the bundle.
Even if not declared in `package.json`, a transitive copy will fail:

- `@google-analytics/data` / `gtag`
- `posthog-js`
- `mixpanel-browser`
- `@sentry/browser`
- `plausible-tracker`
- Anything that ships a tracking pixel to a third-party domain.

If you need error reporting in dev, use `console.error`. Production
telemetry isn't allowed on the free side.

## How dependencies upgrade

- **The SDK** bumps with the platform. Bump `@freegamestore/games` in
  `web/package.json` manually, then `pnpm install` to refresh the lockfile.
  Watch the [changelog](https://github.com/freegamestore-online/public/releases)
  for what changed. Each minor bump can be breaking until 1.0.
- **React** stays on 19 until the platform itself moves. Don't unilaterally
  upgrade to React 20 — the SDK is built against 19.
- **Vite / typescript / other dev tooling** — your call. The compliance
  suite cares about your bundle, not your tooling.

## Related

- [SDK overview](/docs/sdk/overview/) — what `@freegamestore/games` exports.
- [PWA + offline rules](/docs/reference/pwa/) — `vite-plugin-pwa` config.
