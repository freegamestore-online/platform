# Strategy games with proven demand: market research for FreeGameStore

**Date:** 2026-11-05
**Platform:** FreeGameStore (FGS, freegamestore.online): free, open-source (MIT), no-ads, no-tracking browser games built on the `@freegamestore/games` React SDK.

## Summary

Strategy was the standout mobile genre in 2025. Sensor Tower's *State of Gaming 2026* reports it was the only genre to grow on all three metrics at once — revenue, downloads and time spent — and the largest by player spend (~$20.2B worldwide, ahead of puzzle's ~$14.4B). In the US, strategy spend grew about 23.5% year-on-year to roughly $4.2B. But almost all of that money is in a shape FGS cannot build: server-driven 4X/MMO and real-time PvP. The two top-grossing mobile games of 2025 (Last War: Survival, Whiteout Survival) and Supercell's ~$3B year (Clash of Clans ~$5.8B lifetime, Clash Royale ~$4.9B) all depend on servers, live economies and payments. **FGS can't chase the revenue leaders, but it can serve the large single-player and vs-AI strategy audience that those games leave on the table.**

The realistic, high-demand strategy archetypes for a solo web build are **single-player / PvE tower defense** (Plants vs Zombies 2 ~344.8M Play installs est.; Kingdom Rush ~28M; Bloons TD 6 a paid top-seller), **merge/summon defense** (Rush Royale $500M lifetime, 105M+ downloads), **deckbuilder roguelikes** (Balatro 5M+ units in under a year — the breakout strategy format of 2024–25), **single-player auto-battlers/auto-chess** (Teamfight Tactics ~23.9M Play installs est.; Super Auto Pets; Art of War: Legions ~6.8M iOS est.), **turn-based 4X-lite conquest** (The Battle of Polytopia 25M+ mobile downloads, and its vs-AI mode needs no server), **daily chess puzzles** (Chess.com ~250M members; Lichess's CC0 puzzle set is ideal for a date-seeded daily), plus **territory/area-control conquest, incremental strategy, grid tactics, swipe-card decision games (Reigns 2M+ players), deduction/minesweeper logic, network builders (Mini Metro ~1.4M sold) and 2D automation-lite.**

FGS's strategy shelf today is thin and classic: Chess, Checkers, Reversi, Four in a Row, Billiards, Riichi, Tic-Tac-Toe (+ a decaying variant), plus loosely-strategy casual titles (Command, Squishy Swap, Monster Attack, Zombie Attack, TRADE) and the recently-added Ludo. **The biggest gaps are the current demand leaders: single-player tower defense, deckbuilder roguelike, merge-defense, auto-battler and a daily chess-puzzle mode** — none of which exist in the catalog, and all of which ship client-side. Content and balance are the work, not the platform.

## Methodology

- **Google Play install figures** are third-party tracker estimates (AppGoblin, Mixrank), fetched 2026-11-05, because Play's own listing shows only coarse buckets ("100M+") and the live listing resisted direct fetch. They are labelled **est.** and should be treated as approximate; trackers disagree, sometimes by multiples.
- **PC/premium unit sales** (Balatro, Mini Metro, Reigns, Polytopia) come from developer/publisher announcements and trade press (PocketGamer.biz, Game Developer, PCGamesInsider, VGChartz). Developer-reported figures are labelled as such. Polytopia's 25M+ is the developer's own October 2025 milestone and sources disagree whether it is mobile-only or all-platform.
- **Genre and market totals** come from Sensor Tower's *State of Gaming 2026* (via its blog and Game Dev Reports) and Business of Apps. All revenue/MAU numbers are **estimates**.
- **Ranking** is by strength of demand evidence (annual genre weight, lifetime installs/revenue of the top titles, current chart relevance), then weighted toward **gap** (not already on FGS) and **ease** on the FGS stack. Ranks 1–6 are well evidenced; below ~10 the ordering is approximate.
- **"Realistic on FGS"** means a solo developer can ship a solid single-player, vs-AI, hot-seat or daily-seed version within today's SDK and bundle caps. Online PvP and server-driven economies are called out separately.
- **"Already on FGS?"** was checked against the 142-game `sites/freegamestore/registry.json`. "Partial" means FGS has the base game or a cousin but not this strategy variant.

### FGS primitives assumed

| Primitive | What it enables |
|---|---|
| Engines: canvas, grid/cards (DOM), kaplay, phaser, pixi, 3d/r3f, babylon, excalibur, littlejs | A DOM/cards or canvas renderer suits turn-based and card strategy; phaser/pixi/kaplay suit real-time TD and auto-battlers |
| `useLeaderboard` (D1-backed) | Per-game score tables (survival waves cleared, best run score, daily-puzzle time/streak) |
| localStorage | Saves, campaign progress, stats, streaks, idle offline-progress timestamp (per browser only; no cloud KV) |
| Daily date-seed | Deterministic daily puzzle/board generated client-side — an excellent fit for a daily strategy puzzle |
| `useAuth` (Google sign-in, optional) | Identity for leaderboard entries |
| `useGameSounds`, theme toggle | Sound effects, dark mode |
| Bundle cap | 300 KB gzip (2D/DOM); 600 KB with a heavier engine (Phaser/Pixi/3D) |
| **Not available (blockers)** | Realtime rooms/multiplayer, server compute, cron, payments, big-asset storage |

Daily puzzles must be generated deterministically from a date seed, or pre-bundled, because there is no cron to publish fresh content. Client-submitted leaderboards can be cheated, so score them as casual.

## Ranked archetypes

Legend: **Build** = FGS buildability (Easy = days, Medium = 1–2 weeks or content/balance-heavy, Hard = at the edge of a solo web build). **LB** = `useLeaderboard`; **LS** = localStorage save; **Seed** = daily puzzle seeded from the date; **Auth** = `useAuth`.

| Rank | Game archetype | Example top titles (installs / ratings / revenue) | Why it's popular | Build | FGS features used | Already on FGS? | IP / trademark caveats |
|---|---|---|---|---|---|---|---|
| 1 | **Single-player tower defense (place towers, survive waves)** | Plants vs Zombies 2 (EA/PopCap): AppGoblin ~344.8M installs (est.), 4.06★, 7.4M ratings. Kingdom Rush (Ironhide): AppGoblin ~28.2M (est.), 4.71★. Bloons TD 6 (Ninja Kiwi): a long-running paid top-seller, ~5.5M Play installs (Mixrank, est.) + a separate Netflix edition | Deep single-player campaigns, "just one more wave", fully offline | Medium (pathfinding, wave pacing, balance) | phaser/pixi/kaplay, LB (waves survived / endless score), LS (campaign, upgrades), sounds | **No (gap)** — Command is Missile-Command-like, not TD; Monster/Zombie Attack are casual | **Bloons, Plants vs Zombies, Kingdom Rush are trademarks** with distinctive art. Use the generic mechanic with original towers/enemies/names |
| 2 | **Merge / summon defense (merge units to defend a lane/board)** | Rush Royale (MY.GAMES): ~$500M lifetime revenue and 105M+ downloads (developer); earlier milestones 83M installs / $300M. Current SKU blends merge + tower defense | Merge-mechanic dopamine + defense tension; huge revenue proof | Medium | phaser/pixi, LB (best wave), LS (progress), Seed (daily board), sounds | **No (gap)** | Generic merge+defend mechanic is fine. Rush Royale's co-op/PvP is the paid hook — ship the **single-player PvE** mode; PvP needs rooms (see below) |
| 3 | **Deckbuilder roguelike (build a deck, climb a run)** | Balatro (LocalThunk/Playstack): 5M+ units sold across platforms within ~11 months of its Feb 2024 launch — the breakout strategy format of 2024–25; also on mobile. Slay the Spire: the genre's template, millions sold | Procedural runs, deep synergy decisions, endless replay, no content treadmill needed | Medium (card set + balance is the work) | grid/cards (DOM) fits 300 KB, LB (best run score), LS (run + unlocks), Seed (daily seeded run), sounds | **No (gap)** — War/Blackjack/High-Low are card games, not deckbuilders | Specific cards/jokers/art are copyrightable (Balatro, Slay the Spire). Author an original card set and theme; the mechanic itself is generic |
| 4 | **Single-player auto-battler / auto-chess (draft units, auto-combat)** | Teamfight Tactics (Riot): AppGoblin ~23.9M Play installs (est.), 4.48★, 740.9K ratings; ~15M cross-store / ~$27.5M by 2021 (Sensor Tower). Super Auto Pets (Team Wood): async, solo-friendly; AppGoblin ~3.5M Android installs (est.). Art of War: Legions: AppGoblin ~6.8M iOS installs (est.) | Draft + synergy puzzle with low execution demand; Super Auto Pets proves the offline/async model | Medium (unit synergies, deterministic combat sim) | phaser/pixi or DOM, LB (win streak vs AI), LS (collection, progress), sounds | **No (gap)** | Generic "draft units, they fight automatically" is fine. Avoid TFT/LoL and Super Auto Pets character art and names |
| 5 | **Turn-based 4X-lite / single-player conquest (expand, explore, exploit a small map vs AI)** | The Battle of Polytopia (Midjiwan): 25M+ mobile downloads (developer, Oct 2025) — unusually mobile-led for a 4X; also on Switch/Steam | A whole 4X loop in 20 minutes; the single-player vs-AI mode is the entry point and needs no server | Medium–Hard (map gen + a competent AI are the hard parts) | canvas or grid, LS (saved game), LB (turns-to-win / score), Seed (daily map), sounds | **No (gap)** | Polytopia's art/tribes are its IP. Use generic tiles/units. Full 4X MMO (Rise of Kingdoms etc.) is **not buildable** — see below. Online/async play needs rooms + state store |
| 6 | **Daily chess puzzle / chess tactics strategy** | Chess.com: ~250M members (Mar 2026); puzzles are a core daily mode. Lichess ships a **CC0** puzzle database (millions of positions) | Short daily tactics hit; a proven ritual for a huge chess audience; perfect date-seed fit | Easy (bundle a CC0 puzzle subset; no full engine needed for puzzles) | Seed (puzzle of the day), LS (streak, rating), LB (daily streak / solve time), sounds | **Partial** — Chess exists; no daily-puzzle or tactics-trainer mode | Rules are public domain. Lichess puzzle DB is CC0 — ship a curated subset (watch bundle size). Don't copy Chess.com branding |
| 7 | **Territory / area-control conquest (claim regions, vs AI or hot-seat)** | RISK: Global Domination (SMG Studio / Hasbro): the licensed mobile Risk, 110+ maps, solo + pass-and-play modes, ~4.4★ Play / ~4.7★ App Store. Open-source precedents: Slay, Antiyoy (hex-territory conquest) | Classic "paint the map" tension; works turn-based offline against AI or on one device | Easy (Reversi-style) to Medium (Risk-style AI + map) | canvas/grid, LS (saved game, stats), LB (wins vs AI), sounds, hot-seat | **Partial** — Reversi, Tic-Tac-Toe (+ decaying), Four in a Row exist; no Risk-style, hex-territory or dots-and-boxes | **"Risk" is a Hasbro trademark.** Use an original name/map ("Conquest", generic hex world). Don't copy Antiyoy/Slay assets; the mechanic is generic |
| 8 | **Incremental / idle strategy (idle army, idle TD, prestige loops)** | Art of War: Legions' idle-army progression (~6.8M iOS installs est.) and the broad idle-TD/idle-tycoon category; idle mechanics drive long retention across strategy-adjacent titles | "Numbers go up" + strategic upgrade/prestige choices; progresses while away | Easy–Medium (balance + offline-progress maths) | LS (offline progress via client timestamp diff), LB (prestige level), sounds | **Partial** — Cat Clicker is a pure clicker; no strategy/idle-army loop | Generic. Offline progress uses the client clock (cheatable, fine for a solo free game). Avoid specific franchise art |
| 9 | **Turn-based tactics on a grid (small-squad tactics, Into-the-Breach-like)** | Into the Breach and the broader tactics-RPG/SRPG audience (Advance Wars-style); strong, loyal console/PC/mobile niche | Chess-like perfect-information puzzles; procedural missions give endless content | Medium (AI + mission generation) | canvas/grid, LS (campaign), LB (score / turns), Seed (daily mission), sounds | **No (gap)** | Generic mechanic. Avoid Into the Breach / Advance Wars art and unit designs |
| 10 | **Swipe-card decision strategy (balance competing meters, Reigns-like)** | Reigns (Nerial/Devolver): ~2M+ players, ~1.8M copies sold (developer, lifetime); spawned several sequels | One-thumb, tiny footprint, strong narrative hook, naturally daily/seeded | Easy (mechanic is trivial; writing the card deck is the work) | grid/cards (DOM), LS (progress, endings seen), Seed (daily scenario), LB (reign length), sounds | **No (gap)** | Mechanic (swipe left/right to decide, keep 4 meters alive) is generic. Write original scenarios; don't copy Reigns' art/writing |
| 11 | **Deduction / minesweeper-logic strategy (pure-logic solving, no guessing)** | Minesweeper is a decades-old staple; guess-free logic variants (Hexcells, Tametsi-style) have a loyal puzzle audience | Pure deductive reasoning; endless generated, guaranteed-solvable boards | Easy | canvas/grid, Seed (daily guaranteed-solvable board), LS, LB (time), sounds | **Partial** — Minesweeper exists; no guess-free / hex / logic-deduction variants | "Minesweeper" is generic; Hexcells/Tametsi are specific products — use original presentation |
| 12 | **Network / route builder (grow an efficient network, Mini Metro-like)** | Mini Metro (Dinosaur Polo Club): ~1.3–1.4M sold (developer, 2018; higher since), across PC/mobile/Switch; a defining minimalist strategy title | Elegant optimisation under rising pressure; minimalist art keeps the bundle tiny | Medium (procedural demand + scoring) | canvas, LS (saved layout), LB (passengers served / survival time), Seed (daily city), sounds | **No (gap)** — Flowarrow/Line Link are fixed-path puzzles (Flow/Numberlink), not a growing network | Mechanic is generic; Mini Metro's exact transit-map styling is its look. Use original minimalist art |
| 13 | **Solitaire-strategy / skill patience (pure-skill card planning)** | FreeCell and similar high-skill patience games (every deal solvable); part of the always-popular solitaire family (MobilityWare Solitaire 100M+ Play) | Pure planning, no luck in FreeCell; daily solvable deal fits a seed | Easy | grid/cards (DOM), Seed (daily solvable deal), LS (stats, streak), LB (moves/time), sounds | **Partial** — Solitaire exists; FreeCell/Spider skill variants missing (also flagged in simple-games.md) | Rules are public domain. Make daily deals solver-checked for solvability. Don't reuse others' card-back art |
| 14 | **2D automation / factory-lite (build and optimise a production chain)** | Mindustry (factory + tower defense, free, very popular) and Shapez (factory optimiser) show solid demand for a lighter factory loop | Satisfying optimisation/engineering loop; strong retention | Medium–Hard (keep it 2D and small or it blows the bundle) | pixi/canvas, LS (factory save), LB (throughput / score), sounds | **No (gap)** | Build a small 2D loop with original art. Keep assets procedural/tiny to stay in the 600 KB tier; large factory sims don't fit |

## Strategy games that would need the realtime-rooms primitive (online PvP)

FGS has no rooms/multiplayer primitive today. Every archetype above ships as **single-player, vs-AI, hot-seat or daily-seed now.** Their *online PvP* modes — which are where the big money sits — wait on a WebSocket rooms primitive (and, for ranked integrity, server-authoritative logic FGS also lacks).

| Online mode | Why it needs rooms/server | Demand signal | Ships now instead |
|---|---|---|---|
| Online auto-battler / auto-chess lobbies (8-player) | Shared lobby, synced rounds, anti-cheat | Teamfight Tactics ~23.9M Play installs (est.) | Single-player vs-AI boards |
| Merge/TD co-op & PvP (Rush Royale-style) | Two synced boards, matchmaking | Rush Royale $500M lifetime | Single-player PvE waves + leaderboard |
| Online 4X / conquest vs humans (Polytopia multiplayer) | Persistent turn state across days, many seats | Polytopia 25M+ downloads | vs-AI and hot-seat; async also needs a turn-state store |
| Online Risk-style conquest tables | 2–6 seats, hidden intent | RISK: Global Domination (licensed) | vs-AI + pass-and-play |
| Real-time territory arena (Paper.io-style `.io`) | 10–30 peers, continuous position sync | Paper.io 2 (Voodoo) 100M+ downloads claimed | A single-player bot-filled arena approximates it |

## Not buildable on FGS (and why)

The money in mobile strategy is concentrated in exactly the categories FGS cannot build. Say so plainly.

| Category | Examples (demand) | Blocker |
|---|---|---|
| **4X / MMO strategy (base-building + alliances + economy)** | Last War: Survival and Whiteout Survival (the two top-grossing mobile games of 2025, Sensor Tower); Clash of Clans (~$5.8B lifetime IAP est.); Rise of Kingdoms, Lords Mobile, State of Survival | Needs authoritative servers, persistent shared economy, alliances/chat, live-ops **and payments**. None exist on FGS. This is the bulk of strategy revenue and is **out of scope** |
| **Real-time ranked PvP (MOBA-lite / card battler)** | Clash Royale (~$4.9B lifetime player spend est.; Supercell ~$3B in 2025) | Server-authoritative real-time matchmaking + anti-cheat; payments. Not supported |
| **Live-ops gacha / collectible strategy** | Gacha army/hero collectors with daily events and banners | Server economy, cron-driven events, payments, large art libraries |
| **Online competitive auto-chess / TD ladders** | Teamfight Tactics ranked, Rush Royale PvP | Realtime rooms **and** server validation for a trustworthy ladder |
| **Large 3D / big-asset strategy** | Age of Empires Mobile, console-scale RTS ports | 3D asset weight beyond the 600 KB tier; art pipeline; no big-asset storage |
| **Server-published daily/live content without a seed** | Anything needing a server to push a fresh scenario each day | No cron. Daily strategy puzzles must be date-seeded or pre-bundled client-side |
| **Trustworthy competitive leaderboards with stakes** | Ranked/prize strategy ladders | Scores are client-submitted and unvalidated; keep leaderboards casual |
| **Licensed-IP strategy** | RISK: Global Domination, Age of Empires, Warhammer titles | Trademark/licence. The underlying mechanics (area control, 4X, tactics) are fine under original branding |

## Biggest gaps vs the current FGS catalog (ranked by demand × gap × ease)

The strategy shelf today is Chess, Checkers, Reversi, Four in a Row, Billiards, Riichi, Tic-Tac-Toe (+ decaying), the new Ludo, and a few casual "strategy"-tagged titles (Command, Squishy Swap, Monster/Zombie Attack, TRADE). The high-demand modern strategy formats are entirely absent:

1. **Single-player tower defense** (PvZ2 ~344.8M, Kingdom Rush ~28M est.). Medium. The single biggest gap.
2. **Deckbuilder roguelike** (Balatro 5M+ units; the breakout 2024–25 strategy format). Medium — fits DOM/cards in 300 KB; original card set is the work.
3. **Merge / summon defense** (Rush Royale $500M lifetime). Medium. Ship PvE now.
4. **Single-player auto-battler / auto-chess** (TFT ~23.9M est.; Super Auto Pets proves the solo model). Medium.
5. **Daily chess puzzle mode** (Chess.com ~250M members; Lichess CC0 puzzle DB). Easy — extend the existing Chess with a date-seeded daily tactic.
6. **Turn-based 4X-lite conquest** (Polytopia 25M+). Medium–Hard — the AI is the challenge.
7. **Territory / area-control conquest** (Risk-style / hex-territory; builds on the existing Reversi audience). Easy–Medium.
8. **Swipe-card decision strategy (Reigns-like)** (Reigns ~2M+ players). Easy — tiny build, writing is the work; naturally daily.
9. **Incremental / idle strategy** (idle army/TD category). Easy–Medium.
10. **Grid tactics (Into-the-Breach-like)**. Medium.
11. **Guess-free deduction / minesweeper-logic variants** (extend the existing Minesweeper). Easy.
12. **Network / route builder (Mini Metro-like)** (~1.4M sold). Medium.
13. **FreeCell / skill-patience variants** (extend the existing Solitaire). Easy.
14. **2D automation / factory-lite** (Mindustry/Shapez demand). Medium–Hard; keep it small.

**Catalog hygiene flagged in passing:** the "strategy"-tagged casual entries (Command, Squishy Swap, Monster Attack, Zombie Attack, TRADE) are not strategy games in the sense players search for — re-tagging them would make room for genuine strategy titles. As in simple-games.md, any entry using a commercial name or trade dress should be checked and renamed.

## Sources

**Genre & market totals**
- Sensor Tower, *State of Gaming 2026* (strategy the only genre up in revenue/downloads/time spent; strategy ~$20.2B, puzzle ~$14.4B; Last War & Whiteout Survival top 2 by revenue): https://sensortower.com/blog/state-of-gaming-2026
- Game Dev Reports summary of *State of Gaming 2026*: https://gamedevreports.substack.com/p/sensor-tower-state-of-gaming-2026
- Game Dev Reports, "The Strategy genre in the US grew by a quarter" (~23.5% YoY to ~$4.2B TTM): https://gamedevreports.substack.com/p/sensor-tower-the-strategy-genre-in
- GamesBeat, "Strategy games dominated mobile market in late 2024 (Sensor Tower)": https://gamesbeat.com/mobile-games/strategy-games-dominated-mobile-market-in-late-2024-sensor-tower/

**Tower defense**
- AppGoblin, Plants vs Zombies 2 (~344.8M installs est., 4.06★, 7.4M ratings): https://appgoblin.info/apps/com.ea.game.pvz2_row
- AppGoblin, Kingdom Rush (~28.2M installs est., 4.71★): https://appgoblin.info/apps/com.ironhidegames.android.kingdomrush
- Mixrank, Bloons TD 6 (Play installs est.): https://mixrank.com/playstore/apps/com.ninjakiwi.bloonstd6
- AppGoblin, Bloons TD 6: https://appgoblin.info/apps/com.ninjakiwi.bloonstd6

**Merge / summon defense**
- PocketGamer.biz, "Rush Royale surpasses $500M in lifetime revenue": https://www.pocketgamer.biz/rush-royale-surpasses-500m-in-lifetime-revenue/
- MY.GAMES, "Rush Royale Achieves $500 Million In Lifetime Revenue" (105M+ downloads): https://about.my.games/news/567
- PocketGamer.com, "Rush Royale 83 million installs": https://www.pocketgamer.com/rush-royale/83-million-installs-festival-of-talents/

**Deckbuilder roguelike**
- PocketGamer.biz, "Balatro exceeds 5 million in sales on all platforms": https://www.pocketgamer.biz/balatro-exceeds-5-million-in-sales-on-all-platforms
- VGChartz, "Balatro Sales Top 5 Million Units": https://www.vgchartz.com/article/463727/balatro-sales-top-5-million-units/
- Statista, Balatro units sold worldwide: https://statista.com/statistics/1546856/balatro-global-unit-sales

**Auto-battler / auto-chess**
- AppGoblin, Teamfight Tactics (~23.9M Play installs est., 4.48★, 740.9K ratings): https://appgoblin.info/apps/com.riotgames.league.teamfighttactics
- Pocket Tactics (Sensor Tower data), Riot mobile revenue (TFT ~15M cross-store / ~$27.5M by 2021): https://www.pockettactics.com/league-of-legends-wild-rift/revenue
- AppGoblin, Super Auto Pets (~3.5M Android installs est.): https://appgoblin.info/apps/com.teamwood.spacewood.unity
- AppGoblin, Art of War: Legions (~6.8M iOS installs est.): https://appgoblin.info/apps/1484362191

**4X-lite / conquest**
- PocketGamer.biz, "The Battle of Polytopia surpasses 25m downloads on mobile": https://www.pocketgamer.biz/the-battle-of-polytopia-surpasses-25m-downloads-on-mobile
- Wikipedia, The Battle of Polytopia: https://en.wikipedia.org/wiki/The_Battle_of_Polytopia
- Apple App Store, RISK: Global Domination (SMG Studio / Hasbro): https://apps.apple.com/us/app/id1051334048

**Chess**
- Altaroc, Chess.com reaches 250 million users: https://www.altaroc.pe/en/resources/news/chess-com-reunit-desormais-250-millions-dutilisateurs
- Lichess open puzzle database (CC0): https://database.lichess.org/#puzzles

**Swipe-card / network / automation**
- PCGamesInsider, "How Reigns sold 1.8m copies" (2M+ players): https://www.pcgamesinsider.biz/success-story/66428/how-tinder-meets-game-of-thrones-title-reigns-sold-18m-copies/
- PCGamesInsider, "Mini Metro has actually sold close to 1.4m copies": https://www.pcgamesinsider.biz/news/67489/mini-metro-has-actually-sold-close-to-14m-copies/

**Not-buildable revenue leaders**
- GamesBeat, "Supercell generates $3B in 2025 revenue, down 4%": https://gamesbeat.com/supercell-generates-3b-in-2025-revenue-down-4-while-profits-grew/
- Business of Apps, Clash of Clans statistics (~$5.8B lifetime IAP est.): https://www.businessofapps.com/data/clash-of-clans-statistics/
- Next Big Games, "Clash Royale $4.9bn revenue after 10-year comeback": https://nextbiggames.com/2026/03/17/clash-royale-4-9bn-revenue
- Business of Apps, Clash Royale statistics: https://www.businessofapps.com/data/clash-royale-statistics/
