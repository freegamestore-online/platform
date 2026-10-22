import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Fail closed before uploading an incomplete storefront/docs artifact.
export function verifyDist(dist) {
  for (const file of ['index.html', 'style.css', '_headers', '_redirects',
    'docs/index.html', 'docs/sdk/overview/index.html']) {
    if (!existsSync(resolve(dist, file))) throw new Error(`Missing deployment artifact: ${file}`);
  }
  const docs = readFileSync(resolve(dist, 'docs/index.html'), 'utf8');
  const assets = [...docs.matchAll(/(?:href|src)="(\/docs\/[^"?#]+\.(?:css|js))(?:[?#][^"]*)?"/g)];
  if (!assets.length) throw new Error('SDK docs have no built CSS/JS assets');
  for (const [, asset] of assets) {
    if (!existsSync(resolve(dist, `.${asset}`))) throw new Error(`Missing docs asset: ${asset}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyDist(resolve('dist'));
  console.log('Verified storefront and SDK docs deployment artifact');
}
