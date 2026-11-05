# Racing games with proven demand: market research for FreeGameStore

**Date:** 2026-11-05
**Platform:** FreeGameStore (FGS, freegamestore.online): free, open-source (MIT), no-ads, no-tracking browser games built on the `@freegamestore/games` React SDK.

## Summary

Racing is a mature, top-heavy mobile genre: a handful of evergreen franchises hold most of the downloads, and the long tail is dominated by hyper-casual one-mechanic titles. The biggest racing-adjacent downloads belong to **endless runner-racers**: Subway Surfers has passed **4B lifetime downloads** (SYBO/trackers; ~190M MAU reported mid-2026) and was the first Android game to hit 1B on Google Play, while Temple Run 2 sits near **1.1B lifetime** (tracker estimate). The biggest *driving* franchise is **Hill Climb Racing**, whose original game passed **2B downloads** (Fingersoft, Jan 2026) with the series nearing 3B and ~4M daily players — a 2D physics hill-climber, which is the single most striking gap against FGS. **Traffic/moto riders** are huge too: Traffic Rider shows a **500M+** Play install bucket (updated Dec 2025). **Drag racing** monetises best — Zynga's CSR franchise has crossed **$1B lifetime player spending** and CSR 2 led the US racing revenue chart in Q2 2025 (Sensor Tower). **Kart racers** (Beach Buggy Racing ~329M installs est.; Mario Kart Tour 200M+ before its Sept-2026 shutdown) and **one-touch drift** games (Drift Max ~48M est.) round out the proven demand.

The genre is softening on revenue: AppMagic's *Mobile Market Landscape 2026* puts **racing revenue down 11.4% YoY in 2025** (one of the steepest declines), against a near-flat overall market (+0.2% revenue, +4.6% downloads). Demand for the *mechanics* remains large; what's shrinking is the IAP take on the heavy 3D sim-racers.

**FGS already covers the two biggest archetypes.** The catalog's **Racing** (3D endless lane/traffic-dodge runner) and **Kart Racers** (top-down kart vs AI, 3-lap, items) map directly onto the download leaders, and **Endless Highway / Road Hopper / Crossy Rivers / Crossy School** cover the Crossy-Road traffic-crossing format. **Its biggest racing gaps are all 2D/physics-lite and fit the 300 KB tier:** a **hill-climb physics racer**, a **drag racer** (timing/shift), **one-touch drift**, a **moto/traffic rider**, and — the best fit for FGS primitives but absent from the catalog — a **daily seeded time-trial with a leaderboard ghost**. The heavy 3D archetypes (drift simulator, jet-ski, 3D runner-racer) are 600 KB-tier and asset-weight is a real risk; they are lower priority. Online head-to-head racing needs a rooms primitive FGS doesn't have, but **ghost / time-trial competition works today** via `useLeaderboard`.

## Methodology

- **Google Play install buckets / ratings** come from live Play listings and from third-party trackers (AppGoblin, AppBrain, Splitmetrics). Play shows install *buckets* ("500M+"), so those are lower bounds; tracker install totals (e.g. AppGoblin's 329M for Beach Buggy) are **modeled estimates** and frequently disagree with the store bucket by large margins.
- **Annual / lifetime downloads, revenue and MAU** come from AppMagic (via PocketGamer.biz / gamedevreports), Sensor Tower blog posts, developer press releases (Fingersoft, Zynga, Hipster Whale, Gameloft) and GamesBeat. Developer-reported figures are labelled as such. Treat all revenue/MAU figures as **estimates**; third-party trackers disagree, sometimes by multiples.
- **US racing revenue rank** comes from Sensor Tower's Q2 2025 US "Top 5 racing games by revenue" chart (fetched 2026-11-05). Those are weekly-peak figures, not annual totals, and cannot be summed.
- **Genre revenue trend** (racing −11.4% YoY 2025) comes from write-ups of AppMagic's *Mobile Market Landscape 2026*; it is a secondary citation of the AppMagic report.
- **Ranking** is by strength of demand evidence: lifetime/annual downloads first, then install buckets of the top titles, then revenue-chart presence. Ranks 1–6 are well evidenced; below ~10 the ordering is approximate and some figures are **unverified** (flagged inline).
- **"Build"** = FGS buildability (Easy = days; Medium = 1–2 weeks or physics/asset-heavy). 2D/physics-lite targets the 300 KB bundle; anything marked **600 KB / asset-heavy** needs a WebGL engine (Phaser/Pixi/3D) and is an asset-weight risk.
- **"Already on FGS?"** was checked against the 142-game `sites/freegamestore/registry.json`. "Partial" = FGS has an adjacent game but not this archetype's core loop.

### FGS primitives assumed

| Primitive | What it enables |
|---|---|
| `GameShell`, `GameTopbar`, `GameOverScreen` | Standard chrome, pause/restart, end screen |
| `useGameSounds` (+ mute policy), theme toggle | Engine/skid sounds, dark mode |
| `useAuth` (Google sign-in) | Identity for leaderboard entries |
| `useLeaderboard` (D1-backed) | **Lap/time-trial boards** — the natural fit for racing (best lap, total time) |
| localStorage | Best times, unlocks, settings, ghost replay data (per browser only; no cloud KV) |
| Daily date-seed | **Seeded track-of-the-day** generated deterministically on the client |
| Bundle cap | 300 KB gzip (2D/DOM/canvas); 600 KB with a heavy engine (Phaser/Pixi/3D/Babylon) |
| **Not available** | Realtime rooms/multiplayer, server compute, cron, payments, big-asset storage |

A **ghost racer** (race your own or a leaderboard rival's recorded line) is the key racing competition loop that works *without* multiplayer: record inputs/positions to localStorage, store the best run's compact trace, and race it back. A seeded "track of the day" plus a time-trial leaderboard reproduces the daily-competition hook without a server. Client-submitted times can be cheated, so score them as casual.

## Ranked archetypes

Legend: **Build** = FGS buildability. **LB** = `useLeaderboard`; **LS** = localStorage; **Seed** = daily seeded track; **Ghost** = recorded-line replay; **Auth** = `useAuth`.

| Rank | Game archetype | Example top titles (installs / ratings / revenue) | Why it's popular | Build | FGS features used | Already on FGS? | IP / trademark caveats |
|---|---|---|---|---|---|---|---|
| 1 | **Endless runner-racer (lane dodge / traffic weave, speed ramps up)** | Subway Surfers: 4B+ lifetime downloads (SYBO/trackers); first Android game to 1B on Play; ~190M MAU (est., mid-2026); still ~30M downloads/mo (est., method unverified). Temple Run 2: ~1.1B lifetime (Splitmetrics est.), Play 500M+ | One-thumb, instant, infinite "one more run"; the single biggest racing-adjacent format | Easy (2D lane) / Medium (3D). 2D at 300 KB; 3D at 600 KB | LB (distance/score), LS (best, unlocks), Seed (daily course), sounds | **Yes** (Racing = 3D endless traffic-dodge lane runner; also Neon Runner, Star Dodger) | Generic mechanic. Don't copy "Subway Surfers"/"Temple Run" names, characters or graffiti trade dress |
| 2 | **Hill-climb physics racer (2D side-view, fuel + flips, bumpy terrain)** | Hill Climb Racing: developer-reported **2B downloads** (Fingersoft, Jan 2026); series nearing 3B, ~2.5B+ and €220M+ net (2024); ~4M daily players. Hill Climb Racing 2: 40M+ (2018) | Physics "just one more hill" loop, procedural terrain, tiny inputs (gas/brake) | Medium (needs a 2D physics step — matter.js/planck or littlejs built-in; watch bundle) | LB (distance/coins), LS (best, upgrades), Seed (daily terrain), Ghost, sounds | **No (gap)** | Generic 2D physics racer. Don't use the name "Hill Climb Racing" or the red-buggy/driver trade dress. **Highest-value driving gap.** |
| 3 | **Moto / traffic rider (first-person or chase-cam bike weaving live traffic)** | Traffic Rider (skgames): Play **500,000,000+** (listing, updated Dec 2025), ~8.9M ratings; AppGoblin 749–800M (est.). Traffic Racer (same studio): long-running 100M+-class title (bucket unverified) | Speed + near-miss tension, endless, overtaking bonuses | Medium (pseudo-3D road at 300 KB; full 3D 600 KB, asset-heavy) | LB (distance/overtakes), LS (bikes, best), Seed (daily traffic), sounds | **Partial** (Racing covers car traffic-dodge; no motorcycle/first-person variant) | Generic. Avoid "Traffic Rider"/"Traffic Racer" names and copied HUD. Use original bike art |
| 4 | **Kart racer vs AI (lap circuit, pickups/weapons, boost)** | Beach Buggy Racing (Vector Unit): ~329M installs (AppGoblin est.), Play 100M+, 4.5★, 2.9M ratings; BBR2 ~100M (est.). Mario Kart Tour: 200M+ downloads & $200M revenue lifetime (Sensor Tower, 2021) before its Sept-2026 shutdown | Pick-up-and-play, item chaos, beat-the-AI; family appeal | Medium (top-down 2D at 300 KB; 3D kart 600 KB) | LB (lap/race time), LS (unlocks), Seed (daily circuit), sounds | **Yes** (Kart Racers = top-down kart, 3 laps, items, beat AI) | Generic. **Do not** copy "Mario Kart" characters, items (shells/bananas) or trade dress — Nintendo IP. Original karts/pickups only |
| 5 | **Top-down 2D lap racer (seen-from-above circuit, drift cornering)** | Classic format behind Kart Racers and countless web racers; Micro Machines-style. No single modern mega-title, but the base mechanic underlies the kart/drift leaders above | Cheap to render, readable, satisfying cornering; ideal daily time-trial host | Easy (canvas 2D, 300 KB) | LB (best lap/total), LS (ghost data), Seed (track of the day), Ghost, sounds | **Partial** (Kart Racers is top-down; a pure no-items time-trial circuit is missing) | Generic. "Micro Machines" is a trademark — use an original name |
| 6 | **Drag racer (straight-line, perfect-shift timing, build/tune car)** | CSR franchise: **$1B+ lifetime player spending** (Zynga); CSR 2 ~85M installs (AppGoblin est.), ~3M MAU, **#1 US racing revenue Q2 2025** (Sensor Tower). No Limit Drag Racing 2: #3 US racing revenue Q2 2025 | Short 10–20s sessions, shift-timing skill, deep upgrade grind; best monetiser in the genre | Easy (timing/shift minigame, side view, 300 KB) | LB (best quarter-mile time), LS (garage, tuning), Seed (daily car/opponent), sounds | **No (gap)** | Generic drag mechanic. Avoid "CSR"/"No Limit" names and licensed real-car models; use original cars |
| 7 | **One-touch drift (hold-to-turn, keep the line on curves)** | Drift Max (Tiramisu): ~48M installs (AppGoblin est.); Drift Max Pro ~130M (est.). Drifty Race! (SayGames) and Sling Drift (AI Games): one-tap drift, broad hyper-casual reach (buckets unverified) | Single-input, instantly learnable, score-chase; classic hyper-casual hit shape | Easy (canvas 2D, 300 KB) | LB (score/distance), LS (best, cars), Seed (daily track), Ghost, sounds | **No (gap)** | Generic one-tap mechanic. Avoid specific titles' names/art |
| 8 | **Crossy-Road traffic-crossing hopper (cross roads/rivers, dodge vehicles)** | Crossy Road (Hipster Whale): developer-reported **250M+ downloads** (200M milestone 2018). Frogger lineage | Endless, charming, one-tap hop; huge casual reach | Easy (grid/canvas 2D, 300 KB) | LB (distance), LS (characters), sounds | **Yes** (Road Hopper, Crossy Rivers, Crossy School, Endless Highway) | Mechanic is public-domain Frogger-style. "Crossy Road" name & voxel style are Hipster Whale's; "Frogger" is Konami's. Use original look/name |
| 9 | **Daily seeded time-trial with leaderboard ghost** | No single app *is* this, but it's the daily-competition hook of NYT-style dailies applied to racing; time-trial + ghost is the core of console racers (Trackmania, Mario Kart TT). Demand proxy: the daily-ritual leaderboards that drive puzzle retention | Daily "beat the track / beat the ghost" ritual; shareable time; 2-minute session | Easy–Medium (2D top-down, 300 KB) | **Seed (track of the day), LB (daily best time), Ghost (race the #1 line), LS (streak)** | **Partial** (A jungle race is a time-trial vs your own best; no daily seed or ghost) | Fully generic. **Best fit for FGS's primitive set and a clean catalog gap** — ship on the top-down 2D racer (rank 5) |
| 10 | **Drift simulator (3D, tandem/score drifting, real-ish physics)** | CarX Drift Racing 2 (CarX): ~51–53M installs (AppGoblin est.); "30,000,000+ downloaded CarX" (listing). CarX Drift Racing 3 newer, smaller | Dedicated drift community, deep physics, car customisation | Medium–Hard (**600 KB / asset-heavy**, 3D physics; real risk) | LB (drift score), LS (garage), sounds | **No (gap)** | Generic drifting. Avoid "CarX" name and licensed cars. Lower priority: asset weight fights the bundle cap |
| 11 | **Jet-ski / boat racer (water physics, wake jumps, stunts)** | Riptide GP2 (Vector Unit): ~44.9M installs (AppGoblin est.) vs 100K+ (mobi.gg) — **figures conflict, treat as rough/unverified** | Novelty of water handling + stunt boosts; console-quality niche | Medium (2D top-down 300 KB; 3D 600 KB asset-heavy) | LB (race/stunt), LS, Seed (daily course), sounds | **No (gap)** | Generic. Avoid "Riptide GP" name/art. Mid-tier, niche demand |
| 12 | **3D auto-runner race vs AI (lane runner where you place 1st)** | Pocket Champs: 3D Racing Games (Madbox): **#2 on Sensor Tower's Q2 2025 US racing revenue** chart; lifetime install total **unverified** (no public figure found) | Runner simplicity + "finish ahead of rivals" framing + training/upgrade meta | Medium (**600 KB**, 3D) | LB (finish time/place), LS (upgrades), Seed, sounds | **Partial** (overlaps Racing + A jungle race; the "race-to-first vs AI runners" meta is absent) | Generic. Avoid "Pocket Champs" branding. 600 KB tier, lower priority |
| 13 | **Top-down pursuit / getaway chase (evade or outrun, crash-dodge)** | PAKO – Car Chase Simulator (Tree Men Games): ~8.7M installs (AppGoblin est.), 3.9★; PAKO 2 / 3 sequels. Arcade cult niche | Short, punishing, high-score arcade loop; very cheap to build | Easy (canvas 2D, 300 KB) | LB (survival time/score), LS (best, cars), Seed, sounds | **No (gap)** | Generic chase mechanic. Avoid "PAKO" name. Niche but very low build cost |
| 14 | **Slot-car racer (fixed lane, throttle control on bends)** | Slot Car: High Tech Racing (Supercharge): ~30–32K installs (AppGoblin est.) — **low/niche, unverified**. SlotZ Racer, Onslot Car are small | Nostalgic throttle-timing skill; tiny but loyal audience | Easy (canvas 2D, 300 KB) | LB (lap time), LS, Seed (daily layout), Ghost, sounds | **No (gap)** | Generic. "Scalextric" is a trademark. Low priority — thin demand evidence |

## Online head-to-head racing would need a new realtime-rooms primitive on FGS

FGS has no rooms/multiplayer primitive. **Ghost and time-trial competition works today** (record a line, race it back, rank on `useLeaderboard`) and should be the competitive hook for every archetype above. Live, same-track racing against other people needs a rooms primitive:

| Mode | Why it needs rooms | Demand signal | Notes |
|---|---|---|---|
| Real-time multiplayer race (2–8 cars, same track) | Continuous position/physics sync between peers | Mario Kart Tour 200M+; Hill Climb Racing 3 added online PvP in 2025 | Deterministic lockstep or client-authoritative position fan-out; 8 peers, small frequent messages. No anti-cheat without server logic |
| Async "beat my time" challenge links | Needs a persistent per-track time + ghost store, not just rooms | CSR-style PvP leagues; daily time-trial culture | **Partial today:** the leaderboard already supports async best-time competition; a friend-challenge link + stored ghost would upgrade it |
| Live tournament / league ladders | Scheduled events, server-authoritative standings | Live-ops is core to CSR 2, Asphalt | Needs cron + server compute; out of scope |

## Not buildable on FGS (and why)

| Category | Examples (demand) | Blocker |
|---|---|---|
| AAA 3D sim-racers | Asphalt Legends (franchise 1B+ downloads), Real Racing 3, Need for Speed: No Limits | 3D asset libraries (cars, tracks, cities) far exceed the 600 KB cap and FGS has no big-asset storage; live-ops economy |
| Licensed-IP & licensed-car racers | Mario Kart Tour (Nintendo), real manufacturer car models (CSR 2, Asphalt), F1 Mobile | Trademark/copyright on names, characters, cars and tracks. Generic karts/drag cars under original branding are fine |
| Real-money / wager racing | Skill-based cash race apps | Payments unsupported; gambling regulation; contradicts FGS's free, no-monetisation model |
| Server-authoritative ranked PvP racing | Competitive matchmaking ladders | Needs authoritative server logic + matchmaking FGS doesn't support |
| Live-ops economy racers | CSR 2, Asphalt (events, seasons, car-part economy) | Server-side economy, scheduled events, payments |
| Fresh daily tracks pushed from a server | Any "new official track each day" | No cron. Daily tracks must be generated client-side from a date seed |
| Trustworthy global race leaderboards | Competitive time-trial with prizes | Times are client-submitted with no server validation — keep boards casual |

## Biggest gaps vs the current FGS catalog (ranked by demand × fit)

1. **Hill-climb physics racer** (Hill Climb Racing 2B downloads, ~4M DAU). The standout driving gap. Medium (2D physics step).
2. **Daily seeded time-trial + leaderboard ghost.** No download mega-title, but the **best fit for FGS's `useLeaderboard` + date-seed + localStorage** and absent from the catalog. Build it on top of a top-down 2D racer. Easy–Medium.
3. **Drag racer** (CSR franchise $1B+ spend; #1 US racing revenue Q2 2025). Short, skill-timing, highly replayable. Easy.
4. **One-touch drift** (Drift Max ~48M est.; Drifty Race / Sling Drift). Classic hyper-casual shape, single input. Easy.
5. **Moto / traffic rider** (Traffic Rider 500M+ Play bucket). Add a first-person/motorcycle variant alongside the existing car `Racing`. Medium.
6. **Pure top-down time-trial lap racer** (no items), extending the Kart Racers engine. Easy — and the host for gap #2.
7. **Top-down pursuit/getaway chase** (PAKO ~8.7M est.). Very cheap build, arcade high-score loop. Easy.
8. **Drift simulator (3D)**, **jet-ski/boat racer**, **3D auto-runner race vs AI**: all 600 KB-tier and asset-heavy — lower priority, flag the bundle risk.
9. **Slot-car racer**: thin demand evidence; only if a quick arcade filler is wanted.

**Already well covered (don't duplicate):** endless lane/traffic-dodge runner (`Racing`), kart-vs-AI (`Kart Racers`), Crossy-Road traffic-crossing hopper (`Road Hopper`, `Crossy Rivers`, `Crossy School`, `Endless Highway`).

**Catalog hygiene flagged in passing:** the racing-category entries `Race`, `Cart` and `my shopping spree` have placeholder descriptions and look like low-quality or duplicate entries — review and likely unlist. `A jungle race` appears twice in the registry (de-duplicate). `Maze Racer` is a maze-solving puzzle, not a driving racer, despite the name. Check `Racing` and `Kart Racers` for any copied real-car or franchise trade dress before further promotion.

## Sources

**Market reports and genre trend**
- AppMagic, *Mobile Market Landscape 2026* (racing revenue −11.4% YoY 2025; market +0.2% revenue, +4.6% downloads): https://appmagic.rocks/files/view/upload/Reports/EN_MobileMarkeLandscape2026.pdf
- GameDevReports (summary of AppMagic Landscape 2026): https://gamedevreports.substack.com/p/appmagic-mobile-market-landscape
- PocketGamer.biz, "Games revenue growth stalls in 2025 as strategy emerges as the fastest-growing genre": https://www.pocketgamer.biz/games-revenue-growth-stalls-in-2025-as-strategy-emerges-as-the-fastest-growing-genre
- Sensor Tower, Q2 2025 US top 5 racing games by revenue (CSR 2 #1; Pocket Champs; No Limit Drag Racing 2; Asphalt; Mario Kart Tour): https://sensortower.com/blog/2025-q2-android-top-5-racing%20games-revenue-us-62fbc03af5dff393904ee927
- PocketGamer.biz, "The most downloaded mobile games of 2025" (AppMagic data): https://www.pocketgamer.biz/the-most-downloaded-mobile-games-of-2025/

**Endless runner-racers**
- Beebom / Android Authority, Subway Surfers first Android game to 1B downloads on Play: https://beebom.com/subway-surfers-is-first-android-game-to-clock-one-billion-downloads/amp/
- Android Authority, Subway Surfers ~30M downloads/month (2025): https://www.androidauthority.com/subway-surfers-gets-record-1-billion-downloads-google-play-store-846397/
- PocketGamer.com, Subway Surfers 4B downloads: https://www.pocketgamer.com/subway-surfers/4b-downloads
- Splitmetrics, most-downloaded Google Play games (Subway Surfers & Temple Run 2 July 2025 + lifetime): https://splitmetrics.com/blog/most-downloaded-games-in-google-play/

**Hill-climb physics racer**
- Fingersoft, "Hill Climb Racing breaks a new record: 2 billion downloads" (Jan 2026): https://fingersoft.com/news/2026/01/15/hill-climb-racing-breaks-a-new-record-2-billion-downloads/
- PocketGamer.biz, "Fingersoft's Hill Climb Racing passes 2bn downloads worldwide": https://www.pocketgamer.biz/fingersofts-hill-climb-racing-passes-2bn-downloads-worldwide
- Cision/Miltton, "Hill Climb Racing becomes the world's most-downloaded racing game series with more than 2.5 billion downloads": https://news.cision.com/miltton/r/hill-climb-racing-becomes-the-world-s-most-downloaded-racing-game-series-with-more-than-2-5-billion-,c4082680
- iXBT Games, Hill Climb Racing 3 early access with PvP (Oct 2025): https://ixbt.games/en/news/2025/10/31/arkadnaia-gonka-hill-climb-racing-3-s-pvp-vysla-v-rannem-dostupe-na-android.html

**Moto / traffic riders**
- AppGoblin, Traffic Rider (install estimates; Play 500M+ bucket): https://appgoblin.info/apps/com.skgames.trafficrider

**Kart racers**
- AppGoblin, Beach Buggy Racing (~329M installs est.): https://appgoblin.info/apps/com.vectorunit.purple.googleplay
- AppGoblin, Beach Buggy Racing 2 (~100M installs est.): https://appgoblin.info/apps/com.vectorunit.cobalt.googleplay
- Sensor Tower, "Mario Kart Tour surpasses 200 million downloads and $200 million in lifetime revenue": https://sensortower.com/blog/mario-kart-tour-200-million-downloads
- GamesBeat, Mario Kart Tour 200M downloads / $200M revenue: https://gamesbeat.com/sensor-tower-mario-kart-tour-races-to-200m-downloads-and-200m-revenue

**Drag racers**
- PocketGamer.biz, "CSR Racing franchise has surpassed $1 billion in player spending": https://www.pocketgamer.biz/csr-racing-franchise-has-surpassed-1-billion-in-player-spending
- AppGoblin, CSR 2 – Realistic Drag Racing (install/MAU estimates): https://appgoblin.info/apps/887947640
- PocketGamer.biz, "73m downloads for Zynga and NaturalMotion's CSR Racing 2": https://www.pocketgamer.biz/73m-downloads-for-zynga-and-naturalmotion-csr-racing-2

**One-touch drift & drift sim**
- AppGoblin, Drift Max Pro (install estimate): https://appgoblin.info/apps/com.tiramisu.driftmax2/trends
- AppGoblin, CarX Drift Racing 2 (~51–53M installs est.): https://appgoblin.info/apps/com.carxtech.carxdr2
- Apple App Store, Sling Drift (AI Games, one-tap drift): https://apps.apple.com/us/app/sling-drift/id1377372413
- Apple App Store, Drifty Race! (SayGames): https://apps.apple.com/uz/app/id1454780067

**Crossy-Road hopper**
- PocketGamer.biz, "Crossy Road celebrates over 200 million downloads": https://www.pocketgamer.biz/crossy-road-celebrates-over-200-million-downloads
- Crossy Road press page (250M+ downloads claim): https://crossyroad.com/press

**Jet-ski / boat, pursuit, 3D runner-racer, slot-car**
- AppGoblin, Riptide GP2 (~44.9M installs est.): https://appgoblin.info/apps/com.vectorunit.red
- AppGoblin, PAKO – Car Chase Simulator (~8.7M installs est.): https://appgoblin.info/apps/com.treemengames.pako
- BlueStacks, Pocket Champs: 3D Racing Games (Madbox, arcade racing): https://www.bluestacks.com/apps/racing/pocket-champs-3d-on-pc.html
- AppGoblin, Slot Car Game: High Tech Racing (~30–32K installs est.): https://appgoblin.info/apps/com.supercharge.htrplus

**IP / trademark**
- Wikipedia, Asphalt Legends (Gameloft; franchise 1B+ downloads): https://en.wikipedia.org/wiki/Asphalt_Legends
- Wikipedia, Fingersoft (Hill Climb Racing franchise history): https://en.wikipedia.org/wiki/Fingersoft
