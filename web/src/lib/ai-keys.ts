/** AI API key management — stored in localStorage, never sent to our servers.
 *  Keys are used client-side only, piped directly to the provider APIs via the agent worker. */

export interface ProviderConfig {
  type: string;
  name: string;
  description: string;
  keyPlaceholder: string;
  keyPrefix: string;
  free: boolean;
  /** Free by default (shared platform tier) but ALSO accepts an optional user
   *  key to run on the user's own — higher — quota. Only GitHub Models today. */
  optionalKey?: boolean;
  docsUrl: string;
}

export const PROVIDERS: ProviderConfig[] = [
  {
    type: "github",
    name: "GitHub Models",
    description:
      "Free — no key needed (shared platform quota). Add a GitHub fine-grained PAT with Models access to build on your own account's much-higher free quota instead.",
    keyPlaceholder: "github_pat_… (fine-grained, Models: read)",
    keyPrefix: "",
    free: true,
    optionalKey: true,
    docsUrl: "https://github.com/marketplace/models",
  },
  {
    type: "openrouter",
    name: "OpenRouter",
    description: "367+ models with one API key. Claude, GPT, Gemini, Llama, Grok, and more.",
    keyPlaceholder: "sk-or-v1-...",
    keyPrefix: "sk-or-",
    free: false,
    docsUrl: "https://openrouter.ai/keys",
  },
  {
    type: "anthropic",
    name: "Anthropic",
    description: "Claude models directly. Lowest latency for Claude.",
    keyPlaceholder: "sk-ant-api03-...",
    keyPrefix: "sk-ant-",
    free: false,
    docsUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    type: "openai",
    name: "OpenAI",
    description: "GPT and o-series models directly.",
    keyPlaceholder: "sk-proj-...",
    keyPrefix: "sk-",
    free: false,
    docsUrl: "https://platform.openai.com/api-keys",
  },
  {
    type: "google",
    name: "Google AI",
    description: "Gemini models directly. 1M+ context window.",
    keyPlaceholder: "AIza...",
    keyPrefix: "AIza",
    free: false,
    docsUrl: "https://aistudio.google.com/apikey",
  },
];

// AI provider KEYS are no longer kept in localStorage — they live in the agent
// worker's encrypted vault (see hooks/useKeys.ts). This key remains only so a
// one-time migration can lift any pre-vault keys up and then wipe them.
const LEGACY_STORAGE_KEY = "fgs_ai_keys";

/** Read keys stored in localStorage before the server vault existed, so they can
 *  be migrated into the vault. */
export function readLegacyLocalKeys(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "{}"); } catch { return {}; }
}

/** Persist any legacy plaintext keys that could not be migrated yet. */
export function writeLegacyLocalKeys(keys: Record<string, string>) {
  const entries = Object.entries(keys).filter(([, value]) => value);
  if (entries.length) localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  else localStorage.removeItem(LEGACY_STORAGE_KEY);
}

/** Remove the legacy plaintext keys from the browser once migrated. */
export function clearLegacyLocalKeys() {
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}

/** Whether a provider needs no API key (free tier — e.g. GitHub Models). */
export function isFreeProvider(provider: string): boolean {
  return PROVIDERS.find((p) => p.type === provider)?.free ?? false;
}

/**
 * Which provider to start on. Uses the user's stored preference (a non-secret UI
 * choice) or Anthropic (Claude) by default. Whether that provider has a *key* is
 * answered separately by the vault (useKeys) — Create.tsx auto-switches to a
 * provider the user actually has a key for once keys load.
 */
export function resolveInitialProvider(): string {
  const stored = localStorage.getItem("fgs_provider");
  if (stored && PROVIDERS.some((p) => p.type === stored)) return stored;
  // New users (no saved preference) start on the FREE GitHub Models tier so they
  // can vibecode immediately without adding a key. The auto-pick effect in
  // Create.tsx moves them to a keyed provider once keys load, if they have one.
  return "github";
}
