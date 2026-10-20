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
      .option('--json', 'print the response JSON')
      .action(
        async (
          game: string,
          opts: { from: string; to: string; reason: string; json?: boolean },
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
          };
          process.stdout.write(
            `✓ ${body.game_id} owner is now ${body.to_login} (was ${body.from_login})\n`,
          );
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
