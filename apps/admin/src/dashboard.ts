/**
 * Admin API docs page (static HTML). The interactive console is now the React
 * app in web/ (built into public/, served via Workers Static Assets behind the
 * admin auth gate) — the old inline renderDashboardShell was removed with it.
 */

export function renderApiDocs(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>API Docs -- FreeGameStore Admin</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f0f0f;color:#e5e5e5;padding:2rem;max-width:800px;margin:0 auto;line-height:1.6}
    h1{font-size:1.5rem;margin-bottom:0.5rem}
    h2{font-size:1.2rem;margin:2.5rem 0 0.75rem;color:#34d399}
    h3{font-size:1rem;margin:1.5rem 0 0.5rem}
    p{margin-bottom:0.75rem;color:#ccc}
    code{background:#1a1a1a;padding:0.15rem 0.4rem;border-radius:0.25rem;font-size:0.85rem}
    pre{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:0.75rem;padding:1rem;margin:0.75rem 0;overflow-x:auto;font-size:0.85rem;line-height:1.5}
    .method{display:inline-block;padding:0.2rem 0.5rem;border-radius:0.25rem;font-weight:700;font-size:0.75rem;margin-right:0.5rem}
    .get{background:#1a4731;color:#34d399}
    .post{background:#1e3a5f;color:#60a5fa}
    a{color:#34d399}
    .badge{display:inline-block;padding:0.15rem 0.5rem;border-radius:1rem;font-size:0.7rem;font-weight:600}
    .auth{background:#2d1f0f;color:#fbbf24}
    hr{border:none;border-top:1px solid #2a2a2a;margin:2rem 0}
  </style>
</head>
<body>
  <h1>FreeGameStore Admin API</h1>
  <p>Base URL: <code>https://admin.freegamestore.online</code></p>
  <p>The console and every read/observability endpoint are restricted to <span class="badge auth">admin</span> — a signed-in, allowlisted Google email. The creator-facing publish endpoints use their own per-caller auth (see below). No Cloudflare Access is involved.</p>

  <hr>

  <h2>Authentication</h2>
  <h3>Admin console + read endpoints (Google sign-in)</h3>
  <p>Visit <a href="https://admin.freegamestore.online">admin.freegamestore.online</a> and sign in with Google. Only emails in the <code>ADMIN_EMAILS</code> allowlist can access; everyone else gets a sign-in / not-authorized page. Identity is a verified Google email resolved via the auth worker's <code>/me</code>; the browser carries the <code>fgs_token</code> cookie (set on <code>.freegamestore.online</code>).</p>
  <p>Gated: <code>/</code>, <code>/docs</code>, <code>/api/status*</code>, <code>/api/quality</code>, <code>/api/errors</code>, <code>/api/stats</code>, <code>/api/users</code>, <code>/api/reconcile</code>.</p>

  <h3>Publish endpoints (creators + the VibeCode agent)</h3>
  <p><code>/api/provision</code>, <code>/api/publish</code>, and <code>PATCH/DELETE /api/games/:id</code> are NOT admin-gated — creators self-serve. They accept a signed-in creator's <code>fgs_token</code> (cookie or <code>X-FGS-Token</code>), or, for worker-to-worker calls (the agent's VibeCode deploy, which has no user token), a shared <code>X-Internal-Token</code>. On the internal path the owner is taken from the request body's <code>creatorGithub</code>.</p>

  <hr>

  <h2>Endpoints</h2>

  <h3><span class="method get">GET</span> /api/status</h3>
  <p>Returns registry data for all games.</p>
  <pre>GET /api/status

Response: [
  {
    "id": "chess",
    "name": "Chess",
    "org": "freegamestore-online",
    "cfProject": "freechessapp",
    "domain": "chess.freegamestore.online"
  }
]</pre>
  <p>Add <code>?detail=true</code> for full deploy status (slower -- makes a status call per game).</p>

  <h3><span class="method get">GET</span> /api/status/game</h3>
  <p>Returns deploy status for a single game.</p>
  <pre>GET /api/status/game?id=chess</pre>

  <h3><span class="method get">GET</span> /api/quality</h3>
  <p>Returns quality audit results for all games (proxied from GitHub).</p>
  <pre>GET /api/quality

Response: {
  "timestamp": "2026-05-08T...",
  "games": [
    { "id": "chess", "score": 88, "loadTimeMs": 1200, "consoleErrors": [] }
  ]
}</pre>
  <p>Returns <code>204 No Content</code> if the auditor has not produced results yet.</p>

  <h3><span class="method post">POST</span> /api/provision</h3>
  <p>Provisions a new game (Path B — no CF Pages). Creates a GitHub repo from <code>template-game-canvas</code>, adds the creator as a collaborator, writes a host route to D1, and adds the store registry entry. The <code>fgs/host</code> worker then serves the built game from the <code>fgs-games</code> R2 bucket at <code>&lt;id&gt;.freegamestore.online</code> — there is no per-game CF Pages project, DNS record, or <code>.pages.dev</code>.</p>

  <pre>POST /api/provision
Content-Type: application/json

{
  "id": "chess",
  "name": "Chess",
  "category": "strategy",
  "icon": "&amp;#9812;",
  "iconBg": "#ecfdf5",
  "description": "Classic chess game",
  "creatorGithub": "octocat"
}

Response: {
  "steps": [
    { "name": "GitHub repo", "status": "ok", "detail": "Created freegamestore-online/chess from template-game-canvas" },
    { "name": "Collaborator", "status": "ok", "detail": "Invited octocat" },
    { "name": "Host route", "status": "ok", "detail": "chess -> r2 (fgs-games/games/chess)" },
    { "name": "Store registry", "status": "ok", "detail": "Added Chess" }
  ],
  "success": true
}</pre>
  <p>Step statuses: <code>ok</code> (created), <code>skip</code> (already exists), <code>fail</code> (error -- check detail). Idempotent: re-provisioning an existing id skips rather than fails.</p>

  <h3><span class="method post">POST</span> /api/admin/transfer-owner</h3>
  <p>Admin only (Google sign-in). Moves a game's registry owner (<code>creatorGithub</code>). Compare-and-set: applied only if the current owner equals <code>from_login</code>, otherwise 409 with the actual <code>owner_login</code>. Unknown game: 404. <code>to_login</code> must be a GitHub user account, not an organization (400). If the registry stays contended, nothing changes and the answer is 503: retry. A signed-in non-admin gets 403. Every transfer is recorded in the registry commit message and in the <code>game_owner_transfers</code> D1 table. After the registry commit, <code>to_login</code> is granted push on the game repo and <code>from_login</code>'s direct collaborator grant and pending invite are revoked, unless <code>"keep_previous_access": true</code>. Each step is reported in <code>collaborators</code>; a failed step never undoes the transfer, and <code>from_login</code> keeps access when the grant to <code>to_login</code> failed. Repos outside the org are not touched. Undo is the same call with the logins swapped. <code>GET /api/admin/transfer-owner?game_id=…</code> lists a game's transfers. CLI: <code>fgs admin transfer-owner</code>.</p>
  <pre>{ "game_id": "chess", "from_login": "alice", "to_login": "bob", "reason": "handover" }</pre>

  <hr>

  <h2>Workflow</h2>
  <pre>
1. POST /api/provision  ->  repo + collaborator + host route + registry
2. Push code to main    ->  GitHub Actions builds web/ and uploads to R2
3. Host serves it        ->  https://&lt;id&gt;.freegamestore.online (from R2)
4. GET /api/status      ->  verify the game is registered + routed</pre>
  <p>Creators normally never call this directly — they use the console (VibeCode / create form) or the <code>fgs</code> CLI, which funnel through here.</p>

  <p style="margin-top:1rem"><a href="/">&larr; Back to Dashboard</a></p>
</body>
</html>`;
}
