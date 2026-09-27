import { describe, expect, it, vi } from 'vitest';
import { createGameLifecycle } from './game-lifecycle';

const env = { CF_ACCOUNT_ID: '', CF_API_TOKEN: '', GITHUB_TOKEN: '', DB: {} as D1Database };

describe('game lifecycle boundary contract', () => {
  it('passes provision, update, and delete inputs unchanged to typed operations', async () => {
    const provision = vi.fn(async () => ({
      steps: [],
      success: true,
      appUrl: 'https://a',
      repoUrl: 'https://r',
    }));
    const update = vi.fn(async () => ({ ok: true }));
    const remove = vi.fn(async () => ({ ok: true, steps: [] }));
    const lifecycle = createGameLifecycle({ provision, update, delete: remove });

    await lifecycle.provision({ id: 'test', name: 'Test', category: 'casual' }, env);
    await lifecycle.update('test', 'octo', { name: 'Changed' }, env);
    await lifecycle.delete('test', 'operator', env, { adminOverride: true });

    expect(provision).toHaveBeenCalledWith({ id: 'test', name: 'Test', category: 'casual' }, env);
    expect(update).toHaveBeenCalledWith('test', 'octo', { name: 'Changed' }, env);
    expect(remove).toHaveBeenCalledWith('test', 'operator', env, { adminOverride: true });
  });
});
