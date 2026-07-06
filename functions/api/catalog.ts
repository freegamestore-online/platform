import { corsHeaders } from "./_auth";
import { getRegistry } from "./_games";

interface Env {
  GITHUB_TOKEN?: string;
}

// Public catalog of published games — used by the create form's "Remix an
// existing game" picker. The registry is already public (it drives the
// storefront), so no auth: return just the fields the picker needs.
export const onRequestOptions: PagesFunction<Env> = async (ctx) =>
  new Response(null, { status: 204, headers: corsHeaders(ctx.request) });

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const games = await getRegistry(ctx.env.GITHUB_TOKEN);
  const list = (games ?? [])
    .filter((g) => g.id)
    .map((g) => ({ id: g.id, name: g.name || g.id, engine: g.engine, icon: g.icon }));
  return new Response(JSON.stringify({ games: list }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=120",
      ...corsHeaders(ctx.request),
    },
  });
};
