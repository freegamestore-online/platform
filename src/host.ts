export interface Env {
  DB: D1Database;
  APPS: R2Bucket;
  /** Service binding placeholder for a future FGS API worker. */
  API?: Fetcher;
  /** Optional store-wide Cloudflare Web Analytics beacon token. When set, the
   *  api.freegamestore.online/v1/analytics.js loader injects the cookieless CF
   *  beacon; when unset the loader still serves valid JS (just no beacon). */
  CF_BEACON_TOKEN?: string;
}

export interface Route {
  slug: string;
  zone: string;
  r2_prefix: string;
  store: string;
}

/**
 * Map a Host header like "2048.freegamestore.online" to its R2 prefix.
 * Returns null if no row matches; caller serves 404.
 *
 * Lookup is keyed by (slug, zone) so the same slug can exist on multiple
 * store zones without collision. We trust the Host header only for lookup
 * — no privilege is attached to the resolved slug, so spoofing it just
 * picks which 404 you see.
 */
export async function resolveRoute(db: D1Database, host: string): Promise<Route | null> {
  const cleaned = host.toLowerCase().split(":")[0];
  const dot = cleaned.indexOf(".");
  if (dot < 1) return null;
  const slug = cleaned.slice(0, dot);
  const zone = cleaned.slice(dot + 1);
  if (!slug || !zone) return null;

  const row = await db
    .prepare("SELECT slug, zone, r2_prefix, store FROM routes WHERE slug = ?1 AND zone = ?2 AND hosted_on = 'r2'")
    .bind(slug, zone)
    .first<Route>();
  return row ?? null;
}

/**
 * In-isolate cache in front of resolveRoute. Routes only change on
 * publish/delete, so a short TTL is safe and a 50-asset page then costs one
 * D1 read instead of 50. Positive hits live 60s; negative hits (unknown slug)
 * live only 10s so a freshly-published game appears quickly and a transient
 * miss can't be pinned for a full minute.
 *
 * The Map is per-isolate (Workers spins up many), so this is a best-effort
 * cache — no cross-isolate coherency needed; each isolate independently
 * refreshes within one TTL window. Keyed by the cleaned host (lowercased,
 * port stripped) exactly as resolveRoute keys its lookup.
 */
export const ROUTE_CACHE_TTL_MS = 60_000;
export const ROUTE_CACHE_NEG_TTL_MS = 10_000;

interface RouteCacheEntry {
  route: Route | null;
  expires: number;
}
const routeCache = new Map<string, RouteCacheEntry>();

/** Test-only: drop all cached routes so TTL behavior is deterministic. */
export function __clearRouteCache(): void {
  routeCache.clear();
}

export async function resolveRouteCached(db: D1Database, host: string): Promise<Route | null> {
  const key = host.toLowerCase().split(":")[0];
  const now = Date.now();
  const hit = routeCache.get(key);
  if (hit && hit.expires > now) return hit.route;

  const route = await resolveRoute(db, host);
  routeCache.set(key, {
    route,
    expires: now + (route ? ROUTE_CACHE_TTL_MS : ROUTE_CACHE_NEG_TTL_MS),
  });
  return route;
}

/**
 * Compute the R2 key for a given route + URL pathname. Directory paths and
 * `/` default to `index.html`; the leading slash is stripped because R2
 * keys are flat strings, not paths.
 */
export function r2KeyFor(route: Route, pathname: string): string {
  let p = pathname;
  if (p === "" || p === "/" || p.endsWith("/")) p += "index.html";
  return `${route.r2_prefix}/${p.replace(/^\/+/, "")}`;
}

/**
 * Compare a client's `If-None-Match` request header against an R2 object's
 * httpEtag. Returns true iff the browser already has a fresh copy and we
 * should respond 304 Not Modified.
 *
 * `If-None-Match: *` matches any existing resource. Otherwise the header
 * is a comma-separated list of etags (each quoted); we match by exact
 * string. R2 only emits strong etags, so we don't need W/ prefix handling.
 */
export function etagsMatch(headerValue: string | null, objectEtag: string): boolean {
  if (!headerValue) return false;
  const trimmed = headerValue.trim();
  if (trimmed === "*") return true;
  return trimmed.split(",").some((t) => t.trim() === objectEtag);
}

/**
 * Build the security headers we attach to every R2-served response. Split
 * out from the index.ts respond() helper so the policy is unit-testable
 * without spinning up the full Worker, and so the next person to tighten
 * CSP can edit one place. Pass-through args:
 *   - revalidate: true for stable-named files whose content changes across
 *     deploys (HTML, version.json) — short cache + must-revalidate. false for
 *     content-hashed bundle assets, which are safe to cache immutably.
 *
 * Analytics origins are listed explicitly in script-src + connect-src so
 * a future tightening (removing the broad `https:` and replacing with
 * an allowlist) doesn't silently break the platform analytics loader,
 * CF Web Analytics, or BYO GA4 / Plausible tags.
 */
export function securityHeaders(opts: { revalidate: boolean }): Headers {
  const headers = new Headers();
  if (opts.revalidate) {
    headers.set("cache-control", "public, max-age=60, must-revalidate");
  } else {
    headers.set("cache-control", "public, max-age=31536000, immutable");
  }
  // frame-ancestors lets the freegamestore.online storefront iframe
  // games for previews.
  // Games are untrusted user content. The two CSP directives that used a blanket
  // `https:` — script-src and connect-src — were the real runtime holes: a
  // malicious game could load arbitrary external JS, or exfiltrate data
  // (gameplay, a stolen token) to any host via fetch/XHR/beacon/WebSocket.
  // Games are self-contained bundles served from their own origin and only need
  // to talk to the platform (*.freegamestore.online: auth, leaderboard, rooms)
  // plus CF analytics, so we drop the wildcards. This is enforced at serve time,
  // so a creator can't bypass it the way they can a CI check. (img/style/font
  // keep https: — loading external media is common and low-risk; the residual
  // GET-in-URL exfil channel is far narrower than connect-src.)
  // Trusted external origins: the platform analytics loader + the opt-in BYO
  // analytics vendors (Cloudflare / GA4 / Plausible) games may legitimately
  // load. Everything else is dropped — script-src and connect-src no longer
  // carry a blanket `https:`, so a malicious game can't inject arbitrary
  // external JS or exfiltrate data to an attacker host. Platform calls go to
  // *.freegamestore.online (auth, leaderboard, rooms).
  const analyticsScript = "https://static.cloudflareinsights.com https://api.freegamestore.online https://www.googletagmanager.com https://plausible.io";
  const analyticsConnect = "https://cloudflareinsights.com https://api.freegamestore.online https://www.google-analytics.com https://region1.google-analytics.com https://plausible.io";
  const csp = [
    "default-src 'self' https: data: blob:",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${analyticsScript}`,
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline' https:",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    `connect-src 'self' https://*.freegamestore.online wss://*.freegamestore.online ${analyticsConnect}`,
    "frame-src 'self' https:",
    "frame-ancestors 'self' https://freegamestore.online https://*.freegamestore.online https://freegamestore.pages.dev",
    "base-uri 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
  headers.set("content-security-policy", csp);
  headers.set(
    "permissions-policy",
    "geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), midi=(), interest-cohort=()",
  );
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  return headers;
}

/**
 * Synthesize a version.json body from R2 object metadata, for games that were
 * deployed before the deploy.yml build-stamp existed (no real version.json in
 * R2). `deployedAt` comes from when the game's index.html was last uploaded to
 * R2 and `version` is its content etag — so every game answers "when was this
 * last deployed" immediately, without a fleet-wide workflow change. Games that
 * redeploy with the stamp serve a richer real version.json (commit SHA, run
 * number) that takes precedence over this fallback.
 */
export function buildSyntheticVersion(slug: string, uploaded: Date, etag: string): string {
  return JSON.stringify(
    {
      repo: slug,
      version: etag.replace(/"/g, ""),
      deployedAt: uploaded.toISOString(),
      source: "r2-metadata",
      note: "No build stamp yet — redeploy this game to include the commit SHA.",
    },
    null,
    2,
  );
}

/**
 * Whether a served object must revalidate (short cache) rather than be cached
 * immutably for a year. Immutable is ONLY safe for files whose NAME changes when
 * their content changes — i.e. Vite/rollup content-hashed bundles, which are
 * emitted under `assets/` (`assets/index-<hash>.js`). Everything else keeps a
 * STABLE name across deploys: HTML entrypoints, the version.json stamp, and —
 * critically — anything a game ships from `web/public/` (manifest.json, icons,
 * sprites, audio, level/data JSON), which Vite copies verbatim to the dist root.
 * Marking those immutable pins the FIRST version at the CF edge + browsers for up
 * to a year, so a redeploy that changes them can never take effect. Revalidate
 * everything that isn't a hashed bundle. Pure, so the policy is unit-testable.
 */
export function shouldRevalidate(ct: string, key: string): boolean {
  if (ct.startsWith("text/html") || key.endsWith("/version.json")) return true;
  return !/\/assets\//.test(key);
}

/**
 * Best-effort MIME guess from file extension. Defaults to octet-stream so
 * the browser doesn't sniff and execute something it shouldn't (combined
 * with X-Content-Type-Options: nosniff downstream).
 */
export function contentType(path: string): string {
  const ext = path.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  switch (ext) {
    case "html":
      return "text/html; charset=utf-8";
    case "js":
    case "mjs":
      return "application/javascript; charset=utf-8";
    case "css":
      return "text/css; charset=utf-8";
    case "json":
      return "application/json; charset=utf-8";
    case "svg":
      return "image/svg+xml";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "ico":
      return "image/x-icon";
    case "woff":
      return "font/woff";
    case "woff2":
      return "font/woff2";
    case "wasm":
      return "application/wasm";
    case "txt":
      return "text/plain; charset=utf-8";
    case "xml":
      return "application/xml; charset=utf-8";
    case "webmanifest":
      return "application/manifest+json";
    case "map":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}
