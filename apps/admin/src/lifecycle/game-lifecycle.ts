import {
  handleDeleteGame,
  handlePublish,
  handleUpdateGame,
  type PublishEnv,
  type PublishRequest,
} from '../publish';
import type { DeleteGame, GameLifecycle, ProvisionGame, UpdateGame } from './contracts';

/**
 * The lifecycle adapter is the only dependency the request layer needs for
 * provision/update/delete.  Keeping this seam explicit lets route tests use
 * deterministic fakes instead of GitHub, D1, and service bindings.
 */
export function createGameLifecycle(
  operations: {
    provision?: ProvisionGame['provision'];
    update?: UpdateGame['update'];
    delete?: DeleteGame['delete'];
  } = {},
): GameLifecycle {
  return {
    provision:
      operations.provision ??
      ((request: PublishRequest, env: PublishEnv) => handlePublish(request, env)),
    update:
      operations.update ??
      ((gameId: string, login: string, updates: Record<string, unknown>, env: PublishEnv) =>
        handleUpdateGame(gameId, login, updates, env)),
    delete:
      operations.delete ??
      ((gameId: string, login: string, env: PublishEnv, options?: { adminOverride?: boolean }) =>
        handleDeleteGame(gameId, login, env, options)),
  };
}
