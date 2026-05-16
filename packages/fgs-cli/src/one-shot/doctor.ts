import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from '../lib/config.js';

export type CheckStatus = 'pass' | 'fail' | 'warn';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

/**
 * Runs every local + remote health check, in parallel where it's safe to.
 * Returns the full result list. The CLI's `fas doctor` and the TUI's
 * Doctor screen both render this same data.
 */
export async function runDoctor(): Promise<CheckResult[]> {
  const checks = await Promise.all([
    checkNodeVersion(),
    checkBinary('git'),
    checkBinary('pnpm'),
    checkConfigFile(),
    checkSignedIn(),
    checkApiReachable(),
  ]);
  return checks;
}

async function checkNodeVersion(): Promise<CheckResult> {
  const v = process.versions.node;
  const major = Number(v.split('.')[0]);
  if (Number.isNaN(major)) {
    return { name: 'Node version', status: 'warn', detail: `Could not parse: ${v}` };
  }
  if (major < 22) {
    return {
      name: 'Node version',
      status: 'fail',
      detail: `${v} (need ≥ 22 to run the templates)`,
    };
  }
  return { name: 'Node version', status: 'pass', detail: v };
}

async function checkBinary(name: string): Promise<CheckResult> {
  const found = await which(name);
  return found
    ? { name: `${name} installed`, status: 'pass', detail: found }
    : { name: `${name} installed`, status: 'fail', detail: `${name} not on PATH` };
}

async function checkConfigFile(): Promise<CheckResult> {
  const path = join(homedir(), '.fas', 'config.json');
  try {
    const raw = await readFile(path, 'utf8');
    JSON.parse(raw);
    return { name: 'Config file', status: 'pass', detail: path };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { name: 'Config file', status: 'warn', detail: 'No config yet — run `fas login`.' };
    }
    return {
      name: 'Config file',
      status: 'fail',
      detail: `${path}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function checkSignedIn(): Promise<CheckResult> {
  try {
    const config = await readConfig();
    if (!config.session?.token) {
      return { name: 'Signed in', status: 'warn', detail: 'Not signed in. Run `fas login`.' };
    }
    if (!config.github?.login) {
      return {
        name: 'Signed in',
        status: 'warn',
        detail: 'Session present but missing GitHub login — run `fas login` again.',
      };
    }
    return { name: 'Signed in', status: 'pass', detail: `@${config.github.login}` };
  } catch (err) {
    return {
      name: 'Signed in',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkApiReachable(): Promise<CheckResult> {
  try {
    const config = await readConfig();
    const started = Date.now();
    const res = await fetch(`${config.apiBase}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    const ms = Date.now() - started;
    if (res.ok) {
      return { name: 'API reachable', status: 'pass', detail: `${config.apiBase} (${ms}ms)` };
    }
    return {
      name: 'API reachable',
      status: 'fail',
      detail: `HTTP ${res.status} from ${config.apiBase}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name: 'API reachable', status: 'fail', detail: msg };
  }
}

function which(cmd: string): Promise<string | null> {
  return new Promise((resolveFn) => {
    const child = spawn('which', [cmd], { stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '';
    child.stdout.on('data', (chunk: Buffer) => (buf += chunk.toString()));
    child.on('close', (code) => resolveFn(code === 0 ? buf.trim() : null));
    child.on('error', () => resolveFn(null));
  });
}
