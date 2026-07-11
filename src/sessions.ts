/**
 * Per-user VibeCode session list, backed by D1.
 *
 * The console used to keep the project list in localStorage only, so it was
 * lost on browser-clear and never synced across devices. These endpoints store
 * lightweight session metadata (title, deployed game) keyed by the signed-in
 * user, resolved via an auth-worker `/me` subrequest (so no shared JWT secret
 * is needed on this worker).
 *
 * Session *content* (messages, files) still lives in the Durable Object — this
 * is only the index of "which sessions belong to whom".
 */
import type { Env } from "./index";
import type { StoreConfig } from "./config";
import { resilientFetch } from "./ghfetch";

const SCHEMA = `CREATE TABLE IF NOT EXISTS agent_sessions (
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  title TEXT,
  game_id TEXT,
  game_url TEXT,
  deployed INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, session_id)
)`;

// Columns added after the table first shipped. `CREATE TABLE IF NOT EXISTS`
// never alters an existing table, so add them idempotently — the ADD COLUMN
// throws "duplicate column name" once present, which we swallow.
const MIGRATIONS = [
  "ALTER TABLE agent_sessions ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE agent_sessions ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0",
  // GitHub login of the session owner, for the admin all-sessions view (the
  // user_id is an opaque auth sub). Backfilled lazily on each chat turn.
  "ALTER TABLE agent_sessions ADD COLUMN user_login TEXT",
];

let schemaReady = false;
async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.prepare(SCHEMA).run();
  for (const sql of MIGRATIONS) {
    await db.prepare(sql).run().catch(() => {/* column already exists */});
  }
  schemaReady = true;
}

/**
 * Persist a session's cumulative token totals (absolute, DO-authoritative) onto
 * its index row so per-game and per-account usage can be read without touching
 * the Durable Object. The row is created by upsertSessionIndex at the start of
 * every chat turn, so a plain UPDATE here always lands. Best-effort; the caller
 * must not let a usage-write failure break a chat.
 */
export async function bumpSessionTokens(
  db: D1Database,
  userId: string,
  sessionId: string,
  input: number,
  output: number,
): Promise<void> {
  if (!userId || !sessionId) return;
  await ensureSchema(db);
  await db
    .prepare(
      `UPDATE agent_sessions SET input_tokens = ?, output_tokens = ?, updated_at = datetime('now')
       WHERE user_id = ? AND session_id = ?`,
    )
    .bind(Math.max(0, Math.round(input)), Math.max(0, Math.round(output)), userId, sessionId)
    .run();
}

/**
 * Server-authoritative upsert of a session's index row, so an active session is
 * discoverable via GET /sessions from ANY browser. Previously the index was
 * written ONLY by the client (PUT /sessions/:id); a missed/raced PUT left the
 * session invisible in a second browser even though its transcript was durable
 * in the DO. Called from the DO on each chat turn. Preserves `deployed` (only
 * the client's markDeployed toggles it) and never clobbers a real title/game_id
 * with a null via COALESCE.
 */
export async function upsertSessionIndex(
  db: D1Database,
  userId: string,
  sessionId: string,
  fields: { title?: string | null; gameId?: string | null; gameUrl?: string | null; login?: string | null },
): Promise<void> {
  if (!userId || !sessionId) return;
  await ensureSchema(db);
  await db
    .prepare(
      `INSERT INTO agent_sessions (user_id, session_id, title, game_id, game_url, user_login, deployed, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'))
       ON CONFLICT(user_id, session_id) DO UPDATE SET
         title = COALESCE(excluded.title, agent_sessions.title),
         game_id = COALESCE(excluded.game_id, agent_sessions.game_id),
         game_url = COALESCE(excluded.game_url, agent_sessions.game_url),
         user_login = COALESCE(excluded.user_login, agent_sessions.user_login),
         updated_at = datetime('now')`,
    )
    .bind(userId, sessionId, fields.title ?? null, fields.gameId ?? null, fields.gameUrl ?? null, fields.login ?? null)
    .run();
}

/**
 * Is `login` a member of the store's GitHub org? Org members are platform
 * admins (same contract as ownership.ts's admin-all view). Cached per-isolate
 * for 5 minutes so the admin session list / transcript reads don't hit the
 * GitHub API on every call.
 */
const adminCache = new Map<string, { ok: boolean; exp: number }>();
export async function isOrgAdmin(config: StoreConfig, ghToken: string, login: string): Promise<boolean> {
  if (!login) return false;
  const key = login.toLowerCase();
  const hit = adminCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.ok;
  let ok = false;
  try {
    const res = await resilientFetch(`https://api.github.com/orgs/${config.org}/members/${login}`, {
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": config.agentName,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    ok = res.status === 204;
  } catch {
    ok = false;
  }
  adminCache.set(key, { ok, exp: Date.now() + 5 * 60_000 });
  return ok;
}

/**
 * GET /admin/sessions — EVERY user's session index rows, newest first. Org
 * members only (platform admins); everyone else gets 403. Read-only: this is
 * the "parent view" for seeing what any creator's VibeCode chats are up to —
 * pair with /session/:id/history?admin=1 to read a transcript.
 */
export async function handleAdminSessionsApi(
  request: Request,
  env: Env,
  config: StoreConfig,
  cors: Record<string, string>,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== "/admin/sessions") return null;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });

  if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
  if (!env.DB) return json({ error: "database not configured" }, 500);

  const user = await resolveUser(request, env.AUTH);
  if (!user) return json({ error: "unauthorized" }, 401);
  if (!user.login || !(await isOrgAdmin(config, env.GITHUB_TOKEN, user.login))) {
    return json({ error: "forbidden — org admins only" }, 403);
  }

  return json({ sessions: await listAllSessions(env.DB) });
}

/** Every user's session index rows, newest first — the admin view. */
export async function listAllSessions(db: D1Database): Promise<Record<string, unknown>[]> {
  await ensureSchema(db);
  const { results } = await db.prepare(
    `SELECT user_id, user_login, session_id, title, game_id, game_url, deployed,
            input_tokens, output_tokens, created_at, updated_at
     FROM agent_sessions ORDER BY updated_at DESC LIMIT 500`,
  ).all();
  return (results as Record<string, unknown>[]).map((r) => ({
    id: r.session_id,
    user: (r.user_login as string) || (r.user_id as string),
    userId: r.user_id,
    name: (r.title as string) || "Untitled",
    gameId: (r.game_id as string) || undefined,
    gameUrl: (r.game_url as string) || undefined,
    deployed: !!r.deployed,
    tokens: { input: Number(r.input_tokens) || 0, output: Number(r.output_tokens) || 0 },
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function resolveUser(
  request: Request,
  auth: Fetcher,
): Promise<{ id: string; name: string; login: string | null } | null> {
  // The fgs_token arrives as X-FGS-Token (MCP), an Authorization Bearer, or the
  // fgs_token cookie (console). Verify it via the auth worker's /me — over a
  // SERVICE BINDING, since fetching auth's public hostname from a Worker loops
  // back through the edge and times out (CF 522).
  const authz = request.headers.get("Authorization") ?? "";
  const xfgs = request.headers.get("X-FGS-Token") ?? "";
  const cookieToken = (request.headers.get("Cookie") ?? "").match(/fgs_token=([^;]*)/)?.[1];
  const token = xfgs || (authz.startsWith("Bearer ") ? authz.slice(7).trim() : "") || cookieToken;
  if (!token) return null;
  try {
    const r = await auth.fetch("https://auth.freegamestore.online/me", { headers: { "X-FGS-Token": token } });
    if (!r.ok) return null;
    const u = (await r.json()) as { id?: string; name?: string; login?: string | null };
    return u?.id ? { id: u.id, name: u.name || "", login: u.login ?? null } : null;
  } catch {
    return null;
  }
}

/**
 * Handle `/sessions` and `/sessions/:id`. Returns null when the path is not a
 * sessions route, so the caller can fall through to Durable Object routing.
 */
export async function handleSessionsApi(
  request: Request,
  env: Env,
  domain: string,
  cors: Record<string, string>,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== "/sessions" && !path.startsWith("/sessions/")) return null;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });

  if (!env.DB) return json({ error: "database not configured" }, 500);

  const user = await resolveUser(request, env.AUTH);
  if (!user) return json({ error: "unauthorized" }, 401);

  await ensureSchema(env.DB);

  // GET /sessions — list the signed-in user's sessions, newest first, each with
  // its cumulative token usage, plus an account-wide `totals` sum so the UI can
  // show per-game and total spend without a second request.
  if (path === "/sessions" && request.method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT session_id, title, game_id, game_url, deployed, input_tokens, output_tokens, created_at FROM agent_sessions WHERE user_id = ? ORDER BY updated_at DESC",
    )
      .bind(user.id)
      .all();
    let totalIn = 0;
    let totalOut = 0;
    const sessions = (results as Record<string, unknown>[]).map((r) => {
      const input = Number(r.input_tokens) || 0;
      const output = Number(r.output_tokens) || 0;
      totalIn += input;
      totalOut += output;
      return {
        id: r.session_id,
        name: (r.title as string) || "Untitled",
        gameId: (r.game_id as string) || undefined,
        gameUrl: (r.game_url as string) || undefined,
        deployed: !!r.deployed,
        tokens: { input, output },
        createdAt: r.created_at,
      };
    });
    return json({ sessions, totals: { input: totalIn, output: totalOut, games: sessions.length } });
  }

  // /sessions/:id — upsert (PUT) or remove (DELETE) one session.
  const idMatch = path.match(/^\/sessions\/([a-zA-Z0-9_-]{1,64})$/);
  if (idMatch) {
    const sessionId = idMatch[1];
    if (request.method === "PUT") {
      const body = (await request.json().catch(() => ({}))) as {
        title?: string;
        gameId?: string;
        gameUrl?: string;
        deployed?: boolean;
      };
      await env.DB.prepare(
        `INSERT INTO agent_sessions (user_id, session_id, title, game_id, game_url, deployed, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, session_id) DO UPDATE SET
           title = COALESCE(excluded.title, agent_sessions.title),
           game_id = COALESCE(excluded.game_id, agent_sessions.game_id),
           game_url = COALESCE(excluded.game_url, agent_sessions.game_url),
           deployed = excluded.deployed,
           updated_at = datetime('now')`,
      )
        .bind(user.id, sessionId, body.title ?? null, body.gameId ?? null, body.gameUrl ?? null, body.deployed ? 1 : 0)
        .run();
      return json({ ok: true });
    }
    if (request.method === "DELETE") {
      await env.DB.prepare("DELETE FROM agent_sessions WHERE user_id = ? AND session_id = ?").bind(user.id, sessionId).run();
      return json({ ok: true });
    }
  }

  return json({ error: "not found" }, 404);
}
