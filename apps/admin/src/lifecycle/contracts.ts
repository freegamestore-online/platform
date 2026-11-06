import type { LifecycleErrorCode, PublishEnv, PublishRequest, Step } from '../publish';

/** Narrow, testable ports used by the HTTP layer for game lifecycle mutations. */
export interface ProvisionGame {
  provision(
    request: PublishRequest,
    env: PublishEnv,
  ): Promise<{
    steps: Step[];
    success: boolean;
    appUrl?: string;
    repoUrl?: string;
    /** The id belongs to another creator; the HTTP layer answers 409. */
    conflict?: boolean;
  }>;
}

export interface UpdateGame {
  update(
    gameId: string,
    login: string,
    updates: Record<string, unknown>,
    env: PublishEnv,
    /** The caller's numeric GitHub id when the credential carries one (#472). */
    callerGithubId?: string | null,
  ): Promise<{ ok?: boolean; error?: string; code?: LifecycleErrorCode }>;
}

export interface DeleteGame {
  delete(
    gameId: string,
    login: string,
    env: PublishEnv,
    options?: { adminOverride?: boolean; callerGithubId?: string | null },
  ): Promise<{ ok?: boolean; error?: string; code?: LifecycleErrorCode; steps?: Step[] }>;
}

export interface GameLifecycle extends ProvisionGame, UpdateGame, DeleteGame {}
