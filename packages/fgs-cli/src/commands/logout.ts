import { Command } from 'commander';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const logoutCommand = new Command('logout')
  .description('Clear the local fas session and GitHub access token.')
  .action(async () => {
    const path = join(homedir(), '.fas', 'config.json');
    await rm(path, { force: true });
    process.stdout.write('Signed out. Run `fas login` to sign in again.\n');
  });
