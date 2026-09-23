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

export interface AgentErrorRow {
  /** Stable prefix so operators can filter, e.g. "agent/deploy". */
  source: string;
  user?: string | null;
  context?: string | null;
  message: string;
  stack?: string | null;
}

export interface ErrorReportEnv {
  ADMIN?: Fetcher;
  INTERNAL_TOKEN?: string;
}

export async function reportPlatformError(env: ErrorReportEnv, domain: string, row: AgentErrorRow): Promise<void> {
  if (!env.ADMIN || !env.INTERNAL_TOKEN) return;
  if (!row.source || !row.message) return;
  try {
    const res = await env.ADMIN.fetch(`https://admin.${domain}/api/internal/error`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": env.INTERNAL_TOKEN },
      body: JSON.stringify({
        source: row.source,
        user: row.user ?? null,
        context: row.context ?? null,
        // Admin clamps these too; trimming here keeps the request small.
        message: row.message.slice(0, 2000),
        stack: row.stack ? row.stack.slice(0, 4000) : null,
      }),
    });
    if (!res.ok) {
      console.error(`[errlog] admin rejected error report (${res.status}) for ${row.source}`);
    }
  } catch (err) {
    console.error(`[errlog] could not report ${row.source} error: ${String(err)}`);
  }
}
