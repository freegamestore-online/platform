#!/usr/bin/env node
// Live check that a hosted game is served with the default-open capability
// headers (#369). Used by prod-smoke and after a host deploy:
//
//   node scripts/check-game-headers.mjs [game-id ...]   (default: tetris)
//
// The expected lists mirror workers/host/src/host.ts; a host test keeps them
// in step, so a change there fails CI until this file matches.

export const EXPECTED_OPEN = [
  'accelerometer',
  'autoplay',
  'bluetooth',
  'camera',
  'clipboard-read',
  'clipboard-write',
  'compute-pressure',
  'display-capture',
  'encrypted-media',
  'fullscreen',
  'gamepad',
  'geolocation',
  'gyroscope',
  'hid',
  'idle-detection',
  'keyboard-map',
  'local-fonts',
  'magnetometer',
  'microphone',
  'midi',
  'picture-in-picture',
  'publickey-credentials-create',
  'publickey-credentials-get',
  'screen-wake-lock',
  'serial',
  'storage-access',
  'usb',
  'web-share',
  'window-management',
  'xr-spatial-tracking',
];

export const EXPECTED_CLOSED = ['payment', 'browsing-topics'];

/** CSP sources a game must have; a missing one means a default-open regression. */
export const EXPECTED_CSP = {
  'script-src': ["'self'", 'https:', "'wasm-unsafe-eval'"],
  'connect-src': ["'self'", 'https:', 'wss:'],
  'worker-src': ["'self'", 'blob:'],
  'media-src': ["'self'", 'https:', 'blob:'],
};

/** Problems with one response's headers, as human-readable lines. */
export function headerProblems(headers) {
  const problems = [];
  const pp = new Map(
    (headers.get('permissions-policy') ?? '')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean)
      .map((e) => {
        const i = e.indexOf('=');
        return [e.slice(0, i), e.slice(i + 1)];
      }),
  );
  for (const f of EXPECTED_OPEN) {
    if (pp.get(f) !== '(self)')
      problems.push(`permissions-policy ${f}=${pp.get(f) ?? '(missing)'}, want (self)`);
  }
  for (const f of EXPECTED_CLOSED) {
    if (pp.get(f) !== '()')
      problems.push(`permissions-policy ${f}=${pp.get(f) ?? '(missing)'}, want ()`);
  }
  const csp = new Map(
    (headers.get('content-security-policy') ?? '')
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...sources]) => [name, sources]),
  );
  for (const [name, want] of Object.entries(EXPECTED_CSP)) {
    const have = csp.get(name);
    if (!have) {
      problems.push(`csp ${name} missing`);
      continue;
    }
    for (const s of want) if (!have.includes(s)) problems.push(`csp ${name} lacks ${s}`);
  }
  return problems;
}

async function main(ids) {
  let failed = false;
  for (const id of ids) {
    const url = `https://${id}.freegamestore.online/`;
    const res = await fetch(url, { redirect: 'follow' });
    const problems = res.ok ? headerProblems(res.headers) : [`HTTP ${res.status}`];
    if (problems.length) {
      failed = true;
      console.log(`✗ ${url}`);
      for (const p of problems) console.log(`    ${p}`);
    } else {
      console.log(`✓ ${url} default-open headers`);
    }
  }
  process.exit(failed ? 1 : 0);
}

// Run only when executed directly, not when a test imports the lists.
if (process.argv[1]?.endsWith('check-game-headers.mjs')) {
  const ids = process.argv.slice(2);
  await main(ids.length ? ids : ['tetris']);
}
