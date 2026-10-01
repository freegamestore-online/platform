import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// #79: deleting the OPEN session from the picker promoted the next session to
// current but left the deleted chat's messages and deploy state on screen, so
// the next prompt went to session B while the user was looking at A.

vi.mock('../lib/errorReporter', () => ({ reportError: vi.fn() }));
const h = vi.hoisted(() => ({
  currentId: 'sess-a' as string | null,
  deleteProject: vi.fn(),
}));
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
    deleteProject: h.deleteProject,
  }),
}));

import { useAgent } from './useAgent';

const AI = { provider: 'anthropic', model: 'm' } as Parameters<
  ReturnType<typeof useAgent>['sendMessage']
>[1];
const chatUrls: string[] = [];
let streamForever = false;

beforeEach(() => {
  h.currentId = 'sess-a';
  chatUrls.length = 0;
  streamForever = false;
  // The real deleteProject promotes the survivor to current.
  h.deleteProject.mockReset().mockImplementation((id: string) => {
    if (h.currentId === id) h.currentId = 'sess-b';
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/history')) {
        return new Response(
          JSON.stringify({
            messages: [
              { role: 'user', content: 'make a space game' },
              { role: 'assistant', content: 'Built Space Rescue for you.' },
            ],
            deployStatus: { phase: 'error', error: 'CI failed' },
          }),
        );
      }
      if (url.endsWith('/chat')) {
        chatUrls.push(url);
        const body = streamForever
          ? new ReadableStream({ cancel() {} }) // never ends (until aborted)
          : `data: ${JSON.stringify({ type: 'done', data: '' })}\n\n`;
        return new Response(body, { status: 200 });
      }
      return new Response('{}');
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function withSessionAOpen() {
  const hook = renderHook(() => useAgent());
  await act(async () => {
    await hook.result.current.loadHistory();
  });
  expect(hook.result.current.messages.some((m) => m.content === 'make a space game')).toBe(true);
  expect(hook.result.current.deployState?.phase).toBe('error');
  return hook;
}

describe('useAgent.deleteProject (#79)', () => {
  it('clears the deleted chat and its deploy state when the open session is deleted', async () => {
    const { result, rerender } = await withSessionAOpen();
    let deleted: boolean | undefined;
    act(() => {
      deleted = result.current.deleteProject('sess-a');
    });
    rerender();
    expect(deleted).toBe(true);
    expect(h.deleteProject).toHaveBeenCalledWith('sess-a');
    expect(result.current.currentProjectId).toBe('sess-b');
    expect(result.current.messages.some((m) => m.content === 'make a space game')).toBe(false);
    expect(result.current.messages.some((m) => m.content.includes('Space Rescue'))).toBe(false);
    expect(result.current.deployState).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('sends the next prompt to the surviving session', async () => {
    const { result, rerender } = await withSessionAOpen();
    act(() => {
      result.current.deleteProject('sess-a');
    });
    rerender();
    await act(async () => {
      await result.current.sendMessage('add a boss level', AI);
    });
    expect(chatUrls.at(-1)).toMatch(/\/session\/sess-b\/chat$/);
  });

  it('leaves the open chat alone when a different session is deleted', async () => {
    const { result, rerender } = await withSessionAOpen();
    act(() => {
      result.current.deleteProject('sess-other');
    });
    rerender();
    expect(h.deleteProject).toHaveBeenCalledWith('sess-other');
    expect(result.current.currentProjectId).toBe('sess-a');
    expect(result.current.messages.some((m) => m.content === 'make a space game')).toBe(true);
  });

  it('refuses to delete the open session while it is streaming', async () => {
    streamForever = true;
    const { result, unmount } = await withSessionAOpen();
    act(() => {
      void result.current.sendMessage('keep building', AI);
    });
    await act(async () => {});
    expect(result.current.isStreaming).toBe(true);
    let deleted: boolean | undefined;
    act(() => {
      deleted = result.current.deleteProject('sess-a');
    });
    expect(deleted).toBe(false);
    expect(h.deleteProject).not.toHaveBeenCalled();
    unmount(); // aborts the open stream
  });
});
