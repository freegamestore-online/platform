/**
 * Creator analytics page for FreeGameStore (#355). Port of FreeAppStore's
 * storefront analytics.js, adapted to FGS games.
 *
 *   /analytics.html               the games you own
 *   /analytics.html?game=<id>     one game: totals, a daily chart, breakdowns,
 *                                 custom events, and the GA4 / Plausible form
 *   (&days=N and &kind=<event> narrow the window and the event kind)
 *
 * Data comes from the console's owner endpoints. /api/me lists the creator's
 * games and /api/analytics/:id returns stats and the tag config. Both check the
 * session cookie, which is why the requests carry credentials.
 *
 * CSP-safe by construction: no inline script, no style attributes, no inline
 * event handlers, no innerHTML. Text goes in with textContent, the chart is SVG
 * built with setAttribute, and listeners are attached with addEventListener.
 */
(function () {
  'use strict';

  var CONSOLE = 'https://console.freegamestore.online';
  var GAME_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/;
  var WINDOWS = [1, 7, 30, 90];
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var root = document.getElementById('an-content');
  if (!root) return;

  // --- DOM helpers (no innerHTML, no inline styles) ---

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else node.setAttribute(k, String(attrs[k]));
      });
    }
    if (children !== undefined && children !== null) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c === null || c === undefined) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) {
      node.setAttribute(k, String(attrs[k]));
    });
    return node;
  }

  function setContent(nodes) {
    root.replaceChildren.apply(root, nodes);
  }

  function fmt(n) {
    return Number(n || 0).toLocaleString('en-US');
  }

  function errorCard(message) {
    return el('div', { class: 'an-card', role: 'alert' }, [el('p', { class: 'an-error' }, message)]);
  }

  function signInCard() {
    return el('div', { class: 'an-card' }, [
      el('p', null, 'Sign in to see analytics for your games.'),
      el('p', { class: 'an-meta' }, [
        el('a', { class: 'an-link', href: CONSOLE + '/' }, 'Sign in on the console'),
        ' and then come back to this page.',
      ]),
    ]);
  }

  // --- API ---

  // Resolves to { ok, status, data } and never rejects, so each view can render
  // a message for every failure instead of leaving "Loading…" on screen.
  function api(path, init) {
    var opts = init || {};
    opts.credentials = 'include';
    return fetch(CONSOLE + path, opts)
      .then(function (res) {
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            return { ok: res.ok, status: res.status, data: data };
          });
      })
      .catch(function () {
        return { ok: false, status: 0, data: { error: "Couldn't reach analytics. Try again." } };
      });
  }

  // --- Games list (no ?game=) ---

  function renderList() {
    setContent([el('p', { class: 'an-meta' }, 'Loading your games…')]);
    api('/api/me').then(function (res) {
      if (res.status === 401) return setContent([signInCard()]);
      if (!res.ok) return setContent([errorCard(res.data.error || 'Could not load your games.')]);
      var games = (res.data.creator && res.data.creator.games) || [];
      if (games.length === 0) {
        return setContent([
          el('div', { class: 'an-card' }, [
            el('p', null, "You haven't published any games yet."),
            el('p', { class: 'an-meta' }, [
              'Start one at ',
              el('a', { class: 'an-link', href: CONSOLE + '/create' }, 'the console'),
              '.',
            ]),
          ]),
        ]);
      }
      setContent(
        games.map(function (g) {
          return el('div', { class: 'an-card an-row' }, [
            el('div', null, [
              el('h2', { class: 'an-game-name' }, g.name || g.id),
              el('div', { class: 'an-meta' }, g.id + '.freegamestore.online'),
            ]),
            el('a', { class: 'an-link', href: '/analytics.html?game=' + encodeURIComponent(g.id) }, 'View →'),
          ]);
        }),
      );
    });
  }

  // --- One game (?game=) ---

  function renderGame(gameId, days, kind) {
    if (!GAME_ID_RE.test(gameId)) return setContent([errorCard('That game id is not valid.')]);
    setContent([el('p', { class: 'an-meta' }, 'Loading…')]);
    var qs = 'days=' + days + (kind && kind !== 'pageview' ? '&kind=' + encodeURIComponent(kind) : '');
    api('/api/analytics/' + encodeURIComponent(gameId) + '?' + qs).then(function (res) {
      if (res.status === 401) return setContent([signInCard()]);
      if (res.status === 403) return setContent([errorCard("This account doesn't own " + gameId + '.')]);
      if (res.status === 404) return setContent([errorCard('No game called ' + gameId + '.')]);
      if (res.status === 503) return setContent([errorCard('Analytics is not set up yet.')]);
      if (!res.ok) return setContent([errorCard(res.data.error || 'Something went wrong.')]);
      setContent(gameNodes(gameId, res.data, days, kind));
    });
  }

  function gameNodes(gameId, data, days, kind) {
    var stats = data.stats;
    return [
      el('p', { class: 'an-back' }, [el('a', { class: 'an-link', href: '/analytics.html' }, '← All games')]),
      el('div', { class: 'an-card an-row' }, [
        el('h2', { class: 'an-game-name' }, gameId),
        windowPicker(gameId, days, kind),
      ]),
      el('div', { class: 'an-card' }, [
        el('div', { class: 'an-kpis' }, [
          kpi(kind === 'pageview' ? 'Page views' : '“' + kind + '” events', fmt(stats.total_views)),
          kpi('Distinct pages', fmt(stats.unique_paths)),
        ]),
        chart(stats.series, data.bucket),
      ]),
      el('div', { class: 'an-grid' }, [
        breakdown('Top pages', stats.top_paths.map(function (r) { return [r.path, r.views]; })),
        breakdown('Referrers', stats.top_referrers.map(function (r) { return [r.referrer, r.views]; })),
        breakdown('Countries', stats.top_countries.map(function (r) { return [r.country, r.views]; })),
        breakdown('Devices', stats.device_split.map(function (r) { return [r.device, r.views]; })),
      ]),
      eventsCard(gameId, days, kind, stats.events),
      tagForm(gameId, data.config || {}),
    ];
  }

  function kpi(label, value) {
    return el('div', { class: 'an-kpi' }, [el('div', { class: 'an-label' }, label), el('div', { class: 'an-value' }, value)]);
  }

  function windowPicker(gameId, days, kind) {
    var select = el('select', { class: 'an-select', 'aria-label': 'Time window' });
    WINDOWS.forEach(function (d) {
      var opt = el('option', { value: String(d) }, 'Last ' + d + ' day' + (d === 1 ? '' : 's'));
      if (d === days) opt.setAttribute('selected', '');
      select.appendChild(opt);
    });
    select.addEventListener('change', function () {
      var next = parseInt(select.value, 10);
      history.replaceState(null, '', pageUrl(gameId, next, kind));
      renderGame(gameId, next, kind);
    });
    return select;
  }

  function pageUrl(gameId, days, kind) {
    var qs = '?game=' + encodeURIComponent(gameId) + '&days=' + days;
    if (kind && kind !== 'pageview') qs += '&kind=' + encodeURIComponent(kind);
    return qs;
  }

  // Bars are SVG rects with x/y/width/height attributes only. No style attributes,
  // so the chart renders under the strict CSP.
  function chart(series, bucket) {
    if (!series.length) {
      return el('p', { class: 'an-meta' }, 'No ' + (bucket === 'hour' ? 'hourly' : 'daily') + ' data in this window.');
    }
    var W = 600;
    var H = 120;
    var max = Math.max.apply(null, [1].concat(series.map(function (d) { return Number(d.views) || 0; })));
    var slot = W / series.length;
    var svg = svgEl('svg', {
      viewBox: '0 0 ' + W + ' ' + H,
      preserveAspectRatio: 'none',
      class: 'an-chart-svg',
      role: 'img',
      'aria-label': (bucket === 'hour' ? 'Hourly' : 'Daily') + ' views',
    });
    series.forEach(function (d, i) {
      var views = Number(d.views) || 0;
      var h = Math.max(0, Math.min(H - 2, (views / max) * (H - 2)));
      var rect = svgEl('rect', {
        x: i * slot,
        y: H - h,
        width: Math.max(1, slot - 2),
        height: h,
        opacity: views > 0 ? '0.85' : '0.2',
      });
      var title = svgEl('title', {});
      title.textContent = String(d.t || '') + ': ' + views;
      rect.appendChild(title);
      svg.appendChild(rect);
    });
    var first = series[0].t;
    var last = series[series.length - 1].t;
    return el('div', { class: 'an-chart' }, [
      svg,
      el('div', { class: 'an-axis' }, [el('span', null, String(first)), el('span', null, String(last))]),
    ]);
  }

  function breakdown(title, rows) {
    var list = rows.length
      ? el(
          'ul',
          { class: 'an-list' },
          rows.map(function (r) {
            return el('li', null, [
              el('span', { class: 'an-trunc' }, r[0] || '(direct)'),
              el('span', { class: 'an-num' }, fmt(r[1])),
            ]);
          }),
        )
      : el('p', { class: 'an-meta' }, 'No data yet.');
    return el('div', { class: 'an-card' }, [el('h3', { class: 'an-subhead' }, title), list]);
  }

  // Each event kind is a link to the same page filtered to that kind. Plain links
  // keep the events list free of script.
  function eventsCard(gameId, days, kind, events) {
    if (!events.length) return el('div', { class: 'an-card' }, [el('h3', { class: 'an-subhead' }, 'Custom events'), el('p', { class: 'an-meta' }, 'No custom events yet.')]);
    return el('div', { class: 'an-card' }, [
      el('h3', { class: 'an-subhead' }, 'Custom events'),
      el(
        'ul',
        { class: 'an-pills' },
        events.map(function (e) {
          var on = e.kind === kind;
          return el('li', null, [
            el(
              'a',
              { class: on ? 'an-pill an-pill-on' : 'an-pill', href: pageUrl(gameId, days, on ? 'pageview' : e.kind) },
              e.kind + ' · ' + fmt(e.count),
            ),
          ]);
        }),
      ),
    ]);
  }

  // The owner's BYO tags. Saved with a PUT, and the loader picks them up within
  // the hour (its edge cache).
  function tagForm(gameId, config) {
    var ga4 = el('input', { id: 'an-ga4', type: 'text', value: config.ga4 || '', placeholder: 'G-XXXXXXXXXX', autocomplete: 'off', maxlength: '20' });
    var plausible = el('input', { id: 'an-plausible', type: 'text', value: config.plausible || '', placeholder: 'mygame.freegamestore.online', autocomplete: 'off', maxlength: '254' });
    var status = el('span', { class: 'an-meta', role: 'status' });
    var submit = el('button', { class: 'an-btn', type: 'submit' }, 'Save tags');
    var form = el('form', { class: 'an-card an-form' }, [
      el('h3', { class: 'an-subhead' }, 'Your analytics tags'),
      el('label', { class: 'an-label', for: 'an-ga4' }, 'Google Analytics 4 ID (optional)'),
      ga4,
      el('label', { class: 'an-label', for: 'an-plausible' }, 'Plausible domain (optional)'),
      plausible,
      el('div', { class: 'an-actions' }, [submit, status]),
    ]);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submit.disabled = true;
      status.className = 'an-meta';
      status.textContent = 'Saving…';
      var body = JSON.stringify({ ga4: ga4.value.trim() || null, plausible: plausible.value.trim() || null });
      api('/api/analytics/' + encodeURIComponent(gameId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: body,
      }).then(function (res) {
        submit.disabled = false;
        if (res.ok) {
          status.textContent = 'Saved. Visitors pick the change up within an hour.';
        } else {
          status.className = 'an-error';
          status.textContent = res.data.error || 'Could not save.';
        }
      });
    });
    return form;
  }

  // --- Start ---

  var params = new URLSearchParams(location.search);
  var gameId = params.get('game');
  var days = parseInt(params.get('days') || '7', 10);
  if (WINDOWS.indexOf(days) < 0) days = 7;
  var kind = params.get('kind') || 'pageview';
  if (gameId) renderGame(gameId, days, kind);
  else renderList();
})();
