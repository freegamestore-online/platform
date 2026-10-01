/**
 * freegamestore-host — serves every published game from R2.
 *
 * FGS sibling of freeappstore-host. One Worker on *.freegamestore.online
 * replaces the per-game CF Pages project model. Subdomain → slug → R2
 * prefix lookup happens in D1 (shared `routes` table on the fas D1 — its
 * `zone` column distinguishes FAS from FGS rows); assets stream from the
 * fgs-games bucket. Security headers + CSP are emitted from this Worker,
 * matching the FAS sibling's policy.
 *
 * FGS has no platform-infra subdomains today (no api, no admin), so
 * PLATFORM_SUBDOMAINS is just www → apex redirect + future hooks.
 */

import {
  buildSyntheticVersion,
  contentType,
  type Env,
  etagsMatch,
  type Route,
  r2KeyFor,
  resolveRouteCached,
  securityHeaders,
  shouldRevalidate,
} from "./host";

type PlatformDispatch =
  | { type: "service"; binding: keyof Env }
  | { type: "proxy"; target: string }
  | { type: "redirect"; to: string; status?: 301 | 302 }
  | { type: "gone"; message: string };

/**
 * Reserved subdomains on freegamestore.online. The FAS sibling Worker
 * has a much larger list because FAS has api/admin/compliance/etc.
 * platform-infra subdomains; FGS today has only the storefront on the
 * apex and games on subdomains. Keep this minimal — every entry here is
 * a maintenance surface.
 */
const PLATFORM_SUBDOMAINS: Record<string, PlatformDispatch> = {
  www: { type: "redirect", to: "https://freegamestore.online", status: 301 },
  // Both `console` and `publish` serve the same combined publisher app
  // (React frontend + Pages Functions for /api/* and /auth/*). Unlike FAS —
  // where `console` is a separate static-only repo synced to R2 and `publish`
  // is the Pages API — FGS ships one combined Pages project, so we proxy both
  // host names to it. This is the canonical, always-fresh source of truth.
  // `console` is the user-facing entry (VibeCode chat at /create, profile,
  // dashboard) and the default CORS origin; proxying here supersedes the stale
  // one-time R2 snapshot that used to answer `console.freegamestore.online`.
  console: { type: "proxy", target: "https://freegamestore-publisher.pages.dev" },
  publish: { type: "proxy", target: "https://freegamestore-publisher.pages.dev" },
};

// GAME_PROJECT_OVERRIDES + legacyFallback removed 2026-05-28: every FGS
// game on the storefront is on Path B (D1 routes → R2). Unknown slugs
// return clean 404; no more legacy CF Pages proxy.

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Wrap the whole handler: a D1 (route lookup) or R2 (asset read) blip must
    // degrade to a clean 503 for the one request, not surface as an unhandled
    // rejection that CF turns into a raw 500 for EVERY game subdomain at once.
    // A genuinely-unknown slug still returns 404 below (that's not an error).
    try {
      const url = new URL(req.url);
      const host = req.headers.get("host") ?? url.host;

      const cleaned = host.toLowerCase().split(":")[0];
      const dot = cleaned.indexOf(".");
      const slug = dot > 0 ? cleaned.slice(0, dot) : "";

      // Fleet-wide analytics loader. Every game injects
      //   <script src="https://api.freegamestore.online/v1/analytics.js?app=<id>">
      // and this Worker owns *.freegamestore.online/* (which preempts any more
      // specific sibling route), so it must answer the loader here or it 404s on
      // every game. Served before the reserved-subdomain + registry lookups.
      if (slug === "api" && url.pathname === "/v1/analytics.js") {
        return analyticsLoaderResponse(url, env, ctx);
      }

      // hasOwnProperty, not `in`: `slug in obj` walks the prototype chain, so a
      // game published at constructor./toString./__proto__.freegamestore.online
      // would falsely match and never reach its real R2 route.
      if (Object.hasOwn(PLATFORM_SUBDOMAINS, slug)) {
        return await dispatchPlatform(req, env, slug, host);
      }

      // Cached (slug,zone)→route lookup: routes only change on publish/delete,
      // so a 60s in-isolate cache collapses a 50-asset page from 50 D1 reads to
      // one, and a D1 hiccup can't 500 the whole fleet on every asset.
      const route = await resolveRouteCached(env.DB, host);
      if (route) return await serve(env.APPS, route, url, req, ctx);

      return notFound(host);
    } catch {
      return serviceUnavailable();
    }
  },
};

/** Clean 503 for a transient backend (D1/R2) failure. Kept human-readable and
 *  with a short Retry-After so a client/CDN retries rather than caching a 500. */
function serviceUnavailable(): Response {
  return new Response("Service temporarily unavailable — please retry shortly.\n", {
    status: 503,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "retry-after": "5",
      "cache-control": "no-store",
    },
  });
}

// A game id: lowercase slug, may start with a digit (e.g. "2048"), ≤58 chars.
export const ANALYTICS_APP_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/;
const ANALYTICS_CACHE_TTL = 3600;

/** The public analytics loader every game injects. Cookieless, no PII. Injects
 *  the store-wide Cloudflare Web Analytics beacon when CF_BEACON_TOKEN is set,
 *  and always exposes a safe `window.fgsAnalytics` stub so game code calling it
 *  never throws. Centralized so analytics policy can change without redeploying
 *  every game repo. */
export function buildAnalyticsLoader(appId: string, beaconToken: string | null): string {
  const app = JSON.stringify(appId);
  const beacon = beaconToken
    ? `
    try {
      var s = document.createElement("script");
      s.defer = true;
      s.src = "https://static.cloudflareinsights.com/beacon.min.js";
      s.setAttribute("data-cf-beacon", JSON.stringify({ token: ${JSON.stringify(beaconToken)}, spa: true }));
      document.head.appendChild(s);
    } catch (e) {}`
    : "";
  return `(function(){
  var APP = ${app};${beacon}
  window.fgsAnalytics = window.fgsAnalytics || {};
  window.fgsAnalytics.app = APP;
  if (typeof window.fgsAnalytics.event !== "function") window.fgsAnalytics.event = function(){};
})();
`;
}

/** GET api.freegamestore.online/v1/analytics.js?app=<id>. ALWAYS 200 valid JS
 *  (an invalid id no-ops), edge-cached, so a bad id can't become a console error
 *  on every game. */
async function analyticsLoaderResponse(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const appId = url.searchParams.get("app") ?? "";
  const valid = ANALYTICS_APP_ID_RE.test(appId);
  const cacheUrl = `https://fgs-analytics-loader/${valid ? appId : "_invalid"}`;
  const cache = caches.default;
  const hit = await cache.match(cacheUrl);
  if (hit) return hit;

  const body = valid ? buildAnalyticsLoader(appId, env.CF_BEACON_TOKEN ?? null) : "/* fgs analytics: invalid app id */\n";
  const res = new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": `public, max-age=${ANALYTICS_CACHE_TTL}, s-maxage=${ANALYTICS_CACHE_TTL}`,
      "access-control-allow-origin": "*",
    },
  });
  ctx.waitUntil(cache.put(cacheUrl, res.clone()));
  return res;
}

async function dispatchPlatform(req: Request, env: Env, slug: string, host: string): Promise<Response> {
  const mapping = PLATFORM_SUBDOMAINS[slug];
  const url = new URL(req.url);

  if (mapping.type === "service") {
    const target = env[mapping.binding] as Fetcher | undefined;
    if (!target) {
      return new Response(`Reserved subdomain ${host} has no service binding configured.\n`, {
        status: 502,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return await target.fetch(req);
  }
  if (mapping.type === "proxy") {
    const headers = new Headers(req.headers);
    headers.delete("host");
    // redirect: "manual" — a 3xx from the upstream must reach the browser as-is.
    // Following it here (fetch's default) swallowed redirects that set cookies,
    // e.g. /auth/handoff's 302 + session Set-Cookie, and served the final page
    // at the original URL (#74).
    const upstream = await fetch(`${mapping.target}${url.pathname}${url.search}`, {
      method: req.method,
      headers,
      body: req.body,
      redirect: "manual",
    });
    // Keep the browser on the public host if the upstream redirects to its own
    // origin (e.g. Pages' canonical-URL redirects on the pages.dev host).
    const location = upstream.headers.get("location");
    if (location?.startsWith(`${mapping.target}/`) || location === mapping.target) {
      const rewritten = new Response(upstream.body, upstream);
      rewritten.headers.set("location", `https://${host}${location.slice(mapping.target.length) || "/"}`);
      return rewritten;
    }
    return upstream;
  }
  if (mapping.type === "redirect") {
    return Response.redirect(`${mapping.to}${url.pathname}${url.search}`, mapping.status ?? 301);
  }
  return new Response(`${mapping.message}\n`, {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

async function serve(bucket: R2Bucket, route: Route, url: URL, req: Request, _ctx: ExecutionContext): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }

  // version.json — the deploy stamp, or a fallback synthesized from R2 metadata.
  // Handled here (not via the generic object path) because it's always
  // CORS-open (public, non-sensitive deploy info, so the console dashboard can
  // read it cross-subdomain) and always revalidated.
  if (url.pathname === "/version.json") {
    return serveVersion(bucket, route, req);
  }

  const key = r2KeyFor(route, url.pathname);
  // Honour Range on GET so media (<video>/<audio>) can seek — Safari refuses to
  // play video that isn't range-served. R2 parses the Range header for us and
  // sets obj.range on the returned body.
  const wantsRange = req.method === "GET" && req.headers.has("range");
  let obj = await bucket.get(key, wantsRange ? { range: req.headers } : undefined);

  if (!obj && !/\.[a-z0-9]+$/i.test(url.pathname)) {
    obj = await bucket.get(`${route.r2_prefix}/index.html`);
    if (obj) return respond(obj, "text/html; charset=utf-8", req, true);
  }

  if (!obj) return notFound(`${route.slug}.${route.zone}`, url.pathname);

  const ct = contentType(key);
  return respond(obj, ct, req, shouldRevalidate(ct, key));
}

/**
 * Serve <game>/version.json: the real deploy stamp if the game published one,
 * else a fallback synthesized from the index.html R2 metadata so EVERY game
 * answers. Always CORS-open + revalidated (see the caller).
 */
async function serveVersion(bucket: R2Bucket, route: Route, req: Request): Promise<Response> {
  const headers = securityHeaders({ revalidate: true });
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("access-control-allow-origin", "*");

  const real = await bucket.get(`${route.r2_prefix}/version.json`);
  if (real) {
    headers.set("etag", real.httpEtag);
    const ifNoneMatch = req.headers.get("if-none-match");
    if (ifNoneMatch && etagsMatch(ifNoneMatch, real.httpEtag)) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(req.method === "HEAD" ? null : real.body, { headers });
  }

  const idx = await bucket.get(`${route.r2_prefix}/index.html`);
  if (idx) {
    const body = buildSyntheticVersion(route.slug, idx.uploaded, idx.httpEtag);
    return new Response(req.method === "HEAD" ? null : body, { headers });
  }
  return notFound(`${route.slug}.${route.zone}`, "/version.json");
}

function respond(obj: R2ObjectBody, ct: string, req: Request, revalidate: boolean): Response {
  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch && etagsMatch(ifNoneMatch, obj.httpEtag)) {
    const headers = securityHeaders({ revalidate });
    headers.set("etag", obj.httpEtag);
    return new Response(null, { status: 304, headers });
  }
  const headers = securityHeaders({ revalidate });
  headers.set("content-type", ct);
  headers.set("etag", obj.httpEtag);
  headers.set("accept-ranges", "bytes");
  // Partial content: R2 populated obj.range because the request carried a Range.
  if (obj.range && req.method === "GET") {
    const { offset, length } = rangeBounds(obj.range, obj.size);
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    return new Response(obj.body, { status: 206, headers });
  }
  return new Response(req.method === "HEAD" ? null : obj.body, { headers });
}

/** Absolute byte bounds of an R2 range. R2 reports `bytes=-N` as `{ suffix: N }`
 *  (the LAST N bytes); treating it as offset 0 sent a Content-Range for the
 *  whole file with only N bytes of body, corrupting tail reads such as an MP4's
 *  trailing moov atom (#74). */
function rangeBounds(range: R2Range, size: number): { offset: number; length: number } {
  if ("suffix" in range && range.suffix !== undefined) {
    const length = Math.min(range.suffix, size);
    return { offset: size - length, length };
  }
  const offset = "offset" in range && range.offset !== undefined ? range.offset : 0;
  const length = "length" in range && range.length !== undefined ? range.length : size - offset;
  return { offset, length: Math.min(length, size - offset) };
}

function notFound(domain: string, path?: string): Response {
  const body = path ? `Not Found: ${domain} has no asset at ${path}\n` : `Not Found: no game registered at ${domain}.\n`;
  return new Response(body, {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
