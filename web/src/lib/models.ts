// AI model catalog for the VibeCode studio, keyed by provider. Shared by the
// studio page (initial model state) and the toolbar's model picker so the two
// never drift.
export interface ModelOption {
  value: string;
  label: string;
}

export const MODEL_OPTIONS: Record<string, ModelOption[]> = {
  github: [
    { value: "openai/gpt-4.1", label: "GPT-4.1" },
    { value: "openai/gpt-4.1-mini", label: "GPT-4.1 Mini" },
    { value: "openai/gpt-4o", label: "GPT-4o" },
    { value: "openai/gpt-4o-mini", label: "GPT-4o Mini" },
  ],
  openrouter: [
    { value: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
    { value: "anthropic/claude-opus-4", label: "Claude Opus 4" },
    { value: "openai/gpt-4.1", label: "GPT-4.1" },
    { value: "openai/gpt-4o", label: "GPT-4o" },
    { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "deepseek/deepseek-chat-v3-0324", label: "DeepSeek V3" },
  ],
  anthropic: [
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { value: "claude-opus-4-8", label: "Claude Opus 4.8" },
  ],
  openai: [
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
  ],
  google: [
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  ],
};

/** The default model for a provider — its first listed option, with a stable
 *  fallback so a typo'd/unknown provider never yields `undefined`. */
export function firstModelFor(provider: string): string {
  return MODEL_OPTIONS[provider]?.[0]?.value ?? "openai/gpt-4.1";
}

/** Resolve the model to start on: the stored choice if it's valid for this
 *  provider, otherwise the provider's default. Pure — easy to test and reuse. */
export function resolveModel(provider: string, stored: string | null): string {
  const opts = MODEL_OPTIONS[provider] ?? [];
  return stored && opts.some((o) => o.value === stored) ? stored : firstModelFor(provider);
}
