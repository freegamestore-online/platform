# FreeGameStore

The storefront at [freegamestore.online](https://freegamestore.online) — a static HTML site built with `build.js`.

## Build

```bash
node build.js     # Generates dist/ from templates + registry.json
npm test          # Runs build, security, and catalogue interaction tests
```

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
