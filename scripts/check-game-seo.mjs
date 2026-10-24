// Read-only release verification. Uses only public HTTP, never credentials.
import { pathToFileURL } from 'node:url';

const escapeMetadata = (s) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export async function auditGame(game, fetcher = fetch) {
  const root = new URL(game.appUrl);
  if (root.protocol !== 'https:' || !/^[a-z0-9-]+\.freegamestore\.online$/.test(root.hostname))
    throw new Error('Invalid hosted game URL');
  root.pathname = '/';
  root.search = '';
  root.hash = '';
  const canonical = root.href;
  const problems = [];
  const get = async (path) => {
    const res = await fetcher(new URL(path, root), {
      signal: AbortSignal.timeout(15000),
      redirect: 'manual',
    });
    if (res.status !== 200) problems.push(`${path}: HTTP ${res.status}`);
    return res.text();
  };
  const [html, robots, sitemap] = await Promise.all([
    get('/'),
    get('/robots.txt'),
    get('/sitemap.xml'),
  ]);
  const title = escapeMetadata(`${game.name} – Free Game Store`);
  const description = typeof game.description === 'string' ? escapeMetadata(game.description) : '';
  for (const tag of [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}">`,
    `<link rel="canonical" href="${canonical}">`,
    ...Object.entries({
      'og:title': title,
      'og:description': description,
      'og:url': canonical,
      'og:type': 'website',
      'og:site_name': 'Free Game Store',
    }).map(([key, value]) => `<meta property="${key}" content="${value}">`),
    ...Object.entries({
      'twitter:title': title,
      'twitter:description': description,
    }).map(([key, value]) => `<meta name="${key}" content="${value}">`),
  ])
    if (!html.includes(tag)) problems.push(`missing expected ${tag.split(' content=')[0]}`);
  // Authored cards can choose their own layout; the host supplies summary
  // only when absent. Attribute order and quote style are app-controlled.
  const cards = [...html.matchAll(/<meta\b[^>]*>/gi)].map(([tag]) => {
    const attrs = {};
    for (const [, key, double, single, bare] of tag.matchAll(/([^\s=<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))
      attrs[key.toLowerCase()] = double ?? single ?? bare;
    return attrs;
  }).filter((attrs) => attrs.name === 'twitter:card');
  if (cards.length !== 1 || !cards[0].content?.trim()) problems.push('missing or conflicting twitter:card');
  if (!description) problems.push('missing approved description');
  if (
    !robots.includes('User-agent: *\nAllow: /\n') ||
    !robots.includes(`Sitemap: ${canonical}sitemap.xml`)
  )
    problems.push('robots missing public sitemap contract');
  if (
    !sitemap.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"') ||
    !sitemap.includes(`<loc>${canonical}</loc>`)
  )
    problems.push('sitemap missing canonical root');
  return problems;
}

async function main() {
  const response = await fetch('https://freegamestore.online/registry.json', {
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Public registry HTTP ${response.status}`);
  const { games } = await response.json();
  if (!Array.isArray(games) || !games.length) throw new Error('Empty/invalid public registry');
  const publicGames = games.filter(
    (g) => g.status === undefined || ['live', 'published', 'approved'].includes(g.status),
  );
  let failed = 0;
  for (let offset = 0; offset < publicGames.length; offset += 8) {
    await Promise.all(
      publicGames.slice(offset, offset + 8).map(async (game) => {
        try {
          const problems = await auditGame(game);
          if (problems.length) failed++;
          console.log(`${game.id}: ${problems.length ? problems.join('; ') : 'PASS'}`);
        } catch (error) {
          failed++;
          console.log(`${game.id}: ${error.message}`);
        }
      }),
    );
  }
  console.log(
    `Checked ${publicGames.length}/${games.length} registry entries eligible for public discovery; ${failed} failed.`,
  );
  process.exitCode = failed ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
