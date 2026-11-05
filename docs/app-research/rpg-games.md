# RPG & progression games with proven demand: market research for FreeGameStore

**Date:** 2026-11-05
**Platform:** FreeGameStore (FGS, freegamestore.online): free, open-source (MIT), no-ads, no-tracking browser games built on the `@freegamestore/games` React SDK.

## Summary

RPG and progression mechanics are the most monetised part of mobile gaming, but the money and the *buildability* sit in different places. By revenue the genre is dominated by server-driven, gacha, live-ops titles that FGS cannot build: AppMagic data (via PocketGamer.biz) put H1 2025 RPG player spend at about **$9.3B** (down ~11% YoY from $10.4B), and in 2025 **strategy overtook RPG** as the top-grossing genre (AppMagic ~$10.6B H1; Sensor Tower had already called RPG "dethroned for the first time since 2017" back in Q2 2024). RPG still takes nearly half of all game spend in Japan and South Korea. Those leaders — AFK Arena ($1.5B lifetime, AppMagic est.), AFK Journey, Genshin Impact, Honkai: Star Rail, Legend of Mushroom, Whiteout Survival — are **gacha / live-ops / big-3D-asset** games that need payments, a server economy and asset libraries FGS does not support.

The opportunity for a client-side, no-monetisation web store is the **mechanic-only, single-player progression loop**: idle/incremental "numbers go up", survivor-like auto-attack roguelites, procedural roguelike dungeon crawlers, single-player roguelike deckbuilders, tower-defense-RPG hybrids, virtual-pet raisers, choose-your-own-adventure, auto-battlers, grid tactics, and merge-to-power-up. These have real demand (Survivor.io ~47–52M Play installs and $500M+ lifetime IAP; Soul Knight ~93M installs; Rush Royale ~57M installs; Episode ~177M installs; My Talking Tom 2 ~122M downloads in 2025) and run entirely in the browser with localStorage saves, date-seeds and the D1 leaderboard.

FGS already has a toe in this water — **Cat Clicker** (clicker), **Survive** (survival), **DigiCritter / monster attack / fish life / The Cycle Of Life** (pet-care), and **Royal Heist** (a push-your-luck card battler) — but no idle/incremental RPG with offline growth, no survivor-like, no roguelike dungeon crawler, no deckbuilder-roguelike, no tower defense, no CYOA, no auto-battler and no grid tactics. Those are the gaps, and almost all are Easy–Medium within the bundle caps.

## Methodology

- **Install / rating figures** here are mostly **third-party tracker estimates** (AppBrain's install buckets and AppGoblin's modelled counts), cross-checked against press reports and store listings where possible. Unlike the live-Play-listing reads in [simple-games.md](simple-games.md), the Google Play pages could not be machine-read cleanly this session (heavy client-side rendering), so these are labelled as estimates and treated as lower bounds. Trackers disagree, sometimes by multiples.
- **Revenue and lifetime figures** come from AppMagic (via PocketGamer.biz / mobilegamer.biz), Sensor Tower blog posts, Naavik, developer/publisher press releases (MY.GAMES, Lilith) and analyst notes. All are **estimates** unless a developer stated them.
- **Download rankings** (e.g. "My Talking Tom 2 — 122M in 2025") are AppMagic 2025 figures reported by mobilegamer.biz, rounded to the nearest million.
- **"Buildable"** is judged against FGS's constraints (below). "Numbers go up" and procedural content are favoured over asset-heavy worlds.
- **Ranking** is by strength of demand evidence combined with how cleanly the loop fits a client-side web build. Ranks 1–7 are well evidenced; below that the ordering is approximate.
- **"Already on FGS?"** was checked against the 142-game `sites/freegamestore/registry.json`. "Partial" means FGS has an adjacent game but not this progression loop.

### FGS primitives & constraints assumed

| Primitive | What it enables |
|---|---|
| `GameShell`, `GameTopbar`, `GameOverScreen` | Standard chrome, pause/restart, end screen |
| `useGameSounds`, theme toggle | Sound effects, dark mode |
| `useAuth` (Google sign-in, optional) | Identity for leaderboard entries |
| `useLeaderboard` (D1-backed) | Per-game score tables (depth reached, waves survived, prestige level) |
| localStorage | Saves, progress, stats, **offline/idle progress via client timestamp diff** (per browser only; no cloud save) |
| Daily date-seed | Deterministic daily dungeon / daily run / daily puzzle on the client |
| Engines | canvas, grid/cards (DOM), kaplay, phaser, pixi, 3d/r3f, babylon, excalibur, littlejs |
| Bundle cap | **300 KB** gzip for 2D/DOM; **600 KB** with a heavy engine (Phaser/Pixi/3D) |
| **Not available (blockers)** | realtime rooms / multiplayer, server compute, cron, **payments**, big-asset storage, cloud save |

Consequences for RPGs: **gacha / live-ops economies are not buildable** (they need payments + a server-authoritative economy). **Big-content / big-asset RPGs** (open-world 3D, voiced JRPGs, thousands of hand-made levels) do not fit the bundle. Offline/idle growth is fine because it can be computed from a client timestamp diff (cheatable, acceptable for a free solo build). Leaderboards are client-submitted, so keep them casual.

## Ranked archetypes

Legend: **Build** = FGS buildability (Easy = days, Medium = 1–2 weeks or content-heavy). **LB** = `useLeaderboard`; **LS** = localStorage save; **Idle** = offline progress via timestamp diff; **Seed** = daily run seeded from the date; **Auth** = `useAuth`.

| Rank | Game archetype | Example top titles (installs / ratings / revenue — estimates) | Why it's popular | Build | FGS features used | Already on FGS? | IP / trademark caveats |
|---|---|---|---|---|---|---|---|
| 1 | **Idle / incremental RPG ("numbers go up", offline growth)** | Tap Titans 2 (Game Hive): Play 10M+ bucket, 4.6★, ~1.07M reviews; AppGoblin ~20M installs. AdVenture Capitalist (Hyper Hippo): ~22M installs (AppGoblin, cross-platform), 4.5★ ~1.6M ratings. Legend of Slime (LoadComplete): AppGoblin ~18.2M installs, ~177K ratings | Progress continues while away; one-more-upgrade dopamine; no reflexes needed | Easy (loop) → Medium (balancing the curve) | LS (progress), **Idle** (offline earnings by timestamp diff), LB (prestige level), sounds | **Partial** (Cat Clicker is a clicker; Survive exists; no deep incremental-RPG with offline growth) | Generic mechanic. Offline progress is client-side (cheatable, fine for solo). Don't clone a specific game's upgrade art/names |
| 2 | **Survivor-like / bullet-heaven (auto-attack action roguelite)** | Survivor.io (Habby): AppGoblin ~47–52M installs, ~1.1M ratings, 4.5★; **$500M+ lifetime IAP by mid-2024, ~$5–6M/month** (industry est.). Archero (Habby): Play 50M+ bucket, 4.3★, ~1.7M ratings; Archero 2 (Jan 2025) ~$8M IAP in first 11 days. Vampire Survivors mobile (poncle): 1M+ downloads in first week (dev) | Auto-attacking means one-thumb play; build-a-synergy runs; huge 2024–25 subgenre | Medium (needs a heavy 2D engine — Pixi/Phaser/kaplay — and spawn/upgrade tuning; fits 600 KB tier) | LS (meta-upgrades), Seed (daily run), LB (survival time / wave), sounds | **No (gap)** (Star Dodger / Neon Runner are dodge-only, not auto-attack roguelites) | Generic mechanic. Avoid "Survivor.io"/"Vampire Survivors" names and specific weapon-evolution art |
| 3 | **Roguelike dungeon crawler (procedural, turn-based, tile/ASCII)** | Soul Knight (ChillyRoom): AppGoblin ~93M installs, ~1.7M ratings (action-roguelike). Shattered Pixel Dungeon: Play **5M+** bucket (AppBrain, Jan 2026), listed under Role Playing — and it is **open-source** | Infinite procedural replay from a tiny codebase; "just one more run"; classic form factor | Easy–Medium (procedural gen + turn loop in DOM/canvas; ASCII/tile keeps assets ~0) | LS (run in progress, meta-unlocks), Seed (daily seeded dungeon), LB (depth / score), sounds | **No (gap)** (Maze Racer is a maze, not a roguelike) | Mechanics are generic. Shattered Pixel Dungeon is GPL (copyleft) — study it, don't copy its code into an MIT repo. Original tiles/names |
| 4 | **Tower-defense RPG hybrid (upgradable heroes + towers, level map)** | Rush Royale (MY.GAMES): AppGoblin ~57M installs, ~754K ratings, 4.2★; **$500M lifetime revenue** (publisher). Kingdom Rush (Ironhide): AppGoblin ~28M installs, ~841K ratings, ~4.7★. Bloons TD 6 (Ninja Kiwi, paid): Play 5M+, 4.78★, ~387K reviews | Strategic depth + visible progression; replayable waves; strong on web | Medium (pathfinding, waves, upgrade trees; 2D/DOM or Pixi) | LS (level progress, hero upgrades), LB (endless wave), Seed (daily map), sounds | **No (gap)** (monster attack is "protect your pet", not a TD progression loop) | Generic mechanic. Avoid "Kingdom Rush"/"Bloons" art and specific tower designs |
| 5 | **Virtual pet / creature raiser (care + stat growth + idle)** | My Talking Tom 2 (Outfit7): **122M downloads in 2025** (AppMagic via mobilegamer.biz). Grim Soul-style and Tamagotchi-lineage care loops remain evergreen | Nurture loop + daily check-in habit; broad/young audience; idle-friendly | Easy (stats, timers, cosmetics; DOM/canvas or kaplay) | LS (pet state), **Idle** (hunger/growth by timestamp diff), Seed (daily care bonus), sounds | **Partial** (DigiCritter, monster attack, fish life, The Cycle Of Life all exist; none is a deep stat-growth/evolution RPG) | Generic. Avoid "Talking Tom"/"Tamagotchi"/"Pou" characters; original creature art |
| 6 | **Single-player roguelike deckbuilder (Slay-the-Spire-like)** | Slay the Spire mobile (paid $9.99): AppGoblin ~1.6M installs, ~29K ratings. Slay the Spire 2 called **best-performing deckbuilder ever** — Steam ~4.6M copies / ~$92M in 14 days (analyst/press, 2026). Roguelike genre ~$400M Steam revenue in 2025, +80% YoY. Meteorfall: Journeys ~100K Play installs | Deep build-a-deck runs; high replay from a small content set; cult following | Medium (card logic is light; the *content* — cards, relics, enemies, encounters — is the work) | LS (run state, unlocks), Seed (daily seeded run), LB (score / ascension), sounds | **Partial** (Royal Heist is a push-your-luck card battler, not a run-based deckbuilder with a card pool) | **Do not copy Slay the Spire's cards, relics, art or "Spire" name** — specific card sets and art are copyrightable. The build-a-deck roguelike *mechanic* is generic; author original cards |
| 7 | **Text / choice adventure (CYOA, branching story)** | Episode (Pocketgems): AppGoblin ~177M installs. Choices: Stories You Play (Pixelberry): AppGoblin ~61M installs. Reigns (Devolver): 4M+ players (dev), card-swipe choices | Pure text/UI = tiny bundle; strong retention from serialized stories; broad demographics | Easy (engine) → the writing is the work | LS (progress, flags, saves), Seed (daily dilemma), sounds | **No (gap)** | Mechanic is generic. Content must be original (no fan-fiction of licensed IP). Reigns' swipe-left/right framing is fine as a generic UI |
| 8 | **Active clicker-RPG (tap-to-attack hero, prestige resets)** | Overlaps idle (#1): Tap Titans 2 (Play 10M+, 4.6★) is the archetype — tap to damage, auto-heroes, prestige. Clicker Heroes lineage on web is large | Tactile, instant feedback; prestige loop; works great with mouse/touch | Easy | LS (gold, heroes, prestige), **Idle** (DPS while away), LB (max stage), sounds | **Partial** (Cat Clicker is a clicker; not an RPG with hero upgrades + prestige) | Generic. Don't reuse a specific game's hero roster/art |
| 9 | **Single-player auto-battler (draft units, auto-resolve rounds)** | Super Auto Pets (Team Wood): free, cross-platform, plays vs AI teams when no player pool; popular PvE/async format. Backpack Battles (paid $9.99): inventory-builder auto-battler, strong 2025 buzz | Think-then-watch; low APM; synergy puzzle; FGS can run the PvP-free PvE version | Medium (unit/synergy data + deterministic combat resolver; DOM/cards) | LS (progress, unlocks), Seed (daily shop seed), LB (win streak), sounds | **No (gap)** | Generic mechanic. Original units/art; avoid "Super Auto Pets"/"Backpack Battles" naming |
| 10 | **Turn-based tactics on a grid (SRPG skirmish)** | The commercial leaders (Arknights, Fire Emblem Heroes, AFK-style) are gacha; the *mechanic* (grid, action points, terrain, class triangle) is a proven evergreen with strong indie/web demand | Chess-like depth with RPG flavour; deterministic; readable on a grid | Medium (AI + grid rules + a set of maps/units) | LS (campaign progress), Seed (daily skirmish), LB (turns / score), sounds | **No (gap)** | Mechanics generic. Avoid "Fire Emblem"/"Final Fantasy Tactics" units and names; original sprites or shapes |
| 11 | **Merge-to-power-up RPG (merge units/weapons to level the hero)** | Merge is one of the biggest casual subgenres; in RPG form it powers Legend of Mushroom (idle+merge, topped 2024 download charts per data.ai, Play 4.2★) and many "merge weapon / merge archer" hybrids | Satisfying tactile merging + visible power growth; very learnable | Easy–Medium (merge grid + combat is light; **big live-ops versions are content-heavy — flag those**) | LS (board, hero level), **Idle**, LB, sounds | **No (gap)** | Generic merge mechanic. The large titles layer gacha/live-ops (not buildable); ship the single-player merge-growth loop only |
| 12 | **Survival-craft-lite (gather / craft / defend, single biome)** | Grim Soul: Dark Survival RPG (Kefir/Brickworks): 25M+ downloads worldwide (Apple listing, all-platform), Play 10M+ bucket. Broad survival-craft demand, but the hits are large | Gather → craft → upgrade → survive loop; strong retention | Medium — **buildable only as a lite, single-biome version**; full survival-craft is asset/scope heavy (flag) | LS (inventory, base, day count), **Idle** (resource regen), LB (days survived), sounds | **Partial** (Survive exists; not a craft/upgrade progression) | Generic. Avoid licensed survival IP; keep the asset set tiny to fit the bundle |
| 13 | **AFK / auto-combat idle RPG (non-gacha "hero grows while idle")** | The category leaders are gacha (AFK Arena $1.5B lifetime; AFK Journey) — **the monetised version is not buildable** — but the *non-gacha auto-combat idle loop* (equip, auto-fight, stage up, idle rewards) is a valid client-side build | "Set it and check back" + gear/stage progression; low effort, high retention | Easy–Medium | LS (hero, gear, stage), **Idle** (AFK rewards by timestamp), LB (max stage), sounds | **No (gap)** | Build the loop **without gacha/paid summons** (those need payments + server). Original heroes/art |

## Not buildable on FGS (and why)

The highest-revenue RPG types are exactly the ones FGS's constraints rule out. Flag these clearly so the public ideas list doesn't raise them:

| Category | Examples (demand) | Blocker |
|---|---|---|
| **Gacha hero-collector / idle gacha RPG** | AFK Arena ($1.5B lifetime, AppMagic est.), AFK Journey (~$128M IAP + ~12M downloads early), Legend of Mushroom, Idle Heroes, Watcher of Realms | Gacha summons = **payments + server-authoritative economy + anti-fraud**; big character-art libraries. None available on FGS. The non-gacha idle loop (#13) is the buildable subset |
| **Open-world / 3D action RPG** | Genshin Impact, Honkai: Star Rail, Wuthering Waves, Diablo Immortal | Multi-GB 3D asset worlds + server accounts; orders of magnitude beyond the 600 KB bundle cap |
| **MMORPG / online co-op dungeon** | Diablo Immortal, Soul Knight co-op, most "online RPG" titles | Needs realtime rooms / server-authoritative multiplayer (no FGS primitive) |
| **Live-ops survival-strategy RPG (4X-adjacent)** | Whiteout Survival, Last War: Survival, Kingshot | Server economy, alliances, events, payments; strategy overtook RPG as top-grossing genre in 2025 on exactly these |
| **Big-content story / JRPG** | Classic turn-based JRPGs, voiced narrative RPGs | Large art/audio/script asset libraries; won't fit the bundle. A *text* adventure (#7) is the asset-free alternative |
| **Merge-2 / live-ops story RPG at content scale** | Legend of Mushroom's full live-ops layer, merge-story hybrids | Live events + large asset/story libraries + payments. Only the single-player merge loop (#11) fits |
| **Any RPG with real-money, loot boxes, or energy-for-cash** | — | Payments not supported, and it contradicts FGS's free / no-monetisation / no-tracking model |

**Also note:** offline/idle growth and leaderboards are **client-trusted** on FGS (no server validation). That is fine for free, casual progression games, but these archetypes can never run competitive ranked ladders or anti-cheat economies. Keep leaderboards casual, and never attach rewards to them.

## Biggest gaps vs the current FGS catalog (ranked by demand × buildability)

1. **Idle / incremental RPG with offline growth** (Tap Titans 2 10M+; AdVenture Capitalist ~22M). Easy. FGS has a clicker (Cat Clicker) but no offline-growth incremental RPG.
2. **Survivor-like / bullet-heaven** (Survivor.io ~47–52M installs, $500M+ IAP; Archero 50M+). Medium (600 KB tier). A top-5 2024–25 action subgenre with zero FGS presence.
3. **Roguelike dungeon crawler** (Soul Knight ~93M; Shattered Pixel Dungeon 5M+). Easy–Medium, tiny assets, infinite replay, daily-seed friendly.
4. **Tower-defense RPG hybrid** (Rush Royale ~57M, $500M lifetime; Kingdom Rush ~28M). Medium.
5. **Single-player roguelike deckbuilder** (Slay the Spire 2 = best-performing deckbuilder ever; roguelike +80% on Steam in 2025). Medium — content is the work; Royal Heist is only adjacent.
6. **Virtual-pet / creature-raiser with real stat growth** (My Talking Tom 2 122M downloads 2025). Easy — upgrade the existing pet games (DigiCritter etc.) into a growth loop.
7. **Text / choice adventure (CYOA)** (Episode ~177M, Choices ~61M). Easy engine, tiny bundle; the writing is the cost.
8. **Single-player auto-battler** (Super Auto Pets). Medium. No FGS presence.
9. **Turn-based grid tactics (SRPG)** (evergreen mechanic). Medium.
10. **Merge-to-power-up RPG** (Legend of Mushroom lineage). Easy–Medium — single-player loop only.
11. **AFK / auto-combat idle RPG, non-gacha** (bridges the gacha leaders into a buildable loop). Easy–Medium.
12. **Survival-craft-lite** (Grim Soul 10M+ Play). Medium, single-biome only; extend Survive.

## Sources

**Genre-level market data**
- mobilegamer.biz, "The top mobile game downloads of 2025" (AppMagic data; My Talking Tom 2 122M, Snake Clash 104M, etc.): https://mobilegamer.biz/the-top-mobile-game-downloads-of-2025/
- PocketGamer.biz, "Strategy games surge as RPG revenue tumbles — H1 2025's top genres" (AppMagic; RPG ~$9.3B H1 2025, down ~11% YoY; strategy ~$10.6B): https://www.pocketgamer.biz/strategy-games-surge-as-rpg-revenue-tumbles-h1-2025s-top-genres-revealed
- wnhub.io, "RPG dethroned as top-grossing genre for first time since 2017" (Sensor Tower, Q2 2024; ~half of JP/KR spend): https://wnhub.io/news/analytics/item-44402
- Sensor Tower State of Gaming 2026 (mobile gaming $81.8B in 2025; gaming $94B revenue / 52B downloads): https://gamedevreports.substack.com/p/sensor-tower-state-of-gaming-2026
- Statista, "Top grossing mobile RPG games worldwide 2025": https://www.statista.com/statistics/1615479/rpg-apps-top-grossing

**Idle / incremental / clicker RPG**
- AppGoblin, Tap Titans 2: Clicker Idle RPG (~20M installs, ~1.1M ratings, 4.62★): https://appgoblin.info/apps/com.gamehivecorp.taptitans2
- App Pricing Lab, Tap Titans 2 (Play 10M+ bucket, 4.6★, ~1.1M reviews): https://www.apppricinglab.com/app/google_play/com.gamehivecorp.taptitans2
- AppGoblin, Legend of Slime: Idle RPG War (~18.2M installs, ~177K ratings): https://appgoblin.info/apps/com.loadcomplete.slimeidle/trends
- Sensor Tower, AdVenture Capitalist revenue (and ~33.6M all-time downloads, 2018 est.): https://sensortower.com/blog/adventure-capitalist-revenue
- AppGoblin, AdVenture Capitalist (~22M installs, 4.5★ ~1.6M ratings): https://appgoblin.info/apps/927006017/trends

**Survivor-like / action roguelite**
- mobilegamer.biz, "Two months in, Survivor.io passes $75m from 37m downloads": https://mobilegamer.biz/two-months-in-survivor-io-passes-75m-from-37m-downloads/
- Global Games Forum, "How Survivor.io continues to pull in $5 million a month three years later": https://www.globalgamesforum.com/ctv/how-survivor.io-continues-to-pull-in-5-million-a-month-three-years-later
- AppGoblin, Survivor.io (com.dxx.firenow): https://appgoblin.info/apps/com.dxx.firenow
- AppBrain, Habby developer page (Survivor.io and Archero both 50M+ on Google Play): https://www.appbrain.com/dev/Habby/
- App Pricing Lab, Archero 2 (~5M installs, 4.6★): https://apppricinglab.com/app/google_play/com.xq.archeroii
- mobilegamer.biz, "Vampire Survivors mobile has passed 1m downloads in its first week": https://mobilegamer.biz/vampire-survivors-mobile-has-passed-1m-downloads-in-its-first-week/

**Roguelike dungeon crawler**
- AppGoblin, Soul Knight (~93M installs, ~1.7M ratings): https://appgoblin.info/apps/com.ChillyRoom.DungeonShooter
- AppBrain, Shattered Pixel developer page (5M+ installs, Jan 2026): https://www.appbrain.com/dev/Shattered+Pixel/
- AppGoblin, Shattered Pixel Dungeon (Role Playing, free, open-source): https://appgoblin.info/apps/com.shatteredpixel.shatteredpixeldungeon

**Single-player roguelike deckbuilder**
- AppGoblin, Slay the Spire (~1.6M installs, ~29K ratings, paid): https://appgoblin.info/apps/com.humble.SlayTheSpire
- PC Gamer, "Analysts say Slay the Spire 2 is the best-performing deckbuilder of all time": https://www.pcgamer.com/games/roguelike/analysts-say-slay-the-spire-2-is-the-best-performing-deckbuilder-of-all-time-and-the-competition-isnt-close/
- AppGoblin, Meteorfall: Journeys (~100K installs, 4.2★, paid): https://appgoblin.info/apps/com.slothwerks.meteorfall

**Tower-defense RPG hybrid**
- MY.GAMES, "Rush Royale achieves $500 million in lifetime revenue": https://about.my.games/news/567
- AppGoblin, Rush Royale: Tower Defense TD (~57–58M installs, ~754K ratings, 4.22★): https://appgoblin.info/apps/com.my.defense
- AppGoblin, Kingdom Rush Tower Defense TD (~28M installs, ~841K ratings): https://appgoblin.info/apps/com.ironhidegames.android.kingdomrush
- AppGoblin, Bloons TD 6 (5.7M+ installs, 4.78★, ~387K ratings, paid): https://appgoblin.info/apps/com.ninjakiwi.bloonstd6

**Virtual pet / survival-craft**
- mobilegamer.biz top-downloads-2025 (My Talking Tom 2 — 122M in 2025): https://mobilegamer.biz/the-top-mobile-game-downloads-of-2025/
- Apple App Store, Grim Soul: Survival Magic RPG (25M+ downloads worldwide): https://apps.apple.com/us/app/grim-soul-survival-magic-rpg/id1366215798
- AppBrain, Brickworks Games (Grim Soul in the 10M–100M Play bucket): https://www.appbrain.com/dev/Brickworks+Games+Ltd/

**Text / choice adventure**
- AppGoblin, Episode – Choose Your Story (~177M installs): https://appgoblin.info/apps/com.episodeinteractive.android.catalog
- AppGoblin, Choices: Stories You Play (~61M installs): https://appgoblin.info/apps/com.pixelberrystudios.choices
- Game Developer press release, Reigns 10th anniversary (4M+ players): https://www.gamedeveloper.com/press-release/reigns-feiert-10-jahre-auf-dem-thron-mit-4-millionen-spielern-und-einem-k-niglichen-update-f-r-das-originalspiel-ab-sofort-f-r-pc-und-mobilger-te-verf-gbar

**Auto-battler**
- APKMirror, Super Auto Pets (Team Wood Games; free, cross-platform): https://www.apkmirror.com/apk/team-wood-games/super-auto-pets

**Gacha / idle RPG leaders (not buildable — demand reference)**
- PocketGamer.biz, "AFK Arena celebrates seventh anniversary and over $1.5bn in lifetime earnings" (AppMagic): https://www.pocketgamer.biz/afk-arena-celebrates-seventh-anniversary-and-over-15bn-in-lifetime-earnings
- Naavik, "Lessons learned from AFK Journey": https://naavik.co/digest/lessons-learned-from-afk-journey/
- MAF, "How AFK Journey reached $110 million in revenue and counting": https://maf.ad/en/blog/afk-journey-analysis/
