import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthProvider } from './useAuth';

// Regression for #71: signOut only called the auth worker's /logout, which
// cannot clear the console's host-only session cookie — the user stayed signed in.

const realLocation = window.location;

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'location', { value: realLocation, writable: true });
});

describe('useAuthProvider signOut', () => {
  it('clears the console session on this origin as well as the auth-worker session', async () => {
    const calls: { url: string; method: string; credentials?: RequestCredentials }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, method: init?.method ?? 'GET', credentials: init?.credentials });
        if (url === '/auth/me') return new Response(JSON.stringify({ user: null }));
        return new Response(null, { status: 204 });
      }),
    );
    Object.defineProperty(window, 'location', { value: { href: '' }, writable: true });

    const { result } = renderHook(() => useAuthProvider());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.signOut();
    });

    expect(calls).toContainEqual({
      url: '/auth/logout',
      method: 'POST',
      credentials: 'same-origin',
    });
    expect(calls).toContainEqual({
      url: 'https://auth.freegamestore.online/logout',
      method: 'POST',
      credentials: 'include',
    });
    expect(window.location.href).toBe('/');
  });

  it('still navigates away when a logout request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === '/auth/me') return new Response(JSON.stringify({ user: null }));
        throw new TypeError('network down');
      }),
    );
    Object.defineProperty(window, 'location', { value: { href: '' }, writable: true });

    const { result } = renderHook(() => useAuthProvider());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.signOut();
    });
    expect(window.location.href).toBe('/');
  });
});

describe('useAuthProvider agent handoff failure (#78)', () => {
  function stubFetch(handoff: () => Response, me: () => Response = () => meUser()) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/auth/me') return me();
        if (url === '/auth/agent-handoff') return handoff();
        if (url.includes('agent.freegamestore.online/auth/handoff'))
          return new Response(null, { status: 200 });
        return new Response('{}');
      }),
    );
  }
  const meUser = () =>
    new Response(JSON.stringify({ user: { github: 'octo', avatarUrl: 'https://x/u/1?v=4' } }));

  it('keeps the user signed in and reports a separate, retryable agentError', async () => {
    let handoffOk = false;
    stubFetch(() =>
      handoffOk
        ? new Response(JSON.stringify({ token: 't' }))
        : new Response('down', { status: 503 }),
    );
    const { result } = renderHook(() => useAuthProvider());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.user?.github).toBe('octo');
    expect(result.current.error).toBeNull(); // the Dashboard is not blocked
    expect(result.current.agentError).toMatch(/AI studio/);

    handoffOk = true;
    await act(async () => {
      await result.current.retryAgentSession();
    });
    expect(result.current.agentError).toBeNull();
  });

  it('clears an identity error once a refetch succeeds', async () => {
    let meFails = true;
    stubFetch(
      () => new Response(JSON.stringify({ token: 't' })),
      () => (meFails ? new Response('<html>oops', { status: 502 }) : meUser()),
    );
    const { result } = renderHook(() => useAuthProvider());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/Failed to connect/);

    meFails = false;
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.user?.github).toBe('octo');
  });
});
