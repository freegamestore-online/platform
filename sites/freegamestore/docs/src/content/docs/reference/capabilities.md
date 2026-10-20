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
| `payment` | **off** | FreeGameStore games are free, and a payment sheet inside one is a way to take money from players. See [#374](https://github.com/freegamestore-online/platform/issues/374). |
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

- **SharedArrayBuffer / wasm threads.** These need cross-origin isolation (COOP/COEP), which the host doesn't send yet, because it would break cross-origin assets for every game. A per-game opt-in is proposed in [#371](https://github.com/freegamestore-online/platform/issues/371).
- **Storefront preview.** Inside the storefront's preview iframe, a game only gets fullscreen, gamepad, autoplay and clipboard-write. Players get everything else when they open the game in its own tab. Delegating more to the preview is [#372](https://github.com/freegamestore-online/platform/issues/372).
- **Compliance checks.** `fgs check` still fails a game for external `fetch`, external `<script src>` and `document.cookie`, even though the browser allows them. Whether to relax those is [#373](https://github.com/freegamestore-online/platform/issues/373).

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
