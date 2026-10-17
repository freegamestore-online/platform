import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __clearRouteCache,
  buildSyntheticVersion,
  contentType,
  etagsMatch,
  ROUTE_CACHE_NEG_TTL_MS,
  ROUTE_CACHE_TTL_MS,
  type Route,
  r2KeyFor,
  resolveRoute,
  resolveRouteCached,
  securityHeaders,
  shouldRevalidate,
} from "../host";

// Minimal D1 stub — verifies the SQL shape and parameter binding without
// spinning up a real D1. Real schema integration is exercised by the
// migration apply step + an end-to-end test against a deployed Worker.
function mockDb(rows: Route[]): D1Database {
  return {
    prepare: (_sql: string) => ({
      bind: (slug: string, zone: string) => ({
        first: async () => rows.find((r) => r.slug === slug && r.zone === zone) ?? null,
      }),
    }),
  } as unknown as D1Database;
}

// D1 stub that counts how many times a query is actually executed, so we can
// assert the cache collapses N asset requests into a single D1 read. Optionally
// throws to simulate a D1 blip.
function countingDb(rows: Route[], opts: { throwOnQuery?: boolean } = {}): { db: D1Database; calls: () => number } {
  let calls = 0;
  const db = {
    prepare: (_sql: string) => ({
      bind: (slug: string, zone: string) => ({
        first: async () => {
          calls++;
          if (opts.throwOnQuery) throw new Error("D1_ERROR: simulated blip");
          return rows.find((r) => r.slug === slug && r.zone === zone) ?? null;
        },
      }),
    }),
  } as unknown as D1Database;
  return { db, calls: () => calls };
}

const kanban: Route = { slug: "kanban", zone: "freegamestore.online", r2_prefix: "games/kanban", store: "games" };

describe("resolveRoute", () => {
  it("resolves a known subdomain", async () => {
    const r = await resolveRoute(mockDb([kanban]), "kanban.freegamestore.online");
    expect(r?.r2_prefix).toBe("games/kanban");
  });

  it("returns null for unknown subdomain", async () => {
    expect(await resolveRoute(mockDb([kanban]), "missing.freegamestore.online")).toBeNull();
  });

  it("handles uppercase host", async () => {
    expect(await resolveRoute(mockDb([kanban]), "Kanban.FreeGameStore.Online")).not.toBeNull();
  });

  it("strips port suffix", async () => {
    expect(await resolveRoute(mockDb([kanban]), "kanban.freegamestore.online:8443")).not.toBeNull();
  });

  it("returns null for apex (no subdomain)", async () => {
    expect(await resolveRoute(mockDb([kanban]), "freegamestore.online")).toBeNull();
  });

  it("returns null for empty host", async () => {
    expect(await resolveRoute(mockDb([kanban]), "")).toBeNull();
  });

  it("matches the right slug+zone among multiple rows", async () => {
    const games: Route = { slug: "kanban", zone: "freegamestore.online", r2_prefix: "games/kanban", store: "games" };
    const db = mockDb([kanban, games]);
    expect((await resolveRoute(db, "kanban.freegamestore.online"))?.r2_prefix).toBe("games/kanban");
    expect((await resolveRoute(db, "kanban.freegamestore.online"))?.r2_prefix).toBe("games/kanban");
  });
});

describe("resolveRouteCached (in-isolate route cache)", () => {
  beforeEach(() => {
    __clearRouteCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    __clearRouteCache();
  });

  it("collapses repeated lookups for the same host into a single D1 read", async () => {
    const { db, calls } = countingDb([kanban]);
    for (let i = 0; i < 50; i++) {
      const r = await resolveRouteCached(db, "kanban.freegamestore.online");
      expect(r?.r2_prefix).toBe("games/kanban");
    }
    expect(calls()).toBe(1);
  });

  it("re-queries D1 after the positive TTL expires", async () => {
    const { db, calls } = countingDb([kanban]);
    await resolveRouteCached(db, "kanban.freegamestore.online");
    expect(calls()).toBe(1);
    vi.advanceTimersByTime(ROUTE_CACHE_TTL_MS + 1);
    await resolveRouteCached(db, "kanban.freegamestore.online");
    expect(calls()).toBe(2);
  });

  it("caches negative lookups only briefly so a fresh publish appears quickly", async () => {
    const { db, calls } = countingDb([kanban]);
    // Unknown slug — cached, so a second immediate call does not re-hit D1.
    expect(await resolveRouteCached(db, "brandnew.freegamestore.online")).toBeNull();
    expect(await resolveRouteCached(db, "brandnew.freegamestore.online")).toBeNull();
    expect(calls()).toBe(1);
    // ...but the negative entry expires much sooner than a positive one.
    expect(ROUTE_CACHE_NEG_TTL_MS).toBeLessThan(ROUTE_CACHE_TTL_MS);
    vi.advanceTimersByTime(ROUTE_CACHE_NEG_TTL_MS + 1);
    expect(await resolveRouteCached(db, "brandnew.freegamestore.online")).toBeNull();
    expect(calls()).toBe(2);
  });

  it("keys the cache by cleaned host (case-insensitive, port-stripped)", async () => {
    const { db, calls } = countingDb([kanban]);
    await resolveRouteCached(db, "kanban.freegamestore.online");
    await resolveRouteCached(db, "KANBAN.FreeGameStore.Online");
    await resolveRouteCached(db, "kanban.freegamestore.online:8443");
    expect(calls()).toBe(1);
  });

  it("propagates a D1 error to the caller (handler wraps it into a 503)", async () => {
    const { db } = countingDb([kanban], { throwOnQuery: true });
    await expect(resolveRouteCached(db, "kanban.freegamestore.online")).rejects.toThrow(/D1_ERROR/);
  });
});

describe("r2KeyFor", () => {
  it("defaults / to index.html", () => {
    expect(r2KeyFor(kanban, "/")).toBe("games/kanban/index.html");
  });

  it("defaults directory paths to index.html", () => {
    expect(r2KeyFor(kanban, "/about/")).toBe("games/kanban/about/index.html");
  });

  it("strips leading slash", () => {
    expect(r2KeyFor(kanban, "/static/app.js")).toBe("games/kanban/static/app.js");
  });

  it("does not append index.html for files with extensions", () => {
    expect(r2KeyFor(kanban, "/style.css")).toBe("games/kanban/style.css");
  });
});

describe("contentType", () => {
  it.each([
    ["/index.html", "text/html; charset=utf-8"],
    ["/app.js", "application/javascript; charset=utf-8"],
    ["/app.mjs", "application/javascript; charset=utf-8"],
    ["/style.css", "text/css; charset=utf-8"],
    ["/logo.svg", "image/svg+xml"],
    ["/icon.png", "image/png"],
    ["/photo.jpg", "image/jpeg"],
    ["/font.woff2", "font/woff2"],
    ["/site.webmanifest", "application/manifest+json"],
    ["/binary.bin", "application/octet-stream"],
    ["/no-extension", "application/octet-stream"],
  ])("%s → %s", (path, expected) => {
    expect(contentType(path)).toBe(expected);
  });

  // Regression: a URL pathname of "/" has no extension and would resolve to
  // octet-stream; the Worker now feeds contentType the resolved R2 key
  // (apps/<slug>/index.html), which correctly resolves to text/html. This
  // matters because X-Content-Type-Options: nosniff turns octet-stream into
  // a download prompt instead of rendering.
  it("resolves text/html from a key built by r2KeyFor for `/`", () => {
    expect(contentType(r2KeyFor(kanban, "/"))).toBe("text/html; charset=utf-8");
  });

  it("resolves text/html from a key built for a directory path", () => {
    expect(contentType(r2KeyFor(kanban, "/about/"))).toBe("text/html; charset=utf-8");
  });
});

// The legacyProjectName + legacyFallback wiring isn't exported, so we can't
// unit-test it directly without refactoring (the function lives in index.ts).
// The proxy behavior is exercised by the live-deployed Worker against real
// `<slug>.freegamestore.online` URLs whose apps still live on CF Pages —
// any of `language`, `math`, `quiz`, `books`, `music` returning HTTP 200
// confirms the path works. If a regression breaks the fallback, those URLs
// return the Worker's 404 instead — the user-visible symptom that flagged
// the original bug.
// ---- Security headers: defense-in-depth baseline applied to every app. ----
// The analytics pipeline (loader, beacon, BYO tags) depends on these directives
// being permissive enough to allow the platform origins. A future tightening
// pass that drops the broad `https:` from script-src + connect-src must keep
// the explicit api.freegamestore.online / cloudflareinsights / googletagmanager /
// plausible.io origins or analytics breaks across every game.

describe("buildSyntheticVersion (fallback version.json from R2 metadata)", () => {
  const body = buildSyntheticVersion("pong", new Date("2026-07-04T09:30:00.000Z"), '"abc123etag"');
  const parsed = JSON.parse(body);
  it("reports repo, deploy time, and a version from the etag", () => {
    expect(parsed.repo).toBe("pong");
    expect(parsed.deployedAt).toBe("2026-07-04T09:30:00.000Z");
    expect(parsed.version).toBe("abc123etag"); // quotes stripped
    expect(parsed.source).toBe("r2-metadata");
  });
  it("emits valid, parseable JSON", () => {
    expect(() => JSON.parse(body)).not.toThrow();
  });
});

describe("shouldRevalidate (cache policy for stable-named, changing files)", () => {
  it("revalidates HTML and version.json (stable name, changing content)", () => {
    expect(shouldRevalidate("text/html; charset=utf-8", "games/pong/index.html")).toBe(true);
    expect(shouldRevalidate("application/json; charset=utf-8", "games/pong/version.json")).toBe(true);
  });
  it("lets content-hashed bundle assets stay immutable", () => {
    expect(shouldRevalidate("application/javascript; charset=utf-8", "games/pong/assets/index-BN71jIs_.js")).toBe(false);
    expect(shouldRevalidate("text/css; charset=utf-8", "games/pong/assets/index-CaUCB4gH.css")).toBe(false);
  });
  it("revalidates stable-named public/ files (data, manifest, media) so a redeploy isn't pinned for a year", () => {
    // These come from web/public/ (stable names, changing content) — only hashed
    // bundles under assets/ may be immutable.
    expect(shouldRevalidate("application/json; charset=utf-8", "games/pong/data/levels.json")).toBe(true);
    expect(shouldRevalidate("application/json; charset=utf-8", "games/pong/manifest.json")).toBe(true);
    expect(shouldRevalidate("image/png", "games/pong/sprites.png")).toBe(true);
    expect(shouldRevalidate("audio/mpeg", "games/pong/theme.mp3")).toBe(true);
  });
});

describe("securityHeaders", () => {
  const html = securityHeaders({ revalidate: true });
  const asset = securityHeaders({ revalidate: false });

  it("revalidated files get short cache, immutable assets get 1-year cache", () => {
    expect(html.get("cache-control")).toContain("max-age=60");
    expect(html.get("cache-control")).toContain("must-revalidate");
    expect(html.get("cache-control")).not.toContain("immutable");
    expect(asset.get("cache-control")).toContain("max-age=31536000");
    expect(asset.get("cache-control")).toContain("immutable");
  });

  it("CSP allows this store's own analytics loader endpoint (FGS, not FAS)", () => {
    const csp = html.get("content-security-policy") ?? "";
    expect(csp).toContain("https://api.freegamestore.online");
    expect(csp).toMatch(/script-src[^;]*https:\/\/api\.freegamestore\.online/);
    expect(csp).toMatch(/connect-src[^;]*https:\/\/api\.freegamestore\.online/);
    // Regression: must NOT reference a sibling store's origin.
    expect(csp).not.toContain("freeappstore.online");
  });

  it("CSP allows CF Web Analytics beacon (cookieless first-party)", () => {
    const csp = html.get("content-security-policy") ?? "";
    expect(csp).toContain("https://static.cloudflareinsights.com");
    expect(csp).toContain("https://cloudflareinsights.com");
  });

  it("CSP allows BYO Google Analytics 4 tags", () => {
    const csp = html.get("content-security-policy") ?? "";
    expect(csp).toContain("https://www.googletagmanager.com");
    expect(csp).toContain("https://www.google-analytics.com");
  });

  it("CSP allows BYO Plausible tags", () => {
    const csp = html.get("content-security-policy") ?? "";
    expect(csp).toContain("https://plausible.io");
  });

  it("CSP has NO wildcard https:/wss: in script-src or connect-src (games can't inject/exfil)", () => {
    const csp = html.get("content-security-policy") ?? "";
    const sources = (name: string) =>
      (
        csp
          .split(";")
          .map((d) => d.trim())
          .find((d) => d.startsWith(`${name} `)) ?? ""
      )
        .split(/\s+/)
        .slice(1);
    // A bare `https:`/`wss:` source would let a malicious game load arbitrary
    // external scripts or exfiltrate data to any host. Only the named
    // platform + analytics allowlist may appear.
    expect(sources("script-src")).not.toContain("https:");
    expect(sources("connect-src")).not.toContain("https:");
    expect(sources("connect-src")).not.toContain("wss:");
    // ...but the sanctioned platform origin is still reachable.
    expect(sources("connect-src")).toContain("https://*.freegamestore.online");
  });

  it("CSP locks down object-src and base-uri (defense-in-depth)", () => {
    const csp = html.get("content-security-policy") ?? "";
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).toMatch(/base-uri 'self'/);
  });

  it("frame-ancestors allows storefront preview iframes only", () => {
    const csp = html.get("content-security-policy") ?? "";
    expect(csp).toContain("frame-ancestors 'self' https://freegamestore.online");
    expect(csp).toContain("https://freegamestore.pages.dev");
    expect(csp).toContain("https://*.freegamestore.online");
  });

  it("upgrades insecure requests + sets HSTS", () => {
    expect(html.get("content-security-policy")).toContain("upgrade-insecure-requests");
    expect(html.get("strict-transport-security")).toMatch(/max-age=\d+/);
    expect(html.get("strict-transport-security")).toContain("includeSubDomains");
  });

  it("disables powerful APIs by default (Permissions-Policy)", () => {
    const pp = html.get("permissions-policy") ?? "";
    expect(pp).toContain("geolocation=()");
    expect(pp).toContain("camera=()");
    expect(pp).toContain("microphone=()");
    expect(pp).toContain("payment=()");
    expect(pp).toContain("interest-cohort=()");
  });

  it("sets nosniff + strict referrer policy", () => {
    expect(html.get("x-content-type-options")).toBe("nosniff");
    expect(html.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });
});

describe("etagsMatch (304 Not Modified)", () => {
  it("returns false when no If-None-Match header is sent", () => {
    expect(etagsMatch(null, '"abc"')).toBe(false);
  });

  it("matches a single quoted etag exactly", () => {
    expect(etagsMatch('"abc"', '"abc"')).toBe(true);
    expect(etagsMatch('"abc"', '"def"')).toBe(false);
  });

  it("matches against a comma-separated list", () => {
    expect(etagsMatch('"abc", "def", "ghi"', '"def"')).toBe(true);
    expect(etagsMatch('"abc", "def"', '"xyz"')).toBe(false);
  });

  it("wildcard * matches any etag", () => {
    expect(etagsMatch("*", '"anything"')).toBe(true);
  });

  it("trims whitespace around list entries", () => {
    expect(etagsMatch('  "abc"  ,  "def"  ', '"def"')).toBe(true);
  });

  it("treats empty header as no-match", () => {
    expect(etagsMatch("", '"abc"')).toBe(false);
    expect(etagsMatch("   ", '"abc"')).toBe(false);
  });
});

describe("legacy fallback (integration shape only)", () => {
  // legacyProjectName + GAME_PROJECT_OVERRIDES live in src/index.ts (not
  // exported), so we mirror the rules here. If admin's STORE_CONFIG or
  // the override table changes, this test breaks and tells you to
  // update the host worker to match.
  it("standard games map to free<slug>app", () => {
    const cases = [
      ["2048", "free2048app"],
      ["chess", "freechessapp"],
      ["wordle", "freewordleapp"],
      ["snake", "freesnakeapp"],
    ];
    for (const [slug, expected] of cases) {
      const overrides: Record<string, string> = { puzzle: "freepuzzle" };
      const projected = overrides[slug] ?? `free${slug}app`;
      expect(projected).toBe(expected);
    }
  });

  it("puzzle is an outlier — maps to freepuzzle (no `app` suffix)", () => {
    const overrides: Record<string, string> = { puzzle: "freepuzzle" };
    expect(overrides["puzzle"] ?? `freepuzzleapp`).toBe("freepuzzle");
  });
});

// --- analytics loader (fleet-wide /v1/analytics.js) ---
import worker from "../index";
import { ANALYTICS_APP_ID_RE, buildAnalyticsLoader } from "../analytics";

// The fetch handler must degrade a backend blip to a clean 503, not throw.
describe("fetch handler resilience (D1 blip → 503, not raw 500)", () => {
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

  const envWith = (db: D1Database) => ({ DB: db, APPS: {} as R2Bucket }) as never;

  it("returns 503 (not an exception) when the route lookup throws", async () => {
    __clearRouteCache();
    const { db } = countingDb([], { throwOnQuery: true });
    const req = new Request("https://brokengame.freegamestore.online/index.html", {
      headers: { host: "brokengame.freegamestore.online" },
    });
    const res = await worker.fetch(req, envWith(db), ctx);
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("5");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("still returns 404 (not 503) for a genuinely-unknown slug", async () => {
    __clearRouteCache();
    const { db } = countingDb([]); // healthy D1, no matching row
    const req = new Request("https://nosuchgame.freegamestore.online/", {
      headers: { host: "nosuchgame.freegamestore.online" },
    });
    const res = await worker.fetch(req, envWith(db), ctx);
    expect(res.status).toBe(404);
  });
});

describe("analytics loader", () => {
  it("accepts valid game ids incl. leading-digit (2048)", () => {
    expect(ANALYTICS_APP_ID_RE.test("tetris")).toBe(true);
    expect(ANALYTICS_APP_ID_RE.test("kart-racers")).toBe(true);
    expect(ANALYTICS_APP_ID_RE.test("2048")).toBe(true);
  });

  it("rejects malformed ids", () => {
    expect(ANALYTICS_APP_ID_RE.test("Bad_Id")).toBe(false);
    expect(ANALYTICS_APP_ID_RE.test("-lead")).toBe(false);
    expect(ANALYTICS_APP_ID_RE.test("has space")).toBe(false);
    expect(ANALYTICS_APP_ID_RE.test("")).toBe(false);
  });

  it("returns valid JS with the app id embedded + a safe event sender, no beacon when unset", () => {
    const js = buildAnalyticsLoader("tetris", null);
    expect(js).toContain('"tetris"');
    expect(js).toContain("window.fgsAnalytics");
    expect(js).toContain("window.fgsAnalytics.event = function");
    expect(js).not.toContain("cloudflareinsights");
  });

  it("injects the CF Web Analytics beacon only when a token is set", () => {
    const js = buildAnalyticsLoader("tetris", "abc123def456");
    expect(js).toContain("static.cloudflareinsights.com/beacon.min.js");
    expect(js).toContain("abc123def456");
  });

  it("JSON-escapes the app id so it can't break out of the string literal", () => {
    const js = buildAnalyticsLoader('a"};alert(1);//', null);
    expect(js).toContain('"a\\"};alert(1);//"');
    expect(js).not.toContain('APP = "a";');
  });
});
