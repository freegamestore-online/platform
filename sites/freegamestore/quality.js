/**
 * Quality Dashboard runtime.
 *
 * Two views from one page:
 *   /quality.html              — summary list of every app + last known score
 *   /quality.html?app=<id>     — detail: 12 iframes of <id>, one per
 *                                reference viewport, listening for
 *                                fgs:quality postMessages from each.
 *
 * Why iframes (not headless browser):
 * - Anyone can audit any app — public transparency.
 * - Real browser the visitor is using, no Playwright dependency.
 * - Cooperation contract: games can ship with @freeappstore/quality which
 *   posts viewport metrics back to a parent dashboard. Games that opt
 *   out can still be listed but won't show a score.
 *
 * Caveats:
 * - Cross-origin (each app is its own subdomain) so we can't read
 *   iframe.contentDocument. The postMessage protocol IS the API.
 * - Mobile users opening this page on their phone get all iframes at
 *   the same on-screen size (phone width); the `transform: scale()`
 *   trick visually previews larger viewports. The audit numbers we
 *   read still come from the iframe's own perspective, so the data
 *   is correct.
 */

// Escape registry-sourced strings before injecting into innerHTML. Game names
// come from the registry (creator-supplied) and must not be trusted as HTML.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Reference viewport matrix. Mirrors packages/cli/src/commands/screencheck.ts
// computeCoverage exactly so dashboard scores match CLI scores. Each entry
// has a `share`: cumulative device share at that width — if the app fails
// at this width, that's the % of devices it's broken on.
const REFERENCE = [
  { id: 'p-320',  label: '320×568 iPhone SE',      width: 320,  height: 568,  orientation: 'portrait',  share: 99, kind: 'phone' },
  { id: 'p-360',  label: '360×800 Android',         width: 360,  height: 800,  orientation: 'portrait',  share: 96, kind: 'phone' },
  { id: 'p-393',  label: '393×852 iPhone 15',       width: 393,  height: 852,  orientation: 'portrait',  share: 92, kind: 'phone' },
  { id: 'p-414',  label: '414×896 iPhone 11 PM',    width: 414,  height: 896,  orientation: 'portrait',  share: 88, kind: 'phone' },
  { id: 'p-600',  label: '600×800 Tablet',          width: 600,  height: 800,  orientation: 'portrait',  share: 60, kind: 'tablet' },
  { id: 'p-768',  label: '768×1024 iPad',           width: 768,  height: 1024, orientation: 'portrait',  share: 35, kind: 'tablet' },
  { id: 'p-1024', label: '1024×1366 iPad Pro',      width: 1024, height: 1366, orientation: 'portrait',  share: 20, kind: 'tablet' },
  { id: 'l-568',  label: '568×320 iPhone SE land.', width: 568,  height: 320,  orientation: 'landscape', share: 99, kind: 'phone' },
  { id: 'l-667',  label: '667×375 iPhone 8 land.',  width: 667,  height: 375,  orientation: 'landscape', share: 96, kind: 'phone' },
  { id: 'l-736',  label: '736×414 iPhone+ land.',   width: 736,  height: 414,  orientation: 'landscape', share: 88, kind: 'phone' },
  { id: 'l-1024', label: '1024×768 iPad land.',     width: 1024, height: 768,  orientation: 'landscape', share: 35, kind: 'tablet' },
  { id: 'l-1366', label: '1366×1024 iPad Pro land.',width: 1366, height: 1024, orientation: 'landscape', share: 20, kind: 'tablet' },
];

// LocalStorage cache key. Last-seen score per appId, used by the
// summary list so it shows something useful before any iframes load.
const CACHE_KEY = 'fgs:quality:scores:v1';
const REPORT_TIMEOUT_MS = 6000;

// ---- helpers ----

function loadRegistry() {
  const el = document.getElementById('q-registry');
  if (!el) return { apps: [], games: [] };
  try {
    return JSON.parse(el.textContent || '{}');
  } catch {
    return { apps: [], games: [] };
  }
}

function getCachedScores() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function setCachedScore(appId, score) {
  try {
    const all = getCachedScores();
    all[appId] = { score, at: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {}
}

function indexClass(score) {
  if (score == null) return 'unknown';
  if (score >= 95) return 'ok';
  if (score >= 80) return 'warn';
  return 'bad';
}

/**
 * Compute Quality Index from a per-viewport pass map. Score is the
 * worst orientation's max-passing-share — i.e., the smallest device
 * share at which the layout still works.
 *
 * If portrait passes at 320 (99% share) and landscape only at 800
 * (60% share), overall score = 60 — the worst-case orientation
 * binds because users encounter both.
 */
function computeIndex(passing) {
  let portraitScore = 0;
  let landscapeScore = 0;
  let portraitSeen = false;
  let landscapeSeen = false;
  for (const r of REFERENCE) {
    const seen = passing.has(r.id);
    if (r.orientation === 'portrait') {
      portraitSeen = true;
      if (seen) portraitScore = Math.max(portraitScore, r.share);
    } else {
      landscapeSeen = true;
      if (seen) landscapeScore = Math.max(landscapeScore, r.share);
    }
  }
  if (portraitSeen && landscapeSeen) return Math.min(portraitScore, landscapeScore);
  if (portraitSeen) return portraitScore;
  return landscapeScore;
}

// ---- summary view ----

function renderSummary(store) {
  const reg = loadRegistry();
  const list = document.getElementById('q-summary-list');
  if (!list) return;
  let items = [];
  if (store === 'apps' || store === 'all') items = items.concat((reg.apps || []).map(a => ({ ...a, store: 'apps' })));
  if (store === 'games' || store === 'all') items = items.concat((reg.games || []).map(a => ({ ...a, store: 'games' })));
  // Platform fixtures are surfaced separately at the bottom — they're
  // not real apps and shouldn't pollute the score-weighted list.
  if (store === 'fixtures' || store === 'all') items = items.concat((reg.fixtures || []).map(a => ({ ...a, store: 'fixtures' })));
  items.sort((a, b) => a.id.localeCompare(b.id));
  if (items.length === 0) {
    list.innerHTML = '<div class="q-empty">No apps registered.</div>';
    return;
  }
  const cached = getCachedScores();
  list.innerHTML = items.map((a) => {
    const c = cached[a.id];
    const score = c ? c.score : null;
    const cls = indexClass(score);
    const meta = c ? `Last checked ${new Date(c.at).toLocaleString()}` : 'Not yet measured';
    return `
      <a class="q-card" href="/quality.html?app=${encodeURIComponent(a.id)}&store=${a.store}">
        <div class="q-card-head">
          <span class="name">${escapeHtml(a.name || a.id)}</span>
          <span class="index ${cls}">${score == null ? '—' : score}</span>
        </div>
        <div class="meta">${a.store === 'apps' ? 'App' : 'Game'} · ${meta}</div>
      </a>
    `;
  }).join('');
}

function setupStoreTabs() {
  const tabs = document.getElementById('q-store-tabs');
  if (!tabs) return;
  tabs.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (target.tagName !== 'BUTTON') return;
    Array.from(tabs.querySelectorAll('button')).forEach(b => b.classList.remove('active'));
    target.classList.add('active');
    renderSummary(target.dataset.store);
  });
}

// ---- detail view ----

/**
 * Render the iframe grid for one app. Each cell:
 * - hosts an iframe sized to its target width × height
 * - shows pending shimmer until the first postMessage lands
 * - flips to ✓/✗ with reason text once the report comes in
 */
function renderDetail(appEntry, mode) {
  const grid = document.getElementById('q-grid');
  const indexEl = document.getElementById('q-detail-index');
  const passing = new Set();
  const reports = new Map();

  const filtered = REFERENCE.filter((r) =>
    mode === 'phone' ? r.kind === 'phone'
    : mode === 'tablet' ? r.kind === 'tablet'
    : true,
  );

  grid.innerHTML = filtered.map((r) => {
    // We render iframes at their TRUE pixel size so the page layout
    // inside is honest. A CSS `transform: scale()` makes the preview
    // fit in our card without distorting layout numbers.
    const cardWidth = 220;
    const scale = Math.min(cardWidth / r.width, cardWidth / r.height);
    const wrapH = Math.round(r.height * scale);
    return `
      <div class="q-cell q-pending" data-vp="${r.id}">
        <div class="q-cell-head">
          <span>${r.label}</span>
          <span class="badge">…</span>
        </div>
        <div class="q-frame-wrap" style="height: ${wrapH}px;">
          <iframe
            src="${appEntry.appUrl}"
            width="${r.width}"
            height="${r.height}"
            style="width:${r.width}px;height:${r.height}px;transform:scale(${scale.toFixed(4)});"
            loading="lazy"
            sandbox="allow-scripts allow-same-origin"
            referrerpolicy="no-referrer"
            data-vp="${r.id}"
          ></iframe>
        </div>
        <div class="reasons">Loading…</div>
      </div>
    `;
  }).join('');

  // Listen for reports. We can't tell which iframe sent which message
  // because cross-origin iframes don't expose `event.source` identity
  // in a reliable way, but the report carries `viewport.width/height`
  // — match by that.
  const handler = (e) => {
    const data = e.data;
    if (!data || (data.type !== 'fgs:quality' && data.type !== 'fas:quality')) return;
    const vp = REFERENCE.find(r => r.width === data.viewport.width && r.height === data.viewport.height);
    if (!vp) return;
    reports.set(vp.id, data);
    const cell = grid.querySelector(`.q-cell[data-vp="${vp.id}"]`);
    if (!cell) return;
    cell.classList.remove('q-pending');
    const docFails = data.document.scrollsX || data.document.scrollsY;
    const clipFails = data.clipping.length > 0;
    const ok = !docFails && !clipFails;
    cell.classList.toggle('ok', ok);
    cell.classList.toggle('bad', !ok);
    cell.querySelector('.badge').textContent = ok ? '✓' : '✗';
    const reasons = [];
    if (data.document.scrollsX) reasons.push(`scrolls horizontally (${data.document.scrollWidth}px > ${data.document.clientWidth}px)`);
    if (data.document.scrollsY) reasons.push(`scrolls vertically (${data.document.scrollHeight}px > ${data.document.clientHeight}px)`);
    if (data.clipping.length > 0) {
      const first = data.clipping[0];
      reasons.push(`${data.clipping.length} clipping element${data.clipping.length === 1 ? '' : 's'} (${first.selector})`);
    }
    const r = cell.querySelector('.reasons');
    r.textContent = ok ? 'Fits cleanly' : reasons.join(' · ');
    r.classList.toggle('bad', !ok);

    if (ok) passing.add(vp.id);
    else passing.delete(vp.id);
    const score = computeIndex(passing);
    indexEl.textContent = String(score);
    indexEl.className = `index ${indexClass(score)}`;
    setCachedScore(appEntry.id, score);
  };
  window.addEventListener('message', handler);

  // Timeout: if a viewport never reports back, flag it as
  // "no quality reporter present" — opt-out / non-cooperative app.
  setTimeout(() => {
    grid.querySelectorAll('.q-cell.q-pending').forEach(cell => {
      cell.classList.remove('q-pending');
      cell.classList.add('bad');
      cell.querySelector('.badge').textContent = '?';
      const r = cell.querySelector('.reasons');
      r.textContent = 'No quality reporter — this app may be non-cooperative or pre-SDK.';
      r.classList.add('bad');
    });
  }, REPORT_TIMEOUT_MS);
}

function setupModeTabs(appEntry) {
  const tabs = document.getElementById('q-mode-tabs');
  if (!tabs) return;
  tabs.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (target.tagName !== 'BUTTON') return;
    Array.from(tabs.querySelectorAll('button')).forEach(b => b.classList.remove('active'));
    target.classList.add('active');
    renderDetail(appEntry, target.dataset.mode);
  });
}

// ---- entry ----

function init() {
  const params = new URLSearchParams(location.search);
  const appId = params.get('app');
  const store = params.get('store') || 'games';
  if (!appId) {
    document.getElementById('q-summary-view').hidden = false;
    document.getElementById('q-detail-view').hidden = true;
    setupStoreTabs();
    renderSummary('games');
    return;
  }
  const reg = loadRegistry();
  const list =
    store === 'games' ? (reg.games || [])
    : store === 'fixtures' ? (reg.fixtures || [])
    : (reg.apps || []);
  const entry = list.find(a => a.id === appId);
  if (!entry) {
    document.getElementById('q-summary-view').hidden = false;
    document.getElementById('q-detail-view').hidden = true;
    setupStoreTabs();
    renderSummary('games');
    return;
  }
  document.getElementById('q-summary-view').hidden = true;
  document.getElementById('q-detail-view').hidden = false;
  document.getElementById('q-detail-name').textContent = entry.name || entry.id;
  document.getElementById('q-detail-meta').textContent = entry.appUrl;
  setupModeTabs(entry);
  renderDetail(entry, 'all');
}

init();
