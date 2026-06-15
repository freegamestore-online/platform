import { handlePublish, handleUpdateGame, renderProvisionForm } from "./publish";
import { verifySession, handleAuthExchange, handleAuthMe } from "./auth";

interface Env {
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
  GITHUB_TOKEN: string;
  /** This admin's OWN HS256 signing key — it mints + verifies its own
   *  sessions via /v1/auth/exchange (not shared with FAS). */
  SESSION_SIGNING_KEY: string;
  /** Shared `fas` D1 — fgs/host reads from this same table. */
  DB: D1Database;
}

/** Extract the authenticated GitHub login from:
 *  1. Bearer admin session token (CLI / MCP)
 *  2. fgs_token cookie verified via auth worker /me (console) */
async function authenticateLogin(request: Request, env: Env): Promise<string | null> {
  // Try Bearer first (admin-minted JWT)
  const auth = request.headers.get("Authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    const login = await verifySession(auth.slice(7), env.SESSION_SIGNING_KEY);
    if (login) return login;
  }
  // Fall back to fgs_token cookie — verify by calling auth worker's /me
  const cookie = request.headers.get("Cookie") ?? "";
  if (cookie.includes("fgs_token=")) {
    try {
      const meRes = await fetch("https://auth.freegamestore.online/me", {
        headers: { Cookie: cookie },
      });
      if (meRes.ok) {
        const user = await meRes.json() as { id?: string; name?: string };
        // Auth worker /me returns { id, name, avatar }. The id is the GitHub user id
        // (e.g. "github:12345" for GH users). Extract the login from it.
        // For GitHub users the login isn't in /me — but we stored it in the JWT.
        // Parse the cookie JWT payload to get login (unsigned, just for the login value —
        // the auth worker already verified the signature by returning 200).
        const token = cookie.match(/fgs_token=([^;]*)/)?.[1];
        if (token) {
          const parts = token.split(".");
          if (parts.length === 3) {
            const payload = JSON.parse(atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { login?: string; sub?: string };
            return payload.login ?? payload.sub ?? null;
          }
        }
        return user.id ?? null;
      }
    } catch { /* fall through */ }
  }
  return null;
}

interface GameConfig {
  id: string;
  name: string;
  org: string;
  cfProject: string;
  domain: string;
}

interface QualityGame {
  id: string;
  score: number;
  loadTimeMs: number;
  consoleErrors: string[];
}

interface QualityData {
  timestamp: string;
  games: QualityGame[];
}

const REGISTRY_URL = "https://raw.githubusercontent.com/freegamestore-online/freegamestore/main/registry.json";
const QUALITY_URL = "https://raw.githubusercontent.com/freegamestore-online/freegamestore/main/data/quality-results.json";
const ORG = "freegamestore-online";
const DOMAIN = "freegamestore.online";

async function fetchRegistry(): Promise<GameConfig[]> {
  const res = await fetch(REGISTRY_URL, { headers: { "User-Agent": "freegamestore-admin" } });
  if (!res.ok) return [];
  const data = await res.json() as any;
  const items = data.games || [];
  return items.map((item: any) => ({
    id: item.id,
    name: item.name,
    org: ORG,
    cfProject: item.cfProject || `free${item.id}app`,
    domain: `${item.id}.${DOMAIN}`,
  }));
}

async function fetchQuality(): Promise<QualityData | null> {
  try {
    const res = await fetch(QUALITY_URL, { headers: { "User-Agent": "freegamestore-admin" } });
    if (!res.ok) return null;
    return await res.json() as QualityData;
  } catch {
    return null;
  }
}

async function fetchGameStatus(game: GameConfig, env: Env) {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/pages/projects/${game.cfProject}`,
      { headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` } }
    );
    const data = await res.json() as any;

    if (!data.success) {
      return {
        cf: {
          deploy: { status: "no_project", time: null, url: null, error: `Project "${game.cfProject}" not found` },
          domain: { status: "unknown", cert: "unknown", error: null },
          source: null,
        },
      };
    }

    const project = data.result;
    const lastDeploy = project.latest_deployment;
    const source = project.source;
    const domains = project.domains || [];
    const customDomain = domains.find((d: string) => d === game.domain);

    let deployError: string | null = null;
    if (lastDeploy?.latest_stage?.status === "failure") {
      deployError = `${lastDeploy.latest_stage.name || "Build"} failed`;
    }

    return {
      cf: {
        deploy: lastDeploy
          ? {
              status: lastDeploy.latest_stage?.status || "unknown",
              time: lastDeploy.created_on,
              url: lastDeploy.url,
              error: deployError,
              trigger: lastDeploy.deployment_trigger?.type || "unknown",
              commitMsg: lastDeploy.deployment_trigger?.metadata?.commit_message?.slice(0, 60) || null,
            }
          : { status: "none", time: null, url: null, error: "No deployments yet" },
        domain: customDomain
          ? { status: "active", cert: "active", error: null }
          : { status: "not_configured", cert: "none", error: "Custom domain not in project" },
        source: source
          ? { type: source.type, owner: source.config?.owner, repo: source.config?.repo_name, enabled: source.config?.deployments_enabled }
          : null,
      },
    };
  } catch (e) {
    return {
      cf: { deploy: { status: "error", time: null, url: null, error: String(e) }, domain: { status: "error", cert: "error", error: String(e) }, source: null },
    };
  }
}

async function fetchAllStatus(env: Env) {
  const games = await fetchRegistry();
  const results = await Promise.all(
    games.map(async (game) => {
      const status = await fetchGameStatus(game, env);
      return { ...game, ...status };
    })
  );
  return results;
}

function renderDashboardShell(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Admin -- FreeGameStore</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f0f0f; color: #e5e5e5; padding: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    .meta { color: #888; font-size: 0.85rem; margin-bottom: 1.5rem; }
    .stats { display: flex; gap: 1rem; margin-bottom: 2rem; flex-wrap: wrap; }
    .stat { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 0.75rem; padding: 1rem 1.5rem; }
    .stat .num { font-size: 2rem; font-weight: 700; }
    .stat .label { font-size: 0.8rem; color: #888; }
    h2 { font-size: 1.2rem; margin: 2rem 0 0.75rem; padding-bottom: 0.5rem; border-bottom: 1px solid #2a2a2a; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th { text-align: left; padding: 0.5rem; color: #888; font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #2a2a2a; }
    td { padding: 0.6rem 0.5rem; border-bottom: 1px solid #1a1a1a; vertical-align: top; }
    tr:hover { background: #1a1a1a; }
    a { color: #34d399; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .green { color: #34d399; }
    .red { color: #f87171; }
    .yellow { color: #fbbf24; }
    .gray { color: #888; }
    .refresh { background: #10b981; color: white; border: none; padding: 0.5rem 1rem; border-radius: 0.5rem; cursor: pointer; font-size: 0.85rem; }
    .refresh:hover { background: #059669; }
    .loading { color: #fbbf24; }
    .filter-chip { background: #1a1a1a; border: 1px solid #2a2a2a; color: #888; padding: 0.25rem 0.6rem; border-radius: 1rem; cursor: pointer; font-size: 0.75rem; }
    .filter-chip.active { background: #10b981; border-color: #10b981; color: white; }
    .letter-btn { background: #1a1a1a; border: 1px solid #2a2a2a; color: #888; width: 1.5rem; height: 1.5rem; border-radius: 0.25rem; cursor: pointer; font-size: 0.7rem; display: flex; align-items: center; justify-content: center; }
    .letter-btn.active { background: #10b981; border-color: #10b981; color: white; }
    .quality-score { font-weight: 700; font-size: 0.9rem; }
    .q-green { color: #34d399; }
    .q-yellow { color: #fbbf24; }
    .q-red { color: #f87171; }
    .q-gray { color: #555; }
  </style>
</head>
<body>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
    <div>
      <h1>FreeGameStore Admin</h1>
      <div class="meta" id="meta">Loading...</div>
    </div>
    <button class="refresh" onclick="loadAll()">Refresh</button>
  </div>
  <div class="stats" id="stats"></div>

  <!-- Filter bar -->
  <div style="margin-bottom:1rem;display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">
    <input id="search" type="text" placeholder="Search..." oninput="applyFilter()" style="padding:0.4rem 0.8rem;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:0.5rem;color:#e5e5e5;font-size:0.85rem;width:200px;" />
    <span style="color:#888;font-size:0.8rem;margin-left:0.5rem;">Filter:</span>
    <button class="filter-chip active" onclick="setFilter('all')">All</button>
    <button class="filter-chip" onclick="setFilter('healthy')">Healthy</button>
    <button class="filter-chip" onclick="setFilter('issues')">Issues</button>
    <span id="letterBar" style="margin-left:0.5rem;display:flex;gap:2px;flex-wrap:wrap;"></span>
  </div>

  <table><tr><th>Name</th><th>Status</th><th>Quality</th><th>Load</th><th>URL</th><th>Repo</th></tr><tbody id="dataTable"><tr><td colspan="6" class="loading">Loading...</td></tr></tbody></table>

  <script>
    var gameData=[];
    var qualityMap={};
    var liveStatus={};
    var currentFilter='all';
    var currentLetter='';

    function qualityClass(score){
      if(score>=95)return 'q-green';
      if(score>=80)return 'q-yellow';
      return 'q-red';
    }

    function row(d){
      var live=liveStatus[d.domain];
      var dot=live==='ok'?'<span class="green">LIVE</span>':live==='fail'?'<span class="red">DOWN</span>':live==='checking'?'<span class="yellow">...</span>':'<span class="gray">--</span>';
      var q=qualityMap[d.id];
      var scoreCell=q?'<span class="quality-score '+qualityClass(q.score)+'">'+q.score+'</span>':'<span class="q-gray">--</span>';
      var loadCell=q?q.loadTimeMs+'ms':'<span class="q-gray">--</span>';
      return '<tr data-name="'+d.name.toLowerCase()+'" data-live="'+(live==='ok'?'1':'0')+'"><td><strong>'+d.name+'</strong><br><small style="color:#888">'+d.id+'</small></td><td>'+dot+'</td><td>'+scoreCell+'</td><td>'+loadCell+'</td><td><a href="https://'+d.domain+'" target="_blank">'+d.domain+'</a></td><td><a href="https://github.com/'+d.org+'/'+d.id+'" target="_blank" style="font-size:0.8rem">'+d.org+'/'+d.id+'</a></td></tr>';
    }

    function setFilter(f){
      currentFilter=f;
      document.querySelectorAll('.filter-chip').forEach(function(c){c.classList.toggle('active',c.textContent.toLowerCase()===f)});
      renderTable();
    }
    function setLetter(l){
      currentLetter=currentLetter===l?'':l;
      document.querySelectorAll('.letter-btn').forEach(function(b){b.classList.toggle('active',b.textContent===currentLetter)});
      renderTable();
    }
    function buildLetterBar(){
      var letters=[...new Set(gameData.map(function(d){return d.name[0].toUpperCase()}))].sort();
      document.getElementById('letterBar').innerHTML=letters.map(function(l){return '<button class="letter-btn" onclick="setLetter(\\x27'+l+'\\x27)">'+l+'</button>'}).join('');
    }
    function applyFilter(){renderTable()}
    function renderTable(){
      var data=gameData;
      var search=document.getElementById('search').value.toLowerCase();
      var tbody=document.getElementById('dataTable');
      var filtered=data;
      if(search)filtered=filtered.filter(function(d){return d.name.toLowerCase().includes(search)||d.id.includes(search)});
      if(currentLetter)filtered=filtered.filter(function(d){return d.name[0].toUpperCase()===currentLetter});
      if(currentFilter==='healthy')filtered=filtered.filter(function(d){return liveStatus[d.domain]==='ok'});
      if(currentFilter==='issues')filtered=filtered.filter(function(d){return liveStatus[d.domain]==='fail'});
      tbody.innerHTML=filtered.length?filtered.map(row).join(''):'<tr><td colspan="6" style="color:#888">No results</td></tr>';
    }

    async function checkLive(domain){
      liveStatus[domain]='checking';
      try{
        await fetch('https://'+domain+'/',{mode:'no-cors',cache:'no-store'});
        liveStatus[domain]='ok';
      }catch(e){liveStatus[domain]='fail'}
    }

    async function loadAll(){
      document.getElementById('meta').textContent='Loading registry...';
      document.getElementById('dataTable').innerHTML='<tr><td colspan="6" class="loading">Loading...</td></tr>';
      var t0=Date.now();
      try{
        var [gamesRes,qualityRes]=await Promise.all([
          fetch('/api/status',{credentials:'include'}),
          fetch('/api/quality',{credentials:'include'})
        ]);
        if(!gamesRes.ok){document.getElementById('meta').textContent='API error';return}
        gameData=await gamesRes.json();
        qualityMap={};
        if(qualityRes.ok&&qualityRes.status!==204){
          var qd=await qualityRes.json();
          if(qd&&qd.games){qd.games.forEach(function(g){qualityMap[g.id]=g})}
        }
      }catch(e){document.getElementById('meta').textContent='Error: '+e;return}

      // Compute avg quality
      var qScores=gameData.map(function(d){return qualityMap[d.id]}).filter(Boolean);
      var avgQ=qScores.length?Math.round(qScores.reduce(function(s,g){return s+g.score},0)/qScores.length):0;
      var avgLabel=qScores.length?avgQ:'--';

      document.getElementById('stats').innerHTML='<div class="stat"><div class="num">'+gameData.length+'</div><div class="label">Total Games</div></div><div class="stat"><div class="num">--</div><div class="label">Live</div></div><div class="stat"><div class="num'+(qScores.length?' '+(avgQ>=95?'green':avgQ>=80?'yellow':'red'):'')+'">'+(qScores.length?avgQ:'--')+'</div><div class="label">Avg Quality</div></div>';
      document.getElementById('meta').textContent='Loaded in '+(Date.now()-t0)+'ms -- checking liveness...';
      buildLetterBar();renderTable();

      // Check liveness in parallel batches of 10
      for(var i=0;i<gameData.length;i+=10){
        var batch=gameData.slice(i,i+10);
        await Promise.all(batch.map(function(d){return checkLive(d.domain)}));
        renderTable();
      }
      var ok=gameData.filter(function(d){return liveStatus[d.domain]==='ok'}).length;
      document.getElementById('stats').innerHTML='<div class="stat"><div class="num">'+gameData.length+'</div><div class="label">Total Games</div></div><div class="stat"><div class="num green">'+ok+'</div><div class="label">Live</div></div><div class="stat"><div class="num red">'+(gameData.length-ok)+'</div><div class="label">Down</div></div><div class="stat"><div class="num'+(qScores.length?' '+(avgQ>=95?'green':avgQ>=80?'yellow':'red'):'')+'">'+(qScores.length?avgQ:'--')+'</div><div class="label">Avg Quality</div></div>';
      document.getElementById('meta').textContent='Done in '+(Date.now()-t0)+'ms';
    }
    loadAll();
  </script>
</body>
</html>`;
}

function renderApiDocs(): string {
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
  <p>All endpoints require <span class="badge auth">Cloudflare Access</span> authentication -- either Google sign-in (browser) or service token headers.</p>

  <hr>

  <h2>Authentication</h2>
  <h3>Browser (Google sign-in)</h3>
  <p>Visit <a href="https://admin.freegamestore.online">admin.freegamestore.online</a> -- Cloudflare Access prompts Google sign-in. Only authorized emails can access.</p>

  <h3>Service Token (for AI agents / scripts)</h3>
  <pre>CF-Access-Client-Id: &lt;client-id&gt;
CF-Access-Client-Secret: &lt;client-secret&gt;</pre>
  <p>Service tokens are managed in Cloudflare Zero Trust dashboard. Contact admin to get a token.</p>

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
  <p>Add <code>?detail=true</code> for full CF Pages deploy status (slower -- makes CF API calls per game).</p>

  <h3><span class="method get">GET</span> /api/status/game</h3>
  <p>Returns CF deploy status for a single game.</p>
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
  <p>Provisions a new game. Creates GitHub repo from template, CF Pages project with GitHub integration, DNS CNAME, custom domain, and adds to the store registry.</p>

  <pre>POST /api/provision
Content-Type: application/json

{
  "id": "chess",
  "name": "Chess",
  "category": "strategy",
  "icon": "&amp;#9812;",
  "iconBg": "#ecfdf5",
  "description": "Classic chess game"
}

Response: {
  "steps": [
    { "name": "GitHub repo", "status": "ok", "detail": "Created freegamestore-online/chess from template-game-canvas" },
    { "name": "CF Pages project", "status": "ok", "detail": "Created freechessapp with GitHub source" },
    { "name": "Custom domain", "status": "ok", "detail": "Added chess.freegamestore.online" },
    { "name": "DNS CNAME", "status": "ok", "detail": "chess -> freechessapp.pages.dev" },
    { "name": "Store registry", "status": "ok", "detail": "Added Chess" }
  ],
  "success": true
}</pre>
  <p>Step statuses: <code>ok</code> (created), <code>skip</code> (already exists), <code>fail</code> (error -- check detail).</p>

  <hr>

  <h2>Workflow</h2>
  <pre>
1. POST /api/provision  ->  creates everything
2. Clone the repo       ->  git clone git@github.com:freegamestore-online/chess.git
3. Write code           ->  edit src/App.tsx
4. Push to main         ->  git push (auto-deploys, no API call)
5. GET /api/status      ->  verify deployment succeeded</pre>

  <p style="margin-top:1rem"><a href="/">&larr; Back to Dashboard</a></p>
</body>
</html>`;
}

const CORS_ORIGIN = /^https:\/\/[\w-]+\.freegamestore\.online$/;

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = CORS_ORIGIN.test(origin) || origin === "https://freegamestore.online" || origin === "http://localhost:5173";
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(data: unknown, status: number, request: Request): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(request) },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    // Self-contained auth: exchange a GitHub token for an FGS admin session,
    // then verify it. `fgs login` calls /v1/auth/exchange.
    if (url.pathname === "/v1/auth/exchange" && request.method === "POST") {
      return handleAuthExchange(request, env);
    }
    if (url.pathname === "/v1/auth/me" && request.method === "GET") {
      return handleAuthMe(request, env);
    }

    if (url.pathname === "/docs") {
      return new Response(renderApiDocs(), { headers: { "Content-Type": "text/html" } });
    }

    if (url.pathname === "/api/status") {
      const detail = url.searchParams.get("detail") === "true";
      if (detail) {
        const data = await fetchAllStatus(env);
        return jsonResponse(data, 200, request);
      }
      const games = await fetchRegistry();
      return jsonResponse(games, 200, request);
    }

    if (url.pathname === "/api/status/game") {
      const id = url.searchParams.get("id");
      if (!id) {
        return jsonResponse({ error: "id required" }, 400, request);
      }
      const games = await fetchRegistry();
      const game = games.find(g => g.id === id);
      if (!game) {
        return jsonResponse({ error: "not found" }, 404, request);
      }
      const status = await fetchGameStatus(game, env);
      return jsonResponse({ ...game, ...status }, 200, request);
    }

    if (url.pathname === "/api/quality") {
      const data = await fetchQuality();
      if (!data) {
        return new Response(null, { status: 204, headers: corsHeaders(request) });
      }
      return jsonResponse(data, 200, request);
    }

    // PATCH /api/games/:id — update game metadata (name, description, category)
    const gameMatch = url.pathname.match(/^\/api\/games\/([a-z0-9][a-z0-9-]*)$/);
    if (gameMatch && request.method === "PATCH") {
      const login = await authenticateLogin(request, env);
      if (!login) {
        return jsonResponse({ error: "unauthorized" }, 401, request);
      }
      try {
        const body = await request.json() as Record<string, unknown>;
        const result = await handleUpdateGame(gameMatch[1]!, login, body, env as any);
        return jsonResponse(result, result.error ? 400 : 200, request);
      } catch (e) {
        return jsonResponse({ error: String(e) }, 500, request);
      }
    }

    if ((url.pathname === "/api/provision" || url.pathname === "/api/publish") && request.method === "POST") {
      // HS256 Bearer session check. Without this, anyone reachable to
      // admin.freegamestore.online can provision repos in freegamestore-online
      // and mint CF resources. Add CF Access in front for defense-in-depth.
      const authHeader = request.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return jsonResponse({ error: "unauthorized" }, 401, request);
      }
      const login = await verifySession(authHeader.slice(7), env.SESSION_SIGNING_KEY);
      if (!login) {
        return jsonResponse({ error: "invalid or expired session" }, 401, request);
      }
      try {
        const body = await request.json() as any;
        const result = await handlePublish({ ...body, creatorGithub: body.creatorGithub || login }, env as any);
        return jsonResponse(result, result.success ? 200 : 400, request);
      } catch (e) {
        return jsonResponse({ error: String(e) }, 500, request);
      }
    }

    // Render dashboard with provision form
    let html = renderDashboardShell();
    html = html.replace("</body>", renderProvisionForm() + "</body>");
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  },
};
