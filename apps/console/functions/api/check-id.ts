import { resolveCreator } from "./_auth";
// Single source of truth shared with create.ts so "Check" always agrees with
// what "Create Game" accepts. Re-exported for callers/tests importing it here.
import { validateId } from "./_validate";

export { validateId };

interface Env {
  GITHUB_TOKEN: string;
  CREATORS: KVNamespace;
  SESSIONS: KVNamespace;
  JWT_SECRET?: string;
}

const ORG = "freegamestore-online";

/**
 * GET /api/check-id?id=<id> — is this game id available? Auth-gated (uses the
 * platform GITHUB_TOKEN, so not an open GitHub proxy). Returns
 * { available: boolean, reason?: string } so the creator form can check BEFORE
 * hitting Create.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const json = (v: unknown, status = 200) =>
    new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

  const user = await resolveCreator(context.request, context.env);
  if (!user) return json({ available: false, reason: "Sign in to check" }, 401);

  const id = (new URL(context.request.url).searchParams.get("id") || "").trim().toLowerCase();
  const fmt = validateId(id);
  if (fmt) return json({ available: false, reason: fmt });

  try {
    const r = await fetch(`https://api.github.com/repos/${ORG}/${id}`, {
      headers: { Authorization: `Bearer ${context.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "freegamestore-publisher" },
    });
    if (r.status === 404) return json({ available: true });
    if (r.status === 200) return json({ available: false, reason: "Already taken" });
    return json({ available: false, reason: `Couldn't check (GitHub ${r.status})` });
  } catch (e) {
    return json({ available: false, reason: `Check failed: ${(e as Error).message}` });
  }
};
