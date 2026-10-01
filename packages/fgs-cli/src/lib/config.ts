import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CONFIG_DIR = join(homedir(), '.fgs');
/** Canonical FGS CLI config path (`~/.fgs/config.json`). Exported so `doctor`
 *  and `logout` reference the SAME location `login`/`readConfig` write, rather
 *  than hardcoding it (they had drifted to the FAS `~/.fas` path). */
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export interface FgsConfig {
  apiBase: string;
  github?: {
    accessToken: string;
    login: string;
    obtainedAt: number;
  };
  session?: {
    token: string;
    obtainedAt: number;
  };
}

// The FGS admin Worker (auth exchange + provision) lives at
// admin.freegamestore.online. `api.freegamestore.online` was never wired
// (530). Points here so `fgs login` + `fgs publish` reach the admin.
const DEFAULT_API_BASE = 'https://admin.freegamestore.online';

/**
 * The API base for THIS invocation: FGS_API_BASE if set, else the default.
 * Resolved on every read and never taken from the config file (#98): `fgs
 * login` used to persist the base it ran against, and readConfig spread the
 * file over the env-derived default, so `FGS_API_BASE=<staging> fgs login`
 * pinned staging for good: a later `FGS_API_BASE=<prod> fgs publish` still
 * sent the session to staging. (Old files may still hold an apiBase, e.g. the
 * dead api.freegamestore.online; it is ignored.)
 */
export function resolveApiBase(): string {
  const fromEnv = process.env.FGS_API_BASE?.trim();
  return normalizeApiBase(fromEnv || DEFAULT_API_BASE);
}

export function normalizeApiBase(s: string): string {
  return s.replace(/\/+$/, '');
}

export async function readConfig(): Promise<FgsConfig> {
  let parsed: Partial<FgsConfig> = {};
  try {
    parsed = JSON.parse(await readFile(CONFIG_FILE, 'utf8')) as Partial<FgsConfig>;
  } catch {
    // No (or unreadable) config yet: signed out, default API base.
  }
  return { ...parsed, apiBase: resolveApiBase() };
}

export async function writeConfig(config: FgsConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  // apiBase is per-invocation (FGS_API_BASE), never persisted (#98).
  const { apiBase: _apiBase, ...persisted } = config;
  await writeFile(CONFIG_FILE, JSON.stringify(persisted, null, 2), { mode: 0o600 });
  await chmod(CONFIG_FILE, 0o600);
}
