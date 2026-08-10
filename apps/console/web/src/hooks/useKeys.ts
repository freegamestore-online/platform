import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./useAuth";
import { isFreeProvider, readLegacyLocalKeys, writeLegacyLocalKeys } from "../lib/ai-keys";

// AI provider keys live in the agent worker's ENCRYPTED vault (D1, AES-256-GCM),
// NOT in localStorage. The browser only ever learns WHICH providers have a key
// (metadata) — never the key itself, which is decrypted server-side to call the
// provider. This closes the old XSS-reads-localStorage exposure.
const AGENT_URL = "https://agent.freegamestore.online";

export function useKeys() {
  const { user } = useAuth();
  const [providers, setProviders] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setProviders(new Set());
      setLoading(false);
      return;
    }
    try {
      const r = await fetch(`${AGENT_URL}/v1/keys/status`, { credentials: "include" });
      if (r.ok) {
        const d = (await r.json()) as { providers?: { provider: string }[] };
        setProviders(new Set((d.providers ?? []).map((p) => p.provider)));
      }
    } catch {
      /* non-fatal — the send path re-checks server-side anyway */
    } finally {
      setLoading(false);
    }
  }, [user?.sub]);

  const saveKey = useCallback(async (provider: string, key: string): Promise<boolean> => {
    const r = await fetch(`${AGENT_URL}/v1/keys/${provider}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    }).catch(() => null);
    if (r?.ok) setProviders((prev) => new Set(prev).add(provider));
    return !!r?.ok;
  }, []);

  const removeKey = useCallback(async (provider: string): Promise<boolean> => {
    const r = await fetch(`${AGENT_URL}/v1/keys/${provider}`, { method: "DELETE", credentials: "include" }).catch(() => null);
    if (r?.ok) setProviders((prev) => { const n = new Set(prev); n.delete(provider); return n; });
    return !!r?.ok;
  }, []);

  const hasKey = useCallback((provider: string) => providers.has(provider), [providers]);
  const providerUsable = useCallback((provider: string) => isFreeProvider(provider) || providers.has(provider), [providers]);

  // Initial load + one-time migration of any legacy localStorage keys into the
  // vault (then wipe them from the browser so plaintext no longer lingers).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) { setProviders(new Set()); setLoading(false); return; }
      await refresh();
      const legacy = readLegacyLocalKeys(user.sub);
      const entries = Object.entries(legacy).filter(([, v]) => v);
      if (entries.length) {
        const results = await Promise.all(entries.map(async ([provider, key]) => {
          const res = await fetch(`${AGENT_URL}/v1/keys/${provider}`, {
            method: "PUT", credentials: "include",
            headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }),
          }).catch(() => null);
          return { provider, key, ok: !!res?.ok };
        }));
        const failed = Object.fromEntries(results.filter((r) => !r.ok).map((r) => [r.provider, r.key]));
        writeLegacyLocalKeys(failed, user.sub);
        if (!cancelled) await refresh();
      }
    })();
    return () => { cancelled = true; };
  }, [user?.sub, refresh]);

  return { hasKey, providerUsable, saveKey, removeKey, loading, refresh, providers };
}
