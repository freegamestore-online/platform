# freegamestore

Static HTML storefront for FreeGameStore (freegamestore.online). Built by
`build.js` (reads `registry.json` + `templates/*`, emits `dist/`), deployed to
Cloudflare Pages via `.github/workflows/deploy.yml` on every push to `main`.

- `templates/*.html` → generated pages (index, game-detail, developers, author, quality)
- root `*.html` + `ai/*.html` → static pages, copied to `dist/` as-is
- `theme.js` → site-wide theme/text-size toggles + CSP-safe mobile hamburger nav
- `build.js` → build + security headers (`dist/_headers`, incl. the strict CSP)

Push to `main` = auto-build + auto-deploy. `dist/` is gitignored (a build artifact).

## Special Instructions

- **Never run Playwright or any browser testing.** Just fix the code and push.
- **Always push to `main` after making changes**, without waiting for confirmation.
- **Never ask for permission to push** — pushing is always authorized.

## Delivery mode

**Straight to `main`. No branches, no pull requests.** Declared 2026-08-16.

## Hard rules

1. **No branches. No pull requests. Ever.** Commit directly to `main`. Do not run `git checkout -b`, `git switch -c`, or `gh pr create`. If you find yourself on a non-`main` branch, stop and report it. (Declared 2026-08-16.)
