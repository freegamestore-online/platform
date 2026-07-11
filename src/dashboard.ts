/**
 * Admin console HTML — the dashboard shell (client-side app served to the
 * admin's browser) and the API docs page. Extracted verbatim from index.ts to
 * keep the worker's routing/logic file readable. Both are self-contained static
 * strings (no server-side interpolation); the interactive behaviour lives in the
 * inline <script> that runs in the browser.
 */

export function renderDashboardShell(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Admin -- FreeGameStore</title>
  <script>try{var _v=localStorage.getItem('fgs_admin_textsize');if(_v){document.documentElement.style.fontSize=({sm:14,md:16,lg:18,xl:20}[_v]||16)+'px'}}catch(e){}</script>
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
    .tabs { display: flex; gap: 0.25rem; margin-bottom: 1.5rem; border-bottom: 1px solid #2a2a2a; flex-wrap: wrap; }
    .tab { background: none; border: none; color: #888; padding: 0.6rem 1rem; cursor: pointer; font-size: 0.9rem; border-bottom: 2px solid transparent; font-family: inherit; }
    .tab.active { color: #34d399; border-bottom-color: #34d399; }
    .tabpanel { display: none; }
    .tabpanel.active { display: block; }
    .bar { display: inline-block; border-radius: 2px 2px 0 0; min-height: 1px; transition: height 0.2s; }
    .src-tag { font-size: 0.7rem; padding: 0.1rem 0.4rem; border-radius: 0.25rem; background: #2a2a2a; color: #ccc; white-space: nowrap; }
    pre.stack { white-space: pre-wrap; font-size: 0.72rem; color: #fca5a5; margin-top: 0.35rem; max-height: 9rem; overflow: auto; background: #140f0f; padding: 0.5rem; border-radius: 0.35rem; }
    /* Sticky top nav (breaks out of the body's 2rem padding to sit flush). */
    .topnav { position: sticky; top: 0; z-index: 50; margin: -2rem -2rem 1.5rem; padding: 0.6rem 1.5rem; display: flex; align-items: center; gap: 1rem; background: #141414; border-bottom: 1px solid #2a2a2a; }
    .brand { font-weight: 800; font-size: 1.05rem; letter-spacing: -0.01em; }
    .brand .accent { color: #34d399; }
    .brand .tag { color: #888; font-weight: 600; font-size: 0.68rem; border: 1px solid #2a2a2a; padding: 0.1rem 0.4rem; border-radius: 0.35rem; margin-left: 0.5rem; text-transform: uppercase; letter-spacing: 0.06em; vertical-align: middle; }
    .navlinks { display: flex; align-items: center; gap: 0.25rem; margin-left: auto; }
    .navlinks .refresh { margin-left: 0.5rem; }
    .sizesel { background: #1a1a1a; color: #e5e5e5; border: 1px solid #2a2a2a; border-radius: 0.4rem; padding: 0.35rem 0.4rem; font-size: 0.8rem; font-family: inherit; cursor: pointer; }
    .hamburger { display: none; margin-left: auto; background: none; border: 1px solid #2a2a2a; color: #e5e5e5; border-radius: 0.4rem; padding: 0.3rem 0.6rem; cursor: pointer; font-size: 1.15rem; line-height: 1; font-family: inherit; }
    @media (max-width: 720px) {
      .hamburger { display: block; }
      .navlinks { display: none; position: absolute; top: 100%; left: 0; right: 0; flex-direction: column; align-items: stretch; gap: 0; margin: 0; padding: 0.4rem; background: #141414; border-bottom: 1px solid #2a2a2a; box-shadow: 0 8px 20px rgba(0,0,0,0.4); }
      .navlinks.open { display: flex; }
      .navlinks .tab, .navlinks .refresh { width: 100%; text-align: left; border-bottom: 1px solid #1a1a1a; border-radius: 0; margin: 0; }
    }
  </style>
</head>
<body>
  <header class="topnav">
    <div class="brand">Free<span class="accent">Game</span>Store<span class="tag">Admin</span></div>
    <button class="hamburger" onclick="toggleNav()" aria-label="Menu" aria-expanded="false">&#9776;</button>
    <nav class="navlinks" id="navlinks">
      <button class="tab active" data-tab="overview" onclick="showTab('overview')">Overview</button>
      <button class="tab" data-tab="games" onclick="showTab('games')">Games</button>
      <button class="tab" data-tab="errors" onclick="showTab('errors')">Errors <span id="errBadge"></span></button>
      <button class="tab" data-tab="users" onclick="showTab('users')">Users</button>
      <button class="tab" data-tab="sessions" onclick="showTab('sessions')">Sessions</button>
      <button class="tab" data-tab="provision" onclick="showTab('provision')">Provision</button>
      <a class="tab" href="/docs" style="text-decoration:none;">API</a>
      <select class="sizesel" id="txtSize" onchange="setSize(this.value)" title="Text size" aria-label="Text size" style="margin-left:0.5rem;">
        <option value="sm">A·S</option>
        <option value="md">A·M</option>
        <option value="lg">A·L</option>
        <option value="xl">A·XL</option>
      </select>
      <button class="refresh" onclick="refreshActive()">Refresh</button>
    </nav>
  </header>

  <div class="meta" id="meta" style="margin-bottom:1rem;">Ready</div>

  <div id="tab-overview" class="tabpanel active">
    <div class="stats" id="ovStats"><span class="loading">Loading...</span></div>
    <h2>Errors (last 14 days)</h2>
    <div id="ovChart" style="display:flex;align-items:flex-end;gap:4px;height:140px;padding:1rem 0;"></div>
  </div>

  <div id="tab-games" class="tabpanel">
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
  </div>

  <div id="tab-errors" class="tabpanel">
    <h2>Errors &amp; Crashes</h2>
    <p class="meta">Persisted from the create Pages Function and admin provisioning. Newest first.</p>
    <table><tr><th>When</th><th>Source</th><th>User</th><th>Message</th><th>Context</th></tr><tbody id="errTable"><tr><td colspan="5" class="loading">--</td></tr></tbody></table>
  </div>

  <div id="tab-users" class="tabpanel">
    <h2>Registered users <span id="userCount" class="gray"></span></h2>
    <p class="meta">Everyone who has signed in — including users who haven't published a game. To let someone build with a paid model, click <strong>Add key</strong> on their row and paste an API key. It goes into their account, and their studio uses it automatically — nothing else to set up.</p>
    <table><tr><th>User</th><th>ID</th><th>Registered</th><th>Keys</th><th></th></tr><tbody id="allUsersTable"><tr><td colspan="5" class="loading">--</td></tr></tbody></table>

    <div id="keyModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:100;align-items:center;justify-content:center">
      <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:0.75rem;padding:1.25rem;max-width:440px;width:90%">
        <h3 style="margin-bottom:0.75rem">Add API key for <span id="keyModalUser"></span></h3>
        <label class="meta">Provider</label>
        <select id="keyModalProvider" style="margin:0.25rem 0 0.75rem"><option value="anthropic">Anthropic (Claude)</option><option value="openai">OpenAI</option><option value="google">Google (Gemini)</option><option value="github">GitHub Models</option></select>
        <label class="meta">API key (paste it — stored encrypted, never shown again)</label>
        <input id="keyModalKey" type="password" placeholder="sk-ant-..." autocomplete="off" style="margin-top:0.25rem" />
        <div id="keyModalMsg" class="meta" style="margin-top:0.5rem"></div>
        <div style="display:flex;gap:0.5rem;margin-top:0.9rem">
          <button class="addkey-btn" onclick="saveKey()">Save key</button>
          <button onclick="closeKeyModal()" style="background:#2a2a2a;color:#ccc;border:1px solid #3a3a3a;border-radius:0.35rem;padding:0.4rem 0.75rem;cursor:pointer;font-size:0.85rem">Cancel</button>
        </div>
      </div>
    </div>

    <h2 style="margin-top:2rem">Creators</h2>
    <p class="meta">Derived from the store registry (creatorGithub), most games first.</p>
    <table><tr><th>GitHub</th><th>Games</th><th>Game IDs</th></tr><tbody id="userTable"><tr><td colspan="3" class="loading">--</td></tr></tbody></table>

    <style>
    .compform{display:flex;flex-wrap:wrap;gap:0.5rem;margin:0.75rem 0;align-items:center}
    .compform input,.compform select{background:#1a1a1a;color:#e5e5e5;border:1px solid #2a2a2a;border-radius:0.35rem;padding:0.4rem 0.5rem;font-size:0.85rem}
    .compform button,#compTable button,.grant-btn,.revoke-btn{background:#1e3a5f;color:#93c5fd;border:1px solid #2a4a6f;border-radius:0.35rem;padding:0.4rem 0.75rem;cursor:pointer;font-size:0.85rem}
    #compTable button,.revoke-btn{background:#3a1e1e;color:#fca5a5;border-color:#5a2a2a}
    .addkey-btn{background:#14342a;color:#6ee7b7;border:1px solid #1f5140;border-radius:0.35rem;padding:0.4rem 0.75rem;cursor:pointer;font-size:0.85rem;font-weight:600}
    .keychip{display:inline-flex;align-items:center;gap:0.25rem;background:#14342a;color:#6ee7b7;border:1px solid #1f5140;border-radius:0.35rem;padding:0.1rem 0.4rem;font-size:0.78rem;margin:0 0.15rem 0.15rem 0}
    .keychip button{background:none;border:none;color:#6ee7b7;cursor:pointer;font-size:0.95rem;padding:0;line-height:1}
    #keyModal input,#keyModal select{background:#0f0f0f;color:#e5e5e5;border:1px solid #2a2a2a;border-radius:0.35rem;padding:0.5rem;font-size:0.9rem;width:100%}
    </style>
    <h2 style="margin-top:2rem">Complimentary access</h2>
    <p class="meta">Grant select users free builds on a platform-funded key. A grant only kicks in when the user has <em>no key of their own</em> (BYO always wins) and no game is charged to them. <span id="compFunded" class="gray"></span></p>
    <div class="compform">
      <input id="compLogin" placeholder="github-login" autocomplete="off" />
      <select id="compProvider" onchange="compModels()"></select>
      <select id="compModel"></select>
      <input id="compNote" placeholder="note (optional)" autocomplete="off" />
      <input id="compExpires" type="date" title="Expires (optional)" />
      <button onclick="grantComp()">Grant</button>
    </div>
    <div id="compMsg" class="meta"></div>
    <table><tr><th>User</th><th>Provider</th><th>Model</th><th>Note</th><th>By</th><th>Expires</th><th></th></tr><tbody id="compTable"><tr><td colspan="7" class="loading">--</td></tr></tbody></table>
  </div>

  <div id="tab-sessions" class="tabpanel">
    <h2>VibeCode sessions <span id="sessCount" class="gray"></span></h2>
    <p class="meta">Every user's studio chats, newest first. Click a row to read the full transcript — what they asked, what the AI did, whether it deployed.</p>
    <table><tr><th>User</th><th>Session</th><th>Game</th><th>State</th><th>Tokens</th><th>Updated</th></tr><tbody id="sessTable"><tr><td colspan="6" class="loading">--</td></tr></tbody></table>

    <div id="sessModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:100;align-items:center;justify-content:center" onclick="if(event.target===this)closeSessModal()">
      <div style="background:#141414;border:1px solid #2a2a2a;border-radius:0.75rem;padding:1.25rem;max-width:760px;width:94%;height:84vh;display:flex;flex-direction:column">
        <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem">
          <h3 id="sessModalTitle" style="flex:1;font-size:1rem"></h3>
          <span id="sessLive" class="gray" style="font-size:0.72rem"></span>
          <button onclick="closeSessModal()" style="background:#2a2a2a;color:#ccc;border:1px solid #3a3a3a;border-radius:0.35rem;padding:0.3rem 0.7rem;cursor:pointer">Close</button>
        </div>
        <div id="sessModalBody" style="flex:1;overflow-y:auto;font-size:0.85rem;line-height:1.5"></div>
      </div>
    </div>
  </div>

  <div id="tab-provision" class="tabpanel">
    <p class="meta">Manual provisioning — an admin escape hatch. Creators normally self-serve from the console; use this to repair a half-done provision or provision on someone's behalf.</p>
    <!--PROVISION-->
  </div>

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
      return '<tr data-name="'+esc(d.name.toLowerCase())+'" data-live="'+(live==='ok'?'1':'0')+'"><td><strong>'+esc(d.name)+'</strong><br><small style="color:#888">'+esc(d.id)+'</small></td><td>'+dot+'</td><td>'+scoreCell+'</td><td>'+loadCell+'</td><td><a href="https://'+esc(d.domain)+'" target="_blank">'+esc(d.domain)+'</a></td><td><a href="https://github.com/'+esc(d.org)+'/'+esc(d.id)+'" target="_blank" style="font-size:0.8rem">'+esc(d.org)+'/'+esc(d.id)+'</a></td></tr>';
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
      document.getElementById('letterBar').innerHTML=letters.map(function(l){return '<button class="letter-btn" onclick="setLetter(\\x27'+esc(l)+'\\x27)">'+esc(l)+'</button>'}).join('');
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

    // ---- tabs + Overview / Errors / Users ----
    var loaded={games:false,users:false};
    function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
    function stat(num,label,cls){return '<div class="stat"><div class="num'+(cls?' '+cls:'')+'">'+num+'</div><div class="label">'+label+'</div></div>'}
    function timeAgo(ts){try{var d=new Date(String(ts).replace(' ','T')+'Z');var s=(Date.now()-d.getTime())/1000;if(s<60)return Math.floor(s)+'s ago';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago';}catch(e){return ts}}
    function toggleNav(){var n=document.getElementById('navlinks');var open=n.classList.toggle('open');document.querySelector('.hamburger').setAttribute('aria-expanded',open?'true':'false');}
    function setSize(v){var px={sm:14,md:16,lg:18,xl:20}[v]||16;document.documentElement.style.fontSize=px+'px';try{localStorage.setItem('fgs_admin_textsize',v)}catch(e){}var s=document.getElementById('txtSize');if(s)s.value=v;}
    function showTab(name){
      document.querySelectorAll('.tab').forEach(function(t){t.classList.toggle('active',t.dataset&&t.dataset.tab===name)});
      document.querySelectorAll('.tabpanel').forEach(function(p){p.classList.toggle('active',p.id==='tab-'+name)});
      document.getElementById('navlinks').classList.remove('open'); // close mobile menu on select
      if(name==='games'&&!loaded.games){loaded.games=true;loadAll();}
      if(name==='errors')loadErrors();
      if(name==='users'&&!loaded.users){loaded.users=true;loadUsers();}
      if(name==='sessions')loadSessions();
      if(name==='overview')loadOverview();
    }
    function refreshActive(){var a=document.querySelector('.tab.active');var n=a&&a.dataset?a.dataset.tab:'overview';if(n==='games')loadAll();else if(n==='errors')loadErrors();else if(n==='users')loadUsers();else if(n==='sessions')loadSessions();else loadOverview();}
    // ---- Sessions (all users' VibeCode chats) ----
    async function loadSessions(){
      var tb=document.getElementById('sessTable');tb.innerHTML='<tr><td colspan="6" class="loading">Loading...</td></tr>';
      try{
        var r=await fetch('/api/sessions',{credentials:'include'});
        if(!r.ok){tb.innerHTML='<tr><td colspan="6" class="red">Failed ('+r.status+')</td></tr>';return}
        var d=await r.json();var s=d.sessions||[];
        document.getElementById('sessCount').textContent=s.length?('('+s.length+')'):'';
        tb.innerHTML=s.length?s.map(function(x){
          var tok=(x.tokens&&(x.tokens.input||x.tokens.output))?(Math.round((x.tokens.input+x.tokens.output)/1000)+'k'):'--';
          var game=x.gameId?'<a href="'+esc(x.gameUrl||('https://'+x.gameId+'.freegamestore.online'))+'" target="_blank" onclick="event.stopPropagation()">'+esc(x.gameId)+'</a>':'<span class="gray">--</span>';
          return '<tr class="sess-row" data-sid="'+esc(x.id)+'" data-title="'+esc(x.name)+'" data-user="'+esc(x.user)+'" style="cursor:pointer"><td>'+esc(x.user)+'</td><td><strong>'+esc(x.name)+'</strong><br><small class="gray">'+esc(x.id)+'</small></td><td>'+game+'</td><td>'+(x.deployed?'<span class="green">deployed</span>':'<span class="yellow">draft</span>')+'</td><td>'+tok+'</td><td style="white-space:nowrap">'+timeAgo(x.updatedAt||x.createdAt)+'</td></tr>';
        }).join(''):'<tr><td colspan="6" class="gray">No sessions recorded yet.</td></tr>';
      }catch(e){tb.innerHTML='<tr><td colspan="6" class="red">Failed: '+esc(e)+'</td></tr>'}
    }
    // ---- transcript modal: windowed render + live poll + timestamps ----
    var SESS_PAGE=30;
    var sessCur=null;
    function sessTime(ts){
      if(!ts)return '';
      var d=new Date(ts);var now=new Date();
      var hm=('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);
      var sameDay=d.toDateString()===now.toDateString();
      return sameDay?hm:d.toLocaleDateString(undefined,{month:'short',day:'numeric'})+' '+hm;
    }
    function renderMsg(mm,user){
      var t=mm.ts?'<span style="float:right;color:#666;font-size:0.7rem;margin-left:0.5rem" title="'+esc(new Date(mm.ts).toISOString())+'">'+esc(sessTime(mm.ts))+'</span>':'';
      var c=esc((mm.content||'').slice(0,4000));
      if(mm.role==='user')return '<div style="margin:0.5rem 0;padding:0.5rem 0.75rem;background:#1e3a5f;border-radius:0.5rem">'+t+'<strong style="color:#93c5fd">'+esc(user)+'</strong><br>'+c+'</div>';
      if(mm.role==='assistant'){
        var tools=(mm.toolCalls||[]).map(function(tc){
          var i=tc.input||{};var arg=i.path||i.id||i.name||'';
          return '<span class="src-tag">'+esc(tc.name)+(arg?' '+esc(arg):'')+'</span>';
        }).join(' ');
        return '<div style="margin:0.5rem 0;padding:0.5rem 0.75rem;background:#1a1a1a;border-radius:0.5rem">'+t+'<strong class="green">AI</strong><br>'+(c||'<span class="gray">(tool call)</span>')+(tools?'<div style="margin-top:0.35rem;display:flex;flex-wrap:wrap;gap:0.25rem">'+tools+'</div>':'')+'</div>';
      }
      if(mm.role==='tool_result'){
        var rs=(mm.toolResults||[]).map(function(tr){return (tr.content||'').trim()}).filter(Boolean);
        if(!rs.length)return '';
        return '<details style="margin:0.35rem 0 0.35rem 1rem">'+
          '<summary style="cursor:pointer;color:#888;font-size:0.75rem">'+t+'tool result'+(rs.length>1?'s ('+rs.length+')':'')+'</summary>'+
          '<pre style="white-space:pre-wrap;font-size:0.72rem;color:#9ca3af;background:#0f0f0f;border:1px solid #2a2a2a;padding:0.5rem;border-radius:0.35rem;margin-top:0.25rem;max-height:14rem;overflow:auto">'+rs.map(esc).join('\\n\\u2500\\u2500\\u2500\\n')+'</pre></details>';
      }
      return '<div class="gray" style="margin:0.35rem 0;font-size:0.78rem">'+esc(mm.role)+': '+c.slice(0,500)+'</div>';
    }
    // mode: 'bottom' = jump to newest; 'prepend' = keep view anchored after
    // loading older; default = stick to bottom only if already near it.
    function renderSessBody(mode){
      if(!sessCur)return;
      var body=document.getElementById('sessModalBody');
      var msgs=sessCur.msgs;var start=Math.max(0,msgs.length-sessCur.win);
      var earlier=start>0?'<button onclick="loadEarlierSess()" style="display:block;margin:0 auto 0.6rem;background:#1a1a1a;border:1px solid #2a2a2a;color:#888;padding:0.35rem 0.9rem;border-radius:1rem;cursor:pointer;font-size:0.78rem">&#8593; Load earlier ('+start+' older)</button>':'';
      var prevH=body.scrollHeight,prevTop=body.scrollTop;
      var nearBottom=body.scrollHeight-prevTop-body.clientHeight<160;
      body.innerHTML=earlier+msgs.slice(start).map(function(m){return renderMsg(m,sessCur.user)}).join('');
      if(mode==='prepend')body.scrollTop=body.scrollHeight-prevH+prevTop;
      else if(mode==='bottom'||nearBottom)body.scrollTop=body.scrollHeight;
    }
    function loadEarlierSess(){if(!sessCur)return;sessCur.win+=SESS_PAGE;renderSessBody('prepend')}
    async function fetchSess(sid){
      var r=await fetch('/api/sessionhistory?id='+encodeURIComponent(sid),{credentials:'include'});
      if(!r.ok)throw new Error('HTTP '+r.status);
      return r.json();
    }
    function closeSessModal(){
      if(sessCur&&sessCur.poll)clearInterval(sessCur.poll);
      sessCur=null;
      document.getElementById('sessModal').style.display='none';
    }
    async function openSession(sid,title,user){
      closeSessModal();
      sessCur={sid:sid,user:user,msgs:[],win:SESS_PAGE,poll:null};
      var m=document.getElementById('sessModal');var body=document.getElementById('sessModalBody');
      document.getElementById('sessModalTitle').textContent=title+' \\u2014 '+user;
      document.getElementById('sessLive').textContent='';
      body.innerHTML='<span class="loading">Loading transcript...</span>';m.style.display='flex';
      try{var d=await fetchSess(sid);sessCur.msgs=d.messages||[];}
      catch(e){body.innerHTML='<span class="red">Failed to load transcript ('+esc(e.message||e)+')</span>';return}
      if(!sessCur.msgs.length){body.innerHTML='<span class="gray">No messages in this session.</span>'}
      else renderSessBody('bottom');
      // Live view: re-fetch every 5s while open; new messages append and, if the
      // reader is at the bottom, the view follows them (like the studio chat).
      var liveEl=document.getElementById('sessLive');
      liveEl.innerHTML='<span class="green">&#9679; live</span>';
      sessCur.poll=setInterval(async function(){
        if(!sessCur||sessCur.sid!==sid)return;
        try{
          var d2=await fetchSess(sid);
          var msgs2=d2.messages||[];
          if(msgs2.length!==sessCur.msgs.length){
            sessCur.msgs=msgs2;
            renderSessBody();
            liveEl.innerHTML='<span class="green">&#9679; live</span> <span class="gray">updated '+esc(sessTime(Date.now()))+'</span>';
          }
        }catch(e){liveEl.innerHTML='<span class="yellow">&#9679; retrying</span>'}
      },5000);
    }
    async function loadOverview(){
      try{
        var r=await fetch('/api/stats',{credentials:'include'});var s=await r.json();
        document.getElementById('ovStats').innerHTML=stat(s.games,'Games')+stat(s.creators,'Creators')+stat(s.errors24h,'Errors (24h)',s.errors24h>0?'red':'green')+stat(s.errorsTotal,'Errors (total)',s.errorsTotal>0?'yellow':'gray');
        var badge=document.getElementById('errBadge');badge.textContent=s.errors24h?'('+s.errors24h+')':'';badge.className=s.errors24h?'red':'';
        var series=s.errorSeries||[];var max=Math.max.apply(null,[1].concat(series.map(function(p){return p.c})));
        document.getElementById('ovChart').innerHTML=series.length?series.map(function(p){var h=Math.round(p.c/max*110);return '<div title="'+esc(p.d)+': '+p.c+'" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;"><div style="font-size:0.7rem;">'+p.c+'</div><div class="bar" style="height:'+h+'px;width:70%;background:'+(p.c>0?'#f87171':'#2a2a2a')+'"></div><div style="font-size:0.6rem;color:#888;margin-top:2px;">'+esc(p.d).slice(5)+'</div></div>'}).join(''):'<div class="gray">No errors logged yet.</div>';
      }catch(e){document.getElementById('ovStats').innerHTML='<div class="gray">stats error: '+esc(e)+'</div>'}
    }
    async function loadErrors(){
      var tb=document.getElementById('errTable');tb.innerHTML='<tr><td colspan="5" class="loading">Loading...</td></tr>';
      try{
        var r=await fetch('/api/errors?limit=200',{credentials:'include'});var rows=await r.json();
        tb.innerHTML=rows.length?rows.map(function(e){return '<tr><td style="white-space:nowrap">'+timeAgo(e.ts)+'<br><small class="gray">'+esc(e.ts)+' UTC</small></td><td><span class="src-tag">'+esc(e.source)+'</span></td><td>'+esc(e.user_github||'--')+'</td><td><strong class="red">'+esc(e.message)+'</strong>'+(e.stack?'<pre class="stack">'+esc(e.stack)+'</pre>':'')+'</td><td class="gray" style="font-size:0.75rem">'+esc(e.context||'')+'</td></tr>'}).join(''):'<tr><td colspan="5" class="green">No errors logged — clean.</td></tr>';
      }catch(e){tb.innerHTML='<tr><td colspan="5" class="red">Failed to load errors: '+esc(e)+'</td></tr>'}
    }
    async function loadUsers(){
      var tb=document.getElementById('userTable');tb.innerHTML='<tr><td colspan="3" class="loading">Loading...</td></tr>';
      try{
        var r=await fetch('/api/users',{credentials:'include'});var rows=await r.json();
        tb.innerHTML=rows.length?rows.map(function(u){return '<tr><td><a href="https://github.com/'+esc(u.login)+'" target="_blank">'+esc(u.login)+'</a></td><td><strong>'+u.games.length+'</strong></td><td class="gray" style="font-size:0.8rem">'+u.games.map(esc).join(', ')+'</td></tr>'}).join(''):'<tr><td colspan="3" class="gray">No creators yet.</td></tr>';
      }catch(e){tb.innerHTML='<tr><td colspan="3" class="red">Failed: '+esc(e)+'</td></tr>'}
      loadComp();loadAllUsers();
    }
    async function loadAllUsers(){
      var tb=document.getElementById('allUsersTable');
      try{
        var r=await fetch('/api/allusers',{credentials:'include'});var d=await r.json();
        var u=d.users||[];
        document.getElementById('userCount').textContent=u.length?('('+u.length+')'):'';
        tb.innerHTML=u.length?u.map(function(x){
          var keys=x.keys||[];
          var chips=keys.length?keys.map(function(p){return '<span class="keychip">'+esc(p)+' <button class="rmkey-btn" data-uid="'+esc(x.id)+'" data-prov="'+esc(p)+'" title="Remove key">x</button></span>'}).join(''):'<span class="gray">none</span>';
          var action='<button class="addkey-btn" data-uid="'+esc(x.id)+'" data-name="'+esc(x.name)+'">Add key</button>';
          return '<tr><td>'+esc(x.name)+'</td><td class="gray" style="font-size:0.8rem">'+esc(x.id)+'</td><td class="gray" style="font-size:0.8rem">'+esc((x.createdAt||'').slice(0,10))+'</td><td>'+chips+'</td><td>'+action+'</td></tr>';
        }).join(''):'<tr><td colspan="5" class="gray">No registered users.</td></tr>';
      }catch(e){tb.innerHTML='<tr><td colspan="5" class="red">Failed: '+esc(e)+'</td></tr>'}
    }
    // Grant to a specific user id (from a Registered-users row), using whatever
    // provider+model is selected in the Complimentary access form.
    async function grantUser(uid){
      var provider=document.getElementById('compProvider').value;
      var model=document.getElementById('compModel').value;
      var msg=document.getElementById('compMsg');
      if(!model){msg.innerHTML='<span class="red">Pick a funded provider + model in the form below first.</span>';return;}
      msg.textContent='Granting '+provider+' / '+model+' to '+uid+'...';
      try{
        var r=await fetch('/api/comp',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:uid,provider:provider,model:model})});
        var d=await r.json().catch(function(){return{}});
        if(!r.ok){msg.innerHTML='<span class="red">'+esc(d.error||('Failed ('+r.status+')'))+'</span>';return;}
        msg.innerHTML='<span class="green">Granted '+esc(provider)+' / '+esc(model)+' to '+esc(uid)+'.</span>';
        loadComp();loadAllUsers();
      }catch(e){msg.innerHTML='<span class="red">'+esc(e)+'</span>'}
    }
    // Complimentary access — mirrors the studio model catalog so grants use valid ids.
    var COMP_MODELS={anthropic:[['claude-sonnet-4-6','Claude Sonnet 4.6'],['claude-opus-4-6','Claude Opus 4.6'],['claude-haiku-4-5-20251001','Claude Haiku 4.5']],openai:[['gpt-4o','GPT-4o'],['gpt-4o-mini','GPT-4o Mini'],['o3','o3'],['o4-mini','o4 Mini']],google:[['gemini-2.5-pro','Gemini 2.5 Pro'],['gemini-2.5-flash','Gemini 2.5 Flash']],github:[['openai/gpt-4.1','GPT-4.1'],['openai/gpt-4o','GPT-4o']]};
    var COMP_PROVIDERS=['anthropic','openai','google','github'];
    function compInitProviders(funded){
      var sel=document.getElementById('compProvider');
      sel.innerHTML=COMP_PROVIDERS.map(function(p){var ok=funded.indexOf(p)>=0;return '<option value="'+p+'"'+(ok?'':' disabled')+'>'+p+(ok?'':' (no key)')+'</option>'}).join('');
      var first=COMP_PROVIDERS.filter(function(p){return funded.indexOf(p)>=0})[0]||COMP_PROVIDERS[0];
      sel.value=first;compModels();
    }
    function compModels(){
      var p=document.getElementById('compProvider').value;var m=document.getElementById('compModel');
      var opts=COMP_MODELS[p]||[];m.innerHTML=opts.map(function(o){return '<option value="'+esc(o[0])+'">'+esc(o[1])+'</option>'}).join('');
    }
    async function grantComp(){
      var login=document.getElementById('compLogin').value.trim();
      var provider=document.getElementById('compProvider').value;
      var model=document.getElementById('compModel').value;
      var note=document.getElementById('compNote').value.trim();
      var exp=document.getElementById('compExpires').value;
      var msg=document.getElementById('compMsg');
      if(!login){msg.innerHTML='<span class="red">Enter a GitHub login.</span>';return;}
      if(!model){msg.innerHTML='<span class="red">Pick a funded provider + model first.</span>';return;}
      msg.textContent='Granting...';
      var body={login:login,provider:provider,model:model};
      if(note)body.note=note;
      if(exp)body.expiresAt=new Date(exp+'T23:59:59Z').toISOString();
      try{
        var r=await fetch('/api/comp',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        var d=await r.json().catch(function(){return{}});
        if(!r.ok){msg.innerHTML='<span class="red">'+esc(d.error||('Failed ('+r.status+')'))+'</span>';return;}
        msg.innerHTML='<span class="green">Granted '+esc(provider)+' / '+esc(model)+' to '+esc(login)+'.</span>';
        document.getElementById('compLogin').value='';document.getElementById('compNote').value='';document.getElementById('compExpires').value='';
        loadComp();
      }catch(e){msg.innerHTML='<span class="red">'+esc(e)+'</span>'}
    }
    async function revokeComp(userId){
      if(!confirm('Revoke complimentary access for '+userId+'?'))return;
      try{
        var r=await fetch('/api/comp/'+encodeURIComponent(userId),{method:'DELETE',credentials:'include'});
        if(!r.ok){var d=await r.json().catch(function(){return{}});alert('Revoke failed: '+(d.error||r.status));return;}
        loadComp();loadAllUsers();
      }catch(e){alert('Revoke failed: '+e)}
    }
    async function loadComp(){
      var tb=document.getElementById('compTable');
      try{
        var r=await fetch('/api/comp',{credentials:'include'});var d=await r.json();
        var funded=d.funded||[];compInitProviders(funded);
        document.getElementById('compFunded').textContent=funded.length?('Funded: '+funded.join(', ')+'.'):'No platform keys set yet — add a COMP_KEY_<PROVIDER> secret to fund one.';
        var g=d.grants||[];
        tb.innerHTML=g.length?g.map(function(x){return '<tr><td>'+esc(x.userId)+'</td><td>'+esc(x.provider)+'</td><td>'+esc(x.model)+'</td><td class="gray">'+esc(x.note||'')+'</td><td class="gray">'+esc(x.grantedBy||'')+'</td><td class="gray">'+esc(x.expiresAt||'never')+'</td><td><button class="revoke-btn" data-uid="'+esc(x.userId)+'">Revoke</button></td></tr>'}).join(''):'<tr><td colspan="7" class="gray">No complimentary grants.</td></tr>';
      }catch(e){tb.innerHTML='<tr><td colspan="7" class="red">Failed: '+esc(e)+'</td></tr>'}
    }
    // Add-a-key flow: click "Add key" on a user row → paste a provider key → it
    // lands in that user's encrypted vault; their studio auto-selects a provider
    // they have a key for, so they can build immediately.
    var keyTargetUid=null;
    function openKeyModal(uid,name){keyTargetUid=uid;document.getElementById('keyModalUser').textContent=name||uid;document.getElementById('keyModalKey').value='';document.getElementById('keyModalMsg').textContent='';document.getElementById('keyModal').style.display='flex';}
    function closeKeyModal(){document.getElementById('keyModal').style.display='none';keyTargetUid=null;}
    async function saveKey(){
      var provider=document.getElementById('keyModalProvider').value;
      var key=document.getElementById('keyModalKey').value.trim();
      var msg=document.getElementById('keyModalMsg');
      if(!keyTargetUid){msg.innerHTML='<span class="red">No user selected.</span>';return;}
      if(!key){msg.innerHTML='<span class="red">Paste an API key first.</span>';return;}
      msg.textContent='Saving...';
      try{
        var r=await fetch('/api/userkey',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:keyTargetUid,provider:provider,key:key})});
        var d=await r.json().catch(function(){return{}});
        if(!r.ok){msg.innerHTML='<span class="red">'+esc(d.error||('Failed ('+r.status+')'))+'</span>';return;}
        msg.innerHTML='<span class="green">Saved '+esc(provider)+' key. They can build now.</span>';
        loadAllUsers();
        setTimeout(closeKeyModal,900);
      }catch(e){msg.innerHTML='<span class="red">'+esc(e)+'</span>'}
    }
    async function removeKey(uid,provider){
      if(!confirm('Remove the '+provider+' key for this user?'))return;
      try{
        var r=await fetch('/api/userkey/delete',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:uid,provider:provider})});
        if(!r.ok){var d=await r.json().catch(function(){return{}});alert('Remove failed: '+(d.error||r.status));return;}
        loadAllUsers();
      }catch(e){alert('Remove failed: '+e)}
    }
    // Delegated handlers — data-* attributes avoid quoting values into inline
    // onclick, which inside this template-literal-in-a-string mis-escapes
    // (\\' collapses to ') and would break the entire console script.
    document.addEventListener('click',function(ev){
      var t=ev.target;if(!t||!t.closest)return;
      var ak=t.closest('.addkey-btn');if(ak){openKeyModal(ak.getAttribute('data-uid'),ak.getAttribute('data-name'));return;}
      var rk=t.closest('.rmkey-btn');if(rk){removeKey(rk.getAttribute('data-uid'),rk.getAttribute('data-prov'));return;}
      var rb=t.closest('.revoke-btn');if(rb){revokeComp(rb.getAttribute('data-uid'));return;}
      var gb=t.closest('.grant-btn');if(gb){grantUser(gb.getAttribute('data-uid'));return;}
      var sr=t.closest('.sess-row');if(sr){openSession(sr.getAttribute('data-sid'),sr.getAttribute('data-title'),sr.getAttribute('data-user'));return;}
    });
    setSize((function(){try{return localStorage.getItem('fgs_admin_textsize')}catch(e){return null}})()||'md');
    showTab('overview');
  </script>
</body>
</html>`;
}

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
