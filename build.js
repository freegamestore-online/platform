const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const ROOT = __dirname;
// DIST and the registry path can be overridden via env vars so the test
// suite in test/build.test.mjs can run a parallel build against a temp
// registry without touching real outputs.
const DIST = process.env.FGS_DIST ? path.resolve(process.env.FGS_DIST) : path.join(ROOT, 'dist');
const REGISTRY_PATH = process.env.FGS_REGISTRY_PATH ? path.resolve(process.env.FGS_REGISTRY_PATH) : path.join(ROOT, 'registry.json');

// Read registry
const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
let games = registry.games;

// Registry shape validator — stop malformed/malicious entries at build time.
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const COLOR_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const URL_RE = /^https:\/\/[a-z0-9.-]+\.freegamestore\.online(?:\/.*)?$/;
const GITHUB_USER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
// `icon` is the ONE registry field injected into HTML without escapeHtml() (it
// may legitimately be an HTML entity like &#9817; or an emoji). Constrain it so
// it can't carry markup: a single HTML entity, a short emoji sequence, or a few
// alphanumerics — never angle brackets / quotes / raw markup.
const ICON_RE = /^(?:&(?:#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});|[\p{Extended_Pictographic}‍️⃣#*0-9]{1,8}|[A-Za-z0-9]{1,4})$/u;
const PLATFORM_CREATOR_GITHUB = 'serge-ivo';
function safeText(s, max) {
  return typeof s === 'string' && s.length > 0 && s.length <= max && !/[\x00-\x1f\x7f]/.test(s);
}
// Resilient by design: a single malformed/malicious game entry must never take
// the whole store down. We validate each entry independently, DROP the invalid
// ones (they're excluded from the build, never deployed) with a loud warning,
// and continue building with the valid remainder. Returns the surviving games.
function validateRegistry(items) {
  const valid = [];
  const skipped = [];
  const seenIds = new Set();
  for (const g of items) {
    const errors = [];
    if (!g || typeof g !== 'object') {
      skipped.push({ id: '(not an object)', errors: [`entry is not an object: ${JSON.stringify(g)}`] });
      continue;
    }
    if (!g.id || !ID_RE.test(g.id)) errors.push(`bad id: ${JSON.stringify(g.id)}`);
    else if (seenIds.has(g.id)) errors.push(`duplicate id: ${JSON.stringify(g.id)}`);
    if (!safeText(g.name, 80)) errors.push(`name must be 1-80 chars without control chars`);
    if (!g.appUrl || !URL_RE.test(g.appUrl)) errors.push(`appUrl must be https://*.freegamestore.online, got ${JSON.stringify(g.appUrl)}`);
    if (g.iconBg && !COLOR_RE.test(g.iconBg)) errors.push(`iconBg must be a #hex color, got ${JSON.stringify(g.iconBg)}`);
    // Display-only optional fields: an EMPTY value means "not provided" (the
    // publish flow writes description:"" by default), and a present-but-malformed
    // value is a cosmetic problem — never a reason to hide a live, hosted game
    // from the store + search. So SANITIZE-and-KEEP: empty passes untouched;
    // anything invalid is coerced to a safe default and the game still ships.
    // (Previously `!= null` let "" reach safeText, which rejects empty strings,
    // dropping every game published without a hand-written description — 10 live
    // games were silently missing from the storefront. See
    // REGISTRY-VALIDATION-RECOMMENDATIONS.md.)
    if (g.category && !safeText(g.category, 80)) g.category = '';
    if (g.description && !safeText(g.description, 500)) g.description = '';
    if (g.developer && !safeText(g.developer, 60)) g.developer = '';
    if (g.author && !safeText(g.author, 60)) g.author = '';
    if (g.icon != null && (typeof g.icon !== 'string' || !ICON_RE.test(g.icon))) g.icon = ''; // fall back to a name monogram at render
    // Security / routing fields stay HARD-FAIL (a bad value here can't be
    // rendered/linked safely, so excluding the entry is correct):
    if (g.creatorGithub != null && (typeof g.creatorGithub !== 'string' || !GITHUB_USER_RE.test(g.creatorGithub))) {
      errors.push(`creatorGithub must be a GitHub username, got ${JSON.stringify(g.creatorGithub)}`);
    }
    if (g.repo != null && (typeof g.repo !== 'string' || g.repo.length > 100 || !/^[\w.-]+\/[\w.-]+$/.test(g.repo))) {
      errors.push(`repo must be "owner/name", got ${JSON.stringify(g.repo)}`);
    }

    if (errors.length) {
      skipped.push({ id: g.id || '(no id)', errors });
      continue;
    }
    seenIds.add(g.id);
    valid.push(g);
  }

  if (skipped.length) {
    const detail = skipped.map((s) => `  - ${s.id}: ${s.errors.join('; ')}`).join('\n');
    console.warn(
      `⚠ Registry: skipped ${skipped.length} invalid game entr${skipped.length === 1 ? 'y' : 'ies'} ` +
      `(excluded from build, NOT deployed):\n${detail}`,
    );
    // Surface the drop where a human will actually see it: a GitHub Actions
    // warning annotation + the run's build summary. A silently-dropped published
    // game was invisible for weeks with only a buried console.warn as a signal
    // (REGISTRY-VALIDATION-RECOMMENDATIONS.md #4). Now every deploy that hides a
    // game flags it on the run.
    if (process.env.GITHUB_ACTIONS) {
      const ids = skipped.map((s) => s.id).join(', ');
      console.log(`::warning title=Registry dropped ${skipped.length} game(s)::${ids} excluded from the store — check registry.json`);
      if (process.env.GITHUB_STEP_SUMMARY) {
        try {
          fs.appendFileSync(
            process.env.GITHUB_STEP_SUMMARY,
            `### ⚠ ${skipped.length} game(s) dropped from the store build\n\n` +
            skipped.map((s) => `- \`${s.id}\` — ${s.errors.join('; ')}`).join('\n') + '\n',
          );
        } catch { /* summary is best-effort */ }
      }
    }
  }
  console.log(`Registry: ${valid.length}/${items.length} games valid and included in the build.`);
  return valid;
}
games = validateRegistry(games);

// Guard: keep test fixtures out of the PUBLIC store (PLATFORM-ISSUES B). A publish
// whose id ends in `-test`/`-fixture` (or carries `test: true`) is a fixture, not a
// real game — e.g. `mcp-hybrid-test` leaked into the prod registry and rendered as a
// real card. Exclude them from index.html + search; log so it's visible, never
// silent. (`speedtest` etc. are safe — the pattern requires a `-` or string start
// before `test`.)
const TEST_ID = /(?:^|-)(?:test|fixture)$/i;
const fixtures = games.filter((g) => g.test === true || TEST_ID.test(g.id || ''));
if (fixtures.length) {
  games = games.filter((g) => !(g.test === true || TEST_ID.test(g.id || '')));
  console.log(`Registry: excluded ${fixtures.length} test fixture(s) from the store: ${fixtures.map((g) => g.id).join(', ')}`);
}

// Build-status gate (freegamestore-online/platform#22). Provisioning writes the
// repo, host route and registry entry BEFORE the first build runs, so a game can
// be legitimately listed here while its code has never compiled — and the host
// answers a real 200 for the template scaffold either way, so "the URL responds"
// proves nothing. `status` records the build lifecycle:
//   live    — a deploy.yml run concluded success at least once
//   pending — provisioned, no successful build yet
//   failed  — every build so far failed
//
// Only pending/failed are hidden. A MISSING status means the entry predates the
// field (the whole pre-2026-08-11 catalogue) and is genuinely live; an
// UNRECOGNISED value is also treated as live, matching readGameStatus in the
// platform's admin worker — a typo in one field must never delist a live game.
const NON_LIVE = new Set(['pending', 'failed']);
const notLive = games.filter((g) => NON_LIVE.has(g.status));
if (notLive.length) {
  games = games.filter((g) => !NON_LIVE.has(g.status));
  const detail = notLive.map((g) => `${g.id} (${g.status})`).join(', ');
  console.log(`Registry: excluded ${notLive.length} non-live game(s) from the store: ${detail}`);
  // Same annotation treatment as a validation drop: hiding a published game must
  // be visible on the run itself, not buried in build output. A silently-hidden
  // game was invisible for weeks the last time this was only a console log
  // (REGISTRY-VALIDATION-RECOMMENDATIONS.md #4).
  if (process.env.GITHUB_ACTIONS) {
    console.log(`::warning title=Registry hid ${notLive.length} non-live game(s)::${detail} — no successful build yet, excluded from the store`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      try {
        fs.appendFileSync(
          process.env.GITHUB_STEP_SUMMARY,
          `### ${notLive.length} game(s) hidden — no successful build yet\n\n` +
          notLive.map((g) => `- \`${g.id}\` — status \`${g.status}\``).join('\n') + '\n',
        );
      } catch { /* summary is best-effort */ }
    }
  }
}

// Read templates
const indexTemplate = fs.readFileSync(path.join(ROOT, 'templates', 'index.html'), 'utf8');
const detailTemplate = fs.readFileSync(path.join(ROOT, 'templates', 'game-detail.html'), 'utf8');
const developersTemplate = fs.readFileSync(path.join(ROOT, 'templates', 'developers.html'), 'utf8');
const authorTemplate = fs.readFileSync(path.join(ROOT, 'templates', 'author.html'), 'utf8');

// CF Web Analytics — token from FGS_CF_BEACON_TOKEN at build time. Snippet is
// the standard CF Insights beacon; cookieless, no PII. If unset, an HTML
// comment is emitted so the page validates but no beacon ships.
const CF_BEACON_TOKEN = (process.env.FGS_CF_BEACON_TOKEN || '').trim();
const CF_BEACON_SNIPPET = CF_BEACON_TOKEN && /^[a-f0-9]{32,}$/i.test(CF_BEACON_TOKEN)
  ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${CF_BEACON_TOKEN}"}'></script>`
  : '<!-- CF Web Analytics: FGS_CF_BEACON_TOKEN unset at build time -->';

// Helper: format category label (brain-training -> Brain Training)
function categoryLabel(cat) {
  if (!cat) return 'Uncategorized';
  return cat.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Helper: type label
function typeLabel(type) {
  return type === 'standalone' ? 'Standalone (works offline)' : 'Connected (requires internet)';
}

// --- GitHub API helpers (used to source first-published + commit log) ---

const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

function ghFetch(urlPath) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'freegamestore-build',
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (GH_TOKEN) headers['Authorization'] = `Bearer ${GH_TOKEN}`;
    const req = https.request(
      { hostname: 'api.github.com', path: urlPath, method: 'GET', headers },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(data)); }
            catch (e) { reject(new Error(`bad JSON from ${urlPath}: ${e.message}`)); }
          } else {
            const isRateLimit = res.statusCode === 403 && /rate limit/i.test(data);
            reject(new Error(`${urlPath} → ${res.statusCode}${isRateLimit ? ' (rate limited)' : ''}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const FMT_DATE = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
const FMT_SHORT = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Trim the GitHub API responses to only the fields the renderer reads.
 * Keeps the cache file ~30 KB instead of ~350 KB.
 */
function compactHistory(meta, commits) {
  return {
    meta: meta
      ? {
          created_at: meta.created_at ?? null,
          pushed_at: meta.pushed_at ?? null,
        }
      : null,
    commits: Array.isArray(commits)
      ? commits.map((c) => ({
          sha: c.sha,
          html_url: c.html_url,
          commit: {
            message: c.commit?.message ?? '',
            author: { date: c.commit?.author?.date ?? c.commit?.committer?.date ?? null },
          },
        }))
      : null,
  };
}

async function fetchGameHistory(repo) {
  // repo is "owner/name". Two parallel calls: repo metadata for created_at,
  // and the last 3 commits for the changelog. Failures degrade gracefully.
  try {
    const [meta, commits] = await Promise.all([
      ghFetch(`/repos/${repo}`),
      ghFetch(`/repos/${repo}/commits?per_page=3`),
    ]);
    return compactHistory(meta, commits);
  } catch (err) {
    console.warn(`  ! could not fetch history for ${repo}: ${err.message}`);
    return { meta: null, commits: null };
  }
}

// --- History cache (data/commit-history.json) ---
//
// A normal build is OFFLINE: it sources every game's commit history purely
// from the committed data/commit-history.json cache and makes ZERO GitHub API
// calls. Only the scheduled/manual deploy that maintains the cache opts in to
// live fetching via FGS_REFRESH_HISTORY=1 — it hits the API (with a token to
// lift the rate limit), rewrites the cache file, and commits it back. Every
// other build (push deploys, CF Pages' no-token build, local dev) just reads
// the baked file, so pushes never rate-limit and local builds need no token.
const REFRESH_HISTORY = process.env.FGS_REFRESH_HISTORY === '1';
const CACHE_PATH = path.join(ROOT, 'data', 'commit-history.json');

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeCache(cache) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n');
}

async function fetchAllHistories(games) {
  const cache = readCache();
  if (!REFRESH_HISTORY) {
    // Offline path (default): no network. Read straight from the cache; a game
    // not yet cached (e.g. just added to the registry) renders an empty history
    // and gets filled in on the next FGS_REFRESH_HISTORY run.
    return games.map((game) => cache[game.repo] || { meta: null, commits: null });
  }
  // Refresh path (opt-in): fetch fresh from the GitHub API and rewrite the cache.
  const histories = await Promise.all(
    games.map(async (game) => {
      const fresh = await fetchGameHistory(game.repo);
      if (fresh.commits) {
        cache[game.repo] = fresh;
        return fresh;
      }
      const cached = cache[game.repo];
      if (cached?.commits) return cached;
      return fresh;
    }),
  );
  writeCache(cache);
  return histories;
}

function renderHistorySection(repo, history) {
  const githubAllUrl = `https://github.com/${repo}/commits/main`;
  if (!history.commits || history.commits.length === 0) {
    return `<section class="app-section">
      <h2>Recent updates</h2>
      <p class="text-muted">No updates yet — check back after the first deploy.</p>
      <p><a class="source-link" href="${githubAllUrl}" target="_blank" rel="noopener">See full history on GitHub &rarr;</a></p>
    </section>`;
  }
  const items = history.commits.map((c) => {
    const date = new Date(c.commit.author?.date ?? c.commit.committer?.date);
    const isoDate = date.toISOString().slice(0, 10);
    const shortDate = FMT_SHORT.format(date);
    const firstLine = (c.commit.message || '').split('\n')[0].trim();
    const msg = escapeHtml(firstLine).slice(0, 140);
    const sha = c.sha.slice(0, 7);
    return `<li class="version-row">
      <time datetime="${isoDate}" class="version-date">${shortDate}</time>
      <span class="version-msg">${msg}</span>
      <a class="version-sha" href="${c.html_url}" target="_blank" rel="noopener">${sha}</a>
    </li>`;
  }).join('\n');
  return `<section class="app-section">
      <h2>Recent updates</h2>
      <ul class="version-log">
${items}
      </ul>
      <p class="mt-sm"><a class="source-link" href="${githubAllUrl}" target="_blank" rel="noopener">See full history on GitHub &rarr;</a></p>
    </section>`;
}

function renderPublishedLine(history) {
  if (!history.meta) return '';
  const created = history.meta.created_at ? new Date(history.meta.created_at) : null;
  const lastCommit = history.commits?.[0];
  const updated = lastCommit?.commit?.author?.date
    ? new Date(lastCommit.commit.author.date)
    : history.meta.pushed_at ? new Date(history.meta.pushed_at) : null;
  const parts = [];
  if (created) {
    parts.push(`First published <time datetime="${created.toISOString().slice(0,10)}">${FMT_DATE.format(created)}</time>`);
  }
  if (updated) {
    parts.push(`last updated <time datetime="${updated.toISOString().slice(0,10)}">${FMT_DATE.format(updated)}</time>`);
  }
  if (parts.length === 0) return '';
  return `<p class="published-line">${parts.join(' &middot; ')}</p>`;
}

// Clean generated directories without touching dist/docs, which is built by the
// docs package in a separate step.
for (const dir of ['games', 'u', 'ai', 'audit-fixture']) {
  fs.rmSync(path.join(DIST, dir), { recursive: true, force: true });
}

// Ensure dist directories exist
fs.mkdirSync(path.join(DIST, 'games'), { recursive: true });

// Remove legacy pages that are no longer part of the public site. The build does
// not wipe all of dist because docs are built into dist/docs in a second step.
for (const file of ['docs.html', 'guidelines.html', 'pricing.html']) {
  fs.rmSync(path.join(DIST, file), { force: true });
}

// --- Generate index.html ---

// Build game cards — compact letter-badge layout, Figma 2026
// Per-card icon backgrounds live in dist/card-styles.css so a malformed
// iconBg slipping past validation never reaches an HTML style attribute.
function escapeAttrCss(s) { return String(s).replace(/[^a-z0-9_-]/gi, '_'); }
const cardIconBackgrounds = games
  .map(g => {
    const bg = g.iconBg || '#10b981';
    const id = escapeAttrCss(g.id);
    return `.app-card[data-id="${id}"] .app-icon { background: ${bg}; }\n.app-hero-icon[data-id="${id}"] { background: ${bg}; }`;
  })
  .join('\n');

const styleVersion = crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(ROOT, 'style.css')))
  .digest('hex')
  .slice(0, 12);
const cardStylesVersion = crypto.createHash('sha256')
  .update(cardIconBackgrounds)
  .digest('hex')
  .slice(0, 12);

// Content-hash version tag per local JS file. These scripts carry an SRI
// `integrity=` in the HTML, so the served bytes MUST match the hash the HTML
// was built with. But they live at stable URLs (/theme.js) with a 24h edge
// cache, so a deploy that changes a script leaves the edge serving stale bytes
// against the new SRI hash → the browser blocks it (this bricked theme.js →
// dead nav site-wide). Appending ?v=<hash> makes each version a fresh cache
// key, so the served bytes always match the integrity hash. No purge needed.
const JS_ASSETS = ['theme.js', 'search.js', 'storefront.js', 'detail-page.js', 'quality.js', 'get-started.js', 'leaderboard.js'];
const jsVersions = Object.fromEntries(
  JS_ASSETS.map((f) => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex').slice(0, 12)]),
);

function replaceAssetVersions(html) {
  return html
    .replaceAll('{{STYLE_VERSION}}', styleVersion)
    .replaceAll('{{CARD_STYLES_VERSION}}', cardStylesVersion)
    // Cache-bust local stylesheet links, including copied static pages that
    // still use href="style.css" rather than the template placeholder.
    .replace(/href="\/?style\.css"/g, `href="/style.css?v=${styleVersion}"`)
    // Cache-bust local scripts: src="/theme.js" → src="/theme.js?v=<hash>".
    .replace(/src="\/([a-z0-9-]+)\.js"/g, (m, name) => {
      const version = jsVersions[`${name}.js`];
      return version ? `src="/${name}.js?v=${version}"` : m;
    });
}

function creatorGithubForGame(game) {
  if (game.creatorGithub) return game.creatorGithub;
  if ((game.developer || '') === 'FreeGameStore') return PLATFORM_CREATOR_GITHUB;
  return null;
}

function gamesForCreator(username) {
  return games.filter((game) => creatorGithubForGame(game) === username);
}

function renderAuthorChip(game) {
  const creator = creatorGithubForGame(game);
  if (creator) {
    const user = escapeHtml(creator);
    return `<a href="/u/${user}.html" class="author-chip"><img src="https://avatars.githubusercontent.com/${user}?size=40" alt="" class="author-chip-avatar" loading="lazy" width="20" height="20" /><span class="author-chip-name">@${user}</span></a>`;
  }
  return escapeHtml(game.author || game.developer || 'FreeGameStore');
}

// Safe HTML for a game's icon. A registry icon is ICON_RE-validated (an HTML
// entity or emoji), so it's safe to inject raw; otherwise (empty / sanitized
// away) fall back to an escaped one-letter monogram from the name. Used
// everywhere the icon renders so a game with no icon still shows something and is
// never a blank box.
function iconHtml(game) {
  if (game.icon && ICON_RE.test(game.icon)) return game.icon;
  return escapeHtml((game.name || '?').trim().charAt(0).toUpperCase() || '?');
}

function renderGameCard(game) {
  const icon = iconHtml(game);
  return `        <div class="app-card compact" data-id="${escapeHtml(game.id)}" data-category="${escapeHtml(game.category)}" data-published="${escapeHtml(game.firstPublished || '')}" data-about="/games/${escapeHtml(game.id)}.html">
          <div class="app-icon">${icon}</div>
          <div class="app-body">
            <span class="app-name">${escapeHtml(game.name)}</span>
            <span class="app-meta">${escapeHtml(categoryLabel(game.category))}</span>
          </div>
          <a href="${escapeHtml(game.appUrl)}" rel="noopener" class="app-cta" aria-label="Play ${escapeHtml(game.name)}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="6,4 20,12 6,20" /></svg>
            <span class="cta-label">Play</span>
          </a>
        </div>`;
}

const gameCards = games.map(renderGameCard).join('\n\n');

// SHA-256 of the inline no-flash theme bootstrap so CSP can whitelist it
// without 'unsafe-inline'. The bootstrap is the first <script> inside <head>.
const inlineScriptMatch = indexTemplate.match(/<head>[\s\S]*?<script>([\s\S]*?)<\/script>/);
if (!inlineScriptMatch) {
  console.error('Could not locate the inline bootstrap <script> for CSP hashing');
  process.exit(1);
}
const inlineScriptHash = 'sha256-' + crypto.createHash('sha256').update(inlineScriptMatch[1]).digest('base64');

// SRI hashes for local scripts — browsers refuse to execute if the file
// content changes (CDN compromise, in-flight tamper).
function sriHash(filename) {
  const content = fs.readFileSync(path.join(ROOT, filename));
  return 'sha256-' + crypto.createHash('sha256').update(content).digest('base64');
}
const sriHashes = {
  SEARCH_JS: sriHash('search.js'),
  STOREFRONT_JS: sriHash('storefront.js'),
  THEME_JS: sriHash('theme.js'),
  DETAIL_PAGE_JS: sriHash('detail-page.js'),
};

// indexHtml is finalized inside the async IIFE below — cross-store
// registry fetch is async, and we want to embed it into the page.
let indexHtml = indexTemplate
  .replaceAll('__CF_BEACON__', CF_BEACON_SNIPPET)
  .replaceAll('{{INLINE_SCRIPT_HASH}}', inlineScriptHash)
  .replaceAll('{{GAMES_GRID}}', gameCards)
  .replaceAll('{{GAMES_COUNT}}', String(games.length));
indexHtml = replaceAssetVersions(indexHtml);
for (const [k, v] of Object.entries(sriHashes)) {
  indexHtml = indexHtml.replaceAll(`{{SRI_${k}}}`, v);
}

// --- Generate game detail pages ---
// Wrapped in async IIFE because this file is CJS (no top-level await).

async function fetchAuditSummary() {
  // Read quality data from the local file produced by the FGS auditor.
  // Degrades gracefully — if the file doesn't exist, badges don't render.
  try {
    const qualityPath = path.join(ROOT, 'data', 'quality-results.json');
    const raw = fs.readFileSync(qualityPath, 'utf8');
    const parsed = JSON.parse(raw);
    const map = new Map();
    for (const g of parsed.games ?? []) {
      map.set(g.id, { appId: g.id, score: g.score, loadTimeMs: g.loadTimeMs });
    }
    return map;
  } catch (err) {
    console.warn(`  ! could not read quality data: ${err.message}`);
    return new Map();
  }
}

function renderAuditBadge(summary) {
  if (!summary) {
    return '<p class="audit-badge audit-pending"><span class="dot"></span> Not yet audited</p>';
  }
  if (summary.score >= 95) {
    return `<p class="audit-badge audit-pass"><span class="dot"></span> Quality ${summary.score}/99</p>`;
  }
  if (summary.score >= 60) {
    return `<p class="audit-badge audit-warn"><span class="dot"></span> Quality ${summary.score}/99</p>`;
  }
  return `<p class="audit-badge audit-fail"><span class="dot"></span> Quality ${summary.score}/99</p>`;
}

function fetchManifest(appUrl) {
  return new Promise((resolve) => {
    try {
      const u = new URL('/manifest.json', appUrl);
      const req = https.request(
        { hostname: u.hostname, path: u.pathname, method: 'GET' },
        (r) => {
          let data = '';
          r.on('data', (c) => (data += c));
          r.on('end', () => {
            if (r.statusCode !== 200) return resolve(null);
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve(null);
            }
          });
        },
      );
      req.on('error', () => resolve(null));
      req.setTimeout(6000, () => {
        req.destroy();
        resolve(null);
      });
      req.end();
    } catch {
      resolve(null);
    }
  });
}

function viewportCoverage(minWidth) {
  if (minWidth <= 320) return 99;
  if (minWidth <= 360) return 96;
  if (minWidth <= 414) return 88;
  if (minWidth <= 600) return 60;
  if (minWidth <= 768) return 35;
  if (minWidth <= 1024) return 20;
  return 10;
}

function renderViewportBadge(manifest) {
  if (!manifest) {
    return '<p class="audit-badge audit-pending"><span class="dot"></span> Viewport support: unknown</p>';
  }
  const orientation = typeof manifest.orientation === 'string' ? manifest.orientation : null;
  const minWidth =
    typeof manifest.min_viewport_width === 'number' ? manifest.min_viewport_width : null;
  if (orientation === null || minWidth === null) {
    return '<p class="audit-badge audit-pending"><span class="dot"></span> Viewport support: not declared</p>';
  }
  const coverage = viewportCoverage(minWidth);
  const orientLabel =
    orientation === 'any'
      ? 'portrait + landscape'
      : orientation === 'portrait' || orientation === 'portrait-primary'
        ? 'portrait only'
        : 'landscape only';
  const cls = coverage >= 90 ? 'audit-pass' : coverage >= 50 ? 'audit-warn' : 'audit-fail';
  return `<p class="audit-badge ${cls}"><span class="dot"></span> Works on ~${coverage}% of devices · ${orientLabel} · min ${minWidth}px wide</p>`;
}

async function fetchCrossStoreRegistry() {
  // Pull the OTHER store's registry so the homepage search can
  // federate. Failure → empty registry, search still works locally.
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'raw.githubusercontent.com',
        path: '/freeappstore-online/freeappstore/main/registry.json',
        method: 'GET',
      },
      (r) => {
        let data = '';
        r.on('data', (c) => (data += c));
        r.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({
              items: parsed.apps ?? [],
              domain: 'freeappstore.online',
              path: 'apps',
            });
          } catch {
            resolve({ items: [], domain: 'freeappstore.online', path: 'apps' });
          }
        });
      },
    );
    req.on('error', () => resolve({ items: [], domain: 'freeappstore.online', path: 'apps' }));
    req.end();
  });
}

(async () => {
console.log(
  REFRESH_HISTORY
    ? `Refreshing commit history for ${games.length} games from the GitHub API...`
    : `Loading commit history for ${games.length} games from cache (offline, no GitHub API)...`,
);
const [histories, auditMap, crossRegistry, manifests] = await Promise.all([
  fetchAllHistories(games),
  fetchAuditSummary(),
  fetchCrossStoreRegistry(),
  Promise.all(games.map((g) => fetchManifest(g.appUrl))),
]);

indexHtml = indexHtml.replace(
  '{{CROSS_STORE_REGISTRY}}',
  JSON.stringify(crossRegistry).replace(/</g, '\\u003c'),
);
fs.writeFileSync(path.join(DIST, 'index.html'), indexHtml);
fs.writeFileSync(path.join(DIST, 'card-styles.css'), cardIconBackgrounds + '\n');

// --- Quality Dashboard ---
const qualityTemplate = fs.readFileSync(path.join(ROOT, 'templates', 'quality.html'), 'utf8');
const qualityRegistry = {
  apps: (crossRegistry.items || []).map(a => ({ id: a.id, name: a.name, appUrl: a.appUrl })),
  games: games.map(g => ({ id: g.id, name: g.name, appUrl: g.appUrl })),
  // Platform fixtures — deliberately-broken control cases used to verify
  // the auditor flags each layout-bug class correctly. Visible from the
  // /quality dashboard but filtered out of the main store browse.
  fixtures: [
    { id: 'auditor-fixture', name: 'Auditor Fixture', appUrl: '/audit-fixture/', fixture: true,
      description: 'Deliberately-broken control cases. Each scenario reproduces a known layout bug to verify the platform auditor flags it correctly.' },
  ],
};
let qualityHtml = qualityTemplate
  .replaceAll('__CF_BEACON__', CF_BEACON_SNIPPET)
  .replace(
    '{{REGISTRIES_JSON}}',
    JSON.stringify(qualityRegistry).replace(/</g, '\\u003c'),
  );
for (const [k, v] of Object.entries(sriHashes)) {
  qualityHtml = qualityHtml.replaceAll(`{{SRI_${k}}}`, v);
}
const qualityHtmlWithAssets = replaceAssetVersions(qualityHtml);
fs.writeFileSync(path.join(DIST, 'quality.html'), qualityHtmlWithAssets);
console.log(`  /quality dashboard generated for ${qualityRegistry.games.length} games + ${qualityRegistry.apps.length} apps`);

// --- Generate per-author profile pages at /u/<username>.html ---
// This mirrors FAS: creatorGithub is the stable identity. Legacy first-party
// entries predate creatorGithub, so they fall back to the platform creator
// instead of disappearing from all creator profiles.
const uniqueAuthors = [...new Set(games.map(creatorGithubForGame).filter(Boolean))].sort((a, b) => {
  const countDiff = gamesForCreator(b).length - gamesForCreator(a).length;
  return countDiff || a.localeCompare(b);
});
fs.mkdirSync(path.join(DIST, 'u'), { recursive: true });

function computeAuthorBadges(authorGames) {
  const badges = [];
  const count = authorGames.length;
  if (count >= 1) badges.push({ label: 'First release', title: 'Has at least one game published on FreeGameStore.' });
  if (count >= 3) badges.push({ label: 'Game stack', title: 'Published 3 or more games.' });
  if (count >= 5) badges.push({ label: 'Prolific', title: 'Published 5 or more games.' });
  if (count >= 10) badges.push({ label: 'Established', title: 'Published 10 or more games.' });
  const categories = new Set(authorGames.map((g) => String(g.category || '').toLowerCase()).filter(Boolean));
  if (categories.size >= 2) badges.push({ label: 'Genre explorer', title: `Games span ${categories.size} distinct categories.` });
  const audited = authorGames.filter((g) => auditMap.get(g.id)).length;
  if (count >= 3 && audited / count >= 0.75) badges.push({ label: 'Audited', title: `${audited} of ${count} games have platform audit data.` });
  return badges;
}

function renderBadges(badges) {
  if (badges.length === 0) return '';
  return `<div class="badges">\n${badges.map((b) => `          <span class="badge" title="${escapeHtml(b.title)}">${escapeHtml(b.label)}</span>`).join('\n')}\n        </div>`;
}

function authorCategories(authorGames) {
  const categories = [];
  const seen = new Set();
  for (const game of authorGames) {
    const label = categoryLabel(game.category);
    const key = label.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      categories.push(label);
    }
  }
  return categories;
}

function mostCommonCategory(items) {
  const counts = new Map();
  for (const game of items) {
    const label = categoryLabel(game.category);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || 'New games';
}

function dateValue(game) {
  const date = game.lastUpdated || game.firstPublished || game.versions?.[0]?.date || '';
  const time = Date.parse(date);
  return Number.isFinite(time) ? time : 0;
}

function sortByFreshness(items) {
  return [...items].sort((a, b) => dateValue(b) - dateValue(a) || a.name.localeCompare(b.name));
}

function renderCategoryChips(categories, className = 'category-chip-row') {
  if (categories.length === 0) return '';
  return `<div class="${className}">${categories.slice(0, 4).map((category) => `<span class="category-chip">${escapeHtml(category)}</span>`).join('')}</div>`;
}

function renderDeveloperStats() {
  const creatorGames = games.filter((game) => creatorGithubForGame(game));
  const topGenre = mostCommonCategory(creatorGames);
  const stats = [
    { label: 'Creators', value: String(uniqueAuthors.length) },
    { label: 'Creator games', value: String(creatorGames.length) },
    { label: 'Top genre', value: topGenre },
  ];
  return stats.map((stat) => `<div class="developer-stat"><span>${escapeHtml(stat.label)}</span><strong>${escapeHtml(stat.value)}</strong></div>`).join('\n        ');
}

function renderAuthorStats(authorGames) {
  const categories = authorCategories(authorGames);
  const stats = [
    { label: 'Games', value: String(authorGames.length) },
    { label: 'Genres', value: String(categories.length) },
    { label: 'Latest', value: sortByFreshness(authorGames)[0]?.name || 'New game' },
  ];
  return `<div class="author-stat-grid">${stats.map((stat) => `<div class="author-stat"><span>${escapeHtml(stat.label)}</span><strong>${escapeHtml(stat.value)}</strong></div>`).join('')}</div>`;
}

function renderAuthorSpotlight(authorGames) {
  const latest = sortByFreshness(authorGames)[0];
  const categories = authorCategories(authorGames);
  if (!latest) return '';
  return `<section class="author-spotlight">
      <div>
        <span class="spotlight-label">Latest game</span>
        <a href="/games/${escapeHtml(latest.id)}.html">${escapeHtml(latest.name)}</a>
      </div>
      <div>
        <span class="spotlight-label">Genre lane</span>
        <strong>${escapeHtml(mostCommonCategory(authorGames))}</strong>
      </div>
      <div>
        <span class="spotlight-label">Catalog</span>
        <strong>${authorGames.length} game${authorGames.length === 1 ? '' : 's'}${categories.length ? ` across ${categories.length} genre${categories.length === 1 ? '' : 's'}` : ''}</strong>
      </div>
    </section>`;
}

function renderDevGameList(authorGames) {
  const items = sortByFreshness(authorGames).slice(0, 3);
  if (items.length === 0) return '';
  return `<ul class="dev-game-list">${items.map((game) => `<li><span>${iconHtml(game)}</span>${escapeHtml(game.name)}</li>`).join('')}</ul>`;
}

for (const username of uniqueAuthors) {
  const authorGames = gamesForCreator(username);
  const categories = authorCategories(authorGames);
  let html = authorTemplate
    .replaceAll('__CF_BEACON__', CF_BEACON_SNIPPET)
    .replace(/\{\{USERNAME\}\}/g, escapeHtml(username))
    .replace(/\{\{GAME_COUNT\}\}/g, String(authorGames.length))
    .replace(/\{\{S\}\}/g, authorGames.length === 1 ? '' : 's')
    .replace(/\{\{BADGES\}\}/g, renderBadges(computeAuthorBadges(authorGames)))
    .replace(/\{\{AUTHOR_STATS\}\}/g, renderAuthorStats(authorGames))
    .replace(/\{\{AUTHOR_SPOTLIGHT\}\}/g, renderAuthorSpotlight(authorGames))
    .replace(/\{\{CATEGORY_CHIPS\}\}/g, renderCategoryChips(categories))
    .replace(/\{\{GAME_CARDS\}\}/g, authorGames.map(renderGameCard).join('\n\n'));
  html = replaceAssetVersions(html);
  for (const [k, v] of Object.entries(sriHashes)) {
    html = html.replaceAll(`{{SRI_${k}}}`, v);
  }
  fs.writeFileSync(path.join(DIST, 'u', `${username}.html`), html);
}

// --- Generate developers.html ---
const devCards = uniqueAuthors.map(username => {
  const authorGames = gamesForCreator(username);
  const badges = computeAuthorBadges(authorGames);
  const categories = authorCategories(authorGames);
  const badgesHtml = badges.length > 0
    ? `<div class="dev-badges">${badges.map(b => `<span class="dev-badge" title="${escapeHtml(b.title)}">${escapeHtml(b.label)}</span>`).join('')}</div>`
    : '';
  return `        <a class="dev-card" href="/u/${escapeHtml(username)}.html">
          <div class="dev-card-top">
            <img class="dev-avatar" src="https://avatars.githubusercontent.com/${escapeHtml(username)}?size=200" alt="" loading="lazy" />
            <span class="dev-card-count">${authorGames.length}</span>
          </div>
          <div class="dev-card-body">
            <span class="dev-card-name">@${escapeHtml(username)}</span>
            <span class="dev-card-role">${authorGames.length === 1 ? 'Game maker' : 'Game maker with a shelf'}</span>
            ${badgesHtml}
            ${renderCategoryChips(categories, 'dev-category-row')}
            ${renderDevGameList(authorGames)}
            <span class="dev-profile-link">View profile &rarr;</span>
          </div>
        </a>`;
}).join('\n');

let developersHtml = developersTemplate
  .replaceAll('__CF_BEACON__', CF_BEACON_SNIPPET)
  .replaceAll('{{DEVELOPER_STATS}}', renderDeveloperStats())
  .replaceAll('{{DEVELOPERS_GRID}}', devCards);
developersHtml = replaceAssetVersions(developersHtml);
for (const [k, v] of Object.entries(sriHashes)) {
  developersHtml = developersHtml.replaceAll(`{{SRI_${k}}}`, v);
}
fs.writeFileSync(path.join(DIST, 'developers.html'), developersHtml);
console.log(`  developers page generated (${uniqueAuthors.length} developer${uniqueAuthors.length === 1 ? '' : 's'})`);

const okCount = histories.filter((h) => Array.isArray(h?.commits) && h.commits.length > 0).length;
console.log(`  ${okCount}/${games.length} games got commit history`);
console.log(`  ${auditMap.size} games have audit results`);
console.log(`  ${crossRegistry.items.length} apps available for cross-store search`);

games.forEach((game, i) => {
  const offline = game.type === 'standalone' ? 'Yes' : 'When cached';
  const account = game.type === 'standalone' ? 'Not required' : 'Not required';
  const history = histories[i];

  // XSS defense: every user-facing field that's not pre-validated to a
  // safe shape (id, iconBg, appUrl all pass the validator above) is
  // escaped here. NAME / DESCRIPTION / AUTHOR / DEVELOPER are free-form.
  let html = detailTemplate
    .replaceAll('__CF_BEACON__', CF_BEACON_SNIPPET)
    .replace(/\{\{NAME\}\}/g, escapeHtml(game.name))
    .replace(/\{\{NAME_LOWER\}\}/g, escapeHtml(game.name.toLowerCase()))
    .replace(/\{\{ID\}\}/g, escapeHtml(game.id))
    .replace(/\{\{ICON\}\}/g, iconHtml(game)) // validated entity/emoji, else escaped monogram
    .replace(/\{\{ICON_BG\}\}/g, escapeHtml(game.iconBg))
    .replace(/\{\{CATEGORY_LABEL\}\}/g, escapeHtml(categoryLabel(game.category)))
    .replace(/\{\{DESCRIPTION\}\}/g, escapeHtml(game.description))
    .replace(/\{\{APP_URL\}\}/g, escapeHtml(game.appUrl))
    .replace(/\{\{REPO\}\}/g, escapeHtml(game.repo))
    .replace(/\{\{TYPE_LABEL\}\}/g, escapeHtml(typeLabel(game.type)))
    .replace(/\{\{DEVELOPER\}\}/g, escapeHtml(game.developer || 'FreeGameStore'))
    .replace(/\{\{AUTHOR\}\}/g, escapeHtml(game.author || game.developer || 'FreeGameStore'))
    .replace(/\{\{AUTHOR_CHIP\}\}/g, renderAuthorChip(game))
    .replace(/\{\{OFFLINE\}\}/g, offline)
    .replace(/\{\{ACCOUNT\}\}/g, account)
    .replace(/\{\{PUBLISHED_LINE\}\}/g, renderPublishedLine(history))
    .replace(/\{\{HISTORY_SECTION\}\}/g, renderHistorySection(game.repo, history))
    .replace(/\{\{AUDIT_BADGE\}\}/g, renderAuditBadge(auditMap.get(game.id)))
    .replace(/\{\{VIEWPORT_BADGE\}\}/g, renderViewportBadge(manifests[i]));
  html = replaceAssetVersions(html);

  for (const [k, v] of Object.entries(sriHashes)) {
    html = html.replaceAll(`{{SRI_${k}}}`, v);
  }

  fs.writeFileSync(path.join(DIST, 'games', `${game.id}.html`), html);
});

// --- Generate sitemap.xml ---

const today = new Date().toISOString().split('T')[0];
const sitemapEntries = [
  '  <url><loc>https://freegamestore.online/</loc><priority>1.0</priority></url>',
  '  <url><loc>https://freegamestore.online/about.html</loc><priority>0.8</priority></url>',
  '  <url><loc>https://freegamestore.online/capabilities.html</loc><priority>0.8</priority></url>',
  '  <url><loc>https://freegamestore.online/browser-apis.html</loc><priority>0.8</priority></url>',
  '  <url><loc>https://freegamestore.online/docs/</loc><priority>0.85</priority></url>',
  '  <url><loc>https://freegamestore.online/docs/guidelines/</loc><priority>0.75</priority></url>',
  '  <url><loc>https://freegamestore.online/contribute.html</loc><priority>0.7</priority></url>',
  '  <url><loc>https://freegamestore.online/get-started.html</loc><priority>0.9</priority></url>',
  '  <url><loc>https://freegamestore.online/build-with-ai.html</loc><priority>0.85</priority></url>',
  '  <url><loc>https://freegamestore.online/ai/claude-code.html</loc><priority>0.7</priority></url>',
  '  <url><loc>https://freegamestore.online/ai/cursor.html</loc><priority>0.7</priority></url>',
  '  <url><loc>https://freegamestore.online/ai/github-copilot.html</loc><priority>0.7</priority></url>',
  '  <url><loc>https://freegamestore.online/ai/aider.html</loc><priority>0.7</priority></url>',
  '  <url><loc>https://freegamestore.online/ai/codex.html</loc><priority>0.7</priority></url>',
  '  <url><loc>https://freegamestore.online/ai/windsurf.html</loc><priority>0.7</priority></url>',
  '  <url><loc>https://freegamestore.online/ai/zed.html</loc><priority>0.7</priority></url>',
  '  <url><loc>https://freegamestore.online/ai/continue.html</loc><priority>0.7</priority></url>',
  '  <url><loc>https://freegamestore.online/ai/cline.html</loc><priority>0.7</priority></url>',
  '  <url><loc>https://freegamestore.online/ai/chatgpt-web.html</loc><priority>0.7</priority></url>',
  '  <url><loc>https://freegamestore.online/leaderboard.html</loc><priority>0.7</priority></url>',
  '  <url><loc>https://freegamestore.online/developers.html</loc><priority>0.8</priority></url>',
  '  <url><loc>https://freegamestore.online/privacy.html</loc><priority>0.5</priority></url>',
  '  <url><loc>https://freegamestore.online/terms.html</loc><priority>0.5</priority></url>',
  ...uniqueAuthors.map(username =>
    `  <url><loc>https://freegamestore.online/u/${username}.html</loc><priority>0.6</priority></url>`
  ),
  ...games.map(game =>
    `  <url><loc>https://freegamestore.online/games/${game.id}.html</loc><priority>0.9</priority></url>`
  )
];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries.join('\n')}
</urlset>
`;

fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap);
fs.writeFileSync(
  path.join(DIST, 'registry.json'),
  JSON.stringify({ ...registry, games }, null, 2) + '\n',
);

// --- Copy static assets ---

const filesToCopy = [
  'style.css',
  'search.js',
  'storefront.js',
  'theme.js',
  'detail-page.js',
  'quality.js',
  'get-started.js',
  'leaderboard.js',
  'favicon.svg',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'manifest.webmanifest',
  'sw.js',
  'robots.txt',
  '404.html',
  'about.html',
  'contribute.html',
  'leaderboard.html',
  'privacy.html',
  'terms.html',
  'build-with-ai.html',
  'get-started.html',
  'SKILLS.md',
  'llms.txt',
  'capabilities.html',
  'browser-apis.html',
  'prism.js',
  'prism-autodetect.js',
];

// Security headers via CF Pages _headers — single source of truth for CSP and
// every other security header. <meta> CSP intentionally absent (frame-ancestors,
// report-to, HSTS can't ride in <meta>). script-src hash whitelists only the
// inline theme bootstrap.
const csp = [
  "default-src 'self'",
  "img-src 'self' https://*.freegamestore.online https://avatars.githubusercontent.com data:",
  `script-src 'self' '${inlineScriptHash}' https://static.cloudflareinsights.com`,
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self' https://*.freegamestore.online https://cloudflareinsights.com",
  "frame-src https://*.freegamestore.online https://*.progamestore.online",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
  // CSP3 reporting + back-compat directive.
  "report-to csp-endpoint",
  "report-uri /v1/csp-report",
].join('; ');

fs.writeFileSync(path.join(DIST, '_headers'), [
  '/*',
  '  X-Frame-Options: DENY',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: strict-origin-when-cross-origin',
  '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
  '  Cross-Origin-Opener-Policy: same-origin',
  '  Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), midi=()',
  '  Reporting-Endpoints: csp-endpoint="/v1/csp-report"',
  `  Content-Security-Policy: ${csp}`,
  // No Content-Security-Policy-Report-Only: it was byte-identical to the
  // enforced policy, so it added zero coverage — just duplicate violation logs
  // and the "'upgrade-insecure-requests' is ignored in report-only" warning on
  // every page. (Reintroduce ONLY as a strictly-tighter next-gen policy to test.)
  '',
  '# PWA: never long-cache the service worker, and serve the manifest with the',
  '# right content-type. These MUST come before the /*.js wildcard below — CF',
  '# Pages applies the FIRST matching rule, so /sw.js would otherwise inherit the',
  '# /*.js 24h cache and SW updates would lag up to a day.',
  '/sw.js',
  '  Cache-Control: no-cache',
  '/manifest.webmanifest',
  '  Content-Type: application/manifest+json',
  '  Cache-Control: public, max-age=86400',
  '',
  '# Long cache for static assets',
  '/*.css',
  '  Cache-Control: public, max-age=86400, stale-while-revalidate=604800',
  '/*.js',
  '  Cache-Control: public, max-age=86400, stale-while-revalidate=604800',
  '/*.png',
  '  Cache-Control: public, max-age=604800, immutable',
  '/*.svg',
  '  Cache-Control: public, max-age=604800, immutable',
  '',
].join('\n'));

fs.writeFileSync(path.join(DIST, '_redirects'), [
  '/docs.html /docs/ 301',
  '/guidelines.html /docs/guidelines/ 301',
  '/pricing.html /about.html 301',
  '',
].join('\n'));

filesToCopy.forEach(file => {
  const src = path.join(ROOT, file);
  if (fs.existsSync(src)) {
    const dest = path.join(DIST, file);
    if (file.endsWith('.html')) {
      fs.writeFileSync(dest, replaceAssetVersions(fs.readFileSync(src, 'utf8')));
    } else {
      fs.copyFileSync(src, dest);
    }
  }
});

// Also serve SKILLS.md at the lowercase /skills.md — the conventional path used
// across llms.txt, the AI guides, and MCP clients (FAS serves both). Without
// this, freegamestore.online/skills.md 404s while /SKILLS.md works.
{
  const skillsSrc = path.join(ROOT, 'SKILLS.md');
  if (fs.existsSync(skillsSrc)) {
    fs.copyFileSync(skillsSrc, path.join(DIST, 'skills.md'));
  }
}

// AI tool guides under /ai/<slug>.html.
const aiSrcDir = path.join(ROOT, 'ai');
if (fs.existsSync(aiSrcDir)) {
  const aiDestDir = path.join(DIST, 'ai');
  fs.mkdirSync(aiDestDir, { recursive: true });
  for (const f of fs.readdirSync(aiSrcDir)) {
    if (!f.endsWith('.html')) continue;
    const src = path.join(aiSrcDir, f);
    fs.writeFileSync(path.join(aiDestDir, f), replaceAssetVersions(fs.readFileSync(src, 'utf8')));
  }
}

// Auditor fixture under /audit-fixture/. Single static page with
// query-param-driven scenarios — see audit-fixture/index.html for the
// scenarios + their expected audit verdicts. Hosted same-origin so the
// /quality dashboard can iframe it without any CORS dance.
const fixtureSrcDir = path.join(ROOT, 'audit-fixture');
if (fs.existsSync(fixtureSrcDir)) {
  const fixtureDestDir = path.join(DIST, 'audit-fixture');
  fs.mkdirSync(fixtureDestDir, { recursive: true });
  for (const f of fs.readdirSync(fixtureSrcDir)) {
    fs.copyFileSync(path.join(fixtureSrcDir, f), path.join(fixtureDestDir, f));
  }
}

// .well-known/ — MCP discovery and other standards
const wellKnownSrc = path.join(ROOT, '.well-known');
if (fs.existsSync(wellKnownSrc)) {
  const wellKnownDest = path.join(DIST, '.well-known');
  fs.mkdirSync(wellKnownDest, { recursive: true });
  for (const f of fs.readdirSync(wellKnownSrc)) {
    fs.copyFileSync(path.join(wellKnownSrc, f), path.join(wellKnownDest, f));
  }
}

console.log(`Built ${games.length} game cards into dist/index.html`);
console.log(`Generated ${games.length} detail pages in dist/games/`);
console.log('Generated dist/sitemap.xml');
console.log('Copied static assets');
})().catch((err) => {
  console.error('build failed:', err);
  process.exit(1);
});
