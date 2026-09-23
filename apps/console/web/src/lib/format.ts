/** Decode numeric HTML entities (e.g. "&#128133;" → 💅). The AI agent emits
 *  game icons as HTML entities; React renders text escaped, so without this the
 *  raw "&#128133;" shows instead of the emoji. Safe on already-decoded strings. */
export function decodeIcon(s: string): string {
  if (!s) return '';
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => cp(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => cp(Number(n)));
}
function cp(n: number): string {
  try {
    return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : '';
  } catch {
    return '';
  }
}

/** "Jun 30, 2026" from an ISO string; "" if empty/invalid. */
export function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Relative time like "3d ago"; falls back to an absolute date past ~30 days. */
export function formatRelative(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}
