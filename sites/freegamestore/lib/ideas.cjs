// Game ideas page (freegamestore.online/ideas): popular game archetypes with
// proven demand to rebuild as free, MIT, no-ads, no-tracking web games on the
// @freegamestore/games SDK. One dataset (data/game-ideas.json, derived from
// docs/app-research/*.md) drives the page.
//
// Buildability is NOT hand-labelled: it is computed from what an idea
// `requires` vs what FGS can do today, so a card names its own blocker.
//
// This file is the #403 epic's contract (child #404). The renderer
// (renderIdeasPage) and the build wiring land in #406; this file ships the
// vocabulary, the validator, and the verdict/status computation only.
//
// ── Dataset shape (data/game-ideas.json) ──
//   { "researchDate": "YYYY-MM-DD", "ideas": [ Idea, … ] }
//   Idea = {
//     id:         kebab-case, unique
//     name:       1–80 chars
//     category:   one of CATEGORIES (the FGS registry categories)
//     pitch:      ≤300   — why players want it
//     fgsEdge:    ≤300   — why the free/offline FGS build wins (optional)
//     mechanic:   ≤120   — the core loop in a phrase (optional)
//     difficulty: easy | medium | hard
//     decision:   build-now | build-now-rooms-later | upgrade-existing | defer | wont-build
//     demand:     1–5     — strength of the demand evidence
//     wave:       1–9     — optional rollout wave
//     engine:     one of ENGINES — the FGS engine it maps to
//     bundleTier: 300 | 600 — gzip KB budget (2D/DOM vs heavy engine/3D)
//     primitives: subset of PRIMITIVES actually used
//     requires:   subset of BLOCKERS it needs that FGS lacks ([] = buildable now)
//     caveats:    REQUIRED ≤400 — IP/trademark notes (generic mechanics only)
//     fgsGames:   existing catalog ids it matches, or "partial:<id>" (optional)
//     sources:    ≥1 of SOURCES
//     leaders:    ≤8 of { name, store, installs?, rating?, reviews?, chartRank?, chart?, price?, url? }
//   }

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

// The FGS registry categories (sites/freegamestore/registry.json `category`).
const CATEGORIES = [
  'arcade', 'puzzle', 'strategy', 'racing', 'sports', 'cards', 'board', 'rpg', 'action', 'casual',
];
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const DECISIONS = ['build-now', 'build-now-rooms-later', 'upgrade-existing', 'defer', 'wont-build'];

// The engines a game can be built on (workers/agent ENGINE_TEMPLATE_REPOS keys,
// plus "any-2d"/"dom" for ideas not tied to one engine).
const ENGINES = [
  'canvas', 'grid', 'cards', 'kaplay', 'phaser', '3d', 'pixi', 'babylon', 'excalibur', 'littlejs',
  'any-2d', 'dom',
];
const BUNDLE_TIERS = [300, 600];

// What FGS gives a game today. A card lists the ones an idea uses.
const PRIMITIVE_LABELS = {
  localStorage: 'local saves',
  seed: 'daily seed',
  auth: 'sign-in',
  sounds: 'sound',
};
const PRIMITIVES = Object.keys(PRIMITIVE_LABELS);

// What an idea may need that FGS does NOT have. `realtime-rooms` is special:
// the turn-based version ships now as local hot-seat, so it is buildable with a
// caveat rather than blocked. The rest have no path today.
const BLOCKER_LABELS = {
  'realtime-rooms': 'online multiplayer rooms',
  'server-compute': 'server-side logic',
  cron: 'scheduled jobs',
  payments: 'payments',
  'big-assets': 'large asset storage',
};
const BLOCKERS = Object.keys(BLOCKER_LABELS);
const ROOMS = 'realtime-rooms';
const PERMANENT_BLOCKERS = BLOCKERS.filter((b) => b !== ROOMS);

const STORES = ['play', 'apple'];
const SOURCES = ['play', 'apple', 'niche', 'fgs-research'];
// Store links are the only outbound URLs on the page; pin them so a bad data
// edit can't turn the page into a link farm. (Shared with FreeAppStore.)
const STORE_URL_RE = {
  play: /^https:\/\/play\.google\.com\/store\/apps\/details\?id=[A-Za-z0-9._]+(?:&[A-Za-z0-9=._-]+)*$/,
  apple: /^https:\/\/apps\.apple\.com\/[a-z]{2}\/app\/(?:[a-z0-9-]+\/)?id\d+$/,
};
// A fgsGames entry is either a catalog id or "partial:<catalog-id>".
const FGS_GAME_RE = /^(partial:)?[a-z0-9][a-z0-9-]*$/;

function text(s, max) {
  return typeof s === 'string' && s.length > 0 && s.length <= max && !/[\x00-\x1f\x7f]/.test(s);
}
function optText(s, max) {
  return s == null || text(s, max);
}
function subsetOf(list, allowed) {
  return Array.isArray(list) && list.every((x) => allowed.includes(x));
}

function validateIdeas(data) {
  const errors = [];
  if (!data || !Array.isArray(data.ideas)) return ['ideas must be an array'];
  if (!optText(data.researchDate, 20)) errors.push('bad researchDate');
  const seen = new Set();
  for (const idea of data.ideas) {
    const id = idea && idea.id;
    const at = `idea ${JSON.stringify(id)}`;
    if (!id || !ID_RE.test(id)) { errors.push(`${at}: bad id`); continue; }
    if (seen.has(id)) errors.push(`${at}: duplicate id`);
    seen.add(id);
    if (!text(idea.name, 80)) errors.push(`${at}: name must be 1-80 chars`);
    if (!CATEGORIES.includes(idea.category)) errors.push(`${at}: unknown category ${JSON.stringify(idea.category)}`);
    if (!DIFFICULTIES.includes(idea.difficulty)) errors.push(`${at}: unknown difficulty ${JSON.stringify(idea.difficulty)}`);
    if (!DECISIONS.includes(idea.decision)) errors.push(`${at}: unknown decision ${JSON.stringify(idea.decision)}`);
    if (!Number.isInteger(idea.demand) || idea.demand < 1 || idea.demand > 5) errors.push(`${at}: demand must be 1-5`);
    if (idea.wave != null && !(Number.isInteger(idea.wave) && idea.wave >= 1 && idea.wave <= 9)) errors.push(`${at}: bad wave`);
    if (!ENGINES.includes(idea.engine)) errors.push(`${at}: unknown engine ${JSON.stringify(idea.engine)}`);
    if (!BUNDLE_TIERS.includes(idea.bundleTier)) errors.push(`${at}: bundleTier must be 300 or 600`);
    for (const k of ['pitch', 'fgsEdge', 'mechanic']) {
      const max = k === 'mechanic' ? 120 : 300;
      if (!optText(idea[k], max)) errors.push(`${at}: ${k} too long`);
    }
    // caveats is REQUIRED for games — every idea must state its IP position.
    if (!text(idea.caveats, 400)) errors.push(`${at}: caveats are required (1-400 chars)`);
    if (!subsetOf(idea.primitives, PRIMITIVES)) errors.push(`${at}: primitives must be a subset of ${PRIMITIVES.join('/')}`);
    if (idea.requires != null && !subsetOf(idea.requires, BLOCKERS)) errors.push(`${at}: requires must be blocker ids`);
    if (idea.fgsGames != null && !(Array.isArray(idea.fgsGames) && idea.fgsGames.every((g) => typeof g === 'string' && FGS_GAME_RE.test(g)))) {
      errors.push(`${at}: fgsGames must be catalog ids or "partial:<id>"`);
    }
    if (!Array.isArray(idea.sources) || idea.sources.length < 1 || !idea.sources.every((s) => SOURCES.includes(s))) {
      errors.push(`${at}: sources must be a non-empty subset of ${SOURCES.join('/')}`);
    }
    // A buildable-now idea must not carry a blocker; a wont-build must.
    const req = Array.isArray(idea.requires) ? idea.requires : [];
    if (idea.decision === 'build-now' && req.length) errors.push(`${at}: build-now cannot require ${req.join(',')}`);
    if (idea.decision === 'build-now-rooms-later' && !req.includes(ROOMS)) errors.push(`${at}: build-now-rooms-later must require realtime-rooms`);
    if (idea.decision === 'wont-build' && !req.some((r) => PERMANENT_BLOCKERS.includes(r))) errors.push(`${at}: wont-build must require a permanent blocker`);
    if (!Array.isArray(idea.leaders) || idea.leaders.length > 8) { errors.push(`${at}: leaders must be an array of ≤ 8`); continue; }
    for (const l of idea.leaders) {
      if (!l || !text(l.name, 80)) { errors.push(`${at}: leader needs a name`); continue; }
      if (!STORES.includes(l.store)) errors.push(`${at}: leader ${l.name}: bad store`);
      if (l.url != null && !(STORE_URL_RE[l.store] && STORE_URL_RE[l.store].test(l.url))) errors.push(`${at}: leader ${l.name}: url is not a ${l.store} listing: ${JSON.stringify(l.url)}`);
      if (l.rating != null && !(typeof l.rating === 'number' && l.rating >= 0 && l.rating <= 5)) errors.push(`${at}: leader ${l.name}: bad rating`);
      if (l.chartRank != null && !(Number.isInteger(l.chartRank) && l.chartRank > 0)) errors.push(`${at}: leader ${l.name}: bad chartRank`);
      for (const k of ['installs', 'reviews', 'chart', 'price']) {
        if (!optText(l[k], 40)) errors.push(`${at}: leader ${l.name}: bad ${k}`);
      }
    }
  }
  return errors;
}

// Can FGS build `idea` today? → { kind, missing }.
//   'ok'         buildable now (no blockers)
//   'needs-rooms' turn-based: local hot-seat ships now, online needs the rooms primitive
//   'blocked'    needs a capability FGS has no path to (server/cron/payments/big-assets)
function verdictFor(idea) {
  const req = Array.isArray(idea.requires) ? idea.requires : [];
  const permanent = req.filter((r) => PERMANENT_BLOCKERS.includes(r));
  if (permanent.length) return { kind: 'blocked', missing: permanent };
  if (req.includes(ROOMS)) return { kind: 'needs-rooms', missing: [ROOMS] };
  return { kind: 'ok', missing: [] };
}
function buildable(v) {
  return v.kind === 'ok' || v.kind === 'needs-rooms';
}

// The status a card filters on.
//   'blocked'  not buildable on FGS
//   'rooms'    buildable as local hot-seat now; online waits on the rooms primitive
//   'covered'  an existing FGS game already ships it
//   'partial'  an existing FGS game ships the base, not this variant
//   'upgrade'  improve an existing game rather than build new
//   'open'     buildable now and nothing in the catalog covers it — the ones to pick up
function statusOf(idea) {
  const v = verdictFor(idea);
  if (v.kind === 'blocked') return 'blocked';
  const games = Array.isArray(idea.fgsGames) ? idea.fgsGames : [];
  const hasPartial = games.some((g) => g.startsWith('partial:'));
  const hasFull = games.some((g) => !g.startsWith('partial:'));
  if (idea.decision === 'upgrade-existing') return 'upgrade';
  if (hasFull) return 'covered';
  if (hasPartial) return 'partial';
  if (v.kind === 'needs-rooms') return 'rooms';
  return 'open';
}

function blockerPhrase(ids) {
  const labels = [...new Set(ids)].map((b) => BLOCKER_LABELS[b] || b);
  return labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}` : labels[0];
}

// ── Rendering (child #406) ──
// Single store, read-only list: no claim flow, no cross-store links.

const DIFFICULTY_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const STORE_LABEL = { play: 'Google Play', apple: 'App Store' };
const ENGINE_LABEL = {
  canvas: 'Canvas 2D', grid: 'CSS grid', cards: 'card kit', kaplay: 'KAPLAY', phaser: 'Phaser',
  '3d': '3D (three.js)', pixi: 'Pixi.js', babylon: 'Babylon.js', excalibur: 'Excalibur',
  littlejs: 'LittleJS', 'any-2d': '2D', dom: 'DOM',
};

function leaderLine(l, esc) {
  const stats = [];
  if (l.installs) stats.push(`${esc(l.installs)} installs`);
  if (l.chartRank) stats.push(`#${l.chartRank}${l.chart ? ` ${esc(l.chart)}` : ''}`);
  if (l.rating != null) stats.push(`${l.rating.toFixed(1)}★`);
  if (l.reviews) stats.push(`${esc(l.reviews)} reviews`);
  if (l.price) stats.push(esc(l.price));
  const name = l.url
    ? `<a href="${esc(l.url)}" rel="noopener nofollow" target="_blank">${esc(l.name)}</a>`
    : esc(l.name);
  return `<li><span class="ideas-store ideas-store-${l.store}">${STORE_LABEL[l.store]}</span> <span class="ideas-leader-name">${name}</span>${stats.length ? ` <span class="ideas-leader-stats">${stats.join(' · ')}</span>` : ''}</li>`;
}

function buildPrompt(idea) {
  const leaders = idea.leaders.map((l) => `${l.name} (${STORE_LABEL[l.store]})`).join(', ');
  const prims = (idea.primitives || []).map((p) => PRIMITIVE_LABELS[p] || p).join(', ');
  return [
    `Build a free web game for FreeGameStore: ${idea.name}.`,
    idea.pitch ? `Why people want it: ${idea.pitch}` : '',
    leaders ? `Market leaders to match or beat: ${leaders}.` : '',
    idea.fgsEdge ? `Our edge: ${idea.fgsEdge}` : '',
    `Engine: ${ENGINE_LABEL[idea.engine] || idea.engine}, ${idea.bundleTier} KB gzip budget.`,
    prims ? `FGS features to use: ${prims}.` : '',
    idea.caveats ? `Watch out for: ${idea.caveats}` : '',
  ].filter(Boolean).join('\n');
}

function renderCard(idea, esc, appHref) {
  const status = statusOf(idea);
  const v = verdictFor(idea);
  const canBuild = buildable(v);
  const dots = Array.from({ length: 5 }, (_, i) => `<span class="${i < idea.demand ? 'on' : ''}"></span>`).join('');

  const badges = [];
  if (status === 'open') badges.push('<span class="ideas-badge ideas-badge-open">Not on FGS yet</span>');
  if (status === 'partial') badges.push('<span class="ideas-badge ideas-badge-partial">A variant is missing</span>');
  if (status === 'upgrade') badges.push('<span class="ideas-badge ideas-badge-upgrade">Build a better one</span>');
  if (status === 'rooms') badges.push('<span class="ideas-badge ideas-badge-rooms">Local now · online needs rooms</span>');
  if (status === 'blocked') badges.push(`<span class="ideas-badge ideas-badge-blocked">Not possible yet: needs ${esc(blockerPhrase(v.missing))}</span>`);
  badges.push(`<span class="ideas-badge ideas-diff-${idea.difficulty}">${DIFFICULTY_LABEL[idea.difficulty]}</span>`);
  badges.push(`<span class="ideas-badge ideas-engine">${esc(ENGINE_LABEL[idea.engine] || idea.engine)} · ${idea.bundleTier} KB</span>`);

  const games = (idea.fgsGames || []).map((g) => g.replace(/^partial:/, ''));
  const onFgs = games.length
    ? `<p class="ideas-onfgs">On FGS: ${games.map((id) => (appHref ? `<a href="${esc(appHref(id))}">${esc(id)}</a>` : esc(id))).join(', ')}</p>`
    : '';

  const details = [];
  if ((idea.primitives || []).length) details.push(`<p><strong>Uses:</strong> ${idea.primitives.map((p) => esc(PRIMITIVE_LABELS[p] || p)).join(', ')}</p>`);
  if (status === 'rooms') details.push('<p><strong>Multiplayer:</strong> turn-based local hot-seat ships now; online play waits on the FGS rooms primitive.</p>');
  if (idea.caveats) details.push(`<p><strong>Watch out for:</strong> ${esc(idea.caveats)}</p>`);

  const searchText = [idea.name, idea.category, idea.pitch, ...idea.leaders.map((l) => l.name), ...games]
    .filter(Boolean).join(' ').toLowerCase();

  return `<article class="ideas-card ideas-status-${status}" id="idea-${idea.id}" data-id="${idea.id}" data-status="${status}" data-category="${esc(idea.category)}" data-demand="${idea.demand}" data-difficulty="${DIFFICULTIES.indexOf(idea.difficulty)}" data-engine="${esc(idea.engine)}" data-search="${esc(searchText)}">
  <div class="ideas-card-head">
    <div>
      <h3><a href="#idea-${idea.id}">${esc(idea.name)}</a></h3>
      <span class="ideas-cat">${esc(idea.category)}</span>
    </div>
    <div class="ideas-demand" title="Demand ${idea.demand} of 5, from installs and chart position" aria-label="Demand ${idea.demand} of 5">${dots}</div>
  </div>
  <div class="ideas-badges">${badges.join('')}</div>
  ${idea.pitch ? `<p class="ideas-pitch">${esc(idea.pitch)}</p>` : ''}
  ${idea.fgsEdge ? `<p class="ideas-edge"><strong>FGS edge:</strong> ${esc(idea.fgsEdge)}</p>` : ''}
  ${idea.leaders.length ? `<ul class="ideas-leaders" aria-label="Market leaders">${idea.leaders.map((l) => leaderLine(l, esc)).join('')}</ul>` : ''}
  ${onFgs}
  ${details.length ? `<details class="ideas-details"><summary>Build notes</summary>${details.join('')}</details>` : ''}
  ${canBuild ? `<div class="ideas-actions"><button type="button" class="ideas-copy" data-prompt="${esc(buildPrompt(idea))}">Copy build prompt</button></div>` : ''}
</article>`;
}

// template: the ideas.html with {{IDEAS_*}} placeholders.
// opts: { escapeHtml, appHref? }  (appHref(id) → a storefront link for a catalog game)
function renderIdeasPage(template, data, opts) {
  const esc = opts.escapeHtml;
  const appHref = opts.appHref || null;
  const ideas = data.ideas;
  const statuses = ideas.map((i) => statusOf(i));
  const count = (...s) => statuses.filter((x) => s.includes(x)).length;
  // "All" is the default (first, leftmost, active) so the highlighted filter
  // matches the full list the page shows on load; ideas.js re-applies whatever
  // button is marked active, so the two can never drift (#411).
  const groups = [
    ['all', 'All', null],
    ['open', 'Not on FGS yet', ['open']],
    ['partial', 'Variants missing', ['partial']],
    ['buildable', 'All buildable now', ['open', 'covered', 'partial', 'upgrade', 'rooms']],
    ['rooms', 'Needs online rooms', ['rooms']],
    ['blocked', 'Not possible yet', ['blocked']],
  ].filter(([key, , s]) => key === 'all' || count(...s) > 0);
  const statusButtons = groups.map(([key, label, s], i) =>
    `<button class="filter-btn${i === 0 ? ' active' : ''}" type="button" data-status="${key}" data-statuses="${s ? s.join(' ') : ''}" aria-pressed="${i === 0}">${esc(label)} <span class="ideas-btn-count">${s ? count(...s) : ideas.length}</span></button>`
  ).join('\n          ');
  const usedCategories = CATEGORIES.filter((c) => ideas.some((i) => i.category === c));
  const categoryButtons = usedCategories
    .map((c) => `<button class="filter-btn" type="button" data-category="${esc(c)}" aria-pressed="false">${esc(c)}</button>`)
    .join('\n          ');
  const values = {
    IDEAS_CARDS: ideas.map((i) => renderCard(i, esc, appHref)).join('\n'),
    IDEAS_STATUS_BUTTONS: statusButtons,
    IDEAS_CATEGORY_BUTTONS: categoryButtons,
    IDEAS_COUNT: String(ideas.length),
    IDEAS_OPEN_COUNT: String(count('open')),
    IDEAS_READY_COUNT: String(count('open', 'covered', 'partial', 'upgrade', 'rooms')),
    IDEAS_RESEARCH_DATE: esc(data.researchDate || 'the research date'),
  };
  return template.replace(/{{(IDEAS_[A-Z_]+)}}/g, (m, k) => (k in values ? values[k] : m));
}

module.exports = {
  CATEGORIES,
  DIFFICULTIES,
  DECISIONS,
  ENGINES,
  BUNDLE_TIERS,
  PRIMITIVES,
  PRIMITIVE_LABELS,
  BLOCKERS,
  BLOCKER_LABELS,
  PERMANENT_BLOCKERS,
  ROOMS,
  STORES,
  SOURCES,
  STORE_URL_RE,
  DIFFICULTY_LABEL,
  ENGINE_LABEL,
  validateIdeas,
  verdictFor,
  buildable,
  statusOf,
  blockerPhrase,
  renderIdeasPage,
};
