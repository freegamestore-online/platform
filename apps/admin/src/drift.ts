/** Stale-deploy drift canary (#10 Part B).
 *
 *  The stale-serving symptom in the 2026-08-09 incident and the earlier
 *  climberadventure one is identical: the host keeps serving the last good R2
 *  artifact — often the raw template scaffold — while the game looks published.
 *  Nothing flagged "the repo has moved but R2 has not", so drift was only ever
 *  found by visiting the URL or waiting for a creator to complain.
 *
 *  The signal is a two-SHA comparison per game:
 *    - `main`'s HEAD commit
 *    - the head_sha of the last deploy.yml run that concluded SUCCESS
 *  If they differ, commits exist that have never been built to R2.
 *
 *  Distinct from the registry `status` field (#22), which answers "has this game
 *  EVER built". A game can be legitimately live and still be drifted: it shipped
 *  once, then three later pushes failed CI. #22 would call it live — correctly —
 *  and this canary is what notices the last three commits never reached users.
 *
 *  Read-only: two GitHub GETs per game, no D1 tables, no writes anywhere.
 */

export interface DriftRow {
  id: string;
  /** `main` HEAD, short form. */
  headSha: string | null;
  /** head_sha of the last successful deploy.yml run, short form. */
  lastSuccessSha: string | null;
}

/** Latest CONCLUDED deploy.yml outcome. `null` when nothing has concluded yet
 *  (queued/in-progress only, or no runs at all). */
export type DeployConclusion = "success" | "failure" | "timed_out" | "cancelled" | "other" | null;

export interface FleetRow {
  id: string;
  headSha: string | null;
  lastSuccessSha: string | null;
  conclusion: DeployConclusion;
  state: "drifted" | "current" | "neverBuilt" | "unknown";
}

export interface DriftReport {
  ts: string;
  /** Games whose SHAs were both readable and compared. */
  checked: number;
  /** HEAD differs from the last successful build — commits users never got. */
  drifted: DriftRow[];
  /** No successful deploy.yml run has EVER completed (overlaps #22's `pending`). */
  neverBuilt: string[];
  /** A SHA could not be read (repo gone, API error) — reported, never guessed. */
  unknown: string[];
}

interface DriftEnv {
  GITHUB_TOKEN?: string;
}

/** Run `work` over `items` with at most `limit` in flight. ~127 games × 2 calls
 *  would otherwise open 254 sockets at once and trip GitHub's abuse detection. */
async function mapPool<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await work(items[i]!);
    }
  });
  await Promise.all(runners);
  return out;
}

async function gh(env: DriftEnv, path: string): Promise<any | null> {
  try {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "freegamestore-admin",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const short = (sha: unknown) => (typeof sha === "string" && sha ? sha.slice(0, 7) : null);

const CONCLUSIONS = new Set(["success", "failure", "timed_out", "cancelled"]);

/** Inspect one game: HEAD vs last successful build, plus the latest concluded
 *  deploy outcome.
 *
 *  ONE window of recent runs answers both questions, so the fleet sweep stays at
 *  2 GitHub calls per game even though it now feeds two features (#10's canary
 *  and #14's deploy badge). Only when that window contains no success at all —
 *  a game failing repeatedly, or one whose last success is ancient — does it
 *  spend a third call to find the true last success. Without that fallback a
 *  long failure streak would be misreported as "never built". */
export async function checkGameDrift(env: DriftEnv, org: string, id: string): Promise<FleetRow> {
  const [ref, runs] = await Promise.all([
    gh(env, `/repos/${org}/${id}/git/ref/heads/main`),
    gh(env, `/repos/${org}/${id}/actions/workflows/deploy.yml/runs?per_page=10`),
  ]);

  const headSha = short(ref?.object?.sha);
  const list: any[] = Array.isArray(runs?.workflow_runs) ? runs.workflow_runs : [];
  const concluded = list.filter((r) => r?.status === "completed" && r?.conclusion);

  const raw = concluded[0]?.conclusion as string | undefined;
  const conclusion: DeployConclusion = raw ? (CONCLUSIONS.has(raw) ? (raw as DeployConclusion) : "other") : null;

  let lastSuccessSha = short(concluded.find((r) => r.conclusion === "success")?.head_sha);
  if (!lastSuccessSha && runs !== null) {
    const older = await gh(env, `/repos/${org}/${id}/actions/workflows/deploy.yml/runs?status=success&per_page=1`);
    lastSuccessSha = short(older?.workflow_runs?.[0]?.head_sha);
  }

  // A missing HEAD means the repo is unreadable — say so rather than inferring
  // drift from an API failure (the false-orphan trap reconcile already guards).
  if (!headSha) return { id, headSha, lastSuccessSha, conclusion, state: "unknown" };
  if (runs === null) return { id, headSha, lastSuccessSha, conclusion, state: "unknown" };
  if (!lastSuccessSha) return { id, headSha, lastSuccessSha, conclusion, state: "neverBuilt" };
  return { id, headSha, lastSuccessSha, conclusion, state: headSha === lastSuccessSha ? "current" : "drifted" };
}

/** One sweep of the whole fleet. Both /api/drift and /api/status/deploys are
 *  derived from this, and both share a single cache entry — a second independent
 *  fan-out would double an already expensive ~250-call sweep. */
export async function sweepFleet(env: DriftEnv, org: string, ids: string[]): Promise<FleetRow[]> {
  return mapPool(ids, 8, (id) => checkGameDrift(env, org, id));
}

/** Reduce a sweep to the canary report. */
export function driftReportFrom(rows: FleetRow[]): DriftReport {
  const drifted: DriftRow[] = [];
  const neverBuilt: string[] = [];
  const unknown: string[] = [];
  let checked = 0;
  for (const r of rows) {
    if (r.state === "unknown") { unknown.push(r.id); continue; }
    if (r.state === "neverBuilt") { neverBuilt.push(r.id); continue; }
    checked++;
    if (r.state === "drifted") drifted.push({ id: r.id, headSha: r.headSha, lastSuccessSha: r.lastSuccessSha });
  }
  return {
    ts: new Date().toISOString(),
    checked,
    drifted: drifted.sort((a, b) => a.id.localeCompare(b.id)),
    neverBuilt: neverBuilt.sort(),
    unknown: unknown.sort(),
  };
}

/** Build the full canary report for the given game ids. */
export async function findDrift(env: DriftEnv, org: string, ids: string[]): Promise<DriftReport> {
  return driftReportFrom(await sweepFleet(env, org, ids));
}

export interface RunRow {
  conclusion: string;
  sha: string | null;
  message: string;
  updatedAt: string | null;
  url: string | null;
}

/** The last N deploy.yml runs for one game, shaped for the Game Detail page.
 *  Separate from the fleet sweep on purpose: this is a single-game view, so it
 *  can afford the richer per-run detail the sweep deliberately skips. */
export async function recentRuns(env: DriftEnv, org: string, id: string, n = 5): Promise<RunRow[]> {
  const runs = await gh(env, `/repos/${org}/${id}/actions/workflows/deploy.yml/runs?per_page=${n}`);
  const list: any[] = Array.isArray(runs?.workflow_runs) ? runs.workflow_runs : [];
  return list.slice(0, n).map((r) => ({
    // An in-flight run has no conclusion yet — report its status instead of an
    // empty badge.
    conclusion: (r?.status === "completed" ? r?.conclusion : r?.status) || "unknown",
    sha: short(r?.head_sha),
    message: typeof r?.head_commit?.message === "string" ? r.head_commit.message.split("\n")[0]!.slice(0, 120) : "",
    updatedAt: typeof r?.updated_at === "string" ? r.updated_at : null,
    url: typeof r?.html_url === "string" ? r.html_url : null,
  }));
}
