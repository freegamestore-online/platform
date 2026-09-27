import { describe, expect, it } from 'vitest';
import { resolveProvider } from './providerResolution';

describe('resolveProvider', () => {
  it('keeps a provider that has a stored key', () => {
    expect(
      resolveProvider({
        provider: 'anthropic',
        hasKey: (provider) => provider === 'anthropic',
        providerUsable: () => false,
      }),
    ).toBeNull();
  });

  it('selects the first keyed provider when the preference is unusable', () => {
    expect(
      resolveProvider({
        provider: 'anthropic',
        hasKey: (provider) => provider === 'openai',
        providerUsable: () => false,
      }),
    ).toMatchObject({ provider: 'openai' });
  });

  it('still prefers a saved key over the shared free tier', () => {
    expect(
      resolveProvider({
        provider: 'github',
        hasKey: (provider) => provider === 'openai',
        providerUsable: (provider) => provider === 'github',
      }),
    ).toMatchObject({ provider: 'openai' });
  });

  it('falls back to the free GitHub provider when no key is available', () => {
    expect(
      resolveProvider({ provider: 'anthropic', hasKey: () => false, providerUsable: () => false }),
    ).toMatchObject({ provider: 'github' });
  });
});
