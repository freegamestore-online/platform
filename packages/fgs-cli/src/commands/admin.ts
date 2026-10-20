import { Command } from 'commander';
import { resolveApiBase } from '../lib/config.js';

// Platform admin operations (#358). Ported from FreeAppStore's `fas admin`
// (freeappstore-online/platform#274).
//
// Admin rights on FGS come from a Google sign-in on an allowlisted email, not
// from GitHub. The session `fgs login` stores is a GitHub one and is never an
// admin, so these commands take the admin's fgs_token from FGS_ADMIN_TOKEN:
// sign in at https://admin.freegamestore.online with Google and copy the
// `__Host-fgs_token` cookie (or use an MCP session token).

const GAME_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** The admin token, or null when it isn't set. */
export function adminToken(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.FGS_ADMIN_TOKEN?.trim() || null;
}

/** One line for stderr. Includes the current owner on a compare-and-set refusal. */
export function formatTransferFailure(status: number, text: string): string {
  let msg = text.trim() || 'empty response';
  try {
    const parsed = JSON.parse(text) as {
      error?: string;
      owner_login?: string | null;
      login?: string;
    };
    if (parsed.error) {
      if (parsed.owner_login !== undefined) {
        msg = `${parsed.error} (current owner is ${parsed.owner_login ?? 'not recorded'})`;
      } else if (parsed.login) msg = `${parsed.error}: ${parsed.login}`;
      else msg = parsed.error;
    }
  } catch {
    // Body wasn't JSON; keep the raw text.
  }
  return `transfer-owner failed (${status}): ${msg}`;
}

/** One repo-access step from the transfer response (#359). */
export interface CollaboratorStep {
  name: string;
  status: 'ok' | 'skip' | 'fail';
  detail: string;
}

/** Repo-access lines: successes and skips for stdout, failures as warnings
 *  for stderr. A failure does not mean the transfer failed; the owner moved. */
export function formatCollaboratorSteps(steps: CollaboratorStep[]): { out: string; err: string } {
  let out = '';
  let err = '';
  for (const step of steps) {
    if (step.status === 'fail') err += `fgs: warning: repo access: ${step.detail}\n`;
    else out += `  ${step.status === 'ok' ? '✓' : '·'} ${step.detail}\n`;
  }
  return { out, err };
}

function requireAdminToken(): string {
  const token = adminToken();
  if (!token) {
    process.stderr.write(
      'fgs: set FGS_ADMIN_TOKEN to an admin fgs_token (sign in at https://admin.freegamestore.online with Google).\n',
    );
    process.exit(1);
  }
  return token;
}

function requireGameId(game: string): void {
  if (!GAME_ID_RE.test(game)) {
    process.stderr.write(`fgs: invalid game id "${game}".\n`);
    process.exit(1);
  }
}

export const adminCommand = new Command('admin')
  .description('Platform admin operations. Requires FGS_ADMIN_TOKEN (an admin Google session).')
  .addCommand(
    new Command('transfer-owner')
      .description(
        'Transfer a game to a new owner. Refused unless --from is the current owner. Undo by swapping --from and --to.',
      )
      .argument('<game>', 'game id')
      .requiredOption('--from <login>', 'current owner GitHub login (compare-and-set)')
      .requiredOption('--to <login>', 'new owner GitHub login')
      .requiredOption('--reason <text>', 'why the owner is changing (stored in the audit record)')
      .option(
        '--keep-from-access',
        "leave --from's push access to the game repo in place (default: revoke it)",
      )
      .option('--json', 'print the response JSON')
      .action(
        async (
          game: string,
          opts: {
            from: string;
            to: string;
            reason: string;
            keepFromAccess?: boolean;
            json?: boolean;
          },
        ) => {
          requireGameId(game);
          const token = requireAdminToken();
          const res = await fetch(`${resolveApiBase()}/api/admin/transfer-owner`, {
            method: 'POST',
            headers: { 'X-FGS-Token': token, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              game_id: game,
              from_login: opts.from,
              to_login: opts.to,
              reason: opts.reason,
              ...(opts.keepFromAccess ? { keep_previous_access: true } : {}),
            }),
          });
          const text = await res.text();
          if (!res.ok) {
            process.stderr.write(`fgs: ${formatTransferFailure(res.status, text)}\n`);
            process.exit(1);
          }
          if (opts.json) {
            process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
            return;
          }
          const body = JSON.parse(text) as {
            game_id: string;
            from_login: string;
            to_login: string;
            audit_error?: string;
            collaborators?: CollaboratorStep[];
          };
          process.stdout.write(
            `✓ ${body.game_id} owner is now ${body.to_login} (was ${body.from_login})\n`,
          );
          const access = formatCollaboratorSteps(body.collaborators ?? []);
          if (access.out) process.stdout.write(access.out);
          if (access.err) process.stderr.write(access.err);
          if (body.audit_error) process.stderr.write(`fgs: warning: ${body.audit_error}\n`);
        },
      ),
  )
  .addCommand(
    new Command('transfers')
      .description("List a game's ownership transfers, newest first.")
      .argument('<game>', 'game id')
      .action(async (game: string) => {
        requireGameId(game);
        const token = requireAdminToken();
        const res = await fetch(
          `${resolveApiBase()}/api/admin/transfer-owner?game_id=${encodeURIComponent(game)}`,
          { headers: { 'X-FGS-Token': token } },
        );
        const text = await res.text();
        if (!res.ok) {
          process.stderr.write(`fgs: transfers failed (${res.status}): ${text.trim()}\n`);
          process.exit(1);
        }
        process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
      }),
  );
