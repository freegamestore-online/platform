/** Runtime-local adapter for the v1 registry contract.
 *
 * Reads prefer the authenticated GitHub Contents API (fresh immediately after a
 * write) and fall back to the public raw URL. This module deliberately returns
 * the contract's three states instead of collapsing an outage into `[]`.
 */

import { registryContentsUrl, registryRawUrl } from './registryLocation';

export interface RegistryGame {
  id: string;
  name?: string;
  creatorGithub?: string;
  firstPublished?: string;
  forkedFrom?: unknown;
  status?: unknown;
  [key: string]: unknown;
}

export type RegistryReadResult =
  | {
      status: 'available';
      games: RegistryGame[];
      /** Where the games came from. `raw` is the public CDN copy, cached for
       *  minutes after a write, so it can lag a just-provisioned or
       *  just-deleted game; destructive reconciliation must not act on it (#64). */
      source: 'contents' | 'raw';
    }
  | { status: 'missing' }
  | { status: 'unavailable' };

type Attempt = 'available' | 'missing' | 'unavailable';

function parseRegistry(value: unknown): RegistryGame[] | null {
  // Contents normally honours the raw accept header. Accept an envelope as
  // well so a proxy that ignores it is still a trustworthy source.
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { content?: unknown }).content === 'string'
  ) {
    try {
      const decoded = new TextDecoder().decode(
        Uint8Array.from(atob((value as { content: string }).content.replace(/\n/g, '')), (c) =>
          c.charCodeAt(0),
        ),
      );
      value = JSON.parse(decoded);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || !Array.isArray((value as { games?: unknown }).games))
    return null;
  return (value as { games: RegistryGame[] }).games;
}

async function readAttempt(
  url: string,
  init?: RequestInit,
): Promise<{ state: Attempt; games?: RegistryGame[] }> {
  try {
    const res = await fetch(url, init);
    if (res.status === 404) return { state: 'missing' };
    if (!res.ok) return { state: 'unavailable' };
    const games = parseRegistry(await res.json());
    return games ? { state: 'available', games } : { state: 'unavailable' };
  } catch {
    return { state: 'unavailable' };
  }
}

/** Read registry.json according to the v1 availability contract. */
export async function readRegistry(githubToken?: string): Promise<RegistryReadResult> {
  const contents = await readAttempt(
    registryContentsUrl(),
    githubToken
      ? {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: 'application/vnd.github.raw+json',
            'User-Agent': 'freegamestore-admin',
          },
        }
      : undefined,
  );
  if (contents.state === 'available')
    return { status: 'available', games: contents.games!, source: 'contents' };

  const raw = await readAttempt(registryRawUrl(), { headers: { 'User-Agent': 'freegamestore-admin' } });
  if (raw.state === 'available') return { status: 'available', games: raw.games!, source: 'raw' };
  if (contents.state === 'missing' && raw.state === 'missing') return { status: 'missing' };
  return { status: 'unavailable' };
}
