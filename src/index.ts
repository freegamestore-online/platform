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

import { type Env, type Route, contentType, etagsMatch, r2KeyFor, resolveRoute, securityHeaders } from "./host";

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
    const url = new URL(req.url);
    const host = req.headers.get("host") ?? url.host;

    const cleaned = host.toLowerCase().split(":")[0];
    const dot = cleaned.indexOf(".");
    const slug = dot > 0 ? cleaned.slice(0, dot) : "";

    // hasOwnProperty, not `in`: `slug in obj` walks the prototype chain, so a
    // game published at constructor./toString./__proto__.freegamestore.online
    // would falsely match and never reach its real R2 route.
    if (Object.prototype.hasOwnProperty.call(PLATFORM_SUBDOMAINS, slug)) {
      return await dispatchPlatform(req, env, slug, host);
    }

    const route = await resolveRoute(env.DB, host);
    if (route) return await serve(env.APPS, route, url, req, ctx);

    return notFound(host);
  },
};

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
    return await fetch(`${mapping.target}${url.pathname}${url.search}`, {
      method: req.method,
      headers,
      body: req.body,
    });
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

  const key = r2KeyFor(route, url.pathname);
  // Honour Range on GET so media (<video>/<audio>) can seek — Safari refuses to
  // play video that isn't range-served. R2 parses the Range header for us and
  // sets obj.range on the returned body.
  const wantsRange = req.method === "GET" && req.headers.has("range");
  let obj = await bucket.get(key, wantsRange ? { range: req.headers } : undefined);

  if (!obj && !/\.[a-z0-9]+$/i.test(url.pathname)) {
    obj = await bucket.get(`${route.r2_prefix}/index.html`);
    if (obj) return respond(obj, "text/html; charset=utf-8", req);
  }

  if (!obj) return notFound(`${route.slug}.${route.zone}`, url.pathname);

  return respond(obj, contentType(key), req);
}

function respond(obj: R2ObjectBody, ct: string, req: Request): Response {
  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch && etagsMatch(ifNoneMatch, obj.httpEtag)) {
    const headers = securityHeaders({ htmlCache: ct.startsWith("text/html") });
    headers.set("etag", obj.httpEtag);
    return new Response(null, { status: 304, headers });
  }
  const headers = securityHeaders({ htmlCache: ct.startsWith("text/html") });
  headers.set("content-type", ct);
  headers.set("etag", obj.httpEtag);
  headers.set("accept-ranges", "bytes");
  // Partial content: R2 populated obj.range because the request carried a Range.
  const range = obj.range as { offset?: number; length?: number } | undefined;
  if (range && req.method === "GET") {
    const offset = range.offset ?? 0;
    const length = range.length ?? obj.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    return new Response(obj.body, { status: 206, headers });
  }
  return new Response(req.method === "HEAD" ? null : obj.body, { headers });
}

function notFound(domain: string, path?: string): Response {
  const body = path
    ? `Not Found: ${domain} has no asset at ${path}\n`
    : `Not Found: no game registered at ${domain}.\n`;
  return new Response(body, {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
