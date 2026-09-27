import { PROVIDERS } from './ai-keys';
import { firstModelFor } from './models';

export interface ProviderResolutionInput {
  provider: string;
  hasKey(provider: string): boolean;
  providerUsable(provider: string): boolean;
}

export interface ProviderResolution {
  provider: string;
  model: string;
}

/** Select the first usable provider without coupling the policy to React or the key vault. */
export function resolveProvider({
  provider,
  hasKey,
  providerUsable,
}: ProviderResolutionInput): ProviderResolution | null {
  if (hasKey(provider)) return null;
  const keyed = PROVIDERS.find((candidate) => hasKey(candidate.type));
  if (keyed) return { provider: keyed.type, model: firstModelFor(keyed.type) };
  if (providerUsable(provider)) return null;
  const nextProvider = 'github';
  return { provider: nextProvider, model: firstModelFor(nextProvider) };
}
