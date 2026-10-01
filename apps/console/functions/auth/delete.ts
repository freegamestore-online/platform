/**
 * Self-service account deletion is not implemented (#77).
 *
 * This endpoint used to delete only the legacy `fgs_pub_session` KV entry and
 * then answer `{ ok: true }`, so the Profile page told users "all your data" was
 * permanently removed while their session, agent sessions, stored provider keys
 * and auth record all survived. A real deletion spans the console KV stores, the
 * agent (D1 rows + per-session Durable Object storage + key vault) and the auth
 * worker, so until that exists this fails loudly and touches nothing — it must
 * never report success for data it did not delete.
 */
export const onRequestPost: PagesFunction = async () =>
  new Response(
    JSON.stringify({
      error:
        "Account deletion isn't available yet. Nothing was deleted and you are still signed in.",
    }),
    {
      status: 501,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    },
  );
