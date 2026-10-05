---
title: All checks
description: Every compliance check, what it looks for, and how to pass.
---

The compliance suite is a list of independent checks. Each is implemented
in `@freegamestore/compliance` and shipped as part of the `fgs check` CLI.
Each check returns pass / fail with a human-readable reason.

## How to read this page

Each check has:
- **What it checks** — the assertion.
- **How it checks** — the mechanism (file read, regex, etc.).
- **How to pass** — the standard fix.

## Brand & layout

### `brand-fonts`
**What:** Your `index.html` loads Manrope + Fraunces from Google Fonts.
**How:** Greps `web/index.html` for the two font URLs.
**Pass:** Keep the `<link>` tags that ship with the scaffold.

### `brand-tokens`
**What:** Your CSS defines `--paper`, `--ink`, `--accent`, `--muted`, `--line`, `--panel`.
**How:** Greps your CSS files for the tokens.
**Pass:** Don't delete the tokens block from `web/src/index.css`. See [Brand tokens](/docs/reference/brand-tokens/).

### `no-brand-overrides`
**What:** You don't override the SDK's color or font tokens at the component level.
**How:** Scans for inline styles touching `--accent`, font family, etc.
**Pass:** Use the tokens; don't write `style={{ color: '#ff0000' }}` on a topbar element.

### `no-scroll`
**What:** Your page can't introduce body scroll.
**How:** Looks for missing `overflow: hidden` on root containers.
**Pass:** Use `<GameShell>` — it sets the right values for you.

### `unsafe-vh`
**What:** You don't use `100vh` (broken on iOS).
**How:** Greps your CSS / inline styles for `100vh`.
**Pass:** Use `100svh` instead. `<GameShell>` handles this already.

## PWA & manifest

### `manifest`
**What:** A valid web app manifest is present in your build output.
**How:** Reads `web/dist/manifest.webmanifest` (vite-plugin-pwa output) or
parses an inline VitePWA manifest from `web/vite.config.ts`.
**Pass:** Keep the `VitePWA({ manifest: ... })` block in `vite.config.ts`.

### `pwa-meta`
**What:** `<meta>` tags for PWA are present (`theme-color`, `apple-mobile-web-app-capable`, etc.).
**How:** Greps your built `index.html`.
**Pass:** Keep the scaffold's `<head>` block.

### `pwa-offline`
**What:** A service worker is registered and caches the shell.
**How:** Checks `web/dist/sw.js` (vite-plugin-pwa output).
**Pass:** Don't disable the PWA plugin.

### `viewport-support`
**What:** The manifest declares supported orientations.
**How:** Reads `orientation` from the manifest.
**Pass:** Set `orientation: 'any' | 'portrait' | 'landscape'` in your inline VitePWA manifest.

### `html-meta`
**What:** `<title>`, `<meta name="description">`, viewport are present.
**How:** Greps `web/index.html`.
**Pass:** Keep the scaffolded `<head>` and fill in your title.

## Performance

### `bundle-size`
**What:** Built JS/CSS bundle fits the budget.
**How:** Sums sizes under `web/dist/`.
**Pass:** ≤300 KB. **≤600 KB** if your `package.json` declares
`@babylonjs/core`, `three`, or `@react-three/fiber` — those engines are
that size on their own.

## Audio

### `audio-mute-respect`
**What:** Every raw audio API in your bundle is gated on `useSound()`.
**How:** Greps for `new AudioContext()`, `new Audio()`, `<audio>`,
`webkitAudioContext`, `.loadSound(` — fails if found without a nearby
`muted` / `useSound` reference.
**Pass:** Use [`useGameSounds`](/docs/sdk/use-game-sounds/) and you're already passing. For custom audio, follow [Custom audio that respects mute](/docs/how-to/custom-audio/).

## Privacy & licensing

### `no-tracking`
**What:** Your bundle contains no known tracking scripts or endpoints.
**How:** Greps for `google-analytics.com`, `gtag(`, `plausible`, `sentry-cdn`, `mixpanel`, `segment.com`, `hotjar`, `posthog`, and a few others. Uses word boundaries so legit words like "segment" in 3D code don't false-flag.
**Pass:** Don't add analytics. Use console logs in dev only.

### `no-env-production`
**What:** No `.env.production` file is in your repo.
**How:** File lookup.
**Pass:** Don't check secrets in. Use `.env.local` (gitignored) for dev secrets.

### `license-mit`
**What:** A LICENSE file is present and is MIT.
**How:** Reads the file, fingerprints the text.
**Pass:** Keep the scaffolded `LICENSE`. Edit the copyright holder line.

### `no-placeholders`
**What:** Your `package.json`, `index.html` and README don't contain
template literals like `{{title}}` or `TODO`.
**How:** Greps for known placeholder patterns.
**Pass:** Fill in your actual title and metadata.

## Storefront integration

### `store-link`
**What:** Your footer links back to `freegamestore.online`.
**How:** Greps your built bundle for the URL.
**Pass:** Mount `<GameShell>` — it renders the link.

### `claude-md-slim`
**What:** Your `CLAUDE.md`, if present, is short and points at the platform's docs rather than duplicating them.
**How:** Word-count + content sniff.
**Pass:** Either don't ship a `CLAUDE.md` or keep it under ~50 lines that reference these docs.

### `dark-mode`
**What:** App responds to the system color scheme.
**How:** Greps for `prefers-color-scheme`, `data-theme`, or `color-scheme`.
**Pass:** **Games are auto-skipped** (full-bleed UIs pick their own palette). The check is enforced on apps, not games.

## How to run them all locally

```bash
npx -y @freegamestore/cli@latest check
```

See [CLI: fgs check](/docs/compliance/cli/) for details.
