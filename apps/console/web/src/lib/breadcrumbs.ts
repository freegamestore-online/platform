/** In-memory ring buffer for client activity breadcrumbs.
 *
 * Breadcrumbs are appended to error reports so support can see what led up to
 * a crash. They are intentionally privacy-preserving:
 *   - Route changes capture the pathname only (no search params or hashes).
 *   - Game events record only the gameId (already-known app identifier).
 *   - No text input, prompts, API keys, or other PII is ever captured.
 *
 * The buffer is capped at CAPACITY entries; oldest entries are evicted when full.
 */

const CAPACITY = 20;

export type BreadcrumbKind = "route" | "game_open" | "game_switch" | "deploy";

export interface Breadcrumb {
  /** Unix ms timestamp. */
  t: number;
  kind: BreadcrumbKind;
  /** Privacy-safe detail: pathname for routes, gameId for game events. */
  detail: string;
}

const buffer: Breadcrumb[] = [];

/** Append a breadcrumb. Oldest entry is evicted when the buffer is full. */
export function addBreadcrumb(kind: BreadcrumbKind, detail: string): void {
  if (buffer.length >= CAPACITY) buffer.shift();
  buffer.push({ t: Date.now(), kind, detail });
}

/** Return a shallow copy of the current breadcrumb buffer (oldest first). */
export function getBreadcrumbs(): Breadcrumb[] {
  return buffer.slice();
}

/** Reset the buffer. Exported for tests only — do not call in production code. */
export function _resetBuffer(): void {
  buffer.length = 0;
}

/** Serialise breadcrumbs into a compact string that fits within the server's
 *  1 000-character context cap.  Format per entry: "<t>,<kind>,<detail>".
 *  Entries are separated by "|".  If the full list would exceed `maxLen` chars
 *  the oldest entries are dropped until it fits.
 */
export function serializeBreadcrumbs(maxLen = 900): string {
  const crumbs = getBreadcrumbs();
  // Build from most-recent → oldest so we keep the recent ones if we must trim.
  const parts: string[] = [];
  for (let i = crumbs.length - 1; i >= 0; i--) {
    const c = crumbs[i]!;
    parts.unshift(`${c.t},${c.kind},${c.detail}`);
    const candidate = parts.join("|");
    if (candidate.length > maxLen) {
      parts.shift(); // too long — drop the oldest we just added
      break;
    }
  }
  return parts.join("|");
}
