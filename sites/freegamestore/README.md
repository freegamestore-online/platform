# FreeGameStore

The storefront at [freegamestore.online](https://freegamestore.online) — a static HTML site built with `build.js`.

## Build

```bash
node build.js     # Generates dist/ from templates + registry.json
npm test          # Runs build + security regression tests
```

## Structure

- `build.js` — Static site generator (reads `registry.json`, outputs `dist/`)
- `registry.json` — Game catalog (id, name, URL, icon, category)
- `templates/` — HTML templates for index, game detail, quality, developers pages
- `test/` — Build and security tests
- `*.html` — Static pages (about, docs, capabilities, etc.)
- `style.css` — Design system (Manrope + Fraunces, dark mode, responsive)

## Deploy

Push to `main` — GitHub Actions deploys to R2 automatically.

## License

MIT
