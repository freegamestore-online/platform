# Arcade games with proven demand: market research for FreeGameStore

**Date:** 2026-11-05
**Platform:** FreeGameStore (FGS, freegamestore.online): free, open-source (MIT), no-ads, no-tracking browser games built on the `@freegamestore/games` React SDK.

## Summary

The arcade genre on mobile is dominated by a small set of **evergreen, reflex-driven classics** rather than a churn of new chart-toppers the way casual puzzle is. The clearest demand signal is lifetime scale: **Subway Surfers** (endless runner) has 1B+ Play installs and was the 4th most-downloaded mobile game of 2025 with ~191M installs (AppMagic via mobilegamer.biz); **Temple Run 2** also sits at 1B+. Rhythm-tap and one-finger titles are the next tier — **Magic Tiles 3** (500M+), **Geometry Dash Lite** (500M+, 7.77M reviews), **Fruit Ninja** (500M+), **Stack Ball** (500M+), **slither.io** (500M+). The .io arena format still charts today: on 2026-11-05 the US App Store "Casual" top-free list showed **Paper.io 2** at #18, **Magic Tiles 3** at #19 and **Subway Surfers** at #22 — the only arcade titles in the top 25, which are otherwise puzzle/merge games.

FGS already covers most of the canonical arcade mechanics, often several times over: endless runner (Neon Runner, Racing), lane-crosser (Road Hopper, Crossy School, Crossy Rivers, Endless Highway), flappy one-tap (Pipe Flyer, Flappy Slay Bird, stacky birdy), brick-breaker (Breakout, Brick Blast), fixed-shooter (spaceinvaders, Space Shooter), Asteroids, maze-chase (Dot Muncher), Pong, pinball, snake/worm .io (Snake, Slither, Slither Arena), whack-a-mole, slicing (Slicing, SLICEit), rhythm (Beat Star, Cascade Keys), and dodger/catcher (Star Dodger, AVOIDit, Apple Picking, Orb Cascade). **Its biggest genuine gaps are three high-demand formats it has no real equivalent of:** a beat-synced **rhythm-runner** (Geometry Dash, 500M+), **territory-capture / mass-eater .io** (Paper.io 2, Agar.io — FGS only has the worm variant), and a polished **vertical doodle-jumper**. Two more are strong but sit in the 600 KB 3D tier: **helix / descending-ball smash** (Helix Jump, Stack Ball) and **rolling-ball / hole physics** (Going Balls, Hole.io). Most arcade archetypes are **Easy** to build within the 300 KB 2D bundle cap with a `useLeaderboard` high-score table, localStorage best-score saves, and an optional daily date-seed for a "daily run".

## Methodology

- **Google Play installs/ratings** were read directly from live Play Store listings (`play.google.com/store/apps/details?id=…`, US English) on 2026-11-05. Play shows install *buckets* ("500M+"), so these are lower bounds.
- **Apple App Store chart positions** come from Apple's public RSS top-free feeds (US), fetched 2026-11-05. The feed labelled `genre=7003` carries the title "Top Free Applications in Casual"; Apple does not expose a clean public "Arcade" RSS, so arcade titles are read out of the Games (6014) and Casual feeds. Apple does not publish install counts.
- **Annual 2025 downloads** come from AppMagic, reported via PocketGamer.biz and mobilegamer.biz. Monthly and full-year figures use different AppMagic cut-offs and some exclude China Android, so treat them as **estimates**. Third-party trackers (AppGoblin, Sensor Tower, AppBrain) disagree, sometimes by multiples.
- **Historical milestones** (Fruit Ninja 300M, Flappy Bird ~50M) are developer- or press-reported and labelled as such.
- **Ranking** is by strength of demand evidence: lifetime install buckets of the top titles first, then 2025 download estimates, then current chart presence. Ranks 1–8 are well evidenced; below that the ordering is approximate.
- **"Already on FGS?"** was checked against the 142-game catalog (`sites/freegamestore/registry.json`). "Partial" means FGS has an adjacent mechanic but not the specific popular format.
- No install count, rating, revenue or rank below was invented. Where a figure could not be verified it is marked "unverified".

### FGS primitives assumed

| Primitive | What it enables |
|---|---|
| `GameShell`, `GameTopbar`, `GameOverScreen` | Standard chrome, pause/restart, end screen |
| `useGameSounds` (+ mute policy), theme toggle | Sound effects, dark mode |
| `useAuth` (Google sign-in) | Identity for leaderboard entries |
| `useLeaderboard` (D1-backed) | Per-game high-score / best-distance tables |
| localStorage | Best score, unlocks, settings (per browser only; no cloud KV) |
| Engines | canvas (raw 2D), grid/cards (DOM), kaplay, phaser, pixi (WebGL 2D), 3d/r3f, babylon, excalibur, littlejs |
| Bundle cap | 300 KB gzip (2D/DOM); 600 KB with a heavier engine (Phaser/Pixi/3D/Babylon) |
| **Not available (blockers)** | Realtime rooms/multiplayer, server compute, cron, payments, big asset storage |

Arcade scoring is reflex-based, so a **daily run** must be seeded deterministically from the date on the client. Client-submitted leaderboards can be cheated, so score them as casual.

## Ranked archetypes

Legend: **Build** = FGS buildability (Easy = days; Medium = 1–2 weeks or content/physics-heavy) + suggested engine + bundle tier. **LB** = `useLeaderboard`; **LS** = localStorage save; **Seed** = daily run/level seeded from the date; **Auth** = `useAuth`.

| Rank | Game archetype | Example top titles (installs / ratings / revenue) | Why it's popular | Build | FGS features used | Already on FGS? | IP / trademark caveats |
|---|---|---|---|---|---|---|---|
| 1 | **Endless runner (auto-run, dodge/collect on a track)** | Subway Surfers (Sybo): Play 1B+, 4.5★, 41.4M reviews; 4th most-downloaded game of 2025, ~191M installs (AppMagic/mobilegamer.biz); #22 US Casual (Apple, 2026-11-05). Temple Run 2 (Imangi): Play 1B+, 4.1★, 9.8M reviews | One-thumb, instant restart, "one more run" | **Medium** · 2D side/lane runner on **canvas/kaplay/pixi, 300 KB**. Full 3D track runner = **600 KB (r3f/babylon)** and an art pipeline that busts the asset limit | LB (distance), LS (best, coins), Seed (daily run), sounds | **Partial** (Neon Runner 2D-dodge, Racing 3D-lane, A jungle race) — no coin-collect runner with power-ups | Don't copy "Subway Surfers"/"Temple Run" names, the graffiti/temple themes, or character/hoverboard art. Auto-run-and-dodge is a generic mechanic |
| 2 | **Rhythm tile-tap (tap falling tiles on the beat)** | Magic Tiles 3 (AMANOTES): Play 500M+, 4.6★, 3.57M reviews; #19 US Casual (Apple, 2026-11-05). (Piano Tiles 2 delisted from US Play) | Music + reflex, endless free song list | **Easy** · canvas/DOM, **300 KB**. Synthesise notes in WebAudio | LB (score/streak), LS (best), sounds | **Partial** (Beat Star, Cascade Keys) | **Songs are the IP risk.** "Magic Tiles"/"Piano Tiles" are trademarks. Use only **public-domain compositions synthesised in WebAudio** — never recordings or MIDI of copyrighted songs |
| 3 | **Fruit / object slicing (swipe to slice, avoid bombs)** | Fruit Ninja (Halfbrick): Play 500M+, 4.4★, 5.3M reviews; passed 300M downloads in 2016 (Halfbrick, via PocketGamer) | Tactile swipe, combos, juicy feedback | **Medium** · swipe-trail + light physics + particles on **canvas/pixi, 300 KB** | LB (high score), LS (best), sounds | **Partial** (Slicing, SLICEit, AVOIDit) — no combo/bomb slicer with blade trail | "Fruit Ninja" is Halfbrick's trademark; avoid the name and the ninja/blade/dojo trade dress. Slicing is a generic mechanic |
| 4 | **Rhythm-runner (beat-synced auto-run, tap to jump/flip)** | Geometry Dash Lite (RobTop): Play 500M+, 4.6★, 7.77M reviews (full paid app separate). Cross-store ~242M (Sensor Tower, 2018, older) | Twitch-precise, rage-replay loop, music-timed | **Medium** · kaplay/excalibur/canvas, **300 KB**. Level design + precise timing + WebAudio music is the work | LB (best %/attempts), LS (progress), Seed (daily level), sounds | **No (gap)** — FGS Platformer is free-jump, Beat Star is a stationary lane-tapper | "Geometry Dash" is RobTop's trademark; avoid the name, the cube avatar and copied levels/soundtrack. Rhythm auto-run is generic. Author original levels + PD music |
| 5 | **.io arena (grow by eating / capturing territory vs many players)** | slither.io (Lowtech): Play 500M+, 3.8★, 6.54M reviews. Paper.io 2 (Voodoo): Play 100M+, 3.8★, 2.54M reviews; ~102M installs in 2025 (AppMagic); #18 US Casual (Apple, 2026-11-05). Agar.io (Miniclip): Play 100M+ (unverified exact bucket) | Competitive "just one more", simple rules | **Easy** solo-vs-bots · canvas/pixi, **300 KB**. True online needs rooms (see below) | LB (length/area), LS (best), sounds | **Partial** — worm .io covered (Snake, Slither, Slither Arena); **territory-capture (Paper.io) and mass-eater (Agar.io) are gaps** | "slither.io"/"Agar.io"/"Paper.io" are trademarks; avoid names and Voodoo/Miniclip trade dress. Mechanics are generic |
| 6 | **Helix / descending-ball smash (drop a ball through rotating rings)** | Stack Ball (Azur Games): Play 500M+, 4.8★, 1.13M reviews. Helix Jump (Voodoo): Play 100M+, 4.1★, 4.14M reviews | One-tap, satisfying smash, 20-second sessions | **Medium** · needs 3D tower → **r3f/babylon, 600 KB tier**. Procedural geometry keeps assets tiny | LB (level/score), LS (best), sounds | **No (gap)** | "Helix Jump"/"Stack Ball" are Voodoo/Azur trademarks; the mechanic (ball + rotating platform stack) is generic |
| 7 | **Fixed / vertical shoot-'em-up (ship at bottom, waves descend)** | Galaxy Attack: Alien Shooter (OneSoft): Play 100M+, 4.5★, 2.52M reviews. Space Invaders (Taito): genre-defining, 1978 | Clear goal, escalating waves, power-ups | **Easy** · canvas/phaser/pixi, **300 KB** | LB (score), LS (best/wave), sounds | **Yes** (spaceinvaders, Space Shooter, Math Invaders) | "Space Invaders" is Taito's trademark and its alien sprites are protected; don't reuse the name or those exact sprites. A generic fixed/vertical shooter is fine |
| 8 | **Lane-crosser hopper (cross endless roads/rivers, step by step)** | Crossy Road (Hipster Whale): Play 100M+, 4.6★, 4.57M reviews; dev claims 200M+ players (store text, unverified). Frogger (Konami): 1981 classic | Charming, bite-size, high-score chase | **Easy** · top-down 2D on **canvas/kaplay, 300 KB** (voxel 3D optional at 600 KB) | LB (distance), LS (best), sounds | **Yes** (Road Hopper, Crossy School, Crossy Rivers, Endless Highway — **de-dupe candidates**) | "Crossy Road" (Hipster Whale) and "Frogger" (Konami) are trademarks; the voxel block-animal look is Crossy Road trade dress. Use a generic hopper (FGS "Road Hopper" name is already generic) |
| 9 | **Jetpack / auto-run side-scroller (hold to rise, collect, dodge)** | Jetpack Joyride (Halfbrick): Play 100M+, 4.1★, 4.73M reviews | Smooth one-touch control, coins + missions | **Easy–Medium** · kaplay/canvas/pixi, **300 KB** | LB (distance), LS (best, coins), sounds | **Partial** (Platformer endless-jump, Neon Runner) — no hold-to-fly collector | "Jetpack Joyride" is Halfbrick's trademark; avoid the name and the Barry Steakfries character. Hold-to-fly auto-run is generic |
| 10 | **Brick-breaker / Breakout (bounce a ball to clear bricks)** | Bricks Breaker Quest (mobirix): Play 100M+, 4.0★, 606K reviews. Breakout/Arkanoid: arcade classics | Timeless, satisfying clears, level progression | **Easy** · canvas/pixi, **300 KB** | LB (score), LS (level/best), sounds | **Yes** (Breakout, Brick Blast) | Breakout mechanic is generic; **"Arkanoid" is Taito's trademark** — avoid its name and power-up trade dress |
| 11 | **Rolling-ball / hole physics (roll or absorb through a course/city)** | Going Balls (Supersonic): Play 100M+, 4.3★, 987K reviews. Hole.io (Voodoo): ~121M installs in 2025 (AppMagic/mobilegamer.biz); Play 100M+ (unverified exact bucket) | Physics satisfaction, short runs | **Medium** · 3D + physics → **r3f/babylon + a physics lib, 600 KB tier**. Procedural courses keep assets light | LB (distance/score), LS (best), sounds | **No (gap)** — Orb Cascade / Crystal Orbit are catchers, not rollers | "Going Balls"/"Hole.io" are trademarks; roll-a-ball and absorb-the-city are generic mechanics |
| 12 | **Flappy-style one-tap flyer (tap to flap through gaps)** | Flappy Bird (Dong Nguyen): ~50M downloads before removal Feb 2014; Guinness-recognised as the first app withdrawn after topping the App Store. Spawned thousands of still-live clones | Brutally simple, instantly shareable failure | **Easy** · canvas, **300 KB** | LB (score), LS (best), sounds | **Yes** (Pipe Flyer, Flappy Slay Bird, stacky birdy — **de-dupe candidates**) | "Flappy Bird" name; the green pipe art is Nintendo (Mario) trade dress — don't reuse it. FGS "Pipe Flyer" name is generic; check its pipe art isn't Mario-green |
| 13 | **Vertical doodle-jumper (auto-bounce upward, steer by tilt/tap)** | Doodle Jump (Lima Sky): Play 50M+, 3.9★, 1.09M reviews | Endless climb, one-axis control | **Easy** · canvas/kaplay, **300 KB** | LB (height), LS (best), sounds | **Partial** (PixelJump) — no polished tilt/steer jumper | "Doodle Jump" is Lima Sky's trademark and **Lima Sky has aggressively enforced the word "Doodle"**; avoid the name and the Doodler character. Mechanic is generic |
| 14 | **Timing stack / tower builder (tap to drop the next block in line)** | Stack (Ketchapp): Play 50M+, 4.1★, 446K reviews | Minimal, hypnotic, precise-tap tension | **Easy** · canvas/pixi (2D) or r3f for the 3D look, **300 KB** for 2D | LB (height/blocks), LS (best), sounds | **Partial** (Stack pack, stacky birdy) | "Stack"/"Tower Bloxx" names; drop-to-align stacking is a generic mechanic |
| 15 | **Maze-chase (eat all dots, flee/hunt roaming enemies)** | PAC-MAN 256 (Bandai Namco): Play 10M+, 4.5★, 480K reviews. PAC-MAN (1980): one of the highest-grossing arcade games ever | Instantly readable, tense pursuit AI | **Easy–Medium** · canvas, **300 KB**; the ghost/pursuit AI is the work | LB (score), LS (best), Seed (daily maze), sounds | **Yes** (Dot Muncher) | **"Pac-Man", the Pac-Man and ghost characters, and the maze layout are strongly protected** (Bandai Namco). Ship a generic muncher with an original maze, characters and name (FGS "Dot Muncher" is already generic) |

### Lower-demand arcade classics FGS already covers

These are canonical arcade mechanics with modest *current* mobile demand (mostly sub-10M-install retro ports), already live on FGS, so they rank below the table but are worth noting for completeness:

- **Asteroids-style free-flight vector shooter** — FGS **Asteroids**. Few modern mobile hits; demand is nostalgia-driven. Easy on canvas, 300 KB. Public-domain mechanic; "Asteroids" is an Atari trademark.
- **Pong / paddle** — FGS **Pong**. Easy, canvas. Generic; the name is an Atari trademark.
- **Pinball** — FGS **pinball**. Medium (physics), canvas/pixi. Generic; avoid real-table licensed art.
- **Whack-a-mole / reaction time-killer** — FGS **Whack-a-Mole, Dragon Tap, Don't Look Up, coinflip**. Easy. Generic.
- **Tank/maze shooter** — FGS **tanks** (Battle City-like). "Battle City" is Namco's; use generic tanks.
- **Dodger / avoider / catcher** — FGS **Star Dodger, AVOIDit, Apple Picking, Orb Cascade**. The hypercasual staple (cf. Color Switch). Easy, canvas.

## Arcade formats that need a new rooms primitive, or are not buildable

FGS has no realtime-rooms/multiplayer primitive today. **Single-player-vs-bots ships now** for every .io-style game and should be the default build.

| Format | Status | Why |
|---|---|---|
| Online .io arenas with real players (slither.io / Agar.io / Paper.io, 10–50 peers) | **Needs rooms primitive (local solo-vs-bots ships now)** | Real-time position/state fan-out across many peers. A WebSocket rooms primitive (~32 peers, small messages, client-authoritative) would unlock it; there is no anti-cheat without server logic |
| Full-3D endless runner at Subway Surfers / Temple Run fidelity | **Not buildable at full fidelity; 2D version ships now** | 3D character art, animation and texture assets blow past the 600 KB cap and need an art pipeline. A 2D side/lane runner is the buildable substitute |
| Full-3D hole/ball physics at Going Balls / Hole.io polish | **Buildable only as a stripped, procedural 600 KB version** | Polished versions rely on large 3D asset libraries (big-asset storage not supported); a procedural-geometry version fits the 600 KB tier but won't match on content |
| Battle-royale / server-authoritative shooters (Free Fire ~287M installs 2025, Fortnite) | **Not buildable** | 3D engine weight, large assets, authoritative server logic and matchmaking — none supported |
| Competitive global arcade leaderboards with prizes | **Casual only** | Scores are client-submitted with no server validation; keep `useLeaderboard` casual |
| Fresh daily arcade challenge pushed from a server | **Seed it instead** | No cron. A "daily run" must be generated from a client-side date seed |

## Biggest gaps vs the current FGS catalog (ranked by demand)

1. **Rhythm-runner (Geometry Dash-style)** — Geometry Dash Lite 500M+, 7.77M reviews. No FGS equivalent (Platformer is free-jump; Beat Star is a stationary lane-tapper). Medium: level design + beat-timed controls + PD music. **The single biggest arcade gap.**
2. **Territory-capture / mass-eater .io (Paper.io, Agar.io)** — Paper.io 2 100M+ (#18 US Casual now); FGS only has the worm variant. Easy as solo-vs-bots; online later needs a rooms primitive.
3. **Helix / descending-ball smash (Helix Jump, Stack Ball)** — Stack Ball 500M+ 4.8★; Helix Jump 100M+. No FGS equivalent. Medium, 600 KB 3D tier, procedural assets.
4. **Coin-collect endless runner with power-ups (Subway Surfers-like, in 2D)** — Subway Surfers 1B+, 191M in 2025. FGS has dodge-runners but no collect/power-up runner. Medium, 300 KB 2D.
5. **Rolling-ball / hole physics (Going Balls, Hole.io)** — Going Balls 100M+; Hole.io 121M in 2025. Gap. Medium, 600 KB 3D tier.
6. **Vertical doodle-jumper (Doodle Jump)** — 50M+. Only PixelJump is adjacent. Easy, 300 KB.
7. **Jetpack / hold-to-fly auto-run collector (Jetpack Joyride)** — 100M+. Partial only. Easy–Medium, 300 KB.
8. **Polished fruit/object slicer with combos and bombs (Fruit Ninja)** — 500M+. FGS slicers are basic. Medium, 300 KB.
9. **Rhythm tile-tap with PD music (Magic Tiles-style)** — 500M+, charting now. Beat Star/Cascade Keys are adjacent. Easy, 300 KB.

**Catalog hygiene flagged in passing (arcade):** the registry has heavy duplication to de-dupe — flappy clones (Pipe Flyer, Flappy Slay Bird, stacky birdy), lane-crossers (Road Hopper, Crossy School, Crossy Rivers, Endless Highway), and snake/worm (.io) entries (Snake, Slither, Slither Arena). Keep the best of each and unlist the rest. Also audit trade dress on arcade entries copied from commercial titles (pipe art, any Pac-Man/ghost art, invader sprites), per the existing Priority-0 cleanup in `README.md`.

## Sources

**Market reports and 2025 download data (AppMagic-based)**
- mobilegamer.biz, "The top mobile game downloads of 2025" (AppMagic; Subway Surfers 191m #4, Free Fire 287m, Hole.io 121m #9, Paper.io 2 102m #15): https://mobilegamer.biz/the-top-mobile-game-downloads-of-2025/
- PocketGamer.biz, "The most downloaded mobile games of 2025" (AppMagic): https://www.pocketgamer.biz/the-most-downloaded-mobile-games-of-2025
- PocketGamer.biz, "Halfbrick's Fruit Ninja hits 300 million downloads": https://www.pocketgamer.biz/halfbricks-fruit-ninja-hits-300-million-downloads/
- Sensor Tower, Geometry Dash revenue/downloads: https://sensortower.com/blog/geometry-dash-revenue
- Sensor Tower, top hyper-casual games worldwide, May 2019 (Stack Ball): https://sensortower.com/blog/top-hyper-casual-games-worldwide-may-2019-downloads

**Store charts and listings (fetched 2026-11-05)**
- Apple App Store US top-free RSS (Games 6014, Casual 7003): `https://itunes.apple.com/us/rss/topfreeapplications/limit=50/genre=6014/json` and `.../genre=7003/json` (Paper.io 2 #18, Magic Tiles 3 #19, Subway Surfers #22 in Casual)
- Google Play listings, `https://play.google.com/store/apps/details?id=<package>`, read live for: com.kiloo.subwaysurf (Subway Surfers, 1B+, 4.5★, 41.4M reviews), com.imangi.templerun2 (Temple Run 2, 1B+, 4.1★, 9.8M), com.youmusic.magictiles (Magic Tiles 3, 500M+, 4.6★, 3.57M), com.robtopx.geometryjumplite (Geometry Dash Lite, 500M+, 4.6★, 7.77M), com.halfbrick.fruitninjafree (Fruit Ninja, 500M+, 4.4★, 5.3M), air.com.hypah.io.slither (slither.io, 500M+, 3.8★, 6.54M), com.azurgames.stackball (Stack Ball, 500M+, 4.8★, 1.13M), io.voodoo.paper2 (Paper.io 2, 100M+, 3.8★, 2.54M), com.alien.shooter.galaxy.attack (Galaxy Attack, 100M+, 4.5★, 2.52M), com.yodo1.crossyroad (Crossy Road, 100M+, 4.6★, 4.57M), com.halfbrick.jetpackjoyride (Jetpack Joyride, 100M+, 4.1★, 4.73M), com.mobirix.swipebrick2 (Bricks Breaker Quest, 100M+, 4.0★, 606K), com.pronetis.ironball2 (Going Balls, 100M+, 4.3★, 987K), com.h8games.helixjump (Helix Jump, 100M+, 4.1★, 4.14M), com.lima.doodlejump (Doodle Jump, 50M+, 3.9★, 1.09M), com.ketchapp.stack (Stack, 50M+, 4.1★, 446K), eu.bandainamcoent.pacman256 (PAC-MAN 256, 10M+, 4.5★, 480K)

**Historical / IP**
- Wikipedia, *Flappy Bird* (~50M downloads; removed Feb 2014; Guinness record): https://en.wikipedia.org/wiki/Flappy_Bird
- Tuoi Tre News, Flappy Bird Guinness record / downloads: https://news.tuoitre.vn/vietnamese-app-developer-sets-guinness-record-with-now-defunct-flappy-bird-10338206.htm
- Third-party trackers (estimates, cross-checked against live Play buckets): AppGoblin Geometry Dash https://appgoblin.info/apps/com.robtopx.geometryjump · AppGoblin Crossy Road https://appgoblin.info/apps/com.yodo1.crossyroad/trends · AppGoblin Going Balls https://appgoblin.info/apps/com.pronetis.ironball2
