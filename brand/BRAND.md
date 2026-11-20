# FreeGameStore brand

Kit version **2026-11-18**. Canonical source: [`serge-ivo/stores-workspace` `brand/`](https://github.com/serge-ivo/stores-workspace/tree/main/brand). This repo vendors the exact FGS export in [`brand/assets/`](assets/).

## Identity

- **Name:** FreeGameStore, one PascalCase word, with **Game** coloured in the accent.
- **Symbol:** the rounded-square gamepad icon shared with ProGameStore. Never a letter monogram.
- **Wordmark:** Manrope 800. The exported wordmarks are outlined vectors and need no installed fonts.
- **Colours:** accent `#10b981`; on dark surfaces `#34d399`. Use the existing UI tokens.
- **Typography:** Manrope for platform UI, Fraunces for editorial headings. The logo does not use Fraunces.

## Assets

| File | Use |
|---|---|
| `favicon.svg` | Browser icon and the header icon. Standalone, rounded corners. |
| `mark.svg` / `mark-mono.svg` | Transparent glyph, in colour or inheriting `currentColor`. |
| `wordmark-light.svg` / `wordmark-dark.svg` | Complete outlined wordmark for light and dark backgrounds. |
| `icon-{16,32,48,64,128,180,192,512}.png` | Raster icons. 16 and 32 are the favicon fallbacks; 192 and 512 are the PWA icons. |
| `apple-touch-icon.png` | Apple touch icon, 180px. |
| `og-image.svg` / `og-image.png` | 1200 × 630 social card. |
| `brand.json` | Kit version and colour/identity provenance. |

## Usage rules

- Header: a 28–40px icon next to the accessible full name. The store surfaces use `favicon.svg` at 32 × 32 with 8px between icon and wordmark.
- A decorative image beside text takes `alt=""`. A symbol-only link needs the full name as its accessible label.
- `icon-192.png` and `icon-512.png` are opaque, full-bleed and maskable. Do not use them as a square header badge.
- Never redraw, abbreviate or space the name. Do not hand-edit the generated SVGs or PNGs.
- Individual games keep their own names and icons. This kit identifies the platform only.

## Where it ships

Deployed copies, each carrying the icons, `og-image.png` and a public `brand.json` that makes the deployed revision inspectable:

- `sites/freegamestore/` — storefront, plus `wordmark-dark.svg`.
- `sites/freegamestore/docs/public/` and `sites/freegamestore/docs/src/assets/` — SDK docs icons and both wordmarks.
- `apps/console/web/public/` — creator console.
- `apps/admin/web/public/` and `apps/admin/public/` — admin UI.

Public references carry `?v=2026-11-18`. The storefront caches image paths immutably, so new bytes at an unversioned URL can leave the old logo visible.

## Store-specific notes

- Authenticated admin and creator assets stay local to each deployable surface.
- The public admin sign-in gate uses the storefront's versioned favicon and `wordmark-dark.svg`, because admin assets stay behind the allowlist.

## Updating

1. Change the master in the workspace kit and regenerate there.
2. Copy the FGS export to this folder and to every surface above.
3. Bump the `?v=` parameter on the header, favicon, touch icon, PWA manifest icon and social-image references together.
4. Run `python3 brand/check-copies.py` in the workspace.
5. Land through this repo's normal `main` workflow.
