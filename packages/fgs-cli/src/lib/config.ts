import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CONFIG_DIR = join(homedir(), '.fgs');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

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

const DEFAULT_CONFIG: FgsConfig = {
  apiBase: process.env.FGS_API_BASE ?? 'https://api.freegamestore.online',
};

export function normalizeApiBase(s: string): string {
  return s.replace(/\/+$/, '');
}

export async function readConfig(): Promise<FgsConfig> {
  try {
    const raw = await readFile(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<FgsConfig>;
    const merged = { ...DEFAULT_CONFIG, ...parsed };
    return { ...merged, apiBase: normalizeApiBase(merged.apiBase) };
  } catch {
    return { ...DEFAULT_CONFIG, apiBase: normalizeApiBase(DEFAULT_CONFIG.apiBase) };
  }
}

export async function writeConfig(config: FgsConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  await chmod(CONFIG_FILE, 0o600);
}
