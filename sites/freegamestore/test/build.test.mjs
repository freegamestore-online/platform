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
// Mirror build.js's build-status gate (#22): pending/failed games are hidden
// until a build succeeds, so they are not expected on the store pages.
const isHidden = (g) => isFixture(g) || g.status === "pending" || g.status === "failed";

function runBuild() {
  const tmp = mkdtempSync(join(tmpdir(), "fgs-build-test-"));
  const tmpRegistry = join(tmp, "registry.json");
  const tmpDist = join(tmp, "dist");
  mkdirSync(join(tmpDist, "games"), { recursive: true });
  writeFileSync(join(tmpDist, "games", "stale-game.html"), "stale");
  mkdirSync(join(tmpDist, "docs"), { recursive: true });
  writeFileSync(join(tmpDist, "docs", "index.html"), "existing SDK docs");

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
    assert.match(indexHtml, /aria-label="Filter by genre"/);
    assert.match(indexHtml, /data-sort="newest"/);
    assert.doesNotMatch(indexHtml, /maximum-scale|user-scalable=no/);
    // Generated detail pages and copied guides must receive the same footer.
    for (const file of ['index.html', 'about.html', 'developers.html', `games/${FIXTURE_ID}.html`, 'ai/codex.html']) {
      const html = readFileSync(join(tmpDist, file), 'utf8');
      assert.equal((html.match(/aria-label="Footer"/g) || []).length, 1, file);
      assert.match(html, /<h2>Build a game<\/h2>/, file);
      assert.match(html, /<h2>Explore<\/h2>/, file);
    }
    for (const g of registry.games) {
      if (isHidden(g)) continue; // fixtures and not-yet-built games are excluded from the store
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
    assert.equal(readFileSync(join(tmpDist, "docs", "index.html"), "utf8"), "existing SDK docs");
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

function runBuildWithRegistry(games, permissions) {
  const tmp = mkdtempSync(join(tmpdir(), "fgs-build-validator-"));
  const tmpRegistry = join(tmp, "registry.json");
  const tmpDist = join(tmp, "dist");
  writeFileSync(tmpRegistry, JSON.stringify({ games }, null, 2));
  // #370: optional game-permissions.json for the listing sections.
  const permEnv = {};
  if (permissions) {
    permEnv.FGS_PERMISSIONS_PATH = join(tmp, "game-permissions.json");
    writeFileSync(permEnv.FGS_PERMISSIONS_PATH, JSON.stringify({ games: permissions }));
  }
  // spawnSync captures stderr on success too — the resilient validator warns
  // about dropped entries via stderr while still exiting 0, and tests assert it.
  const res = spawnSync(process.execPath, [BUILD_JS], {
    env: { ...process.env, FGS_REGISTRY_PATH: tmpRegistry, FGS_DIST: tmpDist, ...permEnv },
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

test("a bad iconBg falls back to the default colour and keeps the game (#361)", () => {
  const { ok, stderr, tmp } = runBuildWithRegistry([
    { ...VALID_GAME, iconBg: "url(javascript:alert(1))" },
  ]);
  try {
    assert.equal(ok, true, stderr);
    assert.match(stderr, /iconBg must be a #hex color/);
    assert.doesNotMatch(stderr, /skipped 1 invalid game/);
    const index = readFileSync(join(tmp, "dist", "index.html"), "utf8");
    assert.ok(index.includes(VALID_GAME.id), "the game is still listed");
    const css = readFileSync(join(tmp, "dist", "card-styles.css"), "utf8");
    assert.doesNotMatch(css, /javascript/);
    assert.match(css, /#10b981/);
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
      if (isHidden(g)) continue; // fixtures and not-yet-built games are excluded from the store
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

// #355: the public analytics page shows owner data fetched from the console API,
// so it has to run under the strict storefront CSP (style-src 'self', no inline
// script, no inline style attributes, no inline handlers).
test("analytics page ships cache-busted with no inline script, style, or handler", () => {
  const { tmp, tmpDist } = runBuild();
  try {
    const html = readFileSync(join(tmpDist, "analytics.html"), "utf8");
    assert.match(html, /src="\/analytics\.js\?v=[a-f0-9]+"/, "analytics.js must be cache-busted");
    assert.match(html, /src="\/theme\.js\?v=[a-f0-9]+"/, "theme.js must be cache-busted");
    const inlineScripts = html.match(/<script(?![^>]*\ssrc=)[^>]*>/gi) || [];
    assert.deepEqual(inlineScripts, [], "no inline <script> blocks under the strict CSP");
    assert.doesNotMatch(html, /\sstyle="/, "no inline style attributes");
    assert.doesNotMatch(html, /\son[a-z]+="/i, "no inline event handler attributes");
    assert.doesNotMatch(html, /{{[A-Z_]+}}/, "no unsubstituted template placeholders");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("analytics.js renders with DOM APIs only: no innerHTML, no inline styles", () => {
  // Code only: the header comment names the banned APIs on purpose.
  const js = readFileSync(join(REPO_ROOT, "analytics.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, "no HTML-string sinks");
  assert.doesNotMatch(js, /\.style\b|setAttribute\(\s*["']style["']/, "no style attributes or CSSOM style writes");
  // Its data source is the console, which the storefront CSP's connect-src allows.
  assert.match(js, /https:\/\/console\.freegamestore\.online/);
});

test("console CORS allows the PUT the analytics page uses for tag saves", () => {
  const auth = readFileSync(join(REPO_ROOT, "..", "..", "apps", "console", "functions", "api", "_auth.ts"), "utf8");
  const methods = auth.match(/'Access-Control-Allow-Methods':\s*'([^']+)'/);
  assert.ok(methods, "Access-Control-Allow-Methods is set");
  assert.match(methods[1], /\bPUT\b/, "PUT must be allowed for the cross-origin tag save");
});

test("analytics chart colours bars from the stylesheet, not var() in an SVG attribute", () => {
  // Browsers don't resolve var() inside SVG presentation attributes, so
  // fill="var(--accent)" rendered the bars black (#361).
  const js = readFileSync(join(REPO_ROOT, "analytics.js"), "utf8");
  assert.doesNotMatch(js, /fill:\s*['"]var\(/);
  const css = readFileSync(join(REPO_ROOT, "style.css"), "utf8");
  assert.match(css, /\.an-chart-svg rect\s*\{\s*fill:\s*var\(--accent\)/);
});

// --- #370: permissions on listings ---

const PERM_GAMES = [
  { ...VALID_GAME, id: "tilt-game", name: "Tilt", appUrl: "https://tilt-game.freegamestore.online" },
  { ...VALID_GAME, id: "plain-game", name: "Plain", appUrl: "https://plain-game.freegamestore.online" },
  { ...VALID_GAME, id: "new-game", name: "New", appUrl: "https://new-game.freegamestore.online" },
];
const PERMS = {
  "tilt-game": {
    declared: { motion: "Tilt the phone to steer <b>fast</b>", gamepad: "" },
    detected: ["motion", "microphone"],
  },
  "plain-game": { declared: {}, detected: [] },
  // new-game: not scanned yet.
};

function withPermissionBuild(fn) {
  const { ok, stderr, tmp, tmpDist } = runBuildWithRegistry(PERM_GAMES, PERMS);
  try {
    assert.equal(ok, true, stderr);
    fn((id) => readFileSync(join(tmpDist, "games", `${id}.html`), "utf8"), readFileSync(join(tmpDist, "index.html"), "utf8"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test("listing shows declared + detected permissions with icon, name and reason (#370)", () => {
  withPermissionBuild((page) => {
    const html = page("tilt-game");
    const section = html.slice(html.indexOf('id="permissions"'), html.indexOf("</section>", html.indexOf('id="permissions"')));
    assert.match(section, /<h2>Permissions<\/h2>/);
    // Catalog order: motion, microphone, gamepad.
    const names = [...section.matchAll(/app-perm-name">([^<]+)</g)].map((m) => m[1]);
    assert.deepEqual(names, ["Motion sensors", "Microphone", "Gamepad"]);
    // Creator reason is escaped; an undeclared detection says where it came from.
    assert.ok(section.includes("Tilt the phone to steer &lt;b&gt;fast&lt;/b&gt;"));
    assert.ok(!section.includes("<b>fast</b>"));
    assert.ok(section.includes("Found in the game’s code"));
  });
});

test("listing says 'No special permissions' for a scanned game with none, 'Not checked yet' otherwise (#370)", () => {
  withPermissionBuild((page) => {
    assert.match(page("plain-game"), /No special permissions\./);
    assert.match(page("new-game"), /<h2>Permissions<\/h2>\s*<p class="app-perm-none">Not checked yet\.<\/p>/);
  });
});

test("game cards carry a compact permission icon row only when there is one (#370)", () => {
  withPermissionBuild((_page, index) => {
    const card = (id) => {
      const start = index.indexOf(`data-id="${id}"`);
      return index.slice(start, index.indexOf("</a>", start));
    };
    assert.match(card("tilt-game"), /class="app-perms" role="img" aria-label="Asks for: Motion sensors, Microphone, Gamepad"/);
    assert.ok(!card("plain-game").includes("app-perms"));
    assert.ok(!card("new-game").includes("app-perms"));
  });
});

test("the storefront's permission catalog matches the compliance package's (#370)", () => {
  const ts = readFileSync(join(REPO_ROOT, "..", "..", "packages", "compliance", "src", "lib", "permissions.ts"), "utf8");
  const fromCompliance = [...ts.matchAll(/\{ id: '([^']+)', name: '([^']+)', icon: '([^']+)'/g)].map((m) => [m[1], m[2], m[3]]);
  const js = readFileSync(BUILD_JS, "utf8");
  const block = js.slice(js.indexOf("const PERMISSION_INFO = {"), js.indexOf("};", js.indexOf("const PERMISSION_INFO = {")));
  const fromStorefront = [...block.matchAll(/^\s+'?([\w-]+)'?: \{ name: '([^']+)', icon: '([^']+)' \}/gm)].map((m) => [m[1], m[2], m[3]]);
  assert.ok(fromCompliance.length >= 10, "parsed the compliance catalog");
  assert.deepEqual(fromStorefront, fromCompliance);
});

test("the backfilled game-permissions.json covers every registry game (#370)", () => {
  const registry = JSON.parse(readFileSync(REAL_REGISTRY, "utf8"));
  const data = JSON.parse(readFileSync(join(REPO_ROOT, "game-permissions.json"), "utf8"));
  const missing = registry.games.map((g) => g.id).filter((id) => !data.games[id]);
  assert.deepEqual(missing, []);
});

// --- #364: the analytics page keeps the tag form when stats are unavailable ---

/** Runs analytics.js against a tiny fake DOM and a stubbed fetch. */
async function runAnalyticsPage(search, responses) {
  const { runInNewContext } = await import("node:vm");
  class Node {
    constructor(tag) {
      this.tagName = tag;
      this.attributes = {};
      this.children = [];
      this.listeners = {};
      this.className = "";
      this._text = null;
    }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    appendChild(c) { this.children.push(c); return c; }
    replaceChildren(...nodes) { this.children = nodes; }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    get textContent() { return this._text !== null ? this._text : this.children.map((c) => c.textContent).join(""); }
    set textContent(v) { this._text = String(v); this.children = []; }
    get value() { return this._value !== undefined ? this._value : this.attributes.value || ""; }
    set value(v) { this._value = v; }
  }
  const text = (t) => ({ textContent: t, children: [] });
  const root = new Node("div");
  const calls = [];
  const document = {
    getElementById: (id) => (id === "an-content" ? root : null),
    createElement: (t) => new Node(t),
    createElementNS: (_ns, t) => new Node(t),
    createTextNode: text,
  };
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const r = responses(url, init);
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  runInNewContext(readFileSync(join(REPO_ROOT, "analytics.js"), "utf8"), {
    document,
    fetch,
    location: { search },
    URLSearchParams,
    encodeURIComponent,
    JSON,
    Number,
    Array,
    Object,
    String,
  });
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  const all = [];
  const walk = (n) => { all.push(n); (n.children || []).forEach(walk); };
  walk(root);
  return { root, calls, all, flush: () => new Promise((r) => setImmediate(r)) };
}

const NO_STATS_BODY = {
  appId: "chess",
  days: 7,
  kind: "pageview",
  bucket: "day",
  path: null,
  config: { ga4: "G-ABC123", plausible: "chess.freegamestore.online" },
  stats: null,
  statsUnavailable: "not-configured",
};

test("analytics page explains missing stats and keeps the tag form seeded (#364)", async () => {
  const page = await runAnalyticsPage("?game=chess", () => ({ status: 200, body: NO_STATS_BODY }));
  const textAll = page.root.textContent;
  assert.match(textAll, /aren’t switched on yet/);
  assert.match(textAll, /Your analytics tags/);
  assert.doesNotMatch(textAll, /Something went wrong|not set up yet/);
  const inputs = page.all.filter((n) => n.tagName === "input");
  assert.deepEqual(inputs.map((n) => n.value), ["G-ABC123", "chess.freegamestore.online"]);
});

test("analytics page says 'couldn't be loaded' when the stats query failed (#364)", async () => {
  const page = await runAnalyticsPage("?game=chess", () => ({
    status: 200,
    body: { ...NO_STATS_BODY, statsUnavailable: "unavailable" },
  }));
  assert.match(page.root.textContent, /couldn’t be loaded right now/);
});

test("saving from the stats-less page keeps both saved tags (#364)", async () => {
  const page = await runAnalyticsPage("?game=chess", (_url, init) =>
    init && init.method === "PUT"
      ? { status: 200, body: { ok: true, config: NO_STATS_BODY.config } }
      : { status: 200, body: NO_STATS_BODY },
  );
  const form = page.all.find((n) => n.tagName === "form");
  form.listeners.submit({ preventDefault() {} });
  await page.flush();
  const put = page.calls.find((c) => c.init && c.init.method === "PUT");
  assert.deepEqual(JSON.parse(put.init.body), { ga4: "G-ABC123", plausible: "chess.freegamestore.online" });
});

test("storefront never lets a game take payments: payment=() and no payment delegation (#376)", () => {
  const { tmp, tmpDist } = runBuild();
  try {
    const headers = readFileSync(join(tmpDist, "_headers"), "utf8");
    assert.match(headers, /Permissions-Policy:[^\n]*\bpayment=\(\)/);
    // The preview iframes delegate some features to the embedded game, never payment.
    const pages = [readFileSync(join(tmpDist, "index.html"), "utf8")];
    const detailDir = join(tmpDist, "games");
    for (const f of readdirSync(detailDir).filter((n) => n.endsWith(".html")).slice(0, 5)) {
      pages.push(readFileSync(join(detailDir, f), "utf8"));
    }
    for (const html of pages) {
      for (const m of html.matchAll(/<iframe\b[^>]*\ballow="([^"]*)"/g)) {
        assert.doesNotMatch(m[1], /\bpayment\b/, `iframe allow="${m[1]}" delegates payment`);
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
