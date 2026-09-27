import { describe, expect, it, vi } from 'vitest';
import { createAdminDataService } from './data-service';
import { createReconciliationService } from './reconciliation-service';

describe('admin data and reconciliation boundary contracts', () => {
  it('keeps data reads behind explicit injected operations', async () => {
    const registry = vi.fn(async () => [{ id: 'chess' }]);
    const service = createAdminDataService({
      registryItems: async () => [],
      registry,
      registryRaw: async () => [],
      gameStatus: async () => ({}),
      allStatus: async () => [],
      quality: async () => null,
    });
    expect(await service.registry()).toEqual([{ id: 'chess' }]);
    expect(registry).toHaveBeenCalledOnce();
  });

  it('keeps scheduled healing explicit at the reconciliation boundary', async () => {
    const reconcile = vi.fn(async (heal = false) => ({ heal }));
    const service = createReconciliationService(reconcile);
    await service.reconcile();
    await service.reconcile(true);
    expect(reconcile).toHaveBeenNthCalledWith(1);
    expect(reconcile).toHaveBeenNthCalledWith(2, true);
  });
});
