---
title: Browser capabilities
description: Which browser features a hosted game can use, and the few that are off.
---

Every game is served from its own origin, `https://<your-game>.freegamestore.online`. The platform's rule is **default-open**: your game gets the same browser features as any website on its own origin. The browser still asks the player before anything sensitive (microphone, camera, location, a USB device…), so the platform doesn't need to block it for them.

The host sends these headers on every game file. Source: `workers/host/src/host.ts`, decided in [platform#369](https://github.com/freegamestore-online/platform/issues/369).

## Device and browser features (Permissions-Policy)

`(self)` means your game's own page may use the feature. Cross-origin iframes inside your game don't get it: third-party embeds are off by default.

| Feature | State | Typical use in games |
|---|---|---|
| `accelerometer`, `gyroscope`, `magnetometer` | on (self) | Tilt and motion controls |
| `gamepad` | on (self) | Controllers |
| `fullscreen` | on (self) | Full-screen play |
| `screen-wake-lock` | on (self) | Keep the screen awake during play |
| `autoplay` | on (self) | Music and sound without a click first (browsers may still require a gesture) |
| `microphone`, `camera` | on (self) | Voice, rhythm and AR games |
| `geolocation` | on (self) | Location-based games |
| `midi` | on (self) | Music games with a MIDI keyboard |
| `xr-spatial-tracking` | on (self) | WebXR |
| `clipboard-read`, `clipboard-write` | on (self) | Share codes, copy results |
| `web-share` | on (self) | Native share sheet |
| `picture-in-picture`, `display-capture`, `encrypted-media` | on (self) | Video features |
| `bluetooth`, `hid`, `serial`, `usb` | on (self) | Custom controllers |
| `keyboard-map`, `local-fonts`, `window-management`, `idle-detection`, `compute-pressure`, `storage-access` | on (self) | Less common, available |
| `publickey-credentials-create`, `publickey-credentials-get` | on (self) | Passkeys |
| `payment` | **off, by policy** | FreeGameStore games take no payments ([#376](https://github.com/freegamestore-online/platform/issues/376)). The header is `payment=()` on every game response, and `fgs check` fails payment code. See [Developer guidelines](/docs/guidelines/). |
| `browsing-topics` | **off** | Builds an ad-targeting profile of the player; no game needs it. |

Pointer lock, vibration, notifications and persistent storage have no Permissions-Policy feature, and nothing on the platform limits them. (Pointer lock and notifications still need a user gesture or permission prompt from the browser.)

## What your game may load and call (Content-Security-Policy)

| Directive | Allows |
|---|---|
| `script-src` | your files, inline scripts, `eval`, WebAssembly, and scripts from **any https origin** (CDN engines are fine) |
| `connect-src` | `fetch`, XHR, WebSocket (`wss:`) and EventSource to **any https host** |
| `worker-src` | your files, `blob:` and `data:` workers |
| `img-src`, `media-src`, `font-src`, `style-src` | your files, `data:`, `blob:` and any https origin |
| `frame-src` | iframes from any https origin (they don't get the device features above) |

Still restricted, each with its reason:

- `object-src 'none'`: plugins (Flash, Java) are dead and only an attack surface.
- `base-uri 'self'`: an injected `<base href>` would re-point every relative URL, scripts included, at another host.
- `frame-ancestors`: only your game and the storefront may embed it, so other sites can't frame it for clickjacking.

**Don't add your own `<meta http-equiv="Content-Security-Policy">`.** The browser applies it on top of the host's policy, so it can only take capabilities away. Several games did this and blocked the platform analytics loader without noticing.

## Known limits (tracked separately)

- **SharedArrayBuffer / wasm threads.** Available through the registry opt-in described below; browser support and resource compatibility still apply.
- **Storefront preview.** Both the catalogue and detail-page previews delegate only gamepad, fullscreen, autoplay, screen-wake-lock, accelerometer, gyroscope and magnetometer to the embedded game's origin. The storefront header permits these for self and `https://*.freegamestore.online`; iframe allowlists restrict them to the iframe source origin. Browser support, user gestures and any browser permission requirements still apply; delegation does not guarantee sensor or audio access.
  Microphone, camera, geolocation, MIDI, USB, Bluetooth, HID, serial, clipboard and XR access are unavailable in previews. Games declaring or detected using these features show a **Play in a new tab** path and an explanation. Notifications also require playing outside the sandboxed preview. The game's own origin may allow a supported feature, subject to browser permissions. **Payment remains prohibited in every context**, including a new tab. Unscanned metadata cannot guarantee which features a game will request. See [#372](https://github.com/freegamestore-online/platform/issues/372).
- **Compliance checks.** `fgs check` follows the same default-open policy ([#373](https://github.com/freegamestore-online/platform/issues/373)). External `fetch`, XHR and WebSocket calls and `document.cookie` are **warnings**; the external-fetch warning lists each host. An external `<script src>` from a non-platform https origin is a warning only when the tag has `integrity="sha256-…"` (or `sha384`/`sha512`) **and** `crossorigin`; without them, or over plain http, it fails. The font CDNs and the platform analytics loader need no integrity. Direct trackers (`no-tracking`) and payment SDKs (`no-payment-sdk`) remain hard failures. See [All checks](/docs/compliance/checks/).

## Tell players what your game asks for

Every game's storefront page has a **Permissions** section, and game cards show a small icon row, so players know what the browser will ask before it asks ([#370](https://github.com/freegamestore-online/platform/issues/370)). Declare each one with a one-line reason in your repo's root `package.json`:

```json
{
  "name": "my-game",
  "freegamestore": {
    "permissions": {
      "motion": "Tilt your phone to steer",
      "gamepad": "Play with a controller"
    }
  }
}
```

Known ids: `motion` (motion and orientation sensors), `microphone`, `camera`, `location`, `notifications`, `midi`, `clipboard-read`, `bluetooth`, `usb`, `serial`, `hid`, `xr` (VR/AR), `gamepad`, `wake-lock` (keeps the screen awake). The reason is optional and is cut to one line of 120 characters.

`fgs check` looks for these APIs in your own source (`web/src` and `web/index.html`). It warns when it finds one you haven't declared, or a declaration with an unknown id. It never fails your build, and the listing shows detected permissions even when you haven't declared them; declaring adds your reason. Code in `node_modules` and in vendored files under `web/public` isn't scanned, so engine code your game never calls doesn't show up.

If your game uses none, there's nothing to do: the listing says "No special permissions".

## SharedArrayBuffer and wasm threads (cross-origin isolation)

Threaded WebAssembly engines and SharedArrayBuffer require cross-origin isolation.
Opt in by setting a boolean on the game's entry in `sites/freegamestore/registry.json`:

```json
{
  "id": "my-threaded-game",
  "crossOriginIsolated": true
}
```

This is a field on the existing registry entry, alongside its name and appUrl;
it is not a PWA manifest field or a package.json permission. Publish the registry
change through the existing storefront deployment. The game host reads the
published public registry, matches the game id and origin, and caches it for up
to 60 seconds. No per-game hosting route migration is needed.

For an opted-in public game, the host sends both headers on its HTML and assets,
including worker scripts, conditional responses and game error responses:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

Absent or false leaves both headers off. Only literal true opts in; strings such
as "true" are invalid. Without isolation, SharedArrayBuffer / wasm threads are
not available through this hosting policy. If the registry cannot be read after
the cache expires, the host serves the game's normal files without enabling
isolation; a threaded game should show a clear unsupported-mode message.

The storefront omits isolated games' detail-page iframes. Catalogue Play actions
open a new tab with noopener; deep links show an explicit Play action instead of
opening a popup automatically. COOP separates the game from cross-origin opener
contexts, so don't depend on window.opener or opener-based postMessage for play.

COEP credentialless strips credentials from cross-origin no-cors resource
requests. CORS requests still need appropriate server CORS headers; authenticated
assets, third-party embeds and analytics integrations need testing. Prefer
same-origin worker/wasm files and self-hosted assets. This option does not relax
CSP, browser permission prompts, or the prohibition on payments. Browser support
for credentialless varies; there is no automatic require-corp fallback in this
opt-in. A browser that does not support the policy needs a single-thread fallback.
See [COEP documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy).

Verify in the game's top-level browser context that crossOriginIsolated is true
and that a real threaded wasm workload runs successfully. Response headers alone
cannot prove either. Live threaded-demo verification remains tracked in
[#371](https://github.com/freegamestore-online/platform/issues/371); documentation
and automated host tests do not constitute human production or device verification.
