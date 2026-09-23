/**
 * Tests that meaningful failures call reportError and that expected/control-flow
 * errors (OpenSupersededError, AbortError) do NOT.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock reportError so we can assert on calls without real network.
vi.mock('../lib/errorReporter', () => ({
  reportError: vi.fn(),
}));

// useProjects only needs { user, loading } from useAuth — stub a signed-in user.
vi.mock('./useAuth', () => ({
  useAuth: () => ({ user: { sub: 'github:1' }, loading: false }),
}));

import { reportError } from '../lib/errorReporter';
import { OpenSupersededError, useProjects } from './useProjects';

const mockReportError = reportError as ReturnType<typeof vi.fn>;

function jsonRes(body: unknown, ok = true, status = 200): Promise<Response> {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as Response);
}

function srv(id: string, name: string, gameId?: string) {
  return {
    id,
    name,
    gameId,
    gameUrl: gameId ? `https://${gameId}.freegamestore.online` : undefined,
    deployed: !!gameId,
    createdAt: new Date(0).toISOString(),
  };
}

let sessionsResponse: { sessions: ReturnType<typeof srv>[] };
let importResponse: () => Promise<Response>;

beforeEach(() => {
  localStorage.clear();
  mockReportError.mockClear();
  sessionsResponse = { sessions: [] };
  importResponse = () =>
    jsonRes({ name: 'Imported', appUrl: 'https://imported.freegamestore.online' });

  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method || 'GET').toUpperCase();
    if (url.endsWith('/sessions') && method === 'GET') return jsonRes(sessionsResponse);
    if (url.includes('/import') && method === 'POST') return importResponse();
    if (url.includes('/sessions/') && (method === 'PUT' || method === 'DELETE'))
      return jsonRes({ ok: true });
    return jsonRes({}, false, 404);
  }) as unknown as typeof fetch;
});

afterEach(() => vi.restoreAllMocks());

async function mounted() {
  const hook = renderHook(() => useProjects());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

// ---- useProjects: loadProjects ----

describe('useProjects — reportError on load failure', () => {
  it('calls reportError when sessions fetch fails with a real error', async () => {
    // Override fetch to reject for the sessions endpoint.
    globalThis.fetch = vi.fn(() =>
      Promise.reject(new Error('Network error')),
    ) as unknown as typeof fetch;

    const hook = renderHook(() => useProjects());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    expect(mockReportError).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const arg = mockReportError.mock.calls[0]![0] as { message: string; context: string };
    expect(arg.message).toMatch(/Network error/);
    const ctx = JSON.parse(arg.context) as { op: string };
    expect(ctx.op).toBe('loadProjects');
  });

  it('does NOT call reportError for an AbortError (unmount / abort path)', async () => {
    let abortResolve!: () => void;
    const abortPromise = new Promise<void>((r) => {
      abortResolve = r;
    });

    globalThis.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      // Return a promise that rejects with AbortError when the signal fires.
      return new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new DOMException('The user aborted a request.', 'AbortError');
          rej(err);
          abortResolve();
        });
      });
    }) as unknown as typeof fetch;

    const hook = renderHook(() => useProjects());
    // Unmount triggers the cleanup → ctrl.abort() → AbortError in the promise.
    hook.unmount();
    await abortPromise;

    expect(mockReportError).not.toHaveBeenCalled();
  });
});

// ---- useProjects: openGame (via useAgent indirectly; test at hook level) ----

describe('useProjects — openGame error propagation for useAgent wiring', () => {
  it('throws on a failed import so the caller (useAgent) can reportError', async () => {
    // useAgent catches openGame's throw and calls reportError. Here we verify the
    // throw reaches the caller — the wiring in useAgent is tested in useAgent.
    importResponse = () => jsonRes({ error: 'game "bad-game" not found' }, false, 404);
    const { result } = await mounted();

    await expect(
      act(async () => {
        await result.current.openGame('bad-game');
      }),
    ).rejects.toThrow(/bad-game|not found/);
    // reportError is NOT called here — it's useAgent's responsibility.
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it('does NOT call reportError when superseded mid-fetchSessions (OpenSupersededError path)', async () => {
    // Reproduce the fetchSessions token-guard path: game is NOT in the local list,
    // so openGame calls fetchSessions. We block it, advance the token (switchTo),
    // then resolve — the token mismatch throws OpenSupersededError. reportError
    // must NOT be called because it's deliberate control flow.
    //
    // We override fetch so that the sessions GET (authoritative lookup) blocks,
    // then resolves. The import POST won't be reached.
    let resolveSessionsForOpen!: (r: Response) => void;
    const deferredSessions = new Promise<Response>((res) => {
      resolveSessionsForOpen = res;
    });

    // First call is the initial mount load (returns empty).
    let sessionCallCount = 0;
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method || 'GET').toUpperCase();
      if (url.endsWith('/sessions') && method === 'GET') {
        sessionCallCount++;
        if (sessionCallCount === 1) return jsonRes({ sessions: [] }); // initial mount load
        return deferredSessions; // second call = the fetchSessions inside openGame
      }
      if (url.includes('/sessions/') && (method === 'PUT' || method === 'DELETE'))
        return jsonRes({ ok: true });
      return jsonRes({}, false, 404);
    }) as unknown as typeof fetch;

    const { result } = await mounted(); // no games in local list

    let openGamePromise!: Promise<string | void>;
    act(() => {
      openGamePromise = result.current.openGame('missing-game').catch((e) => {
        if (e instanceof OpenSupersededError) return; // absorb it so act() doesn't throw
        throw e;
      });
    });

    // Advance the token while fetchSessions is in flight.
    act(() => result.current.switchTo('sess-other'));

    // Resolve the sessions fetch — openGame sees token mismatch → OpenSupersededError.
    await act(async () => {
      resolveSessionsForOpen({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ sessions: [] }),
      } as Response);
      await openGamePromise;
    });

    expect(mockReportError).not.toHaveBeenCalled();
  });
});
