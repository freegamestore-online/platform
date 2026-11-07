/** Execute infra tools server-side. Extracted from session.ts to keep it manageable. */

import { checkBuildSanity, formatSanityBlock } from "./build-sanity";
import type { StoreConfig } from "./config";
import type { DeployEnv, DeployStatus } from "./deploy";
import { ACTIONS_DEPLOY_CEILING_MS, deployApp, pushCommit, substituteAppName, waitForActionsDeploy } from "./deploy";
import { checkDeployStatus, getAuditResults, getBuildLogs, getCIResults, listDeployed } from "./infra";
import type { ToolCall } from "./providers/types";
import { readRegistry, validateGameId } from "./registry";

interface ExecContext {
  appId: string | null;
  files: Map<string, string>;
  /** Paths deleted this session and not yet pushed (#86). */
  deletedFiles?: Set<string>;
  env: DeployEnv;
  config: StoreConfig;
  /** GitHub login of the signed-in creator; added as a repo collaborator on deploy. */
  creatorLogin?: string;
  /** The template snapshot the session was seeded from — the delta baseline for
   *  Path B deploys (only the files the agent changed vs. this are pushed). */
  seed?: Record<string, string>;
  /** Public engine key the session was seeded from — forwarded to admin so the
   *  generated repo's template (and its lockfile) match the session's code. */
  engine?: string;
  onDeployStatus: (status: DeployStatus) => void;
  /** Bind the session to an app id BEFORE the build runs. This is the
   *  AUTHORIZATION write: push_update / get_build_logs / check_deploy_status all
   *  gate on ctx.appId, so they must work during the same deploy turn — and on a
   *  failed build, so the agent can self-fix. It says "this session owns this id",
   *  NOT "this app shipped". */
  onAppBound: (id: string, name: string) => void;
  /** Mark the app actually DEPLOYED. Fires only after CI confirms the build
   *  succeeded (finalStatus.phase === "live"). Anything that reports shipped
   *  state to a creator or operator must hang off this, never off onAppBound —
   *  the two were one callback, so a red build still read as deployed (#9). */
  onAppDeployed: (id: string, name: string) => void;
}

/** Execute a single infra tool. Returns the result string. */
/** Infra tools that operate on a specific item and therefore REQUIRE a valid
 *  string id. A tool call with a missing/blank id used to slip past validation
 *  (`if (tc.input.id)` was falsy) and write the literal string "undefined" into
 *  the repo path / package.json. Reject it up front. */
const ID_REQUIRED = new Set(["deploy", "push_update", "check_deploy_status", "get_build_logs", "get_ci_results", "get_audit_results"]);

export async function executeInfraTool(tc: ToolCall, ctx: ExecContext): Promise<string> {
  const { config } = ctx;

  // Reject a missing/invalid id BEFORE any id-dependent logic, so no tool ever
  // interpolates `undefined` into a repo name, path, or package.json.
  if (ID_REQUIRED.has(tc.name)) {
    const rawId = tc.input.id;
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return `Error: ${tc.name} requires a valid ${config.noun} id.`;
    }
  }

  // Authorization: scope write tools to the session's own item
  const targetId = tc.input.id as string | undefined;
  if (targetId && ["push_update", "get_build_logs", "get_ci_results", "check_deploy_status"].includes(tc.name)) {
    if (!ctx.appId) return `Error: no ${config.noun} deployed yet. Deploy first before using ${tc.name}.`;
    if (targetId !== ctx.appId)
      return `Error: you can only ${tc.name} on your own ${config.noun} "${ctx.appId}". No access to "${targetId}".`;
  }

  // Validate deploy ID (id presence already enforced above for deploy).
  if (tc.name === "deploy") {
    const id = tc.input.id as string;
    if (!validateGameId(id)) {
      return `Error: invalid ${config.noun} ID "${id}". Must be lowercase, numbers, hyphens. No "free"/"pro" prefix. Max 58 chars.`;
    }
    if (ctx.appId && ctx.appId !== id) {
      return `Error: this session already deployed "${ctx.appId}". Create a new project for a different ${config.noun}.`;
    }
  }

  // Build-sanity gate: before ANY ship (deploy or update), statically verify the
  // compiled source can build. A broken generation (duplicate top-level block,
  // truncated file, unbalanced braces) otherwise fails CI silently and keeps the
  // old version live. Blocking here turns that into an in-session self-correction.
  if (tc.name === "deploy" || tc.name === "push_update") {
    const findings = checkBuildSanity(ctx.files);
    if (findings.length) {
      ctx.onDeployStatus({ phase: "error", error: `Build check failed: ${findings.map((f) => f.file).join(", ")}` });
      return formatSanityBlock(findings, config.noun);
    }
  }

  switch (tc.name) {
    case "deploy":
      return executeDeploy(tc, ctx);
    case "push_update":
      return executePushUpdate(tc, ctx);
    case "check_deploy_status":
      return checkDeployStatus(targetId!, ctx.env, config);
    case "list_deployed_apps":
    case "list_deployed_games":
      return listDeployed(ctx.env, config);
    case "fetch_url":
      return executeFetchUrl(tc, config);
    case "get_build_logs":
      return getBuildLogs(targetId!, ctx.env, config);
    case "get_ci_results":
      return getCIResults(targetId!, ctx.env, config);
    case "get_audit_results":
      return getAuditResults(targetId!, config);
    default:
      return `Unknown infra tool: ${tc.name}`;
  }
}

/** An id compared ignoring case, hyphens and trailing digits (royal-heist ~ royalheist ~ royal-heist2). */
function looseId(id: string): string {
  return id.toLowerCase().replace(/-/g, "").replace(/\d+$/, "");
}

/** The creator's own existing game that a new deploy would duplicate: same
 *  display name (case-insensitive) or same id by `looseId` (#526). The agent used to
 *  answer "id taken" by inventing a near-duplicate id for the same game. Null when
 *  nothing matches or the registry cannot be read (admin still guards the exact id). */
async function findOwnDuplicate(
  ctx: ExecContext,
  appId: string,
  appName: string,
): Promise<{ id: string; name?: string } | null> {
  const login = ctx.creatorLogin?.toLowerCase();
  if (!login) return null;
  const registry = await readRegistry(ctx.config, ctx.env.GITHUB_TOKEN);
  if (registry.status !== "available") return null;
  const name = appName?.trim().toLowerCase();
  return (
    registry.games.find(
      (g) =>
        g.id !== appId &&
        g.creatorGithub?.toLowerCase() === login &&
        (looseId(g.id) === looseId(appId) || (!!name && g.name?.trim().toLowerCase() === name)),
    ) ?? null
  );
}

async function executeDeploy(tc: ToolCall, ctx: ExecContext): Promise<string> {
  const appId = tc.input.id as string;
  const appName = tc.input.name as string;

  // Uniqueness / deleted-game check. A repo that exists but is ARCHIVED was
  // deleted via delete_game — writes to it 404 ("failed to create blob"),
  // which read as a mystery infra failure (escape, 2026-07-11). Name it.
  const repoRes = await fetch(`https://api.github.com/repos/${ctx.config.org}/${appId}`, {
    headers: {
      Authorization: `Bearer ${ctx.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": ctx.config.agentName,
    },
  });
  if (repoRes.status === 200) {
    const repo = (await repoRes.json()) as { archived?: boolean };
    if (repo.archived) {
      return `Error: the ${ctx.config.noun} "${appId}" was DELETED (its repo is archived), so it can't be redeployed. Start a new ${ctx.config.noun} with a different ID instead.`;
    }
    if (!ctx.appId) {
      return `Error: ${ctx.config.noun} ID "${appId}" is already taken, and this session is not opened on it — deploying would overwrite that ${ctx.config.noun} blind. If it's the user's own ${ctx.config.noun}, tell them to open it first (opening loads the real repo files into this session). Otherwise ask the user what they want to call this ${ctx.config.noun}; do NOT pick another ID yourself, and do NOT retry deploy or push_update.`;
    }
  } else if (repoRes.status === 404 && !ctx.appId) {
    const dup = await findOwnDuplicate(ctx, appId, appName);
    if (dup) {
      return `Error: the user already has a ${ctx.config.noun} "${dup.id}"${dup.name ? ` ("${dup.name}")` : ""} that this would duplicate. Nothing was deployed. Tell the user to open "${dup.id}" and update it there, or ask them whether they really want a separate ${ctx.config.noun}. Do NOT invent a different ID to get around this.`;
    }
  } else if (repoRes.status !== 404) {
    // Only an explicit 404 means "free". A 401/403/5xx says nothing about who
    // owns the id, so treating it as free could provision over — and bind to —
    // another creator's game (#88).
    return `Error: couldn't confirm whether the ${ctx.config.noun} ID "${appId}" is free (GitHub returned HTTP ${repoRes.status}). Nothing was deployed — retry deploy in a moment.`;
  }

  // Replace APPNAME placeholders (slug in package manifests, display name
  // elsewhere). For Path B the delta computation re-derives the same baseline,
  // so this must stay the single canonical substitution — hence the shared fn.
  substituteAppName(ctx.files, appId, appName);

  // Bind the id only once admin confirms it is this creator's (deployApp calls
  // back after provisioning) — binding up front let a lost race or an id owned
  // by someone else authorize push_update against their game (#88). Still before
  // the build: marking "deployed" here is what let a red CI run read as a
  // shipped game (#9).
  const bind = () => ctx.onAppBound(appId, appName);

  let deployError: string | null = null;
  let finalStatus: DeployStatus | null = null;
  await deployApp(
    {
      id: appId,
      name: appName,
      category: tc.input.category as string,
      icon: tc.input.icon as string,
      iconBg: tc.input.iconBg as string,
      description: tc.input.description as string,
      template: ctx.engine,
      deletedFiles: ctx.deletedFiles,
    },
    ctx.files,
    ctx.env,
    ctx.config,
    (status) => {
      ctx.onDeployStatus(status);
      // Track the LAST status, not just "live". deployApp/deployPathB report a
      // terminal build failure (CI red, compliance reject, R2 sync error) via
      // onStatus({phase:"error"}) and then RETURN NORMALLY — they don't throw. So
      // keying success on "did it throw" reported "Deploy succeeded" for a failed
      // build, and the agent told the user the game was live while it was broken
      // (the silent-failure loop). The tool result must agree with deployStatus.
      finalStatus = status;
    },
    ctx.creatorLogin,
    ctx.seed,
    bind,
  ).catch((err) => {
    deployError = String(err);
  });

  if (deployError) {
    ctx.onDeployStatus({ phase: "error", error: deployError });
    return `Deploy FAILED: ${deployError}`;
  }
  // TS narrows finalStatus to never inside the closure; read via a widened local.
  const last = finalStatus as DeployStatus | null;
  if (last?.phase === "error")
    return `Deploy FAILED: ${last.error || "the build did not complete"}. Use get_build_logs to see why, fix the code, then push_update.`;
  if (last?.phase === "live") {
    // CI confirmed the build. Only now is the app genuinely deployed.
    ctx.onAppDeployed(appId, appName);
    return `Deploy succeeded. Live: ${last.appUrl}`;
  }
  // Ceiling reached with the run STILL IN PROGRESS: not deployed, and — crucially
  // — not failed either. The waiter now only returns `building` when it actually
  // observed a queued/in-progress run, so this string can no longer be the calm
  // lie it was when a slow-but-failing build timed out at 180s and ended the turn
  // (#7). A run that concluded in failure took the error branch above.
  return `Deploy pushed — the CI run was STILL IN PROGRESS after ${ACTIONS_DEPLOY_CEILING_MS / 60_000} minutes; it has not failed, it just hasn't finished. Poll check_deploy_status for the verdict; if it ends in failure, use get_build_logs and push_update a fix.`;
}

async function executePushUpdate(tc: ToolCall, ctx: ExecContext): Promise<string> {
  const id = tc.input.id as string;
  ctx.onDeployStatus({ phase: "pushing", progress: "Pushing update..." });
  const pushed = await pushCommit(id, ctx.files, (tc.input.message as string) || "Update", ctx.env, ctx.config, ctx.deletedFiles);
  const result = pushed.message;
  if (pushed.sha) ctx.deletedFiles?.clear(); // applied to the repo
  if (!pushed.sha) {
    ctx.onDeployStatus({ phase: "error", error: result });
    return result;
  }

  // Wait for the Actions build to finish and resolve to live/error — exactly
  // like the FIRST deploy does (deployPathB → waitForActionsDeploy). Without
  // this, push_update set phase:"building" and returned immediately, so the
  // studio sat on "Building/Deploying…" FOREVER even though CI completed — the
  // "deploy gets stuck for everyone and never finishes" report. Every edit after
  // the first deploy hit this. The poll persists live (or a real error with a
  // logs link) so the user always sees the true outcome.
  const appUrl = `https://${id}.${ctx.config.domain}`;
  ctx.onDeployStatus({ phase: "building", deployUrl: appUrl });
  let outcome: string | null = null;
  await waitForActionsDeploy(
    id,
    ctx.env,
    ctx.config,
    (s) => {
      ctx.onDeployStatus(s);
      if (s.phase === "live") outcome = `Update deployed and LIVE at ${s.appUrl}.`;
      else if (s.phase === "error") outcome = `Update pushed but the build FAILED: ${s.error}`;
    },
    appUrl,
    pushed.sha,
  ).catch((err) => {
    outcome = `Update pushed; couldn't confirm the build status: ${String(err)}. Use check_deploy_status.`;
  });
  // Same rule as executeDeploy: reaching here means the waiter saw a run still in
  // progress at the ceiling, never a concluded failure.
  return (
    outcome ||
    `${result} The CI run was STILL IN PROGRESS after ${ACTIONS_DEPLOY_CEILING_MS / 60_000} minutes — not failed, just unfinished. Use check_deploy_status for the final result.`
  );
}

// -- fetch_url SSRF guard (#461) --
//
// The old check was a substring regex over the raw URL string, so
// `https://2130706433/` (decimal 127.0.0.1), `https://0x7f000001/`, `https://[::1]/`
// and `https://[::ffff:127.0.0.1]/` all passed while `https://example.com/10.5/`
// was refused. Parse with the WHATWG URL parser — it canonicalises every IPv4
// spelling (decimal, hex, octal, shortened) to dotted-quad and brackets IPv6 —
// then classify the canonical host. Workers can't resolve DNS ahead of fetch,
// so literal IPs are the achievable bar; a few internal name suffixes are
// refused by name.

const BLOCKED_NAME_SUFFIXES = [".localhost", ".internal", ".local", ".home.arpa"];

function parseIpv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

/** Non-public IPv4: loopback, private, link-local, CGNAT, unspecified,
 *  benchmarking, multicast, reserved/broadcast, IETF protocol assignments. */
function isNonPublicIpv4([a, b]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** Expand an IPv6 literal (no brackets) into 8 hextets; null if malformed.
 *  Accepts a trailing dotted IPv4 (`::ffff:127.0.0.1`). */
function parseIpv6(raw: string): number[] | null {
  let s = raw.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  // Trailing dotted IPv4 → two hextets.
  const v4 = /(?:^|:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (v4) {
    const o = parseIpv4(v4[1]);
    if (!o) return null;
    s = `${s.slice(0, s.length - v4[1].length)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toHextets = (part: string) => (part === "" ? [] : part.split(":"));
  const head = toHextets(halves[0]);
  const tail = halves.length === 2 ? toHextets(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const parts = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const out: number[] = [];
  for (const p of parts) {
    if (!/^[0-9a-f]{1,4}$/.test(p)) return null;
    out.push(Number.parseInt(p, 16));
  }
  return out;
}

function isNonPublicIpv6(h: number[]): boolean {
  const embeddedV4 = (i: number) => [h[i] >> 8, h[i] & 0xff, h[i + 1] >> 8, h[i + 1] & 0xff];
  if (h.every((x) => x === 0)) return true; // ::
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return true; // ::1
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) return isNonPublicIpv4(embeddedV4(6)); // ::ffff:a.b.c.d
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) return isNonPublicIpv4(embeddedV4(6)); // NAT64
  if (h[0] === 0x2002) return isNonPublicIpv4(embeddedV4(1)); // 6to4
  if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((h[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/** Why fetch_url must not fetch `raw`, or null if it may. Exported for tests. */
export function fetchUrlError(raw: unknown): string | null {
  if (typeof raw !== "string" || raw === "") return "url is required";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "not a valid URL";
  }
  if (url.protocol !== "https:") return "only https:// is allowed";
  if (url.username || url.password) return "credentials in the URL are not allowed";
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "" || host === "localhost" || BLOCKED_NAME_SUFFIXES.some((s) => host.endsWith(s))) {
    return "internal hostnames are not allowed";
  }
  if (host.startsWith("[")) {
    const v6 = parseIpv6(host.slice(1, -1));
    if (!v6 || isNonPublicIpv6(v6)) return "non-public IPv6 addresses are not allowed";
    return null;
  }
  const v4 = parseIpv4(host);
  if (v4 && isNonPublicIpv4(v4)) return "non-public IPv4 addresses are not allowed";
  // A host that still ends in a number but isn't a dotted quad never gets here:
  // the URL parser already rejected it (e.g. `https://1.2.3.999/`).
  return null;
}

// -- fetch_url: resolved addresses, redirects, method (#451) --
//
// fetchUrlError only sees the spelling of the URL. A public-looking NAME can
// still resolve to a private address, and a public URL can redirect to one, so:
//  - every DNS name is resolved (DNS-over-HTTPS: a Worker has no resolver of its
//    own) and refused if ANY A/AAAA answer is non-public; failing to verify is
//    a refusal, not a pass;
//  - redirects are followed by hand, at most MAX_REDIRECTS hops, and each hop
//    goes through the same checks;
//  - only GET and HEAD, whatever the model asks for.
// The fetch itself still resolves again, so a rebinding name can differ between
// the check and the connect; Workers cannot connect to private ranges at all,
// which is what bounds that gap.

const MAX_REDIRECTS = 3;
const DOH_URL = "https://cloudflare-dns.com/dns-query";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

interface DohAnswer {
  type: number;
  data: string;
}

async function dohAnswers(host: string, type: "A" | "AAAA"): Promise<DohAnswer[] | null> {
  try {
    const res = await fetch(`${DOH_URL}?name=${encodeURIComponent(host)}&type=${type}`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { Status?: number; Answer?: DohAnswer[] };
    if (body.Status !== 0 && body.Status !== 3) return null; // NOERROR / NXDOMAIN only
    return body.Answer ?? [];
  } catch {
    return null;
  }
}

/** Why `host` must not be fetched because of what it resolves to, or null. A
 *  literal address was already judged by fetchUrlError, so it is not resolved. */
export async function resolvedAddressError(host: string): Promise<string | null> {
  if (host.startsWith("[") || parseIpv4(host)) return null;
  const [a, aaaa] = await Promise.all([dohAnswers(host, "A"), dohAnswers(host, "AAAA")]);
  if (!a || !aaaa) return "could not verify that the hostname resolves to a public address";
  for (const answer of [...a, ...aaaa]) {
    if (answer.type === 1) {
      const v4 = parseIpv4(answer.data);
      if (!v4 || isNonPublicIpv4(v4)) return "the hostname resolves to a non-public address";
    } else if (answer.type === 28) {
      const v6 = parseIpv6(answer.data);
      if (!v6 || isNonPublicIpv6(v6)) return "the hostname resolves to a non-public address";
    }
  }
  return null;
}

async function executeFetchUrl(tc: ToolCall, config: StoreConfig): Promise<string> {
  const method = String(tc.input.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return "Error: fetch_url only supports the GET and HEAD methods.";
  let next: string = tc.input.url as string;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const bad = fetchUrlError(next) ?? (await resolvedAddressError(new URL(next).hostname.toLowerCase().replace(/\.$/, "")));
    if (bad) {
      return hop === 0
        ? `Error: can only fetch public HTTPS URLs (${bad}).`
        : `Error: a redirect led somewhere that can't be fetched (${bad}).`;
    }
    try {
      const res = await fetch(next, { method, redirect: "manual", headers: { "User-Agent": config.agentName } });
      const location = res.headers.get("location");
      if (REDIRECT_STATUSES.has(res.status) && location) {
        try {
          next = new URL(location, next).href;
        } catch {
          return "Error: the server sent an invalid redirect.";
        }
        continue;
      }
      return `${res.status} ${res.statusText}\n${(await res.text()).slice(0, 2000)}`;
    } catch (err) {
      return `Fetch error: ${err}`;
    }
  }
  return `Error: too many redirects (more than ${MAX_REDIRECTS}).`;
}
