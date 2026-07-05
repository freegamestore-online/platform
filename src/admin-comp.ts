/**
 * Internal admin endpoint for complimentary grants. Gated by INTERNAL_TOKEN
 * (only the admin worker holds it) — NOT a user session. The admin worker has
 * already authenticated the human against its Google-email allowlist; this
 * endpoint trusts that via the shared token.
 *
 *   GET    /v1/admin/comp           → { grants[], funded[] }
 *   POST   /v1/admin/comp           → { login | userId, provider, model, note?, expiresAt? }
 *   DELETE /v1/admin/comp/:userId   → revoke (userId = github:<id>)
 */
import type { Env } from "./index";
import { COMP_PROVIDERS, compKeyFor, grantComp, listComp, revokeComp } from "./keygrants";

export async function handleAdminCompApi(request: Request, env: Env, cors: Record<string, string>): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path !== "/v1/admin/comp" && !path.startsWith("/v1/admin/comp/")) return null;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });

  // Constant-ish token gate. Only the admin worker carries INTERNAL_TOKEN.
  const tok = request.headers.get("X-Internal-Token") || "";
  if (!env.INTERNAL_TOKEN || tok !== env.INTERNAL_TOKEN) return json({ error: "forbidden" }, 403);
  if (!env.DB) return json({ error: "database not configured" }, 500);

  if (path === "/v1/admin/comp" && request.method === "GET") {
    const grants = await listComp(env);
    const funded = [...COMP_PROVIDERS].filter((p) => !!compKeyFor(env, p));
    return json({ grants, funded });
  }

  if (path === "/v1/admin/comp" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as {
      login?: string; userId?: string; provider?: string; model?: string; note?: string; expiresAt?: string;
    };
    const provider = String(body.provider || "").toLowerCase();
    const model = String(body.model || "").trim();
    const note = body.note ? String(body.note).slice(0, 200) : null;
    const expiresAt = body.expiresAt ? String(body.expiresAt).trim() : null;

    if (!COMP_PROVIDERS.has(provider)) return json({ error: `unknown provider "${provider}"` }, 400);
    if (!model) return json({ error: "model is required" }, 400);
    if (model.length > 128) return json({ error: "model too long" }, 400);
    if (!compKeyFor(env, provider)) {
      return json({ error: `no platform key configured for ${provider} — set the COMP_KEY_${provider.toUpperCase()} secret first` }, 400);
    }
    if (expiresAt && Number.isNaN(Date.parse(expiresAt))) return json({ error: "expiresAt must be an ISO date" }, 400);

    // Resolve the target: an explicit userId (github:<id>) or a GitHub login,
    // which we map to the vault key format via the GitHub API.
    let userId = body.userId ? String(body.userId).trim() : "";
    const login = body.login ? String(body.login).trim() : "";
    if (!userId && login) {
      const resolved = await resolveGithubUserId(login, env.GITHUB_TOKEN);
      if (!resolved) return json({ error: `GitHub user "${login}" not found` }, 404);
      userId = resolved;
    }
    if (!/^github:\d+$/.test(userId)) {
      return json({ error: "a valid GitHub login, or userId (github:<id>), is required" }, 400);
    }

    const grantedBy = request.headers.get("X-Admin-Actor") || "admin";
    await grantComp(env, { userId, provider, model, grantedBy, note, expiresAt });
    return json({ ok: true, userId, provider, model, expiresAt });
  }

  const del = path.match(/^\/v1\/admin\/comp\/(github:\d+)$/);
  if (del && request.method === "DELETE") {
    await revokeComp(env, del[1]!);
    return json({ ok: true });
  }

  return json({ error: "not found" }, 404);
}

/** Map a GitHub login → the `github:<numericId>` vault key format. */
async function resolveGithubUserId(login: string, token?: string): Promise<string | null> {
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/.test(login)) return null;
  const res = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
    headers: {
      "User-Agent": "fgs-agent",
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { id?: number } | null;
  return data && typeof data.id === "number" ? `github:${data.id}` : null;
}
