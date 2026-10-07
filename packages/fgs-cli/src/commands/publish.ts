import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GAME_CATEGORY_LABELS, getCategoryByLabel, runChecks } from '@freegamestore/compliance';
import { Command } from 'commander';
import prompts from 'prompts';
import { assertValidAppId } from '../lib/app-id.js';
import { readConfig } from '../lib/config.js';
import { openUrl } from '../lib/open.js';
import { renderCheckResults } from './check.js';
import { ensureDeployWorkflow } from './publish-workflow.js';

const SUBMISSION_URL = 'https://github.com/freegamestore-online/submissions/issues/new';

// Display labels for the CLI prompts
const CATEGORIES = GAME_CATEGORY_LABELS;

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

      // Refuse a cross-store project up front (FAS app published via fgs publish).
      const storeErr = await assertFreeGameStoreProject(process.cwd());
      if (storeErr) {
        process.stdout.write(`\n✗ ${storeErr}\n`);
        process.exit(1);
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
      const categoryLabel = merged.category!;
      const categorySlug = getCategoryByLabel(categoryLabel)?.slug || categoryLabel;
      const input: SubmissionInput = {
        name: merged.name!,
        category: categoryLabel,
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
        const autoResult = await tryAutoProvision(input, categorySlug);
        const injected = autoResult.kind === 'success' ? await ensureDeployWorkflow() : false;
        const outcome = provisionOutcome(autoResult, input.name, injected);
        for (const line of outcome.lines) process.stdout.write(`${line}\n`);
        // Only an unavailable provisioning service falls through to the Issue
        // form. Auth and validation failures are hard errors (#92): exiting 0
        // made `fgs publish --yes` in CI read as success, and the Issue fallback
        // filed a second, manual request for an id admin had just rejected.
        if (outcome.exitCode !== null) {
          if (outcome.exitCode !== 0) process.exit(outcome.exitCode);
          return;
        }
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

export type AutoProvisionResult =
  | {
      kind: 'success';
      appUrl: string;
      repoUrl: string;
      /** Admin generated the repo just now (vs. it already existed). */
      created: boolean;
    }
  /** No session, or admin rejected it (401). */
  | { kind: 'unauthorized'; reason: string }
  /** Admin refused the request (validation, id taken, ownership conflict). */
  | { kind: 'rejected'; reason: string }
  /** Provisioning service unreachable / not configured / 5xx — retryable. */
  | { kind: 'unavailable'; reason: string };

export async function tryAutoProvision(
  input: SubmissionInput,
  categorySlug?: string,
): Promise<AutoProvisionResult> {
  const config = await readConfig();
  const sessionToken = config.session?.token;
  if (!sessionToken) return { kind: 'unauthorized', reason: 'no session' };

  const typeShort = input.type.startsWith('Standalone') ? 'standalone' : 'connected';
  const slug = categorySlug || getCategoryByLabel(input.category)?.slug || input.category;
  let res: Response;
  try {
    res = await fetch(`${config.apiBase}/api/provision`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: input.name,
        store: STORE,
        category: slug,
        type: typeShort,
        oneliner: input.oneliner,
        description: input.description,
        repo: input.repo,
        demo: input.demo,
      }),
    });
  } catch (err) {
    return { kind: 'unavailable', reason: err instanceof Error ? err.message : String(err) };
  }
  if (res.status === 401) return { kind: 'unauthorized', reason: 'session expired' };

  const text = await res.text().catch(() => '');
  let body: {
    error?: string;
    appUrl?: string;
    repoUrl?: string;
    success?: boolean;
    steps?: { name?: string; status?: string; detail?: string }[];
  } = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // Non-JSON body: reported as-is below.
  }
  const failedSteps = (body.steps ?? [])
    .filter((st) => st.status === 'fail')
    .map((st) => `${st.name}: ${st.detail}`)
    .join('; ');
  const reason = body.error || failedSteps || text.slice(0, 300) || `HTTP ${res.status}`;

  if (res.status >= 500) return { kind: 'unavailable', reason };
  if (!res.ok) return { kind: 'rejected', reason };
  if (!body.appUrl || !body.repoUrl) {
    return { kind: 'unavailable', reason: 'provision returned an unexpected response' };
  }
  const created = (body.steps ?? []).some((st) => st.name === 'GitHub repo' && st.status === 'ok');
  return { kind: 'success', appUrl: body.appUrl, repoUrl: body.repoUrl, created };
}

/** What `fgs publish` prints and how it exits for an auto-provision result.
 *  `exitCode: null` means "fall through to the GitHub Issue form". Pure, so the
 *  exit-code and push-instruction rules are unit-testable (#92). */
export function provisionOutcome(
  result: AutoProvisionResult,
  gameName: string,
  deployWorkflowAdded: boolean,
): { lines: string[]; exitCode: number | null } {
  switch (result.kind) {
    case 'unauthorized':
      return {
        lines: ['', `✗ Not signed in (${result.reason}). Run: fgs login`],
        exitCode: 1,
      };
    case 'rejected':
      return {
        lines: ['', `✗ Publish was rejected: ${result.reason}`, '  Nothing was published.'],
        exitCode: 1,
      };
    case 'unavailable':
      return {
        lines: [
          '',
          `⚠  Auto-provision unavailable (${result.reason}); falling back to Issue form.`,
        ],
        exitCode: null,
      };
    case 'success': {
      const lines = [
        '',
        '✓ Provisioned!',
        `  Live at:  ${result.appUrl}`,
        `  Repo:     ${result.repoUrl}`,
        `  Listing:  https://freegamestore.online/games/${gameName}`,
        '',
      ];
      if (deployWorkflowAdded) {
        lines.push('  Added .github/workflows/deploy.yml (R2 deploy workflow) — commit it:', '');
        lines.push('  git add .github/workflows/deploy.yml');
        lines.push('  git commit -m "Add FreeGameStore deploy workflow"', '');
      }
      if (result.created) {
        // The repo was generated server-side from the template, so it has its
        // own history, unrelated to this checkout's (`fgs init` makes a fresh
        // first commit). A plain push is rejected; replace the scaffold.
        lines.push(
          'Push your code so the live URL serves it. The new repo only holds the template',
          "scaffold and doesn't share history with this checkout, so replace it:",
          '',
          `  git remote add upstream ${result.repoUrl}.git`,
          '  git push --force upstream main',
          '',
        );
      } else {
        lines.push(
          "This game's repo already existed, so it was left as it is. Push to it only from a",
          "clone of that repo (don't force-push — it would overwrite the game's history):",
          '',
          `  git push ${result.repoUrl}.git main`,
          '',
        );
      }
      lines.push('Future commits to main auto-deploy in ~30s.');
      lines.push('Run `fgs list` any time to see your games.');
      return { lines, exitCode: 0 };
    }
  }
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
      choices: CATEGORIES.map((c: (typeof CATEGORIES)[number]) => ({ title: c, value: c })),
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

/** FAS and FGS are SEPARATE stores — separate R2 buckets (fas-apps vs fgs-games),
 *  credentials, host workers and domains. A project scaffolded for FreeAppStore
 *  (uses @freeappstore/sdk, or a deploy.yml pinned to the fas-apps bucket)
 *  cannot deploy from FreeGameStore: its push would fail opaquely at "Upload to
 *  R2" with AccessDenied (the FGS token has no access to fas-apps, and vice
 *  versa). Catch the mismatch HERE, before provisioning, with a clear message. */
export async function assertFreeGameStoreProject(cwd: string): Promise<string | null> {
  const read = async (rel: string): Promise<string> => {
    try {
      return await readFile(join(cwd, rel), 'utf8');
    } catch {
      return '';
    }
  };
  const haystack =
    (await read('web/package.json')) +
    '\n' +
    (await read('package.json')) +
    '\n' +
    (await read('.github/workflows/deploy.yml'));
  // FreeAppStore markers — the SDK dependency or the fas-apps R2 target.
  if (/@freeappstore\/sdk|fas-apps|freeappstore-host/.test(haystack)) {
    return "This looks like a FreeAppStore app (it uses @freeappstore/sdk or the fas-apps bucket). FreeAppStore and FreeGameStore are separate stores — publish it with `fas publish` instead. Cross-publishing fails at R2 upload (AccessDenied) because each store's credentials only reach its own bucket.";
  }
  return null;
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
