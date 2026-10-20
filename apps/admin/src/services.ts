import { createGameLifecycle } from './lifecycle/game-lifecycle';
import { createRegistryState } from './lifecycle/registry-state';

// The HTTP layer only depends on these narrow lifecycle ports. The GitHub/D1
// implementation remains in publish.ts and can be replaced by contract fakes.
export const gameLifecycle = createGameLifecycle();
export const registryState = createRegistryState();
