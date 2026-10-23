import { describe, expect, it, vi } from "vitest";
vi.mock('../seo', async (original) => ({ ...await original<typeof import('../seo')>(), publicGame: vi.fn().mockResolvedValue(undefined) }));
import { __clearRouteCache, type Route } from "../host";
import worker from "../index";

// #376: FreeGameStore games take no payments. EVERY response on a game host
// carries Permissions-Policy payment=() so the browser refuses the Payment
// Request API, including error pages a game could otherwise be framed around.

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const route: Route = { slug: "space", zone: "freegamestore.online", r2_prefix: "games/space", store: "games" };

const db = (found: boolean, fail = false) =>
  ({
    prepare: () => ({
      bind: () => ({
        first: async () => {
          if (fail) throw new Error("D1 down");
          return found ? route : null;
        },
      }),
    }),
  }) as unknown as D1Database;

/** R2 with index.html and app.js; anything else is missing. */
const bucket = {
  get: async (key: string) =>
    key === "games/space/index.html" || key === "games/space/app.js"
      ? ({ size: 5, httpEtag: '"e1"', uploaded: new Date(0), body: "hello" } as unknown as R2ObjectBody)
      : null,
} as unknown as R2Bucket;

async function hit(path: string, init: RequestInit & { found?: boolean; failDb?: boolean } = {}) {
  __clearRouteCache();
  const host = init.found === false ? "nope.freegamestore.online" : "space.freegamestore.online";
  const req = new Request(`https://${host}${path}`, { ...init, headers: { host, ...(init.headers ?? {}) } });
  return worker.fetch(req, { DB: db(init.found !== false, init.failDb), APPS: bucket } as never, ctx);
}

const payment = (res: Response) =>
  (res.headers.get("permissions-policy") ?? "")
    .split(",")
    .map((e) => e.trim())
    .find((e) => e.startsWith("payment="));

describe("payment=() on every game response (#376)", () => {
  it.each([
    ["a served file", () => hit("/app.js"), 200],
    ["the SPA fallback page", () => hit("/level/3"), 200],
    ["a 304 revalidation", () => hit("/app.js", { headers: { "if-none-match": '"e1"' } }), 304],
    ["a range response", () => hit("/app.js", { headers: { range: "bytes=0-1" } }), 200],
    ["version.json", () => hit("/version.json"), 200],
    ["a missing asset (404)", () => hit("/missing.png"), 404],
    ["an unregistered game (404)", () => hit("/", { found: false }), 404],
    ["a non-GET method (405)", () => hit("/", { method: "POST" }), 405],
    ["a backend outage (503)", () => hit("/", { failDb: true }), 503],
  ])("%s", async (_label, call, status) => {
    const res = await call();
    expect(res.status).toBe(status);
    expect(payment(res)).toBe("payment=()");
  });
});
