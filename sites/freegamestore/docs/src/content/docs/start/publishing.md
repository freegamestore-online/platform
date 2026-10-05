---
title: Publish to the storefront
description: How a game gets from your GitHub repo to a `*.freegamestore.online` subdomain.
---

The full path from "my repo is ready" to "listed on the store":

## The fast path

```bash
cd my-game
npx -y @freegamestore/cli@latest publish
```

`publish` runs compliance for you, then either:

- **Auto-provisions** your repo on `freegamestore-online/<id>`, sets up
  Cloudflare R2 hosting bound to `<id>.freegamestore.online`, and adds your
  registry entry — all in one command. Or…
- **Opens a prefilled GitHub Issue** for the platform team to review when
  auto-provision isn't available (first time on a new account, edge cases).

That's it for 90% of submissions. The rest of this page is the manual path
— useful if you want to understand what `publish` does under the hood.

## 1. Pass compliance locally

```bash
cd my-game
npx -y @freegamestore/cli@latest check
```

This runs the same checks CI does. Fail anything? Fix and rerun. Most
issues are template-level (brand fonts, manifest fields) and surface with
actionable suggestions.

The full check list: [Compliance / All checks](/docs/compliance/checks/).

## 2. Open a PR against the storefront registry

In [`freegamestore-online/freegamestore`](https://github.com/freegamestore-online/freegamestore):

```jsonc
// registry.json
{
  "games": [
    {
      "id": "my-game",
      "title": "My Game",
      "slug": "my-game",
      "repo": "https://github.com/your-handle/my-game",
      "category": "puzzle",
      "type": "standalone",
      "subdomain": "my-game.freegamestore.online"
    }
    // ...
  ]
}
```

The storefront's build picks up the new entry on the next deploy and
generates a detail page for your game.

## 3. We provision R2 hosting

Once the registry PR merges, the platform team creates the CF Pages
project bound to `my-game.freegamestore.online`. From that point every
`git push` to your repo's `main` triggers a fresh deploy.

The deploy workflow that ships with every scaffolded game pushes the
`web/dist` output via Wrangler — you don't need to touch it.

## 4. Ongoing compliance

The store re-audits every listed game on a 6-hour schedule. If your
repo drifts from the rules (loses brand fonts, ships tracking, blows the
bundle budget), the audit fails and the storefront flags your detail
page until you fix it. The detail page still works — but the badge goes
yellow.

You can run the audit at any time: `npx -y @freegamestore/cli@latest check`.

## What we *don't* do

- We don't fork your code. The repo stays yours.
- We don't ship your secrets. The compliance audit refuses any
  `.env.production` files.
- We don't take a cut. Free games are free forever. If you want to monetize,
  list on [ProGameStore](https://progamestore.online) instead.
