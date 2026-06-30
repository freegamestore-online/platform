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

const SCHEMA = `CREATE TABLE IF NOT EXISTS agent_sessions (
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  title TEXT,
  game_id TEXT,
  game_url TEXT,
  deployed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, session_id)
)`;

let schemaReady = false;
async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.prepare(SCHEMA).run();
  schemaReady = true;
}

export async function resolveUser(request: Request, auth: Fetcher): Promise<{ id: string; name: string } | null> {
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
    const u = (await r.json()) as { id?: string; name?: string };
    return u?.id ? { id: u.id, name: u.name || "" } : null;
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

  // GET /sessions — list the signed-in user's sessions, newest first.
  if (path === "/sessions" && request.method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT session_id, title, game_id, game_url, deployed, created_at FROM agent_sessions WHERE user_id = ? ORDER BY updated_at DESC",
    )
      .bind(user.id)
      .all();
    const sessions = (results as Record<string, unknown>[]).map((r) => ({
      id: r.session_id,
      name: (r.title as string) || "Untitled",
      gameId: (r.game_id as string) || undefined,
      gameUrl: (r.game_url as string) || undefined,
      deployed: !!r.deployed,
      createdAt: r.created_at,
    }));
    return json({ sessions });
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
           title = excluded.title,
           game_id = excluded.game_id,
           game_url = excluded.game_url,
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
