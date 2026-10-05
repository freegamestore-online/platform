    // Custom domain — the freegamestore-leaderboard.*.workers.dev subdomain is
    // disabled, so the old URL 404'd and scores never loaded.
    const API = 'https://leaderboard.freegamestore.online';
    // Served from our own origin (see build.js filesToCopy) — fetching
    // raw.githubusercontent.com is blocked by connect-src ('self' + *.fgs only).
    const REGISTRY_URL = '/registry.json';

    let games = [];
    let currentView = 'overall';

    // --- Helpers ---

    function timeAgo(dateStr) {
      if (!dateStr) return '';
      const now = Date.now();
      const then = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z').getTime();
      const diff = Math.floor((now - then) / 1000);
      if (diff < 60) return 'just now';
      if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
      if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
      return Math.floor(diff / 86400) + 'd ago';
    }

    function rankClass(i) {
      if (i === 0) return 'gold';
      if (i === 1) return 'silver';
      if (i === 2) return 'bronze';
      return '';
    }

    function escapeHtml(str) {
      const d = document.createElement('div');
      d.textContent = str || '';
      return d.innerHTML;
    }

    function initial(name) {
      return (name || '?').charAt(0).toUpperCase();
    }

    function avatarHtml(avatarUrl, name) {
      if (avatarUrl) {
        // No inline onerror (CSP blocks inline handlers) — carry the fallback
        // initial in a data attribute and bind the error handler after render.
        return '<img class="lb-avatar" src="' + escapeHtml(avatarUrl) + '" alt="" loading="lazy" data-initial="' + escapeHtml(initial(name)) + '">';
      }
      return '<span class="lb-avatar-placeholder">' + initial(name) + '</span>';
    }

    // Swap a broken avatar <img> for its initial placeholder. Bound per render
    // (CSP-safe replacement for the old inline onerror).
    function bindAvatarFallbacks(container) {
      container.querySelectorAll('img.lb-avatar').forEach(function (img) {
        img.addEventListener('error', function () {
          var span = document.createElement('span');
          span.className = 'lb-avatar-placeholder';
          span.textContent = img.dataset.initial || '?';
          img.replaceWith(span);
        }, { once: true });
      });
    }

    // --- Shimmer loading ---

    function renderShimmer(count) {
      const rows = document.getElementById('lb-rows');
      let html = '';
      for (let i = 0; i < count; i++) {
        html += '<div class="shimmer-row">' +
          '<div class="shimmer-block shimmer-rank"></div>' +
          '<div class="shimmer-circle"></div>' +
          '<div class="shimmer-block shimmer-name"></div>' +
          '<div class="shimmer-block shimmer-score"></div>' +
        '</div>';
      }
      rows.innerHTML = html;
    }

    // --- Render: Overall ---

    function renderOverall(scores) {
      const rows = document.getElementById('lb-rows');
      if (!scores || !scores.length) {
        rows.innerHTML = '<div class="lb-empty">No scores yet. Play a game and sign in to appear here.</div>';
        return;
      }
      rows.innerHTML = scores.map(function(s, i) {
        var name = s.name || 'Anonymous';
        return '<div class="lb-row">' +
          '<span class="lb-rank ' + rankClass(i) + '">' + (i + 1) + '</span>' +
          '<span class="lb-player">' +
            avatarHtml(s.avatar_url, name) +
            '<span class="lb-name">' + escapeHtml(name) + '</span>' +
          '</span>' +
          '<span class="lb-score">' + Number(s.total_score).toLocaleString() + '</span>' +
          '<span class="lb-games-played">' + (s.games_played || 0) + '</span>' +
        '</div>';
      }).join('');
      bindAvatarFallbacks(rows);
    }

    // --- Render: Per-game ---

    function renderPerGame(scores) {
      var rows = document.getElementById('lb-rows');
      if (!scores || !scores.length) {
        rows.innerHTML = '<div class="lb-empty">No scores yet. Play a game and sign in to appear here.</div>';
        return;
      }
      rows.innerHTML = scores.map(function(s, i) {
        var name = s.player_name || 'Anonymous';
        return '<div class="lb-row">' +
          '<span class="lb-rank ' + rankClass(i) + '">' + (i + 1) + '</span>' +
          '<span class="lb-player">' +
            avatarHtml(s.avatar_url, name) +
            '<span class="lb-name">' + escapeHtml(name) + '</span>' +
          '</span>' +
          '<span class="lb-score">' + Number(s.score).toLocaleString() + '</span>' +
          '<span class="lb-time">' + timeAgo(s.created_at) + '</span>' +
        '</div>';
      }).join('');
      bindAvatarFallbacks(rows);
    }

    // --- Table header update ---

    function setTableHeader(view) {
      var header = document.getElementById('lb-header');
      if (view === 'overall') {
        header.innerHTML =
          '<span class="col-rank">Rank</span>' +
          '<span class="col-player">Player</span>' +
          '<span class="col-score">Total Score</span>' +
          '<span class="col-games">Games</span>';
      } else {
        header.innerHTML =
          '<span class="col-rank">Rank</span>' +
          '<span class="col-player">Player</span>' +
          '<span class="col-score">Score</span>' +
          '<span class="col-time">When</span>';
      }
    }

    // --- Fetch: Overall ---

    async function loadOverall() {
      setTableHeader('overall');
      renderShimmer(8);
      try {
        var res = await fetch(API + '/api/leaderboard/overall?limit=50');
        if (res.status === 204 || !res.ok) {
          renderOverall([]);
          return;
        }
        var data = await res.json();
        renderOverall(data.scores || []);
        // Update player count stat
        if (data.scores && data.scores.length) {
          document.getElementById('stat-players').textContent = data.scores.length;
        }
      } catch (e) {
        renderOverall([]);
      }
    }

    // --- Fetch: Per-game ---

    async function loadPerGame(gameId) {
      if (!gameId) {
        document.getElementById('lb-rows').innerHTML =
          '<div class="lb-empty">Select a game above to see its leaderboard.</div>';
        return;
      }
      setTableHeader('per-game');
      renderShimmer(6);
      try {
        var res = await fetch(API + '/api/leaderboard/' + encodeURIComponent(gameId) + '?limit=20');
        if (res.status === 204 || !res.ok) {
          renderPerGame([]);
          return;
        }
        var data = await res.json();
        renderPerGame(data.scores || []);
      } catch (e) {
        renderPerGame([]);
      }
    }

    // --- Fetch: Game registry ---

    async function loadGames() {
      try {
        var res = await fetch(REGISTRY_URL);
        if (!res.ok) return;
        var data = await res.json();
        // registry.json may be an array of game objects or { games: [...] }
        games = Array.isArray(data) ? data : (data.games || []);
        var select = document.getElementById('game-select');
        games.forEach(function(g) {
          var opt = document.createElement('option');
          opt.value = g.id;
          opt.textContent = g.name || g.id;
          select.appendChild(opt);
        });
        document.getElementById('stat-games').textContent = games.length;
      } catch (e) {
        // Silently fail — game selector will just be empty
      }
    }

    // --- Tab switching ---

    document.querySelector('.view-tabs').addEventListener('click', function(e) {
      var btn = e.target.closest('.view-tab');
      if (!btn) return;
      var view = btn.dataset.view;
      if (view === currentView) return;
      currentView = view;

      document.querySelectorAll('.view-tab').forEach(function(t) { t.classList.remove('active'); });
      btn.classList.add('active');

      var selector = document.getElementById('game-selector');
      if (view === 'per-game') {
        selector.classList.add('visible');
        var gameId = document.getElementById('game-select').value;
        loadPerGame(gameId);
      } else {
        selector.classList.remove('visible');
        loadOverall();
      }
    });

    // --- Game selector ---

    document.getElementById('game-select').addEventListener('change', function() {
      if (currentView === 'per-game') {
        loadPerGame(this.value);
      }
    });

    // --- Init ---

    async function init() {
      await loadGames();
      loadOverall();
    }

    init();
