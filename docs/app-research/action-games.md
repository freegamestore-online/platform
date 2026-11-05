# Action games with proven demand: market research for FreeGameStore

**Date:** 2026-11-05
**Platform:** FreeGameStore (FGS, freegamestore.online): free, open-source (MIT), no-ads, no-tracking browser games built on the `@freegamestore/games` React SDK.

## Summary

Action is the most-downloaded mobile game category after casual/puzzle, led by **endless runners** and **shooters**. AppMagic's full-year 2025 chart (via Mobilegamer.biz, 13 Jan 2026) puts three shooters/runners in the global top 20: **Free Fire** #3 (287M installs), **Subway Surfers** #4 (191M), and the newcomer **FPS Strike Ops** #17 (99M). The `.io`/arcade-action cluster is also large: **Hole.io** #9 (121M), **Snake Clash** #14 (104M), **Paper.io 2** #15 (102M). Lifetime install buckets confirm the long tail: **Subway Surfers** and **Temple Run 2** are Play 1B+ each; **Sonic Dash** and **Fruit Ninja** 500M+; **Shadow Fight 2**, **Stick War: Legacy**, **Crossy Road**, **Jetpack Joyride**, **Zombie Tsunami**, **Kick the Buddy** and **Geometry Dash Lite** 100M+ each. The **survivor-like / bullet-heaven** subgenre (Habby's **Survivor.io**, **Archero**) is the standout monetiser: Survivor.io passed ~$75M from 37M downloads within two months of launch, and Archero 2 took ~$8M in its first 11 days.

The catch for FGS is that the **biggest** action hits are the hardest to build: behind-view 3D runners (Subway Surfers), realtime 3D shooters (Free Fire) and live `.io` arenas all need either a heavy 3D engine beyond the asset budget, a realtime-rooms primitive FGS does not have, or both. **The buildable opportunity is the 2D layer underneath them:** side-view runners, slice/tap reaction games, 2D twin-stick and bullet-heaven arenas, platform-rhythm runners, rope-swing physics toys, and single-player-vs-bots versions of `.io` games. FGS already covers classic shmups (Space Shooter, Asteroids, Space Invaders), flappy/one-tap flyers (Pipe Flyer), frogger-style hoppers (Road Hopper, Crossy Rivers) and a doodle-jump-style climber (PixelJump). **Its biggest action gaps are: survivor-like / bullet-heaven, twin-stick arena roguelite, auto-runner-with-shoot, platform-rhythm runner, a real 1v1 fighter, rope-swing physics, and single-player territory/`.io` (Paper.io-style).**

## Methodology

- **Google Play installs/ratings** were read from live Play Store listings (`play.google.com/store/apps/details?id=…`, US English) on **2026-11-05** by fetching the raw listing HTML. Play shows install *buckets* ("100M+"), so these are lower bounds.
- **Full-year 2025 global download figures** come from AppMagic data as published by Mobilegamer.biz ("The top mobile game downloads of 2025", 13 Jan 2026) and PocketGamer.biz. These are estimates rounded to the nearest million and cover the App Store + Google Play (Android China revenue excluded).
- **Revenue and launch figures** for Survivor.io, Archero and Archero 2 come from Mobilegamer.biz and GameWorldObserver (citing AppMagic/Sensor Tower). Treat all revenue/MAU figures as **estimates**; lifetime revenue totals attributed to unnamed trackers are labelled **unverified**.
- **Ranking** is by strength of demand evidence: 2025 global downloads first, then lifetime install buckets of the top titles, then genre breadth. Ranks 1–8 are well evidenced; below that the ordering is approximate.
- **"Already on FGS?"** was checked against the 142-game `sites/freegamestore/registry.json` catalog. "Partial" means FGS has an adjacent mechanic but not this specific popular format.
- **"Build"** judges whether a solo developer could ship a solid version within the FGS SDK and the bundle cap. **Easy** = days; **Medium** = 1–2 weeks or content/tuning-heavy.

### FGS primitives and engines assumed

| Primitive / limit | What it enables |
|---|---|
| `GameShell`, `GameTopbar`, `GameOverScreen` | Standard chrome, pause/restart, end screen |
| `useGameSounds`, theme toggle | Sound effects, dark mode |
| `useAuth` (Google sign-in) | Identity for leaderboard entries |
| `useLeaderboard` (D1-backed) | Per-game score tables (high score, best distance/time) |
| localStorage | Saves, stats, best runs, upgrades, settings (per browser only; no cloud KV) |
| Engines | canvas (raw 2D), grid/cards (DOM), kaplay, phaser, pixi (WebGL 2D), 3d/r3f, babylon, excalibur, littlejs |
| Bundle cap | **300 KB** gzip for 2D/DOM (canvas, kaplay, littlejs, excalibur); **600 KB** for a heavy engine (Phaser, Pixi/WebGL, 3D/r3f, Babylon) |
| **Not available (blockers)** | Realtime rooms/multiplayer, server compute, cron, payments, big-asset storage |

Action games are mostly skill/score loops, so `useLeaderboard` (best distance, kills, time survived, combo) plus localStorage (upgrades, unlocks, best run) is the core. Client-submitted scores can be cheated: keep leaderboards casual. Any online/arena mode needs a realtime-rooms primitive FGS does not have yet.

## Ranked archetypes

Legend: **LB** = `useLeaderboard`; **LS** = localStorage save; **Auth** = `useAuth`. Build tier = 300 (2D/DOM) or 600 (heavy engine).

| Rank | Game archetype | Example top titles (installs / ratings / revenue) | Why it's popular | Build | FGS features used | Already on FGS? | IP / trademark caveats |
|---|---|---|---|---|---|---|---|
| 1 | **Endless runner, behind-view 3D (chase / lane-dodge, collect, no fail-restart)** | Subway Surfers (SYBO/Kiloo): Play 1B+, 4.5★, 41.4M reviews; AppMagic 2025 #4, 191M installs. Temple Run 2 (Imangi): Play 1B+, 4.0★, 9.8M reviews. Sonic Dash (Sega): Play 500M+, 4.6★, 6.52M reviews | One-thumb, instant restart, daily-challenge habit, universally legible | **Top titles: not buildable** (behind-view 3D + large character/world asset libraries exceed the 600 KB tier and asset limits). A **2D side-view lane runner is Medium** (canvas/kaplay, 300) | LB (distance), LS (best, coins, unlocks), sounds | **Partial** (Neon Runner is a 2D side-dodge; no coin-collect lane runner; no behind-view 3D) | Mechanic is generic. Avoid Subway Surfers / Temple Run names, characters (Jake, graffiti art) and trade dress. Build an original-art 2D runner |
| 2 | **Arena / battle-royale FPS-TPS shooter** | Free Fire (Garena): AppMagic 2025 #3, 287M installs. FPS Strike Ops: AppMagic 2025 #17, 99M (2025 newcomer). Modern Combat 5 (Gameloft): Play 100M+, 4.6★, 4.28M reviews | Competitive, social, cosmetics economy | **Not buildable** (needs realtime rooms + server-authoritative state + 3D asset pipeline; also anti-cheat) | — | **No** | Out of scope on three blockers at once. Note only |
| 3 | **Slice / swipe-reaction arcade (cut flying objects, avoid bombs, combo)** | Fruit Ninja (Halfbrick): Play 500M+, 4.4★, 5.3M reviews | Tactile, 10-second sessions, combo chase, works great on touch | **Easy** (canvas or pixi; swipe-trail + simple physics; 300, or 600 if pixi) | LB (high score / best combo), LS (best, unlocks), sounds | **Partial** (SLICEit and Slicing exist; no Fruit-Ninja-style arcade slicer with bombs/combos/blitz mode) | Generic slicing is fine. Avoid the Fruit Ninja name, the katana-blade trail look, splatter trade dress and the "sensei" branding. Use original produce/target art |
| 4 | **Single-player `.io` / arena-action vs bots (territory, growth, hole-eat, snake-clash)** | Hole.io (Voodoo): AppMagic 2025 #9, 121M installs. Paper.io 2 (Voodoo): AppMagic 2025 #15, 102M. Snake Clash (Supercent): AppMagic 2025 #14, 104M. slither.io: Play 500M+ | "Agar/snake" growth loop; feels multiplayer even against bots; short sessions | **Easy–Medium vs AI bots** (canvas, 300). Paper.io-style territory fill and snake-growth run fine single-player. **Live online arenas need a rooms primitive** | LB (best area / length / size), LS (best run), sounds | **Partial** (Slither Arena / Snake / Slither cover snake.io; no territory-fill Paper.io-style, no hole-eater) | Mechanics (territory fill, growth) are generic. Avoid the "`.io`" naming convention tied to specific brands (Paper.io, Hole.io are Voodoo), and slither.io's name/skin art. Hole-eater's 3D version is the 600 tier |
| 5 | **Survivor-like / bullet-heaven (auto-attack, dodge hordes, pick upgrades, roguelite run)** | Survivor.io (Habby): Play 50M+, 4.5★; ~$75M IAP from 37M downloads within ~2 months of launch (AppMagic via Mobilegamer); lifetime ~$464.5M net (**unverified** tracker). Vampire Survivors (poncle): Play 1M+, 4.3★, 81.8K reviews (paid) — genre origin | Deep run-to-run progression, "just one more run", readable even with hundreds of entities | **Medium** (littlejs / kaplay / pixi; procedural waves keep assets tiny; mind entity counts; 300–600) | LB (time survived / level), LS (meta-upgrades, unlocks), sounds, Auth (optional) | **No (gap)** | **Highest-value buildable gap.** Mechanic is generic; avoid Survivor.io / Vampire Survivors names and their specific weapon-evolution art. Original sprites synthesised or CC0 |
| 6 | **Top-down twin-stick arena roguelite (auto-fire, aim/dodge, room clears, abilities)** | Archero (Habby): Play 50M+, 4.2★. Archero 2 (Habby): ~$8M in first 11 days (AppMagic via GameWorldObserver, Jan 2025) | Stop-to-shoot tension, ability drafts, bite-size rooms | **Medium** (kaplay / pixi; 300–600) | LB (floor reached / score), LS (upgrades, gear), sounds, Auth (optional) | **Partial** (tanks / Battle City is top-down shoot-and-defend; no twin-stick ability-draft roguelite) | Generic. Avoid Archero name and hero/skill art. The "stand still to aim, move to dodge" rule is not protectable |
| 7 | **Auto-runner with jump + shoot / power-up flight** | Jetpack Joyride (Halfbrick): Play 100M+, 4.2★, 4.73M reviews. Zombie Tsunami (Mobigame): Play 100M+, 4.4★, 6.09M reviews | Endless, upgrade loop, one-button depth | **Medium** (kaplay / canvas; 300) | LB (distance), LS (coins, upgrades, unlocks), sounds | **No (gap)** (Neon Runner dodges only; no shoot/collect-and-upgrade runner) | Mechanics generic. Avoid Jetpack Joyride (Barry Steakfries) and Zombie Tsunami names/art. Original runner |
| 8 | **Platform-rhythm auto-runner (jump to the beat, memorise, precision timing)** | Geometry Dash Lite (RobTop): Play 100M+, 4.4★, 7.77M reviews | Rhythm + reflex + practice-mode mastery; huge creator/clip culture | **Medium** (canvas; the work is level + beat design; 300) | LB (percent complete / attempts), LS (progress, practice checkpoints), sounds | **No (gap)** (Beat Star is a lane rhythm-tap, not a platform-rhythm runner) | **Music is the main IP risk**: use only public-domain compositions or original tracks synthesised in WebAudio — no copyrighted songs. Avoid the Geometry Dash name and cube/icon trade dress |
| 9 | **Vertical / fixed shoot-'em-up (space shmup, bullet-hell lite, wave survival)** | Galaxy Attack, 1945 Air Force, Galaxiga and classic space shooters chart steadily in Sensor Tower's per-country shoot-'em-up top 5 (2025). Asteroids / Space Invaders are evergreen arcade templates | Pure reflex, escalating waves, satisfying firepower upgrades | **Easy–Medium** (kaplay / canvas 300, or phaser/pixi 600) | LB (score / wave), LS (ship upgrades, best), sounds | **Yes** (Space Shooter [Phaser], Space Invaders, Asteroids, Starship) | Generic. Avoid specific titles' ship/enemy art. Space Invaders' exact invader sprites are Taito trade dress — use original shapes |
| 10 | **1v1 fighter (versus brawler: combos, blocks, special meter; stickman or sprite)** | Shadow Fight 2 (Nekki): Play 100M+, 4.5★, 16.7M reviews | Deep but readable combat, progression, nostalgia for the fighting genre | **Medium** (canvas / kaplay; animation + hitbox/frame data is the work; 300). Local hot-seat (2-player one device) ships now; **online versus needs rooms** | LB (vs-AI win streak), LS (unlocks, stats), sounds, local 2P | **No (gap)** (the catalog's "Fight" is a top-down zombie-maze shooter, not a versus fighter; Fire & Ice Duo is a co-op platformer) | Mechanics generic. Avoid Shadow Fight / Mortal Kombat / Street Fighter names, characters and fatality-style trade dress. Silhouette-style original fighters are safe |
| 11 | **Action-strategy lane battler / mini beat-'em-up (spawn units, push to the enemy base)** | Stick War: Legacy (Max Games): Play 100M+, 4.8★, 3.23M reviews | Easy-to-grasp push-your-lane tension; stickman charm; endless/campaign modes | **Medium** (pixi / kaplay; unit AI + balance is the work; 300–600) | LB (waves survived / win streak), LS (upgrades, campaign progress), sounds | **Partial** (Command, Monster Attack, Zombie Attack are simple defend games; no Stick War-style unit-economy lane battler) | Generic genre. Avoid the Stick War name and its specific unit designs. Original stick/sprite units |
| 12 | **Traffic / obstacle hopper (cross lanes of hazards, step-by-step, procedural)** | Crossy Road (Hipster Whale/Yodo1): Play 100M+, 4.4★, 4.57M reviews. Frogger is the public-domain ancestor | Endless, one-tap, "just one more hop", character-unlock collection | **Easy** (canvas / kaplay; voxel look optional; 300) | LB (distance / score), LS (unlocked characters, best), sounds | **Yes** (Road Hopper [frogger], Crossy Rivers, Crossy School) | Frogger's mechanic is generic but **"Frogger" is a Konami trademark**; Crossy Road's voxel art + name are Hipster Whale's trade dress. Use original blocky art and an original name (the catalog already renamed to "Road Hopper") |
| 13 | **Rope-swing / momentum physics (swing, release, fling across gaps)** | Stickman Hook (Madbox): Play 10M+, 4.0★, 558K reviews | Satisfying momentum physics, one-touch, short levels, oddly hypnotic | **Easy–Medium** (canvas / kaplay with a verlet/pendulum solver; physics tuning is the work; 300) | LB (best time / levels cleared), LS (level progress, skins), sounds | **No (gap)** | Pendulum-swing mechanic is generic. Avoid the Stickman Hook name and Madbox's exact level/skin styling. Plain stick figure is fine |
| 14 | **Physics ragdoll / trick-shot action (antistress toy, ricochet one-shot puzzles)** | Kick the Buddy (Playgendary): Play 100M+, 4.0★, 3.57M reviews. Mr Bullet (Lion Studios): Play 10M+, 4.4★, 747K reviews | Toy-box experimentation; trick-shot "aha"; short, shareable | **Medium** (canvas with a light 2D physics lib; stay well inside 300) | LB (stars / levels / score), LS (level progress, unlocks), sounds | **No (gap)** | Mechanics generic. Avoid Kick the Buddy / Mr Bullet names and their character/UI trade dress. Keep antistress content non-gory and age-appropriate |
| 15 | **One-tap reaction flyer / tap-to-survive (flappy, timing taps, reflex)** | Flappy Bird was the defining viral one-tap hit (pulled 2014); the format still fills arcade charts via countless clones. Doodle Jump (Lima Sky): Play 1M+, 4.0★, 1.09M reviews (vertical-ascent cousin) | Trivially learnable, brutally replayable, instantly shareable scores | **Easy** (canvas; 300) | LB (score / distance / height), LS (best), sounds | **Yes** (Pipe Flyer, Flappy Slay Bird, Dragon Tap, Whack-a-Mole; PixelJump covers doodle-jump-style ascent) | **"Flappy Bird" and "Doodle Jump" are protected names** (Lima Sky has enforced "Doodle"/"Doodle Jump" trademarks). Mechanics are generic; use original names and art (the catalog already uses "Pipe Flyer") |

## Needs a realtime-rooms primitive (local/vs-AI ships now)

FGS has no rooms or multiplayer primitive. For the action genre, **single-player-vs-bots or local hot-seat ships now and should be the default**; the online/arena mode waits on a WebSocket rooms primitive (the same one the simple-games report scopes: ~32 peers/room, ~4 KB messages, host- or client-authoritative, no server game logic).

| Online mode | Why it needs rooms | Demand signal |
|---|---|---|
| Live `.io` arena (snake.io, Paper.io, Hole.io, agar-style, 10–30 players) | Many live peers, position sync | slither.io 500M+; Paper.io 2 102M, Hole.io 121M, Snake Clash 104M (AppMagic 2025) |
| 1v1 / party fighter online | Remote opponent, input sync | Shadow Fight 2 100M+ |
| Co-op survivor / twin-stick | Shared enemy state | Survivor.io 50M+ |
| Realtime arena FPS/TPS | Server-authoritative state + anti-cheat (also a 3D blocker) | Free Fire 287M (AppMagic 2025) |

Shot/position sync without server logic is client-trusted (fine for friends via an invite link, not for ranked strangers). Light peer-relayed arenas (snake-style) are feasible at small room sizes with no anti-cheat.

## Not buildable on FGS (and why)

| Category | Examples (demand) | Blocker |
|---|---|---|
| Behind-view 3D endless runners | Subway Surfers (1B+, 191M in 2025), Temple Run 2 (1B+), Sonic Dash (500M+) | 3D character/world asset libraries exceed the 600 KB tier and big-asset limits. A 2D side-view runner is the buildable substitute |
| Realtime 3D shooters (BR / FPS / TPS) | Free Fire (287M in 2025), FPS Strike Ops (99M), Modern Combat 5 (100M+), PUBG Mobile | Realtime rooms + server-authoritative state + anti-cheat + heavy 3D, all unsupported |
| Big-3D physics hybrid-casual | Hole.io (121M in 2025, 3D eater), Extreme Car Driving Simulator (97M in 2025) | 3D engine weight + asset pipeline beyond 600 KB. (A 2D top-down "hole" can approximate it) |
| Live-ops action-RPG / gacha | Archero's full live-ops economy, hero gacha | Server economy, events, payments. The core twin-stick *loop* is buildable; the live-ops wrapper is not |
| Licensed-IP action | Sonic Dash (Sega), Plants vs. Zombies (EA, Play 100M+), any branded hero | Trademark/copyright. Generic mechanics under original branding are fine |

## Biggest gaps vs the current FGS catalog (ranked by demand × buildability)

1. **Survivor-like / bullet-heaven** (Survivor.io 50M+; strongest monetiser in the set). Medium. The single highest-value action gap.
2. **Top-down twin-stick arena roguelite** (Archero 50M+; Archero 2 ~$8M in 11 days). Medium.
3. **Auto-runner with jump + shoot** (Jetpack Joyride 100M+, Zombie Tsunami 100M+). Medium.
4. **Platform-rhythm auto-runner** (Geometry Dash Lite 100M+). Medium; use public-domain/original music only.
5. **Slice / swipe-reaction arcade with combos & bombs** (Fruit Ninja 500M+). Easy; FGS's slicing games don't cover the arcade format.
6. **Single-player territory / `.io` vs bots (Paper.io-style, hole-eater)** (Paper.io 2 102M, Hole.io 121M, Snake Clash 104M in 2025). Easy–Medium; FGS only has snake.io.
7. **Real 1v1 versus fighter** (Shadow Fight 2 100M+). Medium; local hot-seat now, online later. The catalog has no true fighter.
8. **Rope-swing / momentum physics** (Stickman Hook 10M+). Easy–Medium.
9. **Physics ragdoll / trick-shot action** (Kick the Buddy 100M+, Mr Bullet 10M+). Medium.
10. **Action-strategy lane battler** (Stick War: Legacy 100M+, 4.8★). Medium.
11. **2D side-view lane runner (coin-collect)** as an original stand-in for Subway Surfers/Temple Run (both 1B+). Medium.

**Catalog hygiene flagged in passing:** the action entries worth a trademark/trade-dress check are the ones named or styled after commercial titles — Bird Launcher ("Angry Birds" in its own description), Flappy Slay Bird, Dot Muncher (Pac-Man), Slice Master ("good-pizza-great-pizza"), Lavaman And Icegirl / Fire & Ice Duo (Fireboy & Watergirl), Slither / Slither Arena (slither.io), and the "Fight" entry. Confirm each uses an original name and art, as the catalog already did for Road Hopper, Pipe Flyer, Four in a Row and Crazy Eights.

## Sources

**Market reports and download data**
- Mobilegamer.biz, "The top mobile game downloads of 2025" (AppMagic data, 13 Jan 2026): https://mobilegamer.biz/the-top-mobile-game-downloads-of-2025/
- PocketGamer.biz, "The most downloaded mobile games of 2025" (AppMagic data): https://www.pocketgamer.biz/the-most-downloaded-mobile-games-of-2025/
- Mobilegamer.biz, "Two months in, Survivor.io passes $75m from 37m downloads": https://mobilegamer.biz/two-months-in-survivor-io-passes-75m-from-37m-downloads/
- Mobilegamer.biz, "TikTok drives Habby's Survivor.io past $15m IAP revenue, 12m downloads": https://mobilegamer.biz/tiktok-drives-habbys-survivor-io-past-15m-iap-revenue-12m-downloads/
- GameWorldObserver, "Archero 2 revenue: $8 million in 11 days vs original game" (AppMagic / Sensor Tower): https://gameworldobserver.com/2025/01/20/archero-2-revenue-8-million-in-11-days-vs-original-game
- Naavik, "Survivor.io: In Archero's Footsteps" (retention and genre analysis): https://naavik.co/deep-dives/survivorio-archeros-footsteps/
- Sensor Tower, per-country Top 5 shoot-'em-up games charts (2025), e.g. US Q3 2025 Android units: https://sensortower.com/blog/2025-q3-android-top-5-shoot'em%20up%20games-units-us-6019ed4d241bc16eb8623896

**Google Play listings (raw listing HTML fetched 2026-11-05)**
- `https://play.google.com/store/apps/details?id=<package>` for: com.kiloo.subwaysurf (Subway Surfers), com.imangi.templerun2 (Temple Run 2), com.sega.sonicdash (Sonic Dash), com.kitkagames.fallbuddies (Stumble Guys), com.halfbrick.fruitninjafree (Fruit Ninja), com.dxx.firenow (Survivor.io), com.habby.archero (Archero), com.poncle.vampiresurvivors (Vampire Survivors), com.halfbrick.jetpackjoyride (Jetpack Joyride), net.mobigame.zombietsunami (Zombie Tsunami), com.robtopx.geometryjumplite (Geometry Dash Lite), com.nekki.shadowfight (Shadow Fight 2), com.maxgames.stickwarlegacy (Stick War: Legacy), com.yodo1.crossyroad (Crossy Road), com.mindy.grap1 (Stickman Hook), com.playgendary.kickthebuddy (Kick the Buddy), com.lionstudios.mrbullet (Mr Bullet), com.lima.doodlejump (Doodle Jump), com.ketchapp.ballz (Ballz), com.fingersoft.hillclimb (Hill Climb Racing), com.gameloft.android.ANMP.GloftM5HM (Modern Combat 5), com.ea.game.pvzfree_row (Plants vs. Zombies), com.nintendo.zara (Super Mario Run)

**IP / trademark**
- Lima Sky "Doodle Jump" / "Doodle" trademark enforcement (overview): https://en.wikipedia.org/wiki/Doodle_Jump
- Dong Nguyen removed Flappy Bird (2014), spawning the clone wave: https://en.wikipedia.org/wiki/Flappy_Bird
- Tetris Holding v. Xio (trade-dress precedent for "look and feel" of a clone; referenced in simple-games.md): https://en.wikipedia.org/wiki/Tetris_Holding,_LLC_v._Xio_Interactive,_Inc.
