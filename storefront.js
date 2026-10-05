/**
 * FreeGameStore storefront interactions:
 *   - sort dropdown (A-Z / Newest / Category)
 *   - split-pane preview (load game iframe on >=1024px, navigate to about on <1024px)
 *   - ?game=<id> deep link, plus a fullscreen toolbar button (games need it)
 *
 * Theme toggle + mobile nav are handled by theme.js so they apply on every page.
 * Vendored — each store ships its own copy.
 */
(function () {
  // ---------- Sort ----------
  (function () {
    var select = document.getElementById('sort-select');
    var grid = document.getElementById('apps-grid');
    if (!select || !grid) return;

    select.addEventListener('change', function () {
      var cards = Array.from(grid.querySelectorAll('.app-card.compact'));
      cards.sort(function (a, b) {
        switch (select.value) {
          case 'newest': {
            var ap = a.dataset.published || '';
            var bp = b.dataset.published || '';
            // Games with dates first (newest first), undated at end (A-Z)
            if (ap && bp) return bp.localeCompare(ap);
            if (ap) return -1;
            if (bp) return 1;
            var an = a.querySelector('.app-name');
            var bn = b.querySelector('.app-name');
            return (an ? an.textContent : '').localeCompare(bn ? bn.textContent : '');
          }
          case 'category': {
            var ac = a.dataset.category || '';
            var bc = b.dataset.category || '';
            if (ac !== bc) return ac.localeCompare(bc);
            var an2 = a.querySelector('.app-name');
            var bn2 = b.querySelector('.app-name');
            return (an2 ? an2.textContent : '').localeCompare(bn2 ? bn2.textContent : '');
          }
          default: {
            var an3 = a.querySelector('.app-name');
            var bn3 = b.querySelector('.app-name');
            return (an3 ? an3.textContent : '').localeCompare(bn3 ? bn3.textContent : '');
          }
        }
      });
      cards.forEach(function (c) { grid.appendChild(c); });
    });
  })();

  // ---------- Split-pane preview ----------
  (function () {
    var pane = document.getElementById('previewPane');
    if (!pane) return;
    var SPLIT_MQ = window.matchMedia('(min-width: 1024px)');
    var frame = document.getElementById('previewFrame');
    var empty = document.getElementById('previewEmpty');
    var title = document.getElementById('previewTitle');
    var btnNewTab = document.getElementById('previewNewTab');
    var btnAbout = document.getElementById('previewAbout');
    var btnClose = document.getElementById('previewClose');
    var btnFullscreen = document.getElementById('previewFullscreen');
    var current = null;
    var loadTimeout = null;
    var loadToken = 0;

    var emptyTitleEl = empty && empty.querySelector('.empty-title');
    var emptyTipEl = empty && empty.querySelector('.empty-tip');
    var ORIGINAL_EMPTY_TITLE = emptyTitleEl ? emptyTitleEl.textContent : '';
    var ORIGINAL_EMPTY_TIP_HTML = emptyTipEl ? emptyTipEl.innerHTML : '';

    /* SECURITY: the iframe loads game URLs under *.freegamestore.online — all
     * first-party today. Sandbox allows same-origin + scripts because games need
     * their own state (high scores, save files) and gamepad/fullscreen APIs.
     * Revisit before opening third-party game submissions. */
    function restoreEmpty() {
      if (emptyTitleEl) emptyTitleEl.textContent = ORIGINAL_EMPTY_TITLE;
      if (emptyTipEl) emptyTipEl.innerHTML = ORIGINAL_EMPTY_TIP_HTML;
      if (empty) empty.classList.remove('is-error');
    }

    function showLoadError(meta) {
      if (loadTimeout) { clearTimeout(loadTimeout); loadTimeout = null; }
      pane.classList.remove('is-loading');
      frame.hidden = true;
      if (empty) {
        empty.hidden = false;
        empty.classList.add('is-error');
        if (emptyTitleEl) emptyTitleEl.textContent = (meta.name || 'This game') + " can't embed here";
        if (emptyTipEl) emptyTipEl.innerHTML = 'It blocks iframes. Click <strong>↗ New tab</strong> to launch it normally.';
      }
    }

    function activate(card) {
      document.querySelectorAll('.app-card.compact.is-active').forEach(function (c) {
        c.classList.remove('is-active');
      });
      if (card) card.classList.add('is-active');
    }

    function setTitle(name, url) {
      var host = '';
      try { host = url ? new URL(url).host : ''; } catch (e) {}
      title.innerHTML = '';
      title.appendChild(document.createTextNode(name || 'No game selected'));
      if (host) {
        var hs = document.createElement('span');
        hs.className = 'preview-host';
        hs.textContent = host;
        title.appendChild(hs);
      }
    }

    function setUrlParam(value) {
      try {
        var u = new URL(window.location.href);
        if (value) u.searchParams.set('game', value);
        else u.searchParams.delete('game');
        history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
      } catch (e) {}
    }

    function loadInPane(meta, card) {
      current = meta;
      restoreEmpty();
      pane.classList.add('is-loading');
      frame.hidden = false;
      empty.hidden = true;
      btnNewTab.hidden = false;
      if (btnAbout) btnAbout.hidden = !meta.aboutUrl;
      if (btnFullscreen) btnFullscreen.hidden = false;
      btnClose.hidden = false;
      setTitle(meta.name, meta.url);
      activate(card);
      setUrlParam(meta.id);

      // Pre-flight reachability — catches DNS / network errors that the
      // iframe load event misses (browsers fire `load` on their own error pages).
      var token = ++loadToken;
      fetch(meta.url, { method: 'GET', mode: 'no-cors', cache: 'no-store', credentials: 'omit' })
        .then(function () {
          if (token !== loadToken) return;
          frame.src = meta.url;
          if (loadTimeout) clearTimeout(loadTimeout);
          loadTimeout = setTimeout(function () { showLoadError(meta); }, 10000);
          frame.addEventListener('load', function once() {
            pane.classList.remove('is-loading');
            frame.removeEventListener('load', once);
            if (loadTimeout) { clearTimeout(loadTimeout); loadTimeout = null; }
          });
        })
        .catch(function () {
          if (token !== loadToken) return;
          showLoadError(meta);
        });
    }

    function clearPane() {
      current = null;
      loadToken++;
      if (loadTimeout) { clearTimeout(loadTimeout); loadTimeout = null; }
      frame.removeAttribute('src');
      frame.hidden = true;
      empty.hidden = false;
      restoreEmpty();
      btnNewTab.hidden = true;
      if (btnAbout) btnAbout.hidden = true;
      if (btnFullscreen) btnFullscreen.hidden = true;
      btnClose.hidden = true;
      setTitle(null, '');
      activate(null);
      pane.classList.remove('is-loading');
      setUrlParam(null);
    }

    function cardMeta(card) {
      var cta = card.querySelector('.app-cta');
      var name = card.querySelector('.app-name');
      var nameText = 'Game';
      if (name) {
        var n = name.firstChild;
        while (n && n.nodeType !== Node.TEXT_NODE) n = n.nextSibling;
        nameText = (n && n.textContent.trim()) || name.textContent.trim();
      }
      return {
        id: card.dataset.id || '',
        name: nameText,
        url: cta ? cta.getAttribute('href') : null,
        aboutUrl: card.dataset.about || null,
      };
    }

    document.querySelectorAll('#apps-grid .app-card.compact').forEach(function (card) {
      var aboutUrl = card.dataset.about;
      card.style.cursor = 'pointer';
      card.addEventListener('click', function (e) {
        var onCta = !!e.target.closest('.app-cta');
        if (SPLIT_MQ.matches) {
          e.preventDefault();
          loadInPane(cardMeta(card), card);
          return;
        }
        if (!onCta && aboutUrl) window.location.href = aboutUrl;
      });
    });

    if (btnNewTab) btnNewTab.addEventListener('click', function () {
      if (current && current.url) window.open(current.url, '_blank', 'noopener');
    });
    if (btnAbout) btnAbout.addEventListener('click', function () {
      if (current && current.aboutUrl) window.location.href = current.aboutUrl;
    });
    if (btnClose) btnClose.addEventListener('click', clearPane);
    if (btnFullscreen) btnFullscreen.addEventListener('click', function () {
      if (frame.requestFullscreen) frame.requestFullscreen();
      else if (frame.webkitRequestFullscreen) frame.webkitRequestFullscreen();
    });

    // Deep link: ?game=<id> (also accept ?app= for cross-store URLs from FAS).
    try {
      var params = new URLSearchParams(window.location.search);
      var wantId = params.get('game') || params.get('app');
      if (wantId && SPLIT_MQ.matches) {
        var match = document.querySelector('#apps-grid .app-card.compact[data-id="' + CSS.escape(wantId) + '"]');
        if (match) loadInPane(cardMeta(match), match);
      }
    } catch (e) {}

    if (SPLIT_MQ.addEventListener) {
      SPLIT_MQ.addEventListener('change', function (e) { if (!e.matches) activate(null); });
    }
  })();
})();
