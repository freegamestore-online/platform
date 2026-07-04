import { resolveCreator } from "./_auth";

interface Env {
  GITHUB_TOKEN: string;
  CREATORS: KVNamespace;
  SESSIONS: KVNamespace;
  JWT_SECRET?: string;
}

const ORG = "freegamestore-online";

// Same reserved ids + grammar the create path enforces, so "Check" agrees with
// what "Create Game" will accept.
const INFRA_REPOS = new Set([
  "freegamestore", "submissions", "template-game-canvas", "template-game-3d",
  "template-game-grid", "template-game-cards", "brand", "ops", "sdk",
]);

export function validateId(id: string): string | null {
  if (!id) return "ID is required";
  if (id.length > 58) return "58 characters max";
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(id)) return "Lowercase letters, numbers, dashes only. No leading/trailing dash.";
  if (id.startsWith("free") || id.startsWith("pro")) return "Cannot start with 'free' or 'pro'";
  if (INFRA_REPOS.has(id)) return "Reserved id";
  return null;
}

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
