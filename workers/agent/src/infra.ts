/** Infra query tools — read-only operations against GitHub, CF, and audit APIs. */

import type { StoreConfig } from "./config";
import { type DeployEnv, filterLogErrorLines } from "./deploy";
import { makeGhApi, resilientFetch } from "./ghfetch";
import { readRegistry } from "./registry";

/** Helper: fetch job details and error lines from a failed run.
 *  Returns detail (job › step) and errorLines for automatic injection into deploy status. */
export async function getFailedRunDetails(
  org: string,
  repoId: string,
  runId: number | string,
  env: DeployEnv,
  config: StoreConfig,
): Promise<{ detail: string; errorLines: string[] }> {
  const ghApi = makeGhApi(env.GITHUB_TOKEN, config.agentName);
  let detail = "";
  let failingJobId: number | null = null;
  try {
    const jobs = await ghApi(`/repos/${org}/${repoId}/actions/runs/${runId}/jobs`);
    const failedJob = (jobs.jobs || []).find((j: any) => j.conclusion === "failure");
    const failedStep = failedJob?.steps?.find((s: any) => s.conclusion === "failure");
    detail = failedJob ? `${failedJob.name}${failedStep ? " › " + failedStep.name : ""}` : "";
    failingJobId = failedJob?.id ?? null;
  } catch (err) {
    console.error(`[infra] Actions job detail fetch failed for ${org}/${repoId}: ${String(err)}`);
    return { detail, errorLines: [] };
  }
  if (failingJobId === null) return { detail, errorLines: [] };
  try {
    const logRes = await resilientFetch(
      `https://api.github.com/repos/${org}/${repoId}/actions/jobs/${failingJobId}/logs`,
      {
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "User-Agent": config.agentName,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );
    if (!logRes.ok) return { detail, errorLines: [] };
    return { detail, errorLines: filterLogErrorLines(await logRes.text()) };
  } catch (err) {
    console.error(`[infra] Actions job log fetch failed for ${org}/${repoId}: ${String(err)}`);
    return { detail, errorLines: [] };
  }
}

/** Check the latest deployment status via GitHub Actions. */
export async function checkDeployStatus(appId: string, env: DeployEnv, config: StoreConfig): Promise<string> {
  const ghApi = makeGhApi(env.GITHUB_TOKEN, config.agentName);
  const runs = await ghApi(`/repos/${config.org}/${appId}/actions/workflows/deploy.yml/runs?per_page=1`);
  const run = runs.workflow_runs?.[0];
  if (!run) return `No deploy runs found for ${config.org}/${appId}. The ${config.noun} may not be provisioned yet.`;
  const state = run.status === "completed" ? run.conclusion : run.status;
  return `Latest deploy (${run.name || "Deploy to R2"}): ${state}\nURL: https://${appId}.${config.domain}\nCommit: ${run.head_sha?.slice(0, 7) || "?"}\nRun: ${run.html_url}`;
}

/** List all items from the store registry. */
export async function listDeployed(env: DeployEnv, config: StoreConfig): Promise<string> {
  const registry = await readRegistry(config, env.GITHUB_TOKEN);
  if (registry.status !== "available")
    return registry.status === "missing" ? "Registry is missing." : "Registry is temporarily unavailable.";
  const items = registry.games;
  if (items.length === 0) return `No ${config.nounPlural} deployed yet.`;
  return items.map((a: any) => `${a.id} — ${a.name} (${a.category}) ${a.appUrl}`).join("\n");
}

/** Fetch a URL and return the response. */
export async function fetchUrl(url: string, method: string, agentName: string): Promise<string> {
  try {
    const res = await fetch(url, { method, headers: { "User-Agent": agentName } });
    const body = await res.text();
    return `${res.status} ${res.statusText}\n${body.slice(0, 2000)}`;
  } catch (err) {
    return `Fetch error: ${err}`;
  }
}

/** Get build logs for the latest deployment via GitHub Actions. */
export async function getBuildLogs(appId: string, env: DeployEnv, config: StoreConfig): Promise<string> {
  const ghApi = makeGhApi(env.GITHUB_TOKEN, config.agentName);
  const runs = await ghApi(`/repos/${config.org}/${appId}/actions/workflows/deploy.yml/runs?per_page=1`);
  const run = runs.workflow_runs?.[0];
  if (!run) return `No deploy runs found for ${config.org}/${appId}.`;
  const jobs = await ghApi(`/repos/${config.org}/${appId}/actions/runs/${run.id}/jobs`);
  const lines: string[] = [];
  for (const j of jobs.jobs || []) {
    lines.push(`Job "${j.name}": ${j.status === "completed" ? j.conclusion : j.status}`);
    for (const s of j.steps || []) {
      const st = s.status === "completed" ? s.conclusion : s.status;
      lines.push(`  ${st === "success" ? "PASS" : st === "failure" ? "FAIL" : String(st || "").toUpperCase()}: ${s.name}`);
    }
  }

  // The step list alone is useless for FIXING a failure — pull the failing
  // job's raw log and extract the error lines, so the model can act on
  // "Could not resolve X from Y" instead of being told to visit a URL it
  // can't open. Use the shared helper so get_build_logs and auto-injected
  // error lines never disagree about what counts as an error line.
  const { errorLines } = await getFailedRunDetails(config.org, appId, run.id, env, config);
  if (errorLines.length > 0) {
    lines.push("", "── error lines from the failing job ──", ...errorLines);
  }
  return `Deploy run ${String(run.id).slice(0, 8)} — ${run.status === "completed" ? run.conclusion : run.status}\n${lines.join("\n").slice(0, 6000)}`;
}

/** Get GitHub Actions CI check results for a repo. */
export async function getCIResults(appId: string, env: DeployEnv, config: StoreConfig): Promise<string> {
  const ghApi = makeGhApi(env.GITHUB_TOKEN, config.agentName);
  const repo = `${config.org}/${appId}`;
  const runs = await ghApi(`/repos/${repo}/commits/main/check-runs`);
  if (!runs.check_runs?.length) return `No CI check runs found for ${repo}. CI may not have run yet.`;

  const results = runs.check_runs.map((r: any) => {
    const status = r.status === "completed" ? r.conclusion : r.status;
    let detail = "";
    if (r.output?.summary) detail = r.output.summary.slice(0, 200);
    else if (r.output?.text) detail = r.output.text.slice(0, 200);
    return `${status === "success" ? "PASS" : status === "failure" ? "FAIL" : status.toUpperCase()}: ${r.name}${detail ? ` — ${detail}` : ""}`;
  });

  return `CI results for ${repo} (${runs.check_runs.length} checks):\n${results.join("\n")}`;
}

/** Get quality audit results from the store's audit API. */
export async function getAuditResults(appId: string, config: StoreConfig): Promise<string> {
  try {
    const res = await fetch(`https://api.${config.domain}/v1/audit?${config.auditParam}=${appId}`, {
      headers: { "User-Agent": config.agentName },
    });
    if (!res.ok) return `Audit API returned ${res.status}. The ${config.noun} may not have been audited yet.`;
    const data = (await res.json()) as any;

    if (data.summary) {
      const s = data.summary;
      const lines = [`Audit for ${appId}: ${s.pass} pass, ${s.warn} warn, ${s.fail} fail`];
      if (data.checks) {
        for (const c of data.checks) {
          const icon = c.status === "pass" ? "PASS" : c.status === "warn" ? "WARN" : "FAIL";
          lines.push(`  ${icon}: ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
        }
      }
      return lines.join("\n");
    }

    return JSON.stringify(data, null, 2).slice(0, 2000);
  } catch (err) {
    return `Could not reach audit API: ${err}`;
  }
}
