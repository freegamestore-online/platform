interface Env {
  DB: D1Database;
}

const ALLOWED_ORIGIN = /^https:\/\/[\w-]+\.freegamestore\.online$/;
const MAX_NAME_LENGTH = 20;
const MAX_SCORE = 999_999_999;
const RATE_LIMIT_SECONDS = 10;
const LEADERBOARD_LIMIT = 50;

// Valid game IDs — update when adding new games
const VALID_GAMES = new Set([
  "chess", "puzzle", "tetris", "snake", "minesweeper", "2048",
  "slither", "racing", "bowling", "spaceshooter", "breakout", "platformer", "sudoku",
  "pacman", "pong", "flappy", "solitaire", "connect4", "wordle", "simon", "mahjong",
  "checkers", "hangman", "memory", "frogger", "match3", "whackamole", "wordsearch", "asteroids",
]);

function cors(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = ALLOWED_ORIGIN.test(origin) || origin === "http://localhost:5173";
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
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

// POST /api/scores { game, name, score }
async function submitScore(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400, request);
  }

  const { game, name, score } = body as Record<string, unknown>;

  if (typeof game !== "string" || !VALID_GAMES.has(game)) {
    return json({ error: "Invalid game" }, 400, request);
  }
  if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
    return json({ error: "Invalid score" }, 400, request);
  }

  const playerName = typeof name === "string"
    ? name.trim().slice(0, MAX_NAME_LENGTH).replace(/[<>&"']/g, "") || "Anonymous"
    : "Anonymous";

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const ipHash = await hashIP(ip);

  // Rate limit: 1 submission per game per RATE_LIMIT_SECONDS
  const recent = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM scores
     WHERE ip_hash = ? AND game_id = ?
     AND created_at > datetime('now', ?)`,
  )
    .bind(ipHash, game, `-${RATE_LIMIT_SECONDS} seconds`)
    .first<{ cnt: number }>();

  if (recent && recent.cnt > 0) {
    return json({ error: "Too fast, wait a few seconds" }, 429, request);
  }

  await env.DB.prepare(
    `INSERT INTO scores (game_id, player_name, score, ip_hash) VALUES (?, ?, ?, ?)`,
  )
    .bind(game, playerName, score, ipHash)
    .run();

  // Return the player's rank
  const rank = await env.DB.prepare(
    `SELECT COUNT(*) as rank FROM scores WHERE game_id = ? AND score > ?`,
  )
    .bind(game, score)
    .first<{ rank: number }>();

  return json({ ok: true, rank: (rank?.rank ?? 0) + 1 }, 201, request);
}

// GET /api/leaderboard/:game?limit=10
async function getLeaderboard(game: string, url: URL, request: Request, env: Env): Promise<Response> {
  if (!VALID_GAMES.has(game)) {
    return json({ error: "Invalid game" }, 400, request);
  }

  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitParam ?? "10", 10) || 10, 1), LEADERBOARD_LIMIT);

  const results = await env.DB.prepare(
    `SELECT player_name, score, created_at FROM scores
     WHERE game_id = ? ORDER BY score DESC LIMIT ?`,
  )
    .bind(game, limit)
    .all<{ player_name: string; score: number; created_at: string }>();

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
    `SELECT player_name, score, created_at FROM scores
     WHERE game_id = ? ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(game, limit)
    .all<{ player_name: string; score: number; created_at: string }>();

  return json({ game, scores: results.results }, 200, request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(request) });
    }

    // POST /api/scores
    if (request.method === "POST" && path === "/api/scores") {
      return submitScore(request, env);
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
