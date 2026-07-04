/** kidify — rewrite one assistant message into a kid-friendly, funny version.
 *
 *  Runs on the FREE GitHub Models tier using the shared platform GITHUB_TOKEN,
 *  so it costs the signed-in user nothing and never touches their vault key.
 *  Stateless (no DO / no session) — it's a pure text transform — but auth-gated
 *  so the shared token isn't open to the world. The technical original always
 *  stays the source of truth on the client; this is a view layer only. */

import type { Env } from "./index";
import { resolveUser } from "./sessions";

const MODEL = "openai/gpt-4o-mini";
const GITHUB_MODELS_URL = "https://models.github.ai/inference/chat/completions";
const MAX_INPUT = 4000; // chars — cap so one giant message can't blow the budget

// Kept in sync with the console's lib/kidMode.ts option lists.
const AGE_HINT: Record<string, string> = {
  "5": "a 5-to-7-year-old who is just learning to read — use very short sentences and the simplest words",
  "8": "an 8-to-10-year-old — short sentences, simple words, a little bit cheeky",
  "11": "an 11-to-13-year-old — keep it snappy and a bit cooler, but still simple",
};

const VIBE_HINT: Record<string, string> = {
  funny: "Be funny and playful — slip in a small joke.",
  silly: "Be super silly and goofy, like a cartoon narrator.",
  adventure: "Frame it like an exciting adventure or quest.",
  chill: "Be calm, warm and encouraging.",
};

/** Build the system prompt from the chosen age band + vibe. Pure — unit-tested. */
export function buildKidPrompt(age: string, vibe: string): string {
  const a = AGE_HINT[age] ?? AGE_HINT["8"];
  const v = VIBE_HINT[vibe] ?? VIBE_HINT.funny;
  return [
    "You turn a game-building robot's technical update into a message a kid will love.",
    `Your reader is ${a}.`,
    v,
    "Rules:",
    "- 1 to 3 short sentences. No lists, no code, no markdown, no headings.",
    "- Say what changed in the GAME in plain words (new level, colours, score, a bug squished, etc.).",
    "- You may add 1 to 3 fitting emoji.",
    "- Never invent features that aren't in the message. If it's only a status update, say that simply.",
    "- Output ONLY the kid-friendly text — nothing else.",
  ].join("\n");
}

/** Handle POST /kidify. Returns null when the path isn't ours (so the caller
 *  falls through to the next route). */
export async function handleKidify(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== "/kidify") return null;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });

  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  // Auth-gate: the free platform token must not be an open rewrite API.
  const user = await resolveUser(request, env.AUTH);
  if (!user) return json({ error: "unauthorized" }, 401);

  let body: { text?: unknown; age?: unknown; vibe?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "bad json" }, 400);
  }

  const text = String(body.text ?? "").slice(0, MAX_INPUT).trim();
  if (!text) return json({ kid: "" });

  if (!env.GITHUB_TOKEN) return json({ error: "no platform token" }, 502);

  try {
    const res = await fetch(GITHUB_MODELS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.8,
        max_tokens: 350,
        messages: [
          { role: "system", content: buildKidPrompt(String(body.age ?? "8"), String(body.vibe ?? "funny")) },
          { role: "user", content: text },
        ],
      }),
    });
    if (!res.ok) return json({ error: `model ${res.status}` }, 502);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const kid = (data.choices?.[0]?.message?.content ?? "").trim();
    return json({ kid });
  } catch {
    return json({ error: "rewrite failed" }, 502);
  }
}
