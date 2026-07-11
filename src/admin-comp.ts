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
import { getConfig } from "./config";
import { COMP_PROVIDERS, compKeyFor, grantComp, listComp, revokeComp } from "./keygrants";
import { deleteUserKey, isValidProvider, saveUserKey } from "./keys";
import { isOrgAdmin, listAllSessions, resolveUser } from "./sessions";

export async function handleAdminCompApi(request: Request, env: Env, cors: Record<string, string>, ctx?: ExecutionContext): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/v1/admin/")) return null;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });

  // Token gate. Only the admin worker carries INTERNAL_TOKEN. Constant-time
  // compare (like admin's safeEqual) so this high-value worker-to-worker secret
  // can't be recovered a byte at a time via response timing. The SESSION
  // visibility/chat endpoints additionally accept a signed-in ORG MEMBER's own
  // token (same admin contract as /admin/sessions) so MCP/CLI admins can use
  // them without holding the worker-to-worker secret. Key-vault and grant
  // endpoints stay internal-only.
  const tok = request.headers.get("X-Internal-Token") || "";
  const internalOk = !!env.INTERNAL_TOKEN && timingSafeEqual(tok, env.INTERNAL_TOKEN);
  if (!internalOk) {
    const ORG_ADMIN_PATHS = new Set([
      "/v1/admin/sessions",
      "/v1/admin/session-history",
      "/v1/admin/session-errors",
      "/v1/admin/session-chat",
    ]);
    if (!ORG_ADMIN_PATHS.has(path)) return json({ error: "forbidden" }, 403);
    const user = await resolveUser(request, env.AUTH);
    if (!user?.login || !(await isOrgAdmin(getConfig(env.STORE), env.GITHUB_TOKEN, user.login))) {
      return json({ error: "forbidden — org admins only" }, 403);
    }
  }
  if (!env.DB) return json({ error: "database not configured" }, 500);

  // GET /v1/admin/users — every REGISTERED user (from the auth users table in
  // this same D1), each annotated with its complimentary grant if any. Lets the
  // admin see + fund users who have never published a game (so they're absent
  // from the registry-derived creator list).
  if (path === "/v1/admin/users" && request.method === "GET") {
    const grants = await listComp(env);
    const gByUser = new Map(grants.map((g) => [g.userId, g]));
    // Which providers each user already has a vault key for (BYO or admin-added).
    const keysByUser = new Map<string, string[]>();
    try {
      const kr = await env.DB.prepare("SELECT user_id, provider FROM user_api_keys").all();
      for (const k of (kr.results as Record<string, unknown>[]) || []) {
        const uid = String(k.user_id);
        const arr = keysByUser.get(uid) || [];
        arr.push(String(k.provider));
        keysByUser.set(uid, arr);
      }
    } catch {
      /* user_api_keys may not exist yet (no keys saved) — treat as none */
    }
    const { results } = await env.DB.prepare(
      "SELECT id, name, avatar_url, created_at, last_seen FROM users ORDER BY created_at DESC LIMIT 1000",
    ).all();
    const users = (results as Record<string, unknown>[]).map((u) => {
      const id = String(u.id);
      const g = gByUser.get(id) || null;
      return {
        id,
        name: String(u.name || ""),
        avatarUrl: u.avatar_url ? String(u.avatar_url) : null,
        createdAt: u.created_at ? String(u.created_at) : null,
        lastSeen: u.last_seen ? String(u.last_seen) : null,
        keys: keysByUser.get(id) || [],
        grant: g ? { provider: g.provider, model: g.model, expiresAt: g.expiresAt } : null,
      };
    });
    return json({ users });
  }

  // POST /v1/admin/userkey { userId, provider, key } — admin pastes a provider
  // API key straight into a user's vault (same encrypted store as their own BYO
  // key). Their studio auto-selects a provider they have a key for, so the user
  // can build immediately with no further action.
  if (path === "/v1/admin/userkey" && request.method === "POST") {
    if (!env.AI_KEYS_KEK) return json({ error: "key vault not configured (AI_KEYS_KEK unset)" }, 500);
    const body = (await request.json().catch(() => ({}))) as { userId?: string; provider?: string; key?: string };
    const userId = String(body.userId || "").trim();
    const provider = String(body.provider || "").toLowerCase();
    const key = String(body.key || "").trim();
    if (!userId) return json({ error: "userId is required" }, 400);
    if (!isValidProvider(provider)) return json({ error: `unknown provider "${provider}"` }, 400);
    if (!key) return json({ error: "key is required" }, 400);
    if (key.length > 512) return json({ error: "key too long" }, 400);
    await saveUserKey(env, userId, provider, key);
    return json({ ok: true, userId, provider });
  }

  // POST /v1/admin/userkey/delete { userId, provider } — remove a vault key.
  // (POST, not DELETE-with-path, so the github:<id> userId needs no URL escaping.)
  if (path === "/v1/admin/userkey/delete" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { userId?: string; provider?: string };
    const userId = String(body.userId || "").trim();
    const provider = String(body.provider || "").toLowerCase();
    if (!userId || !provider) return json({ error: "userId and provider are required" }, 400);
    await deleteUserKey(env, userId, provider);
    return json({ ok: true });
  }

  // GET /v1/admin/sessions — every user's VibeCode sessions (the admin console's
  // Sessions tab). Same data as the org-member-gated /admin/sessions.
  if (path === "/v1/admin/sessions" && request.method === "GET") {
    return json({ sessions: await listAllSessions(env.DB) });
  }

  // GET /v1/admin/session-history?id=<sid> — any session's transcript, read from
  // its DO with the admin read flag (bypasses the ownership gate WITHOUT binding
  // an owner to an unclaimed session). /v1/admin/session-errors?id=<sid> is the
  // same for the session's server-side error log (tool failures, provider
  // errors, watchdog timeouts) — what the transcript alone doesn't show.
  const doRead = path === "/v1/admin/session-history" ? "/history" : path === "/v1/admin/session-errors" ? "/errors" : null;
  if (doRead && request.method === "GET") {
    const sid = url.searchParams.get("id") || "";
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(sid)) return json({ error: "bad session id" }, 400);
    const stub = env.SESSION.get(env.SESSION.idFromName(sid));
    const res = await stub.fetch(
      new Request(`https://do${doRead}`, {
        headers: { "X-Auth-User": "internal:admin", "X-Auth-Admin": "1" },
      }),
    );
    return new Response(await res.text(), {
      status: res.status,
      headers: { "Content-Type": "application/json", ...cors },
    });
  }

  // POST /v1/admin/session-chat?id=<sid> { message, provider?, model? } — send a
  // prompt INTO a user's session ON THEIR BEHALF: the DO runs the turn with the
  // owner's identity, so their vault key / grant / free tier is used and the
  // message lands in their transcript exactly as if they typed it. The admin
  // watches the turn via the live transcript view. Provider defaults to
  // whatever the owner can actually use (vault key → comp grant → free tier).
  if (path === "/v1/admin/session-chat" && request.method === "POST") {
    const sid = url.searchParams.get("id") || "";
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(sid)) return json({ error: "bad session id" }, 400);
    const body = (await request.json().catch(() => ({}))) as { message?: string; provider?: string; model?: string };
    const message = String(body.message || "").trim();
    if (!message) return json({ error: "message is required" }, 400);

    const ownerRow = await env.DB.prepare("SELECT user_id, user_login FROM agent_sessions WHERE session_id = ? LIMIT 1")
      .bind(sid)
      .first<{ user_id: string; user_login: string | null }>();
    if (!ownerRow?.user_id) return json({ error: "session not found in the index" }, 404);
    const owner = ownerRow.user_id;
    // The owner's GitHub LOGIN must ride along as X-Auth-Login — deploy's
    // internal provision requires creatorGithub, so an empty login made every
    // on-behalf deploy fail ("creatorGithub required", escape 2026-07-11).
    // Old index rows may predate the user_login column: resolve the numeric
    // github:<id> back to a login via the GitHub API as a fallback.
    let ownerLogin = ownerRow.user_login || "";
    if (!ownerLogin && /^github:\d+$/.test(owner)) {
      try {
        const res = await fetch(`https://api.github.com/user/${owner.slice("github:".length)}`, {
          headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "fgs-agent" },
        });
        if (res.ok) ownerLogin = ((await res.json()) as { login?: string }).login || "";
      } catch { /* best-effort — deploy will surface a clear error if still empty */ }
    }

    let provider = body.provider ? String(body.provider).toLowerCase() : "";
    if (!provider) {
      const keyRow = await env.DB.prepare("SELECT provider FROM user_api_keys WHERE user_id = ? LIMIT 1")
        .bind(owner)
        .first<{ provider: string }>()
        .catch(() => null);
      if (keyRow?.provider) provider = keyRow.provider;
      else {
        const grant = (await listComp(env)).find((g) => g.userId === owner);
        provider = grant?.provider || "github";
      }
    }
    const DEFAULT_MODELS: Record<string, string> = {
      anthropic: "claude-sonnet-4-6",
      openai: "gpt-4o",
      google: "gemini-2.5-flash",
      github: "openai/gpt-4o",
    };
    const model = body.model ? String(body.model) : DEFAULT_MODELS[provider] || DEFAULT_MODELS.github!;

    const stub = env.SESSION.get(env.SESSION.idFromName(sid));
    const res = await stub.fetch(
      new Request("https://do/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-User": owner,
          "X-Session-Id": sid,
          "X-Auth-Login": ownerLogin,
        },
        body: JSON.stringify({ message, aiConfig: { provider, model, temperature: 0.7, maxTokens: 16384 } }),
      }),
    );
    // KEEP THE TURN ALIVE INDEPENDENT OF THE CALLER. In practice a turn dies a
    // few minutes after its client disconnects (the DO gets evicted along with
    // its in-memory watchdog — a silent zombie; flappybird/sliceit 2026-07-11).
    // tee() the stream: the caller gets its live trace and may abort whenever;
    // the worker drains the second branch via waitUntil until the turn truly
    // finishes, keeping the DO's response stream connected the whole way.
    const sseHeaders = { "Content-Type": res.headers.get("Content-Type") || "text/event-stream", ...cors };
    if (ctx && res.body) {
      const [toCaller, toDrain] = res.body.tee();
      ctx.waitUntil(
        (async () => {
          const reader = toDrain.getReader();
          try {
            for (;;) {
              const { done } = await reader.read();
              if (done) break;
            }
          } catch { /* stream errored — the turn's own error handling owns it */ }
        })(),
      );
      return new Response(toCaller, { status: res.status, headers: sseHeaders });
    }
    return new Response(res.body, { status: res.status, headers: sseHeaders });
  }

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

/** Length-checked constant-time string compare (avoids leaking the secret via
 *  early-exit timing). Length difference is not itself secret. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
