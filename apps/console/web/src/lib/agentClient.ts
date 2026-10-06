import { useCallback, useEffect, useRef, useState } from 'react';
import type { ServerSession, UsageTotals } from './sessions';

export const AGENT_URL = 'https://agent.freegamestore.online';

/** Shared sessions cache — multiple hooks poll /sessions and would otherwise
 *  each trigger their own fetches. useSharedSessions deduplicates: only one
 *  in-flight fetch runs at a time across all callers, and the result is cached
 *  for 10s so concurrent callers don't re-fetch. */

export interface SessionsCacheData {
  sessions: ServerSession[];
  totals?: UsageTotals | null;
  loaded?: boolean;
  error?: Error | null;
}

interface SessionsCache {
  data: SessionsCacheData | null;
  timestamp: number;
  promise: Promise<SessionsCacheData> | null;
  hasEverBeenFetched: boolean;
}

const cache: SessionsCache = {
  data: null,
  timestamp: 0,
  promise: null,
  hasEverBeenFetched: false,
};

const CACHE_TTL_MS = 10000; // 10 seconds

async function fetchSessions(signal: AbortSignal): Promise<SessionsCacheData> {
  const res = await fetch(`${AGENT_URL}/sessions`, { signal, credentials: 'include' });
  if (!res.ok) throw new Error(`fetch sessions failed: ${res.status}`);
  const data = (await res.json()) as { sessions: ServerSession[]; totals?: UsageTotals };
  return { sessions: data.sessions, totals: data.totals };
}

/** Shared sessions hook — deduplicates /sessions fetches across multiple callers.
 *  Returns the latest session list, or an empty array if loading/error.
 *  Pass an optional dependency array to trigger refetches. */
export function useSharedSessions(deps?: React.DependencyList): SessionsCacheData {
  const [cacheData, setCacheData] = useState<SessionsCacheData>(() => {
    const now = Date.now();
    const isStale = now - cache.timestamp > CACHE_TTL_MS;
    if (cache.data && !isStale) {
      return cache.data;
    }
    return { sessions: [] };
  });
  const [refetchNonce, setRefetchNonce] = useState(0);
  const ctrlRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;

    const now = Date.now();
    const isStale = now - cache.timestamp > CACHE_TTL_MS;

    // If we have fresh cached data, return it immediately
    if (cache.data && !isStale) {
      setCacheData(cache.data);
      return;
    }

    // If there's already a fetch in flight, wait for it
    if (cache.promise) {
      cache.promise
        .then((data) => {
          if (!ctrl.signal.aborted) {
            setCacheData(data);
          }
        })
        .catch(() => {
          // On error, clear the promise so the next call can retry
          if (cache.promise) cache.promise = null;
        });
      return;
    }

    // Otherwise, start a new fetch
    const promise = fetchSessions(ctrl.signal);
    cache.promise = promise;

    promise
      .then((data) => {
        if (!ctrl.signal.aborted) {
          const dataWithLoaded = { ...data, loaded: true };
          cache.data = dataWithLoaded;
          cache.timestamp = Date.now();
          cache.promise = null;
          cache.hasEverBeenFetched = true;
          setCacheData(dataWithLoaded);
        }
      })
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) {
          cache.promise = null;
          cache.hasEverBeenFetched = true;
          // Mark as loaded even on error so loading state updates
          // Return empty sessions with loaded flag and error to indicate fetch completed
          const error = err instanceof Error ? err : new Error(String(err));
          const errorData: SessionsCacheData = { sessions: [], loaded: true, error };
          setCacheData(errorData);
        }
      });

    return () => {
      ctrl.abort();
      if (cache.promise === promise) cache.promise = null;
    };
  }, [refetchNonce, ...(deps || [])]);

  // Export a refetch function so callers can manually invalidate the cache
  useEffect(() => {
    // The refetch is triggered by changing refetchNonce
  }, []);

  return cacheData;
}

/** Manually invalidate the shared sessions cache. Call this after mutations. */
export function invalidateSharedSessions(): void {
  cache.data = null;
  cache.timestamp = 0;
  if (cache.promise) {
    cache.promise = null;
  }
}

/** Test helper: reset the shared sessions cache completely. Called in test beforeEach. */
export function __resetSharedSessionsCacheForTests(): void {
  cache.data = null;
  cache.timestamp = 0;
  cache.promise = null;
  cache.hasEverBeenFetched = false;
}
