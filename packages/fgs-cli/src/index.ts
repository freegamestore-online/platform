#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { adminCommand } from './commands/admin.js';
import { checkCommand } from './commands/check.js';
import { doctorCommand } from './commands/doctor.js';
import { initCommand } from './commands/init.js';
import { listCommand } from './commands/list.js';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { logsCommand } from './commands/logs.js';
import { migrateCommand } from './commands/migrate.js';
import { publishCommand } from './commands/publish.js';
import { screencheckCommand } from './commands/screencheck.js';
import { whoamiCommand } from './commands/whoami.js';

// Read version from the package's own package.json so `fgs --version` always
// matches the installed package.
const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
  version: string;
};

const program = new Command();

program
  .name('fgs')
  .description('FreeGameStore CLI — sign in, scaffold, and publish free games.')
  .version(pkg.version);

program.addCommand(loginCommand);
program.addCommand(logoutCommand);
program.addCommand(whoamiCommand);
program.addCommand(initCommand);
program.addCommand(publishCommand);
program.addCommand(logsCommand);
program.addCommand(doctorCommand);
program.addCommand(checkCommand);
program.addCommand(screencheckCommand);
program.addCommand(migrateCommand);
program.addCommand(listCommand);
program.addCommand(adminCommand);

async function main(): Promise<void> {
  if (process.argv.length === 2) {
    program.outputHelp();
    return;
  }
  await program.parseAsync();
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`fgs: ${msg}\n`);
  process.exit(1);
});
