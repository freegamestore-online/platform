interface Env {
  DB: D1Database;
  JWT_SECRET: string;
}

interface JWTPayload {
  sub: string;
  name: string;
  avatar: string;
  exp: number;
  iat: number;
}

const ALLOWED_ORIGIN = /^https:\/\/[\w-]+\.freegamestore\.online$/;
const MAX_NAME_LENGTH = 20;
const MAX_SCORE = 999_999_999;
const RATE_LIMIT_SECONDS = 10;
const LEADERBOARD_LIMIT = 50;

// Per-game sanity caps. A submitted score above the game's cap is rejected as
// implausible — the cheapest anti-cheat layer there is. Games not listed here
// fall back to MAX_SCORE. Client games can never be fully trusted; this just
// keeps the obviously-forged 999,999,999 entries off the boards. Tune as games
// establish real high-score ranges.
const DEFAULT_MAX_SCORE = MAX_SCORE;
const PER_GAME_MAX: Record<string, number> = {
  coinflip: 1000,
  dice: 1000,
  highlow: 1000,
  simon: 1000,
  whackamole: 100_000,
  "2048": 5_000_000,
};

// Valid game IDs — update when adding new games
const VALID_GAMES = new Set([
  "chess", "puzzle", "tetris", "snake", "minesweeper", "2048",
  "slither", "racing", "bowling", "spaceshooter", "breakout", "platformer", "sudoku",
  "pacman", "pong", "flappy", "solitaire", "connect4", "wordle", "simon", "mahjong",
  "checkers", "hangman", "memory", "frogger", "match3", "whackamole", "wordsearch", "asteroids",
]);

function cors(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = ALLOWED_ORIGIN.test(origin) || origin === "https://freegamestore.online" || origin === "http://localhost:5173";
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(data: unknown, status: number, request: Request): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors(request) },
  });
}

async function hashIP(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip + "fgs-salt-2024");
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function verifyJWT(request: Request, secret: string): Promise<JWTPayload | null> {
  const token = getCookie(request, "fgs_token");
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    // Verify header is HS256
    const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
    if (header.alg !== "HS256") return null;

    // Verify signature
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );

    const signature = base64UrlDecode(parts[2]);
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);

    const valid = await crypto.subtle.verify("HMAC", key, signature, data);
    if (!valid) return null;

    // Decode payload
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1]))) as JWTPayload;

    // Check expiration (matches auth's jwtVerify — a token with a missing or
    // non-numeric exp must not be treated as non-expiring, so require a number).
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

// POST /api/scores { game, name, score }
async function submitScore(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400, request);
  }

  const { game, score } = body as Record<string, unknown>;

  if (typeof game !== "string" || !VALID_GAMES.has(game)) {
    return json({ error: "Invalid game" }, 400, request);
  }
  if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
    return json({ error: "Invalid score" }, 400, request);
  }

  // Authentication is required to submit. Anonymous posts were trivially
  // spoofable (any client could POST a name + score), so the boards only
  // accept signed-in users now.
  const jwtPayload = await verifyJWT(request, env.JWT_SECRET);
  if (!jwtPayload) {
    return json({ error: "Sign in to submit a score" }, 401, request);
  }
  const userId = jwtPayload.sub;
  const playerName =
    jwtPayload.name.trim().slice(0, MAX_NAME_LENGTH).replace(/[<>&"']/g, "") || "Anonymous";

  // Per-game sanity cap — reject implausibly high scores outright.
  const cap = PER_GAME_MAX[game] ?? DEFAULT_MAX_SCORE;
  if (score > cap) {
    return json({ error: "Score exceeds the maximum for this game" }, 422, request);
  }

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const ipHash = await hashIP(ip);

  // Rate limit: 1 submission per user per game per RATE_LIMIT_SECONDS.
  // Keyed on the authenticated user (not IP) so a shared network isn't
  // throttled collectively; ip_hash is still stored for abuse forensics.
  const recent = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM scores
     WHERE user_id = ? AND game_id = ?
     AND created_at > datetime('now', ?)`,
  )
    .bind(userId, game, `-${RATE_LIMIT_SECONDS} seconds`)
    .first<{ cnt: number }>();

  if (recent && recent.cnt > 0) {
    return json({ error: "Too fast, wait a few seconds" }, 429, request);
  }

  await env.DB.prepare(
    `INSERT INTO scores (game_id, player_name, score, ip_hash, user_id) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(game, playerName, score, ipHash, userId)
    .run();

  // Return the player's rank (count of distinct OTHER users who beat this score).
  // Excluding the submitter (user_id != ?) matters when they post a score below
  // their own existing best — otherwise their higher rows satisfy `score > ?`
  // and they'd count themselves, inflating the rank (e.g. sole player → rank 2).
  const rank = await env.DB.prepare(
    `SELECT COUNT(DISTINCT user_id) as rank FROM scores WHERE game_id = ? AND score > ? AND user_id IS NOT NULL AND user_id != ?`,
  )
    .bind(game, score, userId)
    .first<{ rank: number }>();

  return json({ ok: true, rank: (rank?.rank ?? 0) + 1, authenticated: !!userId }, 201, request);
}

// GET /api/leaderboard/:game?limit=10
async function getLeaderboard(game: string, url: URL, request: Request, env: Env): Promise<Response> {
  if (!VALID_GAMES.has(game)) {
    return json({ error: "Invalid game" }, 400, request);
  }

  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitParam ?? "10", 10) || 10, 1), LEADERBOARD_LIMIT);

  // One row per user (their personal best). GROUP BY user_id with MAX(score)
  // relies on SQLite's documented "bare columns take values from the max row"
  // behaviour, so player_name/created_at come from each user's top score.
  // Without this, a single player's 50 best scores fill every board slot — and
  // it would also disagree with the COUNT(DISTINCT user_id) rank math elsewhere.
  const results = await env.DB.prepare(
    `SELECT s.player_name, MAX(s.score) AS score, s.created_at, s.user_id, u.avatar_url
     FROM scores s
     LEFT JOIN users u ON s.user_id = u.id
     WHERE s.game_id = ? AND s.user_id IS NOT NULL
     GROUP BY s.user_id
     ORDER BY score DESC LIMIT ?`,
  )
    .bind(game, limit)
    .all<{ player_name: string; score: number; created_at: string; user_id: string; avatar_url: string | null }>();

  return json({ game, scores: results.results }, 200, request);
}

// GET /api/leaderboard/:game/recent?limit=10
async function getRecent(game: string, url: URL, request: Request, env: Env): Promise<Response> {
  if (!VALID_GAMES.has(game)) {
    return json({ error: "Invalid game" }, 400, request);
  }

  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitParam ?? "10", 10) || 10, 1), LEADERBOARD_LIMIT);

  const results = await env.DB.prepare(
    `SELECT s.player_name, s.score, s.created_at, s.user_id, u.avatar_url
     FROM scores s
     LEFT JOIN users u ON s.user_id = u.id
     WHERE s.game_id = ? ORDER BY s.created_at DESC, s.id DESC LIMIT ?`,
  )
    .bind(game, limit)
    .all<{ player_name: string; score: number; created_at: string; user_id: string | null; avatar_url: string | null }>();

  return json({ game, scores: results.results }, 200, request);
}

// GET /api/leaderboard/overall?limit=10
async function getOverallLeaderboard(url: URL, request: Request, env: Env): Promise<Response> {
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitParam ?? "10", 10) || 10, 1), LEADERBOARD_LIMIT);

  // Sum each user's BEST score per game — not every submission. SUM(s.score)
  // over raw rows is farmable by resubmitting the same game, and contradicts the
  // per-user-best model getLeaderboard uses. The inner query collapses to one
  // best row per (user, game) first.
  const results = await env.DB.prepare(
    `SELECT t.user_id, u.name, u.avatar_url, SUM(t.best) as total_score, COUNT(*) as games_played
     FROM (
       SELECT user_id, game_id, MAX(score) as best
       FROM scores
       WHERE user_id IS NOT NULL
       GROUP BY user_id, game_id
     ) t
     JOIN users u ON t.user_id = u.id
     GROUP BY t.user_id
     ORDER BY total_score DESC
     LIMIT ?`,
  )
    .bind(limit)
    .all<{ user_id: string; name: string; avatar_url: string | null; total_score: number; games_played: number }>();

  return json({ scores: results.results }, 200, request);
}

// GET /api/leaderboard/:game/user/:userId
async function getUserGameScore(game: string, userId: string, request: Request, env: Env): Promise<Response> {
  if (!VALID_GAMES.has(game)) {
    return json({ error: "Invalid game" }, 400, request);
  }

  // Get user's best score
  const best = await env.DB.prepare(
    `SELECT s.player_name, s.score, s.created_at, u.avatar_url
     FROM scores s
     LEFT JOIN users u ON s.user_id = u.id
     WHERE s.game_id = ? AND s.user_id = ?
     ORDER BY s.score DESC LIMIT 1`,
  )
    .bind(game, userId)
    .first<{ player_name: string; score: number; created_at: string; avatar_url: string | null }>();

  if (!best) {
    return json({ error: "No scores found" }, 404, request);
  }

  // Get rank (number of users with higher best scores)
  const rank = await env.DB.prepare(
    `SELECT COUNT(DISTINCT s2.user_id) as rank
     FROM scores s2
     WHERE s2.game_id = ? AND s2.user_id IS NOT NULL AND s2.score > ?`,
  )
    .bind(game, best.score)
    .first<{ rank: number }>();

  return json({
    game,
    user_id: userId,
    player_name: best.player_name,
    score: best.score,
    avatar_url: best.avatar_url,
    created_at: best.created_at,
    rank: (rank?.rank ?? 0) + 1,
  }, 200, request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Versioned alias: /v1/* maps to the same handlers as the unversioned
    // paths. Old game bundles call the unversioned routes; new ones use /v1.
    // Both must keep working — see platform/docs/API-CONTRACT.md (additive-only).
    const path = url.pathname.startsWith("/v1/") ? url.pathname.slice(3) : url.pathname;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(request) });
    }

    // POST /api/scores
    if (request.method === "POST" && path === "/api/scores") {
      return submitScore(request, env);
    }

    // GET /api/leaderboard/overall
    if (request.method === "GET" && path === "/api/leaderboard/overall") {
      return getOverallLeaderboard(url, request, env);
    }

    // GET /api/leaderboard/:game/user/:userId
    const userMatch = path.match(/^\/api\/leaderboard\/([\w-]+)\/user\/([\w-]+)$/);
    if (request.method === "GET" && userMatch?.[1] && userMatch[2]) {
      return getUserGameScore(userMatch[1], userMatch[2], request, env);
    }

    // GET /api/leaderboard/:game/recent
    const recentMatch = path.match(/^\/api\/leaderboard\/([\w-]+)\/recent$/);
    if (request.method === "GET" && recentMatch?.[1]) {
      return getRecent(recentMatch[1], url, request, env);
    }

    // GET /api/leaderboard/:game
    const lbMatch = path.match(/^\/api\/leaderboard\/([\w-]+)$/);
    if (request.method === "GET" && lbMatch?.[1]) {
      return getLeaderboard(lbMatch[1], url, request, env);
    }

    return json({ error: "Not found" }, 404, request);
  },
};
