import { rm } from 'node:fs/promises';
import { Command } from 'commander';
import { CONFIG_FILE } from '../lib/config.js';

export const logoutCommand = new Command('logout')
  .description('Clear the local fgs session.')
  .action(async () => {
    await rm(CONFIG_FILE, { force: true });
    process.stdout.write('Signed out. Run `fgs login` to sign in again.\n');
  });
