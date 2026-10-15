import { afterEach, describe, expect, it, vi } from 'vitest';
import { readRegistry } from './registryReader';
import { REGISTRY_LOCATION } from './registryLocation';
import { STORE_CONFIG } from './publish';

// Regression for #213: the reader pointed at the archived `freegamestore`
// repo while publish wrote to `platform`, so reconcile treated new games as
// orphans and deleted their routes. Reader and writer must name the same file.

function captureFetch() {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ games: [] }), { status: 200 });
    }),
  );
  return urls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('registry reader and writer agree on one location (#213)', () => {
  it('the writer config points at the shared registry location', () => {
    expect(STORE_CONFIG.org).toBe(REGISTRY_LOCATION.org);
    expect(STORE_CONFIG.storeRepo).toBe(REGISTRY_LOCATION.repo);
    expect(STORE_CONFIG.storeRegistryPath).toBe(REGISTRY_LOCATION.path);
  });

  it('the reader fetches the same contents URL that publish writes to', async () => {
    const urls = captureFetch();
    await readRegistry('token');

    const writerContentsUrl =
      `https://api.github.com/repos/${STORE_CONFIG.org}/${STORE_CONFIG.storeRepo}` +
      `/contents/${STORE_CONFIG.storeRegistryPath}`;
    expect(urls[0]).toBe(writerContentsUrl);
  });

  it('the reader never reads the archived freegamestore repo', async () => {
    const urls = captureFetch();
    await readRegistry();

    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toContain('/platform/');
      expect(url).toContain('sites/freegamestore/registry.json');
      expect(url).not.toContain('freegamestore-online/freegamestore/');
    }
  });
});
