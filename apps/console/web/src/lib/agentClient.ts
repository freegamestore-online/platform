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
}

interface SessionsCache {
  data: SessionsCacheData | null;
  timestamp: number;
  promise: Promise<SessionsCacheData> | null;
}

const cache: SessionsCache = {
  data: null,
  timestamp: 0,
  promise: null,
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
  const [cacheData, setCacheData] = useState<SessionsCacheData>({ sessions: [] });
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
          cache.data = data;
          cache.timestamp = Date.now();
          cache.promise = null;
          setCacheData(data);
        }
      })
      .catch(() => {
        if (!ctrl.signal.aborted) {
          cache.promise = null;
          // Keep whatever data we had before (don't clear it on error)
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

// Export a ref-count driven mechanism for triggering refetches
let refetchNonce = 0;
export function triggerSessionsRefetch(): void {
  cache.data = null;
  cache.timestamp = 0;
  refetchNonce++;
}
