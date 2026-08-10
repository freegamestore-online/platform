import { resolveCreatorUser, type SessionEnv } from "../api/_auth";

// Identity for the console/profile UI. Since auth consolidation the source of
// truth is the freegamestore-auth worker's `fgs_token` JWT; resolveCreatorUser
// also accepts the legacy publisher KV session for backward compatibility.
export const onRequestGet: PagesFunction<SessionEnv> = async (context) => {
  const user = await resolveCreatorUser(context.request, context.env);
  return new Response(JSON.stringify({ user }), {
    headers: { "Content-Type": "application/json" },
  });
};
