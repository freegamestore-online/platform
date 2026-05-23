# fgs-auditor

Automated quality testing worker for [freegamestore.online](https://freegamestore.online). Uses Playwright (Chromium) to audit games across reference mobile and tablet viewports, computing a responsive-fit score that mirrors the platform quality index.

## What it does

- Opens each game URL in headless Chromium across 12 reference viewports (portrait + landscape)
- Checks for horizontal overflow (scroll-x) at each size
- Computes a weighted score (`computeIndex`) matching the platform's `quality.js` logic
- Writes results to a JSON report consumed by the FGS compliance pipeline

## Dev

```bash
pnpm install        # also installs Chromium via postinstall
pnpm test           # run vitest unit tests (scoring algorithm)
```

To run a live audit against a game URL:

```bash
npx tsx audit.ts <game-url>
```

## Deploy

This repo is a Cloudflare Worker. Push to `main` to auto-deploy via GitHub Actions.
