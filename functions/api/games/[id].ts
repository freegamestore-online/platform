import { resolveCreator, corsHeaders } from "../_auth";

interface Env {
  SESSIONS: KVNamespace;
  JWT_SECRET?: string;
}

// The canonical game-metadata endpoints live on the admin worker (it owns the
// registry + D1 routes and enforces registry-primary ownership). Admin sits
// behind CF Access, so the browser can't call it directly — this Pages Function
// authorizes the signed-in creator, then forwards the cookie server-side, the
// same pattern /api/create uses for /api/provision.
const ADMIN_GAMES = "https://admin.freegamestore.online/api/games";

export const onRequestOptions: PagesFunction<Env> = async (ctx) =>
  new Response(null, { status: 204, headers: corsHeaders(ctx.request) });

async function proxy(context: Parameters<PagesFunction<Env>>[0], method: "PATCH" | "DELETE"): Promise<Response> {
  const json = (v: unknown, status = 200) =>
    new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json", ...corsHeaders(context.request) } });

  const user = await resolveCreator(context.request, context.env);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const id = String(context.params.id ?? "");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return json({ error: "Invalid game id" }, 400);

  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", Cookie: context.request.headers.get("Cookie") ?? "" },
  };
  if (method === "PATCH") init.body = await context.request.text();

  const res = await fetch(`${ADMIN_GAMES}/${id}`, init);
  const data = await res.json().catch(() => ({ error: "Admin returned a non-JSON response" }));
  return json(data, res.status);
}

/** PATCH /api/games/:id — update metadata (name, description, category, icon, iconBg). */
export const onRequestPatch: PagesFunction<Env> = (ctx) => proxy(ctx, "PATCH");

/** DELETE /api/games/:id — delete the game (delist + drop route + archive repo). */
export const onRequestDelete: PagesFunction<Env> = (ctx) => proxy(ctx, "DELETE");
