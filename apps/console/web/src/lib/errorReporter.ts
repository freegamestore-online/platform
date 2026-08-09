/** Client-side error reporter — posts to /api/client-error.
 *
 * - Debounces by message so a render loop can't flood the endpoint.
 * - Silences fetch errors (best-effort, must not throw into callers).
 * - Only technical error info is sent; no PII beyond the already-known
 *   GitHub identity (resolved server-side from the session cookie).
 */

const ENDPOINT = "/api/client-error";
const DEBOUNCE_MS = 2_000;

// Track recently-sent messages to deduplicate rapid repeated errors.
const recentlySent = new Map<string, number>();

function isDuplicate(key: string): boolean {
  const last = recentlySent.get(key);
  const now = Date.now();
  if (last !== undefined && now - last < DEBOUNCE_MS) return true;
  recentlySent.set(key, now);
  // Keep the map from growing unboundedly.
  if (recentlySent.size > 50) {
    const oldest = [...recentlySent.entries()].sort((a, b) => a[1] - b[1])[0];
    if (oldest) recentlySent.delete(oldest[0]);
  }
  return false;
}

export interface ErrorReport {
  source?: string;
  route?: string;
  message: string;
  stack?: string;
  context?: string;
}

export function reportError(report: ErrorReport): void {
  const key = `${report.message}|${report.route ?? ""}`;
  if (isDuplicate(key)) return;

  const body: ErrorReport = {
    route: report.route ?? location.pathname,
    message: report.message,
    stack: report.stack,
    context: report.context,
  };

  // Fire-and-forget; never propagate errors from the reporter itself.
  fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // Include the session cookie so the server can resolve the identity.
    credentials: "include",
  }).catch(() => {
    // Silently swallow — error reporting must never cause further errors.
  });
}
