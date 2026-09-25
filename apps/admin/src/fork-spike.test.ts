import { describe, expect, it, vi } from 'vitest';
import { forkRepo } from './fork-spike';

// Live evidence captured on 2026-09-25, before the disposable repositories
// were deleted: the GitHub fork API created this fork-of-a-repository with the
// exact same main commit SHA.
const SAFE_SOURCE = 'serge-ivo/fgs-fork-api-spike-45-20260925';
const SAFE_FORK = 'freegamestore-online/fgs-fork-api-spike-45-20260925';
const LIVE_SPIKE_SHA = '91349f7c88a0f987e01c226f8232d609b429e60c';

describe('forkRepo spike (#45)', () => {
  it('forks and verifies the known live-API SHA without file enumeration', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url.endsWith(`/repos/${SAFE_SOURCE}/forks`)) {
        return new Response(JSON.stringify({ full_name: SAFE_FORK, default_branch: 'main' }), {
          status: 202,
        });
      }
      return new Response(JSON.stringify({ sha: LIVE_SPIKE_SHA }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await forkRepo(
      SAFE_SOURCE,
      'freegamestore-online',
      'fgs-fork-api-spike-45-20260925',
      {
        token: 'test-token',
        fetchImpl,
      },
    );

    expect(result).toEqual({
      sourceFullName: SAFE_SOURCE,
      forkFullName: SAFE_FORK,
      branch: 'main',
      sourceSha: LIVE_SPIKE_SHA,
      forkSha: LIVE_SPIKE_SHA,
    });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      body: { organization: 'freegamestore-online', name: 'fgs-fork-api-spike-45-20260925' },
    });
    expect(calls.map((call) => call.url)).toEqual([
      `https://api.github.com/repos/${SAFE_SOURCE}/forks`,
      `https://api.github.com/repos/${SAFE_SOURCE}/commits/main`,
      `https://api.github.com/repos/${SAFE_FORK}/commits/main`,
    ]);
  });

  it('has no 40-file cap: a 41-file source still makes only fork and commit requests', async () => {
    // This fixture represents the same failure threshold that truncates Remix.
    // A fork contains the repository's Git graph, so none of these 41 names is
    // sent to or filtered by forkRepo.
    const sourceFixture = Array.from({ length: 41 }, (_, i) => `web/src/file-${i + 1}.ts`);
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith('/forks')) {
        return new Response(
          JSON.stringify({ full_name: 'target-org/remixed-game', default_branch: 'main' }),
          {
            status: 202,
          },
        );
      }
      return new Response(JSON.stringify({ sha: 'complete-sha' }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await forkRepo('source-org/41-files', 'target-org', 'remixed-game', {
      token: 'test-token',
      fetchImpl,
    });

    expect(sourceFixture).toHaveLength(41);
    expect(result.sourceSha).toBe('complete-sha');
    expect(urls).toHaveLength(3);
    expect(urls.some((url) => /\/(contents|git\/trees|git\/blobs)\b/.test(url))).toBe(false);
  });
});
