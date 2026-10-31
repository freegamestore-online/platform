import { Command } from 'commander';
import { type MigrateResult, migrateTailwindTokens } from '../lib/migrate-tailwind-tokens.js';
import { bold, dim, green, yellow } from '../lib/style.js';

/** True when an alias was left in place because its light and dark values disagree. */
function hasAliasConflict(r: MigrateResult): boolean {
  return r.skippedAliases.some((s) => / in light but | different tokens in the /.test(s.reason));
}

export function renderMigrateResult(r: MigrateResult, out: NodeJS.WritableStream): void {
  if (!r.write) for (const c of r.changes) out.write(c.diff);
  for (const c of r.changes) out.write(`${bold(c.file)}: ${c.replacements} change(s)\n`);
  for (const a of r.inlinedAliases) {
    out.write(`alias ${a.alias} → var(${a.target}), definition removed\n`);
  }
  for (const a of r.renamedAliases) out.write(`alias ${a.alias} renamed to ${a.target}\n`);
  if (r.themeInserted) out.write('inserted @theme inline into index.css\n');
  for (const line of r.report) out.write(`${yellow('left for follow-up:')} ${line}\n`);
  out.write(
    r.write
      ? green(`\nWrote ${r.changes.length} file(s), ${r.replacements} change(s).\n`)
      : `${dim(`\nDry run: ${r.changes.length} file(s), ${r.replacements} change(s) would be made. Re-run with --write to apply.`)}\n`,
  );
}

export const migrateCommand = new Command('migrate').description(
  'Codemods that move a game onto the current FreeGameStore standards.',
);

migrateCommand
  .command('tailwind-tokens')
  .description(
    'Rewrite long-hand Tailwind variable utilities (text-[var(--muted)]) to token utilities (text-muted) and inline retired aliases. Dry run unless --write.',
  )
  .option(
    '--dir <path>',
    'game repo root (or the platform root for apps/console and apps/admin)',
    '.',
  )
  .option('--write', 'apply the changes (default: print the diff and change nothing)')
  .action(async (opts: { dir: string; write?: boolean }) => {
    const r = await migrateTailwindTokens({ dir: opts.dir, write: Boolean(opts.write) });
    renderMigrateResult(r, process.stdout);
    // A light/dark alias conflict needs a human decision: say so with the exit code.
    if (hasAliasConflict(r)) process.exit(1);
  });
