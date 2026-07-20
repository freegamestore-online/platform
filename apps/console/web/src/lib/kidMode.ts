/** Kid mode — show the agent's replies rewritten for a kid, funny and simple,
 *  with a tap to reveal the original technical message. The preference lives in
 *  localStorage (like the text-size setting) and is read by ChatMessage. The
 *  rewrite itself happens server-side on the agent's free tier (POST /kidify);
 *  the technical text is always the source of truth, this is a view layer. */

const AGENT_URL = "https://agent.freegamestore.online";
const KEY = "stores-kid-mode";

export type KidAge = "5" | "8" | "11";
export type KidVibe = "funny" | "silly" | "adventure" | "chill";

export interface KidMode {
  enabled: boolean;
  age: KidAge;
  vibe: KidVibe;
}

// On by default: this is a kids' game platform, so a fresh account gets the
// kid-friendly rewrites without opt-in. Anyone who has explicitly toggled it
// keeps their choice (a stored preference always wins over this default), and
// it can be turned off in the profile to save tokens.
const DEFAULT: KidMode = { enabled: true, age: "8", vibe: "funny" };

export const KID_AGES: { value: KidAge; label: string }[] = [
  { value: "5", label: "Ages 5–7" },
  { value: "8", label: "Ages 8–10" },
  { value: "11", label: "Ages 11–13" },
];

export const KID_VIBES: { value: KidVibe; label: string; emoji: string }[] = [
  { value: "funny", label: "Funny", emoji: "😂" },
  { value: "silly", label: "Silly", emoji: "🤪" },
  { value: "adventure", label: "Adventure", emoji: "🚀" },
  { value: "chill", label: "Chill", emoji: "😎" },
];

const isAge = (v: unknown): v is KidAge => v === "5" || v === "8" || v === "11";
const isVibe = (v: unknown): v is KidVibe =>
  v === "funny" || v === "silly" || v === "adventure" || v === "chill";

export function getKidMode(): KidMode {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const p = JSON.parse(raw) as Partial<KidMode>;
    return {
      // Only an explicit stored boolean overrides the default — a partial/legacy
      // blob missing `enabled` must fall back to DEFAULT (on), not coerce to off.
      enabled: typeof p.enabled === "boolean" ? p.enabled : DEFAULT.enabled,
      age: isAge(p.age) ? p.age : DEFAULT.age,
      vibe: isVibe(p.vibe) ? p.vibe : DEFAULT.vibe,
    };
  } catch {
    return DEFAULT;
  }
}

export function setKidMode(next: KidMode): void {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(next));
}

// A cheap, stable key so an identical (message, age, vibe) is fetched once and
// then served from cache — the free tier is shared, so we don't re-bill it.
// A bare 32-bit hash collides often enough that two different messages could
// hash-collide and one message's kid-rewrite would be served for another. To
// make collisions vanishingly unlikely, combine TWO independently-seeded 32-bit
// hashes (a 64-bit space) with the exact text length — so a match requires
// agreeing on length AND both hashes.
export function cacheKey(text: string, age: string, vibe: string): string {
  const s = `${age}|${vibe}|${text}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = (Math.imul(h1 ^ ch, 0x01000193)) | 0;
    h2 = (Math.imul(h2 + ch, 31)) | 0;
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return `kid:${s.length.toString(36)}:${hex(h1)}${hex(h2)}`;
}

// Persisted LRU cache. Kept as ONE bounded blob (not one key per message) so it
// can't grow unbounded and eventually throw QuotaExceededError — which would
// silently disable caching and re-bill the free tier on every render. Map
// insertion order gives us recency: on a hit we re-insert to mark it fresh, and
// saveCache() trims the oldest entries past the cap.
const CACHE_KEY = "stores-kid-cache";
const CACHE_MAX = 300;

let cache: Map<string, string> | null = null;
function loadCache(): Map<string, string> {
  if (cache) return cache;
  cache = new Map();
  if (typeof window === "undefined") return cache;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (raw) for (const [k, v] of JSON.parse(raw) as [string, string][]) cache.set(k, v);
  } catch {
    /* corrupt/absent — start empty */
  }
  return cache;
}
function saveCache(c: Map<string, string>): void {
  while (c.size > CACHE_MAX) {
    const oldest = c.keys().next().value;
    if (oldest === undefined) break;
    c.delete(oldest);
  }
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify([...c]));
  } catch {
    /* still over quota after the trim — in-memory cache still covers session */
  }
}

// Cap concurrent rewrites: opening a long transcript would otherwise fire a
// dozen simultaneous free-tier calls that rate-limit (429), fall back to the
// original, and — since failures aren't cached — re-fire on the next load.
// Cache hits skip this gate entirely.
const MAX_CONCURRENT = 3;
let active = 0;
const waiters: (() => void)[] = [];
function acquire(): Promise<void> {
  return new Promise((resolve) => {
    if (active < MAX_CONCURRENT) { active++; resolve(); } else { waiters.push(resolve); }
  });
}
function release(): void {
  const next = waiters.shift();
  if (next) next(); // hand the slot straight to the next waiter (active unchanged)
  else active = Math.max(0, active - 1);
}

/** Fetch (or recall) the kid-friendly version of one assistant message. Returns
 *  "" if the rewrite is empty; throws on network/model error so the caller can
 *  fall back to the technical original. */
export async function fetchKidVersion(text: string, mode: KidMode): Promise<string> {
  const key = cacheKey(text, mode.age, mode.vibe);
  const c = loadCache();
  const hit = c.get(key);
  if (hit !== undefined) {
    c.delete(key);
    c.set(key, hit); // bump recency
    return hit;
  }

  await acquire();
  try {
    const res = await fetch(`${AGENT_URL}/kidify`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, age: mode.age, vibe: mode.vibe }),
    });
    if (!res.ok) throw new Error(`kidify ${res.status}`);
    const data = (await res.json()) as { kid?: string };
    const kid = (data.kid ?? "").trim();
    c.set(key, kid);
    saveCache(c);
    return kid;
  } finally {
    release();
  }
}
