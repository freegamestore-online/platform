import { Command } from 'commander';
import { runDoctor, type CheckResult } from '../one-shot/doctor.js';

const ICON: Record<CheckResult['status'], string> = {
  pass: '✓',
  warn: '!',
  fail: '✗',
};

// ANSI color codes — same approach as lib/style.ts but inlined for simplicity
const isTTY = Boolean(process.stdout.isTTY) && process.env['NO_COLOR'] !== '1';
const c = (open: string) => (s: string) => (isTTY ? `\x1b[${open}m${s}\x1b[39m` : s);
const green = c('32');
const yellow = c('33');
const red = c('31');
const dim = (s: string) => (isTTY ? `\x1b[2m${s}\x1b[22m` : s);

const COLOR: Record<CheckResult['status'], (s: string) => string> = {
  pass: green,
  warn: yellow,
  fail: red,
};

export const doctorCommand = new Command('doctor')
  .description('Run local health checks (signed-in, API reachable, tools, etc.).')
  .action(async () => {
    const results = await runDoctor();
    let failed = 0;
    for (const r of results) {
      const icon = COLOR[r.status](ICON[r.status]);
      process.stdout.write(`${icon}  ${r.name.padEnd(20)} ${dim(r.detail)}\n`);
      if (r.status === 'fail') failed++;
    }
    if (failed > 0) process.exit(1);
  });
