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
