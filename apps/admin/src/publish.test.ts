import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifySession } from './auth';
import {
  handleDeleteGame,
  handlePublish,
  handleUpdateGame,
  lifecycleStatus,
  normalizeForkedFrom,
  provisionStatus,
  readGameStatus,
  renderRemixAttributionShell,
  setGameStatuses,
} from './publish';

// Regression guards for the admin authz fixes:
//  - provision must not grant push on a repo it didn't just create
//  - unowned games are not self-service editable
//  - session verification fails closed without a signing key

afterEach(() => {
  vi.restoreAllMocks();
});

const GAME_TEMPLATE = { name: 'template-game-canvas', owner: { login: 'freegamestore-online' } };

describe('verifySession', () => {
  it('fails closed when the signing key is empty', async () => {
    // Never verify against a "undefined"/empty key (which would be forgeable).
    expect(await verifySession('aaa.bbb.ccc', '')).toBeNull();
  });
});

describe('handlePublish collaborator escalation', () => {
  it('does NOT add a push collaborator when the repo already exists', async () => {
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal('fetch', async (input: unknown, init?: { method?: string }) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      // GET on the target repo → it already exists (template-generated, so the
      // claim guard lets it through and the collaborator branch is exercised).
      if (method === 'GET' && url.endsWith('/repos/freegamestore-online/chess')) {
        return new Response(JSON.stringify({ id: 123, template_repository: GAME_TEMPLATE }), {
          status: 200,
        });
      }
      // Everything else (registry read/write etc.) → benign 200.
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const env = { GITHUB_TOKEN: 'x', DB: undefined } as unknown as Parameters<
      typeof handlePublish
    >[1];
    // An attacker names an existing game and their own login as creatorGithub.
    await handlePublish(
      { id: 'chess', name: 'Chess', category: 'arcade', creatorGithub: 'attacker' },
      env,
    );

    const collabPuts = calls.filter((c) => c.url.includes('/collaborators/') && c.method === 'PUT');
    expect(collabPuts).toHaveLength(0);
  });
});

describe('handleUpdateGame ownership', () => {
  it('refuses to edit a game that has no recorded owner', async () => {
    const registry = { games: [{ id: 'orphan', name: 'Orphan' }] }; // no creatorGithub
    const content = btoa(JSON.stringify(registry));
    vi.stubGlobal(
      'fetch',
      async () => new Response(JSON.stringify({ content, sha: 's' }), { status: 200 }),
    );

    const env = { GITHUB_TOKEN: 'x' } as unknown as Parameters<typeof handleUpdateGame>[3];
    const res = await handleUpdateGame('orphan', 'anyone', { name: 'Hacked' }, env);
    expect(res.error).toMatch(/no recorded owner/i);
  });

  it('matches the owner case-insensitively (GitHub logins are case-insensitive)', async () => {
    const registry = { games: [{ id: 'chess', name: 'Chess', creatorGithub: 'Serge-The-Dev' }] };
    let putBody: any = null;
    vi.stubGlobal('fetch', async (_input: unknown, init?: { method?: string; body?: string }) => {
      if (init?.method === 'PUT') {
        putBody = JSON.parse(init.body!);
        return new Response(JSON.stringify({ content: {} }), { status: 200 });
      }
      return new Response(JSON.stringify({ content: btoa(JSON.stringify(registry)), sha: 's' }), {
        status: 200,
      });
    });
    const env = { GITHUB_TOKEN: 'x' } as unknown as Parameters<typeof handleUpdateGame>[3];
    const res = await handleUpdateGame('chess', 'serge-the-dev', { name: 'New Name' }, env);
    expect(res.ok).toBe(true);
    expect(putBody).not.toBeNull(); // a write happened → ownership passed despite casing
  });

  it('cannot change immutable fork attribution through metadata PATCH', async () => {
    const attribution = {
      id: 'chess',
      name: 'Chess',
      creatorGithub: 'original-creator',
      forkedAt: '2026-09-25T00:00:00.000Z',
    };
    const registry = {
      games: [
        { id: 'chess', name: 'Chess', creatorGithub: 'original-creator' },
        {
          id: 'chess-remix',
          name: 'Chess Remix',
          creatorGithub: 'remixer',
          forkedFrom: attribution,
        },
      ],
    };
    let written: any;
    vi.stubGlobal('fetch', async (_input: unknown, init?: { method?: string; body?: string }) => {
      if (init?.method === 'PUT') {
        written = JSON.parse(atob(JSON.parse(init.body!).content));
        return new Response(JSON.stringify({ content: {} }), { status: 200 });
      }
      return new Response(JSON.stringify({ content: btoa(JSON.stringify(registry)), sha: 's' }), {
        status: 200,
      });
    });
    const env = { GITHUB_TOKEN: 'x' } as unknown as Parameters<typeof handleUpdateGame>[3];
    const res = await handleUpdateGame(
      'chess-remix',
      'remixer',
      { name: 'Renamed Remix', forkedFrom: { id: 'forged' } },
      env,
    );
    expect(res.ok).toBe(true);
    expect(written.games[1].forkedFrom).toEqual(attribution);
  });
});

describe('legacy forkedFrom compatibility (#44)', () => {
  const source = { id: 'chess', name: 'Chess', creatorGithub: 'original-creator' };

  it('normalizes a legacy id only when every immutable fact is present', () => {
    expect(normalizeForkedFrom('chess', [source], '2026-09-25T00:00:00.000Z')).toEqual({
      id: 'chess',
      name: 'Chess',
      creatorGithub: 'original-creator',
      forkedAt: '2026-09-25T00:00:00.000Z',
    });
  });

  it('preserves an unresolved legacy id instead of fabricating attribution', () => {
    expect(normalizeForkedFrom('deleted-source', [source], '2026-09-25T00:00:00.000Z')).toBe(
      'deleted-source',
    );
  });
});

describe('generated Remix attribution shell (#46)', () => {
  const snapshot = {
    id: 'space-shooter',
    name: 'Space </script><img src=x>',
    creatorGithub: 'original-creator',
    forkedAt: '2026-09-25T00:00:00.000Z',
  };

  it('uses data/text nodes and only makes links with safe rel attributes', () => {
    const shell = renderRemixAttributionShell(snapshot);
    expect(shell).toContain('fgs-remix-attribution');
    expect(shell).toContain('textContent = attribution.name.trim()');
    expect(shell).toContain("rel = 'noopener noreferrer'");
    expect(shell).toContain('registry.games.some');
    expect(shell).toContain("source.href = 'https://' + attribution.id + '.freegamestore.online'");
    expect(shell).not.toContain('</script><img');
  });

  it('refuses malformed attribution instead of emitting an unsafe shell', () => {
    expect(renderRemixAttributionShell({ ...snapshot, id: 'javascript:alert(1)' })).toBe('');
  });
});

describe('handleDeleteGame ownership', () => {
  it("refuses to delete a game the caller doesn't own (no registry/repo writes)", async () => {
    const registry = { games: [{ id: 'chess', name: 'Chess', creatorGithub: 'someone-else' }] };
    const writes: string[] = [];
    vi.stubGlobal('fetch', async (input: unknown, init?: { method?: string }) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (init?.method && init.method !== 'GET') writes.push(`${init.method} ${url}`);
      return new Response(JSON.stringify({ content: btoa(JSON.stringify(registry)), sha: 's' }), {
        status: 200,
      });
    });
    const env = { GITHUB_TOKEN: 'x', DB: undefined } as unknown as Parameters<
      typeof handleDeleteGame
    >[2];
    const res = await handleDeleteGame('chess', 'serge-the-dev', env);
    expect(res.error).toMatch(/only the creator/i);
    expect(writes).toHaveLength(0); // nothing delisted, archived, or route-deleted
  });

  it('deletes a game the caller owns (delists it via a registry PUT)', async () => {
    const registry = { games: [{ id: 'chess', name: 'Chess', creatorGithub: 'serge-the-dev' }] };
    let putBody: any = null;
    const dbRun = vi.fn(async () => {});
    vi.stubGlobal('fetch', async (_input: unknown, init?: { method?: string; body?: string }) => {
      if (init?.method === 'PUT') {
        putBody = JSON.parse(init.body!);
        return new Response(JSON.stringify({ content: {} }), { status: 200 });
      }
      if (init?.method === 'PATCH')
        return new Response(JSON.stringify({ archived: true }), { status: 200 }); // repo archive
      return new Response(JSON.stringify({ content: btoa(JSON.stringify(registry)), sha: 's' }), {
        status: 200,
      });
    });
    const env = {
      GITHUB_TOKEN: 'x',
      DB: { prepare: () => ({ bind: () => ({ run: dbRun }) }) },
    } as unknown as Parameters<typeof handleDeleteGame>[2];
    const res = await handleDeleteGame('chess', 'serge-the-dev', env);
    expect(res.ok).toBe(true);
    expect(putBody.content).toBeDefined(); // registry rewritten (entry removed)
    expect(dbRun).toHaveBeenCalled(); // route deletion attempted
  });

  it('reports a failed GitHub archive instead of claiming the repo was archived', async () => {
    const registry = { games: [{ id: 'chess', name: 'Chess', creatorGithub: 'serge-the-dev' }] };
    vi.stubGlobal('fetch', async (_input: unknown, init?: { method?: string }) => {
      if (init?.method === 'PUT') {
        return new Response(JSON.stringify({ content: {} }), { status: 200 });
      }
      if (init?.method === 'PATCH') {
        return new Response(JSON.stringify({ message: 'GitHub is unavailable' }), { status: 503 });
      }
      return new Response(JSON.stringify({ content: btoa(JSON.stringify(registry)), sha: 's' }), {
        status: 200,
      });
    });
    const env = {
      GITHUB_TOKEN: 'x',
      DB: { prepare: () => ({ bind: () => ({ run: async () => {} }) }) },
    } as unknown as Parameters<typeof handleDeleteGame>[2];

    const res = await handleDeleteGame('chess', 'serge-the-dev', env);

    expect(res.ok).toBe(true); // Delisting succeeded; cleanup status is per-step.
    expect(res.steps).toContainEqual({
      name: 'Repo',
      status: 'fail',
      detail: 'GitHub is unavailable',
    });
    expect(res.steps).not.toContainEqual(expect.objectContaining({ name: 'Repo', status: 'ok' }));
  });

  it('reports a failed agent session purge instead of treating any response as success', async () => {
    const registry = { games: [{ id: 'chess', name: 'Chess', creatorGithub: 'serge-the-dev' }] };
    vi.stubGlobal('fetch', async (_input: unknown, init?: { method?: string }) => {
      if (init?.method === 'PUT')
        return new Response(JSON.stringify({ content: {} }), { status: 200 });
      if (init?.method === 'PATCH')
        return new Response(JSON.stringify({ archived: true }), { status: 200 });
      return new Response(JSON.stringify({ content: btoa(JSON.stringify(registry)), sha: 's' }), {
        status: 200,
      });
    });
    const env = {
      GITHUB_TOKEN: 'x',
      DB: { prepare: () => ({ bind: () => ({ run: async () => {} }) }) },
      INTERNAL_TOKEN: 'internal',
      AGENT: { fetch: async () => new Response('busy', { status: 503 }) },
    } as unknown as Parameters<typeof handleDeleteGame>[2];

    const res = await handleDeleteGame('chess', 'serge-the-dev', env);

    expect(res.steps).toContainEqual({
      name: 'Session index',
      status: 'fail',
      detail: 'agent returned 503',
    });
  });
});

describe('handlePublish reserved-id guard', () => {
  it('rejects reserved infra ids before touching GitHub', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: unknown) => {
      calls.push(typeof input === 'string' ? input : (input as Request).url);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const env = { GITHUB_TOKEN: 'x', DB: undefined } as unknown as Parameters<
      typeof handlePublish
    >[1];
    // Exact infra ids + any template-game-* variant must be rejected as reserved.
    for (const id of [
      'submissions',
      'brand',
      'ops',
      'sdk',
      'template-game-canvas',
      'template-game-9000',
    ]) {
      const res = await handlePublish({ id, name: 'X', category: 'arcade' }, env);
      expect(res.success).toBe(false);
      expect(res.steps[0]!.detail).toMatch(/reserved/i);
    }
    // `freegamestore` is also refused (via the free-prefix rule) — never provisioned.
    const fg = await handlePublish({ id: 'freegamestore', name: 'X', category: 'arcade' }, env);
    expect(fg.success).toBe(false);
    // Not one of these reached GitHub.
    expect(calls).toHaveLength(0);
  });
});

describe('handlePublish repo-existence fail-safe', () => {
  it('aborts (no generate) when the existence check is inconclusive (403 rate-limit)', async () => {
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal('fetch', async (input: unknown, init?: { method?: string }) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      // The existence check returns 403 (rate limit / token issue) — inconclusive.
      if (method === 'GET' && url.endsWith('/repos/freegamestore-online/chess')) {
        return new Response(JSON.stringify({ message: 'rate limited' }), { status: 403 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const env = { GITHUB_TOKEN: 'x', DB: undefined } as unknown as Parameters<
      typeof handlePublish
    >[1];
    const res = await handlePublish({ id: 'chess', name: 'Chess', category: 'arcade' }, env);
    expect(res.success).toBe(false);
    expect(res.steps[0]!.detail).toMatch(/could not verify/i);
    // Crucially: it did NOT proceed to generate a repo over the unknown state.
    expect(calls.filter((c) => c.url.includes('/generate'))).toHaveLength(0);
  });
});

describe('handlePublish interrupted-provision heal', () => {
  // Stub GitHub so the target repo already exists; `pkgJson` is what root
  // package.json contains (drives the APPNAME-still-present gate).
  function stub(pkgJson: string) {
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal('fetch', async (input: unknown, init?: { method?: string; body?: string }) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      if (method === 'GET' && url.endsWith('/repos/freegamestore-online/chess')) {
        // Repo exists and was generated from a game template (a cut-off provision).
        return new Response(JSON.stringify({ id: 123, template_repository: GAME_TEMPLATE }), {
          status: 200,
        });
      }
      if (method === 'GET' && url.includes('/contents/package.json')) {
        return new Response(JSON.stringify({ content: btoa(pkgJson) }), { status: 200 });
      }
      if (method === 'GET' && url.includes('/collaborators/')) {
        return new Response(null, { status: 204 }); // the creator was invited by their own provision
      }
      if (method === 'GET' && url.includes('/freegamestore/contents/registry.json')) {
        // Unlisted: the provision was cut off before its registry write.
        return new Response(
          JSON.stringify({ content: btoa(JSON.stringify({ games: [] })), sha: 's' }),
          { status: 200 },
        );
      }
      if (method === 'GET' && url.includes('/contents/')) {
        return new Response(JSON.stringify({}), { status: 404 }); // other targets absent
      }
      if (method === 'GET' && url.includes('/git/ref/heads/main')) {
        return new Response(JSON.stringify({ object: { sha: 'headsha' } }), { status: 200 });
      }
      if (method === 'GET' && url.includes('/git/commits/')) {
        return new Response(JSON.stringify({ tree: { sha: 'basetree' } }), { status: 200 });
      }
      if (method === 'POST' && url.includes('/git/blobs')) {
        return new Response(JSON.stringify({ sha: 'blobsha' }), { status: 200 });
      }
      if (method === 'POST' && url.includes('/git/trees')) {
        return new Response(JSON.stringify({ sha: 'treesha' }), { status: 200 });
      }
      if (method === 'POST' && url.includes('/git/commits')) {
        return new Response(JSON.stringify({ sha: 'commitsha' }), { status: 200 });
      }
      if (method === 'PATCH' && url.includes('/git/refs/heads/main')) {
        return new Response(JSON.stringify({ ref: 'refs/heads/main' }), { status: 200 });
      }
      // registry read/write + everything else benign
      return new Response(
        JSON.stringify({ ok: true, content: btoa(JSON.stringify({ games: [] })), sha: 's' }),
        { status: 200 },
      );
    });
    return calls;
  }

  it('re-runs substitution when the existing repo still has APPNAME (heals a cut-off provision)', async () => {
    const calls = stub(JSON.stringify({ name: 'APPNAME' }));
    const env = { GITHUB_TOKEN: 'x', DB: undefined } as unknown as Parameters<
      typeof handlePublish
    >[1];
    const res = await handlePublish(
      { id: 'chess', name: 'Chess', category: 'arcade', creatorGithub: 'serge-the-dev' },
      env,
    );
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/git/commits'))).toBe(true);
    expect(res.steps.some((s) => s.name === 'Naming')).toBe(true);
  });

  it('does NOT re-substitute an established game (package.json already named)', async () => {
    const calls = stub(JSON.stringify({ name: 'chess' }));
    const env = { GITHUB_TOKEN: 'x', DB: undefined } as unknown as Parameters<
      typeof handlePublish
    >[1];
    const res = await handlePublish(
      { id: 'chess', name: 'Chess', category: 'arcade', creatorGithub: 'serge-the-dev' },
      env,
    );
    // The game's real files are never rewritten: no naming commit, no Naming step.
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/git/commits'))).toBe(false);
    expect(res.steps.some((s) => s.name === 'Naming')).toBe(false);
  });
});

describe('handlePublish owner validation', () => {
  it('aborts before any repo/registry write when creatorGithub is malformed', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: unknown) => {
      calls.push(typeof input === 'string' ? input : (input as Request).url);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const env = { GITHUB_TOKEN: 'x', DB: undefined } as unknown as Parameters<
      typeof handlePublish
    >[1];
    const res = await handlePublish(
      { id: 'chess', name: 'Chess', category: 'arcade', creatorGithub: 'bad name!!' },
      env,
    );
    expect(res.success).toBe(false);
    expect(res.steps[0]!.detail).toMatch(/invalid creatorgithub/i);
    // Nothing touched GitHub — no repo check, no generate, no registry write.
    expect(calls).toHaveLength(0);
  });
});

describe('handlePublish cloneFrom validation (#34)', () => {
  it('rejects a malformed or reserved remix source before touching GitHub', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: unknown) => {
      calls.push(typeof input === 'string' ? input : (input as Request).url);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const env = { GITHUB_TOKEN: 'x', DB: undefined } as unknown as Parameters<
      typeof handlePublish
    >[1];
    for (const cloneFrom of [
      '../../orgs/x',
      'chess/contents',
      'a?b=1',
      'ops',
      'template-game-canvas',
      'freegamestore',
    ]) {
      const res = await handlePublish(
        { id: 'chess', name: 'Chess', category: 'arcade', cloneFrom },
        env,
      );
      expect(res.success).toBe(false);
      expect(res.steps[0]!.detail).toMatch(/invalid cloneFrom/i);
    }
    expect(calls).toHaveLength(0);
  });

  it('refuses a source without complete credit before creating the target repo', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      calls.push(url);
      return new Response(
        JSON.stringify({
          content: btoa(JSON.stringify({ games: [{ id: 'chess', name: 'Chess' }] })),
        }),
        { status: 200 },
      );
    });
    const env = { GITHUB_TOKEN: 'x', DB: undefined } as unknown as Parameters<
      typeof handlePublish
    >[1];
    const res = await handlePublish(
      { id: 'chess-remix', name: 'Chess Remix', category: 'arcade', cloneFrom: 'chess' },
      env,
    );
    expect(res.success).toBe(false);
    expect(res.steps[0]).toMatchObject({ name: 'Fork attribution', status: 'fail' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/contents/registry.json');
  });
});

describe('handlePublish Remix truncation regression (#45)', () => {
  it('silently commits only MAX_FILES=40 when the source has 41 eligible files', async () => {
    const sourceId = 'source-game';
    const targetId = 'remixed-game';
    const sourceFiles = Array.from({ length: 41 }, (_, i) => ({
      path: `web/src/file-${i + 1}.ts`,
      sha: `source-blob-${i + 1}`,
      type: 'blob',
    }));
    const committedTrees: Array<Array<{ path: string }>> = [];
    const sourceBlobReads: string[] = [];

    vi.stubGlobal('fetch', async (input: unknown, init?: { method?: string; body?: string }) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith(`/repos/freegamestore-online/${targetId}`)) {
        return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      }
      if (method === 'POST' && url.includes('/generate')) {
        return new Response(JSON.stringify({ id: 1 }), { status: 201 });
      }
      if (
        method === 'GET' &&
        url.endsWith(`/repos/freegamestore-online/${sourceId}/contents/web/package.json`)
      ) {
        return new Response(JSON.stringify({ content: btoa('{}') }), { status: 200 });
      }
      if (
        method === 'GET' &&
        url.endsWith(`/repos/freegamestore-online/${sourceId}/git/ref/heads/main`)
      ) {
        return new Response(JSON.stringify({ object: { sha: 'source-head' } }), { status: 200 });
      }
      if (
        method === 'GET' &&
        url.endsWith(`/repos/freegamestore-online/${sourceId}/git/commits/source-head`)
      ) {
        return new Response(JSON.stringify({ tree: { sha: 'source-tree' } }), { status: 200 });
      }
      if (
        method === 'GET' &&
        url.includes(`/repos/freegamestore-online/${sourceId}/git/trees/source-tree?recursive=1`)
      ) {
        return new Response(JSON.stringify({ tree: sourceFiles }), { status: 200 });
      }
      if (method === 'GET' && url.includes(`/repos/freegamestore-online/${sourceId}/git/blobs/`)) {
        sourceBlobReads.push(url);
        return new Response(JSON.stringify({ content: btoa('source file'), encoding: 'base64' }), {
          status: 200,
        });
      }
      if (method === 'GET' && url.includes('/git/ref/heads/main')) {
        return new Response(JSON.stringify({ object: { sha: 'target-head' } }), { status: 200 });
      }
      if (method === 'GET' && url.includes('/git/commits/')) {
        return new Response(JSON.stringify({ tree: { sha: 'target-tree' } }), { status: 200 });
      }
      if (method === 'GET' && url.includes('/contents/registry.json')) {
        return new Response(
          JSON.stringify({
            content: btoa(
              JSON.stringify({
                games: [{ id: sourceId, name: 'Source Game', creatorGithub: 'source-creator' }],
              }),
            ),
            sha: 'registry-sha',
          }),
          {
            status: 200,
          },
        );
      }
      if (method === 'PUT' && url.includes('/contents/registry.json')) {
        return new Response(JSON.stringify({ content: {} }), { status: 200 });
      }
      if (method === 'POST' && url.endsWith('/git/trees')) {
        const body = JSON.parse(init!.body!);
        if (body.tree.every((item: { path: string }) => item.path.startsWith('web/src/file-'))) {
          committedTrees.push(body.tree);
        }
        return new Response(JSON.stringify({ sha: 'new-tree' }), { status: 201 });
      }
      if (method === 'POST' && url.endsWith('/git/blobs')) {
        return new Response(JSON.stringify({ sha: 'new-blob' }), { status: 201 });
      }
      if (method === 'POST' && url.endsWith('/git/commits')) {
        return new Response(JSON.stringify({ sha: 'new-commit' }), { status: 201 });
      }
      if (method === 'PATCH' && url.includes('/git/refs/heads/main')) {
        return new Response(JSON.stringify({ ref: 'refs/heads/main' }), { status: 200 });
      }
      if (method === 'GET' && url.includes('/contents/')) {
        return new Response(JSON.stringify({ content: btoa('APPNAME'), sha: 'file-sha' }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const env = { GITHUB_TOKEN: 'x', DB: undefined } as unknown as Parameters<
      typeof handlePublish
    >[1];
    const result = await handlePublish(
      { id: targetId, name: 'Remixed Game', category: 'arcade', cloneFrom: sourceId },
      env,
    );

    const remix = result.steps.find((step) => step.name === 'Remix');
    expect(sourceFiles).toHaveLength(41);
    expect(sourceBlobReads).toHaveLength(40);
    expect(committedTrees).toHaveLength(1);
    expect(committedTrees[0]).toHaveLength(40);
    expect(committedTrees[0]!.map((item) => item.path)).not.toContain('web/src/file-41.ts');
    expect(remix).toMatchObject({
      status: 'ok',
      detail: 'copied 40 files from source-game (first 40 of 41)',
    });
  });
});

// Build-status lifecycle (#22). Provisioning writes `pending` before the first
// build, so nothing may report a game live until a deploy.yml run concludes
// success. These guard the transition rules that make that safe.

/** Registry read/write stub. Returns the games it was given on GET, and records
 *  what a PUT would have committed. */
function registryStub(games: unknown[], opts: { putStatus?: number } = {}) {
  const puts: Array<{ games: any[]; message: string }> = [];
  const fetchFn = async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const method = init?.method ?? 'GET';
    if (url.includes('/contents/registry.json')) {
      if (method === 'GET') {
        return new Response(
          JSON.stringify({ content: btoa(JSON.stringify({ games })), sha: 'sha1' }),
          { status: 200 },
        );
      }
      const body = JSON.parse(init!.body!);
      const status = opts.putStatus ?? 200;
      if (status !== 200) return new Response(JSON.stringify({ message: 'conflict' }), { status });
      puts.push({ games: JSON.parse(atob(body.content)).games, message: body.message });
      return new Response(JSON.stringify({ content: { sha: 'sha2' } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  return { puts, fetchFn };
}

const envWithToken = () =>
  ({ GITHUB_TOKEN: 'x', DB: undefined }) as unknown as Parameters<typeof setGameStatuses>[0];

describe('readGameStatus', () => {
  it('treats a missing status as live — every entry predating the field is genuinely live', () => {
    expect(readGameStatus({})).toBe('live');
    expect(readGameStatus(undefined)).toBe('live');
  });

  it('does not hide a game on an unrecognised status', () => {
    expect(readGameStatus({ status: 'wat' })).toBe('live');
  });

  it('reads the three real states', () => {
    expect(readGameStatus({ status: 'pending' })).toBe('pending');
    expect(readGameStatus({ status: 'failed' })).toBe('failed');
    expect(readGameStatus({ status: 'live' })).toBe('live');
  });
});

describe('setGameStatuses', () => {
  it('flips pending → live and commits it', async () => {
    const { puts, fetchFn } = registryStub([{ id: 'chess', status: 'pending' }]);
    vi.stubGlobal('fetch', fetchFn);
    const res = await setGameStatuses(envWithToken(), [{ id: 'chess', status: 'live' }]);
    expect(res.ok).toBe(true);
    expect(res.updated).toEqual(['chess']);
    expect(puts).toHaveLength(1);
    expect(puts[0]!.games[0].status).toBe('live');
  });

  it('flips pending → failed for a game that has never shipped', async () => {
    const { puts, fetchFn } = registryStub([{ id: 'chess', status: 'pending' }]);
    vi.stubGlobal('fetch', fetchFn);
    const res = await setGameStatuses(envWithToken(), [{ id: 'chess', status: 'failed' }]);
    expect(res.updated).toEqual(['chess']);
    expect(puts[0]!.games[0].status).toBe('failed');
  });

  it('REFUSES to move a live game to failed — R2 still serves its last good build', async () => {
    const { puts, fetchFn } = registryStub([{ id: 'chess', status: 'live' }]);
    vi.stubGlobal('fetch', fetchFn);
    const res = await setGameStatuses(envWithToken(), [{ id: 'chess', status: 'failed' }]);
    expect(res.ok).toBe(true);
    expect(res.updated).toEqual([]);
    expect(res.skipped[0]).toMatch(/live/);
    // Nothing was committed at all — a shipped game is never delisted by a
    // later red build.
    expect(puts).toHaveLength(0);
  });

  it('REFUSES to downgrade a legacy entry with no status field', async () => {
    const { puts, fetchFn } = registryStub([{ id: 'chess' }]);
    vi.stubGlobal('fetch', fetchFn);
    const res = await setGameStatuses(envWithToken(), [{ id: 'chess', status: 'failed' }]);
    expect(res.updated).toEqual([]);
    expect(puts).toHaveLength(0);
  });

  it('batches several flips into ONE commit', async () => {
    const { puts, fetchFn } = registryStub([
      { id: 'a', status: 'pending' },
      { id: 'b', status: 'pending' },
      { id: 'c', status: 'live' },
    ]);
    vi.stubGlobal('fetch', fetchFn);
    const res = await setGameStatuses(envWithToken(), [
      { id: 'a', status: 'live' },
      { id: 'b', status: 'failed' },
    ]);
    expect(res.updated).toEqual(['a', 'b']);
    expect(puts).toHaveLength(1);
    expect(puts[0]!.games.find((g: any) => g.id === 'a').status).toBe('live');
    expect(puts[0]!.games.find((g: any) => g.id === 'b').status).toBe('failed');
    // The untargeted entry is carried through untouched.
    expect(puts[0]!.games.find((g: any) => g.id === 'c').status).toBe('live');
  });

  it('skips an unknown id rather than failing the batch', async () => {
    const { fetchFn } = registryStub([{ id: 'chess', status: 'pending' }]);
    vi.stubGlobal('fetch', fetchFn);
    const res = await setGameStatuses(envWithToken(), [
      { id: 'ghost', status: 'live' },
      { id: 'chess', status: 'live' },
    ]);
    expect(res.ok).toBe(true);
    expect(res.updated).toEqual(['chess']);
    expect(res.skipped.some((s) => s.includes('ghost'))).toBe(true);
  });

  it('writes nothing when there is no real transition', async () => {
    const { puts, fetchFn } = registryStub([{ id: 'chess', status: 'live' }]);
    vi.stubGlobal('fetch', fetchFn);
    const res = await setGameStatuses(envWithToken(), [{ id: 'chess', status: 'live' }]);
    expect(res.ok).toBe(true);
    expect(puts).toHaveLength(0);
  });

  it('reports failure when the registry write stays contended', async () => {
    const { fetchFn } = registryStub([{ id: 'chess', status: 'pending' }], { putStatus: 409 });
    vi.stubGlobal('fetch', fetchFn);
    const res = await setGameStatuses(envWithToken(), [{ id: 'chess', status: 'live' }]);
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/contended/i);
  });
});

/** Drives a NEW-game provision far enough to capture the first registry PUT.
 *  Awaits that PUT rather than the whole provision: later steps (placeholder
 *  substitution, route insert) retry against a stub that can never satisfy them,
 *  and the entry shape is settled by the time it commits. */
function firstRegistryPut(req: Parameters<typeof handlePublish>[0]): Promise<any[]> {
  let resolvePut: (games: any[]) => void;
  const firstPut = new Promise<any[]>((r) => {
    resolvePut = r;
  });

  vi.stubGlobal('fetch', async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const method = init?.method ?? 'GET';
    if (url.includes('/contents/registry.json')) {
      if (method === 'GET') {
        const sourceId = req.cloneFrom?.trim().toLowerCase();
        return new Response(
          JSON.stringify({
            content: btoa(
              JSON.stringify({
                games: sourceId
                  ? [{ id: sourceId, name: 'Chess', creatorGithub: 'source-creator' }]
                  : [],
              }),
            ),
            sha: 'sha1',
          }),
          { status: 200 },
        );
      }
      resolvePut(JSON.parse(atob(JSON.parse(init!.body!).content)).games);
      return new Response(JSON.stringify({ content: { sha: 'sha2' } }), { status: 200 });
    }
    // Target repo does not exist yet → provision proceeds down the create path.
    if (method === 'GET' && url.endsWith(`/repos/freegamestore-online/${req.id}`)) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    }
    // The APPNAME substitution step polls for the generated repo's main ref
    // (12 × 1.5s) before it commits. Answer it immediately so the run reaches
    // the registry write inside the test timeout instead of spinning there.
    if (url.includes('/git/ref/heads/main')) {
      return new Response(JSON.stringify({ object: { sha: 'headsha' } }), { status: 200 });
    }
    if (url.includes('/git/commits/')) {
      return new Response(JSON.stringify({ tree: { sha: 'treesha' } }), { status: 200 });
    }
    // Any other repo file read (the substitution targets) — a real contents
    // payload, so the step completes rather than retrying on a decode failure.
    if (method === 'GET' && url.includes('/contents/')) {
      return new Response(JSON.stringify({ content: btoa('APPNAME'), sha: 's' }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify({ ok: true, id: 1 }), { status: 200 });
  });

  const env = { GITHUB_TOKEN: 'x', DB: undefined } as unknown as Parameters<
    typeof handlePublish
  >[1];
  void handlePublish(req, env);
  return firstPut;
}

describe('handlePublish build status', () => {
  it('lists a NEW game as pending — provisioning runs before the first build', async () => {
    const games = await firstRegistryPut({
      id: 'chess',
      name: 'Chess',
      category: 'arcade',
      creatorGithub: 'someone',
    });
    expect(games.find((g: any) => g.id === 'chess').status).toBe('pending');
  });

  it('records the provisioned HEAD so the scaffold build is never read as live (#67)', async () => {
    const games = await firstRegistryPut({
      id: 'chess',
      name: 'Chess',
      category: 'arcade',
      creatorGithub: 'someone',
    });
    // firstRegistryPut's stub answers the main ref with sha "headsha".
    expect(games.find((g: any) => g.id === 'chess').provisionedSha).toBe('headsha');
  });
});

// #44 snapshots immutable source credit at the moment a remix is created.
describe('handlePublish forkedFrom lineage', () => {
  it('records immutable source attribution for a remix', async () => {
    const games = await firstRegistryPut({
      id: 'chess-remix',
      name: 'Chess Remix',
      category: 'arcade',
      creatorGithub: 'someone',
      cloneFrom: ' Chess ',
    });
    expect(games.find((g: any) => g.id === 'chess-remix').forkedFrom).toMatchObject({
      id: 'chess',
      name: 'Chess',
      creatorGithub: 'source-creator',
      forkedAt: expect.any(String),
    });
  });

  it('omits forkedFrom on a game that is not a remix', async () => {
    const games = await firstRegistryPut({
      id: 'chess',
      name: 'Chess',
      category: 'arcade',
      creatorGithub: 'someone',
    });
    expect(games.find((g: any) => g.id === 'chess')).not.toHaveProperty('forkedFrom');
  });
});

// Deprovision from the console (#14). handleDeleteGame gained an ADMIN OVERRIDE
// because an ops console whose delete button only works on the admin's own games
// is not an ops console. It is destructive — delist + route drop + repo archive —
// so the ownership rule must still hold for everyone else.

function deleteStub(registry: unknown[], opts: { putOk?: boolean } = {}) {
  const calls: string[] = [];
  const fetchFn = async (input: unknown, init?: { method?: string }) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const method = init?.method ?? 'GET';
    if (method !== 'GET') calls.push(`${method} ${url}`);
    if (url.includes('/contents/registry.json')) {
      if (method === 'GET') {
        return new Response(
          JSON.stringify({ content: btoa(JSON.stringify({ games: registry })), sha: 's' }),
          { status: 200 },
        );
      }
      return opts.putOk === false
        ? new Response(JSON.stringify({ message: 'conflict' }), { status: 409 })
        : new Response(JSON.stringify({ content: { sha: 's2' } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  return { calls, fetchFn };
}

const deleteEnv = () =>
  ({
    GITHUB_TOKEN: 'x',
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) },
  }) as unknown as Parameters<typeof handleDeleteGame>[2];

describe('handleDeleteGame admin override', () => {
  it('lets an admin deprovision a game they do NOT own', async () => {
    const { calls, fetchFn } = deleteStub([
      { id: 'chess', name: 'Chess', creatorGithub: 'someone-else' },
    ]);
    vi.stubGlobal('fetch', fetchFn);
    const res = await handleDeleteGame('chess', 'admin@example.com', deleteEnv(), {
      adminOverride: true,
    });
    expect(res.ok).toBe(true);
    expect(calls.some((c) => c.startsWith('PUT') && c.includes('registry.json'))).toBe(true);
  });

  it('STILL refuses a non-owner without the override', async () => {
    const { calls, fetchFn } = deleteStub([
      { id: 'chess', name: 'Chess', creatorGithub: 'someone-else' },
    ]);
    vi.stubGlobal('fetch', fetchFn);
    const res = await handleDeleteGame('chess', 'serge-the-dev', deleteEnv());
    expect(res.error).toMatch(/only the creator/i);
    expect(calls).toHaveLength(0); // nothing delisted, archived or route-dropped
  });

  it('lets the override delete a game with no recorded owner', async () => {
    // Ownerless games are exactly the orphans an operator needs to clean up; the
    // normal path refuses them outright.
    const { fetchFn } = deleteStub([{ id: 'orphan', name: 'Orphan' }]);
    vi.stubGlobal('fetch', fetchFn);
    expect(
      (await handleDeleteGame('orphan', 'admin', deleteEnv(), { adminOverride: true })).ok,
    ).toBe(true);
  });

  it('reports a step-by-step result the console can render', async () => {
    const { fetchFn } = deleteStub([{ id: 'chess', name: 'Chess', creatorGithub: 'alice' }]);
    vi.stubGlobal('fetch', fetchFn);
    const res = await handleDeleteGame('chess', 'alice', deleteEnv());
    const names = (res.steps ?? []).map((s) => s.name);
    expect(names).toContain('Store registry');
    expect(names).toContain('Hosting route');
    expect(names).toContain('Repo');
    expect(res.steps!.every((s) => ['ok', 'skip', 'fail'].includes(s.status))).toBe(true);
  });

  it('returns the failing step when the registry write fails', async () => {
    const { fetchFn } = deleteStub([{ id: 'chess', name: 'Chess', creatorGithub: 'alice' }], {
      putOk: false,
    });
    vi.stubGlobal('fetch', fetchFn);
    const res = await handleDeleteGame('chess', 'alice', deleteEnv());
    expect(res.error).toBeTruthy();
    expect(res.steps?.[0]).toMatchObject({ name: 'Store registry', status: 'fail' });
  });
});

describe('handlePublish existing-repo claim guard (#61)', () => {
  const env = { GITHUB_TOKEN: 'x', DB: undefined } as unknown as Parameters<
    typeof handlePublish
  >[1];

  // `repo` is the GET /repos/{org}/{id} body; `registry` is registry.json (or
  // null for an unreadable registry).
  function stub(
    id: string,
    repo: Record<string, unknown>,
    registry: unknown,
    access: { collaborator?: number; invitees?: string[] } = { collaborator: 204 },
  ) {
    const writes: string[] = [];
    vi.stubGlobal('fetch', async (input: unknown, init?: { method?: string }) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = init?.method ?? 'GET';
      if (method !== 'GET') writes.push(`${method} ${url}`);
      if (method === 'GET' && url.endsWith(`/repos/freegamestore-online/${id}`)) {
        return new Response(JSON.stringify({ id: 1, ...repo }), { status: 200 });
      }
      if (method === 'GET' && url.includes(`/repos/freegamestore-online/${id}/collaborators/`)) {
        const status = access.collaborator ?? 404;
        return new Response(status === 204 ? null : JSON.stringify({}), { status });
      }
      if (method === 'GET' && url.includes(`/repos/freegamestore-online/${id}/invitations`)) {
        const invites = (access.invitees ?? []).map((login) => ({ invitee: { login } }));
        return new Response(JSON.stringify(invites), { status: 200 });
      }
      if (method === 'GET' && url.includes('/freegamestore/contents/registry.json')) {
        return registry === null
          ? new Response(JSON.stringify({ message: 'Server Error' }), { status: 500 })
          : new Response(JSON.stringify({ content: btoa(JSON.stringify(registry)), sha: 's' }), {
              status: 200,
            });
      }
      if (method === 'GET' && url.includes('/contents/')) {
        return new Response(JSON.stringify({}), { status: 404 }); // repo files absent
      }
      return new Response(JSON.stringify({ ok: true, content: {} }), { status: 200 });
    });
    return writes;
  }

  it('refuses to register an existing non-game org repo (e.g. the platform monorepo)', async () => {
    const writes = stub('platform', { private: true, template_repository: null }, { games: [] });
    const res = await handlePublish(
      { id: 'platform', name: 'x', category: 'arcade', creatorGithub: 'attacker' },
      env,
    );
    expect(res.success).toBe(false);
    expect(res.steps).toContainEqual(
      expect.objectContaining({ name: 'GitHub repo', status: 'fail' }),
    );
    // No registry entry, route, collaborator, or naming commit — nothing written.
    expect(writes).toHaveLength(0);
  });

  it('refuses a repo generated from a non-game template', async () => {
    const writes = stub(
      'spike',
      { template_repository: { name: 'platform', owner: { login: 'freegamestore-online' } } },
      { games: [] },
    );
    const res = await handlePublish(
      { id: 'spike', name: 'x', category: 'arcade', creatorGithub: 'attacker' },
      env,
    );
    expect(res.success).toBe(false);
    expect(writes).toHaveLength(0);
  });

  it("refuses to re-claim a deleted game's archived repo", async () => {
    const writes = stub(
      'old-game',
      { archived: true, template_repository: GAME_TEMPLATE },
      {
        games: [],
      },
    );
    const res = await handlePublish(
      { id: 'old-game', name: 'x', category: 'arcade', creatorGithub: 'attacker' },
      env,
    );
    expect(res.success).toBe(false);
    expect(writes).toHaveLength(0);
  });

  it('fails closed when the registry cannot be read', async () => {
    const writes = stub('new-game', { template_repository: GAME_TEMPLATE }, null);
    const res = await handlePublish(
      { id: 'new-game', name: 'x', category: 'arcade', creatorGithub: 'me' },
      env,
    );
    expect(res.success).toBe(false);
    expect(res.steps.at(-1)?.detail).toMatch(/Could not read registry\.json/);
    expect(writes).toHaveLength(0);
  });

  it('still heals an unlisted repo generated from a game template (cut-off provision)', async () => {
    const writes = stub('new-game', { template_repository: GAME_TEMPLATE }, { games: [] });
    const res = await handlePublish(
      { id: 'new-game', name: 'New', category: 'arcade', creatorGithub: 'me' },
      env,
    );
    expect(res.steps).toContainEqual(
      expect.objectContaining({ name: 'GitHub repo', status: 'skip' }),
    );
    expect(writes.some((w) => w.startsWith('PUT') && w.includes('registry.json'))).toBe(true);
  });

  it('still re-provisions an already-listed legacy game without template provenance', async () => {
    stub('chess', { template_repository: null }, { games: [{ id: 'chess', name: 'Chess' }] });
    const res = await handlePublish(
      { id: 'chess', name: 'Chess', category: 'arcade', creatorGithub: 'me' },
      env,
    );
    expect(res.steps).toContainEqual(
      expect.objectContaining({ name: 'GitHub repo', status: 'skip' }),
    );
    expect(res.steps).not.toContainEqual(
      expect.objectContaining({ name: 'GitHub repo', status: 'fail' }),
    );
  });
});

describe('handlePublish ownership of an existing id (#88)', () => {
  const env = { GITHUB_TOKEN: 'x', DB: undefined } as unknown as Parameters<
    typeof handlePublish
  >[1];
  const req = (id: string, creatorGithub: string) => ({
    id,
    name: 'Space Invaders',
    category: 'arcade',
    creatorGithub,
  });

  function stub(opts: {
    repoStatus: number;
    repo?: Record<string, unknown>;
    registry: unknown;
    collaborator?: number;
    invitees?: string[];
    generate?: { status: number; body: Record<string, unknown> };
  }) {
    const writes: string[] = [];
    vi.stubGlobal('fetch', async (input: unknown, init?: { method?: string }) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = init?.method ?? 'GET';
      if (method !== 'GET') writes.push(`${method} ${url}`);
      if (method === 'POST' && url.endsWith('/generate')) {
        const g = opts.generate ?? { status: 201, body: { id: 9 } };
        return new Response(JSON.stringify(g.body), { status: g.status });
      }
      if (method === 'GET' && url.endsWith('/repos/freegamestore-online/space-invaders')) {
        return new Response(
          JSON.stringify({ id: 1, template_repository: GAME_TEMPLATE, ...opts.repo }),
          { status: opts.repoStatus },
        );
      }
      if (method === 'GET' && url.includes('/git/ref/heads/main')) {
        return new Response(JSON.stringify({ object: { sha: 'headsha' } }), { status: 200 });
      }
      if (method === 'GET' && url.includes('/git/commits/')) {
        return new Response(JSON.stringify({ tree: { sha: 'basetree' } }), { status: 200 });
      }
      if (method === 'POST' && /\/git\/(blobs|trees|commits)$/.test(url)) {
        return new Response(JSON.stringify({ sha: 'newsha' }), { status: 201 });
      }
      if (method === 'GET' && url.includes('/space-invaders/collaborators/')) {
        const status = opts.collaborator ?? 404;
        return new Response(status === 204 ? null : JSON.stringify({}), { status });
      }
      if (method === 'GET' && url.includes('/space-invaders/invitations')) {
        return new Response(
          JSON.stringify((opts.invitees ?? []).map((login) => ({ invitee: { login } }))),
          { status: 200 },
        );
      }
      if (method === 'GET' && url.includes('/freegamestore/contents/registry.json')) {
        return new Response(
          JSON.stringify({ content: btoa(JSON.stringify(opts.registry)), sha: 's' }),
          { status: 200 },
        );
      }
      if (method === 'GET' && url.includes('/contents/')) {
        return new Response(JSON.stringify({}), { status: 404 });
      }
      return new Response(JSON.stringify({ ok: true, content: {} }), { status: 200 });
    });
    return writes;
  }

  it('refuses an id listed under another creator, with nothing written', async () => {
    const writes = stub({
      repoStatus: 200,
      registry: { games: [{ id: 'space-invaders', creatorGithub: 'alice' }] },
    });
    const res = await handlePublish(req('space-invaders', 'bob'), env);
    expect(res.success).toBe(false);
    expect(res.conflict).toBe(true);
    expect(writes).toHaveLength(0);
  });

  it('lets the recorded creator re-provision their own game (case-insensitive)', async () => {
    stub({
      repoStatus: 200,
      registry: { games: [{ id: 'space-invaders', creatorGithub: 'Alice' }] },
    });
    const res = await handlePublish(req('space-invaders', 'alice'), env);
    expect(res.conflict).toBeUndefined();
    expect(res.steps).toContainEqual(
      expect.objectContaining({ name: 'Store registry', status: 'skip' }),
    );
  });

  it('refuses an unlisted repo the caller did not create (race: they lost the generate)', async () => {
    const writes = stub({
      repoStatus: 200,
      registry: { games: [] },
      collaborator: 404,
      invitees: ['alice'],
    });
    const res = await handlePublish(req('space-invaders', 'bob'), env);
    expect(res.success).toBe(false);
    expect(res.conflict).toBe(true);
    expect(writes).toHaveLength(0);
  });

  it('accepts an unlisted repo the caller holds a pending invite on (their own cut-off provision)', async () => {
    stub({ repoStatus: 200, registry: { games: [] }, collaborator: 404, invitees: ['Bob'] });
    const res = await handlePublish(req('space-invaders', 'bob'), env);
    expect(res.conflict).toBeUndefined();
    expect(res.steps).toContainEqual(
      expect.objectContaining({ name: 'GitHub repo', status: 'skip' }),
    );
  });

  it('fails closed (not as a conflict) when GitHub cannot confirm access', async () => {
    const writes = stub({ repoStatus: 200, registry: { games: [] }, collaborator: 502 });
    const res = await handlePublish(req('space-invaders', 'bob'), env);
    expect(res.success).toBe(false);
    expect(res.conflict).toBeUndefined();
    expect(res.steps.at(-1)?.detail).toMatch(/Could not verify ownership/);
    expect(writes).toHaveLength(0);
  });

  it('flags a lost generate race (422 already exists) as a conflict', async () => {
    stub({
      repoStatus: 404,
      registry: { games: [] },
      generate: { status: 422, body: { message: 'Name already exists on this account' } },
    });
    const res = await handlePublish(req('space-invaders', 'bob'), env);
    expect(res.success).toBe(false);
    expect(res.conflict).toBe(true);
  });

  it('fails as a conflict when a concurrent provision listed the id for someone else', async () => {
    stub({
      repoStatus: 404,
      registry: { games: [{ id: 'space-invaders', creatorGithub: 'alice' }] },
    });
    const res = await handlePublish(req('space-invaders', 'bob'), env);
    expect(res.success).toBe(false);
    expect(res.conflict).toBe(true);
    expect(res.steps).toContainEqual(
      expect.objectContaining({ name: 'Store registry', status: 'fail' }),
    );
  });
});

describe('handleUpdateGame validates like provision (#65)', () => {
  const env = { GITHUB_TOKEN: 'x' } as unknown as Parameters<typeof handleUpdateGame>[3];
  const original = {
    id: 'space-rescue',
    name: 'Space Rescue',
    description: 'Rescue astronauts',
    category: 'arcade',
    icon: '🚀',
    iconBg: '#0a0a1a',
    creatorGithub: 'grace',
  };

  // GitHub serves file content as base64 of the UTF-8 bytes (btoa alone can't
  // encode the emoji icon).
  const utf8B64 = (text: string) =>
    btoa(Array.from(new TextEncoder().encode(text), (b) => String.fromCharCode(b)).join(''));

  /** Stub GitHub: serves the registry, records the PUT body (if any). */
  function stub() {
    const put: { game?: Record<string, unknown> } = {};
    vi.stubGlobal('fetch', async (_input: unknown, init?: { method?: string; body?: string }) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(init.body!);
        const registry = JSON.parse(
          new TextDecoder().decode(Uint8Array.from(atob(body.content), (c) => c.charCodeAt(0))),
        );
        put.game = registry.games[0];
        return new Response(JSON.stringify({ content: {} }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          content: utf8B64(JSON.stringify({ games: [{ ...original }] })),
          sha: 's',
        }),
        { status: 200 },
      );
    });
    return put;
  }
  const update = (updates: Record<string, unknown>) =>
    handleUpdateGame('space-rescue', 'grace', updates, env);

  it.each([
    [{ name: '' }, /name can't be empty/],
    [{ name: '   ' }, /name can't be empty/],
    [{ description: '' }, /description can't be empty/],
    [{ category: '' }, /category can't be empty/],
    [{ icon: '' }, /icon can't be empty/],
    [{ name: 'x'.repeat(61) }, /60 characters/],
    [{ description: 'x'.repeat(301) }, /300 characters/],
    [{ icon: 'x'.repeat(25) }, /24 characters/],
    [{ iconBg: 'red' }, /hex colour/],
    [{ iconBg: '#fff;background:url(x)' }, /hex colour/],
    [{ category: 'Arcade!!' }, /category must be/],
    [{ name: 42 }, /name must be a string/],
  ])('rejects %j without writing the registry', async (updates, message) => {
    const put = stub();
    const res = await update(updates);
    expect(res.error).toMatch(message);
    expect(put.game).toBeUndefined();
  });

  it('normalizes the category the way provision does', async () => {
    const put = stub();
    expect((await update({ category: 'Brain Training' })).ok).toBe(true);
    expect(put.game?.category).toBe('brain-training');
  });

  it('title-cases a slug-shaped name the way provision does', async () => {
    const put = stub();
    expect((await update({ name: 'space-rescue-2' })).ok).toBe(true);
    expect(put.game?.name).toBe('Space Rescue 2');
  });

  it('trims and saves valid values, leaving other fields untouched', async () => {
    const put = stub();
    const res = await update({
      description: '  Save the crew  ',
      iconBg: '#ECFDF5',
      icon: '&#128640;',
    });
    expect(res.ok).toBe(true);
    expect(put.game).toMatchObject({
      name: 'Space Rescue',
      category: 'arcade',
      description: 'Save the crew',
      iconBg: '#ECFDF5',
      icon: '&#128640;',
    });
  });

  it('reports no change when the normalized value is already stored', async () => {
    const put = stub();
    expect((await update({ category: 'Arcade' })).error).toBe('No changes');
    expect(put.game).toBeUndefined();
  });
});

describe('registry write retry and lifecycle error codes (#66)', () => {
  const env = {
    GITHUB_TOKEN: 'x',
    DB: { prepare: () => ({ bind: () => ({ run: async () => {} }) }) },
  } as unknown as Parameters<typeof handleUpdateGame>[3];
  const b64 = (text: string) =>
    btoa(Array.from(new TextEncoder().encode(text), (b) => String.fromCharCode(b)).join(''));
  const game = { id: 'chess', name: 'Chess', creatorGithub: 'grace' };

  /**
   * Stub GitHub. `reads` = the registry served on each successive GET;
   * `puts` = the status of each successive registry PUT.
   */
  function stub(reads: unknown[][], puts: number[]) {
    const calls = { gets: 0, puts: 0 };
    vi.stubGlobal('fetch', async (input: unknown, init?: { method?: string }) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = init?.method ?? 'GET';
      if (url.includes('/contents/registry.json')) {
        if (method === 'PUT') {
          const status = puts[calls.puts++] ?? 200;
          return status === 200
            ? new Response(JSON.stringify({ content: {} }), { status })
            : new Response(JSON.stringify({ message: 'sha mismatch' }), { status });
        }
        const games = reads[Math.min(calls.gets++, reads.length - 1)];
        return new Response(
          JSON.stringify({ content: b64(JSON.stringify({ games })), sha: `s${calls.gets}` }),
          {
            status: 200,
          },
        );
      }
      if (method === 'PATCH')
        return new Response(JSON.stringify({ archived: true }), { status: 200 });
      return new Response('{}', { status: 200 });
    });
    return calls;
  }

  it('update retries once after a concurrent registry write (409) and succeeds', async () => {
    const calls = stub([[game], [game, { id: 'new-game' }]], [409, 200]);
    const res = await handleUpdateGame('chess', 'grace', { name: 'Chess Pro' }, env);
    expect(res).toEqual({ ok: true });
    expect(calls).toEqual({ gets: 2, puts: 2 });
  });

  it('update reports a conflict, not a raw 400, if the registry stays contended', async () => {
    stub([[game]], [409, 409]);
    const res = await handleUpdateGame('chess', 'grace', { name: 'Chess Pro' }, env);
    expect(res.code).toBe('conflict');
    expect(lifecycleStatus(res.code)).toBe(409);
  });

  it('the retry re-checks against the fresh registry (game deleted meanwhile)', async () => {
    const calls = stub([[game], []], [409]);
    const res = await handleUpdateGame('chess', 'grace', { name: 'Chess Pro' }, env);
    expect(res.code).toBe('not_found');
    expect(calls.puts).toBe(1); // nothing written on the retry
  });

  it('delete retries once after a 409 and finishes the deprovision', async () => {
    const calls = stub([[game], [game]], [409, 200]);
    const res = await handleDeleteGame('chess', 'grace', env);
    expect(res.ok).toBe(true);
    expect(calls.puts).toBe(2);
    expect(res.steps).toContainEqual(
      expect.objectContaining({ name: 'Store registry', status: 'ok' }),
    );
  });

  it.each([
    [
      'update by a non-owner',
      'forbidden',
      () => handleUpdateGame('chess', 'mallory', { name: 'X' }, env),
    ],
    ['delete by a non-owner', 'forbidden', () => handleDeleteGame('chess', 'mallory', env)],
    [
      'update of an unknown game',
      'not_found',
      () => handleUpdateGame('nope', 'grace', { name: 'X' }, env),
    ],
    ['delete of an unknown game', 'not_found', () => handleDeleteGame('nope', 'grace', env)],
    [
      'update with an empty name',
      'invalid',
      () => handleUpdateGame('chess', 'grace', { name: '' }, env),
    ],
  ])('%s is %s', async (_label, code, run) => {
    stub([[game]], []);
    expect((await run()).code).toBe(code);
  });

  it('an unreadable registry is an upstream failure', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response(JSON.stringify({ message: 'Server Error' }), { status: 500 }),
    );
    expect((await handleUpdateGame('chess', 'grace', { name: 'X' }, env)).code).toBe('upstream');
    expect((await handleDeleteGame('chess', 'grace', env)).code).toBe('upstream');
  });

  it('maps codes and provision results to HTTP statuses', () => {
    expect([
      lifecycleStatus('invalid'),
      lifecycleStatus('forbidden'),
      lifecycleStatus('not_found'),
      lifecycleStatus('conflict'),
      lifecycleStatus('upstream'),
      lifecycleStatus(undefined),
    ]).toEqual([400, 403, 404, 409, 502, 400]);
    const fail = (name: string) => ({
      success: false,
      steps: [{ name, status: 'fail' as const, detail: '' }],
    });
    expect(provisionStatus({ success: true, steps: [] })).toBe(200);
    expect(provisionStatus({ ...fail('GitHub repo'), conflict: true })).toBe(409);
    expect(provisionStatus(fail('Validation'))).toBe(400);
    expect(provisionStatus(fail('Fork attribution'))).toBe(400);
    expect(provisionStatus(fail('GitHub repo'))).toBe(502);
    expect(provisionStatus(fail('Store registry'))).toBe(502);
  });
});
