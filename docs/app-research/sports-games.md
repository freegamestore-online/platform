# Sports games with proven demand: market research for FreeGameStore

**Date:** 2026-11-05
**Platform:** FreeGameStore (FGS, freegamestore.online): free, open-source (MIT), no-ads, no-tracking browser games built on the `@freegamestore/games` React SDK.

## Summary

The mobile sports category is dominated by two very different things: heavy, licensed 3D simulations (EA SPORTS FC Mobile, eFootball, Dream League Soccer, NBA 2K) and **simple one-mechanic arcade-sports hits** (tap-to-shoot, flick, aim-and-power, swing-timing). FGS can only build the second kind, but that is exactly where a large, proven, evergreen audience sits. Miniclip's **8 Ball Pool** alone has **1B+ Play installs, 4.8★ and 32M reviews** and holds a Guinness record as the most-downloaded mobile pool game; it anchors a portfolio that passed 4B downloads. Arcade football is huge and generic: **Soccer Superstar** (a flick-shot penalty/skill game) shows **100M+ installs, 4.7★, 3.58M reviews**, alongside Football Strike and Head Ball 2 at 100M+ each. One-tap target and aim games travel just as well: **Archery Master 3D** 100M+ (4.4★, 925K), **Flip Diving** 100M+ (4.5★, 988K), **Dunk Shot** 10M+, **Darts of Fury** 10M+ (4.7★, 388K). Cricket is a top-tier regional driver (World Cricket Championship 2 at 100M+). Sensor Tower put US mobile **sports** revenue near **$648.8M/year** and the global sports genre around **$2.7B in 2024** (downloads declining), so the money skews to the licensed sims — but the *reach* of the arcade mechanics is what a free, client-side web game can capture.

FGS already covers a few sports classics: **Billiards** (pool), **Bowling** (Babylon 3D), **Minigolf**, **Pong**, and **Penfight** (a flick-duel). **Its biggest gaps are the proven arcade-sports leaders:** penalty/free-kick/head-to-head **football**, **basketball** free-throw/hoops/dunk, **archery / target** shooting, **cricket** batting, **darts**, **baseball** home-run swing, **tennis / table tennis** beyond Pong, and **flip-diving / trick-dunk** timing games. Almost all of these are **Easy** or **Easy-Medium** to build within the 300 KB 2D bundle cap with a `useLeaderboard` high-score/accuracy table, localStorage saves, and an optional daily date-seed challenge. Full 3D sports sims and real-time online PvP are out of scope (see the last two sections).

## Methodology

- **Google Play installs/ratings** were read directly from live Play Store listings (`play.google.com/store/apps/details?id=…`, US English) on **2026-11-05**. Play shows install *buckets* ("100M+"), so these are lower bounds. Review counts are the live figures on the listing.
- **Annual downloads, revenue and MAU** come from Sensor Tower blog/report posts, Naavik (data.ai/AppMagic data), PocketGamer.biz, developer/publisher press releases, and third-party trackers (AppGoblin). Third-party trackers disagree, sometimes by multiples. Treat all revenue/MAU and lifetime-download figures as **estimates**, and figures I could not confirm against a primary source as **unverified**.
- **Ranking** is by strength of demand evidence, favouring one-mechanic arcade-sports that fit the 300 KB bundle: lifetime install buckets of the top titles first, then breadth of 100M+ titles in the archetype, then revenue/regional signals. Ranks 1-8 are well evidenced; below that the ordering is approximate.
- **"Build"** means a solo developer could ship a solid version in days (Easy) to 1-2 weeks (Medium), using generic or public-domain mechanics, original names and original art.
- **"Already on FGS?"** was checked against the 142-game `sites/freegamestore/registry.json` catalog. "Partial" means FGS has an adjacent game but not this archetype's popular form.

### FGS primitives assumed

| Primitive | What it enables |
|---|---|
| `GameShell`, `GameTopbar`, `GameOverScreen` | Standard chrome, pause/restart, end screen |
| `useGameSounds` (+ mute policy), theme toggle | Sound effects, dark mode |
| `useAuth` (Google sign-in) | Identity for leaderboard entries (optional) |
| `useLeaderboard` (D1-backed) | Per-game score tables — ideal for high-score and **accuracy/streak** sports scoring |
| localStorage | Saves, stats, streaks, settings (per browser only; no cloud KV) |
| Daily date-seed | Deterministic "daily challenge" (wind/pin layout/target set) generated client-side |
| Bundle cap | 300 KB gzip (2D/DOM: canvas, pixi, kaplay, excalibur, littlejs); 600 KB with a heavier engine (Phaser, Babylon, 3d/r3f) |
| **Not available** | Realtime rooms/multiplayer, server compute, cron, payments, big asset storage |

Simple arcade-sports mechanics (aim, power meter, swing timing, flick) fit the 300 KB 2D tier comfortably. Full 3D sports sims do not — the one 3D sports game in the catalog (Bowling) already uses the 600 KB Babylon tier. Client-submitted leaderboards can be cheated, so score them as casual; online PvP is not possible today (see rooms section).

## Ranked archetypes

Legend: **Build** = FGS buildability (Easy = days, Medium = 1-2 weeks or physics/content-heavy). **LB** = `useLeaderboard`; **LS** = localStorage save; **Seed** = daily challenge seeded from the date; **Auth** = `useAuth`.

| Rank | Game archetype | Example top titles (installs / ratings / revenue) | Why it's popular | Build | FGS features used | Already on FGS? | IP / trademark caveats |
|---|---|---|---|---|---|---|---|
| 1 | **Pool / billiards (8-ball, trick shots)** | 8 Ball Pool (Miniclip): Play **1B+, 4.8★, 32M reviews**; Guinness record "most-downloaded mobile pool game"; anchors Miniclip's 4B+ portfolio | Physics satisfaction, quick frames, universally understood | Medium (physics tuning) | LB (vs-AI wins / trick-shot score), LS, sounds | **Yes** (Billiards) | Mechanic is generic. Avoid the name "8 Ball Pool" and Miniclip's UI/trade dress. Online PvP (the real draw) needs rooms |
| 2 | **Arcade football/soccer (penalty, free-kick, flick-shot, head-to-head)** | Soccer Superstar (Real Freestyle Soccer): Play **100M+, 4.7★, 3.58M reviews**. Football Strike (Miniclip): 100M+, 3.72M reviews. Head Ball 2 (Masomo): 100M+, 2.6M reviews. Soccer Stars (Miniclip): 100M+, 4.5★, 2.38M reviews | The world's biggest sport; a single flick/aim mechanic reads instantly and skips the full-pitch sim | Easy (flick-to-shoot / penalty) to Medium (2-player air-hockey-style "stars") | LB (score/streak), Seed (daily keeper pattern), LS, sounds | **No (gap)** | Generic mechanic + original art. **No real leagues, clubs, kits or players** (FIFA/EA FC, real national teams, named footballers). Avoid "Soccer Stars"/"Football Strike" branding. Head-to-head online needs rooms |
| 3 | **Basketball arcade (free-throw / hoops / dunk / flick-to-shoot)** | Basketball Stars: Multiplayer (Miniclip): Play **100M+, 1.75M reviews** (iOS ~4.8★). Dunk Shot (Ketchapp): Play 10M+, 4.4★, 146K reviews | One-thumb "flick the ball through the hoop", endless high-score chase, 30-second sessions | Easy | LB (high score / consecutive baskets), Seed (daily shot set), LS, sounds | **No (gap)** | Generic. **No NBA / real teams / real players** (no LeBron, no franchise logos). Avoid "Basketball Stars"/"Dunk Shot" names and Ketchapp trade dress |
| 4 | **Archery / target shooting (aim + power, moving targets)** | Archery Master 3D (TerranDroid): Play **100M+, 4.4★, 925K reviews**. Archery King (Miniclip): 20M+ downloads (developer/publisher-reported, via KRAFTON/RisingWings). Darts-adjacent aim games chart alongside | Pure skill, aim-and-release, satisfying bullseye feedback, accuracy leaderboard | Easy (2D side-on) to Medium (wind/distance tuning) | LB (accuracy / bullseye streak), Seed (daily wind+distance), LS, sounds | **No (gap)** | Generic. Avoid "Archery King"/"Archery Master" names. Olympic/"Olympics" branding is protected (IOC) — don't use it |
| 5 | **Golf / mini-golf (putting, flick, shot-power + wind)** | Golf Clash (Playdemic/EA): Play 10M+, 4.3★, 2.14M reviews; ~$789M lifetime revenue from ~64M downloads (est., Naavik/data.ai). Golf Rival (Zynga/StarLark): "2nd-largest mobile golf game", 6M downloads in 2021; studio acquired for $525M. Golf Battle (Miniclip) | Shot-power meter + aim is a deep, readable one-screen mechanic; mini-golf adds puzzle holes | Easy (top-down mini-golf / putting) to Medium (shot physics + wind) | LB (daily course time/strokes), Seed (daily hole/wind), LS, sounds | **Partial** (Minigolf exists; power-shot "clash"-style golf and putting variants missing) | Generic. **No PGA / real courses / real golfers.** Avoid "Golf Clash"/"Golf Rival" branding. Head-to-head online needs rooms |
| 6 | **Cricket (batting / tap-timing, bowling)** | World Cricket Championship 2 (Nextwave): Play **100M+, 3.7★, 3.36M reviews**. WCC3: 10M+, 4.3★, 552K reviews. Stick Cricket Classic (Stick Sports): 10M+, 4.4★, 238K reviews ("over a billion game plays") | Massive demand in India/South Asia; a timing-based "tap to bat" mini-mode is simple and addictive | Easy (tap-timing batting / Stick-Cricket-style) to Medium (fuller match) | LB (runs / high score), Seed (daily over), LS, sounds | **No (gap)** | Generic. **No real leagues/teams/players** (no IPL, no national teams, no named cricketers). Avoid "Stick Cricket"/"WCC" branding |
| 7 | **Darts** | Darts of Fury (Yakuto): Play **10M+, 4.7★, 388K reviews**. Darts Club (BoomBit): 10M+ | Aim + a little physics, clean 501/cricket rulesets, quick turns, strong pub-game nostalgia | Easy | LB (checkout / high score / 180s), Seed (daily board), LS, sounds | **No (gap)** | Darts and 501/cricket rules are public domain. Avoid "Darts of Fury"/"Darts Club" names |
| 8 | **Flip diving / trick-dunk / backflip (ragdoll trick-timing)** | Flip Diving (MotionVolt): Play **100M+, 4.5★, 988K reviews**; Flip Diving + Flip Master passed 75M combined downloads ~13 months in; Flip Diving alone hit 40M by Feb 2017 (20B dives) | Timing taps to chain flips/twists, "one more go" risk-reward, instantly shareable fails | Medium (2D ragdoll/physics + timing) | LB (high score / best combo), Seed (daily platform), LS, sounds | **No (gap)** | Generic trick-timing mechanic. Use original ragdoll art; avoid "Flip Diving"/"Flip Master" names |
| 9 | **Tennis / table tennis (swing + aim, beyond Pong)** | Stick Tennis (Stick Sports): Play 10M+, 4.0★, 179K reviews. Mini Tennis: Perfect Smash (Miniclip): 5M+, 4.5★, 57.7K reviews. Tennis Clash (Wildlife): iOS weekly revenue ~$102K peak in Q3 2025 (Sensor Tower, US iOS) | Simple timed-swing + placement; a step up from the bare Pong paddle already in the catalog | Easy (arcade swing / timing) to Medium (rally AI) | LB (rally length / match wins), LS, sounds | **Partial** (Pong only; swing-timing tennis / ping-pong missing) | Generic. **No real tournaments/players** (no Wimbledon, no named pros). Avoid "Tennis Clash"/"Stick Tennis" branding |
| 10 | **Baseball home-run / batting (swing-timing, Home Run Derby)** | Super Hit Baseball (Fresh Build/Habby): Play 1M+, 4.3★, 54.7K reviews (iOS ~4.7★, 70.9K reviews). Baseball Boy! (Voodoo): arcade home-run-derby hit (install count not published) | One-button swing timing + upgrade loop; Home-Run-Derby format is pure arcade | Easy | LB (distance / home-run streak), Seed (daily pitch set), LS, sounds | **No (gap)** | Generic. **No MLB / real teams / real players.** "Yankees"/"MLB" and club logos are off-limits. Avoid "Super Hit Baseball"/"Baseball Boy" names |
| 11 | **Bowling (aim + power + spin)** | 3D Bowling (Italy Games): Play **100M+, 4.7★, 1.15M reviews**. Bowling King (Miniclip): ~29M downloads (Miniclip milestone, 2022) | Aim-and-roll with spin; forgiving, satisfying 10-pin scoring; broad age appeal | Easy (2D top-down) to Medium (3D, 600 KB tier) | LB (high game / strike streak), LS, sounds | **Yes** (Bowling — Babylon 3D, full 10-frame scoring) | Generic. Avoid "Bowling King" branding and the PBA (Professional Bowlers Association) name/marks |
| 12 | **Boxing / arcade combat-sport** | Boxing Star (FourThirtyThree): long-running Play/App Store sports title (live install bucket **unverified** — package not confirmed this pass; iOS App Store id 1241887528). Punch-Hero-style one-tap boxing is an established arcade format | Timing dodge/jab/combo loop; quick rounds; upgrade progression | Medium (hit-timing + simple AI) | LB (KO time / win streak), LS, sounds | **No (gap)** | Generic. Avoid "Boxing Star" branding; **no real boxers, promotions or sanctioning bodies** (no named fighters, no "WBC"). Install figures here are **unverified** |
| 13 | **Curling / shuffleboard / lawn bowls (slide-and-aim)** | Niche but evergreen slide-to-target format; FGS's own **Penfight** (flick-a-pen duel) proves the slide/flick duel reads well. Dedicated curling/shuffleboard apps are small (sub-1M typically) — **demand here is weaker/unverified** | Low-skill-floor aim-and-slide, good for daily-target and 2-player hot-seat | Easy | LB (closest-to-target / high score), Seed (daily layout), LS, sounds, local hot-seat | **Partial** (Penfight is a flick-duel; curling/shuffleboard target variant missing) | Generic/public-domain sports. Avoid Olympic ("curling at the Olympics") branding |

## Online-PvP sports that would need a new realtime-rooms primitive on FGS

FGS has no rooms/multiplayer primitive today. **Single-player high-score chase, vs-AI, and local hot-seat all work now** for every archetype above and should ship first — the online head-to-head mode is what the big titles monetise and what waits on a platform update. A WebSocket rooms primitive (the FAS repo already runs a Durable-Object room: ~32 peers, ~4 KB messages, host- or client-authoritative) would unlock the online versions.

| Archetype | Why it needs rooms | Demand signal | Notes |
|---|---|---|---|
| 8-ball pool online | Shot sync between players | 8 Ball Pool 1B+ Play | Send the shot vector; both clients simulate deterministically |
| Head-to-head football/basketball/tennis | Live 1v1 matches | Basketball Stars 100M+; Head Ball 2 100M+; Football Strike 100M+ | Short real-time sessions; client-authoritative is fine for friends, not strangers (no server anti-cheat) |
| Darts / golf / archery vs a friend | Turn-based duels, shared target | Darts of Fury 10M+; Golf Clash 10M+ | Turn-based, tiny messages — the cheapest online target |
| Cricket 1v1 | Bat vs bowl between two players | WCC2 100M+ | Turn-based |

Until rooms exist, ship these as **score-chase + vs-AI + hot-seat**, which the SDK already supports.

## Not buildable on FGS (and why)

| Category | Examples (demand) | Blocker |
|---|---|---|
| Full 3D licensed football sims | EA SPORTS FC Mobile 27: Play 500M+, 4.6★, 23.4M reviews. eFootball: 100M+, 4.1★, 19.1M reviews. Dream League Soccer 2026: 100M+, 4.5★, 15.2M reviews | Licensed IP (FIFPro players, real clubs/leagues) **and** 3D engine + asset size far beyond the 600 KB tier; art/animation pipeline |
| Licensed console-style sports | NBA 2K Mobile, MLB The Show/Tap Sports, Madden NFL Mobile, EA SPORTS PGA/golf sims | Trademark/licensing (leagues, teams, athletes) + heavy 3D assets. The *mechanics* (hoops, batting, putting) are fine under original branding — that's what the arcade rows above capture |
| Real-money / cash-tournament sports | Skill-based cash pool/darts apps | Payments not supported; skill-gaming/gambling regulation; contradicts FGS's free, no-monetisation model |
| Live-ops card-collector sports | FIFA/FC Ultimate-Team-style collectors, NBA/MLB card games | Server-side economy, events, payments, licensed player cards |
| Big 3D physics sports (realistic) | Realistic 3D golf-swing sims, 3D skateboarding/parkour at full fidelity | Asset size and 3D engine weight beyond 600 KB. A stylised 2D/low-poly arcade version can still fit |
| Real-time ranked PvP with server authority | Any competitive matchmaking ladder with prizes | Needs authoritative server logic + matchmaking, which FGS doesn't support |
| Geo/venue or Street-View-based sports | — | Requires licensed map/imagery APIs |

## Biggest gaps vs the current FGS catalog (ranked by demand)

1. **Arcade football/soccer** — penalty / free-kick / flick-shot / head-to-head (Soccer Superstar 100M+ 3.58M reviews; Football Strike, Head Ball 2, Soccer Stars 100M+ each). The single biggest sports gap. Easy-Medium.
2. **Basketball arcade** — free-throw / hoops / dunk flick (Basketball Stars 100M+; Dunk Shot 10M+). Easy.
3. **Archery / target shooting** (Archery Master 3D 100M+; Archery King 20M+). Easy-Medium.
4. **Cricket** batting/tap-timing (WCC2 100M+; Stick Cricket "over a billion plays") — huge South-Asia demand. Easy-Medium.
5. **Darts** (Darts of Fury 10M+ 4.7★; Darts Club 10M+). Easy.
6. **Flip diving / trick-dunk** timing (Flip Diving 100M+). Medium.
7. **Baseball home-run / batting** (Super Hit Baseball; Baseball Boy). Easy.
8. **Tennis / table tennis** beyond Pong (Stick Tennis 10M+; Mini Tennis 5M+; Tennis Clash). Easy-Medium — upgrades the existing `Pong`.
9. **Golf power-shot / putting** (Golf Clash ~$789M lifetime est.; Golf Rival) — extends the existing `Minigolf`. Easy-Medium.
10. **Boxing / arcade combat-sport** (Boxing Star) — Medium; demand solid but live figures unverified this pass.
11. **Curling / shuffleboard / lawn-bowls** slide-to-target — Easy; mid/low demand, extends `Penfight`'s flick-duel idea.

**Catalog hygiene flagged in passing:** the existing FGS **Bowling**, **Billiards**, **Minigolf**, **Pong** and **Penfight** entries use generic/original names and look clear. Any new sports game must use **original names, art and crowd/kit designs** and must not reference real leagues, clubs, venues or athletes (NBA, EA FC/FIFA, MLB, PGA, IPL, named players). The Olympic rings/word "Olympic(s)" are protected marks (IOC) — avoid them even descriptively in titles.

## Sources

**Live Google Play listings (fetched 2026-11-05, US English), `https://play.google.com/store/apps/details?id=<package>`:**
- com.miniclip.eightballpool (8 Ball Pool — 1B+, 4.8★, 32M reviews)
- com.soccer.score.star (Soccer Superstar — 100M+, 4.7★, 3.58M reviews)
- com.miniclip.footballstrike (Football Strike — 100M+, 3.72M reviews)
- com.masomo.headball2 (Head Ball 2 — 100M+, 2.6M reviews)
- com.miniclip.soccerstars (Soccer Games: Soccer Stars — 100M+, 4.5★, 2.38M reviews)
- com.miniclip.basketballstars (Basketball Stars: Multiplayer — 100M+, 1.75M reviews)
- com.ketchapp.dunkshot (Dunk Shot — 10M+, 4.4★, 146K reviews)
- com.junerking.archery (Archery Master 3D — 100M+, 4.4★, 925K reviews)
- com.playdemic.golf.android (Golf Clash — 10M+, 4.3★, 2.14M reviews)
- com.nextwave.wcc2 (World Cricket Championship 2 — 100M+, 3.7★, 3.36M reviews)
- com.nextwave.wcc3 (World Cricket Championship 3 — 10M+, 4.3★, 552K reviews)
- com.sticksports.stickcricket (Stick Cricket Classic — 10M+, 4.4★, 238K reviews)
- uk.co.yakuto.DartsOfFury (Darts of Fury — 10M+, 4.7★, 388K reviews)
- com.motionvolt.flipdiving (Flip Diving — 100M+, 4.5★, 988K reviews)
- air.com.sticksports.sticktennis (Stick Tennis — 10M+, 4.0★, 179K reviews)
- com.miniclip.minitennis (Mini Tennis: Perfect Smash — 5M+, 4.5★, 57.7K reviews)
- com.offfgames.android.free.baseballbattle (Super Hit Baseball — 1M+, 4.3★, 54.7K reviews)
- com.threed.bowling (3D Bowling — 100M+, 4.7★, 1.15M reviews)
- com.firsttouchgames.dls7 (Dream League Soccer 2026 — 100M+, 4.5★, 15.2M reviews)
- com.ea.gp.fifamobile (EA SPORTS FC Mobile 27 — 500M+, 4.6★, 23.4M reviews)
- jp.konami.pesam (eFootball — 100M+, 4.1★, 19.1M reviews)

**Market reports and download/revenue data**
- Sensor Tower: US mobile sports games ~$648.8M annual revenue: https://gamedevreports.substack.com/p/sensor-tower-mobile-sports-games · https://wnhub.io/news/analytics/item-18818
- Mapendo, mobile game trends 2025 (sports genre ~$2.7B global 2024, downloads declining): https://mapendo.co/blog/mobile-games-trends-in-2025
- Sensor Tower State of Gaming 2026 recap (strategy the only genre to grow revenue+downloads+time in 2025; ~50.4B game downloads, ~$81.8B revenue): https://gamedevreports.substack.com/p/sensor-tower-state-of-gaming-2026 · https://www.pocketgamer.biz/over-95000-mobile-games-were-downloaded-every-minute-in-2025
- Sensor Tower Q2 2025 US top-5 golf games (Golf Clash / Golf Rival / Golf Battle weekly rev/DAU): https://sensortower.com/blog/2025-q2-unified-top-5-golf%20games-revenue-us-602f92d4241bc16eb881361f
- Sensor Tower Q3/Q4 2025 top-5 tennis games (Tennis Clash iOS ~$102K/wk peak): https://sensortower.com/blog/2025-q3-ios-top-5-tennis%20games-units-us-602a7698241bc16eb85cd5bb
- Naavik, "The Turf War Between Golf Clash & Golf Rival" (Golf Clash ~$789M lifetime / ~64M downloads, est., data.ai): https://naavik.co/deep-dives/the-turf-war-between-golf-clash-golf-rival/
- Sensor Tower, 8 Ball Pool revenue history: https://sensortower.com/blog/8-ball-pool-revenue
- PocketGamer.biz, Miniclip exceeds 4 billion downloads (8 Ball Pool >1B; Soccer Stars 57M; Bowling King 29M; Flip Diving 15M; Agar.io 113M): https://www.pocketgamer.biz/miniclip-exceeds-4-billion-downloads/ · https://wnhub.io/news/marketing/item-4472
- PocketGamer.biz, Flip Diving + Flip Master 75M combined downloads: https://www.pocketgamer.biz/flip-diving-and-flip-master-75-million-downloads/
- GamesBeat, Zynga acquires StarLark (Golf Rival) for $525M ("2nd-largest mobile golf game", 6M downloads in 2021): https://gamesbeat.com/zynga-acquires-starlark-studio-and-golf-rival-game-for-525m/
- AFK Gaming, Archery King early access for India (KRAFTON/RisingWings; "more than 20 million downloads"): https://afkgaming.com/gaming/general/archery-king-early-access-announced-for-india-by-krafton-and-risingwings

**Third-party trackers (estimates — used only where live Play data was unavailable)**
- AppGoblin, Archery Master 3D (com.junerking.archery): https://www.appgoblin.info/apps/com.junerking.archery
- AppGoblin, Darts of Fury (uk.co.yakuto.DartsOfFury): https://appgoblin.info/apps/uk.co.yakuto.DartsOfFury
- App Pricing Lab, Super Hit Baseball iOS (~4.7★, 70.9K reviews): https://apppricinglab.com/app/apple/1473199423
- Boxing Star (FourThirtyThree), Apple App Store id 1241887528: https://apps.apple.com/us/app/boxing-star/id1241887528
- Darts Club (BoomBit, 10M+) and Baseball Boy (Voodoo) referenced via TouchArcade/BlueStacks listings: https://toucharcade.com/games/super-hit-baseball-game · https://www.bluestacks.com/apps/arcade/baseball-boy-on-pc.html

**IP / trademark**
- IOC protection of Olympic marks (words/rings): https://olympics.com/ioc/olympic-brand
- Miniclip 8 Ball Pool Guinness World Record (most-downloaded mobile pool game) reported in: https://www.pocketgamer.biz/miniclip-exceeds-4-billion-downloads/
