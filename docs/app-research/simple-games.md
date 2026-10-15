# Simple games with proven demand: market research for FreeGameStore

**Date:** 2026-10-15
**Platform:** FreeGameStore (FGS, freegamestore.online): free, open-source (MIT), no-ads, no-tracking browser games built on the `@freegamestore/games` React SDK.

## Summary

Simple, generic-mechanic puzzle games lead mobile downloads. In 2025, AppMagic ranked **Block Blast!** the most-downloaded mobile game in the world (356.2M installs). **Vita Mahjong** came 7th (121.9M), and the **tile-match** subgenre took 502.9M installs. Naavik's analysis of AppMagic data puts **Match Pair** (~1.1B downloads) and **Sort** (~1B) as the two largest puzzle subgenres by downloads in 2025. The puzzle genre as a whole took >9.7B downloads and about $10B in IAP. NYT Games recorded 11.2B puzzle solves in 2025: Wordle 4.2B, Connections 1.6B, Strands 1.5B, Mini 1.4B, Spelling Bee 667M, Pips 612M. This confirms large demand for daily, seeded, single-screen puzzles, which a client-side web game can serve well.

FGS already covers many classics: block puzzle, match-3, mahjong, Klondike, Sudoku, 5-letter word guess, word search, chess, pool, snake.io, bubble shooter, UNO-like, 2048. **Its biggest gaps are the current download leaders:** triple tile-match, color/water/hexa sort, arrow/escape tap puzzles, Ludo, Wordscapes-style word connect, Connections-style grouping, Flow-style path puzzles, solitaire variants (Spider/FreeCell/TriPeaks), trivia, jigsaw, and Number Match / Nonogram logic puzzles. Almost all of these are **Easy** to build within the 300 KB bundle cap with localStorage saves and the D1 leaderboard.

## Methodology

- **Google Play installs/ratings** were read directly from live Play Store listings (`play.google.com/store/apps/details?id=…`, US English) on 2026-10-15. Play shows install *buckets* ("100M+"), so these are lower bounds.
- **Category chart positions** come from AppBrain's US Top Free charts (Card, Puzzle, Board, Word, Trivia, Casual), updated 2026-10-14. AppBrain install totals are AppBrain estimates.
- **Apple App Store chart positions** come from Apple's public RSS top-free feeds (US; Puzzle, Casual, Card, Board, Word), fetched 2026-10-15. Apple does not publish install counts.
- **Annual downloads, revenue and MAU** come from AppMagic (via PocketGamer.biz), Naavik (AppMagic data), Sensor Tower blog posts, NYT figures reported by TODAY/NBC, and developer press releases. Developer-reported figures are labelled as such. Third-party trackers disagree, sometimes by multiples. Treat all revenue/MAU figures as **estimates**.
- **Ranking** is by strength of demand evidence: annual downloads first, then lifetime install buckets of the top titles, then chart presence on both stores. Ranks 1–10 are well evidenced. Below ~20 the ordering is approximate.
- **"Simple"** means a solo developer could ship a solid version in days to about 2 weeks, using generic or public-domain mechanics.
- **"Already on FGS?"** was checked against the 131-game catalog list supplied by the coordinator. "Partial" means FGS has the base game but not the popular variant.

### FGS primitives assumed

| Primitive | What it enables |
|---|---|
| `GameShell`, `GameTopbar`, `GameOverScreen` | Standard chrome, pause/restart, end screen |
| `useGameSounds` (+ mute policy), theme toggle | Sound effects, dark mode |
| `useAuth` (Google sign-in) | Identity for leaderboard entries |
| `useLeaderboard` (D1-backed) | Per-game score tables (e.g. daily-seed best time, high score) |
| localStorage | Saves, stats, streaks, settings (per browser only; no cloud KV) |
| Bundle cap | 300 KB gzip (2D/DOM); 600 KB with a heavier engine (Phaser/3D) |
| **Not available** | Realtime rooms/multiplayer, server compute, cron, payments, big asset storage |

Daily puzzles must be generated deterministically from a date seed on the client. Client-submitted leaderboards can be cheated, so score them as casual.

## Ranked archetypes

Legend: **Build** = FGS buildability (Easy = days, Medium = 1–2 weeks or content-heavy). **LB** = `useLeaderboard`; **LS** = localStorage save; **Seed** = daily puzzle seeded from the date; **Auth** = `useAuth`.

| Rank | Game archetype | Example top titles (installs / ratings / revenue) | Why it's popular | Build | FGS features used | Already on FGS? | IP / trademark caveats |
|---|---|---|---|---|---|---|---|
| 1 | **Block puzzle (place polyominoes, clear rows/cols)** | Block Blast! (Hungry Studio): #1 most-downloaded game of 2025, 356.2M installs (AppMagic); Play 1B+, 4.8★, 5.68M reviews; developer-reported 70M DAU / 300M MAU (Jan 2026). Woodoku: Play 100M+, 4.2★ | No timer, one-thumb, endless "one more go", ad-friendly | Easy | LB (high score), LS (run in progress, best), Seed (daily board), sounds | **Yes** (Blockudoku, Brick Blast) | Don't copy names "Block Blast"/"Woodoku" or their art. Generic mechanic is fine |
| 2 | **Match-3 swap (level-based)** | Candy Crush Saga: Play 1B+, 4.6★, 38.9M reviews; ~$876.5M FY2025 IAP (est., Business of Apps/TechSpot). Royal Match: Play 100M+, 4.6★; ~$1.37B 2025 revenue (est.); 84M 2025 downloads. Match Swap subgenre ~$5.3B 2025 (Naavik) | Short levels, progression map, strong habit loop | Easy–Medium (level design is the work) | LS (level progress, stars), LB (score per level / endless), sounds | **Yes** (Match 3) | Avoid "Crush", "Saga" and candy/king trade dress. A level map with 100+ hand-tuned or procedurally generated levels is the differentiator |
| 3 | **Triple tile match (tap 3 identical tiles into a tray)** | Tile Explorer (Oakever): Play 100M+, 4.9★, 2.31M reviews. Tile Club: Play 100M+, 4.8★; 86.6M 2025 downloads. Tile Explore (Learnings): 92.4M 2025 downloads. Triple Tile (Tripledot): 50M+. Tile-match subgenre 502.9M downloads in 2025 (+28% YoY); Match Pair ~1.1B (Naavik) | Relaxing, visually tidy, easy to read | Easy | LS (level), Seed (daily stack), LB (time / moves), sounds | **No (gap)** | Generic. Use original icon art (emoji/SVG set) |
| 4 | **Mahjong solitaire (pair-matching on stacked layouts)** | Vita Mahjong: #7 globally in 2025, 121.9M downloads; Play 100M+, 4.9★, 6.41M reviews; #1 US Board on both stores. Mahjong Blast: 50M+, 4.8★. Mahjong-solitaire titles 258.3M 2025 installs (+189% YoY, AppMagic) | Older-skewing audience, large-tile accessibility, calm | Easy | LS, Seed (daily layout, guaranteed solvable), LB (time), sounds | **Yes** (Mahjong, Riichi mahjong) | Tile glyphs are public domain. Emphasise large-tile / senior-friendly mode, a proven niche ("Mahjong for Seniors" 8.3M AppBrain) |
| 5 | **Sort puzzles (water/ball/colour sort, hexa sort)** | Sort subgenre ~1B downloads 2025; ~$280M IAP (+176%) (Naavik). Magic Sort!: #3 US Puzzle (both stores), AppBrain 41M. Water Sort Puzzle: Play 50M+, 4.8★. Ball Sort Puzzle: 50M+, 4.9★. Hexa Sort: 10M+ | Instantly readable, low stress, hard to fail | Easy | LS (level), Seed, LB (moves), sounds | **No (gap)** | Generic. Ship several sort variants (tubes, hex stacks) as one game |
| 6 | **Patience / solitaire family (Klondike, Spider, FreeCell, TriPeaks, Pyramid)** | Solitaire (MobilityWare): Play 100M+, 4.6★. Spider Solitaire (MobilityWare): 50M+. FreeCell: 10M+. Solitaire.com (Tripledot): 50M+. Microsoft Solitaire Collection: 35M monthly players (2020, Microsoft); Play 10M+, 3.9★. Solitaire titles hold ~8 of AppBrain US Card top 30 | Universally known, played daily for decades | Easy | LS (stats, streak, in-progress deal), Seed (daily deal), LB (moves/time), sounds | **Partial** (Solitaire; Spider/FreeCell/TriPeaks/Pyramid missing) | Game rules are public domain. Don't use "Microsoft"/card-back designs from others. Make deals winnable (solver-checked) for daily mode |
| 7 | **Daily 5-letter word guess** | NYT Wordle: 4.2B plays in 2025 (~11.5M/day), down from 5.3B in 2024. "Wordle!" (Lion Studios): Play/AppBrain 18M. NYT Games app: Play 10M+, 4.8★; #3 US Word (iOS) | Daily ritual, shareable result grid, 3-minute session | Easy | Seed (word of the day), LS (streak, stats), LB (streak / guesses), sounds | **Yes** (Wordle/wordguess) | **"Wordle" is NYT's trademark.** In 2024 NYT sent DMCA takedowns to ~1,900 GitHub forks citing the name and "look and feel" (grid + tile colours). Call it a "5-letter word game" with its own name, and consider non-green/yellow palette. Rename the FGS entry if it uses "Wordle" |
| 8 | **Word connect / swipe-letters crossword** | Words of Wonders: Play 100M+, 4.9★, 6.5M reviews (AppBrain 480M). Wordscapes: Play 100M+, 4.7★; Naavik: historically ~$5M/month. Zen Word: 50M+. Word Connect: 50M+. 5 of top 10 iOS Word chart | Calm, vocabulary-flattering, endless levels | Easy–Medium (needs wordlist + level generator) | LS (level), Seed, LB (daily time), sounds | **No (gap)** | Use a permissively licensed wordlist (e.g. SCOWL / ENABLE, public-domain lists), not Scrabble dictionaries (Collins/Hasbro). Don't use "Wordscapes" landscape trade dress |
| 9 | **Ludo / race board games** | Ludo King: Play 1B+, 4.1★, 10.3M reviews; led India's 2025 download chart (AppMagic via Outlook India). Yalla Ludo: AppBrain 300M | Family/social staple in South Asia, MENA | Easy (vs AI / hot-seat) | LS, sounds, local pass-and-play; online needs rooms | **No (gap)** | Ludo/Pachisi are public domain. Avoid "Ludo King" branding. Online play is the main draw (see multiplayer section) |
| 10 | **Pool / billiards** | 8 Ball Pool (Miniclip): Play 1B+, 4.8★, 31.9M reviews; >1B downloads by 2021 (Guinness record) | Physics satisfaction, PvP | Medium (physics tuning) | LB (vs-AI wins), LS, sounds | **Yes** (Billiards) | Generic. Avoid Miniclip UI |
| 11 | **Chess** | Chess.com: Play 100M+, 4.7★, 3.43M reviews; 200M members (Apr 2025), 250M (Mar 2026). Chess - Offline Board Game (Gamovation): 100M+, 4.8★ | Evergreen; puzzles and vs-AI huge offline | Easy–Medium (AI via small engine) | LS, Seed (daily chess puzzle from bundled PD/CC0 puzzle set), LB (puzzle streak) | **Yes** | Rules public domain. Lichess puzzle DB is CC0: a small subset could ship for daily puzzles (watch bundle size) |
| 12 | **Sudoku (and variants)** | Sudoku.com (Easybrain): Play 100M+, 4.7★, 2.52M reviews; iOS 4.6★ (253k ratings); #7 US Board (iOS). Killer Sudoku by Sudoku.com: 10M+. Meowdoku (Oakever, a Sudoku/logic hybrid): #1 US Puzzle on both stores now, Play 10M+ | Pure logic, endless generated content | Easy | Seed, LS, LB (daily time), sounds | **Partial** (Sudoku; Killer Sudoku / queens-style "one per row/col/region" variants missing) | Generic. LinkedIn "Queens" is a trademarked name, but the star-battle mechanic is public domain |
| 13 | **Connections-style grouping (find 4 groups of 4)** | NYT Connections: 1.6B solves in 2025 (2nd largest NYT game). Solitaire Associations Journey: Play 10M+, #1 US Word (iOS), #3 Card (iOS). Tripledot "You Know: Associations" in Card top 15 | Daily, social, "aha" moments | Medium (curated content: groups must be hand-authored) | Seed (puzzle of the day from bundled set), LS (streak), LB | **No (gap)** | "Connections" is NYT branding. Use own name/colours. Content must be original: budget a year of puzzles (~365 × 16 words, small) |
| 14 | **Snake / .io worm** | slither.io: Play 500M+, 3.9★. Worms Zone .io: 500M+, 4.3★ | Instant, competitive feel | Easy | LB (length), sounds | **Yes** (Snake, Slither/snake.io) | Don't use "slither.io" name |
| 15 | **Bubble shooter** | Bubble Shooter - Classic Pop: Play 500M+, 4.6★, 2.37M reviews | Classic casual, aim-and-match | Easy | LS (level), LB, sounds | **Yes** | Generic. Avoid "Bubble Witch"/"Puzzle Bobble" art |
| 16 | **Shedding card game (UNO-like) / Phase-10-like** | UNO!: Play 100M+, 4.3★ (AppBrain 310M); #9 US Card. Phase 10: 10M+, 4.7★ | Family nostalgia | Easy (vs AI) | LS, sounds; online needs rooms | **Yes** (uno) | **UNO and Phase 10 are Mattel trademarks, and the card design is trade dress.** Ship as "Crazy Eights"-family with an original name/deck. Check that the FGS "uno" entry does not use the name/colours |
| 17 | **Trivia / quiz** | Trivia Crack: Play 100M+, 4.5★, 7.85M reviews (AppBrain 270M). QuizzLand: AppBrain 150M. TRIVIA STAR: 32M | Social, learn-something, quick rounds | Medium (content) | Seed (daily 10-question set), LS, LB (daily score) | **No (gap)** | Question bank must be original or openly licensed (e.g. Open Trivia DB is CC BY-SA 4.0, so attribution + share-alike apply). Keep the bank small to fit the bundle, or split into lazy-loaded JSON chunks |
| 18 | **Lateral "brain test" trick puzzles** | Brain Test: Tricky Puzzles (Unico): Play 100M+, 4.7★, 10M reviews (AppBrain 390M); #2 US Trivia | Viral "gotcha" humour | Medium (each level is bespoke) | LS (level), sounds | **No (gap)** | Concept is generic, but specific Brain Test puzzles are copyrightable: author original ones |
| 19 | **Jigsaw puzzles** | Jigsaw Puzzles (Easybrain): Play 100M+, 4.8★, 2.39M reviews. Jigsawscapes: 50M+ | Relaxing, older audience | Medium (image supply) | LS (in-progress), Seed (daily image), LB (time) | **No (gap)** | Images must be CC0/public domain or procedurally generated. Images are the "big asset" constraint: use a small curated set + procedural art |
| 20 | **Arrow / escape tap puzzles (clear pieces in the right order)** | Arrows - Puzzle Escape: Play 100M+, 4.7★ (#19–20 US Puzzle both stores). Amaze GO! (Oakever): 100M+, 4.9★. Arrow Puzzle (Easybrain): 50M+, 4.8★ | Current 2025–26 hit format: quick, readable, procedurally generatable | Easy | Seed, LS, LB (moves/time) | **No (gap)** | Generic mechanic |
| 21 | **Flow / connect-the-dots path puzzle (Numberlink)** | Flow Free (Big Duck): Play 100M+, 4.7★, 1.54M reviews. Dot Link: 10M+, 4.8★; #11 US Board (iOS), #40 US Puzzle (Play) | Simple rules, satisfying fills | Easy | Seed, LS, LB (time) | **No (gap)** (Maze is a different mechanic) | Numberlink is a public-domain puzzle type. "Flow Free" is a trademark |
| 22 | **Merge-number (2048 / 2248 chain)** | 2248 Numbers: Play 50M+, 4.9★. 2048 (Cirulli port): 10M+, 4.5★ | Instantly learnable, deep | Easy | LB, LS | **Partial** (2048; chain-merge "2248" and drop-merge variants missing) | 2048 is MIT-licensed open source. Fine |
| 23 | **Number Match / "Take Ten" pen-and-paper** | Number Match (Easybrain): Play 50M+, 4.8★; #15 US Board (iOS). Number Sums: 5M+ | Retro paper puzzle, older audience | Easy | Seed, LS, LB | **No (gap)** | Generic (Numberzilla/Take Ten traditional) |
| 24 | **Nonogram / Picross** | Nonogram.com (Easybrain): Play 50M+, 4.6★, 904K reviews | Logic + pixel-art reveal | Easy | Seed, LS, LB (time) | **No (gap)** | "Picross" is a Nintendo trademark. Use "Nonogram"/"Griddlers" |
| 25 | **Crossword (classic, mini, themed)** | CodyCross: Play 100M+, 4.7★. Crossword Master: 10M+, 4.8★. NYT Mini: 1.4B solves (2025). Daily Themed Crossword: AppBrain 15M | Daily habit | Medium (clue writing) | Seed, LS (streak), LB (time) | **No (gap)** | Clues must be original. A 5×5 "mini" format needs far less content and fits a daily-seed model |
| 26 | **Themed word search / Strands-style** | NYT Strands: 1.5B solves (2025). Word Search Explorer (PlaySimple): AppBrain 110M, #1 US Word (Play) | Low-stress, daily | Easy | Seed, LS, LB | **Partial** (Word Search; themed snake-path "Strands" variant missing) | "Strands" is NYT branding |
| 27 | **Trick-taking cards (Spades, Hearts, Euchre)** | Spades Plus: Play 10M+, 4.8★. Spades (MobilityWare): 10M+. 5 Spades titles in AppBrain US Card top 30 | Huge US social/card audience | Medium (decent AI) | LS (stats), LB (wins) ; online needs rooms | **No (gap)** | Public domain rules |
| 28 | **Dice: Yatzy / Farkle** | Yahtzee With Buddies: Play 10M+. Yatzy (Playvalve): 10M+, 4.8★. Farkle Dice Roll: #8 US Board (AppBrain) | Quick, luck + choice | Easy | LB (score), LS, sounds | **Partial?** ("dice" exists; unclear if Yatzy/Farkle) | **"Yahtzee" is a Hasbro trademark.** Use "Yatzy" / "Five Dice" |
| 29 | **Screw / nuts-and-bolts puzzle** | Screw subgenre ~399M downloads 2025, >$206M IAP (Naavik). Screw Puzzle: Wood Nut & Bolt: 10M+ | Hybridcasual hit format | Easy–Medium (2D physics-lite) | LS, Seed, LB | **No (gap)** | Generic |
| 30 | **Piano tiles / rhythm tap** | Magic Tiles 3: Play 500M+, 4.6★; #16 US Casual (iOS). Tiles Hop: 500M+ | Music + reflex | Medium | LB, LS, sounds | **No (gap)** | **Songs are the IP risk.** Use only public-domain compositions synthesised in WebAudio (no recordings); tiny bundle |
| 31 | **Dominoes / Pips-style domino logic** | NYT Pips: 612M solves in its first year (2025). Domino! (Flyclops): 5M+, 4.7★. Classic Dominoes (Big Cake): AppBrain 8.9M | Pips shows demand for a daily domino-placement logic puzzle | Easy | Seed, LS, LB | **No (gap)** | Dominoes are public domain. "Pips" is NYT branding |
| 32 | **Backgammon** | Backgammon (AI Factory): Play 10M+, 4.3★. Backgammon Live: 5M+ | Classic, MENA/Europe audience | Medium (AI) | LS, LB (wins vs AI) | **No (gap)** | Public domain |
| 33 | **Battleship / sea battle** | Sea Battle 2: Play 50M+, 4.4★, 1.61M reviews | Simple 2-player deduction | Easy | LS, LB, local hot-seat | **No (gap)** | "Battleship" is a Hasbro trademark. Use "Sea Battle"/"Fleet" |
| 34 | **Idle / clicker / tycoon** | Idle Miner Tycoon: Play 100M+, 4.5★, 5.86M reviews. Tap Titans 2: 10M+ | Progress while away | Easy (simple) to Medium (balance) | LS (offline progress by timestamp diff) | **Yes** (clicker) | Generic. Offline progress must use client timestamp (cheatable, fine for solo) |
| 35 | **Stack / helix hyper-casual** | Helix Jump: Play 100M+, 3.9★. Stack (Ketchapp): 50M+ | One-tap, 30-second sessions | Easy (Stack) / Medium (Helix needs 3D) | LB, sounds | **Partial** (stack yes; helix no) | Avoid Ketchapp/Voodoo names. Helix needs 3D: 600 KB tier |
| 36 | **Local 2-player party pack (split-screen minigames)** | 2 Player Games: the Challenge (JindoBlu): Play 100M+, 4.7★. Offline Games - No Wifi Games (JindoBlu): AppBrain 210M. Mini Games: Calm & Relax: AppBrain 150M | Offline, same-device social play | Easy (reuse existing FGS minis) | LS, sounds; works without rooms | **No (gap)** (as a bundle) | Generic |
| 37 | **Brain-training suite (memory, attention, speed drills)** | Lumosity: Play 10M+, 4.8★ (claims 100M users). Elevate: 10M+, 4.6★. Peak: 10M+, 4.4★ | Self-improvement framing | Medium (several minigames + progress) | LS (progress), LB (per-drill), Seed (daily workout) | **Partial** (Memory, Simon, Color Match exist; no suite) | Avoid unsupported cognitive-benefit claims (the FTC fined Lumosity $2M in 2016 over such claims) |
| 38 | **Cryptogram / Spelling Bee-style word puzzles** | Cryptogram: Word Logic Puzzles: Play 10M+, 4.6★. NYT Spelling Bee: 667M solves (2025) | Older word-puzzle audience | Easy | Seed, LS, LB | **No (gap)** | "Spelling Bee" (NYT) as a product name: use "Hive"/"Honeycomb words". Quotes for cryptograms must be public domain |
| 39 | **Checkers / Connect-4 / Reversi / Tic-tac-toe / Hangman** | Checkers (Gamovation): Play 10M+. Hangman Words: 10M+, 4.8★. Connect-4/Reversi standalone apps ≤1M (low) | Classic, easy AI | Easy | LS, LB | **Yes** (all five) | "Connect 4" is a Hasbro trademark; "Othello" is a registered trademark: prefer "Four in a Row" / "Reversi" |
| 40 | **Mancala / Go / Shogi** | Mancala: Play 5M+. BadukPop (Go): 1M+. Shogi: 1M+ | Niche but loyal, regional | Easy (Mancala) / Medium (Go AI) | LS, LB | **No (gap)** | Public domain |

## Multiplayer games that would need a new realtime-rooms primitive on FGS

FGS has no rooms or multiplayer primitive today. **Local hot-seat / pass-and-play works now** for every turn-based game below and should ship first. A WebSocket rooms primitive would unlock the online versions. A spec of ~32 peers/room, ~4 KB messages and host- or client-authoritative state, with no server game logic, would cover all of them:

| Game | Why it needs rooms | Demand signal | Notes |
|---|---|---|---|
| Ludo (2–4 players) | Online play with friends is the core of Ludo King / Yalla Ludo | Ludo King 1B+ Play; Yalla Ludo 300M (AppBrain) | Turn-based, tiny messages. Highest-value multiplayer target |
| Shedding card game (UNO-like), Crazy Eights | Hidden hands need per-player views | UNO! 100M+ Play | Without server logic, deals/hands are client-trusted (fine for friends, not strangers) |
| Spades / Hearts (4 players, partnerships) | 4-seat tables | Spades Plus 10M+; multiple Spades titles in US Card top 30 | Same trust caveat |
| Chess / Checkers / Backgammon / Reversi online | Remote opponent; clocks | Chess.com 100M+ Play, 250M members | Turn-based. A friend invite link is sufficient |
| Pool (8-ball) online | Shot sync | 8 Ball Pool 1B+ Play | Send the shot vector, both clients simulate deterministically |
| Sea Battle | Hidden boards | Sea Battle 2 50M+ | Commit-reveal hashing avoids trusting the opponent |
| Dominoes | Hidden hands | Domino! 5M+ | Turn-based |
| Async word game (Words-With-Friends-like) | Needs a persistent game-state store, not just rooms | Words With Friends 10M+ Play; Scrabble GO AppBrain 45M | Requires a turn-state store primitive as well as rooms |
| Live trivia rooms / party quiz | Host broadcasts questions, players race | Trivia Crack 100M+ | Host client is authoritative |
| Snake.io / light real-time arena | 10–30 peers, position sync | slither.io 500M+ | Feasible peer-relayed at small room sizes. No anti-cheat without server logic |

## Not buildable on FGS (and why)

| Category | Examples (demand) | Blocker |
|---|---|---|
| Real-money / cash-tournament games | Solitaire Cash, Bingo Cash, Mahjong Clash/Rumble (all in iOS Card/Puzzle top 25) | Payments not supported; gambling/skill-gaming regulation; contradicts FGS's free, no-monetisation model |
| Social casino, slots, sweepstakes | Stake US, Cider Casino (iOS Card top 25) | Same as above, plus age-gating |
| Live-ops economy games | MONOPOLY GO! (AppBrain 130M), Coin Master (350M), Dice Dreams (68M) | Server-side economy, events, payments. Monopoly is Hasbro IP |
| Merge-2 story games | Gossip Harbor (96M), Travel Town, Tasty Travels | Large art/story asset libraries, live events. Merge Match 2 ≈ $1.7B IAP (Naavik), but content scale doesn't fit a solo build or the asset limits |
| Licensed IP games | Disney Solitaire (#1 US Card), Pokémon TCG Pocket, Tetris® (N3TWORK/PlayStudios), Heads Up! (Warner), Family Feud | Trademark/copyright. Mechanics like solitaire or charades are fine under original branding |
| Tetris look-alikes | Any "falling tetromino" game copying Tetris trade dress | *Tetris Holding v. Xio* (D.N.J. 2012) found a clone infringed copyright and trade dress (look and feel: 10×20 well, piece colours, ghost piece). FGS's existing Tetris entry should be checked for trade dress and must not use the name |
| Big 3D / physics hybrid-casual | Subway Surfers (1B+), Going Balls (450M), Hole.io (430M), Township | Asset size and 3D engine weight beyond 600 KB; art pipeline |
| Real-time ranked PvP with server authority | Clash Royale (500M+), competitive matchmaking | Needs authoritative server logic and matchmaking, which FGS doesn't support |
| Colour-by-number / hidden object / spot-the-difference at scale | Happy Color (AppBrain 350M), Search It, Differences (10M+ each) | Value comes from thousands of curated images; big asset storage not supported. A small procedural pixel-art colour-by-number is possible but won't compete on content |
| Geo / map guessing | GeoGuessr (12M) | Requires licensed Street View imagery/API |
| Fresh daily content without seeding | Anything needing a server to publish a new puzzle each day | No cron. Daily puzzles must be pre-bundled or generated from a date seed |
| Trustworthy global leaderboards | Competitive leaderboards with prizes | Scores are client-submitted with no server validation. Keep leaderboards casual |

## Biggest gaps vs the current FGS catalog (ranked by demand)

1. **Triple tile match** (Tile Explorer/Tile Club 100M+ each; tile-match 502.9M downloads in 2025; Match Pair ~1.1B). Easy.
2. **Sort puzzles: water/ball/hexa** (Sort ~1B downloads in 2025; Magic Sort #3 US Puzzle on both stores). Easy.
3. **Ludo** (Ludo King 1B+; Yalla Ludo 300M). Easy as vs-AI/hot-seat. The best case for a future rooms primitive.
4. **Word connect / swipe crossword** (Words of Wonders and Wordscapes 100M+ each). Easy–Medium.
5. **Solitaire variants: Spider, FreeCell, TriPeaks, Pyramid** (Spider 50M+, FreeCell 10M+). Extend the existing Solitaire.
6. **Arrow / escape tap puzzles** (Arrows 100M+, Amaze GO 100M+, Arrow Puzzle 50M+; currently charting). Easy.
7. **Connections-style daily grouping** (NYT Connections 1.6B solves; Solitaire Associations #1 iOS Word). Medium (content).
8. **Flow / Numberlink path puzzle** (Flow Free 100M+). Easy.
9. **Trivia quiz** (Trivia Crack 100M+, QuizzLand 150M). Medium (content licensing).
10. **Jigsaw** (Easybrain Jigsaw 100M+). Medium (CC0 image sourcing).
11. **Brain-test trick puzzles** (Brain Test 100M+, AppBrain 390M). Medium (bespoke levels).
12. **Number Match** (50M+) and **Nonogram** (50M+). Easy.
13. **Crossword mini (5×5 daily)** (CodyCross 100M+; NYT Mini 1.4B solves). Medium.
14. **Sudoku variants: Killer Sudoku, star-battle/"queens"-style** (Killer Sudoku 10M+; Meowdoku #1 US Puzzle). Easy add-on to the existing Sudoku.
15. **Spades / Hearts** (multiple 10M+ titles). Medium (AI).
16. **Screw puzzle** (~399M subgenre downloads 2025). Easy–Medium.
17. **Piano tiles with public-domain music** (Magic Tiles 3 500M+). Medium.
18. **Yatzy / Farkle** (10M+ each). Easy, if "dice" isn't already one of these.
19. **Dominoes + Pips-style daily domino logic** (Pips 612M solves). Easy.
20. **Local 2-player party pack** (2 Player Games 100M+). Easy, mostly reusing existing FGS minis.
21. **Sea Battle**, **Backgammon**, **Strands-style themed word search**, **Spelling-Bee-style honeycomb**, **Cryptogram**, **Mancala**. All Easy–Medium, mid-tier demand.

**Catalog hygiene flagged in passing:** the existing FGS entries named Wordle, UNO, Tetris, Connect 4 and Suika-like "fruit drop" should be checked for trademarked names and copied trade dress. Rename them to generic titles ("5-letter word game", "Crazy Eights", "Block Drop", "Four in a Row", "Fruit Merge"). Suika Game is Aladdin X's title.

## Sources

**Market reports and download/revenue data**
- PocketGamer.biz, "The most downloaded mobile games of 2025" (AppMagic data): https://www.pocketgamer.biz/the-most-downloaded-mobile-games-of-2025/
- Naavik, "How niche subgenres are reshaping the mobile puzzle market" (AppMagic data): https://naavik.co/digest/how-niche-subgenres-are-reshaping-the-mobile-puzzle-market/
- Mobidictum, "Sort, block, and screw mechanics are reshaping the puzzle games market": https://mobidictum.com/sort-block-screw-mechanics-puzzle-games-market/
- Sensor Tower, top 10 worldwide mobile games by revenue and downloads, March 2025: https://sensortower.com/blog/top-10-worldwide-mobile-games-by-revenue-and-downloads-in-march-2025
- Sensor Tower, Q1 2025 US top word puzzle games by revenue: https://sensortower.com/blog/2025-q1-unified-top-5-word%20puzzle%20games-revenue-us-603697f4241bc16eb8570d37
- PocketGamer.biz, "Block Blast reaches 70m daily active users and 300m monthly active users": https://www.pocketgamer.biz/block-blast-reaches-70m-daily-active-users-and-300m-monthly-active-users-worldwide
- Udonis, Block Blast statistics (AppMagic): https://www.blog.udonis.co/statistics/block-blast
- TechSpot, "Candy Crush generates nearly $1 billion annually": https://techspot.com/news/113475-candy-crush-generates-nearly-1-billion-annually-14.html
- Business of Apps, Candy Crush statistics: https://www.businessofapps.com/data/candy-crush-statistics
- Statista, Candy Crush Saga global app revenue: https://statista.com/statistics/1405447/candy-crush-saga-global-app-revenue
- Naavik, Wordscapes profile: https://naavik.co/f2p-mobile/worldscapes-peoplefun/
- Outlook India Respawn, top 10 most downloaded mobile games in India in 2025: https://respawn.outlookindia.com/gaming/gaming-news/top-10-most-downloaded-mobile-games-in-india-in-2025
- PocketGamer.biz, "Miniclip exceeds 4 billion downloads": https://www.pocketgamer.biz/miniclip-exceeds-4-billion-downloads/
- Easybrain, 1 billion downloads: https://easybrain.com/news/easybrain-celebrates-1000000000-downloads
- SocialPeta, Water Sort passes 100M downloads: https://socialpeta.com/blog/water%20sort-color-puzzle-game-surpasses-100-million-downloads

**NYT Games**
- NBC New York / TODAY, NYT Games 2025 numbers (11.2B solves; Wordle 4.2B, Connections 1.6B, Strands 1.5B, Mini 1.4B, Spelling Bee 667M, Pips 612M): https://www.nbcnewyork.com/entertainment/entertainment-news/hardest-wordle-connections-games-2025/6436464/
- A Media Operator, Wordle TV show / lapsed players (Wordle 5.3B in 2024, 4.8B in 2023): https://www.amediaoperator.com/analysis/wordle-tv-show-new-york-times-games-jonathan-knight/

**Other player counts**
- Microsoft Windows Experience Blog, Solitaire 30th anniversary (35M monthly players): https://blogs.windows.com/windowsexperience/?p=174089
- Chess.com 200M members: https://nerdschalk.com/chess-com-surpasses-200-million-members-as-platform-nears-20th-anniversary/
- Chess.com 250M members: https://www.altaroc.pe/en/resources/news/chess-com-reunit-desormais-250-millions-dutilisateurs

**Store charts and listings (fetched 2026-10-15)**
- AppBrain US Top Free charts: Card https://www.appbrain.com/stats/google-play-rankings/top_free/card/us · Puzzle https://www.appbrain.com/stats/google-play-rankings/top_free/puzzle/us · Board https://www.appbrain.com/stats/google-play-rankings/top_free/board/us · Word https://www.appbrain.com/stats/google-play-rankings/top_free/word/us · Trivia https://www.appbrain.com/stats/google-play-rankings/top_free/trivia/us · Casual https://www.appbrain.com/stats/google-play-rankings/top_free/casual/us
- Apple App Store US top-free RSS feeds (genres 7012 Puzzle, 7003 Casual, 7005 Card, 7004 Board, 7019 Word): `https://itunes.apple.com/us/rss/topfreeapplications/limit=25/genre=<id>/json`
- Google Play listings, `https://play.google.com/store/apps/details?id=<package>`, for: com.block.juggle (Block Blast!), com.tripledot.woodoku, com.king.candycrushsaga, com.dreamgames.royalmatch, com.oakever.tiletrip, com.gamovation.tileclub, com.tripledot.triple.tile.match.pair.game.three.master.object, com.vitastudio.mahjong, com.nebula.mahjongtile, water.sort.puzzle.game.color.sorting.free, ball.sort.puzzle.color.sorting.bubble.games, com.gamebrain.hexasort, com.mobilityware.solitaire, com.mobilityware.spider, com.mobilityware.freecell, com.tripledot.solitaire, com.microsoft.microsoftsolitairecollection, com.nytimes.crossword, com.fugo.wow, com.peoplefun.wordcross, kidultlovin.word.zen, com.wordgame.words.connect, com.ludo.king, com.miniclip.eightballpool, com.chess, com.gamovation.chessclubpilot, com.easybrain.sudoku.android, com.easybrain.killer.sudoku.free, com.oakever.meowdoku, com.hitappsgames.wordsolitaire, air.com.hypah.io.slither, com.wildspike.wormszone, bubbleshooter.orig, com.matteljv.uno, com.mattel163.phase10, com.etermax.preguntados.lite, com.unicostudio.braintest, com.easybrain.jigsaw.puzzles, jigsaw.puzzle.game.banana, com.ecffri.arrows, com.oakever.arrows, com.easybrain.arrow.puzzle.game, com.bigduckgames.flow, com.playvalve.connect.dots, com.inspiredsquare.jupiter, com.tpcstld.twozerogame, com.easybrain.number.puzzle.game, com.easybrain.nonogram, com.fanatee.cody, com.easybrain.crossword.puzzles, net.peakgames.mobile.spades.android, com.mobilityware.Spades, com.scopely.yux, com.playvalve.yatzy, com.fc.nut.screw.bolt.washer.fastener.puzzle, com.youmusic.magictiles, com.flyclops.domino.android, uk.co.aifactory.backgammonfree, com.byril.seabattle2, com.fluffyfairygames.idleminertycoon, com.h8games.helixjump, com.ketchapp.stack, com.JindoBlu.TwoPlayerGamesChallenge, com.lumoslabs.lumosity, com.wonder (Elevate), com.brainbow.peak.app, com.crypt.gram.puzz, com.gamovation.quickcheckers, hang.man.word.guessing.games, com.appon.mancala, com.supercell.clashroyale, com.kiloo.subwaysurf, com.n3twork.tetris

**IP / trademark**
- Wikipedia, *Tetris Holding, LLC v. Xio Interactive, Inc.*: https://en.wikipedia.org/wiki/Tetris_Holding,_LLC_v._Xio_Interactive,_Inc.
- Gizmodo, NYT DMCA takedown of Wordle clones (Reactle): https://gizmodo.com/nyt-dmca-takedown-request-wordle-clones-reactle-1851320538
- Fortune, NYT Wordle clones copyright knock-offs (2024): https://fortune.com/2024/03/13/new-york-times-wordle-clones-copyright-knock-offs
- Open Trivia DB (CC BY-SA 4.0 question bank): https://opentdb.com/
