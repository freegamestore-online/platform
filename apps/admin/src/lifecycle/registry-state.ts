import {
  type GameStatus,
  type PublishEnv,
  readGameStatus,
  type Step,
  setGameStatus,
  setGameStatuses,
} from '../publish';

export interface RegistryState {
  readStatus(entry: { status?: unknown } | null | undefined): GameStatus;
  setStatus(env: PublishEnv, id: string, status: 'live' | 'failed'): Promise<Step>;
  setStatuses(
    env: PublishEnv,
    updates: Array<{ id: string; status: 'live' | 'failed' }>,
  ): Promise<{ ok: boolean; updated: string[]; detail: string }>;
}

/** The registry status read/write seam. */
export function createRegistryState(): RegistryState {
  return { readStatus: readGameStatus, setStatus: setGameStatus, setStatuses: setGameStatuses };
}
