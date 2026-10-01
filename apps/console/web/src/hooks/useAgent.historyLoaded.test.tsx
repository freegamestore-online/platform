import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// #76: Create's first-build auto-send must not decide before the session's
// transcript is known. useAgent exposes `historyLoaded` for that.

vi.mock('../lib/errorReporter', () => ({ reportError: vi.fn() }));
const h = vi.hoisted(() => ({ currentId: 'sess-1' as string | null }));
vi.mock('./useProjects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useProjects')>()),
  useProjects: () => ({
    projects: [],
    currentId: h.currentId,
    loading: false,
    loadError: false,
    reload: vi.fn(),
    create: vi.fn(),
    switchTo: vi.fn(),
    openGame: vi.fn(),
    startFreshChat: vi.fn(),
    rename: vi.fn(),
    markDeployed: vi.fn(),
    deleteProject: vi.fn(),
  }),
}));

import { useAgent } from './useAgent';

beforeEach(() => {
  h.currentId = 'sess-1';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ messages: [] }))),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('useAgent.historyLoaded (#76)', () => {
  it('is false until loadHistory completes for the open session', async () => {
    const { result } = renderHook(() => useAgent());
    expect(result.current.historyLoaded).toBe(false);
    await act(async () => {
      await result.current.loadHistory();
    });
    expect(result.current.historyLoaded).toBe(true);
  });

  it('also completes when the history request fails, so the studio is not stuck', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('offline'));
    const { result } = renderHook(() => useAgent());
    await act(async () => {
      await result.current.loadHistory();
    });
    expect(result.current.historyLoaded).toBe(true);
  });

  it('resets for a newly opened session until its own history loads', async () => {
    const { result, rerender } = renderHook(() => useAgent());
    await act(async () => {
      await result.current.loadHistory();
    });
    expect(result.current.historyLoaded).toBe(true);

    h.currentId = 'sess-2';
    rerender();
    expect(result.current.historyLoaded).toBe(false);
    await act(async () => {
      await result.current.loadHistory();
    });
    expect(result.current.historyLoaded).toBe(true);
  });
});
