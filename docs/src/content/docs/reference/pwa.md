---
title: PWA + offline rules
description: Every listed game is installable and works offline. Here's the contract.
---

FreeGameStore is a PWA marketplace. Every listed game must:

- Be installable (valid manifest).
- Work offline (service worker caches the shell).
- Be viewport-stable (no scroll, no broken iOS bar handling).
- Declare a supported orientation.

The scaffolded `vite.config.ts` already satisfies all of this. This page
is for when you need to tweak it.

## The manifest

Manifest is declared inline in `web/vite.config.ts` via `vite-plugin-pwa`,
*not* as a static `web/public/manifest.json` file:

```ts
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'My Game',
        short_name: 'MyGame',
        description: 'A short pitch.',
        theme_color: '#10b981',
        background_color: '#fdfaf3',
        display: 'standalone',
        orientation: 'any',          // or 'portrait' or 'landscape'
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
```

The compliance suite parses this inline manifest from `vite.config.ts`
directly — it understands the brace-balanced shape, so you can reorder or
add comments.

## Required manifest fields

| Field | Why |
|---|---|
| `name` | Shown in the install prompt. |
| `short_name` | Shown on the home screen icon. |
| `description` | Shown in the storefront detail page. |
| `theme_color` | The browser chrome color on Android. |
| `background_color` | The splash screen color. Match `--paper`. |
| `display: 'standalone'` | Removes the browser chrome when installed. |
| `start_url` | Should be `/`. |
| `orientation` | `any`, `portrait`, or `landscape`. Pick what your game expects. |
| `icons` | At least a 192 + 512 + 512 maskable. |

## Orientation

Pick the one that matches your game's UX:

- **`portrait`** — phone in hand, vertical play (Tetris, match-3).
- **`landscape`** — wider play field (most arcade games).
- **`any`** — your game adapts to either. Default. Pick this unless you
  know.

Devices honor the lock when the PWA is installed. In the browser tab, the
user can rotate freely.

## Icons

The scaffold ships two:

- `/icon-192.png` — 192×192, full-bleed, opaque background.
- `/icon-512.png` — 512×512, same.

Put them in `web/public/`. The compliance check `manifest` verifies the
`icons` array is present in the manifest; it doesn't validate the pixels.

A 512×512 **maskable** variant is recommended (Android may crop a
circle/squircle from your icon — a maskable version keeps the logo inside
the safe zone) but not required.

## The service worker

`vite-plugin-pwa` generates `web/dist/sw.js` automatically with the
default `GenerateSW` strategy:

- Precaches every static asset in `web/dist/`.
- Cache-first for hashed assets, stale-while-revalidate for `index.html`.

That gives you offline play for free. The compliance check `pwa-offline`
just verifies `sw.js` is present in the build.

## Avoiding common breaks

- **Don't disable the PWA plugin** for "just a quick test." Once disabled,
  it's easy to forget. The compliance check catches it, but only after
  push.
- **Don't reference assets from a CDN.** Anything not in `web/dist/` is
  not cached by the service worker and won't load offline. Brand fonts
  (Google Fonts) are an explicit exception — the storefront caches them
  via its own service worker.
- **Don't use `100vh`.** Use `100svh`. `<GameShell>` already does. See
  [`unsafe-vh`](/docs/compliance/checks/).

## The `<head>` meta tags

Your `web/index.html` also needs:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#10b981" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<link rel="apple-touch-icon" href="/icon-192.png" />
```

The scaffold ships them. The compliance check `pwa-meta` greps for them.

## Related

- [All checks](/docs/compliance/checks/) — `manifest`, `pwa-meta`, `pwa-offline`, `viewport-support`, `unsafe-vh`.
- [`<GameShell>`](/docs/sdk/game-shell/) — handles `100svh` and overflow.
