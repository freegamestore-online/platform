#!/usr/bin/env node
// Builds the storefront's per-game permissions data (#370):
// sites/freegamestore/game-permissions.json, which build.js renders on each
// listing and game card.
//
// For every game in the registry it reads the game's own repo (a shallow
// clone) and records:
//   - declared: what package.json declares under freegamestore.permissions,
//     id → one-line reason;
//   - detected: what the game's source uses (web/src, web/index.html).
// Detection and parsing come from @freegamestore/compliance, the same code
// `fgs check` runs, so the listing and the check never disagree.
//
//   pnpm --filter @freegamestore/compliance build
//   node scripts/scan-game-permissions.mjs [--clones <dir>] [--only id,id]
//
// --clones reuses existing clones (<dir>/<id>); missing ones are cloned there.
// The repos are only read: nothing in them is installed or run.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = join(ROOT, 'sites/freegamestore/registry.json');
const OUT = join(ROOT, 'sites/freegamestore/game-permissions.json');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** The scan result for one cloned repo. */
export async function scanRepo(dir, compliance) {
  const source = compliance.fsFileSource(dir);
  const detected = await compliance.detectPermissions(source);
  const pkgPath = join(dir, 'package.json');
  const { declared } = compliance.parseDeclaredPermissions(
    existsSync(pkgPath) ? readFileSync(pkgPath, 'utf8') : null,
  );
  return { declared, detected };
}

async function main() {
  const compliance = await import(
    pathToFileURL(join(ROOT, 'packages/compliance/dist/index.js')).href
  );
  const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  const only = arg('--only')?.split(',');
  const clones = arg('--clones') ?? mkdtempSync(join(tmpdir(), 'fgs-perm-scan-'));
  mkdirSync(clones, { recursive: true });

  const previous = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')).games ?? {}) : {};
  const games = { ...previous };
  const failed = [];
  for (const g of registry.games) {
    if (!g?.id || (only && !only.includes(g.id))) continue;
    const repo = typeof g.repo === 'string' ? g.repo : `freegamestore-online/${g.id}`;
    const dir = join(clones, g.id);
    try {
      if (!existsSync(join(dir, '.git'))) {
        execFileSync(
          'git',
          ['clone', '-q', '--depth', '1', `https://github.com/${repo}.git`, dir],
          {
            stdio: 'ignore',
          },
        );
      }
      games[g.id] = await scanRepo(dir, compliance);
    } catch {
      failed.push(g.id);
    }
  }
  const sorted = Object.fromEntries(
    Object.keys(games)
      .sort()
      .map((id) => [id, games[id]]),
  );
  writeFileSync(
    OUT,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), games: sorted }, null, 2)}\n`,
  );
  const withAny = Object.values(sorted).filter(
    (r) => r.detected.length || Object.keys(r.declared).length,
  ).length;
  console.log(`scanned ${Object.keys(sorted).length} games, ${withAny} with permissions → ${OUT}`);
  if (failed.length) console.log(`could not scan: ${failed.join(', ')}`);
}

if (process.argv[1]?.endsWith('scan-game-permissions.mjs')) await main();
