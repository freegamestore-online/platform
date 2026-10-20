/**
 * Lower-cased extension of a repo path, with its dot (`web/src/App.TSX` →
 * `.tsx`), or '' when the last segment has none. A dot in a directory name
 * doesn't count (`web/.vite/cache` → '').
 *
 * Shared by the checks that filter files by type (#368: it was copied into 15 of
 * them). pwa-offline keeps its own variant, which returns the extension
 * without the dot.
 */
export function extOf(path: string): string {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return dot > slash ? path.slice(dot).toLowerCase() : '';
}
