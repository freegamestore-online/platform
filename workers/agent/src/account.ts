/**
 * Self-service account deletion for the agent.
 *
 * When a user deletes their account, we:
 * - Delete all their session D1 index rows
 * - Wipe each session's Durable Object storage (session transcripts, files, etc.)
 * - Delete their API keys (provider key vault)
 * - Delete their complimentary grants
 *
 * The console orchestrates the full cross-service deletion and clears cookies.
 */

import type { StoreConfig } from "./config";
import type { Env } from "./index";
import { resolveUser } from "./sessions";

export async function handleAccountDelete(
  request: Request,
  env: Env,
  _config: StoreConfig,
  cors: Record<string, string>,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Versioned route: /v1/account or unversioned /account
  const isAccountPath = path === "/account" || path === "/v1/account" || path === "/account" || path === "/v1/account";

  if (!isAccountPath || request.method !== "DELETE") return null;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });

  if (!env.DB) return json({ error: "database not configured" }, 500);

  const user = await resolveUser(request, env.AUTH);
  if (!user) return json({ error: "unauthorized" }, 401);

  try {
    // Get all sessions for this user
    const { results: sessions } = await env.DB.prepare("SELECT session_id FROM agent_sessions WHERE user_id = ?")
      .bind(user.id)
      .all<{ session_id: string }>();

    // Delete each session's Durable Object storage
    for (const session of sessions || []) {
      try {
        const doId = env.SESSION.idFromName(session.session_id);
        const doStub = env.SESSION.get(doId);
        // Delete all storage in the DO
        const storageReq = new Request("https://internal/storage/delete-all", {
          method: "POST",
          headers: { "X-Internal-Call": "true" },
        });
        await doStub.fetch(storageReq);
      } catch (e) {
        console.error(`Failed to clear DO storage for session ${session.session_id}:`, e);
        // Continue with others; partial deletion is better than rollback
      }
    }

    // Delete the session index rows
    await env.DB.prepare("DELETE FROM agent_sessions WHERE user_id = ?").bind(user.id).run();

    // Delete API keys (provider key vault)
    await env.DB.prepare("DELETE FROM user_api_keys WHERE user_id = ?").bind(user.id).run();

    // Delete complimentary grants
    await env.DB.prepare("DELETE FROM complimentary_grants WHERE user_id = ?").bind(user.id).run();

    // Clear rate limit records for this user (optional but clean)
    await env.DB.prepare("DELETE FROM rate_limits WHERE user_id = ?")
      .bind(user.id)
      .run()
      .catch(() => {
        // rate_limits might not exist or already be cleared
      });

    return json({ ok: true, message: "Account deleted from agent" }, 200);
  } catch (error) {
    console.error("Account deletion failed:", error);
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Account deletion failed",
      },
      500,
    );
  }
}
