/**
 * Game usage analytics for FreeGameStore (#350). Ported from
 * freeappstore-online/platform `routes/analytics.ts` and adapted for games.
 *
 *   * Loader: GET api.freegamestore.online/v1/analytics.js?app=<id>
 *     Per-game JavaScript, built from the `game_analytics` D1 row. It injects
 *     the owner-configured tags (Cloudflare Web Analytics beacon, GA4, Plausible,
 *     a custom head snippet) and defines `window.fgsAnalytics`.
 *   * Ingest: POST api.freegamestore.online/v1/analytics/event
 *     One Analytics Engine row per page view or custom event. Accepts a single
 *     event or a `{ events: [...] }` batch.
 *
 * Cookieless and no PII: the IP and the full user-agent are never stored. Only
 * the bot/mobile/desktop class, the referrer's hostname and the country are kept.
 */

import type { Env } from "./host";

/** A game id: lowercase slug, may start with a digit (e.g. "2048"), ≤58 chars. */
export const ANALYTICS_APP_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/;
const GA4_RE = /^G-[A-Z0-9]{6,12}$/i;
const DOMAIN_RE = /^[a-z0-9][a-z0-9.-]{0,253}\.[a-z]{2,}$/i;
const CF_TOKEN_RE = /^[a-f0-9]{32,}$/i;
const CUSTOM_HEAD_MAX = 4096;
const EVENT_KIND_RE = /^[a-z][a-z0-9_]{0,31}$/;
const PATH_MAX = 256;
const REFERRER_HOST_MAX = 120;
const PROPS_MAX = 8;
const MAX_BATCH = 100;
const T_WINDOW_MS = 72 * 60 * 60 * 1000; // accept replays up to 72h old
const SAMPLE_BUCKET_SECONDS = 10;
const SAMPLE_MAX_PER_BUCKET = 50;
const LOADER_CACHE_TTL = 3600;

export const ANALYTICS_API_BASE = "https://api.freegamestore.online";

/** The per-game config row. Owner-set (BYO tags); the beacon token is platform-set. */
export interface GameAnalyticsConfig {
  cf_beacon_token: string | null;
  ga4: string | null;
  plausible: string | null;
  custom_head: string | null;
}

/** Reads a game's analytics config. Returns null when the game has none. */
export async function loadGameAnalytics(
  db: D1Database,
  gameId: string,
): Promise<GameAnalyticsConfig | null> {
  return await db
    .prepare(
      `SELECT cf_beacon_token, ga4, plausible, custom_head FROM game_analytics WHERE game_id = ?`,
    )
    .bind(gameId)
    .first<GameAnalyticsConfig>();
}

// -----------------------------------------------------------------------------
// Loader
// -----------------------------------------------------------------------------

/** Builds the per-game loader. The event sender is always included, so
 *  `window.fgsAnalytics.event()` never throws. Tags are included only when
 *  the game's config (or the store-wide fallback beacon) provides them. */
export function buildGameLoader(
  gameId: string,
  config: GameAnalyticsConfig | null,
  fallbackBeaconToken: string | null,
  apiBase: string = ANALYTICS_API_BASE,
): string {
  const parts: string[] = [];
  const rowToken = config?.cf_beacon_token;
  const beaconToken =
    rowToken && CF_TOKEN_RE.test(rowToken) ? rowToken : (fallbackBeaconToken ?? null);
  if (beaconToken) {
    parts.push(
      `script("https://static.cloudflareinsights.com/beacon.min.js", {defer: true, "data-cf-beacon": ${JSON.stringify(JSON.stringify({ token: beaconToken, spa: true }))}});`,
    );
  }
  if (config?.ga4 && GA4_RE.test(config.ga4)) {
    parts.push(
      `script("https://www.googletagmanager.com/gtag/js?id=" + ${JSON.stringify(config.ga4)}, {async: true});`,
    );
  }
  if (config?.plausible && DOMAIN_RE.test(config.plausible)) {
    parts.push(
      `script("https://plausible.io/js/script.js", {defer: true, "data-domain": ${JSON.stringify(config.plausible)}});`,
    );
  }
  if (config?.custom_head && config.custom_head.length <= CUSTOM_HEAD_MAX) {
    parts.push(`raw(${JSON.stringify(config.custom_head)});`);
  }

  const app = JSON.stringify(gameId);
  const eventUrl = JSON.stringify(`${apiBase}/v1/analytics/event`);
  return `(function(){
  var APP = ${app};
  var EVENT_URL = ${eventUrl};
  function script(src, attrs){
    var s = document.createElement("script");
    s.src = src;
    for (var k in attrs) { if (attrs[k] === true) s.setAttribute(k, ""); else s.setAttribute(k, attrs[k]); }
    document.head.appendChild(s);
  }
  function raw(html){
    var t = document.createElement("template");
    t.innerHTML = html;
    while (t.content.firstChild) document.head.appendChild(t.content.firstChild);
  }
  function send(kind, props){
    var evt = {app: APP, kind: kind, path: location.pathname, referrer: document.referrer, props: props || null, t: Date.now()};
    var body = JSON.stringify(evt);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(EVENT_URL, new Blob([body], {type: "application/json"}))) return;
    } catch (e) {}
    try {
      fetch(EVENT_URL, {method: "POST", headers: {"Content-Type": "application/json"}, body: body, keepalive: true, mode: "cors"}).catch(function(){});
    } catch (e) {}
  }
  window.fgsAnalytics = window.fgsAnalytics || {};
  window.fgsAnalytics.app = APP;
  window.fgsAnalytics.event = function(kind, props){ send(String(kind || "event").toLowerCase(), props); };
  ${parts.join("\n  ")}
  send("pageview");
  var _push = history.pushState, _replace = history.replaceState;
  history.pushState = function(){ _push.apply(this, arguments); send("pageview"); };
  history.replaceState = function(){ _replace.apply(this, arguments); send("pageview"); };
  window.addEventListener("popstate", function(){ send("pageview"); });
})();
`;
}

/** Kept for existing callers: the loader with no per-game config. */
export function buildAnalyticsLoader(appId: string, beaconToken: string | null): string {
  return buildGameLoader(appId, null, beaconToken);
}

/** Serves GET /v1/analytics.js?app=<id>. Always 200 with valid JS: an invalid id
 *  or a D1 failure degrades to a no-op or fallback loader, never a console error. */
export async function analyticsLoaderResponse(
  url: URL,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const appId = url.searchParams.get("app") ?? "";
  const valid = ANALYTICS_APP_ID_RE.test(appId);
  const cache = typeof caches !== "undefined" ? caches.default : undefined;
  const cacheUrl = `https://fgs-analytics-loader/${valid ? appId : "_invalid"}`;
  if (cache) {
    const hit = await cache.match(cacheUrl);
    if (hit) return hit;
  }

  let body = "/* fgs analytics: invalid app id */\n";
  // Cache only a loader built from a successful config read. A D1 failure serves
  // the fallback without caching it, so a blip can't stick for an hour.
  let cacheable = valid;
  if (valid) {
    let config: GameAnalyticsConfig | null = null;
    try {
      config = await loadGameAnalytics(env.DB, appId);
    } catch {
      cacheable = false;
    }
    body = buildGameLoader(appId, config, env.CF_BEACON_TOKEN ?? null);
  }

  const res = new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": `public, max-age=${LOADER_CACHE_TTL}, s-maxage=${LOADER_CACHE_TTL}`,
      "access-control-allow-origin": "*",
    },
  });
  if (cache && cacheable) ctx.waitUntil(cache.put(cacheUrl, res.clone()));
  return res;
}

// -----------------------------------------------------------------------------
// Ingest
// -----------------------------------------------------------------------------

export interface CollectItem {
  app?: string;
  kind?: string;
  path?: string;
  referrer?: string;
  props?: Record<string, unknown>;
  t?: number;
}

/** Hosts a browser may send events from: freegamestore.online and its subdomains. */
export function isAllowedOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return url.hostname === "freegamestore.online" || url.hostname.endsWith(".freegamestore.online");
}

/** CORS headers for the event ingest. Empty when the origin isn't a FGS host. */
export function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !isAllowedOrigin(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    vary: "Origin",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  };
}

/** One event, or the entries of a `{ events }` batch. Non-objects are dropped. */
export function collectItems(body: unknown): CollectItem[] {
  if (!body || typeof body !== "object") return [];
  const batch = (body as { events?: unknown }).events;
  if (Array.isArray(batch)) {
    return batch
      .slice(0, MAX_BATCH)
      .filter((item): item is CollectItem => !!item && typeof item === "object");
  }
  return [body as CollectItem];
}

/** Bot UAs are dropped; anything mobile-looking is "mobile"; the rest "desktop". */
export function classifyUA(ua: string | null): "bot" | "mobile" | "desktop" {
  if (!ua) return "desktop";
  if (/bot|crawler|spider|curl|wget|python|node/i.test(ua)) return "bot";
  if (/iphone|android|mobile/i.test(ua)) return "mobile";
  return "desktop";
}

/** The referrer's hostname only, so no path or query is stored. */
export function safeReferrerHost(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    return new URL(raw).hostname.slice(0, REFERRER_HOST_MAX);
  } catch {
    return "";
  }
}

/** Custom-event props as a JSON string: at most 8 entries, keys ≤32 chars, values ≤64. */
export function flattenProps(props: Record<string, unknown> | undefined): string {
  if (!props) return "";
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(props).slice(0, PROPS_MAX)) {
    if (k.length > 32) continue;
    out[k] = String(v).slice(0, 64);
  }
  return JSON.stringify(out);
}

/** A client-recorded time is kept when it's within the replay window (72h back,
 *  5 min ahead for clock skew). Otherwise the server time is used. */
export function effectiveTimestamp(t: number | undefined, nowMs: number): number {
  if (typeof t !== "number" || !Number.isFinite(t)) return nowMs;
  if (t > nowMs + 5 * 60 * 1000) return nowMs;
  if (t < nowMs - T_WINDOW_MS) return nowMs;
  return t;
}

// Per-(game, IP, kind) rate ceiling. Legitimate traffic stays well under it;
// runaway clients are sampled down. The map is per isolate, which is enough
// for cost protection.
const sampleBuckets = new Map<string, { windowStart: number; count: number }>();

export function shouldAccept(key: string, nowMs: number): boolean {
  const windowStart = Math.floor(nowMs / 1000 / SAMPLE_BUCKET_SECONDS) * SAMPLE_BUCKET_SECONDS;
  const cur = sampleBuckets.get(key);
  if (!cur || cur.windowStart !== windowStart) {
    sampleBuckets.set(key, { windowStart, count: 1 });
    // Bound memory: clearing is cheap next to unbounded Analytics Engine writes.
    if (sampleBuckets.size > 1024) sampleBuckets.clear();
    return true;
  }
  cur.count += 1;
  return cur.count <= SAMPLE_MAX_PER_BUCKET;
}

/** POST /v1/analytics/event. Public (no auth), called from every visitor's browser.
 *  Returns 204 even when nothing is written, so a client can't probe for config. */
export async function collectEvents(req: Request, env: Env, nowMs: number = Date.now()): Promise<Response> {
  const cors = corsHeaders(req.headers.get("origin"));
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("invalid json", { status: 400, headers: cors });
  }

  const uaClass = classifyUA(req.headers.get("user-agent"));
  if (uaClass === "bot") return new Response(null, { status: 204, headers: cors });

  const ip = req.headers.get("cf-connecting-ip") ?? "";
  const country = ((req as Request & { cf?: { country?: string } }).cf?.country ?? "").slice(0, 2);

  let accepted = 0;
  for (const item of collectItems(body)) {
    const gameId = (item.app ?? "").trim();
    if (!ANALYTICS_APP_ID_RE.test(gameId)) continue;
    const kind = (item.kind ?? "pageview").trim().toLowerCase();
    if (!EVENT_KIND_RE.test(kind)) continue;
    if (!shouldAccept(`${gameId}:${ip}:${kind}`, nowMs)) continue;
    accepted++;
    if (!env.ANALYTICS) continue;
    const path = (item.path ?? "/").slice(0, PATH_MAX);
    env.ANALYTICS.writeDataPoint({
      indexes: [gameId],
      blobs: [gameId, kind, path, safeReferrerHost(item.referrer), country, uaClass, flattenProps(item.props)],
      // doubles[0] = event count; doubles[1] = event time (ms). Queries prefer
      // doubles[1] so replayed events land on the day they happened.
      doubles: [1, effectiveTimestamp(item.t, nowMs)],
    });
  }
  return new Response(null, {
    status: 204,
    headers: { ...cors, "x-events-accepted": String(accepted) },
  });
}
