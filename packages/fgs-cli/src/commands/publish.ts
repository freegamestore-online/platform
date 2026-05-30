import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runChecks } from '@freegamestore/compliance';
import { Command } from 'commander';
import prompts from 'prompts';
import { assertValidAppId } from '../lib/app-id.js';
import { readConfig } from '../lib/config.js';
import { openUrl } from '../lib/open.js';
import { renderCheckResults } from './check.js';
import { ensureDeployWorkflow } from './publish-workflow.js';

const SUBMISSION_URL = 'https://github.com/freegamestore-online/submissions/issues/new';

// Must match the storefront filter chips on freegamestore.online.
const CATEGORIES = [
  'Brain Training',
  'Arcade',
  'Strategy',
  'Sports',
  'Casual',
  'Cards',
  'Racing',
  'Other (specify in description)',
] as const;

const TYPES = [
  'Standalone (no backend, localStorage only)',
  'Connected (Firebase/Supabase backend, shared with Pro version)',
] as const;

interface SubmissionInput {
  name: string;
  category: (typeof CATEGORIES)[number];
  type: (typeof TYPES)[number];
  oneliner: string;
  description: string;
  repo: string | null;
  demo: string | null;
}

// fgs always targets games.
const STORE = 'games' as const;
const META = {
  label: 'FreeGameStore',
  domain: 'freegamestore.online',
  org: 'freegamestore-online',
} as const;

export const publishCommand = new Command('publish')
  .description(
    'Publish this game to FreeGameStore. Provisions repo + hosting + DNS automatically. If auto-provision is unavailable, falls back to opening a prefilled submission Issue for admin review.',
  )
  .option('--no-open', 'Print the fallback Issue URL instead of opening a browser.')
  .option('--issue', 'Skip auto-provision; always open the GitHub Issue form.')
  .option(
    '--skip-checks',
    'Skip compliance checks (not recommended — your submission may be rejected).',
  )
  .option('--name <id>', 'Game id (lowercase, used as subdomain). Skips the prompt.')
  .option(
    '--category <name>',
    'Category. Use exact label or its lowercased form (e.g. "strategy", "brain training"). Skips the prompt.',
  )
  .option('--type <kind>', 'Game type: "standalone" or "connected". Skips the prompt.')
  .option('--oneliner <text>', 'One-line description shown on the storefront. Skips the prompt.')
  .option('--demo <url>', 'Optional demo URL. Skips the prompt.')
  .option(
    '-y, --yes',
    'Non-interactive: fail rather than prompt for any missing fields. Pair with --name/--category/--type/--oneliner.',
  )
  .action(
    async (opts: {
      open: boolean;
      issue?: boolean;
      skipChecks?: boolean;
      name?: string;
      category?: string;
      type?: string;
      oneliner?: string;
      demo?: string;
      yes?: boolean;
    }) => {
      // Check auth BEFORE prompting — there's no point asking the user for
      // 5 fields just to bail at the end with "not signed in". --issue
      // skips this since the GitHub Issue form path doesn't need a session.
      if (!opts.issue) {
        const config = await readConfig();
        if (!config.session?.token) {
          process.stdout.write('\nNot signed in. Run: fgs login\n');
          process.exit(1);
        }
      }

      // Run compliance checks BEFORE prompts so a doomed submission fails
      // fast. Hard fails block; warnings allow through. Bypass with
      // --skip-checks if you really need to (admin review will still
      // catch issues).
      if (!opts.skipChecks) {
        process.stdout.write('Running compliance checks...\n\n');
        const results = await runChecks(process.cwd());
        const { failed } = renderCheckResults(results);
        if (failed > 0) {
          process.stdout.write(
            '\n⚠  Fix the failures above before publishing, or pass --skip-checks to bypass.\n',
          );
          process.exit(1);
        }
        process.stdout.write('\n');
      }

      const repo = await detectGitRepo();
      const appName = await detectAppName();
      const description = await detectDescription();

      process.stdout.write(`\nLet's publish your game to ${META.label}.\n`);
      if (!repo && opts.issue) {
        process.stdout.write(
          '⚠  No GitHub origin detected. Push your repo to GitHub first, then run again.\n',
        );
      }

      // Resolve flag values up-front. Whatever's missing falls through to a
      // prompt — unless --yes is set, in which case missing values abort.
      const resolved = resolveFromFlags(opts);
      if (resolved.errors.length > 0) {
        for (const e of resolved.errors) process.stdout.write(`✗ ${e}\n`);
        process.exit(1);
      }

      // --yes: optional fields default rather than abort. demo is the only
      // optional field today; new optional fields go here too.
      if (opts.yes && resolved.values.demo === undefined) {
        resolved.values.demo = null;
      }

      const promptList = buildPromptList(resolved.values, { appName, description });
      const answers =
        promptList.length === 0
          ? {}
          : opts.yes
            ? (() => {
                const missing = promptList.map((p) => p.name).join(', ');
                process.stdout.write(`✗ --yes set but missing required field(s): ${missing}\n`);
                process.exit(1);
              })()
            : ((await prompts(promptList, {
                onCancel: () => {
                  process.stdout.write('\nCanceled.\n');
                  process.exit(1);
                },
              })) as Partial<SubmissionInput>);

      const merged: Partial<SubmissionInput> = { ...resolved.values, ...answers };
      const input: SubmissionInput = {
        name: merged.name!,
        category: merged.category!,
        type: merged.type!,
        oneliner: merged.oneliner!,
        // Reuse the oneliner as the body description for the Issue-form
        // fallback. Auto-provision flow doesn't use it (admin's storefront
        // uses oneliner directly).
        description: merged.oneliner!,
        repo: repo ? `https://github.com/${repo}` : null,
        demo: merged.demo?.trim() ? merged.demo : null,
      };

      // Try auto-provision first unless the user explicitly asked for the
      // Issue-form fallback.
      if (!opts.issue) {
        const autoResult = await tryAutoProvision(input);
        if (autoResult.kind === 'success') {
          const injected = await ensureDeployWorkflow();

          process.stdout.write(`\n✓ Provisioned!\n`);
          process.stdout.write(`  Live at:  ${autoResult.appUrl}\n`);
          process.stdout.write(`  Repo:     ${autoResult.repoUrl}\n`);
          process.stdout.write(`  Listing:  https://freegamestore.online/games/${input.name}\n\n`);
          if (injected) {
            process.stdout.write(`  Added .github/workflows/deploy.yml (R2 deploy workflow)\n\n`);
          }
          process.stdout.write(`Push your code so the live URL serves it:\n\n`);
          process.stdout.write(`  git remote add upstream ${autoResult.repoUrl}.git\n`);
          process.stdout.write(`  git push upstream main\n\n`);
          process.stdout.write(`Future commits to main auto-deploy in ~30s.\n`);
          process.stdout.write(`Run \`fgs list\` any time to see your games.\n`);
          return;
        }
        if (autoResult.kind === 'unauthorized') {
          process.stdout.write(`\n⚠  Not signed in. Run: fgs login\n`);
          return;
        }
        process.stdout.write(
          `\n⚠  Auto-provision unavailable (${autoResult.reason}); falling back to Issue form.\n`,
        );
      }

      // Fallback: prefilled GitHub Issue form for admin review.
      const url = buildSubmissionUrl(input);
      if (opts.open) {
        process.stdout.write('\nOpening submission form on GitHub...\n');
        process.stdout.write('Review the prefilled fields and click "Submit new issue".\n');
        process.stdout.write('A maintainer will provision your app within ~48h.\n');
        await openUrl(url);
      } else {
        process.stdout.write(`\n${url}\n`);
      }
    },
  );

interface AutoProvisionSuccess {
  kind: 'success';
  appUrl: string;
  repoUrl: string;
}
interface AutoProvisionFailure {
  kind: 'unconfigured' | 'failed' | 'unauthorized';
  reason: string;
}
type AutoProvisionResult = AutoProvisionSuccess | AutoProvisionFailure;

async function tryAutoProvision(input: SubmissionInput): Promise<AutoProvisionResult> {
  const config = await readConfig();
  const sessionToken = config.session?.token;
  if (!sessionToken) return { kind: 'unauthorized', reason: 'no session' };

  const typeShort = input.type.startsWith('Standalone') ? 'standalone' : 'connected';
  const res = await fetch(`${config.apiBase}/api/provision`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: input.name,
      store: STORE,
      category: input.category,
      type: typeShort,
      oneliner: input.oneliner,
      description: input.description,
      repo: input.repo,
      demo: input.demo,
    }),
  });
  if (res.status === 401) return { kind: 'unauthorized', reason: 'session expired' };
  if (res.status === 503) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: 'unconfigured', reason: body.error ?? '503' };
  }
  if (!res.ok) {
    const body = await res.text();
    return { kind: 'failed', reason: `${res.status}: ${body}` };
  }
  const result = (await res.json()) as { appUrl: string; repoUrl: string };
  return { kind: 'success', appUrl: result.appUrl, repoUrl: result.repoUrl };
}

/**
 * Match a user-supplied --category value (case-insensitive, ignores
 * trailing/leading whitespace) against the canonical labels.
 * Returns the canonical form or null if no match.
 */
export function resolveCategory(value: string): (typeof CATEGORIES)[number] | null {
  const normalized = value.trim().toLowerCase();
  for (const c of CATEGORIES) {
    if (c.toLowerCase() === normalized) return c;
  }
  // Allow short forms like "other" → "Other (specify in description)".
  if (normalized === 'other') return 'Other (specify in description)';
  return null;
}

/** Resolve --type short form ("standalone"|"connected") to the full label. */
export function resolveType(value: string): (typeof TYPES)[number] | null {
  const v = value.trim().toLowerCase();
  if (v === 'standalone' || v === TYPES[0].toLowerCase()) return TYPES[0];
  if (v === 'connected' || v === TYPES[1].toLowerCase()) return TYPES[1];
  return null;
}

interface ResolvedFlags {
  values: Partial<SubmissionInput>;
  errors: string[];
}

export function resolveFromFlags(opts: {
  name?: string;
  category?: string;
  type?: string;
  oneliner?: string;
  demo?: string;
}): ResolvedFlags {
  const values: Partial<SubmissionInput> = {};
  const errors: string[] = [];

  if (opts.name !== undefined) {
    try {
      assertValidAppId(opts.name);
      values.name = opts.name;
    } catch (e) {
      errors.push(e instanceof Error ? `--name: ${e.message}` : '--name invalid');
    }
  }
  if (opts.category !== undefined) {
    const c = resolveCategory(opts.category);
    if (c) values.category = c;
    else errors.push(`--category: not a known category. One of: ${CATEGORIES.join(', ')}`);
  }
  if (opts.type !== undefined) {
    const t = resolveType(opts.type);
    if (t) values.type = t;
    else errors.push('--type must be "standalone" or "connected"');
  }
  if (opts.oneliner !== undefined) {
    if (opts.oneliner.trim().length === 0) errors.push('--oneliner cannot be empty');
    else values.oneliner = opts.oneliner;
  }
  if (opts.demo !== undefined) {
    values.demo = opts.demo.trim() || null;
  }
  return { values, errors };
}

type PromptDef = prompts.PromptObject<string>;

export function buildPromptList(
  resolved: Partial<SubmissionInput>,
  defaults: { appName: string | null; description: string | null },
): PromptDef[] {
  const list: PromptDef[] = [];
  if (resolved.name === undefined) {
    list.push({
      type: 'text',
      name: 'name',
      message: 'App id (lowercase, used as subdomain)',
      initial: defaults.appName ?? '',
      validate: (value: string) => {
        try {
          assertValidAppId(value);
          return true;
        } catch (e) {
          return e instanceof Error ? e.message : 'invalid';
        }
      },
    });
  }
  if (resolved.category === undefined) {
    list.push({
      type: 'select',
      name: 'category',
      message: "Category (one game per category — check freegamestore.online for what's taken)",
      choices: CATEGORIES.map((c) => ({ title: c, value: c })),
    });
  }
  if (resolved.type === undefined) {
    list.push({
      type: 'select',
      name: 'type',
      message: 'App type',
      choices: TYPES.map((t) => ({ title: t, value: t })),
    });
  }
  if (resolved.oneliner === undefined) {
    list.push({
      type: 'text',
      name: 'oneliner',
      message: 'One-line description (shown on the storefront)',
      initial: defaults.description ?? '',
      validate: (v: string) => v.trim().length > 0 || 'required',
    });
  }
  if (resolved.demo === undefined) {
    list.push({
      type: 'text',
      name: 'demo',
      message: 'Demo URL (optional, leave blank if none)',
    });
  }
  return list;
}

export function buildSubmissionUrl(input: SubmissionInput): string {
  const url = new URL(SUBMISSION_URL);
  url.searchParams.set('template', 'app-submission.yml');
  url.searchParams.set('title', `[Submission] ${input.name}`);
  url.searchParams.set('name', input.name);
  url.searchParams.set('category', input.category);
  url.searchParams.set('type', input.type);
  url.searchParams.set('oneliner', input.oneliner);
  url.searchParams.set('description', input.description);
  if (input.repo) url.searchParams.set('repo', input.repo);
  if (input.demo) url.searchParams.set('demo', input.demo);
  return url.toString();
}

async function detectAppName(): Promise<string | null> {
  try {
    const raw = await readFile(join(process.cwd(), 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { name?: string };
    return pkg.name ?? null;
  } catch {
    return null;
  }
}

async function detectDescription(): Promise<string | null> {
  try {
    const raw = await readFile(join(process.cwd(), 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { description?: string };
    return pkg.description ?? null;
  } catch {
    return null;
  }
}

function detectGitRepo(): Promise<string | null> {
  return new Promise((resolveFn) => {
    const child = spawn('git', ['remote', 'get-url', 'origin'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let buf = '';
    child.stdout.on('data', (chunk: Buffer) => (buf += chunk.toString()));
    child.on('close', (code) => {
      if (code !== 0) resolveFn(null);
      else resolveFn(parseGitHubRepo(buf.trim()));
    });
    child.on('error', () => resolveFn(null));
  });
}

export function parseGitHubRepo(url: string): string | null {
  const m = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url);
  if (!m?.[1] || !m[2]) return null;
  return `${m[1]}/${m[2]}`;
}
