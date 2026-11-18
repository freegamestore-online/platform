# FreeGameStore identity

The canonical eight-store family kit is maintained in `stores/brand` beside the platform repositories. This repository vendors its generated exports in `brand/assets/fgs/`; `brand.json` records the identity and version. Regenerate upstream, then copy the exports to the storefront, creator console, and admin public assets together. Do not hand-edit generated SVGs or PNGs.

## Platform identity

- Name: **FreeGameStore**, one PascalCase word, with **Game** accented.
- Mark: the shared rounded-square **gamepad** icon, never a letter monogram.
- Wordmark: **Manrope 800**. Display headings may use Fraunces; the logo does not.
- Accent: `#10b981` in light mode, `#34d399` in dark mode. Use existing UI tokens.
- Header: local `favicon.svg` at 32 × 32 next to the wordmark. A decorative mark has empty alt text; the link must retain the full store name. Keep 8px between icon and wordmark.
- Social card: `og-image.png` (1200 × 630). Browser icon: `favicon.svg`, with 16px/32px PNG fallbacks. Apple touch icon: 180px. PWA: 192px/512px full-bleed PNGs, suitable for maskable use.
- Exported wordmarks are outlined vectors and need no installed fonts. Use `wordmark-light.svg` on light backgrounds and `wordmark-dark.svg` on dark backgrounds. `mark-mono.svg` inherits `currentColor`.

Individual apps and games retain their own names and icons. This kit identifies the platform; it is not a template for replacing product identities. UI components, themes and accessibility follow the existing design system and SDK guidance.

## Distribution

The canonical exports are copied to `sites/freegamestore/`, `apps/console/web/public/` and `apps/admin/web/public/`. Public `brand.json` files make the deployed revision inspectable. Assets are local to each deployable surface, so admin and creator experiences do not depend on the storefront origin for their identity.

Version public identity references with `?v=2026-11-18` (the kit version). The storefront caches image paths immutably; changing bytes at an unversioned URL can leave the old logo visible. Update header, favicon, touch icon, PWA manifest icon and social-image references together when the kit changes.
