/**
 * Storefront search — client-side, federated across both stores.
 *
 * Design:
 * - Local cards (already in the DOM) are filtered by toggling [hidden].
 *   Pure DOM manipulation, no re-render.
 * - The OTHER store's registry is embedded at build time in
 *   <script type="application/json" id="cross-store-registry">. We read
 *   it on first input.
 * - Matching is fuzzy-light: case-insensitive substring across id, name,
 *   description, category. No fuzzy-tolerance scoring — keeps things
 *   predictable.
 * - All filtering is local; nothing is fetched at runtime.
 *
 * URL state: typing puts the query in `?q=` (replaceState — no scroll).
 * Refreshing or sharing the URL re-runs the search.
 */
(() => {
  const input = document.getElementById('storefront-search');
  const localGrid = document.getElementById('apps-grid');
  const emptyMsg = document.getElementById('search-empty');
  const crossSection = document.getElementById('cross-store-results');
  const crossGrid = document.getElementById('cross-store-grid');
  if (!input || !localGrid || !emptyMsg || !crossSection || !crossGrid) return;

  const localCards = Array.from(localGrid.querySelectorAll('.app-card'));
  // Pre-build a search-haystack for each local card so input handler
  // doesn't re-read DOM text on every keystroke.
  const localHaystacks = localCards.map((el) => {
    const text = (el.textContent || '').toLowerCase();
    const cat = (el.getAttribute('data-category') || '').toLowerCase();
    return { el, hay: `${text} ${cat}` };
  });

  let crossItems = [];
  try {
    const raw = document.getElementById('cross-store-registry')?.textContent;
    if (raw) {
      const parsed = JSON.parse(raw);
      // Registry shape: { items: [...], domain: 'freegamestore.online',
      // path: 'games' }. Build cards lazily.
      crossItems = (parsed.items || []).map((item) => ({
        ...item,
        domain: parsed.domain,
        path: parsed.path,
        hay:
          `${item.id} ${item.name} ${item.description} ${item.category}`.toLowerCase(),
      }));
    }
  } catch (e) {
    // Cross-store registry didn't load — local search still works.
  }

  function categoryLabel(cat) {
    return cat
      .split('-')
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(' ');
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function buildCrossCard(item) {
    const a = document.createElement('a');
    a.className = 'app-card compact';
    // URL path segments: use encodeURIComponent, not HTML-escape. esc() would
    // let `..` or `/` ride through. Build-time validators already constrain
    // `id`, but defense-in-depth.
    a.href = `https://${item.domain}/${encodeURIComponent(item.path)}/${encodeURIComponent(item.id)}.html`;
    a.target = '_blank';
    a.rel = 'noopener';
    a.style.textDecoration = 'none';
    const letter = (item.name || '?').trim().charAt(0).toUpperCase();
    const iconBg = item.iconBg || '#10b981';
    a.innerHTML = `
      <div class="app-icon" style="background: ${esc(iconBg)};">${esc(letter)}</div>
      <div class="app-body">
        <span class="app-name">${esc(item.name)}</span>
        <span class="app-meta">${esc(categoryLabel(item.category))} · on ${esc(item.domain.replace('.online', ''))}</span>
      </div>
      <span class="app-cta" aria-hidden="true">
        <svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="6,4 20,12 6,20"/></svg>
        Open
      </span>
    `;
    return a;
  }

  function applyQuery(q) {
    const needle = q.trim().toLowerCase();
    let localShown = 0;

    if (needle === '') {
      // Empty query — restore default: show all local, hide cross.
      for (const { el } of localHaystacks) el.hidden = false;
      emptyMsg.hidden = true;
      crossSection.hidden = true;
      crossGrid.innerHTML = '';
      return;
    }

    for (const { el, hay } of localHaystacks) {
      const match = hay.includes(needle);
      el.hidden = !match;
      if (match) localShown++;
    }
    emptyMsg.hidden = localShown > 0;

    // Cross-store hits.
    crossGrid.innerHTML = '';
    let crossShown = 0;
    for (const item of crossItems) {
      if (!item.hay.includes(needle)) continue;
      crossGrid.appendChild(buildCrossCard(item));
      crossShown++;
      if (crossShown >= 12) break; // sane cap
    }
    crossSection.hidden = crossShown === 0;
  }

  // Initial: pick up ?q= from URL.
  const initial = new URL(window.location.href).searchParams.get('q') || '';
  if (initial) {
    input.value = initial;
    applyQuery(initial);
  }

  // Live filtering. Debounce is overkill at this scale — local arrays
  // are small enough for synchronous filtering on every keystroke.
  input.addEventListener('input', () => {
    const q = input.value;
    applyQuery(q);
    const url = new URL(window.location.href);
    if (q.trim() === '') url.searchParams.delete('q');
    else url.searchParams.set('q', q);
    window.history.replaceState(null, '', url.toString());
  });
})();
