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

### `css-discipline` (warning)
**What:** Your CSS follows the Tailwind-on-tokens model ([ADR-001](https://github.com/freegamestore-online/platform/blob/main/docs/adr/001-tailwind-on-fgs-tokens.md)): `index.css` holds tokens, `@theme` and `@layer` rules only.
**How:** Reads your source CSS (not `public/`, `dist/` or `*.min.css`) and reports five rules: `banned-alias` (`--surface`, `--border`, `--glass`, `--dock`, `--error`), `unlayered-rule` (a style rule outside `@layer`), `hex-outside-tokens` (a hex colour outside a `:root` token block or `@theme`), `per-screen-dark-override` (a dark-mode rule that isn't a `:root` token block) and `feature-classes` (a class selector such as `.score-badge`). `--bg` is not banned: `brand-tokens` still requires it for games.
**Pass:** Put colours in `:root` tokens, base rules in `@layer base`, and style components with Tailwind utilities. A warning for now; it becomes a failure after the fleet migration ([#398](https://github.com/freegamestore-online/platform/issues/398)).

### `opaque-surface` (warning)
**What:** `--paper`, `--panel` and `--popover` are opaque.
**How:** Warns when any of those tokens has alpha below 1 (`rgba(…, 0.72)`, `#rrggbbaa`, `rgb(… / 50%)`, `transparent`). A `var()` value isn't resolved.
**Pass:** Use an opaque colour. Menus, modals and result screens sit on these tokens, and a translucent one lets the game show through the text. A translucent scrim behind a dialog is fine.

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

### `no-payment-capabilities`
**What:** Your game uses no browser payment capability. FreeGameStore games take no payments ([#376](https://github.com/freegamestore-online/platform/issues/376)).
**How:** Fails on the Payment Request API, the Payment Handler API (`paymentManager`, `paymentrequest`/`canmakepayment` events), Apple Pay or Google Pay JS, an iframe with `allow="payment"`, `payment*` or `serviceworker` members in your web app manifest, or `payment` in `freegamestore.permissions`. Scans `web/src` and `web/index.html` with comments ignored. Payment-provider SDKs are `no-payment-sdk`'s job.
**Pass:** Remove the payment code. The word "payment" in text, and a link to your own donation page, are fine.

### `no-external-fetch` (warning)
**What:** Your code doesn't call hosts outside the platform. The host allows `fetch`, XHR and WebSocket to any https host ([#373](https://github.com/freegamestore-online/platform/issues/373)), so this makes it visible instead of blocking it.
**How:** Looks for `fetch('https://…')`, `new WebSocket('wss://…')` and XHR `.open(…)` URLs in `web/src`, comments ignored. `freegamestore.online`, `localhost` and `127.0.0.1` are never reported.
**Pass:** Nothing to do for a warning. The message lists each external host so review can see where data goes. Your own server or a public API is fine; keep the game usable offline (see `pwa-offline`).

### `no-cookies` (warning)
**What:** Your code doesn't use cookies. A first-party cookie on your game's own origin is equivalent to `localStorage`, so this is a warning, not a failure.
**How:** Looks for `document.cookie`, `js-cookie`, `cookie-parser` and `Cookies.get/set` in your source, comments ignored.
**Pass:** Prefer `localStorage` or the SDK's `app.kv`. Cookies used for tracking still fail `no-tracking`.

### `no-external-scripts` (warning with SRI, otherwise fail)
**What:** `web/index.html` loads no script from outside the platform without Subresource Integrity.
**How:** Reads every `<script src>` tag. The font CDNs (`fonts.googleapis.com`, `fonts.gstatic.com`) and the platform loader (`https://api.freegamestore.online/v1/analytics.js`) are allowed. Any other `https://` script is a **warning** if the tag has `integrity="sha256-…"`, `sha384-…` or `sha512-…` **and** `crossorigin`. It **fails** with no `integrity`, with `integrity` but no `crossorigin`, over plain `http://`, or as a protocol-relative `//` URL.
**Pass:** Add both attributes, for example `<script src="https://cdn.example.com/engine.js" integrity="sha384-…" crossorigin="anonymous">`, or self-host the file under `web/public/`.

### `no-tracking`
**What:** Your bundle contains no known tracking scripts or endpoints. This stays a hard fail, as does `no-payment-sdk`: both protect players (privacy) and the free-store policy.
**How:** Greps for `google-analytics.com`, `gtag(`, `plausible`, `sentry-cdn`, `mixpanel`, `segment.com`, `hotjar`, `posthog`, and a few others. Uses word boundaries so legit words like "segment" in 3D code don't false-flag.
**Pass:** Don't add analytics. Use console logs in dev only.

### `no-page-policy` (warning)
**What:** `web/index.html` doesn't set its own Content-Security-Policy or Permissions-Policy with `<meta http-equiv>`.
**How:** Looks for those `http-equiv` meta tags, ignoring HTML comments.
**Pass:** Remove the tag. The host already sends both headers, default-open (see [Browser capabilities](/docs/reference/capabilities/)), and a page-level policy can only take capabilities away. A warning, not a failure: if you want a stricter policy, keep `https://api.freegamestore.online` in `script-src` and `connect-src` so the analytics loader still loads.

### `permissions-declared` (warning)
**What:** Every browser permission your code uses (motion sensors, microphone, camera, location, notifications, MIDI, gamepad, wake lock, …) is declared in `package.json` under `freegamestore.permissions`.
**How:** Looks for the matching APIs in `web/src` and `web/index.html`, comments ignored, and compares them with your declaration.
**Pass:** Add the missing ids with a one-line reason; see [Browser capabilities](/docs/reference/capabilities/#tell-players-what-your-game-asks-for). The storefront shows them on your listing.

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
