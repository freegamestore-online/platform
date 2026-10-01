import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// #80: the stream-end handler started pollDeployStatus INSIDE a setDeployState
// updater (React invokes updaters twice under StrictMode), and every dropped
// stream started another ~3-minute poller without cancelling the last one.

vi.mock('../lib/errorReporter', () => ({ reportError: vi.fn() }));
const projectsMgr = {
  projects: [],
  currentId: 'sess-1',
  loading: false,
  loadError: false,
  reload: vi.fn(),
  create: vi.fn(() => 'new-id'),
  switchTo: vi.fn(),
  openGame: vi.fn(),
  startFreshChat: vi.fn(),
  rename: vi.fn(),
  markDeployed: vi.fn(),
  deleteProject: vi.fn(),
};
vi.mock('./useProjects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useProjects')>()),
  useProjects: () => projectsMgr,
}));

import { useAgent } from './useAgent';

let statusCalls = 0;

/** A /chat stream that reports a deploy in progress and then ends. */
function chatStream(): Response {
  const lines = [
    { type: 'deploy_status', data: JSON.stringify({ phase: 'building', steps: [] }) },
    { type: 'done', data: '' },
  ];
  const body = lines.map((l) => `data: ${JSON.stringify(l)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

beforeEach(() => {
  vi.useFakeTimers();
  statusCalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/chat')) return chatStream();
      if (url.endsWith('/status')) {
        statusCalls++;
        return new Response(JSON.stringify({ deployStatus: { phase: 'building', steps: [] } }));
      }
      return new Response(JSON.stringify({ sessions: [], messages: [] }));
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const AI = { provider: 'anthropic', model: 'm' } as Parameters<
  ReturnType<typeof useAgent>['sendMessage']
>[1];

describe('deploy status polling (#80)', () => {
  it('starts exactly one poller when a stream ends mid-deploy, even under StrictMode', async () => {
    const { result } = renderHook(() => useAgent(), { wrapper: StrictMode });
    await act(async () => {
      await result.current.sendMessage('build it', AI);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(statusCalls).toBe(1);
  });

  it('a new turn cancels the previous poller instead of stacking another', async () => {
    const { result } = renderHook(() => useAgent());
    await act(async () => {
      await result.current.sendMessage('build it', AI);
    });
    await act(async () => {
      await result.current.sendMessage('continue', AI);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(statusCalls).toBe(1); // one live poller, not two
  });

  it('stops polling when the studio unmounts', async () => {
    const { result, unmount } = renderHook(() => useAgent());
    await act(async () => {
      await result.current.sendMessage('build it', AI);
    });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(statusCalls).toBe(0);
  });
});
