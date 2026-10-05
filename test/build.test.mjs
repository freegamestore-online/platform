/**
 * Smoke test for FreeGameStore build.js. Mirrors the FAS test pattern.
 * Runs with Node's built-in test runner.
 *
 *   node --test test/build.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..");
const BUILD_JS = join(REPO_ROOT, "build.js");
const REAL_REGISTRY = join(REPO_ROOT, "registry.json");

const XSS_PAYLOAD = "<script>alert(1)</script>";
// Must NOT end in -test/-fixture: build.js excludes fixtures from the public
// store BEFORE emitting a detail page, which would silently disable this XSS
// regression check. Keep it a "real" game id so escaping is actually exercised.
const FIXTURE_ID = "xss-probe";

// Mirror build.js's public-store fixture exclusion (TEST_ID pattern + test:true)
// so "every game is present" assertions don't trip over deliberately-excluded
// fixtures like mcp-hybrid-test / mcp-snake-test.
const isFixture = (g) => g.test === true || /(?:^|-)(?:test|fixture)$/i.test(g.id || "");

function runBuild() {
  const tmp = mkdtempSync(join(tmpdir(), "fgs-build-test-"));
  const tmpRegistry = join(tmp, "registry.json");
  const tmpDist = join(tmp, "dist");
  mkdirSync(join(tmpDist, "games"), { recursive: true });
  writeFileSync(join(tmpDist, "games", "stale-game.html"), "stale");

  const realRegistry = JSON.parse(readFileSync(REAL_REGISTRY, "utf8"));
  realRegistry.games.push({
    id: FIXTURE_ID,
    name: "XSS Fixture",
    category: "arcade",
    icon: "&#9888;",
    iconBg: "#fee2e2",
    description: XSS_PAYLOAD,
    appUrl: `https://${FIXTURE_ID}.freegamestore.online`,
    repo: `freegamestore-online/${FIXTURE_ID}`,
    cfProject: FIXTURE_ID,
    type: "standalone",
    developer: "FreeGameStore",
  });
  writeFileSync(tmpRegistry, JSON.stringify(realRegistry, null, 2));

  execFileSync(process.execPath, [BUILD_JS], {
    env: { ...process.env, FGS_REGISTRY_PATH: tmpRegistry, FGS_DIST: tmpDist },
    cwd: REPO_ROOT,
    stdio: ["ignore", "ignore", "ignore"],
    timeout: 60_000,
  });
  return { tmp, tmpDist, registry: realRegistry };
}

function listFiles(dir, suffix) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, suffix));
    else if (full.endsWith(suffix)) out.push(full);
  }
  return out;
}

test("build.js writes index.html containing every game id", () => {
  const { tmp, tmpDist, registry } = runBuild();
  try {
    const indexHtml = readFileSync(join(tmpDist, "index.html"), "utf8");
    for (const g of registry.games) {
      if (isFixture(g)) continue; // fixtures are intentionally excluded from the store
      assert.ok(
        indexHtml.includes(`data-id="${g.id}"`),
        `index.html is missing game id "${g.id}"`,
      );
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("build.js removes stale generated game detail pages", () => {
  const { tmp, tmpDist } = runBuild();
  try {
    assert.equal(existsSync(join(tmpDist, "games", "stale-game.html")), false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("build.js escapes <script> payloads in game descriptions", () => {
  const { tmp, tmpDist } = runBuild();
  try {
    const detailHtml = readFileSync(
      join(tmpDist, "games", `${FIXTURE_ID}.html`),
      "utf8",
    );
    assert.ok(
      detailHtml.includes("&lt;script&gt;alert(1)&lt;/script&gt;"),
      "expected escaped <script> in detail page",
    );
    assert.ok(
      !detailHtml.includes(XSS_PAYLOAD),
      "raw <script> leaked unescaped into detail page",
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

function runBuildWithRegistry(games) {
  const tmp = mkdtempSync(join(tmpdir(), "fgs-build-validator-"));
  const tmpRegistry = join(tmp, "registry.json");
  const tmpDist = join(tmp, "dist");
  writeFileSync(tmpRegistry, JSON.stringify({ games }, null, 2));
  // spawnSync captures stderr on success too — the resilient validator warns
  // about dropped entries via stderr while still exiting 0, and tests assert it.
  const res = spawnSync(process.execPath, [BUILD_JS], {
    env: { ...process.env, FGS_REGISTRY_PATH: tmpRegistry, FGS_DIST: tmpDist },
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 60_000,
  });
  const stderr = (res.stderr || "") + (res.error ? String(res.error) : "");
  return { ok: res.status === 0, stderr, tmp, tmpDist };
}

const VALID_GAME = {
  id: "valid-game",
  name: "Valid",
  category: "arcade",
  icon: "&#9728;",
  iconBg: "#eff6ff",
  description: "ok",
  appUrl: "https://valid.freegamestore.online",
  repo: "freegamestore-online/valid",
  cfProject: "valid",
  type: "standalone",
  developer: "FreeGameStore",
};

// The validator is resilient: an invalid entry is DROPPED (excluded from the
// build) with a warning, but never fails the whole build. These tests assert
// the build still succeeds, the reason is reported, and the entry was skipped.
test("validator drops wrong-host appUrl, build still succeeds", () => {
  const { ok, stderr, tmp } = runBuildWithRegistry([
    { ...VALID_GAME, appUrl: "https://evil.example.com" },
  ]);
  try {
    assert.equal(ok, true, stderr);
    assert.match(stderr, /appUrl must be https:\/\/\*\.freegamestore\.online/);
    assert.match(stderr, /skipped 1 invalid game/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("validator drops bad iconBg, build still succeeds", () => {
  const { ok, stderr, tmp } = runBuildWithRegistry([
    { ...VALID_GAME, iconBg: "url(javascript:alert(1))" },
  ]);
  try {
    assert.equal(ok, true, stderr);
    assert.match(stderr, /iconBg must be a #hex color/);
    assert.match(stderr, /skipped 1 invalid game/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("validator drops bad id, build still succeeds", () => {
  for (const badId of ["UPPER", "two words", "dot.sep", ""]) {
    const { ok, stderr, tmp } = runBuildWithRegistry([{ ...VALID_GAME, id: badId }]);
    try {
      assert.equal(ok, true, `id="${badId}" should have been dropped, not fail the build`);
      assert.match(stderr, /skipped 1 invalid game/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
});

test("validator drops bad creatorGithub, build still succeeds", () => {
  const { ok, stderr, tmp } = runBuildWithRegistry([
    { ...VALID_GAME, creatorGithub: "bad/user" },
  ]);
  try {
    assert.equal(ok, true, stderr);
    assert.match(stderr, /creatorGithub must be a GitHub username/);
    assert.match(stderr, /skipped 1 invalid game/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("one bad entry does not take down the valid games", () => {
  const { ok, stderr, tmp, tmpDist } = runBuildWithRegistry([
    { ...VALID_GAME, id: "good-game", name: "GoodGame" },
    { ...VALID_GAME, id: "bad-game", name: "BadGame", appUrl: "https://evil.example.com" },
  ]);
  try {
    assert.equal(ok, true, stderr);
    assert.match(stderr, /skipped 1 invalid game/);
    const indexHtml = readFileSync(join(tmpDist, "index.html"), "utf8");
    assert.ok(indexHtml.includes("GoodGame"), "valid game should be in the build");
    assert.ok(!indexHtml.includes("BadGame"), "invalid game should be excluded from the build");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("public registry excludes test fixtures", () => {
  const { ok, stderr, tmp, tmpDist } = runBuildWithRegistry([
    { ...VALID_GAME, id: "public-game", name: "Public Game" },
    { ...VALID_GAME, id: "e2e-create-smoke-test", name: "Hidden Canary" },
    { ...VALID_GAME, id: "flagged-fixture", name: "Hidden Fixture", test: true },
  ]);
  try {
    assert.equal(ok, true, stderr);
    const publicRegistry = JSON.parse(readFileSync(join(tmpDist, "registry.json"), "utf8"));
    const ids = publicRegistry.games.map((g) => g.id);
    assert.deepEqual(ids, ["public-game"]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("creatorGithub generates developer card, profile page, and author chip", () => {
  const { ok, tmp, tmpDist, stderr } = runBuildWithRegistry([
    { ...VALID_GAME, creatorGithub: "octocat" },
  ]);
  try {
    assert.equal(ok, true, stderr);

    const developersHtml = readFileSync(join(tmpDist, "developers.html"), "utf8");
    assert.ok(developersHtml.includes("Creator arcade"));
    assert.ok(developersHtml.includes("Creator games"));
    assert.ok(developersHtml.includes('href="/u/octocat.html"'));
    assert.ok(developersHtml.includes('src="https://avatars.githubusercontent.com/octocat?size=200"'));
    assert.ok(!developersHtml.includes("https://github.com/octocat.png"));
    assert.ok(developersHtml.includes("View profile"));
    assert.ok(developersHtml.includes("Valid"));

    const authorHtml = readFileSync(join(tmpDist, "u", "octocat.html"), "utf8");
    assert.ok(authorHtml.includes("Creator profile"));
    assert.ok(authorHtml.includes("Latest game"));
    assert.ok(authorHtml.includes("Games by @octocat"));
    assert.ok(authorHtml.includes('data-id="valid-game"'));

    const detailHtml = readFileSync(join(tmpDist, "games", "valid-game.html"), "utf8");
    assert.ok(detailHtml.includes('class="author-chip"'));
    assert.ok(detailHtml.includes('href="/u/octocat.html"'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("generated pages use cache-busted stylesheets", () => {
  const { tmp, tmpDist } = runBuild();
  try {
    const pages = [
      readFileSync(join(tmpDist, "index.html"), "utf8"),
      readFileSync(join(tmpDist, "developers.html"), "utf8"),
      readFileSync(join(tmpDist, "u", "serge-ivo.html"), "utf8"),
      readFileSync(join(tmpDist, "games", "2048.html"), "utf8"),
      readFileSync(join(tmpDist, "quality.html"), "utf8"),
    ];
    for (const html of pages) {
      assert.match(html, /\/style\.css\?v=[a-f0-9]{12}/);
      assert.ok(!html.includes("{{STYLE_VERSION}}"));
    }
    assert.match(pages[0], /\/card-styles\.css\?v=[a-f0-9]{12}/);
    assert.match(pages[2], /\/card-styles\.css\?v=[a-f0-9]{12}/);
    assert.match(pages[3], /\/card-styles\.css\?v=[a-f0-9]{12}/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

function firstNav(html) {
  return (html.match(/<nav[^>]*>[\s\S]*?<\/nav>/) || [""])[0];
}

test("deployed nav uses the single docs entry and no pricing link", () => {
  const { tmp, tmpDist } = runBuild();
  try {
    const pagePaths = [
      "index.html",
      "about.html",
      "developers.html",
      "get-started.html",
      "ai/codex.html",
      "games/2048.html",
      "u/serge-ivo.html",
      "quality.html",
    ];
    for (const pagePath of pagePaths) {
      const html = readFileSync(join(tmpDist, pagePath), "utf8");
      const nav = firstNav(html);
      assert.ok(nav, `${pagePath} is missing a top nav`);
      assert.ok(nav.includes('href="/docs/"'), `${pagePath} nav is missing /docs/`);
      assert.ok(!nav.includes("/docs.html"), `${pagePath} nav links to legacy docs.html`);
      assert.ok(!nav.includes("/guidelines.html"), `${pagePath} nav links to legacy guidelines.html`);
      assert.ok(!nav.includes("/pricing.html"), `${pagePath} nav still links to pricing.html`);
      assert.ok(!nav.includes(">Guidelines<"), `${pagePath} nav still has a separate Guidelines entry`);
      assert.ok(!nav.includes(">Pricing<"), `${pagePath} nav still has a Pricing entry`);
    }

    assert.equal(existsSync(join(tmpDist, "docs.html")), false);
    assert.equal(existsSync(join(tmpDist, "guidelines.html")), false);
    assert.equal(existsSync(join(tmpDist, "pricing.html")), false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("legacy docs, guidelines, and pricing pages redirect instead of shipping stale HTML", () => {
  const { tmp, tmpDist } = runBuild();
  try {
    const redirects = readFileSync(join(tmpDist, "_redirects"), "utf8");
    assert.match(redirects, /^\/docs\.html \/docs\/ 301$/m);
    assert.match(redirects, /^\/guidelines\.html \/docs\/guidelines\/ 301$/m);
    assert.match(redirects, /^\/pricing\.html \/about\.html 301$/m);

    assert.equal(existsSync(join(tmpDist, "docs.html")), false);
    assert.equal(existsSync(join(tmpDist, "guidelines.html")), false);
    assert.equal(existsSync(join(tmpDist, "pricing.html")), false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("legacy FreeGameStore games without creatorGithub appear on platform creator profile", () => {
  const { ok, tmp, tmpDist, stderr } = runBuildWithRegistry([
    { ...VALID_GAME, id: "legacy-one", name: "Legacy One", category: "arcade" },
    { ...VALID_GAME, id: "legacy-two", name: "Legacy Two", category: "puzzle" },
    { ...VALID_GAME, id: "guest-game", name: "Guest Game", creatorGithub: "octocat" },
  ]);
  try {
    assert.equal(ok, true, stderr);

    const developersHtml = readFileSync(join(tmpDist, "developers.html"), "utf8");
    assert.ok(developersHtml.includes('href="/u/serge-ivo.html"'));
    assert.ok(developersHtml.includes('<span class="dev-card-count">2</span>'));

    const authorHtml = readFileSync(join(tmpDist, "u", "serge-ivo.html"), "utf8");
    assert.ok(authorHtml.includes("2 games on FreeGameStore"));
    assert.ok(authorHtml.includes('data-id="legacy-one"'));
    assert.ok(authorHtml.includes('data-id="legacy-two"'));
    assert.ok(!authorHtml.includes('data-id="guest-game"'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("no inline onerror= attributes survive the build", () => {
  const { tmp, tmpDist } = runBuild();
  try {
    const indexHtml = readFileSync(join(tmpDist, "index.html"), "utf8");
    assert.ok(
      !/\sonerror\s*=/i.test(indexHtml),
      "index.html still emits inline onerror=",
    );
    assert.ok(
      /<div class="app-icon">/.test(indexHtml),
      "expected at least one .app-icon element",
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("cards have no inline style attribute; iconBg lives in card-styles.css", () => {
  const { tmp, tmpDist, registry } = runBuild();
  try {
    const indexHtml = readFileSync(join(tmpDist, "index.html"), "utf8");
    assert.ok(
      !/<div class="app-icon"[^>]*style=/.test(indexHtml),
      "inline style= leaked onto .app-icon",
    );
    const css = readFileSync(join(tmpDist, "card-styles.css"), "utf8");
    for (const g of registry.games) {
      if (isFixture(g)) continue; // fixtures are intentionally excluded from the store
      assert.ok(
        css.includes(`.app-card[data-id="${g.id}"] .app-icon`),
        `card-styles.css missing rule for "${g.id}"`,
      );
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

function readHeadersCsp(tmpDist) {
  const headers = readFileSync(join(tmpDist, "_headers"), "utf8");
  const line = (headers.match(/Content-Security-Policy:\s*([^\n]+)/) || [])[1] || '';
  return { headers, csp: line };
}

test("_headers ships X-Frame-Options + HSTS + COOP + frame-ancestors", () => {
  const { tmp, tmpDist } = runBuild();
  try {
    const { headers, csp } = readHeadersCsp(tmpDist);
    assert.match(headers, /X-Frame-Options:\s*DENY/);
    assert.match(headers, /Strict-Transport-Security:\s*max-age=31536000/);
    assert.match(headers, /Cross-Origin-Opener-Policy:\s*same-origin/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("script-src has sha256 hash, no 'unsafe-inline'", () => {
  const { tmp, tmpDist } = runBuild();
  try {
    const { csp } = readHeadersCsp(tmpDist);
    const scriptSrc = (csp.match(/script-src[^;]*/) || [''])[0];
    assert.ok(scriptSrc.includes("'sha256-"), `script-src needs sha256 hash: ${scriptSrc}`);
    assert.ok(!scriptSrc.includes("'unsafe-inline'"), `script-src has unsafe-inline: ${scriptSrc}`);
    assert.ok(!csp.includes("raw.githubusercontent.com"), "raw.githubusercontent.com leaked into runtime CSP");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("img-src and connect-src allowlist specific hosts (no blanket https:)", () => {
  const { tmp, tmpDist } = runBuild();
  try {
    const { csp } = readHeadersCsp(tmpDist);
    const imgSrc = (csp.match(/img-src[^;]*/) || [''])[0];
    assert.ok(!/https:\s*[;\s]/.test(imgSrc), `img-src blanket https:: ${imgSrc}`);
    assert.ok(imgSrc.includes('freegamestore.online'), `img-src missing primary store: ${imgSrc}`);
    assert.ok(imgSrc.includes('avatars.githubusercontent.com'), `img-src missing GitHub avatar CDN: ${imgSrc}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("CSP reporting is wired (report-to + Reporting-Endpoints + handler file)", () => {
  const { tmp, tmpDist } = runBuild();
  try {
    const { headers, csp } = readHeadersCsp(tmpDist);
    assert.match(csp, /report-to csp-endpoint/);
    assert.match(csp, /report-uri \/v1\/csp-report/);
    assert.match(headers, /Reporting-Endpoints: csp-endpoint="\/v1\/csp-report"/);
    assert.ok(
      readFileSync(join(REPO_ROOT, "functions/v1/csp-report.js"), "utf8").includes("onRequestPost"),
      "functions/v1/csp-report.js missing or wrong shape",
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("every local <script src> has a valid SRI integrity attribute", () => {
  const { tmp, tmpDist } = runBuild();
  try {
    const indexHtml = readFileSync(join(tmpDist, "index.html"), "utf8");
    // Local scripts are SRI'd AND cache-busted (src="/theme.js?v=<hash>") — the
    // ?v query is required so a changed script gets a fresh CDN cache key and its
    // served bytes stay in lockstep with the integrity hash (a stale edge copy
    // otherwise fails SRI and blocks the script; that bricked theme.js/nav).
    const localScripts = indexHtml.match(/<script\s+src="\/[^"]+\.js(?:\?v=[a-f0-9]+)?"[^>]*>/g) || [];
    assert.ok(localScripts.length >= 2, `expected ≥2 local script tags, found ${localScripts.length}`);
    for (const tag of localScripts) {
      assert.match(tag, /integrity="sha256-[A-Za-z0-9+/=]+"/, `<script> missing integrity: ${tag}`);
      assert.match(tag, /src="\/[^"]+\.js\?v=[a-f0-9]+"/, `<script> not cache-busted: ${tag}`);
    }
    assert.ok(!/{{SRI_[A-Z_]+}}/.test(indexHtml), "unsubstituted SRI placeholder");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("all built HTML cache-busts local scripts and stylesheet links", () => {
  const { tmp, tmpDist } = runBuild();
  try {
    const htmlFiles = listFiles(tmpDist, ".html");
    assert.ok(htmlFiles.length > 10, `expected many built HTML files, found ${htmlFiles.length}`);
    for (const file of htmlFiles) {
      const html = readFileSync(file, "utf8");
      const localScripts = html.match(/<script\s+src="\/[^"]+\.js(?:\?v=[a-f0-9]+)?"[^>]*>/g) || [];
      for (const tag of localScripts) {
        assert.match(tag, /src="\/[^"]+\.js\?v=[a-f0-9]+"/, `${file}: <script> not cache-busted: ${tag}`);
      }
      const styleLinks = html.match(/<link\s+[^>]*href="\/?style\.css(?:\?v=[a-f0-9]+)?"[^>]*>/g) || [];
      for (const tag of styleLinks) {
        assert.match(tag, /href="\/style\.css\?v=[a-f0-9]+"/, `${file}: style.css not cache-busted: ${tag}`);
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("no <meta http-equiv=Content-Security-Policy> in index.html (headers only)", () => {
  const { tmp, tmpDist } = runBuild();
  try {
    const indexHtml = readFileSync(join(tmpDist, "index.html"), "utf8");
    assert.ok(
      !/meta\s+http-equiv="Content-Security-Policy"/i.test(indexHtml),
      "CSP meta re-appeared in index.html",
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("validator drops duplicate ids and unbounded/ctrl-char names, build still succeeds", () => {
  let r = runBuildWithRegistry([{ ...VALID_GAME }, { ...VALID_GAME }]);
  try {
    assert.equal(r.ok, true, r.stderr);
    assert.match(r.stderr, /duplicate id/);
  } finally { rmSync(r.tmp, { recursive: true, force: true }); }
  r = runBuildWithRegistry([{ ...VALID_GAME, name: "x".repeat(200) }]);
  try {
    assert.equal(r.ok, true, r.stderr);
    assert.match(r.stderr, /name must be 1-80 chars/);
  } finally { rmSync(r.tmp, { recursive: true, force: true }); }
  r = runBuildWithRegistry([{ ...VALID_GAME, name: "tab" + String.fromCharCode(9) + "name" }]);
  try {
    assert.equal(r.ok, true, r.stderr);
    assert.match(r.stderr, /name must be/);
  } finally { rmSync(r.tmp, { recursive: true, force: true }); }
});

// Build-status gate (freegamestore-online/platform#22). A game is provisioned —
// repo, host route, registry entry — BEFORE its first build runs, so the store
// must not list one whose code has never compiled. The host answers 200 for the
// template scaffold, so liveness cannot be inferred from the URL responding.
test("public registry excludes pending and failed games", () => {
  const { ok, stderr, tmp, tmpDist } = runBuildWithRegistry([
    { ...VALID_GAME, id: "live-game", name: "Live", status: "live" },
    { ...VALID_GAME, id: "pending-game", name: "Pending", status: "pending" },
    { ...VALID_GAME, id: "failed-game", name: "Failed", status: "failed" },
  ]);
  try {
    assert.equal(ok, true, stderr);
    const publicRegistry = JSON.parse(readFileSync(join(tmpDist, "registry.json"), "utf8"));
    assert.deepEqual(publicRegistry.games.map((g) => g.id), ["live-game"]);
    // The hidden games must not have detail pages generated either.
    const pages = listFiles(join(tmpDist, "games"), ".html").map((f) => f.split("/").pop());
    assert.ok(!pages.includes("pending-game.html"), "pending game got a detail page");
    assert.ok(!pages.includes("failed-game.html"), "failed game got a detail page");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("a registry entry with NO status is treated as live", () => {
  // The entire pre-2026-08-11 catalogue has no status field. Hiding those would
  // empty the store.
  const { ok, stderr, tmp, tmpDist } = runBuildWithRegistry([
    { ...VALID_GAME, id: "legacy-game", name: "Legacy" },
  ]);
  try {
    assert.equal(ok, true, stderr);
    const publicRegistry = JSON.parse(readFileSync(join(tmpDist, "registry.json"), "utf8"));
    assert.deepEqual(publicRegistry.games.map((g) => g.id), ["legacy-game"]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("an unrecognised status does not hide a game", () => {
  // Matches readGameStatus in the platform's admin worker: only the two known
  // non-live states hide a game, so a typo can never delist a live one.
  const { ok, stderr, tmp, tmpDist } = runBuildWithRegistry([
    { ...VALID_GAME, id: "typo-game", name: "Typo", status: "livee" },
  ]);
  try {
    assert.equal(ok, true, stderr);
    const publicRegistry = JSON.parse(readFileSync(join(tmpDist, "registry.json"), "utf8"));
    assert.deepEqual(publicRegistry.games.map((g) => g.id), ["typo-game"]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
