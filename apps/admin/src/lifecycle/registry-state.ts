import {
  type ForkedFrom,
  type GameStatus,
  normalizeForkedFrom,
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

export interface RemixSource {
  normalize(
    value: unknown,
    items: Array<Record<string, unknown>>,
    firstPublished?: unknown,
  ): ForkedFrom | undefined;
}

/** Registry status and immutable remix provenance are independent read/write seams. */
export function createRegistryState(): RegistryState {
  return { readStatus: readGameStatus, setStatus: setGameStatus, setStatuses: setGameStatuses };
}

export function createRemixSource(): RemixSource {
  return { normalize: normalizeForkedFrom };
}
