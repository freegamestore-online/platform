# App research — the market research behind `/ideas`

These documents gather game archetypes with proven demand on the mobile app
stores, sized up for FreeGameStore (free, open-source/MIT, no-ads, no-tracking
browser games on the `@freegamestore/games` SDK). They are the human-readable
source for the public [`/ideas`](https://freegamestore.online/ideas) page.

## Pipeline

```
docs/app-research/*.md   →   sites/freegamestore/data/game-ideas.json   →   /ideas
   (research, by hand)          (curated dataset, schema-validated)        (page)
```

The dataset is **not** generated from these docs automatically: an archetype
only reaches `game-ideas.json` after its figures are checked and it is written
up against the schema in `sites/freegamestore/lib/ideas.cjs`, which also
computes buildability from what each idea `requires` vs what FGS can do today.
`node build.js` validates the dataset and fails the build if it is malformed.

## Documents

| File | Categories | Date | In the live dataset? |
|------|-----------|------|----------------------|
| `simple-games.md` | puzzle, board, cards, casual, light arcade | 2026-10-15 | **Yes** — the 40 ideas shipped on `/ideas` |
| `arcade-games.md` | arcade | 2026-11-05 | Pending (#408) |
| `action-games.md` | action | 2026-11-05 | Pending (#408) |
| `racing-games.md` | racing | 2026-11-05 | Pending (#408) |
| `sports-games.md` | sports | 2026-11-05 | Pending (#408) |
| `rpg-games.md` | rpg | 2026-11-05 | Pending (#408) |
| `strategy-games.md` | strategy | 2026-11-05 | Pending (#408) |

The six category docs (added in #407) broaden coverage beyond the
puzzle/casual-heavy `simple-games.md` to all ten FGS registry categories. They
are **not yet folded into `game-ideas.json`**: that happens in #408, after a
figure-vetting pass — several store figures in these drafts are labelled
"unverified" or are estimates, and are not published on trust.

## Conventions

- Lead with lifetime scale (installs, ratings, review counts) and current chart
  position where it can be sourced; mark anything unconfirmed as unverified.
- Prefer generic, un-trademarked mechanics — every archetype carries an IP
  caveat before it can enter the dataset (`caveats` is required by the schema).
- Call out what FGS **cannot** build (server-driven economies, real-time PvP,
  payments) so the dataset marks those archetypes blocked rather than hiding
  them.
