# Game research: what to build on FreeGameStore

Research date 2026-10-15. Source report: [simple-games.md](simple-games.md), which covers 40 simple game types ranked by downloads, ratings and revenue on Google Play and the App Store. The non-game apps are in the FAS repo: [FAS app research](https://github.com/freeappstore-online/platform/blob/main/docs/app-research/README.md).

Every game type below was checked against the current FGS catalog (131 games, `sites/freegamestore/registry.json`) and against what FGS provides today: the `@freegamestore/games` SDK (GameShell, sounds, theme), Google sign-in, the D1 leaderboard, localStorage saves, and a 300 KB gzip bundle cap (600 KB for heavier engines).

## How the list is ranked

Priority = demand × **gap** (not in the catalog) × **ease**, with content-heavy games after mechanic-only ones. Decisions:

- **Build now**: works with today's SDK. Single player, vs AI, or pass-and-play on one device.
- **Build now, upgrade later**: ship vs AI / hot-seat now; online play waits for a platform update.
- **Upgrade existing**: the catalog has the base game; add the popular variant.
- **Defer**: blocked by a platform update.
- **Won't build**: real money, licensed IP, live-ops economies, or big 3D.

## Priority 0: clean up the existing catalog first

This comes before new games, because it's legal exposure on games already live. In 2024 NYT sent DMCA takedowns to about 1,900 GitHub "Wordle" forks over the name and look.

1. **Rename and restyle catalog games named after commercial titles.** Candidates seen in the registry: Wordle, UNO, Tetris, Connect 4, Angry Birds, Flappy Bird (×3), Pac-Man, Frogger, Blockudoku, Fireboy and Watergirl / "Lavaman And Icegirl", "Good pizza great pizza", Dress to Impress, snake.io. Generic names exist for each ("5-letter word game", "Crazy Eights", "falling blocks", "Four in a Row", "Maze Chomp", "Road Hopper"). Each also needs a visual check, because trade dress (look and feel) counts as well as the name.
2. **De-duplicate.** The registry has several near-identical entries: Zombie ×4, Snake ×3 (plus snake-2), Flappy ×3, My Dream Room ×2, Royal Heist ×2, A jungle race ×2, Ocean Save ×2, Beat Star ×2. Keep the best of each and unlist the rest.

## Platform updates the deferred items wait on

| # | Update | Unblocks | Size |
|---|---|---|---|
| **G1** | **Realtime rooms for games.** FGS has no multiplayer primitive. FAS already runs one (a Durable Object room with WebSocket fan-out, 32 peers, 4 KB messages); expose it to FGS games or port it into the games SDK as `useRoom`. | Online Ludo, card games with hidden hands, online board games, live trivia, light real-time arenas | Medium (the backend exists on FAS) |
| **G2** | **Persistent game state per match** (store a turn-based game and resume it days later) | Async word game (Words-With-Friends-like), correspondence chess | Medium; builds on G1 |
| **G3** | **Cloud saves** (per-user KV like `fas.kv`) | Progress across devices, so iOS storage wipes don't lose levels | Small–medium. Nice to have; localStorage is fine for launch |

## Priority list: build first

### Wave 1: biggest gaps, mechanic-only (all build now)

| # | Game | Evidence | Decision |
|---|---|---|---|
| 1 | **Triple tile match** | Tile Explorer and Tile Club 100M+ each; tile-match took 502.9M installs in 2025 | Build now |
| 2 | **Sort puzzles (water, ball, hexa)** — one game, three modes | Sort subgenre about 1B downloads in 2025; Magic Sort #3 US Puzzle on both stores | Build now |
| 3 | **Ludo** | Ludo King 1B+, Yalla Ludo 300M | Build now (vs AI + pass-and-play), upgrade later: online needs **G1** |
| 4 | **Word connect / swipe-letter crossword** | Words of Wonders and Wordscapes 100M+ each | Build now (permissive wordlist such as SCOWL/ENABLE) |
| 5 | **Solitaire variants: Spider, FreeCell, TriPeaks, Pyramid** | Spider 50M+, FreeCell 10M+ | Upgrade existing `Solitaire` |
| 6 | **Arrow / escape tap puzzles** | Arrows 100M+, Amaze GO 100M+, currently charting | Build now |
| 7 | **Flow / Numberlink path puzzle** | Flow Free 100M+ | Build now |
| 8 | **Number Match** | 50M+ | Build now |
| 9 | **Nonogram** (not "Picross", which is Nintendo's trademark) | 50M+ | Build now |
| 10 | **Sudoku variants: Killer Sudoku, star-battle / "queens"-style** | Killer Sudoku 10M+; Meowdoku #1 US Puzzle | Upgrade existing `Sudoku` |
| 11 | **Screw / nuts-and-bolts puzzle** | About 399M subgenre downloads in 2025 | Build now |
| 12 | **Yatzy / Farkle** (not "Yahtzee", which is Hasbro's trademark) | 10M+ each | Build now (check what `dice` already is) |
| 13 | **Dominoes + daily domino logic puzzle** | NYT Pips 612M solves | Build now |
| 14 | **2248 chain-merge / drop-merge** | Popular 2048 variants | Upgrade existing `2048` |

### Wave 2: daily-puzzle and content games (build now; content is the work)

Daily puzzles are seeded from the date in the browser, so no server is needed.

| # | Game | Evidence | Content needed |
|---|---|---|---|
| 15 | **Daily grouping puzzle (Connections-style)** | NYT Connections 1.6B solves in 2025 | About 365 hand-written puzzles for a year |
| 16 | **Mini crossword (5×5 daily)** | NYT Mini 1.4B solves; CodyCross 100M+ | Original clues |
| 17 | **Trivia quiz (daily 10)** | Trivia Crack 100M+, QuizzLand 150M | Open Trivia DB (CC BY-SA 4.0, so attribution and share-alike) or original questions |
| 18 | **Jigsaw** | Easybrain Jigsaw 100M+ | CC0 or generated images, kept small |
| 19 | **Brain-test trick puzzles** | Brain Test 100M+ | Original bespoke levels |
| 20 | **Themed word search (Strands-style) and honeycomb words (Spelling Bee-style)** | NYT Strands 1.5B solves; Spelling Bee 667M | Word lists and themes; generic names |
| 21 | **Cryptogram** | Mid-tier demand | Public-domain quotes |
| 22 | **Piano tiles with public-domain music** | Magic Tiles 3 500M+ | Public-domain pieces synthesised with Web Audio |
| 23 | **Brain-training suite** (bundle `Memory`, `Simon`, `Color Match` and new drills) | Impulse 851k and Elevate 544k ratings | Avoid cognitive-benefit claims (the FTC fined Lumosity $2M in 2016) |

### Wave 3: classic board and card games vs AI (build now, online later)

| # | Game | Decision |
|---|---|---|
| 24 | **Spades / Hearts** | Build now vs AI; 4-player online needs **G1** |
| 25 | **Backgammon** | Build now vs AI; online needs **G1** |
| 26 | **Sea Battle** (not "Battleship") | Build now as pass-and-play; online needs **G1** (hidden boards) |
| 27 | **Mancala**, then **Go** (needs a small AI) | Build now |
| 28 | **Local 2-player party pack** | Build now; mostly bundles existing FGS minis split-screen |
| 29 | **Helix / stack 3D** | Build now in the 600 KB tier; low priority |

## Deferred, and what each waits on

| Game | Blocked by |
|---|---|
| Online Ludo, Crazy Eights (UNO-like), Spades/Hearts tables, online chess/checkers/backgammon/reversi, online pool, online Sea Battle and dominoes | **G1** rooms |
| Live trivia rooms / party quiz | **G1** |
| Light real-time arena (snake.io-style, 10–30 players) | **G1** |
| Async word game, correspondence chess | **G1 + G2** |

## Won't build

Real-money and cash-tournament games, social casino and slots, live-ops economy games (Monopoly GO, Coin Master), merge-2 story games, licensed IP (Disney Solitaire, Pokémon), Tetris look-alikes, big 3D hybrid-casual (Subway Surfers, Hole.io), server-authoritative ranked PvP, and colour-by-number or hidden-object games at scale, which need a big image library. Reasons are in [simple-games.md](simple-games.md#not-buildable-on-fgs-and-why).
