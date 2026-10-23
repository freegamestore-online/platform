import type { Route } from './host';

interface Game {
  id?: string;
  appUrl?: string;
  status?: unknown;
  name?: string;
  description?: string;
  /** Only literal true enables COOP/COEP; absent and false preserve defaults. */
  crossOriginIsolated?: boolean;
}

let cached: { games: Game[]; expires: number } | undefined;
let loading: Promise<Game[]> | undefined;

/** Public storefront output is the metadata authority; never fetch creator repos
 * or infer approval from an R2 route, which can exist before the first build. */
async function publicGames(): Promise<Game[]> {
  if (cached && cached.expires > Date.now()) return cached.games;
  if (loading) return loading;
  loading = (async () => {
    try {
      const response = await fetch('https://freegamestore.online/registry.json', {
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) return [];
      const data = await response.json() as { games?: Game[] };
      if (!Array.isArray(data.games)) return [];
      cached = { games: data.games, expires: Date.now() + 60_000 };
      return data.games;
    } catch {
      // No stale approvals on failure. Gameplay continues without SEO enrichment.
      return [];
    } finally {
      loading = undefined;
    }
  })();
  return loading;
}

export async function publicGame(route: Route): Promise<Game | undefined> {
  const canonical = `https://${route.slug}.${route.zone}/`;
  return (await publicGames()).find((game) => {
    if (!game || typeof game !== 'object') return false;
    if (game.id !== route.slug) return false;
    // Missing is genuinely live (publish.ts legacy contract). Explicit private,
    // unpublished and unknown states must not accidentally become discoverable.
    if (game.status !== undefined && !['live', 'published', 'approved'].includes(String(game.status))) return false;
    try { return new URL(game.appUrl || '').href === canonical; } catch { return false; }
  });
}

export function escapeMetadata(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function metadataTags(game: Game, canonical: string): string | null {
  if (typeof game.name !== 'string' || !game.name.trim() ||
      typeof game.description !== 'string' || !game.description.trim()) return null;
  const title = escapeMetadata(`${game.name} – Free Game Store`);
  const description = escapeMetadata(game.description);
  const url = escapeMetadata(canonical);
  return `<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Free Game Store">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">`;
}

/** Streaming parser preserves scripts/game DOM and removes conflicting old tags. */
export function injectMetadata(response: Response, tags: string): Response {
  const remove = { element(element: Element) { element.remove(); } };
  const headers = new Headers(response.headers);
  // R2 validators describe original bytes, not the registry-dependent transform.
  headers.delete('etag');
  headers.delete('content-length');
  headers.delete('accept-ranges');
  headers.set('cache-control', 'no-store');
  return new HTMLRewriter()
    .on('head title, head meta[name="description"], head link[rel="canonical"], head meta[property^="og:"], head meta[name^="twitter:"]', remove)
    .on('head', { element(element: Element) { element.append(tags, { html: true }); } })
    .transform(new Response(response.body, { status: response.status, headers }));
}
