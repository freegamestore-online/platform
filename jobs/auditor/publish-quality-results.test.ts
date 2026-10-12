// Regression check for the weekly publish (#148). The publish used to pass the
// base64 audit file as `-f content=...`, which failed with "Argument list too
// long" once the JSON grew past ~128 KiB. These tests run the real script
// against a fake `gh` and use a payload well past that limit.
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const SCRIPT = resolve(import.meta.dirname, 'publish-quality-results.sh');

// Linux rejects any single argv string above MAX_ARG_STRLEN (128 KiB). The
// fake gh enforces a stricter bound so a regression is caught on any host.
const MAX_ARG_BYTES = 64 * 1024;

// ~1.5 MB of JSON, roughly twice the 718 KB file the failing run tried to send.
const PAYLOAD = JSON.stringify({
  generatedAt: '2026-10-13T06:00:00Z',
  games: Array.from({ length: 3000 }, (_, i) => ({
    id: `game-${i}`,
    notes: 'x'.repeat(480),
    viewports: [{ width: 1280, height: 720, clipped: i % 7 }],
  })),
});

const FAKE_GH = `#!/usr/bin/env bash
set -eu
{
  for arg in "$@"; do
    printf '%s\\n' "\${#arg}" >> "$FAKE_GH_ARGLENS"
  done
  echo "--" >> "$FAKE_GH_ARGLENS"
  echo "$*" >> "$FAKE_GH_CALLS"
}
if [ "$1" = "api" ] && [ "\${2:-}" = "-X" ]; then
  # PUT: capture the request body file that --input points at.
  input=""
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "--input" ]; then input="$2"; fi
    shift
  done
  cp "$input" "$FAKE_GH_BODY"
  if [ "\${FAKE_GH_PUT:-ok}" = "fail" ]; then echo "gh: Conflict (HTTP 409)" >&2; exit 1; fi
  echo '{"commit":{"sha":"fakecommitsha"}}'
  exit 0
fi
# GET
case "\${FAKE_GH_GET:-exists}" in
  exists) echo '{"sha":"existingsha123"}' ;;
  missing) echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;
  error) echo "gh: Server Error (HTTP 500)" >&2; exit 1 ;;
esac
`;

describe('publish-quality-results.sh', () => {
  let dir: string;
  let resultsFile: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'publish-test-'));
    const bin = join(dir, 'bin');
    await run('mkdir', [bin]);
    await writeFile(join(bin, 'gh'), FAKE_GH);
    await chmod(join(bin, 'gh'), 0o755);
    resultsFile = join(dir, 'audit-results.json');
    await writeFile(resultsFile, PAYLOAD);
    env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GH_TOKEN: 'test-token',
      FAKE_GH_ARGLENS: join(dir, 'arglens.txt'),
      FAKE_GH_CALLS: join(dir, 'calls.txt'),
      FAKE_GH_BODY: join(dir, 'body.json'),
    };
    await writeFile(join(dir, 'arglens.txt'), '');
    await writeFile(join(dir, 'calls.txt'), '');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function publish(get: 'exists' | 'missing' | 'error', put: 'ok' | 'fail' = 'ok') {
    return run('bash', [SCRIPT, resultsFile], {
      env: { ...env, FAKE_GH_GET: get, FAKE_GH_PUT: put },
    }).then(
      (r) => ({ code: 0, stdout: r.stdout, stderr: r.stderr }),
      (e: { code: number; stdout: string; stderr: string }) => ({
        code: e.code,
        stdout: e.stdout,
        stderr: e.stderr,
      }),
    );
  }

  async function maxArgBytes(): Promise<number> {
    const lens = (await readFile(env.FAKE_GH_ARGLENS as string, 'utf8'))
      .split('\n')
      .filter((l) => l && l !== '--')
      .map(Number);
    return Math.max(...lens);
  }

  it('updates an existing file with its current sha and round-trips a payload over the argv limit', async () => {
    const result = await publish('exists');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Commit: fakecommitsha');

    const body = JSON.parse(await readFile(env.FAKE_GH_BODY as string, 'utf8'));
    expect(body.sha).toBe('existingsha123');
    expect(body.message).toMatch(/^data: weekly quality audit \d{4}-\d{2}-\d{2}$/);
    expect(Buffer.from(body.content, 'base64').toString('utf8')).toBe(PAYLOAD);
    expect(PAYLOAD.length).toBeGreaterThan(1_000_000);

    expect(await maxArgBytes()).toBeLessThan(MAX_ARG_BYTES);
  });

  it('creates the file without a sha when GitHub reports 404', async () => {
    const result = await publish('missing');
    expect(result.code).toBe(0);

    const body = JSON.parse(await readFile(env.FAKE_GH_BODY as string, 'utf8'));
    expect(body).not.toHaveProperty('sha');
    expect(Buffer.from(body.content, 'base64').toString('utf8')).toBe(PAYLOAD);
  });

  it('fails without writing when the current file cannot be read for a reason other than 404', async () => {
    const result = await publish('error');
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('HTTP 500');
    expect(await readFile(env.FAKE_GH_CALLS as string, 'utf8')).not.toContain('-X PUT');
  });

  it('fails clearly when the PUT is rejected', async () => {
    const result = await publish('exists', 'fail');
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('PUT repos/freegamestore-online/platform/contents/');
  });
});
