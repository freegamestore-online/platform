# FreeGameStore

The storefront at [freegamestore.online](https://freegamestore.online) — a static HTML site built with `build.js`.

## Build

```bash
node build.js     # Generates dist/ from templates + registry.json
npm test          # Runs build, security, and catalogue interaction tests
```

Public storefront links and metadata use extensionless routes (`/games/2048`,
`/u/serge-ivo`, `/ai/codex`); `.html` files remain deployment artifacts and legacy
URLs redirect through Pages. SDK docs use directory URLs with trailing slashes.
After building the storefront and SDK docs, run `node scripts/verify-seo.mjs`
to check every sitemap destination against its canonical. The deployment workflow
runs the same check before upload and `node scripts/verify-seo.mjs --live` after
deployment to check the published sitemap, direct HTTP 200 responses, canonical
agreement, and representative legacy redirects. These checks use HTTP, not browsers.

## Structure

- `build.js` — Static site generator (reads `registry.json`, outputs `dist/`)
- `registry.json` — Game catalog (id, name, URL, icon, category)
- `templates/` — HTML templates for index, game detail, quality, developers pages
- `partials/footer.html` — Shared visitor navigation for generated and static pages
- `test/` — Build and security tests
- `*.html` — Static pages (about, docs, capabilities, etc.)
- `style.css` — Design system (Manrope + Fraunces, dark mode, responsive)

## Deploy

Source lives in `freegamestore-online/platform` at `sites/freegamestore`.
Commit and push to `main`; follow the platform's `AGENTS.md` and deployment-ticket process.
The storefront deploys to the Cloudflare Pages project `freegamestore`.

The SDK docs build separately into `dist/docs`. Preserve them when deploying the
whole site: install dependencies in `docs/` and run its build after `node build.js`,
before deploying `dist/`.

## License

MIT
