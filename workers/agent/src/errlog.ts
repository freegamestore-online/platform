/** Report an agent-side failure into the shared platform `error_log` that the
 *  admin console's Errors view, Operations panel and Overview counts read (#21).
 *
 *  WHY THIS IS A SERVICE CALL AND NOT AN INSERT
 *  --------------------------------------------
 *  The agent cannot write the row itself. The two workers' `DB` bindings look
 *  identical by name but are DIFFERENT databases:
 *
 *    workers/agent/wrangler.toml  DB = leaderboard   (165c4cb7-d93e-4afc-…)
 *    apps/admin/wrangler.toml     DB = freegamestore (a122751e-11a2-466e-…)
 *
 *  `error_log` lives in admin's database. A direct INSERT from the agent would
 *  create an empty `error_log` table inside the leaderboard database, write every
 *  row there, and never fail — producing exactly the invisibility this issue
 *  exists to fix, but harder to notice because the writes appear to succeed.
 *  So the row goes over the existing ADMIN service binding instead.
 *
 *  Best-effort by contract: recording a failure must never turn into a second
 *  failure. Every path swallows and logs. The DO's own in-session `errors[]`
 *  array and Workers Logs remain the authoritative per-session record; this is
 *  the durable, centrally-discoverable copy. */
import { type ErrLogRow, normalizeErrorLogRow } from "../../../contracts/error-log/v1/contract";

export type AgentErrorRow = ErrLogRow;

export interface ErrorReportEnv {
  ADMIN?: Fetcher;
  INTERNAL_TOKEN?: string;
}

export async function reportPlatformError(env: ErrorReportEnv, domain: string, row: AgentErrorRow): Promise<void> {
  if (!env.ADMIN || !env.INTERNAL_TOKEN) return;
  const normalized = normalizeErrorLogRow(row);
  if (!normalized) return;
  try {
    const res = await env.ADMIN.fetch(`https://admin.${domain}/api/internal/error`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": env.INTERNAL_TOKEN },
      body: JSON.stringify({
        ...normalized,
      }),
    });
    if (!res.ok) {
      console.error(`[errlog] admin rejected error report (${res.status}) for ${normalized.source}`);
    }
  } catch (err) {
    console.error(`[errlog] could not report ${normalized.source} error: ${String(err)}`);
  }
}
