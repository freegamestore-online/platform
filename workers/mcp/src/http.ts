// Outbound HTTP for the FGS MCP.
//
// Extracted from index.ts so it can be unit-tested: index.ts imports
// `cloudflare:workers` and `agents/mcp`, neither of which loads under
// `node --test`. Everything here is a free function over globals (fetch,
// AbortController, Response), so the suite can drive it with a fake fetch.
//
// The contract every export upholds: NOTHING THROWS. Failures come back as
// `{ error }`. An exception escaping one of these reaches a tool handler, then
// the MCP SDK, which has nothing to serialize and renders the opaque
// "Tool error: MCP tool call failed" (#29) — the symptom this module exists to
// prevent.

// Wrap a fetch in an AbortController-backed timeout so a slow/edge-stalled
// upstream (admin/agent/leaderboard/GitHub) can't hang the MCP request all the
// way to the Worker wall-clock limit. fetchFn receives the abort signal.
export async function withTimeout<T>(
  fetchFn: (signal: AbortSignal) => Promise<T>,
  ms = 10_000,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetchFn(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

// -- #29: no upstream failure may escape as a thrown exception --
//
// An exception escaping a tool handler reaches the MCP SDK with nothing to
// serialize, and the user sees the opaque "Tool error: MCP tool call failed"
// with no indication of which hop broke. Every outbound call therefore funnels
// through these two, which convert the throw into a readable { error }.
//
// The throws are real, not theoretical: fetch rejects with a TypeError on
// DNS/TLS failure or a connection reset on the worker-to-worker hop, and with
// an AbortError once withTimeout's 10s deadline fires. A body read rejects
// separately, on a truncated or reset response.
export const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Never throws. `label` names the hop so the message says which one failed. */
export async function safeFetch(
  label: string,
  fetchFn: (signal: AbortSignal) => Promise<Response>,
): Promise<{ res: Response } | { error: string }> {
  try {
    return { res: await withTimeout(fetchFn) };
  } catch (err: unknown) {
    return { error: `Request failed for ${label}: ${errMsg(err)}` };
  }
}

/** Never throws. A failed read is distinguishable from a legitimately empty
 *  body, which matters: empty means "no data", unreadable means "broken". */
export async function readBody(res: Response): Promise<{ text: string } | { error: string }> {
  try {
    return { text: await res.text() };
  } catch (err: unknown) {
    return { error: errMsg(err) };
  }
}

// GitHub Actions API (public repos, no auth needed)
export async function getDeployStatus(org: string, gameId: string) {
  const r = await safeFetch('the GitHub Actions API', (signal) =>
    fetch(`https://api.github.com/repos/${org}/${gameId}/actions/runs?per_page=5`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'freegamestore-mcp' },
      signal,
    }),
  );
  if ('error' in r) return r;
  const res = r.res;
  if (!res.ok) return { error: `GitHub API ${res.status}` };
  let data: {
    workflow_runs?: Array<{
      name: string;
      conclusion: string | null;
      status: string;
      updated_at: string;
      html_url: string;
      head_sha: string;
    }>;
  };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    return { error: 'GitHub API returned invalid JSON' };
  }
  return (data.workflow_runs ?? []).map((r) => ({
    name: r.name,
    status: r.conclusion ?? r.status,
    updatedAt: r.updated_at,
    url: r.html_url,
    sha: r.head_sha?.slice(0, 7),
  }));
}

// FGS admin API
// Every failure is returned as { error } rather than thrown: an escaping
// exception reaches the MCP SDK with nothing to serialize and surfaces as the
// opaque "Tool error: MCP tool call failed" (#29). The fetch can throw a
// TypeError (DNS/TLS/reset on the worker-to-worker hop) or an AbortError once
// withTimeout fires, and a body read can reject on a truncated response.
export async function fgsApi(apiBase: string, path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await safeFetch(path, (signal) => fetch(`${apiBase}${path}`, { headers, signal }));
  if ('error' in r) return r;
  const res = r.res;
  if (!res.ok) {
    // Best-effort: an unreadable body must not mask the status we already have.
    const b = await readBody(res);
    return { error: `API ${res.status}: ${'text' in b ? b.text : ''}` };
  }
  // Handle 204 No Content (e.g. /api/quality when no audit data exists)
  if (res.status === 204) return null;
  const body = await readBody(res);
  if ('error' in body) return { error: `Failed to read response body from ${path}: ${body.error}` };
  const text = body.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: `Invalid JSON from ${path}: ${text.slice(0, 200)}` };
  }
}

// POST to the FGS admin
export async function fgsPost(apiBase: string, path: string, token: string, body: unknown) {
  // X-FGS-Token survives worker-to-worker (Cloudflare strips Authorization on those hops).
  const r = await safeFetch(path, (signal) =>
    fetch(`${apiBase}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-FGS-Token': token,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal,
    }),
  );
  if ('error' in r) return r;
  const res = r.res;
  const b = await readBody(res);
  if ('error' in b) return { error: `Failed to read response body from ${path}: ${b.error}` };
  const text = b.text;
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok)
    return {
      error: json.error ?? `API ${res.status}`,
      detail: json.detail ?? json.body ?? text,
      status: res.status,
    };
  return json;
}

// DELETE against an FGS worker (admin or agent). Same header trio as fgsPost —
// X-FGS-Token survives worker-to-worker hops (CF strips Authorization there),
// Authorization covers the direct path. Ownership is enforced server-side.
export async function fgsDelete(base: string, path: string, token: string) {
  const r = await safeFetch(path, (signal) =>
    fetch(`${base}${path}`, {
      method: 'DELETE',
      headers: { 'X-FGS-Token': token, Authorization: `Bearer ${token}` },
      signal,
    }),
  );
  if ('error' in r) return r;
  const res = r.res;
  const b = await readBody(res);
  if ('error' in b) return { error: `Failed to read response body from ${path}: ${b.error}` };
  const text = b.text;
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok)
    return {
      error: json.error ?? `API ${res.status}`,
      detail: json.detail ?? text,
      status: res.status,
    };
  return json;
}

// Stream a chat to the agent and parse SSE events (deploy phases, gameId, etc).
// Encodes sid to prevent URL injection. Returns phases array and final gameId.
export async function agentStream(
  sid: string,
  body: unknown,
  token: string,
  baseUrl: string,
  timeoutMs = 110_000,
): Promise<{ ok: true; phases: string[]; gameId?: string; timedOut: boolean } | { ok: false; error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const phases: string[] = [];
  let gameId: string | undefined;

  try {
    const res = await fetch(`${baseUrl}/session/${encodeURIComponent(sid)}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    if (!res.ok || !res.body) {
      clearTimeout(timer);
      const text = await res.text().catch(() => '');
      return { ok: false, error: `Agent chat failed (${res.status}): ${text.slice(0, 300)}` };
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';

      for (const p of parts) {
        const line = p.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          if ((ev.type === 'deploy' || ev.type === 'deploy_status') && ev.data) {
            try {
              const d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
              if (d.phase) phases.push(d.phase);
              if (d.appId) gameId = d.appId;
            } catch {
              /* skip malformed data */
            }
          }
          if (ev.appId) gameId = ev.appId;
        } catch {
          /* skip malformed event */
        }
      }
    }

    clearTimeout(timer);
    return { ok: true, phases, gameId, timedOut: false };
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: true, phases, gameId, timedOut: true };
    }
    return { ok: false, error: `Agent request failed: ${errMsg(err)}` };
  }
}
