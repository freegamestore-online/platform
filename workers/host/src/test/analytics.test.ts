import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyticsLoaderResponse,
  classifyUA,
  collectEvents,
  corsHeaders,
  effectiveTimestamp,
  flattenProps,
  type GameAnalyticsConfig,
  isAllowedOrigin,
  safeReferrerHost,
} from "../analytics";
import worker from "../index";
import type { Env } from "../host";

const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15";
const NOW = Date.parse("2026-10-18T12:00:00Z");

/** D1 stub: `game_analytics` lookups return `row`; `fail` makes the query throw. */
function fakeDb(row: GameAnalyticsConfig | null, opts: { fail?: boolean } = {}): D1Database {
  return {
    prepare: () => ({
      bind: () => ({
        first: async () => {
          if (opts.fail) throw new Error("D1 unavailable");
          return row;
        },
      }),
    }),
  } as unknown as D1Database;
}

function fakeAnalytics() {
  return { writeDataPoint: vi.fn() } as unknown as AnalyticsEngineDataset & {
    writeDataPoint: ReturnType<typeof vi.fn>;
  };
}

function eventReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://api.freegamestore.online/v1/analytics/event", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": DESKTOP_UA, origin: "https://2048.freegamestore.online", "cf-connecting-ip": "203.0.113.1", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

describe("per-game loader", () => {
  it("includes the GA4 tag and Plausible domain from the game's config row", async () => {
    const env = { DB: fakeDb({ cf_beacon_token: null, ga4: "G-ABC123", plausible: "2048.freegamestore.online", custom_head: null }), APPS: {} } as unknown as Env;
    const res = await analyticsLoaderResponse(new URL("https://api.freegamestore.online/v1/analytics.js?app=2048"), env, ctx);
    const js = await res.text();
    expect(res.status).toBe(200);
    expect(js).toContain("googletagmanager.com/gtag/js?id=");
    expect(js).toContain("G-ABC123");
    expect(js).toContain("plausible.io/js/script.js");
    expect(js).toContain('"data-domain": "2048.freegamestore.online"');
  });

  it("drops a malformed GA4 id and a malformed Plausible domain rather than injecting them", async () => {
    const env = { DB: fakeDb({ cf_beacon_token: null, ga4: 'G-"><script>', plausible: "not a domain", custom_head: null }), APPS: {} } as unknown as Env;
    const js = await (await analyticsLoaderResponse(new URL("https://api.freegamestore.online/v1/analytics.js?app=tetris"), env, ctx)).text();
    expect(js).not.toContain("googletagmanager");
    expect(js).not.toContain("plausible.io");
    expect(js).not.toContain("<script>");
  });

  it("falls back to the store-wide beacon token when the game has none of its own", async () => {
    const env = { DB: fakeDb(null), APPS: {}, CF_BEACON_TOKEN: "abc123def456abc123def456" } as unknown as Env;
    const js = await (await analyticsLoaderResponse(new URL("https://api.freegamestore.online/v1/analytics.js?app=tetris"), env, ctx)).text();
    expect(js).toContain("static.cloudflareinsights.com/beacon.min.js");
    expect(js).toContain("abc123def456abc123def456");
  });

  it("uses the game's own beacon token over the store-wide one", async () => {
    const env = { DB: fakeDb({ cf_beacon_token: "1111222233334444aaaabbbbccccdddd", ga4: null, plausible: null, custom_head: null }), APPS: {}, CF_BEACON_TOKEN: "ffffeeeeddddccccbbbbaaaa99998888" } as unknown as Env;
    const js = await (await analyticsLoaderResponse(new URL("https://api.freegamestore.online/v1/analytics.js?app=tetris"), env, ctx)).text();
    expect(js).toContain("1111222233334444aaaabbbbccccdddd");
    expect(js).not.toContain("ffffeeeeddddccccbbbbaaaa99998888");
  });

  it("serves the fallback loader when the config read fails, without caching it", async () => {
    const cacheCtx = { waitUntil: vi.fn(), passThroughOnException: () => {} } as unknown as ExecutionContext;
    const env = { DB: fakeDb(null, { fail: true }), APPS: {} } as unknown as Env;
    const res = await analyticsLoaderResponse(new URL("https://api.freegamestore.online/v1/analytics.js?app=tetris"), env, cacheCtx);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("window.fgsAnalytics");
    expect(cacheCtx.waitUntil).not.toHaveBeenCalled();
  });

  it("answers an invalid app id with a 200 comment, never an error", async () => {
    const env = { DB: fakeDb(null), APPS: {} } as unknown as Env;
    const res = await analyticsLoaderResponse(new URL("https://api.freegamestore.online/v1/analytics.js?app=Bad_Id"), env, ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("invalid app id");
  });

  it("is served by the fetch handler on the api host", async () => {
    const env = { DB: fakeDb(null), APPS: {} } as unknown as Env;
    const res = await worker.fetch(new Request("https://api.freegamestore.online/v1/analytics.js?app=tetris"), env, ctx);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("event ingest: POST /v1/analytics/event", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("writes one Analytics Engine point per event with the expected blobs and doubles", async () => {
    const analytics = fakeAnalytics();
    const res = await collectEvents(
      eventReq({ app: "2048", kind: "pageview", path: "/play?x=1", referrer: "https://news.example.com/post/1", t: NOW }),
      { ANALYTICS: analytics } as unknown as Env,
      NOW,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("x-events-accepted")).toBe("1");
    expect(analytics.writeDataPoint).toHaveBeenCalledWith({
      indexes: ["2048"],
      blobs: ["2048", "pageview", "/play?x=1", "news.example.com", "", "desktop", ""],
      doubles: [1, NOW],
    });
  });

  it("accepts a batch and writes each valid event, skipping malformed entries", async () => {
    const analytics = fakeAnalytics();
    const res = await collectEvents(
      eventReq({ events: [{ app: "tetris", kind: "level_won", props: { level: 3 } }, { app: "BAD ID", kind: "x" }, "not-an-object", { app: "tetris", kind: "Bad-Kind!" }] }),
      { ANALYTICS: analytics } as unknown as Env,
      NOW,
    );
    expect(res.headers.get("x-events-accepted")).toBe("1");
    expect(analytics.writeDataPoint).toHaveBeenCalledTimes(1);
    const point = analytics.writeDataPoint.mock.calls[0][0];
    expect(point.blobs[1]).toBe("level_won");
    expect(point.blobs[6]).toBe('{"level":"3"}');
  });

  it("drops bot user-agents without writing", async () => {
    const analytics = fakeAnalytics();
    const res = await collectEvents(eventReq({ app: "tetris" }, { "user-agent": "Googlebot/2.1" }), { ANALYTICS: analytics } as unknown as Env, NOW);
    expect(res.status).toBe(204);
    expect(analytics.writeDataPoint).not.toHaveBeenCalled();
  });

  it("rejects non-JSON with 400", async () => {
    const res = await collectEvents(eventReq("{not json"), {} as Env, NOW);
    expect(res.status).toBe(400);
  });

  it("caps a single game/IP/kind at 50 events per 10 second window", async () => {
    const analytics = fakeAnalytics();
    const ip = "198.51.100.77";
    let accepted = 0;
    for (let i = 0; i < 60; i++) {
      const res = await collectEvents(eventReq({ app: "tetris", kind: "tick" }, { "cf-connecting-ip": ip }), { ANALYTICS: analytics } as unknown as Env, NOW);
      accepted += Number(res.headers.get("x-events-accepted"));
    }
    expect(accepted).toBe(50);
    expect(analytics.writeDataPoint).toHaveBeenCalledTimes(50);
  });

  it("answers OPTIONS preflight from a FGS origin and not from a foreign one", async () => {
    const env = {} as Env;
    const ok = await worker.fetch(
      new Request("https://api.freegamestore.online/v1/analytics/event", { method: "OPTIONS", headers: { origin: "https://2048.freegamestore.online" } }),
      env,
      ctx,
    );
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://2048.freegamestore.online");
    expect(ok.headers.get("access-control-allow-methods")).toContain("POST");

    const foreign = await worker.fetch(
      new Request("https://api.freegamestore.online/v1/analytics/event", { method: "OPTIONS", headers: { origin: "https://evil.example" } }),
      env,
      ctx,
    );
    expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("returns 405 for non-POST methods on the event path", async () => {
    const res = await worker.fetch(new Request("https://api.freegamestore.online/v1/analytics/event"), {} as Env, ctx);
    expect(res.status).toBe(405);
  });

  it("does not echo CORS headers to a foreign origin on a successful POST", async () => {
    const res = await collectEvents(eventReq({ app: "tetris" }, { origin: "https://evil.example" }), {} as Env, NOW);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("ingest helpers", () => {
  it("allows only https freegamestore.online origins", () => {
    expect(isAllowedOrigin("https://freegamestore.online")).toBe(true);
    expect(isAllowedOrigin("https://tetris.freegamestore.online")).toBe(true);
    expect(isAllowedOrigin("http://tetris.freegamestore.online")).toBe(false);
    expect(isAllowedOrigin("https://freegamestore.online.evil.example")).toBe(false);
    expect(isAllowedOrigin("https://notfreegamestore.online")).toBe(false);
    expect(isAllowedOrigin("not a url")).toBe(false);
    expect(corsHeaders(null)).toEqual({});
  });

  it("classifies user agents as bot, mobile or desktop", () => {
    expect(classifyUA("Googlebot/2.1")).toBe("bot");
    expect(classifyUA("curl/8.0")).toBe("bot");
    expect(classifyUA("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)")).toBe("mobile");
    expect(classifyUA(DESKTOP_UA)).toBe("desktop");
    expect(classifyUA(null)).toBe("desktop");
  });

  it("keeps only the referrer hostname", () => {
    expect(safeReferrerHost("https://news.example.com/a/b?q=secret")).toBe("news.example.com");
    expect(safeReferrerHost("not a url")).toBe("");
    expect(safeReferrerHost(undefined)).toBe("");
  });

  it("caps event props at 8 entries, 32-char keys and 64-char values", () => {
    const props: Record<string, unknown> = { long: "x".repeat(200), ["k".repeat(40)]: "dropped" };
    for (let i = 0; i < 10; i++) props[`p${i}`] = i;
    const out = JSON.parse(flattenProps(props));
    expect(Object.keys(out).length).toBeLessThanOrEqual(8);
    expect(out.long).toHaveLength(64);
    expect(Object.keys(out)).not.toContain("k".repeat(40));
  });

  it("uses server time for timestamps that are far in the future or outside the replay window", () => {
    expect(effectiveTimestamp(NOW - 60_000, NOW)).toBe(NOW - 60_000);
    expect(effectiveTimestamp(NOW + 60 * 60 * 1000, NOW)).toBe(NOW);
    expect(effectiveTimestamp(NOW - 100 * 60 * 60 * 1000, NOW)).toBe(NOW);
    expect(effectiveTimestamp(undefined, NOW)).toBe(NOW);
  });
});
