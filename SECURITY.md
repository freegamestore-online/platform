# Security Model — FreeGameStore Storefront

This document describes the security posture of the FreeGameStore storefront
(everything served from `freegamestore.online`). It's intentionally short — the goal is
"anyone touching this repo understands what's protecting what."

## Threat model

The storefront is **static HTML/CSS/JS** generated at build time from
`registry.json` (games). There is no server-side render, no
user-supplied input accepted at runtime by the storefront itself.

| Risk                                    | Where                          | Mitigation                                                                                                                |
| --------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Malicious registry entry                | registry.json                  | Build-time validator — shape, length, control-char, duplicate-id checks. Build fails loud on bad data. HTML-escape on render. |
| Clickjacking                            | Browser embedding storefront   | `X-Frame-Options: DENY` + `frame-ancestors 'none'` in `_headers`.                                                          |
| XSS via inline script / style           | Page HTML                      | Hash-based CSP (`script-src 'self' 'sha256-…'`, `style-src 'self'`). No `'unsafe-inline'` anywhere.                       |
| Iframed app escapes sandbox             | Embedded app                   | Sandbox attribute restricts; **first-party trust** today. See "Open questions".                                            |
| Image / fetch exfiltration via CSP gap  | Any HTTPS host                 | `img-src` and `connect-src` allowlisted to `*.freegamestore.online`. No blanket `https:`.                                              |
| Inline `style=` from registry data      | Card markup                    | Eliminated — per-card icon backgrounds live in build-emitted `card-styles.css`, never inline.                              |
| Inline `onerror` JS injection           | Card markup                    | Eliminated — fallback letter lives on a `data-letter` attribute, bound by an external script.                              |

## Auth posture

No auth flow on the storefront — there's no auth.js. theme.js handles theme + mobile menu.

## Headers (single source of truth: `_headers`)

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains
Cross-Origin-Opener-Policy: same-origin
Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=(), usb=(),
                    magnetometer=(), gyroscope=(), accelerometer=(), midi=()
Content-Security-Policy: <see build.js — locked-down, hash-based>
Content-Security-Policy-Report-Only: <same, for telemetry>
```

The CSP **does not** appear in `<meta http-equiv>`. Headers are the only
source of truth. A test enforces this.

## Tests that enforce these invariants

`test/build.test.mjs` (or `.js`) runs on every PR + push to main:

- Validator rejects bad `id` / `appUrl` / `iconBg` / duplicate ids / control-char strings / oversized names.
- HTML-escape applied to every user-controlled field.
- No `onerror=` survives the build.
- No inline `style=` on cards.
- CSP `script-src` has a `sha256-` hash, no `'unsafe-inline'`.
- CSP `style-src` is `'self'`, no `'unsafe-inline'`.
- CSP has no broad `https:` source in `img-src`.
- `_headers` ships HSTS, COOP, `frame-ancestors`, `X-Frame-Options`.
- No CSP `<meta>` tag in any built HTML.

A regression in any of these fails the build.

## Known open questions

1. **Iframe sandbox** keeps `allow-same-origin allow-scripts` for first-party
   apps. Revisit before opening third-party submissions.
2. **CSP reporting endpoint not wired.** `Content-Security-Policy-Report-Only`
   is set, but no `report-to` group. Once an endpoint exists, point it.
3. **`'unsafe-hashes'` not used for `style="..."` attributes** because there
   aren't any — all styles are in classes. If that ever changes, the test
   catches it.
4. **Detail-page ratings are localStorage-only.** Counts persist per-browser via `fgs_counts_<appId>` and vote dedup via `fgs_voted_<appId>`. No server-side aggregation.

## Reporting

Security issues that affect users should go to the maintainer rather than
a public issue. Open a private security advisory on the repo or email the
maintainer listed in `package.json`.
