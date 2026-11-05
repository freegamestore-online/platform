/** Game ideas contract (#404): dataset validation and computed buildability.
 *  No dataset or page yet — those are #405 / #406. These exercise the lib with
 *  inline examples. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const {
  validateIdeas, verdictFor, buildable, statusOf, renderIdeasPage, CATEGORIES, PRIMITIVES, BLOCKERS,
} = require("../lib/ideas.cjs");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// A complete, valid idea. Helper lets each test tweak one field.
const base = {
  id: "triple-tile-match",
  name: "Triple tile match",
  category: "puzzle",
  pitch: "Tap sets of three identical tiles into a tray; relaxing and tidy.",
  fgsEdge: "Free, offline, no ads — rivals gate boards behind ads and energy.",
  mechanic: "match-3-into-tray",
  difficulty: "easy",
  decision: "build-now",
  demand: 5,
  wave: 1,
  engine: "grid",
  bundleTier: 300,
  primitives: ["leaderboard", "localStorage", "seed", "sounds"],
  requires: [],
  caveats: "Generic mechanic; use original tile art, not Tile Club/Triple Tile branding.",
  fgsGames: [],
  sources: ["play", "apple", "niche"],
  leaders: [
    {
      name: "Tile Club",
      store: "play",
      installs: "100M+",
      rating: 4.8,
      reviews: "2.3M",
      chartRank: null,
      chart: null,
      price: null,
      url: "https://play.google.com/store/apps/details?id=com.gamovation.tileclub",
    },
  ],
};
const idea = (over = {}) => ({ ...base, ...over });
const data = (...ideas) => ({ researchDate: "2026-10-15", ideas });

test("a complete, valid idea passes", () => {
  assert.deepEqual(validateIdeas(data(idea())), []);
});

test("CATEGORIES are the FGS registry categories", () => {
  assert.ok(CATEGORIES.includes("arcade") && CATEGORIES.includes("rpg") && CATEGORIES.includes("board"));
  assert.equal(CATEGORIES.length, 10);
});

test("rejects a bad category, difficulty, demand, engine and bundle tier", () => {
  const errs = validateIdeas(data(
    idea({ id: "a", category: "puzzler" }),
    idea({ id: "b", difficulty: "trivial" }),
    idea({ id: "c", demand: 9 }),
    idea({ id: "d", engine: "unity" }),
    idea({ id: "e", bundleTier: 1200 }),
  ));
  assert.ok(errs.some((e) => e.includes('"a"') && e.includes("category")));
  assert.ok(errs.some((e) => e.includes('"b"') && e.includes("difficulty")));
  assert.ok(errs.some((e) => e.includes('"c"') && e.includes("demand")));
  assert.ok(errs.some((e) => e.includes('"d"') && e.includes("engine")));
  assert.ok(errs.some((e) => e.includes('"e"') && e.includes("bundleTier")));
});

test("caveats are required and sources must be non-empty", () => {
  assert.ok(validateIdeas(data(idea({ id: "no-caveats", caveats: "" }))).some((e) => e.includes("caveats")));
  assert.ok(validateIdeas(data(idea({ id: "no-source", sources: [] }))).some((e) => e.includes("sources")));
});

test("duplicate ids and bad kebab ids are caught", () => {
  assert.ok(validateIdeas(data(idea({ id: "dup" }), idea({ id: "dup" }))).some((e) => e.includes("duplicate")));
  assert.ok(validateIdeas(data(idea({ id: "Bad_Id" }))).some((e) => e.includes("bad id")));
});

test("primitives and requires must come from the vocabulary", () => {
  assert.ok(validateIdeas(data(idea({ id: "p", primitives: ["cloud-save"] }))).some((e) => e.includes("primitives")));
  assert.ok(validateIdeas(data(idea({ id: "r", requires: ["gpu"] }))).some((e) => e.includes("requires")));
  assert.ok(PRIMITIVES.length && BLOCKERS.length);
});

test("a leader URL must be a real store listing for its store", () => {
  const errs = validateIdeas(data(idea({
    id: "bad-url",
    leaders: [{ name: "X", store: "play", url: "https://evil.example.com/x" }],
  })));
  assert.ok(errs.some((e) => e.includes("not a play listing")));
});

test("decision/requires consistency is enforced", () => {
  // build-now cannot carry a blocker
  assert.ok(validateIdeas(data(idea({ id: "bn", decision: "build-now", requires: ["realtime-rooms"] }))).some((e) => e.includes("build-now cannot require")));
  // build-now-rooms-later must require rooms
  assert.ok(validateIdeas(data(idea({ id: "rl", decision: "build-now-rooms-later", requires: [] }))).some((e) => e.includes("must require realtime-rooms")));
  // wont-build must carry a permanent blocker
  assert.ok(validateIdeas(data(idea({ id: "wb", decision: "wont-build", requires: [] }))).some((e) => e.includes("permanent blocker")));
});

test("buildability is computed from requires, not hand-labelled", () => {
  assert.equal(verdictFor(idea({ requires: [] })).kind, "ok");
  assert.equal(verdictFor(idea({ requires: ["realtime-rooms"] })).kind, "needs-rooms");
  assert.equal(verdictFor(idea({ requires: ["payments"] })).kind, "blocked");
  assert.equal(verdictFor(idea({ requires: ["realtime-rooms", "server-compute"] })).kind, "blocked");
  assert.equal(buildable(verdictFor(idea({ requires: ["realtime-rooms"] }))), true);
  assert.equal(buildable(verdictFor(idea({ requires: ["payments"] }))), false);
});

test("statusOf reflects catalog coverage and blockers", () => {
  assert.equal(statusOf(idea({ fgsGames: [], requires: [] })), "open");
  assert.equal(statusOf(idea({ fgsGames: ["solitaire"] })), "covered");
  assert.equal(statusOf(idea({ fgsGames: ["partial:solitaire"] })), "partial");
  assert.equal(statusOf(idea({ decision: "build-now-rooms-later", requires: ["realtime-rooms"], fgsGames: [] })), "rooms");
  assert.equal(statusOf(idea({ decision: "wont-build", requires: ["payments"] })), "blocked");
  assert.equal(statusOf(idea({ decision: "upgrade-existing", fgsGames: ["partial:solitaire"] })), "upgrade");
});

test("the shipped data/game-ideas.json is valid", () => {
  const data = JSON.parse(readFileSync(join(ROOT, "data", "game-ideas.json"), "utf8"));
  assert.deepEqual(validateIdeas(data), []);
  assert.ok(data.ideas.length >= 40, `expected ≥40 ideas, got ${data.ideas.length}`);
});

test("renderIdeasPage fills every placeholder and escapes a hostile idea", () => {
  const data = {
    researchDate: "2026-10-15",
    ideas: [idea({ id: "xss", name: "<script>alert(1)</script>", pitch: 'a " b', caveats: "x" })],
  };
  const tmpl = "<a>{{IDEAS_COUNT}}</a>{{IDEAS_STATUS_BUTTONS}}{{IDEAS_CATEGORY_BUTTONS}}<b>{{IDEAS_CARDS}}</b>";
  const out = renderIdeasPage(tmpl, data, { escapeHtml: esc });
  assert.ok(!/{{IDEAS_/.test(out), "all placeholders resolved");
  assert.ok(!out.includes("<script>alert(1)</script>"), "idea name is escaped");
  assert.ok(out.includes("&lt;script&gt;"), "escaped form present");
});
