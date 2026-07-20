/** Resilient fetch layer for the GitHub API.
 *
 * The deploy/import/query paths used to do bare `fetch().then(res.json())` with
 * no status check, no retry, and no timeout. A single hung upstream could wedge
 * a whole session; a burst of blob reads could trip GitHub's secondary rate
 * limit; a transient 5xx surfaced as a cryptic "undefined" downstream. This
 * module centralizes:
 *   - an AbortController timeout (a hung request can't stall forever),
 *   - Retry-After-aware retry + exponential backoff on transient failures
 *     (429, 5xx, and 403-with-Retry-After = GitHub secondary rate limit),
 *   - a parsed-JSON helper that throws WITH the response body on hard failures.
 *
 * Deliberately conservative on the body: `resilientFetch` never reads the
 * response body itself (so callers keep full control of it and mocks that only
 * set `status` still work). Ordinary 4xx (404/409/422) are NOT retried and are
 * returned as-is, because several call sites intentionally probe for a 404
 * (does this repo/ref exist?) — turning that into a throw would break them.
 */

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export interface GhFetchOpts {
  /** Abort a single attempt after this many ms. Default 20s. */
  timeoutMs?: number;
  /** Max retries on a transient failure (network error / retryable status). Default 3. */
  retries?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Exponential backoff with a little jitter: ~0.5s, 1s, 2s… capped at 8s. */
function backoffMs(attempt: number): number {
  const base = Math.min(8000, 500 * 2 ** (attempt - 1));
  return base + Math.floor(Math.random() * 250);
}

/** Parse a Retry-After header (seconds) into ms, or null if absent/invalid. */
function retryAfterMs(res: Response): number | null {
  const raw = res.headers?.get?.("retry-after");
  if (!raw) return null;
  const secs = Number(raw);
  return Number.isFinite(secs) && secs >= 0 ? secs * 1000 : null;
}

function isRetryable(res: Response): boolean {
  if (RETRYABLE_STATUS.has(res.status)) return true;
  // GitHub secondary rate limit answers 403 with a Retry-After header.
  if (res.status === 403 && retryAfterMs(res) !== null) return true;
  return false;
}

/**
 * fetch() wrapped with a per-attempt timeout and transient-failure retry.
 * Returns the final Response (does NOT read its body). Throws only when every
 * attempt fails at the network level (including a timeout abort).
 */
export async function resilientFetch(url: string, init: RequestInit = {}, opts: GhFetchOpts = {}): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const maxRetries = opts.retries ?? 3;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      // Respect a caller-provided signal if present; otherwise use our timeout.
      res = await fetch(url, { ...init, signal: init.signal ?? ctrl.signal });
    } catch (err) {
      clearTimeout(timer);
      const aborted = ctrl.signal.aborted;
      // Don't retry a caller-driven abort — only our own timeout / transient net errors.
      if (attempt < maxRetries && !init.signal) {
        attempt++;
        await sleep(backoffMs(attempt));
        continue;
      }
      throw new Error(aborted ? `request timed out after ${timeoutMs}ms: ${url}` : `network error: ${String(err)}`);
    }
    clearTimeout(timer);

    if (isRetryable(res) && attempt < maxRetries) {
      attempt++;
      await sleep(retryAfterMs(res) ?? backoffMs(attempt));
      continue;
    }
    return res;
  }
}

/**
 * Drop-in resilient replacement for the old per-file `makeGhApi`. Returns
 * PARSED JSON (or `{}` for 204 / empty bodies). Throws WITH the body on a
 * persistent server-side failure (5xx / 429 / secondary rate limit) so the
 * caller sees a real diagnostic instead of `undefined`. Ordinary 4xx bodies are
 * returned as-is (callers already branch on missing fields like `.id`/`.sha`).
 */
export function makeGhApi(token: string, agentName: string, opts: GhFetchOpts = {}) {
  return async (path: string, method = "GET", body?: unknown): Promise<any> => {
    const res = await resilientFetch(
      `https://api.github.com${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": agentName,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      },
      opts,
    );

    if (res.status === 204) return {};
    let text = "";
    try {
      text = await res.text();
    } catch {
      text = "";
    }
    let data: any;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text };
    }

    const ok = (res as { ok?: boolean }).ok ?? (res.status >= 200 && res.status < 300);
    if (!ok && (res.status >= 500 || res.status === 429 || res.status === 403)) {
      throw new Error(`GitHub API ${res.status} (${method} ${path}): ${text.slice(0, 200)}`);
    }
    return data;
  };
}

/**
 * Run `worker` over `items` with at most `concurrency` in flight. Keeps the
 * GitHub blob-read fan-out from firing hundreds of parallel GETs (which trips
 * the secondary rate limit). Preserves input order in the result.
 */
export async function mapPool<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}
