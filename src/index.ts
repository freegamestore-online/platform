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
};

/**
 * Games whose CF Pages project name doesn't follow the `free<slug>app`
 * convention. Audit on 2026-05-21 turned up just one: `puzzle` is hosted
 * at `freepuzzle.pages.dev` (no `app` suffix). Same pattern as FAS's
 * chessclock outlier — see fas-app-project-naming-outliers memory.
 */
const GAME_PROJECT_OVERRIDES: Record<string, string> = {
  puzzle: "freepuzzle",
};

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const host = req.headers.get("host") ?? url.host;

    const cleaned = host.toLowerCase().split(":")[0];
    const dot = cleaned.indexOf(".");
    const slug = dot > 0 ? cleaned.slice(0, dot) : "";

    if (slug in PLATFORM_SUBDOMAINS) {
      return await dispatchPlatform(req, env, slug, host);
    }

    const route = await resolveRoute(env.DB, host);
    if (route) return await serve(env.APPS, route, url, req, ctx);

    return await legacyFallback(req, host);
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

/**
 * Proxy to `<cf-project>.pages.dev` for slugs that haven't been migrated
 * to Path B yet. Games use `free<slug>app` (the admin's STORE_CONFIG
 * historically said `<slug>` but the actual deployed names all have the
 * `app` suffix — registry's `cfProject` field has stale shorter values
 * that don't match reality).
 */
async function legacyFallback(req: Request, host: string): Promise<Response> {
  const cleaned = host.toLowerCase().split(":")[0];
  const dot = cleaned.indexOf(".");
  if (dot < 1) return notFound(host);

  const slug = cleaned.slice(0, dot);
  const zone = cleaned.slice(dot + 1);
  if (zone !== "freegamestore.online") return notFound(host);

  const cfProject = GAME_PROJECT_OVERRIDES[slug] ?? `free${slug}app`;
  const url = new URL(req.url);
  const target = `https://${cfProject}.pages.dev${url.pathname}${url.search}`;
  const headers = new Headers(req.headers);
  headers.delete("host");
  return await fetch(target, { method: req.method, headers, body: req.body });
}

async function serve(bucket: R2Bucket, route: Route, url: URL, req: Request, _ctx: ExecutionContext): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }

  const key = r2KeyFor(route, url.pathname);
  let obj = await bucket.get(key);

  if (!obj && !/\.[a-z0-9]+$/i.test(url.pathname)) {
    obj = await bucket.get(`${route.r2_prefix}/index.html`);
    if (obj) return respond(obj, "text/html; charset=utf-8", req);
  }

  if (!obj) return notFound(url.pathname, route.slug);

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
  return new Response(req.method === "HEAD" ? null : obj.body, { headers });
}

function notFound(host: string, slug?: string): Response {
  const body = slug
    ? `Not Found: ${slug}.${host.split(".").slice(1).join(".")} has no asset at this path.\n`
    : `Not Found: no game registered at ${host}.\n`;
  return new Response(body, {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
