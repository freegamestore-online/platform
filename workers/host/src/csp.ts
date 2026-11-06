/**
 * Content-Security-Policy for hosted games (#454).
 *
 * Three layers:
 *  - the ENFORCED default stays open (host.ts, #369): a game may load scripts and
 *    call APIs on any https host. A fleet scan on 2026-11-07 (141 live games)
 *    found no external script host except the platform's own analytics loader and
 *    no wss: use, but 5 games (breakout, orb-cascade on Pixi; spaceshooter,
 *    fireboyandwatergirl, lavaman-and-icegirl on Phaser) ship `eval` / `new
 *    Function` in the engine chunk, so dropping 'unsafe-eval' now would break them.
 *  - a REPORT-ONLY candidate (script-src and connect-src without 'unsafe-eval' or
 *    `https:`, plus form-action) goes on every response with a report endpoint.
 *    Reports are logged by cspReportResponse; once they show what real traffic
 *    needs, the enforced policy is tightened from data, not from a guess.
 *  - a game opts into the STRICT policy with `"strictCsp": true` on its registry
 *    entry (same place as crossOriginIsolated). It is enforced instead of the
 *    open policy: same-origin plus the platform API and the analytics vendors.
 */

import { corsHeaders } from "./analytics";

const API = "https://api.freegamestore.online";
const AUTH = "https://auth.freegamestore.online";
/** Where browsers POST violation reports (served by index.ts for the `api` slug). */
export const CSP_REPORT_URL = `${API}/v1/csp-report`;

/** Vendors the per-game analytics loader can inject (analytics.ts buildGameLoader). */
const ANALYTICS_SCRIPT = [
  "https://static.cloudflareinsights.com",
  "https://www.googletagmanager.com",
  "https://plausible.io",
];
const ANALYTICS_CONNECT = [
  "https://cloudflareinsights.com",
  "https://www.google-analytics.com",
  "https://*.google-analytics.com",
  "https://*.analytics.google.com",
  "https://www.googletagmanager.com",
  "https://plausible.io",
];

/** Only the game itself, the storefront (apex and Pages previews) and the
 *  console's /create preview may embed a game (#466). */
export const FRAME_ANCESTORS =
  "frame-ancestors 'self' https://freegamestore.online https://console.freegamestore.online https://freegamestore.pages.dev";

/** Observed, not enforced: what the open policy would become without
 *  'unsafe-eval' and the `https:` wildcards. */
export const REPORT_ONLY_CSP = [
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: ${API} ${ANALYTICS_SCRIPT.join(" ")}`,
  `connect-src 'self' data: blob: ${API} ${AUTH} ${ANALYTICS_CONNECT.join(" ")}`,
  "form-action 'self'",
  `report-uri ${CSP_REPORT_URL}`,
  "report-to csp",
].join("; ");

/** Opt-in (`strictCsp: true`): replaces the open policy. */
export const STRICT_CSP = [
  "default-src 'self'",
  `script-src 'self' 'wasm-unsafe-eval' ${API} ${ANALYTICS_SCRIPT.join(" ")}`,
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${ANALYTICS_CONNECT.join(" ")}`,
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  `connect-src 'self' data: blob: ${API} ${AUTH} ${ANALYTICS_CONNECT.join(" ")}`,
  "frame-src 'none'",
  FRAME_ANCESTORS,
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "upgrade-insecure-requests",
  `report-uri ${CSP_REPORT_URL}`,
  "report-to csp",
].join("; ");

/** Report-only candidate and the endpoint it reports to, on every response. */
export function reportingHeaders(headers: Headers): void {
  headers.set("content-security-policy-report-only", REPORT_ONLY_CSP);
  headers.set("reporting-endpoints", `csp="${CSP_REPORT_URL}"`);
}

/** Swap the open policy for the strict one; nothing left to observe. */
export function applyStrictCsp(headers: Headers): void {
  headers.set("content-security-policy", STRICT_CSP);
  headers.delete("content-security-policy-report-only");
}

// --- violation reports -------------------------------------------------------

const REPORT_MAX_BYTES = 16 * 1024;
const LOG_WINDOW_MS = 60_000;
const lastLogged = new Map<string, number>();

interface Violation {
  game: string;
  directive: string;
  blocked: string;
  disposition: string;
}

/** Hostname-only form of a blocked URL, so no path, query or token is logged. */
function blockedSource(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return "";
  if (/^[a-z-]+$/i.test(raw)) return raw.slice(0, 32); // "eval", "inline", "self", "data"
  try {
    const u = new URL(raw);
    return u.host ? `${u.protocol}//${u.host}` : u.protocol;
  } catch {
    return "";
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Violations in either report format: legacy `{"csp-report": {...}}` or the
 *  Reporting API's `[{type: "csp-violation", body: {...}}]`. */
export function parseReports(body: unknown): Violation[] {
  const items: Record<string, unknown>[] = [];
  if (Array.isArray(body)) {
    for (const r of body.slice(0, 10)) {
      if (r && typeof r === "object" && (r as { type?: unknown }).type === "csp-violation") {
        const b = (r as { body?: unknown }).body;
        if (b && typeof b === "object") items.push(b as Record<string, unknown>);
      }
    }
  } else if (body && typeof body === "object") {
    const legacy = (body as { "csp-report"?: unknown })["csp-report"];
    if (legacy && typeof legacy === "object") items.push(legacy as Record<string, unknown>);
  }
  const out: Violation[] = [];
  for (const b of items) {
    let host = "";
    try {
      host = new URL(str(b.documentURL) || str(b["document-uri"])).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (!host.endsWith(".freegamestore.online")) continue;
    out.push({
      game: host.slice(0, host.indexOf(".")).slice(0, 64),
      directive: (str(b.effectiveDirective) || str(b["effective-directive"]) || str(b["violated-directive"])).slice(0, 40),
      blocked: blockedSource(b.blockedURL ?? b["blocked-uri"]),
      disposition: str(b.disposition).slice(0, 10),
    });
  }
  return out;
}

/** POST /v1/csp-report on api.freegamestore.online. Public, called by browsers, so
 *  it answers 204 whatever it gets and logs at most one line per
 *  (game, directive, blocked source) per minute per isolate. */
export async function cspReportResponse(req: Request, nowMs: number = Date.now()): Promise<Response> {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { allow: "POST, OPTIONS" } });
  }
  try {
    const text = await req.text();
    if (text.length <= REPORT_MAX_BYTES) {
      for (const v of parseReports(JSON.parse(text))) {
        const key = `${v.game}|${v.directive}|${v.blocked}`;
        if (nowMs - (lastLogged.get(key) ?? 0) < LOG_WINDOW_MS) continue;
        if (lastLogged.size > 2048) lastLogged.clear();
        lastLogged.set(key, nowMs);
        console.log(JSON.stringify({ csp_violation: v }));
      }
    }
  } catch {
    // Malformed report: nothing to learn.
  }
  return new Response(null, { status: 204, headers: cors });
}
