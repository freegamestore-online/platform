import { Command } from 'commander';
import { readConfig } from '../lib/config.js';
import { fetchAppHistory, formatRelative, type AppHistory } from '../lib/history.js';

interface ListedApp {
  id: string;
  ownerLogin: string;
  createdAt: number;
  store?: 'apps' | 'games';
  category: string | null;
  type: string | null;
  oneliner: string | null;
  repo: string | null;
  demo: string | null;
  appUrl: string;
  repoUrl: string;
}

const isTTY = Boolean(process.stdout.isTTY) && process.env['NO_COLOR'] !== '1';
const dim = (s: string) => (isTTY ? `\x1b[2m${s}\x1b[22m` : s);
const bold = (s: string) => (isTTY ? `\x1b[1m${s}\x1b[22m` : s);

export const listCommand = new Command('list')
  .alias('ls')
  .description('List apps and games you have published.')
  .option('--json', 'Output JSON instead of a table (includes per-app commit history).')
  .option(
    '-v, --verbose',
    'Show recent commits per app. Fetches the last 3 commits from each app repo via the GitHub API.',
  )
  .action(async (opts: { json?: boolean; verbose?: boolean }) => {
    const config = await readConfig();
    if (!config.session?.token) {
      process.stdout.write('\n⚠  Not signed in. Run: fas login\n');
      process.exit(1);
    }

    const res = await fetch(`${config.apiBase}/v1/apps/mine`, {
      headers: { Authorization: `Bearer ${config.session.token}` },
    });
    if (res.status === 401) {
      process.stdout.write('\n⚠  Session expired. Run: fas login\n');
      process.exit(1);
    }
    if (!res.ok) {
      const body = await res.text();
      process.stdout.write(`\n✗ Failed to fetch apps (${res.status}): ${body}\n`);
      process.exit(1);
    }

    const { apps } = (await res.json()) as { apps: ListedApp[] };

    // Fetch commit history in parallel — small set (a creator's own apps),
    // capped at 3 commits each, gracefully degrades on rate-limit (the
    // app prints fine without history). GH_TOKEN env var lifts the
    // 60/hr anonymous limit if the user runs into it.
    const histories = apps.length > 0
      ? await Promise.all(apps.map((a) => fetchAppHistory(repoSlug(a.repoUrl))))
      : [];

    if (opts.json) {
      const enriched = apps.map((a, i) => ({ ...a, history: histories[i] }));
      process.stdout.write(JSON.stringify(enriched, null, 2) + '\n');
      return;
    }

    if (apps.length === 0) {
      process.stdout.write('\nNo apps yet. Run `fas init` to start one.\n');
      return;
    }

    process.stdout.write('\n');
    for (let i = 0; i < apps.length; i++) {
      const a = apps[i]!;
      const h = histories[i]!;
      printApp(a, h, opts.verbose ?? false);
    }
    const gameCount = apps.filter((a) => a.store === 'games').length;
    const appCount = apps.length - gameCount;
    const summary =
      gameCount === 0
        ? `${appCount} app${appCount === 1 ? '' : 's'}`
        : appCount === 0
          ? `${gameCount} game${gameCount === 1 ? '' : 's'}`
          : `${appCount} app${appCount === 1 ? '' : 's'}, ${gameCount} game${gameCount === 1 ? '' : 's'}`;
    process.stdout.write(dim(`${summary}\n`));

    // Surface rate-limit failure as a hint, not an error — output above
    // is still useful, just lacks recency info.
    if (histories.some((h) => h.error === 'rate-limited')) {
      process.stdout.write(
        dim(
          'Some commit history was rate-limited. Set GH_TOKEN to a GitHub PAT to lift the 60/hr anonymous limit.\n',
        ),
      );
    }
  });

function printApp(a: ListedApp, h: AppHistory, verbose: boolean) {
  const storeBadge = a.store === 'games' ? dim('[game] ') : dim('[app]  ');
  process.stdout.write(`${storeBadge}${bold(a.id.padEnd(20))} ${dim(a.category ?? '—')}\n`);
  if (a.oneliner) process.stdout.write(`         ${a.oneliner}\n`);
  if (h.lastUpdated) {
    process.stdout.write(`         ${dim('updated:')} ${formatRelative(h.lastUpdated)}\n`);
  }
  process.stdout.write(`         ${dim('live:')} ${a.appUrl}\n`);
  process.stdout.write(`         ${dim('repo:')} ${a.repoUrl}\n`);
  if (verbose && h.commits && h.commits.length > 0) {
    process.stdout.write(`         ${dim('recent:')}\n`);
    for (const c of h.commits) {
      const short = c.sha.slice(0, 7);
      const msg = c.message.split('\n')[0]!.slice(0, 80);
      process.stdout.write(`           ${dim(short)}  ${msg}\n`);
    }
  }
  process.stdout.write('\n');
}

/**
 * Convert "https://github.com/owner/name[.git]" → "owner/name".
 * Allows dots in the repo name (e.g. nodejs/node.js); strips a
 * trailing `.git` suffix and any trailing slash.
 */
export function repoSlug(url: string): string {
  const m = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url);
  return m ? `${m[1]}/${m[2]}` : '';
}
